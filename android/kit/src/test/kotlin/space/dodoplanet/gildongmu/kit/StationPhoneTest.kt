package space.dodoplanet.gildongmu.kit

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.Serializable
import space.dodoplanet.gildongmu.kit.models.Place
import space.dodoplanet.gildongmu.kit.models.TransitLegStop
import java.io.IOException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

// 역 장소 상세 개편(E44) 판정 계층 — Kit `StationPhoneTests.swift` 미러 + 서비스 계약·노선 표 드리프트.
// fixture 모양은 2026-09-17 실호출(설계 리뷰 18회) 응답에서 옮겼다. 번호는 실제 역 번호다(공개 정보).

private fun poi(name: String, category: String, phone: String?, lat: Double, lng: Double, id: String = "kakao-1") =
    Place(id = id, name = name, category = category, address = "", roadAddress = "", lat = lat, lng = lng, phone = phone)

private const val subwayCat = "교통,수송 > 지하철,전철 > "
private const val stationOfficeCat = "교통,수송 > 기차,철도 > 기차역관리운영"

class StationPhoneTest {
    // stationLayoutKind

    @Test fun layoutKindSubwayForKakaoStationPOI() {
        assertEquals(StationLayoutKind.subway, stationLayoutKind(poi("천호역 5호선", subwayCat + "수도권5호선", "02-6311-5471", 37.5387, 127.1234)))
    }

    @Test fun layoutKindSubwayForTransitStop() {
        val stop = TransitLegStop(name = "군자", stationId = "2544", lat = 37.557226, lng = 127.07954)
        assertEquals(StationLayoutKind.subway, stationLayoutKind(transitStopPlace(stop)))
    }

    @Test fun layoutKindNilForExitPOI() {
        assertNull(stationLayoutKind(poi("천호역 5호선 5번출구", subwayCat + "지하철출구", null, 37.5387, 127.1234)))
    }

    @Test fun layoutKindNilForNaverMergedStationPOI() {
        // 네이버 병합 역 POI는 분류가 "지하철,전철"에서 끝난다(번호도 없다).
        assertNull(stationLayoutKind(poi("판교역 신분당선", "교통,수송>지하철,전철", null, 37.3948, 127.1112, id = "naver-local-1")))
    }

    @Test fun layoutKindNilForRailContractorAndNameOnlyStation() {
        assertNull(stationLayoutKind(poi("코레일테크", "산업 > 건설,시공 > 시공업체 > 도로,철도시공", null, 36.33, 127.43)))
        assertNull(stationLayoutKind(poi("역전할머니맥주 길동역", "음식점 > 술집 > 호프,요리주점", null, 37.53, 127.14)))
    }

    @Test fun layoutKindRailForKTXStation() {
        assertEquals(StationLayoutKind.rail, stationLayoutKind(poi("서울역", "교통,수송 > 기차,철도 > 기차역 > KTX정차역", "1544-7788", 37.5547, 126.9707)))
    }

    /** Swift `split(separator:)`는 빈 조각을 버린다 — 끝 `>` 뒤 빈 조각이 "마지막 조각"이 되면 뭉개진 분류가 역으로 통과한다(이식 고유 단언). */
    @Test fun layoutKindSplitOmitsEmptySegmentsLikeSwift() {
        assertNull(stationLayoutKind(poi("판교역 신분당선", "교통,수송>지하철,전철>", null, 37.3948, 127.1112)))
    }

    // 이름 키·검색어

    @Test fun stationNameKeyNormalizes() {
        assertEquals("천호", stationNameKey("천호(풍납토성)"))
        assertEquals("관악산", stationNameKey("관악산역(서울대)"))
        assertEquals("시청용인대", stationNameKey("시청.용인대역"))
        assertEquals("시청용인대", stationNameKey("시청·용인대"))
        assertEquals("동대문역사문화공원", stationNameKey("동대문역사문화공원역"))
        assertEquals("역삼", stationNameKey("역삼역"))
        assertEquals("서울", stationNameKey("서울역"))
        assertEquals("역", stationNameKey("역"))
    }

