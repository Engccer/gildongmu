"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  beaconStep,
  INITIAL_BEACON_STATE,
  type AnnounceKind,
  type BeaconAnnounce,
  type BeaconState,
} from "@/lib/beacon";
import {
  buildGuideRoute,
  entryProjection,
  guideStateAt,
  guideStep,
  initialGuideState,
  unitAt,
  RESOLVE_TIMEOUT_S,
  type GuideEvent,
  type GuideFix,
  type GuideRoute,
  type GuideState,
} from "@/lib/route-guide";
import { prefersEnglish } from "@/lib/data-locale";
import { formatDistance } from "@/lib/format";
import { haversineMeters } from "@/lib/geo";
import { awaitGeolocation } from "@/lib/geolocation";
import { isOutOfCoverageBody } from "@/lib/out-of-coverage";
import type { WalkRouteBriefing } from "@/lib/types";
import { useBeaconSound } from "./useBeaconSound";
import { useScreenWakeLock } from "./useScreenWakeLock";

/** 추적 상태(구 useDistanceBeacon 계약 승계 — 그 훅은 이 훅으로 대체돼 제거됐다). */
export type BeaconStatus = "idle" | "tracking" | "denied" | "unsupported";

/**
 * 실시간 길 안내 오케스트레이터(스펙 2026-08-03 §9의 웹 판, iOS `BeaconModel` 대응).
 *
 * 판정은 전부 순수 리듀서가 한다 — 간략 안내는 `beaconStep`(직선거리·추세), 상세
 * 안내는 `guideStep`(경로 투영). 이 훅은 I/O·수명만 소유한다: watchPosition 생명주기,
 * 경로 fetch, 이벤트→문장 조립(i18n), 톤·Wake Lock 라우팅, 세션 폐기.
 *
 * 두 모드가 한 watch를 공유하는 것이 핵심이다. 모드마다 watch를 따로 두면 인계·전환
 * 순간에 두 추적이 겹치거나 끊긴다 — fix는 한 줄기로 받고 그 fix를 어느 리듀서에
 * 태울지만 모드가 정한다.
 *
 * 시간은 `performance.now()` 단조 시각(초)만 쓴다. 리듀서의 역순 fix 폐기·타이머
 * 정지 계약이 단조 시각 위에서만 성립하므로 벽시계(Date.now)를 섞지 않는다.
 */

/** 기존 비콘과 동일한 watch 옵션 — 정밀 우선·캐시 무시(추적은 최신 fix가 정본). */
const WATCH_OPTS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 15_000,
  maximumAge: 0,
};
const TONE_THROTTLE_MS = 2000;
const TICK_THROTTLE_MS = 3000;
/**
 * 같은 문장을 다시 통지할 때 live region을 비웠다 채우는 간격. 텍스트가 같으면 DOM이
 * 바뀌지 않아 스크린 리더가 침묵하므로("현재 안내 반복"이 아무 일도 안 하는 것처럼
 * 보인다) 빈 문자열을 한 번 거친다.
 */
const REANNOUNCE_DELAY_MS = 60;

export type GuideMode = "brief" | "detail";

type GuideT = ReturnType<typeof useTranslations<"guide">>;
type BeaconT = ReturnType<typeof useTranslations<"beacon">>;

export interface RouteGuideDest {
  lat: number;
  lng: number;
  name: string;
}

/** 확신도 3단(스펙 §5.4): ≤10m 원문 / ≤20m "약 N" / >20m "N쯤". 잔여 200m 이상은 원문. */
function confidenceDistance(meters: number, accuracy: number, t: GuideT): string {
  const base = formatDistance(meters);
  if (meters >= 200 || accuracy <= 10) return base;
  if (accuracy <= 20) return t("approx", { distance: base });
  return t("rough", { distance: base });
}

/**
 * 유닛(단일 스텝 또는 통독 묶음) 전문. 단일이면 provider 문장을 **그대로** 싣는다 —
 * 도보 스텝 description이 낭독 정본이라 재조합 금지(스펙 §3).
 */
function unitText(route: GuideRoute, indices: number[], t: GuideT): string {
  const descs = indices
    .map((i) => route.steps[i]?.description)
    .filter((d): d is string => Boolean(d));
  if (descs.length <= 1) return descs[0] ?? "";
  return t("bundle", { count: descs.length, steps: descs.join(". ") });
}

