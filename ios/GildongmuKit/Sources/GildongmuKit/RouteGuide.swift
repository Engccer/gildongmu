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
/// 속도 표본 수집의 정확도 상한. uncertain 게이트(50m)보다 좁다 — 계단·실내 진입의
/// 30~50m fix가 진행거리 점프를 만들어 "속도 빠름" 오판을 낳는다(피드백 라운드1 #7).
public let speedSampleMaxAccuracyMeters = 20.0
public let resolveTimeoutSeconds = 30.0
public let bundleRereadSeconds = 15.0

/// 수단별 튜닝 프로파일(B1 스펙 §4.3) — 웹 `GuideTuning` 미러. walk는 현행 상수의
/// 동결이고, 리듀서 본문 변경은 "상수 참조 → 인자 참조 치환"에 한정한다.
public struct GuideTuning: Sendable, Equatable {
    /// 임박(선행) 낭독: 잔여 ≤ max(announceAheadM, v×announceAheadSpeedS)
    public var announceAheadM: Double
    public var announceAheadSpeedS: Double
    /// 원거리 예고 경계(m). nil=미사용(walk)
    public var farNoticeM: Double?
    public var windowAheadMinM: Double
    public var windowAheadSpeedS: Double
    public var offRouteBaseM: Double
    public var offRouteHoldS: Double
    /// 이탈 확정에 "수직거리 비감소 추세" 요구(복귀 중 오확정 차단)
    public var offRouteTrend: Bool
    public var offRouteRenotifyS: Double
    /// 이탈 재통지의 warning 톤 여부(첫 확정은 항상 warning)
    public var offRouteRenotifyWarns: Bool
    public var handoffDistM: Double
    public var handoffRearmM: Double
    /// 재획득 전방 연속성 타이브레이크(재획득 경로 한정)
    public var reacquireTieBreak: Bool
    /// 보행 속도 가드. false면 가드 기계 전체 비활성(차량 상시 활성 → 이탈 재통지 잠식 차단).
    public var speedSuggest: Bool

    public static let walk = GuideTuning(
        announceAheadM: announceAheadMeters, announceAheadSpeedS: 0, farNoticeM: nil,
        windowAheadMinM: windowAheadMinMeters, windowAheadSpeedS: 0,
        offRouteBaseM: offRouteBaseMeters, offRouteHoldS: offRouteHoldSeconds,
        offRouteTrend: false,
        offRouteRenotifyS: offRouteRenotifySeconds, offRouteRenotifyWarns: true,
        handoffDistM: handoffDistMeters, handoffRearmM: handoffRearmMeters,
        reacquireTieBreak: false, speedSuggest: true
    )

    /// 자동차 초기값(스펙 §4.3 표) — 최초 실주행 판정까지 고정.
    public static let car = GuideTuning(
        announceAheadM: 120, announceAheadSpeedS: 15, farNoticeM: 1500,
        windowAheadMinM: 150, windowAheadSpeedS: 5,
        offRouteBaseM: 50, offRouteHoldS: 10,
        offRouteTrend: true,
        offRouteRenotifyS: 180, offRouteRenotifyWarns: false,
        handoffDistM: 150, handoffRearmM: 200,
        reacquireTieBreak: true, speedSuggest: false
    )
}

/// 속도 추정 v(§4.3): max(직전 구간 속도, 중앙값). 표본은 직전 fix까지의 창 —
/// 구속 창 크기는 현재 fix 수용 전에 정해져야 하므로(인과) 현재 fix 미포함.
private func estimateSpeedMps(_ samples: [GuideSpeedSample]) -> Double {
    guard samples.count >= 2 else { return 0 }
    var speeds: [Double] = []
    for i in 1..<samples.count where samples[i].at > samples[i - 1].at {
        speeds.append((samples[i].d - samples[i - 1].d) / (samples[i].at - samples[i - 1].at))
    }
    guard let lastSeg = speeds.last else { return 0 }
    let sorted = speeds.sorted()
    return max(lastSeg, sorted[sorted.count / 2])
}

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
    /// 원거리 예고를 마친 마지막 스텝 index(임박 발화 시 함께 전진). walk에선 불변.
    public var farNoticedUpTo: Int
    /// 이탈 누적 중 관측 최대 수직거리 — offRouteTrend 프로파일의 복귀 유예 기준.
    public var offRoutePeakPerp: Double?
    /// 재획득 타이브레이크 기준: reacquiring 진입 직전 진행거리·속도·진입 시각.
    public var reacquirePrevD: Double?
    public var reacquireV: Double
    public var reacquireSince: Double?
    /// reacquiring 진입 직전 국면이 offRoute였는가. 없으면 이탈 확정이 GPS 공백을
    /// 경유하며 무통지로 소실된다(복귀가 backOnRoute 대신 reacquired로 나감 — 리뷰 HIGH).
    public var reacquiringFromOffRoute: Bool
}

