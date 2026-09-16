# 안드로이드 M2b — 내 주변 나머지 6 kind·주변 상황·역 자동 섹션·무장애·표시줄 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** M2 spec §12(M2b)를 구현한다 — 내 주변 kind 6종(clinic·barrierFree·kids·events·walkInfra·conditions), 둘러보기 "주변 상황" 자동 펼침, 장소 상세 도메인 섹션·역 자동 섹션 5종·무장애 섹션·conditions 앵커 행, 허브 첫 줄 현재 위치 표시줄.

**Architecture:** M2가 세운 계층 위에 행을 더한다 — [2] :kit 순수 판정(`NearbyLoadCore`·모델·서비스는 무변경) / [3] :app 조립기(`NearbyKinds` 한 행 = kind 하나, payload 조립은 `settled` 조각) / [4] Compose 본문(kind별 파일 하나, 문장은 순수 함수 파일에서). 도메인 문장은 전부 리소스 없는 순수 함수(람다 주입)라 JVM에서 검증한다. 장소 상세는 `PlaceDetailViewModel`이 조용한 조각(역 5종·무장애)을 병렬 로드하고 화면은 값이 생기면 섹션을 그린다.

**Tech Stack:** Kotlin · Compose(Material3) · `navigation-compose` 2.10.1 · kotlinx.serialization · kotlinx.coroutines(test) · :kit(`NearbyLoadCore`·`RevealWindow`·`PlaceProjection`·`Fixtures`)

**Spec:** `docs/superpowers/specs/2026-09-16-android-m2-place-nearby-design.md` §12(§1~§11 승계). 실행 방식 판정: **inline**(모든 과제가 `NearbyKinds`·`NearbyKindScreen`·`NearbyStrings`·`PlaceDetailScreen` 네 파일을 순차로 건드리고 앞 과제의 시그니처가 뒤 과제 인터페이스를 정한다).

## Global Constraints

- 소유권(README §1): 이 세션은 `nearby/`·`place/`·`location/`·`nav/`·`a11y/`·`i18n/`·`android/scripts/`·README 소유. `nav/AppRoot.kt`의 `composable<DirectionsRoute>` 줄 불변, `directions/` 만들지 않음. `ios/**`·`src/**`·`packages/**`·`docs/BACKLOG.md`·`PROGRESS.md` 수정 금지.
- 접근성(spec §3, 헌장): 한 줄 = 한 객체(`mergedRow`), 착지 `FocusRequester`는 `mergedRow(..., focus)`·`clickable` 앞, 착지는 한 프레임 뒤, 통지는 `StatusLine` 단일 창구(`Notice`), `disabled` 금지, `Column+verticalScroll`, 헤딩은 `headingText()`, 버튼 48dp `tapTarget()`, 이모지 0, 거리 낭독 `spokenDistanceUnits`.
- 문자열: 인자 있는 문자열은 `appLocalized(res, id, args)`만(복수형 ICU 런타임 분기). 신설 키 0(§12가 인용한 192키 전부 `strings.xml`에 실재 — 2026-09-16 확인). 리터럴 리소스 ID `when`으로 되받는다(동적 키 조립 금지).
- 3-state: 0건 ≠ 정보 없음 ≠ 조회 실패를 어느 문장에서도 뭉개지 않는다.
- 커밋: 자기 브랜치 `feat/android-m1`, pathspec 커밋만(`git add -A` 금지), 한국어 메시지 + `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. `origin` push 금지(pre-push 훅).
- 테스트 실행: `cd android && export ANDROID_HOME=~/Library/Android/sdk && ./gradlew :app:testDebugUnitTest --tests '<클래스>'`(단위) · 전체 게이트는 머신 전역 락 안에서만(Task 11).

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `nearby/NearbyRoutes.kt` | `NearbyKind` 10종(허브 순서) |
| `nearby/NearbyScreenViewModel.kt` | `NearbyKindSpec.fetch(coord, previous)` · `landOn(key)` |
| `nearby/NearbyKinds.kt` | 조립기 표(10 + busRouteStops) |
| `nearby/NearbyPayloads.kt` (신설) | `ClinicPayload`·`WalkInfraPayload`·`ConditionsPayload` + `fetchWalkInfra`·`fetchConditions` |
| `nearby/AroundPayload.kt` | `scene`·`sceneFailed` 조각 |
| `nearby/DomainLines.kt` (신설) | clinic·kids·events 문장(순수) |
| `nearby/WalkInfraLines.kt` (신설) | 보행 인프라 요약·그룹 헤딩·항목 문장(순수) |
| `nearby/ConditionsLines.kt` (신설) | 날씨·공기질·혼잡도 문장·통지(순수) |
| `nearby/SceneLines.kt` (신설) | 주변 상황 묶음 제목·항목 문장(순수) |
| `nearby/NearbyStrings.kt`·`NearbyStringsRes.kt` | 통지·빈 문구 공급 확장 |
| `nearby/NearbyServices.kt` (신설) | 서비스 묶음 |
| `nearby/NearbyFactories.kt` | 10 kind 팩토리 |
| `nearby/NearbyKindScreen.kt` | kind 분기 + `NearbyShell` 무변경 + `AroundBody`에 scene 삽입 |
| `nearby/PlaceListBodies.kt` (신설) | clinic·barrierFree·kids·events 본문(공용 `PlaceListBody`) |
| `nearby/WalkInfraBody.kt`·`ConditionsBody.kt`·`SceneSection.kt` (신설) | 본문 |
| `nearby/NearbyHubScreen.kt` | 10행 + 표시줄 첫 행 |
| `place/PlaceRoutes.kt` | `PlaceDomain` + `domainJson` |
| `place/DomainSections.kt` (신설) | `ClinicDomainSection`·`CultureEventSection` |
| `place/StationLines.kt` (신설) | 역 섹션 문장(순수) |
| `place/StationSectionsView.kt` (신설) | 역 자동 섹션 5종 |
| `place/BarrierFreeLines.kt` (신설) · `place/BarrierFreeSection.kt` (신설) | 시설 라벨 27종 · 섹션 |
| `place/PlaceDetailViewModel.kt`·`PlaceFactories.kt`·`PlaceDetailScreen.kt` | 조용한 조각 로드·배치 |
| `location/LocationStore.kt` | `authorization()`·`coordinateForDisplay()` |
| `location/CurrentAddressStore.kt` (신설) · `location/LocationBar.kt` (신설) | 좌표당 1회 역지오코딩 · 표시줄 4-state 문장(순수) + 행 |
| `nav/AppFactories.kt`·`nav/AppRoot.kt`·`MainActivity.kt` | 조립 |
| 테스트 `app/src/test/.../nearby/{DomainLinesTest, WalkInfraLinesTest, ConditionsPayloadTest, SceneLinesTest, NearbyKindsTest}` · `place/{StationLinesTest, BarrierFreeLinesTest, PlaceRoutesTest}` · `location/{LocationBarTest, CurrentAddressStoreTest}` · 기존 `NearbyScreenViewModelTest`·`AppSourceGuardTest` 확장 · `app/src/test/resources/events-nearby.json`(손 fixture) | |

---

### Task 1: `NearbyKind` 10종 + `fetch(coord, previous)` + `landOn` + 문장 공급 확장

**Files:**
- Modify: `nearby/NearbyRoutes.kt`, `nearby/NearbyScreenViewModel.kt`, `nearby/NearbyKinds.kt`, `nearby/NearbyHubScreen.kt`(kindTitle), `nearby/NearbyStrings.kt`, `nearby/NearbyStringsRes.kt`, `nearby/NearbyFactories.kt`(when 임시 else), `app/src/test/.../nearby/TestStrings.kt`
- Test: `app/src/test/.../nearby/NearbyScreenViewModelTest.kt`

**Interfaces:**
- Produces: `NearbyKindSpec.fetch: suspend (NearbyCoord?, P?) -> P` · `NearbyKindSpec.emptyCopy: ((P) -> String)? = null`(isEmpty가 항상 false인 kind는 생략) · `NearbyScreenViewModel.groupWindows: StateFlow<Map<String, Int>>` + `revealMoreInGroup(group, totalCount, keyAt)`(판정 31, 커밋마다 `willCommit`이 비운다) · `NearbyStrings.{announcePlaces(Int), announceEvents(Int), clinicEmpty, barrierFreeEmpty, kidsEmpty, eventsEmpty, conditionsReady, conditionsPartial, failedTitle, walkInfraSummary(WalkInfrastructure)}`

- [ ] **Step 1: 실패 테스트 — 재조회 fetch가 직전 payload를 받는다**

`NearbyScreenViewModelTest.kt`에 추가(기존 헬퍼 `attempt`·`TestStrings` 사용, 좌표는 `NearbyCoordinateSource.Fixed`):

```kotlin
@Test fun `재조회 fetch는 직전 payload를 previous로 받는다(판정 25)`() = runTest {
    val seen = mutableListOf<List<String>?>()
    val spec = NearbyKindSpec<List<String>>(
        coverage = NearbyCoverage.korea,
        fetch = { _, previous -> seen += previous; listOf("a") },
        isEmpty = { it.isEmpty() }, firstKey = { it.firstOrNull() }, loadedNotice = { "n" }, emptyCopy = { "e" },
    )
    val vm = NearbyScreenViewModel(spec, NearbyCoordinateSource.Fixed(NearbyCoord(37.5, 127.1)), testNearbyStrings(), SavedStateHandle())
    vm.load(); advanceUntilIdle()
    vm.load(force = true); advanceUntilIdle()
    assertEquals(listOf(null, listOf("a")), seen)
}

