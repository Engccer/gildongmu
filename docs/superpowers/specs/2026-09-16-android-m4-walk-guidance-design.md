# 안드로이드 M4: 도보 실시간 안내 설계 (2026-09-16)

> **위치**: 판정 문서 `2026-09-15-android-app-decisions.md`(D1~D13, 재논의 금지)와 병렬 계획 `2026-09-16-android-app-parallel-plan.md` §1·§3·§5-4·§5-5 위에 선 M4 spec. 입력은 `~/gildongmu-wt/android-kit-guide-reports/report.md`의 "D10 경계로 [3]에 남긴 것"(TTS 배율·`resourceName` 변환·`Location.hasX()` → null/-1·`GuideSessionCoordinator` 메인 스레드·단조 시계·GuideAudioSession 목표 계약 5항·시나리오 18개), `docs/INTEGRATIONS.md` §실시간 길 안내, `CLAUDE.md`의 실시간 안내 항목 전부, M1·M2·M3 spec의 접근성·위치·길찾기 계약이다.
>
> **범위 한 줄**: iOS 정식판 **도보** 실시간 안내(`BeaconModel` walk 절단면 + `BeaconTrackingSheet` + 띠바 + 종료 화면)와 기능 등가를 안드로이드 [3]·[4]로 새로 쓴다. 판정 계층([2])은 `:kit`에 이미 있고(웹·iOS·Kotlin 공유 fixture 동조), 이 spec은 **그것을 소비하는 실행 계층과 화면**만 정한다. `:kit` 무수정, 서버 계약 변경 0.
>
> **안전·정확성 크리티컬**: 판정 계층이 iOS 실보행으로 확정한 규칙(톤 계층·도플러 정지·워치독·이탈 두 축·도착 창·결정 지점 두 층·임박 삼중 큐·잊힌 세션 안전망·톤 뒤 발화·잘림 방지·억제 소유자 집합·종료 화면 동기 판정·세션 앱 수명·시트 최소화·통지 우선순위·결과 진동 3종)은 **안드로이드도 같은 행동**을 해야 하고 수단만 다르다. §6이 규칙 하나하나를 수단에 대응시킨다.

---

## 1. 목표와 범위

### 1-1. 포함 (M4)

| 축 | 내용 | iOS 대응 |
|---|---|---|
| 진입 | 길찾기 브리핑 도보 추천·최단 행 펼침 본문 **첫 항목**의 "도보 안내 시작"·"최단 경로 안내 시작" 버튼(실험판 전용). 도착지가 현재 위치면 버튼 없음 | `DirectionsTabView` 도보 DisclosureGroup 첫 항목 |
| 세션 | 앱 수명 싱글턴 `GuideSession`(코디네이터 + 도보 모델 + 최소화 상태). 시작은 **`startWalk` 한 함수**. 안내 중 새 시작 거부. 시트를 내리면 최소화, 종료는 버튼(안내 종료·닫기·알림 액션)뿐 | `GuideSession.shared`·`startBeacon` |
| [3] 위치 | 안내 전용 연속 스트림(FUSED 1초, GMS 무의존) — **전경 서비스(`location` 타입)** 안에서 돈다. `ACCESS_BACKGROUND_LOCATION` 선언·요청 0 | `LocationService.startBeaconUpdates` |
| 지속 알림 | 상태 한 줄 + "안내 종료" 액션. `POST_NOTIFICATIONS` 처리 | (iOS에 없음, D11 자산) |
| [3] 오디오 | `SoundPool` 톤 15파일 + `AudioFocus`(재생 단위 획득·지연 반납) + `TextToSpeech` 발화(톤 뒤 발화 `speechDeferStep`, 단일 슬롯 latest-wins `DeferredAnnouncer`) + 억제 소유자 집합 | `BeaconTonePlayer`·`DeferredAnnouncer`·VoiceOver 통지 |
| 진동 | 톤 동기 waveform 13종 + `ResultHaptic` 3종 한 창구 | `BeaconTonePlayer.haptic`·`ResultHaptic` |
| 화면 | 안내 시트(제목 헤딩·접기·진행 상황·재조회·남은 거리·하단 2행·상태 문장·소리 상태·안내 종료 최하단 고정), 띠바, 조망 목록, 종료 화면(도착·추정·중지 + 걸음·칼로리 요약 + 닫기, 30분 만료), 자동 재조회 채택 + 수동 재조회 | `BeaconTrackingSheet`·`GuideBandView`·`GuideOverviewSheet` 도보부·`arrivalSection` |
| 안전망·수명 | 워치독(2초 주기, 8초 톤, 15초 음성), 잊힌 세션(`sessionIdleStep`), 도착 추정(`presumedArrivalStep`), 화면 유지(`FLAG_KEEP_SCREEN_ON`), 프로세스 재시작 시 알림 정리 | `BeaconModel` 동형 |
| 계측 | iOS `guide-diag.log` 동형 파일 로그(앱 전용 외부 저장소, `adb pull`) | `GuideDiag`·`DiagFileLog` |
| 게이트 | 실험판 전용(`AppConfig.experimentalGuidanceEnabled`) — 정식 빌드 진입점 0(구조 + 소스 가드) | `#if EXPERIMENTAL` |

### 1-2. 제외 (후속 마일스톤 — 자리만 남기거나 아예 두지 않는다)

| 항목 | 갈 곳 | 근거 |
|---|---|---|
| 자동차·대중교통 안내, 승차 전 도보(prewalk), 운전자 모드 | M5 | 착수 프롬프트. `GuideTuning.walk`만 쓴다 — `sessionKind` 축을 두지 않는다 |
| 세션 중 목적지 변경·경유지 추가/변경/삭제, 장소 상세 중첩 시트, 주변 확인(`SurroundingsScene`) | M4b(주변 확인은 M2b 산출물 의존) | 시트 컨트롤 집합의 절반이고 각각 끝점 검색·M2b 컴포넌트에 결박된다. **시작 시 경유지 전달**은 포함(A13 동형 — 경유지 있는 조회의 시작 버튼이 경유지 없는 안내를 조용히 시작하지 않게) |
| 대안 경로 프리뷰·수동 variant 전환 | M4b | 조망 시트의 행동 슬롯. 시작 시 variant 선택(추천/최단)은 포함 |
| 체중 입력 권유 두 줄, 좌우 톤 방식 피커, 진동 스위치 UI, 듣기 속도 설정 | 설정 화면 마일스톤 | 저장 키는 `:kit`(`WalkHealth`·`LeftRightToneScheme`·`TrendHaptics`·`ListenSpeed`)이고 이 마일스톤은 **읽기만**(기본값: 기준 체중 65kg·pitch·진동 확장 켬·1배속) |
| 1회 공지 시트(`WalkGuideNotice`) | 정식 졸업 때 | 실험판엔 공지 대상이 없다 |
| 수동 위치 시작 고지(`manualLocation.guideStartsFromCurrent`) | M2c 뒤 | 수동 위치 자체가 없다 |

---

## 2. 아키텍처 (D5 네 계층의 M4 절단면)

```
[1] 서버        /api/route/walk?includeGeometry=1[&accessible][&variant][&via][&lang]   (기존 라우트, 변경 0)
[2] :kit        Beacon·BeaconGate·BeaconTones·RouteGuide·GuideToneLayer·GuideMotion·GuideCourse(+Axis)
                GuideSpeechGate·DeferredAnnouncer·GuideLiveRows·GuideSessionCoordinator·SessionIdle·EndScreen
                WalkHealth·FinalApproach·RouteOrigin·RerouteProposalGate·LocationFix·CourseDerivation·ListenSpeed
                RouteService·RouteGeometry·Format·Localization                                   (소비만, 무수정)
[3] :app guide/ GuideSession(싱글턴)·WalkGuideModel(배선)·GuideForegroundService·GuideLocationStream·
                GuideNotification·GuidePermissions·StepCounter·GuideDiag·GuideText·GuideStrings
    :app audio/ GuideTonePlayer(SoundPool+AudioFocus+진동)·GuideSpeaker(TextToSpeech)·GuideAudioFocus·
                ToneHaptics·ResultHaptic
[4] :app guide/ui/ GuideBottomBar(띠바+시트 호스트, AppRoot 삽입 한 자리)·GuideSheet·GuideOverviewPage·
                GuideEndScreen·GuideBand·WalkGuideStartButton(directions가 부른다)
    res/raw/    guide_*.mp3 15개 (public/sounds/guide/*.mp3 바이트 동일)
```

- **판정은 전부 `:kit`, 여기는 배선이다**(iOS `BeaconModel` 머리 주석 그대로). `WalkGuideModel`은 `BeaconModel`의 walk 절단면이고 상태 필드·처리 순서를 그대로 옮기되 자동차·prewalk·목적지 변경·경유지 변경·프리뷰 갈래는 **두지 않는다**(항상 참인 분기를 남기지 않는다 — 플래그 졸업 방식).
- **소유권**(계획 §2 웨이브 3): `guide/`·`audio/`·`res/raw/` 신규 소유. `directions/`는 도보 본문 첫 항목 슬롯 추가만(§7-1). `nav/AppRoot.kt`는 `bottomBar` 한 자리 교체만(§7-2). 매니페스트 additive(서비스 선언·`FOREGROUND_SERVICE`·`FOREGROUND_SERVICE_LOCATION`·`POST_NOTIFICATIONS`·`VIBRATE`·`ACTIVITY_RECOGNITION` — §3-4 판정)는 **한 커밋으로 분리**. `android/i18n/android-extra/` 키 additive. `app/build.gradle.kts` 의존성 추가 **0**(플랫폼 API만: `LocationManager`·`SoundPool`·`AudioManager`·`TextToSpeech`·`Vibrator`·`SensorManager`·`NotificationManager`·`ForegroundService`).
- **위치 계층 예외(코디네이터 판정 필요, §12-1)**: `AppSourceGuardTest`는 `LocationManager` 생성을 `AndroidLocationSource.kt` 한 곳으로 잠근다. 안내 스트림은 속도·방위·`elapsedRealtimeNanos`를 실은 별도 페이로드가 필요하고 서비스 수명에 결박되므로 `guide/GuideLocationStream.kt`가 자기 리스너를 등록한다 — `LocationManager`는 리스너마다 독립 요청을 받으므로(iOS `CLLocationManager`의 단일 프로파일 경합이 **없다**) `LocationStore`의 단발 취득과 공존한다. 가드 허용 목록에 이 파일 한 줄을 더하는 것이 필요하다(android-m1 소유 테스트 — 코디네이터에 허가 요청, 대안은 §12-1).
- **스레드**: 모델·코디네이터·`DeferredAnnouncer`·톤 재생기는 **메인 스레드 전용**(Swift `@MainActor` 계약). 위치 콜백은 `mainExecutor`, 서비스 → 모델 호출도 메인, TTS 리스너 콜백은 `Handler(Looper.getMainLooper())`로 반입, 센서 콜백도 메인 Handler. `GuideSession`의 `CoroutineScope`는 `Dispatchers.Main`(`immediate` 아님 — `DeferredAnnouncer` KDoc의 LAZY 계약).
- **시계**: `SystemClock.elapsedRealtime() / 1000.0` **하나**(`uptimeNow`). 잠자기 중에도 흐르므로 `RerouteProposal.acquiredAt`·`nowUptime`·`isEndScreenStale`·`DeferredAnnouncer.clock`·fix 나이(`location.elapsedRealtimeNanos`)·워치독이 전부 같은 축이다. iOS `systemUptime`(잠자기 정지)과의 차이는 §6-3.

