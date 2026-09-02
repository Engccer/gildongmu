import Testing
import Foundation
@testable import GildongmuKit

// 경로 브리핑 계약 테스트: Fixtures/route-car.json·route-transit.json·route-walk.json이 계약 정본.
// ⚠ car 응답은 envelope 없이 CarRouteBriefing 직접(웹 /api/route/car 계약).
// 단위 함정 회귀: durationSeconds=초·totalMinutes=분·fare/taxiFare/tollFare=원.
// transit·walk 둘 다 result가 optional(경로 없음 3-state). walk는 route-walk-no-route.json,
// transit은 inline JSON(routeTransitNullResultDecodesToNil)으로 검증.

// MARK: - fixture 디코딩

@Test func routeCarFixtureDecodes() throws {
    let briefing = try JSONDecoder().decode(CarRouteBriefing.self, from: fixture("route-car"))
    #expect(briefing.distanceMeters == 13841)
    #expect(briefing.taxiFare == 22600)
    #expect(briefing.tollFare == 0)
    // guides 비어있지 않음(브리핑의 본문, 비면 계약 위반)
    #expect(!briefing.guides.isEmpty)
    // guidance가 낭독 정본: 전 구간에서 존재(빈 문자열 가능, 그 경우 뷰가 name 폴백)
    #expect(briefing.guides.first?.guidance == "출발지")
    #expect(briefing.guides.contains { $0.name.isEmpty })   // name 빈 문자열 실측(옵셔널 아님)
}

@Test func routeTransitFixtureDecodes() throws {
    let envelope = try JSONDecoder().decode(TransitRouteEnvelope.self, from: fixture("route-transit"))
    let result = try #require(envelope.result)
    #expect(result.recommended.summary.transfers == 2)
    #expect(result.recommended.summary.departName == "길동")
    #expect(result.recommended.summary.arriveName == "강남")
    #expect(result.recommended.legs.count == 5)
    #expect(result.alternatives.count == 2)
    // 지하철 leg: 노선명·승하차역·역 수가 낭독 재료
    let subway = try #require(result.recommended.legs.first { $0.mode == "subway" })
    #expect(subway.lineName == "수도권 5호선")
    #expect(subway.fromName == "길동")
    #expect(subway.stationCount == 2)
    // 대안에 버스 leg 실측(정류장 수 낭독 분기 재료)
    #expect(result.alternatives.flatMap(\.legs).contains { $0.mode == "bus" })
    // 절단 전 후보 총수(조용한 절단 금지). 표시하진 않지만 계약으로는 남는다
    #expect(result.totalCandidates == 9)
}

/// 경로 식별·축 계약(spec §3.3). routeKey는 필수라 누락되면 디코딩 자체가 실패한다
/// (펼침 상태·안내 세션 추적의 키라 "없으면 인덱스로" 폴백을 두지 않는다).
@Test func routeTransitCarriesStableKeyAndAxes() throws {
    let result = try #require(
        JSONDecoder().decode(TransitRouteEnvelope.self, from: fixture("route-transit")).result)
    #expect(result.recommended.routeKey == "p0")
    // 표시 순서와 키가 다른 좌표계임을 고정한다: 강등 정렬로 p3이 p1보다 앞에 온다
    #expect(result.alternatives.map(\.routeKey) == ["p3", "p1"])
    // 1순위는 축 라벨을 갖지 않는다(자기보다 나은 자기는 없다)
    #expect(result.recommended.highlight == nil)
    #expect(result.alternatives[0].highlight == ["fewestTransfers"])
    // 축이 있는 대안엔 번호가 없고, 축 없는 대안만 번호를 받는다
    #expect(result.alternatives[0].displayIndex == nil)
    #expect(result.alternatives[1].highlight == nil)
    #expect(result.alternatives[1].displayIndex == 1)
}

