# 안드로이드 M4 도보 실시간 안내 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** iOS 정식판 도보 실시간 안내와 기능 등가인 안드로이드 [3] 실행 계층·[4] 화면을 `guide/`·`audio/`에 새로 쓰고, `:kit` 판정 계층을 소비만 한다.

**Architecture:** `GuideSession`(앱 수명 싱글턴)이 `WalkGuideModel`(iOS `BeaconModel` walk 절단면, 판정은 전부 `:kit`)을 소유하고, 전경 서비스(`location` 타입 + wake lock)가 위치 스트림을 열어 모델에 fix를 붓는다. 오디오는 SoundPool + AudioFocus(재생 단위) + TextToSpeech 한 채널, 화면은 `AppRoot` `bottomBar` 한 자리의 `GuideBottomBar`(띠바 + ModalBottomSheet 시트) + 브리핑 도보 행의 시작 버튼이다. 조각 4개(①서비스·위치·알림·세션 ②오디오 ③화면 ④계측·마감)를 순서대로 로컬 `main`에 ff한다.

**Tech Stack:** Kotlin 2.4 · Compose BOM 2026.09(Material3 1.4.0 `ModalBottomSheet`) · 플랫폼 API만(`LocationManager`·`SoundPool`·`AudioFocusRequest`·`TextToSpeech`·`Vibrator`·`SensorManager`·`Notification.Builder`·`PowerManager`) · JUnit5 + `MainDispatcherExtension` + `:kit` testFixtures · Compose ATF androidTest.

**Spec:** `docs/superpowers/specs/2026-09-16-android-m4-walk-guidance-design.md` (설계 확정 `a569cd83`, 리뷰 3회 반영). 절 번호는 이 spec 기준.

**구현 방식 판정(자율성 헌장):** inline. 조각 안 태스크가 순차 의존이고 `WalkGuideModel.kt`·`GuideSession.kt`를 여러 태스크가 편집한다. 리뷰(spec-compliance + code-quality)만 조각마다 별도 컨텍스트(`model: opus`).

## Global Constraints

- `:kit`·`ios/**`·`src/**`·`packages/**`·`location/`·`nav/`(AppRoot `bottomBar` 한 자리 제외)·`a11y/`·`i18n/`·`net/`·`storage/`·`speech/`·`docs/BACKLOG.md`·`PROGRESS.md`·`CLAUDE.md` 무수정. `app/build.gradle.kts` 의존성 추가 0. androidx `core`(`NotificationCompat`·`ContextCompat`) import 0.
- 매니페스트 additive는 **단독 커밋**(Task 2). `AppSourceGuardTest` 허용 목록 1줄은 코디네이터 허가 뒤(Task 3 — 허가 전엔 게이트가 빨갛다는 것을 알고 보고).
- 게이트(README §7, 락 안): `until mkdir ~/gildongmu-wt/gate.lock 2>/dev/null; do sleep 30; done; (cd android && ./gradlew :kit:test :app:testDebugUnitTest :app:assembleDebug :app:assembleExperimental); VITEST_MAX_THREADS=2 npm run test:run; rmdir ~/gildongmu-wt/gate.lock; (cd android && ./gradlew --stop)`. vitest `xcstrings-plural` 1건 실패는 기대값.
- 커밋: pathspec(`git commit -- <files>`), `git add -A` 금지, 한국어 메시지, 꼬리말 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. `origin` push 금지.
- 문자열: 인자 있는 조회는 `appLocalized`만(`LocalizedCallSiteGuardTest`), 키 → `R.string` 리터럴 표(`GuideStrings.stringId`), `res/values*/strings.xml`은 생성물(손으로 고치지 않는다 — `node android/scripts/messages-to-android-strings.mjs`).
- 접근성: 한 줄 = 한 객체(`mergedRow`·`BodyLine`·`HeadingLine`), 착지는 `mergedRow(focus)`(텍스트)·`landingTarget`(버튼, `clickable` 앞) 둘뿐, `.focusRequester(` 직접 부착 0, live region 0(시트), 48dp, 이모지 0, `disabled` 금지, androidTest에 Kotlin `assert(` 0.
- 판정 계층 미러 계약: `Location.hasSpeed()/hasSpeedAccuracy()` 거짓 → `null`, `hasBearing()/hasBearingAccuracy()/hasAccuracy()` 거짓 → `-1.0`. 시계는 `SystemClock.elapsedRealtime()/1000.0` 하나. 모델·`DeferredAnnouncer`·톤 재생기는 메인 스레드 전용, 스코프 `Dispatchers.Main`(immediate 아님).
- 오디오 usage: 톤·TTS 둘 다 `USAGE_MEDIA`(content type SONIFICATION/SPEECH). 포커스 못 잡으면 소리는 안 내고 진동은 낸다.
- `GuideDiag`·실기기 로그 파일은 커밋하지 않는다.

---

## 파일 구조

```
android/app/src/main/kotlin/space/dodoplanet/gildongmu/
  guide/
    GuideSession.kt            앱 수명 싱글턴(object): coordinator·walk·isMinimized·returnedFromBand·startWalk·억제 소유자·전경 입력
    WalkGuideModel.kt          iOS BeaconModel walk 절단면(배선). StateFlow<WalkGuideUiState>
    WalkGuideUiState.kt        화면이 읽는 상태 data class + GuideStatus·FailResolution·SessionEndKind
    WalkStartRequest.kt        시작 인자 한 벌(기본값 없음) + GuideWaypoint
    GuidePorts.kt              [3] 인터페이스 묶음: GuideForegroundController·GuidePermissions·GuideTones·GuideSpeaker·GuideHaptics·StepCounter·GuideEnvironment
    GuideFixPayload.kt         스트림 페이로드 + 순수 변환 guideFixPayload(...)
    GuideLocationStream.kt     LocationManager 리스너(FUSED→GPS), Location.toGuideFix()
    GuideForegroundService.kt  FGS(location) + wake lock + 스트림 소유 + 알림 + ACTION_STOP
    GuideNotification.kt       채널·빌더·bandSummaryText(순수)
    GuidePermissionsImpl.kt    손(rememberLauncherForActivityResult) attach/deliver + 위치는 AppConfig.permissionGate
    AndroidStepCounter.kt      TYPE_STEP_COUNTER 세션 누적
    GuideDiag.kt               Log + 파일 싱크(2MB 교체), 게이트 DEBUG||EXPERIMENTAL
    GuideText.kt               문장 조립(GuideText.swift 미러, Strings 주입)
    GuideStrings.kt            stringId 리터럴 표
    ui/GuideBottomBar.kt       AppRoot 삽입 한 자리: 게이트·attach·손·전경 관찰·KeepScreenOn·띠바·시트 호스트
    ui/GuideBand.kt            띠바
    ui/GuideSheet.kt           안내 시트(+조망 페이지·종료 화면)
    ui/GuideLanding.kt         착지 관용구(withFrameNanos+400ms+runCatching+1회 재시도)
    ui/WalkGuideStartButton.kt 시작 버튼 + 시작 실패 행(directions 슬롯이 부른다)
  audio/
    GuideAudioFocus.kt         AudioFocus 상태 머신(페이크 가능한 AudioFocusPort)
    ToneDurations.kt           상수 표(초)
    ToneResources.kt           toneResource(tone, scheme) → R.raw
    ToneHaptics.kt             톤별 waveform 표
    ResultHaptic.kt            3종 창구(Vibrator)
    GuideTonePlayer.kt         SoundPool + 포커스 + 진동 + isSilenced/focusDenied/미디어 볼륨 0
    GuideSpeaker.kt            TextToSpeech 창구(latest-wins, 배율, 포커스)
  res/raw/guide_*.mp3 (15)     res/drawable/ic_guide_notification.xml
android/app/src/test/kotlin/space/dodoplanet/gildongmu/guide/  WalkGuideModelTest·GuideTextTest·GuideNotificationTest·GuideFixPayloadTest·GuideSessionTest·GuideSourceGuardTest·GuideStringsTest
android/app/src/test/kotlin/space/dodoplanet/gildongmu/audio/  GuideAudioFocusTest·ToneDurationsTest·GuideTonePlayerTest·ToneHapticsTest
android/app/src/androidTest/kotlin/space/dodoplanet/gildongmu/guide/GuideSheetA11yTest.kt
android/i18n/android-extra/{ko,en,es,fr,it,ja}.json (신규 키 7)   android/app/src/main/AndroidManifest.xml (additive)
directions/RouteRows.kt (guideStart 슬롯 인자)  directions/DirectionsScreen.kt (슬롯 전달)  nav/AppRoot.kt (bottomBar 한 줄)
```

---

# 조각 ① — 세션·서비스·위치 스트림·알림

### Task 1: android-extra 신규 키 7개 + 카탈로그 재생성 + `GuideStrings`

**Files:**
- Modify: `android/i18n/android-extra/{ko,en,es,fr,it,ja}.json`
- Regenerate: `android/app/src/main/res/values*/strings.xml`
- Create: `android/app/src/main/kotlin/space/dodoplanet/gildongmu/guide/GuideStrings.kt`
- Test: `android/app/src/test/kotlin/space/dodoplanet/gildongmu/guide/GuideStringsTest.kt`

