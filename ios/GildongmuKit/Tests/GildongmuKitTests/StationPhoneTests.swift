import Testing
import Foundation
@testable import GildongmuKit

// 역 장소 상세 개편(E44) 판정 계층 — spec 2026-09-17-station-detail-reorg-design.md §3.1·§5.4.
// fixture 모양은 2026-09-17 실호출(설계 리뷰 18회) 응답에서 옮겼다. 번호는 실제 역 번호다(공개 정보).

private func poi(
    _ name: String, _ category: String, _ phone: String?,
    lat: Double, lng: Double, id: String = "kakao-1"
) -> Place {
    Place(id: id, name: name, category: category, address: "", roadAddress: "",
          englishAddress: nil, lat: lat, lng: lng, phone: phone, link: nil, distanceMeters: nil)
}

private let subwayCat = "교통,수송 > 지하철,전철 > "

// MARK: stationLayoutKind

@Test func layoutKindSubwayForKakaoStationPOI() {
    #expect(stationLayoutKind(poi("천호역 5호선", subwayCat + "수도권5호선", "02-6311-5471", lat: 37.5387, lng: 127.1234)) == .subway)
}

@Test func layoutKindSubwayForTransitStop() {
    let stop = TransitLegStop(name: "군자", stationId: "2544", lat: 37.557226, lng: 127.07954)
    #expect(stationLayoutKind(transitStopPlace(stop)) == .subway)
}

@Test func layoutKindNilForExitPOI() {
    #expect(stationLayoutKind(poi("천호역 5호선 5번출구", subwayCat + "지하철출구", nil, lat: 37.5387, lng: 127.1234)) == nil)
}

@Test func layoutKindNilForNaverMergedStationPOI() {
    // 네이버 병합 역 POI는 분류가 "지하철,전철"에서 끝난다(번호도 없다).
    #expect(stationLayoutKind(poi("판교역 신분당선", "교통,수송>지하철,전철", nil, lat: 37.3948, lng: 127.1112, id: "naver-local-1")) == nil)
}

@Test func layoutKindNilForRailContractorAndNameOnlyStation() {
    #expect(stationLayoutKind(poi("코레일테크", "산업 > 건설,시공 > 시공업체 > 도로,철도시공", nil, lat: 36.33, lng: 127.43)) == nil)
    #expect(stationLayoutKind(poi("역전할머니맥주 길동역", "음식점 > 술집 > 호프,요리주점", nil, lat: 37.53, lng: 127.14)) == nil)
}

@Test func layoutKindRailForKTXStation() {
    #expect(stationLayoutKind(poi("서울역", "교통,수송 > 기차,철도 > 기차역 > KTX정차역", "1544-7788", lat: 37.5547, lng: 126.9707)) == .rail)
}

// MARK: 이름 키·검색어

@Test func stationNameKeyNormalizes() {
    #expect(stationNameKey("천호(풍납토성)") == "천호")
    #expect(stationNameKey("관악산역(서울대)") == "관악산")
    #expect(stationNameKey("시청.용인대역") == "시청용인대")
    #expect(stationNameKey("시청·용인대") == "시청용인대")
    #expect(stationNameKey("동대문역사문화공원역") == "동대문역사문화공원")
    #expect(stationNameKey("역삼역") == "역삼")
    #expect(stationNameKey("서울역") == "서울")
    #expect(stationNameKey("역") == "역")
}

@Test func stationPhoneQueryAppendsStationSuffixOnce() {
    #expect(stationPhoneQuery("천호(풍납토성)") == "천호역")
    #expect(stationPhoneQuery("서울역") == "서울역")
    #expect(stationPhoneQuery("시청·용인대") == "시청·용인대역")
}

// MARK: 노선 키

@Test func subwayLineIdentityMatchesAcrossProducers() {
    #expect(subwayLineIdentity("수도권 7호선") == subwayLineIdentity("7호선"))
    #expect(subwayLineIdentity("수도권 수인.분당선") == subwayLineIdentity("수인분당선"))
    #expect(subwayLineIdentity("수도권 9호선(급행)") == subwayLineIdentity("9호선"))
    #expect(subwayLineIdentity("부산 1호선") == subwayLineIdentity("부산1호선"))
    #expect(subwayLineIdentity("수도권 공항철도") == subwayLineIdentity("공항철도"))
    #expect(subwayLineIdentity("수도권 7호선") != nil)
}

