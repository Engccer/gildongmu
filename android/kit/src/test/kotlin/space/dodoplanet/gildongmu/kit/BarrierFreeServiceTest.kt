package space.dodoplanet.gildongmu.kit

import kotlinx.coroutines.test.runTest
import java.io.IOException
import kotlin.test.Test
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * 무장애 여행 조회 — Kit `NearbyServiceQueryTests.barrierFreeNearbyRequestsFetchLimit` +
 * `BarrierFreeModelsTests.matchReturnsNilOnNetworkError`(foundation.json 유예분) 미러.
 */
class BarrierFreeServiceTest {
    @Test fun barrierFreeNearbyRequestsFetchLimit() = runTest {
        val t = StubTransport { HttpResponse(200, """{"places":[]}""") }
        BarrierFreeService(APIClient("https://example.test", t)).nearby(37.5, 127.0)
        assertTrue(t.lastQuery().has("limit", "50"))
    }

    /** 연결 실패 — match는 throw 대신 null로 수렴해야 한다(웹 계약). Swift는 닫힌 포트, 여기는 전송 예외. */
    @Test fun matchReturnsNilOnNetworkError() = runTest {
        val service = BarrierFreeService(APIClient("https://example.test", StubTransport { throw IOException("연결 거부") }))
        assertNull(service.match(37.5665986816, 126.9783710306, "존재하지않는장소"))
    }

    /** 디코딩 불가·비-2xx·`{"detail":null}`도 전부 null(비-throw 계약). 정상 응답은 fixture 그대로. */
    @Test fun matchCollapsesEveryFailureToNull() = runTest {
        suspend fun match(response: HttpResponse) =
            BarrierFreeService(APIClient("https://example.test", StubTransport { response })).match(37.5, 127.0, "서울도서관")
        assertNull(match(HttpResponse(200, "<html>")))
        assertNull(match(HttpResponse(429, """{"error":"rate"}""")))
        assertNull(match(HttpResponse(200, """{"detail":null}""")))
        val detail = assertNotNull(match(HttpResponse(200, Fixtures.kit("barrier-free-match.json"))))
        assertTrue(detail.facilities.isNotEmpty())
    }
}