**Interfaces:**
- Produces: `guideStrings(res: Resources): Strings`(M3 `Strings` fun interface 재사용) · `internal fun guideStringId(key: String): Int?`

- [ ] **Step 1: 6로케일 android-extra에 키 추가** — 각 파일의 `android` 객체 안 `beacon`·`guide` 하위에(없으면 만든다). ko 문안(다른 로케일은 ios-extra의 `beacon.guideStartWalkShortest`·`guide.autoReroute` 값을 그대로, 신규 5개는 번역):

```json
"beacon": { "guideStartWalkShortest": "최단 경로 안내 시작" },
"guide": {
  "autoReroute": "새 경로로 다시 안내합니다. 안내 {count}개, 총 {distance}. {first}",
  "mediaVolumeZero": "미디어 볼륨이 꺼져 있어 안내 소리가 나지 않습니다",
  "focusDenied": "다른 앱이 소리를 쓰고 있어 안내 소리를 내지 못하고 있습니다",
  "ttsUnavailable": "이 언어의 음성 안내를 쓸 수 없습니다. 화면의 안내 문장을 확인하세요",
  "serviceStartFailed": "안내 서비스를 시작하지 못했습니다. 앱을 화면에 띄운 채 다시 시작하세요",
  "notificationChannel": "도보 안내"
}
```
`guide.autoReroute`의 en~ja 문안은 `ios/i18n/ios-extra/<lang>.json`의 최상위 `guide.autoReroute`를 복사한다(6로케일 전부 있다 — `python3 -c "import json;[print(l,json.load(open(f'ios/i18n/ios-extra/{l}.json'))['guide']['autoReroute']) for l in ['en','es','fr','it','ja']]"`).

- [ ] **Step 2: 재생성 + check**: `node android/scripts/messages-to-android-strings.mjs && node android/scripts/messages-to-android-strings.mjs --check` → `최신`. `grep -c "android_guide_autoReroute\|android_beacon_guideStartWalkShortest" android/app/src/main/res/values/strings.xml` → 2.

- [ ] **Step 3: 실패 테스트** `GuideStringsTest`:
```kotlin
class GuideStringsTest {
    @Test fun `M4가 쓰는 키 전부가 매핑돼 있다`() {
        val keys = listOf("beacon.walkHeading","beacon.stop","beacon.first","beacon.closer","beacon.farther","beacon.nearby","beacon.weak","beacon.denied","beacon.reduced","beacon.straightLineNote","beacon.guideStartWalk","android.beacon.guideStartWalkShortest",
            "guide.detailStart","guide.bundle","guide.handoff","guide.finalApproachRouteEnd","guide.finalApproachToDest","guide.finalApproachToDestNoDir","guide.finalApproachTick","guide.finalApproachTickNoDir","guide.finalApproachNear","guide.finalApproachNearDir","guide.arrived","guide.arrivedPresumed","guide.endedIdle",
            "guide.dirAhead","guide.dirLeft","guide.dirRight","guide.dirBehind","guide.dirAheadTo","guide.dirLeftTo","guide.dirRightTo","guide.dirBehindTo","guide.offRoute","guide.backOnRoute",
            "guide.imminent.left","guide.imminent.right","guide.imminent.back","guide.imminent.crosswalk","guide.imminent.underpass","guide.liveStraight","guide.liveStraightNoName","guide.liveTurnIn","guide.liveAction.left","guide.liveAction.right","guide.liveAction.back","guide.liveAction.crosswalk","guide.liveAction.underpass","guide.nextAction","guide.nextStraight","guide.nextStraightNoName",
            "guide.uncertain","guide.uncertainRecovered","guide.reacquiring","guide.detailUnavailable","guide.detailNoLocation","guide.progressButton","guide.progressOrdinal","guide.progressCurrent","guide.progressNext","guide.remainingDistance","guide.remainingTime","guide.rerouteButton","guide.rerouteBusy","guide.rerouteFailed","guide.rerouteDone","android.guide.autoReroute","guide.progressUncertain","guide.progressOffRoute","guide.progressFinalApproach","guide.approx","guide.rough","guide.noGuidanceYet","guide.alreadyActive","guide.minimize",
            "guide.band.return","guide.band.remaining","guide.band.starting","guide.band.arrived","guide.band.ended","guide.periodicStraight","guide.periodicStraightNoName","guide.nextDestination",
            "android.beacon.soundUnavailable","android.beacon.stopped","android.beacon.arrivedHeading","android.beacon.arrivedPresumedHeading","android.beacon.endedHeading","android.beacon.healthSummary","android.beacon.healthSummaryWithWeight",
            "android.beacon.food.cherryTomato","android.beacon.food.cucumberHalf","android.beacon.food.kimchi","android.beacon.food.tangerine","android.beacon.food.boiledEgg","android.beacon.food.apple","android.beacon.food.banana","android.beacon.food.riceHalfBowl","android.beacon.food.hotteok","android.beacon.food.riceBowl","android.beacon.food.ramyeon","android.beacon.food.ramyeonMany",
            "android.guide.routeListCurrent","android.guide.routeListRow","android.guide.mediaVolumeZero","android.guide.focusDenied","android.guide.ttsUnavailable","android.guide.serviceStartFailed","android.guide.notificationChannel",
            "android.common.allowPrecise","android.common.openSettings","android.common.geoReducedDesc","directions.viaArrived","actions.close","android.unit.spokenMeters")
        assertEquals(emptyList(), keys.filter { guideStringId(it) == null })
        // 카탈로그에도 실제로 있다(리소스 이름 = 키의 .→_)
        val xml = Fixtures.repoRoot.resolve("android/app/src/main/res/values/strings.xml").readText()
        assertEquals(emptyList(), keys.filter { !xml.contains("name=\"${it.replace('.', '_')}\"") })
    }
}
```
Run: `cd android && ./gradlew :app:testDebugUnitTest --tests '*GuideStringsTest*'` → FAIL(`guideStringId` 미정의).

- [ ] **Step 4: `GuideStrings.kt`** — M3 `DirectionsStrings.kt`의 `resourceStrings`와 같은 꼴(디버그면 미매핑 키 `check` 실패, 릴리스는 키 문자열, 조회는 전부 `appLocalized`):
```kotlin
fun guideStrings(res: Resources): Strings = Strings { key, args ->
    val id = guideStringId(key)
    if (id == null) { check(!BuildConfig.DEBUG) { "안내 문자열 미매핑 키: $key" }; key } else appLocalized(res, id, *args)
}
@StringRes internal fun guideStringId(key: String): Int? = when (key) {
    "beacon.walkHeading" -> R.string.beacon_walkHeading
    /* … Step 3 목록 전부, 한 줄에 하나 … */
    else -> null
}
```
- [ ] **Step 5: 테스트 초록** → 같은 명령 PASS.
- [ ] **Step 6: 커밋** `git commit -m "feat(android): M4 안내 문자열 — android-extra 신규 키 7개(6로케일)·카탈로그 재생성·GuideStrings 리터럴 표" -- android/i18n/android-extra android/app/src/main/res android/app/src/main/kotlin/space/dodoplanet/gildongmu/guide/GuideStrings.kt android/app/src/test/kotlin/space/dodoplanet/gildongmu/guide/GuideStringsTest.kt`

### Task 2: 매니페스트 additive(단독 커밋) + 알림 아이콘

**Files:**
- Modify: `android/app/src/main/AndroidManifest.xml`
- Create: `android/app/src/main/res/drawable/ic_guide_notification.xml`

- [ ] **Step 1: 매니페스트** — `<uses-permission>` 6줄(`FOREGROUND_SERVICE`·`FOREGROUND_SERVICE_LOCATION`·`POST_NOTIFICATIONS`·`VIBRATE`·`WAKE_LOCK`·`ACTIVITY_RECOGNITION`, 각 줄에 spec §3-4 근거 한 줄 주석) + `<application>` 안 `<service android:name=".guide.GuideForegroundService" android:exported="false" android:foregroundServiceType="location" />`. `MainActivity`는 건드리지 않는다.
- [ ] **Step 2: 아이콘** — 24dp 벡터, 단색 `#FFFFFFFF` 실루엣(걷는 사람 또는 화살표), `android:tint` 없음.
- [ ] **Step 3: 확인** `cd android && ./gradlew :app:assembleExperimental`(락 밖, 이 태스크만 — 매니페스트 병합 오류를 즉시 본다) → BUILD SUCCESSFUL. `aapt2 dump xmltree app/build/outputs/apk/experimental/app-experimental.apk --file AndroidManifest.xml | grep -c "foregroundServiceType"` → 1.
- [ ] **Step 4: 커밋(단독)** `git commit -m "feat(android): M4 매니페스트 additive — 전경 서비스(location) 선언·FOREGROUND_SERVICE(_LOCATION)·POST_NOTIFICATIONS·VIBRATE·WAKE_LOCK·ACTIVITY_RECOGNITION·알림 아이콘" -- android/app/src/main/AndroidManifest.xml android/app/src/main/res/drawable/ic_guide_notification.xml`. 보고 파일에 "매니페스트 커밋 SHA"를 적는다.

### Task 3: `GuideFixPayload` + `GuideLocationStream`

