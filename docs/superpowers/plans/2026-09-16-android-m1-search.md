# 안드로이드 M1 검색 화면 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 한소네 7(점자 키보드)과 TalkBack 터치 양쪽에서 검색어 입력 → 결과 목록 탐색이 완결되는 첫 Compose 화면과, 그 화면이 처음 세우는 실행 계층(전송·저장·언어)·i18n 파이프라인·접근성 기본형을 만든다.

**Architecture:** `:kit`(M0, 판정)의 `SearchService`·`RecentSearchStore`·`formatLocalized`를 `:app`의 `SearchViewModel`(StateFlow + `TextFieldState`)이 조립하고, `SearchScreen`(Compose, `Column+verticalScroll`)이 상태만 그린다. 문자열은 `messages/*.json`에서 생성한 Android 리소스(`%N$s` + ICU 복수 블록 원문)를 `appLocalized`가 `formatLocalized`로 푼다. 언어 판정은 리소스 마커 `app_locale`.

**Tech Stack:** Kotlin 2.4.20 · AGP 9.4.0 · Compose BOM 2026.09.00(Material3 `FilterChip`·`TextField(state)`) · lifecycle-viewmodel-compose 2.11.0 · kotlinx-coroutines-test · `java-test-fixtures` · Node 26(생성 스크립트) · vitest.

**Spec:** `docs/superpowers/specs/2026-09-16-android-app-design.md`(§3 접근성 계약·§4 상태 머신·§6 i18n·§7 테스트 레인·§9 판정이 정본. 계획은 spec을 반복하지 않고 구현 단위로 자른다.)

## Global Constraints

- 서버 계약 변경 0: base URL `https://gildongmu.dodoplanet.space`, 라우트 `/api/places`·`/api/address/search`·`/api/search/web`만(M0 `SearchService`가 부른다).
- `:kit`은 안드로이드 의존 0(`KitPurityTest`), JDK API는 Android 12(API 31) 표면까지(README §3).
- 뼈대 파일(`settings`·`build.gradle.kts`·`libs.versions.toml`·`app/**`·`scripts/**`·README)은 이 세션만 고친다. `ios/**`·`src/**`(신설 vitest 제외)·`packages/**`·`docs/BACKLOG.md`·`PROGRESS.md` 수정 금지. 공유 fixture 읽기만.
- 접근성: 한 줄 = 한 접근성 객체(병합 컨테이너 한 곳에만 `contentDescription`), 단일 polite live region(항상 존재하는 `Text` 하나), 컨트롤 라벨에 이모지 0, `disabled` 금지(클릭 무시 + `stateDescription`), 터치 타깃 ≥ 48dp, 모든 컨트롤 `focusable`.
- 인자 있는 문자열은 `appLocalized(...)`만(소스 가드 Task 3). `getString(id, args)`·`stringResource(id, args)`·`pluralStringResource` 금지.
- 커밋: pathspec(`git add <files>`), 한국어 메시지, 꼬리말 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. `origin` push 금지.
- 게이트(락 안, README §7): `./gradlew :kit:test :app:testDebugUnitTest :app:assembleDebug :app:assembleExperimental` + `VITEST_MAX_THREADS=2 npm run test:run`(기존 실패 1건 `xcstrings-plural` xcrun 라이선스는 기대값). `ANDROID_HOME=~/Library/Android/sdk`.
- 실기기 설치(`adb install`)는 코디네이터 허가 뒤에만(Task 7).

---

## 파일 구조

```
android/kit/build.gradle.kts                                      (+ java-test-fixtures, testFixtures 의존)
android/kit/src/testFixtures/kotlin/space/dodoplanet/gildongmu/kit/KitTestFixtures.kt   (StubTransport·stubbedClient·pathOf·queryOf·InMemoryKeyValueStore — test/Fixtures.kt에서 이동)
android/kit/src/test/kotlin/.../Fixtures.kt                       (Fixtures 로더만 남는다)
android/i18n/android-extra/{ko,en,es,fr,it,ja}.json               (안드로이드 전용 키)
android/i18n/arg-order.json                                       (ko 위치 인자 순서 manifest, 생성물)
android/scripts/messages-to-android-strings.mjs                   (생성 스크립트)
android/app/src/main/res/values/strings.xml, values-{en,es,fr,it,ja}/strings.xml   (생성물 — 손으로 고치지 않는다)
android/app/src/main/res/xml/locales_config.xml
android/app/src/main/kotlin/space/dodoplanet/gildongmu/i18n/AppLocale.kt        (current·dataLocale·appLocalized)
android/app/src/main/kotlin/space/dodoplanet/gildongmu/storage/SharedPreferencesStore.kt
android/app/src/main/kotlin/space/dodoplanet/gildongmu/speech/Dictation.kt
android/app/src/main/kotlin/space/dodoplanet/gildongmu/search/SearchViewModel.kt (+ SearchUiState·Notice)
android/app/src/main/kotlin/space/dodoplanet/gildongmu/search/SearchScreen.kt    (화면 조립)
android/app/src/main/kotlin/space/dodoplanet/gildongmu/search/SearchRows.kt      (결과 행·최근 검색 행·칩 축 컴포저블)
android/app/src/main/kotlin/space/dodoplanet/gildongmu/a11y/A11y.kt              (병합 행·헤딩·live region 관용구 modifier)
android/app/src/main/kotlin/space/dodoplanet/gildongmu/MainActivity.kt           (SearchScreen 연결)
android/app/src/test/kotlin/space/dodoplanet/gildongmu/{i18n/AppLocaleTest,i18n/LocalizedCallSiteGuardTest,speech/DictationTest,search/SearchViewModelTest,MainDispatcherRule}.kt
android/app/src/androidTest/kotlin/space/dodoplanet/gildongmu/search/SearchScreenA11yTest.kt   (실기기 전용)
src/lib/__tests__/android-strings-drift.test.ts                   (vitest 가드)
android/README.md                                                 (§6 앱 문자열·§7 게이트 갱신)
```

