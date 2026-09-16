package space.dodoplanet.gildongmu.nearby

import kotlinx.coroutines.test.runTest
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.kit.APIError
import space.dodoplanet.gildongmu.kit.ConditionsService
import space.dodoplanet.gildongmu.kit.Fixtures
import space.dodoplanet.gildongmu.kit.HttpResponse
import space.dodoplanet.gildongmu.kit.NearbyCoord
import space.dodoplanet.gildongmu.kit.models.AirPollutant
import space.dodoplanet.gildongmu.kit.pathOf
import space.dodoplanet.gildongmu.kit.stubbedClient
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

/** spec §12-1 conditions — 조각별 독립(`settled`), 실패 조각 직전 값 유지, 혼잡도 성공 null 덮어쓰기, 커버리지 마커 전체 throw, 통지 3분기. */
class ConditionsPayloadTest {
    private val coord = NearbyCoord(37.538, 127.137)
    private fun service(weather: HttpResponse, air: HttpResponse, congestion: HttpResponse) = ConditionsService(stubbedClient { url ->
        when (pathOf(url)) { "/api/weather/nearby" -> weather; "/api/air-quality/nearby" -> air; "/api/congestion/nearby" -> congestion; else -> HttpResponse(404, "") }
    })
    private val w = HttpResponse(200, Fixtures.kit("weather-nearby.json"))
    private val a = HttpResponse(200, Fixtures.kit("air-nearby.json"))
    private val c = HttpResponse(200, Fixtures.kit("congestion-nearby.json"))

    @Test fun `세 조각 독립 — 한 조각 실패는 null·fresh false, 나머지는 산다`() = runTest {
        val p = fetchConditions(service(HttpResponse(500, ""), a, c), coord, null)
        assertNull(p.weather); assertFalse(p.freshWeather)
        assertNotNull(p.air); assertTrue(p.freshAir); assertNotNull(p.congestion)
    }

    @Test fun `재조회 실패 조각은 직전 값 유지, 혼잡도 성공 null은 덮어쓴다(핫스팟 밖이 답)`() = runTest {
        val first = fetchConditions(service(w, a, c), coord, null)
        assertNotNull(first.weather); assertNotNull(first.congestion)
        val p = fetchConditions(service(HttpResponse(500, ""), a, HttpResponse(200, """{"area":null}""")), coord, first)
        assertEquals(first.weather, p.weather); assertFalse(p.freshWeather); assertTrue(p.freshAir)
        assertNull(p.congestion)
        val q = fetchConditions(service(w, a, HttpResponse(500, "")), coord, first)
        assertEquals(first.congestion, q.congestion)
    }

    @Test fun `어느 조각이든 커버리지 마커면 전체 throw(이중 방어)`() = runTest {
        val e = assertFailsWith<APIError> { fetchConditions(service(w, HttpResponse(200, """{"outOfCoverage":true}"""), c), coord, null) }
        assertSame(APIError.OutOfCoverage, e)
    }

    @Test fun `통지 3분기는 fresh 두 값만 본다`() {
        val base = ConditionsPayload(null, null, null, freshWeather = true, freshAir = true)
        assertEquals("ready", conditionsNotice(base, "ready", "partial", "failed"))
        assertEquals("partial", conditionsNotice(base.copy(freshAir = false), "ready", "partial", "failed"))
        assertEquals("failed", conditionsNotice(base.copy(freshWeather = false, freshAir = false), "ready", "partial", "failed"))
    }

    @Test fun `매핑표 미지 값 — 하늘·강수는 weather_unknown, 공기질 등급은 airQuality_unknown(원문 폴백 금지), 혼잡도는 null(원문)`() {
        assertEquals(R.string.weather_unknown, skyResId("fog")); assertEquals(R.string.weather_sky_clear, skyResId("clear"))
        assertEquals(R.string.weather_unknown, precipResId("hail")); assertEquals(R.string.android_nearby_rainSnow, precipResId("rainSnow"))
        assertEquals(R.string.airQuality_unknown, gradeResId("hazardous")); assertEquals(R.string.airQuality_grade_veryBad, gradeResId("veryBad"))
        assertNull(levelResId("매우 붐빔")); assertEquals(R.string.congestion_levels_busy, levelResId("붐빔"))
    }

    @Test fun `수치 표기·오염도 문장(등급 정본 + 수치 보강)`() {
        assertEquals("31", numberText(31.0)); assertEquals("24.2", numberText(24.2)); assertEquals("0.3", numberText(0.3))
        assertEquals("초미세먼지, 좋음 (12)", pollutantText("초미세먼지", AirPollutant(12.0, "good")) { "좋음" })
        assertEquals("초미세먼지, 좋음", pollutantText("초미세먼지", AirPollutant(null, "good")) { "좋음" })
    }

    @Test fun `conditions 조립기 — 항상 본문·착지 날씨 헤딩·previous 전달`() = runTest {
        val strings = testNearbyStrings()
        val spec = NearbyKinds.conditions(service(w, a, c), strings)
        val p = spec.fetch(coord, null)
        assertFalse(spec.isEmpty(p)); assertEquals("conditions-weather", spec.firstKey(p)); assertNull(spec.emptyCopy)
        assertEquals("날씨와 공기질을 확인했습니다", spec.loadedNotice(p))
        val again = NearbyKinds.conditions(service(HttpResponse(500, ""), HttpResponse(500, ""), c), strings).fetch(coord, p)
        assertEquals(p.weather, again.weather); assertEquals("정보를 가져오지 못했습니다", spec.loadedNotice(again))
    }
}
