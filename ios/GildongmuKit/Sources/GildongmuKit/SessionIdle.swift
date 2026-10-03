import Foundation

// ── 잊힌 안내 세션의 국면 무관 안전망(2026-08-26) ──
// 웹 `session-idle.ts` 미러. 공유 fixture `session-idle-scenarios.json`이 동조 강제.
// 도착 추정(`FinalApproach.swift` `presumedArrivalStep`)은 최종 접근 국면에 들어간 세션만
// 정리한다 — 그 문을 못 지난 세션(GPS 두절·이탈 상태로 종점 접근·간략 강등·목적지 150m 밖
// 실내 진입)에는 종전에 어떤 상한도 없어 출근 도보 안내가 몇 시간이고 켜져 있었다.
// 이 판정은 국면을 보지 않는다. 두절 축은 도착 추정보다 길고(도보 5분·자동차 15분), 무이동 축은 도착 추정과
// 같은 5분이다(2026-09-26 위원장 판정, 나들이 spec §9 · 자동차 두절 2026-10-03 위원장 판정). 같은 워치독 틱에서는 도착 추정이 먼저 판정되므로 동점이면 도착이 이긴다.

/// usable fix 두절이 이만큼 지속되면 세션을 끝낸다 — 수단별 값이고 `GuideTuning.sessionIdleNoFixSeconds`가
/// 고른다. 도보 5분(2026-09-26 위원장 판정), 자동차 15분(2026-10-03 위원장 판정 — 긴 터널·지하도로는 정상
/// 주행으로도 5분을 넘어 터널 안에서 안내가 끝났다). 웹 `SESSION_IDLE_NO_FIX_*_S` 미러.
public let sessionIdleNoFixWalkSeconds = 300.0
public let sessionIdleNoFixCarSeconds = 900.0
/// usable fix는 오는데 앵커 기준 이동이 이만큼 없으면 끝낸다(2026-09-26 위원장 판정 5분).
public let sessionIdleStationarySeconds = 300.0
/// 세션 진행 앵커 이탈 하한(m). 실내 wifi 지터가 도착 추정의 10m를 넘어 "이동"으로 읽히는 것을 막는다.
public let sessionProgressEpsilonMeters = 25.0

/// 도착 추정이 발동할 수 있는 동안(도착 창 ∧ 거리 캡 안) 무이동 축에 주는 유예(초). 끄지 않고 늦게 켠다 — 그대로면
/// 25m 앵커 시계가 10m 앵커 시계보다 먼저 차 추정 도착을 선점하고, 아예 끄면 실내 wifi 지터가 10m 앵커를 계속 밀어
/// 두 판정 모두 영영 안 끝난다(2026-09-26 구현 검증 N2). 웹 `SESSION_IDLE_ARRIVAL_GRACE_S` 미러.
public let sessionIdleArrivalGraceSeconds = 120.0

/// 무이동 축에 넣을 경과 시간 — 도착 추정이 발동할 수 있으면 유예만큼 뺀다(음수는 0). 웹 `sessionIdleStationaryElapsed` 미러.
public func sessionIdleStationaryElapsed(secondsSinceProgress: Double, presumedArrivalCanFire: Bool) -> Double {
    presumedArrivalCanFire ? max(0, secondsSinceProgress - sessionIdleArrivalGraceSeconds) : secondsSinceProgress
}

public enum SessionIdleReason: String, Sendable, Equatable {
    case noFix
    case stationary
}

private func finiteNonNegative(_ x: Double) -> Bool { x.isFinite && x >= 0 }

/// 판정 순서(noFix → stationary)가 계약이다 — 둘 다 성립하면 원인이 더 앞선 noFix.
/// `secondsSinceProgress` **nil = 무이동 축 없음**(자동차 — 정체·휴게소 정차와 구분할 수 없어
/// 켜지 않는다, spec 2026-08-31 §4). 축 선택은 `GuideTuning.sessionIdleStationaryAxis`.
/// `noFixSeconds`는 수단별 `GuideTuning.sessionIdleNoFixSeconds` — 기본값 없음(생략이 조용한 결함이 된다).
public func sessionIdleStep(
    secondsSinceUsableFix: Double,
    secondsSinceProgress: Double?,
    noFixSeconds: Double
) -> SessionIdleReason? {
    guard finiteNonNegative(secondsSinceUsableFix) else { return nil }
    if let p = secondsSinceProgress, !finiteNonNegative(p) { return nil }
    if secondsSinceUsableFix >= noFixSeconds { return .noFix }
    if let p = secondsSinceProgress, p >= sessionIdleStationarySeconds { return .stationary }
    return nil
}
