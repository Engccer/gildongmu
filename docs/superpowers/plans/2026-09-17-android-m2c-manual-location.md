# 안드로이드 M2c — 현재 위치 수동 지정 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** M2 spec §13을 구현한다 — 수동 위치 스토어·판정·유효 좌표(앵커 > 수동 > GPS), M3 끝점 검색의 `EndpointPicker` 추출 재사용, 표시줄 버튼과 라벨 한 함수, 자동 해제 통지의 앱 큐 병합, 소비 화면의 수동 분기와 유도형 금지 표현 가드.

**Architecture:** :kit `ManualLocation.kt`(판정 순수 계층)는 무변경. `location/`에 스토어(KeyValueStore JSON, hydration Job)·판정(`run`: 재진입 join·30초 디바운스·CAS·silent 측위·`notify` 주입)·`EffectiveLocation`(앱 층 좌표 단일 진입점)을 세우고, `LocationStore`는 GPS 층으로 좁힌다(`gpsCoordinateForRanking` 개명·어댑터 이전·`silent` 인자). `a11y/AppNotices`는 덮이지 않는 1칸 큐이고 `StatusLine`이 스스로 읽어 한 문장으로 병합한다. M3 `DirectionsViewModel`의 끝점 검색을 `EndpointPicker`로 추출하고(공개 함수 위임, 테스트 무변경) `manualLocation` 타깃을 더한 뒤, `location/ManualLocationPickerScreen`이 그것을 연다.

**Tech Stack:** Kotlin · Compose · `navigation-compose` · kotlinx.serialization · coroutines(test) · :kit

**Spec:** `docs/superpowers/specs/2026-09-16-android-m2-place-nearby-design.md` §13(§1~§12 승계). 실행 방식: **inline**(과제가 `LocationStore`·`DirectionsViewModel`·`NearbyKindScreen`·`AppSourceGuardTest`를 순차로 건드리고 앞 과제 시그니처가 뒤 인터페이스를 정한다).

## Global Constraints

- 소유권: `location/`·`nearby/`·`a11y/`·`nav/`·`MainActivity`·`AppConfig`·`GildongmuApplication` 이 세션. `directions/`는 M3 종료 상태라 코디네이터 지시로 이 세션이 고친다(공개 함수 위임, **M3 테스트 전량 초록이 게이트**). `ios/**`·`src/**`·`packages/**`·`docs/BACKLOG.md`·`PROGRESS.md` 금지.
- 접근성: 착지는 `landingTarget`/`mergedRow(focus)`, 화면당 `StatusLine` 하나, 한 줄=한 객체, `contentDescription`은 낭독이 다를 때만, `disabled` 금지, 이모지 0.
- 문자열 신설 0(`manualLocation.*` 11·`android.nearby.aroundHereManual*`·`aroundLoadedManual`·`directions.*` 실재). `directions/DirectionsStrings.kt` `stringId` 표에 `manualLocation.pickTitle`·`useGps`·`locating` 추가.
- 취소는 삼키지 않는다(`settled`·`CancellationException` 통과). `runCatching` 금지.
- 커밋: pathspec만, 한국어 + `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`, push 금지. 게이트는 락 안에서만.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `location/ManualLocationStore.kt` (신설) | 런타임 정본 + JSON 영속 + hydration Job |
| `location/ManualLocationJudge.kt` (신설) | `run()`(트리거 3종 공용), `notify` 주입 |
| `location/EffectiveLocation.kt` (신설) | `coordinate(force)`·`coordinateForRanking()`·`nearbyCoordinateSource()` |
| `location/LocationStore.kt` | `silent` 인자, `currentFix`, `gpsCoordinateForRanking` 개명, 어댑터 삭제 |
| `location/LocationBar.kt` | `manualLocationLabel`, `locationBarLabel` v2(수동 갈래+꼬리), 버튼 행, `LaunchedEffect(manual == null)` |
| `location/ManualLocationRoutes.kt`·`ManualLocationPickerScreen.kt`·`ManualLocationPickerViewModel.kt` (신설) | 지정 화면(스택 라우트, picker 호스트, `commit`) |
| `a11y/AppNotices.kt` (신설) · `a11y/A11y.kt` | 앱 통지 큐 · `StatusLine` 병합(`mergeNotices`) |
| `directions/EndpointPicker.kt` (신설) · `DirectionsViewModel.kt` · `EndpointSearchContent.kt` · `EndpointSearchState.kt` · `DirectionsStrings.kt` · `EndpointLocator.kt` | 추출·`manualLocation` 타깃·`onBack`·표·ranking 경유 |
| `nearby/{NearbyKinds,NearbyStrings,NearbyStringsRes,NearbyScreenViewModel,NearbyFactories,NearbyKindScreen,NearbyHubScreen}.kt` · `AroundPayload.kt` | 둘러보기 수동 술어·통지·`manual` 주입·허브 StatusLine·resolver |
| `AppConfig.kt` · `GildongmuApplication.kt` · `MainActivity.kt` · `nav/{AppRoot,AppFactories}.kt` | 싱글턴·hydration·ON_START·배선 |
| 테스트 `test/.../location/{ManualLocationStoreTest,ManualLocationJudgeTest,EffectiveLocationTest,LocationBarTest,ManualLocationPickerViewModelTest}` · `a11y/AppNoticesTest` · `directions/EndpointPickerTest` · `nearby/NearbyKindsTest` 확장 · `nav/AppSourceGuardTest` 확장 · `test/resources/` 없음 | |

