import Foundation

// ── 잊힌 안내 세션의 국면 무관 안전망(2026-08-26) ──
// 웹 `session-idle.ts` 미러. 공유 fixture `session-idle-scenarios.json`이 동조 강제.
// 도착 추정(`FinalApproach.swift` `presumedArrivalStep`)은 최종 접근 국면에 들어간 세션만
// 정리한다 — 그 문을 못 지난 세션(GPS 두절·이탈 상태로 종점 접근·간략 강등·목적지 150m 밖
// 실내 진입)에는 종전에 어떤 상한도 없어 출근 도보 안내가 몇 시간이고 켜져 있었다.
// 이 판정은 국면을 보지 않으므로 상수가 도착 추정보다 훨씬 길다.

/// usable fix 두절이 이만큼 지속되면 세션을 끝낸다(잠정 — 실사용 재판정).
public let sessionIdleNoFixSeconds = 600.0
/// usable fix는 오는데 앵커 기준 이동이 이만큼 없으면 끝낸다.
public let sessionIdleStationarySeconds = 1200.0
/// 세션 진행 앵커 이탈 하한(m). 실내 wifi 지터가 도착 추정의 10m를 넘어 "이동"으로 읽히는 것을 막는다.
public let sessionProgressEpsilonMeters = 25.0

public enum SessionIdleReason: String, Sendable, Equatable {
    case noFix
    case stationary
}

private func finiteNonNegative(_ x: Double) -> Bool { x.isFinite && x >= 0 }

/// 판정 순서(noFix → stationary)가 계약이다 — 둘 다 성립하면 원인이 더 앞선 noFix.
/// `secondsSinceProgress` **nil = 무이동 축 없음**(자동차 — 정체·휴게소 정차와 구분할 수 없어
/// 켜지 않는다, spec 2026-08-31 §4). 축 선택은 `GuideTuning.sessionIdleStationaryAxis`.
public func sessionIdleStep(
    secondsSinceUsableFix: Double,
    secondsSinceProgress: Double?
) -> SessionIdleReason? {
    guard finiteNonNegative(secondsSinceUsableFix) else { return nil }
    if let p = secondsSinceProgress, !finiteNonNegative(p) { return nil }
    if secondsSinceUsableFix >= sessionIdleNoFixSeconds { return .noFix }
    if let p = secondsSinceProgress, p >= sessionIdleStationarySeconds { return .stationary }
    return nil
}