@Test fun `묶음별 더 보기 — 공개 수 StateFlow·첫 새 항목 착지·커밋마다 리셋`() = runTest {
    val vm = subwayViewModel() // 기존 헬퍼(Loaded까지 진행)
    vm.revealMoreInGroup("left", totalCount = 25) { i -> "scene-item-left-$i" }
    assertEquals(20, vm.groupWindows.value["left"]); assertEquals(Landing.Key("scene-item-left-10", 1), vm.landing.value)
    vm.revealMoreInGroup("left", 25) { i -> "scene-item-left-$i" }
    assertEquals(25, vm.groupWindows.value["left"])
    assertNull(vm.groupWindows.value["right"]) // 없는 묶음은 initialVisible
    vm.load(force = true); advanceUntilIdle()
    assertTrue(vm.groupWindows.value.isEmpty()) // willCommit 리셋
}
```

- [ ] **Step 2: 실행 → 컴파일 실패 확인**

Run: `./gradlew :app:testDebugUnitTest --tests '*NearbyScreenViewModelTest*'` → FAIL(`fetch` 인자 수·`landOn` 미정의).

- [ ] **Step 3: 구현**

`NearbyRoutes.kt`:
```kotlin
/** 내 주변 화면 종류 — 허브 순서 = iOS `NearbyHubView`(around·subway·bus·bike·clinic·barrierFree·kids·events·walkInfra·conditions). */
@Serializable
enum class NearbyKind { around, subway, bus, bike, clinic, barrierFree, kids, events, walkInfra, conditions }
```

`NearbyScreenViewModel.kt`:
```kotlin
class NearbyKindSpec<P : Any>(
    val coverage: NearbyCoverage,
    /** 둘째 인자 = 직전 Loaded payload(재조회 때만 non-null). 조각 병합 kind(conditions)가 쓴다(판정 25). */
    val fetch: suspend (NearbyCoord?, P?) -> P,
    ...
)
// core 배선
fetch = { coord, previous -> spec.fetch(coord, previous) },
// 묶음별 리빌 창(주변 상황, 판정 31). RevealWindow 참조 타입을 상태에 두지 않고 공개 수만 든다.
private val groupReveal = mutableMapOf<String, RevealWindow>()   // 산술은 :kit 한 벌
private val _groupWindows = MutableStateFlow<Map<String, Int>>(emptyMap())   // 공개 수 투영(참조 타입을 상태에 두지 않는다)
val groupWindows: StateFlow<Map<String, Int>> = _groupWindows.asStateFlow()
fun revealMoreInGroup(group: String, totalCount: Int, keyAt: (Int) -> String) {
    val window = groupReveal.getOrPut(group) { RevealWindow() }
    val firstNew = window.revealMore(totalCount) ?: return
    _groupWindows.value = _groupWindows.value + (group to window.visibleCount)
    _landing.value = Landing.Key(keyAt(firstNew), ++landingRev)
}
// willCommit: reveal.reset(); _visibleCount.value = …; groupReveal.clear(); _groupWindows.value = emptyMap()
```
`emptyCopy`는 `((P) -> String)? = null`로 바꾸고 `NearbyShell`은 `checkNotNull(vm.emptyCopy(payload))`(isEmpty가 참인데 없으면 조립기 결함).

`NearbyKinds.kt` 기존 5행: `fetch = { c, _ -> ... }`.

`NearbyHubScreen.kt` `kindTitle`:
```kotlin
NearbyKind.clinic -> R.string.android_nearby_clinic
NearbyKind.barrierFree -> R.string.android_nearby_barrierFree
NearbyKind.kids -> R.string.android_nearby_kids
NearbyKind.events -> R.string.android_nearby_events
NearbyKind.walkInfra -> R.string.walkInfra_button
NearbyKind.conditions -> R.string.android_nearby_conditions
```

`NearbyStrings.kt` 추가 필드(끝에):
```kotlin
val announcePlaces: (Int) -> String,
val announceEvents: (Int) -> String,
val clinicEmpty: () -> String,
val barrierFreeEmpty: () -> String,
val kidsEmpty: () -> String,
val eventsEmpty: () -> String,
val conditionsReady: () -> String,
val conditionsPartial: () -> String,
val failedTitle: () -> String,
/** 보행 인프라 완료 통지(소스별 요약 결합, Task 4 `walkInfraLiveSummary`). */
val walkInfraSummary: (WalkInfrastructure) -> String,
```
`NearbyStringsRes.kt` 바인딩: `announcePlaces = { appLocalized(res, R.string.android_nearby_announcePlaces, it) }`, `announceEvents`(`android_nearby_announceEvents`), `clinicEmpty`(`android_nearby_clinicEmpty`), `barrierFreeEmpty`, `kidsEmpty`, `eventsEmpty`, `conditionsReady`(`android_nearby_conditionsReady`), `conditionsPartial`, `failedTitle`(`android_common_failedTitle`), `walkInfraSummary = { walkInfraLiveSummary(it, WalkSummaryWords(...)) }`(Task 4에서 채움 — Task 1에서는 `{ "" }`로 두고 Task 4가 바꾼다).

`TestStrings.kt`에 같은 필드 한국어 고정값 추가(`walkInfraSummary = { "요약" }`).

`NearbyFactories.kt`: `when(kind)`에 신규 6 → 임시 `else -> error("M2b Task 3~5")`는 두지 않는다 — Kotlin `when` 전수 요구를 **Task 3~5가 채울 때까지** 컴파일이 깨지므로, Task 1에서는 신규 6을 `NearbyKind.clinic, NearbyKind.barrierFree, NearbyKind.kids, NearbyKind.events, NearbyKind.walkInfra, NearbyKind.conditions -> TODO("M2b")`로 둔다(Task 5 끝에 0건 확인). `NearbyKindScreen.kt`의 `when(route.kind)`도 동일.

- [ ] **Step 4: 실행 → PASS**

Run: 위 명령 → PASS(기존 15건 + 2건).

- [ ] **Step 5: 커밋**

```bash
git commit -m "feat(android): M2b 1 — NearbyKind 10종·NearbyKindSpec.fetch(coord, previous)·landOn·문장 공급 확장" -- android/app/src/main/kotlin/space/dodoplanet/gildongmu/nearby android/app/src/test/kotlin/space/dodoplanet/gildongmu/nearby
```

---

### Task 2: 도메인 문장 순수 함수 — clinic·kids·events (`nearby/DomainLines.kt`)

**Files:**
- Create: `nearby/DomainLines.kt`
- Test: `app/src/test/.../nearby/DomainLinesTest.kt`

**Interfaces (Produces):**
```kotlin
class ClinicWords(val kindClinic: String, val kindHospital: String, val open: String, val closed: String, val unknown: String, val untilMidnight: String, val untilTime: (String, String) -> String)
fun clinicKindText(kind: String, w: ClinicWords): String
fun clinicStatusText(status: NightClinic.OpenStatus, w: ClinicWords): String
fun kidsKindLabel(kind: String, kidscafe: String, playground: String, playcenter: String, park: String): String
fun kidsInOutLabel(value: String, indoor: String, outdoor: String, unknown: String): String
fun eventFeeText(e: CultureEvent, free: String, paid: (String) -> String): String
```

- [ ] **Step 1: 실패 테스트**

```kotlin
class DomainLinesTest {
    private val w = ClinicWords("의원", "병원", "진료 중", "진료 종료", "진료 여부 알 수 없음", "자정까지") { h, m -> "${h}시 ${m}분까지" }

    @Test fun `진료 상태 3-state`() {
        assertEquals("진료 중, 23시 30분까지", clinicStatusText(NightClinic.OpenStatus("open", 900, 2330), w))
        assertEquals("진료 중, 자정까지", clinicStatusText(NightClinic.OpenStatus("open", 900, 2400), w))
        assertEquals("진료 중", clinicStatusText(NightClinic.OpenStatus("open"), w))
        assertEquals("진료 종료", clinicStatusText(NightClinic.OpenStatus("closed"), w))
        assertEquals("진료 여부 알 수 없음", clinicStatusText(NightClinic.OpenStatus("unknown"), w))
    }
    @Test fun `진료 종별은 두 값만 번역, 그 밖은 원문`() {
        assertEquals("의원", clinicKindText("의원", w)); assertEquals("병원", clinicKindText("종합병원", w)); assertEquals("보건소", clinicKindText("보건소", w))
    }
    @Test fun `아이 놀 곳 kind·실내외`() {
        assertEquals("놀이터", kidsKindLabel("playground", "키즈카페", "놀이터", "놀이센터", "공원")); assertEquals("zoo", kidsKindLabel("zoo", "키즈카페", "놀이터", "놀이센터", "공원"))
        assertEquals("실내외 정보 없음", kidsInOutLabel("mixed", "실내", "실외", "실내외 정보 없음"))
    }
    @Test fun `요금 문구 — 무료는 원문 중복 금지, 유료 빈 요금은 꼬리 공백 제거`() {
        val e = event(isFree = true, fee = "무료")
        assertEquals("무료", eventFeeText(e, "무료") { "유료 $it" })
        assertEquals("유료", eventFeeText(event(isFree = false, fee = null), "무료") { "유료 $it" })
    }
    private fun event(isFree: Boolean, fee: String?) = CultureEvent("1", "t", null, "c", "p", null, "d", "date", "time", isFree, fee, "all", null, 37.5, 127.1, 100)
}
```
`clinicKindText`의 "종합병원" → "병원" 기대는 :kit `clinicKindKey` 실규칙을 먼저 읽고(`ClinicKind.kt`) 맞춘다 — 규칙이 다르면 단언을 규칙에 맞춘다(구현을 바꾸지 않는다).

- [ ] **Step 2: 실행 → FAIL(미정의)**

- [ ] **Step 3: 구현**

```kotlin
package space.dodoplanet.gildongmu.nearby

/** 소아 진료·아이 놀 곳·문화행사 문장(iOS `ClinicNearbyView`·`KidsNearbyView`·`EventsNearbyView` 이식). 리소스는 람다·낱말 주입(JVM). */
class ClinicWords(...)

fun clinicKindText(kind: String, w: ClinicWords): String = when (clinicKindKey(kind)) {
    "clinic" -> w.kindClinic; "hospital" -> w.kindHospital; else -> kind
}

/** 진료 상태 3-state — open은 종료시각까지(2400 = 자정), closed/unknown은 각자의 문장. 목록 행과 상세 도메인 섹션이 공유. */
fun clinicStatusText(status: NightClinic.OpenStatus, w: ClinicWords): String = when (status.state) {
    "open" -> status.end?.let { joinText(w.open, clinicEndTimeText(it, w)) } ?: w.open
    "closed" -> w.closed
    else -> w.unknown
}

private fun clinicEndTimeText(hhmm: Int, w: ClinicWords): String =
    if (hhmm == 2400) w.untilMidnight else w.untilTime((hhmm / 100).toString(), (hhmm % 100).toString())

fun kidsKindLabel(kind: String, kidscafe: String, playground: String, playcenter: String, park: String): String = when (kind) {
    "kidscafe" -> kidscafe; "playground" -> playground; "playcenter" -> playcenter; "park" -> park; else -> kind
}

/** indoor/outdoor 3-state — unknown도 문장으로(생략 금지). */
fun kidsInOutLabel(value: String, indoor: String, outdoor: String, unknown: String): String = when (value) {
    "indoor" -> indoor; "outdoor" -> outdoor; else -> unknown
}

/** 무료면 "무료"만(요금 원문 중복 낭독 금지), 유료면 원문. 유료·요금 부재는 꼬리 공백을 걷는다. */
fun eventFeeText(e: CultureEvent, free: String, paid: (String) -> String): String =
    if (e.isFree) free else paid(e.fee ?: "").trim()
```

- [ ] **Step 4: 실행 → PASS**
- [ ] **Step 5: 커밋** `feat(android): M2b 2 — 소아 진료·아이 놀 곳·문화행사 문장 순수 함수`

---

### Task 3: 목록형 4 kind — clinic·barrierFree·kids·events (조립기·본문·팩토리·서비스 묶음)

**Files:**
- Create: `nearby/NearbyPayloads.kt`(`ClinicPayload`), `nearby/NearbyServices.kt`, `nearby/PlaceListBodies.kt`
- Modify: `nearby/NearbyKinds.kt`, `nearby/NearbyFactories.kt`, `nearby/NearbyKindScreen.kt`, `nav/AppFactories.kt`(시그니처 무변경 — `nearby` 람다 안에서 서비스 묶음), `MainActivity.kt`, `androidTest/nearby/NearbyScreenA11yTest.kt`(`NearbyKinds.subway(service, strings)` 호출 유지 — 서비스 묶음은 팩토리만 받는다)
- Test: `app/src/test/.../nearby/NearbyKindsTest.kt`, `app/src/test/resources/events-nearby.json`

**Interfaces:**
- Produces: `class NearbyServices(val nearby: NearbyService, val barrierFree: BarrierFreeService, val walkInfra: WalkInfraService, val conditions: ConditionsService)` · `data class ClinicPayload(val clinics: List<NightClinic>, val basis: String, val supplementFailed: Boolean)` · `NearbyKinds.{clinic, barrierFree, kids, events}(service, strings)` · `@Composable fun <T> PlaceListBody(...)` · `NearbyNav.onOpenPlace: (Place, PlaceDomain?) -> Unit`(PlaceDomain은 Task 7 — Task 3에서는 `(Place) -> Unit` 유지, Task 7이 바꾼다)

- [ ] **Step 1: 손 fixture** `app/src/test/resources/events-nearby.json`(서버 `/api/events/nearby` 모양, 2건 — `EventsNearbyResponse(events, total)` 필드 전부):

```json
{"events":[{"id":"e1","title":"한강 야외 음악회","category":"콘서트","place":"뚝섬한강공원","district":"광진구","dateText":"2026-09-01~2026-09-30","timeText":"19:00","isFree":true,"fee":"무료","target":"누구나","link":null,"lat":37.531,"lng":127.066,"distanceMeters":420},{"id":"e2","title":"어린이 연극","category":"연극","place":"어린이대공원","district":"광진구","dateText":"2026-09-10~2026-09-20","timeText":"14:00","isFree":false,"fee":"10,000원","target":"어린이","link":null,"lat":37.548,"lng":127.081,"distanceMeters":900}],"total":2}
```

- [ ] **Step 2: 실패 테스트** `NearbyKindsTest.kt`(스텁 전송 관용구는 `AroundPayloadTest` 동형; 리소스 fixture 읽기는 `javaClass.getResource("/events-nearby.json")!!.readText()`):

```kotlin
class NearbyKindsTest {
    private val coord = NearbyCoord(37.538, 127.137)
    private val strings = testNearbyStrings()
    private fun nearby(path: String, body: String) = NearbyService(stubbedClient { url -> if (pathOf(url) == path) HttpResponse(200, body) else HttpResponse(404, "") })

