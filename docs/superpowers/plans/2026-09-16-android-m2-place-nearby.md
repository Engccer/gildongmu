# 안드로이드 M2 장소 상세 + 내 주변 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 검색 결과 → 장소 상세(주소·영업시간·전화·외부 지도·이 장소 주변)와 내 주변 탭(둘러보기·지하철·버스·따릉이)이 한소네 7 점자·TalkBack으로 읽히고, 그것을 받치는 위치 계층·화면 스택·`NearbyLoadCore` 소비 관용구를 세운다.

**Architecture:** `:kit`의 `NearbyLoadCore`·`RevealWindow`·`NearbyService`·`PlaceHoursService`·`LocationFixPolicy`·문장 조립 함수를 `:app`이 조립한다. `location/LocationStore`(플랫폼 `LocationManager` 추상 `LocationSource` + 권한 게이트)가 좌표 어댑터를 주고, `nearby/NearbyScreenViewModel<P>`가 코어를 쥐며 화면은 phase만 그린다. 화면 이동은 골격 `nav/AppRoot`(Nav2, `eb7bf0f8`)에 등록 한 줄. 문자열은 ios-extra `ios.` 접두 키를 `android.*`로 개명해 들인다.

**Tech Stack:** Kotlin 2.4.20 · Compose BOM 2026.09.00(Material3 `TopAppBar`·`NavigationBar`) · navigation-compose 2.10.1 · lifecycle 2.11.0 · kotlinx-coroutines-test · `:kit` testFixtures · Node(생성 스크립트) · vitest · 공식 `android` CLI(실기기).

**Spec:** `docs/superpowers/specs/2026-09-16-android-m2-place-nearby-design.md`(§3 화면·접근성 계약, §4 위치 계층, §5 상태·모델, §7 i18n, §8 테스트, §9 실기기, §10 판정). 계획은 spec을 반복하지 않고 구현 단위로 자른다. M1 spec §3의 기본형(`mergedRow`·`headingText`·`StatusLine`·한 프레임 뒤 착지)은 승계.

## Global Constraints

- 서버 계약 변경 0. 라우트는 `NearbyService`·`PlaceHoursService`·`SearchService`가 이미 부르는 것만.
- `:kit`은 안드로이드 의존 0. **이번 마일스톤 동안 `:kit` FOUNDATION 파일·README §3 정규식 절·`RegexPortabilityTest`는 건드리지 않는다**(`android-kit-fix` 세션 소유, 코디네이터 지시). `nav/AppRoot.kt`의 `composable<DirectionsRoute>` 줄은 M3 소유 — 불변. `directions/` 패키지는 만들지 않는다.
- 소유: `nav/`(등록 한 줄만 바꾼다)·`a11y/`·`i18n/`·`net/`·`storage/`·`location/`·`place/`·`nearby/`·`search/`·매니페스트·gradle·`android/i18n/android-extra/`·`android/scripts/`·README(§3 정규식 절 제외). `ios/**`·`src/**`(기존 드리프트 테스트 개정·신설 vitest 제외)·`packages/**`·`docs/BACKLOG.md`·`PROGRESS.md` 수정 금지.
- 접근성(M1 §3 + M2 §3): 한 줄 = 한 객체(병합 컨테이너 한 곳에만 `contentDescription`), 화면마다 단일 polite `StatusLine`, `disabled` 금지, 48dp, 모든 컨트롤 `focusable`, 이모지 0, 착지는 `FocusRequester` 한 프레임 뒤, `LazyColumn` 금지.
- 인자 있는 문자열은 `appLocalized(res, id, args)`만(소스 가드가 잠근다). 문장은 호출 시점 람다로 ViewModel에 주입(M1 `SearchStrings` 관용구).
- 위치: `ACCESS_BACKGROUND_LOCATION` 문자열 0, GMS 의존 0, `LocationManager` 생성은 `location/` 한 곳, 권한 요청은 내 주변 화면 로드에서만.
- 커밋: pathspec, 한국어 메시지, 꼬리말 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. `origin` push 금지. 통합은 로컬 `main` ff-merge만(`git rebase main` → 게이트 → `git -C ~/Mac-Projects/gildongmu merge --ff-only feat/android-m1`), CHANGELOG `comm -23` 소실 대조.
- 게이트(락 안, README §7): `./gradlew :kit:test :app:testDebugUnitTest :app:assembleDebug :app:assembleExperimental` + `VITEST_MAX_THREADS=2 npm run test:run`(기지 실패 `xcstrings-plural` xcrun 1건은 기대값). `export ANDROID_HOME=~/Library/Android/sdk`. 끝나면 `./gradlew --stop`, `rmdir ~/gildongmu-wt/gate.lock`.
- 실기기 설치는 코디네이터 허가(④) 뒤에만. 접근성 트리는 `android layout --full --pretty`(README §2, 사용 전 `.claude/skills/android-cli/references/interact.md` 읽기).
- **통합 순서(코디네이터)**: Task 1(`location/`)은 단독으로 먼저 ff 통합한다(M3가 그 시그니처를 쓴다). 나머지는 Task 6까지 마친 뒤 리뷰 → ff.

---

## 파일 구조

