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
import {
  buildDisplayUnits,
  guideLiveRows,
  isCrossingStep,
  liveStepsFrom,
  type DisplayUnit,
  type LiveRowsOutput,
  type LiveRowsState,
} from "@/lib/guide-live-rows";
import { walkStepAction, type WalkAction } from "@/lib/walk-action";
import { prefersEnglish } from "@/lib/data-locale";
import { formatDistance, joinText } from "@/lib/format";
import { haversineMeters } from "@/lib/geo";
import {
  ARRIVE_M,
  FINAL_INTERVAL_S,
  relativeDirection,
  type FinalApproachGeometry,
} from "@/lib/final-approach";
import { UNCERTAIN_ACCURACY_M } from "@/lib/route-guide";
import { awaitRealFix } from "@/lib/effective-location";
import { claimGuideSession, releaseGuideSession } from "@/lib/guide-session-store";
import { isOutOfCoverageBody } from "@/lib/out-of-coverage";
import type { CarRouteBriefing, WalkRouteBriefing } from "@/lib/types";
import { walkRouteUrl } from "@/lib/walk-route-url";
import {
  SPEECH_DEFER_MAX_S,
  speechDeferStep,
} from "@/lib/guide-speech-gate";
import { useBeaconSound, type GuideSound } from "./useBeaconSound";
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
/**
 * 상세 모드 추세 축 데드밴드(m). iOS `BeaconModel.detailDeadBand` 미러.
 *
 * 간략 비콘의 `BASE_DEAD_BAND_M`(15)과 값을 나눈 이유는 축이 다르기 때문이다. 간략은
 * 직선거리라 GPS 지터가 그대로 실리지만, 상세의 잔여 거리는 구속 창 투영 + 단조 전진을
 * 거치고 `phase` 게이트·`jumped`가 이탈·튐 fix를 앞서 버린다(실보행 로그 5세션 6,047
 * 스텝에서 진행 거리 역행 0건). 즉 이 축에서 데드밴드는 지터 방어가 아니라 빈도 노브다.
 * 15(중위 17.5초)→10(11.5초)을 거쳐 위원장 실보행 판정(2026-08-12)으로 6 — 10m 간격도
 * 성기게 느껴져 "6m 간격" 직접 지정. 자동차는 주행 속도(5.4km/h 이상)에서
 * `closerIntervalSeconds` 10초가 병목이라 영향이 없고, 그 아래 정체·신호 대기에서만
 * 도보와 같은 기제로 잦아진다. 정체 중 진행 신호가 잦은 것은 해롭지 않아 수단을
 * 가르지 않는다. ⚠ 감쇠 하한(5)보다 커야 감쇠가 산다(드리프트 테스트가 강제).
 */
const DETAIL_DEAD_BAND_M = 6;
/**
 * 상세 모드 데드밴드 감쇠의 하한(m). 경로 투영은 정확도와 무관하게 몇 미터씩 흔들리므로,
 * 이보다 작은 잔여 거리 변화는 이동이 아니라 투영 지터로 본다(iOS `detailDeadBandFloor` 미러).
 */
const DETAIL_DEAD_BAND_FLOOR_M = 5;
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
/**
 * 지연 발화 예약이 이보다 늦게 깨어나면 폐기한다(초). 백그라운드 탭 throttling으로
 * setTimeout이 수 초 뒤에 깨면 이미 지난 모퉁이의 "왼쪽으로 도세요"가 된다
 * (spec 2026-08-14 §6, 리뷰 MAJOR 6 — 웹에는 iOS의 전경 가드·missedAnnouncement
 * 상환이 없고 mountedRef는 참인 채라 이 대조가 유일한 방어선이다).
 */
const DEFER_LATE_DISCARD_S = 1;
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

/** 4분할 방향 → i18n 키. 부등호 소유권은 `relativeDirection`이 갖는다(웹↔Kit 미러). */
/**
 * 이동 방향 어휘("왼쪽으로"). 맨몸 어휘(i18n `dirLeft` 등, iOS `directionWord`)와
 * 따로 두는 이유는 한국어 `으로`/`로`가 받침으로 갈리기 때문이다 — 다만 이 넷은
 * **우리 고정 어휘**라 런타임 판정 없이 i18n에 박는다(임의 고유명사인 도로명과 다른
 * 축이다). 웹에는 맨몸 매핑 상수가 없다: 실시간 방향이 나오지 않아(courseAccuracy
 * 부재) 맨몸 어휘를 쓰는 "근처" 분기에 도달하지 않기 때문이다.
 */
const DIRECTION_TO_KEY = {
  ahead: "dirAheadTo",
  left: "dirLeftTo",
  right: "dirRightTo",
  behind: "dirBehindTo",
} as const;

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
  // 서두 "다음 안내."는 여러 문장이 이어진다는 신호로 유지, 개수는 행동을 바꾸지
  // 않는 잉여라 제거(위원장 실보행 판정 2026-08-10).
  return t("bundle", { steps: descs.join(". ") });
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

/**
 * walk 주기 통지 단문(위원장 실보행 피드백 2026-08-12, iOS `GuideText.periodicWalk`
 * 미러). 직진 구간 반복은 "{target}까지 {distance} 직진하세요"만 — 다음 스텝 전문을
 * 실은 종전 틀(`nextLine`)은 한 문장에 행동 세 개(현재 이동·회전·다음 이동)가 실려
 * 과잉이었고, 조망은 40m 선행 전문 1회가 담당한다. target은 서버 live 조각(재파싱
 * 금지, 부재는 이름 생략). 마지막 스텝은 목적지 틀 유지(값이 명사라 종전에도
 * 단문이었다). car는 임박 층이 없어 주기 통지가 다음 행동의 유일한 반복 채널이라
 * `nextLine`을 유지한다.
 */
export function walkPeriodicLine(
  route: GuideRoute,
  stepIndex: number,
  destName: string,
  distance: string,
  target: string | undefined,
  t: GuideT,
): string {
  // 횡단 스텝(병합 횡단보도는 40m를 넘어 following으로 온다)에 "직진하세요"는
  // 오지시다 — 정본 문장(…건너세요)을 재낭독한다(리뷰 검출 2026-08-12).
  const cur = route.steps[stepIndex]?.description ?? "";
  if (isCrossingStep(walkStepAction(cur), cur)) return cur;
  if (!route.steps[stepIndex + 1]) {
    return t("nextDestination", { dest: destName, distance });
  }
  return target
    ? t("periodicStraight", { target, distance })
    : t("periodicStraightNoName", { distance });
}

/**
 * 진행 상황 서두(서수 + 잔여) — 조망의 뼈대(위원장 실보행 판정 2026-08-10).
 * 종전 응답은 뒷부분이 주기 통지와 문자 그대로 동일해 버튼 고유 정보가 0이었다.
 * 서수 위치("안내 12개 중 5번째")가 핵심 신규 정보이고, 잔여 시간은 근거가 있을
 * 때만 병기한다(3-state — 날조 금지).
 */
export function progressFrameLine(
  route: GuideRoute,
  stepIndex: number,
  total: string,
  etaMinutes: number | null,
  t: GuideT,
): string {
  const ordinal = t("progressOrdinal", {
    count: route.steps.length,
    n: stepIndex + 1,
  });
  const remaining = joinText(
    t("remainingDistance", { distance: total }),
    etaMinutes !== null && t("remainingTime", { minutes: etaMinutes }),
  );
  return `${ordinal}. ${remaining}`;
}

/**
 * 진행 상황 조망문(following) — 서두 + 현재 스텝 전문 + 다음 스텝 전문.
 * 현재 스텝 재확인은 실행 안내를 소음으로 놓쳤을 때의 복구 수단이다. 마지막
 * 스텝이면 다음 파트는 목적지 틀(nextDestination, distance = 구간 잔여).
 */
