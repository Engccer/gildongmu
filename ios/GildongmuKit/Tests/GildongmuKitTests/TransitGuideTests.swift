import Foundation
import Testing
@testable import GildongmuKit

/// 웹 정본과 같은 공유 fixture(`src/lib/__tests__/fixtures/transit-guide-scenarios.json`)를
/// 레포 상대 경로로 직접 읽어 같은 전이·이벤트를 단언한다(사본 금지 — RouteGuideTests 관례).

private struct FixtureFile: Decodable {
    let routes: [String: TransitGuideRoute]
    /// A25 승차 전 도보 판정 기대값(routes 이름 → 대상 | null). 웹과 같은 키를 읽는다.
    let prewalk: [String: TransitPrewalkTarget?]
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
    // previousLock은 락 참조 이름 또는 "명시 null"(소거 기대, §13.1).
    let previousLock: String??
    let event: FixtureEvent??

    enum CodingKeys: String, CodingKey {
        case phase, signal, legIndex, remaining, dataAgeSeconds, previousLock, event
    }
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
        previousLock = c.contains(.previousLock)
            ? .some(try c.decodeIfPresent(String.self, forKey: .previousLock))
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
    let cause: String?
    // currentLocation은 "명시 null"(병치 없음 기대)과 "미지정"을 구분한다.
    let currentLocation: String??
    // 영문 조각(E27 잔여 ①) — 같은 관측의 ko·en이 한 이벤트에 실리는지 잠근다.
    let messageEn: String??
    let currentLocationEn: String??

