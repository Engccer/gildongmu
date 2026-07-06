import Testing
import Foundation
@testable import GildongmuKit

// 경로 브리핑 계약 테스트: Fixtures/route-car.json·route-transit.json(prod 실캡처)이 계약 정본.
// ⚠ car 응답은 envelope 없이 CarRouteBriefing 직접(웹 /api/route/car 계약).
// 단위 함정 회귀: durationSeconds=초·totalMinutes=분·fare/taxiFare/tollFare=원.

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
    let result = envelope.result
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

// MARK: - 단위 함정 회귀 (강동→강남 상식 범위)

@Test func routeUnitsAreInSaneRanges() throws {
    let car = try JSONDecoder().decode(CarRouteBriefing.self, from: fixture("route-car"))
    // durationSeconds가 초가 아니면(밀리초 오염 등) 이 범위를 벗어난다
    #expect((600...7200).contains(car.durationSeconds))
    let transit = try JSONDecoder().decode(TransitRouteEnvelope.self, from: fixture("route-transit")).result
    #expect((20...180).contains(transit.recommended.summary.totalMinutes))
    #expect(transit.recommended.summary.fare > 0)
}

// MARK: - walk leg 계약

@Test func walkLegsHaveNoLineName() throws {
    let transit = try JSONDecoder().decode(TransitRouteEnvelope.self, from: fixture("route-transit")).result
    let allLegs = transit.recommended.legs + transit.alternatives.flatMap(\.legs)
    let walks = allLegs.filter { $0.mode == "walk" }
    #expect(!walks.isEmpty)
    // 도보 leg는 노선·승하차 정보가 없다(뷰의 "도보 N분" 단일 분기 근거)
    #expect(walks.allSatisfy { $0.lineName == nil && $0.fromName == nil && $0.stationCount == nil })
    #expect(walks.allSatisfy { $0.minutes >= 0 })
}
