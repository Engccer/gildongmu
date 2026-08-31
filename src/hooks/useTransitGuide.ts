"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
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
  transitPrewalkTarget,
  withoutPrewalk,
} from "@/lib/transit-guide";
import { claimGuideSession, releaseGuideSession } from "@/lib/guide-session-store";
import { dataLocale, prefersEnglish } from "@/lib/data-locale";
import { joinText } from "@/lib/format";
import {
  messageLabel,
  transitDisplayLeg,
  type TransitDisplayLeg,
  type TransitLabel,
} from "@/lib/transit-display";
import {
  approachFrameLine,
  arrivedAtBoardStopLine,
  boardedLine,
  boardingContextLine,
  contextLine,
  currentStationLine,
  frameLine,
  selectedVehicleLine,
  vehiclePassedLine,
  vehicleSelectedLine,
  waitContextLine,
  type TransitTextLine,
} from "@/lib/transit-guide-text";
import { namedArgs } from "@/lib/transit-text-args";
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

/**
 * 폴링 대상 URL. **`lang`은 기본값 없는 필수 인자다**(E27 잔여 ①) — 생략이 컴파일을 통과하면
 * 실시간 줄만 조용히 한국어로 떨어지고, 서버는 400도 내지 않는다(파라미터 부재 = ko가 정상 계약).
 * 파라미터 **이름 오타도 조용히 무시**되므로 테스트가 URL 문자열 전체를 단언한다.
 */
export function trackTargetUrl(
  leg: TransitGuideLeg,
  phase: "waiting" | "boarding" | "riding" | "arrived",
  resolvedTago: { nodeId: string; cityCode: string } | null,
  boardOverrideIndex: number | null,
  lang: "ko" | "en",
): string | null {
  const mode = leg.trackMode;
  if (!mode) return null;
  // boarding(N3)은 차량을 고른 뒤 그 차량의 승차 정류소 도착을 기다리는 국면이라
  // 조회 대상이 waiting과 같다(riding부터 하차 정류소).
  const atBoardStop = phase === "waiting" || phase === "boarding";
  if (mode === "seoulBus") {
    if (atBoardStop) {
      if (!leg.boardStop?.arsId || !leg.routeId) return null;
      return `/api/transit/track?mode=seoulBus&phase=wait&arsId=${encodeURIComponent(leg.boardStop.arsId)}&routeId=${encodeURIComponent(leg.routeId)}&lang=${lang}`;
    }
    if (!leg.boardStop?.localId || !leg.alightStop?.localId || !leg.routeId) return null;
    return `/api/transit/track?mode=seoulBus&phase=ride&routeId=${encodeURIComponent(leg.routeId)}&boardId=${encodeURIComponent(leg.boardStop.localId)}&alightId=${encodeURIComponent(leg.alightStop.localId)}&lang=${lang}`;
  }
  if (mode === "tagoBus") {
    if (!resolvedTago) return null;
    return `/api/transit/track?mode=tagoBus&phase=track&cityCode=${encodeURIComponent(resolvedTago.cityCode)}&nodeId=${encodeURIComponent(resolvedTago.nodeId)}&routeNo=${encodeURIComponent(leg.lineName)}&lang=${lang}`;
  }
  // waiting 국면의 기준 역은 사용자가 고른 현재 역이 이긴다(A16 L3).
  // riding(alightName)은 건드리지 않는다 — 그쪽은 L1 영역이다.
  const overrideStop =
    boardOverrideIndex != null ? (leg.viaStops[boardOverrideIndex] ?? null) : null;
  const station = atBoardStop ? (overrideStop?.name ?? leg.boardName) : leg.alightName;
  if (!station) return null;
  return `/api/transit/track?mode=subway&phase=track&station=${encodeURIComponent(station)}&line=${encodeURIComponent(leg.lineName)}&lang=${lang}`;
}

