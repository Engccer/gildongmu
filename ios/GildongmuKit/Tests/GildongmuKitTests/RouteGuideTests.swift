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
    /// 종점 오프셋 기하를 아는 세션인가(미지정=모름 → 옛 50m 인계).
    let geometry: Bool?
    /// 경유지 스텝 index(N4). 미지정=경유지 없음.
    let waypointStepIndex: Int?
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
        /// 톤이 **없어야** 하는 지점(`tone`의 부정형). 40m 전문 낭독에서 `ahead` 톤이
        /// 10m 임박 큐로 옮겨 간 계약이 이 축으로만 잠긴다 — `tone` 단언만으로는
        /// "울리지 않아야 한다"를 표현할 수 없다.
        let toneNull: Bool?
    }
}

private func loadScenarios() throws -> [Scenario] {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() } // GildongmuKitTests→Tests→GildongmuKit→ios→repo
    url.appendPathComponent("src/lib/__tests__/fixtures/route-guide-scenarios.json")
    let data = try Data(contentsOf: url)
    return try JSONDecoder().decode(ScenarioFile.self, from: data).scenarios
}

private func routeFrom(_ steps: [Scenario.Step], waypointStepIndex: Int? = nil) -> GuideRoute {
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
    return buildGuideRoute(inputs, waypointStepIndex: waypointStepIndex)!
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
    case .imminent: "imminent"
    case .farNotice: "farNotice"
    case .periodic: "periodic"
    case .bundleReread: "bundleReread"
    case .waypointReached: "waypointReached"
    case .finalApproachEnter: "finalApproachEnter"
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
    case let .imminent(i, _): i
    case let .farNotice(i, _): i
    case let .bundleReread(i): i
    default: nil
    }
}

private func toneName(_ tone: GuideTone?) -> String? { tone?.rawValue }