**Files:**
- Create: `guide/GuideFixPayload.kt`, `guide/GuideLocationStream.kt`
- Test: `test/.../guide/GuideFixPayloadTest.kt`
- (허가 뒤) Modify: `android/app/src/test/kotlin/space/dodoplanet/gildongmu/nav/AppSourceGuardTest.kt:15` — `assertEquals(listOf("AndroidLocationSource.kt", "GuideLocationStream.kt"), …)`

**Interfaces:**
- Produces: `data class GuideFixPayload(lat, lng, accuracy: Double, speed: Double?, speedAccuracy: Double?, course: Double, courseAccuracy: Double, elapsedRealtimeMs: Long)` · `fun guideFixPayload(lat, lng, hasAccuracy, accuracy, hasSpeed, speed, hasSpeedAccuracy, speedAccuracy, hasBearing, bearing, hasBearingAccuracy, bearingAccuracy, elapsedRealtimeNanos): GuideFixPayload` · `class GuideLocationStream(context) { fun open(onFix: (GuideFixPayload) -> Unit, onProviderDisabled: () -> Unit): Boolean; fun close() }`

- [ ] **Step 1: 실패 테스트**
```kotlin
class GuideFixPayloadTest {
    @Test fun `없는 축은 null 또는 -1로 넘긴다(0_0 금지)`() {
        val p = guideFixPayload(37.5, 127.1, hasAccuracy = false, accuracy = 0f, hasSpeed = false, speed = 0f, hasSpeedAccuracy = false, speedAccuracy = 0f, hasBearing = false, bearing = 0f, hasBearingAccuracy = false, bearingAccuracy = 0f, elapsedRealtimeNanos = 5_000_000_000L)
        assertEquals(-1.0, p.accuracy); assertNull(p.speed); assertNull(p.speedAccuracy); assertEquals(-1.0, p.course); assertEquals(-1.0, p.courseAccuracy); assertEquals(5_000L, p.elapsedRealtimeMs)
    }
    @Test fun `있는 축은 값 그대로`() {
        val p = guideFixPayload(37.5, 127.1, true, 12f, true, 1.3f, true, 0.4f, true, 90f, true, 20f, 1_500_000L)
        assertEquals(12.0, p.accuracy); assertEquals(1.3, p.speed!!, 1e-6); assertEquals(0.4, p.speedAccuracy!!, 1e-6); assertEquals(90.0, p.course); assertEquals(20.0, p.courseAccuracy); assertEquals(1L, p.elapsedRealtimeMs)
    }
}
```
- [ ] **Step 2: FAIL 확인** `./gradlew :app:testDebugUnitTest --tests '*GuideFixPayloadTest*'`.
- [ ] **Step 3: 구현** — `GuideFixPayload.kt`에 data class + 순수 함수(`if (hasX) x.toDouble() else -1.0` / `null`; `elapsedRealtimeNanos / 1_000_000`). `GuideLocationStream.kt`:
```kotlin
class GuideLocationStream(context: Context) {
    private val app = context.applicationContext
    private val manager = app.getSystemService(LocationManager::class.java)
    private var listener: LocationListener? = null
    @SuppressLint("MissingPermission") // 권한은 WalkGuideModel.start ②가 먼저 판정한다
    fun open(onFix: (GuideFixPayload) -> Unit, onProviderDisabled: () -> Unit): Boolean {
        val provider = when { manager.hasProvider(LocationManager.FUSED_PROVIDER) -> LocationManager.FUSED_PROVIDER; manager.hasProvider(LocationManager.GPS_PROVIDER) -> LocationManager.GPS_PROVIDER; else -> return false } // GPS 단독(spec §4-2)
        val l = object : LocationListener {
            override fun onLocationChanged(location: Location) = onFix(location.toGuideFix())
            override fun onProviderDisabled(p: String) = onProviderDisabled()
            override fun onProviderEnabled(p: String) {}
        }
        listener = l
        GuideDiag.log("stream provider=$provider")
        manager.requestLocationUpdates(provider, LocationRequest.Builder(1_000L).setQuality(LocationRequest.QUALITY_HIGH_ACCURACY).setMinUpdateDistanceMeters(0f).build(), app.mainExecutor, l)
        return true
    }
    fun close() { listener?.let(manager::removeUpdates); listener = null }
}
internal fun Location.toGuideFix() = guideFixPayload(latitude, longitude, hasAccuracy(), accuracy, hasSpeed(), speed, hasSpeedAccuracy(), speedAccuracyMetersPerSecond, hasBearing(), bearing, hasBearingAccuracy(), bearingAccuracyDegrees, elapsedRealtimeNanos)
```
(`GuideDiag`는 Task 4에서 만든다 — 이 태스크에서는 `android.util.Log` 직접 호출로 두고 Task 4에서 교체.)
- [ ] **Step 4: PASS** 같은 명령.
- [ ] **Step 5: 가드** — 코디네이터 허가가 왔으면 `AppSourceGuardTest` 15행 허용 목록에 `"GuideLocationStream.kt"` 추가(additive). 안 왔으면 `./gradlew :app:testDebugUnitTest --tests '*AppSourceGuardTest*'`가 빨갛다는 것을 보고 파일에 적고 진행(게이트는 조각 통합 전에 초록이어야 한다).
- [ ] **Step 6: 커밋** `-- guide/GuideFixPayload.kt guide/GuideLocationStream.kt test/.../GuideFixPayloadTest.kt [AppSourceGuardTest.kt]`.

### Task 4: `GuideSession` + `WalkGuideModel` 골격 + 포트 인터페이스 + `GuideDiag`

**Files:**
- Create: `guide/GuidePorts.kt`, `guide/WalkStartRequest.kt`, `guide/WalkGuideUiState.kt`, `guide/WalkGuideModel.kt`, `guide/GuideSession.kt`, `guide/GuideDiag.kt`, `guide/GuideText.kt`
- Test: `test/.../guide/WalkGuideModelTest.kt`, `GuideSessionTest.kt`, `GuideTextTest.kt`, `test/.../guide/Fakes.kt`

