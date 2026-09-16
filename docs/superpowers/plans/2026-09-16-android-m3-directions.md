# 안드로이드 M3 길찾기 브리핑 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 길찾기 탭에서 출발지·도착지(·경유지)를 확정하고 한 번의 조회로 대중교통·자동차·도보 브리핑을 점자·TalkBack으로 읽게 한다(실시간 안내 시작 제외).

**Architecture:** `directions/` 패키지 하나. 판정은 전부 :kit(수정 0), :app은 (1) 문자열 키 → 리소스 조회 `Strings` (2) 순수 문장 조립(`TransitLegText`·`RouteText`) (3) `DirectionsViewModel` 상태 머신 (4) Compose 화면. 위치는 `EndpointLocator` 세 함수 뒤에서 main의 `LocationStore`·`PermissionGate` 통과 호출. 프리필은 1회 소비 `StateFlow` 스토어 + `NavController.openDirections()`.

**Tech Stack:** Kotlin 2.4 · Compose BOM 2026.09 · navigation-compose 2.10.1 · lifecycle 2.11 · kotlinx.serialization 1.11 · kotlinx.coroutines 1.11 · JUnit5 + kotlin-test · :kit testFixtures(`stubbedClient`·`Fixtures`·`InMemoryKeyValueStore`).

**Spec:** `docs/superpowers/specs/2026-09-16-android-m3-directions-design.md`(설계 확정 `2e5cba11`). 계약 대조 대상: iOS `ios/Gildongmu/Directions/DirectionsTabView.swift`·`DirectionsEndpointSearchView.swift`·`ios/Gildongmu/RouteBriefing.swift`.

**구현 방식 판정(자율성 헌장)**: inline. 근거 — 태스크 2~5가 한 패키지의 같은 타입(`DirectionsUiState`·`Strings`)을 순차로 넓히고 화면 태스크가 앞 셋을 전부 소비한다(선행 결정이 후속 인터페이스를 바꾼다). 서브에이전트는 리뷰 2건(spec-compliance·code-quality, `model: opus`)에만.

## Global Constraints

- 소유 파일: `android/app/src/main/kotlin/space/dodoplanet/gildongmu/directions/**`, 같은 경로의 `test/`·`androidTest/`, `android/i18n/android-extra/*.json`(additive), `android/app/src/main/res/values*/strings.xml`(**생성물** — 스크립트로만), `android/i18n/arg-order.json`(스크립트가 갱신), `nav/AppRoot.kt`(등록 한 줄 + import 한 줄), `CHANGELOG.md`(자기 항목). 그 밖 수정 금지(`android/kit/**`·`ios/**`·`src/**`·gradle·매니페스트·`MainActivity`·`a11y/`·`nav/` 나머지).
- :kit API 표면은 API 31까지(README §3). `\d`·`\s`·`\w` 금지, 문자 클래스 `[` 이스케이프, KDoc 안 `/*` 금지, `runCatching`을 suspend·async 안에서 금지(`CancellationException` 삼킴).
- 인자 있는 문자열은 `appLocalized(res, id, args)`만(`LocalizedCallSiteGuardTest`). `stringResource(id, args)` 금지.
- 접근성: 한 줄 = 한 객체(비상호작용 `mergedRow`, 상호작용 `clickable(role) + clearAndSetSemantics`), 단일 `StatusLine`, `disabled` 금지(`stateDescription`), 48dp, 이모지 0, `LazyColumn` 금지.
- 커밋: pathspec(`git add <파일>`), 한국어 메시지, 꼬리말 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. `origin` push 금지.
- 무거운 게이트(gradle·vitest)는 머신 락 안에서만(README §7). 태스크 중간 단위 테스트는 `:app:testDebugUnitTest --tests '…'` 한 클래스씩 — 그것도 락 안에서(Gradle 데몬 하나).

---

### Task 1: 문자열 — android-extra 키 추가 + 리소스 재생성

