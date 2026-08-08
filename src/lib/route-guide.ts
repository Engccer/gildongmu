/**
 * 경로 추종형 안내 순수 리듀서 (스펙 2026-08-03 §5 정본 구현 — deterministic,
 * I/O·시계 비의존). 상태 모델·이벤트 우선순위는 스펙 §5.0, 낭독 선행·전진 후행은 §5.3.
 * Kit 미러: RouteGuide.swift — 공유 fixture(route-guide-scenarios.json)가 동조를 강제한다.
 *
 * 시간은 전부 주입된 단조 시각(now, 초)이다. Date.now() 직접 호출 금지 — 역순 fix
 * 폐기·타이머 정지 계약이 주입 시각 위에서만 성립한다(리뷰 #19).
 */
import {
  courseAxisVerdict,
  courseVote,
  INACTIVE_COURSE,
  recordVote,
  type CourseObservation,
  type CourseVote,
  type CourseVoteSample,
} from "./guide-course-axis";
import {
  globalCandidates,
  projectOnPolyline,
  type GuideRoute,
  type StepSpan,
} from "./route-geometry";

export { buildGuideRoute, LONG_STEP_MIN_M, type GuideRoute } from "./route-geometry";

/** 다음 안내 전문을 낭독하는 잔여 거리 — 결정 지점 앞에서 들려야 한다(리뷰 #4 선행 원칙). */
export const ANNOUNCE_AHEAD_M = 40;
export const ADVANCE_MARGIN_BASE_M = 15;
/**
 * **기하를 모르는 세션의** 최종 접근 진입 거리(m). 기하를 아는 세션은 경로 종점까지
 * 따라간다(아래 `ARRIVAL_TOLERANCE_MIN_M`) — 이 50m는 "경로 종점 = 목적지"를 전제한
 * 판단이었고, 실측에서 종점→목적지 오프셋 16~89m가 확인돼 무효화됐다
 * (spec 2026-08-08 §1.2·§3.2).
 */
export const HANDOFF_DIST_M = 50;
export const HANDOFF_REARM_M = HANDOFF_DIST_M + 20;
/**
 * 경로 종점 도달 판정의 하한(m). 실제 임계는 `max(이 값, fix.accuracy)`다 —
 * 경로 잔여 5m를 정확도 30m fix로 판정하는 것은 거짓 정밀도이고, 정확도가 나쁘면
 * 종점 도달을 일찍 인정하는 것이 정직하다(spec 2026-08-08 §3.2).
 * ⚠ 실보행 판정 전까지 동결(spec §6-1).
 */
export const ARRIVAL_TOLERANCE_MIN_M = 10;
export const UNCERTAIN_ACCURACY_M = 50;
export const OFF_ROUTE_BASE_M = 30;
export const OFF_ROUTE_HOLD_S = 20;
export const OFF_ROUTE_RENOTIFY_S = 60;
export const REACQUIRE_GAP_S = 10;
export const WINDOW_BACK_M = 20;
export const WINDOW_AHEAD_MIN_M = 50;
export const EDGE_HITS_MAX = 3;
export const SPEED_ENTER_MPS = 3;
export const SPEED_CLEAR_MPS = 2;
export const SPEED_WINDOW_S = 10;
/**
 * 속도 표본 수집의 정확도 상한. uncertain 게이트(50m)보다 좁다 — 계단·실내 진입의
 * 30~50m fix는 위치로는 쓸 만하지만 진행거리 점프를 만들어, 단조 전진 정류가 그
 * 노이즈의 앞쪽 성분만 누적해 "속도 빠름" 오판을 낳는다(피드백 라운드1 #7).
 */
export const SPEED_SAMPLE_MAX_ACC_M = 20;
export const RESOLVE_TIMEOUT_S = 30;
export const BUNDLE_REREAD_S = 15;

/**
 * 수단별 튜닝 프로파일(B1 스펙 §4.3). walk는 현행 상수의 동결이다 — 값 변경은
 * 회귀이며, 리듀서 본문 변경은 "상수 참조 → 인자 참조 치환"에 한정한다(분기
 * 구조·비교 연산자·평가 순서 불변 계약, §4.2).
 */
export interface GuideTuning {
  /** 임박(선행) 낭독: 잔여 ≤ max(announceAheadM, v×announceAheadSpeedS) */
  announceAheadM: number;
  announceAheadSpeedS: number;
  /** 원거리 예고 경계(m). null=미사용(walk) */
  farNoticeM: number | null;
  windowAheadMinM: number;
  windowAheadSpeedS: number;
  offRouteBaseM: number;
  offRouteHoldS: number;
  /** 이탈 확정에 "수직거리 비감소 추세" 요구(복귀 중 오확정 차단) */
  offRouteTrend: boolean;
  offRouteRenotifyS: number;
  /** 이탈 재통지의 warning 톤 여부(첫 확정은 항상 warning) */
  offRouteRenotifyWarns: boolean;
  handoffDistM: number;
  handoffRearmM: number;
  /** 재획득 전방 연속성 타이브레이크(재획득 경로 한정 — 연속 추적 모호는 거부 유지) */
  reacquireTieBreak: boolean;
  /** 보행 속도 가드(간략 제안). false면 가드 기계 전체 비활성 — 가드가 이탈
   * 재통지를 억제하는 배선이 있어, 차량에서 켜 두면 재통지가 영영 죽는다. */
  speedSuggest: boolean;
  /**
   * 이탈 판정 방위 축(spec 2026-08-09). **보행 전용이다.**
   *
   * ⚠ 이 축의 상수는 전부 보행 궤적으로 쟀다(속도 1.2m/s, 앞뒤 10m 접선 표본).
   * "모퉁이 헛경고를 ±10m 표본이 막는다"는 핵심 논거가 차량 속도에서 성립하지
   * 않는다 — 15m/s면 그 대역을 1.3초에 통과하고 fix 하나당 진행거리가 15m씩 뛴다.
   * 차량에서의 헛경고율은 **측정된 적이 없다.** 차량을 범위에 넣으려면 차량 속도
   * 궤적으로 다시 재고 그 결정을 spec에 적어야 한다(`offRouteTrend`와 같은 계열의
   * 프로파일 플래그다).
   */
  courseAxisEnabled: boolean;
}