@Test func sharedScenarioTable() throws {
    for sc in try loadScenarios() {
        let route = routeFrom(sc.steps, waypointStepIndex: sc.waypointStepIndex)
        let tuning: GuideTuning = sc.tuning == "car" ? .car : .walk
        var state = initialGuideState(
            route: route, now: 0, hasFinalApproachGeometry: sc.geometry == true
        ).state
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
            if ex.toneNull == true {
                for r in rs { #expect(r.tone == nil, "\(sc.name): toneNull") }
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

/// 최종 접근 진입(spec 2026-08-08 §3.2·§4) — 웹 route-guide.test.ts 미러.
/// 공유 fixture가 거리 경계와 래치를 덮고, 여기서는 fixture 스키마로 표현할 수 없는
/// 전이(낭독 미완·이탈 중·가드 순서)를 고정한다.
@Suite("최종 접근 진입 조건")
struct FinalApproachEntryTests {
    private func straight() -> GuideRoute {
        routeFrom([Scenario.Step(len: 100, desc: "직진 100m 이동")])
    }

    /// 종점 근처·전 스텝 낭독 완료·기하 있음인 상태.
    private func atEnd(_ route: GuideRoute, d: Double = 96) -> GuideState {
        var s = guideStateAt(route: route, d: d, now: 0, hasFinalApproachGeometry: true)
        s.announcedUpTo = route.steps.count - 1
        return s
    }

    @Test("낭독이 남아 있으면 종점에 닿아도 진입하지 않는다")
    func announcementIncomplete() {
        let route = routeFrom([
            Scenario.Step(len: 60, desc: "직진A"),
            Scenario.Step(len: 60, desc: "우회전B"),
        ])
        var state = atEnd(route, d: 112)
        state.announcedUpTo = 0
        let out = guideStep(
            state: state, fix: fixCoord(along: 115, lateral: 0, acc: 8),
            route: route, now: 10, tuning: .walk
        )
        #expect(out.event != .finalApproachEnter)
        #expect(out.state.phase != .finalApproach)
    }

    @Test("이탈 중이면 진입하지 않는다 — 이탈 판정이 먼저 반환한다")
    func offRouteBlocksEntry() {
        let route = straight()
        var state = atEnd(route)
        state.phase = .offRoute
        let out = guideStep(
            state: state, fix: fixCoord(along: 97, lateral: 60, acc: 8),
            route: route, now: 10, tuning: .walk
        )
        #expect(out.state.phase == .offRoute)
    }

    @Test("재무장 전이면 진입하지 않는다(수동 상세 복귀 세션)")
    func notArmed() {
        let route = straight()
        var state = atEnd(route)
        state.autoHandoffArmed = false
        let out = guideStep(
            state: state, fix: fixCoord(along: 97, lateral: 0, acc: 8),
            route: route, now: 10, tuning: .walk
        )
        #expect(out.event != .finalApproachEnter)
    }

    /// ⚠ 가드는 uncertain 게이트보다 **앞**에 있어야 한다. 뒤에 두면 정확도가 나빠질 때
    /// uncertain을 경유했다가 resumePhase(.following)로 복귀하며 래치가 조용히 풀린다.
    @Test("진입 후에는 정확도가 무효여도 uncertain으로 가지 않는다")
    func latchSurvivesBadAccuracy() {
        let route = straight()
        let entered = guideStep(
            state: atEnd(route), fix: fixCoord(along: 97, lateral: 0, acc: 8),
            route: route, now: 10, tuning: .walk
        )
        #expect(entered.event == .finalApproachEnter)
        #expect(entered.state.phase == .finalApproach)

        let bad = guideStep(
            state: entered.state, fix: fixCoord(along: 97, lateral: 0, acc: 200),
            route: route, now: 20, tuning: .walk
        )
        #expect(bad.state.phase == .finalApproach)
        #expect(bad.event == nil)
        #expect(bad.state.lastFixAt == 20)
    }

    @Test("재획득으로 상태를 다시 만들어도 기하 보유가 승계된다")
    func geometryFlagSurvivesReacquire() {
        let route = routeFrom([Scenario.Step(len: 400, desc: "직진")])
        var state = guideStateAt(
            route: route, d: 0, now: 0, hasFinalApproachGeometry: true
        )
        state.phase = .reacquiring
        state.lastFixAt = 0
        state = guideStep(
            state: state, fix: fixCoord(along: 200, lateral: 0, acc: 10),
            route: route, now: 10, tuning: .walk
        ).state
        #expect(state.phase != .reacquiring)
        #expect(state.hasFinalApproachGeometry)
    }

    @Test("진입선: 기하를 모르면 옛 50m, 알면 정확도와 하한 중 큰 값")
    func entryDistance() {
        let route = straight()
        var legacy = guideStateAt(route: route, d: 0, now: 0)
        legacy.hasFinalApproachGeometry = false
        #expect(
            finalApproachEntryMeters(state: legacy, accuracy: 5, tuning: .walk)
                == handoffDistMeters
        )
        let known = guideStateAt(
            route: route, d: 0, now: 0, hasFinalApproachGeometry: true
        )
        #expect(finalApproachEntryMeters(state: known, accuracy: 5, tuning: .walk) == 10)
        #expect(finalApproachEntryMeters(state: known, accuracy: 30, tuning: .walk) == 30)
    }
}

@Suite("폴리라인 접선")
struct TangentAtTests {
    /// 웹 `route-geometry.test.ts` "tangentAt" describe 미러.
    @Test("직선은 진행 방위, 시작·끝에서도 방위를 낸다")
    func tangentAtStraight() {
        let straight = buildGuideRoute([
            GuideStepGeometry(
                description: "북진",
                pathCoords: [
                    RoutePoint(lat: 37.5, lng: 127.1),
                    RoutePoint(lat: 37.5 + 100 / 111_320, lng: 127.1),
                ]
            )
        ])!
        #expect(abs(tangentAt(straight.polyline, d: 50, halfMeters: 15)!) < 1)
        #expect(abs(tangentAt(straight.polyline, d: 0, halfMeters: 15)!) < 1)
        #expect(abs(tangentAt(straight.polyline, d: 100, halfMeters: 15)!) < 1)
    }

    @Test("앞뒤 점이 같으면 nil (0도로 접지 않는다)")
    func tangentAtDegenerate() {
        let degenerate = GuidePolyline(points: [RoutePoint(lat: 37.5, lng: 127.1)], cum: [0])
        #expect(tangentAt(degenerate, d: 0, halfMeters: 15) == nil)
    }

    @Test("직각으로 꺾이는 지점의 접선은 두 방위 사이")
    func tangentAtCorner() {
        let lngPerM = 1 / (111_320 * cos(37.5 * .pi / 180))
        let corner = buildGuideRoute([
            GuideStepGeometry(
                description: "북",
                pathCoords: [
                    RoutePoint(lat: 37.5, lng: 127.1),
                    RoutePoint(lat: 37.5 + 50 / 111_320, lng: 127.1),
                ]
            ),
            GuideStepGeometry(
                description: "동",
                pathCoords: [
                    RoutePoint(lat: 37.5 + 50 / 111_320, lng: 127.1),
                    RoutePoint(lat: 37.5 + 50 / 111_320, lng: 127.1 + 50 * lngPerM),
                ]
            ),
        ])!
        let t = tangentAt(corner.polyline, d: 50, halfMeters: 15)!
        #expect(t > 20)
        #expect(t < 70)
    }
}

/// 웹 `route-guide.test.ts`의 "방위 축 통합"·"리듀서 trace" 미러.
@Suite("방위 축 리듀서 통합")
struct CourseAxisReducerTests {
    /// 남→북 직선 400m. 접선은 어디서나 0도.
    private let axisRoute: GuideRoute = buildGuideRoute([
        GuideStepGeometry(
            description: "북진",
            pathCoords: [
                RoutePoint(lat: lat0, lng: lng0),
                RoutePoint(lat: lat0 + 400 * meterLat, lng: lng0),
            ]
        )
    ])!

    private func axisFix(_ along: Double) -> GuideFix {
        fixCoord(along: along, lateral: 0, acc: 8)
    }

    /// bearingDeg 방향 1.2m/s·1Hz 보행 fix(관측은 리듀서 내부 유도기가 만든다).
    private func walk(
        _ state: inout GuideState, fromAlong: Double, lateral: Double = 0,
        bearingDeg: Double, seconds: Int, startAt: Double, tuning: GuideTuning = .walk,
        onEvent: (GuideEvent, Double) -> Bool = { _, _ in false }
    ) {
        let rad = bearingDeg * .pi / 180
        for i in 0...seconds {
            let along = fromAlong + cos(rad) * Double(i) * 1.2
            let lat = lateral + sin(rad) * Double(i) * 1.2
            let out = guideStep(
                state: state, fix: fixCoord(along: along, lateral: lat, acc: 8),
                route: axisRoute, now: startAt + Double(i), tuning: tuning
            )
            state = out.state
            if let e = out.event, onEvent(e, startAt + Double(i)) { return }
        }
    }

    /// 경로 위 역주행(남행)으로 방위 축을 확정시킨 상태(웹 confirmedByReversal 미러).
    /// 확정 이벤트가 나온 fix에서 멈춰 반환한다 — 이후 케이스가 이어 걸 수 있게.
    private func confirmedByReversal() -> (state: GuideState, confirmedAt: Double, alongNow: Double)? {
        var state = initialGuideState(route: axisRoute, now: 0).state
        walk(&state, fromAlong: 60, bearingDeg: 0, seconds: 33, startAt: 0)
        var hit: (Double, Double)?
        walk(&state, fromAlong: 100, bearingDeg: 180, seconds: 55, startAt: 34) { e, t in
            if e == .offRoute {
                hit = (t, 100 - (t - 34) * 1.2)
                return true
            }
            return false
        }
        guard let (t, along) = hit else { return nil }
        return (state, t, along)
    }

    @Test("경로 위 역주행은 방위 축이 확정한다 — 수직거리 축이 못 보는 이탈")
    func courseAxisConfirmsOnReversal() {
        guard let r = confirmedByReversal() else {
            Issue.record("역주행 55초 안에 방위 축이 확정해야 한다")
            return
        }
        #expect(r.state.phase == .offRoute)
        #expect(r.state.offRouteAxes.course)
        // 수직거리는 내내 임계 안이므로 거리 축은 잠기지 않았다.
        #expect(!r.state.offRouteAxes.distance)
    }

    @Test("멈춰 서면 관측이 말라 복귀를 선언하지 않는다 — unknown은 정합이 아니다")
    func unknownIsNotRecovery() {
        guard let r = confirmedByReversal() else {
            Issue.record("확정 실패")
            return
        }
        var state = r.state
        for i in 1...40 {
            let out = guideStep(
                state: state, fix: fixCoord(along: r.alongNow, lateral: 0, acc: 8),
                route: axisRoute, now: r.confirmedAt + Double(i), tuning: .walk
            )
            state = out.state
            #expect(out.event != .backOnRoute)
        }
        #expect(state.phase == .offRoute)
        #expect(state.offRouteAxes.course)
    }

    @Test("방위 축으로 확정한 이탈은 경로 방향으로 걸어야 복귀한다")
    func recoveryRequiresMatchingCourse() {
        guard let r = confirmedByReversal() else {
            Issue.record("확정 실패")
            return
        }
        var state = r.state
        var recovered = false
        walk(&state, fromAlong: r.alongNow, bearingDeg: 0, seconds: 60, startAt: r.confirmedAt + 1) { e, _ in
            if e == .backOnRoute {
                recovered = true
                return true
            }
            return false
        }
        #expect(recovered)
        #expect(state.phase != .offRoute)
        #expect(state.offRouteAxes == OffRouteAxes())
    }

    @Test("차량 프로파일에서는 축이 통째로 꺼진다 — 보행으로만 측정된 상수다")
    func carProfileDisablesAxis() {
        var walkState = initialGuideState(route: axisRoute, now: 0).state
        var carState = initialGuideState(route: axisRoute, now: 0).state
        for tuningAndState in [true, false] {
            var s = tuningAndState ? walkState : carState
            let tuning: GuideTuning = tuningAndState ? .walk : .car
            walk(&s, fromAlong: 60, bearingDeg: 0, seconds: 33, startAt: 0, tuning: tuning)
            walk(&s, fromAlong: 100, bearingDeg: 180, seconds: 40, startAt: 34, tuning: tuning)
            if tuningAndState { walkState = s } else { carState = s }
        }
        #expect(walkState.offRouteAxes.course)
        #expect(!carState.offRouteAxes.course)
        #expect(carState.phase != .offRoute)
        // 게이트는 관측을 중화하므로 표 자체가 창에 쌓이지 않는다(spec §2.10 — 표 없음).
        #expect(carState.courseVotes.isEmpty)
    }

    @Test("국면 전이는 표결 창을 비우고 유도기 버퍼는 남긴다")
    func transitionsClearVotesButKeepBuffer() {
        var primed = initialGuideState(route: axisRoute, now: 0).state
        walk(&primed, fromAlong: 60, bearingDeg: 0, seconds: 20, startAt: 0)
        #expect(!primed.courseVotes.isEmpty)
        #expect(!primed.courseDerivation.fixes.isEmpty)

        // uncertain 진입(정확도 악화)
        let toUncertain = guideStep(
            state: primed, fix: fixCoord(along: 85, lateral: 0, acc: 80),
            route: axisRoute, now: 21, tuning: .walk
        ).state
        #expect(toUncertain.phase == .uncertain)
        #expect(toUncertain.courseVotes.isEmpty)
        #expect(!toUncertain.courseDerivation.fixes.isEmpty)

        // reacquiring 진입(fix 공백 11초)
        let toReacquiring = guideStep(
            state: primed, fix: fixCoord(along: 85, lateral: 0, acc: 8),
            route: axisRoute, now: 32, tuning: .walk
        ).state
        #expect(toReacquiring.phase == .reacquiring)
        #expect(toReacquiring.courseVotes.isEmpty)
        #expect(!toReacquiring.courseDerivation.fixes.isEmpty)
    }

    @Test("상태 재구성은 표결 창을 비우고, 유도기 버퍼는 승계 인자로만 잇는다(§2.9)")
    func rebuildClearsVotesButCarriesBufferOnlyWhenPassed() {
        var primed = initialGuideState(route: axisRoute, now: 0).state
        walk(&primed, fromAlong: 60, bearingDeg: 0, seconds: 20, startAt: 0)
        #expect(!primed.courseDerivation.fixes.isEmpty)
        // 새 세션(인자 생략)은 창·버퍼 전부 초기화.
        let fresh = guideStateAt(route: axisRoute, d: 0, now: 100)
        #expect(fresh.courseVotes.isEmpty)
        #expect(fresh.courseDerivation.fixes.isEmpty)
        // 같은 세션의 재구성(재조회·모드 전환)은 버퍼를 넘겨 잇는다 — 창은 여전히 비운다.
        let carried = guideStateAt(
            route: axisRoute, d: 0, now: 100, courseDerivation: primed.courseDerivation
        )
        #expect(carried.courseVotes.isEmpty)
        #expect(carried.courseDerivation == primed.courseDerivation)
        let reroute = initialGuideState(
            route: axisRoute, now: 100, courseDerivation: primed.courseDerivation
        )
        #expect(reroute.state.courseDerivation == primed.courseDerivation)
    }

    @Test("방위 축 확정이 최종 접근 진입보다 앞이다 — 같은 fix에서는 이탈이 이긴다")
    func courseVerdictWinsOverFinalApproach() {
        // 유도 관측으로는 "종점 접근 중 + 방위 어긋남"을 한 궤적으로 만들 수 없어
        // (관측이 곧 이동이다) 웹 테스트와 동형으로 창을 직접 구성한다:
        // mismatch 다수 창 + 종점 잔여 ≤ 진입선(spec §2.7 순서 불변식 — 변이 6 안전망).
        let mismatchWindow = (0..<9).map { CourseVoteSample(at: Double($0) * 2, vote: .mismatch) }
        var nearEnd = guideStateAt(
            route: axisRoute, d: 392, now: 0, hasFinalApproachGeometry: true
        )
        nearEnd.announcedUpTo = axisRoute.steps.count - 1
        nearEnd.courseVotes = mismatchWindow
        // 관측 없는 fix(버퍼 비어 있음) — 창은 이미 확정 다수이고 잔여 7m ≤ 진입선 10m.
        let out = guideStep(
            state: nearEnd, fix: fixCoord(along: 393, lateral: 0, acc: 8),
            route: axisRoute, now: 18, tuning: .walk
        )
        #expect(out.event == .offRoute)
        #expect(out.state.phase == .offRoute)
        #expect(out.state.offRouteAxes.course)

        // 대조: 창이 비어 있으면 같은 fix가 최종 접근에 진입한다(순서 외 조건 동일).
        var clean = nearEnd
        clean.courseVotes = []
        let enter = guideStep(
            state: clean, fix: fixCoord(along: 393, lateral: 0, acc: 8),
            route: axisRoute, now: 18, tuning: .walk
        )
        #expect(enter.event == .finalApproachEnter)
    }

    @Test("uncertain을 경유해도 축 latch가 보존된다")
    func latchSurvivesUncertain() {
        guard let r = confirmedByReversal() else {
            Issue.record("확정 실패")
            return
        }
        var state = r.state
        for i in 1...5 {
            state = guideStep(
                state: state, fix: fixCoord(along: r.alongNow, lateral: 0, acc: 80),
                route: axisRoute, now: r.confirmedAt + Double(i), tuning: .walk
            ).state
        }
        #expect(state.phase == .uncertain)
        #expect(state.resumePhase == .offRoute)
        #expect(state.offRouteAxes.course)
    }
}

// MARK: - 리듀서 trace 공유 fixture

private struct ReducerFix: Decodable {
    let t: Double
    let along: Double
    let lateral: Double
    let acc: Double
}

private struct ReducerCase: Decodable {
    let name: String
    let steps: [ReducerStep]
    let fixes: [ReducerFix]
    let expectPhaseAtEnd: String
    let expectAxes: ExpectAxes

    struct ReducerStep: Decodable {
        let len: Double
        let desc: String
    }

    struct ExpectAxes: Decodable {
        let distance: Bool
        let course: Bool
    }
}

private struct CourseAxisFile: Decodable {
    let reducer: [ReducerCase]
}

private func loadReducerCases() throws -> [ReducerCase] {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() } // GildongmuKitTests→Tests→GildongmuKit→ios→repo
    url.appendPathComponent("src/lib/__tests__/fixtures/course-axis-scenarios.json")
    return try JSONDecoder().decode(CourseAxisFile.self, from: Data(contentsOf: url)).reducer
}

/// fixture는 경계만 적는다 — 보간 규칙은 파일의 `reducerComment`가 정본이다.
private func interpolate(_ fixes: [ReducerFix]) -> [ReducerFix] {
    var out = [fixes[0]]
    for i in 1..<fixes.count {
        let a = fixes[i - 1]
        let b = fixes[i]
        var t = a.t + 1
        while t <= b.t {
            let r = (t - a.t) / (b.t - a.t)
            out.append(
                ReducerFix(
                    t: t,
                    along: a.along + r * (b.along - a.along),
                    lateral: a.lateral + r * (b.lateral - a.lateral),
                    acc: b.acc
                )
            )
            t += 1
        }
    }
    return out
}

@Suite("방위 축 리듀서 trace (웹 동조 가드)")
struct CourseAxisReducerTraceTests {
    @Test("웹과 같은 국면·축 latch로 끝난다")
    func traceMatchesWeb() throws {
        let cases = try loadReducerCases()
        // ⚠ 공회전 방지: 키 이름이 바뀌거나 배열이 비면 for 루프가 0회 돌고 조용히
        //   통과한다. 가드가 무는지는 케이스가 실제로 있는지에 달렸다.
        #expect(cases.count >= 2)
        for sc in cases {
            var acc = 0.0
            let route = buildGuideRoute(
                sc.steps.map { s in
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
            )!
            var state = initialGuideState(route: route, now: 0).state
            // ⚠ fix에 방위 필드가 없는 것 자체가 계약이다 — 관측은 리듀서 내부
            //   유도기가 궤적에서 만들고 플랫폼은 주입할 수 없다(spec §2.9).
            for f in interpolate(sc.fixes) {
                state = guideStep(
                    state: state,
                    fix: fixCoord(along: f.along, lateral: f.lateral, acc: f.acc),
                    route: route, now: f.t, tuning: .walk
                ).state
            }
            #expect(
                phaseName(state.phase) == sc.expectPhaseAtEnd,
                "\(sc.name): phase \(phaseName(state.phase)) want \(sc.expectPhaseAtEnd)"
            )
            #expect(
                state.offRouteAxes
                    == OffRouteAxes(distance: sc.expectAxes.distance, course: sc.expectAxes.course),
                "\(sc.name): axes \(state.offRouteAxes)"
            )
        }
    }
}

private func phaseName(_ p: GuidePhase) -> String {
    switch p {
    case .following: return "following"
    case .bundle: return "bundle"
    case .uncertain: return "uncertain"
    case .reacquiring: return "reacquiring"
    case .offRoute: return "offRoute"
    case .finalApproach: return "finalApproach"
    }
}

/// 표시 좌표계(spec 2026-08-11 §3) — 웹 route-guide.test.ts 동형 경계표.
@Test func displayCoordinate() {
    #expect(projectionLagMeters == 10)
    #expect(imminentAheadMeters == 20) // 10 + lag 유도식(lag 하향은 실보행 재판정 2026-08-12)
    #expect(displayEffectiveD(d: 0, baselineD: 0) == 0)
    #expect(displayEffectiveD(d: 5, baselineD: 0) == 10) // 램프인: lag 5
    #expect(displayEffectiveD(d: 20, baselineD: 0) == 30) // lag 10 포화
    #expect(displayEffectiveD(d: 60, baselineD: 50) == 70) // 재조회 기준점 50 이후 10 → lag 10(포화점)
    #expect(displayEffectiveD(d: 40, baselineD: 50) == 40) // 기준점 이전(방어)
}

@Test("도착 추정은 walk 전용이다 (spec 2026-08-13 §4)")
func presumedArrivalGateIsWalkOnly() {
    #expect(GuideTuning.walk.presumedArrivalEnabled)
    #expect(!GuideTuning.car.presumedArrivalEnabled)
}


// MARK: - 경유지(N4)

@Test func waypointIndexOutOfRangeRejectsRoute() {
    let steps = [
        GuideStepGeometry(description: "A", pathCoords: [RoutePoint(lat: 37.5, lng: 127.1), RoutePoint(lat: 37.501, lng: 127.1)]),
        GuideStepGeometry(description: "B", pathCoords: [RoutePoint(lat: 37.501, lng: 127.1), RoutePoint(lat: 37.502, lng: 127.1)]),
    ]
    #expect(buildGuideRoute(steps, waypointStepIndex: 2) == nil)
    #expect(buildGuideRoute(steps, waypointStepIndex: -1) == nil)
    #expect(buildGuideRoute(steps, waypointStepIndex: 0)?.waypointStepIndex == 0)
    #expect(buildGuideRoute(steps, waypointStepIndex: 1)?.waypointStepIndex == 1)
    #expect(buildGuideRoute(steps)?.waypointStepIndex == nil)
}

/// 재획득·복귀 재구성(`restateAt`)은 도착 래치를 승계한다 — 지우면 같은 경유지를 다시 알린다.
@Test func restateCarriesWaypointLatch() {
    let route = routeFrom([.init(len: 100, desc: "A"), .init(len: 100, desc: "B")], waypointStepIndex: 1)
    var prev = initialGuideState(route: route, now: 0).state
    prev.waypointReached = true
    prev.waypointPending = true
    let re = restateAt(route: route, d: 150, now: 10, prev: prev)
    #expect(re.waypointReached && re.waypointPending)
}
