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
        hours: [], openStatus: .init(state: "open", start: 900, end: 1800), designated: true)
    let place = nightClinicToPlace(clinic)

    #expect(place.id == "hpid-1")
    #expect(place.name == "길동소아과의원")
    #expect(place.category == "의원")
    // dutyAddr은 도로명 주소(명부 153건 전수 확인) — 지번 슬롯에 넣으면
    // PlaceDetailView가 "지번 주소 …"로 낭독한다. 지번은 소스에 없으므로 빈다.
    #expect(place.roadAddress == "서울 강동구 길동")
    #expect(place.address == "")
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
        hours: [], openStatus: .init(state: "unknown", start: nil, end: nil), designated: false)
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

@Test func barrierFreePlaceToPlaceMapsRoadAddressSlot() {
    let bf = BarrierFreePlace(
        contentId: "130183", name: "서울도서관", category: "",
        address: "서울특별시 중구 세종대로 110 (태평로1가)",
        lat: 37.5666, lng: 126.9784, distanceMeters: 34)
    let place = barrierFreePlaceToPlace(bf)

    #expect(place.id == "130183")
    #expect(place.name == "서울도서관")
    #expect(place.category == "")
    // TourAPI addr1은 도로명 주소(fixture 실측) — 지번 슬롯이면 상세가 "지번 주소 …"로 오낭독.
    #expect(place.roadAddress == "서울특별시 중구 세종대로 110 (태평로1가)")
    #expect(place.address == "")
    #expect(place.phone == nil)
    #expect(place.link == nil)
    #expect(place.distanceMeters == 34)
}

@Test func cultureEventToPlaceUsesTitleAndLeavesAddressEmpty() {
    let event = CultureEvent(
        id: "seoul-158804", title: "백제왕성 달빛 캠프", category: "교육/체험",
        place: "서울백제어린이박물관 주변 잔디밭", district: "송파구",
        dateText: "2026-04-17~2026-11-27", timeText: "17:30 ~ 20:00",
        isFree: true, fee: nil, target: "유아·어린이 동반 30가족",
        link: "https://culture.seoul.go.kr/x?cultcode=158804",
        lat: 37.523991, lng: 127.124412, distanceMeters: 2310)
    let place = cultureEventToPlace(event)

    // 상세 제목은 개최 장소가 아니라 행사명이다(목록에서 고른 것이 행사이므로).
    #expect(place.name == "백제왕성 달빛 캠프")
    #expect(place.category == "교육/체험")
    // ⚠ 주소 슬롯은 비운다 — `place`는 시설 설명이라 넣으면 도로명 주소로 낭독된다.
    #expect(place.address == "")
    #expect(place.roadAddress == "")
    // 좌표는 개최 장소라 길찾기가 그대로 성립한다.
    #expect(place.lat == 37.523991)
    #expect(place.lng == 127.124412)
    #expect(place.link == "https://culture.seoul.go.kr/x?cultcode=158804")
    #expect(place.distanceMeters == 2310)
}

@Test func cultureEventDecodesRouteResponseShape() throws {
    // 라우트 실응답 모양(무료 행사는 fee 키 자체가 없다) — 엄격 디코딩 방어.
    let json = """
    {"events":[{"id":"seoul-1","title":"행사","category":"전시/미술","place":"장소",
    "district":"중구","dateText":"2026-08-01~2026-08-31","timeText":"10:00",
    "isFree":true,"target":"누구나","lat":37.5,"lng":127.0,"distanceMeters":120}],"total":84}
    """.data(using: .utf8)!
    let decoded = try JSONDecoder().decode(EventsNearbyResponse.self, from: json)
    #expect(decoded.total == 84)
    #expect(decoded.events.count == 1)
    #expect(decoded.events[0].fee == nil)
    #expect(decoded.events[0].link == nil)
}

@Test func guideDestinationPlaceKeepsCoordsAndLabelWithEmptyCategory() {
    let place = guideDestinationPlace(
        dest: BeaconDest(lat: 37.5361, lng: 127.1462), label: "오아시스마켓")

    #expect(place.name == "오아시스마켓")
    #expect(place.lat == 37.5361)
    #expect(place.lng == 127.1462)
    // category 빈 문자열 고정 — 라벨만으로 역 프롬프트 버킷을 판정하지 않는다.
    #expect(place.category == "")
    // 주소는 소스에 없으므로 비운다(없는 값을 지어내지 않는다).
    #expect(place.address == "")
    #expect(place.roadAddress == "")
    #expect(place.id == "guide-dest:37.5361,127.1462")
}

// MARK: - 대중교통 경유역 → Place · 상태 문장 역 언급 (E33)

private func viaStop(_ name: String, en: String? = nil, id: String? = nil, lat: Double = 37.5, lng: Double = 127.1) -> TransitLegStop {
    TransitLegStop(name: name, stationId: id, lat: lat, lng: lng, nameEn: en)
}

@Test func transitStopPlaceKeepsKoreanNameAsJoinKeyAndPassesIsStation() {
    let place = transitStopPlace(viaStop("천호(풍납토성)", en: "Cheonho", id: "0554", lat: 37.5386, lng: 127.1236))
    #expect(place.id == "transit-stop:0554")
    // 조인 키는 한국어 원문 — 역 섹션 조회(`stationSections.load(stationName:)`)가 이 값으로 돈다.
    #expect(place.name == "천호(풍납토성)")
    #expect(place.nameRoman == "Cheonho")
    #expect(isStation(place))
    #expect(place.lat == 37.5386)
    #expect(place.lng == 127.1236)
    // 소스에 없는 값은 비운다.
    #expect(place.address == "" && place.roadAddress == "" && place.phone == nil && place.link == nil)
}

@Test func transitStopPlaceFallsBackToCoordinateIdAndNilRoman() {
    let place = transitStopPlace(viaStop("여의도", en: "", id: "", lat: 37.5216, lng: 126.9243))
    #expect(place.id == "transit-stop:37.5216,126.9243")
    // 빈 영문은 부재다(빈 문자열 병기 금지).
    #expect(place.nameRoman == nil)
}

@Test func transitStationMentionsMatchBothLabelsInAppearanceOrder() {
    let stops = [viaStop("천호(풍납토성)", en: "Cheonho"), viaStop("여의도", en: "Yeouido"), viaStop("신촌", en: "Sinchon")]
    // ko 문장: 등장 순, 같은 역 두 번은 한 번.
    #expect(transitStationMentions(in: "5호선 탑승 중, 여의도에서 하차합니다. 다음 역 여의도.", stops: stops) == [1])
    #expect(transitStationMentions(in: "천호(풍납토성)에서 5호선 탑승 기다리는 중. 하차: 여의도.", stops: stops) == [0, 1])
    // en 문장·혼합 문장(조각별 언어가 갈린 줄, 설계 리뷰 E3) 모두 잡는다.
    #expect(transitStationMentions(in: "Riding Line 5, get off at Yeouido.", stops: stops) == [1])
    #expect(transitStationMentions(in: "Riding Line 5, get off at Yeouido. 다음 역 여의도. Cheonho 출발.", stops: stops) == [1, 0])
    // 언급 없음.
    #expect(transitStationMentions(in: "남은 정거장 3개.", stops: stops) == [])
}

@Test func transitStationMentionsPrefersLongerNameLikeChatMentions() {
    let stops = [viaStop("신촌"), viaStop("신촌(경의중앙선)")]
    #expect(transitStationMentions(in: "다음 역 신촌(경의중앙선).", stops: stops) == [1])
}