export const WALK_TUNING: GuideTuning = {
  announceAheadM: ANNOUNCE_AHEAD_M,
  announceAheadSpeedS: 0,
  farNoticeM: null,
  windowAheadMinM: WINDOW_AHEAD_MIN_M,
  windowAheadSpeedS: 0,
  offRouteBaseM: OFF_ROUTE_BASE_M,
  offRouteHoldS: OFF_ROUTE_HOLD_S,
  offRouteTrend: false,
  offRouteRenotifyS: OFF_ROUTE_RENOTIFY_S,
  offRouteRenotifyWarns: true,
  handoffDistM: HANDOFF_DIST_M,
  handoffRearmM: HANDOFF_REARM_M,
  reacquireTieBreak: false,
  speedSuggest: true,
  courseAxisEnabled: true,
};

/** 자동차 초기값(스펙 §4.3 표) — 최초 실주행 판정까지 고정. */
export const CAR_TUNING: GuideTuning = {
  announceAheadM: 120,
  announceAheadSpeedS: 15,
  farNoticeM: 1500,
  windowAheadMinM: 150,
  windowAheadSpeedS: 5,
  offRouteBaseM: 50,
  offRouteHoldS: 10,
  offRouteTrend: true,
  offRouteRenotifyS: 180,
  offRouteRenotifyWarns: false,
  handoffDistM: 150,
  handoffRearmM: 200,
  reacquireTieBreak: true,
  speedSuggest: false,
  // ⚠ 차량 궤적으로 측정된 적이 없다. 켜려면 먼저 재라(위 필드 주석).
  courseAxisEnabled: false,
};

/**
 * 속도 추정 v(스펙 §4.3): max(직전 구간 속도, 중앙값). 표본은 직전 fix까지의
 * 창(state.speedSamples)이다 — 구속 창 크기는 현재 fix 수용 전에 정해져야
 * 하므로(인과) 현재 fix를 포함하지 않는다. walk 프로파일은 속도 계수가 0이라
 * 이 값과 무관하게 현행 동작이다.
 */
function estimateSpeedMps(samples: readonly { at: number; d: number }[]): number {
  if (samples.length < 2) return 0;
  const speeds: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i].at - samples[i - 1].at;
    if (dt > 0) speeds.push((samples[i].d - samples[i - 1].d) / dt);
  }
  if (speeds.length === 0) return 0;
  const lastSeg = speeds[speeds.length - 1];
  const sorted = [...speeds].sort((a, b) => a - b);
  return Math.max(lastSeg, sorted[Math.floor(sorted.length / 2)]);
}

/**
 * `finalApproach`는 **경로 종점 이후 오프셋 구간을 직선으로 추적**하는 국면이다
 * (spec 2026-08-08 §3.0). 단방향 래치라 이 국면에서 다른 국면으로 리듀서가 스스로
 * 돌아가지 않는다 — 해제는 세션 재시작·재조회·수동 전환처럼 상태를 새로 만드는
 * 경로뿐이다(§4 전이표).
 */
export type GuidePhase =
  | "following"
  | "bundle"
  | "uncertain"
  | "reacquiring"
  | "offRoute"
  | "finalApproach";

export interface GuideFix {
  lat: number;
  lng: number;
  accuracy: number;
}