@Test func subwayLineIdentitySeparatesSeoulAndIncheonLine1() {
    #expect(subwayLineIdentity("1호선") != subwayLineIdentity("인천1호선"))
}

@Test func subwayLineIdentityUnknownIsNil() {
    #expect(subwayLineIdentity("화성 트램") == nil)
}

// MARK: 대표번호

@Test func representativePhoneShape() {
    #expect(isRepresentativePhone("1544-7788"))
    #expect(isRepresentativePhone("1599-7788"))
    #expect(isRepresentativePhone("1588-7788"))
    #expect(isRepresentativePhone("1544-5005"))
    #expect(!isRepresentativePhone("02-6110-1281"))
    #expect(!isRepresentativePhone("031-8018-7750"))
    #expect(!isRepresentativePhone("1330"))
    #expect(!isRepresentativePhone("010-1234-5678"))
}

// MARK: pickStationPhone

@Test func pickDoesNotConfuseDongdaemunWithHistoryCulturePark() {
    let places = [
        poi("동대문역사문화공원역 2호선", subwayCat + "수도권2호선", "02-6110-2051", lat: 37.5657, lng: 127.0079),
        poi("동대문역 4호선", subwayCat + "수도권4호선", "02-6110-4211", lat: 37.5714, lng: 127.0098),
    ]
    #expect(pickStationPhone(places: places, stationName: "동대문", lat: 37.5714, lng: 127.0100, lineName: "수도권 2호선") == .unavailable)
    #expect(pickStationPhone(places: places, stationName: "동대문역사문화공원", lat: 37.5657, lng: 127.0080, lineName: "수도권 2호선") == .direct("02-6110-2051"))
}

@Test func pickUsesHintLineAtBupyeong() {
    let places = [
        poi("부평역 1호선", subwayCat + "수도권1호선", "032-528-1439", lat: 37.4895, lng: 126.7245),
        poi("부평역 인천1호선", subwayCat + "인천1호선", "032-515-9103", lat: 37.4906, lng: 126.7240),
    ]
    #expect(pickStationPhone(places: places, stationName: "부평", lat: 37.4894, lng: 126.7249, lineName: "수도권 1호선") == .direct("032-528-1439"))
    #expect(pickStationPhone(places: places, stationName: "부평", lat: 37.4894, lng: 126.7249, lineName: "인천 1호선") == .direct("032-515-9103"))
}

@Test func pickDoesNotFallBackToOtherLineWhenHintLineHasNoPhone() {
    let places = [
        poi("김포공항역 서해선", subwayCat + "서해선", nil, lat: 37.5622, lng: 126.8013),
        poi("김포공항역 9호선", subwayCat + "수도권9호선", "02-2656-0902", lat: 37.5616, lng: 126.8012),
    ]
    #expect(pickStationPhone(places: places, stationName: "김포공항", lat: 37.5620, lng: 126.8010, lineName: "수도권 서해선") == .unavailable)
}

@Test func pickPrefersPhonedPOIAmongSameLineDuplicates() {
    let places = [
        poi("김포공항역 9호선", subwayCat + "수도권9호선", nil, lat: 37.5620, lng: 126.8010, id: "kakao-2"),
        poi("김포공항역 9호선", subwayCat + "수도권9호선", "02-2656-0902", lat: 37.5616, lng: 126.8012),
    ]
    #expect(pickStationPhone(places: places, stationName: "김포공항", lat: 37.5620, lng: 126.8010, lineName: "수도권 9호선") == .direct("02-2656-0902"))
}

@Test func pickMarksRepresentativeNumbers() {
    let places = [
        poi("선릉역 수인분당선", subwayCat + "수인분당선", "1544-7788", lat: 37.5045, lng: 127.0490),
        poi("서면역 부산1호선", subwayCat + "부산1호선", "1544-5005", lat: 35.1578, lng: 129.0592),
    ]
    #expect(pickStationPhone(places: places, stationName: "선릉", lat: 37.5046, lng: 127.0492, lineName: "수도권 수인.분당선") == .representative("1544-7788"))
    #expect(pickStationPhone(places: places, stationName: "서면", lat: 35.1579, lng: 129.0593, lineName: "부산 1호선") == .representative("1544-5005"))
}

