import Foundation
import Testing
@testable import GildongmuKit

/// 웹 정본과 같은 공유 fixture(`src/lib/__tests__/fixtures/transit-bus-stop-cases.json`)를 돈다
/// (E48 spec 2026-09-23-bus-current-stop-design.md §2).
private struct FixtureState: Decodable {
    let legIndex: Int
    let phase: String
    let phaseGen: Int
    let signal: String
    let currentLocation: String?
}
private struct FixtureStop: Decodable {
    let name: String
    let lat: Double
    let lng: Double
}
private struct FixtureLeg: Decodable {
    let mode: String?
    let trackMode: String?
    let viaStops: [FixtureStop]?
}
private struct StepExpected: Decodable {
    let tracker: TransitBusStopTracker?
    let verdict: TransitBusStopVerdict
    let nearestIndex: Int?
}
private struct Case: Decodable {
    let name: String
    let fn: String
    let state: FixtureState
    let leg: FixtureLeg?
    let tracker: TransitBusStopTracker?
    let mark: TransitBusStopMark?
    let fix: TransitDeviceFix?
    let now: Double?
    let overview: TransitOverview?
    let expectedStep: StepExpected?
    let expectedInt: Int?
    let expectedMark: TransitBusStopMark?
    let expectedOverview: TransitOverview?

    enum CodingKeys: String, CodingKey {
        case name, fn, state, leg, tracker, mark, fix, now, overview, expected
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decode(String.self, forKey: .name)
        fn = try c.decode(String.self, forKey: .fn)
        state = try c.decode(FixtureState.self, forKey: .state)
        leg = try c.decodeIfPresent(FixtureLeg.self, forKey: .leg)
        tracker = try c.decodeIfPresent(TransitBusStopTracker.self, forKey: .tracker)
        mark = try c.decodeIfPresent(TransitBusStopMark.self, forKey: .mark)
        fix = try c.decodeIfPresent(TransitDeviceFix.self, forKey: .fix)
        now = try c.decodeIfPresent(Double.self, forKey: .now)
        overview = try c.decodeIfPresent(TransitOverview.self, forKey: .overview)
        expectedStep = fn == "step" ? try c.decode(StepExpected.self, forKey: .expected) : nil
        expectedInt = fn == "viaHere" ? try c.decodeIfPresent(Int.self, forKey: .expected) : nil
        expectedMark = fn == "mark" ? try c.decodeIfPresent(TransitBusStopMark.self, forKey: .expected) : nil
        expectedOverview = fn == "overview" ? try c.decode(TransitOverview.self, forKey: .expected) : nil
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

private func makeLeg(base: FixtureLeg, override: FixtureLeg?) throws -> TransitGuideLeg {
    let mode = try #require(override?.mode ?? base.mode)
    let trackMode = override?.trackMode ?? base.trackMode
    let stops = (override?.viaStops ?? base.viaStops ?? []).map {
        TransitLegStop(name: $0.name, lat: $0.lat, lng: $0.lng)
    }
    return TransitGuideLeg(
        mode: mode, lineName: mode == "subway" ? "수도권 5호선" : "340",
        trackMode: trackMode.flatMap(TransitTrackMode.init(rawValue:)),
        boardName: stops.first?.name ?? "", alightName: stops.last?.name ?? "",
        boardStop: nil, alightStop: nil, viaStops: stops,
        stationCount: nil, routeId: nil, wayCode: nil, walkBeforeMinutes: nil)
}

private func makeState(_ s: FixtureState, route: TransitGuideRoute) throws -> TransitGuideState {
    var state = initTransitGuide(route: route, now: 0)
    state.legIndex = s.legIndex
    state.phase = try #require(TransitPhase(rawValue: s.phase))
    state.phaseGen = s.phaseGen
    state.signal = try #require(TransitSignal(rawValue: s.signal))
    state.currentLocation = s.currentLocation
    return state
}

@Test func busStopSharedCases() throws {
    let file = try JSONDecoder().decode(
        CaseFile.self,
        from: Data(contentsOf: repoURL("src/lib/__tests__/fixtures/transit-bus-stop-cases.json")))
    #expect(file.cases.count >= 50)
    for c in file.cases {
        let leg = try makeLeg(base: file.leg, override: c.leg)
        // 결박 교체 case가 legIndex 1을 쓰므로 경로에 같은 leg를 두 번 싣는다.
        let state = try makeState(c.state, route: TransitGuideRoute(legs: [leg, leg], walkAfterMinutes: nil))
        let now = c.now ?? 0
        switch c.fn {
        case "step":
            let out = transitBusStopStep(c.tracker, state: state, leg: leg, fix: try #require(c.fix), now: now)
            let expected = try #require(c.expectedStep)
            #expect(out.verdict == expected.verdict, "\(c.name)")
            #expect(out.tracker == expected.tracker, "\(c.name)")
            #expect(out.nearestIndex == expected.nearestIndex, "\(c.name)")
        case "mark":
            #expect(transitBusStopMark(state: state, leg: leg, tracker: c.tracker, now: now) == c.expectedMark,
                    "\(c.name)")
        case "viaHere":
            #expect(transitViaStopHereIndexWithBusStop(
                state: state, leg: leg, position: nil, busStop: c.mark, now: now) == c.expectedInt, "\(c.name)")
        case "overview":
            let out = transitOverviewApplyingBusStop(try #require(c.overview), state: state, leg: leg, mark: c.mark)
            #expect(out == c.expectedOverview, "\(c.name)")
        default:
            Issue.record("unknown fn \(c.fn)")
        }
    }
}

/// 비유한 좌표 정류장은 후보가 아니다(JSON은 NaN을 싣지 못한다 — 웹 같은 이름 테스트와 짝).
@Test func busStopSkipsNonFiniteStop() throws {
    let stops = [
        TransitLegStop(name: "a", lat: 37.5, lng: 127),
        TransitLegStop(name: "b", lat: .nan, lng: 127),
        TransitLegStop(name: "c", lat: 37.508, lng: 127),
    ]
    let leg = TransitGuideLeg(
        mode: "bus", lineName: "340", trackMode: .seoulBus, boardName: "a", alightName: "c",
        boardStop: nil, alightStop: nil, viaStops: stops,
        stationCount: nil, routeId: nil, wayCode: nil, walkBeforeMinutes: nil)
    var state = initTransitGuide(route: TransitGuideRoute(legs: [leg], walkAfterMinutes: nil), now: 0)
    state.phase = .riding
    let out = transitBusStopStep(
        nil, state: state, leg: leg, fix: TransitDeviceFix(lat: 37.508, lng: 127, accuracy: 10, ageSeconds: 0), now: 1000)
    #expect(out.tracker?.pendingIndex == 2)
}