**Interfaces (Produces):**
```kotlin
// GuidePorts.kt
interface GuideForegroundController { fun start(); fun stop() }
interface GuidePermissions {
    fun isLocationEnabled(): Boolean
    fun currentLocation(): LocationPermission
    suspend fun requestLocation(): LocationPermission
    suspend fun requestNotifications()                // 33+ 아니면 no-op
    suspend fun requestActivityRecognition(): Boolean
}
interface GuideTones {
    fun preload(); fun beginSession(); fun endSession(); fun play(tone: BeaconTone)
    val toneEndsAt: Double?; val isSilenced: Boolean; val focusDenied: Boolean; val isMediaVolumeZero: Boolean
    var isSuppressed: Boolean
}
interface GuideSpeaker { fun prepare(); fun speak(text: String, highPriority: Boolean): Boolean; val isUnavailable: Boolean }
enum class ResultHapticKind { success, attention, failure }
interface GuideHaptics { fun result(kind: ResultHapticKind) }
data class StepSample(val steps: Int, val distanceMeters: Double?)
interface StepCounter { fun start(); fun stop(); val liveSample: StepSample? }
interface GuideEnvironment { fun isForeground(): Boolean; fun isInteractive(): Boolean }
// WalkStartRequest.kt
data class GuideWaypoint(val dest: BeaconDest, val label: String)
data class WalkStartRequest(val dest: BeaconDest, val label: String, val accessible: Boolean, val variant: WalkRouteVariant?, val shortestAvailable: Boolean, val waypoint: GuideWaypoint?)
// WalkGuideUiState.kt
enum class GuideStatus { idle, tracking, denied, unavailable; val isFailure get() = this == denied || this == unavailable }
enum class FailResolution { none, settings, precise }
enum class GuideMode { brief, detail }
enum class SessionEndKind { arrived, presumed, stopped }
data class WalkGuideUiState(
    val status: GuideStatus = GuideStatus.idle, val starting: Boolean = false, val destinationLabel: String = "",
    val statusText: String = "", val statusIsNextPreview: Boolean = false, val mode: GuideMode = GuideMode.brief,
    val offRoute: Boolean = false, val offRouteEndedByReroute: Boolean = false, val isRerouting: Boolean = false,
    val remainingText: String? = null, val liveTopText: String? = null, val liveNextText: String? = null,
    val soundDegraded: Boolean = false, val focusDenied: Boolean = false, val ttsUnavailable: Boolean = false, val isSilenced: Boolean = false,
    val bandDistanceMeters: Int? = null, val arrivalDest: BeaconDest? = null, val endKind: SessionEndKind = SessionEndKind.arrived, val endText: String = "",
    val arrivalHealth: WalkHealthSummary? = null, val routeStepDescriptions: List<String>? = null, val currentStepIndex: Int? = null,
    val routeWaypointRow: Pair<Int, String>? = null, val failResolution: FailResolution = FailResolution.none, val lastStartVariant: WalkRouteVariant? = null,
)
// GuideSession.kt (object) — 화면·서비스가 읽는 공개 멤버
//   val coordinator: GuideSessionCoordinator; lateinit var walk: WalkGuideModel; lateinit var permissions: GuidePermissionsImpl
//   var isMinimized / returnedFromBand: Boolean (mutableStateOf); var bandLandingSeq: Int (mutableStateOf — 전경 복귀 띠바 착지 트리거)
//   var experimentalEnabled: () -> Boolean; val isActive; val hasScreen
//   fun attach(app: Context); fun startWalk(r: WalkStartRequest); fun setOutputSuppressed(active: Boolean, owner: Any); fun setForeground(fg: Boolean)
// WalkGuideModel.kt (생성자)
class WalkGuideModel(
    private val routes: RouteService, private val strings: Strings, private val dataLocale: () -> DataLocale,
    private val controller: GuideForegroundController, private val permissions: GuidePermissions,
    private val tones: GuideTones, private val speaker: GuideSpeaker, private val haptics: GuideHaptics,
    private val steps: StepCounter, private val env: GuideEnvironment, private val coordinator: GuideSessionCoordinator,
    private val store: KeyValueStore, private val scope: CoroutineScope, private val clock: () -> Double,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) { val ui: StateFlow<WalkGuideUiState>; var outputSuppressed: Boolean; fun requestStart(r: WalkStartRequest); fun restart(); fun stopByUser(); fun clearArrival(); fun clearFailure(); fun handleFix(f: GuideFixPayload); fun handleProviderDisabled(); fun onServiceStartFailed(e: Throwable); fun setForeground(fg: Boolean); fun announceNow(text: String, highPriority: Boolean = false, bypassSuppression: Boolean = false); fun requestReroute(); fun progressText(): String; val isTracking: Boolean }
```
- [ ] **Step 1: Fakes** (`test/.../guide/Fakes.kt`): `FakeController(var failOnStart: Throwable? = null)`(start()가 `failOnStart`면 `model.onServiceStartFailed`를 부르는 콜백 보관), `FakePermissions(var location = Fine, var enabled = true, var activity = true)`, `FakeTones`(재생 목록 `played: MutableList<BeaconTone>`, `toneEndsAt` 설정 가능, `focusDeniedNext: Int`), `FakeSpeaker`(`spoken: MutableList<Pair<String,Boolean>>`, `allow = true`), `FakeHaptics`(`fired: MutableList<ResultHapticKind>`), `FakeSteps`(`liveSample` 설정), `FakeEnv(var foreground = true, var interactive = true)`, `FakeClock(var now = 0.0)`. `catalogStrings = CatalogStrings("ko")`(directions 테스트 픽스처 import). `newModel(...)` 헬퍼가 `stubbedClient { HttpResponse(200, Fixtures.kit("route-walk-geometry.json")) }`(없으면 `route-walk.json`이 `pathCoords`를 싣는지 `grep -c pathCoords`로 확인해 있는 파일을 쓴다)로 `RouteService`를 만든다.
- [ ] **Step 2: 실패 테스트(골격)** `WalkGuideModelTest`:
```kotlin
@ExtendWith(MainDispatcherExtension::class) class WalkGuideModelTest { ...
  @Test fun `권한 없음 → denied 실패 + 설정 해결 + 시작 안 됨`() = runTest { perms.location = None; perms.requestResult = None; m.requestStart(req); advanceUntilIdle()
      assertEquals(GuideStatus.denied, m.ui.value.status); assertEquals(FailResolution.settings, m.ui.value.failResolution); assertEquals(catalog.get("beacon.denied"), m.ui.value.statusText); assertEquals(0, controller.starts) }
  @Test fun `COARSE → unavailable + precise 해결`() ...
  @Test fun `정상 시작 → tracking·서비스 start·start 톤·claim`() = runTest { m.requestStart(req); advanceUntilIdle(); assertEquals(GuideStatus.tracking, m.ui.value.status); assertEquals(listOf(BeaconTone.start), tones.played); assertTrue(coordinator.isActive) }
  @Test fun `서비스 시작 실패 콜백 → serviceStartFailed 문장·idle·토큰 반납`() = runTest { controller.failOnStart = IllegalStateException("bg"); m.requestStart(req); advanceUntilIdle(); assertEquals(catalog.get("android.guide.serviceStartFailed"), m.ui.value.statusText); assertEquals(GuideStatus.unavailable, m.ui.value.status); assertFalse(coordinator.isActive) }
  @Test fun `종료 → 토큰 반납 → 재시작 성공`() = runTest { m.requestStart(req); advanceUntilIdle(); m.stopByUser(); assertFalse(coordinator.isActive); m.requestStart(req); advanceUntilIdle(); assertEquals(GuideStatus.tracking, m.ui.value.status) }
  @Test fun `안내 중 재시작 요청은 alreadyActive 통지`() ...  // GuideSessionTest에서 startWalk 게이트로
  @Test fun `조회 대기 15초 무수용 → detailNoLocation 간략 폴백`() = runTest { m.requestStart(req); advanceUntilIdle(); clock.now += 15.5; advanceTimeBy(16_000); assertEquals(catalog.get("guide.detailNoLocation"), m.ui.value.statusText); assertEquals(GuideMode.brief, m.ui.value.mode) }
}
```
`GuideSessionTest`: `attach` 2회 → 같은 인스턴스; `experimentalEnabled = { false }`면 `startWalk`가 `requestStart`를 부르지 않는다; `setOutputSuppressed` 소유자 둘(동등 data class 인스턴스 둘 — `data class Owner(val n: Int)`)이 따로 셈되고 `이전 ∧ 현재`.
`GuideTextTest`: `start`(`guide.detailStart` 실문장)·`periodicWalk`(횡단 스텝은 원문·target 있음/없음·마지막 스텝)·`imminentText`·`finalApproachEnter`·`finalApproachTick`(≤15m near·방향 유/무)·`progress`(following 서수·offRoute 직선·finalApproach)·`liveTop/liveNext`(`GuideLiveRowsTest` 렌더 규칙과 같은 문장).
- [ ] **Step 3: FAIL 확인** `./gradlew :app:testDebugUnitTest --tests '*guide*'`.
- [ ] **Step 4: 구현** — `GuideDiag`(Log + 파일 싱크는 Task 17, 지금은 `Log.i` + 인메모리 `lines`(테스트용)); `GuideText`(iOS `GuideText.swift`의 walk 함수를 `Strings`로 1:1 — `confidenceDistance`·`approachDistance`·`directionWord`·`directionTowardWord`·`approachDetail`·`finalApproachEnter`·`finalApproachTick`·`unit`·`start`·`reroute`·`autoReroute`·`periodicWalk`·`progressFrame`·`liveActionPhrase`·`liveTurnSoon`·`imminentText`·`liveTop`·`liveNext`·`progress`); `WalkGuideModel`의 골격: 생성자 + `ui` + `requestStart`(`starting` 가드 → `lastStartRequest`·`lastStartVariant` → `scope.launch { start(r) }`) + `start`(spec §3-2 ①~⑪: 권한 판정 4갈래 → `permissions.requestNotifications()`·`requestActivityRecognition()` → `coordinator.claim { stop() }` → 상태 초기화 → `steps.start()` → `GuideDiag.log("session kind=walk")` → `controller.start()` → `tones.beginSession(); playTone(start)` → `soundDegraded` 판정 → 워치독 `scope.launch { while (isActive) { delay(2000); tickWatchdog() } }` → `awaitingRoute = true; routeFetchToken++; startFixWaitWatch()` → `speaker.prepare()`) + `fail` + `stop`(§3-3 ①~⑫ 순서) + `stopByUser`·`stopLeavingSummary`(동기 판정 `WalkHealth.isMeaningfulWalk(sample.steps, sample.distanceMeters)`) + `onServiceStartFailed`(`coordinator.release`·`starting=false`·`fail(unavailable, "android.guide.serviceStartFailed")`) + `announce/announceNow/post`(§5-3: 억제 → `isSpeechAllowed` → `speaker.speak`; `DeferredAnnouncer(scope, clock, toneEndsAt = { tones.toneEndsAt }, post = ::post)`) + `playTone`(억제 가드·`tones.play`·`soundDegraded`·`isSilenced`/`focusDenied` 에지 래치) + `resultHaptic`. `handleFix`는 Task 6에서 채운다(지금은 `awaitingRoute` 분기까지만).
  `GuideSession`(object): `coordinator`·`lateinit var walk`·`isMinimized`·`returnedFromBand`·`var experimentalEnabled: () -> Boolean = { AppConfig.experimentalGuidanceEnabled }`·`attach(app)`(멱등: 실구현 포트 조립 — 포트 실구현은 Task 5·9~12에서 채우므로 지금은 `TODO` 대신 **임시 no-op 구현 클래스**를 `guide/AndroidPorts.kt`에 두고 각 태스크가 교체)·`startWalk`(게이트 → `isActive` 거부 `announceNow(alreadyActive, high, bypass)` → `tones.preload(); speaker.ensure()` → `walk.requestStart`)·`setOutputSuppressed`(§5-5, `Collections.newSetFromMap(IdentityHashMap())`)·`setForeground`.
- [ ] **Step 5: PASS** 같은 명령.
- [ ] **Step 6: 커밋** `-- guide/GuidePorts.kt guide/WalkStartRequest.kt guide/WalkGuideUiState.kt guide/WalkGuideModel.kt guide/GuideSession.kt guide/GuideDiag.kt guide/GuideText.kt guide/AndroidPorts.kt test/.../guide/*.kt`.