**Files:**
- Modify: `android/i18n/android-extra/{ko,en,es,fr,it,ja}.json`(additive)
- Generate: `android/app/src/main/res/values*/strings.xml`, `android/i18n/arg-order.json`(스크립트)

**Interfaces:** Produces 리소스 `R.string.android_route_{totalDistance,durationMinutes,taxiFare,tollFare,fare,transfers,walkMinutes,board,alight,stopCount,stationCount,legMinutes}`, `android_directions_searching`, `android_common_{outOfCoverage,openSettings,allowPrecise,geoDeniedDesc,geoReducedDesc,expanded,collapsed}`, `android_unit_spokenMeters`.

- [ ] **Step 1: 복사 스크립트(1회용, 스크래치)** — `ios/i18n/ios-extra/{lang}.json`의 `ios.route.*`(12키)·`ios.directions.searching`·`ios.common.{outOfCoverage,openSettings,allowPrecise}`·`ios.unit.spokenMeters`를 `android.*`로 각 로케일 android-extra에 삽입(중첩 JSON, 기존 키 보존, 2칸 들여쓰기 + 끝 개행). `android.common.geoDeniedDesc`·`geoReducedDesc`는 M2 spec §7 문안(ko "설정에서 길동무의 위치 접근을 허용해 주세요" / "대략적인 위치만 허용되어 있습니다. 정확한 위치를 허용해 주세요"), 비-ko는 ios-extra의 `geoDeniedDesc` 영문 계열을 참고해 같은 뜻으로. `android.common.expanded`/`collapsed`: ko 펼침/접힘, en Expanded/Collapsed, es Expandido/Contraído, fr Développé/Réduit, it Espanso/Ridotto, ja 展開/折りたたみ.
- [ ] **Step 2: 생성** — `node android/scripts/messages-to-android-strings.mjs` 실행. 기대: `[arg-order] … (등록 N)` 성공, exit 0. `--check`로 재실행해 최신 확인.
- [ ] **Step 3: 확인** — `grep -c 'android_route_' android/app/src/main/res/values/strings.xml` = 12, `values-ja`에도 존재. `android.common.geoDeniedDesc`가 있으면 M2 rebase 시 양쪽 보존(같은 문안).
- [ ] **Step 4: Commit** — `git add android/i18n/android-extra android/i18n/arg-order.json android/app/src/main/res` → `feat(android): 길찾기 문자열 — ios.route·common·unit 키를 android.*로 6로케일 추가, 펼침·접힘 신설`.

### Task 2: 기반 타입 — `Strings`·`EndpointJson`·`EndpointLocator`·`DirectionsPrefill`

**Files:**
- Create: `directions/DirectionsStrings.kt`, `directions/EndpointJson.kt`, `directions/EndpointLocator.kt`, `directions/DirectionsPrefill.kt`
- Test: `test/.../directions/EndpointJsonTest.kt`, `test/.../directions/DirectionsPrefillStoreTest.kt`, `test/.../directions/CatalogStrings.kt`(테스트 페이크 — messages/{lang}.json + ios-extra→android.* + android-extra를 `formatLocalized`로 푼다)

**Interfaces (Produces):**
```kotlin
fun interface Strings { fun get(key: String, vararg args: Any): String }          // 키 = messages 키("route.transit.legWalkTo", "android.route.board")
fun resourceStrings(res: Resources): Strings                                      // 리터럴 when 매핑(키 ~50개). 미매핑 키: check(BuildConfig.DEBUG 아님) → 릴리스는 키 문자열
@Serializable sealed class EndpointJson { data object Current; data class Place(label, lat, lng, labelRoman) }
fun DirectionsEndpoint.toJson(): String ; fun endpointFromJson(s: String?): DirectionsEndpoint?
interface EndpointLocator { suspend fun currentCoordinate(force: Boolean): NearbyCoord; suspend fun coordinateForRanking(): NearbyCoord?; suspend fun requestPreciseLocation(): Boolean }
class LocationStoreLocator(store: LocationStore, permissions: PermissionGate) : EndpointLocator
fun directionsLocator(): EndpointLocator = LocationStoreLocator(AppConfig.locationStore, AppConfig.permissionGate)
enum class DirectionsPrefillRole { from, to }
data class DirectionsPrefill(role, label, lat, lng, labelRoman: String? = null)
object DirectionsPrefillStore { val pending: StateFlow<DirectionsPrefill?>; fun offer(p); fun take(p): Boolean /* compareAndSet(p, null) */ }
fun NavController.openDirections(prefill: DirectionsPrefill)
```

