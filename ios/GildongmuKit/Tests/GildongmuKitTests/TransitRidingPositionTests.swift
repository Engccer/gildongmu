import Foundation
import Testing
@testable import GildongmuKit

/// 웹 정본과 같은 공유 fixture(`src/lib/__tests__/fixtures/transit-riding-position-cases.json`)를 돈다
/// (E35 spec 2026-09-23 §4).
private struct FixtureLock: Decodable {
    let mode: String
    let routeId: String
    let direction: String
    let vehicleId: String
}
private struct FixtureState: Decodable {
    let legIndex: Int
    let phase: String
    let phaseGen: Int
    let signal: String
    let lock: FixtureLock?
    let currentLocation: String?
}
private struct FixtureLeg: Decodable {
    let trackMode: String?
    let viaStops: [String]?
    let minutes: Int?
}
private struct FixtureOutcome: Decodable {
    let kind: String
    let station: String?
    let dataAgeSeconds: Int?
    let lineEmpty: Bool?
}
private struct Case: Decodable {
    let name: String
    let fn: String
    let state: FixtureState
    let leg: FixtureLeg?
    let position: TransitRidingPosition?
    let requested: TransitPositionBinding?
    let pending: TransitPositionBinding?
    let outcome: FixtureOutcome?
    let now: Double?
    let overview: TransitOverview?
    let expectedBool: Bool?
    let expectedInt: Int?
    let expectedPosition: TransitRidingPosition?
    let expectedOverview: TransitOverview?
    let expectedBinding: TransitPositionBinding?
    let expectedVerdict: String?
    let expectedIsNull: Bool

    enum CodingKeys: String, CodingKey {
        case name, fn, state, leg, position, requested, pending, outcome, now, overview, expected
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decode(String.self, forKey: .name)
        fn = try c.decode(String.self, forKey: .fn)
        state = try c.decode(FixtureState.self, forKey: .state)
        leg = try c.decodeIfPresent(FixtureLeg.self, forKey: .leg)
        position = try c.decodeIfPresent(TransitRidingPosition.self, forKey: .position)
        requested = try c.decodeIfPresent(TransitPositionBinding.self, forKey: .requested)
        pending = try c.decodeIfPresent(TransitPositionBinding.self, forKey: .pending)
        outcome = try c.decodeIfPresent(FixtureOutcome.self, forKey: .outcome)
        now = try c.decodeIfPresent(Double.self, forKey: .now)
        overview = try c.decodeIfPresent(TransitOverview.self, forKey: .overview)
        expectedIsNull = try c.decodeNil(forKey: .expected)
        expectedBool = fn == "lookupDue" ? try c.decode(Bool.self, forKey: .expected) : nil
        expectedInt = ["shown", "viaHere", "statusIndex"].contains(fn) && !expectedIsNull
            ? try c.decode(Int.self, forKey: .expected) : nil
        expectedPosition = fn == "step" && !expectedIsNull
            ? try c.decode(TransitRidingPosition.self, forKey: .expected) : nil
        expectedOverview = fn == "overview" ? try c.decode(TransitOverview.self, forKey: .expected) : nil
        expectedBinding = fn == "neverSeenDeferred" && !expectedIsNull
            ? try c.decode(TransitPositionBinding.self, forKey: .expected) : nil
        expectedVerdict = fn == "neverSeenPending" ? try c.decode(String.self, forKey: .expected) : nil
    }
}
private struct CaseFile: Decodable {
    let leg: FixtureLeg
    let cases: [Case]
}

private func repoURL(_ rel: String) -> URL {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() }
    url.appendPathComponent(rel)
    return url
}

private func makeLeg(base: FixtureLeg, override: FixtureLeg?) -> TransitGuideLeg {
    let trackMode = override?.trackMode ?? base.trackMode
    let names = override?.viaStops ?? base.viaStops ?? []
    return TransitGuideLeg(
        mode: trackMode == "subway" ? "subway" : "bus", lineName: "수도권 5호선",
        trackMode: trackMode.flatMap(TransitTrackMode.init(rawValue:)),
        boardName: names.first ?? "", alightName: names.last ?? "",
        boardStop: nil, alightStop: nil,
        viaStops: names.map { TransitLegStop(name: $0, lat: 37.5, lng: 127) },
        stationCount: nil, routeId: nil, wayCode: nil, walkBeforeMinutes: nil,
        minutes: override?.minutes ?? base.minutes)
}

private func makeState(_ s: FixtureState, route: TransitGuideRoute) throws -> TransitGuideState {
    var state = initTransitGuide(route: route, now: 0)
    state.legIndex = s.legIndex
    state.phase = try #require(TransitPhase(rawValue: s.phase))
    state.phaseGen = s.phaseGen
    state.signal = try #require(TransitSignal(rawValue: s.signal))
    state.lock = try s.lock.map { l in
        TransitLock(mode: try #require(TransitTrackMode(rawValue: l.mode)), routeId: l.routeId,
                    direction: l.direction, vehicleId: l.vehicleId)
    }
    state.currentLocation = s.currentLocation
    return state
}

