import Foundation

// ── 나들이 10m 비프(spec 2026-09-26 §6.5) ──
// 만보계 누적 거리가 10m 경계를 넘을 때마다 짧은 톤 한 번. 걸은 거리 표시(시트 행·띠바)는 1m 단위로
// 따로 푼다(`outingDisplayMeters`, E54). 둘 다 내림이라 비프가 난 순간 화면 숫자는 그 경계 이상이다.
// ⚠ 축은 만보계 하나다. 만보계 값이 없으면 비프도 없고 GPS 거리로 대체하지 않는다(§6.5).

/// ⚠ 잠정값(spec §10). 비프 간격(만보계 거리, m).
public let outingBeepIntervalMeters = 10.0

/// 거리의 10m 양자화(내림). 음수·비유한 값은 0.
public func outingQuantizedMeters(_ meters: Double) -> Int {
    guard meters.isFinite, meters > 0 else { return 0 }
    return Int((meters / outingBeepIntervalMeters).rounded(.down) * outingBeepIntervalMeters)
}

/// 걸은 거리 표시값(1m 내림, E54). 음수·비유한 값은 0. 비프 판정에는 쓰지 않는다.
public func outingDisplayMeters(_ meters: Double) -> Int {
    guard meters.isFinite, meters > 0 else { return 0 }
    return Int(meters.rounded(.down))
}

/// 직전 값에서 현재 값으로 오는 동안 넘은 10m 경계 수. 역행·비유한 입력은 0.
/// 호출부는 0보다 크면 **한 번만** 재생한다(한 콜백에 20m가 와도 연타하지 않는다).
public func outingDistanceToneStep(previousMeters: Double, currentMeters: Double) -> Int {
    guard previousMeters.isFinite, currentMeters.isFinite, currentMeters > previousMeters else { return 0 }
    let crossed = outingQuantizedMeters(currentMeters) - outingQuantizedMeters(previousMeters)
    return max(0, crossed / Int(outingBeepIntervalMeters))
}
