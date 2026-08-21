/**
 * 안내 톤 선택(순수 함수). Kit `GuideToneLayer.swift` 미러 — 상수·분기 순서가 동일해야
 * 하고, 공유 fixture(`fixtures/tone-layer-scenarios.json`)가 양쪽 동조를 강제한다.
 *
 * **간략·상세가 같은 함수를 쓴다.** 모드 차이는 입력 조립에만 있다 — 두 모드가 각자
 * 계층 로직을 가지면 이 설계가 고치려던 부채(같은 `tick`이 간략에서 정체, 상세에서
 * 생존 하트비트라는 두 뜻)가 형태만 바꿔 남는다.
 *
 * **우선순위 중재기가 아니라 계층 순서다.** 각 단계는 배타적이고, 위 단계가 톤을 내면
 * 아래 단계의 `trendStep`을 **호출하지 않는다**. 호출하지 않으므로 앵커·추세·타이머가
 * 갱신되지 않고, "억제된 후보의 latch가 커밋되어 다음 fix에서 사라지는" 문제가
 * 구조적으로 성립하지 않는다.
 *
 * ```
 * 1. unreliable    → unreliable 톤(진입 즉시 1회 + 간격 반복)
 * 2. priorityTone  → 그 톤(상세 ahead·warning, 간략 nearby)
 * 3. eventOwned    → 침묵(이벤트가 톤 자리를 소유)
 * 4. trend         → 정지 tick / closer / farther
 * ```
 *
 * ⚠ 배타성은 추세 앵커가 정지한다는 뜻이라 복귀 시 재기준화가 필요한데, 복귀하는
 * fix에서 상위 톤이 나면 그 fix는 추세 축에 닿지 못한다. `needsRebase`를 상태에 두어
 * **추세 축에 도달하는 첫 fix**가 소비하게 한다.
 */
import { trendStep, type Trend } from "./beacon";
import type { MotionState } from "./guide-motion";

export type GuideTone =
  | "closer"
  | "farther"
  | "nearby"
  | "tick"
  | "start"
  | "stop"
  | "ahead"
  | "crosswalk"
  | "left"
  | "right"
  | "back"
  | "warning"
  | "unreliable";

/**
 * 행동 안내 톤 — 정숙 창(`QUIET_AFTER_ACTION_S`)을 여는 집합. 결정 지점 임박 5종
 * (`imminentTone`)과 이탈 경고. Kit `isActionTone` 미러.
 */
export function isActionTone(tone: GuideTone): boolean {
  switch (tone) {
    case "ahead":
    case "crosswalk":
    case "left":
    case "right":
    case "back":
    case "warning":
      return true;
    case "closer":
    case "farther":
    case "nearby":
    case "tick":
    case "start":
    case "stop":
    case "unreliable":
      return false;
  }
}

export interface TrendInput {
  /** 추세 축 거리(간략=목적지 직선거리, 상세=경로 잔여 거리). */
  distance: number;
  deadBand: number;
  /**
   * 시간 감쇠의 하한. 이보다 작은 변화는 어떤 경우에도 추세로 읽지 않는다 — 무한
   * 감쇠는 결국 GPS 지터를 톤으로 만든다. 간략은 `accuracy`, 상세는 투영 지터 하한을
   * 준다. 미지정이면 `deadBand`와 같아 **감쇠가 없다**(현행 동작).
   */
  deadBandFloor?: number;
  motion: MotionState;
  /** closer 최소 간격(초). 수단별로 가른다 — 차량은 2초 창에 매 fix 걸린다. */
  closerIntervalSeconds: number;
}

export interface ToneLayerInput {
  /** 1단계: 간략 weak·상세 uncertain/reacquiring·fix 워치독. */
  unreliable: boolean;
  /** 2단계: 이 fix가 소유한 우선 톤. */
  priorityTone: GuideTone | null;
  /** 3단계: 이벤트가 톤 자리를 소유한다(상세 event 존재). */
  eventOwned: boolean;
  /** 4단계: 추세 축 입력. null이면 추세 판정을 하지 않는다(이탈 중·투영 점프 폐기). */
  trend: TrendInput | null;
  /** 도착 종단 — tick·추세·unreliable을 억제한다. 우선 톤은 억제 대상이 아니다. */
  arrived: boolean;
  /** 호출부가 요구하는 축 재기준화(이탈 복귀·handoff 축 전환). */
  rebaseTrend: boolean;
}