---

## 3. 세션·시작·종료 ([3] 오케스트레이션)

### 3-1. `GuideSession` (앱 수명 싱글턴, `object`)

```kotlin
object GuideSession {
    val coordinator = GuideSessionCoordinator()            // :kit, 메인 전용
    lateinit var walk: WalkGuideModel                       // attach(context)에서 1회 생성
    var isMinimized by mutableStateOf(false)                // 시트가 내려가 띠바가 세션을 대표
    var returnedFromBand by mutableStateOf(false)           // 띠바 복귀 시트의 첫 착지 = 접기 버튼(1회 소비)
    val isActive: Boolean get() = coordinator.isActive || walk.starting
    val hasScreen: Boolean get() = walk.isTracking || walk.arrivalDest != null
    fun startWalk(request: WalkStartRequest)                // 유일한 시작 진입점
    fun setOutputSuppressed(active: Boolean, owner: Any)    // 억제 소유자 집합(§5-5)
    fun setForeground(foreground: Boolean)                  // 전경 판정 입력(§5-3)
}
```

- `startWalk`: ① `AppConfig.experimentalGuidanceEnabled`가 거짓이면 **아무것도 하지 않는다**(정식 빌드 진입점 0의 구조 층 — 버튼 미노출이 1선, 이것이 2선) ② `isActive`면 거부 통지 `guide.alreadyActive`(`announceNow`, 억제 우회) ③ `walk.requestStart(request)`. 소스 가드가 `startWalk(` 호출부를 **`WalkGuideStartButton.kt` 한 곳**으로 잠근다(iOS `guidance-gate-drift` 정신, §10-3).
- `WalkStartRequest(dest: BeaconDest, label: String, accessible: Boolean, variant: WalkRouteVariant?, shortestAvailable: Boolean, waypoint: GuideWaypoint?)` — **기본값 없음**(A4·A13). `GuideWaypoint(dest: BeaconDest, label: String)`.
- `GuideSession.attach(context)`는 `GildongmuApplication`이 아니라 **`GuideBottomBar`의 첫 컴포지션**(`remember`)에서 앱 컨텍스트로 1회 부른다 — `GildongmuApplication`·`AppConfig`는 android-m1 소유. 서비스가 먼저 살아나는 경로(프로세스 재생성 뒤 시스템 재시작)는 `START_NOT_STICKY`라 없다(§4-3).

### 3-2. `WalkGuideModel.requestStart → start` (iOS `begin`/`start` 순서 그대로)

1. `starting` 재진입 가드, `lastStartRequest` 저장(시작 실패 뒤 복구 재시작용 — 정밀 위치 허용 후 `restart()`).
2. **권한 게이트**(`GuidePermissions`, §3-4): 기기 위치 서비스 꺼짐 → `fail(unavailable, "beacon.weak")`. 위치 권한 `None` → `AppConfig.permissionGate.request()`(M2 손) → 재판정. `None` → `fail(denied, "beacon.denied", resolution = settings)`. `Coarse` → `fail(unavailable, "beacon.reduced", resolution = precise)`(iOS reducedAccuracy 대응 — 해결 버튼은 M3 `allowPrecise`와 같은 재요청). `Fine` → 진행.
3. `POST_NOTIFICATIONS`(API 33+) 미허가면 요청 1회. 거부는 **차단이 아니다** — 서비스는 알림 없이도 돈다(시스템이 "앱이 백그라운드에서 실행 중" 표식으로 대신한다). 거부 사실은 세션 시작 문장 뒤에 1회 병기하지 않는다(행동을 바꾸지 않는 정보). `ACTIVITY_RECOGNITION` 미허가면 요청 1회. 거부 → 걸음 요약 없음(3-state 부재).
4. `coordinator.claim { stop() }` — null이면 거부 통지(권한 대기 중 뒤집힌 경합의 최종 게이트).
5. 상태 초기화(iOS `start` 대입 목록 그대로: `deferredAnnouncer.advanceGeneration()`, `dest`·`arrivalDest = null`·`endKind`·`resetArrivalHealth`·`arrivalSessionToken`·`liveHealthSample = null`·`sessionStartedAt`·`outputSuppressed = false`·`destinationLabel`·`beaconState/gateState/toneState/motionState = initial`·`lastFixAt`·`startedAt = uptimeNow`·세션 진행 앵커·`status = tracking`·`statusText = ""`·`failResolution = none`).
6. `StepCounter.start(token)` (허가 시), `GuideDiag.log("session kind=walk")`.
7. **전경 서비스 시작**(§4): `GuideForegroundService.start(context)` → 서비스가 `startForeground(type LOCATION)` + 스트림 열기 + `walk.onFix`로 전달. 실패(`ForegroundServiceStartNotAllowedException` — 앱이 백그라운드에서 시작 요청)는 `fail(unavailable, "beacon.weak")`로 접지 않고 **전용 문장 `android.guide.serviceStartFailed`**(3-state — 위치 문제가 아니다).
8. `tones.beginSession()` → `playTone(start)` → `soundDegraded`(미디어 볼륨 0) 판정 1회 통지.
9. `watchdog.start()`(2초), `awaitingRoute = true`, `routeFetchToken += 1`, `startFixWaitWatch(15초)`.
10. `speaker.prepare()`(TTS 초기화 — 세션 시작 문장이 초기화보다 먼저 오면 **보류 1문장**으로 들고 있다가 초기화 완료 시 발화; 초기화 실패는 `ttsUnavailable` 행 + `ResultHaptic.failure` 1회).

### 3-3. 종료 경로 (전부 `stop()` 경유, iOS 목록 동형)

| 경로 | 톤 | 종료 화면 | 사유 |
|---|---|---|---|
| 시트 "안내 종료"·알림 "안내 종료" 액션 | `stop` 톤 | 도보 세션 ∧ `WalkHealth.isMeaningfulWalk(라이브 누적)` **동기 판정** → `.stopped` 화면(`beacon.stopped` 문장) | `stopByUser` |
| 확정 도착(최종 접근 `distance ≤ 15m`) | `nearby` | `.arrived` | `handleFinalApproach` |
| 추정 도착(`presumedArrivalStep`) | `nearby` **전경에서만** | `.presumed` | `maybePresumeArrival` |
| 잊힌 세션(`sessionIdleStep`) | `stop` 전경에서만 | `.stopped`(`guide.endedIdle`) | 워치독 |
| 위치 제공자 꺼짐(`onProviderDisabled`) | 없음 | `.stopped`(`beacon.weak`) + 실패 상태 잔존 | `stopAndFail` |
| 앱 프로세스 종료 | — | — | 서비스도 함께 죽고 알림은 시스템이 지운다 |

- `stop()`은 iOS 정리 목록 그대로 + **서비스 정지(`stopForeground(REMOVE)` → `stopSelf`)**·`StepCounter.stop()`(값은 남긴다 — 종료 처리가 뒤에 읽는다)·`FLAG_KEEP_SCREEN_ON` 해제(호스트 effect가 `isTracking`을 본다)·`tones.endSession()`(잔여 재생만큼 포커스 반납을 미룬다, §5-2).
- 권한 회수는 안드로이드에서 **프로세스 재시작**이다(M2 판정) — iOS `handle(authorization:)` 경로는 없다. 재시작 뒤 `GuideSession`은 빈 상태이고 서비스는 `START_NOT_STICKY`라 되살아나지 않는다.
- 종료 화면 30분 만료: `endedAt = uptimeNow`(elapsedRealtime — 잠자기 중에도 흐른다, `EndScreen.kt` KDoc 요구 충족). 백그라운드를 거쳐 전경으로 돌아올 때(`setForeground(true)`, 직전에 `wasBackgrounded`) `isEndScreenStale`이면 `clearArrival()`.

### 3-4. 권한·매니페스트 (D11)

| 권한 | 선언 | 요청 시점 | 거부 시 |
|---|---|---|---|
| `ACCESS_FINE_LOCATION`·`COARSE` | 기존 | 시작 버튼(M2 손 재사용) | 시작 실패 문장 + 해결 버튼(설정 열기 / 정확한 위치 허용) |
| `FOREGROUND_SERVICE`·`FOREGROUND_SERVICE_LOCATION` | **추가**(설치 시 자동) | — | — |
| `POST_NOTIFICATIONS` | **추가** | 시작 버튼(33+) | 알림 없이 진행 |
| `VIBRATE` | **추가**(자동) | — | — |
| `ACTIVITY_RECOGNITION` | **추가** | 시작 버튼 | 걸음 요약 없음 |
| `ACCESS_BACKGROUND_LOCATION` | **0**(소스 가드 기존 `AppSourceGuardTest`) | — | — |