```
android/app/src/main/AndroidManifest.xml                                   (+ FINE·COARSE 위치 권한)
android/app/src/main/kotlin/space/dodoplanet/gildongmu/
  location/LocationSource.kt        LocationSource 인터페이스 + RawFix (LocationManager 추상)
  location/AndroidLocationSource.kt LocationManager 구현(유일한 생성 지점)
  location/PermissionGate.kt        LocationPermission·PermissionGate 인터페이스 + AndroidPermissionGate(대기 슬롯 소유)
  location/LocationStore.kt         StoredFix·LocationException·LocationStore(currentCoordinate·coordinateForRanking·nearbyCoordinateSource)
  AppConfig.kt                      (+ locationStore·permissionGate 싱글턴)
  MainActivity.kt                   (+ 권한 런처 손 등록·해제; AppRoot에 factories 전달)
  nav/AppRoot.kt                    (NearbyRoute 자리표시 → NearbyHubScreen; place/nearby 스택 라우트 등록 3줄)
  nearby/NearbyRoutes.kt            NearbyKindRoute·BusRouteStopsRoute·NearbyKind·PlaceAnchor(JSON)
  nearby/NearbyStrings.kt           통지·문구 공급(호출 시점 람다)
  nearby/NearbyScreenViewModel.kt   코어 껍데기 + Landing + visibleCount + returnFocusKey
  nearby/NearbyKinds.kt             kind별 조립기(fetch·isEmpty·firstKey·loaded 문장·빈 문구·payload 타입)
  nearby/AroundPayload.kt           둘러보기 payload + settled 헬퍼
  nearby/NearbyLines.kt             subwayStationLine·subwayArrivalLine·busArrivalLine·bikeLine·bearingLabel·nearbyTitle
  nearby/NearbyHubScreen.kt         허브
  nearby/NearbyKindScreen.kt        공통 껍데기(TopAppBar·phase 스위치·착지·더 보기) + 4 도메인 본문
  nearby/BusRouteStopsScreen.kt     경유 정류소
  place/PlaceRoutes.kt              PlaceDetailRoute(placeJson) + Place JSON 왕복
  place/PlaceDetailViewModel.kt     hours·notice·복사·열기 판정
  place/ExternalOpen.kt             chooseFallback(순수) + openWithFallback(Intent)
  place/PlaceDetailScreen.kt        상세 화면
  search/SearchViewModel.kt         (+ coordinate 공급자·sort·naverBackedSeen·lastSubmittedQuery·toggleSort·returnFocusKey)
  search/SearchScreen.kt            (+ TopAppBar 제목, 행 버튼→상세, 토글, pop 복귀 착지)
  search/SearchRows.kt              (PlaceRow: onClick·거리 조각·spokenDistanceUnits)
android/app/src/test/kotlin/space/dodoplanet/gildongmu/
  location/LocationStoreTest.kt · nearby/NearbyScreenViewModelTest.kt · nearby/NearbyLinesTest.kt · nearby/AroundPayloadTest.kt
  place/ExternalOpenTest.kt · place/PlaceRoutesTest.kt · search/SearchViewModelTest.kt(확장) · nav/NavGuardTest.kt(소스 가드)
android/app/src/androidTest/.../nearby/NearbyScreenA11yTest.kt · place/PlaceDetailA11yTest.kt
android/scripts/messages-to-android-strings.mjs                     (ios-extra 도입·% 가드)
android/i18n/android-extra/{ko,en,es,fr,it,ja}.json                 (+ 신설 키 9)
android/i18n/arg-order.json · android/app/src/main/res/values*/strings.xml   (생성물)
src/lib/__tests__/android-strings-drift.test.ts                     (일반화 (4)·개명 arg-order 대조·% 가드)
```

---

### Task 1: `location/` 계층 — 첫 통합 조각 (spec §4)

**Files:**
- Create: `location/LocationSource.kt`, `location/AndroidLocationSource.kt`, `location/PermissionGate.kt`, `location/LocationStore.kt`
- Modify: `AppConfig.kt`(싱글턴), `MainActivity.kt`(권한 런처 손), `AndroidManifest.xml`(권한 2), `README.md` §1 트리
- Test: `test/.../location/LocationStoreTest.kt`, `test/.../nav/NavGuardTest.kt`(소스 가드: `LocationManager` 생성 1곳·`ACCESS_BACKGROUND_LOCATION` 0)

**Interfaces (Produces — M3도 이 시그니처를 쓴다):**
```kotlin
package space.dodoplanet.gildongmu.location

data class RawFix(val lat: Double, val lng: Double, val accuracyMeters: Double /* hasAccuracy() 거짓 → -1.0 */, val elapsedRealtimeMs: Long)

interface LocationSource {
    fun isLocationEnabled(): Boolean
    fun hasProvider(name: String): Boolean
    /** 구독 시작. 반환값을 close하면 removeUpdates. 콜백은 메인 스레드. */
    fun subscribe(provider: String, onFix: (RawFix) -> Unit): AutoCloseable
    fun elapsedRealtimeMs(): Long
    companion object { const val FUSED = "fused"; const val GPS = "gps"; const val NETWORK = "network" }
}

enum class LocationPermission { Fine, Coarse, None }
interface PermissionGate {
    fun current(): LocationPermission
    /** 시스템 다이얼로그(FINE+COARSE 동시) 뒤 재판정. 영구 거부면 다이얼로그 없이 즉시 None. */
    suspend fun request(): LocationPermission
}

class LocationException(val kind: Kind) : Exception(kind.name) { enum class Kind { Denied, ReducedAccuracy, Unavailable } }

class LocationStore(private val source: LocationSource, private val permissions: PermissionGate, private val log: (String) -> Unit = {}) {
    data class StoredFix(val lat: Double, val lng: Double, val accuracy: Double, val fixedAtElapsedMs: Long)
    var stored: StoredFix? ; var lastFixFailed: Boolean
    suspend fun currentCoordinate(force: Boolean = false, timeoutMs: Long = 8_000, ttlSeconds: Double = LocationFixPolicy.freshTTL, acceptAccuracy: Double = LocationFixPolicy.acceptAccuracy): NearbyCoord
    suspend fun coordinateForRanking(): NearbyCoord?
    fun nearbyCoordinateSource(): NearbyCoordinateSource
}
```

- [ ] **Step 1: 실패하는 테스트** — `LocationStoreTest.kt`(JUnit5 + `runTest`, 페이크 `FakeSource`(구독 콜백을 테스트가 직접 호출, `hasProvider` 집합, `enabled` 플래그, 가상 elapsed) + `FakeGate`(`current` 값, `request()` 호출 수·반환값)):

