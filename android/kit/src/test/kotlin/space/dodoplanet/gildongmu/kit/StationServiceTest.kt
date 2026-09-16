package space.dodoplanet.gildongmu.kit

import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * 역 상세·환경 조회 — Kit `RouteServiceQueryTests.stationAndNearbyLangEnRequestsLangParam`의 StationService 부분 미러
 * + Swift 주석 계약(미커버 null ≠ 실패 throw, 혼잡도 area:null은 오류 아님).
 */
class StationServiceTest {
    private fun transport(response: HttpResponse) = StubTransport { response }

    @Test fun stationLangEnRequestsLangParam() = runTest {
        val t = transport(HttpResponse(200, """{"meta":null,"arrivals":null,"timetable":null,"facilities":null}"""))
        val station = StationService(APIClient("https://example.test", t))
        station.meta("강남", lang = "en")
        assertTrue(t.lastQuery().has("lang", "en"))
        assertTrue(t.lastQuery().has("station", "강남"))
        station.arrivals("강남", lang = "ko")
        assertFalse(t.lastQuery().hasName("lang"))
        station.timetable("강남", lang = "en")
        assertTrue(t.lastQuery().has("lang", "en"))
        station.metroFacilities("강남", lang = "en")
        assertTrue(t.lastQuery().has("lang", "en"))
        // 코레일 시설은 lang 계약이 없다.
        station.korailFacilities("서울")
        assertEquals(listOf("station" to "서울"), t.lastQuery())
    }

    /** 미커버 역은 본문 null(성공), 조회 실패는 throw — 시간표 실패를 미커버로 위장하지 않는다. */
    @Test fun uncoveredIsNullButFailureThrows() = runTest {
        val ok = StationService(APIClient("https://example.test", transport(HttpResponse(200, """{"timetable":null}"""))))
        assertNull(ok.timetable("동두천", lang = "ko"))
        val failing = StationService(APIClient("https://example.test", transport(HttpResponse(502, """{"error":"upstream"}"""))))
        assertFailsWith<APIError.BadStatus> { failing.timetable("동두천", lang = "ko") }
    }

    /** 혼잡도 `area: null`은 "서울 핫스팟이 아니다"라는 답이다(null 반환). 경로·좌표 쿼리 확인. */
    @Test fun conditionsPathsAndNullBodies() = runTest {
        val t = transport(HttpResponse(200, """{"air":null,"weather":null,"area":null}"""))
        val conditions = ConditionsService(APIClient("https://example.test", t))
        assertNull(conditions.air(37.5, 127.0))
        assertEquals("/api/air-quality/nearby", pathOf(t.seenUrls.last()))
        assertNull(conditions.weather(37.5, 127.0))
        assertEquals("/api/weather/nearby", pathOf(t.seenUrls.last()))
        assertNull(conditions.congestion(37.5, 127.0))
        assertEquals("/api/congestion/nearby", pathOf(t.seenUrls.last()))
        assertEquals(listOf("lat" to "37.5", "lng" to "127.0"), t.lastQuery())
    }
}
