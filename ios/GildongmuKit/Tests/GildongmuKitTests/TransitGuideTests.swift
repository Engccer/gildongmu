import Foundation
import Testing
@testable import GildongmuKit

/// 웹 정본과 같은 공유 fixture(`src/lib/__tests__/fixtures/transit-guide-scenarios.json`)를
/// 레포 상대 경로로 직접 읽어 같은 전이·이벤트를 단언한다(사본 금지 — RouteGuideTests 관례).

private struct FixtureFile: Decodable {
    let routes: [String: TransitGuideRoute]
    let locks: [String: TransitLock]
    let scenarios: [FixtureScenario]
}

private struct FixtureScenario: Decodable {
    let name: String
    let route: String
    let steps: [FixtureStep]
}

private struct FixtureStep: Decodable {
    let at: Double
    let input: FixtureInput
    let expect: FixtureExpect
}

private struct FixtureInput: Decodable {
    let kind: String
    let lock: String?
    let seq: Int?
    let phaseGen: Int?
    let poll: FixturePoll?
}

private struct FixturePoll: Decodable {
    let kind: String
    let items: [TransitTrackItem]?
}

private struct FixtureExpect: Decodable {
    let phase: String?
    let signal: String?
    let legIndex: Int?
    // remaining은 "명시 null"(추출 실패 기대)과 "미지정"을 구분해야 한다.
    let remaining: Int??
    let dataAgeSeconds: Int??
    let event: FixtureEvent??

    enum CodingKeys: String, CodingKey { case phase, signal, legIndex, remaining, dataAgeSeconds, event }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        phase = try c.decodeIfPresent(String.self, forKey: .phase)
        signal = try c.decodeIfPresent(String.self, forKey: .signal)
        legIndex = try c.decodeIfPresent(Int.self, forKey: .legIndex)
        remaining = c.contains(.remaining)
            ? .some(try c.decodeIfPresent(Int.self, forKey: .remaining))
            : .none
        dataAgeSeconds = c.contains(.dataAgeSeconds)
            ? .some(try c.decodeIfPresent(Int.self, forKey: .dataAgeSeconds))
            : .none
        event = c.contains(.event)
            ? .some(try c.decodeIfPresent(FixtureEvent.self, forKey: .event))
            : .none
    }
}

private struct FixtureEvent: Decodable {
    let kind: String
    let legIndex: Int?
    let remaining: Int?
    let certain: Bool?
    let final: Bool?
    // currentLocation은 "명시 null"(병치 없음 기대)과 "미지정"을 구분한다.
    let currentLocation: String??

    enum CodingKeys: String, CodingKey { case kind, legIndex, remaining, certain, final, currentLocation }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = try c.decode(String.self, forKey: .kind)
        legIndex = try c.decodeIfPresent(Int.self, forKey: .legIndex)
        remaining = try c.decodeIfPresent(Int.self, forKey: .remaining)
        certain = try c.decodeIfPresent(Bool.self, forKey: .certain)
        final = try c.decodeIfPresent(Bool.self, forKey: .final)
        currentLocation = c.contains(.currentLocation)
            ? .some(try c.decodeIfPresent(String.self, forKey: .currentLocation))
            : .none
    }
}

private func loadFixture() throws -> FixtureFile {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() } // GildongmuKitTests→Tests→GildongmuKit→ios→repo
    url.appendPathComponent("src/lib/__tests__/fixtures/transit-guide-scenarios.json")
    let data = try Data(contentsOf: url)
    return try JSONDecoder().decode(FixtureFile.self, from: data)
}

