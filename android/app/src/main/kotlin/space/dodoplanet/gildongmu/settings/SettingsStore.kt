package space.dodoplanet.gildongmu.settings

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import space.dodoplanet.gildongmu.i18n.AppLocale
import space.dodoplanet.gildongmu.kit.KeyValueStore
import space.dodoplanet.gildongmu.kit.TrendHaptics

/** 저장값 → 언어 오버라이드 코드(순수, spec §14-2). null·공백·미지 코드는 null = 시스템 따름. 최상위 함수 — JVM 테스트가 `AppConfig`를 끌어오지 않는다. */
fun localeOverride(stored: String?): String? = stored?.takeIf { it in AppLocale.supported }

/**
 * 설정 값의 **단일 소유자**(spec §14-1, iOS `@AppStorage` 자리). 매체는 `SharedPreferencesStore` 기본 파일(최근 검색·수동 위치와 한 파일).
 * 첫 읽기 `load()`는 `MainActivity.attachBaseContext`가 동기로 부른다(첫 프레임이 옳은 언어여야 한다 — 파일 단위 로드 1회를 시작 경로 비용으로 수용).
 * 받아쓰기 키·값은 iOS `DictationStyle`과 같다(M6가 같은 키를 읽는다). 진동 키는 :kit `TrendHaptics.storageKey`.
 */
class SettingsStore(private val store: KeyValueStore) {
    private val _language = MutableStateFlow<String?>(null)
    /** null = 시스템 설정 따름. 값은 `AppLocale.supported` 안 코드만. */
    val language: StateFlow<String?> = _language.asStateFlow()

    private val _dictationStyle = MutableStateFlow(DICTATION_TAP)
    val dictationStyle: StateFlow<String> = _dictationStyle.asStateFlow()

    private val _resultHaptics = MutableStateFlow(false)
    val resultHapticsEnabled: StateFlow<Boolean> = _resultHaptics.asStateFlow()

    /** `attachBaseContext`용 동기 읽기(언어 키). `load()`와 같은 값. */
    fun readLanguageSync(): String? = localeOverride(store.getString(KEY_LANGUAGE))

    /** 첫 읽기(멱등). */
    fun load() {
        _language.value = readLanguageSync()
        _dictationStyle.value = store.getString(KEY_DICTATION)?.takeIf { it == DICTATION_TAP || it == DICTATION_HOLD } ?: DICTATION_TAP
        _resultHaptics.value = store.getString(TrendHaptics.storageKey) == "true"
    }

    /** null·미지 코드는 "시스템 설정 따름"으로 저장(빈 문자열 = 없음, `KeyValueStore`에 삭제가 없다). */
    fun setLanguage(code: String?) {
        val value = localeOverride(code)
        _language.value = value
        store.putString(KEY_LANGUAGE, value ?: "")
    }

    fun setDictationStyle(raw: String) {
        if (raw != DICTATION_TAP && raw != DICTATION_HOLD) return
        _dictationStyle.value = raw
        store.putString(KEY_DICTATION, raw)
    }

    fun setResultHaptics(enabled: Boolean) {
        _resultHaptics.value = enabled
        store.putString(TrendHaptics.storageKey, enabled.toString())
    }

    companion object {
        const val KEY_LANGUAGE = "appLanguage"
        /** iOS `DictationStyle.key`. */
        const val KEY_DICTATION = "dictationStyle"
        const val DICTATION_TAP = "tapToggle"
        const val DICTATION_HOLD = "hold"
    }
}
