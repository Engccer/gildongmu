/**
 * 경로 추종형 안내 순수 리듀서 (스펙 2026-08-03 §5 정본 구현 — deterministic,
 * I/O·시계 비의존). 상태 모델·이벤트 우선순위는 스펙 §5.0, 낭독 선행·전진 후행은 §5.3.
 * Kit 미러: RouteGuide.swift — 공유 fixture(route-guide-scenarios.json)가 동조를 강제한다.
 *
 * 시간은 전부 주입된 단조 시각(now, 초)이다. Date.now() 직접 호출 금지 — 역순 fix
 * 폐기·타이머 정지 계약이 주입 시각 위에서만 성립한다(리뷰 #19).
 */
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
export const HANDOFF_DIST_M = 50;
export const HANDOFF_REARM_M = HANDOFF_DIST_M + 20;
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

export type GuidePhase = "following" | "bundle" | "uncertain" | "reacquiring" | "offRoute";

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
   * reacquiring 진입 직전 국면이 offRoute였는가. 없으면 이탈 확정이 GPS 공백을
   * 경유하며 무통지로 소실된다 — 복귀 이벤트가 backOnRoute가 아니라 reacquired로
   * 나가 UI의 이탈 상태(재조회 버튼)가 리듀서와 어긋난 채 남는다(독립 리뷰 HIGH).
   */
  reacquiringFromOffRoute: boolean;
}

export type GuideEvent =
  | { kind: "announceSteps"; indices: number[] }
  | { kind: "periodic"; stepIndex: number; remainingMeters: number; accuracy: number }
  | { kind: "bundleReread"; indices: number[] }
  | { kind: "handoff" }
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
  opts?: { autoHandoffArmed?: boolean },
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
    reacquiringFromOffRoute: false,
  };
}