/** 다음 안내 지점 이름 — 마지막 스텝이면 목적지. */
function nextTarget(route: GuideRoute, stepIndex: number, destName: string): string {
  return route.steps[stepIndex + 1]?.description ?? destName;
}

/** 간략 안내 통지문(기존 비콘 문구 계약 그대로). 발화할 것이 없으면 빈 문자열. */
function briefText(announce: BeaconAnnounce, t: BeaconT): string {
  if (announce.kind === "weak") return t("weak");
  if (!announce.speak) return "";
  // ⚠ nearby의 수치는 거리가 아니라 오차 반경이라 formatDistance를 태우지 않는다.
  if (announce.kind === "nearby") {
    return t("nearby", { meters: Math.round(announce.accuracy) });
  }
  const distance = formatDistance(announce.distance);
  if (announce.kind === "first") return t("first", { distance });
  if (announce.kind === "closer") return t("closer", { distance });
  if (announce.kind === "farther") return t("farther", { distance });
  return "";
}

/** 반복 대상은 실행 안내뿐이다(스펙 §4.2) — 상태·오류·속도 통지는 저장하지 않는다. */
function isGuidanceEvent(kind: GuideEvent["kind"]): boolean {
  return kind === "announceSteps" || kind === "bundleReread" || kind === "periodic";
}

export interface RouteGuideApi {
  status: BeaconStatus;
  supported: boolean;
  mode: GuideMode;
  /** 단일 polite live region에 실을 텍스트(패널이 그대로 렌더한다). */
  liveText: string;
  lastGuidance: string | null;
  offRoute: boolean;
  /** 전환 버튼 노출 조건 — ko 데이터 로케일이면서 유효 상세 경로를 쥔 세션만. */
  canOfferDetail: boolean;
  rerouting: boolean;
  start: () => void;
  stop: () => void;
  toggleMode: () => void;
  repeatGuidance: () => void;
  announceProgress: () => void;
  requestReroute: () => void;
}