/// 도보 구간의 거리·행선지(spec §3.2). 3-state: 거리 필드 부재는 "0m"가 아니라
/// "정보 없음"이라 표시 계층이 거리 없는 문구로 떨어진다.
@Test func walkLegsCarryDistanceAndDestination() throws {
    let result = try #require(
        JSONDecoder().decode(TransitRouteEnvelope.self, from: fixture("route-transit")).result)
    let walks = result.recommended.legs.filter { $0.mode == "walk" }
    // 첫 도보의 행선지는 뒤 첫 탑승 구간의 승차역
    #expect(walks.first?.toName == "길동")
    #expect(walks.first?.distanceMeters == 178)
    // 마지막 도보엔 행선지가 없다(provider가 목적지 이름을 모른다)
    #expect(walks.last?.toName == nil)
    // 거리 결측 도보가 fixture에 실재한다(3-state 분기가 죽은 코드가 아님을 고정)
    let allWalks = (result.recommended.legs + result.alternatives.flatMap(\.legs))
        .filter { $0.mode == "walk" }
    #expect(allWalks.contains { $0.distanceMeters == nil })
    // 탑승 구간에는 거리를 싣지 않는다(정거장 수가 이미 표현한다)
    #expect((result.recommended.legs + result.alternatives.flatMap(\.legs))
        .filter { $0.mode != "walk" }
        .allSatisfy { $0.distanceMeters == nil })
}

