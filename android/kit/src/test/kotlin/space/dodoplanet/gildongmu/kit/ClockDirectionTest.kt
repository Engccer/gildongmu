package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** 웹 `clock-direction.test.ts`·Kit `ClockDirectionTests`와 같은 공유 fixture(`clock-direction-cases.json`). */
class ClockDirectionTest {
    @Serializable
    private data class CaseFile(val cases: List<Case>) {
        @Serializable
        data class Case(val reference: Double, val target: Double, val relative: Double, val hour: Int)
    }

    @Test fun clockDirectionSharedCases() {
        val cases = Fixtures.sharedJson("clock-direction-cases.json", CaseFile.serializer()).cases
        assertTrue(cases.size >= 15)
        for (c in cases) {
            val rel = relativeBearing(c.reference, c.target)
            assertTrue(rel >= 0 && rel < 360)
            assertTrue(abs(rel - c.relative) < 1e-6, "${c.reference}→${c.target}")
            assertEquals(c.hour, clockHour(rel), "${c.reference}→${c.target}")
        }
    }
}