---

### Task 1: `ManualLocationStore` + hydration

**Files:** Create `location/ManualLocationStore.kt`; Modify `AppConfig.kt`, `GildongmuApplication.kt`; Test `location/ManualLocationStoreTest.kt`

**Interfaces (Produces):**
```kotlin
class ManualLocationStore(private val store: KeyValueStore, private val now: () -> Double = { System.currentTimeMillis() / 1000.0 }) {
    val current: StateFlow<ManualLocation?>; val verdict: StateFlow<ManualVerdict?>
    suspend fun hydrate()                      // IO에서 1회; 두 번째부터 no-op
    suspend fun awaitHydrated()                // current 읽기 전 호출(EffectiveLocation·Judge)
    fun set(label: String, labelRoman: String?, lat: Double, lng: Double, origin: ManualFix?)
    fun setVerdict(next: ManualVerdict); fun clear()
    companion object { const val KEY = "manualLocation"; fun isValid(m: ManualLocation): Boolean }
}
```

- [ ] **Step 1: 실패 테스트**
```kotlin
class ManualLocationStoreTest {
    private class Mem : KeyValueStore { val map = HashMap<String, String>(); override fun getString(key: String) = map[key]; override fun putString(key: String, value: String) { map[key] = value }; override fun remove(key: String) { map.remove(key) } }
    private fun manual(revision: Int = 1, origin: ManualFix? = ManualFix(37.5, 127.1, 20.0, 1000.0)) = ManualLocation(revision, "길동역", "Gildong", 37.5, 127.1, origin, 1000.0)

    @Test fun `set은 revision 단조·verdict 초기화·저장, clear는 삭제`() = runTest {
        val mem = Mem(); val s = ManualLocationStore(mem) { 2000.0 }; s.hydrate()
        s.set("길동역", "Gildong", 37.5, 127.1, ManualFix(37.5, 127.1, 20.0, 1990.0))
        assertEquals(1, s.current.value!!.revision); assertEquals(2000.0, s.current.value!!.setAt); assertNotNull(mem.map[ManualLocationStore.KEY])
        s.setVerdict(ManualVerdict.keep); assertEquals(ManualVerdict.keep, s.verdict.value)
        s.set("천호역", null, 37.6, 127.2, null); assertEquals(2, s.current.value!!.revision); assertNull(s.verdict.value)
        s.clear(); assertNull(s.current.value); assertNull(s.verdict.value); assertNull(mem.map[ManualLocationStore.KEY])
    }
    @Test fun `hydrate — 저장값 복원, 손상·범위 밖은 폐기(삭제), verdict는 비영속`() = runTest {
        val mem = Mem(); mem.map[ManualLocationStore.KEY] = KitJson.encodeToString(ManualLocation.serializer(), manual())
        val s = ManualLocationStore(mem); s.hydrate(); assertEquals("길동역", s.current.value!!.label); assertNull(s.verdict.value)
        val bad = Mem(); bad.map[ManualLocationStore.KEY] = KitJson.encodeToString(ManualLocation.serializer(), manual(origin = ManualFix(37.5, 127.1, 0.0, 1000.0)))
        val t = ManualLocationStore(bad); t.hydrate(); assertNull(t.current.value); assertNull(bad.map[ManualLocationStore.KEY])
        val junk = Mem(); junk.map[ManualLocationStore.KEY] = "{not json"; val u = ManualLocationStore(junk); u.hydrate(); assertNull(u.current.value)
    }
    @Test fun `isValid — 라벨 공백·NaN·범위 밖 거부`() {
        assertTrue(ManualLocationStore.isValid(manual()))
        assertFalse(ManualLocationStore.isValid(manual().copy(label = " ")))
        assertFalse(ManualLocationStore.isValid(manual().copy(lat = Double.NaN)))
        assertFalse(ManualLocationStore.isValid(manual().copy(lng = 181.0)))
        assertFalse(ManualLocationStore.isValid(manual().copy(setAt = Double.POSITIVE_INFINITY)))
        assertTrue(ManualLocationStore.isValid(manual(origin = null)))
    }
    @Test fun `awaitHydrated는 hydrate 완료를 기다린다(불변식: hydration 전 current 읽기 없음)`() = runTest {
        val mem = Mem(); mem.map[ManualLocationStore.KEY] = KitJson.encodeToString(ManualLocation.serializer(), manual())
        val s = ManualLocationStore(mem)
        val job = launch { s.hydrate() }
        s.awaitHydrated(); assertNotNull(s.current.value); job.join()
    }
}
```
`KeyValueStore`에 `remove(key)`가 없으면 인터페이스에 더한다(`SharedPreferencesStore` 구현 한 줄).