- [ ] **Step 1: 실패 테스트** — `EndpointJsonTest`: `Current` 왕복, `Place(label,lat,lng,roman=null)` 왕복(labelRoman 키 생략), 잘못된 문자열 → null. `DirectionsPrefillStoreTest`: `offer` 뒤 `pending.value` 같음, `take(p)` true 뒤 null, 두 번째 `take` false.
- [ ] **Step 2: 실행해 실패 확인** — `./gradlew :app:testDebugUnitTest --tests 'space.dodoplanet.gildongmu.directions.*'`(락 안). 컴파일 실패 기대.
- [ ] **Step 3: 구현** — `EndpointJson`은 `KitJson`으로 인코딩(`explicitNulls=false`라 roman null 생략). `Strings` `when` 매핑 표(키 → `R.string.xxx`)는 Task 3·4가 쓰는 키 전부: `directions.{from,to,via,searchFrom,searchTo,searchVia,currentLocation,currentLocationNear,useCurrentLocation,refreshingCurrent,swap,submit,addVia,removeVia,viaArrived,unsupportedWaypoint,needEndpoints,locating,loading,geoError,readySummary,allFailed,candidateCount,candidateNone,candidateError,coordError,walkRecommended,walkShortest}`, `route.{public,car}`, `route.pedestrian.{heading,summary,noRoute,error,stepFreeToggle}`, `route.briefing.error`, `route.transit.{noRoute,error,recommended,alternativeHeading,alternativeFastest,alternativeFewestTransfers,alternativeFastestFewestTransfers,busNo,legBoardExit,legServiceOutside,legWalkTo,legWalkToNoDistance,legWalkToExit,legWalkToExitNoDistance,legWalkToDest,legWalkToDestNoDistance}`, `android.route.*`(12), `android.directions.searching`, `android.common.{outOfCoverage,openSettings,allowPrecise,geoDeniedDesc,geoReducedDesc,expanded,collapsed}`, `android.unit.spokenMeters`, `android.tab.directions`, `recent.{title,clearAll,delete,deleted,cleared,pin,unpin,pinned,clearedExceptPinned}`, `recentRoutes.{title,item,itemVia,clearAll,cleared}`, `transitGuide.exitBound`, `actions.close`, `search.{label,clear,button}`, `android.search.{prompt,searching}`. 인자 있는 키는 `appLocalized(res, id, *args)`, 없는 키는 `res.getString(id)`. `openDirections` = `DirectionsPrefillStore.offer(prefill); navigate(DirectionsRoute) { popUpTo(graph.findStartDestination().id) { saveState = true }; launchSingleTop = true; restoreState = true }`.
- [ ] **Step 4: 통과 확인** — 같은 명령.
- [ ] **Step 5: Commit** — `feat(android): 길찾기 기반 타입 — 문자열 조회·필드 JSON·EndpointLocator(LocationStore 통과)·프리필 스토어`.

### Task 3: 문장 조립 — `TransitLegText.kt`·`RouteText.kt`

**Files:**
- Create: `directions/TransitLegText.kt`, `directions/RouteText.kt`
- Test: `test/.../directions/TransitLegTextTest.kt`, `test/.../directions/RouteTextTest.kt`(`CatalogStrings("ko")`·`("ja")`·`("en")` + `Fixtures.kitJson("route-transit.json", TransitRouteEnvelope.serializer())` 등)