```kotlin
class LocationStoreTest {
    private class FakeSource(var enabled: Boolean = true, val providers: Set<String> = setOf(LocationSource.FUSED)) : LocationSource {
        var now = 100_000L; var listener: ((RawFix) -> Unit)? = null; var subscribedProvider: String? = null; var closed = 0
        override fun isLocationEnabled() = enabled
        override fun hasProvider(name: String) = name in providers
        override fun subscribe(provider: String, onFix: (RawFix) -> Unit): AutoCloseable { subscribedProvider = provider; listener = onFix; return AutoCloseable { closed++; listener = null } }
        override fun elapsedRealtimeMs() = now
        fun emit(accuracy: Double, ageSeconds: Double = 0.0, lat: Double = 37.5, lng: Double = 127.1) = listener!!(RawFix(lat, lng, accuracy, now - (ageSeconds * 1000).toLong()))
    }
    private class FakeGate(var value: LocationPermission, val afterRequest: LocationPermission = value) : PermissionGate {
        var requests = 0
        override fun current() = value
        override suspend fun request(): LocationPermission { requests++; value = afterRequest; return value }
    }
    private val dispatcher = StandardTestDispatcher()

    @Test fun `수용 정확도 fix가 오면 즉시 반환하고 구독을 닫는다`() = runTest(dispatcher) {
        val src = FakeSource(); val store = LocationStore(src, FakeGate(LocationPermission.Fine))
        val d = async { store.currentCoordinate() }; runCurrent()
        src.emit(accuracy = 12.0)
        assertEquals(NearbyCoord(37.5, 127.1), d.await()); assertEquals(1, src.closed); assertEquals(LocationSource.FUSED, src.subscribedProvider)
    }
    @Test fun `타임아웃이면 이번 취득의 최선값, 스토어 옛 값은 폴백이 아니다`() = runTest(dispatcher) {
        val src = FakeSource(); val store = LocationStore(src, FakeGate(LocationPermission.Fine))
        store.stored = LocationStore.StoredFix(1.0, 1.0, 20.0, src.now - 5_000) // 옛 값
        val d = async { store.currentCoordinate(force = true) }; runCurrent()
        src.emit(accuracy = 80.0, lat = 37.6); src.emit(accuracy = 60.0, lat = 37.7) // 둘 다 30m 초과, 100m 이하
        advanceTimeBy(8_001); assertEquals(NearbyCoord(37.7, 127.1), d.await())
        val d2 = async { store.currentCoordinate(force = true) }; runCurrent(); advanceTimeBy(8_001)
        assertEquals(LocationException.Kind.Unavailable, assertFailsWith<LocationException> { d2.await() }.kind) // 이번 취득 fix 0
    }
    @Test fun `캐시가 신선하고 정확하면 측위 없이 반환한다`() = runTest(dispatcher) { /* stored accuracy 10, age 30s → 구독 0 */ }
    @Test fun `COARSE만이면 ReducedAccuracy, 요청은 한 번만`() = runTest(dispatcher) { /* gate Coarse → 예외 kind ReducedAccuracy, subscribe 안 함 */ }
    @Test fun `권한 없음은 다이얼로그 뒤 재판정 — 거부면 Denied`() = runTest(dispatcher) { /* None→None: requests==1, Denied */ }
    @Test fun `기기 위치 꺼짐은 권한 뒤 취득 앞에서 즉시 Unavailable`() = runTest(dispatcher) { /* enabled=false, gate None→Fine: requests==1, subscribe 없음, Unavailable */ }
    @Test fun `융합 제공자가 없으면 GPS를 구독하고 로그를 남긴다`() = runTest(dispatcher) { /* providers = {gps}: subscribedProvider == gps */ }
    @Test fun `취소되면 구독을 닫는다`() = runTest(dispatcher) { /* d.cancel() → closed == 1 */ }
    @Test fun `ranking은 권한 없으면 팝업 없이 null, 실패는 스토어 폴백`() = runTest(dispatcher) { /* gate None: null, requests==0 ; Fine + timeout 2s + stored → stored 좌표 */ }
    @Test fun `hasAccuracy 거짓(-1)은 저장도 수용도 안 된다`() = runTest(dispatcher) { /* emit(-1.0) 뒤 timeout → Unavailable */ }
}
```
- [ ] **Step 2: 실패 확인** — `./gradlew :app:testDebugUnitTest --tests '*LocationStoreTest*'` → 컴파일 실패(클래스 없음).
- [ ] **Step 3: 구현** — `LocationStore.kt`:

```kotlin
class LocationStore(private val source: LocationSource, private val permissions: PermissionGate, private val log: (String) -> Unit = {}) {
    data class StoredFix(val lat: Double, val lng: Double, val accuracy: Double, val fixedAtElapsedMs: Long)
    var stored: StoredFix? = null
    var lastFixFailed: Boolean = false; private set
    private fun ageOf(fix: StoredFix) = (source.elapsedRealtimeMs() - fix.fixedAtElapsedMs) / 1000.0

    suspend fun currentCoordinate(force: Boolean = false, timeoutMs: Long = 8_000, ttlSeconds: Double = LocationFixPolicy.freshTTL, acceptAccuracy: Double = LocationFixPolicy.acceptAccuracy): NearbyCoord {
        stored?.let { if (!force && canReuseCachedFix(it.accuracy, ageOf(it), ttlSeconds, acceptAccuracy)) return NearbyCoord(it.lat, it.lng) }
        var permission = permissions.current()
        if (permission == LocationPermission.None) permission = permissions.request()      // 다이얼로그(영구 거부면 즉시 None)
        when (permission) { LocationPermission.None -> throw LocationException(Kind.Denied); LocationPermission.Coarse -> { lastFixFailed = true; throw LocationException(Kind.ReducedAccuracy) }; LocationPermission.Fine -> Unit }
        if (!source.isLocationEnabled()) { lastFixFailed = true; throw LocationException(Kind.Unavailable) } // 권한 뒤, 취득 앞(spec §4)
        return try { acquireGatedFix(timeoutMs, acceptAccuracy).also { lastFixFailed = false } } catch (e: LocationException) { lastFixFailed = true; throw e }
    }

    private suspend fun acquireGatedFix(timeoutMs: Long, acceptAccuracy: Double): NearbyCoord {
        val provider = when { source.hasProvider(LocationSource.FUSED) -> LocationSource.FUSED; source.hasProvider(LocationSource.GPS) -> LocationSource.GPS; else -> throw LocationException(Kind.Unavailable) }
        log("locationProvider=$provider")
        var best: StoredFix? = null                       // 이번 취득 한정(iOS oneShotBest) — 스토어 옛 값은 후보가 아니다
        val accepted = CompletableDeferred<NearbyCoord>()
        val subscription = source.subscribe(provider) { raw ->
            val age = (source.elapsedRealtimeMs() - raw.elapsedRealtimeMs) / 1000.0
            if (isStorableFix(raw.accuracyMeters, age)) {
                val fix = StoredFix(raw.lat, raw.lng, raw.accuracyMeters, raw.elapsedRealtimeMs)
                stored = fix
                if (isBetterFix(raw.accuracyMeters, best?.accuracy)) best = fix
            }
            if (shouldAcceptFix(raw.accuracyMeters, age, acceptAccuracy)) accepted.complete(NearbyCoord(raw.lat, raw.lng))
        }
        try {
            return withTimeoutOrNull(timeoutMs) { accepted.await() } ?: best?.let { NearbyCoord(it.lat, it.lng) } ?: throw LocationException(Kind.Unavailable)
        } finally { subscription.close() }
    }

    suspend fun coordinateForRanking(): NearbyCoord? {
        if (permissions.current() != LocationPermission.Fine) return null   // 팝업 없음
        return try { currentCoordinate(timeoutMs = (LocationFixPolicy.softTimeout * 1000).toLong(), ttlSeconds = LocationFixPolicy.softTTL, acceptAccuracy = LocationFixPolicy.storeCeiling) }
        catch (e: LocationException) { stored?.let { NearbyCoord(it.lat, it.lng) } }
    }

    fun nearbyCoordinateSource(): NearbyCoordinateSource = NearbyCoordinateSource.Current { force ->
        try { currentCoordinate(force) } catch (e: LocationException) {
            throw when (e.kind) { Kind.Denied -> NearbyLocationError.Denied; Kind.ReducedAccuracy -> NearbyLocationError.ReducedAccuracy; Kind.Unavailable -> NearbyLocationError.Unavailable }
        }
    }
}
```
(NETWORK 동시 구독은 `subscribe`를 두 번 부르고 둘 다 닫는다 — `hasProvider(GPS) && hasProvider(NETWORK)`일 때만.) `AndroidLocationSource(context)`: `LocationManager` + `LocationRequest.Builder(1_000).setQuality(LocationRequest.QUALITY_HIGH_ACCURACY).build()` + `requestLocationUpdates(provider, request, ContextCompat.getMainExecutor(context), listener)`, `RawFix(loc.latitude, loc.longitude, if (loc.hasAccuracy()) loc.accuracy.toDouble() else -1.0, loc.elapsedRealtimeNanos / 1_000_000)`. `AndroidPermissionGate(context)`: `current()`는 `checkSelfPermission` 둘로 판정; `request()`는 `CompletableDeferred<LocationPermission>` 목록에 매달리고 `launcher?.invoke(arrayOf(FINE, COARSE))`(손이 없으면 즉시 `current()`); `attach(launch: (Array<String>) -> Unit)`·`detach()`·`deliver()`는 대기자 전부 `current()`로 재개, 대기자 없으면 로그만. `MainActivity.onCreate`: `val launcher = registerForActivityResult(RequestMultiplePermissions()) { AppConfig.permissionGate.deliver() }; AppConfig.permissionGate.attach { launcher.launch(it) }`, `onDestroy`: `detach()`. `AppConfig`: `val permissionGate by lazy { AndroidPermissionGate(app) }`, `val locationStore by lazy { LocationStore(AndroidLocationSource(app), permissionGate) { Log.i("Location", it) } }` — `app`은 `Application` 컨텍스트(초기화는 `MainActivity`가 `AppConfig.init(applicationContext)` 1회, 또는 `Application` 서브클래스 — 후자로: `GildongmuApp : Application`, 매니페스트 `android:name`).
- [ ] **Step 4: 통과 확인 + 소스 가드** — `NavGuardTest`(이름은 소스 가드 파일): `LocationManager` 생성(`getSystemService(LocationManager::class.java)`·`LOCATION_SERVICE`)이 `location/AndroidLocationSource.kt` 한 곳뿐, `ACCESS_BACKGROUND_LOCATION` 0, `play-services` 0(gradle 포함).
- [ ] **Step 5: 커밋 + 첫 ff 통합** — `feat(android): 위치 계층 — LocationStore(캐시·권한·정밀도·게이트 취득·이번 취득 최선값)·PermissionGate 대기 슬롯·NearbyCoordinateSource 어댑터`. 게이트(락) → `git rebase main` → 게이트 → ff → 코디네이터에 SHA + 시그니처 보고.