    @Test fun stationPhoneQueryAppendsStationSuffixOnce() {
        assertEquals("천호역", stationPhoneQuery("천호(풍납토성)"))
        assertEquals("서울역", stationPhoneQuery("서울역"))
        assertEquals("시청·용인대역", stationPhoneQuery("시청·용인대"))
    }

    // 노선 키

    @Test fun subwayLineIdentityMatchesAcrossProducers() {
        assertEquals(subwayLineIdentity("7호선"), subwayLineIdentity("수도권 7호선"))
        assertEquals(subwayLineIdentity("수인분당선"), subwayLineIdentity("수도권 수인.분당선"))
        assertEquals(subwayLineIdentity("9호선"), subwayLineIdentity("수도권 9호선(급행)"))
        assertEquals(subwayLineIdentity("부산1호선"), subwayLineIdentity("부산 1호선"))
        assertEquals(subwayLineIdentity("공항철도"), subwayLineIdentity("수도권 공항철도"))
        assertNotNull(subwayLineIdentity("수도권 7호선"))
    }

    @Test fun subwayLineIdentitySeparatesSeoulAndIncheonLine1() {
        assertNotEquals(subwayLineIdentity("인천1호선"), subwayLineIdentity("1호선"))
    }

    @Test fun subwayLineIdentityUnknownIsNil() {
        assertNull(subwayLineIdentity("화성 트램"))
    }

    // 대표번호

    @Test fun representativePhoneShape() {
        assertTrue(isRepresentativePhone("1544-7788"))
        assertTrue(isRepresentativePhone("1599-7788"))
        assertTrue(isRepresentativePhone("1588-7788"))
        assertTrue(isRepresentativePhone("1544-5005"))
        assertFalse(isRepresentativePhone("02-6110-1281"))
        assertFalse(isRepresentativePhone("031-8018-7750"))
        assertFalse(isRepresentativePhone("1330"))
        assertFalse(isRepresentativePhone("010-1234-5678"))
    }

    // pickStationPhone

    @Test fun pickDoesNotConfuseDongdaemunWithHistoryCulturePark() {
        val places = listOf(
            poi("동대문역사문화공원역 2호선", subwayCat + "수도권2호선", "02-6110-2051", 37.5657, 127.0079),
            poi("동대문역 4호선", subwayCat + "수도권4호선", "02-6110-4211", 37.5714, 127.0098),
        )
        assertEquals(StationPhoneResult.Unavailable, pickStationPhone(places, "동대문", 37.5714, 127.0100, "수도권 2호선"))
        assertEquals(StationPhoneResult.Direct("02-6110-2051"), pickStationPhone(places, "동대문역사문화공원", 37.5657, 127.0080, "수도권 2호선"))
    }

    @Test fun pickUsesHintLineAtBupyeong() {
        val places = listOf(
            poi("부평역 1호선", subwayCat + "수도권1호선", "032-528-1439", 37.4895, 126.7245),
            poi("부평역 인천1호선", subwayCat + "인천1호선", "032-515-9103", 37.4906, 126.7240),
        )
        assertEquals(StationPhoneResult.Direct("032-528-1439"), pickStationPhone(places, "부평", 37.4894, 126.7249, "수도권 1호선"))
        assertEquals(StationPhoneResult.Direct("032-515-9103"), pickStationPhone(places, "부평", 37.4894, 126.7249, "인천 1호선"))
    }

    @Test fun pickDoesNotFallBackToOtherLineWhenHintLineHasNoPhone() {
        val places = listOf(
            poi("김포공항역 서해선", subwayCat + "서해선", null, 37.5622, 126.8013),
            poi("김포공항역 9호선", subwayCat + "수도권9호선", "02-2656-0902", 37.5616, 126.8012),
        )
        assertEquals(StationPhoneResult.Unavailable, pickStationPhone(places, "김포공항", 37.5620, 126.8010, "수도권 서해선"))
    }

    @Test fun pickPrefersPhonedPOIAmongSameLineDuplicates() {
        val places = listOf(
            poi("김포공항역 9호선", subwayCat + "수도권9호선", null, 37.5620, 126.8010, id = "kakao-2"),
            poi("김포공항역 9호선", subwayCat + "수도권9호선", "02-2656-0902", 37.5616, 126.8012),
        )
        assertEquals(StationPhoneResult.Direct("02-2656-0902"), pickStationPhone(places, "김포공항", 37.5620, 126.8010, "수도권 9호선"))
    }

