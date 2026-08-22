/**
 * 경로 추종형 안내 순수 리듀서 (스펙 2026-08-03 §5 정본 구현 — deterministic,
 * I/O·시계 비의존). 상태 모델·이벤트 우선순위는 스펙 §5.0, 낭독 선행·전진 후행은 §5.3.
 * Kit 미러: RouteGuide.swift — 공유 fixture(route-guide-scenarios.json)가 동조를 강제한다.
 *
 * 시간은 전부 주입된 단조 시각(now, 초)이다. Date.now() 직접 호출 금지 — 역순 fix
 * 폐기·타이머 정지 계약이 주입 시각 위에서만 성립한다(리뷰 #19).
 */
import {
  COURSE_AXIS_WINDOW_S,
  courseAxisVerdict,
  courseVote,
  recordVote,
  type CourseVote,
  type CourseVoteSample,
} from "./guide-course-axis";
import {
  deriveCourse,
  INITIAL_DERIVATION_STATE,
  type CourseDerivationState,
  type DerivedCourse,
} from "./course-derivation";
import { MAX_CAR_SPEED_MPS, MAX_WALK_SPEED_MPS } from "./guide-motion";
import {
  globalCandidates,
  projectOnPolyline,
  type GuideRoute,
  type StepSpan,
} from "./route-geometry";
import { imminentTone, walkStepAction, type GuideAction, type ImminentTone } from "./walk-action";

export { buildGuideRoute, LONG_STEP_MIN_M, type GuideRoute } from "./route-geometry";

/** 다음 안내 전문을 낭독하는 잔여 거리 — 결정 지점 앞에서 들려야 한다(리뷰 #4 선행 원칙). */
export const ANNOUNCE_AHEAD_M = 40;
/**
 * 결정 지점 **임박** 큐의 잔여 거리(m). 40m 전문 낭독이 *무엇을* 할지 알린다면
 * 이 큐는 *지금이다*를 알린다 — 위원장 실보행 피드백 2026-08-09: "모퉁이를 돌기 전,
 * 횡단보도를 건너기 전 10m에서 사운드·진동·짧은 문장으로 알려 달라".
 *
 * ⚠ **40m 낭독을 대체하지 않는다.** 짧은 명령형 전용이라 전문을 옮기면 들으면서
 * 이미 모퉁이를 지난다. 두 층은 역할이 다르다(정보 vs 타이밍). 옮긴 것은
 * **`ahead` 톤 하나**다 — 종전에는 40m 전문에 붙어 있어서 소리가 "곧 뭔가 있다"만
 * 말하고 "지금이다"는 못 말했다.
 *
 * 유도식 10 + PROJECTION_LAG_M(2026-08-11 재정의, spec §3): "실위치 여유 10m +
 * 관측 지연 보정"이라는 구조를 상수 관계로 박아, lag 재판정이 임박 시점을 자동으로
 * 함께 움직인다. 초기값 10m가 지연에 잡아먹혀 회전을 지난 뒤 발화한 위험 실사고
 * (2026-08-10)가 이 구조의 근거다. 상수는 계속 실보행 판정 대상.
 */
/**
 * 표시 계층의 투영 지연 추정(m). 실보행 2회 실측(~15m)으로 15에서 시작했으나
 * 위원장 실보행 재판정(2026-08-12, 자택↔오아시스마켓 왕복)으로 10으로
 * 하향 — 15는 실제 지연보다 크게 잡혀 표시·임박이 실위치보다 앞서갔다.
 * ⚠ **이 값의 갱신은 IMMINENT_AHEAD_M을 함께 움직이는 의도적 행동 변경이다** —
 * 실보행 재판정 없이 바꾸지 말 것. 표시 계층에 10·20을 직접 쓰면 drift다
 * (불변식 B: lag 상수와 effectiveD 유도는 이 파일 ↔ RouteGuide.swift 한 쌍에만
 * 존재한다).
 */
export const PROJECTION_LAG_M = 10;
export const IMMINENT_AHEAD_M = 10 + PROJECTION_LAG_M; // = 20 (유도식 — lag 재판정 연동)

/**
 * 표시 좌표계 유효 진행거리(spec 2026-08-11 §3). 표시 계층(guide-live-rows)의
 * 구간 선택·국면·잔여가 전부 이 좌표를 쓴다. **음성·톤·햅틱 계층은 원시 d 유지.**
 * 램프인: 지연은 이동 중 쌓이는 오차라 기준점(세션·재조회 시작 시점의 d) 직후에는
 * 걸은 거리만큼만 차오른다(F7 — 출발·재조회 직후 과소 표시 방지).
 */