### Task 2: 문자열 — ios-extra `ios.` 접두 일괄 도입·`%@` 재작성·`%` 가드·신설 키 (spec §7)

**Files:**
- Modify: `android/scripts/messages-to-android-strings.mjs`, `android/i18n/android-extra/*.json`(6), `src/lib/__tests__/android-strings-drift.test.ts`
- Generated: `android/i18n/arg-order.json`, `res/values*/strings.xml`

**Produces:** 리소스 `android_nearby_*`·`android_place_*`·`android_route_*`·`android_common_*`·`android_unit_spokenMeters`·`android_station_*` 등(개명 규칙 `ios.X` → `android.X`).

- [ ] **Step 1: 실패하는 vitest** — 드리프트 테스트에 추가: (a) `buildAndroidStrings()`에 `android.nearby.subway`(개명 도입)가 있고 `dataSources.walkHealth`(웹 오버라이드)는 없다 (b) `android.nearby.subwayEmptyNearest` ko = "주변에 지하철역이 없습니다. 가장 가까운 역은 %1$s, %2$s 거리입니다" (c) `rejected`에 `%` 잔존 검사: 값 `"a %@ b"`를 넣은 가짜 카탈로그로 `renderStringsXml`이 거부 (d) (4) 일반화: android-extra의 모든 `android.X`에 `ios.X`가 있으면 6로케일 동일, 예외는 `INTENDED_DIFFERENCES = { "android.common.geoDeniedDesc": "...", "android.common.geoReducedDesc": "...", "android.nearby.subwayEmptyNearest": "%@ → 명명 플레이스홀더", "android.nearby.subwayClosed": "같음" }` (e) 개명 arg-order 대조: `android/i18n/arg-order.json`의 `android.X` 순서 == `ios/i18n/arg-order.json`의 `ios.X` 순서(재작성 2키 제외).
- [ ] **Step 2: 실패 확인** — `VITEST_MAX_THREADS=2 npx vitest run src/lib/__tests__/android-strings-drift.test.ts`.
- [ ] **Step 3: 구현** — 스크립트: `const iosExtra = buildCatalog({ namespaces: [], extraDir: IOS_EXTRA_DIR, output: null })`; `for key of Object.keys(iosExtra.strings)`: `ios.` 접두만 `android.` + 나머지로 개명해 `strings`·`argOrder`에 넣고(android-extra 같은 키가 있으면 android-extra 우선), 비접두 키는 `ignoredIosOverrides++`(로그 `[android-strings] ios-extra 웹 오버라이드 N키 무시`). `%` 스캐너: `function hasStrayPercent(v) { let i=0; while ((i=v.indexOf('%',i))>=0) { if (v.startsWith('%%',i)) { i+=2; continue } const m=/^%\d+\$s/.exec(v.slice(i)); if (!m) return true; i+=m[0].length } return false }` → `rejected`. android-extra 6로케일에 신설: `android.common.back`("뒤로"/"Back"/"Atrás"/"Retour"/"Indietro"/"戻る"), `android.common.noAppToOpen`, `android.common.locationFailed`, `android.common.locationOff`, `android.common.geoDeniedDesc`, `android.common.geoReducedDesc`, `android.nearby.announceRouteStops`("경유 정류소 {count}곳" — en "{count} stops on route", …), `android.nearby.subwayEmptyNearest`(ios 문안에서 `%@`→`{station}`, `{distance}`), `android.nearby.subwayClosed`(`%@`→`{time}`). 번역은 ios-extra 각 로케일 원문을 그대로 두고 지정자만 바꾼다. `node android/scripts/messages-to-android-strings.mjs --update-arg-order`.
- [ ] **Step 4: 통과 확인** — vitest 파일 + `./gradlew :app:assembleDebug`(aapt2가 새 리소스를 받는다) + `LocalizedCallSiteGuardTest` 그대로 초록.
- [ ] **Step 5: 커밋** — `feat(android): ios-extra ios. 접두 키 일괄 도입(android.* 개명)·%@ 키 재작성·% 잔존 가드·신설 키 9`.