private func makeOutcome(_ o: FixtureOutcome) throws -> TransitPositionOutcome {
    switch o.kind {
    case "found": .found(station: try #require(o.station), dataAgeSeconds: o.dataAgeSeconds)
    case "notFound": .notFound(lineEmpty: try #require(o.lineEmpty as Bool?))
    case "unsupported": .unsupported
    case "failed": .failed
    default: throw CocoaError(.coderInvalidValue)
    }
}

@Test func ridingPositionSharedCases() throws {
    let file = try JSONDecoder().decode(
        CaseFile.self,
        from: Data(contentsOf: repoURL("src/lib/__tests__/fixtures/transit-riding-position-cases.json")))
    #expect(file.cases.count >= 60)
    for c in file.cases {
        let leg = makeLeg(base: file.leg, override: c.leg)
        let state = try makeState(c.state, route: TransitGuideRoute(legs: [leg], walkAfterMinutes: nil))
        let now = c.now ?? 0
        switch c.fn {
        case "lookupDue":
            #expect(transitPositionLookupDue(state: state, leg: leg, position: c.position) == c.expectedBool, "\(c.name)")
        case "step":
            let out = transitRidingPositionStep(
                c.position, state: state, leg: leg, requested: try #require(c.requested),
                outcome: try makeOutcome(try #require(c.outcome)), now: now)
            #expect(out == c.expectedPosition, "\(c.name)")
        case "shown":
            #expect(transitPositionShownIndex(state: state, position: c.position, now: now) == c.expectedInt, "\(c.name)")
        case "viaHere":
            #expect(transitViaStopHereIndex(state: state, leg: leg, position: c.position, now: now) == c.expectedInt, "\(c.name)")
        case "statusIndex":
            #expect(transitPositionStatusIndex(state: state, position: c.position, now: now) == c.expectedInt, "\(c.name)")
        case "overview":
            let out = transitOverviewApplyingPosition(
                try #require(c.overview), state: state, position: c.position, now: now)
            #expect(out == c.expectedOverview, "\(c.name)")
        case "neverSeenDeferred":
            #expect(transitNeverSeenWarningDeferred(state: state, position: c.position, now: now)
                == c.expectedBinding, "\(c.name)")
        case "neverSeenPending":
            let verdict = transitNeverSeenPendingStep(
                try #require(c.pending), state: state, position: c.position, now: now)
            #expect(verdict.rawValue == c.expectedVerdict, "\(c.name)")
        default:
            Issue.record("unknown fn \(c.fn)")
        }
    }
}

@Test func positionEnvelopeOutcome() throws {
    func env(_ json: String) throws -> TransitPositionEnvelope {
        try JSONDecoder().decode(TransitPositionEnvelope.self, from: Data(json.utf8))
    }
    #expect(TransitPositionService.outcome(from: try env(
        #"{"status":"found","station":"길동","trainStatus":"3","dataStamp":"2026-09-23 14:49:20","dataAgeSeconds":40}"#
    )) == .found(station: "길동", dataAgeSeconds: 40))
    #expect(TransitPositionService.outcome(from: try env(#"{"status":"found","station":"길동","dataAgeSeconds":null}"#))
        == .found(station: "길동", dataAgeSeconds: nil))
    #expect(TransitPositionService.outcome(from: try env(#"{"status":"found","station":""}"#)) == .failed)
    #expect(TransitPositionService.outcome(from: try env(#"{"status":"notFound","total":33}"#)) == .notFound(lineEmpty: false))
    #expect(TransitPositionService.outcome(from: try env(#"{"status":"notFound","total":0}"#)) == .notFound(lineEmpty: true))
    // 비-200 분류(설계 리뷰 m4, 웹 positionOutcomeFromHttpStatus 미러).
    #expect(TransitPositionService.outcome(from: APIError.badStatus(code: 429, message: nil)) == .failed)
    #expect(TransitPositionService.outcome(from: APIError.badStatus(code: 502, message: nil)) == .failed)
    #expect(TransitPositionService.outcome(from: APIError.badStatus(code: 400, message: nil)) == .unsupported)
    #expect(TransitPositionService.outcome(from: URLError(.timedOut)) == .failed)
    #expect(TransitPositionService.outcome(from: try env(#"{"status":"unsupported"}"#)) == .unsupported)
    #expect(TransitPositionService.outcome(from: try env(#"{"status":"weird"}"#)) == .failed)
}

/// 유휴 정지(E48 잔여 ⑥): 추적 중이 아닌 riding에서만 래치를 만료시키고 결박·조회 수는 남긴다. 인계 뒤(추적 중)는 그대로 —
/// 비우면 멈춰 있는 도착 쪽 표식으로 한 역 이상 뒤로 간다.
@Test func ridingPositionOnIdlePause() throws {
    let leg = makeLeg(
        base: FixtureLeg(trackMode: "subway", viaStops: ["천호", "강동", "길동", "굽은다리"], minutes: 10),
        override: nil)
    var state = initTransitGuide(route: TransitGuideRoute(legs: [leg], walkAfterMinutes: nil), now: 0)
    state.phase = .riding
    state.lock = TransitLock(mode: .subway, routeId: "1005", direction: "하행", vehicleId: "5123")
    var position = TransitRidingPosition(
        binding: TransitPositionBinding(legIndex: 0, phaseGen: state.phaseGen, vehicleId: "5123"))
    position.stopIndex = 2
    position.lastFoundAt = 1_000
    position.lookups = 4
    position.behind = 1

    state.signal = .notYetVisible
    let expired = try #require(transitRidingPositionOnIdlePause(position, state: state))
    #expect(expired.stopIndex == nil && expired.lastFoundAt == nil && expired.behind == 0)
    #expect(expired.lookups == 4 && expired.binding == position.binding)
    // 만료 뒤에는 시계가 창 안이어도 표식이 없다.
    #expect(transitPositionShownIndex(state: state, position: expired, now: 1_001) == nil)

    for signal in [TransitSignal.neverSeen, .signalLost, .upstreamFailed] {
        state.signal = signal
        #expect(transitRidingPositionOnIdlePause(position, state: state)?.stopIndex == nil, "\(signal)")
    }

    state.signal = .tracking
    #expect(transitRidingPositionOnIdlePause(position, state: state) == position)
    #expect(transitRidingPositionOnIdlePause(nil, state: state) == nil)
    #expect(transitRidingPositionOnIdlePause(position, state: nil) == position)
}
