/**
 * 잊힌 안내 세션의 **국면 무관 안전망**(2026-08-26 위원장 실사용: 출근 도보 안내를 끄지 않아
 * 몇 시간이고 켜져 있었다). 도착 추정(`final-approach.ts` `presumedArrivalStep`)은 최종 접근
 * 국면에 들어간 세션만 정리하므로, 그 문을 못 지난 세션(GPS 두절·이탈 상태로 종점 접근·
 * 간략 강등·목적지 150m 밖 실내 진입)에는 종전에 어떤 상한도 없었다. 이 판정은 국면을
 * 보지 않는다 — 그래서 상수가 도착 추정보다 훨씬 길다(경로 중간의 정상 보행을 끊으면 안 된다).
 *
 * Kit `SessionIdle.swift` 미러, 공유 fixture `session-idle-scenarios.json`. 웹은 소비자가 없다
 * (브라우저 탭은 백그라운드에서 멈춘다) — iOS `BeaconModel` 워치독이 유일한 배선.
 */

/** usable fix 두절이 이만큼 지속되면 세션을 끝낸다(잠정 — 실사용 재판정). */
export const SESSION_IDLE_NO_FIX_S = 600;
/** usable fix는 오는데 앵커 기준 이동이 이만큼 없으면 끝낸다(신호 대기·잠시 멈춤보다 훨씬 길게). */
export const SESSION_IDLE_STATIONARY_S = 1200;
/**
 * 세션 진행 앵커 이탈 하한(m). 도착 추정의 10m보다 큰 이유: 실내 wifi 측위 지터가 10m를 넘어
 * 20분 내내 "이동"으로 읽히면 이 축이 영영 안 열린다(도착 추정 spec §7 미탐 수용 사례).
 */
export const SESSION_PROGRESS_EPSILON_M = 25;

export type SessionIdleReason = "noFix" | "stationary";

export interface SessionIdleInput {
  /** 기준: max(세션 시작, 마지막 usable fix). */
  secondsSinceUsableFix: number;
  /**
   * 기준: max(세션 시작, 마지막 앵커 전진). **null = 무이동 축 없음**(자동차 — 정체·휴게소
   * 정차와 구분할 수 없어 켜지 않는다, spec 2026-08-31 §4). 축 선택은 `GuideTuning.sessionIdleStationaryAxis`.
   */
  secondsSinceProgress: number | null;
}

const finiteNonNegative = (x: number) => Number.isFinite(x) && x >= 0;

/** 판정 순서(noFix → stationary)가 계약이다 — 둘 다 성립하면 원인이 더 앞선 noFix. */
export function sessionIdleStep(input: SessionIdleInput): SessionIdleReason | null {
  if (!finiteNonNegative(input.secondsSinceUsableFix)) return null;
  if (input.secondsSinceProgress !== null && !finiteNonNegative(input.secondsSinceProgress)) return null;
  if (input.secondsSinceUsableFix >= SESSION_IDLE_NO_FIX_S) return "noFix";
  if (input.secondsSinceProgress !== null && input.secondsSinceProgress >= SESSION_IDLE_STATIONARY_S) {
    return "stationary";
  }
  return null;
}
