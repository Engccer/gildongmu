import Foundation

/// 경로 추종형 안내 순수 리듀서 — 웹 정본 `src/lib/route-guide.ts`의 1:1 미러
/// (스펙 2026-08-03 §5). 공유 fixture(route-guide-scenarios.json)가 동조를 강제한다.
///
/// 시간은 전부 주입된 단조 시각(now, 초)이다. Date() 직접 호출 금지 — 역순 fix
/// 폐기·타이머 정지 계약이 주입 시각 위에서만 성립한다.

/// 다음 안내 전문을 낭독하는 잔여 거리 — 결정 지점 앞에서 들려야 한다(낭독 선행 원칙).
public let announceAheadMeters = 40.0
public let advanceMarginBaseMeters = 15.0
public let handoffDistMeters = 50.0
public let handoffRearmMeters = handoffDistMeters + 20
public let uncertainAccuracyMeters = 50.0
public let offRouteBaseMeters = 30.0
public let offRouteHoldSeconds = 20.0
public let offRouteRenotifySeconds = 60.0
public let reacquireGapSeconds = 10.0
public let windowBackMeters = 20.0
public let windowAheadMinMeters = 50.0
public let edgeHitsMax = 3
public let speedEnterMps = 3.0
public let speedClearMps = 2.0
public let speedWindowSeconds = 10.0
public let resolveTimeoutSeconds = 30.0
public let bundleRereadSeconds = 15.0

public enum GuidePhase: Sendable, Equatable {
    case following, bundle, uncertain, reacquiring, offRoute
}

public struct GuideFix: Sendable, Equatable {
    public let lat: Double
    public let lng: Double
    public let accuracy: Double

    public init(lat: Double, lng: Double, accuracy: Double) {
        self.lat = lat
        self.lng = lng
        self.accuracy = accuracy
    }

    var point: RoutePoint { RoutePoint(lat: lat, lng: lng) }
}

public struct GuideSpeedSample: Sendable, Equatable {
    public let at: Double
    public let d: Double
}

public struct GuideState: Sendable, Equatable {
    public var phase: GuidePhase
    /// uncertain·reacquiring·offRoute에서 복귀할 기본 국면(following 또는 bundle).
    public var resumePhase: GuidePhase
    public var d: Double
    public var stepIndex: Int
    /// 낭독 완료된 마지막 스텝 index(선행 낭독 포함).
    public var announcedUpTo: Int
    /// 어떤 발화든 갱신 — 주기 통지의 기준.
    public var lastAnnouncedAt: Double
    public var lastFixAt: Double?
    public var windowEdgeHits: Int
    public var offRouteSince: Double?
    public var lastOffRouteNoticeAt: Double?
    public var speedSamples: [GuideSpeedSample]
    public var speedGuardActive: Bool
    public var speedWarned: Bool
    /// 자동 인계 무장 여부. 수동 상세 복귀 후엔 재무장선(70m) 밖으로 나가야 true.
    public var autoHandoffArmed: Bool
}

public enum GuideEvent: Sendable, Equatable {
    case announceSteps([Int])
    case periodic(stepIndex: Int, remainingMeters: Int, accuracy: Double)
    case bundleReread([Int])
    case handoff
    case offRoute
    case backOnRoute
    case uncertainEnter
    case uncertainExit
    case reacquiring
    case reacquired
    case speedSuggest
}

public enum GuideTone: Sendable, Equatable {
    case ahead, warning
}

public struct GuideOutput: Sendable, Equatable {
    public let state: GuideState
    public let event: GuideEvent?
    public let tone: GuideTone?
}

/// 스텝 index가 속한 유닛(긴 스텝=자기 하나, 짧은 스텝=연속 묶음 전체)의 index 목록.
public func unitAt(route: GuideRoute, index: Int) -> [Int] {
    guard index >= 0, index < route.steps.count else { return [] }
    if route.steps[index].isLong { return [index] }
    var a = index
    var b = index
    while a > 0 && !route.steps[a - 1].isLong { a -= 1 }
    while b < route.steps.count - 1 && !route.steps[b + 1].isLong { b += 1 }
    return route.steps[a...b].map(\.index)
}

private func stepAt(route: GuideRoute, d: Double) -> GuideStepSpan {
    for s in route.steps where d < s.endD { return s }
    return route.steps[route.steps.count - 1]
}

/// 임의 진행거리에서의 초기 상태(전환·재획득·재조회 리셋 공용).
public func guideStateAt(
    route: GuideRoute, d: Double, now: Double, autoHandoffArmed: Bool = true
) -> GuideState {
    let step = stepAt(route: route, d: d)
    let unit = unitAt(route: route, index: step.index)
    return GuideState(
        phase: step.isLong ? .following : .bundle,
        resumePhase: step.isLong ? .following : .bundle,
        d: d,
        stepIndex: step.index,
        announcedUpTo: unit[unit.count - 1],
        lastAnnouncedAt: now,
        lastFixAt: nil,
        windowEdgeHits: 0,
        offRouteSince: nil,
        lastOffRouteNoticeAt: nil,
        speedSamples: [],
        speedGuardActive: false,
        speedWarned: false,
        autoHandoffArmed: autoHandoffArmed
    )
}