**Interfaces (Produces):**
```kotlin
data class LegLine(val visual: String, val spoken: String)
fun transitLegLine(legs: List<TransitRouteLeg>, index: Int, destinationName: String?, lang: String, dataLocale: DataLocale, strings: Strings): LegLine
fun alightLine(leg: TransitRouteLeg, lang: String, dataLocale: DataLocale, strings: Strings): String?      // :kit alightLineText 래핑(exitBound = strings.get("transitGuide.exitBound", it))
fun transitAlternativeName(route: TransitRoute, strings: Strings): String
fun transitSummaryText(summary: TransitRouteSummary, lang: String, strings: Strings): String
fun walkDisplayMinutes(b: WalkRouteBriefing): Int ; fun walkSummaryText(b: WalkRouteBriefing, strings: Strings): String
fun carSummaryText(b: CarRouteBriefing, lang: String, strings: Strings): String
fun walkStepItems(b: WalkRouteBriefing, viaLabel: String?, strings: Strings): List<String>   // 구획 행 포함, 번호 = 원본 인덱스+1, notice step 0 생략
fun carStepItems(b: CarRouteBriefing, viaLabel: String?, strings: Strings): List<String>
fun wonText(amount: Int, lang: String): String
```

- [ ] **Step 1: 실패 테스트** — spec §9 목록: fixture 추천 경로 5구간 ko 문장(예: "길동까지 도보 4분, 178m", "수도권 5호선, 길동에서 승차, 천호에서 하차, 2 정거장, 4분 소요", 마지막 "목적지까지 도보 1분, 72m"; `destinationName="강남역"` → "강남역까지 도보 1분, 72m") / 승차 출구 배타: `exit.board="3"`이 있는 지하철 leg 앞에 도보 leg → 도보 줄 "길동 3번 출구까지 도보 4분, 178m", 탑승 줄엔 없음; 도보 없이 탑승 시작 → 탑승 줄 끝 "3번 출구로 진입" / 하차 줄 4조합(quickExit·alight 유무) / ja+en: `lang="ja"`, `dataLocale=en`, 영문 조각 완비 → 구간 줄 영어(`visual` "Line 5 (수도권 5호선)…" 아님 — 노선은 `lineNameEn` 그대로, 역명만 병기), 하차 줄 일본어 카탈로그 / en 결손 하나 → 한국어 줄 / 노선 `" "` → "번 버스" 없음 / 빈 `toName` + destinationName → 이름 갈래 / `walkStepItems`: notice 스텝 생략 뒤 번호 "2. …" 유지, `waypoint.stepIndex=2` 앞에 "경유지 X 도착" / `carStepItems`: guidance 비면 name, 거리 0 생략 / `walkDisplayMinutes(1806)==30`이고 `WalkCollapse.shouldCollapse(1806)==false` 동일성 / 대안 이름 4갈래 / `wonText(22600,"ko")=="22,600"`.
- [ ] **Step 2: 실패 확인** → **Step 3: 구현**(spec §3-4-a~d 그대로; `bilingualName(lang, ko, en, roman=null)`은 승차·하차 역명에만) → **Step 4: 통과** → **Step 5: Commit** `feat(android): 길찾기 문장 조립 — 구간 줄·하차 줄·요약·스텝(출구 한 줄 규칙·en 원자성·원본 인덱스 번호)`.

### Task 4: 상태 머신 — `EndpointSearchState`·`DirectionsViewModel`

**Files:**
- Create: `directions/EndpointSearchState.kt`, `directions/DirectionsViewModel.kt`
- Test: `test/.../directions/DirectionsViewModelTest.kt`(`MainDispatcherExtension`, `stubbedClient`, 페이크 `EndpointLocator`, `InMemoryKeyValueStore`, `CatalogStrings("ko")`)