---

### Task 1: `:kit` 테스트 픽스처를 `:app`과 공유한다

**Files:**
- Modify: `android/kit/build.gradle.kts`
- Create: `android/kit/src/testFixtures/kotlin/space/dodoplanet/gildongmu/kit/KitTestFixtures.kt`
- Modify: `android/kit/src/test/kotlin/space/dodoplanet/gildongmu/kit/Fixtures.kt` (StubTransport 이하 제거)
- Modify: `android/app/build.gradle.kts`, `android/gradle/libs.versions.toml`

**Interfaces:**
- Produces: `class StubTransport(handler: (String) -> HttpResponse) : HttpTransport { val seenUrls }`, `fun stubbedClient(handler): APIClient`, `fun pathOf(url)`, `fun queryOf(url)`, `class InMemoryKeyValueStore : KeyValueStore` — 패키지 `space.dodoplanet.gildongmu.kit`, `:app` 테스트에서 `testImplementation(testFixtures(project(":kit")))`로 보인다.

- [ ] **Step 1: 픽스처 파일을 옮긴다**

`Fixtures.kt`에서 `StubTransport`·`stubbedClient`·`pathOf`·`queryOf`·`InMemoryKeyValueStore` 다섯 선언을 잘라 새 파일로:

```kotlin
package space.dodoplanet.gildongmu.kit

/** `APIClient` 스텁 전송(Swift `StubURLProtocol` 대응). handler는 절대 URL을 받는다. `:app` 테스트도 쓴다(testFixtures). */
class StubTransport(private val handler: (String) -> HttpResponse) : HttpTransport {
    val seenUrls = mutableListOf<String>()
    override suspend fun get(url: String, timeoutMs: Long?): HttpResponse {
        seenUrls.add(url)
        return handler(url)
    }
}

fun stubbedClient(handler: (String) -> HttpResponse): APIClient = APIClient("https://example.test", StubTransport(handler))

/** URL의 경로 부분(`/api/places`). */
fun pathOf(url: String): String = java.net.URI(url).path

/** URL의 raw 쿼리. 없으면 "". */
fun queryOf(url: String): String = java.net.URI(url).rawQuery ?: ""

/** `RecentSearchStore` 테스트용 메모리 저장소. */
class InMemoryKeyValueStore : KeyValueStore {
    private val map = HashMap<String, String>()
    override fun getString(key: String): String? = map[key]
    override fun putString(key: String, value: String) { map[key] = value }
}
```

- [ ] **Step 2: 빌드 파일**

`kit/build.gradle.kts` plugins에 `` `java-test-fixtures` `` 추가, dependencies에 `testFixturesImplementation(libs.kotlinx.coroutines.core)`. `app/build.gradle.kts`에 `testImplementation(testFixtures(project(":kit")))`, `testImplementation(kotlin("test"))`, `testImplementation(libs.kotlinx.coroutines.test)`, `testRuntimeOnly(libs.junit.platform.launcher)`, `implementation(libs.lifecycle.viewmodel.compose)`, `implementation(libs.compose.foundation)`, `androidTestImplementation(libs.compose.ui.test.junit4.accessibility)`, `androidTestImplementation(libs.androidx.test.ext.junit)`, `androidTestImplementation(libs.androidx.test.runner)`; `android { testOptions { unitTests.all { it.useJUnitPlatform() } } }`. toml에 `lifecycle-viewmodel-compose = "2.11.0"`, `androidx-test-ext-junit = "1.3.0"`, `androidx-test-runner = "1.7.0"`, libraries `lifecycle-viewmodel-compose`, `compose-foundation = { module = "androidx.compose.foundation:foundation" }`, `compose-ui-test-junit4-accessibility = { module = "androidx.compose.ui:ui-test-junit4-accessibility" }`, `androidx-test-ext-junit`, `androidx-test-runner`.

- [ ] **Step 3: 검증**

Run: `cd android && ./gradlew :kit:test :app:assembleDebug` → BUILD SUCCESSFUL, :kit 258건. `KitPurityTest`의 카탈로그 alias 검사가 `testFixtures` 의존을 허용하는지 확인(허용 집합은 module 접두 판정이라 통과).

- [ ] **Step 4: Commit** — `build(android): :kit testFixtures로 스텁 전송·저장소를 :app 테스트와 공유, M1 의존성 등록`

### Task 2: 앱 문자열 생성 파이프라인 (`strings.xml` + arg-order + vitest 가드)

**Files:**
- Create: `android/i18n/android-extra/{ko,en,es,fr,it,ja}.json`, `android/scripts/messages-to-android-strings.mjs`, `android/i18n/arg-order.json`(생성), `android/app/src/main/res/values*/strings.xml`(생성), `android/app/src/main/res/xml/locales_config.xml`, `src/lib/__tests__/android-strings-drift.test.ts`
- Modify: `android/app/src/main/AndroidManifest.xml`(`android:localeConfig="@xml/locales_config"`), `android/app/src/main/res/values/strings.xml`의 손글 `app_name`은 유지하되 파일 이름을 `app.xml`로 옮긴다(생성물과 분리).