@Test func routeTransitNullResultDecodesToNil() throws {
    // "경로 없음"(ODsay graceful), 조회 실패 아님, throw 대상 아님(3-state, walk 동형)
    let envelope = try JSONDecoder().decode(TransitRouteEnvelope.self, from: Data(#"{"result":null}"#.utf8))
    #expect(envelope.result == nil)
}

// MARK: - 단위 함정 회귀 (강동→강남 상식 범위)

@Test func routeUnitsAreInSaneRanges() throws {
    let car = try JSONDecoder().decode(CarRouteBriefing.self, from: fixture("route-car"))
    // durationSeconds가 초가 아니면(밀리초 오염 등) 이 범위를 벗어난다
    #expect((600...7200).contains(car.durationSeconds))
    let transit = try #require(JSONDecoder().decode(TransitRouteEnvelope.self, from: fixture("route-transit")).result)
    #expect((20...180).contains(transit.recommended.summary.totalMinutes))
    #expect(transit.recommended.summary.fare > 0)
}

// MARK: - walk leg 계약

@Test func walkLegsHaveNoLineName() throws {
    let transit = try #require(JSONDecoder().decode(TransitRouteEnvelope.self, from: fixture("route-transit")).result)
    let allLegs = transit.recommended.legs + transit.alternatives.flatMap(\.legs)
    let walks = allLegs.filter { $0.mode == "walk" }
    #expect(!walks.isEmpty)
    // 도보 leg는 노선·승하차 정보가 없다(뷰의 "도보 N분" 단일 분기 근거)
    #expect(walks.allSatisfy { $0.lineName == nil && $0.fromName == nil && $0.stationCount == nil })
    #expect(walks.allSatisfy { $0.minutes >= 0 })
}

// MARK: - 도보 경로 브리핑 계약

@Test func routeWalkFixtureDecodes() throws {
    let envelope = try JSONDecoder().decode(WalkRouteEnvelope.self, from: fixture("route-walk"))
    let briefing = try #require(envelope.result)
    #expect(briefing.distanceMeters == 2078)
    #expect(briefing.durationSeconds == 1806)
    #expect(!briefing.steps.isEmpty)
    // description이 낭독 정본(완성 문장), 첫 단계에서 확인
    #expect(briefing.steps.first?.description == "천호대로를 따라 119m 이동")
    // distanceMeters는 optional(현재 서버 미전송) — nil이어도 디코딩 성공해야 함
    #expect(briefing.steps.allSatisfy { $0.distanceMeters == nil })
    // includeGeometry 미지정 응답엔 기하가 없다(기존 계약 유지)
    #expect(briefing.steps.allSatisfy { $0.pathCoords == nil })
}

/// includeGeometry=1 응답 계약: 스텝마다 pathCoords가 붙지만 옵셔널이라
/// 없는 스텝(서버가 기하를 못 준 스텝)과 섞여도 디코딩이 깨지지 않아야 한다.
@Test func walkStepDecodesOptionalPathCoords() throws {
    let json = #"""
    {"result":{"distanceMeters":100,"durationSeconds":80,"steps":[
      {"description":"이동","pathCoords":[{"lat":37.5,"lng":127.1},{"lat":37.5001,"lng":127.1}]},
      {"description":"우회전"}
    ]}}
    """#
    let envelope = try JSONDecoder().decode(WalkRouteEnvelope.self, from: Data(json.utf8))
    let steps = try #require(envelope.result?.steps)
    #expect(steps[0].pathCoords?.count == 2)
    #expect(steps[0].pathCoords?.first == RoutePoint(lat: 37.5, lng: 127.1))
    #expect(steps[1].pathCoords == nil)
}

@Test func routeWalkNoRouteFixtureDecodesToNilResult() throws {
    // "경로 없음"(예: Tmap 3102) — 조회 실패 아님, throw 대상 아님(3-state)
    let envelope = try JSONDecoder().decode(WalkRouteEnvelope.self, from: fixture("route-walk-no-route"))
    #expect(envelope.result == nil)
}

@Test func routeWalkUnitsAreInSaneRange() throws {
    let envelope = try JSONDecoder().decode(WalkRouteEnvelope.self, from: fixture("route-walk"))
    let briefing = try #require(envelope.result)
    // durationSeconds가 분·밀리초로 오염되면 이 범위(도보 상식 범위)를 벗어난다
    #expect((60...14400).contains(briefing.durationSeconds))
    #expect(briefing.distanceMeters > 0)
}

// MARK: - RouteService.walk 404 게이트 통과 확인 (Kit 계층에서 흡수하지 않고 그대로 throw)

extension StubNetworkTests {
    @Test func routeServiceWalkThrowsBadStatusOn404() async throws {
        StubURLProtocol.handler = { _ in
            (404, Data(#"{"error":"도보 길찾기는 API 키 등록 후 사용할 수 있습니다."}"#.utf8))
        }
        let service = RouteService(client: stubbedClient())
        await #expect(throws: APIError.self) {
            _ = try await service.walk(originLat: 37.5, originLng: 127.0, destLat: 37.6, destLng: 127.1, accessible: false, lang: .ko, via: nil)
        }
    }

    @Test func routeServiceWalkNullResultReturnsNilNotThrow() async throws {
        StubURLProtocol.handler = { _ in (200, Data(#"{"result":null}"#.utf8)) }
        let service = RouteService(client: stubbedClient())
        let result = try await service.walk(originLat: 37.5, originLng: 127.0, destLat: 37.6, destLng: 127.1, accessible: false, lang: .ko, via: nil)
        #expect(result == nil)
    }
}

// MARK: - 운행 시간 판정 필드(2026-08-01)
// ODsay가 출발 시각을 반영하지 않아 서버가 TOPIS 운행시간을 조인해 실어 준다.
// 옵셔널이라 필드가 없는 구버전 응답과도 호환되어야 한다.

extension StubNetworkTests {
    @Test func 운행시간_필드를_디코딩한다() throws {
        let json = Data("""
        {"mode":"bus","lineName":"342","fromName":"강동역","toName":"길동생태공원",
         "stationCount":14,"minutes":22,"serviceStatus":"outside",
         "firstServiceTime":"04:00","lastServiceTime":"22:30"}
        """.utf8)
        let leg = try JSONDecoder().decode(TransitRouteLeg.self, from: json)
        #expect(leg.serviceStatus == "outside")
        #expect(leg.firstServiceTime == "04:00")
        #expect(leg.lastServiceTime == "22:30")
    }

    @Test func 운행시간_필드가_없어도_디코딩된다() throws {
        let json = Data(#"{"mode":"bus","lineName":"342","minutes":22}"#.utf8)
        let leg = try JSONDecoder().decode(TransitRouteLeg.self, from: json)
        #expect(leg.serviceStatus == nil)
        #expect(leg.firstServiceTime == nil)
    }
}

// MARK: - 계단 회피 판정 필드(2026-08-08, 백로그 A4)
// 기하 응답에는 안내 문장이 유사 스텝으로 오지 않으므로 필드가 유일한 채널이다.
// 두 필드 모두 옵셔널 — 구버전 서버 응답에서 브리핑이 통째로 깨지면 안 된다.

/// 도보 스텝의 서버 투영 행동(E16 축3 §4.2.1). 리듀서는 `step.action`만 보므로(문장 분류 폴백 없음)
/// **이 디코딩이 없으면 임박 큐가 전면 침묵한다** — 웹 테스트도 타입 검사도 Kit fixture
/// 테스트도 통과시키는 자리라(fixture는 action을 직접 싣는다) 여기가 유일한 가드다.
@Suite("도보 스텝의 서버 투영 행동")
struct WalkRouteStepActionTests {
    private func steps(_ json: String) throws -> [WalkRouteStep] {
        try JSONDecoder().decode(WalkRouteBriefing.self, from: Data(json.utf8)).steps
    }

    @Test("서버가 실은 action을 디코딩한다")
    func decodesAction() throws {
        let s = try steps(#"""
        {"distanceMeters":1,"durationSeconds":1,
         "steps":[{"description":"우회전 후 10m 이동","action":"right"},
                  {"description":"횡단보도","action":"crosswalk"}]}
        """#)
        #expect(s[0].action == .right)
        #expect(s[1].action == .crosswalk)
    }

    @Test("필드가 없으면 nil이다(구버전 서버 응답에서 브리핑이 깨지지 않는다)")
    func absentAction() throws {
        let s = try steps(#"{"distanceMeters":1,"durationSeconds":1,"steps":[{"description":"직진"}]}"#)
        #expect(s[0].action == nil)
        #expect(s[0].description == "직진")
    }

    @Test("모르는 행동 문자열은 nil로 떨어진다(전방 호환 — 브리핑을 실패시키지 않는다)")
    func unknownAction() throws {
        let s = try steps(#"""
        {"distanceMeters":1,"durationSeconds":1,
         "steps":[{"description":"무언가","action":"teleport"}]}
        """#)
        #expect(s[0].action == nil)
    }

    @Test("자동차 브리핑의 guidanceLang(A26)은 선택 디코딩이다")
    func decodesGuidanceLang() throws {
        let with = try JSONDecoder().decode(CarRouteBriefing.self, from: Data(#"""
        {"distanceMeters":1,"durationSeconds":1,"taxiFare":0,"tollFare":0,"guides":[],"guidanceLang":"ko"}
        """#.utf8))
        #expect(with.guidanceLang == "ko")
        let without = try JSONDecoder().decode(CarRouteBriefing.self, from: Data(#"""
        {"distanceMeters":1,"durationSeconds":1,"taxiFare":0,"tollFare":0,"guides":[]}
        """#.utf8))
        #expect(without.guidanceLang == nil)
    }

    @Test("횡단 구간 플래그(A26)를 디코딩하고, 없으면 nil이다")
    func decodesCrossing() throws {
        let s = try steps(#"""
        {"distanceMeters":1,"durationSeconds":1,
         "steps":[{"description":"Cross the crosswalk, then walk 30m","action":"crosswalk","crossing":true},
                  {"description":"천호역 횡단보도까지 100m 이동","action":"crosswalk"}]}
        """#)
        #expect(s[0].crossing == true)
        #expect(s[1].crossing == nil)
    }

    @Test("다른 필드와 함께 와도 전부 디코딩된다")
    func withOtherFields() throws {
        let s = try steps(#"""
        {"distanceMeters":1,"durationSeconds":1,
         "steps":[{"description":"좌회전 후 20m 이동","distanceMeters":20,
                   "pathCoords":[{"lat":37.5,"lng":127.1}],
                   "live":{"target":"파리바게뜨"},"action":"left"}]}
        """#)
        #expect(s[0].action == .left)
        #expect(s[0].distanceMeters == 20)
        #expect(s[0].pathCoords?.count == 1)
        #expect(s[0].live?.target == "파리바게뜨")
    }
}

@Suite("도보 브리핑의 계단 회피 필드")
struct WalkRouteBriefingStepFreeTests {
    private func decode(_ json: String) throws -> WalkRouteBriefing {
        try JSONDecoder().decode(WalkRouteBriefing.self, from: Data(json.utf8))
    }

    @Test("필드가 없으면 판정 없음이다(구버전 서버 응답)")
    func absent() throws {
        let b = try decode(#"{"distanceMeters":100,"durationSeconds":60,"steps":[]}"#)
        #expect(b.stepFreeStatus == nil)
        #expect(b.stepFreeNotice == nil)
    }

    @Test("알려진 상태를 매핑한다")
    func known() throws {
        let b = try decode(#"""
        {"distanceMeters":100,"durationSeconds":60,"steps":[],
         "stepFree":"no_stepfree_route","stepFreeNotice":"계단이 포함될 수 있습니다."}
        """#)
        #expect(b.stepFreeStatus == .noStepFreeRoute)
        #expect(b.stepFreeNotice == "계단이 포함될 수 있습니다.")
    }

    @Test("applied·unavailable도 매핑한다")
    func otherStates() throws {
        let applied = try decode(#"{"distanceMeters":1,"durationSeconds":1,"steps":[],"stepFree":"applied"}"#)
        #expect(applied.stepFreeStatus == .applied)
        let unavailable = try decode(#"{"distanceMeters":1,"durationSeconds":1,"steps":[],"stepFree":"unavailable"}"#)
        #expect(unavailable.stepFreeStatus == .unavailable)
    }

    /// ⚠ raw enum으로 직접 디코딩하면 서버가 넷째 상태를 추가할 때
    /// `WalkRouteBriefing` **전체**가 깨진다. 모르는 값은 "판정 없음"이다.
    @Test("미지의 상태 문자열이 브리핑 전체를 깨뜨리지 않는다")
    func unknownStatusDoesNotBreakDecoding() throws {
        let b = try decode(#"""
        {"distanceMeters":100,"durationSeconds":60,"steps":[],"stepFree":"partially_applied"}
        """#)
        #expect(b.distanceMeters == 100)
        #expect(b.stepFreeStatus == nil)
    }
}

/// 최종 접근 기하도 같은 규율을 따른다 — 선택 필드 + 원시 문자열 사유(spec 2026-08-08 §3.1).
@Suite("도보 브리핑의 최종 접근 기하")
struct WalkRouteBriefingFinalApproachTests {
    private func decode(_ json: String) throws -> WalkRouteBriefing {
        try JSONDecoder().decode(WalkRouteBriefing.self, from: Data(json.utf8))
    }

    @Test("필드가 없으면 nil이다(구버전 서버 응답)")
    func absent() throws {
        let b = try decode(#"{"distanceMeters":100,"durationSeconds":60,"steps":[]}"#)
        #expect(b.finalApproach == nil)
    }

    @Test("거리·상대각을 읽는다")
    func present() throws {
        let b = try decode(#"""
        {"distanceMeters":100,"durationSeconds":60,"steps":[],
         "finalApproach":{"offsetMeters":16.1,"relativeBearing":-92.4}}
        """#)
        let fa = try #require(b.finalApproach)
        #expect(abs(fa.offsetMeters - 16.1) < 0.001)
        #expect(relativeDirection(try #require(fa.relativeBearing)) == .left)
        #expect(fa.unavailableReason == nil)
    }

    @Test("부재 사유를 매핑한다")
    func unavailable() throws {
        let b = try decode(#"""
        {"distanceMeters":100,"durationSeconds":60,"steps":[],
         "finalApproach":{"offsetMeters":4.2,"bearingUnavailable":"tooClose"}}
        """#)
        #expect(b.finalApproach?.unavailableReason == .tooClose)
        #expect(b.finalApproach?.relativeBearing == nil)
    }

    /// ⚠ raw enum으로 직접 디코딩하면 서버가 넷째 사유를 추가할 때 브리핑 전체가 깨진다.
    @Test("미지의 사유 문자열이 브리핑 전체를 깨뜨리지 않는다")
    func unknownReasonDoesNotBreakDecoding() throws {
        let b = try decode(#"""
        {"distanceMeters":100,"durationSeconds":60,"steps":[],
         "finalApproach":{"offsetMeters":30,"bearingUnavailable":"headingUnstable"}}
        """#)
        #expect(b.distanceMeters == 100)
        #expect(b.finalApproach?.unavailableReason == nil)
        #expect(b.finalApproach?.offsetMeters == 30)
    }
}

// MARK: - 경유지 필드(2026-08-22 N4)
// `via`를 보낸 요청에만 실리는 옵트인 필드 — 없는 응답에서 브리핑이 깨지면 안 된다.

@Suite("경로 브리핑의 waypoint 필드")
struct RouteBriefingWaypointTests {
    @Test("도보: 있으면 stepIndex·coord를 읽고, 없으면 nil")
    func walk() throws {
        let with = try JSONDecoder().decode(WalkRouteBriefing.self, from: Data(#"""
        {"distanceMeters":100,"durationSeconds":60,"steps":[],
         "waypoint":{"stepIndex":5,"coord":{"lat":37.5353,"lng":127.1323}}}
        """#.utf8))
        #expect(with.waypoint?.stepIndex == 5)
        #expect(with.waypoint?.coord.lat == 37.5353)
        let without = try JSONDecoder().decode(WalkRouteBriefing.self, from: Data(
            #"{"distanceMeters":100,"durationSeconds":60,"steps":[]}"#.utf8))
        #expect(without.waypoint == nil)
    }

    @Test("자동차: 동형")
    func car() throws {
        let with = try JSONDecoder().decode(CarRouteBriefing.self, from: Data(#"""
        {"distanceMeters":2066,"durationSeconds":300,"taxiFare":5000,"tollFare":0,"guides":[],
         "provider":"tmap","waypoint":{"stepIndex":2,"coord":{"lat":37.5353,"lng":127.1323}}}
        """#.utf8))
        #expect(with.waypoint?.stepIndex == 2)
        let without = try JSONDecoder().decode(CarRouteBriefing.self, from: Data(
            #"{"distanceMeters":2066,"durationSeconds":300,"taxiFare":5000,"tollFare":0,"guides":[]}"#.utf8))
        #expect(without.waypoint == nil)
    }
}

// E27: 대중교통 leg의 영문 additive 필드 — 한국어 필드는 그대로 오고 `*En`만 더해진다.
@Test func transitLegEnFieldsDecodeOptionally() throws {
    let json = #"""
    {"result":{"recommended":{"summary":{"totalMinutes":31,"fare":1650,"transfers":2,"walkMinutes":3,"departName":"길동","arriveName":"강남","departNameEn":"Gildong","arriveNameEn":"Gangnam"},
      "legs":[{"mode":"subway","lineName":"수도권 9호선(급행)","lineNameEn":"Line 9 Express","fromName":"길동","fromNameEn":"Gildong","toName":"천호","toNameEn":"Cheonho (Pungnaptoseong)","stationCount":1,"minutes":3,
               "stops":[{"name":"길동","nameEn":"Gildong","lat":37.5,"lng":127.1}]}],
      "routeKey":"p0"},"alternatives":[],"totalCandidates":1}}
    """#
    let r = try #require(try JSONDecoder().decode(TransitRouteEnvelope.self, from: Data(json.utf8)).result)
    let leg = r.recommended.legs[0]
    #expect(leg.lineName == "수도권 9호선(급행)")
    #expect(leg.lineNameEn == "Line 9 Express")
    #expect(leg.fromNameEn == "Gildong")
    #expect(leg.toNameEn == "Cheonho (Pungnaptoseong)")
    #expect(leg.stops?[0].nameEn == "Gildong")
    #expect(r.recommended.summary.departNameEn == "Gildong")
    #expect(r.recommended.summary.arriveNameEn == "Gangnam")
}

@Test func transitDisplayPickLineIsAtomic() {
    #expect(TransitDisplay.pickLine(isEn: true, ko: "강남, 2호선", enParts: ["Gangnam", "Line 2"]) { $0.joined(separator: ", ") } == "Gangnam, Line 2")
    #expect(TransitDisplay.pickLine(isEn: true, ko: "강남, 2호선", enParts: ["Gangnam", nil]) { $0.joined(separator: ", ") } == "강남, 2호선")
    #expect(TransitDisplay.pickLine(isEn: false, ko: "강남, 2호선", enParts: ["Gangnam", "Line 2"]) { $0.joined(separator: ", ") } == "강남, 2호선")
}

// MARK: - 급행 정차역 집합·출구 번호(2026-09-02, A16 L1·E25)
// 두 필드 모두 additive optional. ⚠ 선언하지 않으면 서버가 실어도 앱만 침묵한다 — 디코딩이 유일한 가드.

@Suite("급행 정차역 집합·출구 번호 디코딩")
struct TransitLegExpressExitTests {
    @Test func 두_필드를_디코딩한다() throws {
        let json = Data("""
        {"mode":"subway","lineName":"수도권 9호선","fromName":"당산","toName":"노들","stationCount":3,"minutes":6,
         "expressStops":["김포공항","당산","여의도","노량진","중앙보훈병원"],
         "expressStopIds":["902","913","915","917","938"],
         "exit":{"alight":"1"}}
        """.utf8)
        let leg = try JSONDecoder().decode(TransitRouteLeg.self, from: json)
        #expect(leg.expressStops == ["김포공항", "당산", "여의도", "노량진", "중앙보훈병원"])
        #expect(leg.expressStopIds == ["902", "913", "915", "917", "938"])
        #expect(leg.exit?.alight == "1")
        #expect(leg.exit?.board == nil)
    }

    @Test func 두_필드가_없어도_디코딩된다() throws {
        let json = Data(#"{"mode":"subway","lineName":"수도권 5호선","minutes":6}"#.utf8)
        let leg = try JSONDecoder().decode(TransitRouteLeg.self, from: json)
        #expect(leg.expressStops == nil)
        #expect(leg.expressStopIds == nil)
        #expect(leg.exit == nil)
    }
}
