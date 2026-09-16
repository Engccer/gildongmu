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
}