### Task 5: `GuideForegroundService` + `GuideNotification` + `GuidePermissionsImpl` + `AndroidStepCounter`

**Files:**
- Create: `guide/GuideForegroundService.kt`, `guide/GuideNotification.kt`, `guide/GuidePermissionsImpl.kt`, `guide/AndroidStepCounter.kt`
- Modify: `guide/AndroidPorts.kt`(컨트롤러·권한·걸음 실구현으로 교체)
- Test: `test/.../guide/GuideNotificationTest.kt`

**Interfaces:**
- Produces: `fun bandSummaryText(ui: WalkGuideUiState, strings: Strings): String`(순수 — 띠바·알림 본문 공용) · `object GuideNotification { const val ID = 4101; fun ensureChannel(ctx); fun build(ctx, title, text): Notification }` · `class GuideForegroundService : Service`(`ACTION_START`/`ACTION_STOP`) · `class AndroidGuideController(ctx): GuideForegroundController` · `class GuidePermissionsImpl(ctx): GuidePermissions`(`attach(launch: (Array<String>) -> Unit)`/`deliver()` — `GuideBottomBar`가 Task 14에서 붙인다) · `class AndroidStepCounter(ctx, main: Handler): StepCounter`

- [ ] **Step 1: 실패 테스트** `GuideNotificationTest`: `bandSummaryText` — 추적 중 `bandDistanceMeters=850` → `guide.band.remaining(dest, "850m")`; `null` → `band.starting`; `arrivalDest != null && endKind == stopped` → `band.ended`; `arrived` → `band.arrived`. `notificationBodyText(ui, strings)` = `statusText`가 비면 `bandSummaryText`.
- [ ] **Step 2: FAIL** → **Step 3: 구현**:
```kotlin
class GuideForegroundService : Service() {
    private var stream: GuideLocationStream? = null; private var wakeLock: PowerManager.WakeLock? = null; private var lastBody: String? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> { GuideSession.walk.stopByUser(); return START_NOT_STICKY }
            ACTION_START -> {
                val ui = GuideSession.walk.ui.value
                val n = GuideNotification.build(this, title(ui), notificationBodyText(ui, guideStrings(resources)))
                try { startForeground(GuideNotification.ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION) }
                catch (e: Exception) { GuideDiag.log("service start failed=${e::class.simpleName}"); stopSelf(); Handler(Looper.getMainLooper()).post { GuideSession.walk.onServiceStartFailed(e) }; return START_NOT_STICKY }
                wakeLock = (getSystemService(PowerManager::class.java)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "gildongmu:guide").apply { setReferenceCounted(false); acquire() }
                val s = GuideLocationStream(this); stream = s
                val opened = s.open(onFix = { GuideSession.walk.handleFix(it) }, onProviderDisabled = { GuideSession.walk.handleProviderDisabled() })
                if (!opened) Handler(Looper.getMainLooper()).post { GuideSession.walk.handleProviderDisabled() }
                observeUi()   // scope: 서비스 수명 Job — ui.collect { 본문이 바뀔 때만 notify }
                GuideDiag.log("service start ok")
            }
        }
        return START_NOT_STICKY
    }
    override fun onDestroy() { uiJob?.cancel(); stream?.close(); stream = null; wakeLock?.takeIf { it.isHeld }?.release(); wakeLock = null; super.onDestroy() }
    override fun onBind(i: Intent?) = null
    companion object { const val ACTION_START = "space.dodoplanet.gildongmu.guide.START"; const val ACTION_STOP = "…STOP" }
}
class AndroidGuideController(ctx: Context) : GuideForegroundController {
    private val app = ctx.applicationContext
    override fun start() { app.startForegroundService(Intent(app, GuideForegroundService::class.java).setAction(GuideForegroundService.ACTION_START)) }
    override fun stop() { app.stopService(Intent(app, GuideForegroundService::class.java)) }
}
```
`GuideNotification.build`: 플랫폼 `Notification.Builder(ctx, CHANNEL)`·`setOngoing(true)`·`setOnlyAlertOnce(true)`·`setCategory(Notification.CATEGORY_NAVIGATION)`·`setSmallIcon(R.drawable.ic_guide_notification)`·`setContentTitle/Text`·`setContentIntent(PendingIntent.getActivity(ctx, 0, Intent(ctx, MainActivity::class.java).addFlags(FLAG_ACTIVITY_NEW_TASK or FLAG_ACTIVITY_SINGLE_TOP), FLAG_IMMUTABLE or FLAG_UPDATE_CURRENT))`·`addAction(Notification.Action.Builder(null, ctx.getString(R.string.beacon_stop), PendingIntent.getService(ctx, 1, Intent(ctx, GuideForegroundService::class.java).setAction(ACTION_STOP), FLAG_IMMUTABLE or FLAG_UPDATE_CURRENT)).build())`. 채널 `IMPORTANCE_LOW`, 이름 `R.string.android_guide_notificationChannel`.
`GuidePermissionsImpl`: 위치는 `AppConfig.permissionGate`·`AppConfig.locationStore.isLocationEnabled()`, 알림·활동 인식은 자기 `CompletableDeferred` 대기 슬롯(`AndroidPermissionGate` 동형, `attach/detach/deliver`).
`AndroidStepCounter`: `SensorManager.registerListener(listener, TYPE_STEP_COUNTER, SENSOR_DELAY_NORMAL, main)`; 첫 이벤트 값 = 기준값; `liveSample = StepSample(current - base, null)`.
- [ ] **Step 4: PASS** · **Step 5: `assembleExperimental`**(락 밖 단발) BUILD SUCCESSFUL · **Step 6: 커밋**.

### Task 6: fix 파이프라인 — 간략·상세·최종 접근·도착·재조회·안전망·상환

**Files:**
- Modify: `guide/WalkGuideModel.kt`
- Test: `test/.../guide/WalkGuideModelTest.kt`(추가 시나리오)

**Interfaces:** 변경 없음(내부).

- [ ] **Step 1: 실패 테스트** — spec §10-1 ①~⑱ 중 이 태스크 몫:
  - ① 첫 수용 fix(acc 10, 나이 0) → `/api/route/walk` 호출 1회(`transport.seenUrls`에 `includeGeometry=1`) → 상세 커밋 → `spoken.last().first == GuideText.start(...)`·`highPriority == true`, `ui.mode == detail`.
  - ⑯ 조회 중 fix 5개 → 호출 1회.
  - ③ 상세 fix 열: `route-guide-scenarios.json` 첫 시나리오("긴 구간 선행 낭독과 전진 분리")의 스텝을 `pathCoords`로 만든 가짜 브리핑 JSON을 stub 응답으로 주고, fixture의 `fixes`를 `GuideFixPayload`로 변환해 흘린다 → `afterFix 10`에 `AnnounceSteps` 문장 발화; 임박 시나리오 하나("임박 삼중")로 `tones.played`에 행동 톤 3개·문장 1개.
  - ⑧ 간략 모드에서 fix 정상(2초 간격 8회) → `unreliable` 톤 0·`beacon.weak` 0; fix 두절 + `clock.now += 8`·`advanceTimeBy(8_000)` → `unreliable` 1; `+15초` → `beacon.weak` 문장; 600초 → `guide.endedIdle` + `stopped`.
  - ⑤ 최종 접근: 상세 세션에서 종점 도달 fix → `finalApproachEnter` → 서술 문장(`guide.finalApproachRouteEnd` 접두)·`ResultHaptic.attention`; 같은 fix가 도착 반경 안이어도 도착은 다음 fix(⑰); 다음 fix 거리 10m → `nearby` 톤·`arrivalDest`·`endKind == arrived`·문장 `guide.arrived`·`status == idle`.
  - ④ 이탈: fixture "수직거리 이탈 확정" 시나리오 fix 열 → `OffRoute` 문장 + `warning` 톤 + 자동 조회 1회(`seenUrls` 2번째) → 채택 문장 `android.guide.autoReroute` high + `ResultHaptic.success` + `ui.offRoute == false`·`offRouteEndedByReroute == true`.
  - ⑥ 사용자 종료: `steps.liveSample = StepSample(80, null)` → `stopByUser()` → `arrivalDest != null`·`endKind == stopped`·`arrivalHealth != null`(kcal 반올림 확인: 80걸음 × 0.7m = 56m → 65kg → `0.056 × 65 × 0.5 = 1.82 → 2`); `StepSample(40, null)` → `arrivalDest == null`.
  - ⑨ 전경 게이트: `env.foreground = false; env.interactive = true` → 주기 통지가 `spoken`에 안 오고 `setForeground(false)` 뒤 `setForeground(true)`에 현재 상태 1문장; `env.interactive = false` → 발화; 타 앱 전경 중 확정 도착 → 복귀 시 `guide.arrived` 상환(추적 가드 앞).
  - ⑦ 억제: `outputSuppressed = true` 중 `AnnounceSteps` → 발화 0·해제 시 최신 1개 복구.
  - ⑩ 종료 화면: `arrivalDest` 세운 뒤 `clock.now += 1801`·`setForeground(false)`·`setForeground(true)` → `arrivalDest == null`.
  - ⑫ `handleProviderDisabled` → `beacon.weak` + `status == unavailable`.
  - ⑮ `tones.focusDeniedNext = 3` → 톤 재생 0·`haptics.fired`에 `failure` 1 → 허가 뒤 `android.guide.focusDenied` 상환 1회.