- [ ] **Step 2: 실행 → FAIL**
- [ ] **Step 3: 구현** — `hydrate()`: `CompletableDeferred<Unit>` `hydrated`; 첫 호출만 `store.getString(KEY)` → `runCatching`이 아니라 `try { KitJson.decodeFromString } catch (e: SerializationException) { null }` → `isValid` 실패면 `store.remove(KEY)` → `_current.value` → `hydrated.complete(Unit)`. `awaitHydrated() = hydrated.await()`. `set`: `ManualLocation(revision = (current?.revision ?: 0) + 1, …, setAt = now())`, `isValid` 통과 시에만 `_current`·`putString`·`_verdict = null`. `setVerdict`: 같으면 무시. `clear`: `_current = null; _verdict = null; remove`. `isValid`(iOS `isValid` 그대로).
  `AppConfig.manualLocationStore by lazy { ManualLocationStore(SharedPreferencesStore(app)) }`; `GildongmuApplication.onCreate`: `CoroutineScope(Dispatchers.IO).launch { AppConfig.manualLocationStore.hydrate() }`(앱 수명 스코프 `AppConfig.appScope`).
- [ ] **Step 4: PASS** → **Step 5: 커밋** `feat(android): M2c 1 — ManualLocationStore(JSON 영속·hydration Job·isValid·verdict 비영속)`

---

### Task 2: `LocationStore` — `silent`·`currentFix`·GPS 층으로 좁히기

**Files:** Modify `location/LocationStore.kt`; Test `location/LocationStoreTest.kt` 확장

**Interfaces (Produces):**
```kotlin
suspend fun currentCoordinate(force = false, timeoutMs = …, ttlSeconds = …, acceptAccuracy = …, silent: Boolean = false): NearbyCoord
/** 판정·지정용 실측 fix. 실패 null. `silent`는 lastFixFailed 미갱신(화면이 요청하지 않은 측위). */
suspend fun currentFix(force: Boolean, silent: Boolean): ManualFix?
suspend fun gpsCoordinateForRanking(): NearbyCoord?      // 옛 coordinateForRanking
// nearbyCoordinateSource() 삭제 → EffectiveLocation으로 이전(Task 3)
```

