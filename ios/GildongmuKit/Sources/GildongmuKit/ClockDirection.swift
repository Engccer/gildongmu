import Foundation

// 시계 방향 체계(E62·E63 공유 경계 인터페이스, spec `2026-10-03-crosswalk-guidance-design.md` §2).
// 웹 `clock-direction.ts` ↔ 안드로이드 `:kit` `ClockDirection.kt` 미러, 공유 fixture `clock-direction-cases.json`.
// 기준 방향은 호출자가 정한다(E62 횡단 = 경로의 직전 진행 방향, E63 이탈 = 사용자의 실제 진행 방위).

/// 기준 방향에서 대상 방향까지 시계 방향으로 잰 각(0° 이상 360° 미만). 입력은 북 기준 방위(°).
public func relativeBearing(reference: Double, target: Double) -> Double {
    let r = ((target - reference).truncatingRemainder(dividingBy: 360) + 360)
        .truncatingRemainder(dividingBy: 360)
    return r >= 360 ? 0 : r
}

/// 상대 방위를 30°로 반올림한 시(1~12, 0°는 12시). 반올림은 0.5 올림(`floor(x + 0.5)`) — 세 플랫폼 동일.
public func clockHour(_ relativeDegrees: Double) -> Int {
    let h = Int((relativeDegrees / 30 + 0.5).rounded(.down)) % 12
    return h == 0 ? 12 : h
}