private func toInput(_ raw: FixtureInput, locks: [String: TransitLock]) throws -> TransitGuideInput {
    switch raw.kind {
    case "board":
        guard let ref = raw.lock, let lock = locks[ref] else {
            throw NSError(domain: "fixture", code: 1)
        }
        return .board(lock)
    case "changeBoarding":
        return .changeBoarding
    case "advance":
        return .advance
    case "poll":
        guard let seq = raw.seq, let phaseGen = raw.phaseGen, let poll = raw.poll else {
            throw NSError(domain: "fixture", code: 2)
        }
        let p: TransitTrackPoll = switch poll.kind {
        case "ok": .ok(poll.items ?? [])
        case "empty": .empty
        case "unsupported": .unsupported
        default: .failed
        }
        return .poll(seq: seq, phaseGen: phaseGen, poll: p)
    default:
        throw NSError(domain: "fixture", code: 3)
    }
}

/// 이벤트 종류를 fixture 문자열로 환원(웹 event.kind 대응).
private func kindName(_ event: TransitGuideEvent?) -> String? {
    switch event {
    case .boarded: "boarded"
    case .trackingStarted: "trackingStarted"
    case .countdown: "countdown"
    case .messageChanged: "messageChanged"
    case .arrived: "arrived"
    case .backOnTrack: "backOnTrack"
    case .approxVehicleChanged: "approxVehicleChanged"
    case .signalLost: "signalLost"
    case .upstreamFailed: "upstreamFailed"
    case .signalRecovered: "signalRecovered"
    case .legAdvanced: "legAdvanced"
    case .boardingReset: "boardingReset"
    case .capSlowed: "capSlowed"
    case nil: nil
    }
}