    @Test fun `clinic — 첫 키·통지·기준·보완 실패`() = runTest {
        val spec = NearbyKinds.clinic(nearby("/api/clinic/nearby", Fixtures.kit("clinic-nearby.json")), strings)
        val p = spec.fetch(coord, null)
        assertFalse(spec.isEmpty(p)); assertEquals("place-${p.clinics.first().id}", spec.firstKey(p))
        assertEquals("주변 장소 ${p.clinics.size}곳", spec.loadedNotice(p)); assertEquals("weekday", p.basis); assertFalse(p.supplementFailed)
        val empty = spec.fetch(coord, null).copy(clinics = emptyList())
        assertTrue(spec.isEmpty(empty)); assertEquals("주변에 소아 야간진료 기관이 없습니다", spec.loadedNotice(empty)); assertEquals(spec.emptyCopy(empty), spec.loadedNotice(empty))
    }
    @Test fun `clinic — basis·supplementFailed 부재는 weekday·false`() = runTest {
        val p = NearbyKinds.clinic(nearby("/api/clinic/nearby", """{"clinics":[]}"""), strings).fetch(coord, null)
        assertEquals("weekday", p.basis); assertFalse(p.supplementFailed)
    }
    @Test fun `barrierFree·kids·events — 첫 키는 place-{id}, 통지는 종류별`() = runTest {
        val bf = NearbyKinds.barrierFree(BarrierFreeService(stubbedClient { HttpResponse(200, Fixtures.kit("barrier-free-nearby.json")) }), strings)
        val b = bf.fetch(coord, null); assertEquals("place-${b.first().contentId}", bf.firstKey(b)); assertEquals("주변 장소 ${b.size}곳", bf.loadedNotice(b))
        val kids = NearbyKinds.kids(nearby("/api/places/kids", Fixtures.kit("kids-nearby.json")), strings)
        val k = kids.fetch(coord, null); assertEquals("place-${k.first().id}", kids.firstKey(k))
        val ev = NearbyKinds.events(nearby("/api/events/nearby", javaClass.getResource("/events-nearby.json")!!.readText()), strings)
        val e = ev.fetch(coord, null); assertEquals("place-e1", ev.firstKey(e)); assertEquals("주변 문화행사 2건", ev.loadedNotice(e))
        assertEquals("주변에 문화행사가 없습니다", ev.emptyCopy(emptyList()))
    }
}
```
`Fixtures.kit` 경로·`stubbedClient`·`pathOf`는 `space.dodoplanet.gildongmu.kit` 테스트 픽스처(`AroundPayloadTest` import 동형). 빈 문구 기대값은 `testNearbyStrings`에 넣은 문자열과 같게 한다(리소스 원문은 `strings.xml` `android_nearby_clinicEmpty` 등 — 테스트 문장은 자유).

- [ ] **Step 3: 실행 → FAIL**

- [ ] **Step 4: 구현**

`NearbyPayloads.kt`:
```kotlin
/** 소아 진료 한 커밋 payload(iOS `ClinicPayload`) — 화면이 밝히는 메타 두 값만(공휴일 기준·보완 실패). */
data class ClinicPayload(val clinics: List<NightClinic>, val basis: String, val supplementFailed: Boolean)
```

`NearbyServices.kt`:
```kotlin
/** kind 팩토리가 받는 서비스 묶음(전부 `AppConfig.apiClient` 위). */
class NearbyServices(val nearby: NearbyService, val barrierFree: BarrierFreeService, val walkInfra: WalkInfraService, val conditions: ConditionsService)
```

`NearbyKinds.kt` 추가:
```kotlin
fun clinic(service: NearbyService, strings: NearbyStrings) = NearbyKindSpec<ClinicPayload>(
    coverage = NearbyCoverage.korea,
    fetch = { c, _ -> service.clinics(c!!.lat, c.lng).let { ClinicPayload(it.clinics, it.basis ?: "weekday", it.supplementFailed ?: false) } },
    isEmpty = { it.clinics.isEmpty() },
    firstKey = { it.clinics.firstOrNull()?.let { x -> "place-${x.id}" } },
    loadedNotice = { if (it.clinics.isEmpty()) strings.clinicEmpty() else strings.announcePlaces(it.clinics.size) },
    emptyCopy = { strings.clinicEmpty() },
)
fun barrierFree(service: BarrierFreeService, strings: NearbyStrings) = NearbyKindSpec<List<BarrierFreePlace>>(
    coverage = NearbyCoverage.korea,
    fetch = { c, _ -> service.nearby(c!!.lat, c.lng) },
    isEmpty = { it.isEmpty() },
    firstKey = { it.firstOrNull()?.let { x -> "place-${x.contentId}" } },
    loadedNotice = { if (it.isEmpty()) strings.barrierFreeEmpty() else strings.announcePlaces(it.size) },
    emptyCopy = { strings.barrierFreeEmpty() },
)
fun kids(service: NearbyService, strings: NearbyStrings) = NearbyKindSpec<List<KidsPlace>>( ... "place-${x.id}", kidsEmpty, announcePlaces )
fun events(service: NearbyService, strings: NearbyStrings) = NearbyKindSpec<List<CultureEvent>>( ... "place-${x.id}", eventsEmpty, announceEvents )
```

`NearbyFactories.kt`: `nearbyFactory(kind, anchor, services: NearbyServices, strings, current)`; when 분기 `clinic -> NearbyScreenViewModel(NearbyKinds.clinic(services.nearby, strings), ...)` 등. `busRouteStopsFactory`는 `NearbyService` 그대로.

`MainActivity.kt`: `val services = NearbyServices(nearbyService, BarrierFreeService(AppConfig.apiClient), WalkInfraService(AppConfig.apiClient), ConditionsService(AppConfig.apiClient))`; `nearby = { kind, anchor -> nearbyFactory(kind, anchor, services, nearby) { ... } }`.

`PlaceListBodies.kt`:
```kotlin
/**
 * 장소 목록형 본문 공용(clinic·barrierFree·kids·events — iOS 4뷰의 List 골격). 행 = `PlaceRow` 버튼(→ 상세), 착지 키 `place-{id}`,
 * "더 보기"는 `vm.revealMore`, 머리·꼬리는 kind가 준다. 헤딩 없음(평면 1행=1객체, iOS 판정 동형).
 */
@Composable
fun <T : Any, P : Any> PlaceListBody(
    items: List<T>,
    vm: NearbyScreenViewModel<P>,
    requesterFor: (String) -> FocusRequester,
    place: (T) -> Place,
    secondary: (T) -> String,
    onOpen: (T) -> Unit,
    header: @Composable () -> Unit = {},
    footer: @Composable () -> Unit = {},
) {
    val res = LocalContext.current.resources
    val lang = AppLocale.current(res)
    val meters = stringResource(R.string.android_unit_spokenMeters)
    val visibleCount by vm.visibleCount.collectAsState()
    header()
    for (item in items.take(visibleCount)) {
        val p = place(item)
        PlaceRow(p, lang, spokenMeters = meters, secondaryOverride = secondary(item), onClick = { onOpen(item) }, modifier = Modifier.focusRequester(requesterFor("place-${p.id}")))
    }
    if (items.size > visibleCount) {
        Button(onClick = { vm.revealMore(items.size) { i -> "place-${place(items[i]).id}" } }, Modifier.tapTarget().testTag("showMore")) { Text(stringResource(R.string.actions_showMore)) }
    }
    footer()
}

@Composable
fun ClinicBody(payload: ClinicPayload, vm: NearbyScreenViewModel<ClinicPayload>, requesterFor: (String) -> FocusRequester, onOpen: (NightClinic) -> Unit) {
    val res = LocalContext.current.resources
    val words = clinicWords(res)
    val distance = { m: Int -> appLocalized(res, R.string.place_distance, formatDistance(m)) }
    PlaceListBody(
        payload.clinics, vm, requesterFor, ::nightClinicToPlace,
        secondary = { c -> joinText(clinicKindText(c.kind, words), clinicStatusText(c.openStatus, words), distance(c.distanceMeters)) },
        onOpen = onOpen,
        header = {
            // 공휴일 기준으로 읽은 날·보완 실패만 밝힌다(조건부라 잡음 아님).
            if (payload.basis == "holiday") Text(stringResource(R.string.clinicNearby_basisHoliday), Modifier.fillMaxWidth().mergedRow("clinic-basis").padding(vertical = 8.dp))
            if (payload.supplementFailed) Text(stringResource(R.string.clinicNearby_supplementFailedNotice), Modifier.fillMaxWidth().mergedRow("clinic-supplement").padding(vertical = 8.dp))
        },
    )
}

/** 리소스 → 낱말 묶음(화면 몫). `DomainSections`(장소 상세)도 같은 함수를 쓴다. */
fun clinicWords(res: Resources) = ClinicWords(
    kindClinic = res.getString(R.string.clinicNearby_kind_clinic), kindHospital = res.getString(R.string.clinicNearby_kind_hospital),
    open = res.getString(R.string.clinicNearby_open), closed = res.getString(R.string.android_nearby_clinicClosed), unknown = res.getString(R.string.android_nearby_clinicUnknown),
    untilMidnight = res.getString(R.string.android_nearby_untilMidnight), untilTime = { h, m -> appLocalized(res, R.string.android_nearby_untilTime, h, m) },
)

@Composable fun BarrierFreeBody(...) = PlaceListBody(places, vm, requesterFor, ::barrierFreePlaceToPlace,
    secondary = { joinText(it.address, distance(it.distanceMeters)) }, onOpen,
    footer = { if (places.isNotEmpty()) Text(stringResource(R.string.barrierFreeInfo_source), Modifier.fillMaxWidth().mergedRow("bf-source").padding(vertical = 8.dp)) })

@Composable fun KidsBody(...) secondary = { k -> joinText(kidsKindLabel(k.kind, ...4 리소스), kidsInOutLabel(k.indoorOutdoor, ...3 리소스), distance(k.distanceMeters), k.roadAddress ?: k.address) }

