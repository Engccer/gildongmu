package space.dodoplanet.gildongmu.kit

import kotlinx.coroutines.test.runTest
import java.io.IOException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * 장소 영업시간 한 줄(E24). Kit에는 이 서비스 테스트가 없어 Swift 주석 계약을 단언한다: 도로명이 있을 때만 싣고,
 * 4초 예산을 전송에 넘기며, 어떤 실패도 null(비-throw).
 */
class PlaceHoursServiceTest {
    /** 예산까지 기록하는 전송 스텁(공용 `StubTransport`는 timeoutMs를 버린다). */
    private class RecordingTransport(private val response: () -> HttpResponse) : HttpTransport {
        val urls = mutableListOf<String>()
        val timeouts = mutableListOf<Long?>()
        override suspend fun get(url: String, timeoutMs: Long?): HttpResponse {
            urls.add(url); timeouts.add(timeoutMs)
            return response()
        }
    }

    @Test fun queryCarriesRoadAddressOnlyWhenPresentAndBudget() = runTest {
        val t = RecordingTransport { HttpResponse(200, """{"hours":{"ranges":[{"open":"09:00","close":"02:00","closesNextDay":true}],"allDay":false}}""") }
        val service = PlaceHoursService(APIClient("https://example.test", t))
        val hours = assertNotNull(service.today(37.5, 127.1, name = "봉래면옥", roadAddress = "명일로 1"))
        assertEquals(PlaceHoursToday(listOf(PlaceHoursToday.Range("09:00", "02:00", closesNextDay = true)), allDay = false), hours)
        val q = queryItemsOf(t.urls.last())
        assertEquals(listOf("lat" to "37.5", "lng" to "127.1", "name" to "봉래면옥", "roadAddress" to "명일로 1"), q)
        assertEquals(4_000L, t.timeouts.last())

        service.today(37.5, 127.1, name = "봉래면옥", roadAddress = "")
        assertFalse(queryItemsOf(t.urls.last()).hasName("roadAddress"))
    }

    /** 오늘 휴무(ranges 비고 allDay 거짓)는 null이 아니라 값이다. */
    @Test fun closedTodayIsAValue() = runTest {
        val service = PlaceHoursService(APIClient("https://example.test", RecordingTransport { HttpResponse(200, """{"hours":{"ranges":[],"allDay":false}}""") }))
        val hours = assertNotNull(service.today(37.5, 127.1, "a", ""))
        assertTrue(hours.ranges.isEmpty()); assertFalse(hours.allDay)
    }

    @Test fun everyFailureIsNull() = runTest {
        suspend fun today(response: () -> HttpResponse) =
            PlaceHoursService(APIClient("https://example.test", RecordingTransport(response))).today(37.5, 127.1, "a", "")
        assertNull(today { HttpResponse(200, """{"hours":null}""") })
        assertNull(today { HttpResponse(429, "") })
        assertNull(today { HttpResponse(200, "not-json") })
        assertNull(today { throw IOException("timeout") })
    }
}
