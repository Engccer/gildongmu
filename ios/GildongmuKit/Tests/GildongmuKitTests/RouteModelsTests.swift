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
            _ = try await service.walk(originLat: 37.5, originLng: 127.0, destLat: 37.6, destLng: 127.1)
        }
    }

    @Test func routeServiceWalkNullResultReturnsNilNotThrow() async throws {
        StubURLProtocol.handler = { _ in (200, Data(#"{"result":null}"#.utf8)) }
        let service = RouteService(client: stubbedClient())
        let result = try await service.walk(originLat: 37.5, originLng: 127.0, destLat: 37.6, destLng: 127.1)
        #expect(result == nil)
    }
}