@Composable fun EventsBody(...) secondary = { e -> joinText(e.category, eventFeeText(e, free, paid), distance(e.distanceMeters)) }
```
(`PlaceListBody`가 `items`가 비면 아무것도 그리지 않는다 — 0건은 `NearbyShell`이 `emptyCopy`로 먼저 가른다.)

`NearbyKindScreen.kt` `when(route.kind)`에 4분기(around 분기 동형; `vm.returnFocus.remember("place-${place.id}")` 뒤 `nav.onOpenPlace(place)`).

- [ ] **Step 5: 실행 → PASS**, `./gradlew :app:compileDebugKotlin` 통과(TODO 분기는 walkInfra·conditions 둘만 남는다).
- [ ] **Step 6: 커밋** `feat(android): M2b 3 — 소아 진료·무장애·아이 놀 곳·문화행사 화면(공용 목록 본문·서비스 묶음)`

---

### Task 4: 보행 인프라 kind (`coverage = none`, 그룹 3 항상)

**Files:**
- Create: `nearby/WalkInfraLines.kt`, `nearby/WalkInfraBody.kt`
- Modify: `nearby/NearbyPayloads.kt`(`WalkInfraPayload`·`fetchWalkInfra`), `nearby/NearbyKinds.kt`, `nearby/NearbyFactories.kt`, `nearby/NearbyKindScreen.kt`, `nearby/NearbyStringsRes.kt`(`walkInfraSummary` 실바인딩), `TestStrings.kt`
- Test: `nearby/WalkInfraLinesTest.kt`

**Interfaces (Produces):**
```kotlin
data class WalkInfraPayload(val walk: WalkInfrastructure, val asOf: String)   // asOf = 커밋 시각의 로케일 short time(m7)
suspend fun fetchWalkInfra(service: WalkInfraService, coord: NearbyCoord, now: () -> String): WalkInfraPayload
class WalkSummaryWords(val audioSummary: (Int) -> String, val audioNone: String, val audioUnsupported: String, val audioError: String, val osmSummary: (Int) -> String, val osmEmpty: String, val osmUnsupported: String, val osmError: String)
fun walkInfraLiveSummary(walk: WalkInfrastructure, w: WalkSummaryWords): String
fun walkGroupHeader(status: WalkSourceStatus<OsmWalkData>, total: (OsmWalkData) -> Int, listed: (OsmWalkData) -> Int, plain: String, count: (String) -> String, truncated: (String, String) -> String): String
fun walkAudioSiteText(site: AudioSignalSite, direction: (String) -> String?, format: (String, String, Int) -> String): String
fun walkItemLocationText(feature: WalkFeature, direction: (String) -> String?, format: (String, String) -> String): String
```

- [ ] **Step 1: 실패 테스트**

```kotlin
class WalkInfraLinesTest {
    private val w = WalkSummaryWords({ "반경 300m 안 ${it}기" }, "음향신호기 없음", "음향신호기 미제공 지역", "음향신호기 조회 실패", { "보행 시설 ${it}곳" }, "보행 시설 없음", "보행 시설 미제공", "보행 시설 조회 실패")
    private fun walk(name: String) = KitJson.decodeFromString(WalkInfraEnvelope.serializer(), Fixtures.kit(name)).walk  // internal이면 WalkInfraService 경유 스텁으로 대체
    @Test fun `요약 — ok·unsupported·error 조합을 "0기" 합성 없이`() {
        assertEquals("반경 300m 안 3기, 보행 시설 12곳", walkInfraLiveSummary(walk("walk-nearby.json"), w))  // 수치는 fixture 실값으로 맞춘다
        assertEquals("음향신호기 미제공 지역, 보행 시설 12곳", walkInfraLiveSummary(walk("walk-nearby-unsupported.json"), w))
        assertTrue(walkInfraLiveSummary(walk("walk-nearby-degraded.json"), w).contains("조회 실패"))
    }
    @Test fun `그룹 헤딩 — 절단 시 "N곳 중 M곳", 0이면 평문`() {
        val ok = WalkSourceStatus.Ok(OsmWalkData(features = emptyList(), totalCount = 0, listedCount = 0, truncated = false, crossingTotal = 7, tactileTotal = 0))
        assertEquals("횡단보도 7곳 중 0곳", walkGroupHeader(ok, { it.crossingTotal }, { it.crossings.size }, "횡단보도", { "횡단보도 ${it}곳" }, { t, l -> "횡단보도 ${t}곳 중 ${l}곳" }))
        assertEquals("점자블록", walkGroupHeader(ok, { it.tactileTotal }, { it.tactiles.size }, "점자블록", { "점자블록 ${it}곳" }, { t, l -> "$t/$l" }))
        assertEquals("횡단보도", walkGroupHeader(WalkSourceStatus.Error(), { it.crossingTotal }, { 0 }, "횡단보도", { "x" }, { _, _ -> "y" }))
    }
    @Test fun `미지 방위는 방위 조각 생략`() {
        assertEquals("120m", walkItemLocationText(WalkFeature("1", true, "yes", false, null, 120, "zz"), { null }) { d, dist -> "$d $dist" })
        assertEquals("북 120m(2기)", walkAudioSiteText(AudioSignalSite(120, "n", 2), { "북" }) { d, dist, n -> "$d $dist(${n}기)" })
        assertEquals("120m(2기)", walkAudioSiteText(AudioSignalSite(120, "zz", 2), { null }) { d, dist, n -> "$d $dist(${n}기)".trim(' ', ',') })
    }
}
```
`WalkInfraEnvelope`가 `internal`이면 테스트는 `WalkInfraService(stubbedClient{...}).nearby(...)`로 받는다(runTest).

- [ ] **Step 2: 실행 → FAIL**
- [ ] **Step 3: 구현**

`NearbyPayloads.kt`:
```kotlin
data class WalkInfraPayload(val walk: WalkInfrastructure, val asOf: String)
/** 조회 시각은 커밋 시점의 "HH:mm"(iOS `WalkInfraPayload.asOf` 동형). */
suspend fun fetchWalkInfra(service: WalkInfraService, coord: NearbyCoord, now: () -> String): WalkInfraPayload = WalkInfraPayload(service.nearby(coord.lat, coord.lng), now())
```

`WalkInfraLines.kt`(iOS `walkInfraLiveSummary`·`crossingHeader`·`tactileHeader`·`audioSiteText`·`itemLocationText` 이식):
```kotlin
fun walkInfraLiveSummary(walk: WalkInfrastructure, w: WalkSummaryWords): String {
    val audio = when (val s = walk.audioSignals) {
        is WalkSourceStatus.Ok -> if (s.data.deviceCount > 0) w.audioSummary(s.data.deviceCount) else w.audioNone
        is WalkSourceStatus.Unsupported -> w.audioUnsupported
        is WalkSourceStatus.Error -> w.audioError
    }
    val osm = when (val s = walk.osm) {
        is WalkSourceStatus.Ok -> if (s.data.listedCount > 0) w.osmSummary(s.data.listedCount) else w.osmEmpty
        is WalkSourceStatus.Unsupported -> w.osmUnsupported
        is WalkSourceStatus.Error -> w.osmError
    }
    return joinText(audio, osm)
}
/** "N곳 중 가까운 M곳"은 cap 전 실개수 기반(절단 침묵 금지). total 0·비-ok는 평문 헤딩. */
fun walkGroupHeader(status: WalkSourceStatus<OsmWalkData>, total: (OsmWalkData) -> Int, listed: (OsmWalkData) -> Int, plain: String, count: (String) -> String, truncated: (String, String) -> String): String {
    val data = (status as? WalkSourceStatus.Ok)?.data ?: return plain
    val t = total(data); if (t <= 0) return plain
    val l = listed(data)
    return if (t > l) truncated(t.toString(), l.toString()) else count(t.toString())
}
fun walkAudioSiteText(site: AudioSignalSite, direction: (String) -> String?, format: (String, String, Int) -> String): String {
    val d = formatDistance(site.distanceMeters)
    val dir = direction(site.bearing) ?: return format("", d, site.deviceCount).trim(' ', ',')
    return format(dir, d, site.deviceCount)
}
fun walkItemLocationText(feature: WalkFeature, direction: (String) -> String?, format: (String, String) -> String): String {
    val d = formatDistance(feature.distanceMeters)
    return direction(feature.bearing)?.let { format(it, d) } ?: d
}
```

`NearbyKinds.walkInfra(service: WalkInfraService, strings, now: () -> String)`:
```kotlin
coverage = NearbyCoverage.none,   // 판정 24 — 두 소스가 각자 Unsupported로 말한다
fetch = { c, _ -> fetchWalkInfra(service, c!!, now) },
isEmpty = { false },              // 본문이 3-state를 말한다(빈 문구 없음)
firstKey = { "walkinfra-top" },
loadedNotice = { strings.walkInfraSummary(it.walk) },
emptyCopy = { "" },               // 도달 불가(isEmpty false)
```
`now`는 팩토리가 `{ DateFormat.getTimeInstance(DateFormat.SHORT, Locale(AppLocale.current(app.resources))).format(Date()) }`로 준다(**앱 언어** short time — 인자 없는 `getTimeInstance`·`configuration.locales[0]`는 시스템 로케일이라 금지; iOS `timeStyle: .short` 동형).

`NearbyStringsRes.kt`: `walkInfraSummary = { walkInfraLiveSummary(it, WalkSummaryWords(audioSummary = { appLocalized(res, R.string.walkInfra_audioSummary, it) }, audioNone = getString(walkInfra_audioNone), audioUnsupported = …, audioError = …, osmSummary = { appLocalized(res, R.string.walkInfra_osmSummary, it) }, osmEmpty = …, osmUnsupported = …, osmError = …)) }`.

`WalkInfraBody.kt`(iOS 뷰 순서 그대로 — 헤딩 `walkInfra_asOf(asOf)` 착지 → 그룹 3 → 각주):
```kotlin
@Composable
fun WalkInfraBody(payload: WalkInfraPayload, requesterFor: (String) -> FocusRequester) {
    val res = LocalContext.current.resources
    val meters = stringResource(R.string.android_unit_spokenMeters)
    val direction: (String) -> String? = { bearingResId(it)?.let { id -> res.getString(id) } }   // AroundBody의 것을 internal로 승격
    fun row(text: String, key: String) = Text(text, Modifier.fillMaxWidth().mergedRow(key, spokenDistanceUnits(text, meters)).padding(vertical = 8.dp))
    fun heading(text: String, key: String, focus: FocusRequester? = null) = Text(text, Modifier.fillMaxWidth().mergedRow(key, focus = focus).headingText().padding(top = 12.dp, bottom = 4.dp), style = MaterialTheme.typography.titleMedium)

    heading(appLocalized(res, R.string.walkInfra_asOf, payload.asOf), "walkinfra-top", requesterFor("walkinfra-top"))
    val walk = payload.walk
    // 음향신호기
    heading(stringResource(R.string.walkInfra_groupAudio), "audio")
    when (val s = walk.audioSignals) {
        is WalkSourceStatus.Ok -> if (s.data.deviceCount > 0) {
            row(appLocalized(res, R.string.walkInfra_audioSummary, s.data.deviceCount), "audio-summary")
            s.data.sites.forEachIndexed { i, site -> row(walkAudioSiteText(site, direction) { d, dist, n -> appLocalized(res, R.string.walkInfra_audioSite, d, dist, n) }, "audio-$i") }
        } else row(stringResource(R.string.walkInfra_audioNone), "audio-none")
        is WalkSourceStatus.Unsupported -> row(stringResource(R.string.walkInfra_audioUnsupported), "audio-status")
        is WalkSourceStatus.Error -> row(stringResource(R.string.walkInfra_audioError), "audio-status")
    }
    // 횡단보도
    heading(walkGroupHeader(walk.osm, { it.crossingTotal }, { it.crossings.size }, stringResource(R.string.walkInfra_groupCrossing), { appLocalized(res, R.string.walkInfra_groupCrossingCount, it) }, { t, l -> appLocalized(res, R.string.walkInfra_groupCrossingTruncated, t, l) }), "crossing")
    when (val s = walk.osm) {
        is WalkSourceStatus.Ok -> if (s.data.crossings.isEmpty()) row(stringResource(R.string.walkInfra_crossingEmpty), "crossing-empty")
            else s.data.crossings.forEach { f -> row(joinText(walkItemLocationText(f, direction) { d, dist -> appLocalized(res, R.string.walkInfra_itemLocation, d, dist) }, if (f.crossingSignal == "yes") stringResource(R.string.walkInfra_hasSignal) else null, if (f.tactilePaving) stringResource(R.string.walkInfra_hasTactile) else null), "crossing-${f.osmId}") }
        is WalkSourceStatus.Unsupported -> row(stringResource(R.string.walkInfra_crossingUnsupported), "crossing-status")
        is WalkSourceStatus.Error -> row(stringResource(R.string.walkInfra_crossingError), "crossing-status")
    }
    // 점자블록(동형: tactileTotal·tactiles·hostBusStop/hostSubwayEntrance·tactileEmpty/Unsupported/Error)
    ...
    // 각주 — 성공한 소스만 인용
    val audioOk = (walk.audioSignals as? WalkSourceStatus.Ok)?.data
    val osmOk = walk.osm is WalkSourceStatus.Ok
    if (audioOk != null || osmOk) {
        row(stringResource(R.string.walkInfra_footnote), "footnote")
        row(joinText(if (osmOk) stringResource(R.string.walkInfra_sourceOsm) else null, audioOk?.let { appLocalized(res, R.string.walkInfra_sourceAudio, it.baseDate) }), "footnote-source")
    }
}
```
(`stringResource`는 composable 컨텍스트 안에서만 — `when` 분기 안 호출은 composable 람다 안이므로 가능.) `NearbyKindScreen` 분기: `NearbyShell(title, vm, ..., loadingText = stringResource(R.string.walkInfra_loading), failedText = stringResource(R.string.walkInfra_error)) { p, req -> WalkInfraBody(p, req) }`.

- [ ] **Step 4: 실행 → PASS**
- [ ] **Step 5: 커밋** `feat(android): M2b 4 — 주변 보행 인프라(소스별 3-state·그룹 헤딩 3 항상·각주)`

---

### Task 5: 날씨·공기질·혼잡도 kind + 장소 상세 앵커 4행

**Files:**
- Create: `nearby/ConditionsLines.kt`, `nearby/ConditionsBody.kt`
- Modify: `nearby/NearbyPayloads.kt`(`ConditionsPayload`·`fetchConditions`), `nearby/NearbyKinds.kt`, `nearby/NearbyFactories.kt`, `nearby/NearbyKindScreen.kt`, `place/PlaceDetailScreen.kt`(앵커 목록에 `NearbyKind.conditions`)
- Test: `nearby/ConditionsPayloadTest.kt`

**Interfaces (Produces):**
```kotlin
data class ConditionsPayload(val weather: Weather?, val air: AirQuality?, val congestion: Congestion?, val freshWeather: Boolean, val freshAir: Boolean)
suspend fun fetchConditions(service: ConditionsService, coord: NearbyCoord, previous: ConditionsPayload?): ConditionsPayload
fun conditionsNotice(p: ConditionsPayload, ready: String, partial: String, failed: String): String
fun numberText(value: Double): String
fun pollutantText(label: String, pollutant: AirPollutant, grade: (String) -> String): String
```

- [ ] **Step 1: 실패 테스트**

```kotlin
class ConditionsPayloadTest {
    private val coord = NearbyCoord(37.538, 127.137)
    private fun service(weather: HttpResponse, air: HttpResponse, congestion: HttpResponse) = ConditionsService(stubbedClient { url ->
        when (pathOf(url)) { "/api/weather/nearby" -> weather; "/api/air/nearby" -> air; "/api/congestion/nearby" -> congestion; else -> HttpResponse(404, "") }
    })  // 경로는 StationService.kt의 ConditionsService 실경로로 맞춘다
    private val w = HttpResponse(200, Fixtures.kit("weather-nearby.json")); private val a = HttpResponse(200, Fixtures.kit("air-nearby.json")); private val c = HttpResponse(200, Fixtures.kit("congestion-nearby.json"))

    @Test fun `세 조각 독립 — 한 조각 실패는 null·fresh false`() = runTest {
        val p = fetchConditions(service(HttpResponse(500, ""), a, c), coord, null)
        assertNull(p.weather); assertFalse(p.freshWeather); assertNotNull(p.air); assertTrue(p.freshAir); assertNotNull(p.congestion)
    }
    @Test fun `재조회 실패 조각은 직전 값 유지, 혼잡도 성공 null은 덮어쓴다`() = runTest {
        val first = fetchConditions(service(w, a, c), coord, null)
        val p = fetchConditions(service(HttpResponse(500, ""), a, HttpResponse(200, """{"area":null}""")), coord, first)
        assertEquals(first.weather, p.weather); assertFalse(p.freshWeather)
        assertNull(p.congestion)   // 핫스팟 밖이 답
        val q = fetchConditions(service(w, a, HttpResponse(500, "")), coord, first)
        assertEquals(first.congestion, q.congestion)   // 실패만 직전 값
    }
    @Test fun `어느 조각이든 커버리지 마커면 전체 throw`() = runTest {
        assertFailsWith<APIError.OutOfCoverage> { fetchConditions(service(w, HttpResponse(200, """{"outOfCoverage":true}"""), c), coord, null) }
    }
    @Test fun `통지 3분기는 fresh 두 값만 본다`() {
        val base = ConditionsPayload(null, null, null, true, true)
        assertEquals("ready", conditionsNotice(base, "ready", "partial", "failed"))
        assertEquals("partial", conditionsNotice(base.copy(freshAir = false), "ready", "partial", "failed"))
        assertEquals("failed", conditionsNotice(base.copy(freshWeather = false, freshAir = false), "ready", "partial", "failed"))
    }
    @Test fun `수치 표기·오염도 문장`() {
        assertEquals("31", numberText(31.0)); assertEquals("24.2", numberText(24.2))
        assertEquals("초미세먼지, 좋음 (12)", pollutantText("초미세먼지", AirPollutant(12.0, "good")) { "좋음" })
        assertEquals("초미세먼지, 좋음", pollutantText("초미세먼지", AirPollutant(null, "good")) { "좋음" })
    }
}
```
`assertFailsWith<APIError.OutOfCoverage>` — object 타입이라 `assertFailsWith<APIError>`로 받고 `assertSame(APIError.OutOfCoverage, e)`.

- [ ] **Step 2: 실행 → FAIL**
- [ ] **Step 3: 구현**

`NearbyPayloads.kt`:
```kotlin
data class ConditionsPayload(...)