    @Test fun pickMarksRepresentativeNumbers() {
        val places = listOf(
            poi("선릉역 수인분당선", subwayCat + "수인분당선", "1544-7788", 37.5045, 127.0490),
            poi("서면역 부산1호선", subwayCat + "부산1호선", "1544-5005", 35.1578, 129.0592),
        )
        assertEquals(StationPhoneResult.Representative("1544-7788"), pickStationPhone(places, "선릉", 37.5046, 127.0492, "수도권 수인.분당선"))
        assertEquals(StationPhoneResult.Representative("1544-5005"), pickStationPhone(places, "서면", 35.1579, 129.0593, "부산 1호선"))
    }

    @Test fun pickMatchesNameTailNotCategoryTail() {
        // 분류 끝은 "우이신설경전철"·"용인에버라인"이지만 이름 꼬리가 노선 표기다.
        val places = listOf(
            poi("신설동역 우이신설선", subwayCat + "우이신설경전철", "02-3499-5561", 37.5760, 127.0250),
            poi("시청.용인대역 에버라인", subwayCat + "용인에버라인", "031-329-3573", 37.2393, 127.1889),
        )
        assertEquals(StationPhoneResult.Direct("02-3499-5561"), pickStationPhone(places, "신설동", 37.5760, 127.0249, "수도권 우이신설선"))
        assertEquals(StationPhoneResult.Direct("031-329-3573"), pickStationPhone(places, "시청·용인대", 37.2393, 127.1889, "용인에버라인"))
    }

    @Test fun pickRejectsSameNameStationFarAway() {
        val places = listOf(poi("양평역 경의중앙선", subwayCat + "경의중앙선", "1544-7788", 37.4926, 127.4918))
        // 5호선 양평(서울 영등포) 좌표에서 경의중앙선 노선으로 물어도 53km라 후보가 아니다.
        assertEquals(StationPhoneResult.Unavailable, pickStationPhone(places, "양평", 37.5260, 126.8866, "경의중앙선"))
    }

    @Test fun pickIgnoresExitAndNaverDuplicates() {
        val places = listOf(
            poi("천호역 5호선 5번출구", subwayCat + "지하철출구", "02-0000-0000", 37.5388, 127.1235),
            poi("천호역 5호선", "교통,수송>지하철,전철", "02-1111-1111", 37.5387, 127.1234, id = "naver-local-9"),
        )
        assertEquals(StationPhoneResult.Unavailable, pickStationPhone(places, "천호", 37.5387, 127.1234, "수도권 5호선"))
    }

    @Test fun pickUnknownLineIsUnavailable() {
        val places = listOf(poi("천호역 5호선", subwayCat + "수도권5호선", "02-6311-5471", 37.5387, 127.1234))
        assertEquals(StationPhoneResult.Unavailable, pickStationPhone(places, "천호", 37.5387, 127.1234, "화성 트램"))
    }

    // 역무실 POI 우선(판정 ⑦)

    @Test fun pickPrefersStationOfficePOIAtTransferStation() {
        // 실호출 게이트 사례: 환승역 역 POI "가락시장역 3호선"이 8호선 역무실 번호를 갖고, 3호선 번호는 역무실 POI에만 있다.
        val places = listOf(
            poi("가락시장역 3호선", subwayCat + "수도권3호선", "02-6311-8171", 37.4922, 127.1177),
            poi("가락시장역 3호선 역무실", stationOfficeCat, "02-6110-3501", 37.4928, 127.1182, id = "kakao-3"),
        )
        assertEquals(StationPhoneResult.Direct("02-6110-3501"), pickStationPhone(places, "가락시장", 37.4922, 127.1177, "수도권 3호선"))
    }