public enum GuideEvent: Sendable, Equatable {
    case announceSteps([Int])
    case farNotice(indices: [Int], remainingMeters: Int)
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
        autoHandoffArmed: autoHandoffArmed,
        // 재진입 유닛은 원거리 예고 소비 처리 — 경계 안 시작은 크로싱 불성립(§4.3).
        farNoticedUpTo: unit[unit.count - 1],
        offRoutePeakPerp: nil,
        reacquirePrevD: nil,
        reacquireV: 0,
        reacquireSince: nil,
        reacquiringFromOffRoute: false
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
public func entryProjection(
    route: GuideRoute, fix: GuideFix, tuning: GuideTuning = .walk
) -> GuideEntryProjection {
    let maxPerp = max(tuning.offRouteBaseM, 2 * fix.accuracy)
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
    state: GuideState, fix: GuideFix, route: GuideRoute, now: Double,
    tuning: GuideTuning = .walk
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
        // 이탈 중 진입이면 복귀도 이탈로(이탈 상태 소실 방지 — 리뷰 HIGH의 대칭 경로).
        s.resumePhase = state.phase == .offRoute ? .offRoute : state.resumePhase
        s.lastFixAt = now
        s.speedSamples = []
        return GuideOutput(state: s, event: .uncertainEnter, tone: nil)
    }

    // 2) reacquiring: 전역 재탐색(모호하면 유지 — 다음 fix에서 재시도).
    if state.phase == .reacquiring {
        var entryD: Double?
        if case let .ok(d) = entryProjection(route: route, fix: fix, tuning: tuning) {
            entryD = d
        } else if case .ambiguous = entryProjection(route: route, fix: fix, tuning: tuning),
                  tuning.reacquireTieBreak,
                  let prevD = state.reacquirePrevD,
                  let since = state.reacquireSince {
            // 재획득 전방 연속성 타이브레이크(§4.3): 전방 창 안 후보가 정확히 1개일
            // 때만 채택. 0·복수는 거부 유지 — 평행도로 이탈 은폐 차단.
            // elapsed는 "마지막으로 확실했던 시점"부터의 경과(고정 보정 없음 —
            // gap 트리거는 진입 시 직전 fix 시각을 reacquireSince에 담는다).
            let elapsed = now - since
            let maxAheadD = prevD + state.reacquireV * elapsed * 1.5 + 100
            let maxPerp = max(tuning.offRouteBaseM, 2 * fix.accuracy)
            let inWindow = globalCandidates(route.polyline, p: fix.point, maxPerp: maxPerp)
                .filter { $0.d >= prevD && $0.d <= maxAheadD }
            if inWindow.count == 1 { entryD = inWindow[0].d }
        }
        guard let d = entryD else {
            var s = state
            s.lastFixAt = now
            return GuideOutput(state: s, event: nil, tone: nil)
        }
        var s = guideStateAt(route: route, d: d, now: now, autoHandoffArmed: state.autoHandoffArmed)
        s.speedWarned = state.speedWarned
        s.lastFixAt = now
        // 이탈 확정 상태에서 공백으로 넘어온 재확보는 곧 이탈 종료다 — backOnRoute를
        // 내야 UI의 이탈 상태(재조회 버튼)가 함께 닫힌다(리뷰 HIGH).
        return GuideOutput(
            state: s,
            event: state.reacquiringFromOffRoute ? .backOnRoute : .reacquired,
            tone: nil
        )
    }
    let gap = state.lastFixAt.map { now - $0 > reacquireGapSeconds } ?? false
    if gap || state.windowEdgeHits >= edgeHitsMax {
        var s = state
        s.phase = .reacquiring
        s.windowEdgeHits = 0
        s.speedSamples = []
        s.lastFixAt = now
        s.reacquiringFromOffRoute = state.phase == .offRoute
        // 타이브레이크 기준 보관 — 표본은 지금 리셋되므로 진입 시점에 계산해 둔다.
        // 기준 시각은 "마지막으로 확실했던 시점"(gap=직전 fix 시각·edgeHits=지금).
        s.reacquirePrevD = state.d
        s.reacquireV = estimateSpeedMps(state.speedSamples)
        s.reacquireSince = gap ? state.lastFixAt : now
        return GuideOutput(state: s, event: .reacquiring, tone: nil)
    }