// 조각 포착은 기존 `settled`(취소 재던짐). 커버리지 마커는 실패 Result 안의 예외 타입으로 가른다.
private fun <T> Result<T>.isOutOfCoverage() = exceptionOrNull() === APIError.OutOfCoverage

/** iOS `ConditionsModel.fetch` 이식: 조각별 독립, 커버리지 마커 이중 방어, 실패 조각은 직전 값, 혼잡도만 성공 null 덮어쓰기. */
suspend fun fetchConditions(service: ConditionsService, coord: NearbyCoord, previous: ConditionsPayload?): ConditionsPayload = coroutineScope {
    val w = async { settled { service.weather(coord.lat, coord.lng) } }
    val a = async { settled { service.air(coord.lat, coord.lng) } }
    val c = async { settled { service.congestion(coord.lat, coord.lng) } }
    val (wr, ar, cr) = Triple(w.await(), a.await(), c.await())
    if (wr.isOutOfCoverage() || ar.isOutOfCoverage() || cr.isOutOfCoverage()) throw APIError.OutOfCoverage
    val weather = wr.getOrNull()
    val air = ar.getOrNull()
    ConditionsPayload(
        weather = weather ?: previous?.weather,
        air = air ?: previous?.air,
        congestion = if (cr.isSuccess) cr.getOrNull() else previous?.congestion,   // 성공한 null은 "핫스팟 밖"이라 덮어쓴다
        freshWeather = weather != null, freshAir = air != null,
    )
}
```

`ConditionsLines.kt`:
```kotlin
fun conditionsNotice(p: ConditionsPayload, ready: String, partial: String, failed: String) = when {
    p.freshWeather && p.freshAir -> ready; p.freshWeather || p.freshAir -> partial; else -> failed
}
/** 정수값은 소수점 제거("31.0도" 방지), 소수는 그대로. */
fun numberText(value: Double): String = if (value % 1.0 == 0.0) value.toLong().toString() else value.toString()
fun pollutantText(label: String, pollutant: AirPollutant, grade: (String) -> String): String {
    val g = grade(pollutant.grade)
    val v = pollutant.value ?: return "$label, $g"
    return "$label, $g (${numberText(v)})"
}
```

`NearbyKinds.conditions(service: ConditionsService, strings)`:
```kotlin
coverage = NearbyCoverage.korea,
fetch = { c, previous -> fetchConditions(service, c!!, previous) },
isEmpty = { false },
firstKey = { "conditions-weather" },
loadedNotice = { conditionsNotice(it, strings.conditionsReady(), strings.conditionsPartial(), strings.failedTitle()) },
emptyCopy = { "" },
```

`ConditionsBody.kt`(iOS `weatherSection`·`airSection`·`congestionSection` 순서·문장 동형; 등급·하늘·강수 낱말은 리터럴 `when` → resId):
```kotlin
private fun gradeResId(g: String) = when (g) { "good" -> R.string.airQuality_grade_good; "moderate" -> R.string.airQuality_grade_moderate; "bad" -> R.string.airQuality_grade_bad; "veryBad" -> R.string.airQuality_grade_veryBad; else -> R.string.airQuality_unknown }
private fun skyResId(l: String) = when (l) { "clear" -> R.string.weather_sky_clear; "partlyCloudy" -> R.string.android_nearby_skyPartly; "cloudy" -> R.string.weather_sky_cloudy; else -> R.string.weather_unknown }
private fun precipResId(l: String) = when (l) { "none" -> R.string.weather_precipitation_none; "rain" -> R.string.weather_precipitation_rain; "rainSnow" -> R.string.android_nearby_rainSnow; "snow" -> R.string.weather_precipitation_snow; "shower" -> R.string.weather_precipitation_shower; else -> R.string.weather_unknown }
private fun levelResId(raw: String) = when (CongestionLevelKey.fromLevelText(raw)) { relaxed -> congestion_levels_relaxed; normal -> …; slightlyBusy -> …; busy -> …; null -> null }  // null → 원문

@Composable
fun ConditionsBody(p: ConditionsPayload, requesterFor: (String) -> FocusRequester) {
    // ① 날씨 헤딩(착지) + 줄들 / weatherFailed
    heading(stringResource(R.string.android_nearby_weatherHeading), "conditions-weather", requesterFor("conditions-weather"))
    p.weather?.let { w ->
        row(appLocalized(res, R.string.android_nearby_skyLine, stringResource(skyResId(w.sky.label))), "sky")
        row(appLocalized(res, R.string.android_nearby_precipLine, stringResource(precipResId(w.precipitation.label))), "precip")
        w.tempC?.let { row(appLocalized(res, R.string.android_nearby_tempNow, numberText(it)), "temp") }
        joinText(w.tempMax?.let { appLocalized(res, R.string.android_nearby_tempMax, numberText(it)) }, w.tempMin?.let { appLocalized(res, R.string.android_nearby_tempMin, numberText(it)) }).takeIf { it.isNotEmpty() }?.let { row(it, "temp-range") }
        w.humidity?.let { row(appLocalized(res, R.string.weather_humidity, numberText(it)), "humidity") }
        w.precipProbability?.let { row(appLocalized(res, R.string.weather_precipProbability, numberText(it)), "pop") }
        row(appLocalized(res, R.string.android_nearby_baseTime, w.baseTime), "base-time")
    } ?: row(stringResource(R.string.android_nearby_weatherFailed), "weather-failed")
    // ② 공기질 헤딩 + 측정소(병기: 시각 display·낭독 primary)·khai·pm10·pm25·dataTime / airFailed
    heading(stringResource(R.string.weather_airLabel), "air")
    p.air?.let { a ->
        val name = bilingualName(lang, a.stationName, en = null, roman = a.stationNameRoman)
        Text(appLocalized(res, R.string.android_nearby_airStationLine, name.display, numberText(a.distanceKm)), Modifier.fillMaxWidth().mergedRow("air-station", appLocalized(res, R.string.android_nearby_airStationLine, name.primary, numberText(a.distanceKm))).padding(vertical = 8.dp))
        row(pollutantText(stringResource(R.string.airQuality_khai), a.khai) { stringResource(gradeResId(it)) }, "khai")  // stringResource는 람다 밖에서 미리 계산해 넘긴다
        … pm10 · pm25 · dataTime
    } ?: row(stringResource(R.string.android_nearby_airFailed), "air-failed")
    // ③ 혼잡도 — 있을 때만, 헤더 없음
    p.congestion?.let { c ->
        val name = bilingualName(lang, c.name, en = null, roman = c.nameRoman)
        val level = levelResId(c.level)?.let { stringResource(it) } ?: c.level
        Text(appLocalized(res, R.string.congestion_summary, name.display, level), Modifier.fillMaxWidth().mergedRow("congestion", appLocalized(res, R.string.congestion_summary, name.primary, level)).padding(vertical = 8.dp))
        if (lang == "ko" && c.message.isNotEmpty()) row(c.message, "congestion-message")
        row(appLocalized(res, R.string.congestion_asOf, c.asOf), "congestion-asof")
    }
}
```
(`gradeResId` 람다 안 `stringResource` 호출 금지 — 4등급 문자열을 미리 `remember`가 아니라 지역 변수로 읽어 `grade = { g -> when(g){...} }`로 넘긴다.)

`PlaceDetailScreen.kt`: `for (kind in listOf(NearbyKind.subway, NearbyKind.bus, NearbyKind.bike, NearbyKind.conditions))`, 주석 "(날씨·공기질은 M2b)" 제거.

`NearbyFactories`·`NearbyKindScreen` 분기 추가 → `when` TODO 0건.

- [ ] **Step 4: 실행 → PASS**, `:app:compileDebugKotlin` 통과, `grep -rn 'TODO("M2b")' app/src/main` 0건.
- [ ] **Step 5: 커밋** `feat(android): M2b 5 — 날씨·공기질·혼잡도(조각별 독립·직전 값 유지·혼잡도 성공 null 덮어쓰기)·장소 상세 앵커 4행`

---

### Task 6: 둘러보기 "주변 상황" 자동 펼침

**Files:**
- Create: `nearby/SceneLines.kt`, `nearby/SceneSection.kt`
- Modify: `nearby/AroundPayload.kt`, `nearby/NearbyKindScreen.kt`(`AroundBody`에 삽입)
- Test: `nearby/SceneLinesTest.kt`, `nearby/AroundPayloadTest.kt` 확장

**Interfaces (Produces):**
```kotlin
// AroundPayload: + val scene: SurroundingsScene?, val sceneFailed: Boolean ; isAllAbsent는 셋 다 부재
fun sceneBucketResId(bucket: String): Int?
fun sceneBucketTitle(name: String, count: Int, countLabel: (Int) -> String): String   // count > 3이면 "이름 N곳"
fun sceneItemLine(item: SurroundingsSceneItem, name: String, lang: String, withRoad: (String, String, String) -> String, plain: (String, String) -> String): String
fun sceneItemKey(bucket: String, index: Int) = "scene-item-$bucket-$index"   // iOS `sceneItemRowID` 동형, pop 복귀 키도 같은 값(판정 30)
```

- [ ] **Step 1: 실패 테스트**

```kotlin
class SceneLinesTest {
    @Test fun `묶음 제목은 3개 초과에만 곳수 병기`() {
        assertEquals("왼쪽", sceneBucketTitle("왼쪽", 3) { "${it}곳" }); assertEquals("왼쪽 4곳", sceneBucketTitle("왼쪽", 4) { "${it}곳" })
    }
    @Test fun `12 bucket 키 전수 매핑, 미지 값 null`() {
        listOf("left","right","across","beyond","n","ne","e","se","s","sw","w","nw").forEach { assertNotNull(sceneBucketResId(it), it) }
        assertNull(sceneBucketResId("up"))
    }
    @Test fun `항목 문장 — 도로명은 비-ko에서 로마자만`() {
        val item = SurroundingsSceneItem("카페", "Cafe", 30, "천호대로", "Cheonho-daero", "카페", "1", 37.5, 127.1, "음식점 > 카페")
        assertEquals("30m 앞 카페, 천호대로", sceneItemLine(item, "카페", "ko", { d, n, r -> "$d 앞 $n, $r" }) { d, n -> "$d 앞 $n" })
        assertEquals("30m Cafe, Cheonho-daero", sceneItemLine(item, "Cafe", "en", { d, n, r -> "$d $n, $r" }) { d, n -> "$d $n" })
        assertEquals("30m 앞 카페", sceneItemLine(item.copy(road = null), "카페", "ko", { _, _, _ -> "x" }) { d, n -> "$d 앞 $n" })
    }
}
// AroundPayloadTest 추가
@Test fun `scene 조각 — 실패는 sceneFailed, 셋 다 부재여야 isAllAbsent`() = runTest {
    val p = fetchAround(service(HttpResponse(200, """{"data":null}"""), HttpResponse(200, """{"places":[]}"""), HttpResponse(500, "")), coord)
    assertTrue(p.sceneFailed); assertFalse(p.isAllAbsent)
    val q = fetchAround(service(HttpResponse(200, """{"data":null}"""), HttpResponse(200, """{"places":[]}"""), HttpResponse(200, """{"data":null}""")), coord)
    assertTrue(q.isAllAbsent)
    val r = fetchAround(service(HttpResponse(500, ""), HttpResponse(500, ""), HttpResponse(200, Fixtures.kit("surroundings-scene.json"))), coord)
    assertNotNull(r.scene)   // 하나라도 성공이면 loaded
}
```
(`service(...)` 헬퍼에 `/api/surroundings/scene` 셋째 인자 추가; 기존 2인자 호출은 셋째 기본값 `HttpResponse(200, """{"data":null}""")`.)

- [ ] **Step 2: 실행 → FAIL**
- [ ] **Step 3: 구현**

`AroundPayload.kt`: 필드 `scene: SurroundingsScene?`, `sceneFailed: Boolean` 추가; `isAllAbsent = overview == null && !overviewFailed && !placesFailed && !sceneFailed && places.isNullOrEmpty() && scene == null`; `fetchAround`에 `val scene = async { settled { service.surroundingsScene(coord.lat, coord.lng) } }`; **throw는 `o.isFailure && p.isFailure && s.isFailure`일 때만**(M1 — 장면만 성공해도 Loaded).

`SceneLines.kt`:
```kotlin
fun sceneBucketResId(bucket: String): Int? = when (bucket) {
    "left" -> R.string.surroundings_bucket_left; "right" -> R.string.surroundings_bucket_right; "across" -> R.string.surroundings_bucket_across; "beyond" -> R.string.surroundings_bucket_beyond
    "n" -> R.string.surroundings_bucket_n; "ne" -> …; "e" -> …; "se" -> …; "s" -> …; "sw" -> …; "w" -> …; "nw" -> …; else -> null
}
private const val COUNT_IN_TITLE_THRESHOLD = 3
fun sceneBucketTitle(name: String, count: Int, countLabel: (Int) -> String) = if (count > COUNT_IN_TITLE_THRESHOLD) "$name ${countLabel(count)}" else name
fun sceneItemLine(item: SurroundingsSceneItem, name: String, lang: String, withRoad: (String, String, String) -> String, plain: (String, String) -> String): String {
    val d = formatDistance(item.distanceMeters)
    val road = item.road ?: return plain(d, name)
    return withRoad(d, name, bilingualName(lang, road, en = null, roman = item.roadRoman).primary)
}
fun sceneItemKey(bucket: String, index: Int) = "scene-item-$bucket-$index"
```
(`R` 참조라 :app 안에 두되 순수 함수 — 테스트는 JVM `R` 상수 접근 가능. 안 되면 resId 함수만 `NearbyKindScreen`에 두고 나머지를 테스트한다.)

`SceneSection.kt`:
```kotlin
/**
 * "주변 상황" 자동 펼침(iOS `SurroundingsSceneAutoSection`). 부모 커밋과 함께 나타나고 트리거·닫기·착지가 없다 — 헤딩이 발견 경로.
 * 묶음별 "더 보기" 창은 payload 정체성에 묶인다(새 커밋 = 새 payload = 리셋).
 */