- [ ] **Step 2: FAIL** → **Step 3: 구현** — spec §6-1·§6-2 순서 그대로(`handleFix`→`judgeMotion`→`awaitingRoute`(`routeFetchJob == null` 가드·`routeOriginStep`)→`inFinalApproach`→`handleDetail`→간략; `handleDetail`(`guideStep`·`refreshLiveRows`·`fix` 로그·`finalApproachEnter` 분기·`updateRemaining`·`routeTone`·`consume`); `handleFinalApproach`(서술 선행·도착·`maybePresumeArrival`·15초 틱); `consume(event)`; `fetchGuideRoute`·`commitReroutedRoute`·`requestReroute`·`maybeFetchProposal`·`fetchProposal`(origin = `lastFixCoord` 15초); `tickWatchdog`; `maybeEndIdleSession`; `noteSessionProgress`; `setForeground`(§5-3 상환 순서); `outputSuppressed` setter 복구; `liveDirection`; `progressText`). `GuideText`·`guideLiveRows`·`buildDisplayUnits`·`liveStepsFrom`은 `:kit` 그대로.
- [ ] **Step 4: PASS** `--tests '*WalkGuideModelTest*'` · **Step 5: 커밋**.

### Task 7: 조각 ① 소스 가드 + 게이트 + 리뷰 + 통합

**Files:**
- Create: `test/.../guide/GuideSourceGuardTest.kt`(spec §10-1 가드 ①②⑥⑦⑧⑩⑪⑫⑬ — ③④⑤⑨는 조각 ②·③에서 추가)

- [ ] **Step 1: 가드 작성** — `Fixtures.repoRoot.resolve("android/app/src/main/kotlin/space/dodoplanet/gildongmu")` 스캔: ① `GuideSession.startWalk(` 호출 파일 == `["WalkGuideStartButton.kt"]`(아직 없으면 빈 목록 허용 — 조각 ③에서 1로 고정) ② `GuideSession.kt`의 `fun startWalk` 본문·`GuideBottomBar.kt`(있으면) 첫 문장에 `experimentalGuidanceEnabled` ⑥ `guide/`에서 `import android.location`은 `GuideLocationStream.kt`만 ⑦ 매니페스트 `foregroundServiceType="location"` 서비스 1·`launchMode` 0 ⑧ `guide/`·`audio/` 소스의 키 모양 리터럴 전수가 `guideStringId`에 있다(`DirectionsSourceGuardTest` 정규식 재사용) ⑩ `androidx.core` import 0 ⑪ `.requestFocus()`는 `runCatching {` 안에서만(같은 줄 또는 직전 줄) ⑫ `guide/`에 `.focusRequester(` 0 ⑬ `PendingIntent.get`이 있는 줄에 `FLAG_IMMUTABLE`.
- [ ] **Step 2: 게이트(락)** — Global Constraints 명령. 전부 초록(vitest 1건 기대 실패). 실패 시 고치고 재실행.
- [ ] **Step 3: 커밋 정리 → 리뷰 디스패치** — `git status` 미커밋 0. 리뷰 2명(`model: opus`, 별도 컨텍스트): spec-compliance(요구: spec §2~§6·§10-1, 산출물 `git diff main...HEAD`)·code-quality. 결과는 `~/gildongmu-wt/android-m4-reports/review-p1-{spec,quality}.md`. 리뷰 중 커밋·rebase 금지. 반영 후 재게이트.
- [ ] **Step 4: rebase → 소실 대조 → ff** — `git rebase main`(충돌: `AppRoot.kt`·android-extra·매니페스트는 additive 양쪽 보존) → `base=$(git rev-parse main); comm -23 <(git show "${base}:CHANGELOG.md" | sort) <(sort CHANGELOG.md)` → 생성물 재생성 → 게이트 재실행 → `git -C ~/Mac-Projects/gildongmu merge --ff-only feat/android-m4`. 보고 ②(코디네이터 SendMessage + report.md: 통합 SHA·게이트 결과·매니페스트 커밋 SHA·가드 허용 목록 상태).

---

# 조각 ② — 오디오(D10)

### Task 8: `res/raw` 톤 15개 + `ToneDurations` + `ToneResources` + 프레임 계수 가드

**Files:**
- Create: `android/app/src/main/res/raw/guide_{closer,farther,nearby,tick,start,stop,ahead,crosswalk,left_pan,left_pitch,right_pan,right_pitch,back,warning,unreliable}.mp3`(`cp public/sounds/guide/<n>.mp3 …/guide_<n with - → _>.mp3`), `audio/ToneDurations.kt`, `audio/ToneResources.kt`
- Test: `test/.../audio/ToneDurationsTest.kt`, `GuideSourceGuardTest` ⑤ 추가

**Interfaces:**
- Produces: `object ToneDurations { fun seconds(tone: BeaconTone, scheme: LeftRightToneScheme): Double }` · `fun toneResource(tone: BeaconTone, scheme: LeftRightToneScheme): Int` · `internal fun mp3DurationSeconds(bytes: ByteArray): Double`(테스트 소스, `test/.../audio/Mp3Frames.kt`)

- [ ] **Step 1: 실패 테스트**
```kotlin
class ToneDurationsTest {
    @Test fun `파서 자가 시험 — 합성 바이트열`() {
        val id3 = byteArrayOf('I'.code.toByte(),'D'.code.toByte(),'3'.code.toByte(),4,0,0, 0,0,0,10) + ByteArray(10)
        val frame = ByteArray(417).also { it[0] = 0xFF.toByte(); it[1] = 0xFB.toByte(); it[2] = 0x90.toByte(); it[3] = 0xC0.toByte() } // MPEG1 L3 128kbps 44.1k 패딩 0
        val bytes = id3 + ByteArray(0).let { var b = it; repeat(84) { b += frame }; b } + ("TAG" + "x".repeat(125)).toByteArray()
        assertEquals(84 * 1152.0 / 44100, mp3DurationSeconds(bytes), 1e-9)
    }
    @Test fun `표가 파일과 맞는다`() {
        val raw = Fixtures.repoRoot.resolve("android/app/src/main/res/raw")
        for (tone in BeaconTone.entries) for (scheme in LeftRightToneScheme.entries) {
            val name = tone.resourceName(scheme).replace('-', '_')
            val actual = mp3DurationSeconds(raw.resolve("$name.mp3").readBytes())
            assertEquals(ToneDurations.seconds(tone, scheme), actual, 0.05, name)
        }
    }
    @Test fun `raw 이름 집합·바이트가 웹 파일과 같다`() { /* 소스 가드 ⑤: raw 파일 이름 == 15개 변환 집합, bytes == public/sounds/guide/<name without guide_, _→->.mp3 */ }
}
```
`mp3DurationSeconds`: ID3v2 헤더면 syncsafe 크기만큼 건너뛰기 → 첫 프레임 헤더에서 Xing/Info(`"Xing"`/`"Info"` 문자열이 헤더 뒤 36바이트 안)를 찾아 프레임 수 필드(플래그 bit0)가 있으면 그 값, 없으면 동기워드(`0xFFE`)를 따라 프레임 길이 `144 * bitrate / sampleRate + padding`으로 세기(후행 `TAG` 128바이트 제외) → `frames * 1152.0 / sampleRate`.
- [ ] **Step 2: FAIL** → **Step 3: 구현** — `ToneDurations`(spec §5-1 표 그대로: closer 0.20 farther 0.20 nearby 2.20 tick 0.48 start 1.30 stop 1.30 ahead 0.68 crosswalk 1.09 left/right 0.40 back 0.90 warning 0.80 unreliable 0.42), `toneResource` exhaustive `when`(`left`·`right`는 scheme으로 `R.raw.guide_left_pan`/`_pitch`).
- [ ] **Step 4: PASS** · **Step 5: 커밋**(`res/raw` 15파일 포함).

### Task 9: `GuideAudioFocus`

**Files:** Create `audio/GuideAudioFocus.kt`; Test `test/.../audio/GuideAudioFocusTest.kt`

**Interfaces:**
```kotlin
interface AudioFocusPort { fun request(listener: (Int) -> Unit): Int /* AUDIOFOCUS_REQUEST_GRANTED|FAILED|DELAYED */; fun abandon() }
class GuideAudioFocus(private val port: AudioFocusPort, private val postDelayed: (Long, () -> Unit) -> Cancellable) {
    val held: Boolean; fun acquire(): Boolean; fun releaseAfter(seconds: Double); fun endSession(remainingSeconds: Double); fun releaseNow()
}
class AndroidAudioFocusPort(audioManager: AudioManager, attributes: AudioAttributes) : AudioFocusPort   // AudioFocusRequest(GAIN_TRANSIENT_MAY_DUCK)
```
- [ ] **Step 1: 실패 테스트** — spec §5-2 표 19항을 테스트 이름으로 1:1(`#1 beginSession은 포커스를 잡지 않고 첫 play가 잡는다` … `#19 요청 거절`): 페이크 포트가 `requests: Int`·`abandons: Int`·`nextResult`·`listener`를 노출, 페이크 `postDelayed`가 예약 목록을 들고 `runDue(seconds)`로 실행.
- [ ] **Step 2: FAIL** → **Step 3: 구현**(`acquire`: `held`면 true; `port.request` GRANTED → `held = true`·예약 취소·true; 그 외 false. `releaseAfter`: 기존 예약 취소 후 예약 → 실행 시 `port.abandon(); held = false`. 리스너 LOSS* → `held = false`; GAIN 무시).
- [ ] **Step 4: PASS** · **Step 5: 커밋**.

