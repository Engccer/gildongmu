# 안드로이드 설정 화면(§14) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 탭 루트 4개의 상단 바 "설정" 버튼 → 설정 화면(언어·받아쓰기 방식·결과 진동(실험판)·정보 출처·개인정보 처리방침·문제 신고)을 iOS `SettingsView` 미러로 세우고, 앱 언어 오버라이드(`createConfigurationContext` 한 경로 + 호출 시점 `localizedApp()`)와 결과 진동 채널(`Notice.haptic` → `StatusLine`)을 붙인다.

**Architecture:** `settings/` 패키지(이 세션 소유)에 `SettingsStore`(단일 소유자, `KeyValueStore` 뒤)·순수 `localeOverride`·`settingsRows`·화면 2개·`SettingsAction`. 언어는 `AppConfig.localized(base)`/`localizedApp()` 한 경로, ViewModel 문장 팩토리 6곳은 `() -> Resources`로 호출 시점 읽기. 진동은 `a11y/Notice.haptic` + `LocalResultHaptics`(a11y 정의, `AppRoot` 제공) + `StatusLine` 발화 효과 안. 선택 목록은 `AlertDialog`(라우트 없음, `LocalModalOpen` 제공).

**Tech Stack:** Kotlin, Jetpack Compose(Material3 `AlertDialog`·`Switch`·`selectableGroup`), `navigation-compose`, `SharedPreferences`, JUnit5(JVM)·Compose UI test(ATF).

**Spec:** `docs/superpowers/specs/2026-09-16-android-m2-place-nearby-design.md` §14(판정 39~43, 설계 리뷰 5차 확정) + §13-5(앱 통지 소유자·haptic 규칙) + §3-1(상단 바 순서 규칙) + §4(권한 자리 셋).

## Global Constraints