@Composable
fun SceneAutoSection(payload: AroundPayload, vm: NearbyScreenViewModel<AroundPayload>, requesterFor: (String) -> FocusRequester, onOpenPlace: (Place) -> Unit) {
    val res = LocalContext.current.resources; val lang = AppLocale.current(res); val meters = stringResource(R.string.android_unit_spokenMeters)
    val windows by vm.groupWindows.collectAsState()   // VM 소유, 커밋마다 리셋(판정 31)
    heading(stringResource(R.string.surroundings_ready), "scene-heading")
    val scene = payload.scene
    when {
        payload.sceneFailed || scene == null -> row(stringResource(R.string.surroundings_error), "scene-error")
        scene.total == 0 -> row(stringResource(R.string.surroundings_empty), "scene-empty")
        else -> {
            for (group in scene.groups) {
                val name = sceneBucketResId(group.bucket)?.let { stringResource(it) } ?: group.bucket
                heading(sceneBucketTitle(name, group.items.size) { appLocalized(res, R.string.surroundings_count, it) }, "scene-${group.bucket}")
                val visible = windows[group.bucket] ?: RevealWindow.initialVisible
                group.items.take(visible).forEachIndexed { i, item ->
                    val n = bilingualName(lang, item.name, en = null, roman = item.nameRoman)
                    val line = { nm: String -> sceneItemLine(item, nm, lang, { d, x, r -> appLocalized(res, R.string.surroundings_itemWithRoad, d, x, r) }) { d, x -> appLocalized(res, R.string.surroundings_item, d, x) } }
                    val key = sceneItemKey(group.bucket, i)
                    Text(line(n.display), Modifier.fillMaxWidth().focusRequester(requesterFor(key)).clickable(role = Role.Button) { onOpenPlace(sceneItemToPlace(item)) }.testTag(key).defaultMinSize(minHeight = 48.dp).padding(vertical = 8.dp).semantics(mergeDescendants = true) { contentDescription = spokenDistanceUnits(line(n.primary), meters) })
                }
                if (group.items.size > visible) {
                    Button(onClick = { vm.revealMoreInGroup(group.bucket, group.items.size) { i -> sceneItemKey(group.bucket, i) } }, Modifier.tapTarget().testTag("showMore-${group.bucket}")) { Text(stringResource(R.string.actions_showMore)) }
                }
            }
            row(stringResource(R.string.surroundings_source), "scene-source")
        }
    }
}
```
행은 `PlaceRow`가 아니라 문장형(거리·이름·도로명)이라 `mergedRow` 대신 위 체인(focusRequester → clickable → testTag → 48dp → merge) — 소스 가드 착지 순서 규칙(`focusRequester`가 `clickable` 앞) 준수. `AroundBody`: "2. 한눈에 보기" 뒤, "3. 주변 가게" 앞에 `SceneAutoSection(payload, vm, requesterFor, onOpenPlace)`; 장소 행 열 때 `vm.returnFocus.remember(key)`는 `onOpenPlace` 호출부에서(`AroundBody`의 기존 람다에 키를 실어 보내도록 `onOpenPlace: (Place, returnKey: String) -> Unit`로 좁힌다).

- [ ] **Step 4: 실행 → PASS**
- [ ] **Step 5: 커밋** `feat(android): M2b 6 — 둘러보기 "주변 상황" 자동 펼침(세 조각 한 커밋·묶음별 더 보기·출처 각주)`

---

### Task 7: `PlaceDomain` 라우트 인자 + 장소 상세 도메인 섹션(clinic·event)

**Files:**
- Create: `place/DomainSections.kt`
- Modify: `place/PlaceRoutes.kt`, `nearby/NearbyKindScreen.kt`(`NearbyNav.onOpenPlace`), `nearby/PlaceListBodies.kt`(clinic·events가 도메인을 싣는다), `nav/AppRoot.kt`, `place/PlaceDetailScreen.kt`, `nav/AppFactories.kt`(`place: (Place) -> Factory` 유지)
- Test: `place/PlaceRoutesTest.kt` 확장

**Interfaces (Produces):**
```kotlin
@Serializable sealed class PlaceDomain { @Serializable data class Clinic(val clinic: NightClinic) : PlaceDomain(); @Serializable data class Event(val event: CultureEvent) : PlaceDomain() }
data class PlaceDetailRoute(val placeJson: String, val domainJson: String? = null) { val domain: PlaceDomain? ; companion fun of(place, domain: PlaceDomain? = null) }
NearbyNav.onOpenPlace: (Place, PlaceDomain?) -> Unit
@Composable fun PlaceDetailScreen(factory, nav, domain: PlaceDomain?, takeReturnFocus)
```

- [ ] **Step 1: 실패 테스트** `PlaceRoutesTest`:
```kotlin
@Test fun `도메인 섹션 인자는 JSON 왕복한다(재생성 뒤에도 남는다, 판정 26)`() {
    val clinic = NightClinic("c1", "달빛의원", null, "서울", "02", "의원", "", "1번 출구", 37.5, 127.1, 100, emptyList(), NightClinic.OpenStatus("open", 900, 2400), designated = true)
    val route = PlaceDetailRoute.of(nightClinicToPlace(clinic), PlaceDomain.Clinic(clinic))
    assertEquals(PlaceDomain.Clinic(clinic), route.domain)
    assertNull(PlaceDetailRoute.of(nightClinicToPlace(clinic)).domain)
}
```
- [ ] **Step 2: FAIL 확인**
- [ ] **Step 3: 구현**

`PlaceRoutes.kt`:
```kotlin
/** 장소 상세 최상단 도메인 섹션 재료(iOS `domainSection` — 그 화면에 온 이유라 서열 1위). 라우트 JSON이라 재생성 뒤에도 남는다(판정 26). */
@Serializable
sealed class PlaceDomain {
    @Serializable data class Clinic(val clinic: NightClinic) : PlaceDomain()
    @Serializable data class Event(val event: CultureEvent) : PlaceDomain()
}
@Serializable
data class PlaceDetailRoute(val placeJson: String, val domainJson: String? = null) {
    val place: Place get() = KitJson.decodeFromString(Place.serializer(), placeJson)
    val domain: PlaceDomain? get() = domainJson?.let { KitJson.decodeFromString(PlaceDomain.serializer(), it) }
    companion object {
        fun of(place: Place, domain: PlaceDomain? = null) = PlaceDetailRoute(KitJson.encodeToString(Place.serializer(), place), domain?.let { KitJson.encodeToString(PlaceDomain.serializer(), it) })
    }
}
```
`KitJson`이 `classDiscriminator` 기본(`type`)으로 sealed를 직렬화하는지 확인(`KitJson.kt`) — `ignoreUnknownKeys`만 켜져 있으면 기본으로 된다.

`DomainSections.kt`:
```kotlin
/** 소아 진료 도메인 섹션 — 진료 상태 / 오시는 길 / 달빛 지정(true일 때만). 전부 평문 한 줄=한 객체. */
@Composable
fun ClinicDomainSection(clinic: NightClinic) {
    val res = LocalContext.current.resources; val words = clinicWords(res)
    row(clinicStatusText(clinic.openStatus, words), "domain-status")
    if (clinic.directions.isNotEmpty()) row(appLocalized(res, R.string.clinicNearby_directions, clinic.directions), "domain-directions")
    if (clinic.designated == true) row(stringResource(R.string.android_clinic_designated), "domain-designated")
}
/** 문화행사 도메인 섹션 — 장소·자치구(병기), 기간·시간, 요금, 대상. 빈 값은 줄 없음. */
@Composable
fun CultureEventSection(event: CultureEvent) {
    val res = LocalContext.current.resources; val lang = AppLocale.current(res)
    val place = bilingualName(lang, event.place, en = null, roman = event.placeRoman)
    val venue = joinText(place.display, event.district)
    if (venue.isNotEmpty()) Text(venue, Modifier.fillMaxWidth().mergedRow("domain-venue", joinText(place.primary, event.district)).padding(vertical = 8.dp))
    joinText(event.dateText, event.timeText).takeIf { it.isNotEmpty() }?.let { row(it, "domain-when") }
    row(eventFeeText(event, stringResource(R.string.eventsNearby_free)) { appLocalized(res, R.string.eventsNearby_paid, it) }, "domain-fee")
    if (event.target.isNotEmpty()) row(appLocalized(res, R.string.eventsNearby_target, event.target), "domain-target")
}
```
(`row`/`heading` 헬퍼는 `a11y/A11y.kt`에 `@Composable fun BodyLine(text, key, spoken = null)`·`HeadingLine(text, key, focus = null)`로 한 번만 정의하고 Task 4~9 본문이 공유한다 — Task 4에서 만들고 여기서 재사용.)

`PlaceDetailScreen(factory, nav, domain, takeReturnFocus)`: 제목 보조 줄(1) 뒤, 분류(2) 앞에 `when (domain) { is PlaceDomain.Clinic -> ClinicDomainSection(domain.clinic); is PlaceDomain.Event -> CultureEventSection(domain.event); null -> Unit }`. `AppRoot`: `PlaceDetailScreen(..., domain = remember(route) { route.domain }, ...)`; `NearbyNav.onOpenPlace = { place, domain -> navController.navigate(PlaceDetailRoute.of(place, domain)) }`; `SearchScreen` 호출은 `PlaceDetailRoute.of(it)`. `ClinicBody`·`EventsBody`의 `onOpen`이 `PlaceDomain.Clinic(c)`/`PlaceDomain.Event(e)`를 싣는다; 나머지 kind는 `null`.

- [ ] **Step 4: PASS**
- [ ] **Step 5: 커밋** `feat(android): M2b 7 — 장소 상세 도메인 섹션(소아 진료·문화행사, 라우트 JSON 인자)`

---

### Task 8: 역 자동 섹션 5종

**Files:**
- Create: `place/StationLines.kt`, `place/StationSectionsView.kt`
- Modify: `place/PlaceDetailViewModel.kt`, `place/PlaceFactories.kt`, `place/PlaceDetailScreen.kt`, `MainActivity.kt`
- Test: `place/StationLinesTest.kt`, `place/PlaceDetailViewModelTest.kt` 확장

**Interfaces (Produces):**
```kotlin
sealed class TimetableState { data object Hidden; data object Error; data class Done(val timetable: StationTimetable) }
data class StationSections(val meta: StationMeta?, val arrivals: StationArrivals?, val timetable: TimetableState, val korail: StationFacilities?, val metro: SeoulMetroFacilities?)
suspend fun loadStationSections(service: StationService, station: String, dataLocale: String): StationSections   // 5 병렬, 시간표만 3-state
fun countText(label: String, count: Int?, unknown: (String) -> String, none: (String) -> String, some: (String, Int) -> String): String
fun coverageText(line: TimetableLine, lineDisplayName: (TimetableLine) -> String, noTrains: (String) -> String, unavailable: (String) -> String, unknown: (String) -> String): String?   // coverage = line.coverage ?: (directions 비면 "unknown" else "ok") (m1)
fun lineKoName(line: TimetableLine, lineSuffixed: (String) -> String): String = line.lineCore?.let(lineSuffixed) ?: line.lineName   // A26, 방향 행
fun lineDisplayName(line: TimetableLine, isEn: Boolean, lineSuffixed: (String) -> String): String = if (isEn && line.lineNameEn != null) line.lineNameEn!! else lineKoName(line, lineSuffixed)   // coverage 사유 줄
fun trainText(train: TimetableTrain, en: Boolean, nextDay: String, toTerminus: (String) -> String): String
fun terminusReady(train: TimetableTrain): Boolean = train.terminus.isEmpty() || train.terminusEn != null   // 종착이 비면 영문 불필요(N4)
fun timetableLineEn(line: TimetableLine, direction: TimetableDirection, isEn: Boolean): Boolean = isEn && line.lineNameEn != null && terminusReady(direction.first) && terminusReady(direction.last)
fun facilityName(f: SeoulMetroFacility, compass: (String) -> String?, elevatorAt: (String, String) -> String, lineNumber: (String) -> String): String
fun facilityDetail(f: SeoulMetroFacility, wheelchairAccessible: String): String?
fun stationMetaLine(meta: StationMeta, lang: String, isEn: Boolean, nameSuffixed: (String) -> String, transfer: String): LineText   // ko: joinText(nameSuffixed(name), nameEn, tail) / en: joinText(bilingualName(name, en=nameEn).display, tail)·spoken은 .primary (m2)
// PlaceDetailViewModel: val station: StateFlow<StationSections?>  (isStation일 때만 로드)
```

- [ ] **Step 1: 실패 테스트** `StationLinesTest`(iOS 함수 이식 검증):
```kotlin
@Test fun `시설 수 3-state`() { val f = { l: String, c: Int? -> countText(l, c, { "$it 정보 없음" }, { "$it 없음" }) { l2, n -> "$l2 ${n}대" } }
    assertEquals("엘리베이터 정보 없음", f("엘리베이터", null)); assertEquals("엘리베이터 없음", f("엘리베이터", 0)); assertEquals("엘리베이터 3대", f("엘리베이터", 3)) }
