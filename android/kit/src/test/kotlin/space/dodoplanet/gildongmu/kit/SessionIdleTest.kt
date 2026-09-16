package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** 웹 정본과 같은 공유 fixture(`session-idle-scenarios.json`)를 읽는다 — Kit `SessionIdleTests` 미러. */
class SessionIdleTest {
    @Serializable
    private data class FixtureFile(val scenarios: List<Scenario>) {
        @Serializable
        data class Scenario(val name: String, val input: Input, val expect: String? = null)

        @Serializable
        data class Input(val secondsSinceUsableFix: Double, val secondsSinceProgress: Double? = null)
    }

    @Test fun `공유 fixture 동조`() {
        val scenarios = Fixtures.sharedJson("session-idle-scenarios.json", FixtureFile.serializer()).scenarios
        assertTrue(scenarios.isNotEmpty())
        for (s in scenarios) {
            val got = sessionIdleStep(s.input.secondsSinceUsableFix, s.input.secondsSinceProgress)
            assertEquals(s.expect, got?.rawValue, s.name)
        }
    }

    @Test fun `무효 입력은 null`() {
        assertNull(sessionIdleStep(-1.0, 0.0))
        assertNull(sessionIdleStep(Double.NaN, 0.0))
        assertNull(sessionIdleStep(0.0, Double.POSITIVE_INFINITY))
    }

    @Test fun `국면 무관 안전망은 도착 추정보다 모든 축이 느슨하다 — 두 프로파일`() {
        for (p in listOf(PresumedArrivalThresholds.walk, PresumedArrivalThresholds.car)) {
            assertTrue(sessionIdleNoFixSeconds > p.noFixSeconds)
            assertTrue(sessionIdleStationarySeconds > p.stationarySeconds)
        }
        assertTrue(sessionProgressEpsilonMeters > progressEpsilonMeters)
    }

    @Test fun `무이동 축이 없으면 두절 축만 산다`() {
        assertEquals(SessionIdleReason.noFix, sessionIdleStep(600.0, null))
        assertNull(sessionIdleStep(Double.NaN, null))
    }
}