export function progressOverviewLine(
  route: GuideRoute,
  stepIndex: number,
  destName: string,
  total: string,
  segment: string,
  etaMinutes: number | null,
  t: GuideT,
): string {
  const frame = progressFrameLine(route, stepIndex, total, etaMinutes, t);
  const cur = route.steps[stepIndex]?.description;
  const next = route.steps[stepIndex + 1]?.description;
  const parts = [
    frame,
    cur ? t("progressCurrent", { step: cur }) : null,
    next
      ? t("progressNext", { step: next })
      : t("nextDestination", { dest: destName, distance: segment }),
  ];
  return parts.filter((p): p is string => Boolean(p)).join(". ");
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
  // ⚠ `imminent`는 제외한다. 이 값은 신호 불량 구간에서 "마지막으로 들은 안내"로
  //    되읽히는데(`progressUncertain`), 그 자리에 "잠시 후 왼쪽으로 도세요"가 남으면
  //    무엇을 향한 회전이었는지가 사라진다 — 전문이 남아 있어야 쓸모가 있다.
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
  /**
   * "현재 안내" 행 — **car 세션 전용**(walk는 liveRows가 대체, spec 2026-08-11.
   * 자동차 세션 화면은 그 spec의 비범위라 종전 행을 유지한다). walk에선 항상 null.
   */
  currentText: string | null;
  /**
   * 하단 2행(spec 2026-08-11, walk 상세 전용): 윗줄 = 현재 행동(동적 카운트다운·
   * 상태 대체·최종 접근 문형), 아랫줄 = 다음 예고("다음 안내," 라벨 포함 완성 문자열).
   * live region 밖 정적 텍스트로만 렌더한다 — 능동 통지는 기존 음성·통지 채널이
   * 담당한다(이중 낭독 금지). 빈 값은 null(요소 제거 — 빈 텍스트 낭독 금지).
   */
  liveRows: { top: string | null; next: string | null };
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
  /**
   * 계단 회피(도보 전용). ⚠ **봉인하지 않는다** — `useState` 초기값 고정은
   * *컴포넌트 마운트* 수명이라 세션 종료 후 값이 바뀌어도 같은 마운트에서는 옛
   * 값이 남는다(spec 2026-08-08 §2.2). 매 렌더 갱신되는 ref로 두고 조회 직전에
   * 읽는다. ⚠ **기본값을 두지 않는다** — A4가 생략 가능한 안전 인자에서 나왔다.
   */
  accessible: boolean,
): RouteGuideApi {
  const locale = useLocale();
  const t = useTranslations("guide");
  const tBeacon = useTranslations("beacon");
  // kind는 세션 봉인 구성의 키 — 첫 렌더 값으로 고정한다(중도 변경 미지원.
  // ref가 아니라 state 초기값 고정: 렌더 중 ref 읽기 금지 규칙과의 정합).
  const [kindFixed] = useState(kind);
  const tuning = GUIDE_TUNINGS[kindFixed];
  const { play, preload } = useBeaconSound();
  const wakeLock = useScreenWakeLock();

  const [status, setStatus] = useState<BeaconStatus>("idle");
  const [mode, setMode] = useState<GuideMode>("brief");
  const [liveText, setLiveText] = useState("");
  const [offRoute, setOffRoute] = useState(false);
  const [progress, setProgress] = useState<GuideProgress | null>(null);
  const [currentText, setCurrentText] = useState<string | null>(null);
  const [liveRows, setLiveRows] = useState<{ top: string | null; next: string | null }>({
    top: null,
    next: null,
  });
  const [hasRoute, setHasRoute] = useState(false);
  const [rerouting, setRerouting] = useState(false);

  const destRef = useRef(dest);
  /** 계단 회피 최신값(조회 시점 판독 — spec 2026-08-08 §2.2). */
  const accessibleRef = useRef(accessible);
  /**
   * 직전 계단 회피 판정(열화 전이 통지의 기준 — spec 2026-08-08 §2.3).
   * 원시 문자열이다: 알려진 셋 밖의 값도 중복 통지를 막는 식별자로 쓴다.
   */
  const lastStepFreeRef = useRef<string | null>(null);
  const modeRef = useRef<GuideMode>("brief");
  const trackingRef = useRef(false);
  const mountedRef = useRef(true);
  const watchIdRef = useRef<number | null>(null);
  const beaconRef = useRef<BeaconState>(INITIAL_BEACON_STATE);
  const guideRef = useRef<GuideState | null>(null);
  // 최종 접근(spec 2026-08-08 §3.0) — 활성 동안 거리·방향·도착 발화의 소유자는 이 층뿐이다.
  const inFinalApproachRef = useRef(false);
  const finalApproachGeoRef = useRef<FinalApproachGeometry | null>(null);
  const finalIntroSpokenRef = useRef(false);
  const lastFinalTickAtRef = useRef<number | null>(null);
  /** 톤 계층 상태(간략·상세 공용 — 모드 차이는 입력 조립에만 있다). */
  const toneStateRef = useRef<ToneLayerState>(INITIAL_TONE_LAYER_STATE);
  /** 정지 판정 상태(도플러 3-state). */
  const motionStateRef = useRef<MotionJudgeState>(INITIAL_MOTION_STATE);
  /** 세션 시작 시각(초, 단조) — 첫 fix 대기도 워치독이 덮게 하는 기준. */
  const startedAtRef = useRef<number | null>(null);
  const routeRef = useRef<GuideRoute | null>(null);
  /** 하단 2행 표시 유닛(walk 상세 전용, spec 2026-08-11 §4.1) — 경로 커밋 시 재구축. */
  const displayUnitsRef = useRef<DisplayUnit[]>([]);
  /**
   * 표시 입력 스텝(live.target 조각 포함) — walk 주기 통지의 직진 목표 이름이 여기서
   * 나온다(위원장 실보행 피드백 2026-08-12: 직진 구간 반복 통지는 다음 스텝 전문이
   * 아니라 "{target}까지 {distance} 직진하세요" 단문). 표시 유닛과 수명이 같다.
   */
  const liveStepsRef = useRef<ReturnType<typeof liveStepsFrom>>([]);
  /** 하단 2행 리듀서 소상태. 재조회·이탈 복귀·모드 전환에서 null 리셋. */
  const liveRowsStateRef = useRef<LiveRowsState | null>(null);
  /** 표시 좌표계 램프인 기준점(원시 d) — 상태 재구성 지점마다 그 시점 d로 교체. */
  const liveBaselineDRef = useRef(0);
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
   * 시작 경로 조회를 기다리는 중인가(iOS `awaitingRoute` 미러). 이 창 동안 들어오는
   * fix를 간략 리듀서에 태우면 "목적지까지 216m" 뒤에 곧바로 상세 시작 요약이 붙어
   * **이중 발화**가 된다 — 두 문장이 같은 것을 다르게 말하므로 스크린 리더에서는
   * 앞 문장이 잘리거나 서로 경합한다.
   *
   * ⚠ 이 창은 시작 조회를 정밀 재취득(`force`)으로 바꾸면서 넓어졌다. 종전에는 공유
   * 스토어가 이미 `ready`면 즉시 resolve돼 창이 사실상 없었고, 그래서 웹에만 억제가
   * 없어도 드러나지 않았다(독립 리뷰 검출).
   */
  const awaitingRouteRef = useRef(false);
  /**
   * 세대 토큰. 시작·중지·모드 전환·재조회마다 증가하고, 비동기 응답은 도착 시 자기
   * 세대를 대조해 어긋나면 폐기한다(latest-wins — 스펙 §5.6 이탈 게이트).
   */
  const genRef = useRef(0);
  const rerouteInFlightRef = useRef(false);
  const prevKindRef = useRef<AnnounceKind | null>(null);
  const liveRef = useRef("");
  /**
   * 발화 보류 단일 슬롯(재발화 우회 + 지연 발화 공유 — spec 2026-08-14 §6).
   * ⚠ 타이머 ref를 둘로 늘리지 말 것: 두 타이머가 서로의 문장을 덮는 경합이 생긴다.
   * latest-wins(§4-1)는 `announce` 진입의 clearTimeout 한 곳이 지킨다.
   */
  const reannounceTimerRef = useRef<number | null>(null);
  /** 지금 재생 중인 안내 톤이 끝나는 단조 시각(초) — `speechDeferStep` 입력. */
  const toneEndsAtRef = useRef<number | null>(null);

  const supported = typeof navigator !== "undefined" && !!navigator.geolocation;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** live region 반영(같은 문자열 재발화 우회 포함) — 지연 판정 없이 즉시 쓴다. */
  const commit = useCallback((text: string) => {
    if (!mountedRef.current) return;
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

  /**
   * 통지 창구(spec 2026-08-14 §6): 안내 톤이 재생 중이면(잔여 0.6초 이상) 그 소리가
   * 끝난 뒤에 live region에 쓴다 — 톤과 발화가 같은 청각 채널이라 겹치면 스크린
   * 리더 사용자는 문장 앞머리를 잃는다. 판정은 `speechDeferStep`(Kit 미러) 소유.
   */
  const announce = useCallback(
    (text: string) => {
      if (!mountedRef.current) return;
      // 단일 슬롯 latest-wins(§4-1): 새 통지가 보류 문장(지연·재발화 불문)을 버린다.
      // 안내는 최신이 참이다 — 늦게 말한 임박 명령은 이미 돈 모퉁이를 돌라는 명령이다.
      if (reannounceTimerRef.current !== null) {
        window.clearTimeout(reannounceTimerRef.current);
        reannounceTimerRef.current = null;
      }
      // 빈 문자열은 지우기라 지연이 무의미하다(세션 경계의 announce("")).
      const wait = text
        ? speechDeferStep(performance.now() / 1000, toneEndsAtRef.current)
        : 0;
      if (wait <= 0) {
        commit(text);
        return;
      }
      const gen = genRef.current;
      const scheduledAt = performance.now() / 1000;
      const schedule = (delay: number) => {
        const due = performance.now() / 1000 + delay;
        reannounceTimerRef.current = window.setTimeout(() => {
          reannounceTimerRef.current = null;
          if (!mountedRef.current || gen !== genRef.current) return;
          const now = performance.now() / 1000;
          // 낡은 예약 폐기(리뷰 MAJOR 6): throttled 탭에서 늦게 깬 명령은 버린다.
          if (now - due > DEFER_LATE_DISCARD_S) return;
          // 게시 직전 재평가(§4-5): 예약 후 새 톤(발화 없는 tick 등)이 시작됐으면
          // 더 기다리되, 예약 시각부터의 총 대기는 상한 안(무한 연기 구조 차단).
          const elapsed = now - scheduledAt;
          const more = speechDeferStep(now, toneEndsAtRef.current);
          if (more > 0 && elapsed < SPEECH_DEFER_MAX_S) {
            schedule(Math.min(more, SPEECH_DEFER_MAX_S - elapsed));
            return;
          }
          commit(text);
        }, delay * 1000);
      };
      schedule(wait);
    },
    [commit],
  );

  /**
   * 톤 재생 + 종료 시각 기록(발화 지연 판정 입력). 길이 0(버퍼 미준비·재생 실패)은
   * 기록하지 않는다 — 소리가 안 났는데 이전 톤 시각으로 문장이 미뤄지는 결함 차단
   * (iOS `BeaconTonePlayer.toneEndsAt`과 같은 계약).
   *
   * ⚠ **더 늦게 끝나는 쪽이 이긴다**(iOS와 정책이 다른 이유): iOS는 선점 재생이라
   * 마지막 톤이 곧 유일하게 들리는 톤이지만, 웹 Web Audio는 소스가 겹쳐 울린다 —
   * 도착 경로에서 nearby 종(2.246초) 직후 stop() 경유 stop 톤(1.332초)이 겹치는데,
   * 마지막-이김으로 두면 "도착했습니다"가 아직 울리는 종 꼬리와 다시 겹친다
   * (spec 리뷰 검출 2026-08-14 — 이 spec의 동기였던 경로 그 자체).
   */
  const playTone = useCallback(
    (sound: GuideSound, now: number) => {
      const length = play(sound);
      if (length <= 0) return;
      const endsAt = now + length;
      const current = toneEndsAtRef.current;
      toneEndsAtRef.current = current !== null && current > endsAt ? current : endsAt;
    },
    [play],
  );

  const rememberGuidance = useCallback((text: string) => {
    lastGuidanceRef.current = text;
  }, []);

  /**
   * "현재 안내" 행 표시문. 단일 스텝은 라벨 틀로 감싸고, 묶음은 통독 서두
   * ("다음 안내.")가 스스로를 설명하므로 원문 그대로 둔다 — "현재 안내, 다음
   * 안내. …"처럼 라벨이 서두와 모순되는 조합을 막는다.
   */
  const currentDisplay = useCallback(
    (text: string, isBundle: boolean): string =>
      isBundle ? text : t("progressCurrent", { step: text }),
    [t],
  );

  /** 행동구("왼쪽으로 도세요") — 디스크립터 렌더의 공통 조각. */
  const actionPhrase = useCallback((a: WalkAction): string => t(`liveAction.${a}`), [t]);

  /**
   * 하단 2행 디스크립터 → 문자열(spec §4.2·§4.3·§6). fixture 러너
   * (guide-live-rows.test.ts)와 같은 매핑 규칙 — 여기가 갈리면 fixture가 못 잡으므로
   * 규칙 변경은 반드시 러너와 함께 간다.
   */
  const renderLiveRows = useCallback(
    (out: LiveRowsOutput): { top: string | null; next: string | null } => {
      const top = out.top;
      const topText =
        top === null
          ? null
          : top.kind === "offRoute"
            ? t("offRoute")
            : top.kind === "uncertain"
              ? t("uncertain")
              : top.kind === "reacquiring"
                ? t("reacquiring")
                : top.kind === "crossing"
                  ? top.text
                  : top.kind === "turnSoon"
                    ? t(`imminent.${top.action}`)
                    : top.kind === "turnIn"
                      ? t("liveTurnIn", { n: top.meters, action: actionPhrase(top.action) })
                      : top.target
                        ? t("liveStraight", { target: top.target, n: top.meters })
                        : t("liveStraightNoName", { n: top.meters });
      const nx = out.next;
      const step =
        nx === null
          ? null
          : nx.kind === "action"
            ? nx.anchor
              ? t("nextAction", { anchor: nx.anchor, action: actionPhrase(nx.action) })
              : actionPhrase(nx.action)
            : nx.kind === "straight"
              ? nx.target
                ? t("nextStraight", { target: nx.target, n: nx.meters })
                : t("nextStraightNoName", { n: nx.meters })
              : actionPhrase(nx.action); // crossing·turn
      return { top: topText, next: step ? t("progressNext", { step }) : null };
    },
    [actionPhrase, t],
  );

  /** 값이 같으면 이전 객체를 돌려 재렌더를 막는다(매 fix 호출 — 객체 identity 베일아웃). */
  const setLiveRowsIfChanged = useCallback(
    (rows: { top: string | null; next: string | null }) => {
      setLiveRows((prev) => (prev.top === rows.top && prev.next === rows.next ? prev : rows));
    },
    [],
  );

  /**
   * 하단 2행 갱신(walk 상세 전용). 매 fix·커밋 지점에서 부른다 — 상태 국면
   * (uncertain·offRoute 포함)도 리듀서가 행을 소유하므로 국면 가드가 없다.
   */
  const refreshLiveRows = useCallback(
    (state: GuideState) => {
      if (kindFixed !== "walk") return;
      const out = guideLiveRows(
        liveRowsStateRef.current,
        displayUnitsRef.current,
        state.d,
        liveBaselineDRef.current,
        state.phase,
      );
      liveRowsStateRef.current = out.state;
      setLiveRowsIfChanged(renderLiveRows(out));
    },
    [kindFixed, renderLiveRows, setLiveRowsIfChanged],
  );

  /**
   * 열화 전이 판정(spec 2026-08-08 §2.3). 상태가 열화이고 **직전과 다를 때만**
   * 문장을 돌려준다. 직전 상태를 갱신하는 부작용이 있으므로 **조회 성공 경로에서
   * 정확히 1회** 부른다. 기하 빌드까지 성공한 뒤에 불러야 한다 — "조회 성공"의
   * 시점이 HTTP·디코딩·기하 셋으로 갈리는데 가장 늦은 것이 정본이다.
   *
   * ⚠ **신호는 상태 분류가 아니라 "서버가 문장을 실었는가"다**(a11y 리뷰 H2).
   * 서버는 열화일 때만 `stepFreeNotice`를 채우므로 문장의 존재 자체가 경고를
   * 뜻한다. 알려진 상태 셋으로 분류가 되는지로 가르면, 서버가 넷째 상태를
   * 추가하는 순간 문장이 와 있는데도 침묵한다 — 모르는 상태일수록 보수적으로
   * 말해야 한다. `status`를 원시 문자열로 받는 것도 같은 이유다(중복 판정을
   * 막는 식별자로만 쓰고 값의 의미를 해석하지 않는다).
   */
  const consumeStepFreeNotice = useCallback(
    (status: string | null, notice: string | null): string | null => {
      const prev = lastStepFreeRef.current;
      // 정상(applied)·미요청은 침묵하되 기준은 갱신한다 — 이후 열화가 오면 전이다.
      const benign = status === null || status === "applied";
      // ⚠ 열화인데 문장이 비어 오면(서버 계약 위반) 기준을 갱신하지 않는다.
      //    갱신하면 문장이 정상화된 뒤에도 전이가 사라져 영영 침묵한다(리뷰 L5).
      if (benign || notice) lastStepFreeRef.current = status;
      if (benign || !notice || status === prev) return null;
      return notice;
    },
    [],
  );

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
      if (out.tone) playTone(out.tone, now);
    },
    [playTone],
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
        // 웹에는 speedAccuracy 축이 **없다**(값이 무효인 것과 다른 상태다). undefined가
        // 그 구분을 나르고, 판정 함수가 speed 유효성만으로 도플러를 채택한다.
        undefined,
        maxSpeedMps,
      );
      motionStateRef.current = out.state;
      return out.motion;
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
  }, []);

  /** 이벤트 → 통지문. 사용자에게 말할 것이 없는 이벤트는 빈 문자열. */
  const eventText = useCallback(
    (event: GuideEvent, route: GuideRoute): string => {
      switch (event.kind) {
        case "announceSteps":
        case "bundleReread":
          return unitText(route, event.indices, t);
        case "imminent":
          // 임박 큐(20m, §6a): 전문이 아니라 짧은 명령형이다. 전문은 40m에서 이미
          // 나갔고, 여기서 다시 읽으면 8초 안에 두 문장이 겹쳐 정작 행동 시점을 놓친다.
          return t(`imminent.${event.action}`);
        case "farNotice":
          // 원거리 예고(§4.7): 크로싱 시점의 **실측 잔여**(리듀서가 기하에서 계산해
          // 실어 줌 — 상수 낭독 금지, 독립 리뷰 반영) + 원문을 독립 문장으로 결합.
          return t("farNotice", {
            distance: formatDistance(event.remainingMeters),
            step: unitText(route, event.indices, t),
          });
        case "periodic": {
          const distance = confidenceDistance(event.remainingMeters, event.accuracy, t);
          // walk는 단문, car는 종전 틀 — 근거는 walkPeriodicLine 주석.
          return kindFixed === "walk"
            ? walkPeriodicLine(
                route,
                event.stepIndex,
                destRef.current.name,
                distance,
                liveStepsRef.current[event.stepIndex]?.live?.target,
                t,
              )
            : nextLine(route, event.stepIndex, destRef.current.name, distance, t);
        }
        case "finalApproachEnter":
          // 이 이벤트의 문장은 `stepFinalApproach`가 소유한다 — 진입 서술은 fix 기준
          // 거리·방향을 쓰는데 이 함수는 fix를 받지 않는다. 빈 문자열은 무발화다.
          return "";
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
      if (kindFixed === "walk") {
        // 하단 2행: 커밋은 상태 재구성 지점이다 — 램프인 기준점·클램프를 새 기준으로
        // 리셋하고 즉시 1회 계산한다(spec §3 F7·§4.2 리셋 계약).
        liveBaselineDRef.current = state.d;
        liveRowsStateRef.current = null;
        refreshLiveRows(state);
        setCurrentText(null); // walk의 "현재 안내" 행은 liveRows가 대체(spec 2026-08-11)
      } else {
        // car 화면은 spec 비범위 — 종전 "현재 안내" 행 유지.
        const indices = unitAt(route, state.stepIndex);
        setCurrentText(currentDisplay(unitText(route, indices, t), indices.length > 1));
      }
      // 거리 축이 직선 → 경로로 바뀐다(전환·재획득·재조회 공통). 다음 추세 fix가
      // 새 축 현재값으로 앵커를 다시 잡고 현재 상태를 1회 알린다.
      toneStateRef.current = { ...toneStateRef.current, needsRebase: true };
    },
    [currentDisplay, kindFixed, progressOf, refreshLiveRows, t],
  );

  /**
   * 현재 위치에서 목적지까지 상세 경로 기하를 조립한다(시작 시 재조회 — 길찾기
   * 뷰가 쥔 낡은 출발점 기하 재사용 금지, §5). 실패는 전부 null(fail-closed).
   * car는 provider 판별자·기하 검증(buildCarGuide)을 통과해야 상세 적격이다.
   *
   * ⚠ **`force`에 기본값을 두지 않는다.** 공유 위치 스토어는 TTL이 없어 한 번
   * `ready`가 되면 force 없이는 영영 갱신되지 않는다 — 그래서 생략이 곧 "세션 최초
   * 좌표로 조회"가 되고, 재조회 경로에서는 **기능의 존재 이유 자체가 무효화**된다
   * (이탈해서 누른 재조회가 출발점에서 같은 경로를 다시 받아 온다). 실기기 실사용에서
   * 발견됐고 어떤 오류도 내지 않는다. 인자를 필수로 두면 새 호출 지점이 이 판단을
   * 건너뛸 수 없다([[no-default-for-safety-parameters]]).
   */
  const fetchGuideRoute = useCallback(async (force: boolean): Promise<{
    route: GuideRoute;
    durationSeconds: number | null;
    roadSpans: CarRoadSpan[];
    /**
     * 계단 회피 판정(도보 전용, 미요청·자동차면 null). ⚠ 타입은 `StepFreeStatus`가
     * 아니라 `string`이다 — 서버 응답은 런타임 검증을 거치지 않으므로 알려진 셋
     * 밖의 값이 그대로 흘러온다. 이 값은 중복 통지를 막는 식별자로만 쓴다.
     */
    stepFree: string | null;
    /** 열화 상태의 안내 문장(서버 정본). 기하 응답엔 유사 스텝이 없어 유일한 채널. */
    stepFreeNotice: string | null;
    /** 경로 종점 → 목적지 오프셋 기하(§3.1). 구버전 서버·기하 실패면 null. */
    finalApproach: FinalApproachGeometry | null;
    /** 하단 2행 표시 입력(walk 전용 — 스팬 + 서버 live 조각, spec 2026-08-11). car는 []. */
    liveSteps: ReturnType<typeof liveStepsFrom>;
  } | null> => {
    // fail-closed: 실좌표가 없으면 안내를 시작하지 않는다. 수동 위치로 만든
    // 기존 경로 기하를 재사용하면 첫 실제 fix에서 즉시 이탈 판정이 난다.
    const fix = await awaitRealFix({ force });
    if (!fix) return null;
    const target = destRef.current;
    try {
      if (kindFixed === "car") {
        const res = await fetch(
          `/api/route/car?origin=${fix.lat},${fix.lng}` +
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
          // 자동차에는 계단 회피·최종 접근 개념이 없다(실주행은 딥링크 위임이 정본).
          stepFree: null,
          stepFreeNotice: null,
          finalApproach: null,
          liveSteps: [],
        };
      }
      const res = await fetch(
        walkRouteUrl({
          origin: { lat: fix.lat, lng: fix.lng },
          dest: { lat: target.lat, lng: target.lng },
          accessible: accessibleRef.current,
          includeGeometry: true,
          // 웹 실시간 안내는 경유지를 아직 받지 않는다(N4 spec §3 — 경유지 조회에선
          // 안내 시작 버튼 자체가 없다). 경유지 안내는 iOS 실보행 판정 뒤 웹에 얹는다.
          via: null,
        }),
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
        stepFree: result.stepFree ?? null,
        stepFreeNotice: result.stepFreeNotice ?? null,
        finalApproach: result.finalApproach ?? null,
        liveSteps: liveStepsFrom(route, result.steps),
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
      // ETA는 "현 위치 → 목적지" 재조회값이라 좌표가 낡으면 카운트다운이 멎는다
      // (10분 주기 6회가 전부 같은 출발점을 조회하게 된다). fail-closed: 실좌표를
      // 못 얻으면 이번 주기는 건너뛰고 직전 값을 유지한다(수동 위치로 재조회하지 않음).
      const fix = await awaitRealFix({ force: true });
      if (!fix) return;
      const target = destRef.current;
      const res = await fetch(
        `/api/route/car?origin=${fix.lat},${fix.lng}` +
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

  /** 세션의 최종 접근 상태를 새 경로 기준으로 되돌린다(시작·재조회·중지 공용). */
  const resetFinalApproach = useCallback((geometry: FinalApproachGeometry | null) => {
    inFinalApproachRef.current = false;
    finalApproachGeoRef.current = geometry;
    finalIntroSpokenRef.current = false;
    lastFinalTickAtRef.current = null;
  }, []);

  /** 기하는 두고 소유권만 놓는다(수동 모드 전환 — §4). */
  const releaseFinalApproach = useCallback(() => {
    inFinalApproachRef.current = false;
    finalIntroSpokenRef.current = false;
    lastFinalTickAtRef.current = null;
  }, []);

  /**
   * 최종 접근 거리 사다리(§3.6). ⚠ **정확도가 좋아도 헤지를 빼지 않는다** — 보고 정확도
   * 5.4m에 실오차 36.5m인 실측이 있다(일반 안내 `confidenceDistance`와 갈리는 지점).
   * 임계 비교는 반올림 전 원거리로 한다.
   */
  const approachDistance = useCallback(
    (meters: number, accuracy: number): string => {
      const base = formatDistance(Math.round(meters));
      return accuracy <= 20
        ? t("approx", { distance: base })
        : t("rough", { distance: base });
    },
    [t],
  );

  /**
   * 주기 통지 한 문장. 방향을 모르면 거리만 남긴다(빈 문자열 보간 금지 —
   * "…, , 16미터"처럼 구분자가 겹친다).
   *
   * ⚠ 15초마다 반복되는 통지인데도 완성 문장인 것은 **일관성 우선 판정**이다
   * (위원장 2026-08-09). 실보행에서 길게 느껴지면 이 한 줄만 되돌린다.
   */
  const approachDetail = useCallback(
    (distance: string, direction: string | null): string =>
      direction
        ? t("finalApproachTick", { direction, distance })
        : t("finalApproachTickNoDir", { distance }),
    [t],
  );

  /**
   * 주기 통지 문장. ⚠ **진입 서술은 이 함수를 쓰지 않는다** — §3.6 사다리의
   * "≤15m 수치 생략" 행은 **fix에서 온 거리의 잡음**을 전제하는데, 진입 서술이 말하는
   * `offsetMeters`는 폴리라인에서 정적으로 계산된 값이라 그 전제가 성립하지 않는다
   * (iOS `GuideText.finalApproachEnter`/`finalApproachTick` 분리와 동형 — 종전에는
   * 웹만 한 함수를 공유해 오프셋 10~15m 진입 서술에서 거리를 통째로 빼먹었다).
   */
  const approachTick = useCallback(
    (meters: number, accuracy: number, direction: string | null): string => {
      if (meters <= ARRIVE_M) {
        return direction
          ? t("finalApproachNearDir", { direction })
          : t("finalApproachNear");
      }
      return approachDetail(approachDistance(meters, accuracy), direction);
    },
    [approachDetail, approachDistance, t],
  );

  /**
   * 최종 접근 fix 처리(§3.4). 거리는 항상 **현재 fix → 목적지 직선거리**다 —
   * `offsetMeters`는 진입 서술에서만 쓰고 재사용하지 않는다.
   *
   * ⚠ **시간 상한을 두지 않는다.** 종료 조건은 거리(도착)와 사용자의 중지뿐이다.
   * ⚠ 주기 통지에는 방향이 없다: `GeolocationCoordinates`에 `heading`은 있으나 정확도
   * 필드가 없어 품질 게이트(`courseStep`)를 통과할 수 없다(§3.5 검토 #32). 이것은
   * 플랫폼 사실이며, **진입 서술의 방향은 서버가 준 정적 기하라 웹에서도 나온다.**
   */
  const stepFinalApproach = useCallback(
    (fix: GuideFix, motion: MotionState, now: number) => {
      // ⚠ **신뢰 불가 fix에서는 거리·방향을 말하지 않는다**(§3.0 unreliable 최우선
      //   불변식). 이 경로는 리듀서를 타지 않으므로(§3.0 소유권) 리듀서의 uncertain
      //   게이트가 여기엔 없다 — 그 대가로 정확도 판정을 이 층이 직접 져야 한다.
      //   없으면 튄 fix가 도착 반경을 만족해 "도착했습니다"로 세션을 끝낼 수 있다.
      //   주기 시각도 갱신하지 않는다: 정지·유지이지 리셋이 아니다(§4).
      if (!(fix.accuracy > 0) || fix.accuracy > UNCERTAIN_ACCURACY_M) {
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
        return;
      }
      const distance = haversineMeters(
        fix.lat,
        fix.lng,
        destRef.current.lat,
        destRef.current.lng,
      );
      const arrived = distance <= ARRIVE_M;
      emitTone(
        {
          unreliable: false,
          priorityTone: null,
          eventOwned: false,
          trend: {
            distance,
            deadBand: Math.max(BASE_DEAD_BAND_M, fix.accuracy),
            deadBandFloor: fix.accuracy,
            motion,
            closerIntervalSeconds,
          },
          arrived,
          rebaseTrend: false,
        },
        now,
      );

      // ⚠ **진입 배치 서술이 도착보다 앞이다.** 뒤에 두면 오프셋 10~15m 구간에서
      //   진입 fix가 이미 도착 반경 안이라 배치 서술이 한 번도 나가지 않은 채 세션이
      //   끝난다 — 방향을 못 들은 채 "도착했습니다"만 듣는 것이 이번 작업이 고치려던
      //   증상 그 자체다(독립 리뷰 검출). 도착은 다음 fix(약 1초 뒤)가 낸다.
      const geometry = finalApproachGeoRef.current;
      if (!finalIntroSpokenRef.current && geometry) {
        finalIntroSpokenRef.current = true;
        lastFinalTickAtRef.current = now;
        const bearing = geometry.relativeBearing;
        // 진입 서술은 항상 수치를 낸다(§3.3) — `approachTick`의 "근처" 축약을 타지 않는다.
        const distance = approachDistance(geometry.offsetMeters, fix.accuracy);
        // 방향을 알면 "왼쪽으로 … 가면 {목적지}입니다", 모르면 "{목적지}까지 …입니다".
        // 목적지가 문장 끝에서 `입니다`/`까지`에 붙으므로 임의 고유명사여도 조사가
        // 걸리지 않는다 — 이 어순을 고른 이유다(spec §2).
        const approach =
          bearing !== undefined
            ? t("finalApproachToDest", {
                direction: t(DIRECTION_TO_KEY[relativeDirection(bearing)]),
                distance,
                dest: destRef.current.name,
              })
            : t("finalApproachToDestNoDir", {
                dest: destRef.current.name,
                distance,
              });
        const text = `${t("finalApproachRouteEnd")} ${approach}`;
        rememberGuidance(text);
        // 하단 2행 윗줄 = 기존 최종 접근 문형(§4.2 우선순위 2 — 이 층이 행을 소유).
        setLiveRowsIfChanged({ top: text, next: null });
        announce(text);
        return;
      }

      if (arrived) {
        const text = t("arrived");
        rememberGuidance(text);
        // ⚠ `stopRef`가 아니라 `sessionStopRef`를 쓴다. `stopRef`는 매 렌더 대입되는데,
        // 훅 인자로 캡처된 값을 나중에 수정하는 것을 React Compiler가 막는다
        // (react-hooks/immutability). `sessionStopRef`는 생성 후 읽기만 한다.
        sessionStopRef.current();
        announce(text);
        return;
      }

      const last = lastFinalTickAtRef.current;
      if (last === null) {
        lastFinalTickAtRef.current = now;
        return;
      }
      if (now - last < FINAL_INTERVAL_S) return;
      lastFinalTickAtRef.current = now;
      const text = approachTick(distance, fix.accuracy, null);
      rememberGuidance(text);
      setLiveRowsIfChanged({ top: text, next: null });
      announce(text);
    },
    [
      announce,
      // `approachDetail`은 이제 `approachTick` 안에서만 쓰인다 — 진입 서술이 문구를
      // 직접 조립하도록 바뀌면서 이 콜백의 직접 의존에서 빠졌다.
      approachDistance,
      approachTick,
      closerIntervalSeconds,
      emitTone,
      rememberGuidance,
      setLiveRowsIfChanged,
      t,
    ],
  );

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
                // 감쇠 하한은 그 fix의 정확도다 — 정확도보다 작은 변화는 아무리
                // 오래 기다려도 추세가 아니라 지터다.
                deadBandFloor: fix.accuracy,
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
      // 방위 축은 위치 이력 유도라 웹에서도 켜진다(spec §4 재설계) — 관측은 리듀서
      // 내부 유도기가 fix 이력에서 만들고 플랫폼은 주입할 수 없다. 단 iOS 로그로만
      // 검증됐으므로 웹 실보행 검증은 spec §7 3단계 관측 항목이다.
      const result = guideStep(state, fix, route, now, tuning);
      guideRef.current = result.state;
      setOffRoute(result.state.phase === "offRoute");
      setProgress(progressOf(route, result.state));
      if (kindFixed === "walk") {
        // 하단 2행(spec 2026-08-11): 이탈 복귀·재획득은 리듀서가 d를 재구성한
        // 지점이다 — 투영이 새 기준에 정렬됐으므로 램프인 기준점·클램프를 리셋한다.
        if (result.event?.kind === "backOnRoute" || result.event?.kind === "reacquired") {
          liveBaselineDRef.current = result.state.d;
          liveRowsStateRef.current = null;
        }
        // 매 fix 갱신 — 상태 국면(uncertain·offRoute)도 리듀서가 행을 소유한다.
        refreshLiveRows(result.state);
      } else if (result.state.phase === "following" || result.state.phase === "bundle") {
        // car 화면은 spec 비범위 — 종전 "현재 안내" 행(현재 구간 직접 유도) 유지.
        const indices = unitAt(route, result.state.stepIndex);
        setCurrentText(
          currentDisplay(unitText(route, indices, t), indices.length > 1),
        );
      }

      // 톤 계층 입력 조립(상세 4단계). ⚠ 종전의 "무이벤트 fix마다 3초 tick 하트비트"는
      // 폐기됐다 — 같은 소리가 간략에서는 정체를 뜻해 한 소리에 두 뜻이 있었다.
      // 그 자리를 추세 축이 대신하므로 별도 중재가 필요 없다.
      const phase = result.state.phase;
      const remaining = Math.max(0, route.totalMeters - result.state.d);
      // 투영 점프 판정은 리듀서 소유다(A10 — `GuideTuning.maxSpeedMps` 주석). 튄 fix의
      // 진입 확정은 리듀서가 6b에서 이미 한 fix 미뤘으므로 여기서 사후 거부하지 않는다 —
      // 종전의 커밋 후 거부는 phase만 finalApproach로 잠긴 세션 영구 정지를 만들었다.
      const jumped = result.projectionJumped === true;
      // 최종 접근 진입은 **톤 조립 앞에서** 갈라진다. 이 fix의 소유권이 통째로 넘어가므로
      // 상세 톤 입력을 조립하면 안 된다 — `emitTone`은 톤 상태를 전진시켜서 한 fix에
      // 두 번 부르면 전이가 두 번 일어난다.
      if (result.event?.kind === "finalApproachEnter") {
        setProgress(null);
        // 스텝은 전부 소화됐다 — 낡은 유닛이 "현재 안내" 행에 남는 것을 막는다
        // (iOS beginFinalApproach 미러, 리뷰 HIGH 반영).
        setCurrentText(null);
        // 하단 2행: 윗줄 소유권이 최종 접근 층으로 넘어간다(§4.2 우선순위 2).
        // 아랫줄은 비운다 — 스텝 예고는 전부 소화됐다.
        liveRowsStateRef.current = null;
        setLiveRowsIfChanged({ top: null, next: null });
        clearEtaTimer(); // 최종 접근 중 ETA 재조회는 무의미(자원 위생)
        rebaseForAxisChange(); // 경로 거리 → 직선거리
        // ⚠ 오프셋이 하한 미만이면(`tooClose`) 종점 도달이 곧 목적지 도착이라
        //   최종 접근을 건너뛴다(§3.2). 말할 배치가 없는데 진입 서술을 내면
        //   "약 8미터" 다음에 곧바로 도착이 붙어 잉여다.
        if (
          finalApproachGeoRef.current === null ||
          finalApproachGeoRef.current.bearingUnavailable === "tooClose"
        ) {
          // 기하가 없으면(구버전 응답) 말할 배치 정보가 없다. 종전 인계 그대로
          // 간략(비콘)으로 넘겨 거리 추적만 남긴다 — 침묵보다 낫다.
          modeRef.current = "brief";
          setMode("brief");
          prevKindRef.current = null;
          setOffRoute(false);
          announce(t("handoff"));
          return;
        }
        inFinalApproachRef.current = true;
        finalIntroSpokenRef.current = false;
        lastFinalTickAtRef.current = null;
        // 진입이 소유권을 넘겼으면 **같은 fix로** 첫 발화를 낸다. 다음 fix를 기다리면
        // 종점에 선 채 수 초 침묵하고, 그 침묵이 이번에 고치려는 증상이다.
        stepFinalApproach(fix, motion, now);
        return;
      }
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
                deadBand: DETAIL_DEAD_BAND_M,
                deadBandFloor: DETAIL_DEAD_BAND_FLOOR_M,
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
      if (!text) return;
      announce(text);
      if (isGuidanceEvent(result.event.kind)) rememberGuidance(text);
      // ⚠ 실행 안내 이벤트로 "현재 안내" 행을 갱신하지 않는다(실보행 라운드1 정정) —
      //   이 이벤트는 경계 40m 전 선행 + 1회 래치라 "지금 구간"과 어긋난다. 행은
      //   위의 상태 유도 세팅이 소유한다.
    },
    [
      announce,
      clearEtaTimer,
      closerIntervalSeconds,
      currentDisplay,
      emitTone,
      eventText,
      kindFixed,
      refreshLiveRows,
      setLiveRowsIfChanged,
      stepFinalApproach,
      t,
      progressOf,
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
        commitDetail(
          route,
          guideStateAt(route, entry.d, now, {
            autoHandoffArmed: false,
            // 같은 세션의 모드 전환 — 유도기 버퍼를 잇는다(spec §2.9).
            courseDerivation: guideRef.current?.courseDerivation,
          }),
        );
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
      // 최종 접근은 모드보다 앞이다 — 이 국면의 발화 소유자는 이 층 하나뿐이라
      // 경로 리듀서도 비콘 리듀서도 이 fix를 보지 않는다(§3.0 소유권 계약).
      if (inFinalApproachRef.current) {
        stepFinalApproach(fix, motion, now);
        return;
      }
      const route = routeRef.current;
      const state = guideRef.current;
      if (modeRef.current === "detail" && route && state) {
        stepDetail(fix, route, state, motion, now);
        return;
      }
      // 시작 경로 조회 대기 중에는 간략 리듀서에 태우지 않는다(iOS 동형): 곧 나올
      // 상세 시작 요약과 이중 발화가 된다. `judgeMotion`은 위에서 이미 지났으므로
      // 도플러 표본은 끊기지 않고, 비콘 앵커는 상세 확정 시 어차피 재기준화된다.
      // 조회가 실패하면 이 플래그가 풀리며 다음 fix부터 간략 안내가 정상 동작한다.
      if (awaitingRouteRef.current) return;
      stepBrief(fix, motion, now);
    },
    [judgeMotion, resolvePending, stepBrief, stepDetail, stepFinalApproach],
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
    startedAtRef.current = null;
    guideRef.current = null;
    resetFinalApproach(null);
    routeRef.current = null;
    routeDurationRef.current = null;
    roadSpansRef.current = [];
    etaRef.current = null;
    etaCallCountRef.current = 0;
    lastFixRef.current = null;
    lastFixAtRef.current = null;
    lastGuidanceRef.current = null;
    pendingResolveRef.current = null;
    awaitingRouteRef.current = false;
    displayUnitsRef.current = [];
    liveStepsRef.current = [];
    liveRowsStateRef.current = null;
    liveBaselineDRef.current = 0;
    if (mountedRef.current) {
      setStatus("idle");
      setMode("brief");
      modeRef.current = "brief";
      setHasRoute(false);
      setOffRoute(false);
      setProgress(null);
      setCurrentText(null);
      setLiveRows({ top: null, next: null });
      setRerouting(false);
      announce("");
    }
    playTone("stop", performance.now() / 1000);
  }, [announce, clearEtaTimer, clearWatch, playTone, resetFinalApproach, wakeLock]);

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
    lastStepFreeRef.current = null;
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
    playTone("start", performance.now() / 1000);
    // 긴 톤 3종 사전 디코드(spec 2026-08-14 §6): 웹은 첫 재생이 fetch 왕복이라
    // 길이를 몰라, 프리로드 없이는 각 톤의 첫 발생에서 겹침 결함이 그대로 남는다.
    preload(["ahead", "warning", "nearby"]);
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
    // 조회를 기다리는 동안 간략 발화를 보류한다(위 `awaitingRouteRef`).
    awaitingRouteRef.current = true;
    void (async () => {
      // 시작 조회는 정밀 재취득이다(§5) — 길찾기 조회 이후 이동해 있으면 낡은
      // 출발점 기하로 즉시 이탈·오투영이 난다.
      const fetched = await fetchGuideRoute(true);
      // ⚠ 세대가 어긋나면 **플래그를 건드리지 않고** 빠진다 — 이미 다음 세션의 것이다.
      if (gen !== genRef.current || !trackingRef.current || !mountedRef.current) return;
      // 이 세션이 맞다 — 성공·실패 어느 쪽이든 여기서 보류를 끝낸다(무한 억제 차단).
      awaitingRouteRef.current = false;
      if (!fetched) {
        // 경로가 없으면 경로 기반 계단 판정도 없다(3-state). 복구된 상세가 열화면
        // 그때 다시 통지된다 — 새 경로에 대한 새 판정이므로 반복이 아니다.
        lastStepFreeRef.current = null;
        // 조용한 강등 금지 — 시작 통지가 어느 모드인지 말한다(스펙 §4.1·§4.5).
        announce(t("detailUnavailable"));
        return;
      }
      const { route } = fetched;
      routeDurationRef.current = fetched.durationSeconds;
      roadSpansRef.current = fetched.roadSpans;
      // 하단 2행 표시 유닛은 경로와 수명이 같다 — commitDetail(refreshLiveRows)보다 앞.
      displayUnitsRef.current =
        fetched.liveSteps.length > 0 ? buildDisplayUnits(fetched.liveSteps) : [];
      liveStepsRef.current = fetched.liveSteps;
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
      resetFinalApproach(fetched.finalApproach);
      const init = initialGuideState(route, now, {
        hasFinalApproachGeometry: fetched.finalApproach !== null,
      });
      commitDetail(route, init.state);
      setHasRoute(true);
      const first = unitText(route, init.firstIndices, t);
      rememberGuidance(first);
      const notice = consumeStepFreeNotice(fetched.stepFree, fetched.stepFreeNotice);
      // 요약과 첫 안내는 한 문장으로 — 두 통지가 경합하면 앞의 것이 잘린다(스펙 §5.3).
      const summary = t(kindFixed === "car" ? "carStart" : "detailStart", {
        count: route.steps.length,
        distance: formatDistance(route.totalMeters),
        first,
      });
      // 계단 회피 안내 문장이 앞이다 — 세션 전체에 걸린 조건이라 걷기 전에 들어야 한다.
      announce(notice ? `${notice} ${summary}` : summary);
    })();
  }, [
    announce,
    clearEtaTimer,
    commitDetail,
    consumeStepFreeNotice,
    kindFixed,
    fetchGuideRoute,
    locale,
    playTone,
    preload,
    refreshCarEta,
    rememberGuidance,
    resetFinalApproach,
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
      // 사용자가 직선 안내를 명시 선택했다 — 최종 접근이 쥔 발화 소유권을 놓는다
      // (§4 "수동 detail → brief"). 기하는 세션 것이라 유지한다.
      releaseFinalApproach();
      // 경로 거리 → 직선거리(handoff와 같은 규칙). 방향만 승계하고 두 기준을 새 축
      // 현재값으로 재설정한다.
      rebaseForAxisChange();
      prevKindRef.current = null;
      pendingResolveRef.current = null;
      setOffRoute(false);
      setProgress(null);
      // 하단 2행은 상세 전용 — 간략 복귀 시 비운다(유닛은 세션 것이라 유지).
      liveRowsStateRef.current = null;
      setLiveRows({ top: null, next: null });
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
      // 경로 스텝 안내 중간에 "약 20미터"가 끼어드는 것을 막는다(§4 "수동 brief → detail").
      releaseFinalApproach();
      commitDetail(
        route,
        guideStateAt(route, entry.d, now, {
          autoHandoffArmed: false,
          hasFinalApproachGeometry: finalApproachGeoRef.current !== null,
          // 같은 세션의 모드 전환 — 유도기 버퍼를 잇는다(spec §2.9).
          courseDerivation: guideRef.current?.courseDerivation,
        }),
      );
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
  }, [announce, commitDetail, kindFixed, rebaseForAxisChange, releaseFinalApproach, t, tuning]);

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
    if (state.phase === "finalApproach") {
      // 경로 잔여는 이 국면에서 의미가 없다(이미 종점을 지났고 state가 동결된다).
      // 정직한 값은 목적지 직선거리뿐이고, 없으면 마지막 안내를 되돌린다
      // (iOS GuideText.progress .finalApproach 미러, 리뷰 HIGH 반영 — 종전에는
      // 이 국면이 following으로 흘러 동결 시점 기준 "{dest}까지 0m"류가 나갔다).
      announce(
        straight
          ? t("progressFinalApproach", { distance: straight })
          : t("progressUncertain", {
              last: lastGuidanceRef.current ?? t("noGuidanceYet"),
            }),
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
    // 잔여 시간은 상시 표시 행과 같은 산식(progressOf)을 재사용한다(사본 금지).
    const etaSeconds = progressOf(route, state).etaSeconds;
    const etaMinutes =
      etaSeconds !== null ? Math.max(1, Math.round(etaSeconds / 60)) : null;
    if (state.phase === "bundle") {
      // 묶음 국면은 통독 자체가 "다음 안내." 서두를 가지므로 다음 파트가 따로 없다.
      announce(
        wrapCar(
          `${progressFrameLine(route, state.stepIndex, total, etaMinutes, t)}. ${unitText(
            route,
            unitAt(route, state.stepIndex),
            t,
          )}`,
        ),
      );
      return;
    }
    const cur = route.steps[state.stepIndex];
    announce(
      wrapCar(
        progressOverviewLine(
          route,
          state.stepIndex,
          destRef.current.name,
          total,
          formatDistance(Math.max(0, (cur?.endD ?? state.d) - state.d)),
          etaMinutes,
          t,
        ),
      ),
    );
  }, [announce, kindFixed, progressOf, t, tBeacon]);

  const requestReroute = useCallback(() => {
    if (!trackingRef.current || rerouteInFlightRef.current) return;
    rerouteInFlightRef.current = true;
    setRerouting(true);
    genRef.current += 1;
    const gen = genRef.current;
    void (async () => {
      try {
        // 재조회의 출발지는 **지금 서 있는 자리**여야 한다 — 캐시를 읽으면 이탈해서
        // 누른 재조회가 출발점에서 같은 경로를 다시 받아 온다(실사용 발견).
        const fetched = await fetchGuideRoute(true);
        // 도착 응답 폐기: 세대 불일치·중지·언마운트(채팅 이탈 게이트 동형).
        if (gen !== genRef.current || !trackingRef.current || !mountedRef.current) return;
        if (!fetched) {
          // 경로가 없으면 경로 기반 계단 판정도 없다(3-state) — 시작 폴백과 동형.
          lastStepFreeRef.current = null;
          announce(t("rerouteFailed"));
          return;
        }
        const { route } = fetched;
        routeDurationRef.current = fetched.durationSeconds;
        roadSpansRef.current = fetched.roadSpans;
        // 새 경로 = 새 표시 유닛(commitDetail의 rows 리셋·재계산보다 앞).
        displayUnitsRef.current =
          fetched.liveSteps.length > 0 ? buildDisplayUnits(fetched.liveSteps) : [];
        liveStepsRef.current = fetched.liveSteps;
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
        // 새 경로는 새 종점·새 오프셋이다 — 래치·타이머·서술 래치를 전부 초기화한다.
        resetFinalApproach(fetched.finalApproach);
        const init = initialGuideState(route, now, {
          hasFinalApproachGeometry: fetched.finalApproach !== null,
          // 재조회는 같은 세션의 새 경로다 — 유도기 버퍼를 잇는다(spec §2.9.
          // 비우면 갈림 직후 재조회에서 축이 ~10m 냉시동돼, "이탈 → 재조회 →
          // 다시 잘못된 길" 시나리오에서 이 축의 이점이 사라진다).
          courseDerivation: guideRef.current?.courseDerivation,
        });
        commitDetail(route, init.state);
        setHasRoute(true);
        pendingResolveRef.current = null;
        const first = unitText(route, init.firstIndices, t);
        rememberGuidance(first);
        const notice = consumeStepFreeNotice(fetched.stepFree, fetched.stepFreeNotice);
        // 첫 안내만 내보내면 그것이 **새 경로**인지 원래 경로의 다음 스텝인지 낭독으로
        // 구분되지 않는다(실사용 발견: 화면 출발지 필드는 길찾기 입력값이라 갱신되지
        // 않으므로, "출발지가 현재 위치로 바뀌었다"를 전할 채널이 이 문장뿐이다).
        // 시작 통지(`detailStart`)와 같은 구조로 규모까지 함께 준다.
        const summary = t("rerouteDone", {
          count: route.steps.length,
          distance: formatDistance(route.totalMeters),
          first,
        });
        announce(notice ? `${notice} ${summary}` : summary);
      } finally {
        rerouteInFlightRef.current = false;
        if (mountedRef.current) setRerouting(false);
      }
    })();
  }, [
    announce,
    commitDetail,
    consumeStepFreeNotice,
    fetchGuideRoute,
    kindFixed,
    rememberGuidance,
    resetFinalApproach,
    t,
  ]);

  // 전경 전용(스펙 §9): 탭이 숨으면 중지하고 경로를 폐기한다. 복귀 후 자동 재개 없음
  // — 숨김 탭에서 멎은 watch·타이머가 좀비 상태를 만드는 것을 상태로 흡수한다.
  const stopRef = useRef(stop);
  /** 세션 스토어에 등록하는 안정 정체성 중지 함수(claim/release 짝 맞춤용). */
  const sessionStopRef = useRef(() => stopRef.current());

  // 최신 값 미러(매 렌더 후). 등록형 콜백이 등록 시점 클로저에 고정되는 것을 막는
  // 유일한 갱신 지점 — 렌더 중 ref 쓰기는 금지다(useNearbyFetch 관례 동형).
  useEffect(() => {
    destRef.current = dest;
    accessibleRef.current = accessible;
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
      // 텍스트 채널도 함께 연다. iOS에는 대응물이 있고(`noticeStaleIfNeeded`), 웹에는
      // 백그라운드 억제가 없으므로 이 침묵은 "발화를 막은 것"이 아니라 순수 누락이다 —
      // 소리만 나고 화면은 마지막 안내 그대로면 스크린 리더 사용자는 처음 듣는 소리의
      // 원인을 알 수 없다. geolocation 에러 콜백은 콜백이 조용히 멎는 경우를 못 잡는다.
      if (prevKindRef.current !== "weak") {
        prevKindRef.current = "weak";
        announce(tBeacon("weak"));
      }
    }, WATCHDOG_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [announce, emitTone, status, tBeacon]);

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
    currentText,
    liveRows,
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
