package space.dodoplanet.gildongmu.settings

import space.dodoplanet.gildongmu.kit.InMemoryKeyValueStore
import space.dodoplanet.gildongmu.kit.TrendHaptics
import space.dodoplanet.gildongmu.kit.WalkHealth
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
        var invalidated = 0
        SettingsStore(mem, onLanguageChanged = { invalidated++ }).also { it.load() }.setLanguage("ja"); assertEquals(1, invalidated) // 저장이 곧 무효화
        s.setLanguage(null); assertNull(SettingsStore(mem).also { it.load() }.language.value) // 시스템 따름으로 복귀
        s.setLanguage("xx"); assertNull(s.language.value)
        mem.putString(SettingsStore.KEY_DICTATION, "weird"); assertEquals("tapToggle", SettingsStore(mem).also { it.load() }.dictationStyle.value)
        s.setDictationStyle("weird"); assertEquals("hold", s.dictationStyle.value) // 미지 값은 무시
        assertEquals("true", mem.getString(TrendHaptics.storageKey))
    }

    @Test fun `체중 — 범위 안은 저장(소수점 0은 정수로), 빈 값은 미입력으로, 범위 밖·잘못된 표기는 저장 없이 Reject(M4 걸음 요약과 같은 키)`() {
        val mem = InMemoryKeyValueStore(); val s = SettingsStore(mem).also { it.load() }
        assertEquals("", s.weightText.value)
        assertTrue(s.commitWeight("65.0") is WalkHealth.WeightCommitOutcome.Store); assertEquals("65", s.weightText.value); assertEquals("65", mem.getString(WalkHealth.weightStorageKey))
        assertTrue(s.commitWeight("62,5") is WalkHealth.WeightCommitOutcome.Store); assertEquals("62.5", mem.getString(WalkHealth.weightStorageKey))
        assertEquals(WalkHealth.WeightCommitOutcome.Reject, s.commitWeight("500")); assertEquals("62.5", s.weightText.value)
        assertEquals(WalkHealth.WeightCommitOutcome.Reject, s.commitWeight("abc")); assertEquals("62.5", mem.getString(WalkHealth.weightStorageKey))
        assertEquals(WalkHealth.WeightCommitOutcome.Clear, s.commitWeight(" ")); assertEquals("", s.weightText.value); assertEquals("", mem.getString(WalkHealth.weightStorageKey))
        assertEquals("62.5", SettingsStore(InMemoryKeyValueStore().also { it.putString(WalkHealth.weightStorageKey, "62.5") }).also { it.load() }.weightText.value)
    }
}
