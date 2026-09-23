import Foundation

/// 옛 위치(stale-origin)의 시간 표현(순수 함수). 웹 `src/lib/stale-origin.ts`·
/// 안드로이드 `:kit` `StaleOrigin.kt`가 공유 fixture `stale-fix-age-cases.json`으로 미러한다.
/// 설계 정본 `docs/superpowers/specs/2026-09-23-stale-origin-disclosure-design.md`.

/// 표시용 경과 표현. 수량 문구는 ICU plural 키(`manualLocation.staleAge*`)가 고른다.
public enum StaleFixAge: Equatable, Sendable {
    case justNow
    case minutes(Int)
    case hours(Int)
}

/// 경과 초 → 표현. 1분 미만 `justNow`, 1~59분 `minutes`, 그 이상 `hours`(모두 내림).
/// 음수(시계 역행)는 0으로 접고, 비유한 값은 nil — 시각을 모르면 옛 위치라고 말할 수 없다.
public func staleFixAge(ageSeconds: Double) -> StaleFixAge? {
    guard ageSeconds.isFinite else { return nil }
    let minutes = Int((max(0, ageSeconds) / 60).rounded(.down))
    if minutes < 1 { return .justNow }
    if minutes < 60 { return .minutes(minutes) }
    return .hours(minutes / 60)
}