- 서비스 선언: `<service android:name=".guide.GuideForegroundService" android:foregroundServiceType="location" android:exported="false" />`.
- 런타임 권한 요청 손: `GuidePermissions`(guide/)가 `AndroidPermissionGate`와 같은 attach/deliver 모양으로 **자기 `rememberLauncherForActivityResult`를 `GuideBottomBar` 컴포지션에 둔다**(`MainActivity`는 android-m1 소유라 건드리지 않는다). 위치 권한만 M2 손(`AppConfig.permissionGate`)을 그대로 쓴다.
- ⚠ **`ACTIVITY_RECOGNITION` 추가는 착수 프롬프트의 additive 목록에 없던 항목**이다(§12-2에서 판정·보고). 근거: iOS 정식판 종료 화면의 걸음·칼로리 요약(위원장 요청 2026-08-18 음식 비유 포함)이 D3 기능 등가에 들고, 안드로이드 걸음 수는 `TYPE_STEP_COUNTER` + 이 권한(API 29+)이 유일한 경로다. 프롬프트가 `WalkHealth.isMeaningfulWalk` 동기 판정을 명시했으므로 걸음 입력이 전제다.

---

## 4. 전경 서비스·위치 스트림·알림 (D11)

### 4-1. `GuideForegroundService`

- `Service`(플랫폼, 라이브러리 0). `onStartCommand`: `ACTION_START` → `startForeground(NOTIFICATION_ID, notification, FOREGROUND_SERVICE_TYPE_LOCATION)` → `stream.open(onFix = walk::handleFix, onProviderDisabled = walk::handleProviderDisabled)`. `ACTION_STOP`(알림 액션) → `walk.stopByUser()`(메인). 반환 `START_NOT_STICKY`. `onDestroy` → 스트림 닫기. `onTaskRemoved`(최근 앱에서 스와이프) → **세션 유지**(iOS 백그라운드 계약과 같다 — 사용자가 명시로 끄기 전엔 산다) — 단 `Activity`가 죽어도 프로세스와 서비스는 산다는 뜻이고, 이후 알림 탭이 `MainActivity`를 새로 띄우면 `GuideSession`(프로세스 싱글턴)이 그대로라 시트가 복원된다.
- 시작은 **전경에서만**(`ContextCompat.startForegroundService`) — 버튼 활성화가 곧 전경이다. Android 14+에서 위치 타입 FGS는 `ACCESS_FINE_LOCATION` **런타임 허가가 선행**되어야 `startForeground`가 `SecurityException`을 내지 않는다 — §3-2 ②가 앞선다.
- ⚠ **D11 실측 항목(§11-1)**: 전경에서 시작한 `location` 타입 FGS가 화면 꺼짐·다른 앱 전경에서 fix를 계속 받는가(Android 12+ while-in-use 규칙: FGS가 전경에서 시작됐으면 백그라운드 위치 권한 없이 계속 접근 가능 — 문서 근거는 있으나 한소네 7(Android 15)에서 실측으로 닫는다). 실패하면 세션은 워치독의 `unreliable` 톤 + 15초 "신호 약함"으로 **정직하게** 드러난다(침묵 실패 없음).

### 4-2. `GuideLocationStream`

```kotlin
data class GuideFixPayload(
    val lat: Double, val lng: Double,
    val accuracy: Double,          // hasAccuracy() 거짓 → -1.0 (:kit `> 0` 가드)
    val speed: Double?,            // hasSpeed() 거짓 → null  (motionStep 계약, 0.0 금지)
    val speedAccuracy: Double?,    // hasSpeedAccuracy() 거짓 → null
    val course: Double,            // hasBearing() 거짓 → -1.0 (courseStep 계약, 0.0 금지)
    val courseAccuracy: Double,    // hasBearingAccuracy() 거짓 → -1.0
    val elapsedRealtimeMs: Long,   // location.elapsedRealtimeNanos / 1e6 — 나이의 기준
)
```

- 요청: `LocationRequest.Builder(1_000L).setQuality(QUALITY_HIGH_ACCURACY).setMinUpdateDistanceMeters(0f)`(거리 필터 끔 — 데드밴드가 이미 필터, iOS `distanceFilter = none` 동형). provider는 M2 판정 그대로 `FUSED` → 없으면 `GPS`(+`NETWORK`). `mainExecutor`.
- 나이 `age = (elapsedRealtime() - fix.elapsedRealtimeMs) / 1000.0`. 캐시 fix(`startUpdatingLocation` 첫 콜백)는 iOS와 같이 나이로 걸러진다(`isUsableFix` 5초·상세 10초).
- `onProviderDisabled(FUSED|GPS)` → `walk.handleProviderDisabled()` → `stopAndFail(unavailable, "beacon.weak")`. `onProviderEnabled`는 무시(세션은 이미 끝났다).
- 두 스트림(안내·`LocationStore` 단발)이 같은 `LocationManager`에 독립 리스너로 공존한다 — 끄는 쪽이 서로를 죽이지 않는다(iOS `isOneShotActive` 소유권 판별이 **불필요**). 단 `LocationStore.currentCoordinate`는 안내 중에도 자기 게이트로 답한다 — iOS의 "추적 중엔 스트림 최신 fix로 답한다" 특례는 두지 않는다(수동 재조회의 origin은 §6-2가 세션 최신 fix를 직접 쓴다).

### 4-3. 알림 (`GuideNotification`)

- 채널 `guide`(`IMPORTANCE_LOW`, 이름 `android.guide.notificationChannel`), 알림 `setOngoing(true)`·`setSilent(true)`·`setOnlyAlertOnce(true)`·`CATEGORY_NAVIGATION`·작은 아이콘(기존 런처 전경 벡터).
- 제목 = `joinText(beacon.walkHeading, destinationLabel)`(시트 제목과 같은 문장). 본문 = **상태 한 줄** = `statusText`가 비어 있지 않으면 그것, 비면 띠바 요약(`guide.band.remaining`/`starting`) — 시트 상태 행·띠바와 같은 조립기(`bandSummaryText`)를 지난다. 본문이 바뀔 때만 `notify`(매 fix 갱신 금지 — 띠바 거리 10m 양자화가 그 빈도를 정한다).
- 액션 "안내 종료"(`beacon.stop`) → `PendingIntent.getService(ACTION_STOP)`. 본문 탭 → `PendingIntent.getActivity(MainActivity, FLAG_UPDATE_CURRENT)` + `isMinimized = false`(액티비티가 이미 떠 있으면 `singleTop`으로 그대로).
- 종료 화면 상태(추적 끝, `arrivalDest != null`)에는 알림이 **없다** — 서비스가 `stop()`에서 내려갔다. 종료 사실은 띠바(`guide.band.arrived`/`ended`)가 든다.
- 프로세스가 시스템에 의해 죽으면 FGS 알림은 시스템이 지운다. 앱 재시작 시 `GuideSession`은 빈 상태라 유령 시트도 없다.

---

## 5. 오디오 (D10 재설계)

### 5-1. 톤 재생기 `GuideTonePlayer` (`SoundPool`)

- `SoundPool.Builder().setMaxStreams(2).setAudioAttributes(USAGE_ASSISTANCE_NAVIGATION_GUIDANCE + CONTENT_TYPE_SONIFICATION)`. 15개 `res/raw`를 앱 최초 세션 시작 때 로드(`load` 비동기, `setOnLoadCompleteListener` 완료 전 재생 요청은 **버린다**(무음 — `isSilenced` 아님, 1초 미만 창)).
- **리소스 이름 규칙**: `BeaconTone.resourceName(scheme)`(`guide-left-pitch`)의 `-` → `_`(`guide_left_pitch`). 표는 `toneResource(tone, scheme): Int`(exhaustive `when` → `R.raw.guide_*`). 소스 가드가 `res/raw` 파일 이름 집합 == `{ 톤 13 × scheme 조합의 resourceName 변환 }`(15개)을 대조하고, mp3 **바이트가 `public/sounds/guide/<이름>.mp3`와 동일**함을 단언한다(웹 `sounds-drift.test.ts`의 Kotlin 판 — `src/**`는 금지라 `:app` 테스트가 `Fixtures.repoRoot`로 읽는다).
- **길이**: `MediaMetadataRetriever`로 로드 시 1회 측정(`METADATA_KEY_DURATION`), `toneEndsAt = uptimeNow + duration`. 측정 실패 → 그 톤은 `toneEndsAt = null`(발화를 미루지 않는다 — 정직한 폴백). ffprobe 실측(초): closer 0.20 · farther 0.20 · nearby 2.20 · tick 0.48 · start/stop 1.30 · ahead 0.68 · crosswalk 1.09 · left/right 0.40 · back 0.90 · warning 0.80 · unreliable 0.42(`speechDeferThresholdSeconds` 0.6 선이 정확히 갈리는 표 — `speechDeferMaxSeconds` 3.0 ≥ 2.2 + 0.15).
- **게인**(iOS `gains` 미러): closer/farther 0.35 · nearby 1 · tick 0.3 · start/stop/ahead/crosswalk/left/right/back 0.8 · warning 1 · unreliable 0.45.
- **선점**: 새 재생은 진행 중 스트림을 `stop`하고 교체(iOS `playing.stop()`).
- `play(tone)`: ① `toneEndsAt = null`(진입 즉시 — 조기 반환 경로 공통) ② 진동(§5-4) ③ `focus.acquire()`(§5-2) ④ `soundPool.play(...)` 반환 0이면 `isSilenced = true`, 아니면 `isSilenced = false`·`toneEndsAt` 대입·`focus.releaseAfter(duration + 0.15)`.
- `isSuppressed`(모델 `outputSuppressed` 전파): 참이면 `play`는 no-op(iOS `playTone` 가드 동형 — 모델 창구에서 이미 막지만 재생기도 방어).
- **`soundDegraded` 판정 축**: iOS "잠금·백그라운드에서 소리가 나는가"는 안드로이드에서 성립하지 않는다(FGS가 살아 있는 한 `SoundPool`은 화면 상태와 무관하게 난다). 남는 무음 원인은 **미디어 볼륨 0**이라 `audioManager.getStreamVolume(STREAM_MUSIC) == 0`을 세션 시작과 매 재생에 판정, 참이면 `soundDegraded = true` + 문장 `android.guide.mediaVolumeZero` 1회(`ResultHaptic.attention`) + 시트 행 상시. DND는 미디어 스트림을 막지 않는다(수용). `isBackgroundAudible` 개념은 두지 않는다.