@Test func sharedTransitScenarioTable() throws {
    let fixture = try loadFixture()
    for scenario in fixture.scenarios {
        guard let route = fixture.routes[scenario.route] else {
            Issue.record("route 미정의: \(scenario.route)")
            continue
        }
        var state = initTransitGuide(route: route, now: 0)
        for (i, step) in scenario.steps.enumerated() {
            let input = try toInput(step.input, locks: fixture.locks)
            let result = transitGuideStep(state: state, input: input, route: route, now: step.at)
            state = result.state
            let ctx = "\(scenario.name) step \(i)"
            if let phase = step.expect.phase {
                #expect(state.phase.rawValue == phase, "\(ctx) phase")
            }
            if let signal = step.expect.signal {
                #expect(state.signal.rawValue == signal, "\(ctx) signal")
            }
            if let legIndex = step.expect.legIndex {
                #expect(state.legIndex == legIndex, "\(ctx) legIndex")
            }
            if case let .some(expected) = step.expect.remaining {
                #expect(state.remaining == expected, "\(ctx) remaining")
            }
            if case let .some(expected) = step.expect.dataAgeSeconds {
                #expect(state.dataAgeSeconds == expected, "\(ctx) dataAgeSeconds")
            }
            if case let .some(expectedEvent) = step.expect.event {
                if let expectedEvent {
                    #expect(kindName(result.event) == expectedEvent.kind, "\(ctx) event.kind")
                    switch result.event {
                    case let .boarded(legIndex):
                        if let e = expectedEvent.legIndex { #expect(legIndex == e, "\(ctx) event.legIndex") }
                    case let .countdown(remaining, _, currentLocation):
                        if let e = expectedEvent.remaining { #expect(remaining == e, "\(ctx) event.remaining") }
                        if case let .some(e) = expectedEvent.currentLocation {
                            #expect(currentLocation == e, "\(ctx) event.currentLocation")
                        }
                    case let .trackingStarted(_, remaining):
                        if let e = expectedEvent.remaining { #expect(remaining == e, "\(ctx) event.remaining") }
                    case let .arrived(certain):
                        if let e = expectedEvent.certain { #expect(certain == e, "\(ctx) event.certain") }
                    case let .legAdvanced(legIndex, final):
                        if let e = expectedEvent.legIndex { #expect(legIndex == e, "\(ctx) event.legIndex") }
                        if let e = expectedEvent.final { #expect(final == e, "\(ctx) event.final") }
                    default:
                        break
                    }
                } else {
                    #expect(result.event == nil, "\(ctx) event null")
                }
            }
        }
    }
}

// === fixture 밖 단위 검증(웹 unit 테스트 미러) ===

@Test func adaptivePollingIntervals() throws {
    let fixture = try loadFixture()
    let route = fixture.routes["subwaySingle"]!
    let lock = fixture.locks["subway5696"]!
    var state = initTransitGuide(route: route, now: 0)
    #expect(transitPollIntervalMs(state) == 20_000)
    state = transitGuideStep(state: state, input: .board(lock), route: route, now: 0).state
    #expect(transitPollIntervalMs(state) == 60_000)
    let far = TransitTrackItem(
        vehicleId: "5696", direction: "하행", message: "[9]번째 전역", remainingStops: 9,
        destinationName: "하남검단산", express: false, arrivalCode: "99")
    state = transitGuideStep(
        state: state, input: .poll(seq: 1, phaseGen: 1, poll: .ok([far])), route: route, now: 1
    ).state
    // §12 개정: 추적 중이면 원거리도 15초(원거리 30초 폐지).
    #expect(transitPollIntervalMs(state) == 15_000)
    let near = TransitTrackItem(
        vehicleId: "5696", direction: "하행", message: "[3]번째 전역", remainingStops: 3,
        destinationName: "하남검단산", express: false, arrivalCode: "99")
    state = transitGuideStep(
        state: state, input: .poll(seq: 2, phaseGen: 1, poll: .ok([near])), route: route, now: 2
    ).state
    #expect(transitPollIntervalMs(state) == 15_000)
    // advance는 arrived에서만 유효(리듀서 가드) — 도착 관측 후 전환.
    let arrivedItem = TransitTrackItem(
        vehicleId: "5696", direction: "하행", message: "여의도 도착", remainingStops: 0,
        destinationName: "하남검단산", express: false, arrivalCode: "1")
    state = transitGuideStep(
        state: state, input: .poll(seq: 3, phaseGen: 1, poll: .ok([arrivedItem])), route: route, now: 3
    ).state
    state = transitGuideStep(state: state, input: .advance, route: route, now: 4).state
    #expect(state.phase == .done)
    #expect(transitPollIntervalMs(state) == 0)
    #expect(transitPollIntervalMs(initTransitGuide(route: fixture.routes["untrackableSubway"]!, now: 0)) == 0)
}

@Test func sessionPollCapAnnouncesOnce() throws {
    let fixture = try loadFixture()
    let route = fixture.routes["subwaySingle"]!
    var state = initTransitGuide(route: route, now: 0)
    state = transitGuideStep(
        state: state, input: .board(fixture.locks["subway5696"]!), route: route, now: 0
    ).state
    var capEvents = 0
    for i in 1...(transitSessionPollCap + 5) {
        let r = transitGuideStep(
            state: state, input: .poll(seq: i, phaseGen: 1, poll: .empty),
            route: route, now: Double(i) * 1000)
        state = r.state
        if case .capSlowed = r.event { capEvents += 1 }
    }
    #expect(capEvents == 1)
    #expect(transitPollIntervalMs(state) == 60_000)
}

@Test func eventProfileChannels() {
    #expect(transitEventProfile(.countdown(remaining: 1, message: "", currentLocation: nil)).interrupt == true)
    #expect(transitEventProfile(.countdown(remaining: 2, message: "", currentLocation: nil)).interrupt == false)
    #expect(transitEventProfile(.arrived(certain: true)).interrupt == true)
    #expect(transitEventProfile(.signalLost).interrupt == false)
}

@Test func odsayLineMapping() {
    #expect(subwayIdForOdsayLine("수도권 5호선") == "1005")
    #expect(subwayIdForOdsayLine("수도권 수인.분당선") == "1075")
    #expect(subwayIdForOdsayLine("신분당선") == "1077")
    #expect(subwayIdForOdsayLine("대전 1호선") == nil)
}

@Test func buildGuideRouteFoldsWalkContext() {
    let route = TransitRoute(
        summary: TransitRouteSummary(
            totalMinutes: 30, fare: 1500, transfers: 0, walkMinutes: 8,
            departName: "천호", arriveName: "여의도"),
        legs: [
            TransitRouteLeg(
                mode: "walk", lineName: nil, fromName: nil, toName: nil,
                stationCount: nil, minutes: 3, serviceStatus: nil,
                firstServiceTime: nil, lastServiceTime: nil),
            TransitRouteLeg(
                mode: "subway", lineName: "수도권 5호선", fromName: "천호", toName: "여의도",
                stationCount: 8, minutes: 20, serviceStatus: nil,
                firstServiceTime: nil, lastServiceTime: nil, serviceWayCode: 2),
            TransitRouteLeg(
                mode: "walk", lineName: nil, fromName: nil, toName: nil,
                stationCount: nil, minutes: 5, serviceStatus: nil,
                firstServiceTime: nil, lastServiceTime: nil),
        ])
    let guide = buildTransitGuideRoute(route)
    #expect(guide?.legs.count == 1)
    #expect(guide?.legs.first?.walkBeforeMinutes == 3)
    #expect(guide?.legs.first?.trackMode == .subway)
    #expect(guide?.walkAfterMinutes == 5)

    let walkOnly = TransitRoute(
        summary: TransitRouteSummary(
            totalMinutes: 10, fare: 0, transfers: 0, walkMinutes: 10,
            departName: nil, arriveName: nil),
        legs: [TransitRouteLeg(
            mode: "walk", lineName: nil, fromName: nil, toName: nil,
            stationCount: nil, minutes: 10, serviceStatus: nil,
            firstServiceTime: nil, lastServiceTime: nil)])
    #expect(buildTransitGuideRoute(walkOnly) == nil)
}

@Test func boardingCandidateClassification() {
    let leg = TransitGuideLeg(
        mode: "subway", lineName: "수도권 5호선", trackMode: .subway,
        boardName: "천호", alightName: "여의도",
        boardStop: TransitLegStop(name: "천호", lat: 37.5385, lng: 127.1235),
        alightStop: TransitLegStop(name: "여의도", lat: 37.5216, lng: 126.924),
        viaStops: [
            TransitLegStop(name: "천호", lat: 37.5385, lng: 127.1235),
            TransitLegStop(name: "왕십리(성동구청)", lat: 37.5613, lng: 127.0374),
            TransitLegStop(name: "여의도", lat: 37.5216, lng: 126.924),
            TransitLegStop(name: "화곡", lat: 37.5416, lng: 126.8406),
        ],
        stationCount: 3, routeId: nil, wayCode: 2, walkBeforeMinutes: nil)

    #expect(transitTerminatesBeforeAlight("왕십리", leg: leg) == true)
    #expect(transitTerminatesBeforeAlight("화곡", leg: leg) == false)
    #expect(transitTerminatesBeforeAlight("여의도", leg: leg) == false)
    #expect(transitTerminatesBeforeAlight("미지의역", leg: leg) == false)

    func item(_ direction: String, _ vid: String, dest: String? = nil, express: Bool = false) -> TransitTrackItem {
        TransitTrackItem(
            vehicleId: vid, direction: direction, message: "m", remainingStops: 5,
            destinationName: dest, express: express, arrivalCode: nil)
    }
    let matched = classifyTransitBoardingCandidates([item("상행", "1"), item("하행", "2")], leg: leg)
    #expect(matched.directionUncertain == false)
    #expect(matched.candidates.map(\.item.vehicleId) == ["2"])

    let uncertain = classifyTransitBoardingCandidates([item("내선", "3"), item("외선", "4")], leg: leg)
    #expect(uncertain.directionUncertain == true)
    #expect(uncertain.candidates.count == 2)

    let decorated = classifyTransitBoardingCandidates(
        [item("하행", "5", express: true), item("하행", "6", dest: "왕십리")], leg: leg)
    #expect(decorated.candidates[0].express == true)
    #expect(decorated.candidates[1].terminatesEarly == true)
}