### Task 10: `ToneHaptics` + `ResultHaptic`

**Files:** Create `audio/ToneHaptics.kt`, `audio/ResultHaptic.kt`; Test `test/.../audio/ToneHapticsTest.kt`; `GuideSourceGuardTest` ③ 추가(`Vibrator`·`VibrationEffect`·`SoundPool`·`TextToSpeech(`·`AudioFocusRequest` 참조는 `audio/{ToneHaptics,ResultHaptic,GuideTonePlayer,GuideSpeaker,GuideAudioFocus}.kt`만)

**Interfaces:**
- Produces: `data class Waveform(val timings: LongArray, val amplitudes: IntArray)` · `fun toneWaveform(tone: BeaconTone): Waveform` · `class AndroidVibrator(ctx): VibratorPort` · `interface VibratorPort { fun vibrate(w: Waveform); fun click(); }` · `class ResultHaptic(port: VibratorPort) : GuideHaptics`

- [ ] **Step 1: 실패 테스트** — 13톤 각각 `timings.sum() ≤ ToneDurations.seconds(tone, pitch) * 1000 + 50`, `timings.size == amplitudes.size`, `closer`는 탭 1(진동 구간 1개), `farther` 2, `nearby` 6, `crosswalk` 8, `ahead` 7. `ResultHaptic.result(success)` → `click` 1, `attention` → waveform `[0,40,60,40]`, `failure` → `[0,60,60,60,60,60]`.
- [ ] **Step 2: FAIL** → **Step 3: 구현**(spec §5-4 표를 `timings/amplitudes`로 — off 구간 amplitude 0) → **Step 4: PASS** → **Step 5: 커밋**.

### Task 11: `GuideTonePlayer`

**Files:** Create `audio/GuideTonePlayer.kt`; Test `test/.../audio/GuideTonePlayerTest.kt`; Modify `guide/AndroidPorts.kt`(`GuideTones` 실구현으로 교체)

**Interfaces:**
```kotlin
interface SoundPort { fun load(resId: Int, onLoaded: () -> Unit); fun play(resId: Int, gain: Float): Int /* streamId, 0=실패 */; fun stop(streamId: Int); fun isLoaded(resId: Int): Boolean }
interface VolumePort { fun isMediaVolumeZero(): Boolean }
class GuideTonePlayer(sound: SoundPort, focus: GuideAudioFocus, vibrator: VibratorPort, volume: VolumePort, store: KeyValueStore, clock: () -> Double, resource: (BeaconTone, LeftRightToneScheme) -> Int = ::toneResource) : GuideTones
```
- [ ] **Step 1: 실패 테스트** — `play(closer)`: 순서 `vibrate → focus.acquire → sound.play`(페이크가 호출 순서 기록), `toneEndsAt == now + 0.20`, `releaseAfter(0.35)` 예약; 포커스 거절 → `vibrate` 1·`sound.play` 0·`toneEndsAt == null`, 3회 → `focusDenied == true`, 허가 → `false`; 로드 전 `play(start)` → 보류 → `onLoaded` 콜백 뒤 `sound.play` 1(같은 경로: `toneEndsAt` 대입); 로드 전 `play(closer)` → 버림; `sound.play` 반환 0 → `isSilenced`; `isSuppressed` → 아무것도 안 함; `hapticIsOptIn`(closer) + 스위치 꺼짐 → `vibrate` 0, 켜짐(`store.putString(TrendHaptics.storageKey, "true")`) → 1; 선점: 두 번째 `play`가 첫 `streamId`에 `stop`; `endSession()` 잔여 + 0.15 예약; `isMediaVolumeZero` 위임.
- [ ] **Step 2: FAIL** → **Step 3: 구현**(spec §5-1 `play` ①~⑤, 게인 표, `preload`(15개 `load`), `beginSession`(예약 취소), `endSession`(`focus.endSession(remaining)`), `AndroidSoundPort`(`SoundPool.Builder().setMaxStreams(2).setAudioAttributes(USAGE_MEDIA + CONTENT_TYPE_SONIFICATION)`), `AndroidVolumePort`(`getStreamVolume(STREAM_MUSIC) == 0`)) → **Step 4: PASS** → **Step 5: 커밋**.

### Task 12: `GuideSpeaker` + 발화 창구 배선

**Files:** Create `audio/GuideSpeaker.kt`; Modify `guide/AndroidPorts.kt`; Test `test/.../audio/GuideSpeakerTest.kt`; `GuideSourceGuardTest` ④·⑨ 추가(`speaker.speak(` 호출부 == `WalkGuideModel.kt`의 `post` 한 곳; `guide/ui/`에 `liveRegion` 0)

**Interfaces:**
```kotlin
interface TtsPort { fun init(onReady: (Boolean) -> Unit); fun setLanguage(tag: String): Boolean; fun setRate(rate: Float); fun speakFlush(text: String, utteranceId: String): Boolean; fun setProgressListener(onDone: (String) -> Unit) }
class GuideSpeaker(tts: TtsPort, focus: GuideAudioFocus, store: KeyValueStore, language: () -> String, meters: () -> String) : GuideSpeaker
```
- [ ] **Step 1: 실패 테스트** — 초기화 전 `speak(a)`·`speak(b)` → 준비 뒤 `b`만 1회; 언어 미지원 → `isUnavailable`·`speak` false; 포커스 거절 → `speakFlush` 0·false; `onDone(옛 id)`는 반납 없음, 최신 id만 `releaseAfter(0.15)`; `listenSpeed` 저장값 없음 → `setRate` 호출 0, `1.5` → `setRate(1.5f)`; 문장은 `spokenDistanceUnits(text, "미터")`로 넘어간다.
- [ ] **Step 2: FAIL** → **Step 3: 구현**(`AndroidTtsPort`: `TextToSpeech(ctx, listener)`·`onInit(SUCCESS)` 뒤 `setAudioAttributes(USAGE_MEDIA + CONTENT_TYPE_SPEECH)`·`speak(text, QUEUE_FLUSH, null, id)`·`setOnUtteranceProgressListener`(메인 반입)) → **Step 4: PASS** → **Step 5: 커밋**.

### Task 13: 조각 ② 게이트·리뷰·통합 (Task 7 절차 동일, 보고 ③)

- [ ] 게이트(락) → 리뷰 2명(`review-p2-*.md`) → 반영 → rebase → `comm` 대조 → 게이트 → ff → 보고 ③(오디오 판정 목록: usage MEDIA·포커스 거절 진동 우선·TTS 배율 초기 표).

---

# 조각 ③ — 화면

### Task 14: `WalkGuideStartButton` + 시작 실패 행 + directions 슬롯

**Files:** Create `guide/ui/WalkGuideStartButton.kt`, `guide/ui/GuideLanding.kt`; Modify `directions/RouteRows.kt`(`WalkOutcomeRows`에 `guideStart: (@Composable (WalkRouteVariant?) -> Unit)? = null` 인자, `DisclosureRow` 본문 첫 줄에 `guideStart?.invoke(null)` / 최단 행 `invoke(WalkRouteVariant.shortest)`), `directions/DirectionsScreen.kt`(`WalkOutcomeRows(..., guideStart = walkGuideStartSlot(s, lang))`)

**Interfaces:**
- Produces: `@Composable fun WalkGuideStartButton(dest: BeaconDest, label: String, accessible: Boolean, variant: WalkRouteVariant?, shortestAvailable: Boolean, waypoint: GuideWaypoint?)` · `suspend fun land(requester: FocusRequester, what: String)`(`GuideLanding.kt`: `withFrameNanos{}; delay(400); runCatching { requester.requestFocus() }.onFailure { delay(600); runCatching { requester.requestFocus() }.onFailure { Log.w("Guide", "$what 착지 실패", it) } }`)
- Consumes: `GuideSession.startWalk`, `GuideSession.walk.ui`, `clearFailure()`, `restart()`, `AppConfig.permissionGate`, `appDetailsSettingsIntent`·`tryStartActivity`