    @Test fun pickIgnoresStationOfficeOfOtherLine() {
        val places = listOf(
            poi("가락시장역 8호선", subwayCat + "수도권8호선", "02-6311-8171", 37.4922, 127.1177),
            poi("가락시장역 3호선 역무실", stationOfficeCat, "02-6110-3501", 37.4928, 127.1182, id = "kakao-3"),
        )
        assertEquals(StationPhoneResult.Direct("02-6311-8171"), pickStationPhone(places, "가락시장", 37.4922, 127.1177, "수도권 8호선"))
    }

    @Test fun pickFallsBackWhenStationOfficeHasNoPhone() {
        val places = listOf(
            poi("가락시장역 3호선", subwayCat + "수도권3호선", "02-6311-8171", 37.4922, 127.1177),
            poi("가락시장역 3호선 역무실", stationOfficeCat, null, 37.4928, 127.1182, id = "kakao-3"),
        )
        assertEquals(StationPhoneResult.Direct("02-6311-8171"), pickStationPhone(places, "가락시장", 37.4922, 127.1177, "수도권 3호선"))
    }

    // 서비스 계약(Swift 주석 — 장소 트랙만·3초·ko·실패는 Failed). Kit에는 서비스 테스트가 없어 이식 고유 단언이다.

    private class RecordingTransport(private val response: () -> HttpResponse) : HttpTransport {
        val urls = mutableListOf<String>()
        val timeouts = mutableListOf<Long?>()
        override suspend fun get(url: String, timeoutMs: Long?): HttpResponse {
            urls.add(url); timeouts.add(timeoutMs)
            return response()
        }
    }

    @Test fun lookupCallsPlacesTrackOnlyInKoreanWithThreeSecondBudget() = runTest {
        val body = """{"places":[{"id":"kakao-1","name":"천호역 5호선","category":"교통,수송 > 지하철,전철 > 수도권5호선","address":"","roadAddress":"","lat":37.5387,"lng":127.1234,"phone":"02-6311-5471"}],"provider":"kakao","query":"천호역"}"""
        val t = RecordingTransport { HttpResponse(200, body) }
        val service = StationPhoneService(APIClient("https://example.test", t))
        assertEquals(StationPhoneResult.Direct("02-6311-5471"), service.lookup("천호(풍납토성)", 37.5387, 127.1234, "수도권 5호선"))
        assertEquals("/api/places", pathOf(t.urls.single()))
        assertEquals(listOf("query" to "천호역", "lat" to "37.5387", "lng" to "127.1234", "lang" to "ko"), queryItemsOf(t.urls.single()))
        assertEquals(3_000L, t.timeouts.single())
    }

    @Test fun lookupFailureIsFailedNotUnavailable() = runTest {
        val bad = StationPhoneService(APIClient("https://example.test", RecordingTransport { HttpResponse(502, """{"error":"x"}""") }))
        assertEquals(StationPhoneResult.Failed, bad.lookup("천호", 37.5387, 127.1234, "수도권 5호선"))
        val down = StationPhoneService(APIClient("https://example.test", RecordingTransport { throw IOException("timeout") }))
        assertEquals(StationPhoneResult.Failed, down.lookup("천호", 37.5387, 127.1234, "수도권 5호선"))
    }

    // 공유 fixture(웹·안드로이드가 같은 표로 잠긴다) — 노선 표 세 벌 대조는 웹 `station-phone-line-table-drift.test.ts`.

    @Serializable private data class LayoutCase(val note: String, val id: String, val category: String, val expected: String? = null)
    @Serializable private data class PhoneCase(val phone: String, val expected: Boolean)
    @Serializable private data class LayoutCases(val layoutKind: List<LayoutCase>, val representativePhone: List<PhoneCase>)

    @Test fun sharedLayoutAndRepresentativeCases() {
        val file = Fixtures.sharedJson("station-layout-cases.json", LayoutCases.serializer())
        assertTrue(file.layoutKind.isNotEmpty() && file.representativePhone.isNotEmpty())
        for (c in file.layoutKind) {
            assertEquals(c.expected, stationLayoutKind(poi("x", c.category, null, 37.5, 127.0, id = c.id))?.rawValue, c.note)
        }
        for (c in file.representativePhone) assertEquals(c.expected, isRepresentativePhone(c.phone), c.phone)
    }
}
