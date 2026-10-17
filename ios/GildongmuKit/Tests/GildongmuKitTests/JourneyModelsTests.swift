import Testing
import Foundation
@testable import GildongmuKit

// E70 여정 응답(spec §4.7) 디코딩·조회 쿼리·최근 경로 역 필드 계약. Fixtures/journey-result.json은 손으로 쓴 §4.7 모양
// (아현 → 광화문, 공공 역 좌표)이다.

private func decodeResult(_ json: String) throws -> JourneyResult {
    try JSONDecoder().decode(JourneyResult.self, from: Data(json.utf8))
}

@Suite struct JourneyModelsTests {
    /// 실호출 응답 그대로(2026-10-17 `/api/route/journey` 둘 다 지정 — 홍대입구 2호선 승차 → 잠실 2호선 하차, 공공 지점)를
    /// 디코딩한다. 손 fixture만으로는 서버가 필드를 바꿔도 잡지 못한다(최종 교차 검토 MINOR-7).
    @Test func liveResponseDecodes() throws {
        let result = try JSONDecoder().decode(JourneyResult.self, from: fixture("journey-live-both"))
        let variant = try #require(result.variants.first)
        #expect(variant.kind == .designated)
        #expect(variant.boardStation?.name == "홍대입구")
        #expect(variant.alightStation?.name == "잠실")
        #expect(variant.taxiIn?.provider == "tmap")
        #expect(variant.transit.legs.map(\.mode) == ["subway"])
        let option = try #require(variant.egress?.options.first)
        #expect(option.kind == .exit)
        #expect(option.placeName.hasPrefix("잠실역"))
        #expect(variant.totals.transitFare == variant.transit.summary.fare)
    }

    /// 판정 5: 버스 정류장에서 시작·끝나는 변형을 탈것 종류로 가른다(앞뒤 도보는 보지 않는다).
    @Test func busStopEndsFollowVehicleLegs() throws {
        let result = try JSONDecoder().decode(JourneyResult.self, from: fixture("journey-result"))
        #expect(result.variants.allSatisfy { !$0.boardsAtBusStop && !$0.alightsAtBusStop })
        let json = try #require(String(data: fixture("journey-result"), encoding: .utf8))
        let bus = json.replacingOccurrences(of: "\"mode\": \"subway\"", with: "\"mode\": \"bus\"")
        let busResult = try decodeResult(bus)
        #expect(busResult.variants.allSatisfy { $0.boardsAtBusStop && $0.alightsAtBusStop })
    }

    @Test func fixtureDecodes() throws {
        let result = try JSONDecoder().decode(JourneyResult.self, from: fixture("journey-result"))
        #expect(result.designatedMissing == nil)
        #expect(result.variants.count == 2)

        let designated = result.variants[0]
        #expect(designated.kind == .designated)
        #expect(designated.boardStation == JourneyStationRef(name: "아현", coord: RoutePoint(lat: 37.5573, lng: 126.956)))
        #expect(designated.alightStation?.name == "광화문")
        #expect(designated.taxiIn?.taxiFare == 7800)
        #expect(designated.taxiIn?.durationSeconds == 480)
        #expect(designated.transit.routeKey == "p0")
        #expect(designated.transit.legs.first?.stops?.first?.name == "아현")
        #expect(designated.totals == JourneyTotals(minutes: 31, taxiFare: 15600, transitFare: 1550))
        #expect(designated.egress?.lookupFailed == nil)
        let options = try #require(designated.egress?.options)
        #expect(options.map(\.kind) == [.exit, .stand])
        #expect(options[0].label == "1")
        #expect(options[0].placeName == "광화문역 5호선 1번출구")
        #expect(options[0].lineName == "5호선")
        #expect(options[0].taxiOut.taxiFare == 7800)
        #expect(options[1].lineName == nil)

        // 추천 변형: 택시 앞 구간·하차 지정 역·출구가 없다
        let recommended = result.variants[1]
        #expect(recommended.kind == .recommended)
        #expect(recommended.boardStation?.name == "애오개")
        #expect(recommended.taxiIn == nil)
        #expect(recommended.alightStation == nil)
        #expect(recommended.egress == nil)
        #expect(recommended.totals.taxiFare == 0)
    }

