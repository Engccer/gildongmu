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
 * 웹 정본과 같은 공유 fixture 셋(`final-approach-scenarios.json`·`presumed-arrival-scenarios.json`·
 * `brief-arrival-window-cases.json`)을 읽어 같은 경계표를 단언한다(Kit `FinalApproachTests` 미러).
 * `briefArrivalWindowMaxAccuracyMeters == carArrivalMaxAccuracyMeters` 단언은 GUIDE(`CarArrival`) 이식 때.
 */
class FinalApproachTest {
    private val mPerDegLat = 111_320.0
    private val mPerDegLng = 111_320.0 * cos(37.5 * PI / 180)
    private fun toPoint(v: List<Double>) = RoutePoint(37.5 + v[0] / mPerDegLat, 127.1 + v[1] / mPerDegLng)

    @Serializable
    private data class FixtureFile(val scenarios: List<Scenario>) {
        @Serializable
        data class Scenario(val name: String, val segments: List<List<Double>>, val dest: List<Double>, val expect: Expect)
        @Serializable
        data class Expect(val offsetMeters: Double? = null, val relativeBearing: Double? = null, val bearingUnavailable: String? = null, val direction: String? = null)
    }

    @Test fun `공유 fixture 동조`() {
        val scenarios = Fixtures.sharedJson("final-approach-scenarios.json", FixtureFile.serializer()).scenarios
        assertTrue(scenarios.isNotEmpty())
        for (s in scenarios) {
            val route = checkNotNull(buildGuideRoute(listOf(GuideStepGeometry("고정", s.segments.map(::toPoint))))) { "${s.name} 경로 조립" }
            val out = checkNotNull(computeFinalApproach(route, toPoint(s.dest))) { "${s.name} 기하" }
            s.expect.offsetMeters?.let { assertTrue(abs(out.offsetMeters - it) < 1.0, "${s.name} 오프셋") }
            s.expect.relativeBearing?.let { want ->
                val got = assertNotNull(out.relativeBearing, "${s.name} 상대각 존재")
                assertTrue(abs(got - want) < 1.0, "${s.name} 상대각")
            }
            s.expect.bearingUnavailable?.let {
                assertEquals(it, out.bearingUnavailable?.rawValue, "${s.name} 부재 사유")
                assertNull(out.relativeBearing, "${s.name} 상대각은 비어야 한다")
            }
            s.expect.direction?.let {
                val got = assertNotNull(out.relativeBearing, "${s.name} 상대각 존재")
                assertEquals(it, relativeDirection(got).rawValue, "${s.name} 방향")
            }
        }
    }

    @Test fun `4분할 경계 소유권 — 부등호까지 웹과 같다`() {
        val table = listOf(
            0.0 to RelativeDirection.ahead, 45.0 to RelativeDirection.ahead, 45.1 to RelativeDirection.right,
            -45.0 to RelativeDirection.ahead, -45.1 to RelativeDirection.left,
            135.0 to RelativeDirection.right, 135.1 to RelativeDirection.behind,
            -135.0 to RelativeDirection.left, -135.1 to RelativeDirection.behind,
            180.0 to RelativeDirection.behind, -180.0 to RelativeDirection.behind,
        )
        for ((theta, want) in table) assertEquals(want, relativeDirection(theta), "${theta}도")
    }

    @Serializable
    private data class PresumedFixtureFile(val stepScenarios: List<StepScenario>, val anchorScenarios: List<AnchorScenario>) {
        @Serializable
        data class StepScenario(val name: String, val profile: String, val input: Input, val expect: String? = null)
        @Serializable
        data class Input(val inFinalApproach: Boolean, val secondsSinceUsableFix: Double, val secondsSinceProgress: Double, val lastKnownDistanceToDestMeters: Double? = null)
        @Serializable
        data class AnchorScenario(val name: String, val epsilonMeters: Double, val steps: List<List<Double>>, val expectProgressedAt: List<Int>)
    }

    private fun thresholds(profile: String) = when (profile) {
        "walk" -> PresumedArrivalThresholds.walk
        "car" -> PresumedArrivalThresholds.car
        else -> error("미지 프로파일 $profile")
    }

    @Test fun `도착 추정 판정 공유 fixture 동조`() {
        val file = Fixtures.sharedJson("presumed-arrival-scenarios.json", PresumedFixtureFile.serializer())
        assertTrue(file.stepScenarios.isNotEmpty())
        for (s in file.stepScenarios) {
            val got = presumedArrivalStep(
                s.input.inFinalApproach, s.input.secondsSinceUsableFix, s.input.secondsSinceProgress,
                s.input.lastKnownDistanceToDestMeters, thresholds(s.profile),
            )
            assertEquals(s.expect, got?.rawValue, s.name)
        }
    }

    @Test fun `프로파일 car는 두절이 더 짧고 나머지는 같다`() {
        assertTrue(PresumedArrivalThresholds.car.noFixSeconds < PresumedArrivalThresholds.walk.noFixSeconds)
        assertEquals(PresumedArrivalThresholds.walk.stationarySeconds, PresumedArrivalThresholds.car.stationarySeconds)
        assertEquals(PresumedArrivalThresholds.walk.maxDistanceMeters, PresumedArrivalThresholds.car.maxDistanceMeters)
    }

    @Test fun `진행 앵커 공유 fixture 동조`() {
        val file = Fixtures.sharedJson("presumed-arrival-scenarios.json", PresumedFixtureFile.serializer())
        for (s in file.anchorScenarios) {
            var anchor: RoutePoint? = null
            val progressedAt = ArrayList<Int>()
            for ((i, step) in s.steps.withIndex()) {
                val out = advanceProgressAnchor(anchor, toPoint(step), s.epsilonMeters)
                anchor = out.anchor
                if (out.progressed) progressedAt.add(i)
            }
            assertEquals(s.expectProgressedAt, progressedAt, s.name)
        }
    }

    @Test fun `도착 추정 무효 입력은 null`() {
        val walk = PresumedArrivalThresholds.walk
        assertNull(presumedArrivalStep(true, -1.0, 0.0, 20.0, walk))
        assertNull(presumedArrivalStep(true, Double.NaN, 0.0, 20.0, walk))
        assertNull(presumedArrivalStep(true, 200.0, Double.POSITIVE_INFINITY, 20.0, walk))
        assertNull(presumedArrivalStep(true, 200.0, 0.0, -5.0, walk))
    }

    @Serializable
    private data class BriefWindowFixtureFile(val cases: List<Case>) {
        @Serializable
        data class Case(val name: String, val input: Input, val expect: Expect)
        @Serializable
        data class Input(val active: Boolean, val nearby: Boolean, val accuracy: Double)
        @Serializable
        data class Expect(val active: Boolean, val entered: Boolean, val exited: Boolean)
    }

    @Test fun `간략 창 자격 공유 fixture 동조`() {
        val cases = Fixtures.sharedJson("brief-arrival-window-cases.json", BriefWindowFixtureFile.serializer()).cases
        assertTrue(cases.isNotEmpty())
        for (c in cases) {
            assertEquals(
                BriefArrivalWindowStep(c.expect.active, c.expect.entered, c.expect.exited),
                briefArrivalWindowStep(c.input.active, c.input.nearby, c.input.accuracy), c.name,
            )
        }
    }

    @Test fun `NaN 정확도는 자격 없음`() {
        assertEquals(BriefArrivalWindowStep(false, false, true), briefArrivalWindowStep(true, true, Double.NaN))
    }
}