### 5-2. `GuideAudioFocus` — 목표 계약 5항의 AudioFocus 판

iOS 오디오 세션 모델(카테고리 승격·원복·`didPromote`·소유권 이전·route 변경)은 안드로이드에 **해당 문제가 없다**. 안드로이드는 "소리를 내는 동안만 포커스를 쥔다"는 단순 모델로 같은 목표를 달성한다.

```kotlin
class GuideAudioFocus(audioManager) {
    fun acquire(): Boolean         // 이미 쥐고 있으면 true, 아니면 requestAudioFocus(GAIN_TRANSIENT_MAY_DUCK)
    fun releaseAfter(seconds)      // 예약 반납(메인 Handler). 새 acquire가 예약을 취소한다
    fun releaseNow()               // shutdown
    val onFocusChange: LOSS·LOSS_TRANSIENT·LOSS_TRANSIENT_CAN_DUCK → held = false (다음 acquire가 재요청)
}
```

| 목표 계약(kit-guide 보고) | AudioFocus 판 | 달성 |
|---|---|---|
| 1. 받아쓰기·TTS 점유 중 억제 | 억제는 오디오 층이 아니라 **모델 창구**(`outputSuppressed`, §5-5)가 막는다. 포커스는 무관 | ✔ |
| 2. 인터럽션 시작/종료 재조정("`.ended` 유실 대비") | `onAudioFocusChange(LOSS*)` → `held = false`. **다음 `play`가 `acquire`로 되살린다**(GAIN 콜백에 의존하지 않는다 — 유실돼도 무관) | ✔ |
| 3. route 변경: 메아리만 거르고 남의 탈취는 회복 | 안드로이드 `SoundPool`은 플레이어가 route에 결박되지 않아 재생성이 없다. `ACTION_AUDIO_BECOMING_NOISY`는 2.2초 이하 큐라 **무시**(문서화). 채팅 TTS(M6)의 포커스 요청은 우리 LOSS_TRANSIENT로 와 계약 2와 같은 경로 | ✔(해당 없음 + 2로 흡수) |
| 4. 원복은 우리가 승격했을 때만(`didPromote`) | `abandonAudioFocusRequest`는 **자기 `AudioFocusRequest` 핸들**에만 작용한다 — 구조적으로 남을 건드릴 수 없다 | ✔(구조) |
| 5. 소리 직후 종료가 소리를 자른다 → 잔여만큼 대기, 새 세션 시작은 미뤄진 원복 취소 | `releaseAfter(duration + 0.15)` 예약, `acquire`가 예약 취소, `endSession()`은 재생 잔여만큼 미룬 `releaseAfter`, `shutdown()`은 즉시 `releaseNow` | ✔ |

`GuideAudioSessionTests` 시나리오 18개의 AudioFocus 판(리듀서 대신 `GuideAudioFocus` 단위 테스트 — 페이크 `AudioManager` 인터페이스로 JVM):

| # | iOS 시나리오 | 안드로이드 판 |
|---|---|---|
| 1 | 세션 시작은 .playback으로 승격 | `beginSession()`은 포커스를 잡지 않는다 — 첫 `play`의 `acquire`가 잡는다(승격 개념 없음). 단언: `beginSession` 뒤 `held == false`, 첫 `play` 뒤 `held == true` |
| 2 | suppression 중 시작은 의도만 저장 | 억제 중 `play`는 no-op이라 `acquire`도 없다. 단언: 억제 중 `play` → 요청 0회 |
| 3 | suppression 해제 시 저장 의도 재적용 | 해제 뒤 첫 `play`가 `acquire`. 단언: 해제 후 `play` → 요청 1회 |
| 4 | 승격하지 않았으면 종료 시 원복 없음 | `endSession()`은 `held == false`면 `abandon` 0회 |
| 5 | 시작한 적 없는 종료는 세션 불변 | 동일(요청 0·반납 0) |
| 6 | 승격했으면 종료 시 .ambient 원복 | `held`면 `endSession()` → 잔여 뒤 `abandon` 1회 |
| 7 | 인터럽션 종료가 suppression 중 도착해도 해제 시 복구 | LOSS 뒤 억제 해제 뒤 `play` → `acquire` 재요청 1회 |
| 8 | route 변경은 플레이어 재생성 | 해당 없음(계약 3) — 테스트 없음, 문서만 |
| 9 | 세션 밖 인터럽션·route·탈취는 공유 세션 불변 | `held == false`에서 LOSS 콜백 → 상태 변화 0·반납 0 |
| 10 | 세션 밖 단발 재생은 .ambient 확보 | 세션 밖 `play`도 `acquire` → `releaseAfter`(같은 경로, 승격 구분 없음) |
| 11 | 억제 중 route 변경은 점유자 세션 불변 | 해당 없음 |
| 12 | 종료가 억제 중 도착하면 원복 자격 유지 | 억제 중 `endSession()`: `held`면 예약 반납은 그대로 진행(소리를 내지 않는 중이라 잘림 없음) — 단언: 반납 1회 |
| 13 | 이미 .playback인 세션의 인터럽션 종료도 재적용 | GAIN 콜백은 무시, 다음 `play`가 재요청 — 단언: LOSS 뒤 GAIN 뒤 `play` → 요청 1회 |
| 14 | 인터럽션 시작은 활성만 내리고 다음 확보가 재적용 | 계약 2 그대로 |
| 15 | 원복 자격은 마지막 적용 카테고리에서 유도(전수 열) | `held`는 `acquire` 성공/`abandon`/LOSS 세 전이만 — 전수 열 대신 상태 머신 3전이 단언 |
| 16 | 소유권 이전은 자격만 반납 | 재생기 인스턴스가 하나(M5도 같은 `GuideAudioFocus`를 공유) — 이전 개념 없음. 단언: 예약 반납 중 새 `acquire`가 예약을 취소하고 `held` 유지 |
| 17 | route 변경 사유 매핑 | 해당 없음 |
| 18 | 카테고리 탈취는 소유 중에만 재적용, 재생성 없음 | 계약 2·3으로 흡수 |

### 5-3. 발화 `GuideSpeaker` (`TextToSpeech`)

- **채널 판정**: 안내 문장은 앱 자체 TTS **한 채널**로 발화한다(착수 프롬프트 지정). 근거: 안드로이드 접근성 통지(`announceForAccessibility`, API 34 deprecated / Compose live region)는 화면이 살아 있는 동안만 동작하고 한소네 자체 리더가 TalkBack이 아닐 수 있다 — 스크린 리더 유무·전경 여부와 무관한 채널이 필요하다. 대가: TalkBack 낭독과 겹칠 수 있다(§11-4 실측), 점자 디스플레이엔 문장이 오지 않는다(시트 상태 행이 같은 문장을 시각·점자로 든다).
- 따라서 **안내 시트에는 live region이 없다**(M1 `StatusLine` 관용구의 예외 — 같은 문장을 TTS와 TalkBack이 둘 다 읽는 이중 낭독 차단). 사용자 활성화의 직접 응답도 같은 채널(`announceNow`).
- `TextToSpeech(context, initListener)` — 앱 수명 싱글턴(재생성 비용·초기화 지연), 세션 시작에 `prepare()`. 초기화 완료 전 문장은 **최신 1개 보류**(latest-wins). `setLanguage(Locale.forLanguageTag(AppLocale.current))` — `LANG_MISSING_DATA`·`LANG_NOT_SUPPORTED`면 `ttsUnavailable = true`(시트 행 `android.guide.ttsUnavailable` 상시 + `ResultHaptic.failure` 1회 + 상태 행은 계속 갱신).
- `speak(text, QUEUE_FLUSH, params(AudioAttributes 항법 안내 + `KEY_PARAM_UTTERANCE_ID`))` — **latest-wins**(임박 명령이 전문 뒤에 줄 서지 않는다). 발화 전 `focus.acquire()`, `onDone/onError/onStop`(메인 반입)에서 `focus.releaseAfter(0.15)`. 문장은 `spokenDistanceUnits(text, android.unit.spokenMeters)`를 지난다(iOS `spokenUnits` 동형 — TTS가 `m`을 어떻게 읽는지 §11-5 실측 뒤 정정 유지/제거).
- **배율**: `ListenSpeed.normalizeSpeed(저장값)`이 1.0이면 `setSpeechRate`를 **부르지 않는다** — 그러면 엔진이 시스템 TTS 기본 속도(설정 > 접근성 > 텍스트 음성 변환 > 말하기 속도)를 쓴다. 스크린 리더 사용자는 그 값을 이미 빠르게 맞춰 두므로 앱 고정값 1.0이 오히려 느리다. 1.5·2.0이면 `setSpeechRate(배율)`(축이 배율이라 값 그대로). **초기 표: 1.0 → 호출 없음(시스템 기본), 1.5 → 1.5f, 2.0 → 2.0f** — §11-6 실측으로 확정(한소네에서 시스템 속도가 반영되는지, 1.5f가 체감 1.5배인지).
- `highPriority`: 안드로이드 TTS엔 우선순위 축이 없다 — 모든 문장이 flush(latest-wins)라 iOS `.high`의 목적(착지 낭독에 잠식되지 않음)은 채널 분리로 이미 달성된다. 인자는 호출부 의도 기록용으로 유지(계측 로그에 남긴다).
- **전경 게이트(iOS `isForeground`)의 안드로이드 판정(§12-3)**: `post()`는 `GuideSession.isSpeechAllowed()`가 거짓이면 `missedAnnouncement = true`로 떨어뜨린다. `isSpeechAllowed = 앱 전경(Activity STARTED) ∨ 화면 꺼짐(!powerManager.isInteractive)`. 즉 **다른 앱이 전경**일 때만 음성을 막는다(그 사용자는 그 앱을 스크린 리더로 읽는 중이라 우리 TTS가 겹친다 — iOS 규칙의 근거 그대로) 하고, **화면이 꺼진 채 걷는 주 사용 상황에서는 음성이 난다**(iOS는 VO 통지가 백그라운드에서 게시되지 않아 막았다 — 그 플랫폼 제약이 안드로이드엔 없고, 이것이 D11이 전경 서비스를 택한 이득이다). 전경 복귀 상환(`missedAnnouncement` → 현재 상태 한 문장)은 iOS 동형. 실측 §11-3.
- 전경 판정 입력: `GuideBottomBar`의 `DisposableEffect(LocalLifecycleOwner)`가 `ON_START/ON_STOP`을 `GuideSession.setForeground`로 넘긴다(`lifecycle-process` 의존성 추가 없이). `wasBackgrounded`는 `ON_STOP`에서 세운다.