export function useRouteGuide(dest: RouteGuideDest): RouteGuideApi {
  const locale = useLocale();
  const t = useTranslations("guide");
  const tBeacon = useTranslations("beacon");
  const { playCloser, playFarther, playNearby, playTick, playStart, playStop } =
    useBeaconSound();
  const wakeLock = useScreenWakeLock();

  const [status, setStatus] = useState<BeaconStatus>("idle");
  const [mode, setMode] = useState<GuideMode>("brief");
  const [liveText, setLiveText] = useState("");
  const [lastGuidance, setLastGuidance] = useState<string | null>(null);
  const [offRoute, setOffRoute] = useState(false);
  const [hasRoute, setHasRoute] = useState(false);
  const [rerouting, setRerouting] = useState(false);

  const destRef = useRef(dest);
  const modeRef = useRef<GuideMode>("brief");
  const trackingRef = useRef(false);
  const mountedRef = useRef(true);
  const watchIdRef = useRef<number | null>(null);
  const beaconRef = useRef<BeaconState>(INITIAL_BEACON_STATE);
  const guideRef = useRef<GuideState | null>(null);
  /** 상세 모드 무이벤트 tick의 스로틀 기준(초 단위 단조 시각). */
  const detailTickRef = useRef<number | null>(null);
  const routeRef = useRef<GuideRoute | null>(null);
  const lastFixRef = useRef<GuideFix | null>(null);
  const lastGuidanceRef = useRef<string | null>(null);
  /** 간략→상세 전환 보류 시작 시각(단조 초). null이면 보류 없음. */
  const pendingResolveRef = useRef<number | null>(null);
  /**
   * 세대 토큰. 시작·중지·모드 전환·재조회마다 증가하고, 비동기 응답은 도착 시 자기
   * 세대를 대조해 어긋나면 폐기한다(latest-wins — 스펙 §5.6 이탈 게이트).
   */
  const genRef = useRef(0);
  const rerouteInFlightRef = useRef(false);
  const prevKindRef = useRef<AnnounceKind | null>(null);
  const lastTrendToneAtRef = useRef(0);
  const lastTickAtRef = useRef(0);
  const liveRef = useRef("");
  const reannounceTimerRef = useRef<number | null>(null);

  const supported = typeof navigator !== "undefined" && !!navigator.geolocation;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const announce = useCallback((text: string) => {
    if (!mountedRef.current) return;
    if (reannounceTimerRef.current !== null) {
      window.clearTimeout(reannounceTimerRef.current);
      reannounceTimerRef.current = null;
    }
    // 같은 문장이면 DOM 텍스트가 안 바뀌어 낭독이 안 된다 — 빈 값을 한 번 거친다.
    if (text && text === liveRef.current) {
      liveRef.current = "";
      setLiveText("");
      reannounceTimerRef.current = window.setTimeout(() => {
        reannounceTimerRef.current = null;
        if (!mountedRef.current) return;
        liveRef.current = text;
        setLiveText(text);
      }, REANNOUNCE_DELAY_MS);
      return;
    }
    liveRef.current = text;
    setLiveText(text);
  }, []);

  const rememberGuidance = useCallback((text: string) => {
    lastGuidanceRef.current = text;
    setLastGuidance(text);
  }, []);

  const routeTone = useCallback(
    (kind: AnnounceKind) => {
      const now = Date.now();
      if (kind === "nearby") {
        playNearby();
        return;
      }
      // 추세 톤과 tick은 독립 창 — tick이 추세 톤 예산을 잠식하지 않는다.
      if (kind === "closer" || kind === "farther") {
        if (now - lastTrendToneAtRef.current < TONE_THROTTLE_MS) return;
        lastTrendToneAtRef.current = now;
        if (kind === "closer") playCloser();
        else playFarther();
        return;
      }
      if (kind === "hold") {
        if (now - lastTickAtRef.current < TICK_THROTTLE_MS) return;
        lastTickAtRef.current = now;
        playTick();
      }
      // first·weak: 톤 없음.
    },
    [playCloser, playFarther, playNearby, playTick],
  );

  /** 이벤트 → 통지문. 사용자에게 말할 것이 없는 이벤트는 빈 문자열. */
  const eventText = useCallback(
    (event: GuideEvent, route: GuideRoute): string => {
      switch (event.kind) {
        case "announceSteps":
        case "bundleReread":
          return unitText(route, event.indices, t);
        case "periodic":
          return t("next", {
            step: nextTarget(route, event.stepIndex, destRef.current.name),
            distance: confidenceDistance(event.remainingMeters, event.accuracy, t),
          });
        case "handoff":
          return t("handoff");
        case "offRoute":
          return t("offRoute");
        case "backOnRoute":
          return t("backOnRoute");
        case "uncertainEnter":
          return t("uncertain");
        case "uncertainExit":
          return t("uncertainRecovered");
        case "reacquiring":
          return t("reacquiring");
        case "reacquired":
          // 재획득 성공은 "확신 회복"과 같은 의미의 회복 통지다(전용 키 없음).
          return t("uncertainRecovered");
        case "speedSuggest":
          return t("speedSuggest");
      }
    },
    [t],
  );

  /** 상세 모드 확정 — 전환·재획득·재조회가 공유하는 커밋 지점. */
  const commitDetail = useCallback(
    (route: GuideRoute, state: GuideState) => {
      guideRef.current = state;
      routeRef.current = route;
      modeRef.current = "detail";
      setMode("detail");
      setOffRoute(state.phase === "offRoute");
    },
    [],
  );

  /** 현재 위치에서 목적지까지 도보 경로를 받아 기하를 조립한다. 실패는 전부 null(fail-closed). */
  const fetchGuideRoute = useCallback(async (): Promise<GuideRoute | null> => {
    const geo = await awaitGeolocation();
    if (geo.status !== "ready") return null;
    const target = destRef.current;
    try {
      const res = await fetch(
        `/api/route/walk?origin=${geo.coords.lat},${geo.coords.lng}` +
          `&dest=${target.lat},${target.lng}&includeGeometry=1`,
      );
      if (!res.ok) return null;
      const body: unknown = await res.json();
      if (isOutOfCoverageBody(body)) return null;
      const result = (body as { result?: WalkRouteBriefing | null }).result;
      if (!result) return null;
      return buildGuideRoute(result.steps);
    } catch {
      return null;
    }
  }, []);

  const stepBrief = useCallback(
    (fix: GuideFix) => {
      const result = beaconStep(beaconRef.current, fix, destRef.current);
      beaconRef.current = result.state;
      // weak가 연속되면 재방출하지 않는다(polite live region 스팸 방지).
      if (result.announce.kind === "weak" && prevKindRef.current === "weak") return;
      prevKindRef.current = result.announce.kind;
      routeTone(result.announce.kind);
      const text = briefText(result.announce, tBeacon);
      announce(text);
      if (text && result.announce.speak) rememberGuidance(text);
    },
    [announce, rememberGuidance, routeTone, tBeacon],
  );

  const stepDetail = useCallback(
    (fix: GuideFix, route: GuideRoute, state: GuideState, now: number) => {
      const result = guideStep(state, fix, route, now);
      guideRef.current = result.state;
      setOffRoute(result.state.phase === "offRoute");
      if (result.tone === "ahead") playNearby();
      else if (result.tone === "warning") playFarther();
      if (!result.event) {
        // 무이벤트 fix는 tick 하트비트(스펙 §5.3 상세 톤 유지 — 침묵과 죽음의 구분).
        if (detailTickRef.current === null || now - detailTickRef.current >= 3) {
          detailTickRef.current = now;
          playTick();
        }
        return;
      }
      const text = eventText(result.event, route);
      if (result.event.kind === "handoff") {
        // 인계는 단방향 래치 — 여기서 간략으로 넘기면 이후 fix는 비콘 경로가 받는다.
        modeRef.current = "brief";
        setMode("brief");
        beaconRef.current = INITIAL_BEACON_STATE;
        prevKindRef.current = null;
        setOffRoute(false);
      }
      if (!text) return;
      announce(text);
      if (isGuidanceEvent(result.event.kind)) rememberGuidance(text);
    },
    [announce, eventText, playFarther, playNearby, playTick, rememberGuidance],
  );

  /**
   * 간략→상세 전환 보류 해소(스펙 §6). 후보가 복수인 동안은 간략을 유지한 채 후속
   * fix로 재평가하고, 타임아웃이면 보류를 접는다. 이 fix를 소비했으면 true.
   */
  const resolvePending = useCallback(
    (fix: GuideFix, now: number): boolean => {
      const startedAt = pendingResolveRef.current;
      const route = routeRef.current;
      if (startedAt === null) return false;
      if (!route) {
        pendingResolveRef.current = null;
        return false;
      }
      const entry = entryProjection(route, fix);
      if (entry.status === "ok") {
        pendingResolveRef.current = null;
        commitDetail(route, guideStateAt(route, entry.d, now, { autoHandoffArmed: false }));
        announce(t("toDetailDone"));
        return true;
      }
      if (now - startedAt >= RESOLVE_TIMEOUT_S) {
        pendingResolveRef.current = null;
        announce(t("resolveFailed"));
        return true;
      }
      return false;
    },
    [announce, commitDetail, t],
  );

  const handleFix = useCallback(
    (pos: GeolocationPosition) => {
      if (!mountedRef.current || !trackingRef.current) return;
      const fix: GuideFix = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      };
      lastFixRef.current = fix;
      const now = performance.now() / 1000;
      if (resolvePending(fix, now)) return;
      const route = routeRef.current;
      const state = guideRef.current;
      if (modeRef.current === "detail" && route && state) {
        stepDetail(fix, route, state, now);
        return;
      }
      stepBrief(fix);
    },
    [resolvePending, stepBrief, stepDetail],
  );

  const clearWatch = useCallback(() => {
    if (
      watchIdRef.current !== null &&
      typeof navigator !== "undefined" &&
      navigator.geolocation
    ) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }
    watchIdRef.current = null;
  }, []);

  const handleError = useCallback(
    (err: GeolocationPositionError) => {
      if (!mountedRef.current) return;
      if (err.code === err.PERMISSION_DENIED) {
        clearWatch();
        trackingRef.current = false;
        prevKindRef.current = null;
        void wakeLock.release();
        setStatus("denied");
        announce(tBeacon("denied"));
        return;
      }
      // POSITION_UNAVAILABLE·TIMEOUT: 추적 유지, 신호 약함만(전이 1회) 통지.
      if (prevKindRef.current === "weak") return;
      prevKindRef.current = "weak";
      announce(tBeacon("weak"));
    },
    [announce, clearWatch, tBeacon, wakeLock],
  );

  // 콜백을 ref로 우회 등록한다 — watchPosition에 넘긴 함수는 등록 시점 클로저에
  // 고정되므로, 로케일 전환 같은 재렌더가 옛 번역을 계속 쓰게 두지 않는다.
  // (갱신은 아래 단일 미러 effect에서 — 렌더 중 ref 쓰기 금지.)
  const handleFixRef = useRef(handleFix);
  const handleErrorRef = useRef(handleError);

  const stop = useCallback(() => {
    if (!trackingRef.current && watchIdRef.current === null) return;
    genRef.current += 1;
    clearWatch();
    trackingRef.current = false;
    prevKindRef.current = null;
    void wakeLock.release();
    // 경로 데이터는 세션 메모리에만 둔다(스펙 §7.3) — 중지 시 폐기.
    beaconRef.current = INITIAL_BEACON_STATE;
    guideRef.current = null;
    routeRef.current = null;
    lastFixRef.current = null;
    lastGuidanceRef.current = null;
    pendingResolveRef.current = null;
    if (mountedRef.current) {
      setStatus("idle");
      setMode("brief");
      modeRef.current = "brief";
      setHasRoute(false);
      setOffRoute(false);
      setRerouting(false);
      setLastGuidance(null);
      announce("");
    }
    playStop();
  }, [announce, clearWatch, playStop, wakeLock]);

  const start = useCallback(() => {
    if (!supported) {
      setStatus("unsupported");
      return;
    }
    if (watchIdRef.current !== null) return;
    genRef.current += 1;
    const gen = genRef.current;
    beaconRef.current = INITIAL_BEACON_STATE;
    guideRef.current = null;
    routeRef.current = null;
    lastFixRef.current = null;
    lastGuidanceRef.current = null;
    pendingResolveRef.current = null;
    prevKindRef.current = null;
    trackingRef.current = true;
    modeRef.current = "brief";
    setMode("brief");
    setHasRoute(false);
    setOffRoute(false);
    setLastGuidance(null);
    setStatus("tracking");
    announce("");
    playStart();
    void wakeLock.acquire();
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => handleFixRef.current(pos),
      (err) => handleErrorRef.current(err),
      WATCH_OPTS,
    );

    // 상세 안내는 ko 데이터 로케일 전용(도보 API가 ko 전용) — 그 외는 간략으로 시작.
    if (prefersEnglish(locale)) {
      announce(t("briefStarted"));
      return;
    }
    void (async () => {
      const route = await fetchGuideRoute();
      if (gen !== genRef.current || !trackingRef.current || !mountedRef.current) return;
      if (!route) {
        // 조용한 강등 금지 — 시작 통지가 어느 모드인지 말한다(스펙 §4.1).
        announce(t("detailUnavailable"));
        return;
      }
      const now = performance.now() / 1000;
      const init = initialGuideState(route, now);
      commitDetail(route, init.state);
      setHasRoute(true);
      const first = unitText(route, init.firstIndices, t);
      rememberGuidance(first);
      // 요약과 첫 안내는 한 문장으로 — 두 통지가 경합하면 앞의 것이 잘린다(스펙 §5.3).
      announce(
        t("detailStart", {
          count: route.steps.length,
          distance: formatDistance(route.totalMeters),
          first,
        }),
      );
    })();
  }, [
    announce,
    commitDetail,
    fetchGuideRoute,
    locale,
    playStart,
    rememberGuidance,
    supported,
    t,
    wakeLock,
  ]);

  const toggleMode = useCallback(() => {
    const route = routeRef.current;
    if (!trackingRef.current || !route) return;
    // 진행 중 재조회 응답은 모드 전환으로 무효가 된다(스펙 §5.6 폐기 조건).
    genRef.current += 1;
    const now = performance.now() / 1000;
    if (modeRef.current === "detail") {
      modeRef.current = "brief";
      setMode("brief");
      guideRef.current = null;
      // 간략 앵커 리셋 — 다음 fix가 절대거리 1회 발화 후 추세를 다시 잡는다(스펙 §6).
      beaconRef.current = INITIAL_BEACON_STATE;
      prevKindRef.current = null;
      pendingResolveRef.current = null;
      setOffRoute(false);
      announce(t("toBriefDone"));
      return;
    }
    const fix = lastFixRef.current;
    if (!fix) {
      pendingResolveRef.current = now;
      announce(t("resolvePending"));
      return;
    }
    const entry = entryProjection(route, fix);
    if (entry.status === "ok") {
      pendingResolveRef.current = null;
      commitDetail(route, guideStateAt(route, entry.d, now, { autoHandoffArmed: false }));
      announce(t("toDetailDone"));
      return;
    }
    if (entry.status === "ambiguous") {
      // 후보가 복수면 확정하지 않는다 — 잘못 고른 후보도 폴리라인 위라 이탈 판정이
      // 영영 못 잡는다. 간략을 유지한 채 후속 fix로 재평가(스펙 §6).
      pendingResolveRef.current = now;
      announce(t("resolvePending"));
      return;
    }
    announce(t("resolveFailed"));
  }, [announce, commitDetail, t]);

  const repeatGuidance = useCallback(() => {
    announce(lastGuidanceRef.current ?? t("noGuidanceYet"));
  }, [announce, t]);

  const announceProgress = useCallback(() => {
    const route = routeRef.current;
    const state = guideRef.current;
    const fix = lastFixRef.current;
    const straight = fix
      ? formatDistance(
          haversineMeters(fix.lat, fix.lng, destRef.current.lat, destRef.current.lng),
        )
      : null;
    if (modeRef.current !== "detail" || !route || !state) {
      // 간략 모드의 진행 상황은 목적지 직선거리 하나다(스펙 §4.2).
      announce(straight ? tBeacon("first", { distance: straight }) : t("noGuidanceYet"));
      return;
    }
    const total = formatDistance(Math.max(0, route.totalMeters - state.d));
    if (state.phase === "offRoute") {
      announce(
        straight
          ? t("progressOffRoute", { distance: straight })
          : t("offRoute"),
      );
      return;
    }
    if (state.phase === "uncertain" || state.phase === "reacquiring") {
      announce(
        t("progressUncertain", {
          last: lastGuidanceRef.current ?? t("noGuidanceYet"),
        }),
      );
      return;
    }
    if (state.phase === "bundle") {
      announce(
        t("progressBundle", {
          total,
          count: unitAt(route, state.stepIndex).length,
        }),
      );
      return;
    }
    const cur = route.steps[state.stepIndex];
    announce(
      t("progressFollowing", {
        total,
        step: nextTarget(route, state.stepIndex, destRef.current.name),
        distance: formatDistance(Math.max(0, (cur?.endD ?? state.d) - state.d)),
      }),
    );
  }, [announce, t, tBeacon]);

  const requestReroute = useCallback(() => {
    if (!trackingRef.current || rerouteInFlightRef.current) return;
    rerouteInFlightRef.current = true;
    setRerouting(true);
    genRef.current += 1;
    const gen = genRef.current;
    void (async () => {
      try {
        const route = await fetchGuideRoute();
        // 도착 응답 폐기: 세대 불일치·중지·언마운트(채팅 이탈 게이트 동형).
        if (gen !== genRef.current || !trackingRef.current || !mountedRef.current) return;
        if (!route) {
          announce(t("rerouteFailed"));
          return;
        }
        // 새 경로는 현재 위치에서 출발하므로 진행거리 0에서 다시 시작한다.
        const now = performance.now() / 1000;
        const init = initialGuideState(route, now);
        commitDetail(route, init.state);
        setHasRoute(true);
        pendingResolveRef.current = null;
        const first = unitText(route, init.firstIndices, t);
        rememberGuidance(first);
        announce(first);
      } finally {
        rerouteInFlightRef.current = false;
        if (mountedRef.current) setRerouting(false);
      }
    })();
  }, [announce, commitDetail, fetchGuideRoute, rememberGuidance, t]);

  // 전경 전용(스펙 §9): 탭이 숨으면 중지하고 경로를 폐기한다. 복귀 후 자동 재개 없음
  // — 숨김 탭에서 멎은 watch·타이머가 좀비 상태를 만드는 것을 상태로 흡수한다.
  const stopRef = useRef(stop);

  // 최신 값 미러(매 렌더 후). 등록형 콜백이 등록 시점 클로저에 고정되는 것을 막는
  // 유일한 갱신 지점 — 렌더 중 ref 쓰기는 금지다(useNearbyFetch 관례 동형).
  useEffect(() => {
    destRef.current = dest;
    handleFixRef.current = handleFix;
    handleErrorRef.current = handleError;
    stopRef.current = stop;
  });

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") stopRef.current();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // 언마운트 정리 — watch·Wake Lock·재통지 타이머.
  useEffect(() => {
    return () => {
      if (
        watchIdRef.current !== null &&
        typeof navigator !== "undefined" &&
        navigator.geolocation
      ) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      watchIdRef.current = null;
      trackingRef.current = false;
      routeRef.current = null;
      guideRef.current = null;
      if (reannounceTimerRef.current !== null) {
        window.clearTimeout(reannounceTimerRef.current);
        reannounceTimerRef.current = null;
      }
      void wakeLock.release();
    };
  }, [wakeLock]);

  return {
    status,
    supported,
    mode,
    liveText,
    lastGuidance,
    offRoute,
    canOfferDetail: !prefersEnglish(locale) && hasRoute,
    rerouting,
    start,
    stop,
    toggleMode,
    repeatGuidance,
    announceProgress,
    requestReroute,
  };
}
