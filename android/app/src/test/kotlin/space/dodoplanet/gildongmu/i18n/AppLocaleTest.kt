package space.dodoplanet.gildongmu.i18n

import kotlin.test.Test
import kotlin.test.assertEquals

class AppLocaleTest {
    @Test fun `마커가 지원 언어면 그대로 아니면 ko`() {
        assertEquals("en", AppLocale.normalize("en"))
        assertEquals("ja", AppLocale.normalize("ja"))
        assertEquals("ko", AppLocale.normalize("de"))
        assertEquals("ko", AppLocale.normalize(null))
        assertEquals("ko", AppLocale.normalize(""))
    }

    @Test fun `dataLocale은 ko만 ko 나머지 전부 en`() {
        assertEquals("ko", AppLocale.dataLocaleOf("ko"))
        for (l in listOf("en", "es", "fr", "it", "ja")) assertEquals("en", AppLocale.dataLocaleOf(l), l)
    }

    @Test fun `resolveFormat은 formatLocalized를 지나 복수 블록과 위치 인자를 푼다`() {
        assertEquals("검색 결과 3건", AppLocale.resolveFormat("검색 결과 %1\$s건", "ko", listOf(3)))
        val en = "{1, plural, one {%1\$s result} other {%1\$s results}}"
        assertEquals("1 result", AppLocale.resolveFormat(en, "en", listOf(1)))
        assertEquals("2 results", AppLocale.resolveFormat(en, "en", listOf(2)))
        assertEquals("plain", AppLocale.resolveFormat("plain", "ko", emptyList()))
    }
}