@Test fun `coverage — ok는 null, 부재+방향 0은 unknown(m1), 부재+방향 있음은 ok`() { ... line(coverage=null, directions=[]) → unknown 문장; line(coverage=null, directions=[d]) → null; coverage="noTrains" → noTrains(lineDisplayName) }
@Test fun `노선명 — 방향 행은 lineCore 접미(A26), coverage 줄은 en 우선`() { assertEquals("2호선", lineKoName(TimetableLine("수도권 2", lineCore = "2", …)) { "${it}호선" }); assertEquals("Line 2", lineDisplayName(line(lineNameEn = "Line 2"), true) { … }) }
@Test fun `첫차 문장 — 익일 접두·종착 없음·en 종착 폴백`() {
    assertEquals("익일 00:42 왕십리행", trainText(TimetableTrain("00:42", nextDay = true, terminus = "왕십리"), false, "익일") { "${it}행" })
    assertEquals("05:30", trainText(TimetableTrain("05:30", terminus = ""), true, "next") { "to $it" })
    assertEquals("05:30 to Wangsimni", trainText(TimetableTrain("05:30", terminus = "왕십리", terminusEn = "Wangsimni"), true, "next") { "to $it" })
}
@Test fun `시설 이름 — parts compass+meters 우선, location+lineEn 차선, 없으면 name`() { ... }
@Test fun `역 메타 한 줄 — ko는 접미·영문·노선·환승·운영기관, en은 병기`() { ... LineText(visual, spoken) }
// PlaceDetailViewModelTest
@Test fun `역 섹션 — 시간표만 실패를 Error로, 나머지 실패는 null`() = runTest {
    val s = StationService(stubbedClient { url -> when (pathOf(url)) { "/api/station/timetable" -> HttpResponse(500, ""); "/api/station/meta" -> HttpResponse(200, Fixtures.kit("station-meta.json")); else -> HttpResponse(500, "") } })
    val r = loadStationSections(s, "강남", "ko")
    assertNotNull(r.meta); assertNull(r.arrivals); assertEquals(TimetableState.Error, r.timetable)
    val hidden = loadStationSections(StationService(stubbedClient { HttpResponse(200, """{"timetable":null}""") }), "강남", "ko")
    assertEquals(TimetableState.Hidden, hidden.timetable)
}
```
(`TimetableTrain` 생성자 인자 순서는 `StationModels.kt` 104~110행을 읽고 맞춘다.)

- [ ] **Step 2: FAIL**
- [ ] **Step 3: 구현** — `StationLines.kt`에 위 시그니처를 iOS `StationSections.swift` 163~320행 그대로 이식(`metroKindResId`·`dailyTypeResId`·`directionResId`·`operatingStatusResId`·`compassResId`(`subway_direction_*`)는 리터럴 `when` → resId, 미지 값 원문). `loadStationSections`는 `coroutineScope { async { settled { … } } ×5 }`; 시간표는 `settled` 결과가 실패면 `Error`, `null`이면 `Hidden`, 값이면 `Done`.

`PlaceDetailViewModel(place, hours, strings, station: StationService?, barrierFree: BarrierFreeService?, dataLocale: () -> String)`: `init`에서 `if (isStation(place) && station != null) viewModelScope.launch { _station.value = loadStationSections(station, place.name, dataLocale()) }`. (테스트 편의로 nullable — 기존 테스트는 null.)

`StationSectionsView.kt`(iOS 렌더 순서: meta → arrivals → timetable → korail → metro; 각 섹션 헤딩 = 발견 경로, 실패·null은 그 섹션 없음, 시간표 Error는 문장):
```kotlin
@Composable
fun StationSectionsView(s: StationSections) {
    val res = LocalContext.current.resources; val lang = AppLocale.current(res); val dataLocale = AppLocale.dataLocale(res); val isEn = dataLocale == "en"
    s.meta?.let { m -> HeadingLine(stringResource(R.string.stationMeta_heading), "station-meta"); val line = stationMetaLine(m, lang, dataLocale, { appLocalized(res, R.string.android_station_nameSuffixed, it) }, stringResource(R.string.stationMeta_transfer)); BodyLine(line.visual, "station-meta-line", line.spoken) }
    s.arrivals?.let { a -> HeadingLine(stringResource(R.string.android_station_arrivalHeading), "station-arrivals")
        if (a.arrivals.isEmpty()) BodyLine(stringResource(R.string.android_station_noArrivals), "station-arrivals-none")
        else a.arrivals.forEachIndexed { i, arr -> BodyLine(subwayArrivalLine(arr, isEn, segmentText, express) { appLocalized(res, R.string.subwayArrival_currentLocation, it) }, "station-arrival-$i") } }   // segmentText·express는 SubwayBody의 것을 internal 함수로 승격해 공유
    when (val t = s.timetable) {
        TimetableState.Hidden -> Unit
        TimetableState.Error -> { HeadingLine(stringResource(R.string.timetable_heading), "timetable"); BodyLine(stringResource(R.string.timetable_error), "timetable-error") }
        is TimetableState.Done -> { HeadingLine(...); BodyLine(joinText(dailyTypeLabel, partial?), "timetable-daily"); for (line in t.timetable.lines) { coverageText(...)?.let { BodyLine(it, "timetable-${line.lineName}") } ?: line.directions.forEach { d -> val en = timetableLineEn(line, d, dataLocale); BodyLine(joinText("${if (en) line.lineNameEn!! else lineKoName(line)} ${directionLabel(d.direction)}", "${first} ${trainText(d.first, en, …)}", "${last} ${trainText(d.last, en, …)}"), "timetable-${line.lineName}-${d.direction}") } } }
    }
    s.korail?.let { f -> HeadingLine(stringResource(R.string.android_station_railFacilities), "korail"); BodyLine(if (f.accessibleToilet) … accessibleToiletYes else …No); BodyLine(countText(wheelchairLifts label, f.wheelchairLifts, …)); BodyLine(accessibleSlope Yes/No); BodyLine(countText(elevators label, f.elevators, …)) }
    s.metro?.let { f -> HeadingLine(stringResource(R.string.android_station_seoulFacilities), "metro"); for (g in f.groups) { BodyLine(appLocalized(res, R.string.android_station_kindCount, metroKindLabel(g.kind), g.facilities.size), "metro-${g.kind}"); g.facilities.forEachIndexed { i, fac -> BodyLine(joinText(facilityName(fac, …), fac.location, fac.floors, operatingStatusText(fac.operatingStatus), facilityDetail(fac, …)), "metro-${g.kind}-$i") } }
        if (f.supplementFailed == true) BodyLine(stringResource(R.string.subway_supplementFailed), "metro-supplement")
        if (f.groups.any { it.kind == "voiceGuide" }) BodyLine(stringResource(R.string.subway_voiceGuideSource), "metro-voice") }
}
```
`PlaceDetailScreen`: "이 장소 주변" 4행 다음에 `station?.let { StationSectionsView(it) }`. `MainActivity`: `placeDetailFactory(place, PlaceHoursService(...), placeStrings(app), StationService(AppConfig.apiClient), BarrierFreeService(AppConfig.apiClient)) { AppLocale.dataLocale(app.resources) }`.

- [ ] **Step 4: PASS**
- [ ] **Step 5: 커밋** `feat(android): M2b 8 — 역 자동 섹션 5종(병렬·조각별 null·시간표 3-state)`

---

### Task 9: 무장애 편의시설 자동 섹션

**Files:**
- Create: `place/BarrierFreeLines.kt`, `place/BarrierFreeSection.kt`
- Modify: `place/PlaceDetailViewModel.kt`, `place/PlaceDetailScreen.kt`
- Test: `place/BarrierFreeLinesTest.kt`

- [ ] **Step 1: 실패 테스트** — `strings.xml`의 `barrierFreeInfo_facility_*` 27키 전수가 `barrierFreeFacilityResId(key)`에 매핑되는지(리소스 이름 → key 역산):
```kotlin
class BarrierFreeLinesTest {
    @Test fun `시설 키 27종 전수 매핑, 미지 키 null`() {
        val xml = File("src/main/res/values/strings.xml").readText()   // AppSourceGuardTest와 같은 루트(`app/`)
        val keys = Regex("""name="barrierFreeInfo_facility_([a-z]+)"""").findAll(xml).map { it.groupValues[1] }.toList()
        assertEquals(27, keys.size)
        keys.forEach { assertNotNull(barrierFreeFacilityResId(it), it) }
        assertNull(barrierFreeFacilityResId("teleport"))
    }
}
```
- [ ] **Step 2: FAIL** → **Step 3: 구현** — `barrierFreeFacilityResId(key: String): Int?` 27개 `when`(iOS 47~75행 키 목록 그대로); VM `val barrierFree: StateFlow<BarrierFreeDetail?>`(`init`: `barrierFree?.match(place.lat, place.lng, place.name)?.takeIf { it.facilities.isNotEmpty() }` — `match`는 비-throw 계약(BarrierFreeService.kt 확인, throw면 `runCatching`이 아니라 `settled`로 null)); `BarrierFreeSection(detail)`: 헤딩 `barrierFreeInfo_heading` + 행 `"${label} ${value}"`(미지 키는 `facility.label`) + `barrierFreeInfo_source`. 화면: 역 섹션 다음(마지막).
- [ ] **Step 4: PASS** → **Step 5: 커밋** `feat(android): M2b 9 — 무장애 편의시설 자동 섹션(시설 1개 이상일 때만)`

---

### Task 10: 현재 위치 표시줄(허브 첫 행) + `CurrentAddressStore`

**Files:**
- Create: `location/CurrentAddressStore.kt`, `location/LocationBar.kt`
- Modify: `location/LocationStore.kt`, `nearby/NearbyHubScreen.kt`, `nav/AppFactories.kt`, `nav/AppRoot.kt`, `MainActivity.kt`, `AppConfig.kt`
- Test: `location/LocationBarTest.kt`, `location/CurrentAddressStoreTest.kt`, `location/LocationStoreTest.kt` 확장

**Interfaces (Produces):**
```kotlin
// LocationStore
fun authorization(): LocationPermission = permissions.current()
/**
 * 표시용 좌표(iOS `coordinateForDisplay`): 권한 Fine이 아니면 null(팝업 없음), soft 상한, **TTL·정확도는 기본값**(60초·30m), 실패는 **null — `stored` 폴백 없음**.
 * `coordinateForRanking`과 세 축이 다르다(M6): 이 좌표는 역지오코딩돼 "현재 위치, 〈주소〉"로 낭독되므로 낡은 좌표의 주소는 화면으로 반증할 수 없는 거짓 위치 주장이다.
 */
suspend fun coordinateForDisplay(): NearbyCoord? {
    if (permissions.current() != LocationPermission.Fine) return null
    return try { currentCoordinate(timeoutMs = (LocationFixPolicy.softTimeout * 1000).toLong()) } catch (e: LocationException) { null }
}
// CurrentAddressStore
data class LocationBarInput(val permission: LocationPermission, val hasCoordinate: Boolean, val lastFixFailed: Boolean, val address: String?, val english: String?)
class CurrentAddressStore(private val location: LocationStore, private val search: SearchService) {
    val state: StateFlow<LocationBarInput>
    suspend fun ensureLoaded(lang: String)   // 좌표당·언어당 1회, 취소는 확정 아님, 좌표 갈리면 옛 주소 먼저 폐기
}
// LocationBar.kt
fun locationBarLabel(input: LocationBarInput, lang: String, needsPermission: String, reducedAccuracy: String, gps: String, gpsNear: (String) -> String, locating: String, gpsFailed: String): LineText   // None → needsPermission(`geoDeniedTitle`), Coarse → reducedAccuracy(`geoReducedTitle`)(판정 29·N1)
@Composable fun LocationBarRow(store: CurrentAddressStore)
```
`coordinateForDisplay`는 `coordinateForRanking`과 **다른 함수**다(M6: TTL 60초·30m·스토어 폴백 없음 vs 300초·100m·스토어 폴백). 둘 다 `currentCoordinate` 위의 얇은 게이트라 중복은 인자 셋뿐.

- [ ] **Step 1: 실패 테스트**
```kotlin
class LocationBarTest {
    private fun label(i: LocationBarInput, lang: String = "ko") = locationBarLabel(i, lang, "위치 권한이 필요합니다", "정확한 위치가 꺼져 있습니다", "현재 위치", { "현재 위치($it 부근)" }, "확인 중", "위치 확인 실패")
    @Test fun `4-state — 권한 없음은 실패가 아니라 권한 필요(판정 29)·실패·확인 중·주소`() {
        assertEquals("위치 권한이 필요합니다", label(LocationBarInput(LocationPermission.None, true, true, "길동", null)).visual)   // 권한이 좌표·실패보다 먼저
        assertEquals("위치 확인 실패", label(LocationBarInput(LocationPermission.Fine, false, true, null, null)).visual)
        assertEquals("확인 중", label(LocationBarInput(LocationPermission.Fine, false, false, null, null)).visual)
        assertEquals("현재 위치", label(LocationBarInput(LocationPermission.Fine, true, false, null, null)).visual)
        assertEquals("현재 위치(천호대로 1 부근)", label(LocationBarInput(LocationPermission.Fine, true, false, "천호대로 1", null)).visual)
        val en = label(LocationBarInput(LocationPermission.Fine, true, false, "천호대로 1", "1 Cheonho-daero"), "en")
        assertEquals("현재 위치(1 Cheonho-daero (천호대로 1) 부근)", en.visual); assertEquals("현재 위치(1 Cheonho-daero 부근)", en.spoken)
    }
    @Test fun `Coarse는 시도 여부와 무관하게 "정확한 위치가 꺼져 있습니다"(N1 — 표시용 좌표는 Fine에서만 시도해 확인 중에 갇히지 않는다)`() {
        assertEquals("정확한 위치가 꺼져 있습니다", label(LocationBarInput(LocationPermission.Coarse, false, false, null, null)).visual)
        assertEquals("정확한 위치가 꺼져 있습니다", label(LocationBarInput(LocationPermission.Coarse, true, true, "길동", null)).visual)
    }
}
class CurrentAddressStoreTest {   // LocationStoreTest의 페이크 LocationSource·PermissionGate 재사용
    @Test fun `좌표당 1회, 언어가 바뀌면 다시, 좌표가 갈리면 옛 주소 먼저 폐기`() = runTest { ... calls 카운트 1 → 같은 좌표 재호출 0 → lang "en" 호출 1 → 좌표 이동 뒤 state.address null 확인 후 새 주소 }
    @Test fun `미허용이면 네트워크 0, loadedKey 안 세움 — 허용 뒤 조회된다`() = runTest { ... }
    @Test fun `취소는 확정이 아니다`() = runTest { 전송 스텁이 suspend 중 job.cancel() → 다시 ensureLoaded → 호출 1회 더 }
}
```
- [ ] **Step 2: FAIL** → **Step 3: 구현**

`CurrentAddressStore.kt`:
```kotlin
class CurrentAddressStore(private val location: LocationStore, private val search: SearchService) {
    private val _state = MutableStateFlow(snapshot(null, null))
    val state: StateFlow<LocationBarInput> = _state.asStateFlow()
    private var loadedKey: String? = null
    private var inflight = false
    private fun snapshot(address: String?, english: String?) = LocationBarInput(location.authorization(), location.stored != null, location.lastFixFailed, address, english)