export function displayEffectiveD(d: number, baselineD: number): number {
  return d + Math.min(PROJECTION_LAG_M, Math.max(0, d - baselineD));
}
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
  /**
   * 결정 지점 임박 큐의 **거리 바닥**(m). null=큐 미사용. 실제 임계는
   * `max(imminentAheadM, v×imminentAheadS)`(`announceAheadM` 구조 동형).
   *
   * walk는 20m(10 + lag)·시간 계수 0이라 종전과 같다. car는 2026-08-23 K2로 시간 축이
   * 생겼다(spec `2026-08-23-car-guidance-completion-design.md` §3.2): 15m 바닥은 속도 표본이
   * 없거나(세션 시작·정확도 20m 초과) 정지 중일 때 `v×T=0`이 `rem ≥ 0` 하한과 만나
   * 큐가 구조적으로 안 나가는 것을 막는다(실주행 p10 2.1m/s × 5초 = 10m).
   */
  imminentAheadM: number | null;
  /** 임박 큐의 시간 축(초). 임계 = max(imminentAheadM, v×이 값). walk 0. */
  imminentAheadS: number;
  /**
   * 속도 표본이 2개 미만(세션 시작·재획득 직후·정확도 배제)일 때의 임박 임계(m). walk는
   * `imminentAheadM`과 같아 종전 동일. car는 60(≈10m/s×6초) — 바닥 15m로 떨어뜨리면 터널
   * 복귀 직후 30m 앞 교차로가 침묵한다(설계 리뷰 B4).
   */
  imminentUnknownSpeedM: number;
  /**
   * 행동의 출처. `text`=문장 분류(`walkStepAction`), `step`=서버 투영 `action`만(없으면 침묵).
   * ⚠ car는 `step`이다 — 문장으로 되돌아가면 "왼쪽 옆길"·"오른쪽 방향"(갈래·시설 문장)이
   * 회전으로 분류돼 코드 판정 층을 신설한 목적이 무효가 된다(설계 리뷰 B1).
   */
  actionSource: "text" | "step";
  /**
   * 임박 큐가 전문 선행(`imminentUpTo < announcedUpTo`)을 요구하는가. walk true — "잠시 후
   * 왼쪽으로 도세요"는 무엇을 향한 회전인지 전문이 먼저 말해야 한다. car false — 명령
   * "우회전"은 자기 완결이고, 재획득·시작 직후 경계가 임계 안이면 전문을 기다리는 한 fix
   * (20m/s에서 20m)에 경계를 지나 큐가 영영 사라진다(설계 리뷰 B3). 이때 전문 래치도
   * 함께 전진한다(명령이 전문을 대신한다 — 도로 정보는 주기 통지 몫).
   */
  imminentNeedsAnnounce: boolean;
  /**
   * 공백 뒤 따라잡기 안전(K2 spec §3.4). 실주행 2026-08-22: 터널 5분 공백 뒤 구속 창이
   * fix마다 150m씩 기어가며(점프 표본이 속도 추정을 150m/s로 부풀려 창이 커진 탓에
   * 재획득도 안 걸렸다) **이미 지난 교차로 3개의 "우회전" 전문이 1초 간격으로** 나갔다.
   * 자동차에서는 위험 오안내다. 켜면 세 가지가 바뀐다: ①투영 점프(`jumped`) fix는 속도
   * 표본에 넣지 않고 6a 이후 발화를 전부 건너뛴다(창 기아가 3회 쌓여 재획득으로 넘어가
   * 전역 재투영 + 래치 재구성) ②uncertain 복귀 fix의 공백이 `REACQUIRE_GAP_S`를 넘으면
   * 복귀 대신 재획득으로 간다 ③유닛 끝이 이미 d 뒤에 있는 유닛은 전문 없이 래치만 전진.
   * 도보는 종전 동작 유지(실보행 판정이 종전을 전제 — 도보 적용은 별도 판정, `docs/BACKLOG.md`).
   */
  silentCatchUp: boolean;
  /**
   * 속도 표본 정확도 상한(m). walk 20(`SPEED_SAMPLE_MAX_ACC_M` — 계단 노이즈), car 50
   * (= uncertain 게이트. 차량은 임박 임계가 `v×T`라 표본이 끊기면 바닥 15m로 떨어져
   * 20m/s에서 0.75초가 된다 — 정확도 21~50m 구간에서 시간 축이 죽는 것이 더 위험하다).
   */
  speedSampleMaxAccM: number;
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
  /**
   * 도착 추정 자동 종료(spec 2026-08-13). **보행 전용** — 자동차는 정체 5분 정지·
   * 지하차도가 일상이라 도보 상수를 공유하면 주행 중 안내가 끊긴다(설계 리뷰 C5).
   */
  presumedArrivalEnabled: boolean;
  /**
   * 수단별 물리 속도 상한(m/s) — 투영 점프 판정의 기준. 직전 fix 대비 진행거리
   * 증가가 `maxSpeedMps × dt × 1.5`를 넘으면 투영이 튄 것이다(여유 계수 1.5 —
   * 상한 자체가 보수적이라 이중으로 좁히지 않는다).
   *
   * ⚠ **이 판정은 리듀서 소유다(A10, 2026-08-11).** 종전에는 오케스트레이터가
   * 별도 기준값(lastRemaining)으로 판정해 `finalApproachEnter`를 상태 커밋 **뒤에**
   * 거부했는데, 거부된 세션이 0a 가드 국면에 갇혀 영구 정지했다(하교 실보행 실사고 —
   * 재진입을 낼 주체가 자기가 잠근 국면 안에 갇힌다). 리듀서 안에서는 직전 d가
   * `state.d`, 직전 시각이 `state.lastFixAt`이라 별도 기준값 없이 진입 확정 **전에**
   * 같은 판정이 성립하고, 진입 이벤트와 phase 전이가 원자적이 된다.
   */
  maxSpeedMps: number;
}

export const WALK_TUNING: GuideTuning = {
  announceAheadM: ANNOUNCE_AHEAD_M,
  announceAheadSpeedS: 0,
  imminentAheadM: IMMINENT_AHEAD_M,
  imminentAheadS: 0,
  imminentUnknownSpeedM: IMMINENT_AHEAD_M,
  actionSource: "text",
  imminentNeedsAnnounce: true,
  silentCatchUp: false,
  speedSampleMaxAccM: SPEED_SAMPLE_MAX_ACC_M,
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
  presumedArrivalEnabled: true,
  maxSpeedMps: MAX_WALK_SPEED_MPS,
};

