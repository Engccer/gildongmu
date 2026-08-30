/**
 * 실시간 도보 안내 하단 2행 파생 계층 (spec 2026-08-11 §4 — 순수, I/O 비의존).
 * Kit 미러: GuideLiveRows.swift — 공유 fixture(guide-live-rows-scenarios.json)가
 * 최종 ko 문자열 수준에서 동조를 강제한다.
 *
 * 구간 선택·국면·잔여는 전부 표시 좌표계(`displayEffectiveD`)를 쓴다. 음성·톤·햅틱
 * 파이프라인(guideStep)은 원시 d를 계속 쓴다(불변식 A). 이 계층은 문자열을 만들지
 * 않고 **디스크립터**를 낸다 — i18n 렌더는 플랫폼 배선(웹 useRouteGuide ·
 * iOS GuideText)의 몫이고, 디스크립터→키 매핑 규칙은 fixture 러너와 동일해야 한다.
 *
 * 우선순위 1·2(도착·최종 접근)는 이 계층 밖이다 — 그 국면의 발화·표시 소유자는
 * 오케스트레이터의 최종 접근 층이고, 여기는 finalApproach에서 빈 행을 낸다.
 */
import { displayEffectiveD, stepActionFor, type GuidePhase, type GuideTuning } from "./route-guide";
import type { GuideRoute } from "./route-geometry";
import type { WalkAction } from "./walk-action";

/**
 * 도보 회전 접근 전환 표시 잔여(m). 표시 10 = 원시 20 = 임박 큐 시점(spec §2-4, lag 10).
 * 자동차는 임박 큐가 속도 함수(`max(15, v×6)`)라 오케스트레이터가 같은 식에서 표시 lag를
 * 뺀 값을 `guideLiveRows`의 `turnApproachM`으로 넘긴다(K2 spec §4).
 */
export const TURN_APPROACH_M = 10;
/** 예고에서 "연속 회전"으로 접는 유닛 길이(m) — 직진 창이 사실상 없는 유닛. */
export const SHORT_UNIT_PREVIEW_M = 10;

export interface LiveStepInput {
  description: string;
  startD: number;
  endD: number;
  /** 서버 구조화 조각(spec §5). 추출 실패는 부재 — 재파싱으로 채우지 않는다. */
  live?: { target?: string; anchor?: string };
  /** 서버 투영 행동(자동차 `turnType`, K2 §2.3). 있으면 문장 분류 대신 쓴다. */
  action?: WalkAction;
  /** 서버 횡단 구간 플래그(A26, `WalkRouteStep.crossing`). 부재는 "횡단 구간 아님". */
  crossing?: boolean;
}



/** 행동 경계 기준으로 병합한 표시 유닛(spec §4.1) — "직진 구간 + (있다면) 끝 행동". */
export interface DisplayUnit {
  stepIndices: number[];
  startD: number;
  endD: number;
  crossing: boolean;
  /** 횡단 유닛의 표시 문장(주석 포함 스텝 전문). 비횡단은 null. */
  crossingText: string | null;
  /** 횡단 유닛의 행동 종류(crosswalk|underpass). 비횡단은 null. */
  crossingAction: WalkAction | null;
  /** 유닛 끝 경계의 행동(다음 유닛 첫 스텝에서 유도). 최종 유닛은 null(F6). */
  endAction: WalkAction | null;
  /** 끝 행동의 기준 이름(다음 유닛 첫 스텝의 live.anchor). */
  endAnchor: string | null;
  /** 직진 목표 이름(유닛 마지막 스텝의 live.target — 병합 후 유닛의 것). */
  target: string | null;
}

/**
 * 횡단 유닛 판정 — 행동 + **서버 횡단 구간 플래그**(`WalkRouteStep.crossing`, A26).
 * 행동만으로는 부족하다: "횡단보도"는 지명으로도 등장하므로(회전 우선순위가 회전 문장은
 * 걸러 주지만, 회전 없는 "천호역 횡단보도까지 100m 이동"이 남는다) 구간 전체가 횡단인지는
 * 서버가 구조로 판정해 실어 준다. ⚠ 종전의 재작성 행동문("…건너세요") 부분 문자열 판정은
 * ko 전용이라 en 안내(Tmap 영어 문장)에서 횡단 유닛이 한 번도 서지 않았다 — 되돌리지 말 것.
 * Kit `isCrossingStep` 미러, 공유 fixture의 `crossing`이 ko 동작 불변을 잠근다.
 */