    suspend fun ensureLoaded(lang: String) {
        if (inflight) return
        inflight = true
        try {
            val coord = location.coordinateForDisplay()   // 허용된 세션에서만·팝업 없음·낡은 좌표 없음(M6)
            _state.value = snapshot(_state.value.address, _state.value.english)
            if (coord == null) return
            val key = "%.4f,%.4f|%s".format(Locale.ROOT, coord.lat, coord.lng, lang)
            if (key == loadedKey) return
            if (loadedKey != null) _state.value = snapshot(null, null)   // 옛 주소 먼저 폐기
            val resolved = settled { search.reverseGeocode(coord.lat, coord.lng, lang) }.getOrNull()   // 취소는 통과(확정 아님)
            loadedKey = key
            _state.value = snapshot(resolved?.address, resolved?.address?.let { resolved.english })
        } finally { inflight = false }
    }
}
```
(`settled`는 `nearby/AroundPayload.kt`의 것 — `location/`이 `nearby/`를 import하면 방향이 어색하니 `kit`… 아니면 `a11y`가 아닌 `net/`? → **`settled`를 `location/Settled.kt`로 옮기지 않고** 여기서는 `try { } catch (e: CancellationException) { throw e } catch (e: Exception) { null }`을 직접 쓴다. 두 줄이라 공유 가치가 없다.)

`LocationBar.kt`:
```kotlin
/** iOS `LocationBarView.state` 4-state(수동 위치 갈래는 M2c). 권한 없음이 좌표보다 먼저 — 권한 회수 뒤에도 좌표가 남는다. */
fun locationBarLabel(input: LocationBarInput, lang: String, gps: String, gpsNear: (String) -> String, locating: String, gpsFailed: String): LineText {
    if (input.permission == LocationPermission.None) return LineText(needsPermission, needsPermission)   // 안 물음·거부 구분 불가 — 둘 다 참인 문장(판정 29)
    if (input.permission == LocationPermission.Coarse) return LineText(reducedAccuracy, reducedAccuracy)   // 표시용 좌표는 Fine에서만 시도 — 여기서 갈라야 "확인 중"에 안 갇힌다
    if (!input.hasCoordinate) return (if (input.lastFixFailed) gpsFailed else locating).let { LineText(it, it) }
    val address = input.address ?: return LineText(gps, gps)
    val name = bilingualName(lang, address, en = input.english, roman = null)
    return LineText(gpsNear(name.display), gpsNear(name.primary))
}
@Composable
fun LocationBarRow(store: CurrentAddressStore) {
    val res = LocalContext.current.resources; val input by store.state.collectAsState()
    LaunchedEffect(Unit) { store.ensureLoaded(AppLocale.dataLocale(res)) }
    val line = locationBarLabel(input, AppLocale.current(res), stringResource(R.string.android_common_geoDeniedTitle), stringResource(R.string.android_common_geoReducedTitle), stringResource(R.string.manualLocation_gps), { appLocalized(res, R.string.manualLocation_gpsNear, it) }, stringResource(R.string.manualLocation_locating), stringResource(R.string.manualLocation_gpsFailed))
    Text(line.visual, Modifier.fillMaxWidth().mergedRow("location-bar", line.spoken.takeIf { it != line.visual }).padding(vertical = 8.dp))
}
```
`AppConfig.currentAddressStore by lazy { CurrentAddressStore(locationStore, SearchService(apiClient)) }`; `AppFactories.currentAddress: CurrentAddressStore`; `NearbyHubScreen(onOpen, takeReturnFocus, currentAddress)` 첫 행에 `LocationBarRow(currentAddress)`; `AppRoot`에서 전달.

`LocationStoreTest` 확장: `authorization()`이 게이트 `current()`를 그대로 준다 · `coordinateForDisplay()` — 권한 None이면 null이고 `request()` 호출 0 · 낡은 `stored`가 있고 이번 취득이 실패하면 **null**(`coordinateForRanking`은 같은 조건에서 stored 좌표) 2건.

- [ ] **Step 4: PASS** → **Step 5: 커밋** `feat(android): M2b 10 — 현재 위치 표시줄(4-state·좌표당 1회 역지오코딩·위치 요청 없음)`

---

### Task 11: 소스 가드·androidTest·문서·게이트·리뷰

**Files:**
- Modify: `app/src/test/.../nav/AppSourceGuardTest.kt`, `androidTest/nearby/NearbyScreenA11yTest.kt`, `androidTest/place/PlaceDetailA11yTest.kt`, `CHANGELOG.md`(맨 위 날짜 절 안드로이드 항목), `android/README.md`(§1 트리에 신설 파일), spec §12-6 "적대적 설계 리뷰 판정" 줄·§9 실기기 17~22 확인

- [ ] **Step 1: 소스 가드 추가**(`AppSourceGuardTest`): ① `NearbyKind.entries` 순서가 spec 표(around·subway·bus·bike·clinic·barrierFree·kids·events·walkInfra·conditions)와 같다(`NearbyKindTest`가 아니라 enum 순서 단언) ② `nearby/`·`place/` 본문 파일에서 `LocationManager`·`Scaffold(` 0(기존 가드가 신설 파일도 스캔하는지 glob 확인) ③ `sceneBucketResId`·`barrierFreeFacilityResId`·`metroKindResId` 등 리터럴 `when`에 `R.string.` 동적 조립(`getIdentifier`) 0.
- [ ] **Step 2: androidTest 4건**(컴파일 게이트만 — 실기기 연결 시 실행, m10): `NearbyScreenA11yTest`에 `conditionsLandsOnWeatherHeading`(conditions kind, 스텁 3경로, `conditions-weather` 노드 헤딩·포커스) · `walkInfraHasThreeGroupHeadings`(`walk-nearby.json`, 헤딩 `audio`·`crossing`·`tactile` 존재 + `walkinfra-top` 착지) · `PlaceDetailA11yTest`에 `stationSectionsAppearQuietly`(역 place + 스텁 5경로 → `station-meta` 헤딩 존재, 통지 텍스트 없음) · 허브 `locationBarReadsPermissionNeededWhenNone`(`NearbyHubScreen` + None 권한 스토어 → `location-bar` 텍스트 = 권한 필요 문구). 각각 `tryPerformAccessibilityChecks`.
- [ ] **Step 3: 문서** — CHANGELOG 항목 2~4줄 + spec 링크; README §1 트리; spec §12-6 판정 22~28 밑에 구현 중 바뀐 것(예: `coordinateForDisplay` 신설 대신 `coordinateForRanking` 공용 — 판정 28 각주).
- [ ] **Step 4: 게이트(락)** — `until mkdir ~/gildongmu-wt/gate.lock 2>/dev/null; do sleep 30; done` → `cd android && export ANDROID_HOME=~/Library/Android/sdk && ./gradlew :kit:test :app:testDebugUnitTest :app:assembleDebug :app:assembleExperimental :app:compileDebugAndroidTestKotlin && ./gradlew --stop` → `cd .. && VITEST_MAX_THREADS=2 npm run test:run`(기지 실패 1건 `xcstrings-plural` xcrun 라이선스만 허용) → `rmdir ~/gildongmu-wt/gate.lock`.
- [ ] **Step 5: 커밋** `docs(android): M2b 문서·소스 가드·androidTest` → 구현 리뷰 2건(spec-compliance·code-quality, `model: opus`, 결과 `~/gildongmu-wt/android-m1-reports/review-m2b-{spec,quality}.md`) → 반영 → 게이트 재실행 → `git rebase main` → 게이트 → `git -C ~/Mac-Projects/gildongmu merge --ff-only feat/android-m1` → 보고 ⑤(report.md + 코디네이터).

---

## 후속(이 계획 밖, 코디네이터 판정 2026-09-16)

- **M2c 수동 위치 지정**: M3 `directions/` 출발·도착지 검색 화면 재사용 + `ManualLocationStore/Judge` 이식 + 표시줄을 버튼(`manualLocation.pickTitle` 꼬리)으로. M3 통합 뒤.
- **설정 화면 마일스톤**(별도 항목): 언어·결과 진동·받아쓰기 홀드 등 iOS 설정 미러. 결과 진동(`HapticFeedbackConstants.CONFIRM/REJECT`)은 그때 함께 판정.

## Self-review 기록

- spec §12-1 표 6행 → Task 3·4·5 / §12-1 도메인 섹션 → Task 7 / §12-2 → Task 6 / §12-3 → Task 8·9 / §12-4 → Task 10 / §12-5 테스트 레인 → 각 Task Step 1 + Task 11 / §12-6 판정 22~28 → 후속·Task 4(24)·Task 1(25)·Task 7(26)·Task 8(27)·Task 10(28).
- 타입 일관: `NearbyKindSpec.fetch(NearbyCoord?, P?)`(Task 1) ↔ Task 3~6 조립기 `{ c, _ -> }`·`{ c, previous -> }`; `landOn`(Task 1) ↔ Task 6; `ClinicWords`·`clinicWords(res)`(Task 2·3) ↔ Task 7; `LineText`(기존) ↔ Task 8·10; `NearbyServices`(Task 3) ↔ Task 4·5 팩토리; `BodyLine`·`HeadingLine`(Task 4에서 `a11y/A11y.kt`에 신설) ↔ Task 5~9.
- 플레이스홀더: Task 1의 `TODO("M2b")` 분기는 Task 5 끝 0건 확인 단계가 있다(의도된 임시).
- 설계 리뷰 2차 반영: N1 → Task 10 `Coarse` 갈래 · N2 → Task 4 앱 언어 로케일 · N3 → Task 1 `Map<String, RevealWindow>` 내부 · N4 → Task 8 `terminusReady` · N5 → Task 5 `settled`.
- 설계 리뷰 1차 반영(2026-09-16): B1 → Task 10 판정 29 · M1 → Task 6 삼항 throw · M2·M3 → Task 1 `groupWindows`/Task 6 자체 행 `scene-item-` · M4 → Task 4 0건 문구 · M5 → 매핑표 기본 분기 단언(각 Task 테스트) · M6 → Task 10 `coordinateForDisplay` 별도 · m1~m3·m12 → Task 8 · m7 → Task 4 · m10 → Task 11 · m13 → Task 10 스냅샷.
