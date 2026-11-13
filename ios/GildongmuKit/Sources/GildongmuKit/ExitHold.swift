import Foundation

// ── 출구 대기(E84, spec 2026-11-14-transit-exit-carryover-design) ──
// 지하철 말미 도보 인계가 출구 번호를 실어 왔을 때, 도보 세션의 시작 경로 조회 대기 창(`awaitingRoute`)을
// 「역 밖으로 나와 위치가 제대로 잡힐 때까지」로 늘린다. 창 안에서는 리듀서가 fix를 보지 않으므로 역 안 좌표로 만든
// 회전 안내가 나갈 자리가 없다. **창을 닫는 축은 벽시계가 아니라 증거(최근 fix)와 사용자 선언(버튼)이다.**
// 판정은 전부 이 파일의 순수 함수이고 공유 fixture `exit-hold-cases.json`이 잠근다(웹·안드로이드는 미이식).

/// 보관 가능한 fix는 오는데 수용 정확도에 들지 못하는 상태가 이만큼 이어지면 최근 창의 최선값으로 조회한다(잠정).
/// fix가 아예 없으면 이 상한은 걸리지 않는다 — 깊은 역사를 걷는 중일 수 있어 계속 기다린다.
public let exitHoldMaxSeconds = 240.0
/// 상한에서 쓸 최선값 후보의 창(초). 창 전체의 최선값은 몇 분 전 승강장 좌표일 수 있다 — 종전 시작 대기 상한과 같은 15초.
public let exitHoldRecentWindowSeconds = 15.0
/// 창 안 첫 보관 가능 fix가 하차역에서 이 거리 + 정확도보다 멀면 다른 역에서 내린 것으로 보고 출구 대기를 버린다(잠정).
public let exitHoldStationMaxMeters = 600.0
/// 단독 출구 통지를 게시한 뒤 이 시간 안에 나가는 시작류 통지는 출구 문장을 접두로 다시 싣는다(잠정) — `.high` 시작
/// 통지가 말하는 중인 단독 통지를 끊기 때문이다. 발화 끝 신호에 걸지 않는다(짝이 늦으면 판정이 흔들린다).
public let exitLeadRepeatWindowSeconds = 4.0
/// 창 동안 잊힌 세션 안전망의 fix 두절 임계(초, 잠정). `GuideTuning.sessionIdleNoFixExitHoldSeconds`가 싣는다.
public let exitHoldSessionIdleNoFixSeconds = 900.0

/// 창 안에서 받은 보관 가능 fix 하나와 받은 시각(단조 초).
public struct ExitHoldSample: Equatable, Sendable {
    public var fix: RouteOriginFix
    public var at: Double

    public init(fix: RouteOriginFix, at: Double) {
        self.fix = fix
        self.at = at
    }
}

public enum ExitHoldFetchReason: String, Equatable, Sendable {
    /// 수용 정확도·나이를 통과한 fix(역 밖으로 나온 것으로 본다).
    case accepted
    /// 상한에 닿아 최근 창의 최선값으로.
    case recentBest
}

public enum ExitHoldDecision: Equatable, Sendable {
    /// 계속 기다린다.
    case wait
    /// 이 좌표로 지금 조회한다.
    case fetch(RouteOriginFix, reason: ExitHoldFetchReason)
    /// 하차역 근처가 아니다 — 출구 대기를 버리고 종전 시작 흐름으로.
    case abandon
}

/// 보관 가능한 fix인가(창의 표본·「첫 fix」 판정이 같은 술어를 쓴다).
public func exitHoldStorable(_ fix: RouteOriginFix) -> Bool {
    isStorableFix(accuracy: fix.accuracy, age: fix.ageSeconds)
}

/// 최근 창(`exitHoldRecentWindowSeconds`) 안 표본 중 가장 정확한 것. 나이는 소비 시점 기준으로 더한다.
public func exitHoldRecentBest(samples: [ExitHoldSample], now: Double) -> RouteOriginFix? {
    var best: ExitHoldSample?
    for sample in samples where now - sample.at >= 0 && now - sample.at <= exitHoldRecentWindowSeconds {
        if isBetterFix(sample.fix.accuracy, than: best?.fix.accuracy) { best = sample }
    }
    guard var fix = best?.fix, let at = best?.at else { return nil }
    fix.ageSeconds += now - at
    return fix
}

/// 출구 대기 창의 fix 한 건 판정.
///
/// - `elapsed`: 창이 열린 뒤 경과(초).
/// - `isFirstStorable`: 이 fix가 창 안에서 처음 받은 보관 가능 fix인가(다른 역 판정은 그 한 번만 한다).
/// - `stationDistance`: 이 fix에서 하차역까지 직선 거리(m). 역 좌표를 모르면 nil(다른 역 판정을 하지 않는다).
/// - `recent`: 이 fix를 **포함한** 창 안 표본.
///
/// 순서가 계약이다: 보관 불가 → 대기 / 다른 역 → 포기 / 수용 → 조회 / 상한 → 최근 최선값 조회 / 그 밖 → 대기.
public func exitHoldStep(
    elapsed: Double,
    fix: RouteOriginFix,
    isFirstStorable: Bool,
    stationDistance: Double?,
    recent: [ExitHoldSample],
    now: Double
) -> ExitHoldDecision {
    guard exitHoldStorable(fix) else { return .wait }
    if isFirstStorable, let stationDistance, stationDistance.isFinite,
       stationDistance > exitHoldStationMaxMeters + fix.accuracy {
        return .abandon
    }
    if case let .fetch(origin) = routeOriginStep(best: nil, fix: fix) {
        return .fetch(origin, reason: .accepted)
    }
    if elapsed >= exitHoldMaxSeconds, let best = exitHoldRecentBest(samples: recent, now: now) {
        return .fetch(best, reason: .recentBest)
    }
    return .wait
}

/// 시작류 통지(시작 요약·간략 강등 문장)에 출구 문장을 접두로 다시 실을 것인가.
/// 단독 통지가 버려졌거나(억제·백그라운드) 게시한 지 `exitLeadRepeatWindowSeconds`가 안 됐으면 참.
/// `secondsSincePosted` nil = 아직 게시하지 못했다.
public func exitLeadPrefixNeeded(hasExit: Bool, dropped: Bool, secondsSincePosted: Double?) -> Bool {
    guard hasExit else { return false }
    if dropped { return true }
    guard let secondsSincePosted else { return true }
    return secondsSincePosted < exitLeadRepeatWindowSeconds
}

/// 출구 대기 창의 무이동 축 경과. 무이동은 fix가 와야 관측된다 — fix가 끊긴 시간(지하 통로)은 「멈춰 있었다」의
/// 증거가 아니므로 뺀다(끊긴 시간은 두절 축이 따로 센다). fix가 계속 오면 종전 값과 같다.
public func exitHoldStationaryElapsed(secondsSinceProgress: Double, secondsSinceFix: Double) -> Double {
    max(0, secondsSinceProgress - max(0, secondsSinceFix))
}