export interface ToneLayerState {
  anchorDistance: number | null;
  trend: Trend;
  lastTrendToneAt: number | null;
  lastTickAt: number | null;
  lastUnreliableAt: number | null;
  wasUnreliable: boolean;
  /** 추세 축에 도달하는 첫 fix가 소비할 재기준화 예약. */
  needsRebase: boolean;
  /** 행동 안내 후 추세 톤 억제가 끝나는 시각. */
  quietUntil: number | null;
  /** 앵커가 마지막으로 **움직인** 시각. 데드밴드 시간 감쇠의 기준이다. */
  anchorSetAt: number | null;
}

export const INITIAL_TONE_LAYER_STATE: ToneLayerState = {
  anchorDistance: null,
  trend: "none",
  lastTrendToneAt: null,
  lastTickAt: null,
  lastUnreliableAt: null,
  wasUnreliable: false,
  needsRebase: false,
  quietUntil: null,
  anchorSetAt: null,
};

/** 신뢰 불가 반복 간격(초). 초기값이며 `MAX_NORMAL_SILENCE_S` 이하여야 한다. */
export const UNRELIABLE_INTERVAL_S = 10;
/** 행동 안내 후 정숙 구간(초). */
export const QUIET_AFTER_ACTION_S = 3;
export const TICK_INTERVAL_S = 3;
/** farther 간격(초). 수단별로 가르지 않는다 — 경고 축이기 때문이다. */
export const FARTHER_INTERVAL_S = 2;
export const WALK_CLOSER_INTERVAL_S = 2;
/** 차량 closer 간격(초). 초기값이며 실주행 판정 대상이다. */
export const CAR_CLOSER_INTERVAL_S = 10;
/**
 * 허용 최대 정상 침묵(초) = 데드밴드 15m ÷ 느린 구간 0.7m/s. 위원장 판정으로 계약값
 * 확정(2026-08-08). ⚠ 최소 재확인 간격 추가는 폐기한 하트비트의 재등장이라 기각됐고,
 * 데드밴드 축소는 GPS 지터 내성을 깎아 기각됐다. 되살리지 말 것.
 */
export const MAX_NORMAL_SILENCE_S = 21;
/**
 * 데드밴드 감쇠 유예(초). **계약값과 같게 둔다** — 그 안에서는 데드밴드가 원값 그대로라
 * 현행 동작이 바뀌지 않고, 계약을 넘어선 뒤에만 감쇠가 시작된다. 즉 이 장치는 계약의
 * 변경이 아니라 **계약을 지키기 위한 구현**이다.
 */
export const DEAD_BAND_GRACE_S = MAX_NORMAL_SILENCE_S;
/** 유예 이후 하한에 도달하기까지의 시간(초). */
export const DEAD_BAND_DECAY_SPAN_S = 21;

/**
 * 거리 축이 평평할 때의 데드밴드 감쇠(위원장 판정 2026-08-08). Kit `decayedDeadBand` 미러.
 *
 * **왜 필요한가**: 21초 계약의 산식(데드밴드 ÷ 느린 구간 속도)은 "목적지를 향해 직선으로
 * 이동한다"는 미명시 전제 위에 있었다. 목적지와 평행하게 걷거나 블록을 돌아가면 거리가
 * 거의 변하지 않아 hold가 무한 지속되고, moving이라 정지 tick도 안 난다(접근성 감사 H1).
 *
 * **왜 감쇠인가**: 고정 간격 재확인은 폐기한 하트비트의 재등장이고 정적 축소는 GPS 지터
 * 내성을 처음부터 깎는다 — 둘 다 기각됐다. 시간 감쇠는 초기 내성을 온전히 유지하면서
 * 실제 이동이 있으면 결국 톤이 나게 한다.
 */
export function decayedDeadBand(
  base: number,
  floor: number,
  holdSeconds: number,
): number {
  if (holdSeconds <= DEAD_BAND_GRACE_S || floor >= base) return base;
  const progress = Math.min(1, (holdSeconds - DEAD_BAND_GRACE_S) / DEAD_BAND_DECAY_SPAN_S);
  return Math.max(floor, base - (base - floor) * progress);
}

