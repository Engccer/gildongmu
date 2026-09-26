import Foundation

// ── 나들이 10m 비프(spec 2026-09-26 §6.5) ──
// 만보계 누적 거리가 10m 경계를 넘을 때마다 짧은 톤 한 번. 표시 행의 10m 양자화도 같은
// 함수(`outingQuantizedMeters`)를 지난다 — 비프가 난 순간 화면 숫자가 같은 칸으로 올라간다.
// ⚠ 축은 만보계 하나다. 만보계 값이 없으면 비프도 없고 GPS 거리로 대체하지 않는다(§6.5).

/// ⚠ 잠정값(spec §10). 비프 간격(만보계 거리, m).
public let outingBeepIntervalMeters = 10.0

/// 거리의 10m 양자화(내림). 음수·비유한 값은 0.
public func outingQuantizedMeters(_ meters: Double) -> Int {
    guard meters.isFinite, meters > 0 else { return 0 }
    return Int((meters / outingBeepIntervalMeters).rounded(.down) * outingBeepIntervalMeters)
}

/// 직전 값에서 현재 값으로 오는 동안 넘은 10m 경계 수. 역행·비유한 입력은 0.
/// 호출부는 0보다 크면 **한 번만** 재생한다(한 콜백에 20m가 와도 연타하지 않는다).
public func outingDistanceToneStep(previousMeters: Double, currentMeters: Double) -> Int {
    guard previousMeters.isFinite, currentMeters.isFinite, currentMeters > previousMeters else { return 0 }
    let crossed = outingQuantizedMeters(currentMeters) - outingQuantizedMeters(previousMeters)
    return max(0, crossed / Int(outingBeepIntervalMeters))
}