export interface GuideState {
  phase: GuidePhase;
  /**
   * uncertain에서 복귀할 국면. offRoute를 포함한다 — 이탈 확정 중 정확도 악화로
   * uncertain을 경유했다가 following으로 돌아가면 이탈 상태가 무통지로 소실된다
   * (reacquiringFromOffRoute와 같은 계열, 독립 리뷰 HIGH의 대칭 경로).
   */
  resumePhase: "following" | "bundle" | "offRoute";
  d: number;
  stepIndex: number;
  /** 낭독 완료된 마지막 스텝 index(선행 낭독 포함). */
  announcedUpTo: number;
  /** 어떤 발화든 갱신 — 주기 통지의 기준(리뷰 #25). */
  lastAnnouncedAt: number;
  lastFixAt: number | null;
  windowEdgeHits: number;
  offRouteSince: number | null;
  lastOffRouteNoticeAt: number | null;
  speedSamples: { at: number; d: number }[];
  speedGuardActive: boolean;
  speedWarned: boolean;
  /** 자동 인계 무장 여부. 수동 상세 복귀 후엔 재무장선(70m) 밖으로 나가야 true(리뷰 #11). */
  autoHandoffArmed: boolean;
  /**
   * 이 세션이 종점 오프셋 기하(`WalkRouteBriefing.finalApproach`)를 아는가.
   *
   * - `true`  → 최종 접근 진입 조건은 **경로 종점 도달**(`max(ARRIVAL_TOLERANCE_MIN_M, accuracy)`).
   * - `false` → 구버전 응답이다. **현행 50m 인계를 그대로 쓴다**(spec §3.2, 검토 #33).
   *   기하 없이 종점까지 끌고 가면 정작 종점에서 할 말이 없다.
   *
   * ⚠ **fix 인자가 아니라 상태에 둔다.** 이 값은 세션(경로 응답)의 성질이라 매 fix마다
   * 다시 넘길 값이 아니고, 넘기게 하면 호출 지점 하나만 어긋나도 타입이 못 잡는다.
   * 재조회는 `guideStateAt`을 지나가므로 새 경로의 기하로 교체되는 것이 강제된다(§4).
   */
  hasFinalApproachGeometry: boolean;
  /**
   * 원거리 예고(farNotice)를 마친 마지막 스텝 index(임박 발화 시 함께 전진 —
   * 뒤늦은 원거리 예고 금지). walk(farNoticeM=null)에선 불변.
   */
  farNoticedUpTo: number;
  /** 이탈 누적 중 관측 최대 수직거리 — offRouteTrend 프로파일의 복귀 유예 기준. */
  offRoutePeakPerp: number | null;
  /** 재획득 타이브레이크 기준: reacquiring 진입 직전 진행거리·속도·진입 시각. */
  reacquirePrevD: number | null;
  reacquireV: number;
  reacquireSince: number | null;
  /**
   * reacquiring 진입 직전 국면이 offRoute였는가. 없으면 이탈 확정이 GPS 공백을
   * 경유하며 무통지로 소실된다 — 복귀 이벤트가 backOnRoute가 아니라 reacquired로
   * 나가 UI의 이탈 상태(재조회 버튼)가 리듀서와 어긋난 채 남는다(독립 리뷰 HIGH).
   */
  reacquiringFromOffRoute: boolean;
  /**
   * 축별 이탈 latch. 확정은 OR, 복귀는 **평가 가능한 활성 축 전체 해제**다.
   *
   * ⚠ 단일 "원인" 문자열로 접지 않는다 — 거리 축으로 이탈한 뒤 사용자가 역주행해도
   * 방위 상태가 기록되지 않아 방향이 어긋난 채 복귀가 선언된다(codex 리뷰 7).
   */
  offRouteAxes: { distance: boolean; course: boolean };
  /** 방위 표결 창. 상태 재구성 시 비워진다(경로 identity 바인딩). */
  courseVotes: readonly CourseVoteSample[];
}

export type GuideEvent =
  | { kind: "announceSteps"; indices: number[] }
  | { kind: "farNotice"; indices: number[]; remainingMeters: number }
  | { kind: "periodic"; stepIndex: number; remainingMeters: number; accuracy: number }
  | { kind: "bundleReread"; indices: number[] }
  | { kind: "finalApproachEnter" }
  | { kind: "offRoute" }
  | { kind: "backOnRoute" }
  | { kind: "uncertainEnter" }
  | { kind: "uncertainExit" }
  | { kind: "reacquiring" }
  | { kind: "reacquired" }
  | { kind: "speedSuggest" };

export type GuideTone = "ahead" | "warning";

export interface GuideOutput {
  state: GuideState;
  event: GuideEvent | null;
  tone: GuideTone | null;
  /**
   * 진단 계측용(spec §7 1단계). **판정에 쓰이지 않는다.**
   *
   * 실보행 로그로 §6 상수를 정하려면 "왜 그렇게 판정했나"를 되짚을 수 있어야 한다.
   * `verdict=unknown, votes=20`만으로는 표가 없어서인지 회색지대여서인지 구분되지
   * 않고, 수직거리 없이는 두 축의 상관을 볼 수 없다(A6의 원인 진단이 그 열로
   * 이루어졌다). 판정 전 국면에서 조기 반환하면 계산된 적이 없으므로 `undefined`이고,
   * 그것이 정직한 값이다(0으로 접지 않는다).
   */
  perpMeters?: number;
  /** 이 fix가 실제로 창에 넣은 표. 이탈 중에는 `entryProjection` 기준이다. */
  courseVote?: CourseVote;
}

/** 스텝 index가 속한 유닛(긴 스텝=자기 하나, 짧은 스텝=연속 묶음 전체)의 index 목록. */
export function unitAt(route: GuideRoute, index: number): number[] {
  const s = route.steps[index];
  if (!s) return [];
  if (s.isLong) return [index];
  let a = index;
  let b = index;
  while (a > 0 && !route.steps[a - 1].isLong) a--;
  while (b < route.steps.length - 1 && !route.steps[b + 1].isLong) b++;
  return route.steps.slice(a, b + 1).map((x) => x.index);
}

function stepAt(route: GuideRoute, d: number): StepSpan {
  for (const s of route.steps) if (d < s.endD) return s;
  return route.steps[route.steps.length - 1];
}

/** 임의 진행거리에서의 초기 상태(전환·재획득·재조회 리셋 공용). */
export function guideStateAt(
  route: GuideRoute,
  d: number,
  now: number,
  opts?: { autoHandoffArmed?: boolean; hasFinalApproachGeometry?: boolean },
): GuideState {
  const step = stepAt(route, d);
  const unit = unitAt(route, step.index);
  return {
    phase: step.isLong ? "following" : "bundle",
    resumePhase: step.isLong ? "following" : "bundle",
    d,
    stepIndex: step.index,
    announcedUpTo: unit[unit.length - 1],
    lastAnnouncedAt: now,
    lastFixAt: null,
    windowEdgeHits: 0,
    offRouteSince: null,
    lastOffRouteNoticeAt: null,
    speedSamples: [],
    speedGuardActive: false,
    speedWarned: false,
    autoHandoffArmed: opts?.autoHandoffArmed ?? true,
    // 기본은 false(옛 50m 인계) — 기하를 안다고 주장하려면 명시해야 한다.
    hasFinalApproachGeometry: opts?.hasFinalApproachGeometry ?? false,
    // 재진입 시점의 유닛은 원거리 예고 소비 처리 — 경계선을 이미 안에서 시작하면
    // 크로싱이 성립하지 않아 뒤늦은 예고가 구조적으로 없다(스펙 §4.3).
    farNoticedUpTo: unit[unit.length - 1],
    offRoutePeakPerp: null,
    reacquirePrevD: null,
    reacquireV: 0,
    reacquireSince: null,
    reacquiringFromOffRoute: false,
    offRouteAxes: { distance: false, course: false },
    courseVotes: [],
  };
}