/**
 * 자동차 임박 큐 거리 바닥(m)·관측 지연(초). 시간 축 5초(위원장 판정 2026-08-23, 잠정)에
 * fix 간격 p50 1.0초(실주행 로그)를 더한다 — 도보의 `10 + PROJECTION_LAG_M` 동형.
 * ⚠ B1 실주행 판정 대상. 운전자 모드는 8초(스피커로 듣는 운전자의 반응 여유).
 */
export const CAR_IMMINENT_FLOOR_M = 15;
export const CAR_FIX_LAG_S = 1;
export const CAR_IMMINENT_AHEAD_S = 5 + CAR_FIX_LAG_S;
export const CAR_DRIVER_IMMINENT_AHEAD_S = 8 + CAR_FIX_LAG_S;
/** 속도 표본이 없을 때의 자동차 임박 임계(m) ≈ 10m/s × 6초(설계 리뷰 B4). */
export const CAR_IMMINENT_UNKNOWN_SPEED_M = 60;

/** 자동차(동승자) 초기값(스펙 §4.3 표 + K2 §3.2) — 실주행 판정까지 잠정. */
export const CAR_TUNING: GuideTuning = {
  announceAheadM: 120,
  announceAheadSpeedS: 15,
  imminentAheadM: CAR_IMMINENT_FLOOR_M,
  imminentAheadS: CAR_IMMINENT_AHEAD_S,
  imminentUnknownSpeedM: CAR_IMMINENT_UNKNOWN_SPEED_M,
  actionSource: "step",
  imminentNeedsAnnounce: false,
  silentCatchUp: true,
  speedSampleMaxAccM: UNCERTAIN_ACCURACY_M,
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
  // ⚠ 정체 5분 정지가 일상이라 도보 상수로는 주행 중 종료가 된다(설계 리뷰 C5).
  presumedArrivalEnabled: false,
  maxSpeedMps: MAX_CAR_SPEED_MPS,
};

/**
 * 운전자 모드(K2 §3.3): 리듀서에서는 임박 시간 축 하나만 다르다. "낮은 빈도"는
 * 오케스트레이터가 이벤트를 거르는 것으로 구현한다 — 여기 발화 정책을 넣으면 미러·fixture가
 * 청취자 축까지 곱해진다.
 */
export const CAR_DRIVER_TUNING: GuideTuning = {
  ...CAR_TUNING,
  imminentAheadS: CAR_DRIVER_IMMINENT_AHEAD_S,
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
  /**
   * 임박 큐를 마친 마지막 스텝 index. 항상 `imminentUpTo <= announcedUpTo`다.
   *
   * ⚠ **스텝 단위로 전진한다 — `announcedUpTo`처럼 유닛 끝으로 뛰지 않는다.**
   * 전문 낭독은 짧은 스텝들을 한 문장으로 묶어 읽지만 결정 지점은 그 묶음 **안에도**
   * 있다. 유닛 끝으로 뛰면 묶음의 첫 스텝만 분류되고 나머지 회전·횡단보도는 큐를
   * 받을 기회가 구조적으로 사라진다(6a 주석의 실측 두 건).
   *
   * ⚠ 행동이 없는 경계(단순 직진 연결)에서도 **전진한다**. 전진하지 않으면 그
   * 경계에 영원히 걸려 다음 회전의 큐가 영영 나가지 않는다.
   */
  imminentUpTo: number;
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
  /**
   * 방위 관측 유도기 버퍼(fix 이력). ⚠ 표결 창과 수명이 다르다 — 궤적은 경로의
   * 함수가 아니므로 경로 교체·재구성(§2.8)에서 비우지 않고(age 30s로 자체 소멸),
   * 새 세션에서만 초기화한다(spec §2.9).
   */
  courseDerivation: CourseDerivationState;
  /**
   * 경유지 도착선 통과 확정 래치(N4). 신뢰 가능한 fix(`!isOff && !jumped`)가 경로 위 투영으로
   * 도착선을 넘었을 때 한 번 선다. 같은 경로 세대 안에서는 `restateAt`이 승계한다.
   */
  waypointReached: boolean;
  /** 확정됐으나 같은 fix의 임박 큐에 밀려 아직 발화하지 못한 도착. 다음 fix에서 새 임박보다 먼저 나간다. */
  waypointPending: boolean;
  /**
   * uncertain 진입 시점의 **마지막 신뢰 fix 시각**(silentCatchUp ②). uncertain 분기는 불량 fix마다
   * `lastFixAt`을 갱신하므로 복귀 공백을 `lastFixAt`으로 재면 촘촘한 불량 fix(터널 acc 300m가
   * 1Hz로 오는 실측)에서 공백이 늘 ~1초라 절대 걸리지 않는다(spec 리뷰 M3). null=uncertain 아님.
   */
  uncertainSince: number | null;
}

