import Foundation
import Testing
@testable import GildongmuKit

/// 웹 정본과 같은 공유 fixture(`src/lib/__tests__/fixtures/transit-progress-overview-scenarios.json`)를
/// 읽어 디스크립터 동일을 대조한다(spec 2026-08-23 §3·§10).
private struct FixtureLeg: Decodable {
    let mode: String
    let lineName: String
    let trackMode: String?
    let boardName: String
    let alightName: String
    let viaStops: [String]
    let stationCount: Int?
    let walkBeforeMinutes: Int?
}
private struct FixtureRoute: Decodable {
    let legs: [FixtureLeg]
    let walkAfterMinutes: Int?
}
private struct FixtureState: Decodable {
    let legIndex: Int
    let phase: String
    let signal: String
    let currentLocation: String?
    let arrivedCertain: Bool
}
private struct Scenario: Decodable {
    let name: String
    let state: FixtureState
    let route: FixtureRoute
    let expected: TransitOverview
}
private struct ScenarioFile: Decodable { let scenarios: [Scenario] }

private func repoURL(_ rel: String) -> URL {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() }
    url.appendPathComponent(rel)
    return url
}

private func toRoute(_ r: FixtureRoute) -> TransitGuideRoute {
    TransitGuideRoute(
        legs: r.legs.map { l in
            TransitGuideLeg(
                mode: l.mode, lineName: l.lineName,
                trackMode: l.trackMode.flatMap(TransitTrackMode.init(rawValue:)),
                boardName: l.boardName, alightName: l.alightName,
                boardStop: nil, alightStop: nil,
                viaStops: l.viaStops.map { TransitLegStop(name: $0, lat: 0, lng: 0) },
                stationCount: l.stationCount, routeId: nil, wayCode: nil,
                walkBeforeMinutes: l.walkBeforeMinutes)
        },
        walkAfterMinutes: r.walkAfterMinutes)
}

@Test func progressOverviewSharedScenarioTable() throws {
    let file = try JSONDecoder().decode(
        ScenarioFile.self,
        from: Data(contentsOf: repoURL("src/lib/__tests__/fixtures/transit-progress-overview-scenarios.json")))
    #expect(file.scenarios.count >= 12)
    for sc in file.scenarios {
        let route = toRoute(sc.route)
        var state = initTransitGuide(route: route, now: 0)
        state.legIndex = sc.state.legIndex
        state.phase = try #require(TransitPhase(rawValue: sc.state.phase))
        state.signal = try #require(TransitSignal(rawValue: sc.state.signal))
        state.currentLocation = sc.state.currentLocation
        state.arrivedCertain = sc.state.arrivedCertain
        let out = transitProgressOverview(state: state, route: route)
        #expect(out == sc.expected, "scenario \(sc.name)")
    }
}

/// Codable 왕복 — 웹 JSON 모양(kind 판별·null 명시)과 같은 인코딩인지.
@Test func overviewRowCodableRoundTrip() throws {
    let rows: [TransitOverviewRow] = [
        .walk(minutes: 3),
        .leg(legIndex: 0, mode: "subway", lineName: "5호선", boardName: "a", alightName: "b", status: .current, stationCount: nil),
        .stop(stopIndex: 1, name: "x", role: .via, here: true),
        .stopsUnavailable,
        .silence(signal: .neverSeen),
    ]
    let data = try JSONEncoder().encode(rows)
    let back = try JSONDecoder().decode([TransitOverviewRow].self, from: data)
    #expect(back == rows)
    let text = String(decoding: data, as: UTF8.self)
    #expect(text.contains("\"stationCount\":null"))
}