export function isCrossingStep(action: WalkAction | null, crossing: boolean | undefined): boolean {
  return (action === "crosswalk" || action === "underpass") && crossing === true;
}

/** `source`: 행동 출처(리듀서 `actionSource`와 같은 값 — 2026-08-23부터 walk·car 모두 `step`). 기본값 없음. */
export function buildDisplayUnits(
  steps: LiveStepInput[],
  source: GuideTuning["actionSource"],
): DisplayUnit[] {
  const actionOf = (step: LiveStepInput) => stepActionFor(step, source);
  const groups: { indices: number[]; crossing: boolean; action: WalkAction | null }[] = [];
  for (let i = 0; i < steps.length; i++) {
    const action = actionOf(steps[i]);
    const crossing = isCrossingStep(action, steps[i].crossing);
    const prev = groups[groups.length - 1];
    // 행동 없는 경계(지도 분할 직진)는 흡수한다(F5). 횡단 유닛은 흡수하지 않는다 —
    // 국면이 유닛 단위라 꼬리를 붙이면 다 건넌 뒤에도 "건너세요"가 남는다.
    if (i > 0 && action === null && prev && !prev.crossing) {
      prev.indices.push(i);
    } else {
      groups.push({ indices: [i], crossing, action });
    }
  }
  return groups.map((g, gi) => {
    const first = steps[g.indices[0]];
    const last = steps[g.indices[g.indices.length - 1]];
    const next = groups[gi + 1];
    const nextFirst = next ? steps[next.indices[0]] : null;
    return {
      stepIndices: g.indices,
      startD: first.startD,
      endD: last.endD,
      crossing: g.crossing,
      crossingText: g.crossing ? first.description : null,
      crossingAction: g.crossing ? g.action : null,
      // 끝 행동 = 다음 유닛 첫 스텝이 알리는 행동(횡단 유닛 진입 포함). 최종 유닛 null.
      endAction: nextFirst ? actionOf(nextFirst) : null,
      endAnchor: nextFirst?.live?.anchor ?? null,
      target: last.live?.target ?? null,
    };
  });
}

/** 리듀서 스팬(StepSpan)과 응답 스텝(live)을 index로 짝지어 표시 입력을 만든다. */
export function liveStepsFrom(
  route: GuideRoute,
  steps: { live?: { target?: string; anchor?: string }; crossing?: boolean }[],
): LiveStepInput[] {
  return route.steps.map((s) => ({
    description: s.description,
    startD: s.startD,
    endD: s.endD,
    ...(steps[s.index]?.live ? { live: steps[s.index].live } : {}),
    ...(s.action === undefined ? {} : { action: s.action }),
    ...(steps[s.index]?.crossing ? { crossing: true } : {}),
  }));
}

/** 표시 전용 소상태(spec §4) — 판정 계층 상태 신설 금지. */
export interface LiveRowsState {
  /** 직전 표시 유닛 index(단조 클램프 스코프). */
  unitIndex: number;
  /** 직전 표시 잔여(클램프 기준). */
  clamped: number;
}

export type LiveTopRow =
  | { kind: "offRoute" }
  | { kind: "reacquiring" }
  | { kind: "uncertain" }
  | { kind: "crossing"; text: string }
  | { kind: "turnIn"; meters: number; action: WalkAction } // meters ≥ 1
  | { kind: "turnSoon"; action: WalkAction } // 표시 잔여 0 = "잠시 후"(음수 표시 금지)
  | { kind: "straight"; meters: number; target: string | null };

export type LiveNextRow =
  | { kind: "action"; action: WalkAction; anchor: string | null } // 직진 국면: 현재 유닛 끝 행동
  | { kind: "straight"; meters: number; target: string | null } // 다음 유닛 직진 예고(지도 값)
  | { kind: "crossing"; action: WalkAction }
  | { kind: "turn"; action: WalkAction }; // 연속 회전

export interface LiveRowsOutput {
  state: LiveRowsState | null;
  top: LiveTopRow | null;
  next: LiveNextRow | null;
}

