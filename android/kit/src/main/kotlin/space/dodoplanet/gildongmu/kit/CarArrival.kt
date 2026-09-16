package space.dodoplanet.gildongmu.kit

/**
 * 자동차 도착 판정(순수) — 웹 `car-arrival.ts` ↔ Kit `CarArrival.swift` 미러, 공유 fixture `car-arrival-cases.json`.
 * spec `2026-08-23-car-guidance-completion-design.md` §6.4: **40m 안 + 도플러 정지 + 정확도 ≤ 30m** 셋 다.
 * 도보의 `distance ≤ 15`를 쓰지 않는 이유·15m 무조건 분기를 뺀 이유(옆 차로 통과 종료)는 웹 파일 주석.
 * ⚠ 적신호 정차 오판은 잠정 수용 — B1 실주행 판정 축.
 */
const val carArrivalStopMeters = 40.0
const val carArrivalMaxAccuracyMeters = 30.0

fun carArrivalStep(distance: Double, accuracy: Double, motion: MotionState): Boolean =
    motion == MotionState.stopped && accuracy <= carArrivalMaxAccuracyMeters && distance <= carArrivalStopMeters
