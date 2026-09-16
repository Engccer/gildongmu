package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** 웹 `bilingual-name.test.ts`·Kit `BilingualNameTests`와 같은 fixture — 규칙이 한 벌임을 강제. */
class BilingualNameTest {
    @Serializable
    private data class CaseFile(val cases: List<Case>) {
        @Serializable
        data class Case(
            val id: String, val locale: String, val ko: String, val en: String? = null, val roman: String? = null,
            val primary: String, val secondary: String? = null,
        )
    }

    private val cases by lazy { Fixtures.sharedJson("bilingual-name-cases.json", CaseFile.serializer()).cases }

    @Test fun fixtureIsNotEmpty() {
        assertTrue(cases.size >= 10)
    }

    @Test fun matchesSharedFixture() {
        for (c in cases) {
            val got = bilingualName(c.locale, c.ko, c.en, c.roman)
            assertEquals(c.primary, got.primary, "${c.id} primary")
            assertEquals(c.secondary, got.secondary, "${c.id} secondary")
        }
    }

    @Test fun displayIsOneLineParenthesis() {
        assertEquals("Seolleung (선릉역)", BilingualName("Seolleung", "선릉역").display)
        assertEquals("CU", BilingualName("CU", null).display)
    }

    @Test fun hasHangulMirrorsWeb() {
        assertTrue(hasHangul("강동성심병원"))
        assertTrue(hasHangul("ㄱ"))
        assertFalse(hasHangul("GS25"))
        assertFalse(hasHangul(""))
    }
}