### 5-4. 진동

- 톤 동기 진동(`ToneHaptics`): `Vibrator`(`VibratorManager.defaultVibrator`, API 31) + `VibrationEffect.createWaveform(timings, amplitudes, -1)`. 패턴은 iOS `haptic(for:)`의 시점·세기를 waveform 구간으로 옮긴 표(§10-4 JVM 테스트가 시점 합이 톤 길이 이하임을 단언):
  - closer 탭 1(0ms, 40ms@115) · farther 탭 2(0·80ms) · nearby 종 타격 6(0·290·440·590·840·1100ms, 세기 255·190·205·215·190·130) · tick 지속 500ms@90 · unreliable 탭 3(0·150·400ms) · ahead 트릴 7(40·130·210·280·360·420·500ms) · crosswalk 비프 8(4×120ms 간격 ×2묶음, 묶음 간격 250ms) · left/right 탭 2(0·220ms, 둘째 강) · back 400ms 버즈 2회(간격 100ms, 세기 계단 감쇠) · warning 40ms@255 + 감쇠 300ms(3단) · start/stop 1300ms 엔벨로프(150·150·155·260·185·200·200ms 구간, 세기 0→38→140→255→255→180→77→0).
  - `hapticIsOptIn`(closer·tick·unreliable)은 `TrendHaptics.storageKey` 저장값(기본 꺼짐 — iOS 동형, 설정 UI는 설정 마일스톤)을 매 재생 시 읽는다.
- **안드로이드 차이(기록)**: 진동은 FGS가 살아 있는 한 **백그라운드에서도 난다**(iOS "햅틱은 백그라운드 미지원"의 반대). 그래도 "어떤 신호도 진동에만 싣지 않는다" 규칙은 유지한다 — 진동 없는 기기(한소네 미확인, §11-7)가 있고 소리가 정본이다.
- `ResultHaptic.fire(success|attention|failure)`: `createPredefined(EFFECT_CLICK)` / `createWaveform([0,40,60,40])` / `createWaveform([0,60,60,60,60,60])`(iOS notification 3종 질감 대응, §11-7 실기기 판정). **실험판 상수 켬**(착수 프롬프트 — 설정 마일스톤에서 스위치). 모델 창구 `resultHaptic(kind)`는 `outputSuppressed`면 건너뛴다("문장이 나가는 조건 = 진동이 나가는 조건"). 소스 가드가 `Vibrator`·`VibrationEffect` 참조를 `audio/` 두 파일로 잠근다.

### 5-5. 억제 소유자 집합 (`outputSuppressed`)

```kotlin
// GuideSession
private val suppressionOwners = HashSet<Any>()
private var suppressionPrior: Boolean? = null
fun setOutputSuppressed(active: Boolean, owner: Any) {
    if (active) { val wasEmpty = owners.isEmpty(); owners += owner; if (!wasEmpty) return
                  prior = walk.outputSuppressed; walk.outputSuppressed = true }
    else        { owners -= owner; if (owners.isNotEmpty()) return; val p = prior ?: return; prior = null
                  walk.outputSuppressed = p && walk.outputSuppressed }   // 이전 값 ∧ 현재 값
}
```

- 소비자: 받아쓰기(android-m1 `speech/` — 시작 직전 `setOutputSuppressed(true, this)`, **모든** 종료 경로에서 `false`), 채팅 TTS(M6). 인터페이스는 `guide/`에 두고 배선은 그 소유 세션에 요청한다(§12-4). `walk.outputSuppressed` setter는 iOS 동형 — `tones.isSuppressed` 전파, 해제 시 `pendingRecovery` 최신 1개 복구 발화.
- 세션 경계(`start`·`stop`)는 `outputSuppressed = false`로 무조건 해제(iOS BLOCKER 계약)하되 **소유자 집합은 비우지 않는다** — 받아쓰기가 아직 돌고 있으면 그 종료가 `prior ∧ current`로 다시 판정한다.

---

## 6. 리듀서 배선 (`WalkGuideModel`) — iOS 규칙 → 안드로이드 수단

### 6-1. fix 처리 파이프라인 (iOS `handle(fix:)` 순서 그대로)

1. `guard isTracking, dest` → `now = uptimeNow`, `age`.
2. `motion = judgeMotion(fix, age, now)` — `abs(age) > 5초`면 `speedUnknown`, 아니면 `motionStep(state, MotionSample, speed, speedAccuracy, maxWalkSpeedMps)`.
3. `awaitingRoute`: `lastFixAt`·세션 진행 앵커 갱신 → `routeOriginStep(best, RouteOriginFix)` → `Fetch` → `startRouteFetch(origin, "accepted")` / `Wait(best)` → 보관(`routeOriginBestAt`) + `routeOriginWait` 로그 → return. 15초 상한(`fixWaitWatch`)이 최선값으로 조회하거나 `fallbackToBrief("guide.detailNoLocation")`.
4. `inFinalApproach` → `handleFinalApproach` → return.
5. `mode == detail` → `handleDetail` → return.
6. 간략: `brief` 로그 → `isUsableFix` 아니면 `routeTone(unreliable, arrived = arrivedNow)` → return. `beaconStep` → 간략 도착 창(`briefArrivalWindowStep`) → `beaconGateStep` → `routeTone(unreliable = weak, priority = nearbyTone ? nearby : null, trend = TrendInput(distance, max(15, acc), floor = acc, motion, walkCloserInterval), arrived = nearby)` → 통지(`text(for:)`) → `maybePresumeArrival`.

`handleDetail`: `accuracy > 0 && age ≤ 10` 아니면 `unreliable` 톤 → return. `guideStep(state, GuideFix, route, now, GuideTuning.walk)` → `backOnRoute/reacquired`면 하단 2행 기준 리셋 → `refreshLiveRows` → `fix` 로그(iOS 필드 전부) → `finalApproachEnter`면 `beginFinalApproach` + 같은 fix로 `handleFinalApproach` → `updateRemaining` → `routeTone(unreliable = uncertain|reacquiring, priority = BeaconTone.fromGuide(out.tone), eventOwned = event != null, trend = following|bundle ∧ !jumped ? TrendInput(remaining, 6, floor 5, motion, 2초) : null)` → 이벤트 없으면 `syncStatusTextWithPhase` / 있으면 `consume(event)`.

`consume(event)`(walk만): `AnnounceSteps`·`BundleReread` → `GuideText.unit`, `statusText = ""`, 억제면 `pendingRecovery` / `Imminent(stage 0만 문장)` → `GuideText.imminentText(action)`, 억제 시 보관 안 함 / `Periodic` → `GuideText.periodicWalk(target = liveSteps[i].target)`, `statusIsNextPreview = true` / `WaypointReached` → `waypoint = null`·`clearProposal`·`nearby` 톤·`directions.viaArrived` / `OffRoute` → `offRoute = true`·문장·회차 시작이면 `maybeFetchProposal` / `BackOnRoute` → `ResultHaptic.success`·문장 / `UncertainEnter`·`UncertainExit`·`Reacquiring`·`Reacquired` → 문장 / `SpeedSuggest` → 무시 / `FarNotice`·`FinalApproachEnter` → 도달하지 않음(walk 프로파일·fix 처리부가 가른다).

`handleFinalApproach`: `isUsableFix` 아니면 `unreliable` → return. 직선거리·띠바 거리·`advanceProgressAnchor` → `arrived = distance ≤ finalApproachArriveMeters` → `final` 로그 → `routeTone(trend = TrendInput(distance, max(15, acc), floor acc, motion, 2초), arrived)` → 진입 서술 1회(`GuideText.finalApproachEnter`, `ResultHaptic.attention`, 미게시면 `pendingFinalApproachIntro`) → 도착이면 `nearby` 톤·`stop()`·`arrivalDest = dest`·`endKind = arrived`·`loadArrivalHealth()`·문장(`guide.arrived`) → `maybePresumeArrival` → 15초 주기 `GuideText.finalApproachTick(distance, liveDirection, acc)`.

`liveDirection`: `courseStep(course, courseAccuracy, speed ?: -1.0, motion, age)` — `speed`가 null이면 `-1.0`(courseStep의 `speed >= 0.4` 가드가 `Unknown`을 낸다).

### 6-2. 경로 조회·재조회

- `fetchDetailData(origin, dest, variant, waypoint)` = `RouteService.walk(..., accessible, lang = DataLocale, includeGeometry = true, variant, via)` → `waypoint != null && briefing.waypoint == null`이면 null → `buildGuideRoute(steps.map { GuideStepGeometry(description, pathCoords, action) }, waypoint?.stepIndex)` → null이면 상세 부적격 → `DetailFetchResult(route, durationSeconds, stepFree(raw)·stepFreeStatus·stepFreeNotice, finalApproach, liveSteps = liveStepsFrom(route, steps.map { LiveStepFields(live?.target, live?.anchor, crossing ?: false) }))`. `Dispatchers.IO`에서 호출, 커밋은 메인.
- 시작 조회 커밋(`fetchGuideRoute`)·재조회 커밋(`commitReroutedRoute`)·자동 채택(`fetchProposal`)은 iOS 동형(토큰·목적지·경유지 스냅샷 가드, `consumeStepFreeNotice`, `.high` 문장, `pendingStepFreeNotice` 상환).
- **재조회 origin**: iOS는 `LocationService.currentCoordinate()`(추적 중 스트림 최신 fix). 안드로이드는 `LocationStore`가 스트림을 모르므로 **모델의 마지막 수용 fix(`lastFixCoord`, 15초 이내)**를 origin으로 쓴다 — 없으면 재조회 실패 문장(`guide.rerouteFailed`). 자동 채택의 신선도 검사(`RerouteProposalGate.isFresh`, 취득점 30m·120초 + fix 15초)는 그대로.
- 조회 상한: `withTimeoutOrNull(15초)`(M3 `queryTimeoutMs` 동형) — 만료는 실패로 접는다(iOS는 URLSession 기본 상한).