export function useTransitGuide(route: TransitRoute | null) {
  const t = useTranslations("transitGuide");
  const locale = useLocale();

  const guideRoute = useMemo(
    () => (route ? buildTransitGuideRoute(route) : null),
    [route],
  );

  const [state, setState] = useState<TransitGuideState | null>(null);
  const [waiting, setWaiting] = useState<WaitingSnapshot>(EMPTY_WAITING);
  const [liveMessage, setLiveMessage] = useState("");
  /**
   * live region의 `lang`(E27 잔여 ①). 한국어 폴백이 섞인 통지에만 `"ko"`가 붙는다 —
   * 영어 엔진이 한글을 만나면 그 이름이 통째로 침묵하기 때문이다(spec §3.8).
   * 영어 줄에는 태그를 붙이지 않는다(UI 문장 틀이 섞여 있어 순수 데이터 줄이 아니다).
   */
  const [liveLang, setLiveLang] = useState<"ko" | undefined>(undefined);
  /**
   * 완료(done) 후 도보 핸드오프 제안(A안, §14.2) — 세션 자원은 회수하되 말미
   * 도보가 있으면 패널이 "남은 도보 안내 시작"을 노출한다. 다음 시작에서 소거.
   */
  const [doneHandoff, setDoneHandoff] = useState<{ walkMinutes: number } | null>(null);
  /**
   * 세션이 실제로 도는 경로(A25). 승차 전 도보를 걸어서 온 세션은 첫 leg의 도보 문맥을 지운
   * 경로로 돌므로 props 파생 `guideRoute`와 다를 수 있다 — 상시 표시·패널 leg는 이쪽을 읽는다.
   */
  const [sessionRoute, setSessionRoute] = useState<TransitGuideRoute | null>(null);
  /** 승차 전 도보 대상(A25 spec 2026-08-30 §3) — null이면 종전 시작 경로. */
  const prewalkTarget = useMemo(
    () => (guideRoute ? transitPrewalkTarget(guideRoute) : null),
    [guideRoute],
  );
  /** 역 재선택 단계 표시 여부(A16 L3, 지하철 전용). */
  const [reboardPickerActive, setReboardPickerActive] = useState(false);
  /**
   * 선택 차량 설명(boarding 상시 표시·통지, N3). 탑승 변경으로 waiting에 돌아가도
   * 남긴다 — "탑승 변경 취소"(restoreBoarding)가 같은 차량으로 복귀한다. 소거는
   * 새 선택·전진·세션 종료. ref인 이유는 통지가 dispatch 직후 동기로 읽기 때문.
   */
  /**
   * ⚠ **문자열이 아니라 ko·en 쌍이다**(E27 잔여 ①). 선택 시점의 렌더 문자열을 얼려 두면 세션
   * 도중 언어를 바꿨을 때 그 조각만 옛 언어로 남는다 — 값을 쌍으로 들고 렌더가 고른다.
   */
  const selectedDescriptionRef = useRef<TransitLabel | null>(null);
  const [selectedDescription, setSelectedDescriptionState] = useState<TransitLabel | null>(null);
  const setSelectedDescription = useCallback((desc: TransitLabel | null) => {
    selectedDescriptionRef.current = desc;
    setSelectedDescriptionState(desc);
  }, []);
  /**
   * 사용자가 고른 기준 역(A16 L3). nil이면 leg 원래 승차역.
   *
   * ⚠ 이 값이 상태 머신이 아니라 훅에 사는 이유: 머신은 **어느 역을 조회할지
   * 모른다**(폴 결과만 받는다). 조회 대상은 trackTargetUrl이 정하므로 L3는
   * 공유 계약도 fixture도 건드리지 않는다. state가 아니라 ref인 이유는 폴 루프가
   * 렌더 사이클 밖에서 읽기 때문이다.
   */
  const boardOverrideRef = useRef<number | null>(null);
  /**
   * 위 ref의 렌더용 사본(`stateRef`+`state` 관례 동형). 폴 루프는 ref를, 화면·발화
   * 문구는 이 값을 읽는다 — 둘을 함께 갱신하는 곳은 `setBoardOverride` 하나다.
   */
  const [boardOverride, setBoardOverrideState] = useState<number | null>(null);
  /**
   * ⚠ **이름이 아니라 인덱스다**(E27 잔여 ①, spec 2026-09-01 §3.6). 이름으로 들면 표시 영문을
   * `viaStops`에서 역조회해야 하는데, 정규화 후 동명 역이 둘이면 첫 일치를 골라 **다른 역의
   * 영문명이 표시된다**(오류 없이). 인덱스는 그 모호함이 구조적으로 없다.
   */
  const setBoardOverride = useCallback((index: number | null) => {
    boardOverrideRef.current = index;
    setBoardOverrideState(index);
  }, []);

  const liveRef = useRef("");
  const reannounceTimerRef = useRef<number | null>(null);
  // 같은 문장이면 DOM 텍스트가 안 바뀌어 aria-live가 침묵한다(진행 상황 버튼
  // 연타 재현) — 빈 값을 한 번 거쳐 재발화한다(useRouteGuide announce 동형).
  const announce = useCallback((text: string, lang?: "ko") => {
    setLiveLang(lang);
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

  /** 세션의 데이터 언어(E27 잔여 ①) — 화면·통지가 같은 축을 쓴다. */
  const isEn = prefersEnglish(locale);

  /**
   * descriptor → 화면 문자열. 조각을 각자 조회해 쉼표로 잇는다(빈 조각은 제거).
   * `lang`은 표시 채널만 쓴다 — 발화는 문자열뿐이라 여기서 텍스트만 돌려주고,
   * `lang`이 필요한 자리는 `renderLine`을 쓴다.
   */
  const renderText = useCallback(
    (d: TransitTextLine): string =>
      joinText(
        ...d.parts.map((p) => ("key" in p ? t(p.key, namedArgs(p.key, p.args)) : p.text)),
      ),
    [t],
  );

  /**
   * 한 조각의 렌더 결과와 **한국어 폴백 여부**.
   *
   * 유일하게 필요한 태그는 `lang="ko"`다(E27 §3.6 — UI 문장 틀이 섞인 영어 줄은 태그하지 않는다).
   * 그래서 조각마다 "이 줄이 ko로 떨어졌나"만 들고 다니고, 줄 하나라도 ko면 통지·표시 전체를
   * ko로 태그한다 — 영어 엔진이 한글을 만나면 **그 이름이 통째로 침묵**하기 때문이다(spec §3.8).
   */
  const piece = useCallback(
    (d: TransitTextLine): { text: string; ko: boolean } => ({
      text: renderText(d),
      ko: isEn && d.parts.length > 0 && d.lang === "ko",
    }),
    [isEn, renderText],
  );

  /**
   * leg → 표시 투영. 조인 필드가 타입에 없어 이 아래에서는 노선명·역명을 조회 쿼리로 쓸 수 없다
   * (spec §3.5 — 1선은 구조).
   */
  /**
   * ⚠ **재선택 인덱스는 인자로 받는다**(ref를 여기서 읽지 않는다). 이 훅은 같은 값을 ref와 state
   * 두 벌로 드는데 — 폴 루프는 렌더 사이클 밖이라 ref를, 화면 문구는 state를 읽어야 한다 —
   * 여기서 ref를 읽으면 렌더 중 ref 접근이 되어 화면이 갱신되지 않을 수 있다(React 규칙).
   */
  const displayLegOf = useCallback(
    (leg: TransitGuideLeg, overrideIndex: number | null): TransitDisplayLeg =>
      transitDisplayLeg(leg, overrideIndex),
    [],
  );

  /**
   * 대기 문맥(§4.1): 선행 도보 + 승차 지점 + 노선.
   *
   * ⚠ **재선택한 기준 역이 있으면 그 역이 승차 지점이다**(A16 L3). 이 문장은 상시 표시이자 진행
   * 상황 발화라, 조회 대상과 어긋나면 화면은 "천호역 대기"라고 말하는데 그 아래 목록은 왕십리
   * 도착 정보인 상태가 된다. 목록 항목에 역명이 없으므로 SR 사용자에게는 이 문장이 그 화면의
   * 유일한 역 정보원이다.
   *
   * @param isCurrentLeg 이 문맥이 **지금 안내 중인 구간**을 설명하는가(기본값 없음 — 다음 구간
   * 안내가 이전 구간에서 고른 역을 말하면 안 되는데 생략이 통과하면 조용히 들어온다).
   */
  const waitContextPiece = useCallback(
    (leg: TransitGuideLeg, isCurrentLeg: boolean) =>
      piece(
        waitContextLine(isEn, displayLegOf(leg, isCurrentLeg ? boardOverride : null), isCurrentLeg),
      ),
    [boardOverride, displayLegOf, isEn, piece],
  );

  /** 노선·하차 전문 문맥(§6.1 M1 개정) — 추적 시작·진행 상황·상시 표시가 담당. */
  const contextPiece = useCallback(
    (leg: TransitGuideLeg) => piece(contextLine(isEn, displayLegOf(leg, null))),
    [displayLegOf, isEn, piece],
  );

  /**
   * 승차 국면 상태 문장(§12.3). 버스는 완성 문장의 라벨 프레임("{stop}까지 {message}", 원문 무변형).
   * 지하철은 `arvlMsg2`가 조회역(=하차역) 기준 열차 위치 서술이라 그 틀에 넣으면 뜻이 뒤집힌다
   * ("충정로까지 전역 도착", A27) — 코드로 탑승자 시점 문장을 고르고 99는 생략(잔여 수가 말한다).
   */
  const framePiece = useCallback(
    (leg: TransitGuideLeg, message: TransitLabel, arrivalCode: string | null) =>
      piece(frameLine(isEn, displayLegOf(leg, null), message, arrivalCode)),
    [displayLegOf, isEn, piece],
  );

  /** boarding 문맥(N3) — 승차 정류소에서 선택 차량을 기다리는 중. 재선택 역이 이긴다. */
  const boardingContextPiece = useCallback(
    (leg: TransitGuideLeg) => piece(boardingContextLine(isEn, displayLegOf(leg, boardOverride))),
    [boardOverride, displayLegOf, isEn, piece],
  );

  /** boarding 완성 문장 프레임 — 승차 정류소 라벨 전치("{stop}에 {message}"). */
  const approachFramePiece = useCallback(
    (leg: TransitGuideLeg, message: TransitLabel) =>
      piece(approachFrameLine(isEn, displayLegOf(leg, boardOverride), message)),
    [boardOverride, displayLegOf, isEn, piece],
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

  /**
   * 신호 → 상시 표시 문구. ⚠ notYetVisible은 국면으로 갈린다 — "차량 접근 대기"는
   * 대기 국면 어휘라 승차 중에 뜨면 "아직 못 탔다"로 뒤집혀 읽힌다(A16).
   */
  const signalText = useCallback(
    (signal: TransitGuideState["signal"], phase: TransitGuideState["phase"]): string =>
      ({
        tracking: phase === "boarding" ? t("stateApproaching") : t("stateTracking"),
        notYetVisible:
          phase === "riding"
            ? t("stateRidingNotYetVisible")
            : phase === "boarding"
              ? t("stateBoardingNotYetVisible")
              : t("stateNotYetVisible"),
        neverSeen: t("stateNeverSeen"),
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
  const buildStatus = useCallback(
    (s: TransitGuideState, leg: TransitGuideLeg): { text: string; lang?: "ko" } => {
      const boarding = s.phase === "boarding";
      const ui = (text: string) => ({ text, ko: false });
      const lastMessage = s.lastMessage
        ? messageLabel(s.lastMessage, s.lastMessageEn ?? undefined)
        : null;
      const pieces: { text: string; ko: boolean }[] = [
        s.phase === "waiting"
          ? waitContextPiece(leg, true)
          : boarding
            ? boardingContextPiece(leg)
            : contextPiece(leg),
        boarding && selectedDescription
          ? piece(selectedVehicleLine(isEn, selectedDescription))
          : ui(""),
        ui(signalText(s.signal, s.phase)),
        // boarding은 승차 정류소 기준 정보라 "하차역까지 남은 정거장"을 말하면 거짓이
        // 된다 — 원문 프레임만(잔여 수는 원문 꼬리가 담는다).
        ui(
          !boarding && s.remaining != null
            ? t("remainingCount", { count: s.remaining })
            : !boarding && leg.stationCount != null && s.phase === "riding"
              ? t("stationCountAbout", { count: leg.stationCount })
              : "",
        ),
        lastMessage
          ? boarding
            ? approachFramePiece(leg, lastMessage)
            : framePiece(leg, lastMessage, s.lastArrivalCode)
          : ui(""),
        // 근사 주석의 판별자는 leg 유형이 아니라 잠금의 근사 여부(§13.2 — tagoBus는
        // 대기 중에도 근사 예고로 유지).
        ui(
          leg.trackMode === "tagoBus" || (s.lock != null && isApproxTransitLock(s.lock))
            ? t("approxNote")
            : "",
        ),
        // 신선도 문장은 정확히 1개(§12.3, 감사 H2·M1): 추적 중이면 데이터 나이,
        // 그 외(미등장·소실·실패)엔 마지막 폴 시각만 — 낡은 나이를 신선한 값처럼
        // 이월하지 않는다(3-state, useRouteGuide "낡은 fix 거짓 정밀 차단" 동형).
        ui(
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
        ),
      ];
      return {
        text: pieces
          .map((p) => p.text)
          .filter(Boolean)
          .join(" "),
        ...(pieces.some((p) => p.ko && p.text) ? { lang: "ko" as const } : {}),
      };
    },
    [
      approachFramePiece,
      boardingContextPiece,
      contextPiece,
      framePiece,
      isEn,
      piece,
      selectedDescription,
      signalText,
      t,
      waitContextPiece,
    ],
  );

  /** approaching 첫 관측 판별(전이 전 trackingAnnounced) — dispatch가 기록, announceEvent가 읽는다. */
  const firstObservationRef = useRef(false);

  /** 이벤트 → 통지 문구(완성 문장은 원문 병치). */
  const announceEvent = useCallback(
    (event: TransitGuideEvent): void => {
      const leg = currentLeg();
      const r = routeRef.current;
      // 조각마다 한국어 폴백 여부를 함께 들고 다닌다(마지막에 통지 전체의 lang을 정한다).
      const pieces: { text: string; ko: boolean }[] = [];
      const parts = {
        push: (text: string) => {
          if (text) pieces.push({ text, ko: false });
        },
      };
      const pushPiece = (p: { text: string; ko: boolean }) => {
        if (p.text) pieces.push(p);
      };
      switch (event.kind) {
        case "vehicleSelected":
          if (leg) {
            pushPiece(
              piece(
                vehicleSelectedLine(
                  isEn,
                  displayLegOf(leg, boardOverrideRef.current),
                  selectedDescriptionRef.current,
                ),
              ),
            );
          }
          break;
        case "approaching":
          // 첫 관측만 "추적합니다"를 앞세운다. 이벤트는 첫 관측과 사다리를 구분하지
          // 않으므로 전이 전 상태(dispatch가 남긴 플래그)를 본다.
          if (firstObservationRef.current) parts.push(t("approachingStarted"));
          if (event.message && leg) {
            pushPiece(approachFramePiece(leg, messageLabel(event.message, event.messageEn)));
          }
          break;
        case "vehiclePassed":
          if (leg) pushPiece(piece(vehiclePassedLine(isEn, displayLegOf(leg, boardOverrideRef.current))));
          break;
        case "boarded": {
          if (!leg) break;
          const d = displayLegOf(leg, null);
          if (event.cause === "observed") pushPiece(piece(arrivedAtBoardStopLine(isEn, d)));
          pushPiece(piece(boardedLine(isEn, d)));
          break;
        }
        case "trackingStarted":
          if (leg) pushPiece(contextPiece(leg));
          parts.push(t("trackingStarted"));
          {
            const framed = event.message && leg
              ? framePiece(leg, messageLabel(event.message, event.messageEn), event.arrivalCode)
              : { text: event.message, ko: false };
            if (framed.text) pushPiece(framed);
            else if (event.remaining != null) parts.push(t("remainingCount", { count: event.remaining }));
          }
          break;
        case "countdown":
          // §12.3: 매 사다리마다 문맥 문장을 반복하지 않는다 — 프레임이 하차역을 밝힌다.
          {
            // 지하철 99(운행중)는 프레임이 비어 잔여 수 문장으로 떨어진다(A27).
            const framed = event.message && leg
              ? framePiece(leg, messageLabel(event.message, event.messageEn), event.arrivalCode)
              : { text: event.message, ko: false };
            if (framed.text) pushPiece(framed);
            else parts.push(t("remainingCount", { count: event.remaining }));
          }
          // 한 정거장 전 현재 역 병치(§12.2, 피드백 #10) — 잔여 ≥ 2 문장은 원문이
          // 현재 역을 이미 담아 병치하지 않는다(중복 금지).
          if (event.remaining <= 1 && event.currentLocation) {
            pushPiece(
              piece(
                currentStationLine(
                  isEn,
                  messageLabel(event.currentLocation, event.currentLocationEn),
                ),
              ),
            );
          }
          break;
        case "messageChanged":
          {
            const label = messageLabel(event.message, event.messageEn);
            const framed = leg
              ? stateRef.current?.phase === "boarding"
                ? approachFramePiece(leg, label)
                : framePiece(leg, label, event.arrivalCode)
              : { text: event.message, ko: false };
            if (framed.text) pushPiece(framed);
          }
          break;
        case "arrived": {
          parts.push(event.certain ? t("arrived") : t("arrivedGuess"));
          const s = stateRef.current;
          const next = s && r ? r.legs[s.legIndex + 1] : null;
          if (next) {
            const inner = waitContextPiece(next, false);
            pushPiece({ text: t("nextLeg", { context: inner.text }), ko: inner.ko });
          }
          else if (r?.walkAfterMinutes != null) {
            parts.push(t("nextLeg", { context: t("doneWalk", { minutes: r.walkAfterMinutes }) }));
          }
          break;
        }
        case "backOnTrack":
          parts.push(t("backOnTrack"));
          {
            const framed = event.message && leg
              ? framePiece(leg, messageLabel(event.message, event.messageEn), event.arrivalCode)
              : { text: event.message, ko: false };
            if (framed.text) pushPiece(framed);
          }
          break;
        case "approxVehicleChanged":
          parts.push(t("approxVehicleChanged"));
          break;
        case "signalLost":
          // boarding의 소실은 "아직 안 탔는데 차량이 안 보인다"라 riding 문구와 다르다.
          parts.push(t(stateRef.current?.phase === "boarding" ? "boardingSignalLost" : "signalLost"));
          break;
        case "neverSeen":
          parts.push(t("neverSeen"));
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
              pushPiece(waitContextPiece(nextLeg, false));
              if (!nextLeg.trackMode) parts.push(t("untrackable"));
            }
          }
          break;
        }
        case "boardingReset":
          parts.push(t("changeBoardingDone"));
          break;
      }
      if (pieces.length > 0) {
        announce(
          pieces.map((p) => p.text).join(" "),
          pieces.some((p) => p.ko) ? "ko" : undefined,
        );
      }
    },
    [
      announce,
      approachFramePiece,
      contextPiece,
      currentLeg,
      displayLegOf,
      framePiece,
      isEn,
      piece,
      t,
      waitContextPiece,
    ],
  );

  const dispatch = useCallback(
    (input: Parameters<typeof transitGuideStep>[1]): void => {
      const s = stateRef.current;
      const r = routeRef.current;
      if (!s || !r) return;
      const { state: next, event } = transitGuideStep(s, input, r, Date.now());
      // 사용자가 고른 기준 역(A16 L3)의 수명은 딱 한 번의 재선택이다. 재잠금·전진
      // 뒤에도 남으면 다음 대기 국면이 엉뚱한 역을 조회한다. ⚠ 소거를 호출부마다
      // 흩뿌리지 않는 이유가 그것이다(iOS dispatch 동형).
      // N3: boarding이 재선택 역을 계속 조회해야 하므로 `board`가 아니라 **riding
      // 진입**(선언·관측 어느 길이든)에서 지운다. 국면 기반이라 폴이 일으키는 승격도 잡는다.
      if (input.kind === "advance") {
        setBoardOverride(null);
        setSelectedDescription(null);
      }
      if (next.phase === "riding" && s.phase !== "riding") setBoardOverride(null);
      firstObservationRef.current = !s.trackingAnnounced && next.trackingAnnounced;
      // 픽커는 riding 국면 전용 UI다. 국면이 바뀌면 화면에서는 사라지지만 플래그가
      // 남아, 다음 riding 진입에서 묻지도 않은 역 선택 화면이 되살아난다(독립 리뷰
      // MAJOR). ⚠ 국면 기반인 이유: board·advance만 열거하면 폴이 일으키는 arrived
      // 전이를 놓친다. boardOverride는 waiting에서 쓰이므로 같은 축으로 못 묶는다.
      if (next.phase !== "riding") setReboardPickerActive(false);
      commit(next);
      if (event) announceEvent(event);
    },
    [announceEvent, commit, setBoardOverride, setSelectedDescription],
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
    const atBoardStop = s.phase === "waiting" || s.phase === "boarding";
    const cacheKey = `${s.legIndex}:${atBoardStop ? "board" : "alight"}`;
    const cached = tagoResolvedRef.current.get(cacheKey);
    if (cached === "unsupported") return null;
    if (cached) return cached;
    const target = atBoardStop ? leg.boardStop : leg.alightStop;
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
    // 조기 unsupported에서도 새로고침 응답을 침묵시키지 않는다(§13.2 — 무응답이
    // 곧 "고정" 체감, 접근성 감사 HIGH). 플래그는 항상 소비(누수 시 자동 폴 발화).
    // ⚠ 응답 게시는 성공 경로와 같은 국면 가드를 통과할 때만 — in-flight 중 탑승·
    // 전환으로 국면이 바뀐 뒤의 실패 문구는 새 국면 채널 오염이다(독립 리뷰 WARNING.
    // dispatch는 머신의 phaseGen·seq 방어가 있지만 announce는 그 밖이다).
    const stillSameWaiting = () =>
      stateRef.current?.phase === "waiting" && stateRef.current.phaseGen === phaseGen;
    const finishEarlyUnsupported = () => {
      const wasRefresh = refreshAnnounceRef.current;
      refreshAnnounceRef.current = false;
      dispatch({ kind: "poll", seq, phaseGen, poll: { kind: "unsupported" } });
      if (wasRefresh && stillSameWaiting()) announce(reasonText("unavailable"));
    };
    try {
      let refreshResponse: string | null = null;
      let resolvedTago: { nodeId: string; cityCode: string } | null = null;
      if (leg.trackMode === "tagoBus") {
        resolvedTago = await resolveTagoIfNeeded();
        const cacheKey = `${s.legIndex}:${s.phase === "waiting" || s.phase === "boarding" ? "board" : "alight"}`;
        if (!resolvedTago && tagoResolvedRef.current.get(cacheKey) === "unsupported") {
          finishEarlyUnsupported();
          return;
        }
      }
      // done·untrackable은 함수 상단에서 걸렀으므로 여기의 phase는 세 국면뿐.
      const url = trackTargetUrl(
        leg,
        s.phase as "waiting" | "boarding" | "riding" | "arrived",
        resolvedTago,
        boardOverrideRef.current,
        dataLocale(locale),
      );
      if (!url) {
        finishEarlyUnsupported();
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
        // 요청의 응답이라 후보 수(0 포함)로 답한다. 조회 실패·미지원만 사유 문장
        // (실패를 "0개"로 말하지 않는다 — 3-state). 0건의 왜는 목록 자리 지속
        // 문장이 담당한다(같은 문장을 통지·화면 두 곳에 남기지 않는다, 감사 M4).
        if (refreshAnnounceRef.current) {
          refreshAnnounceRef.current = false;
          const legNow = currentLeg();
          const reason = waitingEmptyReason(poll, rawCount);
          if (legNow && legNow.trackMode !== "tagoBus") {
            const { candidates } = classifyBoardingCandidates(
              [...items, ...departed.map((d) => d.item)],
              legNow,
            );
            refreshResponse =
              reason === "unavailable"
                ? reasonText("unavailable")
                : t("waitingCount", { count: candidates.length });
          }
        }
      }
      refreshAnnounceRef.current = false;
      dispatch({ kind: "poll", seq, phaseGen, poll });
      // 응답은 dispatch 뒤에 게시한다 — 같은 폴의 신호 이벤트 통지(signalRecovered
      // 등)와 배칭될 때 마지막 승자가 새로고침 응답이 되게(감사 M1: 역순이면
      // 응답이 페인트 없이 사라진다).
      if (refreshResponse) announce(refreshResponse);
    } catch {
      // 새로고침 응답은 실패도 침묵하지 않는다(§13.2 — 무응답이 곧 "고정" 체감).
      // 단 같은 대기 국면일 때만 게시(위 stillSameWaiting 주석 — 리뷰 WARNING).
      const wasRefresh = refreshAnnounceRef.current;
      refreshAnnounceRef.current = false;
      dispatch({ kind: "poll", seq, phaseGen, poll: { kind: "failed" } });
      if (wasRefresh && stillSameWaiting()) announce(reasonText("unavailable"));
    } finally {
      inFlightRef.current = false;
      scheduleNext();
    }
  }, [announce, currentLeg, dispatch, reasonText, resolveTagoIfNeeded, scheduleNext, t, locale]);

  const stopSession = useCallback(() => {
    clearTimer();
    stateRef.current = null;
    routeRef.current = null;
    setSessionRoute(null);
    retainedRef.current.clear();
    tagoResolvedRef.current.clear();
    refreshAnnounceRef.current = false;
    setBoardOverride(null);
    setSelectedDescription(null);
    setReboardPickerActive(false);
    setState(null);
    setWaiting(EMPTY_WAITING);
    // ⚠ setBoardOverride·setSelectedDescription은 useCallback([])이라 안정 정체성이다 —
    // 아래 주석의 "참조 동일성이 세션 스토어의 소유 판정 키"라는 전제를 깨지 않는다.
  }, [clearTimer, setBoardOverride, setSelectedDescription]);
  // stopSession·pollOnce는 상태 의존이 없어 안정 정체성이다(참조 동일성이
  // 세션 스토어의 소유 판정 키 — 별도 ref 고정 불필요).

  // tick이 오르면 1폴(마운트 직후 tick 0은 세션 없음 가드로 무시된다).
  useEffect(() => {
    if (pollTick > 0) void pollOnce();
  }, [pollTick, pollOnce]);

  /** 게이트 뒤 세션 초기화 공통부(`start`·`startAfterPrewalk`). `prefix`는 시작 문장 앞 한 문장. */
  const beginSession = useCallback(
    (route: TransitGuideRoute, prefix: string | null) => {
      setDoneHandoff(null);
      claimGuideSession(stopSession);
      routeRef.current = route;
      setSessionRoute(route);
      seqRef.current = 0;
      const init = initTransitGuide(route, Date.now());
      commit(init);
      const first = route.legs[0];
      const context = waitContextPiece(first, true);
      const parts = [t("started", { count: route.legs.length }), context.text];
      if (!first.trackMode) parts.push(t("untrackable"));
      if (prefix) parts.unshift(prefix);
      announce(parts.filter(Boolean).join(" "), context.ko ? "ko" : undefined);
      void pollOnce();
    },
    [announce, commit, pollOnce, stopSession, t, waitContextPiece],
  );

  const start = useCallback(() => {
    if (!guideRoute) return;
    beginSession(guideRoute, null);
  }, [beginSession, guideRoute]);

  /**
   * 승차 전 도보 뒤의 시작(A25 §6). `prewalkCompleted`가 true면 첫 leg의 도보 문맥을 지운 경로로
   * 시작하고 도착 문장을 시작 문장 앞에 붙인다(DistanceBeacon이 언마운트되며 자기 live region을
   * 잃으므로 도착 문장은 이 채널이 낸다). ⚠ 기본값 없음(안전 인자).
   */
  const startAfterPrewalk = useCallback(
    (prewalkCompleted: boolean) => {
      if (!guideRoute || !prewalkTarget) return;
      beginSession(
        prewalkCompleted ? withoutPrewalk(guideRoute) : guideRoute,
        prewalkCompleted ? t("prewalkArrived", { station: prewalkTarget.name }) : null,
      );
    },
    [beginSession, guideRoute, prewalkTarget, t],
  );

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

  /**
   * "탑승" = 차량 선택(N3). 설명은 선택 차량의 안정 조각(행선·방향)만 — 폴마다 바뀌는
   * 완성 문장은 제외. dispatch **전에** 기록해 vehicleSelected 통지가 빈 설명을 읽지 않는다.
   */
  const boardCandidate = useCallback(
    (candidate: BoardingCandidate, description: TransitLabel) => {
      const leg = currentLeg();
      if (!leg?.trackMode) return;
      setSelectedDescription(description);
      board({
        mode: leg.trackMode,
        routeId: leg.routeId ?? subwayIdForOdsayLine(leg.lineName) ?? "",
        direction: candidate.item.direction,
        vehicleId: candidate.item.vehicleId ?? "",
      });
    },
    [board, currentLeg, setSelectedDescription],
  );

  /** "탑승했습니다"(boarding → riding 사용자 선언, N3). */
  const confirmBoarded = useCallback(() => {
    if (stateRef.current?.phase !== "boarding") return;
    dispatch({ kind: "confirmBoarded" });
    clearTimer();
    void pollOnce();
  }, [clearTimer, dispatch, pollOnce]);

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
      // 말미 도보가 있으면 핸드오프 제안을 남긴다(§14.2 — stopSession 전에 건짐).
      const walkMinutes = routeRef.current?.walkAfterMinutes ?? null;
      releaseGuideSession(stopSession);
      clearTimer();
      stopSession();
      if (walkMinutes != null) setDoneHandoff({ walkMinutes });
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

  /**
   * 탑승 변경 진입(A16 L3). 지하철은 지금 있는 역을 먼저 묻는다.
   *
   * ⚠ 지하철 전용인 근거 둘: 조회 파라미터가 수단마다 다르고(지하철만 역 *이름*,
   * 서울버스는 정류소 ID), 버스는 갈아타면 대개 다른 leg다. iOS `beginReboard` 미러.
   */
  const beginReboard = useCallback(() => {
    const leg = currentLeg();
    if (leg?.trackMode === "subway" && leg.viaStops.length > 0) {
      setReboardPickerActive(true);
      return;
    }
    changeBoarding();
  }, [changeBoarding, currentLeg]);

  const cancelReboard = useCallback(() => setReboardPickerActive(false), []);

  /**
   * 사용자가 고른 현재 역으로 재선택한다(A16 L3). 인자는 **세션 경로 `viaStops`의 인덱스**다 —
   * 이름을 받는 판을 남기면 그것이 다시 동명 역 모호 경로가 된다(spec §3.6).
   */
  const changeBoardingAt = useCallback(
    (stopIndex: number) => {
      setBoardOverride(stopIndex);
      setReboardPickerActive(false);
      changeBoarding();
    },
    [changeBoarding, setBoardOverride],
  );

  /**
   * 탑승 변경 취소(§13.1) — 직전 잠금·국면으로 복귀(머신이 previousLock·previousPhase
   * 소유). ⚠ `board(previousLock)`으로 돌리면 식별자 잠금은 boarding으로 가서 이미
   * 탄 사용자가 승차 정류소 폴링으로 되돌아간다(설계 리뷰 M5) — 전용 입력이 정본.
   */
  const cancelChangeBoarding = useCallback(() => {
    if (!stateRef.current?.previousLock) return;
    dispatch({ kind: "restoreBoarding" });
    clearTimer();
    void pollOnce();
  }, [clearTimer, dispatch, pollOnce]);

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
        [t("resumed"), current ? signalText(current.signal, current.phase) : ""].filter(Boolean).join(" "),
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
    // 소실 항목은 vehId 보유만 유지되므로(retained 조건) 경과 매핑 키는 vehId다.
    const departedMinutesByKey = new Map<string, number>(
      waiting.departed.flatMap((d) =>
        d.item.vehicleId ? [[d.item.vehicleId, d.minutes] as [string, number]] : [],
      ),
    );
    const { candidates, directionUncertain } = classifyBoardingCandidates(
      [...waiting.live, ...waiting.departed.map((d) => d.item)],
      leg,
    );
    const options = candidates.map((candidate, index): WaitingOption => {
      const vid = candidate.item.vehicleId;
      return {
        candidate,
        departedMinutes: vid ? (departedMinutesByKey.get(vid) ?? null) : null,
        // vehId 없는 항목의 키를 완성 문장으로 두면 문장 갱신마다 remount되어
        // 포커스가 폴마다 튕긴다(감사 L2) — 슬롯 위치 폴백(§5.1 상대 순서 유지).
        key: vid || `slot-${index}`,
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
    const status = buildStatus(s, leg);
    announce(status.text, status.lang);
  }, [announce, buildStatus]);

  /** 상시 표시 문자열(§12.3) — 패널이 그대로 렌더한다(별도 조립 금지). */
  const activeRoute = sessionRoute ?? guideRoute;
  const status = useMemo(() => {
    const leg = state && activeRoute ? activeRoute.legs[state.legIndex] : null;
    return state && leg ? buildStatus(state, leg) : { text: "" };
  }, [activeRoute, buildStatus, state]);

  return {
    startable: guideRoute !== null,
    /** 세션 중엔 실제로 도는 경로(승차 전 도보를 지운 것일 수 있다), 아니면 props 파생. */
    guideRoute: activeRoute,
    prewalkTarget,
    state,
    statusText: status.text,
    /** 상시 표시 줄의 `lang`(한국어 폴백일 때만 "ko"). */
    statusLang: status.lang,
    liveMessage,
    /** live region의 `lang`(한국어 폴백이 섞인 통지일 때만 "ko"). */
    liveLang,
    // 외부(패널 중지 통지 등)도 같은 가드를 태운다 — 직접 setState 노출 금지.
    setLiveMessage: announce,
    waitingOptions: waitingOptions.options,
    directionUncertain: waitingOptions.directionUncertain,
    /** 대기 목록 0건 사유(§13.3) — 항목이 있으면 null. */
    waitingReason: waiting.reason,
    /** 완료 후 도보 핸드오프 제안(§14.2) — 말미 도보가 없으면 null. */
    doneHandoff,
    start,
    startAfterPrewalk,
    stop,
    boardCandidate,
    confirmBoarded,
    boardApprox,
    boardAlready,
    /** boarding 국면의 선택 차량 설명(상시 표시용). */
    selectedDescription,
    advance,
    changeBoarding,
    beginReboard,
    cancelReboard,
    changeBoardingAt,
    reboardPickerActive,
    cancelChangeBoarding,
    refreshWaiting,
    announceProgress,
  };
}
