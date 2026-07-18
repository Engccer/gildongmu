import Testing
import Foundation
@testable import GildongmuKit

// Place 합성 헬퍼 4종 계약 테스트 — 웹 `src/lib/nearby-place.ts`·`src/lib/where-am-i-place.ts`
// 필드 매핑 미러. category는 채팅 프롬프트 라우팅 키(isStation 판정)이므로 각 소스
// (clinic=kind, kids=category, surrounding=categoryRaw, whereAmI=빈 문자열)를 정확히 검증한다.

@Test func nightClinicToPlaceMapsKindAsCategory() {
    let clinic = NightClinic(
        id: "hpid-1", name: "길동소아과의원", address: "서울 강동구 길동",
        phone: "02-1234-5678", kind: "의원", emergencyClass: "응급의료기관 이외",
        directions: "", lat: 37.5384, lng: 127.1428, distanceMeters: 320,
        hours: [], openStatus: .init(state: "open", start: 900, end: 1800))
    let place = nightClinicToPlace(clinic)

    #expect(place.id == "hpid-1")
    #expect(place.name == "길동소아과의원")
    #expect(place.category == "의원")
    #expect(place.address == "서울 강동구 길동")
    #expect(place.roadAddress == "")
    #expect(place.lat == 37.5384)
    #expect(place.lng == 127.1428)
    #expect(place.phone == "02-1234-5678")
    #expect(place.link == nil)
    #expect(place.distanceMeters == 320)
}

@Test func nightClinicToPlaceEmptyPhoneBecomesNil() {
    let clinic = NightClinic(
        id: "hpid-2", name: "굽은다리소아과", address: "", phone: "", kind: "병원",
        emergencyClass: "", directions: "", lat: 37.53, lng: 127.14, distanceMeters: 500,
        hours: [], openStatus: .init(state: "unknown", start: nil, end: nil))
    #expect(nightClinicToPlace(clinic).phone == nil)
}

@Test func kidsPlaceToPlaceMapsCategoryAndFallsBackRoadAddress() {
    let kids = KidsPlace(
        id: "kakao-1", name: "길동키즈카페", category: "가정,생활 > 유아용품 > 키즈카페",
        kind: "kidscafe", indoorOutdoor: "indoor", distanceMeters: 150,
        address: "서울 강동구 길동 1", roadAddress: nil, lat: 37.539, lng: 127.143,
        phone: "02-999-9999", link: "https://place.map.kakao.com/1")
    let place = kidsPlaceToPlace(kids)

    #expect(place.id == "kakao-1")
    #expect(place.name == "길동키즈카페")
    #expect(place.category == "가정,생활 > 유아용품 > 키즈카페")
    #expect(place.address == "서울 강동구 길동 1")
    // roadAddress nil이면 빈 문자열로 폴백(웹 `k.roadAddress ?? ""` 동형).
    #expect(place.roadAddress == "")
    #expect(place.lat == 37.539)
    #expect(place.lng == 127.143)
    #expect(place.phone == "02-999-9999")
    #expect(place.link == "https://place.map.kakao.com/1")
    #expect(place.distanceMeters == 150)
}

@Test func surroundingPlaceToPlaceUsesCategoryRawNotCategoryKey() {
    let place2 = SurroundingPlace(
        id: "kakao-2", name: "길동역 2번 출구", category: "subway",
        categoryRaw: "교통,수송 > 지하철,전철 > 지하철역", distanceMeters: 80,
        bearing: "n", lat: 37.5385, lng: 127.1432, phone: nil, link: nil)
    let place = surroundingPlaceToPlace(place2)

    #expect(place.id == "kakao-2")
    #expect(place.name == "길동역 2번 출구")
    // category 키("subway")가 아니라 categoryRaw 전체 계층을 써야 isStation 판정이 된다.
    #expect(place.category == "교통,수송 > 지하철,전철 > 지하철역")
    #expect(place.address == "")
    #expect(place.roadAddress == "")
    #expect(place.lat == 37.5385)
    #expect(place.lng == 127.1432)
    #expect(place.distanceMeters == 80)
}

@Test func whereAmIToPlaceCategoryAlwaysEmptyToAvoidStationMisclassification() {
    let dataWithStation = WhereAmIData(
        address: WhereAmIAddress(road: "천호대로 1042", jibun: "길동 247"),
        region: "서울특별시 강동구 길동",
        nearestStation: WhereAmIStation(name: "길동", line: "5호선", bearing: "n", distanceMeters: 336),
        landmarks: [])
    let place = whereAmIToPlace(dataWithStation, lat: 37.53842, lng: 127.14281, lang: "ko")

    // nearestStation이 있어도 category는 항상 빈 문자열(isStation false 고정).
    #expect(place.category == "")
    #expect(place.name == "서울특별시 강동구 길동")
    #expect(place.address == "길동 247")
    #expect(place.roadAddress == "천호대로 1042")
    #expect(place.id == "where-am-i-37.53842-127.14281")
    #expect(place.lat == 37.53842)
    #expect(place.lng == 127.14281)
    #expect(place.phone == nil)
    #expect(place.link == nil)
    #expect(place.distanceMeters == nil)
}

@Test func whereAmIToPlaceNameFallsBackRoadThenJibunThenDefault() {
    let roadOnly = WhereAmIData(
        address: WhereAmIAddress(road: "천호대로 1042", jibun: nil),
        region: nil, nearestStation: nil, landmarks: [])
    #expect(whereAmIToPlace(roadOnly, lat: 0, lng: 0, lang: "ko").name == "천호대로 1042")

    let jibunOnly = WhereAmIData(
        address: WhereAmIAddress(road: nil, jibun: "길동 247"),
        region: nil, nearestStation: nil, landmarks: [])
    #expect(whereAmIToPlace(jibunOnly, lat: 0, lng: 0, lang: "ko").name == "길동 247")

    let none = WhereAmIData(address: nil, region: nil, nearestStation: nil, landmarks: [])
    #expect(whereAmIToPlace(none, lat: 0, lng: 0, lang: "ko").name == "현재 위치")
}
