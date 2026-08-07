"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  BASE_DEAD_BAND_M,
  beaconStep,
  INITIAL_BEACON_STATE,
  rebaseBeaconState,
  type AnnounceKind,
  type BeaconAnnounce,
  type BeaconState,
} from "@/lib/beacon";
import {
  INITIAL_MOTION_STATE,
  MAX_CAR_SPEED_MPS,
  MAX_WALK_SPEED_MPS,
  motionStep,
  type MotionJudgeState,
  type MotionState,
} from "@/lib/guide-motion";
import {
  CAR_CLOSER_INTERVAL_S,
  INITIAL_TONE_LAYER_STATE,
  toneLayerStep,
  WALK_CLOSER_INTERVAL_S,
  type ToneLayerInput,
  type ToneLayerState,
} from "@/lib/guide-tone-layer";
import {
  buildGuideRoute,
  CAR_TUNING,
  entryProjection,
  guideStateAt,
  guideStep,
  initialGuideState,
  unitAt,
  RESOLVE_TIMEOUT_S,
  WALK_TUNING,
  type GuideEvent,
  type GuideFix,
  type GuideRoute,
  type GuideState,
  type GuideTuning,
} from "@/lib/route-guide";
import { buildCarGuide, roadNameAt, type CarRoadSpan } from "@/lib/car-route-guide";
import { prefersEnglish } from "@/lib/data-locale";
import { formatDistance, joinText } from "@/lib/format";
import { haversineMeters } from "@/lib/geo";
import { awaitGeolocation } from "@/lib/geolocation";
import { claimGuideSession, releaseGuideSession } from "@/lib/guide-session-store";
import { isOutOfCoverageBody } from "@/lib/out-of-coverage";
import type { CarRouteBriefing, WalkRouteBriefing } from "@/lib/types";
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
/**
 * fix 부재를 신뢰 불가 톤으로 알리기 시작하는 경과(초). iOS `noFixSeconds`와 동조.
 * ⚠ **타이머 구동**이라야 한다 — 권한 철회·서비스 중단이면 fix 콜백 자체가 오지
 * 않아, 톤을 fix 처리에만 걸면 마지막 정상 톤 이후 영구 침묵이 된다.
 */
const NO_FIX_S = 8;
/** 워치독 점검 주기(ms). 임계(8초)보다 촘촘해야 지연이 작다. */
const WATCHDOG_INTERVAL_MS = 2000;
/**
 * 같은 문장을 다시 통지할 때 live region을 비웠다 채우는 간격. 텍스트가 같으면 DOM이
 * 바뀌지 않아 스크린 리더가 침묵하므로("현재 안내 반복"이 아무 일도 안 하는 것처럼
 * 보인다) 빈 문자열을 한 번 거친다. 너무 짧으면 접근성 트리가 두 변경을 한 배치로
 * 합쳐 낭독 0회가 된다(통상 권고 100~150ms 하단 — 실기기 VO 확인 항목).
 * ⚠ ZWSP·공백 덧붙이기 우회 금지: iOS에서 문자로 낭독됨 실측.
 */
const REANNOUNCE_DELAY_MS = 120;
/** 이 나이(초)를 넘긴 fix로는 직선거리를 단정하지 않는다(3-state — 거짓 정밀 금지). */
const PROGRESS_FIX_MAX_AGE_S = 15;

export type GuideMode = "brief" | "detail";

/**
 * 안내 수단(B1 스펙 §4.1). kind 하나가 리듀서 튜닝·경로 소스·낭독 문구를 봉인
 * 구성으로 원자 결정한다 — "car인데 walk 프로파일" 같은 의미 불일치 세션이
 * 성립하지 않는다. 세션 도중 kind 변경은 지원하지 않는다(첫 렌더 값 고정).
 */
export type GuideKind = "walk" | "car";

const GUIDE_TUNINGS: Record<GuideKind, GuideTuning> = {
  walk: WALK_TUNING,
  car: CAR_TUNING,
};

/** car ETA 재조회(§4.6): 10분 주기, 시작 조회 포함 세션 캡 6회. */
const CAR_ETA_INTERVAL_MS = 600_000;
const CAR_ETA_CALL_CAP = 6;
/** ETA를 "오래됨"으로 판정하는 경과(초) — 주기 + 여유. */
const CAR_ETA_STALE_S = 660;

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
 * 유닛(단일 스텝 또는 통독 묶음) 전문. 단일이면 API 문장을 **그대로** 싣는다 —
 * 클라이언트 재조합 금지(스펙 §3). ⚠ 이 `description`은 provider 원문이 아니라
 * 서버 `rewriteWalkGuidance`가 만든 완성 문장이다(2026-08-07): 거리·도로명이 이미
 * 문장 안에 있으므로 여기서 거리를 덧붙이면 중복 낭독이 된다.
 */
function unitText(route: GuideRoute, indices: number[], t: GuideT): string {
  const descs = indices
    .map((i) => route.steps[i]?.description)
    .filter((d): d is string => Boolean(d));
  if (descs.length <= 1) return descs[0] ?? "";
  return t("bundle", { count: descs.length, steps: descs.join(". ") });
}

