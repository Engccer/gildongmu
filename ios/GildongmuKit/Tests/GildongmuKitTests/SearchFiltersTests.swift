import Testing
import Foundation
@testable import GildongmuKit

// 웹 `src/lib/__tests__/category.test.ts`·`region.test.ts`의 대표 케이스를
// 그대로 옮긴다(기대값 재사용). 버킷 판정·지역 판정·AND 결합을 다룬다.

private func place(
    id: String = "id",
    name: String = "name",
    category: String = "",
    address: String = "",
    roadAddress: String = "",
    lat: Double = 37.5,
    lng: Double = 127.0
) -> Place {
    Place(
        id: id, name: name, category: category, address: address,
        roadAddress: roadAddress, englishAddress: nil, lat: lat, lng: lng,
        phone: nil, link: nil, distanceMeters: nil
    )
}

// MARK: - categoryOf (bucketsPresent/filterPlaces(bucket:) 경유로 간접 검증)

@Test(arguments: [
    ("여행 > 관광,명소 > 문화유적 > 고궁,궁", "attraction"),
    ("여행 > 관광,명소 > 문화유적", "attraction"),
    ("교통,수송 > 교통시설 > 주차장", "transport"),
    ("교통,수송 > 지하철,전철 > 수도권3호선", "transport"),
    ("음식점 > 한식 > 육류,고기", "food"),
    ("가정,생활 > 백화점", "shopping"),
    ("여행 > 숙박 > 호텔", "lodging"),
    ("교육,학문 > 학교 > 중학교", "other"),
    // 회귀: 카카오 최상위 "문화,예술"(사진관 등 비명소)이 단독 '문화' 키워드로
    // attraction에 잘못 묶였다(2026-07-20 "키자니아" 검색 실측 — 인생네컷이 관광·명소 섹션에)
    ("문화,예술 > 사진 > 사진관,포토스튜디오 > 즉석사진 > 인생네컷", "other"),
    ("Tourist Attraction", "attraction"),
    ("Cultural Facility", "attraction"),
    ("Restaurant", "food"),
    ("Shopping", "shopping"),
    ("Accommodation", "lodging"),
    ("관광지", "attraction"),
    ("문화시설", "attraction"),
    ("음식점", "food"),
    ("", "other"),
])
func categoryBucketJudgesRepresentativeCases(category: String, expectedBucket: String) {
    let single = [place(id: "x", category: category)]
    #expect(bucketsPresent(single) == [expectedBucket])
    #expect(filterPlaces(single, bucket: expectedBucket).map(\.id) == ["x"])
}

@Test func bucketsPresentReturnsOnlyExistingBucketsInOrder() {
    let places = [
        place(id: "1", category: "관광,명소>고궁"),
        place(id: "2", category: "음식점>분식"),
        place(id: "3", category: "교통,수송>지하철"),
    ]
    #expect(bucketsPresent(places) == ["attraction", "food", "transport"])
    #expect(bucketsPresent([]) == [])
}

@Test func filterPlacesByBucketNilReturnsAll() {
    let places = [place(id: "1", category: "관광,명소>고궁"), place(id: "2", category: "음식점>분식")]
    #expect(filterPlaces(places, bucket: nil).count == 2)
}

@Test func groupPlacesByBucketOrdersAndSkipsEmptyBuckets() {
    let places = [
        place(id: "kakao-역", category: "교통,수송 > 지하철,전철 > 3호선"),
        place(id: "tour-shop", category: "Shopping"),
        place(id: "kakao-궁", category: "여행 > 관광,명소 > 문화유적 > 고궁,궁"),
    ]
    let groups = groupPlacesByBucket(places)
    #expect(groups.map(\.bucket) == ["attraction", "shopping", "transport"])
}

@Test func groupPlacesByBucketPreservesInputOrderWithinBucket() {
    let places = [
        place(id: "kakao-궁", category: "여행 > 관광,명소 > 문화유적 > 고궁,궁"),
        place(id: "tour-palace", category: "Tourist Attraction"),
    ]
    let groups = groupPlacesByBucket(places)
    #expect(groups.count == 1)
    #expect(groups[0].places.map(\.id) == ["kakao-궁", "tour-palace"])
}