- [ ] **Step 1: 실패 테스트**(`LocationStoreTest` 기존 페이크)
```kotlin
@Test fun `silent 측위는 실패해도 lastFixFailed를 세우지 않고, 성공 fix는 stored를 갱신한다`() = runTest(dispatcher) {
    val src = FakeSource(); val s = store(src, FakeGate(LocationPermission.Fine))
    val d = async { s.currentFix(force = true, silent = true) }; runCurrent(); advanceTimeBy(8_001); runCurrent()
    assertNull(d.await()); assertFalse(s.lastFixFailed)
    val ok = async { s.currentFix(force = true, silent = true) }; runCurrent(); src.emit(accuracy = 12.0, lat = 37.9)
    val fix = ok.await()!!; assertEquals(37.9, fix.lat); assertEquals(12.0, fix.accuracy); assertEquals(37.9, s.stored?.lat)
    val loud = async { s.currentFix(force = true, silent = false) }; runCurrent(); advanceTimeBy(8_001); runCurrent()
    assertNull(loud.await()); assertTrue(s.lastFixFailed)
}
@Test fun `currentFix의 at은 epoch 초로 fix 나이를 뺀 값`() = runTest(dispatcher) { /* now 주입: LocationStore(src, gate, epochNow = { 1_000.0 }) → at == 1000 - age */ }
```
- [ ] **Step 2: FAIL** → **Step 3: 구현** — `currentCoordinate`에 `silent` 파라미터; `lastFixFailed = true` 세 자리를 `if (!silent) lastFixFailed = true`로; `currentFix`: `try { currentCoordinate(force, silent = silent); stored?.let { ManualFix(it.lat, it.lng, it.accuracy, epochNow() - ageOf(it)) } } catch (e: LocationException) { null }`(생성자에 `epochNow: () -> Double = { System.currentTimeMillis() / 1000.0 }`). `coordinateForRanking` → `gpsCoordinateForRanking`(호출부 `MainActivity`·`EndpointLocator`·`CurrentAddressStore`(`coordinateForDisplay`는 그대로) — 컴파일이 안내). `nearbyCoordinateSource()` 본문을 Task 3로 옮길 때까지 유지, Task 3에서 삭제.
- [ ] **Step 4: PASS** → **Step 5: 커밋**

---

### Task 3: `ManualLocationJudge` + `EffectiveLocation` + 배선(소비자 전수·ON_START·가드)

**Files:** Create `location/ManualLocationJudge.kt`, `location/EffectiveLocation.kt`; Modify `location/LocationStore.kt`(어댑터 삭제), `AppConfig.kt`, `MainActivity.kt`, `directions/EndpointLocator.kt`, `nav/AppSourceGuardTest.kt`; Test `location/ManualLocationJudgeTest.kt`, `location/EffectiveLocationTest.kt`

**Interfaces (Produces):**
```kotlin
class ManualLocationJudge(manual: ManualLocationStore, location: LocationStore, now: () -> Double, notify: (String) -> Unit, autoClearedText: () -> String, minIntervalSeconds: Double = 30.0) { suspend fun run(force: Boolean = false) }
class EffectiveLocation(location: LocationStore, manual: ManualLocationStore, judge: ManualLocationJudge) {
    suspend fun coordinate(force: Boolean): NearbyCoord; suspend fun coordinateForRanking(): NearbyCoord?; fun nearbyCoordinateSource(): NearbyCoordinateSource
}
// EndpointLocator: LocationStoreLocator(effective: EffectiveLocation, permissions) — currentCoordinate → effective.coordinate, coordinateForRanking → effective.coordinateForRanking
```