### Task 3: `nearby/` 공통 — ViewModel 껍데기·kind 조립기·문장 조립 (spec §3-5·§3-6~3-9·§5)

**Files:**
- Create: `nearby/NearbyRoutes.kt`, `nearby/NearbyStrings.kt`, `nearby/NearbyScreenViewModel.kt`, `nearby/NearbyKinds.kt`, `nearby/AroundPayload.kt`, `nearby/NearbyLines.kt`
- Test: `nearby/NearbyScreenViewModelTest.kt`, `nearby/NearbyLinesTest.kt`, `nearby/AroundPayloadTest.kt`

**Interfaces:**
```kotlin
@Serializable enum class NearbyKind { around, subway, bus, bike }
@Serializable data class PlaceAnchor(val lat: Double, val lng: Double, val name: String, val nameRoman: String? = null)
@Serializable data class NearbyKindRoute(val kind: NearbyKind, val anchorJson: String? = null)   // anchorJson = KitJson.encodeToString(PlaceAnchor)
@Serializable data class BusRouteStopsRoute(val source: String, val cityCode: String?, val routeId: String, val routeNo: String)

class NearbyStrings(val checking: () -> String, val announceEmpty: () -> String, val refreshFailed: () -> String, val refreshDenied: () -> String, val refreshReduced: () -> String, val outOfCoverage: () -> String,
    val announceStations: (Int) -> String, val announceStops: (Int) -> String, val announceBikes: (Int) -> String, val announceRouteStops: (Int) -> String, val aroundLoaded: () -> String,
    val subwayEmptyNearest: (String, String) -> String, val spokenMeters: () -> String, val lang: () -> String, val dataLocale: () -> String)

sealed class Landing { data object None : Landing(); data class Key(val key: String, val rev: Int) : Landing() }

class NearbyKindSpec<P : Any>(val coverage: NearbyCoverage, val fetch: suspend (NearbyCoord?) -> P, val isEmpty: (P) -> Boolean, val firstKey: (P) -> String?, val loadedNotice: (P) -> String, val emptyCopy: () -> String)

class NearbyScreenViewModel<P : Any>(spec: NearbyKindSpec<P>, coordinate: NearbyCoordinateSource, private val strings: NearbyStrings, private val savedState: SavedStateHandle) : ViewModel() {
    val phase: StateFlow<NearbyLoadPhase<P>>; val notice: StateFlow<Notice>; val landing: StateFlow<Landing>; val visibleCount: StateFlow<Int>
    var consumedLanding: Int   // 비저장
    fun load(force: Boolean = false)
    fun revealMore(totalCount: Int, keyAt: (Int) -> String)
    fun rememberReturnFocus(key: String); fun takeReturnFocus(): String?   // SavedStateHandle "returnFocus"
}
object NearbyKinds { fun subway(service: NearbyService, strings: NearbyStrings): NearbyKindSpec<SubwayNearbyResult>; fun bus(...): NearbyKindSpec<List<BusStop>>; fun bike(...): NearbyKindSpec<List<BikeStation>>; fun around(...): NearbyKindSpec<AroundPayload>; fun busRouteStops(service, strings, source, cityCode, routeId): NearbyKindSpec<List<BusRouteStop>> }
// NearbyLines.kt
data class LineText(val visual: String, val spoken: String)
fun subwayStationLine(isEn: Boolean, lang: String, stationName: String, nameEn: String?, lines: List<String>, linesEn: List<String>?): LineText
fun subwayArrivalLine(arrival: SubwayArrival, isEn: Boolean, segmentText: (SubwayArrivalSegment) -> String, express: String, currentLocation: (String) -> String): String
fun busArrivalLine(arrival: BusArrival, routeNo: (String) -> String, lowFloor: String, stopsBefore: (Int) -> String, minutesAway: (String) -> String): String
fun busStopHeading(stop: BusStop, lang: String): LineText ; fun bikeLine(station: BikeStation, lang: String, bikesAvailable: (Int) -> String, racksTotal: (Int) -> String): LineText
fun bearingLabel(bearing: String, direction: (String) -> String?, suffixed: (String) -> String): String?
fun nearbyTitle(base: String, anchor: PlaceAnchor?, lang: String): String
```

- [ ] **Step 1: 실패하는 테스트** — `NearbyScreenViewModelTest`(코어는 :kit 실물, 전송은 `stubbedClient` + `Fixtures.kit("subway-nearby.json")` 본문, 좌표는 `NearbyCoordinateSource.Fixed(NearbyCoord(37.5, 127.0))`, `MainDispatcherExtension`):
  - 첫 로드 → `Loaded`, `notice.text == "주변 역 N곳"`(페이크 문장), `landing == Key(firstStationName, 1)`.
  - 새로고침(force) 재조회 → 착지 rev 그대로(발급 없음), 통지는 다시.
  - 0건 응답(`{"stations":[],"nearest":null}`) → `Loaded` + `isEmpty` 참 + 통지 `subwayEmpty`; 이어 N건 재조회 → 착지 발급 1회(첫 키 null→값).
  - Loaded 뒤 502 → phase 유지 + 통지 `refreshFailed`.
  - `Fixed` 앵커가 한국 밖(35.0, 139.0) → `OutOfCoverage`, 서버 호출 0(`StubTransport` 호출 수).
  - `revealMore`: 25건 payload에서 `visibleCount` 10→20, `landing == Key(keyAt(10), rev+1)`.
  - `rememberReturnFocus("place-k1")` 뒤 `takeReturnFocus()`는 한 번만 값을 준다.
  `NearbyLinesTest`: `subwayStationLine`(ko/en, en 결측 시 ko), `subwayArrivalLine` 문장형·원문형(공유 fixture `subway-arrival-prose-cases.json`의 키 열 전수를 `segmentText` 페이크로 돌려 미매핑 0 — fixture 로더 `Fixtures.shared`), `busArrivalLine`(arrivalMessage 있음/없음), `bikeLine`, `bearingLabel("ne")`·미지 → null, `nearbyTitle(anchor 비-ko primary)`. `AroundPayloadTest`: 하나 실패 → Loaded + 플래그, 둘 실패 → throw(코어 FailedServer), 취소는 `CancellationException` 그대로.
