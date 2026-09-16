package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** 웹 정본과 같은 공유 fixture(`end-screen-stale-cases.json`)를 읽는다 — Kit `EndScreenTests` 미러. */
class EndScreenTest {
    @Serializable
    private data class FixtureFile(val cases: List<Case>) {
        @Serializable
        data class Case(val name: String, val secondsSinceEnd: Double, val expect: Boolean)
    }

    @Test fun `종료 화면 수명 공유 fixture 동조`() {
        val cases = Fixtures.sharedJson("end-screen-stale-cases.json", FixtureFile.serializer()).cases
        assertTrue(cases.isNotEmpty())
        for (c in cases) assertEquals(c.expect, isEndScreenStale(c.secondsSinceEnd), c.name)
    }

    @Test fun `NaN·무한은 소거하지 않는다`() {
        assertFalse(isEndScreenStale(Double.NaN))
        assertFalse(isEndScreenStale(Double.POSITIVE_INFINITY))
    }
}