export function toneLayerStep(
  state: ToneLayerState,
  input: ToneLayerInput,
  now: number,
): { state: ToneLayerState; tone: GuideTone | null } {
  const next: ToneLayerState = { ...state };

  // 1단계 — 신뢰 불가. 도착 후에는 억제한다(목적지에 서 있는 동안 반복 금지).
  if (input.unreliable && !input.arrived) {
    next.needsRebase = true;
    // 진입 즉시 1회가 계약의 핵심이다. 간격 타이머만 두면 GPS 상실 후 최대
    // UNRELIABLE_INTERVAL_S만큼 침묵해 사용자가 이상을 늦게 안다.
    const due =
      !state.wasUnreliable ||
      now - (state.lastUnreliableAt ?? -Infinity) >= UNRELIABLE_INTERVAL_S;
    next.wasUnreliable = true;
    if (!due) return { state: next, tone: null };
    next.lastUnreliableAt = now;
    return { state: next, tone: "unreliable" };
  }
  if (state.wasUnreliable) {
    next.wasUnreliable = false;
    next.needsRebase = true;
  }
  if (input.rebaseTrend) next.needsRebase = true;

  // 2단계 — 우선 톤. 행동 안내는 정숙 구간을 연다.
  if (input.priorityTone) {
    const tone = input.priorityTone;
    if (isActionTone(tone)) {
      next.quietUntil = now + QUIET_AFTER_ACTION_S;
    }
    // 이탈 구간의 잔여 거리는 낡은 투영이라 앵커가 낡는다.
    if (tone === "warning") next.needsRebase = true;
    return { state: next, tone };
  }

  // 3단계 — 이벤트가 톤 자리를 소유.
  if (input.eventOwned) return { state: next, tone: null };

  // 4단계 — 추세 축.
  if (next.quietUntil !== null && now < next.quietUntil) return { state: next, tone: null };
  const t = input.trend;
  if (!t || input.arrived) return { state: next, tone: null };

  if (next.needsRebase) {
    next.needsRebase = false;
    next.anchorDistance = t.distance;
    next.anchorSetAt = now;
    // 회복 즉시 1회: 데드밴드 미달이어도 현재 상태를 알린다. 없으면 사용자가 회복
    // 여부를 모른 채 최대 MAX_NORMAL_SILENCE_S를 더 기다린다.
    if (t.motion === "stopped") {
      next.lastTickAt = now;
      return { state: next, tone: "tick" };
    }
    if (next.trend === "closer") {
      next.lastTrendToneAt = now;
      return { state: next, tone: "closer" };
    }
    if (next.trend === "farther") {
      next.lastTrendToneAt = now;
      return { state: next, tone: "farther" };
    }
    return { state: next, tone: null }; // 승계할 추세가 없으면 앵커만 잡는다
  }

  // 4.5 추세 축 내부 순서 — 정지가 먼저다.
  if (t.motion === "stopped") {
    if (now - (state.lastTickAt ?? -Infinity) < TICK_INTERVAL_S) {
      return { state: next, tone: null };
    }
    next.lastTickAt = now;
    return { state: next, tone: "tick" };
  }
  // ⚠ speedUnknown에서는 tick을 내지 않는다(속도를 모르는데 정지 톤은 거짓이다).
  // 침묵이 늘지만 거짓 정지보다 낫고, 지속되면 fix 워치독이 unreliable로 잡는다.

  // 앵커가 오래 제자리면 데드밴드를 점진 축소한다(평평한 거리 축의 무한 침묵 차단).
  const band = decayedDeadBand(
    t.deadBand,
    t.deadBandFloor ?? t.deadBand,
    now - (next.anchorSetAt ?? now),
  );
  const previousAnchor = next.anchorDistance;
  const stepped = trendStep(previousAnchor, next.trend, t.distance, band);
  next.anchorDistance = stepped.anchor;
  next.trend = stepped.trend;
  // ⚠ 앵커가 **처음 설정되는** 경우도 포함해야 한다(그때 kind는 hold다). kind로만
  // 판정하면 기준이 영영 null로 남아 감쇠가 작동하지 않는다 — 계약 테스트가 잡았다.
  if (stepped.anchor !== previousAnchor) next.anchorSetAt = now;
  if (stepped.kind === "hold") {
    // moving인데 데드밴드 미달인 침묵은 허용한다 — 직전 톤이 상태를 이미 알렸고,
    // 여기를 채우면 도보에서 2초마다 소리가 나 빈도 절제와 충돌한다.
    return { state: next, tone: null };
  }
  const interval =
    stepped.kind === "closer" ? t.closerIntervalSeconds : FARTHER_INTERVAL_S;
  if (now - (state.lastTrendToneAt ?? -Infinity) < interval) {
    return { state: next, tone: null };
  }
  next.lastTrendToneAt = now;
  return { state: next, tone: stepped.kind };
}