- [ ] **Step 2: 실패 확인**.
- [ ] **Step 3: 구현** — `NearbyScreenViewModel`: `core = NearbyLoadCore(coordinate, spec.coverage, fetch = { coord, _ -> spec.fetch(coord) }, willCommit = { reveal.reset(); _visibleCount.value = reveal.visibleCount }, onEvent = ::onEvent)`; `onEvent`: `Loaded(p)` → `notice = next(spec.loadedNotice(p))`, 착지: `val key = spec.firstKey(p); if (previousFirstKey == null && key != null) _landing.value = Landing.Key(key, ++rev); previousFirstKey = key` · `RefreshFailed` → `strings.refreshFailed()` · `PermissionLost` → `refreshDenied` · `AccuracyLost` → `refreshReduced` · `WentOutOfCoverage` → `outOfCoverage` · `EmptyResult` → 없음. `load(force)`는 `viewModelScope.launch { core.load(force) }`. `AroundPayload.kt`: `suspend fun <T> settled(block: suspend () -> T): Result<T>`(`try { Result.success(block()) } catch (e: CancellationException) { throw e } catch (e: Exception) { Result.failure(e) }`), `around` fetch는 `coroutineScope { val o = async { settled { service.nearbyOverview(...) } }; val p = async { settled { service.surroundings(...) } } ... }`, 둘 다 실패면 첫 예외를 throw. `NearbyKinds.subway`: `fetch = { c -> service.subwayArrivals(c!!.lat, c.lng, strings.dataLocale()) }`, `isEmpty = { it.stations.isEmpty() }`, `firstKey = { it.stations.firstOrNull()?.stationName }`, `loadedNotice = { r -> if (r.stations.isEmpty()) r.nearest?.let { n -> strings.subwayEmptyNearest(nearestLabel(n), formatDistance(n.distanceMeters)) } ?: strings.announceEmpty() else strings.announceStations(r.stations.size) }`. `NearbyLines.kt`는 iOS 함수를 그대로 옮긴다(`subwayArrivalLine`은 `TransitDisplay.pickLine` + `subwayArrivalProse*`, `bilingualName`, `joinText`).
- [ ] **Step 4: 통과 확인**.
- [ ] **Step 5: 커밋** — `feat(android): 내 주변 공통 — NearbyScreenViewModel(코어 껍데기·첫 착지 키 전이·리빌·복귀 키)·kind 조립기 5종·문장 조립`.

### Task 4: `nearby/` 화면 — 허브·공통 껍데기·4 도메인 본문·경유 정류소 + 골격 등록 (spec §3-4~3-9)

**Files:**
- Create: `nearby/NearbyHubScreen.kt`, `nearby/NearbyKindScreen.kt`, `nearby/BusRouteStopsScreen.kt`, `a11y/AppTopBar.kt`(공통 상단 바: 제목 헤딩·뒤로·동작 슬롯)
- Modify: `nav/AppRoot.kt`(`composable<NearbyRoute> { NearbyHubScreen(nav) }` + `composable<NearbyKindRoute>`·`composable<BusRouteStopsRoute>` 2줄 추가 — `DirectionsRoute` 줄 불변), `MainActivity.kt`(factories 조립: `nearbyFactory(kind, anchor)`)
- Test: `androidTest/.../nearby/NearbyScreenA11yTest.kt`(앵커 고정 + 스텁 전송, ATF + 첫 역 헤딩 착지 + 병합 노드)

**Interfaces:**
```kotlin
@Composable fun AppTopBar(title: String, onBack: (() -> Unit)?, actions: @Composable RowScope.() -> Unit = {})   // 제목 Text에 headingText(), 뒤로 IconButton contentDescription = android_common_back
@Composable fun NearbyHubScreen(onOpen: (NearbyKind) -> Unit, returnFocus: String?)
@Composable fun NearbyKindScreen(route: NearbyKindRoute, vm: NearbyScreenViewModel<*>, onOpenPlace: (Place) -> Unit, onOpenRouteStops: (BusRouteStopsRoute) -> Unit, onBack: () -> Unit)
@Composable fun BusRouteStopsScreen(route: BusRouteStopsRoute, vm: NearbyScreenViewModel<List<BusRouteStop>>, onBack: () -> Unit)
```

- [ ] **Step 1: androidTest 작성**(실기기 레인, 머신 게이트 밖) — `NearbyScreenA11yTest`: `createAndroidComposeRule<ComponentActivity>()`(v2), `MaterialTheme { NearbyKindScreen(NearbyKindRoute(subway, anchorJson), vm, {}, {}, {}) }`, `waitUntil { vm.phase.value is Loaded }`, `onNodeWithTag("station-강남역").assertIsFocused()`, `tryPerformAccessibilityChecks()`.
- [ ] **Step 2: 구현** — `NearbyKindScreen`: `Scaffold(topBar = AppTopBar(nearbyTitle(...), onBack, actions = { IconButton(onClick = { vm.load(force = true) }, Modifier.testTag("refresh").semantics { if (phase is Loading) stateDescription = checking }) { Icon(Icons.Filled.Refresh, contentDescription = stringResource(R.string.android_common_refresh)) } }))`; 본문 `Column + verticalScroll`: `StatusLine(notice)` → `when (phase)` 표(§3-5): `Loading/Idle` → `Text(checking)`; `Loaded` → `if (spec.isEmpty) Text(emptyCopy, contentDescription = spokenDistanceUnits) else body(kind)`; `Denied` → `Text(geoDeniedTitle).headingText().focusRequester(causeFocus)` + `Text(android_common_geoDeniedDesc)` + `Button(openSettings) { context.startActivity(appDetailsIntent) }`; `ReducedAccuracy` → 같은 꼴 + `Button(allowPrecise) { scope.launch { if (AppConfig.permissionGate.request() != Fine) openSettings() else vm.load(force = true) } }`; `OutOfCoverage` → `Text(outOfCoverage)`; `UnavailableHere(r)` → 문구; `FailedLocation` → `if (!locationEnabled) headingText(locationOff) + Button(openSettings → ACTION_LOCATION_SOURCE_SETTINGS) else headingText(locationFailed)`; `FailedServer` → `headingText(failedTitle)`; `Empty` → `headingText(failedTitle)`. 착지: `LaunchedEffect(landing) { val l = landing as? Key ?: return; if (l.rev > vm.consumedLanding) { vm.consumedLanding = l.rev; withFrameNanos {}; focusMap[l.key]?.requestFocus() } }`; 전락 착지: `LaunchedEffect(phase::class) { if (phase is Denied || ReducedAccuracy || OutOfCoverage) { withFrameNanos {}; causeFocus.requestFocus() } }`(첫 로드에서도 원인 헤딩 착지 — 진입 뒤 첫 낭독이 원인이 되게). 도메인 본문 4개는 §3-6~3-9 표대로(`Modifier.mergedRow("station-$name", spoken)` 헤딩은 `.headingText()` 추가, 버스 도착 행은 `clickable(onClickLabel = routeStopsHint, role = Button)`, 둘러보기 장소 행은 `PlaceRow(place, lang, onClick)` 재사용(Task 6에서 onClick 추가) + 더 보기 `Button(showMore) { vm.revealMore(places.size) { i -> "place-${places[i].id}" } }`). `NearbyHubScreen`: `AppTopBar(android_tab_nearby, onBack = null)` + 버튼 4개(`Modifier.testTag("hub-$kind").focusRequester(...)`), pop 복귀: `LaunchedEffect(returnFocus) { returnFocus?.let { withFrameNanos {}; requesters[it]?.requestFocus() } }`. `AppRoot`: `composable<NearbyRoute> { entry -> val vm = viewModel<HubReturnViewModel>(entry); NearbyHubScreen(onOpen = { k -> vm.rememberReturnFocus("hub-$k"); nav.navigate(NearbyKindRoute(k)) }, returnFocus = vm.takeReturnFocus()) }` 등.
- [ ] **Step 3: 컴파일·단위 테스트·assemble 통과 확인**(androidTest는 실기기).
- [ ] **Step 4: 커밋** — `feat(android): 내 주변 허브·공통 껍데기(상단 바·phase 본문·원인 헤딩 착지·새로고침)·둘러보기/지하철/버스/따릉이·경유 정류소`.

