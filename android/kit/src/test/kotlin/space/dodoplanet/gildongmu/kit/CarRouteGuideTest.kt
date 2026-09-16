package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.CarRoadLink
import space.dodoplanet.gildongmu.kit.models.CarRouteBriefing
import space.dodoplanet.gildongmu.kit.models.CarRouteGuide
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** 자동차 안내 기하 조립 — Kit `CarRouteGuideTests`·웹 `car-route-guide.test.ts` 미러(위도 1도 ≈ 111,320m 남→북 직선). */
class CarRouteGuideTest {
    private val meterLat = 1.0 / 111_320

    private fun pt(m: Double) = RoutePoint(37.5 + m * meterLat, 127.1)

    private val defaultGuides = listOf(
        CarRouteGuide(
            name = "", guidance = "직진 200m 이동", distanceMeters = 0, durationSeconds = 0,
            pathCoords = listOf(pt(0.0), pt(200.0)), roadLinks = listOf(CarRoadLink("올림픽로", 200.0)),
        ),
        CarRouteGuide(
            name = "", guidance = "우회전 후 300m 이동", distanceMeters = 0, durationSeconds = 0,
            pathCoords = listOf(pt(200.0), pt(350.0), pt(500.0)),
            roadLinks = listOf(CarRoadLink("천호대로", 150.0), CarRoadLink(null, 150.0)),
        ),
    )

    private fun briefing(guides: List<CarRouteGuide> = defaultGuides, terminal: RoutePoint? = null) = CarRouteBriefing(
        distanceMeters = 500, durationSeconds = 120, taxiFare = 5000, tollFare = 0, guides = guides, provider = "tmap", terminalCoord = terminal,
    )

    @Test fun `경로와 도로명 스팬을 조립한다`() {
        val out = assertNotNull(buildCarGuide(briefing()))
        assertEquals(2, out.route.steps.size)
        assertTrue(abs(out.route.totalMeters - 500) < 5)
        assertEquals(
            listOf(CarRoadSpan("올림픽로", 0.0, 200.0), CarRoadSpan("천호대로", 200.0, 350.0), CarRoadSpan(null, 350.0, 500.0)),
            out.roadSpans,
        )
    }

    @Test fun `기하 결손은 fail-closed`() {
        val guides = defaultGuides.toMutableList()
        guides[1] = CarRouteGuide(name = "", guidance = guides[1].guidance, distanceMeters = 0, durationSeconds = 0)
        assertNull(buildCarGuide(briefing(guides)))
    }

    @Test fun `비유한 좌표는 fail-closed`() {
        val guides = defaultGuides.toMutableList()
        guides[0] = guides[0].copy(pathCoords = listOf(pt(0.0), RoutePoint(Double.NaN, 127.1)))
        assertNull(buildCarGuide(briefing(guides)))
    }

    /** 종점 마커가 마지막 스텝 끝과 5m 초과 어긋나면 전체 null(§5 커버리지, 웹 미러). */
    @Test fun `종점 마커 불일치는 fail-closed`() {
        assertNull(buildCarGuide(briefing(terminal = pt(560.0))))
        assertNotNull(buildCarGuide(briefing(terminal = pt(500.0))))
    }

    @Test fun `도로명 스팬 불일치는 도로명만 강등한다`() {
        val guides = defaultGuides.toMutableList()
        guides[1] = guides[1].copy(roadLinks = listOf(CarRoadLink("천호대로", 30.0)))
        val out = assertNotNull(buildCarGuide(briefing(guides)))
        assertEquals(2, out.route.steps.size)
        assertTrue(out.roadSpans.isEmpty())
    }

    @Test fun `도로명은 포함 스팬에서 고른다`() {
        val spans = assertNotNull(buildCarGuide(briefing())).roadSpans
        assertEquals("올림픽로", roadNameAt(spans, 0.0))
        assertEquals("올림픽로", roadNameAt(spans, 199.0))
        assertEquals("천호대로", roadNameAt(spans, 200.0))
        assertNull(roadNameAt(spans, 400.0)) // 무명 링크
        assertNull(roadNameAt(spans, 501.0))
        assertNull(roadNameAt(emptyList(), 100.0))
    }

    @Test fun `기하 키 없는 브리핑도 디코딩된다`() {
        // 미지정 응답(기하 키 부재)·구버전 서버(provider 부재) 디코딩 호환.
        val json = """
            {"distanceMeters":1000,"durationSeconds":300,"taxiFare":5000,"tollFare":0,
             "guides":[{"name":"","guidance":"직진","distanceMeters":0,"durationSeconds":0}]}
        """.trimIndent()
        val b = KitJson.decodeFromString(CarRouteBriefing.serializer(), json)
        assertNull(b.provider)
        assertNull(b.guides[0].pathCoords)
        assertNull(b.guides[0].roadLinks)
    }
}