/** 시작 상태 + 원자 시작 발화(스펙 §5.3)에 넣을 첫 유닛. 문장 조립은 오케스트레이터 몫. */
export function initialGuideState(
  route: GuideRoute,
  now: number,
): { state: GuideState; firstIndices: number[] } {
  return { state: guideStateAt(route, 0, now), firstIndices: unitAt(route, 0) };
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

function periodicIntervalS(remaining: number): number {
  if (remaining > 500) return 60;
  if (remaining >= 150) return 30;
  return 15;
}

export function guideStep(
  state: GuideState,
  fix: GuideFix,
  route: GuideRoute,
  now: number,
  tuning: GuideTuning = WALK_TUNING,
): GuideOutput {
  // 0) 역순 시각 방어: now가 과거로 가면 fix 폐기(상태 불변).
  if (state.lastFixAt !== null && now < state.lastFixAt) {
    return { state, event: null, tone: null };
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
      },
      event: { kind: "uncertainEnter" },
      tone: null,
    };
  }

  // 2) reacquiring: 전역 재탐색(모호하면 유지 — 다음 fix에서 재시도).
  if (state.phase === "reacquiring") {
    const entry = entryProjection(route, fix, tuning);
    if (entry.status !== "ok") {
      return { state: { ...state, lastFixAt: now }, event: null, tone: null };
    }
    const s: GuideState = {
      ...guideStateAt(route, entry.d, now, { autoHandoffArmed: state.autoHandoffArmed }),
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
        lastFixAt: now,
        reacquiringFromOffRoute: state.phase === "offRoute",
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
  // 창 경계 적중은 "경로 위인데 창이 못 따라간" 신호일 때만 센다. 수직거리가 크면
  // 그것은 이탈 증거이지 창 기아가 아니다(두 판정이 경합하면 이탈이 영영 확정되지 않는다).
  const offThreshold = Math.max(tuning.offRouteBaseM, 2 * fix.accuracy);
  const edgeHit = proj.d >= state.d + ahead - 1 && proj.perpMeters <= offThreshold;
  const windowEdgeHits = edgeHit ? state.windowEdgeHits + 1 : 0;

  // 4) 속도 창(10초 중앙값, 리뷰 #17) — uncertain·reacquiring 밖에서만 표본 수집.
  const samples = [...state.speedSamples, { at: now, d }].filter(
    (s) => now - s.at <= SPEED_WINDOW_S,
  );
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
  if (tuning.speedSuggest && windowSpan >= SPEED_WINDOW_S * 0.8) {
    if (!speedGuardActive && median > SPEED_ENTER_MPS) speedGuardActive = true;
    else if (speedGuardActive && median < SPEED_CLEAR_MPS) speedGuardActive = false;
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
    if (entry.status === "ok") {
      const back: GuideState = {
        ...guideStateAt(route, entry.d, now, { autoHandoffArmed: state.autoHandoffArmed }),
        speedSamples: samples,
        speedGuardActive,
        speedWarned: state.speedWarned,
        lastFixAt: now,
      };
      return { state: back, event: { kind: "backOnRoute" }, tone: null };
    }
    const canRenotify =
      !speedGuardActive &&
      (state.lastOffRouteNoticeAt === null ||
        now - state.lastOffRouteNoticeAt >= tuning.offRouteRenotifyS);
    if (canRenotify) {
      next = { ...next, lastOffRouteNoticeAt: now };
      return { state: next, event: { kind: "offRoute" }, tone: "warning" };
    }
    return { state: next, event: null, tone: null };
  }
  const isOff = proj.perpMeters > offThreshold;
  if (isOff) {
    const since = state.offRouteSince ?? now;
    next = { ...next, offRouteSince: since };
    if (now - since >= tuning.offRouteHoldS) {
      next = {
        ...next,
        phase: "offRoute",
        resumePhase: stepAt(route, d).isLong ? "following" : "bundle",
        lastOffRouteNoticeAt: now,
      };
      return { state: next, event: { kind: "offRoute" }, tone: "warning" };
    }
  } else if (state.offRouteSince !== null) {
    next = { ...next, offRouteSince: null };
  }

  // 6) 국면·낭독.
  const cur = stepAt(route, d);
  next = {
    ...next,
    phase: cur.isLong ? "following" : "bundle",
    resumePhase: cur.isLong ? "following" : "bundle",
  };

  // 6a) 인계(최우선): 전 스텝 낭독 완료 AND 잔여 ≤ 50m AND 재무장(스펙 §5.3, 리뷰 #2).
  if (
    next.autoHandoffArmed &&
    next.announcedUpTo >= route.steps.length - 1 &&
    remainingTotal <= tuning.handoffDistM
  ) {
    return { state: next, event: { kind: "handoff" }, tone: null };
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
      next = { ...next, announcedUpTo: indices[indices.length - 1], lastAnnouncedAt: now };
      return { state: next, event: { kind: "announceSteps", indices }, tone: "ahead" };
    }
  }

  // 6c) 주기: following=구간 잔여, bundle=묶음 재통독(리뷰 #5). 기준은 lastAnnouncedAt.
  const sinceAnnounce = now - next.lastAnnouncedAt;
  if (cur.isLong) {
    const remainingStep = cur.endD - d;
    if (sinceAnnounce >= periodicIntervalS(remainingStep)) {
      next = { ...next, lastAnnouncedAt: now };
      return {
        state: next,
        event: {
          kind: "periodic",
          stepIndex: cur.index,
          remainingMeters: Math.round(remainingStep),
          accuracy: fix.accuracy,
        },
        tone: null,
      };
    }
  } else if (sinceAnnounce >= BUNDLE_REREAD_S) {
    const indices = unitAt(route, cur.index);
    next = { ...next, lastAnnouncedAt: now };
    return { state: next, event: { kind: "bundleReread", indices }, tone: null };
  }

  // 6d) 속도 제안(최하위, 세션당 1회 — 리뷰 #16 플래그 분리).
  if (speedGuardActive && !next.speedWarned) {
    next = { ...next, speedWarned: true };
    return { state: next, event: { kind: "speedSuggest" }, tone: null };
  }
  return { state: next, event: null, tone: null };
}