### Task 5: `place/` — 장소 상세 (spec §3-2·§6)

**Files:**
- Create: `place/PlaceRoutes.kt`, `place/PlaceDetailViewModel.kt`, `place/ExternalOpen.kt`, `place/PlaceDetailScreen.kt`
- Modify: `nav/AppRoot.kt`(`composable<PlaceDetailRoute>` 1줄), `MainActivity.kt`(factory)
- Test: `place/ExternalOpenTest.kt`, `place/PlaceRoutesTest.kt`, `place/PlaceDetailViewModelTest.kt`, `androidTest/.../place/PlaceDetailA11yTest.kt`

**Interfaces:**
```kotlin
@Serializable data class PlaceDetailRoute(val placeJson: String) { companion object { fun of(place: Place) = PlaceDetailRoute(KitJson.encodeToString(Place.serializer(), place)) }; val place: Place get() = KitJson.decodeFromString(Place.serializer(), placeJson) }
class PlaceStrings(val copied: () -> String, val noAppToOpen: () -> String, val hoursLine: (String) -> String, val allDay: () -> String, val closed: () -> String, val nextDay: (String) -> String)
class PlaceDetailViewModel(val place: Place, private val hours: PlaceHoursService, private val strings: PlaceStrings, io: CoroutineDispatcher = Dispatchers.IO) : ViewModel() {
    val hoursLine: StateFlow<String?>; val notice: StateFlow<Notice>
    fun onCopied(); fun onOpenFailed()
    val kakaoPlaceId: String?   // "kakao-" 접두
}
data class OpenPlan(val primary: String, val fallback: String?)   // ExternalOpen.kt
fun naverRoutePlan(dest: RouteDestination, appId: String): OpenPlan?  // null → 버튼 숨김
fun kakaoRoutePlan(dest: RouteDestination): OpenPlan?
fun kakaoPlacePlan(id: String): OpenPlan
fun hoursLineText(h: PlaceHoursToday, s: PlaceStrings): String
fun Context.openWithFallback(plan: OpenPlan, onFailed: () -> Unit)   // ACTION_VIEW, ActivityNotFoundException → fallback → onFailed
```

- [ ] **Step 1: 실패하는 테스트** — `ExternalOpenTest`: `naverRoutePlan` primary = `buildNaverRouteDeeplink(walk, …)`, fallback = `buildKakaoWebRouteUrl(walk, …)`; 권역 밖 좌표(빌더 null)면 null; `kakaoPlacePlan("123").fallback == "https://place.map.kakao.com/123"`. `PlaceRoutesTest`: `Place` JSON 왕복(옵션 필드 null 포함). `PlaceDetailViewModelTest`: hours 200 → 문장 "오늘 영업시간 09:00~18:00 (Google Maps)", 429·404·`{"hours":null}` → null(줄 없음, 통지 없음), `hoursLineText(allDay)`·`closed`·`closesNextDay`; `onCopied` → notice "주소 복사됨"(seq 증가), `kakaoPlaceId`.
- [ ] **Step 2: 실패 확인**.
- [ ] **Step 3: 구현** — 화면은 §3-2 표 순서 그대로 `Column`: 보조 줄(`clearAndSetSemantics {}`), 분류, 주소 3쌍(`Text(appLocalized(res, R.string.android_place_roadAddressLine, v))` + `Button(copyRoadAddress) { clipboard.setPrimaryClip(...); vm.onCopied() }`), `hoursLine?.let { Text(it) }`, 전화 `Button(appLocalized(callLine, phone)) { context.startActivity(Intent(ACTION_DIAL, "tel:…".toUri())) 실패 시 vm.onOpenFailed() }`, 홈페이지(비카카오·http/https), 헤딩 `android_route_section`, 외부 지도 3(플랜 null이면 미노출), 헤딩 `android_place_nearbyHeading`, 앵커 버튼 3(`onOpenNearby(kind)` → `NearbyKindRoute(kind, anchorJson)`; 복귀 키 `anchor-$kind`). 진입 착지: `LaunchedEffect(Unit) { withFrameNanos {}; titleFocus.requestFocus() }`(§9-6 판정 뒤 제거 가능). 길찾기 프리필 2버튼·채팅은 **자리만**(주석으로 예약, 코드 없음).
- [ ] **Step 4: 통과 확인**.
- [ ] **Step 5: 커밋** — `feat(android): 장소 상세 — 주소 3종+복사·영업시간(E24)·전화·홈페이지·외부 지도 3(폴백·null 숨김)·이 장소 주변 3행`.

### Task 6: 검색 화면 변경 — 행 활성화·거리·좌표 직렬·리뷰순 토글·pop 복귀·상단 바 (spec §3-3)

