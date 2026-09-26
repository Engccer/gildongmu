package space.dodoplanet.gildongmu.settings

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import space.dodoplanet.gildongmu.i18n.AppLocale
import space.dodoplanet.gildongmu.kit.KeyValueStore
import space.dodoplanet.gildongmu.kit.ListenSpeed
import space.dodoplanet.gildongmu.kit.TrendHaptics
import space.dodoplanet.gildongmu.kit.WalkHealth

/** 저장값 → 언어 오버라이드 코드(순수, spec §14-2). null·공백·미지 코드는 null = 시스템 따름. 최상위 함수 — JVM 테스트가 `AppConfig`를 끌어오지 않는다. */
fun localeOverride(stored: String?): String? = stored?.takeIf { it in AppLocale.supported }

/** 테마 선택(iOS `ThemePreference` raw 값) → 다크 여부(순수). 미지 값은 시스템 따름. */
fun resolveDarkTheme(preference: String, systemDark: Boolean): Boolean = when (preference) {
    SettingsStore.THEME_LIGHT -> false
    SettingsStore.THEME_DARK -> true
    else -> systemDark
}

/**
 * 설정 값의 **단일 소유자**(spec §14-1, iOS `@AppStorage` 자리). 매체는 `SharedPreferencesStore` 기본 파일(최근 검색·수동 위치와 한 파일).
 * 첫 읽기 `load()`는 `MainActivity.attachBaseContext`가 동기로 부른다(첫 프레임이 옳은 언어여야 한다 — 파일 단위 로드 1회를 시작 경로 비용으로 수용).
 * 받아쓰기 키·값은 iOS `DictationStyle`과 같다(M6가 같은 키를 읽는다). 진동 키는 :kit `TrendHaptics.storageKey`.
 * 테마 키·값은 iOS `@AppStorage("themePreference")`(`system`·`light`·`dark`), 듣기 속도는 :kit `ListenSpeed.storageKey`(문자열 "1.5" — 도보 안내 발화도 같은 키를 읽는다).
 */
class SettingsStore(private val store: KeyValueStore, /** 언어 저장 직후(`AppConfig.localizedApp` 캐시 무효화 — 저장 행위에 묶어 두 번째 호출자가 빠뜨리지 못하게). */ private val onLanguageChanged: () -> Unit = {}) {
    private val _language = MutableStateFlow<String?>(null)
    /** null = 시스템 설정 따름. 값은 `AppLocale.supported` 안 코드만. */
    val language: StateFlow<String?> = _language.asStateFlow()

    private val _dictationStyle = MutableStateFlow(DICTATION_TAP)
    val dictationStyle: StateFlow<String> = _dictationStyle.asStateFlow()

    private val _resultHaptics = MutableStateFlow(false)
    val resultHapticsEnabled: StateFlow<Boolean> = _resultHaptics.asStateFlow()

    private val _theme = MutableStateFlow(THEME_SYSTEM)
    /** `THEME_SYSTEM`·`THEME_LIGHT`·`THEME_DARK`. `MainActivity`가 `resolveDarkTheme`로 즉시 반영한다. */
    val themePreference: StateFlow<String> = _theme.asStateFlow()

    private val _listenSpeed = MutableStateFlow(1.0)
    /** 채팅 듣기 배율(1·1.5·2). 재생기는 재생 시점에 읽는다(재생 중 변속 없음 — iOS 동형). */
    val listenSpeed: StateFlow<Double> = _listenSpeed.asStateFlow()

    private val _weightText = MutableStateFlow("")
    /** 체중 입력 원문(저장은 `WalkHealth.weightStorageKey` = M4 걸음 요약이 읽는 키, 빈 문자열 = 미입력). */
    val weightText: StateFlow<String> = _weightText.asStateFlow()

    /** 첫 읽기(멱등) — `MainActivity.attachBaseContext`가 동기로 부른다(언어가 첫 프레임에 필요). */
    fun load() {
        _language.value = localeOverride(store.getString(KEY_LANGUAGE))
        _dictationStyle.value = store.getString(KEY_DICTATION)?.takeIf { it == DICTATION_TAP || it == DICTATION_HOLD } ?: DICTATION_TAP
        _resultHaptics.value = store.getString(TrendHaptics.storageKey) == "true"
        _theme.value = store.getString(KEY_THEME)?.takeIf { it in THEMES } ?: THEME_SYSTEM
        _listenSpeed.value = ListenSpeed.normalizeSpeed(store.getString(ListenSpeed.storageKey)?.toDoubleOrNull())
        _weightText.value = store.getString(WalkHealth.weightStorageKey).orEmpty()
    }

    /** 체중 확정(A39 — 편집이 끝날 때, 멱등): 판정은 :kit `WalkHealth.weightCommit`. `Reject`는 저장·상태 무변경(호출자가 실패를 말한다, 3-state). */
    fun commitWeight(text: String): WalkHealth.WeightCommitOutcome {
        val outcome = WalkHealth.weightCommit(text)
        when (outcome) {
            is WalkHealth.WeightCommitOutcome.Store -> { val v = formatWeight(outcome.weight); _weightText.value = v; store.putString(WalkHealth.weightStorageKey, v) }
            WalkHealth.WeightCommitOutcome.Clear -> { _weightText.value = ""; store.putString(WalkHealth.weightStorageKey, "") }
            WalkHealth.WeightCommitOutcome.Reject -> Unit
        }
        return outcome
    }

    /** null·미지 코드는 "시스템 설정 따름"으로 저장(빈 문자열 = 없음, `KeyValueStore`에 삭제가 없다). */
    fun setLanguage(code: String?) {
        val value = localeOverride(code)
        _language.value = value
        store.putString(KEY_LANGUAGE, value ?: "")
        onLanguageChanged()
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

    fun setTheme(raw: String) {
        if (raw !in THEMES) return
        _theme.value = raw
        store.putString(KEY_THEME, raw)
    }

    /** 허용값 밖은 무시(선택지는 `ListenSpeed.allowedSpeeds`뿐이다). */
    fun setListenSpeed(speed: Double) {
        if (speed !in ListenSpeed.allowedSpeeds) return
        _listenSpeed.value = speed
        store.putString(ListenSpeed.storageKey, speed.toString())
    }

    companion object {
        const val KEY_LANGUAGE = "appLanguage"
        /** iOS `@AppStorage("themePreference")`. */
        const val KEY_THEME = "themePreference"
        const val THEME_SYSTEM = "system"
        const val THEME_LIGHT = "light"
        const val THEME_DARK = "dark"
        val THEMES = listOf(THEME_SYSTEM, THEME_LIGHT, THEME_DARK)
        /** iOS `DictationStyle.key`. */
        const val KEY_DICTATION = "dictationStyle"
        const val DICTATION_TAP = "tapToggle"
        const val DICTATION_HOLD = "hold"

        /** 65.0 → "65", 62.5 → "62.5"(iOS `formatWeight` 동형). */
        fun formatWeight(weight: Double): String = if (weight == Math.floor(weight)) weight.toLong().toString() else weight.toString()
    }
}
