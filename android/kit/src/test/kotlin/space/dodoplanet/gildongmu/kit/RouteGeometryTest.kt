package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * 폴리라인 조립·접선 계약. Kit `RouteGuideTests`의 "폴리라인 접선" 스위트와 waypoint 인덱스 테스트를 옮겼다.
 * 리듀서 시나리오(`route-guide-scenarios.json` expect)는 `RouteGuideTest`가 든다 — 여기서는 그 fixture의 스텝 기하가
 * 조립·투영되는지만 본다.
 */
class RouteGeometryTest {
    private val mPerDegLat = 111_320.0
    private val mPerDegLng = 111_320.0 * cos(37.5 * PI / 180)
    private fun pt(along: Double, lateral: Double = 0.0) = RoutePoint(37.5 + along / mPerDegLat, 127.1 + lateral / mPerDegLng)

    private fun straight(len: Double = 100.0) = checkNotNull(buildGuideRoute(listOf(GuideStepGeometry("직진", listOf(pt(0.0), pt(len))))))

    @Test fun `직선은 진행 방위 시작 끝에서도 방위를 낸다`() {
        val s = straight()
        assertTrue(abs(tangentAt(s.polyline, 50.0, 15.0)!!) < 1)
        assertTrue(abs(tangentAt(s.polyline, 0.0, 15.0)!!) < 1)
        assertTrue(abs(tangentAt(s.polyline, 100.0, 15.0)!!) < 1)
    }

    @Test fun `앞뒤 점이 같으면 null`() {
        val degenerate = GuidePolyline(listOf(pt(0.0), pt(0.0)), listOf(0.0, 0.0))
        assertNull(tangentAt(degenerate, 0.0, 15.0))
    }

    @Test fun `직각으로 꺾이는 지점의 접선은 두 방위 사이`() {
        val corner = checkNotNull(buildGuideRoute(listOf(
            GuideStepGeometry("북", listOf(pt(0.0), pt(50.0))),
            GuideStepGeometry("동", listOf(pt(50.0), pt(50.0, 50.0))),
        )))
        val t = tangentAt(corner.polyline, 50.0, 15.0)!!
        assertTrue(t > 30 && t < 60, "$t")
    }

    @Test fun waypointIndexOutOfRangeRejectsRoute() {
        val steps = listOf(
            GuideStepGeometry("a", listOf(pt(0.0), pt(50.0))),
            GuideStepGeometry("b", listOf(pt(50.0), pt(100.0))),
        )
        assertNull(buildGuideRoute(steps, waypointStepIndex = 2))
        assertNull(buildGuideRoute(steps, waypointStepIndex = -1))
        assertEquals(0, buildGuideRoute(steps, waypointStepIndex = 0)?.waypointStepIndex)
        assertEquals(1, buildGuideRoute(steps, waypointStepIndex = 1)?.waypointStepIndex)
        assertNull(buildGuideRoute(steps)?.waypointStepIndex)
    }

    @Test fun `이음매가 벌어지면 fail-closed`() {
        assertNull(buildGuideRoute(listOf(
            GuideStepGeometry("a", listOf(pt(0.0), pt(50.0))),
            GuideStepGeometry("b", listOf(pt(60.0), pt(100.0))),
        )))
        assertNull(buildGuideRoute(emptyList()))
        assertNull(buildGuideRoute(listOf(GuideStepGeometry("빈", null))))
    }

    @Test fun `창 투영과 전역 후보`() {
        val s = straight(200.0)
        val p = projectOnPolyline(s.polyline, pt(80.0, 3.0), 0.0, 200.0)
        assertNotNull(p)
        assertTrue(abs(p.d - 80) < 1 && abs(p.perpMeters - 3) < 0.5, "$p")
        assertNull(projectOnPolyline(s.polyline, pt(80.0), 300.0, 400.0))
        assertEquals(1, globalCandidates(s.polyline, pt(80.0, 3.0), 10.0).size)
        assertEquals(0, globalCandidates(s.polyline, pt(80.0, 30.0), 10.0).size)
    }

    @Serializable
    private data class ScenarioFile(val scenarios: List<Scenario>) {
        @Serializable
        data class Scenario(val name: String, val steps: List<Step>)
        @Serializable
        data class Step(val len: Double, val desc: String, val action: String? = null)
    }

    /** 공유 fixture의 스텝 기하(남→북 직선 배치)가 전부 조립되고 총거리가 len 합과 같다. */
    @Test fun `공유 시나리오 기하가 조립된다`() {
        val scenarios = Fixtures.sharedJson("route-guide-scenarios.json", ScenarioFile.serializer()).scenarios
        assertTrue(scenarios.isNotEmpty())
        for (s in scenarios) {
            var along = 0.0
            val steps = s.steps.map { step ->
                val start = along
                along += step.len
                GuideStepGeometry(step.desc, listOf(pt(start), pt(along)), step.action?.let(WalkAction::fromRawValue))
            }
            val route = checkNotNull(buildGuideRoute(steps)) { s.name }
            // fixture 좌표 규약은 명목 111,320m/도이고 하버사인(R=6,371km)은 111,195m/도라 0.11% 차이가 정상이다.
            assertTrue(abs(route.totalMeters - along) < along * 0.002 + 0.5, "${s.name} 총거리 ${route.totalMeters} vs $along")
            assertEquals(s.steps.size, route.steps.size, s.name)
        }
    }
}