    enum CodingKeys: String, CodingKey {
        case kind, legIndex, remaining, certain, final, cause, currentLocation
        case messageEn, currentLocationEn
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = try c.decode(String.self, forKey: .kind)
        legIndex = try c.decodeIfPresent(Int.self, forKey: .legIndex)
        remaining = try c.decodeIfPresent(Int.self, forKey: .remaining)
        cause = try c.decodeIfPresent(String.self, forKey: .cause)
        certain = try c.decodeIfPresent(Bool.self, forKey: .certain)
        final = try c.decodeIfPresent(Bool.self, forKey: .final)
        currentLocation = c.contains(.currentLocation)
            ? .some(try c.decodeIfPresent(String.self, forKey: .currentLocation))
            : .none
        messageEn = c.contains(.messageEn)
            ? .some(try c.decodeIfPresent(String.self, forKey: .messageEn))
            : .none
        currentLocationEn = c.contains(.currentLocationEn)
            ? .some(try c.decodeIfPresent(String.self, forKey: .currentLocationEn))
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
    case "confirmBoarded":
        return .confirmBoarded
    case "restoreBoarding":
        return .restoreBoarding
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
    case .vehicleSelected: "vehicleSelected"
    case .approaching: "approaching"
    case .vehiclePassed: "vehiclePassed"
    case .trackingStarted: "trackingStarted"
    case .countdown: "countdown"
    case .messageChanged: "messageChanged"
    case .arrived: "arrived"
    case .backOnTrack: "backOnTrack"
    case .approxVehicleChanged: "approxVehicleChanged"
    case .signalLost: "signalLost"
    case .neverSeen: "neverSeen"
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
            if case let .some(expectedLockRef) = step.expect.previousLock {
                let expectedLock = expectedLockRef.flatMap { fixture.locks[$0] }
                #expect(state.previousLock == expectedLock, "\(ctx) previousLock")
            }
            if case let .some(expectedEvent) = step.expect.event {
                if let expectedEvent {
                    #expect(kindName(result.event) == expectedEvent.kind, "\(ctx) event.kind")
                    switch result.event {
                    case let .boarded(legIndex, cause):
                        if let e = expectedEvent.legIndex { #expect(legIndex == e, "\(ctx) event.legIndex") }
                        if let e = expectedEvent.cause { #expect(cause.rawValue == e, "\(ctx) event.cause") }
                    case let .vehicleSelected(legIndex):
                        if let e = expectedEvent.legIndex { #expect(legIndex == e, "\(ctx) event.legIndex") }
                    case let .approaching(remaining, _, messageEn):
                        if case let .some(e) = expectedEvent.remaining { #expect(remaining == e, "\(ctx) event.remaining") }
                        if case let .some(e) = expectedEvent.messageEn {
                            #expect(messageEn == e, "\(ctx) event.messageEn")
                        }
                    case let .countdown(remaining, _, messageEn, currentLocation, currentLocationEn, _):
                        if let e = expectedEvent.remaining { #expect(remaining == e, "\(ctx) event.remaining") }
                        if case let .some(e) = expectedEvent.currentLocation {
                            #expect(currentLocation == e, "\(ctx) event.currentLocation")
                        }
                        if case let .some(e) = expectedEvent.messageEn {
                            #expect(messageEn == e, "\(ctx) event.messageEn")
                        }
                        if case let .some(e) = expectedEvent.currentLocationEn {
                            #expect(currentLocationEn == e, "\(ctx) event.currentLocationEn")
                        }
                    case let .trackingStarted(_, messageEn, remaining, _):
                        if let e = expectedEvent.remaining { #expect(remaining == e, "\(ctx) event.remaining") }
                        if case let .some(e) = expectedEvent.messageEn {
                            #expect(messageEn == e, "\(ctx) event.messageEn")
                        }
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
    // boarding(차량 선택 뒤 승차 정류소 대기)은 waiting과 같은 엔드포인트라 같은 주기.
    #expect(transitPollIntervalMs(state) == 20_000)
    state = transitGuideStep(state: state, input: .confirmBoarded, route: route, now: 0).state
    #expect(transitPollIntervalMs(state) == 60_000)
    let far = TransitTrackItem(
        vehicleId: "5696", direction: "하행", message: "[9]번째 전역", remainingStops: 9,
        destinationName: "하남검단산", express: false, arrivalCode: "99")
    state = transitGuideStep(
        state: state, input: .poll(seq: 1, phaseGen: 2, poll: .ok([far])), route: route, now: 1
    ).state
    // §12 개정: 추적 중이면 원거리도 15초(원거리 30초 폐지).
    #expect(transitPollIntervalMs(state) == 15_000)
    let near = TransitTrackItem(
        vehicleId: "5696", direction: "하행", message: "[3]번째 전역", remainingStops: 3,
        destinationName: "하남검단산", express: false, arrivalCode: "99")
    state = transitGuideStep(
        state: state, input: .poll(seq: 2, phaseGen: 2, poll: .ok([near])), route: route, now: 2
    ).state
    #expect(transitPollIntervalMs(state) == 15_000)
    // advance는 arrived에서만 유효(리듀서 가드) — 도착 관측 후 전환.
    let arrivedItem = TransitTrackItem(
        vehicleId: "5696", direction: "하행", message: "여의도 도착", remainingStops: 0,
        destinationName: "하남검단산", express: false, arrivalCode: "1")
    state = transitGuideStep(
        state: state, input: .poll(seq: 3, phaseGen: 2, poll: .ok([arrivedItem])), route: route, now: 3
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
    state = transitGuideStep(state: state, input: .confirmBoarded, route: route, now: 0).state
    var capEvents = 0
    for i in 1...(transitSessionPollCap + 5) {
        let r = transitGuideStep(
            state: state, input: .poll(seq: i, phaseGen: 2, poll: .empty),
            route: route, now: Double(i) * 1000)
        state = r.state
        if case .capSlowed = r.event { capEvents += 1 }
    }
    #expect(capEvents == 1)
    #expect(transitPollIntervalMs(state) == 60_000)
}

@Test func eventProfileChannels() {
    #expect(transitEventProfile(.countdown(remaining: 1, message: "", messageEn: nil, currentLocation: nil, currentLocationEn: nil, arrivalCode: nil)).interrupt == true)
    #expect(transitEventProfile(.countdown(remaining: 2, message: "", messageEn: nil, currentLocation: nil, currentLocationEn: nil, arrivalCode: nil)).interrupt == false)
    #expect(transitEventProfile(.arrived(certain: true)).interrupt == true)
    #expect(transitEventProfile(.signalLost).interrupt == false)
}

@Test func odsayLineMapping() {
    #expect(subwayIdForOdsayLine("수도권 5호선") == "1005")
    #expect(subwayIdForOdsayLine("수도권 수인.분당선") == "1075")
    #expect(subwayIdForOdsayLine("신분당선") == "1077")
    #expect(subwayIdForOdsayLine("대전 1호선") == nil)
    // 급행 lane 접미(웹 미러) — 벗기지 않으면 급행 leg가 통째로 추적 불가.
    #expect(subwayIdForOdsayLine("수도권 9호선(급행)") == "1009")
    // ⚠ 1호선 형태는 우리 함수의 동작 단언이지 ODsay 관측이 아니다(웹 미러).
    #expect(subwayIdForOdsayLine("수도권 1호선(급행)") == "1001")
    // 그 밖의 괄호 등급은 삼키지 않는다(직통은 실시간 도착 축이 없다).
    #expect(subwayIdForOdsayLine("수도권 공항철도(직통)") == nil)
    // 앵커 계약(웹 미러): 끝에 붙은 한 토큰만 벗긴다.
    #expect(subwayIdForOdsayLine("수도권 (급행)9호선") == nil)
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
        ],
        routeKey: "p0")
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
            firstServiceTime: nil, lastServiceTime: nil)],
        routeKey: "p0")
    #expect(buildTransitGuideRoute(walkOnly) == nil)
}

@Test func buildGuideRouteKeepsExpressLegTrackable() {
    // 웹 "급행 leg도 추적 대상이고 경유역은 급행 정차역 그대로다" 미러.
    // 종전에는 lineName의 "(급행)" 접미 때문에 trackMode가 nil이라 급행 경로의
    // 실시간 안내가 통째로 열리지 않았다(A16 선행 결함).
    let stops = ["김포공항", "마곡나루", "가양", "염창", "당산", "여의도", "노량진", "동작", "고속터미널"]
        .enumerated()
        .map { TransitLegStop(name: $0.element, stationId: String(900 + $0.offset), lat: 37.5, lng: 126.9) }
    let route = TransitRoute(
        summary: TransitRouteSummary(
            totalMinutes: 40, fare: 1950, transfers: 0, walkMinutes: 4,
            departName: "김포공항", arriveName: "고속터미널"),
        legs: [
            TransitRouteLeg(
                mode: "subway", lineName: "수도권 9호선(급행)",
                fromName: "김포공항", toName: "고속터미널",
                stationCount: 8, minutes: 27, serviceStatus: nil,
                firstServiceTime: nil, lastServiceTime: nil,
                serviceWayCode: 1, stops: stops),
        ],
        routeKey: "p-exp")
    let guide = buildTransitGuideRoute(route)
    #expect(guide?.legs.first?.trackMode == .subway)
    // 표시명은 급행 표기를 유지한다(정규화는 매핑 축에만 걸린다).
    #expect(guide?.legs.first?.lineName == "수도권 9호선(급행)")
    #expect(guide?.legs.first?.viaStops.count == 9)
    #expect(guide?.legs.first?.viaStops.contains { $0.name == "샛강" } == false)
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

    let uncertain = classifyTransitBoardingCandidates([item("알수없음", "3")], leg: leg)
    #expect(uncertain.directionUncertain == true)
    #expect(uncertain.candidates.count == 1)

    // A17: 후보 전원 direction 빈 문자열(버스)은 방향 축 부재 — uncertain 아님. 웹 동일 케이스.
    let bus = classifyTransitBoardingCandidates([item("", "b1"), item("", "b2")], leg: leg)
    #expect(bus.directionUncertain == false)
    #expect(bus.candidates.map(\.item.vehicleId) == ["b1", "b2"])
    #expect(classifyTransitBoardingCandidates([], leg: leg).directionUncertain == false)
    // 방향 값이 하나라도 있는데 전멸이면 여전히 uncertain.
    let mixed = classifyTransitBoardingCandidates([item("", "1"), item("알수없음", "2")], leg: leg)
    #expect(mixed.directionUncertain == true)
    #expect(mixed.candidates.count == 2)

    let decorated = classifyTransitBoardingCandidates(
        [item("하행", "5", express: true), item("하행", "6", dest: "왕십리")], leg: leg)
    // 집합 부재 → 판정 불가(unknown): 차단하지 않고 종전 expressCheck.
    #expect(decorated.candidates[0].express == .unknown)
    #expect(decorated.candidates[0].unreachable == nil)
    #expect(decorated.candidates[1].express == nil)
    #expect(decorated.candidates[1].unreachable == .terminatesEarly)
}

// 웹 transit-guide.test.ts "급행 결정적 미도달 게이트(A16 L1)"와 동일 케이스(미러 동조). spec 2026-09-02 §4.2.
@Test func expressVerdictGate() {
    let names = ["김포공항", "당산", "노량진", "노들", "동작"]
    let ids = ["901", "902", "903", "904", "905"]
    func stops(_ withIds: Bool) -> [TransitLegStop] {
        zip(names, ids).map { TransitLegStop(name: $0.0, stationId: withIds ? $0.1 : nil, lat: 37.5, lng: 127) }
    }
    func leg(expressStops: [String]? = nil, expressStopIds: [String]? = nil, withIds: Bool = true, alightName: String = "노들") -> TransitGuideLeg {
        TransitGuideLeg(
            mode: "subway", lineName: "수도권 9호선", trackMode: .subway,
            boardName: "김포공항", alightName: alightName,
            boardStop: stops(withIds).first,
            alightStop: TransitLegStop(name: "노들", stationId: withIds ? "904" : nil, lat: 37.5, lng: 127),
            viaStops: stops(withIds), stationCount: 4, routeId: nil, wayCode: 2, walkBeforeMinutes: nil,
            expressStops: expressStops, expressStopIds: expressStopIds)
    }
    let express = TransitTrackItem(
        vehicleId: "9", direction: "하행", message: "m", remainingStops: 3,
        destinationName: "중앙보훈병원", express: true, arrivalCode: nil)

    // ID 판정
    let skip = leg(expressStops: ["김포공항", "당산", "동작"], expressStopIds: ["901", "902", "905"])
    #expect(transitExpressVerdict(express, leg: skip) == .skips)
    #expect(transitUnreachableReason(express, leg: skip) == .expressSkipsAlight)
    #expect(classifyTransitBoardingCandidates([express], leg: skip).candidates[0].unreachable == .expressSkipsAlight)
    let stop = leg(expressStops: ["김포공항", "당산", "노들"], expressStopIds: ["901", "902", "904"])
    #expect(transitExpressVerdict(express, leg: stop) == .stops)
    #expect(transitUnreachableReason(express, leg: stop) == nil)
    // ID는 이름 별칭을 무시한다
    #expect(transitExpressVerdict(express, leg: leg(expressStops: ["김포공항역", "당산역", "노들역"], expressStopIds: ["901", "902", "904"])) == .stops)
    // 이름 판정(ID 부재): 자격 ⓐⓑ
    #expect(transitExpressVerdict(express, leg: leg(expressStops: ["김포공항", "당산", "동작"], withIds: false)) == .skips)
    #expect(transitExpressVerdict(express, leg: leg(expressStops: ["김포공항역", "노들역"], withIds: false)) == .stops)
    #expect(transitExpressVerdict(express, leg: leg(expressStops: ["여의도", "신논현"], withIds: false)) == .unknown)
    #expect(transitExpressVerdict(express, leg: leg(expressStops: ["김포공항", "당산"], withIds: false, alightName: "미지역")) == .unknown)
    // 집합 부재·빈 집합은 unknown, 완행은 nil, 종착 앞이면 종착이 먼저
    #expect(transitExpressVerdict(express, leg: leg()) == .unknown)
    #expect(transitExpressVerdict(express, leg: leg(expressStops: [], expressStopIds: [])) == .unknown)
    let local = TransitTrackItem(vehicleId: "1", direction: "하행", message: "m", remainingStops: 3, destinationName: nil, express: false, arrivalCode: nil)
    #expect(transitExpressVerdict(local, leg: leg()) == nil)
    let early = TransitTrackItem(vehicleId: "8", direction: "하행", message: "m", remainingStops: 3, destinationName: "당산", express: true, arrivalCode: nil)
    #expect(transitUnreachableReason(early, leg: leg(expressStops: ["김포공항"], expressStopIds: ["901"])) == .terminatesEarly)
    // 근사 잠금 급행 확인(§6): 집합 있는 노선만 묻고, 선언 판정은 후보 없이 leg만으로
    #expect(transitNeedsExpressPrompt(leg()) == false)
    #expect(transitNeedsExpressPrompt(skip) == true)
    #expect(transitDeclaredExpressVerdict(leg: skip) == .skips)
    #expect(transitDeclaredExpressVerdict(leg: stop) == .stops)
    #expect(transitDeclaredExpressVerdict(leg: leg()) == .unknown)
    // 출구 번호 형식 게이트
    #expect(transitValidExitNo(" 2-1 ") == "2-1")
    #expect(transitValidExitNo("1 2") == nil)
    #expect(transitValidExitNo("3번 출구") == nil)
    #expect(transitValidExitNo(nil) == nil)
}

// 웹 transit-guide.test.ts "순환선 2호선(내선·외선)"과 동일 케이스(미러 동조).
// 실호출 확정 2026-08-16 — 내선=wayCode 2·외선=1, 종착 상수 "성수"는 차단 근거 아님.
@Test func loopLineBoardingCandidates() {
    let names = [
        "을지로입구", "을지로3가", "을지로4가", "동대문역사문화공원", "신당",
        "상왕십리", "왕십리", "한양대", "뚝섬", "성수",
        "건대입구", "구의", "강변", "잠실나루", "잠실",
    ]
    let leg = TransitGuideLeg(
        mode: "subway", lineName: "수도권 2호선", trackMode: .subway,
        boardName: "을지로입구", alightName: "잠실",
        boardStop: TransitLegStop(name: "을지로입구", lat: 37.565998, lng: 126.982569),
        alightStop: TransitLegStop(name: "잠실", lat: 37.51395, lng: 127.100138),
        viaStops: names.map { TransitLegStop(name: $0, lat: 37.5, lng: 127) },
        stationCount: 14, routeId: nil, wayCode: 2, walkBeforeMinutes: nil)

    func item(_ direction: String, _ vid: String) -> TransitTrackItem {
        TransitTrackItem(
            vehicleId: vid, direction: direction, message: "m", remainingStops: 5,
            destinationName: "성수", express: false, arrivalCode: nil)
    }
    let result = classifyTransitBoardingCandidates([item("내선", "3"), item("외선", "4")], leg: leg)
    #expect(result.directionUncertain == false)
    #expect(result.candidates.map(\.item.vehicleId) == ["3"])
    // 순수 판정 자체는 여전히 "앞선 종착"이라 답한다 — 순환선 제외는 분류기 몫.
    #expect(transitTerminatesBeforeAlight("성수", leg: leg) == true)
    #expect(result.candidates[0].unreachable == nil)

    // 지선(성수·신정)도 내선/외선을 쓴다. 방향 대응은 본선과 같고, 종착은 지선
    // 라벨이거나 그 지선의 종점이라 어느 쪽도 하차역보다 앞설 수 없다.
    let branch = TransitGuideLeg(
        mode: "subway", lineName: "수도권 2호선", trackMode: .subway,
        boardName: "용답", alightName: "신설동",
        boardStop: TransitLegStop(name: "용답", lat: 37.562066, lng: 127.050879),
        alightStop: TransitLegStop(name: "신설동", lat: 37.574653, lng: 127.025158),
        viaStops: ["용답", "신답", "용두", "신설동"].map {
            TransitLegStop(name: $0, lat: 37.56, lng: 127.04)
        },
        stationCount: 3, routeId: nil, wayCode: 2, walkBeforeMinutes: nil)

    func branchItem(_ direction: String, _ vid: String, _ dest: String) -> TransitTrackItem {
        TransitTrackItem(
            vehicleId: vid, direction: direction, message: "m", remainingStops: 2,
            destinationName: dest, express: false, arrivalCode: nil)
    }
    let branchResult = classifyTransitBoardingCandidates(
        [branchItem("내선", "7", "신설동"), branchItem("외선", "8", "성수지선")], leg: branch)
    #expect(branchResult.directionUncertain == false)
    #expect(branchResult.candidates.map(\.item.vehicleId) == ["7"])
    #expect(transitTerminatesBeforeAlight("신설동", leg: branch) == false)
    #expect(transitTerminatesBeforeAlight("성수지선", leg: branch) == false)
}

// 웹 transit-guide.test.ts "경유 목록 현재 위치 매칭(§14.1)"과 동일 케이스(미러 동조).
@Test func viaStopCurrentIndexMatching() {
    let leg = TransitGuideLeg(
        mode: "subway", lineName: "수도권 5호선", trackMode: .subway,
        boardName: "천호", alightName: "여의도",
        boardStop: TransitLegStop(name: "천호", lat: 37.5385, lng: 127.1235),
        alightStop: TransitLegStop(name: "여의도", lat: 37.5216, lng: 126.924),
        viaStops: [
            TransitLegStop(name: "천호", lat: 37.5385, lng: 127.1235),
            TransitLegStop(name: "강동", lat: 37.5359, lng: 127.1323),
            TransitLegStop(name: "왕십리(성동구청)", lat: 37.5613, lng: 127.0374),
            TransitLegStop(name: "여의도", lat: 37.5216, lng: 126.924),
            TransitLegStop(name: "화곡", lat: 37.5416, lng: 126.8406),
        ],
        stationCount: 4, routeId: nil, wayCode: 2, walkBeforeMinutes: nil)
    let empty = TransitGuideLeg(
        mode: "subway", lineName: "수도권 5호선", trackMode: .subway,
        boardName: "천호", alightName: "여의도",
        boardStop: nil, alightStop: nil, viaStops: [],
        stationCount: nil, routeId: nil, wayCode: nil, walkBeforeMinutes: nil)

    #expect(viaStopCurrentIndex(leg: leg, currentLocation: "강동") == 1)
    #expect(viaStopCurrentIndex(leg: leg, currentLocation: "강동역") == 1) // "역" 접미 흡수
    #expect(viaStopCurrentIndex(leg: leg, currentLocation: "왕십리") == 2) // 부역명 괄호 흡수
    #expect(viaStopCurrentIndex(leg: leg, currentLocation: "미지의역") == nil) // 목록 밖 = 무표기
    #expect(viaStopCurrentIndex(leg: leg, currentLocation: nil) == nil)
    #expect(viaStopCurrentIndex(leg: leg, currentLocation: "") == nil)
    #expect(viaStopCurrentIndex(leg: empty, currentLocation: "강동") == nil)
}

// MARK: - 승차 전 도보 판정 (A25, spec 2026-08-30 §3) — 웹 transit-guide.test.ts 미러

@Test func prewalkTargetMatchesSharedFixture() throws {
    let fixture = try loadFixture()
    #expect(Set(fixture.prewalk.keys) == Set(fixture.routes.keys))
    for (name, route) in fixture.routes {
        #expect(transitPrewalkTarget(route) == fixture.prewalk[name] ?? nil, "\(name)")
    }
}

@Test func prewalkTargetRejectsZeroMinutesMissingStopAndNullIsland() throws {
    let base = try #require(loadFixture().routes["subwaySingle"])
    let first = base.legs[0]
    func patched(minutes: Int?, stop: TransitLegStop?) -> TransitGuideRoute {
        TransitGuideRoute(legs: [TransitGuideLeg(
            mode: first.mode, lineName: first.lineName, trackMode: first.trackMode,
            boardName: first.boardName, alightName: first.alightName,
            boardStop: stop, alightStop: first.alightStop, viaStops: first.viaStops,
            stationCount: first.stationCount, routeId: first.routeId, wayCode: first.wayCode,
            walkBeforeMinutes: minutes, quickExit: first.quickExit)], walkAfterMinutes: nil)
    }
    #expect(transitPrewalkTarget(patched(minutes: 0, stop: first.boardStop)) == nil)
    #expect(transitPrewalkTarget(patched(minutes: nil, stop: first.boardStop)) == nil)
    #expect(transitPrewalkTarget(patched(minutes: 3, stop: nil)) == nil)
    #expect(transitPrewalkTarget(patched(minutes: 3, stop: TransitLegStop(name: "x", lat: 0, lng: 0))) == nil)
    #expect(transitPrewalkTarget(patched(minutes: 3, stop: TransitLegStop(name: "x", lat: .nan, lng: 127))) == nil)
    #expect(transitPrewalkTarget(TransitGuideRoute(legs: [], walkAfterMinutes: nil)) == nil)
}

@Test func withoutPrewalkClearsOnlyFirstLegAndKeepsOriginal() throws {
    let base = try #require(loadFixture().routes["twoLegs"])
    let out = withoutPrewalk(base)
    #expect(out.legs[0].walkBeforeMinutes == nil)
    #expect(out.legs.count == base.legs.count)
    #expect(out.legs[1].walkBeforeMinutes == base.legs[1].walkBeforeMinutes)
    #expect(out.walkAfterMinutes == base.walkAfterMinutes)
    #expect(base.legs[0].walkBeforeMinutes == 2)  // 원본 불변
    #expect(out.legs[0].boardName == base.legs[0].boardName)

    // 명시 복사라 필드가 늘면 빠뜨릴 수 있다 — en 이름(종전 유실 결함, 2026-09-02 수정)·급행 집합·출구 보존 단언.
    let rich = TransitGuideLeg(
        mode: "subway", lineName: "수도권 9호선", trackMode: .subway, boardName: "김포공항", alightName: "노들",
        boardStop: nil, alightStop: nil, viaStops: [], stationCount: 4, routeId: nil, wayCode: 2,
        walkBeforeMinutes: 3, quickExit: nil, lineNameEn: "Line 9", boardNameEn: "Gimpo Int'l Airport",
        alightNameEn: "Nodeul", expressStops: ["김포공항"], expressStopIds: ["901"], exitAlight: "2-1")
    let kept = withoutPrewalk(TransitGuideRoute(legs: [rich], walkAfterMinutes: nil)).legs[0]
    #expect(kept.walkBeforeMinutes == nil)
    #expect(kept.lineNameEn == "Line 9" && kept.boardNameEn == "Gimpo Int'l Airport" && kept.alightNameEn == "Nodeul")
    #expect(kept.expressStops == ["김포공항"] && kept.expressStopIds == ["901"] && kept.exitAlight == "2-1")
}


// MARK: - A27 승차 국면 지하철 상태줄 — 웹과 같은 공유 fixture(`subway-riding-message-cases.json`)

private struct RidingCase: Decodable {
    let arrivalCode: String?
    let expect: Expect
    struct Expect: Decodable { let kind: String; let key: String? }
}

@Test func subwayRidingMessageMatchesSharedFixture() throws {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() }
    url.appendPathComponent("src/lib/__tests__/fixtures/subway-riding-message-cases.json")
    struct File: Decodable { let cases: [RidingCase] }
    let file = try JSONDecoder().decode(File.self, from: Data(contentsOf: url))
    #expect(file.cases.count >= 10)
    for c in file.cases {
        let got = subwayRidingMessage(c.arrivalCode)
        switch c.expect.kind {
        case "key": #expect(got == .key(c.expect.key ?? ""), "code \(String(describing: c.arrivalCode))")
        case "omit": #expect(got == .omit, "code \(String(describing: c.arrivalCode))")
        default: #expect(got == .raw, "code \(String(describing: c.arrivalCode))")
        }
    }
}