@Test func pickMatchesNameTailNotCategoryTail() {
    // 분류 끝은 "우이신설경전철"·"용인에버라인"이지만 이름 꼬리가 노선 표기다.
    let places = [
        poi("신설동역 우이신설선", subwayCat + "우이신설경전철", "02-3499-5561", lat: 37.5760, lng: 127.0250),
        poi("시청.용인대역 에버라인", subwayCat + "용인에버라인", "031-329-3573", lat: 37.2393, lng: 127.1889),
    ]
    #expect(pickStationPhone(places: places, stationName: "신설동", lat: 37.5760, lng: 127.0249, lineName: "수도권 우이신설선") == .direct("02-3499-5561"))
    #expect(pickStationPhone(places: places, stationName: "시청·용인대", lat: 37.2393, lng: 127.1889, lineName: "용인에버라인") == .direct("031-329-3573"))
}

@Test func pickRejectsSameNameStationFarAway() {
    let places = [poi("양평역 경의중앙선", subwayCat + "경의중앙선", "1544-7788", lat: 37.4926, lng: 127.4918)]
    // 5호선 양평(서울 영등포) 좌표에서 경의중앙선 노선으로 물어도 53km라 후보가 아니다.
    #expect(pickStationPhone(places: places, stationName: "양평", lat: 37.5260, lng: 126.8866, lineName: "경의중앙선") == .unavailable)
}

@Test func pickIgnoresExitAndNaverDuplicates() {
    let places = [
        poi("천호역 5호선 5번출구", subwayCat + "지하철출구", "02-0000-0000", lat: 37.5388, lng: 127.1235),
        poi("천호역 5호선", "교통,수송>지하철,전철", "02-1111-1111", lat: 37.5387, lng: 127.1234, id: "naver-local-9"),
    ]
    #expect(pickStationPhone(places: places, stationName: "천호", lat: 37.5387, lng: 127.1234, lineName: "수도권 5호선") == .unavailable)
}

@Test func pickUnknownLineIsUnavailable() {
    let places = [poi("천호역 5호선", subwayCat + "수도권5호선", "02-6311-5471", lat: 37.5387, lng: 127.1234)]
    #expect(pickStationPhone(places: places, stationName: "천호", lat: 37.5387, lng: 127.1234, lineName: "화성 트램") == .unavailable)
}

// MARK: 역무실 POI 우선(판정 ⑦)

private let stationOfficeCat = "교통,수송 > 기차,철도 > 기차역관리운영"

@Test func pickPrefersStationOfficePOIAtTransferStation() {
    // 실호출 게이트 사례: 환승역 역 POI "가락시장역 3호선"이 8호선 역무실 번호를 갖고, 3호선 번호는 역무실 POI에만 있다.
    let places = [
        poi("가락시장역 3호선", subwayCat + "수도권3호선", "02-6311-8171", lat: 37.4922, lng: 127.1177),
        poi("가락시장역 3호선 역무실", stationOfficeCat, "02-6110-3501", lat: 37.4928, lng: 127.1182, id: "kakao-3"),
    ]
    #expect(pickStationPhone(places: places, stationName: "가락시장", lat: 37.4922, lng: 127.1177, lineName: "수도권 3호선") == .direct("02-6110-3501"))
}

@Test func pickIgnoresStationOfficeOfOtherLine() {
    let places = [
        poi("가락시장역 8호선", subwayCat + "수도권8호선", "02-6311-8171", lat: 37.4922, lng: 127.1177),
        poi("가락시장역 3호선 역무실", stationOfficeCat, "02-6110-3501", lat: 37.4928, lng: 127.1182, id: "kakao-3"),
    ]
    #expect(pickStationPhone(places: places, stationName: "가락시장", lat: 37.4922, lng: 127.1177, lineName: "수도권 8호선") == .direct("02-6311-8171"))
}

@Test func pickFallsBackWhenStationOfficeHasNoPhone() {
    let places = [
        poi("가락시장역 3호선", subwayCat + "수도권3호선", "02-6311-8171", lat: 37.4922, lng: 127.1177),
        poi("가락시장역 3호선 역무실", stationOfficeCat, nil, lat: 37.4928, lng: 127.1182, id: "kakao-3"),
    ]
    #expect(pickStationPhone(places: places, stationName: "가락시장", lat: 37.4922, lng: 127.1177, lineName: "수도권 3호선") == .direct("02-6311-8171"))
}
