package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.Place
import kotlin.test.Test
import kotlin.test.assertEquals

/** 웹 `category.test.ts`·`region.test.ts`·Kit `SearchFiltersTests`의 대표 케이스(기대값 재사용). */
class SearchFiltersTest {
    private fun place(id: String = "id", category: String = "", address: String = "", roadAddress: String = "") = Place(
        id = id, name = "name", category = category, address = address, roadAddress = roadAddress,
        englishAddress = null, lat = 37.5, lng = 127.0, phone = null, link = null, distanceMeters = null,
    )

    private val bucketCases = listOf(
        "여행 > 관광,명소 > 문화유적 > 고궁,궁" to "attraction",
        "여행 > 관광,명소 > 문화유적" to "attraction",
        "교통,수송 > 교통시설 > 주차장" to "transport",
        "교통,수송 > 지하철,전철 > 수도권3호선" to "transport",
        "음식점 > 한식 > 육류,고기" to "food",
        "음식점 > 카페 > 테마카페" to "food",
        "가정,생활 > 백화점" to "shopping",
        "여행 > 숙박 > 호텔" to "lodging",
        "교육,학문 > 학교 > 중학교" to "public",
        "사회,공공기관 > 지방행정기관 > 구청" to "public",
        "사회,공공기관 > 단체,협회 > 사회복지시설 > 장애인복지시설" to "public",
        "사회,복지 > 장애인복지시설" to "public",
        "부동산 > 빌딩" to "other",
        "스포츠,레저 > 스포츠시설 > 체육관" to "other",
        "문화,예술 > 사진 > 사진관,포토스튜디오 > 즉석사진 > 인생네컷" to "other",
        "문화,예술 > 미술,공예 > 가죽공예" to "other",
        "문화,예술 > 문화시설 > 미술관" to "attraction",
        "가정,생활 > 유아 > 놀이시설 > 키즈카페" to "other",
        "Tourist Attraction" to "attraction",
        "Cultural Facility" to "attraction",
        "Restaurant" to "food",
        "Shopping" to "shopping",
        "Accommodation" to "lodging",
        "관광지" to "attraction",
        "문화시설" to "attraction",
        "음식점" to "food",
        "" to "other",
    )

    @Test fun categoryBucketJudgesRepresentativeCases() {
        for ((category, expected) in bucketCases) {
            val single = listOf(place(id = "x", category = category))
            assertEquals(listOf(expected), bucketsPresent(single), category)
            assertEquals(listOf("x"), filterPlacesByBucket(single, expected).map { it.id }, category)
        }
    }

    @Test fun bucketsPresentReturnsOnlyExistingBucketsInOrder() {
        val places = listOf(
            place("1", category = "관광,명소>고궁"), place("2", category = "음식점>분식"), place("3", category = "교통,수송>지하철"),
        )
        assertEquals(listOf("attraction", "food", "transport"), bucketsPresent(places))
        assertEquals(emptyList(), bucketsPresent(emptyList()))
    }

    @Test fun filterPlacesByBucketNullReturnsAll() {
        val places = listOf(place("1", category = "관광,명소>고궁"), place("2", category = "음식점>분식"))
        assertEquals(2, filterPlacesByBucket(places, null).size)
    }

    @Test fun bucketLabelKoMirrorsMessages() {
        assertEquals("관광·명소", bucketLabel("attraction", "ko"))
        assertEquals("공공·교육", bucketLabel("public", "ko"))
        assertEquals("음식", bucketLabel("food", "ko"))
        assertEquals("쇼핑", bucketLabel("shopping", "ko"))
        assertEquals("숙박", bucketLabel("lodging", "ko"))
        assertEquals("교통", bucketLabel("transport", "ko"))
        assertEquals("기타", bucketLabel("other", "ko"))
        assertEquals("zzz", bucketLabel("zzz", "ko"))
    }

    private val regionCases = listOf(
        "경기 양평군 서종면 북한강로 992" to "gyeonggi",
        "제주특별자치도 서귀포시 칠십리로658번길 27-16" to "jeju",
        "서울 종로구 종로1길 50" to "seoul",
        "부산 수영구 구락로123번길 20" to "busan",
        "서울특별시 강남구 테헤란로" to "seoul",
        "경기도 성남시 분당구" to "gyeonggi",
        "강원특별자치도 춘천시" to "gangwon",
        "전북특별자치도 전주시" to "jeonbuk",
        "충청남도 천안시" to "chungnam",
        "세종특별자치시 한누리대로" to "sejong",
        "광주광역시 동구" to "gwangju",
        "경기 광주시 경안동" to "gyeonggi",
    )

    @Test fun regionJudgesRepresentativeCases() {
        for ((address, expected) in regionCases) {
            val single = listOf(place(id = "x", address = address))
            assertEquals(listOf(expected), regionsPresent(single), address)
            assertEquals(listOf("x"), filterPlacesByRegion(single, expected).map { it.id }, address)
        }
    }

    @Test fun regionUnmatchedAddressFallsIntoNoRegion() {
        for (address in listOf("", "해외 어딘가")) assertEquals(emptyList(), regionsPresent(listOf(place(id = "x", address = address))), address)
    }

    @Test fun regionFallsBackToRoadAddressWhenAddressEmpty() {
        assertEquals(listOf("busan"), regionsPresent(listOf(place(id = "x", address = "", roadAddress = "부산 해운대구 우동"))))
    }

    @Test fun regionsPresentReturnsStandardOrderDeduplicated() {
        val places = listOf(
            place("1", address = "서울 종로구 종로1길 50"), place("2", address = "경기 양평군 서종면"),
            place("3", address = "부산 수영구 구락로123번길 20"), place("4", address = "서울 강남구 테헤란로"),
            place("5", address = "해외 어딘가"),
        )
        assertEquals(listOf("seoul", "busan", "gyeonggi"), regionsPresent(places))
        assertEquals(emptyList(), regionsPresent(emptyList()))
    }

    @Test fun filterPlacesByRegionNullReturnsAll() {
        val places = listOf(place("1", address = "서울 종로구"), place("2", address = "부산 해운대구"))
        assertEquals(2, filterPlacesByRegion(places, null).size)
    }

    @Test fun regionLabelKoMirrorsMessages() {
        assertEquals("서울", regionLabel("seoul", "ko"))
        assertEquals("제주", regionLabel("jeju", "ko"))
        assertEquals("경북", regionLabel("gyeongbuk", "ko"))
    }

    @Test fun bucketAndRegionFiltersCombineWithAnd() {
        val places = listOf(
            place("seoul-food", category = "음식점>한식", address = "서울 종로구"),
            place("seoul-attraction", category = "관광,명소>고궁", address = "서울 종로구"),
            place("busan-food", category = "음식점>한식", address = "부산 해운대구"),
        )
        assertEquals(listOf("seoul-food"), filterPlacesByRegion(filterPlacesByBucket(places, "food"), "seoul").map { it.id })
    }
}
