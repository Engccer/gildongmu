package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * 복수형 해석기(A29). 웹 `i18n-plurals.test.ts`·Kit `LocalizationTests`와 같은 fixture로 분기 선택 규칙이
 * 한 벌임을 강제하고, 실카탈로그로 `formatLocalized`가 실제 문장을 내는지 본다. 지정자는 `%N$s`.
 */
class LocalizationTest {
    @Serializable
    private data class PluralCase(val lang: String, val n: Int, val category: String)

    @Test fun categoryRulesMatchSharedFixture() {
        val cases = Fixtures.sharedJson("plural-category-cases.json", ListSerializer(PluralCase.serializer()))
        assertTrue(cases.size >= 20)
        for (c in cases) assertEquals(c.category, pluralCategory(c.n, c.lang), "${c.lang} ${c.n}")
    }

    @Test fun unknownLanguageIsOther() {
        assertEquals("other", pluralCategory(1, "de"))
    }

    private val placeFormat = "{1, plural, one {%1\$s place} other {%1\$s places}}"

    @Test fun resolvesOneAndOther() {
        assertEquals("%1\$s place", resolvePluralBlocks(placeFormat, "en", listOf(1)))
        assertEquals("%1\$s places", resolvePluralBlocks(placeFormat, "en", listOf(2)))
        assertEquals("%1\$s places", resolvePluralBlocks(placeFormat, "en", listOf(0)))
        assertEquals("%1\$s place", resolvePluralBlocks(placeFormat, "fr", listOf(0)))
        assertEquals("%1\$s places", resolvePluralBlocks(placeFormat, "ko", listOf(1)))
    }

    @Test fun stringArgumentsStillSelectByParsedInteger() {
        assertEquals("%1\$s place", resolvePluralBlocks(placeFormat, "en", listOf("1")))
        assertEquals("%1\$s places", resolvePluralBlocks(placeFormat, "en", listOf("1,234")))
        assertEquals("%1\$s places", resolvePluralBlocks(placeFormat, "en", listOf("x")))
    }

    /** 수량 인자 누락은 호출부 결함이라 즉시 던진다(Swift DEBUG assertion 대응). */
    @Test fun missingPluralArgumentThrows() {
        assertFailsWith<IllegalArgumentException> { resolvePluralBlocks("{2, plural, one {a} other {b}}", "en", listOf(1)) }
        assertFailsWith<IllegalStateException> { formatLocalized("{1, plural, one {%1\$s a} other {%1\$s b}}", "en", emptyList()) }
    }

    @Test fun blockIndexIsIndependentOfPosition() {
        val format = "%1\$s, %2\$s ({3, plural, one {%3\$s device} other {%3\$s devices}})"
        assertEquals("%1\$s, %2\$s (%3\$s device)", resolvePluralBlocks(format, "en", listOf("north", "120m", 1)))
        assertEquals("north, 120m (1 device)", formatLocalized(format, "en", listOf("north", "120m", 1)))
    }

    @Test fun twoBlocksInOneString() {
        val format = "{1, plural, one {%1\$s disponible} other {%1\$s disponibles}} · {2, plural, one {%2\$s borne} other {%2\$s bornes}}"
        assertEquals("1 disponible · 12 bornes", formatLocalized(format, "fr", listOf(1, 12)))
        assertEquals("0 disponible · 1 borne", formatLocalized(format, "fr", listOf(0, 1)))
    }

    @Test fun literalBracesAndPercentSurvive() {
        assertEquals("{x} 3 100%", formatLocalized("{x} %1\$s 100%%", "en", listOf(3)))
        assertEquals("{1, select, a {b}}", resolvePluralBlocks("{1, select, a {b}}", "en", listOf(1)))
        assertEquals("{1, plural, one {a}}", resolvePluralBlocks("{1, plural, one {a}}", "en", listOf(1)))
    }

    @Test fun intArgumentsRenderLikeStringCount() {
        assertEquals("장소 3건", formatLocalized("장소 %1\$s건", "ko", listOf(3)))
        assertEquals("장소 3건", formatLocalized("장소 %1\$s건", "ko", listOf("3")))
        assertEquals("plain", formatLocalized("plain", "ko", emptyList()))
    }

    @Test fun realCatalogTransitBusSentence() {
        assertEquals("버스 정류소가 1곳 있습니다. X", kitLocalized("whereAmI.overview.transitBus", "ko", 1, "X"))
        assertEquals("There is 1 bus stop. X", kitLocalized("whereAmI.overview.transitBus", "en", 1, "X"))
        assertEquals("There are 3 bus stops. X", kitLocalized("whereAmI.overview.transitBus", "en", 3, "X"))
        assertEquals("Il y a 0 arrêt de bus. X", kitLocalized("whereAmI.overview.transitBus", "fr", 0, "X"))
        assertEquals("C'è 1 fermata dell'autobus. X", kitLocalized("whereAmI.overview.transitBus", "it", 1, "X"))
    }

    @Test fun missingKeyAndMissingLangFallBack() {
        assertEquals("no.such.key", kitLocalized("no.such.key", "ko"))
        assertEquals(kitLocalized("category.food", "ko"), kitLocalized("category.food", "de"))
    }
}
