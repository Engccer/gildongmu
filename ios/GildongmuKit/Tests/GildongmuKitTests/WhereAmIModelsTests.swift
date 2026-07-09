import Testing
import Foundation
@testable import GildongmuKit

// "현재 위치 정위"(where-am-i) 계약 테스트 — Fixtures/where-am-i.json(2026-07-10 prod
// 실캡처, 길동 좌표)이 계약 정본. envelope {data:...}는 다른 nearby fixture와 달리
// 라우트가 {data: WhereAmIData | null}로 감싸므로 WhereAmIResponse로 디코딩한다.

@Test func whereAmIFixtureDecodes() throws {
    let response = try JSONDecoder().decode(WhereAmIResponse.self, from: fixture("where-am-i"))
    let data = try #require(response.data)
    #expect(data.region == "서울특별시 강동구 길동")
    #expect(data.address?.jibun == "서울 강동구 길동 247")
    #expect(data.address?.road == nil)
    #expect(data.nearestStation?.name == "길동")
    #expect(data.nearestStation?.line == "5호선")
    #expect(data.nearestStation?.bearing == "n")
    #expect(data.nearestStation?.distanceMeters == 336)
    // fixture는 12곳(cap 6은 narrative 빌더 책임, 모델 자체는 전량 보존)
    #expect(data.landmarks.count == 12)
}

@Test func buildLocationNarrativeKoFromFixture() throws {
    let response = try JSONDecoder().decode(WhereAmIResponse.self, from: fixture("where-am-i"))
    let data = try #require(response.data)
    let paragraphs = buildLocationNarrativeKo(data)

    #expect(paragraphs.count == 2)
    // 단락1 — 위치 + 근접역
    #expect(paragraphs[0].contains("현재 위치는"))
    #expect(paragraphs[0].contains("서울특별시 강동구 길동"))
    #expect(paragraphs[0].contains("가장 가까운 지하철역은 길동 (5호선), 북쪽 약 336m입니다."))
    // 단락2 — 주변 기준점(거리순 상위 6, 입력 순서 유지)
    #expect(paragraphs[1].hasPrefix("주변에는 "))
    #expect(paragraphs[1].hasSuffix(" 등이 있습니다."))
    #expect(paragraphs[1].contains("남서쪽 약 22m에 달리는커피 길동점 카페"))
    #expect(paragraphs[1].contains("본도시락 길동점 음식점"))
    // cap 6 밖(7번째 이후)은 생략된다 — "CU 길동미소점 ATM"(7번째)·"호남가"(8번째)
    #expect(!paragraphs[1].contains("ATM"))
    #expect(!paragraphs[1].contains("호남가"))
}

@Test func buildLocationNarrativeKoOmitsMissingPieces() {
    // 주소·행정동·기준점 없이 근접역만 있으면 역 문장만, 단락2는 생략된다.
    let stationOnly = WhereAmIData(
        address: nil,
        region: nil,
        nearestStation: WhereAmIStation(name: "굽은다리", line: "5호선", bearing: "se", distanceMeters: 250),
        landmarks: [])
    let paragraphs = buildLocationNarrativeKo(stationOnly)
    #expect(paragraphs.count == 1)
    #expect(paragraphs[0] == "가장 가까운 지하철역은 굽은다리 (5호선), 남동쪽 약 250m입니다.")

    // 근접역·기준점 없이 위치만 있으면 위치 문장만.
    let placeOnly = WhereAmIData(
        address: WhereAmIAddress(road: "천호대로 1042", jibun: nil),
        region: "서울특별시 강동구 길동",
        nearestStation: nil,
        landmarks: [])
    let placeParagraphs = buildLocationNarrativeKo(placeOnly)
    #expect(placeParagraphs.count == 1)
    #expect(placeParagraphs[0] == "현재 위치는 서울특별시 강동구 길동, 천호대로 1042입니다.")

    // 전부 없으면 빈 배열.
    let empty = WhereAmIData(address: nil, region: nil, nearestStation: nil, landmarks: [])
    #expect(buildLocationNarrativeKo(empty).isEmpty)
}

@Test func buildLocationNarrativeKoStripsDuplicateRegionPrefix() {
    // 웹 stripRegionPrefix 미러: 도로명이 행정동의 시·구 접두로 시작하면 중복 제거.
    let dedup = WhereAmIData(
        address: WhereAmIAddress(road: "서울특별시 강동구 천중로44길 74", jibun: nil),
        region: "서울특별시 강동구 길동",
        nearestStation: nil,
        landmarks: [])
    #expect(buildLocationNarrativeKo(dedup)[0] == "현재 위치는 서울특별시 강동구 길동, 천중로44길 74입니다.")

    // 접두가 겹치지 않으면 원문 그대로 둔다.
    let noOverlap = WhereAmIData(
        address: WhereAmIAddress(road: "천호대로 1042", jibun: nil),
        region: "서울특별시 강동구 길동",
        nearestStation: nil,
        landmarks: [])
    #expect(buildLocationNarrativeKo(noOverlap)[0] == "현재 위치는 서울특별시 강동구 길동, 천호대로 1042입니다.")
}

@Test func buildLocationNarrativeKoFallsBackWhenRoadIsEmptyString() {
    // 웹 `||` 폴백 동형: road가 빈 문자열("")이면 트레일링 쉼표 없이 jibun으로 폴백된다.
    let emptyRoad = WhereAmIData(
        address: WhereAmIAddress(road: "", jibun: "강동구 길동 247"),
        region: "서울특별시 강동구 길동",
        nearestStation: nil,
        landmarks: [])
    let paragraph = buildLocationNarrativeKo(emptyRoad)[0]
    #expect(paragraph == "현재 위치는 서울특별시 강동구 길동, 강동구 길동 247입니다.")
    #expect(!paragraph.contains(", 입니다"))
}