    // 3) 구속 창 투영 + 단조 전진(스펙 §5.1). 창 크기는 직전 창 속도로 되먹인다
    //    (walk는 속도 계수 0이라 현행 동일).
    let vPrev = estimateSpeedMps(state.speedSamples)
    let ahead = max(tuning.windowAheadMinM, 3 * fix.accuracy, vPrev * tuning.windowAheadSpeedS)
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
    let offThreshold = max(tuning.offRouteBaseM, 2 * fix.accuracy)
    let edgeHit = proj.d >= state.d + ahead - 1 && proj.perpMeters <= offThreshold
    let windowEdgeHits = edgeHit ? state.windowEdgeHits + 1 : 0

    // 4) 속도 창(10초 중앙값) — uncertain·reacquiring 밖에서만 표본 수집.
    //    정확도 나쁜 fix(>20m)는 표본에서 배제한다(투영·전진은 유지 — 위치 축과 속도
    //    축의 품질 요구가 다르다). 배제가 이어지면 창이 짧아져 가드 판정이 멈춘다.
    var samples = state.speedSamples
    if fix.accuracy <= speedSampleMaxAccuracyMeters {
        samples.append(GuideSpeedSample(at: now, d: d))
    }
    samples.removeAll { now - $0.at > speedWindowSeconds }
    var speeds: [Double] = []
    for i in 1..<max(samples.count, 1) where samples[i].at > samples[i - 1].at {
        speeds.append((samples[i].d - samples[i - 1].d) / (samples[i].at - samples[i - 1].at))
    }
    speeds.sort()
    let median = speeds.isEmpty ? 0 : speeds[speeds.count / 2]
    let windowSpan = samples.count >= 2 ? samples[samples.count - 1].at - samples[0].at : 0
    var speedGuardActive = state.speedGuardActive
    // 가드 기계는 speedSuggest 프로파일에서만 동작한다(차량 상시 활성 → 재통지 잠식 차단).
    if tuning.speedSuggest {
        if windowSpan >= speedWindowSeconds * 0.8 {
            if !speedGuardActive && median > speedEnterMps {
                speedGuardActive = true
            } else if speedGuardActive && median < speedClearMps {
                speedGuardActive = false
            }
        } else if speedGuardActive, samples.isEmpty {
            // 표본이 전무하면(정확도 배제·시간창 배수로 소멸) 판정 근거가 없다 —
            // 낡은 판정을 쥔 채 이탈 재통지를 무기한 억제하는 고착 차단(독립 리뷰).
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
    if !next.autoHandoffArmed && remainingTotal > tuning.handoffRearmM {
        next.autoHandoffArmed = true
    }

    // 5) 이탈 판정(스펙 §5.6).
    if state.phase == .offRoute {
        // 이탈 중 복귀 감지는 구속 창이 아니라 전역 후보로 한다. 이탈 동안 창이 뒤에
        // 머물러, 사용자가 경로 앞쪽으로 복귀해도 창 안 투영으로는 영영 못 잡는다.
        if case let .ok(entryD) = entryProjection(route: route, fix: fix, tuning: tuning) {
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
            (state.lastOffRouteNoticeAt.map { now - $0 >= tuning.offRouteRenotifyS } ?? true)
        if canRenotify {
            next.lastOffRouteNoticeAt = now
            // 재통지 톤은 프로파일 몫(차량은 이탈=정보라 무톤, 첫 확정만 경고 — §4.3).
            return GuideOutput(
                state: next, event: .offRoute,
                tone: tuning.offRouteRenotifyWarns ? .warning : nil
            )
        }
        return GuideOutput(state: next, event: nil, tone: nil)
    }
    let isOff = proj.perpMeters > offThreshold
    if isOff {
        var since = state.offRouteSince ?? now
        var peak = max(state.offRoutePeakPerp ?? 0, proj.perpMeters)
        // 복귀 추세 유예(offRouteTrend): 관측 최대 대비 5m 이상 줄면 누적 리셋(§4.3).
        if tuning.offRouteTrend, proj.perpMeters < peak - 5 {
            since = now
            peak = proj.perpMeters
        }
        next.offRouteSince = since
        next.offRoutePeakPerp = peak
        if now - since >= tuning.offRouteHoldS {
            next.phase = .offRoute
            next.resumePhase = stepAt(route: route, d: d).isLong ? .following : .bundle
            next.lastOffRouteNoticeAt = now
            next.offRoutePeakPerp = nil
            return GuideOutput(state: next, event: .offRoute, tone: .warning)
        }
    } else if state.offRouteSince != nil {
        next.offRouteSince = nil
        next.offRoutePeakPerp = nil
    }

    // 6) 국면·낭독.
    let cur = stepAt(route: route, d: d)
    next.phase = cur.isLong ? .following : .bundle
    next.resumePhase = cur.isLong ? .following : .bundle

    // 6a) 인계(최우선): 전 스텝 낭독 완료 AND 잔여 ≤ 인계선 AND 재무장(스펙 §5.3).
    if next.autoHandoffArmed,
       next.announcedUpTo >= route.steps.count - 1,
       remainingTotal <= tuning.handoffDistM {
        return GuideOutput(state: next, event: .handoff, tone: nil)
    }

    // 6b) 선행 낭독: 낭독 완료 유닛의 끝까지 잔여 ≤ 임박선이면 다음 유닛 전문.
    //     임박선은 max(거리 하한, v×시간 계수) — walk는 시간 계수 0이라 40m 고정 동일.
    if next.announcedUpTo < route.steps.count - 1 {
        let announcedEnd = route.steps[next.announcedUpTo].endD
        let announceAhead = max(tuning.announceAheadM, vPrev * tuning.announceAheadSpeedS)
        if announcedEnd - d <= announceAhead {
            let indices = unitAt(route: route, index: next.announcedUpTo + 1)
            next.announcedUpTo = indices[indices.count - 1]
            // 임박이 나가면 그 유닛의 원거리 예고는 소비된다(뒤늦은 원거리 예고 금지).
            next.farNoticedUpTo = max(next.farNoticedUpTo, indices[indices.count - 1])
            next.lastAnnouncedAt = now
            return GuideOutput(state: next, event: .announceSteps(indices), tone: .ahead)
        }
    }

    // 6b') 원거리 예고(§4.3 car 전용): 다음 분기 경계선을 하향 통과하는 fix에서 1회.
    //      세션 시작·재획득 재진입이 이미 경계 안이면 크로싱 불성립으로 자연 생략.
    if let farNoticeM = tuning.farNoticeM,
       next.announcedUpTo < route.steps.count - 1,
       next.farNoticedUpTo <= next.announcedUpTo {
        let boundary = route.steps[next.announcedUpTo].endD
        let prevRemaining = boundary - state.d
        let nowRemaining = boundary - d
        if prevRemaining > farNoticeM, nowRemaining <= farNoticeM {
            let indices = unitAt(route: route, index: next.announcedUpTo + 1)
            next.farNoticedUpTo = indices[indices.count - 1]
            next.lastAnnouncedAt = now
            // 낭독 거리는 크로싱 시점의 실측 잔여(§4.7 — 상수 낭독 금지, 리뷰 검출).
            return GuideOutput(
                state: next,
                event: .farNotice(indices: indices, remainingMeters: Int(nowRemaining.rounded())),
                tone: nil
            )
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