- 소유권: `settings/`(신설)·`a11y/`·`i18n/`·`nav/`·`storage/`·`MainActivity`·`AppConfig`·`android/i18n/android-extra/`·`android/scripts/`는 이 세션. `directions/`(M3 종료로 이 세션)·`chat/`(M6 소유 — **additive 한 줄 수준만**, 보고). `ios/**`·`src/**`·`packages/**`·`docs/BACKLOG.md`·`PROGRESS.md` 수정 금지.
- 신설 문자열 키 **1**: `android.settings.resultHapticsFooter`(android-extra 6로케일, iOS 키 없음 → 드리프트 검사 밖). 그 밖 전부 실재 키(§14 머리 목록). 수입된 `android.settings.trendHapticsFooter`는 쓰지 않는다.
- `createConfigurationContext` 호출은 `AppConfig.kt` 한 곳. `performHapticFeedback` 호출 파일은 `A11y.kt` 하나. `applicationContext` 참조는 `AppConfig.kt`와 `SharedPreferencesStore(app…)` 인자뿐. `Scaffold(` 직접 호출 0, 착지 부착은 `landingTarget`/`mergedRow(focus)`뿐, `getIdentifier(` 0.
- 커밋: pathspec만(`git add -A` 금지), 한국어 메시지 + `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. `origin` push 금지(2026-09-22 09:00 KST까지).
- 게이트(락): `until mkdir ~/gildongmu-wt/gate.lock 2>/dev/null; do sleep 30; done` → `cd android && export ANDROID_HOME=~/Library/Android/sdk && ./gradlew :kit:test :app:testDebugUnitTest :app:assembleDebug :app:assembleExperimental :app:compileDebugAndroidTestKotlin` → `./gradlew --stop` → `VITEST_MAX_THREADS=2 npm run test:run`(기지 실패 1 `xcstrings-plural` xcrun) → `rmdir ~/gildongmu-wt/gate.lock`.
- 실행 방식: **inline**(과제들이 `AppConfig.kt`·`A11y.kt`·`AppRoot.kt`·`MainActivity.kt`를 함께 만지고 1 → 2 → 3 → 4 → 5 순 의존).

---

### Task 1: `SettingsStore` + 순수 `localeOverride` + 로케일 오버라이드 한 경로

**Files:**
- Create: `android/app/src/main/kotlin/space/dodoplanet/gildongmu/settings/SettingsStore.kt`
- Modify: `AppConfig.kt`(`settings`·`localized`·`localizedApp`·`resultHapticsSettingEnabled`), `MainActivity.kt`(`attachBaseContext`), `storage/SharedPreferencesStore.kt`(기본 파일 `gildongmu`, KDoc), `i18n/AppLocale.kt`(KDoc)
- Test: `test/.../settings/SettingsStoreTest.kt`, `test/.../nav/AppSourceGuardTest.kt`(가드 2종)

**Interfaces (Produces):**
```kotlin
/** 최상위 순수 함수 — 저장값 → 오버라이드 코드. null·공백·미지 코드는 null(시스템 따름). */
fun localeOverride(stored: String?): String?
class SettingsStore(store: KeyValueStore) {
    val language: StateFlow<String?>; val dictationStyle: StateFlow<String>; val resultHapticsEnabled: StateFlow<Boolean>
    fun load()                                   // 첫 읽기 — IO 또는 attachBaseContext(언어 키만 동기, 아래)
    fun readLanguageSync(): String?              // attachBaseContext용(파일 단위 로드 1회 수용)
    fun setLanguage(code: String?); fun setDictationStyle(raw: String); fun setResultHaptics(enabled: Boolean)
    companion object { const val KEY_LANGUAGE = "appLanguage"; const val KEY_DICTATION = "dictationStyle"; const val DICTATION_TAP = "tapToggle"; const val DICTATION_HOLD = "hold" }
}
// AppConfig
val settings: SettingsStore
val resultHapticsSettingEnabled: Boolean = BuildConfig.EXPERIMENTAL
fun localized(base: Context): Context
fun localizedApp(): Context               // @Volatile 캐시, setLanguage가 무효화
```

- [ ] **Step 1: 실패 테스트** — `SettingsStoreTest`: `localeOverride(null/""/"xx"/"ko"/"ja")` 3분기 · 왕복(`setLanguage("en")` → 새 인스턴스 `load()` 뒤 `language.value == "en"`) · 받아쓰기 기본 `tapToggle`·`setDictationStyle("hold")` 왕복·미지 값은 기본 · 진동 기본 false·왕복. 가드: `createConfigurationContext(`는 `AppConfig.kt`에서만; `SharedPreferencesStore(` 기본 파일 이름 `"gildongmu"`.
```kotlin
class SettingsStoreTest {
    @Test fun `localeOverride — null·공백·미지 코드는 null, 지원 코드는 그대로`() {
        assertNull(localeOverride(null)); assertNull(localeOverride("")); assertNull(localeOverride("xx")); assertNull(localeOverride("zh"))
        assertEquals("ko", localeOverride("ko")); assertEquals("ja", localeOverride("ja"))
    }
    @Test fun `언어·받아쓰기·진동 왕복과 기본값`() {
        val mem = InMemoryKeyValueStore(); val s = SettingsStore(mem).also { it.load() }
        assertNull(s.language.value); assertEquals("tapToggle", s.dictationStyle.value); assertFalse(s.resultHapticsEnabled.value)
        s.setLanguage("en"); s.setDictationStyle("hold"); s.setResultHaptics(true)
        val again = SettingsStore(mem).also { it.load() }
        assertEquals("en", again.language.value); assertEquals("hold", again.dictationStyle.value); assertTrue(again.resultHapticsEnabled.value)
        mem.putString(SettingsStore.KEY_DICTATION, "weird"); assertEquals("tapToggle", SettingsStore(mem).also { it.load() }.dictationStyle.value)
        assertEquals("en", SettingsStore(mem).readLanguageSync())
    }
}
```
- [ ] **Step 2: FAIL 확인** — `./gradlew -q :app:testDebugUnitTest --tests '*SettingsStoreTest*'`
- [ ] **Step 3: 구현**
```kotlin
// settings/SettingsStore.kt
fun localeOverride(stored: String?): String? = stored?.takeIf { it in AppLocale.supported }

/** 설정 값의 단일 소유자(spec §14-1). 매체는 `SharedPreferencesStore` 기본 파일(최근 검색·수동 위치와 한 파일). */
class SettingsStore(private val store: KeyValueStore) {
    private val _language = MutableStateFlow<String?>(null); val language: StateFlow<String?> = _language.asStateFlow()
    private val _dictationStyle = MutableStateFlow(DICTATION_TAP); val dictationStyle: StateFlow<String> = _dictationStyle.asStateFlow()
    private val _resultHaptics = MutableStateFlow(false); val resultHapticsEnabled: StateFlow<Boolean> = _resultHaptics.asStateFlow()
    fun readLanguageSync(): String? = localeOverride(store.getString(KEY_LANGUAGE))
    fun load() {
        _language.value = readLanguageSync()
        _dictationStyle.value = store.getString(KEY_DICTATION)?.takeIf { it == DICTATION_TAP || it == DICTATION_HOLD } ?: DICTATION_TAP
        _resultHaptics.value = store.getString(TrendHaptics.storageKey) == "true"
    }
    fun setLanguage(code: String?) { val v = localeOverride(code); _language.value = v; store.putString(KEY_LANGUAGE, v ?: "") }
    fun setDictationStyle(raw: String) { if (raw != DICTATION_TAP && raw != DICTATION_HOLD) return; _dictationStyle.value = raw; store.putString(KEY_DICTATION, raw) }
    fun setResultHaptics(enabled: Boolean) { _resultHaptics.value = enabled; store.putString(TrendHaptics.storageKey, enabled.toString()) }
    companion object { const val KEY_LANGUAGE = "appLanguage"; const val KEY_DICTATION = "dictationStyle"; const val DICTATION_TAP = "tapToggle"; const val DICTATION_HOLD = "hold" }
}
```
`AppConfig`:
```kotlin
val settings: SettingsStore by lazy { SettingsStore(SharedPreferencesStore(app)) }
val resultHapticsSettingEnabled: Boolean = BuildConfig.EXPERIMENTAL
/** 로케일 오버라이드 컨텍스트(spec §14-2 판정 39) — `createConfigurationContext` 호출은 이 파일 한 곳. */
fun localized(base: Context): Context {
    val code = localeOverride(settings.language.value) ?: return base
    val config = Configuration(base.resources.configuration).apply { setLocales(LocaleList(Locale.forLanguageTag(code))) }
    return base.createConfigurationContext(config)
}
@Volatile private var localizedAppCache: Context? = null
/** ViewModel 문장·dataLocale·시각 포맷의 리소스 — 호출 시점에 읽는다(캡처 금지). 문자열·시각 포맷만 읽을 것(로케일 밖 구성 축은 스냅샷). */
fun localizedApp(): Context = localizedAppCache ?: localized(app).also { localizedAppCache = it }
fun invalidateLocalizedApp() { localizedAppCache = null }
```
`MainActivity`: `override fun attachBaseContext(base: Context) { AppConfig.settings.load(); super.attachBaseContext(AppConfig.localized(base)) }`(파일 단위 로드 1회 — spec §14-1 수용; `load()`는 멱등). `GildongmuApplication.onCreate`는 그대로. `SharedPreferencesStore(name = "gildongmu")` + KDoc("최근 검색·수동 위치·설정 한 파일; 첫 읽기는 IO 또는 `attachBaseContext`의 언어 키 동기 읽기 — 그 한 번이 파일 전체를 로드한다"). `AppLocale` KDoc: "앱 내 언어 선택은 §14(`AppConfig.localized`)이고 시스템 앱별 언어 설정은 저장값이 null일 때만 효력".
- [ ] **Step 4: 가드 2종**(`AppSourceGuardTest`): `createConfigurationContext(` 파일 == `AppConfig.kt`; `SharedPreferencesStore(context: Context, name: String = "gildongmu")` 문자열 실재.
- [ ] **Step 5: PASS** → 커밋 `feat(android): 설정 1 — SettingsStore·localeOverride·AppConfig.localized/localizedApp·attachBaseContext·prefs 파일 gildongmu`.

---

### Task 2: 문장 팩토리 6곳 → 호출 시점 `localizedApp()`(캡처 0) + 규약 가드

**Files:**
- Modify: `nearby/NearbyStringsRes.kt`(`nearbyStrings(res: () -> Resources)`), `MainActivity.kt`(`searchStrings(res: () -> Resources)`·`services` 시각 포맷·주석), `place/PlaceFactories.kt`(`placeStrings(res: () -> Resources)`), `directions/DirectionsStrings.kt`(`resourceStrings(res: () -> Resources)` 오버로드), `directions/DirectionsViewModelFactory.kt`, `location/ManualLocationPickerViewModel.kt`, `AppConfig.kt`(`autoClearedText`), `chat/ChatFactories.kt`(`lang`·`dataLocale`·`chatStrings`), `chat/ChatStrings.kt`(`chatStrings(res: () -> Resources)` 오버로드), `speech/Dictation.kt`(KDoc), 주석 6곳
- Test: 기존 테스트·androidTest의 `nearbyStrings(context)`·`placeStrings(context)`·`searchStrings(context)` 호출부를 `{ context.resources }`로; `AppSourceGuardTest` 규약 가드

- [ ] **Step 1: 가드부터(실패)** — `AppSourceGuardTest`:
```kotlin
@Test fun `리소스는 호출 시점에 localizedApp에서 읽는다 — app·applicationContext 캡처 0(spec §14-2)`() {
    val forbidden = Regex("""\b(app|applicationContext)\.(resources|getString\()""")
    val offenders = sources.filter { it.extension == "kt" && it.name != "AppConfig.kt" && forbidden.containsMatchIn(it.readText()) }.map { it.name }
    assertEquals(emptyList(), offenders)
    // applicationContext 별칭 금지 — 저장소 생성자 인자만 허용
    val alias = Regex("""\bapplicationContext\b""")
    val aliasOffenders = sources.filter { f -> f.extension == "kt" && f.name != "AppConfig.kt" && f.readLines().any { l -> alias.containsMatchIn(l) && !l.contains("SharedPreferencesStore(") && !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*") } }.map { it.name }
    assertEquals(emptyList(), aliasOffenders)
    val factoryFiles = sources.filter { it.extension == "kt" && (it.name.endsWith("Factory.kt") || it.name.endsWith("Factories.kt") || it.name.endsWith("StringsRes.kt") || it.name == "MainActivity.kt") }
    assertTrue(factoryFiles.size >= 5)
    assertEquals(emptyList(), factoryFiles.filter { Regex("""\bcontext\.(resources|getString\()""").containsMatchIn(it.readText()) }.map { it.name })
}
```
- [ ] **Step 2: FAIL 확인**(현행 `app.resources`·`context.resources` 다수).
- [ ] **Step 3: 구현** — 팩토리마다 `val res = context.resources` 제거, 람다 안에서 `res().getString(...)`·`appLocalized(res(), ...)`: 예) `fun nearbyStrings(res: () -> Resources): NearbyStrings = NearbyStrings(lang = { AppLocale.current(res()) }, dataLocale = { AppLocale.dataLocale(res()) }, spokenMeters = { res().getString(R.string.android_unit_spokenMeters) }, …)`. `walkSummaryWords(res: () -> Resources)`도 호출 시점. `MainActivity`: `val res: () -> Resources = { AppConfig.localizedApp().resources }`를 팩토리 인자로; `DateFormat` 로케일도 `AppLocale.current(res())`. `directionsViewModelFactory`·`manualLocationPickerFactory`·`chatViewModelFactory`: `context` 인자는 `SharedPreferencesStore(context)`에만 쓰고(`val app = context.applicationContext` 삭제 — 저장소 생성자가 스스로 `applicationContext`를 잡는다) 문장·언어는 `{ AppConfig.localizedApp().resources }`. `AppConfig.manualLocationJudge`: `autoClearedText = { localizedApp().getString(R.string.manualLocation_autoCleared) }`. `resourceStrings(res: () -> Resources)`·`chatStrings(res: () -> Resources)` 오버로드(기존 `Resources` 판은 컴포저블용으로 유지). 주석 6곳 정정(§14-3 목록).
- [ ] **Step 4: 테스트 호출부 갱신 + PASS** — `./gradlew -q :app:testDebugUnitTest :app:compileDebugAndroidTestKotlin`.
- [ ] **Step 5: 커밋** `feat(android): 설정 2 — 문장 팩토리 6곳 호출 시점 localizedApp 읽기(캡처 0)·() -> Resources 오버로드·규약 가드`(chat/ 접촉 보고).

---

### Task 3: 결과 진동 채널 — `Notice.haptic` → `StatusLine`

**Files:**
- Modify: `a11y/Notice.kt`(`HapticKind`·`haptic`), `a11y/AppNotices.kt`(`post(text, spoken, haptic)`·`mergeNotices` haptic 규칙), `a11y/A11y.kt`(`LocalResultHaptics`·발화 효과 안 `performHapticFeedback`), `nav/AppRoot.kt`(제공), `nearby/NearbyScreenViewModel.kt`(`post(text, haptic)`), `search/SearchViewModel.kt`(결과 3분기), `AppConfig.kt`(judge `notify`에 `attention`)
- Test: `a11y/AppNoticesTest`(haptic 규칙), `nearby/NearbyScreenViewModelTest`·`search/SearchViewModelTest`(종류 단언), `AppSourceGuardTest`(`performHapticFeedback` 파일 1)

**Interfaces:** `enum class HapticKind { success, attention, failure }`; `data class Notice(seq, text, spoken = null, haptic: HapticKind? = null)`; `AppNotices.post(text, spoken = null, haptic = null)`; `val LocalResultHaptics = compositionLocalOf { false }`.

- [ ] **Step 1: 실패 테스트** — `mergeNotices(screen(haptic=success), app(haptic=attention))`의 haptic == attention; app haptic null이면 screen 것; `NearbyScreenViewModel`: Loaded n건 → success, 0건 → attention, RefreshFailed → failure, PermissionLost/AccuracyLost → failure(전락), WentOutOfCoverage → attention; 진행·삭제 통지는 null. `SearchViewModel`: count>0 success, 0 attention, failed failure, searchingFor null. 가드: `performHapticFeedback(` 파일 == `A11y.kt`.
- [ ] **Step 2: FAIL** → **Step 3: 구현** — `StatusLine` 발화 효과 끝(`shown = u.text` 뒤): `if (u.rev != 0 && hapticsOn) u.text.haptic?.let { haptics.performHapticFeedback(when (it) { success -> HapticFeedbackType.Confirm; attention -> HapticFeedbackType.ContextClick; failure -> HapticFeedbackType.Reject }) }`(`val haptics = LocalHapticFeedback.current`, `val hapticsOn = LocalResultHaptics.current`). `AppRoot`: `CompositionLocalProvider(LocalResultHaptics provides AppConfig.settings.resultHapticsEnabled.collectAsState().value) { Scaffold(...) }`. 게시자: `NearbyScreenViewModel.post(text, haptic: HapticKind? = null)`; `AppConfig.manualLocationJudge.notify = { AppNotices.post(it, haptic = HapticKind.attention) }`.
- [ ] **Step 4: PASS** → 커밋 `feat(android): 설정 3 — Notice.haptic 진동 채널(StatusLine 발화 효과 안·LocalResultHaptics·게시자 내 주변/검색/자동 해제)`.

---

### Task 4: `settings/` 화면 — 행·다이얼로그·정보 출처·신설 키

**Files:**
- Create: `settings/SettingsRoutes.kt`(`@Serializable data object SettingsRoute`·`DataSourcesRoute`), `settings/SettingsRows.kt`(`SettingsRow` sealed + `settingsRows(experimental)`), `settings/SettingsScreen.kt`, `settings/DataSourcesScreen.kt`, `settings/SettingsAction.kt`, `settings/ChoiceDialog.kt`
- Modify: `android/i18n/android-extra/{ko,en,es,fr,it,ja}.json`(`android.settings.resultHapticsFooter`) → `node android/scripts/messages-to-android-strings.mjs` 재생성 → `res/values*/strings.xml`
- Test: `settings/SettingsRowsTest.kt`(JVM), `androidTest/settings/SettingsScreenA11yTest.kt`

**Interfaces:**
```kotlin
sealed class SettingsRow { object Language; object Dictation; object ResultHaptics; object DataSources; object PrivacyPolicy; object ReportProblem }
fun settingsRows(experimental: Boolean): List<SettingsRow>   // 정식 5·실험 6(ResultHaptics는 Dictation 뒤)
@Composable fun SettingsAction(onOpen: () -> Unit)             // IconButton(Icons.Filled.Settings) contentDescription = android.settings.title, tapTarget, testTag("settings")
@Composable fun SettingsScreen(onBack: () -> Unit, onOpenDataSources: () -> Unit, takeReturnFocus: () -> String?)
@Composable fun DataSourcesScreen(onBack: () -> Unit)
@Composable fun ChoiceDialog(title: String, options: List<Pair<String, String>>, selected: String?, onSelect: (String) -> Unit, onDismiss: () -> Unit) // key→label, 진입 착지 = 선택 행(없으면 첫 행)
```
- [ ] **Step 1: 실패 테스트** — `settingsRows(false) == [Language, Dictation, DataSources, PrivacyPolicy, ReportProblem]`, `settingsRows(true)`는 `Dictation` 뒤에 `ResultHaptics`(6). ATF: 행 각 한 객체(`settings-language` 태그 텍스트 "언어, 한국어" 또는 "언어, 시스템 설정 따름"), 언어 행 활성화 → 다이얼로그 `selectableGroup` 안 7행 + **진입 착지 = 현재 선택 행**(`@Before`에서 `AppConfig.settings.setLanguage("ja")` → 커서를 제목에 옮긴 뒤 언어 행 클릭 → `onNodeWithTag("choice-ja").assertIsFocused()`), 받아쓰기 다이얼로그 2행, 정보 출처 16행 + 라이선스 + 링크 2.
- [ ] **Step 2: FAIL** → **Step 3: 구현**
  - `settings/SettingsRows.kt`: 위 순수 함수.
  - `ChoiceDialog`: `AlertDialog(onDismissRequest = onDismiss, title = { Text(title) }, text = { Column(Modifier.selectableGroup()) { options.forEach { (key, label) -> Row(Modifier.fillMaxWidth().tapTarget().testTag("choice-$key").selectable(selected = key == selected, role = Role.RadioButton) { onSelect(key) }.landingTarget(requesters.getOrPut(key) { FocusRequester() })) { RadioButton(selected = key == selected, onClick = null); Text(label) } } } }, confirmButton = {})`. ⚠ 착지 순서 가드: `selectable(...) { }` 뒤 `landingTarget` 금지 → **`landingTarget`을 `selectable` 앞에**: `.testTag(...).landingTarget(r).selectable(...)`. 진입 착지 `LaunchedEffect(Unit) { withFrameNanos {}; runCatching { requesters[selected ?: options.first().first]?.requestFocus() } }`.
  - `SettingsScreen`: `val store = AppConfig.settings; val language by store.language.collectAsState(); …; var dialog by remember { mutableStateOf<SettingsRow?>(null) }; var notice by remember { mutableStateOf(Notice(0, "")) }; val titleFocus = remember { FocusRequester() }; val rowFocus = remember { mutableMapOf<SettingsRow, FocusRequester>() }`. 복귀 착지 `LaunchedEffect(Unit) { takeReturnFocus()?.let { key -> withFrameNanos {}; runCatching { rowFocus[SettingsRow.DataSources]?.requestFocus() } } }`(정보 출처에서 pop 복귀). 재생성 뒤 착지: `LaunchedEffect(Unit) { if (AppNotices.pending.value != null) { withFrameNanos {}; runCatching { titleFocus.requestFocus() } } }`(언어 변경 재생성 직후 = 대기 앱 통지가 있는 첫 컴포지션). `CompositionLocalProvider(LocalModalOpen provides (dialog != null)) { AppScreenScaffold(stringResource(R.string.android_settings_title), onBack, titleFocus) { padding -> Column(scroll) { rows.forEach { row -> when (row) { Language -> ValueRow(label = 언어, value = languageLabel, tag = "settings-language", onClick = { dialog = row }) … ResultHaptics -> Row(Modifier.toggleable(value = haptics, role = Role.Switch) { store.setResultHaptics(it) }.tapTarget().testTag("settings-haptics")) { Text(trendHaptics); Switch(checked = haptics, onCheckedChange = null) } + Text(footer, mergedRow("settings-haptics-footer")) … PrivacyPolicy -> ActionRow(Intent(ACTION_VIEW, Uri.parse("${AppConfig.API_BASE_URL}/${AppLocale.current(res)}/privacy"))) ReportProblem -> ActionRow(Intent(ACTION_SENDTO, Uri.parse("mailto:engccer@gmail.com"))) } }; StatusLine(notice) } } }`. `ValueRow` = `Modifier.fillMaxWidth().tapTarget().testTag(tag).landingTarget(r).clickable(role = Button) { }` + `Text(joinText(label, value))`(한 객체). 링크 실패: `if (!tryStartActivity(context, intent)) notice = Notice(notice.seq + 1, noAppToOpen)`.
  - 언어 적용: `onSelect = { key -> dialog = null; val code = key.takeIf { it != "system" }; store.setLanguage(code); AppConfig.invalidateLocalizedApp(); AppNotices.post(AppConfig.localizedApp().getString(R.string.android_settings_languageApplied), haptic = HapticKind.success); (context as? Activity)?.recreate() }`. 받아쓰기: `store.setDictationStyle(key)`; 닫힌 뒤 복귀 착지는 그 행(`rowFocus[row]`).
  - 라벨: 언어 값 = `language?.let { nativeName(it) } ?: themeSystem`, `nativeName`은 `nav_korean` 등 6키 매핑(`when`, 리터럴). 받아쓰기 값 = `dictationTap`/`dictationHold`.
  - `DataSourcesScreen`: `AppScreenScaffold(dataSources_title, onBack)` + 16 `Text(mergedRow("source-$i"))`(순서 kakao·tourapi·juso·seoulopen·airkorea·kma·tago·nmc·kakaomobility·ncp·odsay·tmap·kric·korail·seoulmetro·perplexity) + `Text(osmLicense)` + 버튼 2(`osmLink` → `ACTION_VIEW https://www.openstreetmap.org/copyright`, `osmCopyRequest` → `ACTION_SENDTO mailto:engccer@gmail.com`; 실패 → 로컬 `notice` `noAppToOpen`) + `StatusLine(notice)`.
  - android-extra 6로케일에 `android.settings.resultHapticsFooter`(ko: "검색과 내 주변의 결과를 진동으로도 알립니다. 화면이 켜져 있고 기기의 촉각 피드백 설정이 켜져 있을 때만 진동합니다."; en/es/fr/it/ja 동의어 문안) → 생성기 실행 → `strings.xml` 재생성(생성물은 커밋).
- [ ] **Step 4: PASS**(JVM + `compileDebugAndroidTestKotlin`) → 커밋 `feat(android): 설정 4 — settings/ 화면(행 순수 함수·선택 다이얼로그 착지·결과 진동 스위치·정보 출처·링크 실패 통지)·신설 키 resultHapticsFooter 6로케일`.

---

### Task 5: 진입 배선 4탭 + 복귀 착지 + 라우트 등록 + 가드

**Files:**
- Modify: `nav/AppRoot.kt`(`composable<SettingsRoute>`·`composable<DataSourcesRoute>`, 탭 4개에 `ReturnFocusViewModel` + `onOpenSettings`), `search/SearchScreen.kt`(`actions`·`settingsFocus`·`takeSettingsReturn`), `directions/DirectionsScreen.kt`(같은 additive), `nearby/NearbyHubScreen.kt`(`onOpenSettings`, resolver `"settings"`), `chat/ChatScreen.kt`(`ChatTabScreen(onOpenSettings, takeSettingsReturn)` additive)
- Test: `AppSourceGuardTest`(`SettingsAction(`이 4탭 루트 파일 전부에 있음), 기존 ATF 호출부 갱신

- [ ] **Step 1: 가드(실패)** — `for (f in listOf("search/SearchScreen.kt","directions/DirectionsScreen.kt","nearby/NearbyHubScreen.kt","chat/ChatScreen.kt")) assertTrue(read(f).contains("SettingsAction("))`.
- [ ] **Step 2: 구현** — 각 탭 루트: `AppScreenScaffold(title, onBack = null, actions = { /* 화면 고유 액션 */ SettingsAction(onOpenSettings) })`… 버튼 착지 requester는 `SettingsAction(onOpen, focus: FocusRequester)`로 받아 `landingTarget(focus)`; 복귀 `LaunchedEffect(Unit) { if (takeSettingsReturn() == "settings") { withFrameNanos {}; runCatching { settingsFocus.requestFocus() } } }`. `AppRoot`: `composable<SearchRoute> { entry -> val rf: ReturnFocusViewModel = viewModel(entry); SearchScreen(vm, onOpenPlace, onOpenSettings = { rf.slot.remember("settings"); navController.navigate(SettingsRoute) }, takeSettingsReturn = rf.slot::take) }`(길찾기·채팅 동형; 허브는 기존 `returnFocus` 슬롯·resolver에 `"settings"` 추가). `composable<SettingsRoute> { entry -> val rf: ReturnFocusViewModel = viewModel(entry); SettingsScreen(onBack = { navController.popBackStack() }, onOpenDataSources = { rf.slot.remember("dataSources"); navController.navigate(DataSourcesRoute) }, takeReturnFocus = rf.slot::take) }`, `composable<DataSourcesRoute> { DataSourcesScreen { navController.popBackStack() } }`. ⚠ 검색의 `SearchViewModel.takeReturnFocus` 게이트는 건드리지 않는다(결과 행 전용).
- [ ] **Step 3: PASS** → 커밋 `feat(android): 설정 5 — 4탭 상단 바 SettingsAction·pop 복귀 착지(AppRoot ReturnFocusViewModel)·SettingsRoute/DataSourcesRoute 등록`.

---

### Task 6: 문서·게이트·리뷰·통합

- [ ] CHANGELOG 맨 위 절(2026-09-17)에 설정 항목(2~4줄 + spec §14) · README §1 트리(`settings/`) · spec §14-7 구현 리뷰 판정 자리.
- [ ] 게이트(락) → 구현 리뷰 2건(spec-compliance·code-quality, `model: opus`, `review-settings-{spec,quality}.md`) → 반영 → 게이트 → `git rebase main`(움직였으면 재게이트) → ff → 보고 ⑤(코디네이터: `chat/` 접촉 목록·BACKLOG 후보 `localeRevision`·실기기 27~30).

## Self-review

- spec 커버: §14-1 → Task 1·4·5 · §14-2 → Task 1·2·4 · §14-3 → Task 3·4 · §14-4 → Task 4 · §14-5 → 각 Task Step 1 + Task 6 · §13-5 haptic → Task 3 · §3-1 순서 → Task 5 · 판정 39(Task 1·2)·40(Task 3)·41(Task 4 행 목록)·42(Task 5)·43(없음 — 유예).
- 타입 일관: `SettingsStore` API(Task 1) ↔ Task 4 화면 ↔ Task 3 `AppRoot` 제공; `HapticKind`(Task 3) ↔ Task 4 언어 적용 `post(haptic = success)`; `() -> Resources` 팩토리(Task 2) ↔ Task 4 `localizedApp()`; `ReturnFocusViewModel.slot`(기존) ↔ Task 5.
- 플레이스홀더 0. 순서 1 → 2 → 3 → 4 → 5 → 6.