**Files:**
- Modify: `search/SearchViewModel.kt`, `search/SearchScreen.kt`, `search/SearchRows.kt`, `nav/AppRoot.kt`(`composable<SearchRoute>`가 `onOpenPlace` 배선), `MainActivity.kt`(factory에 `coordinate = { AppConfig.locationStore.coordinateForRanking() }`)
- Test: `search/SearchViewModelTest.kt`(확장), `search/SearchRowsTest.kt`(순수 문장: 거리 조각·spoken)

**Interfaces:**
```kotlin
class SearchViewModel(service, store, dataLocale, strings, savedState, io, private val coordinate: suspend () -> NearbyCoord? = { null })
data class SearchUiState(..., val sort: PlaceSort = PlaceSort.accuracy, val canSortByReview: Boolean = false)
fun toggleSort(); fun rememberReturnFocus(key: String); fun takeReturnFocus(): String?
@Composable fun PlaceRow(place: Place, lang: String, spokenMeters: String, onClick: (() -> Unit)? = null, modifier: Modifier = Modifier)
```

- [ ] **Step 1: 실패하는 테스트** — `SearchViewModelTest` 추가: (a) `coordinate = { delay(500); NearbyCoord(37.5, 127.0) }` → 요청 URL에 `lat=37.5`(직렬: 좌표 전에 `/api/places` 호출 0), `distanceMeters` 있는 응답이 행에 흐른다 (b) `placesProvider: "merged"` 응답 뒤 `canSortByReview`(dataLocale ko) 참, en이면 거짓 (c) `toggleSort()`: `queryState`가 마지막 제출 질의로 되돌아가고 URL에 `sort=review`, `resultsRevision`은 오르되 착지 발급 없음(`landFocus=false` — `consumedRevision`을 미리 올린다) (d) 리뷰순 장소 트랙 실패(`/api/places` 502) → `sort`가 accuracy로 롤백, 일반 제출 실패는 롤백 없음 (e) 검색 중 토글 무시 (f) `rememberReturnFocus/takeReturnFocus` 1회 소비, `outcome == null`이면 `takeReturnFocus()`가 null. `SearchRowsTest`: `placeSecondaryLine(place, lang)` = "분류, 주소, 약 120m", spoken = `spokenDistanceUnits(..., "미터")`.
- [ ] **Step 2: 실패 확인**.
- [ ] **Step 3: 구현** — `submit(landFocus: Boolean = true)`: `val coord = coordinate()`(직렬) → `service.search(trimmed, coord?.lat, coord?.lng, lang, sort)`; `naverBackedSeen = naverBackedSeen || result.placesProvider in setOf("merged", "naver-local")`; 롤백 `if (!landFocus && requestedSort == sort && result.places.isFailed) sort = accuracy`; `landFocus == false`면 `consumedRevision = resultsRevision + 1`. `toggleSort()`: `if (isSearching || lastSubmittedQuery.isEmpty()) return; sort = flip; setBucket(null); setRegion(null); setQuery(lastSubmittedQuery); submit(landFocus = false)`. 화면: `AppTopBar(app_title, onBack = null)`(본문 제목 제거), 토글 `Button` 자리는 최근 검색 다음·결과 앞, `PlaceRow(onClick = { vm.rememberReturnFocus("place-${place.id}"); onOpenPlace(place) })`, pop 복귀 `LaunchedEffect(Unit) { vm.takeReturnFocus()?.let { key -> withFrameNanos {}; rowFocus[key]?.requestFocus() } }`(`rowFocus`는 `place-{id}` 키 맵, `outcome == null`이면 VM이 null을 준다).
- [ ] **Step 4: 통과 확인**.
- [ ] **Step 5: 커밋** — `feat(android): 검색 — 장소 행 활성화→상세·좌표 가중(직렬)·거리 표기·네이버 리뷰순 토글·pop 복귀 착지·상단 바`.

### Task 7: 게이트·리뷰·통합·실기기 (spec §8·§9)

- [ ] **Step 1: 게이트**(락) — 전체 + `LocalizedCallSiteGuardTest`·`NavGuardTest`·vitest 드리프트.
- [ ] **Step 2: 리뷰** — 별도 컨텍스트 서브에이전트 2건(spec-compliance: spec §3~§7 표 대조 / code-quality), 입력은 spec + 계획 + `git diff main...HEAD`. 지적 반영 → 재확인.
- [ ] **Step 3: 문서** — README §1 트리(`location/`·`nearby/`·`place/`), §6 앱 문자열 절(ios-extra 도입 규칙·`%` 가드·INTENDED_DIFFERENCES), CHANGELOG M2 항목(3~4줄 + spec 링크), spec §9 절차(`android layout`), `kit-fix` 통합 뒤 위임 주석 2건(`QuickExitTextTest.kt`·`FinalApproach.kt`).
- [ ] **Step 4: 통합** — `git rebase main`(`AppRoot.kt` directions 줄 충돌은 M3 쪽 유지) → 게이트 → `comm -23` → ff → report.md ⑤ + 코디네이터 SendMessage(SHA·APK 경로·실기기 항목 16개·역이식 후보 3).
- [ ] **Step 5: 실기기**(기기 잡히면) — ④ 허가 → `android install --apks=app-experimental.apk` → `android layout --full --pretty -o ~/gildongmu-wt/android-m1-reports/layout-m2-*.json` → spec §9 항목 결과를 보고에.

---

## 자기 검토

- **spec 커버리지**: §3-1(상단 바·pop 복귀 → T4 `AppTopBar`·T6/T4 복귀), §3-2(T5), §3-3(T6), §3-4~3-9(T3·T4), §4(T1), §5(T3), §6(T5·T1·T4), §7(T2), §8(각 Task 테스트 + T7 가드), §9(T7), §10-1/16(T1), 10-17/18(T2 키 + T4), 10-19(T5 `OpenPlan?`), 10-20(T6), 10-21(T4·T6). 빠진 것 없음.
- **플레이스홀더**: "…"는 코드 생략 표기가 아니라 같은 꼴 반복 자리(각 Task에 원형이 있다). TBD 0.
- **타입 일관성**: `NearbyKindRoute(kind, anchorJson)`·`PlaceAnchor`·`Landing.Key(key, rev)`·`NearbyStrings`·`OpenPlan`·`LocationException.Kind`가 Task 간 같은 이름.
- **구현 방식 판정**: 순차 의존(T1 → T3 → T4/T6, T2 → T4/T5)이고 `AppRoot.kt`·`MainActivity.kt`를 여러 Task가 만지므로 **inline 실행**(M1과 같다). 리뷰만 별도 컨텍스트.