/**
 * 같은 세션 안에서 진행거리만 바꿔 상태를 다시 만든다(재획득·복귀 공용).
 *
 * ⚠ **세션 성질(경로 응답에서 온 값·세션 래치)의 승계 목록은 여기 한 곳에만 둔다.**
 * 호출 지점마다 나열하면 새 필드를 더할 때 하나를 빠뜨리게 되고, 그 결과는 조용하다 —
 * 실제로 `hasFinalApproachGeometry`가 재획득 경로에서만 떨어져 진입선이 옛 50m로
 * 되돌아간 적이 있다(계측으로 발견).
 */
function restateAt(
  route: GuideRoute,
  d: number,
  now: number,
  prev: GuideState,
): GuideState {
  return guideStateAt(route, d, now, {
    autoHandoffArmed: prev.autoHandoffArmed,
    hasFinalApproachGeometry: prev.hasFinalApproachGeometry,
  });
}

/** 시작 상태 + 원자 시작 발화(스펙 §5.3)에 넣을 첫 유닛. 문장 조립은 오케스트레이터 몫. */
export function initialGuideState(
  route: GuideRoute,
  now: number,
  opts?: { hasFinalApproachGeometry?: boolean },
): { state: GuideState; firstIndices: number[] } {
  return {
    state: guideStateAt(route, 0, now, {
      hasFinalApproachGeometry: opts?.hasFinalApproachGeometry,
    }),
    firstIndices: unitAt(route, 0),
  };
}

/**
 * 간략→상세 전환·재조회 후 초기 투영(스펙 §6). 후보가 복수면 확정하지 않는다 —
 * 잘못 고른 후보도 폴리라인 위라 수직거리 이탈 판정이 영영 못 잡는다(리뷰 #6).
 */
export function entryProjection(
  route: GuideRoute,
  fix: GuideFix,
  tuning: GuideTuning = WALK_TUNING,
): { status: "ok"; d: number } | { status: "ambiguous" } | { status: "none" } {
  const maxPerp = Math.max(tuning.offRouteBaseM, 2 * fix.accuracy);
  const cands = globalCandidates(route.polyline, fix, maxPerp);
  if (cands.length === 0) return { status: "none" };
  if (cands.length > 1) return { status: "ambiguous" };
  return { status: "ok", d: cands[0].d };
}

/**
 * 최종 접근 진입선(경로 잔여 m). 기하를 알면 경로 종점까지 따라가고, 모르면 옛 50m다
 * (spec 2026-08-08 §3.2).
 *
 * ⚠ **정확도에 연동하는 이유**: 경로 잔여 5m를 정확도 30m fix로 판정하는 것은 거짓
 * 정밀도다. 정확도가 나쁘면 종점 도달을 일찍 인정하는 것이 정직하다.
 */
export function finalApproachEntryM(
  state: Pick<GuideState, "hasFinalApproachGeometry">,
  accuracy: number,
  tuning: GuideTuning,
): number {
  if (!state.hasFinalApproachGeometry) return tuning.handoffDistM;
  return Math.max(ARRIVAL_TOLERANCE_MIN_M, accuracy);
}

function periodicIntervalS(remaining: number): number {
  if (remaining > 500) return 60;
  if (remaining >= 150) return 30;
  return 15;
}

/**
 * `course`는 **필수 인자다.** 기본값을 주면 호출 지점 하나를 빠뜨려도 컴파일이
 * 통과해, 그 플랫폼에서만 축이 조용히 죽는다(안전 인자에 기본값 금지).
 * 방위를 제공하지 않는 플랫폼은 `INACTIVE_COURSE`를 **명시적으로** 넘긴다.
 */
