import Foundation
import Testing
@testable import GildongmuKit

/// 웹 정본과 같은 공유 fixture(`src/lib/__tests__/fixtures/route-guide-scenarios.json`)를
/// 레포 상대 경로로 직접 읽어 같은 경계표를 단언한다(사본 금지 — 드리프트 원천 차단,
/// `format-drift.test.ts`의 파일 직접 읽기 관례 동형).
private let meterLat = 1.0 / 111_320
private let lat0 = 37.5
private let lng0 = 127.1

private struct ScenarioFile: Decodable {
    let scenarios: [Scenario]
}

private struct Scenario: Decodable {
    let name: String
    let steps: [Step]
    let fixes: [Fix]
    let expect: [Expectation]

    struct Step: Decodable {
        let len: Double
        let desc: String
    }

    struct Fix: Decodable {
        let t: Double
        let along: Double
        let lateral: Double
        let acc: Double
    }

    struct Expectation: Decodable {
        let afterFix: Int?
        let afterFixAny: [Int]?
        let event: String?
        let eventNot: String?
        let eventNull: Bool?
        let eventOneOf: [String]?
        let indices: [Int]?
        let tone: String?
    }
}

private func loadScenarios() throws -> [Scenario] {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() } // GildongmuKitTests→Tests→GildongmuKit→ios→repo
    url.appendPathComponent("src/lib/__tests__/fixtures/route-guide-scenarios.json")
    let data = try Data(contentsOf: url)
    return try JSONDecoder().decode(ScenarioFile.self, from: data).scenarios
}

private func routeFrom(_ steps: [Scenario.Step]) -> GuideRoute {
    var acc = 0.0
    let inputs = steps.map { s in
        let g = GuideStepGeometry(
            description: s.desc,
            pathCoords: [
                RoutePoint(lat: lat0 + acc * meterLat, lng: lng0),
                RoutePoint(lat: lat0 + (acc + s.len) * meterLat, lng: lng0),
            ]
        )
        acc += s.len
        return g
    }
    return buildGuideRoute(inputs)!
}

private func fixCoord(along: Double, lateral: Double, acc: Double) -> GuideFix {
    GuideFix(
        lat: lat0 + along * meterLat,
        lng: lng0 + (lateral * meterLat) / cos(lat0 * .pi / 180),
        accuracy: acc
    )
}

/// 이벤트 종류를 fixture 문자열로 환원(웹 event.kind 대응).
private func kindName(_ event: GuideEvent?) -> String? {
    switch event {
    case .announceSteps: "announceSteps"
    case .periodic: "periodic"
    case .bundleReread: "bundleReread"
    case .handoff: "handoff"
    case .offRoute: "offRoute"
    case .backOnRoute: "backOnRoute"
    case .uncertainEnter: "uncertainEnter"
    case .uncertainExit: "uncertainExit"
    case .reacquiring: "reacquiring"
    case .reacquired: "reacquired"
    case .speedSuggest: "speedSuggest"
    case nil: nil
    }
}

private func indicesOf(_ event: GuideEvent?) -> [Int]? {
    switch event {
    case let .announceSteps(i): i
    case let .bundleReread(i): i
    default: nil
    }
}

private func toneName(_ tone: GuideTone?) -> String? {
    switch tone {
    case .ahead: "ahead"
    case .warning: "warning"
    case nil: nil
    }
}

@Test func sharedScenarioTable() throws {
    for sc in try loadScenarios() {
        let route = routeFrom(sc.steps)
        var state = initialGuideState(route: route, now: 0).state
        var results: [(event: GuideEvent?, tone: GuideTone?)] = []
        for f in sc.fixes {
            let out = guideStep(
                state: state,
                fix: fixCoord(along: f.along, lateral: f.lateral, acc: f.acc),
                route: route,
                now: f.t
            )
            state = out.state
            results.append((out.event, out.tone))
        }
        for ex in sc.expect {
            let idxs: [Int] = ex.afterFix.map { [$0] } ?? ex.afterFixAny ?? []
            let rs = idxs.map { results[$0] }
            if let event = ex.event {
                #expect(
                    rs.contains { kindName($0.event) == event },
                    "\(sc.name): event \(event)"
                )
            }
            if let not = ex.eventNot {
                for r in rs {
                    #expect(kindName(r.event) != not, "\(sc.name): eventNot \(not)")
                }
            }
            if ex.eventNull == true {
                for r in rs { #expect(r.event == nil, "\(sc.name): eventNull") }
            }
            if let oneOf = ex.eventOneOf {
                #expect(
                    rs.contains { kindName($0.event).map(oneOf.contains) ?? false },
                    "\(sc.name): eventOneOf \(oneOf)"
                )
            }
            if let indices = ex.indices {
                let found = rs.compactMap { indicesOf($0.event) }.first
                #expect(found == indices, "\(sc.name): indices \(indices)")
            }
            if let tone = ex.tone {
                #expect(rs.contains { toneName($0.tone) == tone }, "\(sc.name): tone \(tone)")
            }
        }
    }
}

@Test func entryProjectionAmbiguityContract() {
    // U자 왕복(평행 20m 간격)은 ambiguous — 임의 확정 금지(스펙 §6).
    let uRoute = buildGuideRoute([
        GuideStepGeometry(description: "북", pathCoords: [
            RoutePoint(lat: lat0, lng: lng0),
            RoutePoint(lat: lat0 + 300 * meterLat, lng: lng0),
        ]),
        GuideStepGeometry(description: "동", pathCoords: [
            RoutePoint(lat: lat0 + 300 * meterLat, lng: lng0),
            RoutePoint(lat: lat0 + 300 * meterLat, lng: lng0 + 20 * meterLat / cos(lat0 * .pi / 180)),
        ]),
        GuideStepGeometry(description: "남", pathCoords: [
            RoutePoint(lat: lat0 + 300 * meterLat, lng: lng0 + 20 * meterLat / cos(lat0 * .pi / 180)),
            RoutePoint(lat: lat0, lng: lng0 + 20 * meterLat / cos(lat0 * .pi / 180)),
        ]),
    ])!
    #expect(entryProjection(route: uRoute, fix: fixCoord(along: 150, lateral: 10, acc: 10)) == .ambiguous)

    let single = buildGuideRoute([
        GuideStepGeometry(description: "직진", pathCoords: [
            RoutePoint(lat: lat0, lng: lng0),
            RoutePoint(lat: lat0 + 300 * meterLat, lng: lng0),
        ]),
    ])!
    if case let .ok(d) = entryProjection(route: single, fix: fixCoord(along: 150, lateral: 5, acc: 10)) {
        #expect(abs(d - 150) < 1)
    } else {
        Issue.record("단일 후보는 ok여야 한다")
    }
    #expect(entryProjection(route: single, fix: fixCoord(along: 150, lateral: 200, acc: 10)) == GuideEntryProjection.none)
}

@Test func unitAtContract() {
    let route = routeFrom([
        .init(len: 100, desc: "a"), .init(len: 20, desc: "b"),
        .init(len: 30, desc: "c"), .init(len: 100, desc: "d"),
    ])
    #expect(unitAt(route: route, index: 0) == [0])
    #expect(unitAt(route: route, index: 1) == [1, 2])
    #expect(unitAt(route: route, index: 2) == [1, 2])
    #expect(unitAt(route: route, index: 3) == [3])

    let bundleFirst = routeFrom([
        .init(len: 20, desc: "횡단보도"), .init(len: 16, desc: "이동"), .init(len: 100, desc: "직진"),
    ])
    #expect(initialGuideState(route: bundleFirst, now: 0).firstIndices == [0, 1])
}