/**
 * 다음 안내 통지문 — 그 자리에 들어오는 값의 **타입에 맞는 틀**을 고른다
 * (위원장 실사용 피드백 2026-08-07).
 *
 * 다음 스텝이 있으면 값은 완결 서술문이고("수서역에서 …밤고개로를 따라 300m
 * 이동"), 마지막 스텝이면 목적지 이름(명사)이다. 종전에는 둘을 한 틀
 * "{step}까지 {distance}"에 넣어, 명사에는 맞고 서술문에는 어긋났다 —
 * "…300m 이동까지 약 129m"처럼 두 거리가 역할 표지 없이 인접해 어느 쪽이 남은
 * 거리인지 낭독으로 구분되지 않았고, "…까지"로 끝나는 도보 원문에는 조사가
 * 겹쳤다. 서술문에는 잔여 거리를 앞에 두고 "앞"으로 역할을 표시한다(내비게이션
 * 관용구 "300m 앞 좌회전"과 같은 어순 — 운전 중 필요한 순서는 "얼마 뒤에 →
 * 무엇을"이다). 스텝 원문은 어느 틀에서도 재조합하지 않는다.
 */
export function nextLine(
  route: GuideRoute,
  stepIndex: number,
  destName: string,
  distance: string,
  t: GuideT,
): string {
  const step = route.steps[stepIndex + 1]?.description;
  return step
    ? t("next", { distance, step })
    : t("nextDestination", { dest: destName, distance });
}