**Interfaces (Produces):** spec §4 그대로. 생성자:
```kotlin
class DirectionsViewModel(
    private val routes: RouteService, private val search: SearchService, private val store: RecentSearchStore,
    private val locator: EndpointLocator, private val dataLocale: () -> String, private val strings: Strings,
    private val savedState: SavedStateHandle, private val prefill: StateFlow<DirectionsPrefill?> = DirectionsPrefillStore.pending,
    private val takePrefill: (DirectionsPrefill) -> Boolean = DirectionsPrefillStore::take,
    private val io: CoroutineDispatcher = Dispatchers.IO, private val queryTimeoutMs: Long = 15_000,
) : ViewModel()
val state: StateFlow<DirectionsUiState>; val endpointSearch: StateFlow<EndpointSearchState?>
var consumedResultsRevision / consumedWalkRefetch / consumedPrefillFocus: Int   // 화면 비저장 소비 세대
fun openPicker(target); fun closePicker(); fun submitCandidates(); fun selectPlace(place); fun selectAddress(address); fun selectCurrent()
fun swap(); fun clearVia(); fun runQuery(); fun toggleStepFree(); fun requestPreciseLocation()
fun activateRecentRoute(r); fun removeRecentRoute(r): String?; fun togglePinRecentRoute(r); fun clearRecentRoutes()
fun removeRecentEndpoint(e): String?; fun togglePinRecentEndpoint(e); fun clearRecentEndpoints()
fun fieldText(target, accessible: Boolean): String   // spec §3-1 표 2·4·5 라벨 조립(현재 위치 값 포함)
```
핵심 코드(타임아웃 박스 — 그대로 옮긴다):
```kotlin
private class QueryTimeout : Exception("query timeout")
private suspend fun <T> settle(block: suspend () -> T): Result<T> =
    try { Result.success(block()) } catch (e: CancellationException) { throw e } catch (e: Exception) { Result.failure(e) }
private suspend fun <T> timed(block: suspend () -> T): Result<T> =
    withTimeoutOrNull(queryTimeoutMs) { settle(block) } ?: Result.failure(QueryTimeout())
```
프리필 소비(`init`): `viewModelScope.launch { prefill.collect { p -> if (p != null && takePrefill(p)) applyPrefill(p) } }`.

- [ ] **Step 1: 실패 테스트** — spec §9 첫 묶음 전부(끝점 부재·3수단 성공·transit `{}` → Empty·15초 초과(전송 `delay(20_000)` + `advanceTimeBy`)·측위 3실패·requestPrecise·후쿠오카 OutOfCoverage 호출 0·서버 마커·경유지·계단 회피·취소·swap·승격·프리필 2종+살아 있는 채 소비·최근 경로 삭제 착지·끝점 검색 5·5·3-state·지오코딩 실패·닫힘 중 지오코딩 무효·JSON 왕복).
- [ ] **Step 2: 실패 확인** → **Step 3: 구현**(spec §4) → **Step 4: 통과** → **Step 5: Commit** `feat(android): 길찾기 상태 머신 — 3수단 병렬·15초 Result 박스·커버리지·출입구 승격·계단 회피 재조회·끝점 검색·최근 경로·프리필 소비`.

### Task 5: 화면 — `DirectionsScreen`·`EndpointSearchContent`·`RouteRows` + 등록

**Files:**
- Create: `directions/DirectionsScreen.kt`, `directions/EndpointSearchContent.kt`, `directions/RouteRows.kt`
- Modify: `nav/AppRoot.kt`(자리표시 줄 → `DirectionsScreen()`, import 1)
- Test: `androidTest/.../directions/DirectionsScreenA11yTest.kt`(실기기 레인), `test/.../directions/DirectionsSourceGuardTest.kt`(`directions/`에 `android.location`·`LocationManager`·`stringResource(…,`·`LazyColumn` 0)