- [ ] **Step 1: 실패 테스트**(페이크는 `LocationStoreTest`의 `FakeSource`/`FakeGate`를 `internal`로 올려 공유)
```kotlin
class ManualLocationJudgeTest {
    // 헬퍼: store(mem, hydrated), location(src, gate), judge(notify 카운트, now var)
    @Test fun `수동 없음 → 측위 0·결과 없음`() …
    @Test fun `origin 없음 → undecidable, 측위 0`() …
    @Test fun `권한 Fine 아님 → undecidable, request 0`() …
    @Test fun `keep·drop·undecidable — drop은 clear + 통지 1회`() = runTest(dispatcher) {
        // origin (37.5,127.1,acc 20); fix (37.503,…) → ~330m → drop → current null, notify 1, text == autoCleared
        // fix 가까움 → keep; fix 없음(타임아웃) → undecidable
    }
    @Test fun `CAS — 판정 중 재지정이면 옛 결과 폐기(해제 없음·verdict 미기록)`() …
    @Test fun `동시 트리거 2회 → 측위 1회·통지 1회(join)`() …
    @Test fun `30초 안 재호출은 건너뜀, force는 예외`() …
    @Test fun `취소는 통과하고 결과를 남기지 않는다`() …   // job.cancel() during acquire → verdict 그대로 null
    @Test fun `silent — 판정 실패가 lastFixFailed를 세우지 않는다`() …
}
class EffectiveLocationTest {
    @Test fun `수동 우선·force는 judge 먼저·drop 뒤 GPS`() …
    @Test fun `ranking — 수동이면 측위 0, 없으면 gps`() …
    @Test fun `hydration 전 호출은 join 뒤 수동을 돌려준다`() …   // hydrate를 지연시키고 coordinateForRanking() 먼저 호출
    @Test fun `nearbyCoordinateSource — LocationException 번역·취소 통과`() …  // 옛 LocationStoreTest의 어댑터 테스트 이전
}
```
- [ ] **Step 2: FAIL** → **Step 3: 구현**
  `run(force)`: `manual.awaitHydrated()`; `inFlight?.let { it.join(); return }`(자기 Job 보관, `coroutineScope { launch }`가 아니라 호출자 스코프에서 `Job` 참조만 — 두 호출자가 다른 스코프일 수 있으므로 `Mutex` + `lastRunAt` 조합이 단순: `mutex.withLock { if (!force && now() - lastRunAt < minInterval) return; lastRunAt = now(); … }` — 재진입은 두 번째가 락을 기다렸다가 디바운스에 걸려 건너뛴다 → 측위 1회·통지 1회). 갈래는 spec §13-2. 취소: `withLock` 안 `currentFix`가 취소되면 `CancellationException`이 그대로 나가고 `setVerdict` 미도달.
  `EffectiveLocation`: `coordinate(force)`: `manual.awaitHydrated(); if (force) judge.run(force = true); manual.current.value?.let { return NearbyCoord(it.lat, it.lng) }; return location.currentCoordinate(force)`. `coordinateForRanking`: `awaitHydrated(); manual?.coord ?: location.gpsCoordinateForRanking()`. `nearbyCoordinateSource()`: 기존 어댑터 본문 이전(`LocationException` → `NearbyLocationError` 번역).
  `AppConfig`: `manualLocationJudge`·`effectiveLocation` lazy; `MainActivity`: `nearbyFactory(...) { AppConfig.effectiveLocation.nearbyCoordinateSource() }`, `coordinate = { AppConfig.effectiveLocation.coordinateForRanking() }`; `ON_START`: `lifecycle.addObserver(LifecycleEventObserver { _, e -> if (e == Lifecycle.Event.ON_START) lifecycleScope.launch { AppConfig.manualLocationJudge.run() } })`. `directionsLocator()` → `LocationStoreLocator(AppConfig.effectiveLocation, AppConfig.permissionGate)`.
  가드(`AppSourceGuardTest`): ① `location/` 밖 `:app` 소스에 `AppConfig.locationStore.`·`: LocationStore`·`LocationStore(` 참조 0(허용: `AppConfig.kt`) ② `MainActivity.kt`가 `Lifecycle.Event.ON_START` + `manualLocationJudge.run(` 둘 다 포함.
- [ ] **Step 4: PASS(+ 기존 `LocationStoreTest`·`DirectionsViewModelTest` 초록)** → **Step 5: 커밋**

---

### Task 4: `AppNotices` + `StatusLine` 병합 + 허브 `StatusLine` + 총체성 가드

**Files:** Create `a11y/AppNotices.kt`; Modify `a11y/A11y.kt`(`StatusLine`), `nearby/NearbyHubScreen.kt`, `nav/AppSourceGuardTest.kt`; Test `a11y/AppNoticesTest.kt`

**Interfaces (Produces):**
```kotlin
object AppNotices { val pending: StateFlow<Notice?>; fun post(text: String, spoken: String? = null); fun consume(seq: Int) }
/** 순수: 앱 통지가 있으면 앞에 붙여 한 문장, 결과는 nextSeq. 없으면 screen 그대로. */
fun mergeNotices(screen: Notice, app: Notice?, nextSeq: Int): Notice
```
- [ ] **Step 1: 실패 테스트** — `mergeNotices`: 앱 없음 → screen 동일 / 앱 있음 → `joinText(app.text, screen.text)`·spoken 같은 순서·seq == nextSeq / 화면 문장 빈 문자열이면 앱 문장만 / `AppNotices.post` 두 번 → 둘째가 첫째를 덮지 않는다(큐 1칸: 첫째 소비 전엔 둘째 보류 → `consume` 뒤 둘째 노출) / `consume(다른 seq)` 무시.
- [ ] **Step 2: FAIL** → **Step 3: 구현** — `AppNotices`: `pending` + `queue: ArrayDeque<Notice>`; `post`는 큐에 넣고 `pending`이 비었으면 승격; `consume(seq)`는 `pending.seq == seq`일 때만 다음으로. `StatusLine(notice)`: `val app by AppNotices.pending.collectAsState()`; `var counter = remember { mutableIntStateOf(notice.seq) }`; `val merged = remember(notice, app) { if (app == null) notice else mergeNotices(notice, app, ++counter.intValue) }`; `initialSeq = remember { notice.seq }`(화면 통지만); `LaunchedEffect(merged.seq) { if (app == null && merged.seq == initialSeq) return@LaunchedEffect; shown = 빈; withFrameNanos; shown = merged; if (app != null) AppNotices.consume(app.seq) }`. 허브: `StatusLine(Notice(0, ""))`를 첫 행 위에. 가드: `AppScreenScaffold(` 파일은 `StatusLine(`도 포함(allowlist `AppTopBar.kt`).
- [ ] **Step 4: PASS** → **Step 5: 커밋**