/// 시작 상태 + 원자 시작 발화(스펙 §5.3)에 넣을 첫 유닛. 문장 조립은 오케스트레이터 몫.
public func initialGuideState(
    route: GuideRoute, now: Double
) -> (state: GuideState, firstIndices: [Int]) {
    (guideStateAt(route: route, d: 0, now: now), unitAt(route: route, index: 0))
}

public enum GuideEntryProjection: Sendable, Equatable {
    case ok(d: Double)
    case ambiguous
    case none
}

/// 간략→상세 전환·재조회 후 초기 투영(스펙 §6). 후보가 복수면 확정하지 않는다 —
/// 잘못 고른 후보도 폴리라인 위라 수직거리 이탈 판정이 영영 못 잡는다.
public func entryProjection(route: GuideRoute, fix: GuideFix) -> GuideEntryProjection {
    let maxPerp = max(offRouteBaseMeters, 2 * fix.accuracy)
    let cands = globalCandidates(route.polyline, p: fix.point, maxPerp: maxPerp)
    if cands.isEmpty { return .none }
    if cands.count > 1 { return .ambiguous }
    return .ok(d: cands[0].d)
}

private func periodicIntervalSeconds(remaining: Double) -> Double {
    if remaining > 500 { return 60 }
    if remaining >= 150 { return 30 }
    return 15
}