### 6-3. iOS와 의도적으로 다른 것 (전부 플랫폼 차이 — 규칙 위반 아님)

| 자리 | iOS | 안드로이드 | 근거 |
|---|---|---|---|
| 백그라운드 복귀 앵커 리셋(`handleScenePhaseChange` 말미) | 미선언 빌드만 리셋 | **리셋 없음** | 스트림이 FGS로 계속 흘러 상태가 최신(iOS 선언 빌드와 같은 갈래) |
| 음성 전경 게이트 | 전경만 | 전경 ∨ 화면 꺼짐(§5-3) | VO 통지 제약 부재 |
| `isBackgroundAudible`/`soundDegraded` | 카테고리·활성 | 미디어 볼륨 0 | 카테고리 개념 없음 |
| 진동 백그라운드 | 불가 | 가능(신호를 진동에만 싣지 않는 규칙은 유지) | 플랫폼 |
| 권한 회수 처리 | 델리게이트로 `stopAndFail` | 없음(프로세스 재시작) | 플랫폼 |
| 정밀 위치 | `reducedAccuracy` 팝업 | COARSE → 재요청(M3 동형) | 플랫폼 |
| 단조 시계 | `systemUptime`(잠자기 정지) + `ContinuousClock`(종료 화면) | `elapsedRealtime` 하나 | 잠자기 중 리듀서 판정: 화면 꺼짐에도 fix가 계속 오므로 시계가 흐르는 것이 옳다(`RerouteProposal`·`sessionIdle`이 주머니 시간을 정직하게 센다) |
| 재조회 origin | 위치 서비스 `currentCoordinate` | 모델 최신 fix(15초) | §6-2 |
| 알림 | 없음 | FGS 지속 알림 + 종료 액션 | D11 |
| 화면 유지 | `isIdleTimerDisabled` | `FLAG_KEEP_SCREEN_ON`(추적 중) | 플랫폼 |

### 6-4. 규칙 대조표 (CLAUDE.md·INTEGRATIONS §실시간 길 안내 → 수단)

