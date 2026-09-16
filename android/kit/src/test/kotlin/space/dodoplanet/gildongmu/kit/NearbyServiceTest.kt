package space.dodoplanet.gildongmu.kit

import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * 내 주변 조회 쿼리 계약 — Kit `NearbyServiceQueryTests`(limit 옵트인) + `RouteServiceQueryTests.stationAndNearbyLangEnRequestsLangParam`의
 * NearbyService 부분 미러. "더 보기" 재료는 limit=50을 옵트인 명시 요청해야 하고, 비대상 메서드는 오염되지 않아야 한다.
 */
class NearbyServiceTest {
    private fun service(body: String): Pair<NearbyService, StubTransport> {
        val transport = StubTransport { HttpResponse(200, body) }
        return NearbyService(APIClient("https://example.test", transport)) to transport
    }

    @Test fun kidsPlacesRequestsFetchLimit() = runTest {
        val (svc, t) = service("""{"kids":[]}""")
        svc.kidsPlaces(37.5, 127.0)
        assertTrue(t.lastQuery().has("limit", "50"))
    }

    @Test fun surroundingsRequestsFetchLimit() = runTest {
        val (svc, t) = service("""{"places":[]}""")
        svc.surroundings(37.5, 127.0)
        assertTrue(t.lastQuery().has("limit", "50"))
    }

    /** kids·around 동형(Swift 주석 계약 — Kit 테스트 없음). */
    @Test fun cultureEventsRequestsFetchLimit() = runTest {
        val (svc, t) = service("""{"events":[],"total":0}""")
        svc.cultureEvents(37.5, 127.0)
        assertTrue(t.lastQuery().has("limit", "50"))
        assertEquals("/api/events/nearby", pathOf(t.seenUrls.last()))
    }

    /** 대조: clinics는 limit 확장 대상이 아니다 — 오염 방지 단언. */
    @Test fun clinicsDoesNotRequestFetchLimit() = runTest {
        val (svc, t) = service("""{"clinics":[]}""")
        svc.clinics(37.5, 127.0)
        assertFalse(t.lastQuery().hasName("limit"))
    }

    /** E27: 비-ko만 `lang`을 싣는다. */
    @Test fun subwayArrivalsSendsLangOnlyForNonKorean() = runTest {
        val (svc, t) = service("""{"stations":[]}""")
        svc.subwayArrivals(37.5, 127.0, lang = "en")
        assertTrue(t.lastQuery().has("lang", "en"))
        val result = svc.subwayArrivals(37.5, 127.0, lang = "ko")
        assertFalse(t.lastQuery().hasName("lang"))
        assertTrue(result.stations.isEmpty()); assertNull(result.nearest)
    }

    /** cityCode는 source=="tago"일 때만 쿼리에 포함(웹 BusRouteStops.tsx 미러, Kit 테스트 없음). */
    @Test fun busRouteStopsSendsCityCodeOnlyForTago() = runTest {
        val (svc, t) = service("""{"stops":[]}""")
        svc.busRouteStops(source = "tago", cityCode = "25", routeId = "DJB30300004")
        assertEquals(listOf("source" to "tago", "routeId" to "DJB30300004", "cityCode" to "25"), t.lastQuery())
        svc.busRouteStops(source = "seoul", cityCode = "25", routeId = "100100118")
        assertFalse(t.lastQuery().hasName("cityCode"))
    }

    /** data:null은 조회 실패가 아니라 구성 결함 신호(null 반환, throw 아님). */
    @Test fun overviewAndSceneDataNullReturnsNull() = runTest {
        val (svc, _) = service("""{"data":null}""")
        assertNull(svc.nearbyOverview(37.5, 127.0))
        assertNull(svc.surroundingsScene(37.5, 127.0))
    }
}