---

### Task 5: `EndpointPicker` 추출 + `manualLocation` 타깃 + `EndpointSearchContent(picker, p, onBack)`

**Files:** Create `directions/EndpointPicker.kt`; Modify `directions/{DirectionsViewModel,EndpointSearchContent,EndpointSearchState,DirectionsStrings,DirectionsScreen}.kt`; Test `directions/EndpointPickerTest.kt`(+ 기존 `DirectionsViewModelTest` 무변경 초록)

- [ ] **Step 1: 실패 테스트** `EndpointPickerTest` — `open(from)` 최근 목록 로드(스코프 from) / `submitCandidates` ranking 좌표를 검색에 실음·5건 절단·3-state 통지 / `selectCurrent`는 `from`·`manualLocation`에서만 `onSelect(Current, target)` / `selectAddress` 지오코딩 성공 시에만 / `close()`가 잡을 취소하고 상태 null / `postNotice` seq 증가 / `manualLocation.recentScope == to`.
- [ ] **Step 2: FAIL** → **Step 3: 구현** — `EndpointSearchState.kt`: `enum DirectionsFieldTarget { from, to, via, manualLocation }`, `recentScope`에 `manualLocation -> to`. `EndpointPicker(search, store, strings, io, scope, ranking, onSelect)`: 필드·함수를 `DirectionsViewModel` 550~672행에서 **이동**(복사 아님): `_state`(옛 `_endpointSearch`)·`consumedCandidateRevision`·`searchJob`·`geocodeJob`·`open`·`close`·`submitCandidates`(`locator.coordinateForRanking()` → `ranking()`)·`selectPlace/RecentEndpoint/Address/Current`(`selectCurrent` 가드 `target == from || target == manualLocation`; `refreshCurrentLocation` 호출 제거)·`select`(`onSelect(endpoint, target)` 호출 뒤 잡 취소·상태 null — 착지 발급 없음)·`removeRecentEndpoint/togglePin/clearRecentEndpoints`·`updatePicker`·`pickerNext`·`postNotice(text)`. `DirectionsViewModel`: `val picker = EndpointPicker(search, store, strings, io, viewModelScope, ranking = { locator.coordinateForRanking() }) { endpoint, target -> setEndpoint(endpoint, target); if (target == from && endpoint == Current) refreshCurrentLocation(); landing = if (target == from) Field(to) else Submit }`; `endpointSearch = picker.state`; 기존 공개 함수는 한 줄 위임(`fun openPicker(t) = picker.open(t)`, `fun closePicker() { val t = picker.state.value?.target ?: return; picker.close(); _state.update { landing = landingNext(Field(t)) } }`, `submitCandidates`·`selectPlace`… 전부 위임; `consumedCandidateRevision`은 `picker`로). `fieldText`의 `when`에 `manualLocation -> error("manualLocation은 길찾기 폼 필드가 아니다")`; `DirectionsScreen`의 `LandingTarget.Field` 소비 `when`에 `manualLocation -> null`(+`Log.w`). `EndpointSearchContent(picker, p, onBack)`: `vm.` 호출을 `picker.`로, 제목 `when`에 `manualLocation -> strings.get("manualLocation.pickTitle")`, 현재 위치 버튼 `if (p.target == from || p.target == manualLocation) Button(onClick = picker::selectCurrent) { Text(strings.get(if (p.target == manualLocation) "manualLocation.useGps" else "directions.useCurrentLocation")) }`, `AppScreenScaffold(title, onBack = onBack)`. `DirectionsScreen`: `EndpointSearchContent(vm.picker, p, onBack = vm::closePicker)`. `DirectionsStrings.stringId`에 3키.
- [ ] **Step 4: `EndpointPickerTest` + `DirectionsViewModelTest` + `DirectionsSourceGuardTest` PASS** → **Step 5: 커밋**

---

### Task 6: 지정 화면 + 표시줄 버튼 + 라벨 한 함수

