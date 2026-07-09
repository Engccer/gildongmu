import Testing
import Foundation
@testable import GildongmuKit

// 내 주변 6종 계약 테스트 — Fixtures/*-nearby.json(2026-07-07 prod 실캡처)이 계약 정본.

@Test func subwayNearbyFixtureDecodes() throws {
    let result = try JSONDecoder().decode(SubwayNearbyResponse.self, from: fixture("subway-nearby"))
    #expect(!result.stations.isEmpty)
    let first = result.stations[0]
    #expect(first.arrivalStatus == "ok")
    #expect(!first.lines.isEmpty)
    // 도착 낭독 정본은 완성 문장 message(arvlMsg2) — 비어 있으면 계약 위반
    #expect(!first.arrivals.isEmpty)
    #expect(first.arrivals.allSatisfy { !$0.message.isEmpty })
    // 거리순 정렬 보존(서버 계약)
    #expect(result.stations.map(\.distanceMeters) == result.stations.map(\.distanceMeters).sorted())
}

@Test func busNearbyFixtureDecodes() throws {
    let result = try JSONDecoder().decode(BusNearbyResponse.self, from: fixture("bus-nearby"))
    #expect(!result.stops.isEmpty)
    #expect(result.stops.allSatisfy { $0.source == "tago" || $0.source == "seoul" })
    // 서울(TOPIS) 도착은 완성 문장 arrivalMessage가 정본
    let seoulArrivals = result.stops.flatMap(\.arrivals).filter { $0.source == "seoul" }
    #expect(!seoulArrivals.isEmpty)
    #expect(seoulArrivals.allSatisfy { $0.arrivalMessage?.isEmpty == false })
}

@Test func bikeNearbyFixtureDecodes() throws {
    let result = try JSONDecoder().decode(BikeNearbyResponse.self, from: fixture("bike-nearby"))
    #expect(!result.stations.isEmpty)
    // 0대와 "정보 없음"의 혼동이 없는 정수 필드 계약
    #expect(result.stations.allSatisfy { $0.racksTotal >= 0 && $0.bikesAvailable >= 0 })
    #expect(result.stations.allSatisfy { !$0.stationId.isEmpty })
}

@Test func clinicNearbyFixtureDecodes() throws {
    let result = try JSONDecoder().decode(ClinicNearbyResponse.self, from: fixture("clinic-nearby"))
    #expect(!result.clinics.isEmpty)
    // openStatus는 라우트가 덧붙이는 3-state — open/closed/unknown 외 값은 계약 위반
    #expect(result.clinics.allSatisfy { ["open", "closed", "unknown"].contains($0.openStatus.state) })
    // 진료시간은 월~일+공휴일 8칸, 정보 없는 요일은 start/end 둘 다 null
    #expect(result.clinics.allSatisfy { $0.hours.count == 8 })
    #expect(result.clinics.contains { $0.hours.contains { $0.start == nil && $0.end == nil } })
}

@Test func kidsNearbyFixtureDecodes() throws {
    let result = try JSONDecoder().decode(KidsNearbyResponse.self, from: fixture("kids-nearby"))
    #expect(!result.kids.isEmpty)
    #expect(result.kids.allSatisfy { ["kidscafe", "playground", "playcenter", "park"].contains($0.kind) })
    #expect(result.kids.allSatisfy { ["indoor", "outdoor", "unknown"].contains($0.indoorOutdoor) })
    // roadAddress·phone은 옵셔널 — fixture에 실제 결측이 존재해야 옵셔널 계약이 검증된다
    #expect(result.kids.contains { $0.roadAddress == nil })
    #expect(result.kids.contains { $0.phone == nil })
}

@Test func aroundNearbyFixtureDecodes() throws {
    let result = try JSONDecoder().decode(AroundNearbyResponse.self, from: fixture("around-nearby"))
    #expect(!result.places.isEmpty)
    // bearing은 8방위 소문자(n·ne·e·se·s·sw·w·nw) — fixture 실측
    let validBearings = Set(["n", "ne", "e", "se", "s", "sw", "w", "nw"])
    #expect(result.places.allSatisfy { validBearings.contains($0.bearing) })
    #expect(result.places.allSatisfy { !$0.categoryRaw.isEmpty })
    #expect(result.places.allSatisfy { $0.distanceMeters >= 0 })
}

@Test func busRouteStopsFixtureDecodes() throws {
    let result = try JSONDecoder().decode(BusRouteStopsResponse.self, from: fixture("bus-route-stops"))
    #expect(!result.stops.isEmpty)
    #expect(result.stops.allSatisfy { !$0.nodeId.isEmpty })
    // order는 정류소 통과 순서 — 오름차순 보존(서버 계약)
    #expect(result.stops.map(\.order) == result.stops.map(\.order).sorted())
}
