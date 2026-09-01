/**
 * 대중교통 승차 국면 추세 톤 계층(E15 ②, spec 2026-09-02 §2) — 순수, Kit `TransitGuideTone.swift`
 * 미러. 공유 fixture `transit-guide-tone-scenarios.json`이 **리듀서 입력 단위로** 두 구현의 톤 열을
 * 잠근다(`transitGuideStep` → `transitToneStep`).
 *
 * 도보 `toneLayerStep`과 **계층 배타성**(위 단계가 반환하면 아래는 실행되지 않는다)과 **앵커
 * 비교**만 공유한다. 축이 다르다: 연속량 거리·데드밴드·감쇠·도플러 정지가 없고, 정수 정거장 수
 * 하나다(데드밴드 = 1). 정지 축은 두지 않는다 — 열차의 정차는 정상이고 독립 관측이 없어 "정지"를
 * 판정할 근거가 없다(거짓 정지 톤 금지 원칙 그대로).
 *
 * ⚠ 순서가 도보와 다르다 — **이벤트 소유가 신뢰 불가보다 앞이다.** 대중교통은 신호 전이
 * (`signalLost`·`upstreamFailed`·`signalRecovered`)가 항상 이벤트와 함께 오므로, 도보처럼
 * unreliable을 앞에 두면 한 폴에 경고음 둘(이벤트 weak + 층 unreliable)이 나고 새 재생이 앞 소리를
 * 선점해 첫 경고가 잘린다(설계 리뷰 #1). 이벤트 톤이 곧 이 층의 "우선 톤"이다.
 *
 * ⚠ 앵커는 **마지막으로 전달된 잔여**다(도보의 "상위 단계에서 앵커 불변"과 반대). 축이 정수라
 * "이벤트가 말한 값 = 앵커"가 정확히 성립하고, 옮기지 않으면 사다리 발화 직후 같은 값에 closer가
 * 나 중복 진행음이 된다.
 *
 * 웹은 이 층을 배선하지 않는다(웹 대중교통 안내는 톤 채널이 없다) — 순수 미러와 fixture만이 웹 몫이다.
 */
import type { GuideTone } from "./guide-tone-layer";
import type { TransitGuideEvent, TransitGuideState } from "./transit-guide";

/** 이 층이 낼 수 있는 톤 — 기존 소리 셋을 재사용한다(신규 파일 0). */
export type TransitToneKind = Extract<GuideTone, "closer" | "farther" | "unreliable">;

export interface TransitToneInput {
  /** `after.signal ∈ {signalLost, upstreamFailed}`. neverSeen·notYetVisible은 아니다(§2.3). */
  unreliable: boolean;
  /** 이 스텝의 리듀서 이벤트가 있다 — 이벤트가 톤 자리를 소유한다. */
  eventOwned: boolean;
  /** 추적 중(`signal == tracking`)일 때의 잔여 정거장. 그 외 null = 추세 판정 안 함. */
  remaining: number | null;
  /** 확정 도착 — 모든 톤 억제. 추정 도착은 억제하지 않는다(소실이 계속되면 경고가 계속돼야 한다). */
  arrivedCertain: boolean;
}

export interface TransitToneState {
  /** 마지막으로 전달된(이벤트 또는 톤) 잔여 정거장. */
  anchorRemaining: number | null;
  wasUnreliable: boolean;
  lastUnreliableAt: number | null;
}

export const INITIAL_TRANSIT_TONE_STATE: TransitToneState = {
  anchorRemaining: null,
  wasUnreliable: false,
  lastUnreliableAt: null,
};

/**
 * 신뢰 불가 반복 간격(초). 도보 10초보다 긴 이유는 관측 주기가 폴(15~60초)이라 그보다 촘촘한
 * 반복이 새 정보를 담지 않기 때문이다. ⚠ 잠정값 — 실승차 판정(BACKLOG E15 ②).
 */
export const TRANSIT_UNRELIABLE_INTERVAL_S = 60;

