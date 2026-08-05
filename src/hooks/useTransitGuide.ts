"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  buildTransitGuideRoute,
  classifyBoardingCandidates,
  initTransitGuide,
  isApproxTransitLock,
  pollIntervalMs,
  subwayIdForOdsayLine,
  transitGuideStep,
  waitingEmptyReason,
  type WaitingEmptyReason,
  type BoardingCandidate,
  type TrackItem,
  type TrackPoll,
  type TransitGuideEvent,
  type TransitGuideLeg,
  type TransitGuideRoute,
  type TransitGuideState,
  type TransitLock,
} from "@/lib/transit-guide";
import { claimGuideSession, releaseGuideSession } from "@/lib/guide-session-store";
import type { TransitRoute } from "@/lib/types";

/**
 * 대중교통 실시간 안내 오케스트레이터(B2 §4·§7) — 판정은 전부 상태 머신
 * (`transit-guide.ts`)이 하고, 여기는 폴링 I/O·세션 수명·통지 문구 조립만 한다.
 *
 * - **단일 비행**: 폴 완료 후에만 다음 폴을 예약한다(setTimeout 체인). 응답
 *   커밋은 머신의 phaseGen·seq 검증이 이중 방어.
 * - 통지는 단일 polite live region 문자열(웹은 톤·interrupting 미적용 — §6.1의
 *   채널 승격은 실승차 창구인 iOS 몫, 웹 주 사용처는 컴퓨터라 polite로 충분).
 *   최신 문자열이 이전 것을 대체하므로 supersede가 구조적으로 성립한다.
 * - 탭 숨김: 폴링 정지(전경 전용), 복귀 시 즉시 1폴 + 상태 통지(§3.2).
 * - 세션 단일성: guide-session-store 공유(도보·자동차와 상호 배제).
 */

/** 대기 목록 항목(소실 유지 포함, §5.1). */
export interface WaitingOption {
  candidate: BoardingCandidate;
  /** 마지막 관측 후 경과(분) — 현재 폴에 없는 항목만(3분 유지). */
  departedMinutes: number | null;
  key: string;
}

interface RetainedItem {
  item: TrackItem;
  lastSeenAt: number;
}

/** 폴 시점에 계산해 두는 대기 목록 스냅숏(렌더 순수성 — 렌더 중 ref·시계 접근 금지). */
interface WaitingSnapshot {
  live: TrackItem[];
  departed: Array<{ item: TrackItem; minutes: number }>;
  /** 마지막 대기 폴의 0건 사유(§13.3) — 항목이 있으면 null. */
  reason: WaitingEmptyReason | null;
}

const EMPTY_WAITING: WaitingSnapshot = { live: [], departed: [], reason: null };

const RETAIN_MS = 180_000;

/** 같은 문장 재발화를 위한 빈 값 경유 지연(useRouteGuide 동일값). */
const REANNOUNCE_DELAY_MS = 120;

function trackTargetUrl(
  leg: TransitGuideLeg,
  phase: "waiting" | "riding" | "arrived",
  resolvedTago: { nodeId: string; cityCode: string } | null,
): string | null {
  const mode = leg.trackMode;
  if (!mode) return null;
  if (mode === "seoulBus") {
    if (phase === "waiting") {
      if (!leg.boardStop?.arsId || !leg.routeId) return null;
      return `/api/transit/track?mode=seoulBus&phase=wait&arsId=${encodeURIComponent(leg.boardStop.arsId)}&routeId=${encodeURIComponent(leg.routeId)}`;
    }
    if (!leg.boardStop?.localId || !leg.alightStop?.localId || !leg.routeId) return null;
    return `/api/transit/track?mode=seoulBus&phase=ride&routeId=${encodeURIComponent(leg.routeId)}&boardId=${encodeURIComponent(leg.boardStop.localId)}&alightId=${encodeURIComponent(leg.alightStop.localId)}`;
  }
  if (mode === "tagoBus") {
    if (!resolvedTago) return null;
    return `/api/transit/track?mode=tagoBus&phase=track&cityCode=${encodeURIComponent(resolvedTago.cityCode)}&nodeId=${encodeURIComponent(resolvedTago.nodeId)}&routeNo=${encodeURIComponent(leg.lineName)}`;
  }
  const station = phase === "waiting" ? leg.boardName : leg.alightName;
  if (!station) return null;
  return `/api/transit/track?mode=subway&phase=track&station=${encodeURIComponent(station)}&line=${encodeURIComponent(leg.lineName)}`;
}