**Files:** Create `location/ManualLocationRoutes.kt`(`@Serializable data object ManualLocationRoute`), `location/ManualLocationPickerViewModel.kt`, `location/ManualLocationPickerScreen.kt`; Modify `location/LocationBar.kt`, `nearby/NearbyHubScreen.kt`, `nav/{AppRoot,AppFactories}.kt`, `MainActivity.kt`, `directions/DirectionsStrings.kt`(`resourceStrings` 재사용); Test `location/LocationBarTest.kt` 확장, `location/ManualLocationPickerViewModelTest.kt`

**Interfaces (Produces):**
```kotlin
fun manualLocationLabel(manual: ManualLocation, verdict: ManualVerdict?, lang: String, accessible: Boolean, verified: (String) -> String, unverifiable: (String) -> String): String
class LocationBarWords(val needsPermission: String, val reducedAccuracy: String, val gps: String, val gpsNear: (String) -> String, val locating: String, val gpsFailed: String, val manual: (String) -> String, val manualUnverifiable: (String) -> String, val pickTitle: String)
fun locationBarLabel(input: LocationBarInput, manual: ManualLocation?, verdict: ManualVerdict?, lang: String, w: LocationBarWords): LineText   // 꼬리 ", pickTitle" 포함
@Composable fun LocationBarRow(store: CurrentAddressStore, manual: ManualLocationStore, onPick: () -> Unit, focus: FocusRequester)
class ManualLocationPickerViewModel(picker 조립 인자…, manual, location, now, onDone: () -> Unit) { val picker: EndpointPicker; val isCommitting: StateFlow<Boolean> }
```
- [ ] **Step 1: 실패 테스트** — `LocationBarTest`: 수동 verified → "지정한 위치, 길동역, 위치 지정하기" / undecidable → "지정한 위치, 길동역(위치 확인 불가), 위치 지정하기" / en + labelRoman → 시각 "Gildong (길동역)…" 낭독 로마자만 / 수동 없음 → §12-4 갈래 + 꼬리. `ManualLocationPickerViewModelTest`: `Place` + Fine → `currentFix` 1회·진행 통지 1회·`set` origin 있음·`onDone` 1회·연타 무시 / `Place` + None → `currentFix` 0·통지 0·origin null·`onDone` / `Current` → `clear`·측위 0·통지 0 / 취소(잡 cancel) → `set` 0·`onDone` 0.
- [ ] **Step 2: FAIL** → **Step 3: 구현** — VM: `picker = EndpointPicker(…, ranking = effective::coordinateForRanking) { endpoint, _ -> commit(endpoint) }`; `commit`: `if (committing) return; committing = true; scope.launch { try { when (endpoint) { Current -> manual.clear(); is Place -> { val origin = if (location.authorization() == Fine) { _isCommitting = true; picker.postNotice(strings.get("manualLocation.locating")); location.currentFix(force = true, silent = false)?.takeIf { isEligibleManualFix(it, now()) } } else null; manual.set(endpoint.label, endpoint.labelRoman, endpoint.lat, endpoint.lng, origin) } }; onDone() } finally { committing = false; _isCommitting = false } }`; `init { picker.open(manualLocation) }`. Screen: `EndpointSearchContent(vm.picker, p ?: return, onBack = { vm.cancel(); onBack() })`. `AppRoot`: `composable<ManualLocationRoute> { ManualLocationPickerScreen(factories.manualLocation { navController.popBackStack() }) { navController.popBackStack() } }`; 허브 `onPick = { returnFocus.slot.remember("location-bar"); navController.navigate(ManualLocationRoute) }`; 허브 resolver: `key == "location-bar"` → 표시줄 requester. `LocationBarRow`: `Button(onClick = onPick, Modifier.fillMaxWidth().tapTarget().testTag("location-bar").landingTarget(focus)) { Text(line.visual) }` + `semantics { if (spoken != visual) contentDescription = spoken }`; `LaunchedEffect(manual == null) { if (manual == null) store.ensureLoaded(...) }`.
- [ ] **Step 4: PASS** → **Step 5: 커밋**

---

### Task 7: 소비 화면 수동 분기 + 유도형 금지 표현 가드

**Files:** Modify `nearby/{NearbyKinds,NearbyStrings,NearbyStringsRes,NearbyScreenViewModel,NearbyFactories,NearbyKindScreen}.kt`, `nearby/AroundPayload.kt`(KDoc), `directions/DirectionsViewModel.kt`(`currentLocationText` 수동 분기 — `manual: () -> ManualLocation?`·`verdict` 생성자 인자 기본값 `{ null }`), `test/.../nearby/TestStrings.kt`, `nav/AppSourceGuardTest.kt`; Test `nearby/NearbyKindsTest.kt`·`NearbyLinesTest.kt` 확장, `directions/DirectionsViewModelTest.kt` 1건 추가