export function guideStep(
  state: GuideState,
  fix: GuideFix,
  route: GuideRoute,
  now: number,
  tuning: GuideTuning,
  course: CourseObservation,
): GuideOutput {
  // 0) 역순 시각 방어: now가 과거로 가면 fix 폐기(상태 불변).
  if (state.lastFixAt !== null && now < state.lastFixAt) {
    return { state, event: null, tone: null };
  }

  // 프로파일이 방위 축을 끄면 관측을 비활성으로 중화한다. ⚠ 게이트는 여기 한 곳뿐이다 —
  // 조건을 하위 분기마다 흩으면 하나를 빠뜨리고, 그 하나가 조용히 축을 살린다.
  const obs = tuning.courseAxisEnabled ? course : INACTIVE_COURSE;

  // 0a) 최종 접근 중에는 리듀서가 아무 판정도 하지 않는다(spec §4 전이표).
  //     발화 소유권이 최종 접근 층으로 넘어갔고, 이 국면은 **경로를 이미 벗어난**
  //     구간을 다루므로 낡은 폴리라인으로 이탈·재획득을 주장하면 거짓이다.
  //     ⚠ **이 가드는 반드시 uncertain 게이트보다 앞에 온다.** 뒤에 두면 정확도가
  //     나빠질 때 uncertain을 경유했다가 resumePhase("following")로 복귀하면서
  //     단방향 래치가 조용히 풀린다.
  if (state.phase === "finalApproach") {
    // 낡은 폴리라인 기준 표는 이 국면에서 근거가 아니다(경로를 이미 벗어난 구간).
    return {
      state: { ...state, lastFixAt: now, courseVotes: [] },
      event: null,
      tone: null,
    };
  }

  // 1) uncertain 게이트(정확도 무효 포함): 자동 낭독·타이머 전부 정지(리뷰 #12).
  const accBad = !(fix.accuracy > 0) || fix.accuracy > UNCERTAIN_ACCURACY_M;
  if (state.phase === "uncertain") {
    if (accBad) return { state: { ...state, lastFixAt: now }, event: null, tone: null };
    const s: GuideState = {
      ...state,
      phase: state.resumePhase,
      lastFixAt: now,
      lastAnnouncedAt: now,
    };
    return { state: s, event: { kind: "uncertainExit" }, tone: null };
  }
  if (accBad) {
    return {
      state: {
        ...state,
        phase: "uncertain",
        // 이탈 중 진입이면 복귀도 이탈로(이탈 상태 소실 방지).
        resumePhase: state.phase === "offRoute" ? "offRoute" : state.resumePhase,
        lastFixAt: now,
        speedSamples: [],
        // ⚠ 창은 비우고 latch(offRouteAxes)는 스프레드로 보존한다. 투영을 못 믿는
        //   기간의 표는 근거가 아니지만, 이탈 사실이 정확도 악화로 소실되면 안 된다.
        courseVotes: [],
      },
      event: { kind: "uncertainEnter" },
      tone: null,
    };
  }

  // 2) reacquiring: 전역 재탐색(모호하면 유지 — 다음 fix에서 재시도).
  if (state.phase === "reacquiring") {
    const entry = entryProjection(route, fix, tuning);
    let entryD: number | null = entry.status === "ok" ? entry.d : null;
    // 재획득 전방 연속성 타이브레이크(§4.3, 재획득 경로 한정): 직전 진행거리 기준
    // 전방 창 안 후보가 정확히 1개일 때만 채택. 0·복수는 거부 유지 — 타이브레이크가
    // 평행도로 이탈을 감추는 경로를 막는다.
    if (
      entryD === null &&
      entry.status === "ambiguous" &&
      tuning.reacquireTieBreak &&
      state.reacquirePrevD !== null &&
      state.reacquireSince !== null
    ) {
      // elapsed = "마지막으로 확실했던 시점"부터의 경과. 진입 시 gap 트리거는
      // 직전 fix 시각을, edgeHits 트리거는 진입 시각을 reacquireSince에 담으므로
      // 고정 보정(+GAP) 없이 실공백이 그대로 반영된다(독립 리뷰: 터널 장공백
      // 과소추정·무공백 과대추정 분리).
      const elapsed = now - state.reacquireSince;
      const maxAheadD = state.reacquirePrevD + state.reacquireV * elapsed * 1.5 + 100;
      const maxPerp = Math.max(tuning.offRouteBaseM, 2 * fix.accuracy);
      const inWindow = globalCandidates(route.polyline, fix, maxPerp).filter(
        (c) => c.d >= state.reacquirePrevD! && c.d <= maxAheadD,
      );
      if (inWindow.length === 1) entryD = inWindow[0].d;
    }
    if (entryD === null) {
      return { state: { ...state, lastFixAt: now }, event: null, tone: null };
    }
    // ⚠ 재획득 성공도 복귀다. 방위 축이 잠겨 있으면 위치만으로 풀지 않는다.
    //   이 경로가 §5의 offRoute 분기보다 **먼저** 실행되므로, 여기를 빼면
    //   fix 공백 10초만으로 복귀 계약이 통째로 우회된다.
    // ⚠ 이 판정은 **구조상 항상 hold다.** 재획득 진입에서 창이 비워졌으므로 표가
    //   정확히 하나뿐이고 `MIN_VOTES`(8)에 못 미쳐 `courseAxisVerdict`는 반드시
    //   unknown이다. 그래도 verdict를 부르는 형태로 두는 이유는, 창 초기화 정책이
    //   바뀌면(예: 짧은 공백은 창을 유지) 이 자리가 자동으로 증거 평가로 돌아가야
    //   하기 때문이다. `if offRouteAxes.course { hold }`로 줄이면 그 연결이 끊긴다.
    const reVotes = recordVote(
      state.courseVotes,
      now,
      courseVote(obs, route.polyline, entryD, fix.accuracy),
    );
    if (state.offRouteAxes.course && courseAxisVerdict(reVotes) !== "on") {
      // 위치는 되찾았지만 방향이 확인되지 않았다 — 이탈 상태를 유지한다.
      // `reacquiringFromOffRoute`를 내리는 이유: 국면을 offRoute로 되돌리므로
      // 재획득 상태가 아니다. 남기면 다음 재획득에서 이벤트 종류를 잘못 가른다.
      return {
        state: {
          ...state,
          phase: "offRoute",
          lastFixAt: now,
          courseVotes: reVotes,
          reacquiringFromOffRoute: false,
        },
        event: null,
        tone: null,
      };
    }
    const s: GuideState = {
      ...restateAt(route, entryD, now, state),
      speedWarned: state.speedWarned,
      lastFixAt: now,
    };
    // 이탈 확정 상태에서 공백으로 넘어온 재확보는 곧 이탈 종료다 — backOnRoute를
    // 내야 UI의 이탈 상태(재조회 버튼)가 함께 닫힌다(독립 리뷰 HIGH).
    return {
      state: s,
      event: { kind: state.reacquiringFromOffRoute ? "backOnRoute" : "reacquired" },
      tone: null,
    };
  }
  const gap = state.lastFixAt !== null && now - state.lastFixAt > REACQUIRE_GAP_S;
  if (gap || state.windowEdgeHits >= EDGE_HITS_MAX) {
    return {
      state: {
        ...state,
        phase: "reacquiring",
        windowEdgeHits: 0,
        speedSamples: [],
        // 위치를 잃은 동안의 표는 근거가 아니다(latch는 스프레드로 보존).
        courseVotes: [],
        lastFixAt: now,
        reacquiringFromOffRoute: state.phase === "offRoute",
        // 타이브레이크 기준 보관 — 표본은 지금 리셋되므로 진입 시점에 계산해 둔다.
        // 기준 시각은 "마지막으로 확실했던 시점": gap 트리거는 직전 fix 시각(실공백
        // 전체가 창에 반영), edgeHits 트리거는 지금(공백 없음 — 여유 과대 방지).
        reacquirePrevD: state.d,
        reacquireV: estimateSpeedMps(state.speedSamples),
        reacquireSince: gap ? state.lastFixAt : now,
      },
      event: { kind: "reacquiring" },
      tone: null,
    };
  }

  // 3) 구속 창 투영 + 단조 전진(스펙 §5.1). 창 크기는 직전 창 속도로 되먹인다
  //    (walk는 속도 계수 0이라 현행 동일 — B1 §4.3 고속 fix 공백 기아 봉합).
  const vPrev = estimateSpeedMps(state.speedSamples);
  const ahead = Math.max(
    tuning.windowAheadMinM,
    3 * fix.accuracy,
    vPrev * tuning.windowAheadSpeedS,
  );
  const proj = projectOnPolyline(route.polyline, fix, state.d - WINDOW_BACK_M, state.d + ahead);
  if (!proj) return { state: { ...state, lastFixAt: now }, event: null, tone: null };
  const d = Math.max(state.d, proj.d);
  // 방위 축 표결(spec §2.1). 추종 중 기준은 구속 창 투영 결과다.
  const vote = courseVote(obs, route.polyline, d, fix.accuracy);
  const courseVotes = recordVote(state.courseVotes, now, vote);
  // 진단 계측: 이 fix가 실제로 넣은 표. 이탈 분기에서 entry 기준으로 덮인다.
  let loggedVote = vote;
  const emit = (s: GuideState, event: GuideEvent | null, tone: GuideTone | null): GuideOutput => ({
    state: s,
    event,
    tone,
    perpMeters: proj.perpMeters,
    courseVote: loggedVote,
  });
  // 창 경계 적중은 "경로 위인데 창이 못 따라간" 신호일 때만 센다. 수직거리가 크면
  // 그것은 이탈 증거이지 창 기아가 아니다(두 판정이 경합하면 이탈이 영영 확정되지 않는다).
  const offThreshold = Math.max(tuning.offRouteBaseM, 2 * fix.accuracy);
  const edgeHit = proj.d >= state.d + ahead - 1 && proj.perpMeters <= offThreshold;
  const windowEdgeHits = edgeHit ? state.windowEdgeHits + 1 : 0;

  // 4) 속도 창(10초 중앙값, 리뷰 #17) — uncertain·reacquiring 밖에서만 표본 수집.
  //    정확도 나쁜 fix(>20m)는 표본에서 배제한다(투영·전진은 유지 — 위치 축과 속도
  //    축의 품질 요구가 다르다). 배제가 이어지면 창이 짧아져 가드 판정 자체가
  //    멈추므로, 나쁜 fix만으로는 가드가 새로 켜지지 않는다.
  const samples = (
    fix.accuracy > SPEED_SAMPLE_MAX_ACC_M
      ? state.speedSamples
      : [...state.speedSamples, { at: now, d }]
  ).filter((s) => now - s.at <= SPEED_WINDOW_S);
  const speeds: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i].at - samples[i - 1].at;
    if (dt > 0) speeds.push((samples[i].d - samples[i - 1].d) / dt);
  }
  speeds.sort((a, b) => a - b);
  const median = speeds.length ? speeds[Math.floor(speeds.length / 2)] : 0;
  const windowSpan = samples.length >= 2 ? samples[samples.length - 1].at - samples[0].at : 0;
  let speedGuardActive = state.speedGuardActive;
  // 가드 기계는 speedSuggest 프로파일에서만 동작한다 — 차량에서 켜 두면 상시
  // 활성이 되어 이탈 재통지 억제 배선을 영구 잠식한다(적대적 리뷰 반영).
  if (tuning.speedSuggest) {
    if (windowSpan >= SPEED_WINDOW_S * 0.8) {
      if (!speedGuardActive && median > SPEED_ENTER_MPS) speedGuardActive = true;
      else if (speedGuardActive && median < SPEED_CLEAR_MPS) speedGuardActive = false;
    } else if (speedGuardActive && samples.length === 0) {
      // 표본이 전무하면(정확도 배제·시간창 배수로 소멸) 판정 근거가 없다 — 가드를
      // 해제한다. 21~50m 정확도가 지속되는 구간에서 낡은 판정을 쥔 채 이탈
      // 재통지를 무기한 억제하는 고착 차단(독립 리뷰 MAJOR, 정확도 배제의 2차 회귀).
      speedGuardActive = false;
    }
  }

  const remainingTotal = route.totalMeters - d;
  let next: GuideState = {
    ...state,
    d,
    stepIndex: stepAt(route, d).index,
    lastFixAt: now,
    windowEdgeHits,
    speedSamples: samples,
    speedGuardActive,
    courseVotes,
  };
  // 재무장: 수동 복귀 세션은 잔여가 재무장선 밖으로 나가야 자동 인계 허용(리뷰 #11).
  if (!next.autoHandoffArmed && remainingTotal > tuning.handoffRearmM) {
    next = { ...next, autoHandoffArmed: true };
  }

  // 5) 이탈 판정(스펙 §5.6).
  if (state.phase === "offRoute") {
    // 이탈 중 복귀 감지는 구속 창이 아니라 전역 후보로 한다. 이탈 동안 창이 뒤에
    // 머물러, 사용자가 경로 앞쪽으로 복귀해도 창 안 투영으로는 영영 못 잡는다.
    const entry = entryProjection(route, fix, tuning);
    // ⚠ 이탈 중 표결 기준은 `state.d`가 아니라 `entryProjection`이 고른 지점이다.
    //   `state.d`는 단조 전진이라 역주행·되돌아가기에서 실제 복귀 지점과 다르다.
    //   후보가 모호하면 방위가 맞아도 복귀를 확정하지 않는다(판정 근거 없음).
    // ⚠ 이탈 중에는 창을 비우지 않는다 — 비우면 복귀 판정 표본이 영영 최소치에
    //   못 미친다(국면 초기화는 uncertain·reacquiring·finalApproach에만).
    const offVote =
      entry.status === "ok"
        ? courseVote(obs, route.polyline, entry.d, fix.accuracy)
        : ("unknown" as CourseVote);
    const offVotes = recordVote(state.courseVotes, now, offVote);
    next = { ...next, courseVotes: offVotes };
    loggedVote = offVote; // 진단: 이 국면에서 실제로 창에 들어간 표는 entry 기준이다.
    if (entry.status === "ok") {
      // 축별 해제. 평가 불가(`unknown`)는 해제가 아니다.
      const courseCleared =
        !state.offRouteAxes.course || courseAxisVerdict(offVotes) === "on";
      if (courseCleared) {
        // restateAt이 guideStateAt을 거치므로 창과 latch가 함께 초기화된다(§2.8).
        const back: GuideState = {
          ...restateAt(route, entry.d, now, state),
          speedSamples: samples,
          speedGuardActive,
          speedWarned: state.speedWarned,
          lastFixAt: now,
        };
        return emit(back, { kind: "backOnRoute" }, null);
      }
    }
    const canRenotify =
      !speedGuardActive &&
      (state.lastOffRouteNoticeAt === null ||
        now - state.lastOffRouteNoticeAt >= tuning.offRouteRenotifyS);
    if (canRenotify) {
      next = { ...next, lastOffRouteNoticeAt: now };
      // 재통지 톤은 프로파일 몫(차량은 이탈=정보라 무톤, 첫 확정만 경고 — §4.3).
      return emit(next, { kind: "offRoute" }, tuning.offRouteRenotifyWarns ? "warning" : null);
    }
    return emit(next, null, null);
  }
  const courseVerdict = courseAxisVerdict(courseVotes);
  const isOff = proj.perpMeters > offThreshold;
  if (isOff) {
    let since = state.offRouteSince ?? now;
    let peak = Math.max(state.offRoutePeakPerp ?? 0, proj.perpMeters);
    // 복귀 추세 유예(offRouteTrend): 관측 최대 대비 5m 이상 줄면 누적을 리셋한다 —
    // 경로 쪽으로 돌아오는 중에 시간만으로 확정하는 오판 차단(§4.3).
    if (tuning.offRouteTrend && proj.perpMeters < peak - 5) {
      since = now;
      peak = proj.perpMeters;
    }
    next = { ...next, offRouteSince: since, offRoutePeakPerp: peak };
    if (now - since >= tuning.offRouteHoldS) {
      next = {
        ...next,
        phase: "offRoute",
        resumePhase: stepAt(route, d).isLong ? "following" : "bundle",
        lastOffRouteNoticeAt: now,
        offRoutePeakPerp: null,
        offRouteAxes: { ...next.offRouteAxes, distance: true },
      };
      return emit(next, { kind: "offRoute" }, "warning");
    }
  } else if (state.offRouteSince !== null) {
    next = { ...next, offRouteSince: null, offRoutePeakPerp: null };
  }
  // 방위 축은 거리 축과 독립이다. 수직거리가 임계 안이어도 확정한다 — 자기근접으로
  // 수직거리가 무너지는 갈림에서 이 축이 유일한 증거다(spec §1.2).
  if (courseVerdict === "off") {
    next = {
      ...next,
      phase: "offRoute",
      resumePhase: stepAt(route, d).isLong ? "following" : "bundle",
      lastOffRouteNoticeAt: now,
      // 거리 축 확정과 같은 상태를 남긴다 — 두 확정 경로가 서로 다른 잔여를 남기면
      // 다음 사람이 어느 쪽을 믿어야 할지 알 수 없다(무해하더라도 읽는 비용이다).
      offRouteSince: null,
      offRoutePeakPerp: null,
      offRouteAxes: { ...next.offRouteAxes, course: true },
    };
    return emit(next, { kind: "offRoute" }, "warning");
  }

  // 6) 국면·낭독.
  const cur = stepAt(route, d);
  next = {
    ...next,
    phase: cur.isLong ? "following" : "bundle",
    resumePhase: cur.isLong ? "following" : "bundle",
  };

  // 6a) 최종 접근 진입(최우선): 전 스텝 낭독 완료 AND 진입선 도달 AND 재무장
  //     (스펙 2026-08-03 §5.3 + 2026-08-08 §3.2, 리뷰 #2).
  //
  //     기하를 아는 세션의 진입선은 **경로 종점**이다. 종전 50m는 "경로 종점 = 목적지"를
  //     전제한 판단이었고, 실측에서 종점→목적지 오프셋 16~89m가 확인돼 무효화됐다 —
  //     오프셋 89m 목적지는 실제 목적지까지 139m 지점에서 경로 추종이 꺼지고 있었다.
  //
  //     ⚠ 단방향 래치다. 진입하면 0a) 가드가 이후 모든 판정을 멈추므로, 정확도가 좋아져
  //     임계가 줄어도 되돌아가지 않는다(spec §3.2 검토 #20).
  //     ⚠ **`isOff`를 직접 본다.** 5절의 early-return은 **이미 확정된** offRoute만 막고,
  //     이번 fix가 새로 이탈 판정됐지만 아직 20초 확정 유예를 못 채운 중간 상태는
  //     6절이 phase를 following으로 되돌려 놓아 그대로 통과한다. 그러면 종점 부근의
  //     노이즈 fix 하나가 이탈 확정을 우회한 채 단방향 래치를 걸 수 있다
  //     (독립 리뷰 검출). §4 전이표의 "진입 조건 ∧ offRoute 동시 = 성립 불가"를
  //     문언 그대로 참으로 만든다.
  //     ⚠ **방위 축은 여기서 다시 보지 않는다 — 순서가 곧 불변식이다.** 방위 확정
  //     블록이 위에서 무조건 return하므로 이 지점의 `courseVerdict`는 결코 "off"가
  //     아니다(타입 좁힘으로 증명된다). 그 배선을 이 블록 **뒤로** 옮기면 종점
  //     부근에서 finalApproachEnter가 먼저 반환되고, 다음 fix부터 0a 가드가 모든
  //     판정을 멈춰 확인된 이탈이 영구히 소실된다. 순서를 바꾸지 말 것.
  if (
    !isOff &&
    next.autoHandoffArmed &&
    next.announcedUpTo >= route.steps.length - 1 &&
    remainingTotal <= finalApproachEntryM(next, fix.accuracy, tuning)
  ) {
    next = { ...next, phase: "finalApproach" };
    return emit(next, { kind: "finalApproachEnter" }, null);
  }

  // 6b) 선행 낭독: 낭독 완료 유닛의 끝까지 잔여 ≤ 임박선이면 다음 유닛 전문(리뷰 #4).
  //     임박선은 max(거리 하한, v×시간 계수) — walk는 시간 계수 0이라 40m 고정 동일.
  if (next.announcedUpTo < route.steps.length - 1) {
    const announcedEnd = route.steps[next.announcedUpTo].endD;
    const announceAhead = Math.max(
      tuning.announceAheadM,
      vPrev * tuning.announceAheadSpeedS,
    );
    if (announcedEnd - d <= announceAhead) {
      const indices = unitAt(route, next.announcedUpTo + 1);
      next = {
        ...next,
        announcedUpTo: indices[indices.length - 1],
        // 임박이 나가면 그 유닛의 원거리 예고는 소비된다(뒤늦은 원거리 예고 금지).
        farNoticedUpTo: Math.max(next.farNoticedUpTo, indices[indices.length - 1]),
        lastAnnouncedAt: now,
      };
      return emit(next, { kind: "announceSteps", indices }, "ahead");
    }
  }

  // 6b') 원거리 예고(§4.3 car 전용): 다음 분기 경계선(farNoticeM)을 하향 통과하는
  //      fix에서 1회. 세션 시작·재획득 재진입이 이미 경계 안이면 크로싱이 성립하지
  //      않아 자연 생략된다. 우선순위는 임박(6b) 뒤 — 같은 fix에 둘 다 성립할 수
  //      없는 기하(구속 창 상한)지만 순서로도 보장한다.
  if (
    tuning.farNoticeM !== null &&
    next.announcedUpTo < route.steps.length - 1 &&
    next.farNoticedUpTo <= next.announcedUpTo
  ) {
    const boundary = route.steps[next.announcedUpTo].endD;
    const prevRemaining = boundary - state.d;
    const nowRemaining = boundary - d;
    if (prevRemaining > tuning.farNoticeM && nowRemaining <= tuning.farNoticeM) {
      const indices = unitAt(route, next.announcedUpTo + 1);
      next = {
        ...next,
        farNoticedUpTo: indices[indices.length - 1],
        lastAnnouncedAt: now,
      };
      // 낭독 거리는 크로싱 시점의 실측 잔여다(§4.7 "기하에서 계산" — 상수 낭독 금지,
      // 독립 리뷰 검출: 고속에서 크로싱 잔여가 경계보다 창 상한만큼 적을 수 있다).
      return emit(next, {
          kind: "farNotice",
          indices,
          remainingMeters: Math.round(nowRemaining),
        }, null);
    }
  }

  // 6c) 주기: following=구간 잔여, bundle=묶음 재통독(리뷰 #5). 기준은 lastAnnouncedAt.
  const sinceAnnounce = now - next.lastAnnouncedAt;
  if (cur.isLong) {
    const remainingStep = cur.endD - d;
    if (sinceAnnounce >= periodicIntervalS(remainingStep)) {
      next = { ...next, lastAnnouncedAt: now };
      return emit(next, {
          kind: "periodic",
          stepIndex: cur.index,
          remainingMeters: Math.round(remainingStep),
          accuracy: fix.accuracy,
        }, null);
    }
  } else if (sinceAnnounce >= BUNDLE_REREAD_S) {
    const indices = unitAt(route, cur.index);
    next = { ...next, lastAnnouncedAt: now };
    return emit(next, { kind: "bundleReread", indices }, null);
  }

  // 6d) 속도 제안(최하위, 세션당 1회 — 리뷰 #16 플래그 분리).
  if (speedGuardActive && !next.speedWarned) {
    next = { ...next, speedWarned: true };
    return emit(next, { kind: "speedSuggest" }, null);
  }
  return emit(next, null, null);
}
