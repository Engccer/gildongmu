package space.dodoplanet.gildongmu.settings

import space.dodoplanet.gildongmu.kit.InMemoryKeyValueStore
import space.dodoplanet.gildongmu.kit.TrendHaptics
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** spec §14-1·§14-2 — 순수 `localeOverride` 3분기, 설정 왕복·기본값·미지 값. */
class SettingsStoreTest {
    @Test fun `localeOverride — null·공백·미지 코드는 null, 지원 코드는 그대로`() {
        assertNull(localeOverride(null)); assertNull(localeOverride("")); assertNull(localeOverride("xx")); assertNull(localeOverride("zh"))
        assertEquals("ko", localeOverride("ko")); assertEquals("ja", localeOverride("ja"))
    }

    @Test fun `언어·받아쓰기·진동 왕복과 기본값, 미지 값은 기본`() {
        val mem = InMemoryKeyValueStore()
        val s = SettingsStore(mem).also { it.load() }
        assertNull(s.language.value); assertEquals("tapToggle", s.dictationStyle.value); assertFalse(s.resultHapticsEnabled.value)
        s.setLanguage("en"); s.setDictationStyle("hold"); s.setResultHaptics(true)
        val again = SettingsStore(mem).also { it.load() }
        assertEquals("en", again.language.value); assertEquals("hold", again.dictationStyle.value); assertTrue(again.resultHapticsEnabled.value)
        assertEquals("en", SettingsStore(mem).readLanguageSync())
        s.setLanguage(null); assertNull(SettingsStore(mem).also { it.load() }.language.value) // 시스템 따름으로 복귀
        s.setLanguage("xx"); assertNull(s.language.value)
        mem.putString(SettingsStore.KEY_DICTATION, "weird"); assertEquals("tapToggle", SettingsStore(mem).also { it.load() }.dictationStyle.value)
        s.setDictationStyle("weird"); assertEquals("hold", s.dictationStyle.value) // 미지 값은 무시
        assertEquals("true", mem.getString(TrendHaptics.storageKey))
    }
}