    @Test func designatedMissingAndEmptyVariantsDecode() throws {
        let missing = try decodeResult(#"{"variants":[],"designatedMissing":{"side":"alight"}}"#)
        #expect(missing.variants.isEmpty)
        #expect(missing.designatedMissing == JourneyDesignatedMissing(side: .alight))
        for (raw, side) in [("board", JourneyMissingSide.board), ("both", .both)] {
            let r = try decodeResult(#"{"variants":[],"designatedMissing":{"side":"\#(raw)"}}"#)
            #expect(r.designatedMissing?.side == side)
        }
    }

    @Test func egressNoneAndLookupFailedDecode() throws {
        // 3-state: 출구 후보 없음(kind none, 이름 빈 문자열)과 조회 실패(lookupFailed)는 서로 다른 신호다.
        let json = """
        {"variants":[{"kind":"designated",
          "transit":{"summary":{"totalMinutes":10,"fare":1550,"transfers":0,"walkMinutes":0,
                                "departName":"아현","arriveName":"광화문"},"legs":[],"routeKey":"p0"},
          "egress":{"options":[{"kind":"none","label":"","placeName":"",
            "coord":{"lat":37.5714,"lng":126.9767},
            "taxiOut":{"distanceMeters":3400,"durationSeconds":780,"taxiFare":7800,"tollFare":0,"guides":[]}}],
            "lookupFailed":true},
          "totals":{"minutes":23,"taxiFare":7800,"transitFare":1550}}]}
        """
        let result = try decodeResult(json)
        let egress = try #require(result.variants.first?.egress)
        #expect(egress.lookupFailed == true)
        #expect(egress.options.first?.kind == EgressKind.none)
        #expect(egress.options.first?.placeName == "")
        #expect(egress.options.first?.lineName == nil)
    }

    @Test func unknownVariantKindFailsDecoding() {
        // 서버가 모르는 갈래를 보내면 조용히 다른 갈래로 읽지 않는다
        #expect(throws: (any Error).self) {
            try decodeResult(#"{"variants":[{"kind":"fastest","transit":{"summary":{"totalMinutes":1,"fare":0,"transfers":0,"walkMinutes":0},"legs":[],"routeKey":"p"},"totals":{"minutes":1,"taxiFare":0,"transitFare":0}}]}"#)
        }
    }
}

extension StubNetworkTests {
    @Test func journeyDecodesResultAndSendsAllStationQueries() async throws {
        var captured: [URLQueryItem]?
        var path: String?
        let body = try fixture("journey-result")
        StubURLProtocol.handler = { request in
            let comps = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)
            captured = comps?.queryItems
            path = comps?.path
            return (200, body)
        }
        let response = try await RouteService(client: stubbedClient()).journey(
            originLat: 37.55, originLng: 126.95, destLat: 37.58, destLng: 126.98,
            board: JourneyStationQuery(name: "아현", lat: 37.5573, lng: 126.956, line: "2호선"),
            alight: JourneyStationQuery(name: "광화문", lat: 37.5714, lng: 126.9767, line: nil))
        guard case .result(let result) = response else {
            Issue.record("result가 아니다: \(response)")
            return
        }
        #expect(result.variants.count == 2)
        #expect(path == "/api/route/journey")
        func value(_ name: String) -> String? { captured?.first { $0.name == name }?.value }
        #expect(value("origin") == "37.55,126.95")
        #expect(value("dest") == "37.58,126.98")
        #expect(value("board") == "37.5573,126.956")
        #expect(value("boardName") == "아현")
        #expect(value("boardLine") == "2호선")
        #expect(value("alight") == "37.5714,126.9767")
        #expect(value("alightName") == "광화문")
        // 노선 힌트가 없는 쪽은 파라미터를 보내지 않는다(빈 문자열도 아님)
        #expect(captured?.contains { $0.name == "alightLine" } == false)
        // ko 전용 — lang을 보내지 않는다
        #expect(captured?.contains { $0.name == "lang" } == false)
    }

    @Test func journeyOmitsUndesignatedSide() async throws {
        var captured: [URLQueryItem]?
        StubURLProtocol.handler = { request in
            captured = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems
            return (200, Data(#"{"variants":[]}"#.utf8))
        }
        let response = try await RouteService(client: stubbedClient()).journey(
            originLat: 37.55, originLng: 126.95, destLat: 37.58, destLng: 126.98,
            board: nil,
            alight: JourneyStationQuery(name: "광화문", lat: 37.5714, lng: 126.9767, line: "5호선"))
        guard case .result(let result) = response else {
            Issue.record("result가 아니다")
            return
        }
        #expect(result.variants.isEmpty)
        let names = Set(captured?.map(\.name) ?? [])
        #expect(names == ["origin", "dest", "alight", "alightName", "alightLine"])
    }

    @Test func journeyOutOfCoverageMarkerDecodesToOutOfCoverage() async throws {
        StubURLProtocol.handler = { _ in (200, Data(#"{"outOfCoverage":true}"#.utf8)) }
        let response = try await RouteService(client: stubbedClient()).journey(
            originLat: 35.1, originLng: 129.0, destLat: 33.5, destLng: 126.5, board: nil, alight: nil)
        guard case .outOfCoverage = response else {
            Issue.record("outOfCoverage가 아니다: \(response)")
            return
        }
    }

    @Test func journeyServerErrorStillThrows() async {
        StubURLProtocol.handler = { _ in (502, Data(#"{"error":"upstream"}"#.utf8)) }
        await #expect(throws: APIError.self) {
            _ = try await RouteService(client: stubbedClient()).journey(
                originLat: 37.55, originLng: 126.95, destLat: 37.58, destLng: 126.98, board: nil, alight: nil)
        }
    }
}

// MARK: - 최근 경로의 역 필드

private func freshDefaults(_ name: String) -> UserDefaults {
    let suite = "journey-recent-tests-\(name)"
    let defaults = UserDefaults(suiteName: suite)!
    defaults.removePersistentDomain(forName: suite)
    return defaults
}

private let home = RecentEndpoint(label: "출발지", lat: 37.5, lng: 127.0)
private let dest = RecentEndpoint(label: "도착지", lat: 37.6, lng: 127.1)
private let ahyeon = RecentStation(label: "아현", lat: 37.5573, lng: 126.956, line: "2호선")
private let gwanghwamun = RecentStation(label: "광화문", lat: 37.5714, lng: 126.9767, line: nil)

@Suite struct RecentRouteStationTests {
    @Test func legacyJSONDecodesWithNilStations() throws {
        let json = #"[{"from":{"label":"출발지","lat":37.5,"lng":127.0},"to":{"label":"도착지","lat":37.6,"lng":127.1},"pinned":true}]"#
        let routes = try JSONDecoder().decode([RecentRoute].self, from: Data(json.utf8))
        #expect(routes.count == 1)
        #expect(routes[0].boardStation == nil)
        #expect(routes[0].alightStation == nil)
        #expect(routes[0].pinned)
        #expect(routes[0].via == nil)
    }

    @Test func stationsRoundTripThroughStore() {
        let store = RecentSearchStore(defaults: freshDefaults("roundtrip"))
        store.recordRoute(RecentRoute(
            from: home, to: dest, via: nil, boardStation: ahyeon, alightStation: gwanghwamun, pinned: false))
        let saved = store.routes()
        #expect(saved.count == 1)
        #expect(saved[0].boardStation == ahyeon)
        #expect(saved[0].alightStation == gwanghwamun)
        #expect(saved[0].boardStation?.line == "2호선")
        #expect(saved[0].alightStation?.line == nil)
    }

    @Test func idAndSameRouteSeparateRoutesByStations() {
        let plain = RecentRoute(from: home, to: dest, via: nil, boardStation: nil, alightStation: nil, pinned: false)
        let withBoard = RecentRoute(from: home, to: dest, via: nil, boardStation: ahyeon, alightStation: nil, pinned: false)
        let withBoth = RecentRoute(from: home, to: dest, via: nil, boardStation: ahyeon, alightStation: gwanghwamun, pinned: false)
        #expect(plain.id != withBoard.id)
        #expect(withBoard.id != withBoth.id)
        #expect(RecentSearchStore.sameRoute(plain, plain))
        #expect(!RecentSearchStore.sameRoute(plain, withBoard))
        #expect(!RecentSearchStore.sameRoute(withBoard, withBoth))

        let store = RecentSearchStore(defaults: freshDefaults("dedupe"))
        store.recordRoute(plain)
        store.recordRoute(withBoard)
        store.recordRoute(withBoth)
        #expect(store.routes().count == 3)
        // 같은 쌍을 다시 기록하면 끌어올릴 뿐 늘지 않는다
        store.recordRoute(withBoard)
        #expect(store.routes().count == 3)
        #expect(store.routes().first?.boardStation == ahyeon)
    }

    @Test func stationKeyUsesFourDecimalCoordinates() {
        // 좌표 4자리 일치 = 같은 역(라벨·노선 힌트는 정체성이 아니다)
        let a = RecentRoute(from: home, to: dest, via: nil,
                            boardStation: RecentStation(label: "아현", lat: 37.55731, lng: 126.95601, line: "2호선"),
                            alightStation: nil, pinned: false)
        let b = RecentRoute(from: home, to: dest, via: nil,
                            boardStation: RecentStation(label: "아현역", lat: 37.55732, lng: 126.95602, line: nil),
                            alightStation: nil, pinned: false)
        let c = RecentRoute(from: home, to: dest, via: nil,
                            boardStation: RecentStation(label: "아현", lat: 37.5580, lng: 126.956, line: "2호선"),
                            alightStation: nil, pinned: false)
        #expect(a.id == b.id)
        #expect(RecentSearchStore.sameRoute(a, b))
        #expect(a.id != c.id)
    }

    @Test func pinningAndReorderKeepStations() {
        let store = RecentSearchStore(defaults: freshDefaults("pin"))
        let route = RecentRoute(from: home, to: dest, via: nil, boardStation: ahyeon, alightStation: gwanghwamun, pinned: false)
        store.recordRoute(route)
        let pinned = store.setRoutePinned(route, pinned: true)
        #expect(pinned.first?.pinned == true)
        #expect(pinned.first?.boardStation == ahyeon)
        #expect(pinned.first?.alightStation == gwanghwamun)
        // 고정본이 있는 상태에서 같은 쌍을 다시 기록해도 역이 유지된다
        let again = store.recordRoute(route)
        #expect(again.first?.pinned == true)
        #expect(again.first?.boardStation == ahyeon)
    }
}