- [ ] **Step 1: 실패 테스트** — `usedManualCoordinate(payload, manual)` 정확 비교 / `NearbyKinds.around(..., manual)`의 `loadedNotice`가 수동이면 `aroundLoadedManual` / `aroundHereResId(payload, manual, hasPlace)` 4분기 / `DirectionsViewModel.fieldText(from)`가 수동이면 "출발지, 지정한 위치, 길동역" / 가드: 유니버스 파일 목록에 `LocationBar.kt` 포함 단언·GPS 키 유도(ko 값에 "현재 위치")·`KNOWN_UNBRANCHED` 죽은 항목 0·수동 키 전수 참조 ≥1.
- [ ] **Step 2: FAIL** → **Step 3: 구현** — `NearbyScreenViewModel(spec, coordinate, strings, savedState, manual: () -> ManualLocation? = { null })`·팩토리에서 `{ AppConfig.manualLocationStore.current.value }`; `AroundBody(payload, vm, …)`가 `vm.manual()`로 술어; `NearbyLines.kt`에 `usedManualCoordinate`·`aroundHereResId`; `NearbyStrings.aroundLoadedManual`; `DirectionsViewModel.currentLocationText` 첫 줄 `manual()?.let { return manualLocationLabel(it, verdict(), lang, accessible, …) }`(`MainActivity`가 `AppConfig.manualLocationStore`를 넘긴다). 가드(§13-4 ①~⑤) 구현: 유니버스 = 술어 5종 중 하나를 포함하는 `:app` kt; GPS 키 = `values/strings.xml` 파싱 → 값에 `manualLocation_gps` 값 포함하는 name 집합; 각 유니버스 파일이 참조하는 GPS 키 중 `KNOWN_UNBRANCHED` 밖은 그 파일이 수동 키(`manualLocation_manual`·`Manual`)도 참조해야 통과; `KNOWN_UNBRANCHED` 각 키는 유니버스 어느 파일에서든 참조돼야(죽은 항목 실패); 수동 키 전수(`name`에 `Manual` 또는 `manualLocation_manual`)는 6로케일 존재 + 참조 ≥1 + 값이 GPS 문구를 담지 않음.
- [ ] **Step 4: PASS** → **Step 5: 커밋**

---

### Task 8: 문서·가드 마무리·게이트·리뷰·통합

- [ ] CHANGELOG 맨 위 절에 M2c 항목(2~4줄 + spec §13) · README §1 트리(`location/` 신설 파일·`directions/EndpointPicker`) · spec §13-7 아래 구현 리뷰 판정 자리.
- [ ] 게이트(락): `until mkdir ~/gildongmu-wt/gate.lock …` → `:kit:test :app:testDebugUnitTest :app:assembleDebug :app:assembleExperimental :app:compileDebugAndroidTestKotlin` → `--stop` → vitest → `rmdir`.
- [ ] 구현 리뷰 2건(spec-compliance·code-quality, `model: opus`, `review-m2c-{spec,quality}.md`) → 반영 → 게이트 → `git rebase main`(움직였으면 게이트 재실행·CHANGELOG `comm -23`) → ff → 보고 ⑤.

## Self-review

- spec §13-1 → Task 1 · §13-2 → Task 2·3 · §13-3 → Task 5·6 · §13-4 → Task 6·7 · §13-5 → Task 4 · §13-6 → 각 Task Step 1 + Task 8 · 판정 32~38 → Task 5(32)·4(33)·3(34·35·38)·6(37) · 판정 36은 M4.
- 타입 일관: `EffectiveLocation.coordinateForRanking`(Task 3) ↔ `EndpointPicker.ranking`(Task 5) ↔ 지정 VM(Task 6); `ManualLocationStore.current`(Task 1) ↔ Task 3·6·7; `mergeNotices`/`AppNotices.consume`(Task 4) ↔ `ManualLocationJudge.notify`(Task 3, `AppNotices::post`); `EndpointSearchContent(picker, p, onBack)`(Task 5) ↔ Task 6; `locationBarLabel` v2(Task 6)가 M2b `LocationBarTest`를 대체(서명 변경 — 기존 단언은 `LocationBarWords`로 옮긴다).
- 플레이스홀더 0. 실행 순서는 파일 의존 순(1 → 2 → 3 → 4 → 5 → 6 → 7 → 8).