**Interfaces:**
- Produces: 리소스 `R.string.<key with . → _>` 전부, `R.string.app_locale`(값 `ko|en|es|fr|it|ja`), android-extra 키 `android.tab.{search,directions,nearby,chat}`, `android.search.{prompt,searching,failedTitle,webSection,announceFailed,announceEmpty,announceCount}`, `search.button` 오버라이드("검색"). 스크립트 export: `buildAndroidStrings()`, `renderStringsXml(locale)`, `OUTPUT_DIR`, `ARG_ORDER_PATH`.

- [ ] **Step 1: android-extra 6파일** — ko:

```json
{ "android": {
    "tab": { "search": "검색", "directions": "길찾기", "nearby": "내 주변", "chat": "채팅" },
    "search": { "prompt": "장소, 주소 검색", "searching": "검색 중", "failedTitle": "검색에 실패했습니다", "webSection": "웹 검색",
                "announceFailed": "검색에 실패했습니다.", "announceEmpty": "검색 결과가 없습니다", "announceCount": "검색 결과 {count}건" } },
  "search": { "button": "검색" } }
```
en·es·fr·it·ja는 `ios/i18n/ios-extra/<lang>.json`의 `ios.tab`·`ios.search` 값을 그대로 옮긴다(예: en `announceCount` = `{count, plural, one {# result} other {# results}}`, `search.button`은 웹 en "Search (Enter)"에서 꼬리를 뗀 "Search" — 다른 로케일도 `messages/<lang>.json` `search.button`에서 " (Enter)" 꼬리만 뗀다).

- [ ] **Step 2: 실패하는 vitest** — `src/lib/__tests__/android-strings-drift.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { XMLParser } from "fast-xml-parser"; // 없으면 node --experimental-strip-types 대신 정규식 파서(아래 parseStringsXml)를 쓴다 — 새 npm 의존성은 넣지 않는다
import { buildAndroidStrings, renderStringsXml, OUTPUT_DIR, ARG_ORDER_PATH, LOCALES, escapeAndroid } from "../../../android/scripts/messages-to-android-strings.mjs";
import { collectArgOrder as iosArgOrder, ARG_ORDER_PATH as IOS_ARG_ORDER } from "../../../ios/scripts/messages-to-xcstrings.mjs";

/** `<string name="k">v</string>`를 {k: 원문} 으로 — 이스케이프를 되돌린다(왕복 검사). */
function parseStringsXml(xml: string): Record<string, string> { /* 정규식 + unescape(\\'→', \\"→", &amp;→&, &lt;→<, &gt;→>, 선두 \\@·\\?, 양끝 큰따옴표 제거) */ }

describe("안드로이드 앱 문자열 드리프트", () => {
  const built = buildAndroidStrings();
  it("생성물이 최신이다(byte-identical)", () => { for (const l of LOCALES) expect(readFileSync(join(OUTPUT_DIR, l === "ko" ? "values" : `values-${l}`, "strings.xml"), "utf8")).toBe(renderStringsXml(l, built)); });
  it("arg-order manifest가 정본과 같고 iOS manifest와 공유 키 순서가 같다", () => { /* diffArgOrder(manifest, built.argOrder) → {added:[],removed:[],changed:[]}; 공유 키마다 ios[key] === android[key] */ });
  it("왕복: XML을 다시 읽으면 빌더 값과 같다", () => { for (const l of LOCALES) expect(parseStringsXml(renderStringsXml(l, built))).toEqual({ ...built.strings[l], app_locale: l }); });
  it("android.search.* 는 ios.search.* 와 6로케일 문안이 같다", () => { /* android-extra vs ios-extra JSON 직접 비교(prompt·searching·failedTitle·webSection·announceFailed·announceEmpty·announceCount) */ });
  it("인자 0인데 %%를 담은 키는 없다", () => { expect(built.rejected).toEqual([]); });
});
```

Run: `npx vitest run src/lib/__tests__/android-strings-drift.test.ts` → FAIL(스크립트 없음).

- [ ] **Step 3: 스크립트** — `android/scripts/messages-to-android-strings.mjs`

```js
#!/usr/bin/env node
// messages/*.json + android/i18n/android-extra/*.json → android/app/src/main/res/values(-lang)/strings.xml
// iOS 빌더(buildCatalog)를 import해 같은 규칙(ko 등장 순서 positional·ICU 복수 블록 원문·`#`→%N$@)으로 만든 뒤
// %N$@ → %N$s. 복수형은 <plurals>가 아니라 :kit formatLocalized가 런타임에 푼다(spec §6). arg-order 게이트는
// iOS syncArgOrder를 android/i18n/arg-order.json에 그대로 적용한다.
import { buildCatalog, syncArgOrder, UPDATE_ARG_ORDER_FLAG } from '../../ios/scripts/messages-to-xcstrings.mjs';
export const LOCALES = ['ko', 'en', 'es', 'fr', 'it', 'ja'];
export const ARG_ORDER_PATH = path.join(REPO_ROOT, 'android', 'i18n', 'arg-order.json');
export const OUTPUT_DIR = path.join(REPO_ROOT, 'android', 'app', 'src', 'main', 'res');
const TARGET = { namespaces: null, extraDir: path.join(REPO_ROOT, 'android', 'i18n', 'android-extra'), output: null };