/** 진행 상황 통지문 — 총 잔여를 앞세우되 뒤쪽 어순은 nextLine과 같은 계약. */
export function progressFollowingLine(
  route: GuideRoute,
  stepIndex: number,
  destName: string,
  total: string,
  distance: string,
  t: GuideT,
): string {
  const step = route.steps[stepIndex + 1]?.description;
  return step
    ? t("progressFollowing", { total, distance, step })
    : t("progressFollowingDestination", { total, dest: destName, distance });
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

/** 마지막 안내 저장 대상은 실행 안내뿐(스펙 §4.2) — 상태·오류·속도 통지는 제외. */
function isGuidanceEvent(kind: GuideEvent["kind"]): boolean {
  return (
    kind === "announceSteps" ||
    kind === "farNotice" ||
    kind === "bundleReread" ||
    kind === "periodic"
  );
}

/** 상세 모드 상시 표시용 경로 기준 진행 상황(위원장 실측 판정 2026-08-03 묶음 A). */
export interface GuideProgress {
  /** 경로 기준 잔여 거리(m) — 직선거리가 아니다. */
  remainingMeters: number;
  /** 경로 총 소요시간을 잔여 비례로 축소한 추정(초). 근거 없으면 null(날조 금지). */
  etaSeconds: number | null;
}

export interface RouteGuideApi {
  status: BeaconStatus;
  supported: boolean;
  mode: GuideMode;
  /** 단일 polite live region에 실을 텍스트(패널이 그대로 렌더한다). */
  liveText: string;
  offRoute: boolean;
  /**
   * 상세 모드의 경로 기준 잔여 거리·예상 시간. live region 밖 일반 텍스트로만
   * 렌더한다 — 매 fix 갱신되므로 polite 채널에 태우면 그 자체가 통지 스팸이 된다.
   */
  progress: GuideProgress | null;
  /** 전환 버튼 노출 조건 — ko 데이터 로케일이면서 유효 상세 경로를 쥔 세션만. */
  canOfferDetail: boolean;
  rerouting: boolean;
  start: () => void;
  stop: () => void;
  toggleMode: () => void;
  announceProgress: () => void;
  requestReroute: () => void;
}

export function useRouteGuide(
  dest: RouteGuideDest,
  kind: GuideKind = "walk",
): RouteGuideApi {
  const locale = useLocale();
  const t = useTranslations("guide");
  const tBeacon = useTranslations("beacon");
  // kind는 세션 봉인 구성의 키 — 첫 렌더 값으로 고정한다(중도 변경 미지원.
  // ref가 아니라 state 초기값 고정: 렌더 중 ref 읽기 금지 규칙과의 정합).
  const [kindFixed] = useState(kind);
  const tuning = GUIDE_TUNINGS[kindFixed];
  const { play } = useBeaconSound();
  const wakeLock = useScreenWakeLock();

  const [status, setStatus] = useState<BeaconStatus>("idle");
  const [mode, setMode] = useState<GuideMode>("brief");
  const [liveText, setLiveText] = useState("");
  const [offRoute, setOffRoute] = useState(false);
  const [progress, setProgress] = useState<GuideProgress | null>(null);
  const [hasRoute, setHasRoute] = useState(false);
  const [rerouting, setRerouting] = useState(false);

  const destRef = useRef(dest);
  const modeRef = useRef<GuideMode>("brief");
  const trackingRef = useRef(false);
  const mountedRef = useRef(true);
  const watchIdRef = useRef<number | null>(null);
  const beaconRef = useRef<BeaconState>(INITIAL_BEACON_STATE);
  const guideRef = useRef<GuideState | null>(null);
  /** 톤 계층 상태(간략·상세 공용 — 모드 차이는 입력 조립에만 있다). */
  const toneStateRef = useRef<ToneLayerState>(INITIAL_TONE_LAYER_STATE);
  /** 정지 판정 상태(도플러 3-state). */
  const motionStateRef = useRef<MotionJudgeState>(INITIAL_MOTION_STATE);
  /** 상세 투영 점프 가드의 기준(직전 잔여 거리·시각). */
  const lastRemainingRef = useRef<{ meters: number; at: number } | null>(null);
  /** 세션 시작 시각(초, 단조) — 첫 fix 대기도 워치독이 덮게 하는 기준. */
  const startedAtRef = useRef<number | null>(null);
  const routeRef = useRef<GuideRoute | null>(null);
  /** 상세 경로의 총 소요시간(초, provider 원값) — walk 잔여 시간 비례 추정의 분모. */
  const routeDurationRef = useRef<number | null>(null);
  /** car 도로명 스팬(§4.7 — 현재 진행거리가 속한 링크만 답한다). */
  const roadSpansRef = useRef<CarRoadSpan[]>([]);
  /** car ETA(§4.6): 현 위치→목적지 재조회 totalTime + 갱신 시각(단조 초). */
  const etaRef = useRef<{ seconds: number; updatedAt: number } | null>(null);
  const etaCallCountRef = useRef(0);
  const etaTimerRef = useRef<number | null>(null);
  const lastFixRef = useRef<GuideFix | null>(null);
  /** 마지막 fix 수신 시각(초, 단조) — 진행 상황의 직선거리 신선도 게이트용. */
  const lastFixAtRef = useRef<number | null>(null);
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
  }, []);

  /**
   * 경로 기준 잔여 거리·예상 시간(스냅숏). 예상 시간은 provider가 준 총 소요시간을
   * 잔여 거리 비례로 축소한 값이다 — 실측 속도로 재추정하지 않는다(보행 멈춤·GPS
   * 잡음에 출렁이는 수치는 상시 표시로 부적합, 결정론 우선).
   */
  const progressOf = useCallback(
    (route: GuideRoute, state: GuideState): GuideProgress => {
      const remaining = Math.max(0, route.totalMeters - state.d);
      // car ETA는 재조회 값의 경과 차감 카운트다운(§4.6 — 비례 축소는 정체
      // 국소성에 취약해 폐기). walk는 총 소요의 잔여 비례(묶음 A 계약 유지).
      if (kindFixed === "car") {
        const eta = etaRef.current;
        const elapsed = eta ? performance.now() / 1000 - eta.updatedAt : 0;
        return {
          remainingMeters: remaining,
          etaSeconds: eta ? Math.max(0, eta.seconds - elapsed) : null,
        };
      }
      const dur = routeDurationRef.current;
      return {
        remainingMeters: remaining,
        etaSeconds:
          dur !== null && dur > 0 && route.totalMeters > 0
            ? (dur * remaining) / route.totalMeters
            : null,
      };
    },
    [kindFixed],
  );

  /** 수단별 물리 상한(정지 판정 폴백 + 투영 점프 가드). */
  const maxSpeedMps = kindFixed === "car" ? MAX_CAR_SPEED_MPS : MAX_WALK_SPEED_MPS;
  /** 수단별 closer 최소 간격 — 차량은 데드밴드를 매 fix 넘어 2초 창에 매번 걸린다. */
  const closerIntervalSeconds =
    kindFixed === "car" ? CAR_CLOSER_INTERVAL_S : WALK_CLOSER_INTERVAL_S;

  /**
   * 톤 계층 통과 + 재생. 계층 순서·간격·재기준화는 순수 함수가 소유한다 — 훅은
   * 입력 조립과 I/O만 한다(iOS `BeaconModel.routeTone`과 같은 구조).
   */
  const emitTone = useCallback(
    (input: ToneLayerInput, now: number) => {
      const out = toneLayerStep(toneStateRef.current, input, now);
      toneStateRef.current = out.state;
      if (out.tone) play(out.tone);
    },
    [play],
  );

  /**
   * 이 fix의 이동 상태. **모든 fix에서 호출한다** — 거리 미분 폴백이 직전 표본을
   * 쓰므로 건너뛰면 폴백 기준이 낡는다.
   *
   * ⚠ `pos.coords.speed`는 무효일 때 `null`이고 웹에는 `speedAccuracy`가 없다.
   * 그대로 넘겨 판정을 순수 함수에 맡긴다(0으로 변환하면 거짓 정지 tick).
   */
  const judgeMotion = useCallback(
    (pos: GeolocationPosition, now: number): MotionState => {
      const out = motionStep(
        motionStateRef.current,
        {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          at: now,
        },
        pos.coords.speed,
        null,
        maxSpeedMps,
      );
      motionStateRef.current = out.state;
      return out.motion;
    },
    [maxSpeedMps],
  );

  /**
   * 상세 투영 점프 가드. 상세 모드의 오차 원인은 GPS 정확도가 아니라 **경로 투영의
   * 안정성**이라(평행 도로로 투영이 점프하면 accuracy 5m에도 잔여 거리가 100m 튄다)
   * 데드밴드를 정확도로 스케일하지 않고 점프한 fix를 통째로 버린다.
   */
  const projectionJumped = useCallback(
    (remaining: number, now: number): boolean => {
      const prev = lastRemainingRef.current;
      lastRemainingRef.current = { meters: remaining, at: now };
      if (!prev) return false;
      const dt = now - prev.at;
      if (dt <= 0) return true;
      // 여유 계수 1.5 — 속도 상한 자체가 보수적이라 이중으로 좁히지 않는다.
      return Math.abs(remaining - prev.meters) > maxSpeedMps * dt * 1.5;
    },
    [maxSpeedMps],
  );

  /**
   * 거리 축이 바뀔 때(상세 경로 거리 ⇄ 간략 직선거리)의 재기준화. iOS
   * `BeaconModel.rebaseForAxisChange` 미러.
   *
   * 값이 **불연속으로** 줄어든다(경로 500m가 직선 120m가 되는 식). 추세 방향만
   * 승계하고 `anchorDistance`와 `lastSpokenDistance`를 **둘 다** 새 축의 현재값으로
   * 재설정한다. ⚠ `lastSpokenDistance`를 옛 축 값으로 두면 차이 380m가 즉시
   * 마일스톤을 넘겨 **전환 직후 거짓 closer 음성**이 나가고, 반대 방향 전환에서는
   * 필요한 음성이 장기 억제된다.
   */
  const rebaseForAxisChange = useCallback(() => {
    const fixAge =
      lastFixAtRef.current !== null
        ? performance.now() / 1000 - lastFixAtRef.current
        : Infinity;
    const fix = fixAge <= PROGRESS_FIX_MAX_AGE_S ? lastFixRef.current : null;
    // 새 축의 현재값을 모르면 null이 정직한 폴백이다 — 다음 fix가 first 경로를 타서
    // 절대거리를 1회 발화하고 다시 추세를 잡는다.
    const straight = fix
      ? haversineMeters(fix.lat, fix.lng, destRef.current.lat, destRef.current.lng)
      : null;
    beaconRef.current = rebaseBeaconState(beaconRef.current, straight);
    // 톤 축도 같은 규칙 — 다음 추세 fix가 재기준화 후 현재 상태를 1회 알린다.
    toneStateRef.current = { ...toneStateRef.current, needsRebase: true };
    lastRemainingRef.current = null;
  }, []);

  /** 이벤트 → 통지문. 사용자에게 말할 것이 없는 이벤트는 빈 문자열. */
  const eventText = useCallback(
    (event: GuideEvent, route: GuideRoute): string => {
      switch (event.kind) {
        case "announceSteps":
        case "bundleReread":
          return unitText(route, event.indices, t);
        case "farNotice":
          // 원거리 예고(§4.7): 크로싱 시점의 **실측 잔여**(리듀서가 기하에서 계산해
          // 실어 줌 — 상수 낭독 금지, 독립 리뷰 반영) + 원문을 독립 문장으로 결합.
          return t("farNotice", {
            distance: formatDistance(event.remainingMeters),
            step: unitText(route, event.indices, t),
          });
        case "periodic":
          return nextLine(
            route,
            event.stepIndex,
            destRef.current.name,
            confidenceDistance(event.remainingMeters, event.accuracy, t),
            t,
          );
        case "handoff":
          return t("handoff");
        case "offRoute":
          // 차량 이탈 문구는 상태 전문(§4.3) — 첫 통지를 놓쳐도 반복만으로 완결.
          return kindFixed === "car" ? t("carOffRoute") : t("offRoute");
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
    [t, kindFixed],
  );

  /** 상세 모드 확정 — 전환·재획득·재조회가 공유하는 커밋 지점. */
  const commitDetail = useCallback(
    (route: GuideRoute, state: GuideState) => {
      guideRef.current = state;
      routeRef.current = route;
      modeRef.current = "detail";
      setMode("detail");
      setOffRoute(state.phase === "offRoute");
      setProgress(progressOf(route, state));
      // 거리 축이 직선 → 경로로 바뀐다(전환·재획득·재조회 공통). 다음 추세 fix가
      // 새 축 현재값으로 앵커를 다시 잡고 현재 상태를 1회 알린다.
      toneStateRef.current = { ...toneStateRef.current, needsRebase: true };
      lastRemainingRef.current = null;
    },
    [progressOf],
  );

  /**
   * 현재 위치에서 목적지까지 상세 경로 기하를 조립한다(시작 시 재조회 — 길찾기
   * 뷰가 쥔 낡은 출발점 기하 재사용 금지, §5). 실패는 전부 null(fail-closed).
   * car는 provider 판별자·기하 검증(buildCarGuide)을 통과해야 상세 적격이다.
   */
  const fetchGuideRoute = useCallback(async (): Promise<{
    route: GuideRoute;
    durationSeconds: number | null;
    roadSpans: CarRoadSpan[];
  } | null> => {
    const geo = await awaitGeolocation();
    if (geo.status !== "ready") return null;
    const target = destRef.current;
    try {
      if (kindFixed === "car") {
        const res = await fetch(
          `/api/route/car?origin=${geo.coords.lat},${geo.coords.lng}` +
            `&dest=${target.lat},${target.lng}&includeGeometry=1`,
        );
        if (!res.ok) return null;
        const body: unknown = await res.json();
        if (isOutOfCoverageBody(body)) return null;
        const briefing = body as CarRouteBriefing;
        // 카카오 폴백은 기하 미지원(§5) — 시작 폴백으로 정직 강등.
        if (briefing.provider !== "tmap") return null;
        const carGuide = buildCarGuide(briefing);
        if (!carGuide) return null;
        return {
          route: carGuide.route,
          durationSeconds:
            Number.isFinite(briefing.durationSeconds) && briefing.durationSeconds > 0
              ? briefing.durationSeconds
              : null,
          roadSpans: carGuide.roadSpans,
        };
      }
      const res = await fetch(
        `/api/route/walk?origin=${geo.coords.lat},${geo.coords.lng}` +
          `&dest=${target.lat},${target.lng}&includeGeometry=1`,
      );
      if (!res.ok) return null;
      const body: unknown = await res.json();
      if (isOutOfCoverageBody(body)) return null;
      const result = (body as { result?: WalkRouteBriefing | null }).result;
      if (!result) return null;
      const route = buildGuideRoute(result.steps);
      if (!route) return null;
      return {
        route,
        durationSeconds:
          Number.isFinite(result.durationSeconds) && result.durationSeconds > 0
            ? result.durationSeconds
            : null,
        roadSpans: [],
      };
    } catch {
      return null;
    }
  }, [kindFixed]);

  /**
   * car ETA 갱신(§4.6): 현 위치→목적지 재조회의 totalTime을 그대로 잔여 ETA로
   * 쓴다(기하·안내 상태는 교체하지 않는다). 세대 일치 시에만 커밋, 실패는 조용히
   * 직전 값 유지(stale 판정은 updatedAt이 담당). 캡은 시작 조회를 포함해 6회.
   */
  const refreshCarEta = useCallback(async () => {
    if (kindFixed !== "car" || !trackingRef.current) return;
    if (modeRef.current !== "detail") return;
    if (etaCallCountRef.current >= CAR_ETA_CALL_CAP) return;
    // 이탈 중 동결(§4.4): 낡은 경로 기준 ETA 갱신은 거짓이라 건너뛴다.
    if (guideRef.current?.phase === "offRoute") return;
    const gen = genRef.current;
    etaCallCountRef.current += 1;
    try {
      const geo = await awaitGeolocation();
      if (geo.status !== "ready") return;
      const target = destRef.current;
      const res = await fetch(
        `/api/route/car?origin=${geo.coords.lat},${geo.coords.lng}` +
          `&dest=${target.lat},${target.lng}`,
      );
      if (!res.ok) return;
      const body: unknown = await res.json();
      if (isOutOfCoverageBody(body)) return;
      const briefing = body as CarRouteBriefing;
      if (!Number.isFinite(briefing.durationSeconds) || briefing.durationSeconds <= 0) return;
      // 세대 3중 일치(§4.6): 세션 세대·추적 유지·상세 모드일 때만 커밋.
      if (gen !== genRef.current || !trackingRef.current || modeRef.current !== "detail") {
        return;
      }
      etaRef.current = {
        seconds: briefing.durationSeconds,
        updatedAt: performance.now() / 1000,
      };
      const route = routeRef.current;
      const state = guideRef.current;
      if (route && state) setProgress(progressOf(route, state));
    } catch {
      // 조용히 직전 값 유지 — 반복 실패가 polite 채널을 점유하지 않는다(§4.6).
    }
  }, [kindFixed, progressOf]);

  const clearEtaTimer = useCallback(() => {
    if (etaTimerRef.current !== null) {
      window.clearInterval(etaTimerRef.current);
      etaTimerRef.current = null;
    }
  }, []);

  const stepBrief = useCallback(
    (fix: GuideFix, motion: MotionState, now: number) => {
      const result = beaconStep(beaconRef.current, fix, destRef.current);
      beaconRef.current = result.state;
      const weak = result.announce.kind === "weak";
      // 도착 톤 소유는 존 진입 1회뿐이다(리듀서 래치는 음성만 막는다).
      const nearbyEntry = result.announce.kind === "nearby" && result.announce.speak;
      // 톤 계층 입력 조립(간략 3단계: 신뢰 불가 → 도착 → 추세).
      emitTone(
        {
          unreliable: weak,
          priorityTone: nearbyEntry ? "nearby" : null,
          eventOwned: false,
          trend: weak
            ? null
            : {
                distance: result.announce.distance,
                deadBand: Math.max(BASE_DEAD_BAND_M, fix.accuracy),
                motion,
                closerIntervalSeconds,
              },
          arrived: result.state.nearby,
          rebaseTrend: false,
        },
        now,
      );
      // weak가 연속되면 재방출하지 않는다(polite live region 스팸 방지).
      if (weak && prevKindRef.current === "weak") return;
      prevKindRef.current = result.announce.kind;
      const text = briefText(result.announce, tBeacon);
      announce(text);
      if (text && result.announce.speak) rememberGuidance(text);
    },
    [announce, closerIntervalSeconds, emitTone, rememberGuidance, tBeacon],
  );

  const stepDetail = useCallback(
    (fix: GuideFix, route: GuideRoute, state: GuideState, motion: MotionState, now: number) => {
      const result = guideStep(state, fix, route, now, tuning);
      guideRef.current = result.state;
      setOffRoute(result.state.phase === "offRoute");
      setProgress(progressOf(route, result.state));

      // 톤 계층 입력 조립(상세 4단계). ⚠ 종전의 "무이벤트 fix마다 3초 tick 하트비트"는
      // 폐기됐다 — 같은 소리가 간략에서는 정체를 뜻해 한 소리에 두 뜻이 있었다.
      // 그 자리를 추세 축이 대신하므로 별도 중재가 필요 없다.
      const phase = result.state.phase;
      const remaining = Math.max(0, route.totalMeters - result.state.d);
      const jumped = projectionJumped(remaining, now);
      // 추세 축은 정상 추종에서만 유효하다(이탈 중 잔여 거리는 낡은 투영이다).
      const trendable = (phase === "following" || phase === "bundle") && !jumped;
      emitTone(
        {
          unreliable: phase === "uncertain" || phase === "reacquiring",
          priorityTone: result.tone,
          eventOwned: result.event !== null,
          trend: trendable
            ? {
                distance: remaining,
                // 상세는 정확도로 스케일하지 않는다(투영 안정성이 오차 축이다).
                deadBand: BASE_DEAD_BAND_M,
                motion,
                closerIntervalSeconds,
              }
            : null,
          arrived: false,
          rebaseTrend: false,
        },
        now,
      );

      if (!result.event) return;
      const text = eventText(result.event, route);
      if (result.event.kind === "handoff") {
        // 인계는 단방향 래치 — 여기서 간략으로 넘기면 이후 fix는 비콘 경로가 받는다.
        modeRef.current = "brief";
        setMode("brief");
        rebaseForAxisChange();
        prevKindRef.current = null;
        setOffRoute(false);
        setProgress(null);
        clearEtaTimer(); // 간략 전환 후 ETA 재조회는 무의미(자원 위생 — 리뷰 반영)
      }
      if (!text) return;
      announce(text);
      if (isGuidanceEvent(result.event.kind)) rememberGuidance(text);
    },
    [
      announce,
      clearEtaTimer,
      closerIntervalSeconds,
      emitTone,
      eventText,
      progressOf,
      projectionJumped,
      rebaseForAxisChange,
      rememberGuidance,
      tuning,
    ],
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
      const entry = entryProjection(route, fix, tuning);
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
    [announce, commitDetail, t, tuning],
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
      lastFixAtRef.current = performance.now() / 1000;
      const now = lastFixAtRef.current;
      // 모든 fix에서 갱신한다(거리 미분 폴백이 직전 표본을 쓴다).
      const motion = judgeMotion(pos, now);
      if (resolvePending(fix, now)) return;
      const route = routeRef.current;
      const state = guideRef.current;
      if (modeRef.current === "detail" && route && state) {
        stepDetail(fix, route, state, motion, now);
        return;
      }
      stepBrief(fix, motion, now);
    },
    [judgeMotion, resolvePending, stepBrief, stepDetail],
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
    clearEtaTimer();
    releaseGuideSession(sessionStopRef.current);
    trackingRef.current = false;
    prevKindRef.current = null;
    void wakeLock.release();
    // 경로 데이터는 세션 메모리에만 둔다(스펙 §7.3) — 중지 시 폐기.
    beaconRef.current = INITIAL_BEACON_STATE;
    toneStateRef.current = INITIAL_TONE_LAYER_STATE;
    motionStateRef.current = INITIAL_MOTION_STATE;
    lastRemainingRef.current = null;
    startedAtRef.current = null;
    guideRef.current = null;
    routeRef.current = null;
    routeDurationRef.current = null;
    roadSpansRef.current = [];
    etaRef.current = null;
    etaCallCountRef.current = 0;
    lastFixRef.current = null;
    lastFixAtRef.current = null;
    lastGuidanceRef.current = null;
    pendingResolveRef.current = null;
    if (mountedRef.current) {
      setStatus("idle");
      setMode("brief");
      modeRef.current = "brief";
      setHasRoute(false);
      setOffRoute(false);
      setProgress(null);
      setRerouting(false);
      announce("");
    }
    play("stop");
  }, [announce, clearEtaTimer, clearWatch, play, wakeLock]);

  const start = useCallback(() => {
    if (!supported) {
      setStatus("unsupported");
      return;
    }
    if (watchIdRef.current !== null) return;
    // 세션 단일성(§3.3): 다른 패널이 쥔 세션을 먼저 종료시킨 뒤 시작한다.
    claimGuideSession(sessionStopRef.current);
    genRef.current += 1;
    const gen = genRef.current;
    beaconRef.current = INITIAL_BEACON_STATE;
    toneStateRef.current = INITIAL_TONE_LAYER_STATE;
    motionStateRef.current = INITIAL_MOTION_STATE;
    lastRemainingRef.current = null;
    // 첫 fix 대기도 워치독이 덮는다(기준을 세션 시작 시각으로).
    startedAtRef.current = performance.now() / 1000;
    guideRef.current = null;
    routeRef.current = null;
    routeDurationRef.current = null;
    roadSpansRef.current = [];
    etaRef.current = null;
    etaCallCountRef.current = 0;
    lastFixRef.current = null;
    lastFixAtRef.current = null;
    lastGuidanceRef.current = null;
    pendingResolveRef.current = null;
    prevKindRef.current = null;
    trackingRef.current = true;
    modeRef.current = "brief";
    setMode("brief");
    setHasRoute(false);
    setOffRoute(false);
    setProgress(null);
    setStatus("tracking");
    announce("");
    play("start");
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
      const fetched = await fetchGuideRoute();
      if (gen !== genRef.current || !trackingRef.current || !mountedRef.current) return;
      if (!fetched) {
        // 조용한 강등 금지 — 시작 통지가 어느 모드인지 말한다(스펙 §4.1·§4.5).
        announce(t("detailUnavailable"));
        return;
      }
      const { route } = fetched;
      routeDurationRef.current = fetched.durationSeconds;
      roadSpansRef.current = fetched.roadSpans;
      if (kindFixed === "car") {
        // 시작 조회가 ETA 1회차(§4.6 — 캡은 시작·주기·수동 재조회 전부 포함).
        etaCallCountRef.current = 1;
        etaRef.current =
          fetched.durationSeconds !== null
            ? { seconds: fetched.durationSeconds, updatedAt: performance.now() / 1000 }
            : null;
        clearEtaTimer();
        etaTimerRef.current = window.setInterval(() => {
          void refreshCarEta();
        }, CAR_ETA_INTERVAL_MS);
      }
      const now = performance.now() / 1000;
      const init = initialGuideState(route, now);
      commitDetail(route, init.state);
      setHasRoute(true);
      const first = unitText(route, init.firstIndices, t);
      rememberGuidance(first);
      // 요약과 첫 안내는 한 문장으로 — 두 통지가 경합하면 앞의 것이 잘린다(스펙 §5.3).
      announce(
        t(kindFixed === "car" ? "carStart" : "detailStart", {
          count: route.steps.length,
          distance: formatDistance(route.totalMeters),
          first,
        }),
      );
    })();
  }, [
    announce,
    clearEtaTimer,
    commitDetail,
    kindFixed,
    fetchGuideRoute,
    locale,
    play,
    refreshCarEta,
    rememberGuidance,
    supported,
    t,
    wakeLock,
  ]);

  const toggleMode = useCallback(() => {
    // 전환 버튼은 도보 전용(§3.3) — car의 brief 복귀는 세션 재시작뿐(§4.5).
    if (kindFixed !== "walk") return;
    const route = routeRef.current;
    if (!trackingRef.current || !route) return;
    // 진행 중 재조회 응답은 모드 전환으로 무효가 된다(스펙 §5.6 폐기 조건).
    genRef.current += 1;
    const now = performance.now() / 1000;
    if (modeRef.current === "detail") {
      modeRef.current = "brief";
      setMode("brief");
      guideRef.current = null;
      // 경로 거리 → 직선거리(handoff와 같은 규칙). 방향만 승계하고 두 기준을 새 축
      // 현재값으로 재설정한다.
      rebaseForAxisChange();
      prevKindRef.current = null;
      pendingResolveRef.current = null;
      setOffRoute(false);
      setProgress(null);
      announce(t("toBriefDone"));
      return;
    }
    const fix = lastFixRef.current;
    if (!fix) {
      pendingResolveRef.current = now;
      announce(t("resolvePending"));
      return;
    }
    const entry = entryProjection(route, fix, tuning);
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
  }, [announce, commitDetail, kindFixed, rebaseForAxisChange, t, tuning]);

  const announceProgress = useCallback(() => {
    const route = routeRef.current;
    const state = guideRef.current;
    // 낡은 fix로 직선거리를 단정하지 않는다(3-state — 신호 끊긴 뒤의 거짓 정밀 차단).
    const fixAge =
      lastFixAtRef.current !== null
        ? performance.now() / 1000 - lastFixAtRef.current
        : Infinity;
    const fix = fixAge <= PROGRESS_FIX_MAX_AGE_S ? lastFixRef.current : null;
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
    // car 병기(§4.7): 현재 링크 도로명 + 진행 + ETA 오래됨(3-state — 갱신 실패의
    // 침묵을 여기서 보상). following·bundle 공통(iOS와 통일 — 리뷰 드리프트 반영).
    const wrapCar = (base: string): string => {
      if (kindFixed !== "car") return base;
      const road = roadNameAt(roadSpansRef.current, state.d);
      const eta = etaRef.current;
      const etaAgeS = eta ? performance.now() / 1000 - eta.updatedAt : null;
      return joinText(
        road !== null && t("carRoadNow", { road }),
        base,
        etaAgeS !== null &&
          etaAgeS > CAR_ETA_STALE_S &&
          t("etaStale", { minutes: Math.round(etaAgeS / 60) }),
      );
    };
    if (state.phase === "bundle") {
      announce(
        wrapCar(
          t("progressBundle", {
            total,
            count: unitAt(route, state.stepIndex).length,
          }),
        ),
      );
      return;
    }
    const cur = route.steps[state.stepIndex];
    announce(
      wrapCar(
        progressFollowingLine(
          route,
          state.stepIndex,
          destRef.current.name,
          total,
          formatDistance(Math.max(0, (cur?.endD ?? state.d) - state.d)),
          t,
        ),
      ),
    );
  }, [announce, kindFixed, t, tBeacon]);

  const requestReroute = useCallback(() => {
    if (!trackingRef.current || rerouteInFlightRef.current) return;
    rerouteInFlightRef.current = true;
    setRerouting(true);
    genRef.current += 1;
    const gen = genRef.current;
    void (async () => {
      try {
        const fetched = await fetchGuideRoute();
        // 도착 응답 폐기: 세대 불일치·중지·언마운트(채팅 이탈 게이트 동형).
        if (gen !== genRef.current || !trackingRef.current || !mountedRef.current) return;
        if (!fetched) {
          announce(t("rerouteFailed"));
          return;
        }
        const { route } = fetched;
        routeDurationRef.current = fetched.durationSeconds;
        roadSpansRef.current = fetched.roadSpans;
        if (kindFixed === "car") {
          // 수동 재조회도 ETA 호출 캡에 포함(§4.6). 새 경로 기준으로 원자 교체.
          etaCallCountRef.current = Math.min(
            CAR_ETA_CALL_CAP,
            etaCallCountRef.current + 1,
          );
          etaRef.current =
            fetched.durationSeconds !== null
              ? { seconds: fetched.durationSeconds, updatedAt: performance.now() / 1000 }
              : null;
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
  }, [announce, commitDetail, fetchGuideRoute, kindFixed, rememberGuidance, t]);

  // 전경 전용(스펙 §9): 탭이 숨으면 중지하고 경로를 폐기한다. 복귀 후 자동 재개 없음
  // — 숨김 탭에서 멎은 watch·타이머가 좀비 상태를 만드는 것을 상태로 흡수한다.
  const stopRef = useRef(stop);
  /** 세션 스토어에 등록하는 안정 정체성 중지 함수(claim/release 짝 맞춤용). */
  const sessionStopRef = useRef(() => stopRef.current());

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

  /**
   * fix 부재 워치독. **타이머 구동**이라야 한다 — 권한 철회·위치 서비스 중단이면
   * `watchPosition` 콜백 자체가 오지 않아, 톤을 fix 처리에만 걸면 마지막 정상 톤
   * 이후 영구 침묵이 된다(그 침묵은 "안 움직이는 중"과 구분되지 않는다).
   * 세션 시작 후 첫 fix 대기도 같은 타이머가 덮는다.
   */
  useEffect(() => {
    if (status !== "tracking") return;
    const id = window.setInterval(() => {
      if (!trackingRef.current) return;
      const now = performance.now() / 1000;
      const reference = lastFixAtRef.current ?? startedAtRef.current;
      if (reference === null || now - reference < NO_FIX_S) return;
      emitTone(
        {
          unreliable: true,
          priorityTone: null,
          eventOwned: false,
          trend: null,
          arrived: false,
          rebaseTrend: false,
        },
        now,
      );
    }, WATCHDOG_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [emitTone, status]);

  // 언마운트 정리 — watch·Wake Lock·재통지 타이머.
  useEffect(() => {
    // 안정 정체성 함수의 스냅숏(ref cleanup 경고 대응 — 값은 마운트 내내 동일).
    const sessionStop = sessionStopRef.current;
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
      if (etaTimerRef.current !== null) {
        window.clearInterval(etaTimerRef.current);
        etaTimerRef.current = null;
      }
      releaseGuideSession(sessionStop);
      void wakeLock.release();
    };
  }, [wakeLock]);

  return {
    status,
    supported,
    mode,
    liveText,
    offRoute,
    progress,
    // 전환 버튼은 도보 전용(§3.3) — car의 brief 복귀는 세션 재시작뿐.
    canOfferDetail: kindFixed === "walk" && !prefersEnglish(locale) && hasRoute,
    rerouting,
    start,
    stop,
    toggleMode,
    announceProgress,
    requestReroute,
  };
}