/** 순수 층(spec §2.3). `now`는 초 단위 단조 시각. */
export function transitToneLayerStep(
  state: TransitToneState,
  input: TransitToneInput,
  now: number,
): { state: TransitToneState; tone: TransitToneKind | null } {
  // 0단계 — 확정 도착. 이후 폴은 재관측 감시일 뿐이라 앵커·타이머도 건드리지 않는다.
  if (input.arrivedCertain) return { state, tone: null };

  const next: TransitToneState = { ...state };
  // 장부(항상): 신뢰 불가 진입은 타이머만 잡는다(진입 톤은 그 폴의 이벤트가 소유한다).
  // 이탈은 앵커를 현재 잔여로 옮긴다(회복 이벤트가 그 값을 말했다).
  if (input.unreliable && !state.wasUnreliable) {
    next.wasUnreliable = true;
    next.lastUnreliableAt = now;
  } else if (!input.unreliable && state.wasUnreliable) {
    next.wasUnreliable = false;
    next.anchorRemaining = input.remaining ?? state.anchorRemaining;
  }

  // 1단계 — 이벤트 소유. 이벤트가 말한 잔여가 앵커이고, 신뢰 불가 중의 이벤트는 그 소리 뒤
  // 60초 간격이 다시 시작되도록 타이머를 지금으로 되돌린다.
  if (input.eventOwned) {
    next.anchorRemaining = input.remaining ?? next.anchorRemaining;
    if (input.unreliable) next.lastUnreliableAt = now;
    return { state: next, tone: null };
  }

  // 2단계 — 신뢰 불가 반복.
  if (input.unreliable) {
    if (now - (next.lastUnreliableAt ?? -Infinity) < TRANSIT_UNRELIABLE_INTERVAL_S) {
      return { state: next, tone: null };
    }
    next.lastUnreliableAt = now;
    return { state: next, tone: "unreliable" };
  }

  // 3단계 — 추세 축(정수 정거장, 데드밴드 1).
  const remaining = input.remaining;
  if (remaining === null) return { state: next, tone: null };
  const anchor = next.anchorRemaining;
  if (anchor === null) {
    // 첫 값은 이벤트(trackingStarted)가 말한다 — 여기 도달했다면 앵커만 잡는다.
    next.anchorRemaining = remaining;
    return { state: next, tone: null };
  }
  if (remaining < anchor) {
    next.anchorRemaining = remaining;
    return { state: next, tone: "closer" };
  }
  if (remaining > anchor) {
    next.anchorRemaining = remaining;
    return { state: next, tone: "farther" };
  }
  return { state: next, tone: null };
}

/** 리듀서 결과 → 층 입력. **전부 `after`에서** 조립한다(설계 리뷰 #2). */
export function transitToneInput(
  after: TransitGuideState,
  event: TransitGuideEvent | null,
): TransitToneInput {
  return {
    unreliable: after.signal === "signalLost" || after.signal === "upstreamFailed",
    eventOwned: event !== null,
    remaining: after.signal === "tracking" ? after.remaining : null,
    arrivedCertain: after.phase === "arrived" && after.arrivedCertain,
  };
}

/**
 * 리듀서 한 스텝 뒤의 톤 판정 — 오케스트레이터가 부르는 유일한 진입점.
 *
 * - `phaseGen`이 바뀐 스텝(국면 전이 = 새 잠금·새 대상)은 층 상태를 초기화한다. 바뀌지 않는
 *   전이(도착 추정·`backOnTrack` 복귀)는 같은 열차의 같은 축이라 앵커를 유지한다.
 * - 대기·boarding·done에는 적용하지 않는다(riding·arrived만).
 */
export function transitToneStep(
  state: TransitToneState,
  before: TransitGuideState,
  after: TransitGuideState,
  event: TransitGuideEvent | null,
  now: number,
): { state: TransitToneState; tone: TransitToneKind | null } {
  const base = before.phaseGen !== after.phaseGen ? INITIAL_TRANSIT_TONE_STATE : state;
  if (after.phase !== "riding" && after.phase !== "arrived") return { state: base, tone: null };
  return transitToneLayerStep(base, transitToneInput(after, event), now);
}