export function resourceName(key) { return key.replace(/\./g, '_'); }
/** aapt2 이스케이프: ' " → \' \" · & < > 엔티티 · 선두 @ ? → \@ \? · 양끝 공백은 큰따옴표로 감싼다 */
export function escapeAndroid(value) { let v = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, "\\'").replace(/"/g, '\\"'); if (/^[@?]/.test(v)) v = '\\' + v; if (/^\s|\s$/.test(v)) v = `"${v}"`; return v; }
export function buildAndroidStrings() {
  const { catalog, skipped, argOrder } = buildCatalog(TARGET);
  if (skipped.length) throw new Error(`[android-strings] 변환 불가 키: ${skipped.join(', ')}`);
  const strings = Object.fromEntries(LOCALES.map((l) => [l, {}]));
  const rejected = [];
  for (const key of Object.keys(catalog.strings).sort()) {
    for (const [lang, unit] of Object.entries(catalog.strings[key].localizations)) {
      const value = unit.stringUnit.value.replace(/%(\d+)\$@/g, '%$1$$s');
      if (!(key in argOrder) && value.includes('%%')) rejected.push(`${key}/${lang}`);
      strings[lang][key] = value;
    }
  }
  return { strings, argOrder, rejected };
}
export function renderStringsXml(locale, built = buildAndroidStrings()) {
  const lines = ['<?xml version="1.0" encoding="utf-8"?>', '<!-- 생성물: node android/scripts/messages-to-android-strings.mjs — 손으로 고치지 않는다 -->', '<resources>', `    <string name="app_locale">${locale}</string>`];
  for (const key of Object.keys(built.strings[locale]).sort()) lines.push(`    <string name="${resourceName(key)}">${escapeAndroid(built.strings[locale][key])}</string>`);
  lines.push('</resources>', '');
  return lines.join('\n');
}
// CLI: --check | --update-arg-order. syncArgOrder({ update, manifestPath: ARG_ORDER_PATH, current: built.argOrder }) 실패면 exit 1 (쓰기 전에).
```
`locales_config.xml`: `<locale-config><locale android:name="ko"/>…6개</locale-config>`. Manifest `<application android:localeConfig="@xml/locales_config">`. 기존 `values/strings.xml`의 `app_name`은 `values/app.xml`(+`values-en/app.xml` "Gildongmu")로 옮긴다. ⚠ `app_locale`은 6개 `values*/strings.xml` 전부에 있어야 한다(기본 ko 포함).

- [ ] **Step 4: 생성·검증** — `node android/scripts/messages-to-android-strings.mjs --update-arg-order`(부트스트랩 1회) → `--check` → vitest 초록 → `./gradlew :app:assembleDebug`(aapt2가 이스케이프를 받아들이는지가 진짜 검증. `%1$s`와 `{…}` 혼재 문자열은 형식 검증을 통과해야 한다 — 실패하면 그 키를 `formatted="false"`가 아니라 이스케이프로 고친다).

- [ ] **Step 5: Commit** — `feat(android): 앱 문자열 생성 파이프라인 — messages→strings.xml, android-extra, arg-order 잠금, 드리프트 가드`

### Task 3: 언어 판정·문자열 조회 계층 + 호출부 소스 가드

**Files:**
- Create: `android/app/src/main/kotlin/space/dodoplanet/gildongmu/i18n/AppLocale.kt`, `android/app/src/test/kotlin/space/dodoplanet/gildongmu/i18n/{AppLocaleTest,LocalizedCallSiteGuardTest}.kt`

**Interfaces:**
- Produces: `object AppLocale { val supported: List<String>; fun current(res: Resources): String; fun dataLocale(res): String; fun normalize(marker: String?): String }`, `fun appLocalized(res: Resources, @StringRes id: Int, vararg args: Any): String`, Compose `@Composable fun appString(@StringRes id: Int, vararg args: Any): String`.

- [ ] **Step 1: 실패하는 테스트** — 순수 부분만 JVM:

```kotlin
class AppLocaleTest {
    @Test fun `마커가 지원 언어면 그대로, 아니면 ko`() {
        assertEquals("en", AppLocale.normalize("en")); assertEquals("ko", AppLocale.normalize("de")); assertEquals("ko", AppLocale.normalize(null))
    }
    @Test fun `dataLocale은 ko만 ko 나머지 전부 en`() {
        assertEquals("ko", AppLocale.dataLocaleOf("ko")); for (l in listOf("en","es","fr","it","ja")) assertEquals("en", AppLocale.dataLocaleOf(l))
    }
    @Test fun `resolveFormat은 formatLocalized를 지난다`() {
        assertEquals("검색 결과 3건", AppLocale.resolveFormat("검색 결과 %1\$s건", "ko", listOf(3)))
        assertEquals("There is 1 result", AppLocale.resolveFormat("{1, plural, one {There is %1\$s result} other {There are %1\$s results}}", "en", listOf(1)))
    }
}
class LocalizedCallSiteGuardTest {
    /** 인자 있는 문자열 조회는 appLocalized만 — 네 꼴을 스캔(spec §6). */
    @Test fun `앱 소스에 인자 있는 직접 조회가 없다`() {
        val root = repoRoot().resolve("android/app/src/main")
        val bad = Regex("""(getString\(\s*R\.string\.[A-Za-z0-9_]+\s*,|resources\.getString\([^)]*,|stringResource\(\s*R\.string\.[A-Za-z0-9_]+\s*,|pluralStringResource\()""")
        val offenders = root.walkTopDown().filter { it.extension == "kt" }.flatMap { f -> f.readLines().withIndex().filter { bad.containsMatchIn(it.value) }.map { "${f.name}:${it.index + 1}" } }.toList()
        assertEquals(emptyList(), offenders)
    }
}
```
(`repoRoot()`는 `:app` 테스트 전용 작은 헬퍼: `System.getProperty("user.dir")`에서 위로 올라가 `package.json`을 찾는다. `:app` build.gradle.kts `tasks.withType<Test> { systemProperty("gildongmu.appDir", projectDir.absolutePath) }`.)

- [ ] **Step 2: 구현**

```kotlin
package space.dodoplanet.gildongmu.i18n
object AppLocale {
    val supported = listOf("ko", "en", "es", "fr", "it", "ja")
    /** 리소스 해석기가 고른 폴더의 마커(spec §5 split-brain 회피). */
    fun current(res: Resources): String = normalize(res.getString(R.string.app_locale))
    fun normalize(marker: String?): String = if (marker != null && marker in supported) marker else "ko"
    fun dataLocaleOf(lang: String): String = if (lang == "ko") "ko" else "en"
    fun dataLocale(res: Resources): String = dataLocaleOf(current(res))
    /** :kit formatLocalized 경유 — 복수 블록·%N$s. */
    fun resolveFormat(format: String, lang: String, args: List<Any>): String = formatLocalized(format, lang, args)
}
fun appLocalized(res: Resources, @StringRes id: Int, vararg args: Any): String = AppLocale.resolveFormat(res.getString(id), AppLocale.current(res), args.toList())
@Composable fun appString(@StringRes id: Int, vararg args: Any): String { val res = LocalContext.current.resources; return appLocalized(res, id, *args) }
```

- [ ] **Step 3: 검증·커밋** — `./gradlew :app:testDebugUnitTest` 초록 → `feat(android): AppLocale·appLocalized — 리소스 마커 언어 판정, formatLocalized 경유, 호출부 소스 가드`

### Task 4: 저장소 구현과 받아쓰기 게이트 순수 함수

**Files:**
- Create: `android/app/src/main/kotlin/space/dodoplanet/gildongmu/storage/SharedPreferencesStore.kt`, `android/app/src/main/kotlin/space/dodoplanet/gildongmu/speech/Dictation.kt`, `android/app/src/test/kotlin/space/dodoplanet/gildongmu/speech/DictationTest.kt`

**Interfaces:**
- Produces: `class SharedPreferencesStore(context: Context, name: String = "gildongmu.recent") : KeyValueStore`, `fun isDictationAvailable(sdkInt: Int, onDeviceProbe: () -> Boolean): Boolean`, `object Dictation { fun isAvailable(context: Context): Boolean }`.

- [ ] **Step 1: 테스트(순수 함수)**

```kotlin
class DictationTest {
    @Test fun `33 미만은 프로브를 부르지도 않고 false`() { var probed = false; assertFalse(isDictationAvailable(31) { probed = true; true }); assertFalse(probed) }
    @Test fun `33 이상은 온디바이스 프로브가 정한다`() { assertTrue(isDictationAvailable(33) { true }); assertFalse(isDictationAvailable(35) { false }) }
}
```

- [ ] **Step 2: 구현** — `SharedPreferencesStore`는 `getString`/`putString`을 `SharedPreferences`에 그대로(`apply()`); ViewModel이 `Dispatchers.IO`에서 부른다(Task 5). `Dictation.isAvailable(context) = isDictationAvailable(Build.VERSION.SDK_INT) { SpeechRecognizer.isOnDeviceRecognitionAvailable(context) }`. 33은 D9 정책선(주석에 `createOnDeviceSpeechRecognizer`는 API 31·`checkRecognitionSupport` 33 명시).

- [ ] **Step 3: 검증·커밋** — `feat(android): SharedPreferences 저장소·받아쓰기 API 33 게이트(순수 함수)`

### Task 5: `SearchViewModel` 상태 머신

**Files:**
- Create: `android/app/src/main/kotlin/space/dodoplanet/gildongmu/search/SearchViewModel.kt`, `android/app/src/test/kotlin/space/dodoplanet/gildongmu/{MainDispatcherRule.kt,search/SearchViewModelTest.kt}`

**Interfaces:**
- Produces:
```kotlin
data class Notice(val seq: Int, val text: String)
data class SearchUiState(val outcome: SearchOutcome? = null, val isSearching: Boolean = false, val failed: Boolean = false,
    val resultsRevision: Int = 0, val bucket: String? = null, val region: String? = null,
    val recentQueries: List<RecentQuery> = emptyList(), val notice: Notice = Notice(0, "")) { val totalCount: Int }
class SearchViewModel(service: SearchService, store: RecentSearchStore, dataLocale: () -> String, strings: SearchStrings, savedState: SavedStateHandle, io: CoroutineDispatcher = Dispatchers.IO) : ViewModel() {
    val queryState: TextFieldState; val state: StateFlow<SearchUiState>; var consumedRevision: Int  // 비저장(§3 착지)
    fun submit(); fun clearQuery(); fun setBucket(String?); fun setRegion(String?)
    fun removeRecent(text): Int?  /* 착지할 다음 행 index, 목록 소멸이면 null */; fun togglePinRecent(text); fun clearRecent()
}
/** 통지 문장 공급(리소스는 화면 몫이라 ViewModel은 문장을 주입받는다 — JVM 테스트 가능). */
class SearchStrings(val searchingFor: (String) -> String, val failed: String, val empty: String, val count: (Int) -> String, val deleted: String, val cleared: String, val clearedExceptPinned: String)
```

- [ ] **Step 1: 실패하는 테스트**

```kotlin
class MainDispatcherRule(val dispatcher: TestDispatcher = StandardTestDispatcher()) : TestWatcher() {
    override fun starting(d: Description) = Dispatchers.setMain(dispatcher); override fun finished(d: Description) = Dispatchers.resetMain()
}
class SearchViewModelTest {
    @get:Rule val main = MainDispatcherRule()
    private val strings = SearchStrings({ "'$it' 검색 중…" }, "실패", "없음", { "결과 $it 건" }, "삭제했습니다", "모두 지웠습니다", "고정 제외 지움")
    private fun vm(handler: (String) -> HttpResponse, store: RecentSearchStore = RecentSearchStore(InMemoryKeyValueStore())) =
        SearchViewModel(SearchService(stubbedClient(handler)), store, { "ko" }, strings, SavedStateHandle(), io = main.dispatcher)
    private val places = """{"places":[{"id":"k1","name":"강동역","category":"교통,수송 > 지하철","address":"서울 강동구","roadAddress":"서울 강동구 천호대로","lat":37.5,"lng":127.1}],"provider":"kakao-local","query":"강동"}"""
    private val emptyAddr = """{"addresses":[],"query":"q"}"""

    @Test fun `제출은 기록·필터 리셋·검색 중 통지·결과 통지·세대 증가 순이다`() = runTest {
        val m = vm { url -> when (pathOf(url)) { "/api/places" -> HttpResponse(200, places); "/api/address/search" -> HttpResponse(200, emptyAddr); else -> HttpResponse(404, "") } }
        m.queryState.setTextAndPlaceCursorAtEnd("강동"); m.setBucket("food")
        m.submit()
        assertTrue(m.state.value.isSearching); assertEquals("'강동' 검색 중…", m.state.value.notice.text); assertNull(m.state.value.bucket)
        assertEquals(listOf("강동"), m.state.value.recentQueries.map { it.text })
        main.dispatcher.scheduler.advanceUntilIdle()
        val s = m.state.value
        assertFalse(s.isSearching); assertFalse(s.failed); assertEquals(1, s.totalCount); assertEquals(1, s.resultsRevision); assertEquals("결과 1 건", s.notice.text)
    }
    @Test fun `빈 질의는 무시된다`() = runTest { val m = vm { HttpResponse(500, "") }; m.queryState.setTextAndPlaceCursorAtEnd("   "); m.submit(); assertEquals(0, m.state.value.resultsRevision); assertFalse(m.state.value.isSearching) }
    @Test fun `장소·주소 둘 다 실패면 failed 결과 0면 empty`() = runTest { /* 502 둘 → failed=true·notice=실패 ; 빈 성공 둘+웹 빈 → failed=false·notice=없음 */ }
    @Test fun `새 제출은 앞 검색을 취소해 stale 결과가 상태를 쓰지 않는다`() = runTest { /* 첫 핸들러는 delay 뒤 응답, 두 번째는 즉시 — 최종 outcome.query == 두 번째, resultsRevision == 1 */ }
    @Test fun `통지 seq는 같은 문장이라도 매번 증가한다`() = runTest { /* removeRecent 두 번 → seq 두 번 증가, text 같음 */ }
    @Test fun `최근 검색 삭제의 착지 index는 다음 → 이전 → null`() = runTest { /* [c,b,a]에서 b 삭제 → 1(a), a 삭제 → 0(c), c 삭제 → null */ }
    @Test fun `고정 토글은 자리를 유지하고 저장소에 반영된다`() = runTest { /* 목록 순서 불변, store.queries()에서 pinned=true */ }
    @Test fun `프로세스 재생성 뒤 검색어만 복원된다`() = runTest { val h = SavedStateHandle(mapOf("query" to "강동")); val m = SearchViewModel(SearchService(stubbedClient { HttpResponse(404, "") }), RecentSearchStore(InMemoryKeyValueStore()), { "ko" }, strings, h, main.dispatcher); assertEquals("강동", m.queryState.text.toString()); assertNull(m.state.value.outcome) }
}
```

- [ ] **Step 2: 구현** — spec §4 그대로. 핵심:

```kotlin
fun submit() {
    val trimmed = queryState.text.toString().trim(); if (trimmed.isEmpty()) return
    searchJob?.cancel()
    savedState["query"] = trimmed
    val requestedLang = dataLocale()
    _state.update { it.copy(recentQueries = store.recordQuery(trimmed), bucket = null, region = null, isSearching = true, notice = notice(strings.searchingFor(trimmed))) }
    searchJob = viewModelScope.launch {
        val result = withContext(io) { service.search(trimmed, lat = null, lng = null, lang = requestedLang) }
        ensureActive()
        _state.update { s -> val total = result.orderedSections.sumOf { it.count }
            s.copy(outcome = result, isSearching = false, failed = result.allFailed && total == 0, resultsRevision = s.resultsRevision + 1,
                   notice = notice(when { result.allFailed && total == 0 -> strings.failed; total == 0 -> strings.empty; else -> strings.count(total) })) }
    }
}
private fun notice(text: String) = Notice(_state.value.notice.seq + 1, text)
```
`recentQueries` 초기 로드와 `store` 호출은 `withContext(io)`(SharedPreferences 동기 I/O). `removeRecent`는 삭제 전 index로 다음 착지 index를 계산해 반환.

- [ ] **Step 3: 검증·커밋** — `./gradlew :app:testDebugUnitTest` → `feat(android): SearchViewModel — iOS SearchModel 미러(취소·3-state·세대·통지 seq·최근 검색)`

### Task 6: `SearchScreen` — 화면·접근성 기본형·착지·실기기 검사 레인

**Files:**
- Create: `android/app/src/main/kotlin/space/dodoplanet/gildongmu/a11y/A11y.kt`, `search/SearchScreen.kt`, `search/SearchRows.kt`, `android/app/src/androidTest/kotlin/space/dodoplanet/gildongmu/search/SearchScreenA11yTest.kt`
- Modify: `MainActivity.kt`(`SearchScreen(viewModel)`), `AppConfig.kt`(`searchService`·`recentStore(context)` 팩토리)

**Interfaces:**
- Consumes: Task 3 `appString`·`AppLocale`, Task 5 `SearchViewModel`, `:kit` `filterPlacesByBucket/Region`·`bucketsPresent`·`regionsPresent`·`bucketLabel`·`regionLabel`·`bilingualName`·`pickCategory`·`SearchSection`.
- Produces: `@Composable fun SearchScreen(viewModel: SearchViewModel)`; `Modifier.mergedRow(spoken: String?)`(= `semantics(mergeDescendants = true) { spoken?.let { contentDescription = it } }` + `focusable()` + `minHeight 48dp` + `testTag`), `Modifier.headingText()`, `@Composable fun StatusLine(notice: Notice)`.

- [ ] **Step 1: A11y 관용구** — `A11y.kt`:

```kotlin
/** 한 줄 = 한 접근성 객체. 비-ko 병기처럼 낭독이 시각과 다를 때만 spoken을 준다(병합 컨테이너 한 곳, 자식엔 절대 두지 않는다 — spec §3-8). */
fun Modifier.mergedRow(tag: String, spoken: String? = null): Modifier = this.testTag(tag).defaultMinSize(minHeight = 48.dp).focusable()
    .semantics(mergeDescendants = true) { if (spoken != null) contentDescription = spoken }
fun Modifier.headingText(): Modifier = semantics { heading() }
/** 단일 polite 통지 창구. 항상 존재하며 seq 변화마다 한 프레임 빈 문자열을 거쳐 같은 문장도 다시 발화한다(spec §3-4). */
@Composable fun StatusLine(notice: Notice, modifier: Modifier = Modifier) {
    var shown by remember { mutableStateOf("") }
    LaunchedEffect(notice.seq) { shown = ""; withFrameNanos { }; shown = notice.text }
    Text(shown, modifier = modifier.semantics { liveRegion = LiveRegionMode.Polite }.testTag("status"))
}
```

- [ ] **Step 2: 화면** — `SearchScreen.kt` 골격(spec §3 표 순서 그대로; 전부 `Column(Modifier.verticalScroll(rememberScrollState()).semantics { testTagsAsResourceId = true })`):

```kotlin
@Composable fun SearchScreen(vm: SearchViewModel) {
    val s by vm.state.collectAsStateWithLifecycle()
    val lang = AppLocale.current(LocalContext.current.resources)
    val firstRow = remember { FocusRequester() }; val searchButton = remember { FocusRequester() }
    LaunchedEffect(s.resultsRevision) { if (s.resultsRevision > vm.consumedRevision && s.totalCount > 0) { vm.consumedRevision = s.resultsRevision; withFrameNanos { }; runCatching { firstRow.requestFocus() } } }
    Column(...) {
        Text(stringResource(R.string.app_title), Modifier.headingText())
        TextField(state = vm.queryState, lineLimits = TextFieldLineLimits.SingleLine, label = { Text(stringResource(R.string.search_label)) },
            placeholder = { Text(stringResource(R.string.android_search_prompt)) },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search), onKeyboardAction = { vm.submit() },
            trailingIcon = if (vm.queryState.text.isNotEmpty()) { { IconButton(onClick = { vm.clearQuery(); fieldFocus.requestFocus() }) { Icon(Icons.Filled.Close, contentDescription = stringResource(R.string.search_clear)) } } } else null,
            modifier = Modifier.fillMaxWidth().focusRequester(fieldFocus).onPreviewKeyEvent { if (it.key == Key.Enter && it.type == KeyEventType.KeyUp) { vm.submit(); true } else false })
        Button(onClick = { if (!s.isSearching) vm.submit() }, modifier = Modifier.focusRequester(searchButton).semantics { if (s.isSearching) stateDescription = searching }) { Text(stringResource(R.string.search_button)) }
        StatusLine(s.notice)
        if (s.outcome == null && !s.isSearching && s.recentQueries.isNotEmpty()) RecentSection(s.recentQueries, onRun = { vm.queryState.setTextAndPlaceCursorAtEnd(it); vm.submit() },
            onDelete = { text -> val next = vm.removeRecent(text); /* next==null → searchButton.requestFocus() else 해당 행 requester */ }, onTogglePin = vm::togglePinRecent, onClearAll = { vm.clearRecent(); if (vm.state.value.recentQueries.isEmpty()) searchButton.requestFocus() })
        s.outcome?.let { ResultSections(it, s.bucket, s.region, lang, showHeadings = it.orderedSections.size > 1, firstRowRequester = firstRow, onBucket = vm::setBucket, onRegion = vm::setRegion) }
    }
}
```
`SearchRows.kt`: `PlaceRow(place, lang, modifier)` — 시각 `Text(name.display)` + `Text(joinText(pickCategory(...), roadAddress.ifEmpty { address }))`, 컨테이너 `mergedRow("place-${id}", spoken = if (lang == "ko") null else joinText(name.primary, secondary))`; `AddressRow`(비-ko `spoken = "${name.primary}, ${zipNo}"`); `WebRow`(`Modifier.clickable(role = Role.Button) { context.startActivity(Intent(ACTION_VIEW, url.toUri())) }`, `runCatching` ActivityNotFound); `RecentRow`(`Button` 대신 `Row.clickable(role = Role.Button)` + `clearAndSetSemantics { contentDescription = text; if (pinned) stateDescription = pinnedLabel; customActions = listOf(pin/unpin, delete); role = Role.Button }` + 시각 핀 아이콘 `contentDescription = null`); `ChipAxis(label, allLabel, items, selected, onSelect)` — 라벨 `Text` 한 줄 + `FlowRow(Modifier.selectableGroup())` + `FilterChip(selected, onClick, label = { Text("$label $count") })`, `items.size <= 1`이면 아무것도 그리지 않는다. `ResultSections`는 `outcome.orderedSections`를 순회하며 첫 행에만 `focusRequester(firstRowRequester)`. 장소 섹션: `bucketsPresent(base)`·`regionsPresent(base)`로 칩, `filterPlacesByRegion(filterPlacesByBucket(base, bucket), region)`로 행, 비면 `search_noFilterResults`.

- [ ] **Step 3: MainActivity 연결** — `setContent { MaterialTheme { SearchScreen(viewModel { SearchViewModel(AppConfig.searchService, RecentSearchStore(SharedPreferencesStore(applicationContext)), { AppLocale.dataLocale(resources) }, searchStrings(resources), createSavedStateHandle()) }) } }` — `searchStrings(res)`는 `appLocalized`로 7문장을 묶는 팩토리.

- [ ] **Step 4: 실기기 검사 레인**(`androidTest`, 머신 게이트 밖):

```kotlin
class SearchScreenA11yTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()
    @Test fun rowsAreSingleNodesAndPassAtf() {
        val vm = SearchViewModel(SearchService(stubbedClient { url -> when (pathOf(url)) { "/api/places" -> HttpResponse(200, PLACES); "/api/address/search" -> HttpResponse(200, EMPTY_ADDR); else -> HttpResponse(404, "") } }), RecentSearchStore(InMemoryKeyValueStore()), { "ko" }, searchStrings(rule.activity.resources), SavedStateHandle())
        rule.setContent { SearchScreen(vm) }
        rule.enableAccessibilityChecks()
        rule.onNodeWithTag("query").performTextInput("강동"); rule.onNodeWithTag("submit").performClick()
        rule.waitUntil { vm.state.value.resultsRevision == 1 }
        rule.onNodeWithTag("place-k1").assertTextContains("강동역", substring = true).assertIsFocused()
        rule.onRoot().tryPerformAccessibilityChecks()
    }
}
```
(`androidTest`도 `testFixtures(project(":kit"))`를 `androidTestImplementation`으로 받는다.)

- [ ] **Step 5: 검증** — `./gradlew :app:testDebugUnitTest :app:assembleDebug :app:assembleExperimental`; `LocalizedCallSiteGuardTest` 초록; `adb devices`에 기기가 있으면 코디네이터 허가 뒤 `./gradlew :app:connectedExperimentalAndroidTest`, 없으면 APK 경로 보고.

- [ ] **Step 6: Commit** — `feat(android): 검색 화면 — Compose 접근성 기본형(병합 행·헤딩·단일 live region·착지)·칩 필터·최근 검색·ATF 레인`

### Task 7: 게이트·리뷰·통합·실기기

- [ ] `android/README.md` §6에 앱 문자열 절(생성 명령·`appLocalized` 규칙·`app_locale`)과 §7 게이트에 `:app:testDebugUnitTest` 추가. `CHANGELOG.md` 맨 위 날짜 절에 M1 항목 2~4줄.
- [ ] 락 안 게이트 전부 초록 → 리뷰(spec-compliance + code-quality 서브에이전트, `git diff main...HEAD`만) → 반영 → `git rebase main` → 게이트 재실행 → `comm -23` CHANGELOG 대조 → `git -C ~/Mac-Projects/gildongmu merge --ff-only feat/android-m1` → 보고 ⑤.
- [ ] 실기기: `adb devices` 비면 APK 경로(`android/app/build/outputs/apk/experimental/app-experimental.apk`)만 보고. 있으면 설치 직전 코디네이터 허가(④) → `adb install -r` → `adb exec-out timeout 10 uiautomator dump /dev/tty` 구조를 보고에 첨부 → spec §8 항목 9개 판정은 위원장(코디네이터 경유).