| 규칙 | 수단 |
|---|---|
| 톤 계층 배타 순서·`needsRebase` | `toneLayerStep` 입력 조립만(§6-1) — 간략 3단·상세 4단 입력이 iOS와 같은 값 |
| 도플러 3-state 정지, `speedUnknown`엔 tick 없음 | `motionStep`에 `hasSpeed()` 거짓을 **null**로(0.0 금지) |
| fix 부재 워치독(8초 톤·15초 음성·30초 재통지) | 메인 `Handler.postDelayed` 2초 루프 `tickWatchdog`(`unreliable`, `maybePresumeArrival`, `maybeEndIdleSession`, `noticeStaleIfNeeded`) |
| 이탈 두 축·유도기 리듀서 소유 | `guideStep`만 부른다(방위 관측 인자 없음) |
| 도착 창·`briefArrivalWindowStep`·`resetArrivalWindow` 한 곳 | §6-1 간략·최종 접근 갱신부 |
| 결정 지점 두 층·임박 삼중 큐·`stage > 0` 무문장 | `consume(Imminent)` |
| 잊힌 세션 안전망(600초·1200초, 앵커 25m) | `noteSessionProgress` + 워치독 `maybeEndIdleSession` |
| 톤 뒤 발화·단일 슬롯·`announceNow`만 즉시 | `DeferredAnnouncer(scope = Main, clock = uptimeNow, toneEndsAt = tones::toneEndsAt, post = ::post)` — 새 통지 경로는 `announce`/`announceNow`만(소스 가드: `speaker.speak(` 호출부는 `post` 한 곳) |
| 잘림 방지 대기 | `endSession()` 잔여 대기 + `beginSession()` 예약 취소(§5-2) |
| `outputSuppressed` 소유자 집합 | §5-5 |
| 오디오 재생기 둘 → 소유권 이전 | 재생기 하나·포커스 하나(M5도 공유) — 이전 개념 소멸(§5-2 #16) |
| 종료 화면 동기 판정 | `stopLeavingSummary`: `StepCounter.liveSample`(라이브 누적)으로 `isMeaningfulWalk` 동기 판정 |
| 세션 앱 수명·시트 최소화·소거는 닫기뿐 | `GuideSession`(§3-1)·`GuideBottomBar`(§7-2) |
| 통지 우선순위 판별선 | TTS 채널이라 잠식 없음(§5-3) — `highPriority`는 기록 |
| 결과 진동 3종·문장 조건 = 진동 조건 | §5-4 |
| 안내 origin은 정확도(`routeOriginStep`) + `routeOrigin` 로그 | §6-1 ③ |
| 정지 톤 뒤 원복 | `stop()`의 `tones.endSession()` |
| 추정 도착 종은 전경만 | `isForeground`(Activity STARTED — 화면 꺼짐은 전경이 **아니다**: 주머니 속에서 한참 뒤 울리지 않게, iOS 판정의 취지) |
| 거리 표기 `formatDistance`만·낭독 `spokenDistanceUnits` | `GuideText`·행 렌더·TTS 창구 |
| 3-state | 상세/간략 폴백 문구 갈림, 걸음 요약 부재는 행 부재, `ttsUnavailable`·미디어 볼륨 0 문장 분리 |

---

## 7. 화면 ([4])

M1 §3 기본형·M2·M3 관용구(`mergedRow`·`ActionRow`·`tapTarget`·`headingText`·`FocusRequester`는 `focusable` **앞**·48dp·이모지 0)를 전부 승계한다. **이 화면에만 다른 것**: live region이 없다(§5-3).

### 7-1. 시작 버튼 (`WalkGuideStartButton`, directions 슬롯)

- `WalkOutcomeRows`에 `guideStart: (@Composable (variant: WalkRouteVariant?) -> Unit)?` 인자를 더한다(기본값 null — M3 테스트 호환). `DirectionsForm`은 `AppConfig.experimentalGuidanceEnabled ∧ 도착 좌표 있음`일 때만 슬롯을 넘긴다: `{ variant -> WalkGuideStartButton(dest, label, accessible = s.stepFreeEnabled && lang == ko, variant, shortestAvailable = s.walkShortest != null, waypoint = s.via) }`. 도착 좌표·라벨 = `promotedDestination ?: (to as Place)`; `to == Current`면 슬롯 null(버튼 없음).
- 버튼 라벨 `beacon.guideStartWalk` / `android.beacon.guideStartWalkShortest`(android-extra 신규 — ios-extra 비접두 키는 들이지 않는 규칙이라 접두 키로), `tapTarget`, testTag `guide-start-walk`/`guide-start-walk-shortest`. 활성화 = `GuideSession.startWalk(request)`. 착지: 시작 즉시 시트가 뜨므로 이동 없음. 시트가 최소화되어 돌아오면 커서는 시스템 복원(버튼이 그대로 있다).
- 추적 중엔 버튼을 **숨기지 않는다**(누르면 `guide.alreadyActive` 거부 통지 — iOS 동형).

### 7-2. `GuideBottomBar` (AppRoot 삽입 한 자리)

```kotlin
// AppRoot: bottomBar = { GuideBottomBar { NavigationBar(...) } }
@Composable fun GuideBottomBar(tabs: @Composable () -> Unit) {
    val ctx = LocalContext.current; remember { GuideSession.attach(ctx.applicationContext) }
    GuidePermissionsLauncher()                       // rememberLauncherForActivityResult 손 등록
    ForegroundObserver()                             // ON_START/ON_STOP → GuideSession.setForeground
    KeepScreenOn(GuideSession.walk.isTracking)       // activity.window FLAG_KEEP_SCREEN_ON
    Column { if (GuideSession.hasScreen && GuideSession.isMinimized) GuideBand(); tabs() }
    if (GuideSession.hasScreen && !GuideSession.isMinimized) GuideSheet()   // ModalBottomSheet
}
```

- 띠바(`GuideBand`): 버튼 하나 = 객체 하나. 시각 두 줄(요약·`guide.band.return`), 낭독 `joinText(spokenDistanceUnits(요약), guide.band.return)`. 요약 = `guide.band.remaining(dest, formatDistance(bandDistanceMeters))` / `starting` / 종료 화면이면 `arrived`·`ended`. 활성화 → `returnedFromBand = true; isMinimized = false`. **최소화 직후 착지 = 띠바**(`FocusRequester`를 `clickable` 앞에, 한 프레임 + 400ms 뒤 `requestFocus`, 실패 1회 재시도).
- 시트(`GuideSheet`): `ModalBottomSheet(onDismissRequest = { isMinimized = true }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), dragHandle = null)`. 뒤로 키·바깥 탭·스와이프 = **최소화**(종료가 아니다). 내용은 `Column(verticalScroll)` + 최하단 고정 종료 버튼(스크롤 밖).

### 7-3. 안내 시트 읽기 순서 (= 시각 순서)

| 순서 | 요소 | 계약 |
|---|---|---|
| 1 | 제목 행 | `Text(joinText(beacon.walkHeading, destinationLabel))` 헤딩(`headingText`), `mergedRow("guide-title", focus = titleFocus)`. **진입 기본 착지**. 우측 접기 `IconButton`(`guide.minimize`, 48dp, `focusRequester(minimizeFocus)`) — 띠바 복귀(`returnedFromBand`) 시 착지 |
| 2 | 진행 상황 버튼 `guide.progressButton` | 상세(경로 보유) → 조망 페이지(§7-4)로 시트 내용을 교체 / 간략 → `announceNow(progressText(), high)` + `statusText` 갱신 |
| 3 | 재조회 버튼(이탈 확정 시만) | 라벨 `isRerouting ? guide.rerouteBusy : guide.rerouteButton`(라벨이 곧 상태). 성공·자동 채택으로 사라질 때 **제목 착지**(`offRoute` false 전이 ∧ `reroutePressed ∨ offRouteEndedByReroute`) |
| 4 | 간략 주석 `beacon.straightLineNote`(`mode == brief`) | 비상호작용 행 |
| 5 | 남은 거리·시간(`remainingText`, 상세 ∧ !offRoute) | `TextRow(spoken = spokenDistanceUnits)` — 매 fix 갱신, 통지 없음 |
| 6 | 상세: 하단 2행(`liveTopText`·`liveNextText`) / 간략: 상태 행(`statusIsNextPreview ? guide.progressNext(statusText) : statusText`) | 비상호작용 행. 값이 null·빈 문자열이면 행 없음 |
| 7 | 소리 상태 행(`soundDegraded` → `android.guide.mediaVolumeZero`, `ttsUnavailable` → `android.guide.ttsUnavailable`, `tones.isSilenced` → `android.beacon.soundUnavailable`) | 지속 상태라 상태 행과 자리를 다투지 않는다 |
| 8 | **최하단 고정** `beacon.stop` 버튼 | 스크롤 밖 `Column` 말미, `tapTarget`, testTag `guide-stop`. 활성화 → `stopByUser()` |

- 착지 절차(M2 관용구 확장): `LaunchedEffect(key) { withFrameNanos{}; delay(400); if (!requester.requestFocus()) { delay(600); requester.requestFocus() } }` — `ModalBottomSheet` 표시 애니메이션이 끝난 뒤 시스템이 포커스를 옮기므로 그보다 늦게 대입(iOS `landTitleFocus` 동형). `requestFocus()`의 Boolean 반환으로 1회 재시도.
- 도착 전이(`arrivalDest` null → non-null): 포커스를 쥔 종료 버튼이 사라진다 — **도착 문장 착지**.

### 7-4. 조망 페이지 (시트 내용 교체, iOS `GuideOverviewSheet` 도보부)

상단 닫기 → 행(`ios.guide.routeListCurrent`/`routeListRow`, 경유지 구획 `directions.viaArrived`) → 말미 닫기. 헤더 = `progressText()`(헤딩, 진입 착지 — 낭독이 곧 조망 문장, 별도 통지 없음). 닫기·뒤로 → 시트 본문으로 복귀, 착지 = 진행 상황 버튼. 행동 슬롯(대안 보기)은 M4b.

### 7-5. 종료 화면 (같은 시트, `arrivalDest != null`)

| 순서 | 요소 |
|---|---|
| 1 | 헤딩 `joinText(endHeading, destinationLabel)` — `android.beacon.arrivedHeading`/`arrivedPresumedHeading`/`endedHeading` |
| 2 | 종료 문장(`guide.arrived`/`guide.arrivedPresumed`/`endText`) — **착지** |
| 3 | 걸음·칼로리 문장(있을 때만): `usedDefaultWeight ? android.beacon.healthSummaryWithWeight(steps, 65, kcal) : healthSummary(steps, kcal)` + 음식 비유(`WalkHealth.foodComparison` → `android.beacon.food.*` 리터럴 `when`) 한 객체(공백 결합) |
| 4 | 닫기 `actions.close` → `clearArrival()` |

- 체중은 `WalkHealth.weightStorageKey`를 `SharedPreferencesStore`로 읽는다(설정 UI 없음 — 항상 기본 체중 문장).
- 30분 만료(§3-3). 백그라운드에서 끝난 세션은 정지 톤·음성 없이 화면만 남는다(설계대로).

### 7-6. 통지·착지·진동 표

| 사건 | 문장(TTS) | 착지 | 진동 |
|---|---|---|---|
| 시작(상세 커밋) | `guide.detailStart` 원자 발화(+열화 문장 앞) | 시트 제목 | `start` 톤 진동 |
| 간략 폴백 | `guide.detailUnavailable(dest)`/`detailNoLocation` | — | — |
| 결정 지점 40m | 전문(`GuideText.unit`) | — | — |
| 임박 20·15·10m | 문장은 첫 단계만 | — | 행동별 톤 진동 매 단계 |
| 이탈 확정 | `guide.offRoute` | — | `warning` |
| 자동 채택·재조회 성공 | `guide.autoReroute`/`rerouteDone` | 제목(버튼 소멸) | `ResultHaptic.success` |
| 재조회 실패 | `guide.rerouteFailed` | — | `failure` |
| 복귀 | `guide.backOnRoute` | — | `success` |
| 최종 접근 진입 | `guide.finalApproachRouteEnd + …` | — | `attention` |
| 확정·추정 도착 | `guide.arrived`/`arrivedPresumed` | 종료 문장 | `nearby` 톤 진동 |
| 사용자 종료(요약 있음) | `beacon.stopped` | 종료 문장 | `stop` 톤 진동 |
| 미디어 볼륨 0 | `android.guide.mediaVolumeZero` 1회 | — | `attention` |
| TTS 불가 | (문장 불가 — 행만) | — | `failure` 1회 |
| 거부(이미 안내 중) | `guide.alreadyActive` | — | — |

---

## 8. 계측 (`GuideDiag`)

- `GuideDiag.log(msg)`: `Log.i("GuideDiag", line)` + 파일 `context.getExternalFilesDir(null)/guide-diag.log`(2MB 초과 시 `guide-diag.old.log`로 교체). 게이트 `BuildConfig.DEBUG || BuildConfig.EXPERIMENTAL`(릴리스는 no-op, 문자열 조립 자체가 인라인 람다로 건너뛴다).
- 줄 형식은 iOS와 같다(`[GuideDiag] [ISO8601] session kind=walk` · `routeOrigin lat= lng= acc= age= reason=` · `routeOriginWait acc= age= best=` · `brief t= lat= lng= acc= motion= age= usable= dist= nearby=` · `fix t= … phase= d= event= perp= edgeHits= derived= vote= axes= votes= verdict=` · `finalEnter offset=` · `final t= dist= acc= arrived= introSpoken=` · `arrivalWindowEnter/Exit` · `presumedArrival reason= dist= window=` · `sessionIdleEnd reason=` · `briefHandoff reason=` · `endScreenExpired age=` · `arrivalHealth load= latencyMs=`) — 기존 리플레이 스크립트가 그대로 읽게. 추가 줄: `service start ok|failed=`·`focus lost=`·`tts init=`·`notify text=`(길이만).
- 회수: `adb pull /sdcard/Android/data/space.dodoplanet.gildongmu.dev/files/guide-diag.log ~/gildongmu-private/field-logs/android-<날짜>.log`. 저장소엔 커밋하지 않는다 — 루트 `.gitignore`에 `guide-diag*.log*` 패턴을 더한다(현재 `docs/superpowers/specs/logs/*.log`만 있다).

---

## 9. i18n

- 기존 키 재사용: `beacon.*`(walkHeading·stop·first·closer·farther·nearby·weak·denied·reduced·straightLineNote·stopped·guideStartWalk), `guide.*`(detailStart·bundle·handoff·finalApproach*·arrived·arrivedPresumed·endedIdle·dir*·offRoute·backOnRoute·imminent.*·live*·nextAction·nextStraight*·uncertain*·reacquiring·detailUnavailable·detailNoLocation·progressButton·progressOrdinal·progressCurrent·progressNext·remainingDistance·remainingTime·rerouteButton·rerouteBusy·rerouteFailed·rerouteDone·autoReroute·progressUncertain·progressOffRoute·progressFinalApproach·approx·rough·noGuidanceYet·alreadyActive·minimize·band.return·band.remaining·band.starting·band.arrived·band.ended·periodicStraight·periodicStraightNoName·nextDestination), `android.beacon.*`(soundUnavailable·arrivedHeading·arrivedPresumedHeading·endedHeading·healthSummary·healthSummaryWithWeight·food.*), `android.guide.routeListCurrent`·`routeListRow`, `directions.viaArrived`, `actions.close`, `android.unit.spokenMeters`.
- **android-extra 신규(6로케일)**: `android.beacon.guideStartWalkShortest`(ios-extra 문안 그대로) · `android.guide.mediaVolumeZero`("미디어 볼륨이 꺼져 있어 안내 소리가 나지 않습니다") · `android.guide.ttsUnavailable`("이 언어의 음성 안내를 쓸 수 없습니다. 화면의 안내 문장을 확인하세요") · `android.guide.serviceStartFailed`("안내 서비스를 시작하지 못했습니다. 앱을 화면에 띄운 채 다시 시작하세요") · `android.guide.notificationChannel`("도보 안내"). `%`가 없는 문장이라 거부 규칙 무관, `INTENDED_DIFFERENCES` 대상 아님(iOS에 없는 키).
- 문자열 창구 `GuideStrings.stringId(key)` 리터럴 표(M3 `DirectionsStrings` 관용구) + `GuideSourceGuardTest`가 소스의 키 모양 리터럴 전수를 표에 대조. `GuideText`는 `Strings` 주입(JVM 테스트는 `CatalogStrings` 재사용 — `directions/` 테스트 픽스처를 `guide/` 테스트가 import한다).
- 카탈로그 재생성: `node android/scripts/messages-to-android-strings.mjs`(신규 키는 순서 변경이 아니라 exit 0).

---

## 10. 게이트와 테스트 레인

### 10-1. JVM (`:app:testDebugUnitTest`)

- `WalkGuideModelTest`: 페이크 `RouteService`(`stubbedClient`), 페이크 `GuideTones`·`GuideSpeaker`·`StepCounter`·`GuideForegroundController`(인터페이스 — 실구현은 서비스), 주입 시계·`MainDispatcherExtension`. 시나리오: ① 시작 → 수용 fix → 상세 커밋 → 원자 발화 1회 ② 15초 무수용 → 최선값 조회 / 없음 → 간략 폴백 문장 ③ 상세 fix 열(공유 fixture `route-guide-scenarios.json`의 한 케이스를 좌표 열로) → 임박 stage 0만 문장·톤 3회 ④ 이탈 확정 → 자동 조회 1회·채택·`.high` 문장·`ResultHaptic.success` ⑤ 최종 접근 진입 서술 → 도착 → `stop`·`arrivalDest`·종료 문장 ⑥ 사용자 종료: 라이브 누적 50m 이상이면 종료 화면, 미만이면 없음(동기) ⑦ 억제 소유자 집합 `이전 ∧ 현재` ⑧ 워치독 8초 `unreliable`·15초 문장·600초 세션 종료 ⑨ 전경 게이트: 다른 앱 전경 → `missedAnnouncement` → 복귀 상환 1문장 / 화면 꺼짐 → 발화 ⑩ 종료 화면 30분 만료 ⑪ 알림 본문 조립기 = 상태 문장 우선 ⑫ 거부(`alreadyActive`).
- `GuideAudioFocusTest`: §5-2 표의 18항 대응 단언(페이크 `AudioManager` 인터페이스).
- `GuideTonePlayerTest`(순수부): `toneResource` 전수·게인 표·`toneEndsAt` 대입 조건·`ToneHaptics` 시점 합 ≤ 톤 길이.
- `GuideTextTest`: `CatalogStrings`로 실문장 단언(시작·주기·임박·최종 접근·조망 헤더·종료 화면 걸음 문장).
- `DeferredAnnouncer` 배선: 톤 뒤 발화가 `post`를 지연 호출하는지(kit 테스트가 이미 수명을 잠근다 — 여기서는 `toneEndsAt` 주입 확인 1건).
- **소스 가드 `GuideSourceGuardTest`**: ① `GuideSession.startWalk(` 호출부 == `WalkGuideStartButton.kt` 1곳(+ 테스트) ② `startWalk` 본문에 `experimentalGuidanceEnabled` 가드 존재 ③ `TextToSpeech(`·`SoundPool`·`Vibrator`·`VibrationEffect` 참조는 `audio/` 지정 파일만 ④ `speaker.speak(` 호출부는 `WalkGuideModel.post` 한 곳 ⑤ `res/raw` 이름 집합 == `resourceName` 변환 집합, 바이트 == `public/sounds/guide` ⑥ `guide/`에서 `import android.location`은 `GuideLocationStream.kt`만 ⑦ 매니페스트에 `foregroundServiceType="location"` 서비스 1개, `ACCESS_BACKGROUND_LOCATION` 0(기존 가드) ⑧ 문자열 키 전수 매핑 ⑨ 시트에 `liveRegion` 0.

### 10-2. androidTest (`connectedDebugAndroidTest`, adb 연결 시)

- `GuideSheetA11yTest`: 페이크 모델 상태로 시트를 띄워 제목 헤딩·행 단일 노드·종료 버튼 48dp·ATF 검사 통과. 종료 화면 착지 문장 단일 노드.

### 10-3. 게이트 절차

README §7 락 안에서 `:kit:test :app:testDebugUnitTest :app:assembleDebug :app:assembleExperimental` + `VITEST_MAX_THREADS=2 npm run test:run`(`xcstrings-plural` 1건 실패 기대). vitest 쪽 영향: `android-strings-drift`(신규 키 왕복)·`mirror-registry`(kit 무수정) — 생성물 재생성 필수.

### 10-4. 변이 주입(커밋 뒤)

① `motionStep`에 speed 0.0 넘기기(거짓 정지 tick 검출) ② `startWalk` 게이트 제거(소스 가드) ③ `releaseAfter` 예약 취소 제거(잘림 시나리오 #16) ④ `stopLeavingSummary` 임계 49m(동기 판정) — 넷 다 빨강이어야 한다.

---

## 11. 실기기 검증 항목 (한소네 7, `docs/FIELD-TEST.md` 형식 — 보고 파일에 대본으로 싣는다)

| # | 언제 | 무엇을 듣고 | 무엇을 답하나 |
|---|---|---|---|
| 1 | **D11**: 안내 시작 → 화면 끄고 3분 걷기 → 다른 앱(카톡) 열고 2분 | 화면 꺼짐·타 앱 전경에서 톤이 계속 나는가(closer/tick) / 8초 `unreliable`가 나는가 | 로그 `fix t=` 줄이 끊김 없이 이어지면 D11 성립. 끊기면 spec §4-1 재판정(백그라운드 위치는 D11이 요청 금지 — 대안은 코디네이터) |
| 2 | 시작 직후 | 시작 톤 → `guide.detailStart` 문장이 톤 뒤에 나오는가(겹침 없음) | `speechDeferStep` 배선 |
| 3 | 화면 꺼짐 중 결정 지점 | 임박 톤 + 문장이 **둘 다** 나는가(§5-3 판정) / 다른 앱 전경에선 문장이 **안** 나고 복귀 시 현재 상태 1문장 | 음성 게이트 |
| 4 | TalkBack으로 시트를 훑는 중 주기 통지 도착 | TTS와 TalkBack이 겹칠 때 어느 쪽이 덕킹되는가, 문장이 들리는가 | 겹침이 치명적이면 §12-5 대안(TalkBack 중엔 접근성 통지 채널) |
| 5 | 주기 통지 "약 120m" | TTS가 `m`을 "미터"로 읽는가(정정 없이) | `spokenDistanceUnits` 유지/제거 |
| 6 | 시스템 TTS 속도를 빠르게 둔 채 | 안내 속도가 시스템 설정을 따르는가 | §5-3 배율 표 확정 |
| 7 | 임박 톤 5종·이탈·도착·start/stop | 진동이 나는가, 5종이 손에서 갈리는가, `ResultHaptic` 3종이 갈리는가 | 한소네 진동 유무 |
| 8 | 알림 그늘 | "도보 안내, {dest}" + 상태 한 줄이 점자로 읽히는가, "안내 종료" 액션이 종료하는가 | D11 자산 |
| 9 | 접기 → 띠바 | 띠바에 커서가 착지하는가, 펼치면 접기 버튼에 착지하는가 | 착지 표 |
| 10 | 시트 진입 | 제목 헤딩 착지, 스와이프 순서 = §7-3 표 | |
| 11 | 도착 | 종 → 도착 문장 착지 → 걸음·칼로리 문장 → 닫기 | 걸음 센서 유무 |
| 12 | 미디어 볼륨 0으로 시작 | `mediaVolumeZero` 문장·진동, 시트 행 | |
| 13 | 계단 회피 켠 채 시작 | 열화 문장이 시작 문장 앞에 결합되는가 | |
| 14 | 이탈(일부러 한 블록 돌기) | `warning` → `offRoute` → 자동 채택 문장 → 커서 제목 착지 | |
| 15 | 세션 중 전화 수신 | 통화 뒤 다음 톤이 나는가(계약 2) | |

**D11 실측 계획**: #1을 첫 실보행의 첫 항목으로 두고 결과를 spec §4-1에 한 줄로 기록한다(성립/불성립·기기·OS·날짜).

---

## 12. 판정 목록 (강한 디폴트 — 뒤집으려면 근거)

1. **안내 위치 스트림은 `guide/GuideLocationStream.kt`가 자기 리스너로 연다**(§2). `AppSourceGuardTest`의 `LocationManager` 허용 목록에 이 파일 한 줄을 더해야 하며 그 테스트는 android-m1 소유 — 코디네이터에 허가 요청(①). 대안 B: `location/LocationSource`에 `subscribeGuide(onFix: GuideRawFix)`를 android-m1이 추가(약 20줄, 페이로드 타입은 `location/`). A가 결합도가 낮고 `LocationManager`의 다중 리스너가 공존 문제를 없애므로 A 권고.
2. **`ACTIVITY_RECOGNITION` 추가**(§3-4) — 착수 프롬프트 additive 목록 밖. 거부해도 안내는 돈다(요약만 없음). 코디네이터가 기각하면 종료 화면은 도착 문장 + 닫기만 남기고 `WalkHealth` 배선은 뺀다.
3. **음성 전경 게이트 = 전경 ∨ 화면 꺼짐**(§5-3). iOS "백그라운드 음성 억제"의 근거(VO 통지 미게시·타 앱 침해) 중 타 앱 침해만 남기고, 화면 꺼짐은 TTS로 낸다. 실측 #3.
4. **억제 소유자 집합 인터페이스는 `guide/`에 두고 배선은 소유 세션에 요청**(받아쓰기 android-m1, 채팅 TTS M6) — 지금 시점엔 소비자 0(받아쓰기 미구현).
5. **안내 문장 채널은 TTS 하나, 시트는 live region 없음**(§5-3). 실측 #4가 치명적 겹침을 보이면 대안: TalkBack 활성 ∧ 전경일 때만 접근성 통지(`AccessibilityManager.interrupt` + live region)로 갈아타는 이중 채널 — 지금은 두지 않는다(YAGNI).
6. **포커스는 재생 단위 획득·지연 반납**(§5-2). 세션 단위 보유(GAIN)는 다른 앱 미디어를 세션 내내 끊는다(iOS `.mixWithOthers` 판정과 충돌).
7. **TTS 배율 1.0 = 호출 없음(시스템 기본)**(§5-3).
8. **알림 본문 = 상태 문장 우선, 비면 띠바 요약; 갱신은 텍스트 변화 시만**(§4-3).
9. **`ResultHaptic` 상수 켬, 추세 진동 3종은 저장값(기본 꺼짐)**(§5-4).
10. **조망은 시트 내용 교체**(중첩 다이얼로그 없음, §7-4). 뒤로 키가 조망만 닫는다.
11. **재조회 origin은 모델 최신 fix 15초**(§6-2).
12. **시계 하나 `elapsedRealtime`**(§2).
13. **서비스 `START_NOT_STICKY`, `onTaskRemoved` 유지**(§4-1).
14. **`POST_NOTIFICATIONS` 거부는 차단 아님**(§3-2 ③).
15. **`res/raw` 바이트 동일 가드는 `:app` JVM 테스트**(`src/**` 금지, §5-1).
16. **`AppRoot` 변경은 `bottomBar` 한 자리**(§7-2) — 시트·띠바·손·전경 관찰·화면 유지 전부 `GuideBottomBar` 안.

## 13. 적대적 설계 리뷰 판정

(리뷰 뒤 기록)
