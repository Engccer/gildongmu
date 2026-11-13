import Foundation

// ── 출구 대기(E84, spec 2026-11-14-transit-exit-carryover-design) ──
// 지하철 말미 도보 인계가 출구 번호를 실어 왔을 때, 도보 세션의 시작 경로 조회 대기 창(`awaitingRoute`)을
// 「역 밖으로 나와 위치가 제대로 잡힐 때까지」로 늘린다. 창 안에서는 리듀서가 fix를 보지 않으므로 역 안 좌표로 만든
// 회전 안내가 나갈 자리가 없다. **창을 닫는 축은 벽시계가 아니라 증거(최근 fix)와 사용자 선언(버튼)이다.**
// 판정은 전부 이 파일의 순수 함수이고 공유 fixture `exit-hold-cases.json`이 잠근다(웹·안드로이드는 미이식).

/// 창이 이만큼 열려 있었고(잠정) **보관 가능한 fix가 최근 창 길이 이상 이어졌는데도** 수용 정확도에 들지 못하면 최근 창의
/// 최선값으로 조회한다. fix가 아예 없으면 이 상한은 걸리지 않는다 — 깊은 역사를 걷는 중일 수 있어 계속 기다린다.
/// 오래 걸어 나온 사람의 첫 보관 가능 fix에 곧바로 걸리지도 않는다(그 fix는 대개 가장 나쁜 fix다).
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
/// 창 안에서 fix가 이만큼 끊겼다가 다시 오면 「관측 공백」으로 본다(초, 잠정): 그 fix가 무이동 시계를 다시 세운다.
public let exitHoldObservationGapSeconds = 30.0

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
/// - `storableSince`: 이 fix가 속한 보관 가능 fix 연속 구간의 첫 표본 시각(`exitHoldStorableRunStart`). 보관 불가면 nil.
///
/// 순서가 계약이다: 보관 불가 → 대기 / 다른 역 → 포기 / 수용 → 조회 /
/// 상한(창 240초 ∧ 연속 구간 15초 이상) → 최근 최선값 조회 / 그 밖 → 대기.
public func exitHoldStep(
    elapsed: Double,
    fix: RouteOriginFix,
    isFirstStorable: Bool,
    stationDistance: Double?,
    recent: [ExitHoldSample],
    storableSince: Double?,
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
    if elapsed >= exitHoldMaxSeconds, let storableSince, now - storableSince >= exitHoldRecentWindowSeconds,
       let best = exitHoldRecentBest(samples: recent, now: now) {
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

/// 보관 가능 fix 연속 구간의 시작 시각. 직전 보관 가능 표본과의 간격이 최근 창을 넘으면 구간이 끊긴 것으로 보고
/// 이 fix에서 새로 시작한다(`previousSampleAt` nil = 첫 표본).
public func exitHoldStorableRunStart(previousStart: Double?, previousSampleAt: Double?, now: Double) -> Double {
    guard let previousStart, let previousSampleAt,
          now - previousSampleAt >= 0, now - previousSampleAt <= exitHoldRecentWindowSeconds
    else { return now }
    return previousStart
}

// ── 창과 잊힌 세션 안전망(`SessionIdle.swift`) ──
// 안전망의 두 시계(fix 두절·무이동)는 「마지막 fix」「마지막 진행」에서 잰다. 출구 대기 창은 그 전제를 둘 깬다:
// ① 지하 통로에서 fix가 몇 분 끊겼다가 처음 오는 fix는 진행으로 치지 않으므로(앵커만 세운다) 무이동 시계가 세션 시작부터
//    흐른 것으로 읽혀 그 fix 직후 세션이 끝난다. ② 창이 닫히며 두절 임계가 900초에서 300초로 돌아오면 창 안에서 흐른
//    시간이 곧바로 임계를 넘는다. 그래서 시계의 **하한**을 둔다: 관측 공백 뒤 첫 fix가 무이동 시계를, 창이 닫히는 순간이
//    두 시계를 다시 세운다. 출구 인계가 없는 세션은 하한이 nil이라 종전과 같다.

/// 안전망 시계의 하한. nil = 하한 없음(종전 동작).
public struct ExitHoldIdleFloors: Equatable, Sendable {
    /// fix 두절 시계의 하한(창이 닫힌 시각).
    public var fix: Double?
    /// 무이동 시계의 하한(창이 닫힌 시각 또는 관측 공백 뒤 첫 fix).
    public var progress: Double?

    public init(fix: Double? = nil, progress: Double? = nil) {
        self.fix = fix
        self.progress = progress
    }
}

/// 창 안 fix 한 건. 직전 fix(없으면 세션 시작)와의 간격이 `exitHoldObservationGapSeconds`를 넘으면 무이동 시계를 이 fix로
/// 다시 세운다. `resumed`가 참이면 호출부는 진행 앵커도 이 fix로 재설정한다(공백 전 앵커와의 변위는 관측이 아니다).
public func exitHoldIdleFloorsAfterFix(
    _ floors: ExitHoldIdleFloors, now: Double, previousFixAt: Double?, startedAt: Double
) -> (floors: ExitHoldIdleFloors, resumed: Bool) {
    let gap = now - max(startedAt, previousFixAt ?? startedAt)
    guard gap > exitHoldObservationGapSeconds else { return (floors, false) }
    var next = floors
    next.progress = now
    return (next, true)
}

/// 창이 닫히는 순간: 두 시계가 그 시각부터 새로 흐른다.
public func exitHoldIdleFloorsAfterClose(now: Double) -> ExitHoldIdleFloors {
    ExitHoldIdleFloors(fix: now, progress: now)
}

/// 안전망 시계의 기준 시각. `floor` nil이면 종전 식(`max(startedAt, last ?? startedAt)`)과 같다.
public func sessionIdleReference(startedAt: Double, last: Double?, floor: Double?) -> Double {
    max(startedAt, last ?? startedAt, floor ?? startedAt)
}

/// 도보·자동차 세션의 안전망 판정 한 자리(워치독 틱마다). 출구 대기가 없던 세션(`floors` 비어 있음 ∧ `holdActive` 거짓)은
/// 종전 식과 값이 같다. 창 동안은 ① 두절 임계가 `sessionIdleNoFixExitHoldSeconds`이고 ② 지금 관측이 끊겨 있으면
/// (마지막 fix 뒤 `exitHoldObservationGapSeconds` 초과) 무이동을 세지 않는다 — 무이동은 fix가 와야 관측된다.
public func exitHoldAwareSessionIdleStep(
    now: Double,
    startedAt: Double,
    lastFixAt: Double?,
    lastProgressAt: Double?,
    floors: ExitHoldIdleFloors,
    holdActive: Bool,
    tuning: GuideTuning,
    presumedArrivalCanFire: Bool
) -> SessionIdleReason? {
    let sinceFix = now - sessionIdleReference(startedAt: startedAt, last: lastFixAt, floor: floors.fix)
    let sinceProgress = now - sessionIdleReference(startedAt: startedAt, last: lastProgressAt, floor: floors.progress)
    let stationary: Double? = if !tuning.sessionIdleStationaryAxis {
        nil
    } else if holdActive, sinceFix > exitHoldObservationGapSeconds {
        0
    } else {
        sessionIdleStationaryElapsed(secondsSinceProgress: sinceProgress, presumedArrivalCanFire: presumedArrivalCanFire)
    }
    return sessionIdleStep(
        secondsSinceUsableFix: sinceFix,
        secondsSinceProgress: stationary,
        noFixSeconds: holdActive ? tuning.sessionIdleNoFixExitHoldSeconds : tuning.sessionIdleNoFixSeconds)
}