- [ ] **Step 1: 구현**(시작 버튼 `Button(Modifier.tapTarget().testTag(...))` + 실패 행: `ui.status.isFailure && ui.statusText.isNotEmpty() && ui.lastStartVariant == variant` → `Text(ui.statusText, Modifier.fillMaxWidth().mergedRow("guide-fail", focus = failFocus).padding(vertical = 8.dp))` + `LaunchedEffect(ui.status) { if (ui.status.isFailure) land(failFocus, "실패 문장") }` + 해결 버튼(`precise`: `scope.launch { if (AppConfig.permissionGate.request() == Fine) GuideSession.walk.restart() else GuideSession.walk.announceNow(strings.get("android.common.geoReducedDesc")) }` / `settings`: 인텐트). `DirectionsForm`의 슬롯 조립: `if (AppConfig.experimentalGuidanceEnabled) { val target = s.promotedDestination?.let { it.label to BeaconDest(it.lat, it.lng) } ?: (s.to as? DirectionsEndpoint.Place)?.let { it.label to BeaconDest(it.lat, it.lng) }; target?.let { (label, dest) -> { variant -> WalkGuideStartButton(dest, label, accessible = s.stepFreeEnabled && lang == "ko", variant, s.walkShortest != null, s.via?.let { GuideWaypoint(BeaconDest(it.lat, it.lng), it.label) }) } } } else null`.
- [ ] **Step 2: 테스트** — `DirectionsSourceGuardTest`가 `directions/`에서 `guide` import를 막는지 확인(막지 않는다 — 위치 API·Lazy만). `GuideSourceGuardTest` ①을 "정확히 1곳"으로 고정. 기존 `DirectionsViewModelTest`·androidTest `DirectionsScreenA11yTest`는 슬롯 기본값 null로 무변경 통과.
- [ ] **Step 3: `assembleExperimental`** → **Step 4: 커밋**.

### Task 15: `GuideBottomBar` + `GuideBand` + `AppRoot` 한 줄

**Files:** Create `guide/ui/GuideBottomBar.kt`, `guide/ui/GuideBand.kt`; Modify `nav/AppRoot.kt:55-56`(`bottomBar = { GuideBottomBar { NavigationBar(...) { … } } }` — 한 줄 래핑 + import 1줄); Modify `guide/GuidePermissionsImpl.kt`(손 attach)

- [ ] **Step 1: 구현** — spec §7-2 코드: 첫 문장 게이트, `remember { GuideSession.attach(app) }`, `GuidePermissionsLauncher()`(`rememberLauncherForActivityResult(RequestMultiplePermissions()) { GuideSession.permissions.deliver() }` + `DisposableEffect`로 attach/detach), `ForegroundObserver()`(`LocalLifecycleOwner` `LifecycleEventObserver` ON_START/ON_STOP → `GuideSession.setForeground`), `KeepScreenOn(showsSheet)`(`LocalView.current.context as? Activity`의 `window.addFlags/clearFlags(FLAG_KEEP_SCREEN_ON)` in `DisposableEffect`), `Column { if (hasScreen && isMinimized) GuideBand(ui, bandFocus); tabs() }`, `if (showsSheet) GuideSheet(ui)`. 띠바 착지: `LaunchedEffect(GuideSession.isMinimized, GuideSession.bandLandingSeq) { if (isMinimized) land(bandFocus, "띠바") }`; 전경 복귀 착지는 `GuideSession.setForeground(true)`가 `hasScreen && isMinimized`면 `bandLandingSeq++`.
  `GuideBand`: `Row(Modifier.fillMaxWidth().landingTarget(bandFocus).clickable(role = Role.Button) { GuideSession.returnedFromBand = true; GuideSession.isMinimized = false }.testTag("guide-band").defaultMinSize(minHeight = 48.dp).padding(12.dp).clearAndSetSemantics { contentDescription = joinText(spokenDistanceUnits(summary, meters), returnLabel) }) { Column { Text(summary); Text(returnLabel, style = bodySmall) } }`.
- [ ] **Step 2: 확인** `assembleExperimental` + `AppSourceGuardTest`(`Scaffold(` 직접 호출 0 — `GuideBottomBar`는 Scaffold를 열지 않는다) → **Step 3: 커밋**(`AppRoot.kt` 변경은 2줄만인지 `git diff --stat` 확인).

### Task 16: `GuideSheet` + 조망 페이지 + 종료 화면

**Files:** Create `guide/ui/GuideSheet.kt`

- [ ] **Step 1: 구현** — spec §7-3~§7-5 순서 그대로. `ModalBottomSheet(onDismissRequest = { GuideSession.isMinimized = true }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), dragHandle = null)`; 내부 `var overviewOpen by remember { mutableStateOf(false) }`·`BackHandler(enabled = overviewOpen) { overviewOpen = false }`; `Column(Modifier.fillMaxSize()) { Column(Modifier.weight(1f).verticalScroll(...)) { … 행 … }; if (ui.arrivalDest == null) Button(onClick = { GuideSession.walk.stopByUser() }, Modifier.fillMaxWidth().tapTarget().testTag("guide-stop")) { Text(strings.get("beacon.stop")) } }`. 제목 `Row { HeadingLine(joinText(walkHeading, label), "guide-title", focus = titleFocus); IconButton(Modifier.landingTarget(minimizeFocus).testTag("guide-minimize"), onClick = { isMinimized = true }) { Icon(…, contentDescription = strings.get("guide.minimize")) } }`. 행은 `BodyLine`(`spoken = spokenDistanceUnits`). 착지: `LaunchedEffect(Unit) { if (returnedFromBand) { returnedFromBand = false; land(minimizeFocus) } else land(titleFocus) }`; `LaunchedEffect(ui.offRoute) { if (!ui.offRoute && (reroutePressed || ui.offRouteEndedByReroute)) { reroutePressed = false; land(titleFocus) } }`; `LaunchedEffect(ui.arrivalDest != null) { if (ui.arrivalDest != null) land(arrivedFocus) }`; 조망 닫힘 → `land(progressFocus)`. 조망: 상단 닫기 → `ui.routeStepDescriptions` 행(`android.guide.routeListCurrent`/`routeListRow`, 경유지 구획) → 말미 닫기, 헤더 `HeadingLine(GuideSession.walk.progressText(), focus = overviewFocus)`. 종료 화면: 헤딩·종료 문장(`Text(..., Modifier.mergedRow("guide-end", spoken, focus = arrivedFocus))`)·걸음 문장(`GuideText.healthLine` — `usedDefaultWeight ? healthSummaryWithWeight : healthSummary` + `foodLine`)·닫기(`clearArrival()`).
- [ ] **Step 2: `assembleExperimental`** → **Step 3: 커밋**.

### Task 17: androidTest `GuideSheetA11yTest` + 조각 ③ 통합 + 실보행 대본

**Files:** Create `androidTest/.../guide/GuideSheetA11yTest.kt`; Modify `~/gildongmu-wt/android-m4-reports/report.md`(대본)

- [ ] **Step 1: androidTest**(spec §10-2 ①~⑥; `createAndroidComposeRule<ComponentActivity>()`, `rule.setContent { MaterialTheme { AppRoot(testFactories) } }`, 페이크 포트로 `GuideSession.attach` 뒤 `walk.ui` 상태를 직접 세우는 테스트 훅 `GuideSession.walk.debugSetUi(...)`(`@VisibleForTesting`), `enableAccessibilityChecks()`·`onRoot().tryPerformAccessibilityChecks()`, JUnit 단언만). adb 없으면 컴파일만(`./gradlew :app:compileDebugAndroidTestKotlin`).
- [ ] **Step 2: 게이트·리뷰·rebase·ff**(Task 7 절차, `review-p3-*.md`) → 보고 ④(spec §11 20항을 FIELD-TEST 형식으로 report.md에 전문 이관 + 실험판 APK 경로 `android/app/build/outputs/apk/experimental/app-experimental.apk`). 실기기 설치는 보고 ⑤ 허가 뒤.

---

# 조각 ④ — 계측·마감

### Task 18: `GuideDiag` 파일 싱크 + 회수 문서 + 변이 주입 + CHANGELOG

**Files:** Modify `guide/GuideDiag.kt`; Modify `CHANGELOG.md`(자기 항목만, 맨 위 날짜 절); Modify `.gitignore`(코디네이터 허가 시 `guide-diag*.log*` 1줄)

- [ ] **Step 1: 파일 싱크** — `context.getExternalFilesDir(null)/guide-diag.log`, 2MB 초과 시 `.old.log` 교체, `BuildConfig.DEBUG || BuildConfig.EXPERIMENTAL` 게이트(릴리스 no-op, 인라인 람다). 회수 명령을 `GuideDiag.kt` 머리 주석과 report.md에: `adb pull /sdcard/Android/data/space.dodoplanet.gildongmu.dev/files/guide-diag.log ~/gildongmu-private/field-logs/android-<날짜>.log`.
- [ ] **Step 2: 변이 주입(커밋 뒤, 파일 복사 복원)** — ① `WalkGuideModel`의 `DeferredAnnouncer(toneEndsAt = { null })` ② `isSpeechAllowed`에서 `|| !env.isInteractive()` 제거 ③ `setOutputSuppressed` 해제를 `walk.outputSuppressed = false` 고정 ④ 워치독 루프를 `handleFix` 안으로 → 각각 `:app:testDebugUnitTest --tests '*WalkGuideModelTest*|*GuideSessionTest*'`가 빨강임을 확인, 결과를 report.md에 4줄.
- [ ] **Step 3: CHANGELOG** 항목(2~4줄 + spec 링크) → **Step 4: 게이트·리뷰(cross-cutting 1명)·rebase·ff** → 보고(⑥ 상당: 최종 통합 SHA·남은 판정·실기기 대기 항목).
