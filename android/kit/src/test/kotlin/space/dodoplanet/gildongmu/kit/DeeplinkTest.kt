package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** 지도 앱 딥링크(Kit `DeeplinkTests` 미러). */
class DeeplinkTest {
    private val gangnam = RouteDestination(lat = 37.4979, lng = 127.0276, name = "강남역")

    @Test fun naverRouteDeeplinkMirrorsWebFormat() {
        val s = assertNotNull(buildNaverRouteDeeplink(RouteMode.walk, gangnam, appname = "space.dodoplanet.gildongmu"))
        assertTrue(s.startsWith("nmap://route/walk?"))
        assertTrue(s.contains("dlat=37.4979") && s.contains("dlng=127.0276"))
        assertTrue(s.contains("appname=space.dodoplanet.gildongmu"))
        // 출발지 생략 = 현재 위치 출발(웹 계약)
        assertFalse(s.contains("slat="))
    }

    @Test fun kakaoRouteDeeplinkUsesOfficialByParams() {
        val s = assertNotNull(buildKakaoRouteDeeplink(RouteMode.publicTransit, gangnam))
        assertTrue(s.startsWith("kakaomap://route?"))
        assertTrue(s.contains("ep=37.4979,127.0276"))
        assertTrue(s.contains("by=publictransit"))
    }

    @Test fun outsideKoreaReturnsNil() {
        val paris = RouteDestination(lat = 48.85, lng = 2.35, name = "Paris")
        assertNull(buildNaverRouteDeeplink(RouteMode.car, paris, appname = "a"))
        assertNull(buildKakaoRouteDeeplink(RouteMode.car, paris))
        assertTrue(isInKorea(37.5, 127.0))
    }

    @Test fun kakaoPlaceDeeplinkAndWebFallback() {
        assertEquals("kakaomap://place?id=26338954", buildKakaoPlaceDeeplink("26338954"))
        val web = assertNotNull(buildKakaoWebRouteUrl(RouteMode.walk, gangnam))
        assertTrue(web.startsWith("https://map.kakao.com/link/by/walk/"))
        assertTrue(web.contains("37.4979"))
    }

    /** Swift `URLComponents`·`addingPercentEncoding`과 같은 인코딩: 한글·공백·`&`는 퍼센트, 쉼표는 그대로. */
    @Test fun encodingMatchesFoundation() {
        val dest = RouteDestination(lat = 37.4979, lng = 127.0276, name = "A&B 역")
        val naver = assertNotNull(buildNaverRouteDeeplink(RouteMode.walk, dest, appname = "a"))
        assertTrue(naver.contains("dname=A%26B%20%EC%97%AD&appname=a"), naver)
        val web = assertNotNull(buildKakaoWebRouteUrl(RouteMode.publicTransit, dest))
        assertEquals("https://map.kakao.com/link/by/traffic/A&B%20%EC%97%AD,37.4979,127.0276", web)
    }

    @Test fun routeModeRawValues() {
        assertEquals(listOf("walk", "public", "car", "bike"), RouteMode.entries.map { it.rawValue })
        assertEquals(RouteMode.publicTransit, RouteMode.fromRawValue("public"))
        assertNull(RouteMode.fromRawValue("publicTransit"))
    }
}