**구조**(spec §3-1·§3-2·§3-4 표 순서 그대로):
- `DirectionsScreen()`: `viewModel(factory = remember { directionsViewModelFactory(app) })`, `BackHandler(enabled = picker != null) { vm.closePicker() }`, `if (picker != null) EndpointSearchContent(...) else DirectionsForm(...)`.
- `DirectionsForm`: 제목 헤딩 → 필드 버튼 3(`clickable(role=Button)+clearAndSetSemantics{contentDescription = fieldText(accessible=true)}`, 시각 `Text(fieldText(accessible=false))`) → 조회 버튼(`stateDescription` busy) → `StatusLine` → 해결 버튼(phase별) → 최근 경로 섹션 → 수단 섹션(`ModeSection`: 헤딩(도보에 `FocusRequester`) + [도보·ko 토글] + `OutcomeRows`).
- `RouteRows.kt`: `DisclosureRow(label, spoken, expanded, onToggle, content)`(라벨 행 `clickable(role=Button)+clearAndSetSemantics{contentDescription; stateDescription=expanded?"펼침":"접힘"}` + `if (expanded) content()`), `TransitOutcomeRows`, `WalkOutcomeRows`(추천·최단 2행), `CarOutcomeRows`, `TextRow(text, spoken)` = `Text(text, Modifier.mergedRow(tag, spoken))`.
- 착지: `LaunchedEffect(s.walkRefetchRevision)` → 도보 헤딩, `LaunchedEffect(s.prefillFocusRevision)` → 도착지 버튼, `focusAfterResolve` 상태 → 폼 재컴포즈 뒤 `withFrameNanos` → 대상 requester, 삭제 착지 `pendingLanding` 키 맵(M1 관용구).
- `EndpointSearchContent`: 제목 헤딩·닫기·`TextField(state)`·검색 버튼·["현재 위치 사용"]·`StatusLine`·최근 장소 섹션·장소 후보·주소 후보. 진입 착지 검색 입력, 후보 도착 첫 후보 착지.

- [ ] **Step 1: 소스 가드 테스트 작성**(실패: 파일 없음이 아니라 통과 — 가드는 부정 단언이라 구현 뒤에도 초록이어야 한다. 검출력은 임시로 `import android.location.LocationManager` 한 줄을 넣어 빨개지는지 1회 확인 후 제거).
- [ ] **Step 2: 화면 구현** → `./gradlew :app:assembleDebug`(락 안) 컴파일 통과.
- [ ] **Step 3: androidTest 작성**(실기기 연결 시에만 실행 — 컴파일은 `:app:compileDebugAndroidTestKotlin`으로 확인).
- [ ] **Step 4: Commit** — `feat(android): 길찾기 화면 — 폼·끝점 검색·수단 섹션(펼침 행·계단 회피 토글·착지 표)·AppRoot 등록`.

### Task 6: 게이트·문서·보고 ②

- [ ] **Step 1: 게이트**(락) — `./gradlew :kit:test :app:testDebugUnitTest :app:assembleDebug :app:assembleExperimental` + `VITEST_MAX_THREADS=2 npm run test:run`(기대 실패 1: `xcstrings-plural` xcrun 라이선스) → `rmdir` 락, `--stop`.
- [ ] **Step 2: CHANGELOG** — 맨 위 날짜 절에 M3 항목 2~4줄 + spec 링크.
- [ ] **Step 3: 보고 파일 ② 갱신 + SendMessage** → 리뷰 2건 디스패치(`model: opus`, 요구사항 = spec + 이 계획, 산출물 = `git diff main...HEAD` 커밋 SHA, 결과 파일 `review-m3-spec.md`·`review-m3-quality.md`).
- [ ] **Step 4: 리뷰 반영 커밋 → rebase main → 게이트 → CHANGELOG `comm` 소실 대조 → `git -C ~/Mac-Projects/gildongmu merge --ff-only feat/android-m3` → 보고 ④.**

## Self-Review

- spec 커버리지: §3-1 표(Task 5) · §3-2(Task 4·5) · §3-3(Task 4·5) · §3-4 a~d(Task 3·5) · §3-5 착지(Task 5) · §4(Task 4) · §5(Task 2) · §6(Task 2) · §7 저장·설정(Task 4·5) · §8(Task 1) · §9 테스트(Task 2~5) · §12 기록 완료. 실기기 §10은 통합 뒤 코디네이터 경유.
- 타입 일관성: `Strings.get(key, vararg)` 하나로 VM·문장 조립·화면이 같은 키를 쓴다. `EndpointLocator` 세 함수 이름은 spec §6과 같다.