/** 다음 유닛 예고(종류별 — 직진 가정 금지, F11). */
function previewOf(unit: DisplayUnit): LiveNextRow {
  if (unit.crossing) return { kind: "crossing", action: unit.crossingAction ?? "crosswalk" };
  const len = Math.floor(unit.endD - unit.startD);
  // 직진 창이 사실상 없는 짧은 유닛은 길이 예고가 무의미하다 — 행동만 예고(연속 회전).
  if (len <= SHORT_UNIT_PREVIEW_M && unit.endAction) {
    return { kind: "turn", action: unit.endAction };
  }
  return { kind: "straight", meters: len, target: unit.target };
}

/**
 * 리듀서형 파생(F3): `(prevRowState, 입력) → (nextRowState, rows)`. 입력은 리듀서가
 * 이미 계산하는 값만 받는다(원시 d·국면·세션/재조회 기준점). 호출자는 표시 유닛
 * 전이 외의 리셋 지점(재조회·이탈 복귀·모드 전환)에서 prev=null + 새 baselineD를
 * 넘긴다 — 클램프·램프인이 함께 새 기준으로 시작한다.
 */
/**
 * `turnApproachM`: 회전 접근 전환 표시 잔여(m). walk는 `TURN_APPROACH_M`, car는 임박 큐와
 * 같은 식(`max(15, v×6) − 표시 lag`). 기본값 없음 — 빠뜨리면 차량 윗줄이 "잠시 후"로
 * 바뀌는 시점이 임박 큐와 어긋난다([[no-default-for-safety-parameters]]).
 */
export function guideLiveRows(
  prev: LiveRowsState | null,
  units: DisplayUnit[],
  d: number,
  baselineD: number,
  phase: GuidePhase,
  turnApproachM: number,
): LiveRowsOutput {
  if (units.length === 0) return { state: null, top: null, next: null };
  // 이탈: 両행을 비운다(F2 — 낡은 예고는 따라가게 된다). 문장은 렌더 계층의 기존 키.
  if (phase === "offRoute") return { state: null, top: { kind: "offRoute" }, next: null };
  // 최종 접근·도착(우선순위 1·2)은 이 계층 밖 — 오케스트레이터가 행을 소유한다.
  if (phase === "finalApproach") return { state: null, top: null, next: null };

  const effD = displayEffectiveD(d, baselineD);
  const found = units.findIndex((u) => effD < u.endD);
  const unitIndex = found === -1 ? units.length - 1 : found;
  const unit = units[unitIndex];
  const raw = Math.floor(Math.max(0, unit.endD - effD)); // F8: 버림
  // 단조 클램프(같은 표시 유닛 스코프). 국면 판정도 이 값으로 한다(F4) — "숫자는
  // 8인데 국면은 직진" 같은 자기모순이 구조적으로 불가능하다.
  const clamped =
    prev !== null && prev.unitIndex === unitIndex ? Math.min(prev.clamped, raw) : raw;
  const state: LiveRowsState = { unitIndex, clamped };

  // 밑국면(상태 대체와 무관한 유닛 기준 국면) — 아랫줄이 이것을 따른다(상태 중 유지).
  const isLast = unitIndex === units.length - 1;
  const turnApproach = !unit.crossing && clamped <= turnApproachM && unit.endAction !== null;
  const next: LiveNextRow | null = isLast
    ? null // 최종 유닛은 비운다(§4.3)
    : unit.crossing || turnApproach
      ? previewOf(units[unitIndex + 1]) // 행동 실행 중 → 그 행동 뒤 유닛 예고
      : { kind: "action", action: unit.endAction!, anchor: unit.endAnchor }; // 직진 중 → 끝 행동 예고

  // 상태 대체(우선순위 4·5): 윗줄만 바꾸고 아랫줄·클램프는 유지(해소 시 그 자리 복귀).
  if (phase === "reacquiring") return { state, top: { kind: "reacquiring" }, next };
  if (phase === "uncertain") return { state, top: { kind: "uncertain" }, next };

  const top: LiveTopRow = unit.crossing
    ? { kind: "crossing", text: unit.crossingText ?? "" }
    : turnApproach
      ? clamped <= 0
        ? { kind: "turnSoon", action: unit.endAction! }
        : { kind: "turnIn", meters: clamped, action: unit.endAction! }
      : { kind: "straight", meters: clamped, target: unit.target };
  return { state, top, next };
}
