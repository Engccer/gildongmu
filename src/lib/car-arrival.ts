/**
 * 자동차 도착 판정(순수). Kit `CarArrival.swift` 미러 — 공유 fixture `car-arrival-cases.json`.
 * spec `2026-08-23-car-guidance-completion-design.md` §6.4(위원장 판정 ④ "목적지 부근 정차 시").
 *
 * 차량은 목적지 15m 안에 세우지 못하는 경우가 흔하다(주차장·건너편 정차). 그래서 도보의
 * `distance ≤ 15`가 아니라 **40m 안 + 정지 + 정확도 ≤ 30m**다. 셋 다 있어야 한다:
 * - 정지는 도플러 3-state의 `stopped`만이다(`speedUnknown`은 정지가 아니다).
 * - 정확도 상한은 목적지 옆 차로 통과·평행도로를 거르는 최소 방어(설계 리뷰 M3).
 * - 15m 무조건 분기는 뺐다(M4) — 옆 차로를 50km/h로 지나며 종료되던 경로. 차량은 어차피 서야 도착이다.
 * 이 판정은 최종 접근 국면 안에서만 돈다(경로 종점 150m 안 — 평행도로 오판의 1차 방어).
 * ⚠ 적신호 정차 오판은 잠정 수용 — B1 실주행 판정 축(`docs/BACKLOG.md`).
 */
import type { MotionState } from "./guide-motion";

export const CAR_ARRIVAL_STOP_M = 40;
export const CAR_ARRIVAL_MAX_ACC_M = 30;

export function carArrivalStep(distance: number, accuracy: number, motion: MotionState): boolean {
  return motion === "stopped" && accuracy <= CAR_ARRIVAL_MAX_ACC_M && distance <= CAR_ARRIVAL_STOP_M;
}
