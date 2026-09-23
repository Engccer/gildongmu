package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** 웹·Kit과 같은 공유 fixture(`stale-fix-age-cases.json`)를 읽어 같은 경계표를 단언한다(Kit `StaleOriginTests` 미러). */
class StaleOriginTest {
    @Serializable
    private data class FixtureFile(val ageCases: List<AgeCase>) {
        @Serializable
        data class AgeCase(val name: String, val ageSeconds: Double, val expect: Expect)
        @Serializable
        data class Expect(val unit: String, val count: Int)
    }

    private val fixture by lazy { Fixtures.sharedJson("stale-fix-age-cases.json", FixtureFile.serializer()) }

    private fun expected(e: FixtureFile.Expect): StaleFixAge? = when (e.unit) {
        "justNow" -> StaleFixAge.JustNow
        "minutes" -> StaleFixAge.Minutes(e.count)
        "hours" -> StaleFixAge.Hours(e.count)
        else -> null
    }

    @Test fun `시간 표현 공유 fixture 동조`() {
        assertTrue(fixture.ageCases.isNotEmpty())
        for (c in fixture.ageCases) assertEquals(expected(c.expect), staleFixAge(c.ageSeconds), c.name)
    }

    @Test fun `비유한 값은 옛 위치가 아니다`() {
        assertNull(staleFixAge(Double.NaN))
        assertNull(staleFixAge(Double.POSITIVE_INFINITY))
    }
}