export type GuideEvent =
  | { kind: "announceSteps"; indices: number[] }
  /**
   * 결정 지점 임박(20m) 앞. `action`은 낭독 문구를 고르는 키이고 `indices`는 **그 행동을
   * 담은 스텝 하나**다(유닛이 아니다 — 결정 지점은 유닛 안에도 있다).
   */
  | { kind: "imminent"; indices: number[]; action: GuideAction }
  | { kind: "farNotice"; indices: number[]; remainingMeters: number }
  | { kind: "periodic"; stepIndex: number; remainingMeters: number; accuracy: number }
  | { kind: "bundleReread"; indices: number[] }
  /** 경유지 도착(N4). 톤 없음 — 도착 종은 오케스트레이터 몫. */
  | { kind: "waypointReached" }
  | { kind: "finalApproachEnter" }
  | { kind: "offRoute" }
  | { kind: "backOnRoute" }
  | { kind: "uncertainEnter" }
  | { kind: "uncertainExit" }
  | { kind: "reacquiring" }
  | { kind: "reacquired" }
  | { kind: "speedSuggest" };

/**
 * 리듀서가 fix마다 내는 우선 톤. 행동 톤 5종(`imminentTone`)과 이탈 경고.
 * 톤 계층 `GuideTone`(재생 9+4종)의 부분집합이라 그대로 흘려보낸다.
 */
export type GuideTone = ImminentTone | "warning";

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
  /**
   * 이 fix가 실제로 창에 넣은 표. 이탈 중에는 `entryProjection` 기준이다.
   * 관측이 없어 표를 내지 않았으면 `undefined`다(spec §2.10 — 표 없음).
   */
  courseVote?: CourseVote;
  /** 이 fix에서 유도된 방위 관측(진단용). 없으면 null — 프로파일 게이트 통과 후 값. */
  derivedCourse?: DerivedCourse | null;
  /**
   * 이 fix의 진행거리 전진이 물리적으로 불가능했는가(투영 점프). 오케스트레이터의
   * 추세 톤 게이트가 소비한다 — 튄 잔여 거리를 추세로 읽으면 거짓 closer가 난다.
   * 판정 자체는 리듀서가 소유하고 최종 접근 진입(6b)을 한 fix 미룬다(A10).
   * 투영에 도달하지 못한 조기 반환 경로에서는 `undefined`(판정 없음).
   */
  projectionJumped?: boolean;
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

/**
 * 결정 지점 행동. 출처는 프로파일이 정한다(`actionSource`) — car는 서버 투영만 보고 문장으로
 * 되돌아가지 않는다(없으면 침묵). 공용 `stepActionFor`는 표시 계층(`guide-live-rows`)도 쓴다.
 */
export function stepActionFor(
  step: { description: string; action?: GuideAction },
  source: GuideTuning["actionSource"],
): GuideAction | null {
  return source === "step" ? (step.action ?? null) : walkStepAction(step.description);
}

function stepAt(route: GuideRoute, d: number): StepSpan {
  for (const s of route.steps) if (d < s.endD) return s;
  return route.steps[route.steps.length - 1];
}

/**
 * 임의 진행거리에서의 초기 상태(전환·재획득·재조회 리셋 공용).
 *
 * ⚠ **`courseDerivation`은 같은 세션의 재구성(재조회·brief↔detail 전환)이라면 반드시
 * 직전 상태의 버퍼를 넘긴다**(spec §2.9 — 궤적은 경로의 함수가 아니라서 경로 교체는
 * 버퍼를 비울 사유가 아니다. 비우면 갈림 직후 재조회에서 축이 ~10m 냉시동돼, A6이
 * 고치려던 "이탈 → 재조회 → 다시 잘못된 길" 반복에서 이점이 사라진다). 생략은
 * **새 세션(안내 시작)에서만** 정당하다.
 */