public func guideStep(
    state: GuideState, fix: GuideFix, route: GuideRoute, now: Double
) -> GuideOutput {
    // 0) 역순 시각 방어: now가 과거로 가면 fix 폐기(상태 불변).
    if let last = state.lastFixAt, now < last {
        return GuideOutput(state: state, event: nil, tone: nil)
    }

    // 1) uncertain 게이트(정확도 무효 포함): 자동 낭독·타이머 전부 정지.
    let accBad = !(fix.accuracy > 0) || fix.accuracy > uncertainAccuracyMeters
    if state.phase == .uncertain {
        if accBad {
            var s = state
            s.lastFixAt = now
            return GuideOutput(state: s, event: nil, tone: nil)
        }
        var s = state
        s.phase = state.resumePhase
        s.lastFixAt = now
        s.lastAnnouncedAt = now
        return GuideOutput(state: s, event: .uncertainExit, tone: nil)
    }
    if accBad {
        var s = state
        s.phase = .uncertain
        s.lastFixAt = now
        s.speedSamples = []
        return GuideOutput(state: s, event: .uncertainEnter, tone: nil)
    }

    // 2) reacquiring: 전역 재탐색(모호하면 유지 — 다음 fix에서 재시도).
    if state.phase == .reacquiring {
        guard case let .ok(d) = entryProjection(route: route, fix: fix) else {
            var s = state
            s.lastFixAt = now
            return GuideOutput(state: s, event: nil, tone: nil)
        }
        var s = guideStateAt(route: route, d: d, now: now, autoHandoffArmed: state.autoHandoffArmed)
        s.speedWarned = state.speedWarned
        s.lastFixAt = now
        return GuideOutput(state: s, event: .reacquired, tone: nil)
    }
    let gap = state.lastFixAt.map { now - $0 > reacquireGapSeconds } ?? false
    if gap || state.windowEdgeHits >= edgeHitsMax {
        var s = state
        s.phase = .reacquiring
        s.windowEdgeHits = 0
        s.speedSamples = []
        s.lastFixAt = now
        return GuideOutput(state: s, event: .reacquiring, tone: nil)
    }

    // 3) 구속 창 투영 + 단조 전진(스펙 §5.1).
    let ahead = max(windowAheadMinMeters, 3 * fix.accuracy)
    guard let proj = projectOnPolyline(
        route.polyline, p: fix.point, fromD: state.d - windowBackMeters, toD: state.d + ahead
    ) else {
        var s = state
        s.lastFixAt = now
        return GuideOutput(state: s, event: nil, tone: nil)
    }
    let d = max(state.d, proj.d)
    // 창 경계 적중은 "경로 위인데 창이 못 따라간" 신호일 때만 센다. 수직거리가 크면
    // 그것은 이탈 증거이지 창 기아가 아니다.
    let offThreshold = max(offRouteBaseMeters, 2 * fix.accuracy)
    let edgeHit = proj.d >= state.d + ahead - 1 && proj.perpMeters <= offThreshold
    let windowEdgeHits = edgeHit ? state.windowEdgeHits + 1 : 0

    // 4) 속도 창(10초 중앙값) — uncertain·reacquiring 밖에서만 표본 수집.
    var samples = state.speedSamples
    samples.append(GuideSpeedSample(at: now, d: d))
    samples.removeAll { now - $0.at > speedWindowSeconds }
    var speeds: [Double] = []
    for i in 1..<max(samples.count, 1) where samples[i].at > samples[i - 1].at {
        speeds.append((samples[i].d - samples[i - 1].d) / (samples[i].at - samples[i - 1].at))
    }
    speeds.sort()
    let median = speeds.isEmpty ? 0 : speeds[speeds.count / 2]
    let windowSpan = samples.count >= 2 ? samples[samples.count - 1].at - samples[0].at : 0
    var speedGuardActive = state.speedGuardActive
    if windowSpan >= speedWindowSeconds * 0.8 {
        if !speedGuardActive && median > speedEnterMps {
            speedGuardActive = true
        } else if speedGuardActive && median < speedClearMps {
            speedGuardActive = false
        }
    }

    let remainingTotal = route.totalMeters - d
    var next = state
    next.d = d
    next.stepIndex = stepAt(route: route, d: d).index
    next.lastFixAt = now
    next.windowEdgeHits = windowEdgeHits
    next.speedSamples = samples
    next.speedGuardActive = speedGuardActive
    // 재무장: 수동 복귀 세션은 잔여가 재무장선 밖으로 나가야 자동 인계 허용.
    if !next.autoHandoffArmed && remainingTotal > handoffRearmMeters {
        next.autoHandoffArmed = true
    }

    // 5) 이탈 판정(스펙 §5.6).
    if state.phase == .offRoute {
        // 이탈 중 복귀 감지는 구속 창이 아니라 전역 후보로 한다. 이탈 동안 창이 뒤에
        // 머물러, 사용자가 경로 앞쪽으로 복귀해도 창 안 투영으로는 영영 못 잡는다.
        if case let .ok(entryD) = entryProjection(route: route, fix: fix) {
            var back = guideStateAt(
                route: route, d: entryD, now: now, autoHandoffArmed: state.autoHandoffArmed
            )
            back.speedSamples = samples
            back.speedGuardActive = speedGuardActive
            back.speedWarned = state.speedWarned
            back.lastFixAt = now
            return GuideOutput(state: back, event: .backOnRoute, tone: nil)
        }
        let canRenotify = !speedGuardActive &&
            (state.lastOffRouteNoticeAt.map { now - $0 >= offRouteRenotifySeconds } ?? true)
        if canRenotify {
            next.lastOffRouteNoticeAt = now
            return GuideOutput(state: next, event: .offRoute, tone: .warning)
        }
        return GuideOutput(state: next, event: nil, tone: nil)
    }
    let isOff = proj.perpMeters > offThreshold
    if isOff {
        let since = state.offRouteSince ?? now
        next.offRouteSince = since
        if now - since >= offRouteHoldSeconds {
            next.phase = .offRoute
            next.resumePhase = stepAt(route: route, d: d).isLong ? .following : .bundle
            next.lastOffRouteNoticeAt = now
            return GuideOutput(state: next, event: .offRoute, tone: .warning)
        }
    } else if state.offRouteSince != nil {
        next.offRouteSince = nil
    }

    // 6) 국면·낭독.
    let cur = stepAt(route: route, d: d)
    next.phase = cur.isLong ? .following : .bundle
    next.resumePhase = cur.isLong ? .following : .bundle

    // 6a) 인계(최우선): 전 스텝 낭독 완료 AND 잔여 ≤ 50m AND 재무장(스펙 §5.3).
    if next.autoHandoffArmed,
       next.announcedUpTo >= route.steps.count - 1,
       remainingTotal <= handoffDistMeters {
        return GuideOutput(state: next, event: .handoff, tone: nil)
    }

    // 6b) 선행 낭독: 낭독 완료 유닛의 끝까지 잔여 ≤ 40m면 다음 유닛 전문.
    if next.announcedUpTo < route.steps.count - 1 {
        let announcedEnd = route.steps[next.announcedUpTo].endD
        if announcedEnd - d <= announceAheadMeters {
            let indices = unitAt(route: route, index: next.announcedUpTo + 1)
            next.announcedUpTo = indices[indices.count - 1]
            next.lastAnnouncedAt = now
            return GuideOutput(state: next, event: .announceSteps(indices), tone: .ahead)
        }
    }

    // 6c) 주기: following=구간 잔여, bundle=묶음 재통독. 기준은 lastAnnouncedAt.
    let sinceAnnounce = now - next.lastAnnouncedAt
    if cur.isLong {
        let remainingStep = cur.endD - d
        if sinceAnnounce >= periodicIntervalSeconds(remaining: remainingStep) {
            next.lastAnnouncedAt = now
            return GuideOutput(
                state: next,
                event: .periodic(
                    stepIndex: cur.index,
                    remainingMeters: Int(remainingStep.rounded()),
                    accuracy: fix.accuracy
                ),
                tone: nil
            )
        }
    } else if sinceAnnounce >= bundleRereadSeconds {
        let indices = unitAt(route: route, index: cur.index)
        next.lastAnnouncedAt = now
        return GuideOutput(state: next, event: .bundleReread(indices), tone: nil)
    }

    // 6d) 속도 제안(최하위, 세션당 1회).
    if speedGuardActive && !next.speedWarned {
        next.speedWarned = true
        return GuideOutput(state: next, event: .speedSuggest, tone: nil)
    }
    return GuideOutput(state: next, event: nil, tone: nil)
}