export function useTransitGuide(route: TransitRoute | null) {
  const t = useTranslations("transitGuide");

  const guideRoute = useMemo(
    () => (route ? buildTransitGuideRoute(route) : null),
    [route],
  );

  const [state, setState] = useState<TransitGuideState | null>(null);
  const [waiting, setWaiting] = useState<WaitingSnapshot>(EMPTY_WAITING);
  const [liveMessage, setLiveMessage] = useState("");

  const liveRef = useRef("");
  const reannounceTimerRef = useRef<number | null>(null);
  // 같은 문장이면 DOM 텍스트가 안 바뀌어 aria-live가 침묵한다(진행 상황 버튼
  // 연타 재현) — 빈 값을 한 번 거쳐 재발화한다(useRouteGuide announce 동형).
  const announce = useCallback((text: string) => {
    if (reannounceTimerRef.current !== null) {
      window.clearTimeout(reannounceTimerRef.current);
      reannounceTimerRef.current = null;
    }
    if (text && text === liveRef.current) {
      liveRef.current = "";
      setLiveMessage("");
      reannounceTimerRef.current = window.setTimeout(() => {
        reannounceTimerRef.current = null;
        liveRef.current = text;
        setLiveMessage(text);
      }, REANNOUNCE_DELAY_MS);
      return;
    }
    liveRef.current = text;
    setLiveMessage(text);
  }, []);

  const stateRef = useRef<TransitGuideState | null>(null);
  const routeRef = useRef<TransitGuideRoute | null>(null);
  const seqRef = useRef(0);
  /** 다음 대기 폴 결과를 직접 응답으로 통지(새로고침, §13.2) — 폴 1회 소비. */
  const refreshAnnounceRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const retainedRef = useRef<Map<string, RetainedItem>>(new Map());
  // 지방버스 정류소 해석 캐시(§5.2). ⚠ 키는 (legIndex, 대상 정류소) 복합 —
  // legIndex만 쓰면 waiting에서 해석한 **승차** 정류소가 riding 캐시로 적중해
  // 하차 카운트다운이 승차 정류소 도착을 읽는다(독립 리뷰 BLOCKER).
  const tagoResolvedRef = useRef<Map<string, { nodeId: string; cityCode: string } | "unsupported">>(
    new Map(),
  );

  const commit = useCallback((next: TransitGuideState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const currentLeg = useCallback((): TransitGuideLeg | null => {
    const s = stateRef.current;
    const r = routeRef.current;
    if (!s || !r) return null;
    return r.legs[s.legIndex] ?? null;
  }, []);

  /** 대기 문맥(§4.1): 선행 도보 + 승차 지점 + 노선. */
  const waitContextText = useCallback(
    (leg: TransitGuideLeg): string => {
      const args = { stop: leg.boardName, line: leg.lineName };
      return leg.walkBeforeMinutes != null && leg.walkBeforeMinutes > 0
        ? t("waitContextWalk", { ...args, minutes: leg.walkBeforeMinutes })
        : t("waitContext", args);
    },
    [t],
  );

  /** 노선·하차 전문 문맥(§6.1 M1 개정) — 추적 시작·진행 상황·상시 표시가 담당. */
  const contextText = useCallback(
    (leg: TransitGuideLeg): string => t("context", { line: leg.lineName, stop: leg.alightName }),
    [t],
  );

  /** upstream 완성 문장의 라벨 프레임(§12.3) — 원문 무변형, 하차역 라벨 전치. */
  const frameText = useCallback(
    (leg: TransitGuideLeg, message: string): string =>
      t("messageFrame", { stop: leg.alightName, message }),
    [t],
  );

  /** 0건 사유 문구(§13.3 3-state) — 목록 자리·새로고침 응답 공용. */
  const reasonText = useCallback(
    (reason: WaitingEmptyReason): string =>
      reason === "filtered"
        ? t("noCandidatesFiltered")
        : reason === "unavailable"
          ? t("noCandidatesUnavailable")
          : t("noCandidates"),
    [t],
  );

  const signalText = useCallback(
    (signal: TransitGuideState["signal"]): string =>
      ({
        tracking: t("stateTracking"),
        notYetVisible: t("stateNotYetVisible"),
        signalLost: t("stateSignalLost"),
        upstreamFailed: t("stateUpstreamFailed"),
        untrackable: t("stateUntrackable"),
      })[signal],
    [t],
  );

  /**
   * 상시 표시·진행 상황 공용 조립기(§12.3) — 완성 문장 파트를 공백으로 연결하는
   * 단일 헬퍼. 화면과 통지가 같은 파트 목록을 공유해 드리프트를 구조 차단한다.
   */
  const buildStatusText = useCallback(
    (s: TransitGuideState, leg: TransitGuideLeg): string => {
      const parts = [
        s.phase === "waiting" ? waitContextText(leg) : contextText(leg),
        signalText(s.signal),
        s.remaining != null
          ? t("remainingCount", { count: s.remaining })
          : leg.stationCount != null && s.phase === "riding"
            ? t("stationCountAbout", { count: leg.stationCount })
            : "",
        s.lastMessage ? frameText(leg, s.lastMessage) : "",
        // 근사 주석의 판별자는 leg 유형이 아니라 잠금의 근사 여부(§13.2 — tagoBus는
        // 대기 중에도 근사 예고로 유지).
        leg.trackMode === "tagoBus" || (s.lock != null && isApproxTransitLock(s.lock))
          ? t("approxNote")
          : "",
        // 신선도 문장은 정확히 1개(§12.3, 감사 H2·M1): 추적 중이면 데이터 나이,
        // 그 외(미등장·소실·실패)엔 마지막 폴 시각만 — 낡은 나이를 신선한 값처럼
        // 이월하지 않는다(3-state, useRouteGuide "낡은 fix 거짓 정밀 차단" 동형).
        s.signal === "tracking" && s.dataAgeSeconds != null
          ? t("dataAge", { seconds: s.dataAgeSeconds })
          : s.lastUpdatedAt != null
            ? t("lastUpdated", {
                time: new Date(s.lastUpdatedAt).toLocaleTimeString("ko-KR", {
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                }),
              })
            : "",
      ];
      return parts.filter(Boolean).join(" ");
    },
    [contextText, frameText, signalText, t, waitContextText],
  );

  /** 이벤트 → 통지 문구(완성 문장은 원문 병치). */
  const announceEvent = useCallback(
    (event: TransitGuideEvent): void => {
      const leg = currentLeg();
      const r = routeRef.current;
      const parts: string[] = [];
      switch (event.kind) {
        case "boarded": {
          if (!leg) break;
          parts.push(
            leg.stationCount != null
              ? t("boardedCount", { line: leg.lineName, stop: leg.alightName, count: leg.stationCount })
              : t("boarded", { line: leg.lineName, stop: leg.alightName }),
          );
          break;
        }
        case "trackingStarted":
          if (leg) parts.push(contextText(leg), t("trackingStarted"));
          if (event.message) parts.push(leg ? frameText(leg, event.message) : event.message);
          else if (event.remaining != null) parts.push(t("remainingCount", { count: event.remaining }));
          break;
        case "countdown":
          // §12.3: 매 사다리마다 문맥 문장을 반복하지 않는다 — 프레임이 하차역을 밝힌다.
          parts.push(
            event.message
              ? leg
                ? frameText(leg, event.message)
                : event.message
              : t("remainingCount", { count: event.remaining }),
          );
          // 한 정거장 전 현재 역 병치(§12.2, 피드백 #10) — 잔여 ≥ 2 문장은 원문이
          // 현재 역을 이미 담아 병치하지 않는다(중복 금지).
          if (event.remaining <= 1 && event.currentLocation) {
            parts.push(t("currentStation", { station: event.currentLocation }));
          }
          break;
        case "messageChanged":
          parts.push(leg ? frameText(leg, event.message) : event.message);
          break;
        case "arrived": {
          parts.push(event.certain ? t("arrived") : t("arrivedGuess"));
          const s = stateRef.current;
          const next = s && r ? r.legs[s.legIndex + 1] : null;
          if (next) parts.push(t("nextLeg", { context: waitContextText(next) }));
          else if (r?.walkAfterMinutes != null) {
            parts.push(t("nextLeg", { context: t("doneWalk", { minutes: r.walkAfterMinutes }) }));
          }
          break;
        }
        case "backOnTrack":
          parts.push(t("backOnTrack"));
          if (event.message) parts.push(leg ? frameText(leg, event.message) : event.message);
          break;
        case "approxVehicleChanged":
          parts.push(t("approxVehicleChanged"));
          break;
        case "signalLost":
          parts.push(t("signalLost"));
          break;
        case "upstreamFailed":
          parts.push(t("upstreamFailed"));
          break;
        case "signalRecovered":
          parts.push(t("signalRecovered"));
          break;
        case "capSlowed":
          parts.push(t("capSlowed"));
          break;
        case "legAdvanced": {
          if (event.final) {
            parts.push(
              r?.walkAfterMinutes != null
                ? t("doneWalk", { minutes: r.walkAfterMinutes })
                : t("done"),
            );
          } else {
            const nextLeg = r?.legs[event.legIndex];
            if (nextLeg) {
              parts.push(waitContextText(nextLeg));
              if (!nextLeg.trackMode) parts.push(t("untrackable"));
            }
          }
          break;
        }
        case "boardingReset":
          parts.push(t("changeBoardingDone"));
          break;
      }
      if (parts.length > 0) announce(parts.join(" "));
    },
    [announce, contextText, currentLeg, frameText, t, waitContextText],
  );

  const dispatch = useCallback(
    (input: Parameters<typeof transitGuideStep>[1]): void => {
      const s = stateRef.current;
      const r = routeRef.current;
      if (!s || !r) return;
      const { state: next, event } = transitGuideStep(s, input, r, Date.now());
      commit(next);
      if (event) announceEvent(event);
    },
    [announceEvent, commit],
  );

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** 지방버스 하차 정류소 해석(세션당 1회). 실패는 "unsupported" 캐시(재시도 없음). */
  const resolveTagoIfNeeded = useCallback(async (): Promise<
    { nodeId: string; cityCode: string } | null
  > => {
    const s = stateRef.current;
    const leg = currentLeg();
    if (!s || !leg || leg.trackMode !== "tagoBus") return null;
    const cacheKey = `${s.legIndex}:${s.phase === "waiting" ? "board" : "alight"}`;
    const cached = tagoResolvedRef.current.get(cacheKey);
    if (cached === "unsupported") return null;
    if (cached) return cached;
    const target = s.phase === "waiting" ? leg.boardStop : leg.alightStop;
    if (!target) return null;
    try {
      const res = await fetch(
        `/api/transit/track?mode=tagoBus&phase=resolve&lat=${target.lat}&lng=${target.lng}`,
      );
      if (!res.ok) return null; // 일시 실패 — 캐시하지 않고 다음 폴에서 재시도
      const body = (await res.json()) as {
        status: string;
        stop?: { nodeId: string; cityCode: string };
      };
      if (body.status === "ok" && body.stop) {
        const resolved = { nodeId: body.stop.nodeId, cityCode: body.stop.cityCode };
        tagoResolvedRef.current.set(cacheKey, resolved);
        return resolved;
      }
      tagoResolvedRef.current.set(cacheKey, "unsupported");
      return null;
    } catch {
      return null;
    }
  }, [currentLeg]);

  // 폴 예약은 tick 상태 경유 — 타이머 콜백이 최신 pollOnce를 잡게 하면서
  // 렌더·훅 클로저의 ref 변형 금지(React 컴파일러 규칙)를 지킨다.
  const [pollTick, setPollTick] = useState(0);
  const scheduleNext = useCallback(() => {
    clearTimer();
    const s = stateRef.current;
    if (!s) return;
    const interval = pollIntervalMs(s);
    if (interval <= 0) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setPollTick((n) => n + 1);
    }, interval);
  }, [clearTimer]);

  const pollOnce = useCallback(async (): Promise<void> => {
    const s = stateRef.current;
    const leg = currentLeg();
    if (!s || !leg || inFlightRef.current) return;
    if (document.visibilityState === "hidden") return; // 전경 전용(§3.2)
    if (s.phase === "done" || s.signal === "untrackable") return;

    inFlightRef.current = true;
    const phaseGen = s.phaseGen;
    const seq = ++seqRef.current;
    try {
      let resolvedTago: { nodeId: string; cityCode: string } | null = null;
      if (leg.trackMode === "tagoBus") {
        resolvedTago = await resolveTagoIfNeeded();
        const cacheKey = `${s.legIndex}:${s.phase === "waiting" ? "board" : "alight"}`;
        if (!resolvedTago && tagoResolvedRef.current.get(cacheKey) === "unsupported") {
          dispatch({ kind: "poll", seq, phaseGen, poll: { kind: "unsupported" } });
          return;
        }
      }
      // done·untrackable은 함수 상단에서 걸렀으므로 여기의 phase는 세 국면뿐.
      const url = trackTargetUrl(leg, s.phase as "waiting" | "riding" | "arrived", resolvedTago);
      if (!url) {
        dispatch({ kind: "poll", seq, phaseGen, poll: { kind: "unsupported" } });
        return;
      }
      const res = await fetch(url);
      let poll: TrackPoll;
      let rawCount: number | null = null;
      if (!res.ok) {
        poll = { kind: "failed" };
      } else {
        const body = (await res.json()) as {
          status: string;
          items?: TrackItem[];
          rawCount?: number;
        };
        rawCount = typeof body.rawCount === "number" ? body.rawCount : null;
        poll =
          body.status === "ok"
            ? { kind: "ok", items: body.items ?? [] }
            : body.status === "empty"
              ? { kind: "empty" }
              : { kind: "unsupported" };
      }
      // 대기 목록(§5.1): waiting에서만 UI가 직접 소비(머신은 갱신 시각만 기록).
      // 소실 항목(3분 유지)의 경과·병합을 여기(폴 시점)서 계산해 렌더를 순수하게 둔다.
      if (stateRef.current?.phase === "waiting" && stateRef.current.phaseGen === phaseGen) {
        const items = poll.kind === "ok" ? poll.items : [];
        const now = Date.now();
        const retained = retainedRef.current;
        for (const item of items) {
          if (item.vehicleId) retained.set(item.vehicleId, { item, lastSeenAt: now });
        }
        for (const [key, value] of retained) {
          if (now - value.lastSeenAt > RETAIN_MS) retained.delete(key);
        }
        const liveKeys = new Set(items.map((i) => i.vehicleId ?? ""));
        const departed: WaitingSnapshot["departed"] = [];
        for (const [key, r] of retained) {
          if (!liveKeys.has(key)) {
            departed.push({
              item: r.item,
              minutes: Math.max(1, Math.round((now - r.lastSeenAt) / 60_000)),
            });
          }
        }
        setWaiting({ live: items, departed, reason: waitingEmptyReason(poll, rawCount) });
        // 새로고침 직접 응답(§13.2): 자동 폴 무낭독 규칙의 대상이 아니다 — 사용자
        // 요청의 응답이라 결과(후보 수 또는 0건 사유)를 통지한다.
        if (refreshAnnounceRef.current) {
          refreshAnnounceRef.current = false;
          const legNow = currentLeg();
          const reason = waitingEmptyReason(poll, rawCount);
          if (legNow && legNow.trackMode !== "tagoBus") {
            const { candidates } = classifyBoardingCandidates(
              [...items, ...departed.map((d) => d.item)],
              legNow,
            );
            announce(
              candidates.length > 0
                ? t("waitingCount", { count: candidates.length })
                : reasonText(reason ?? "none"),
            );
          }
        }
      }
      refreshAnnounceRef.current = false;
      dispatch({ kind: "poll", seq, phaseGen, poll });
    } catch {
      // 새로고침 응답은 실패도 침묵하지 않는다(§13.2 — 무응답이 곧 "고정" 체감).
      if (refreshAnnounceRef.current) {
        refreshAnnounceRef.current = false;
        announce(reasonText("unavailable"));
      }
      dispatch({ kind: "poll", seq, phaseGen, poll: { kind: "failed" } });
    } finally {
      inFlightRef.current = false;
      scheduleNext();
    }
  }, [announce, currentLeg, dispatch, reasonText, resolveTagoIfNeeded, scheduleNext, t]);

  const stopSession = useCallback(() => {
    clearTimer();
    stateRef.current = null;
    routeRef.current = null;
    retainedRef.current.clear();
    tagoResolvedRef.current.clear();
    setState(null);
    setWaiting(EMPTY_WAITING);
  }, [clearTimer]);
  // stopSession·pollOnce는 상태 의존이 없어 안정 정체성이다(참조 동일성이
  // 세션 스토어의 소유 판정 키 — 별도 ref 고정 불필요).

  // tick이 오르면 1폴(마운트 직후 tick 0은 세션 없음 가드로 무시된다).
  useEffect(() => {
    if (pollTick > 0) void pollOnce();
  }, [pollTick, pollOnce]);

  const start = useCallback(() => {
    if (!guideRoute) return;
    claimGuideSession(stopSession);
    routeRef.current = guideRoute;
    seqRef.current = 0;
    const init = initTransitGuide(guideRoute, Date.now());
    commit(init);
    const first = guideRoute.legs[0];
    const parts = [t("started", { count: guideRoute.legs.length }), waitContextText(first)];
    if (!first.trackMode) parts.push(t("untrackable"));
    announce(parts.join(" "));
    void pollOnce();
  }, [announce, commit, guideRoute, pollOnce, stopSession, t, waitContextText]);

  const stop = useCallback(() => {
    releaseGuideSession(stopSession);
    stopSession();
  }, [stopSession]);

  const board = useCallback(
    (lock: TransitLock) => {
      dispatch({ kind: "board", lock });
      // 국면이 바뀌었으니 즉시 하차 추적 1폴(다음 예약은 폴 완료가 잡는다).
      clearTimer();
      void pollOnce();
    },
    [clearTimer, dispatch, pollOnce],
  );

  const boardCandidate = useCallback(
    (candidate: BoardingCandidate) => {
      const leg = currentLeg();
      if (!leg?.trackMode) return;
      board({
        mode: leg.trackMode,
        routeId: leg.routeId ?? subwayIdForOdsayLine(leg.lineName) ?? "",
        direction: candidate.item.direction,
        vehicleId: candidate.item.vehicleId ?? "",
      });
    },
    [board, currentLeg],
  );

  const boardApprox = useCallback(() => {
    const leg = currentLeg();
    if (leg?.trackMode !== "tagoBus") return;
    board({ mode: "tagoBus", routeId: leg.lineName, direction: "", vehicleId: "" });
  }, [board, currentLeg]);

  const advance = useCallback(() => {
    dispatch({ kind: "advance" });
    const s = stateRef.current;
    if (s?.phase === "done") {
      // 완료 통지는 legAdvanced 이벤트가 이미 냈다 — 세션 자원만 회수하고
      // 패널은 트리거로 복귀한다(done 상태를 화면에 유지하지 않는다).
      releaseGuideSession(stopSession);
      clearTimer();
      stopSession();
    } else {
      retainedRef.current.clear();
      setWaiting(EMPTY_WAITING);
      clearTimer();
      void pollOnce();
    }
  }, [clearTimer, dispatch, pollOnce, stopSession]);

  const changeBoarding = useCallback(() => {
    dispatch({ kind: "changeBoarding" });
    // §13.1: 소실 항목 3분 버퍼(retained)는 비우지 않는다 — 잘못 잠근 채 이동한
    // 뒤 돌아온 목록에서 원래 열차가 사라지던 경로(§5.1 늦은 선택 수용의 구멍).
    // 스냅숏만 비우고 즉폴이 재구성한다(직전 국면의 낡은 목록 표시 방지).
    setWaiting(EMPTY_WAITING);
    clearTimer();
    void pollOnce();
  }, [clearTimer, dispatch, pollOnce]);

  /** 탑승 변경 취소(§13.1) — 직전 잠금으로 재탑승(머신이 previousLock을 소유). */
  const cancelChangeBoarding = useCallback(() => {
    const lock = stateRef.current?.previousLock;
    if (lock) board(lock);
  }, [board]);

  /** "이미 탑승했습니다"(§13.2) — 식별자 없는 근사 잠금(tagoBus 계약 동형). */
  const boardAlready = useCallback(() => {
    const leg = currentLeg();
    if (!leg?.trackMode || leg.trackMode === "tagoBus") return;
    board({
      mode: leg.trackMode,
      routeId: leg.routeId ?? subwayIdForOdsayLine(leg.lineName) ?? "",
      direction: leg.wayCode === 1 ? "상행" : leg.wayCode === 2 ? "하행" : "",
      vehicleId: "",
    });
  }, [board, currentLeg]);

  /** 새로고침(§13.2) — 즉폴 + 결과를 직접 응답으로 통지(자동 폴 무낭독의 예외). */
  const refreshWaiting = useCallback(() => {
    if (stateRef.current?.phase !== "waiting") return;
    refreshAnnounceRef.current = true;
    clearTimer();
    void pollOnce();
  }, [clearTimer, pollOnce]);

  // 탭 숨김·복귀(§3.2): 숨김은 폴링 정지(예약 취소), 복귀는 즉시 1폴 + 상태 통지.
  useEffect(() => {
    const onVisibility = () => {
      if (!stateRef.current) return;
      if (document.visibilityState === "hidden") {
        clearTimer();
        return;
      }
      const current = stateRef.current;
      announce(
        [t("resumed"), current ? signalText(current.signal) : ""].filter(Boolean).join(" "),
      );
      void pollOnce();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [announce, clearTimer, pollOnce, signalText, t]);

  // 언마운트: 자원 회수(통지 없음 — 언마운트 전이의 통지는 뷰 몫, §3.3).
  useEffect(() => {
    return () => {
      releaseGuideSession(stopSession);
      stopSession();
      if (reannounceTimerRef.current !== null) {
        window.clearTimeout(reannounceTimerRef.current);
        reannounceTimerRef.current = null;
      }
    };
  }, [stopSession]);

  /** 대기 목록(소실 유지 병합, §5.1). 후보 판정은 순수 함수. */
  const waitingOptions = useMemo((): { options: WaitingOption[]; directionUncertain: boolean } => {
    const s = state;
    const leg = s && guideRoute ? guideRoute.legs[s.legIndex] : null;
    if (!s || !leg || s.phase !== "waiting" || !leg.trackMode || leg.trackMode === "tagoBus") {
      return { options: [], directionUncertain: false };
    }
    // 스냅숏은 폴 시점에 계산됐다(렌더 순수성) — 여기서는 순수 판정·매핑만.
    const departedMinutesByKey = new Map(
      waiting.departed.map((d) => [d.item.vehicleId ?? d.item.message, d.minutes]),
    );
    const { candidates, directionUncertain } = classifyBoardingCandidates(
      [...waiting.live, ...waiting.departed.map((d) => d.item)],
      leg,
    );
    const options = candidates.map((candidate): WaitingOption => {
      const key = candidate.item.vehicleId ?? candidate.item.message;
      return {
        candidate,
        departedMinutes: departedMinutesByKey.get(key) ?? null,
        key,
      };
    });
    return { options, directionUncertain };
  }, [guideRoute, state, waiting]);

  /**
   * 진행 상황(§3.2 공통 컨트롤) — 임의 시점 전문 조회, live region으로 발화.
   * 상시 표시와 같은 조립기를 공유한다(§12.3 드리프트 차단).
   */
  const announceProgress = useCallback(() => {
    const s = stateRef.current;
    const r = routeRef.current;
    const leg = s && r ? r.legs[s.legIndex] : null;
    if (!s || !leg) return;
    announce(buildStatusText(s, leg));
  }, [announce, buildStatusText]);

  /** 상시 표시 문자열(§12.3) — 패널이 그대로 렌더한다(별도 조립 금지). */
  const statusText = useMemo(() => {
    const leg = state && guideRoute ? guideRoute.legs[state.legIndex] : null;
    return state && leg ? buildStatusText(state, leg) : "";
  }, [buildStatusText, guideRoute, state]);

  return {
    startable: guideRoute !== null,
    guideRoute,
    state,
    statusText,
    liveMessage,
    // 외부(패널 중지 통지 등)도 같은 가드를 태운다 — 직접 setState 노출 금지.
    setLiveMessage: announce,
    waitingOptions: waitingOptions.options,
    directionUncertain: waitingOptions.directionUncertain,
    /** 대기 목록 0건 사유(§13.3) — 항목이 있으면 null. */
    waitingReason: waiting.reason,
    start,
    stop,
    boardCandidate,
    boardApprox,
    boardAlready,
    advance,
    changeBoarding,
    cancelChangeBoarding,
    refreshWaiting,
    announceProgress,
  };
}