export function guideStateAt(
  route: GuideRoute,
  d: number,
  now: number,
  opts?: {
    autoHandoffArmed?: boolean;
    hasFinalApproachGeometry?: boolean;
    courseDerivation?: CourseDerivationState;
    waypointReached?: boolean;
    waypointPending?: boolean;
  },
): GuideState {
  const step = stepAt(route, d);
  const unit = unitAt(route, step.index);
  return {
    phase: step.isLong ? "following" : "bundle",
    resumePhase: step.isLong ? "following" : "bundle",
    d,
    stepIndex: step.index,
    announcedUpTo: unit[unit.length - 1],
    // ⚠ **유닛 끝이 아니라 지금 서 있는 스텝이다.** 지나온 것은 이 스텝의 시작
    // 결정뿐이고, 같은 유닛의 뒤쪽 스텝들은 아직 앞에 있다 — 유닛 끝으로 두면
    // 묶음 안의 회전이 통째로 사라진다. 그 스텝들의 전문은 이미 나갔으므로
    // (`announcedUpTo`가 유닛 끝) `imminentUpTo < announcedUpTo` 조건도 성립한다.
    imminentUpTo: step.index,
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
    courseDerivation: opts?.courseDerivation ?? INITIAL_DERIVATION_STATE,
    waypointReached: opts?.waypointReached ?? false,
    waypointPending: opts?.waypointPending ?? false,
    uncertainSince: null,
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
  // 유도기 버퍼는 궤적의 사실이라 재구성에서도 잇는다(spec §2.9 — 비우는 것은
  // 표결 창이지 버퍼가 아니다. 버퍼는 age 상한으로 자체 소멸한다).
  return guideStateAt(route, d, now, {
    autoHandoffArmed: prev.autoHandoffArmed,
    hasFinalApproachGeometry: prev.hasFinalApproachGeometry,
    courseDerivation: prev.courseDerivation,
    waypointReached: prev.waypointReached,
    waypointPending: prev.waypointPending,
  });
}

/** 시작 상태 + 원자 시작 발화(스펙 §5.3)에 넣을 첫 유닛. 문장 조립은 오케스트레이터 몫. */
export function initialGuideState(
  route: GuideRoute,
  now: number,
  opts?: { hasFinalApproachGeometry?: boolean; courseDerivation?: CourseDerivationState },
): { state: GuideState; firstIndices: number[] } {
  return {
    state: guideStateAt(route, 0, now, {
      hasFinalApproachGeometry: opts?.hasFinalApproachGeometry,
      // 재조회(같은 세션의 새 경로)는 직전 버퍼를 넘긴다 — guideStateAt ⚠ 참조.
      courseDerivation: opts?.courseDerivation,
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

/**
 * 이 상태에서의 임박 큐 임계(m) — 6a와 같은 식. 표시 계층(`guideLiveRows`의 `turnApproachM`)이
 * 리듀서와 같은 시점에 "잠시 후"로 넘어가도록 **한 함수**에서 낸다(K2 §4). walk는 20 고정.
 */
export function imminentAheadMeters(
  state: Pick<GuideState, "speedSamples">,
  tuning: GuideTuning,
): number {
  if (tuning.imminentAheadM === null) return 0;
  // 표본 2개 미만이면 속도를 모른다 — 0으로 두면 바닥만 남아 고속 진입에서 침묵한다.
  if (state.speedSamples.length < 2) return tuning.imminentUnknownSpeedM;
  return Math.max(tuning.imminentAheadM, estimateSpeedMps(state.speedSamples) * tuning.imminentAheadS);
}

/** 표시 좌표계의 회전 접근 전환 잔여(m) = 임박 임계 − 표시 lag(하한 0). walk는 10(`TURN_APPROACH_M`). */
export function turnApproachMeters(
  state: Pick<GuideState, "speedSamples">,
  tuning: GuideTuning,
): number {
  return Math.max(0, imminentAheadMeters(state, tuning) - PROJECTION_LAG_M);
}

function periodicIntervalS(remaining: number): number {
  if (remaining > 500) return 60;
  if (remaining >= 150) return 30;
  return 15;
}

/**
 * 방위 관측은 인자가 아니라 **리듀서가 fix 이력에서 직접 유도한다**(spec §2.9 재설계).
 * 플랫폼이 관측을 만들어 넘길 수 없는 구조가 1선 방어다 — 두 플랫폼의 유도가
 * 갈리는 drift(사슬 U·전진 게이트가 플랫폼별로 달라짐)를 시그니처가 차단한다.
 */
export function guideStep(
  state: GuideState,
  fix: GuideFix,
  route: GuideRoute,
  now: number,
  tuning: GuideTuning,
): GuideOutput {
  // 0) 역순 시각 방어: now가 과거로 가면 fix 폐기(상태 불변).
  if (state.lastFixAt !== null && now < state.lastFixAt) {
    return { state, event: null, tone: null };
  }

  // 유도기 갱신은 국면과 무관하게 매 fix 1회 — 버퍼는 궤적의 사실이다(spec §2.9).
  // finalApproach·uncertain 조기 반환보다 앞이라 어느 국면에서도 버퍼가 이어진다.
  const dv = deriveCourse(state.courseDerivation, fix, now);
  state = { ...state, courseDerivation: dv.state };
  // 프로파일 게이트는 여기 한 곳뿐이다 — 조건을 하위 분기마다 흩으면 하나를
  // 빠뜨리고, 그 하나가 조용히 축을 살린다(기존 계약 유지).
  const derived = dv.obs !== null && tuning.courseAxisEnabled ? dv.obs : null;
  // 관측이 없으면 표를 내지 않는다(spec §2.10 — 창에 안 쌓임). 대신 창은 시간으로
  // 낡는다: 정지가 길어지면 표가 말라 verdict가 unknown으로 돌아간다(§2.0 ⚠).
  const pruneVotes = (samples: readonly CourseVoteSample[]) =>
    samples.filter((s) => s.at > now - COURSE_AXIS_WINDOW_S);

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
    // 복귀 fix의 공백이 재획득 공백을 넘으면 복귀가 아니라 재획득이다(silentCatchUp ②).
    // uncertain 분기는 lastFixAt을 갱신하므로 아래 gap 검사가 이 공백을 보지 못한다 —
    // 터널 5분 뒤 resumePhase로 돌아가면 구속 창이 옛 d에서 기어가며 지난 스텝을 읽는다.
    if (
      tuning.silentCatchUp &&
      state.uncertainSince !== null &&
      now - state.uncertainSince > REACQUIRE_GAP_S
    ) {
      return {
        state: {
          ...state,
          phase: "reacquiring",
          windowEdgeHits: 0,
          speedSamples: [],
          courseVotes: [],
          lastFixAt: now,
          reacquiringFromOffRoute: state.resumePhase === "offRoute",
          reacquirePrevD: state.d,
          reacquireV: 0,
          reacquireSince: state.uncertainSince,
          uncertainSince: null,
        },
        event: { kind: "reacquiring" },
        tone: null,
      };
    }
    const s: GuideState = {
      ...state,
      phase: state.resumePhase,
      lastFixAt: now,
      lastAnnouncedAt: now,
      uncertainSince: null,
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
        // 마지막 신뢰 fix 시각을 보관한다(복귀 공백의 기준 — 불량 fix마다 갱신되는 lastFixAt 대신).
        uncertainSince: state.lastFixAt ?? now,
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
    const reVotes =
      derived === null
        ? pruneVotes(state.courseVotes)
        : recordVote(state.courseVotes, now, courseVote(derived, route.polyline, entryD));
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
  // 투영 점프: 직전 수용 fix 대비 물리 불가능한 전진(tuning.maxSpeedMps 주석 — A10).
  // 단조 전진이라 감소 방향은 없고, 재구성 직후(lastFixAt 초기화)는 기준이 없어 false다.
  // dt=0(동시각 fix)은 전진이 있을 때만 점프다 — 종전 오케스트레이터는 무조건 true였는데,
  // 전진 0을 점프로 보면 직전 fix에서 거부된 진입이 동시각 중복 fix에서도 계속 막힌다
  // (의도적 변경, 독립 리뷰 2026-08-11 확인).
  const jumped =
    state.lastFixAt !== null &&
    d - state.d > tuning.maxSpeedMps * Math.max(0, now - state.lastFixAt) * 1.5;
  // 방위 축 표결(spec §2.1). 추종 중 기준은 구속 창 투영 결과다. 관측 없으면 표 없음.
  const vote = derived === null ? null : courseVote(derived, route.polyline, d);
  const courseVotes =
    vote === null ? pruneVotes(state.courseVotes) : recordVote(state.courseVotes, now, vote);
  // 진단 계측: 이 fix가 실제로 넣은 표. 이탈 분기에서 entry 기준으로 덮인다.
  let loggedVote = vote ?? undefined;
  const emit = (s: GuideState, event: GuideEvent | null, tone: GuideTone | null): GuideOutput => ({
    state: s,
    event,
    tone,
    perpMeters: proj.perpMeters,
    courseVote: loggedVote,
    derivedCourse: derived,
    projectionJumped: jumped,
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
  //    점프 fix의 표본은 창 기아 따라잡기 속도(150m/s)라 버린다(silentCatchUp ① — 넣으면
  //    창이 부풀어 재획득이 영영 안 걸린다).
  const samples = (
    fix.accuracy > tuning.speedSampleMaxAccM || (tuning.silentCatchUp && jumped)
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
      derived === null
        ? null
        : entry.status === "ok"
          ? courseVote(derived, route.polyline, entry.d)
          : ("unknown" as CourseVote); // 관측은 있는데 기준점이 모호 — 판정 불가 표.
    const offVotes =
      offVote === null
        ? pruneVotes(state.courseVotes)
        : recordVote(state.courseVotes, now, offVote);
    next = { ...next, courseVotes: offVotes };
    loggedVote = offVote ?? undefined; // 진단: 이 국면에서 창에 들어간 표는 entry 기준이다.
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

  // W1) 경유지 도착선 통과 **감지**(N4, spec 2026-08-22-waypoint-ios §2.5). 발화와 분리한다 —
  //     같은 fix에 임박 큐가 걸리면 큐가 이기고 도착은 pending으로 남는다.
  //     ⚠ 신뢰 가능한 통과만: `!isOff` + `!jumped`. 경로가 경유지를 지나가도록 그려지므로
  //       경로 위 투영이 도착선을 넘었다는 것 자체가 증거다(좌표 근접 2중 판정 없음).
  if (
    route.waypointStepIndex !== undefined &&
    !next.waypointReached &&
    !isOff &&
    !jumped &&
    d >= route.steps[route.waypointStepIndex].startD
  ) {
    next = { ...next, waypointReached: true, waypointPending: true };
  }
  // W2) 이전 fix에서 확정됐는데 임박 큐에 밀려 못 나간 도착은 새 임박보다 먼저 나간다.
  if (state.waypointPending && next.waypointPending) {
    next = { ...next, waypointPending: false, lastAnnouncedAt: now };
    return emit(next, { kind: "waypointReached" }, null);
  }

  // J) 투영 점프 fix는 발화하지 않는다(silentCatchUp ①). 창이 기아 상태로 기어가는 중이라
  //    d가 실위치가 아니다 — 이 d로 전문·임박·주기를 내면 지난 지점을 읽는다. 상태(d·창
  //    기아 카운트)는 커밋되므로 3회 뒤 재획득이 전역 재투영으로 바로잡는다.
  if (tuning.silentCatchUp && jumped) return emit(next, null, null);

  // 6a) 결정 지점 임박 큐(20m = 10 + lag, walk 전용): 소리·진동과 짧은 명령형 한 문장으로
  //     "지금이다"를 알린다.
  //
  //     ⚠ **래치가 스텝 단위인 것이 계약이다 — 유닛 단위로 뛰면 안 된다.** 전문 낭독(6c)이
  //     유닛 단위인 이유는 짧은 스텝들을 한 문장으로 묶어 읽기 위함인데, 결정 지점은
  //     그 유닛 **안에도** 있다. 유닛 끝까지 래치를 뛰게 하면 유닛의 첫 스텝만 분류되고
  //     나머지 결정 지점은 큐를 받을 기회가 구조적으로 사라진다(실측: 자택→고우헤어
  //     경로의 유닛 [4,5]에서 [4]가 단순 이동이라 [5]의 마지막 좌회전이 통째로 침묵했다.
  //     경복궁 경로는 33·36·28m 간격 3연속 회전 중 첫 회전만 울렸다).
  //     "무엇을"은 유닛 단위, "지금이다"는 결정 지점 단위 — 같은 수열일 이유가 없다.
  //
  //     ⚠ **불변식: 전문이 나간 스텝만 큐를 받는다**(`imminentUpTo < announcedUpTo`).
  //     "잠시 후 왼쪽으로 도세요"를 무엇을 향한 회전인지 말하기 전에 내보내면 명령만
  //     남는다. 두 래치가 같으면 그 스텝은 아직 전문 전이므로 6c에 자리를 내준다.
  //
  //     ⚠ **6c(전문 낭독)보다 앞이고, 6b(최종 접근)에는 양보하지 않는다.**
  //     6c에 밀리는 것은 짧은 유닛에서 재현되므로 앞에 둔다(다음 유닛 전문 38m와 이번
  //     횡단보도 8m가 같은 fix에 걸리는데 급한 쪽은 8m다).
  //     ⚠ **알려진 한계**: 최종 접근이 먼저 래치되면 마지막 결정 지점의 큐가 사라진다.
  //     두 조건은 같은 fix에서 경쟁하는 게 아니라 거리가 달라서(최종 접근은 잔여 50m,
  //     큐는 경계 20m 앞), 블록 순서만으로는 못 막는다. **"결정 지점이 남았으면 최종
  //     접근을 미룬다"를 실제로 구현해 봤고 되돌렸다** — 이탈 판정이 마지막 50m까지
  //     연장되면서 A6 헛경고율이 2배가 됐다(실측: BIASED 2.x% → 6.7%, HARSH 10.5%,
  //     `a6-probe.test.ts` 상한 전부 초과). 도착 직전의 거짓 "경로 이탈" 경고가 놓친
  //     큐 하나보다 나쁘다. **프로덕션 영향은 좁다**: 앱은 `includeGeometry=1`을 보내
  //     진입선이 `max(10, accuracy)`라 큐가 먼저 나간다. 기하 없는 구버전 응답과
  //     `accuracy > 마지막스텝길이 + 10`인 경우에만 사라진다. A6 상수 확정 뒤 재검토
  //     대상이다(`docs/BACKLOG.md`).
  //
  //     ⚠ **경계를 이미 지났으면 발화하지 않는다**(`rem >= 0`). 하한이 없으면 uncertain
  //     구간을 지나 창이 `d`를 경계 너머로 끌어올린 fix에서 "잠시 후 왼쪽으로 도세요"가
  //     **모퉁이를 돈 뒤에** 나간다(실측: 정확도 악화 → 회복 후 d가 214m로 착지, 경계는
  //     200m). 6c의 서술문과 달리 이 문장은 시점이 박힌 명령문이라 오독의 대가가 다르다.
  //     지나친 경계는 한 fix 안에서 전부 흘려보낸다 — 한 개씩 따라잡으면 그 사이의
  //     진짜 결정 지점을 놓친다.
  //
  //     ⚠ **행동이 없는 경계에서도 래치는 전진시키고 발화만 건너뛴다.** 직진 연결마다
  //     소리를 내면 큐가 신호이기를 그만두고, 반대로 래치를 세워 두면 그 경계에 걸려
  //     다음 회전을 영영 못 알린다.
  //
  //     ⚠ `!isOff`는 6b와 같은 이유다(아래 주석) — 이 fix가 이탈로 판정됐지만 확정
  //     유예를 못 채운 중간 상태에서, 의심 중인 투영을 근거로 명령을 내지 않는다.
  //     ⚠ **임계는 거리 바닥과 시간 축의 max다**(K2 §3.2, `announceAhead` 동형). walk는
  //     시간 계수 0이라 20m 고정이고, car는 `max(15, v×6)` — 20m/s에서 120m, 정지·표본
  //     부재에서 15m. 행동은 **스텝의 `action`(서버 turnType 투영)이 있으면 그것**, 없으면
  //     문장 분류다 — 자동차 문장은 "오른쪽 방향"이 회전이 아니라 문장을 보지 않는다.
  if (tuning.imminentAheadM !== null && !isOff) {
    const imminentAhead = imminentAheadMeters(state, tuning); // vPrev와 같은 표본(직전 fix까지)
    // 전문 선행 상한: walk는 낭독된 스텝까지, car는 마지막 스텝까지(명령이 자기 완결, B3).
    const imminentCap = tuning.imminentNeedsAnnounce ? next.announcedUpTo : route.steps.length - 1;
    while (next.imminentUpTo < imminentCap && route.steps[next.imminentUpTo].endD < d) {
      next = { ...next, imminentUpTo: next.imminentUpTo + 1 };
    }
    if (
      next.imminentUpTo < imminentCap &&
      route.steps[next.imminentUpTo].endD - d <= imminentAhead
    ) {
      const target = next.imminentUpTo + 1;
      const action = stepActionFor(route.steps[target], tuning.actionSource);
      next = { ...next, imminentUpTo: target };
      if (action) {
        // 전문보다 먼저 나간 명령은 전문을 대신한다 — 래치를 같이 올려 6c가 지난 행동의
        // 전문("교차로에서 우회전 후…")을 회전 뒤에 읽지 않게 한다(car 전용 경로).
        if (next.announcedUpTo < target) {
          next = {
            ...next,
            announcedUpTo: target,
            farNoticedUpTo: Math.max(next.farNoticedUpTo, target),
          };
        }
        next = { ...next, lastAnnouncedAt: now };
        return emit(next, { kind: "imminent", indices: [target], action }, imminentTone(action));
      }
    }
  }

  // W3) 이번 fix에 확정된 도착은 임박이 나가지 않았으면 바로 나간다(6b 앞 — 최종 접근
  //     래치가 먼저 서면 0a 가드가 이후 판정을 막아 도착이 영영 소실된다).
  if (next.waypointPending) {
    next = { ...next, waypointPending: false, lastAnnouncedAt: now };
    return emit(next, { kind: "waypointReached" }, null);
  }

  // 6b) 최종 접근 진입: 전 스텝 낭독 완료 AND 진입선 도달 AND 재무장
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
  //     ⚠ **`!jumped`: 튄 잔여 거리로 진입을 확정하지 않는다**(A10, 2026-08-11 하교
  //     실사고). 종전에는 오케스트레이터가 진입 이벤트를 사후 거부했는데, phase는
  //     이미 커밋된 뒤라 0a 가드에 갇혀 세션이 영구 정지했다. 여기서 미루면 진입과
  //     phase 전이가 원자적이고, d가 유계라 반복 점프는 자기 종결된다 — 조건이
  //     참이면 다음 fix(전진 0 = 점프 아님)에서 진입한다.
  //     ⚠ **미도착 경유지가 있으면 진입하지 않는다**(N4 설계 리뷰 #1) — 경유지가 진입선
  //       안에 있으면 6b가 먼저 래치돼 도착 이벤트가 영구 소실된다.
  if (
    !isOff &&
    !jumped &&
    (route.waypointStepIndex === undefined || next.waypointReached) &&
    next.autoHandoffArmed &&
    next.announcedUpTo >= route.steps.length - 1 &&
    remainingTotal <= finalApproachEntryM(next, fix.accuracy, tuning)
  ) {
    next = { ...next, phase: "finalApproach" };
    return emit(next, { kind: "finalApproachEnter" }, null);
  }

  // 6b'') 지난 유닛 무발화 따라잡기(car, K2 §3.4): 유닛 **끝**이 이미 d 뒤에 있으면 그 유닛의
  //      결정 지점은 전부 지났다 — 전문을 내지 않고 래치 3종을 유닛 끝으로 옮긴다. 끝이 앞에
  //      있는 유닛은 6c가 정상 발화한다("지금 구간" 전문은 나간다).
  //      ⚠ 6b(최종 접근) **뒤**다. 앞에 두면 마지막 유닛을 지나쳐 착지한 fix가 전문 없이
  //        최종 접근에 든다. 뒤에 두면 그 fix는 6c가 마지막 유닛을 내고 다음 fix에서 6b에 든다.
  //      ⚠ `!isOff`: 확정 유예 중인 이탈 fix의 d로 래치를 비가역 전진시키지 않는다(설계 리뷰 B5).
  if (tuning.silentCatchUp && !isOff) {
    while (next.announcedUpTo < route.steps.length - 1) {
      const unit = unitAt(route, next.announcedUpTo + 1);
      const unitEnd = unit[unit.length - 1];
      if (route.steps[unitEnd].endD >= d) break;
      next = {
        ...next,
        announcedUpTo: unitEnd,
        imminentUpTo: unitEnd,
        farNoticedUpTo: Math.max(next.farNoticedUpTo, unitEnd),
      };
    }
  }

  // 6c) 선행 낭독: 낭독 완료 유닛의 끝까지 잔여 ≤ 임박선이면 다음 유닛 전문(리뷰 #4).
  //     임박선은 max(거리 하한, v×시간 계수) — walk는 시간 계수 0이라 40m 고정 동일.
  if (next.announcedUpTo < route.steps.length - 1) {
    const announcedEnd = route.steps[next.announcedUpTo].endD;
    const announceAhead = Math.max(
      tuning.announceAheadM,
      vPrev * tuning.announceAheadSpeedS,
    );
    if (announcedEnd - d <= announceAhead) {
      const unit = unitAt(route, next.announcedUpTo + 1);
      // car(silentCatchUp): 묶음 안에서 이미 끝난 스텝은 빼고 읽는다 — "지난 회전 전문"을
      // 묶음 단위로 되읽는 구멍(설계 리뷰 B6). 남는 것이 없으면 마지막 스텝 하나.
      const remaining = tuning.silentCatchUp ? unit.filter((i) => route.steps[i].endD >= d) : unit;
      const indices = remaining.length > 0 ? remaining : [unit[unit.length - 1]];
      next = {
        ...next,
        announcedUpTo: unit[unit.length - 1],
        // 임박이 나가면 그 유닛의 원거리 예고는 소비된다(뒤늦은 원거리 예고 금지).
        farNoticedUpTo: Math.max(next.farNoticedUpTo, unit[unit.length - 1]),
        lastAnnouncedAt: now,
      };
      // ⚠ **톤은 임박 층이 있는 프로파일에서만 뗀다.** walk는 `ahead`가 6a로 옮겨
      //   갔으므로 여기서 또 울리면 소리가 "곧 뭔가 있다"와 "지금이다" 둘 다를 뜻하게
      //   되어 신호가 흐려진다(실보행 피드백 2026-08-09). car도 2026-08-23 K2로 임박
      //   층이 생겨 같은 규칙이다 — 임박 층이 없는 프로파일이 생기면 여기가 **그 자리의
      //   유일한 소리**라 `ahead`를 들고, `QUIET_AFTER_ACTION_S` 정숙 창도 여기서 연다.
      //   ⚠ walk에서 그 정숙 구간이 40m 시점에 사라지는 것은 **아는 대가**다. 이 fix의
      //   추세음은 `eventOwned`가 막지만 다음 fix부터는 막지 않으므로, 낭독 첫 3초
      //   보호가 없어진다. 실보행 판정 대상이다(`docs/BACKLOG.md`).
      const tone = tuning.imminentAheadM === null ? "ahead" : null;
      return emit(next, { kind: "announceSteps", indices }, tone);
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
