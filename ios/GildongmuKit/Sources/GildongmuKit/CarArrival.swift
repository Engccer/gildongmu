import Foundation

/// 자동차 도착 판정(순수) — 웹 `car-arrival.ts` 미러, 공유 fixture `car-arrival-cases.json`.
/// spec `2026-08-23-car-guidance-completion-design.md` §6.4: **40m 안 + 도플러 정지 + 정확도 ≤ 30m**
/// 셋 다. 도보의 `distance ≤ 15`를 쓰지 않는 이유·15m 무조건 분기를 뺀 이유는 웹 파일 주석.
/// ⚠ 적신호 정차 오판은 잠정 수용 — B1 실주행 판정 축.
public let carArrivalStopMeters = 40.0
public let carArrivalMaxAccuracyMeters = 30.0

public func carArrivalStep(distance: Double, accuracy: Double, motion: MotionState) -> Bool {
    motion == .stopped && accuracy <= carArrivalMaxAccuracyMeters && distance <= carArrivalStopMeters
}
