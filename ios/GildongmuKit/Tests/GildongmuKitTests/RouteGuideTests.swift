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
    let tuning: String?
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
    case .farNotice: "farNotice"
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
    case let .farNotice(i, _): i
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
        let tuning: GuideTuning = sc.tuning == "car" ? .car : .walk
        var state = initialGuideState(route: route, now: 0).state
        var results: [(event: GuideEvent?, tone: GuideTone?)] = []
        for f in sc.fixes {
            let out = guideStep(
                state: state,
                fix: fixCoord(along: f.along, lateral: f.lateral, acc: f.acc),
                route: route,
                now: f.t,
                tuning: tuning
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

/// 속도 가드 표본 소멸 시 해제(정확도 배제의 2차 회귀 차단 — 웹 route-guide.test.ts 미러).
/// 가드 활성 후 21~50m 정확도 지속(표본 배제만 발동)으로 시간창이 마르면 가드를
/// 해제해야 한다 — 미해제면 이탈 재통지가 무기한 억제된다(독립 리뷰 MAJOR).
@Test func speedGuardClearsWhenSamplesStarve() {
    let route = routeFrom([.init(len: 2000, desc: "직진")])
    var state = initialGuideState(route: route, now: 0).state
    var lastEvent: GuideEvent?
    for (t, along) in [(0.0, 0.0), (5.0, 40.0), (10.0, 90.0)] {
        let out = guideStep(
            state: state, fix: fixCoord(along: along, lateral: 0, acc: 10),
            route: route, now: t, tuning: .walk
        )
        state = out.state
        lastEvent = out.event
    }
    #expect(kindName(lastEvent) == "speedSuggest")
    #expect(state.speedGuardActive)
    for t in [15.0, 20.0] {
        state = guideStep(
            state: state, fix: fixCoord(along: 90, lateral: 0, acc: 30),
            route: route, now: t, tuning: .walk
        ).state
        #expect(state.speedGuardActive) // 잔여 표본이 남은 동안은 동결 유지
    }
    state = guideStep(
        state: state, fix: fixCoord(along: 90, lateral: 0, acc: 30),
        route: route, now: 25, tuning: .walk
    ).state
    #expect(state.speedSamples.isEmpty)
    #expect(!state.speedGuardActive)
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

/// U자 경로(북 300 → 동 40 → 남 300) — 재획득 타이브레이크 직접 테스트용(웹 미러).
private func uRoute40() -> GuideRoute {
    let east = 40 * meterLat / cos(lat0 * .pi / 180)
    return buildGuideRoute([
        GuideStepGeometry(description: "북", pathCoords: [
            RoutePoint(lat: lat0, lng: lng0),
            RoutePoint(lat: lat0 + 300 * meterLat, lng: lng0),
        ]),
        GuideStepGeometry(description: "동", pathCoords: [
            RoutePoint(lat: lat0 + 300 * meterLat, lng: lng0),
            RoutePoint(lat: lat0 + 300 * meterLat, lng: lng0 + east),
        ]),
        GuideStepGeometry(description: "남", pathCoords: [
            RoutePoint(lat: lat0 + 300 * meterLat, lng: lng0 + east),
            RoutePoint(lat: lat0, lng: lng0 + east),
        ]),
    ])!
}

private func enterReacquiring(_ route: GuideRoute, dPrev: Double) -> GuideState {
    var state = guideStateAt(route: route, d: dPrev, now: 0)
    state.lastFixAt = 0
    let out = guideStep(
        state: state, fix: fixCoord(along: dPrev, lateral: 0, acc: 10),
        route: route, now: 11, tuning: .car
    )
    #expect(out.event == .reacquiring)
    return out.state
}

@Test func carReacquireTieBreakAdoptsSingleForwardCandidate() {
    let route = uRoute40()
    let st = enterReacquiring(route, dPrev: 100) // v=0 → 창 [100, 200]
    let out = guideStep(
        state: st, fix: fixCoord(along: 150, lateral: 10, acc: 10),
        route: route, now: 12, tuning: .car
    )
    // 후보: 북 d≈150(창 안) vs 남 d≈490(창 밖) → 단일 채택
    #expect(out.event == .reacquired)
    #expect(abs(out.state.d - 150) < 1)
}

@Test func carReacquireTieBreakRejectsZeroInWindow() {
    let route = uRoute40()
    let st = enterReacquiring(route, dPrev: 100)
    let out = guideStep(
        state: st, fix: fixCoord(along: 250, lateral: 20, acc: 10),
        route: route, now: 12, tuning: .car
    )
    // 북 d≈250·남 d≈390 — 둘 다 창 [100,200] 밖 → 거부 유지
    #expect(out.event == nil)
    #expect(out.state.phase == .reacquiring)
}

@Test func carReacquireTieBreakRejectsMultipleInWindow() {
    let route = uRoute40()
    var st = enterReacquiring(route, dPrev: 100)
    st.reacquireV = 20 // 창 상한 100 + 20×12×1.5 + 100 = 560
    let out = guideStep(
        state: st, fix: fixCoord(along: 250, lateral: 20, acc: 10),
        route: route, now: 12, tuning: .car
    )
    // 북 d≈250·남 d≈390 둘 다 창 안 → 복수 거부(평행도로 이탈 은폐 차단)
    #expect(out.event == nil)
    #expect(out.state.phase == .reacquiring)
}

@Test func carReacquireTieBreakCoefficientLocksAdoption() {
    // 북 900 → 동 40 → 남 900. prevD=100·v=20·elapsed 12초: 창 상한이 1.5×면
    // 560, 1.0×이면 440 — d≈500 후보는 1.5×에서만 창 안(계수 회귀 잠금, 웹 미러).
    let east = 40 * meterLat / cos(lat0 * .pi / 180)
    let route = buildGuideRoute([
        GuideStepGeometry(description: "북", pathCoords: [
            RoutePoint(lat: lat0, lng: lng0),
            RoutePoint(lat: lat0 + 900 * meterLat, lng: lng0),
        ]),
        GuideStepGeometry(description: "동", pathCoords: [
            RoutePoint(lat: lat0 + 900 * meterLat, lng: lng0),
            RoutePoint(lat: lat0 + 900 * meterLat, lng: lng0 + east),
        ]),
        GuideStepGeometry(description: "남", pathCoords: [
            RoutePoint(lat: lat0 + 900 * meterLat, lng: lng0 + east),
            RoutePoint(lat: lat0, lng: lng0 + east),
        ]),
    ])!
    var entered = enterReacquiring(route, dPrev: 100)
    entered.reacquireV = 20
    let out = guideStep(
        state: entered, fix: fixCoord(along: 500, lateral: 10, acc: 10),
        route: route, now: 12, tuning: .car
    )
    #expect(out.event == .reacquired)
    #expect(abs(out.state.d - 500) < 5)
}

@Test func carReacquireTieBreakBufferLocksAdoption() {
    let route = uRoute40()
    let st = enterReacquiring(route, dPrev: 100) // v=0 → 창 [100, 200]
    // d≈180은 버퍼 100일 때만 창 안(50이면 상한 150 밖) — 버퍼 회귀 잠금.
    let out = guideStep(
        state: st, fix: fixCoord(along: 180, lateral: 10, acc: 10),
        route: route, now: 12, tuning: .car
    )
    #expect(out.event == .reacquired)
    #expect(abs(out.state.d - 180) < 5)
}

@Test func carOffRouteRenotifyIntervalAndNoTone() {
    let route = routeFrom([.init(len: 600, desc: "직진")])
    var state = guideStateAt(route: route, d: 0, now: 0)
    state.lastFixAt = 0
    var confirm: GuideOutput?
    for (t, along) in [(5.0, 40.0), (10.0, 80.0), (15.0, 120.0)] {
        confirm = guideStep(
            state: state, fix: fixCoord(along: along, lateral: 60, acc: 10),
            route: route, now: t, tuning: .car
        )
        state = confirm!.state
    }
    #expect(confirm?.event == .offRoute)
    #expect(confirm?.tone == .warning) // 첫 확정은 항상 경고 톤

    var renotifyAt: Double?
    var renotifyTone: GuideTone? = .warning
    var t = 24.0
    while t <= 210 {
        let out = guideStep(
            state: state, fix: fixCoord(along: 200, lateral: 60, acc: 10),
            route: route, now: t, tuning: .car
        )
        state = out.state
        if out.event == .offRoute {
            renotifyAt = t
            renotifyTone = out.tone
            break
        }
        t += 9
    }
    #expect(renotifyAt != nil)
    #expect((renotifyAt ?? 0) >= 195) // 확정 15 + 180
    #expect(renotifyTone == nil) // 재통지는 무톤(§4.3)
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