@Test func groupPlacesByBucketEmptyInputReturnsEmpty() {
    #expect(groupPlacesByBucket([]).isEmpty)
}

@Test func bucketLabelKoMirrorsMessages() {
    #expect(bucketLabel("attraction", lang: "ko") == "관광·명소")
    #expect(bucketLabel("food", lang: "ko") == "음식")
    #expect(bucketLabel("shopping", lang: "ko") == "쇼핑")
    #expect(bucketLabel("lodging", lang: "ko") == "숙박")
    #expect(bucketLabel("transport", lang: "ko") == "교통")
    #expect(bucketLabel("other", lang: "ko") == "기타")
}

// MARK: - regionOf (regionsPresent/filterPlaces(region:) 경유로 간접 검증)

@Test(arguments: [
    ("경기 양평군 서종면 북한강로 992", "gyeonggi"),
    ("제주특별자치도 서귀포시 칠십리로658번길 27-16", "jeju"),
    ("서울 종로구 종로1길 50", "seoul"),
    ("부산 수영구 구락로123번길 20", "busan"),
    ("서울특별시 강남구 테헤란로", "seoul"),
    ("경기도 성남시 분당구", "gyeonggi"),
    ("강원특별자치도 춘천시", "gangwon"),
    ("전북특별자치도 전주시", "jeonbuk"),
    ("충청남도 천안시", "chungnam"),
    ("세종특별자치시 한누리대로", "sejong"),
    ("광주광역시 동구", "gwangju"),
    ("경기 광주시 경안동", "gyeonggi"),
])
func regionJudgesRepresentativeCases(address: String, expectedRegion: String) {
    let single = [place(id: "x", address: address)]
    #expect(regionsPresent(single) == [expectedRegion])
    #expect(filterPlaces(single, region: expectedRegion).map(\.id) == ["x"])
}

@Test(arguments: ["", "해외 어딘가"])
func regionUnmatchedAddressFallsIntoNoRegion(address: String) {
    let single = [place(id: "x", address: address)]
    #expect(regionsPresent(single) == [])
}

@Test func regionFallsBackToRoadAddressWhenAddressEmpty() {
    let single = [place(id: "x", address: "", roadAddress: "부산 해운대구 우동")]
    #expect(regionsPresent(single) == ["busan"])
}

@Test func regionsPresentReturnsStandardOrderDeduplicated() {
    let places = [
        place(id: "1", address: "서울 종로구 종로1길 50"),
        place(id: "2", address: "경기 양평군 서종면"),
        place(id: "3", address: "부산 수영구 구락로123번길 20"),
        place(id: "4", address: "서울 강남구 테헤란로"),
        place(id: "5", address: "해외 어딘가"),
    ]
    #expect(regionsPresent(places) == ["seoul", "busan", "gyeonggi"])
    #expect(regionsPresent([]) == [])
}

@Test func filterPlacesByRegionNilReturnsAll() {
    let places = [place(id: "1", address: "서울 종로구"), place(id: "2", address: "부산 해운대구")]
    #expect(filterPlaces(places, region: nil).count == 2)
}

@Test func regionLabelKoMirrorsMessages() {
    #expect(regionLabel("seoul", lang: "ko") == "서울")
    #expect(regionLabel("jeju", lang: "ko") == "제주")
    #expect(regionLabel("gyeongbuk", lang: "ko") == "경북")
}

// MARK: - AND 결합 (버킷 → 지역, 웹 filterPlacesByRegion(filterPlacesByBucket(...)) 미러)

@Test func bucketAndRegionFiltersCombineWithAnd() {
    let places = [
        place(id: "seoul-food", category: "음식점>한식", address: "서울 종로구"),
        place(id: "seoul-attraction", category: "관광,명소>고궁", address: "서울 종로구"),
        place(id: "busan-food", category: "음식점>한식", address: "부산 해운대구"),
    ]
    let byBucketThenRegion = filterPlaces(filterPlaces(places, bucket: "food"), region: "seoul")
    #expect(byBucketThenRegion.map(\.id) == ["seoul-food"])
}
