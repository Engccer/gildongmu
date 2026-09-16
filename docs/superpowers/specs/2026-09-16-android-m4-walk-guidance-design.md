# 안드로이드 M4: 도보 실시간 안내 설계 (2026-09-16)

> **위치**: 판정 문서 `2026-09-15-android-app-decisions.md`(D1~D13, 재논의 금지)와 병렬 계획 `2026-09-16-android-app-parallel-plan.md` §1·§3·§5-4·§5-5 위에 선 M4 spec. 입력은 `~/gildongmu-wt/android-kit-guide-reports/report.md`의 "D10 경계로 [3]에 남긴 것"(TTS 배율·`resourceName` 변환·`Location.hasX()` → null/-1·`GuideSessionCoordinator` 메인 스레드·단조 시계·GuideAudioSession 목표 계약 5항·시나리오 18개), `docs/INTEGRATIONS.md` §실시간 길 안내, `CLAUDE.md`의 실시간 안내 항목 전부, M1·M2·M3 spec의 접근성·위치·길찾기 계약이다. 적대적 설계 리뷰 1차(§13) 반영본.
>
> **범위 한 줄**: iOS 정식판 **도보** 실시간 안내(`BeaconModel` walk 절단면 + `BeaconTrackingSheet` + 띠바 + 종료 화면)와 기능 등가를 안드로이드 [3]·[4]로 새로 쓴다. 판정 계층([2])은 `:kit`에 이미 있고(웹·iOS·Kotlin 공유 fixture 동조), 이 spec은 **그것을 소비하는 실행 계층과 화면**만 정한다. `:kit` 무수정, 서버 계약 변경 0.
>
> **안전·정확성 크리티컬**: 판정 계층이 iOS 실보행으로 확정한 규칙(톤 계층·도플러 정지·워치독·이탈 두 축·도착 창·결정 지점 두 층·임박 삼중 큐·잊힌 세션 안전망·톤 뒤 발화·잘림 방지·억제 소유자 집합·종료 화면 동기 판정·세션 앱 수명·시트 최소화·통지 우선순위·결과 진동 3종)은 **안드로이드도 같은 행동**을 해야 하고 수단만 다르다. §6이 규칙 하나하나를 수단에 대응시킨다. 이 spec의 결함은 거의 전부 [3] 플랫폼 수단 층에서 생긴다 — "iOS가 푼 문제를 안드로이드 수단이 정말 푸는가"를 절마다 묻는다.

---

## 1. 목표와 범위

### 1-1. 포함 (M4)

| 축 | 내용 | iOS 대응 |
|---|---|---|
| 진입 | 길찾기 브리핑 도보 추천·최단 행 펼침 본문 **첫 항목**의 "도보 안내 시작"·"최단 경로 안내 시작" 버튼(실험판 전용). 도착지가 현재 위치면 버튼 없음 | `DirectionsTabView` 도보 DisclosureGroup 첫 항목 |
| 세션 | 앱 수명 싱글턴 `GuideSession`(코디네이터 + 도보 모델 + 최소화 상태). 시작은 **`startWalk` 한 함수**. 안내 중 새 시작 거부. 시트를 내리면 최소화, 종료는 버튼(안내 종료·닫기·알림 액션)뿐 | `GuideSession.shared`·`startBeacon` |
| [3] 위치 | 안내 전용 연속 스트림(FUSED 1초, GMS 무의존) — **전경 서비스(`location` 타입)** 안에서 돈다. 세션 수명 **부분 wake lock**(§4-1). `ACCESS_BACKGROUND_LOCATION` 선언·요청 0 | `LocationService.startBeaconUpdates` |
| 지속 알림 | 상태 한 줄 + "안내 종료" 액션. `POST_NOTIFICATIONS` 처리 | (iOS에 없음, D11 자산) |
| [3] 오디오 | `SoundPool` 톤 15파일 + `AudioFocus`(재생 단위 획득·지연 반납, **못 잡으면 내지 않는다**) + `TextToSpeech` 발화(톤 뒤 발화 `speechDeferStep`, 단일 슬롯 latest-wins `DeferredAnnouncer`) + 억제 소유자 집합 | `BeaconTonePlayer`·`DeferredAnnouncer`·VoiceOver 통지 |
| 진동 | 톤 동기 waveform 13종 + `ResultHaptic` 3종 한 창구 | `BeaconTonePlayer.haptic`·`ResultHaptic` |
| 화면 | 안내 시트(제목 헤딩·접기·진행 상황·재조회·남은 거리·하단 2행·상태 문장·소리 상태·안내 종료 최하단 고정), 띠바, 조망 목록, 종료 화면(도착·추정·중지 + 걸음·칼로리 요약 + 닫기, 30분 만료), 자동 재조회 채택 + 수동 재조회 | `BeaconTrackingSheet`·`GuideBandView`·`GuideOverviewSheet` 도보부·`arrivalSection` |
| 안전망·수명 | 워치독(2초 주기, 8초 톤, 15초 음성 — wake lock 위에서), 잊힌 세션(`sessionIdleStep`), 도착 추정(`presumedArrivalStep`), 시트 표시 중 화면 유지, 프로세스 재시작 시 알림 정리 | `BeaconModel` 동형 |
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
[3] :app guide/ GuideSession(싱글턴)·WalkGuideModel(배선)·GuideForegroundService·GuideForegroundController·
                GuideLocationStream·GuideNotification·GuidePermissions·StepCounter·GuideDiag·GuideText·GuideStrings
    :app audio/ GuideTonePlayer(SoundPool+AudioFocus+진동)·GuideSpeaker(TextToSpeech)·GuideAudioFocus·
                ToneHaptics·ResultHaptic·ToneDurations
[4] :app guide/ui/ GuideBottomBar(띠바+시트 호스트+손+전경 관찰, AppRoot 삽입 한 자리)·GuideSheet·GuideOverviewPage·
                GuideEndScreen·GuideBand·WalkGuideStartButton(directions가 부른다)
    res/raw/    guide_*.mp3 15개 (public/sounds/guide/*.mp3 바이트 동일)
```

- **판정은 전부 `:kit`, 여기는 배선이다**(iOS `BeaconModel` 머리 주석 그대로). `WalkGuideModel`은 `BeaconModel`의 walk 절단면이고 상태 필드·처리 순서를 그대로 옮기되 자동차·prewalk·목적지 변경·경유지 변경·프리뷰 갈래는 **두지 않는다**(항상 참인 분기를 남기지 않는다 — 플래그 졸업 방식).
- **소유권 근거는 코디네이터 착수 프롬프트(2026-09-16, 세션 `android-m4`)다** — 병렬 계획 §2에는 아직 웨이브 3 절이 없다(코디네이터가 그 절을 신설하는 것을 §12-1에서 요청한다). 프롬프트가 준 것: `guide/`·`audio/`·`res/raw/`(신규 소유) · `directions/`의 **안내 시작 버튼 자리 추가만** · `nav/AppRoot.kt` **등록·띠바 삽입 한 자리** · `android/i18n/android-extra/` 키 additive · **매니페스트 additive**(서비스 선언·`FOREGROUND_SERVICE`·`FOREGROUND_SERVICE_LOCATION`·`POST_NOTIFICATIONS`·`VIBRATE` — 한 커밋 분리·보고 명시) · `app/build.gradle.kts` 의존성 additive(필요 시 보고). 프롬프트 밖이라 **판정을 요청하는 것**: ① `AppSourceGuardTest` 허용 목록 1줄(§4-2) ② `ACTIVITY_RECOGNITION`·`WAKE_LOCK` 권한(프롬프트 목록 밖 additive, §3-4) ③ 루트 `.gitignore` 1줄(§8). `app/build.gradle.kts` 의존성 추가는 **0** — 플랫폼 API만 쓴다(`LocationManager`·`SoundPool`·`AudioManager`·`AudioFocusRequest`·`TextToSpeech`·`Vibrator`·`SensorManager`·`NotificationManager`·`Notification.Builder`·`Context.startForegroundService`·`PowerManager`). androidx 전이 의존(`NotificationCompat`·`ContextCompat`)에 기대지 않는다(리뷰 m-3).
- **위치 계층 예외**: `AppSourceGuardTest`는 `LocationManager` 생성을 `AndroidLocationSource.kt` 한 곳으로 잠근다. 안내 스트림은 속도·방위·`elapsedRealtimeNanos`를 실은 별도 페이로드가 필요하고 서비스 수명에 결박되므로 `guide/GuideLocationStream.kt`가 자기 리스너를 등록한다 — `LocationManager`는 리스너마다 독립 요청을 받으므로(iOS `CLLocationManager`의 단일 프로파일 경합이 **없다**) `LocationStore`의 단발 취득과 공존한다. 가드 허용 목록에 이 파일 한 줄을 더하는 것이 필요하다(§12-1).
- **스레드**: 모델·코디네이터·`DeferredAnnouncer`·톤 재생기는 **메인 스레드 전용**(Swift `@MainActor` 계약). 위치 콜백은 `mainExecutor`, 서비스 → 모델 호출도 메인, TTS 리스너 콜백·센서 콜백·포커스 콜백은 `Handler(Looper.getMainLooper())`로 반입. `GuideSession`의 `CoroutineScope`는 `Dispatchers.Main`(`immediate` 아님 — `DeferredAnnouncer` KDoc의 LAZY 계약).
- **시계**: `SystemClock.elapsedRealtime() / 1000.0` **하나**(`uptimeNow`). 잠자기 중에도 흐르므로 `RerouteProposal.acquiredAt`·`nowUptime`·`isEndScreenStale`·`DeferredAnnouncer.clock`·fix 나이(`location.elapsedRealtimeNanos`)·워치독 판정이 전부 같은 축이다. iOS `systemUptime`(잠자기 정지)과의 차이는 §6-3. ⚠ 워치독의 **타이머 축**은 별개 문제다 — `Handler.postDelayed`의 `uptimeMillis`는 깊은 절전에서 멈추므로 §4-1의 wake lock이 그 절전을 막는다.
- **화면이 보는 상태**: `WalkGuideModel`은 리듀서 내부 상태를 `private var`로 들고, 화면이 읽는 값은 **`StateFlow<WalkGuideUiState>`**(data class: `status`·`destinationLabel`·`statusText`·`statusIsNextPreview`·`mode`·`offRoute`·`isRerouting`·`remainingText`·`liveTopText`·`liveNextText`·`soundDegraded`·`ttsUnavailable`·`isSilenced`·`bandDistanceMeters`·`arrivalDest`·`endKind`·`endText`·`arrivalHealth`·`routeStepDescriptions`·`currentStepIndex`·`routeWaypointRow`·`offRouteEndedByReroute`)로 커밋 지점마다 `update`한다(M1~M3 ViewModel 관용구, `collectAsState`). `GuideSession.isMinimized`·`returnedFromBand`만 `mutableStateOf`(리뷰 m-5).

---

## 3. 세션·시작·종료 ([3] 오케스트레이션)

### 3-1. `GuideSession` (앱 수명 싱글턴, `object`)

```kotlin
object GuideSession {
    val coordinator = GuideSessionCoordinator()            // :kit, 메인 전용
    lateinit var walk: WalkGuideModel                       // attach()가 1회 생성, 멱등
    var isMinimized by mutableStateOf(false)                // 시트가 내려가 띠바가 세션을 대표
    var returnedFromBand by mutableStateOf(false)           // 띠바 복귀 시트의 첫 착지 = 접기 버튼(1회 소비)
    val isActive: Boolean get() = coordinator.isActive || walk.starting
    val hasScreen: Boolean get() = walk.isTracking || walk.arrivalDest != null
    fun attach(app: Context)                                // 멱등 — 이미 초기화됐으면 즉시 반환
    fun startWalk(request: WalkStartRequest)                // 유일한 시작 진입점
    fun setOutputSuppressed(active: Boolean, owner: Any)    // 억제 소유자 집합(§5-5)
    fun setForeground(foreground: Boolean)                  // 전경 판정 입력(§5-3)
}
```

- `attach(app)`: `GuideBottomBar`의 첫 컴포지션(`remember`)에서 앱 컨텍스트로 부른다 — `GildongmuApplication`·`AppConfig`는 android-m1 소유. **멱등이다**: Activity 재생성(회전·앱 언어 변경·글꼴 크기)마다 다시 불리므로 `if (::walk.isInitialized) return`(리뷰 M-2 — 아니면 서비스는 옛 모델에 fix를 붓고 화면은 빈 모델을 그린다). `attach`가 하는 일: `walk` 생성, `GuideTonePlayer.preload()`(SoundPool 15개 로드 시작 — 첫 세션 시작 톤이 로드 창에 걸리지 않게, 리뷰 M-7), `GuideSpeaker` 싱글턴 생성(TTS 초기화는 세션 시작에). 서비스·스트림·알림은 `GuideSession.walk`를 **매 호출 시점에 조회**하고 인스턴스를 붙들지 않는다.
- `startWalk`: ① `AppConfig.experimentalGuidanceEnabled`가 거짓이면 **아무것도 하지 않는다**(정식 빌드 진입점 0의 구조 층 — 버튼 미노출이 1선, 이것이 2선) ② `isActive`면 거부 통지 `guide.alreadyActive`(`announceNow`, 억제 우회) ③ `walk.requestStart(request)`. 소스 가드가 `startWalk(` 호출부를 **`WalkGuideStartButton.kt` 한 곳**으로 잠근다(iOS `guidance-gate-drift` 정신, §10-1).
- `WalkStartRequest(dest: BeaconDest, label: String, accessible: Boolean, variant: WalkRouteVariant?, shortestAvailable: Boolean, waypoint: GuideWaypoint?)` — **기본값 없음**(A4·A13). `GuideWaypoint(dest: BeaconDest, label: String)`.

### 3-2. `WalkGuideModel.requestStart → start` (iOS `begin`/`start` 순서 그대로)

1. `starting` 재진입 가드, `lastStartRequest` 저장(시작 실패 뒤 복구 재시작용 — 정밀 위치 허용 후 `restart()`).
2. **권한 게이트**(`GuidePermissions`, §3-4): 기기 위치 서비스 꺼짐 → `fail(unavailable, "beacon.weak")`. 위치 권한 `None` → `AppConfig.permissionGate.request()`(M2 손) → 재판정. `None` → `fail(denied, "beacon.denied", resolution = settings)`. `Coarse` → `fail(unavailable, "beacon.reduced", resolution = precise)`(iOS reducedAccuracy 대응 — 해결 버튼은 M3 `allowPrecise`와 같은 재요청). `Fine` → 진행.
3. `POST_NOTIFICATIONS`(API 33+) 미허가면 요청 1회. 거부는 **차단이 아니다** — 서비스는 알림 없이도 돈다(시스템이 "앱이 백그라운드에서 실행 중" 표식으로 대신한다). `ACTIVITY_RECOGNITION` 미허가면 요청 1회. 거부 → 걸음 요약 없음(3-state 부재).
4. `sessionToken = coordinator.claim { stop() }` — null이면 거부 통지(권한 대기 중 뒤집힌 경합의 최종 게이트). **토큰은 보관하고 `stop()`이 반납한다**(리뷰 M-1 — 반납이 없으면 첫 종료 뒤 모든 재시작이 영구 거부된다).
5. 상태 초기화(iOS `start` 대입 목록 그대로: `deferredAnnouncer.advanceGeneration()`, `dest`·`arrivalDest = null`·`endKind`·`resetArrivalHealth`·`arrivalSessionToken`·`liveHealthSample = null`·`sessionStartedAt`·`outputSuppressed = false`·`destinationLabel`·`beaconState/gateState/toneState/motionState = initial`·`lastFixAt = null`·`lastStaleNoticeAt = null`·`startedAt = uptimeNow`·세션 진행 앵커·`status = tracking`·`statusText = ""`·`failResolution = none`·`silencedHapticFired = false`).
6. `StepCounter.start(token)`(허가 시): `TYPE_STEP_COUNTER`는 **부팅 이후 누적**이라 기준값은 **세션 첫 이벤트의 값**이고(그 앞 걸음은 유실 — iOS "첫 라이브 콜백 전 중지는 요약 없음" 수용과 같은 성질), 라이브 표본 = `현재 − 기준값`, 거리는 **항상 null**(안드로이드에 만보계 거리가 없다) → `WalkHealth.effectiveDistanceMeters`가 보폭 0.7m로 환산해 `isMeaningfulWalk` 임계 50m ≈ **72걸음**이다(리뷰 m-4). 센서 콜백은 메인 Handler.
7. `GuideDiag.log("session kind=walk")`.
8. **wake lock 획득**(`PowerManager.PARTIAL_WAKE_LOCK`, 태그 `gildongmu:guide`, 시한 없음 — 해제는 `stop()`; §4-1).
9. **전경 서비스 시작**: `GuideForegroundController.start(request)` — 실구현은 `Context.startForegroundService(Intent(ACTION_START))`(플랫폼 API 26+). ⚠ **시작 실패는 호출부에서 잡히지 않는다**(리뷰 B-3): `ForegroundServiceStartNotAllowedException`(백그라운드 시작)·`SecurityException`(Android 14+ 위치 권한 미보유)은 서비스 안 `startForeground()` 호출 지점에서 던져진다. 그래서 서비스가 잡아 **`onServiceStartFailed(reason)`**을 메인으로 되부르고(§4-1), 모델은 `fail(unavailable, "android.guide.serviceStartFailed")`로 접는다(위치 문제와 문장을 가른다 — 3-state). 컨트롤러 인터페이스는 실패 콜백을 **필수 인자**로 받아 누락이 컴파일에서 막힌다.
10. `tones.beginSession()` → `playTone(start)`(SoundPool이 아직 로드 중이면 **시작 톤 1개만 보류**해 로드 완료 콜백에서 재생 — 리뷰 M-7) → `soundDegraded`(미디어 볼륨 0) 판정 1회 통지.
11. `watchdog.start()`(2초), `awaitingRoute = true`, `routeFetchToken += 1`, `startFixWaitWatch(15초)`.
12. `speaker.prepare()`(TTS 초기화 — 세션 시작 문장이 초기화보다 먼저 오면 **보류 1문장**으로 들고 있다가 초기화 완료 시 발화; 초기화 실패는 `ttsUnavailable` 행 + `ResultHaptic.failure` 1회).

### 3-3. 종료 경로 (전부 `stop()` 경유, iOS 목록 동형)

| 경로 | 톤 | 종료 화면 | 사유 |
|---|---|---|---|
| 시트 "안내 종료"·알림 "안내 종료" 액션 | `stop` 톤 | 도보 세션 ∧ `WalkHealth.isMeaningfulWalk(라이브 누적)` **동기 판정** → `.stopped` 화면(`android.beacon.stopped` 문장 — iOS `ios.beacon.stopped`와 같은 문안, 리뷰 N-5) | `stopByUser` |
| 확정 도착(최종 접근 `distance ≤ 15m`) | `nearby` | `.arrived` | `handleFinalApproach` |
| 추정 도착(`presumedArrivalStep`) | `nearby` **전경에서만** | `.presumed` | `maybePresumeArrival` |
| 잊힌 세션(`sessionIdleStep`) | `stop` 전경에서만 | `stopLeavingSummary` 동기 판정(`guide.endedIdle`) | 워치독 |
| 위치 제공자 꺼짐(`onProviderDisabled`) | 없음 | `stopLeavingSummary` 동기 판정(`beacon.weak`) + 실패 상태 잔존(첫 행과 같은 조건 — 리뷰 m-9) | `stopAndFail` |
| 서비스 시작 실패 | 없음 | 없음(세션이 시작되지 않았다) | `fail(unavailable, serviceStartFailed)` |
| 앱 프로세스 종료 | — | — | 서비스도 함께 죽고 알림은 시스템이 지운다 |

- `stop()` 정리 목록(iOS 그대로 + 안드로이드 추가), **순서가 계약**: ① `pendingStepFreeNotice = null` ② `deferredAnnouncer.advanceGeneration()` ③ `resetFinalApproach(null)` ④ **`sessionToken?.let { coordinator.release(it) }; sessionToken = null`** ⑤ `startJob` 취소·`starting = false` ⑥ 워치독 정지 ⑦ **서비스 정지**(`controller.stop()` → `stopForeground(STOP_FOREGROUND_REMOVE)` → `stopSelf`) + 스트림 닫기 ⑧ `StepCounter.stop()`(값은 남긴다 — 종료 처리가 뒤에 읽는다) ⑨ **wake lock 해제** ⑩ `if (playStopTone && status == tracking) playTone(stop)` ⑪ `tones.endSession()`(정지 톤 뒤 — 잔여 재생 + 0.15초만큼 포커스 반납을 미룬다, §5-2) ⑫ `status = idle`·`statusText = ""`·`failResolution`·`soundDegraded`·`outputSuppressed = false`(소유자 집합은 유지, §5-5)·리듀서 상태 넷 초기화·`dest = null`·경로·토큰·`awaitingRoute`·`mode = brief`·하단 2행·`offRoute`·`pendingRecovery`·`lastFixCoord/At`·`isRerouting`·`carriedCourseDerivation`·`waypoint`·`rerouteToken += 1`·`routeFetchToken += 1`·`clearProposal()`·`proposalFetchCount = 0`.
- 권한 회수는 안드로이드에서 **프로세스 재시작**이다(M2 판정) — iOS `handle(authorization:)` 경로는 없다. 재시작 뒤 `GuideSession`은 빈 상태이고 서비스는 `START_NOT_STICKY`라 되살아나지 않는다.
- `teardown()`·`tones.shutdown()`은 **두지 않는다**(리뷰 m-11) — 세션·재생기가 프로세스 수명이라 화면 이탈 정리가 없다. `GuideAudioFocus.releaseNow()`는 테스트 전용.
- 종료 화면 30분 만료: `endedAt = uptimeNow`(elapsedRealtime — 잠자기 중에도 흐른다, `EndScreen.kt` KDoc 요구 충족). 백그라운드를 거쳐 전경으로 돌아올 때(`setForeground(true)`, 직전에 `wasBackgrounded`) `isEndScreenStale`이면 `clearArrival()`.

### 3-4. 권한·매니페스트 (D11)

| 권한 | 선언 | 요청 시점 | 거부 시 |
|---|---|---|---|
| `ACCESS_FINE_LOCATION`·`COARSE` | 기존 | 시작 버튼(M2 손 재사용) | 시작 실패 문장 + 해결 버튼(설정 열기 / 정확한 위치 허용) |
| `FOREGROUND_SERVICE`·`FOREGROUND_SERVICE_LOCATION` | **추가**(설치 시 자동) | — | — |
| `POST_NOTIFICATIONS` | **추가** | 시작 버튼(33+) | 알림 없이 진행 |
| `VIBRATE` | **추가**(자동) | — | — |
| `WAKE_LOCK` | **추가**(자동, 프롬프트 목록 밖 — §12-2) | — | — |
| `ACTIVITY_RECOGNITION` | **추가**(프롬프트 목록 밖 — §12-2) | 시작 버튼 | 걸음 요약 없음 |
| `ACCESS_BACKGROUND_LOCATION` | **0**(소스 가드 기존 `AppSourceGuardTest`) | — | — |

- 서비스 선언: `<service android:name=".guide.GuideForegroundService" android:foregroundServiceType="location" android:exported="false" />`. `MainActivity`의 `launchMode`는 건드리지 않는다(§4-3이 Intent 플래그로 같은 효과를 낸다).
- 런타임 권한 요청 손: `GuidePermissions`(guide/)가 `AndroidPermissionGate`와 같은 attach/deliver 모양으로 **자기 `rememberLauncherForActivityResult`를 `GuideBottomBar` 컴포지션에 둔다**(`MainActivity`는 android-m1 소유라 건드리지 않는다). 위치 권한만 M2 손(`AppConfig.permissionGate`)을 그대로 쓴다.
- ⚠ **`ACTIVITY_RECOGNITION`·`WAKE_LOCK` 추가는 착수 프롬프트의 additive 목록에 없던 항목**이다(§12-2에서 판정·보고). 전자의 근거: iOS 정식판 종료 화면의 걸음·칼로리 요약(위원장 요청 2026-08-18 음식 비유 포함)이 D3 기능 등가에 들고, 안드로이드 걸음 수는 `TYPE_STEP_COUNTER` + 이 권한(API 29+)이 유일한 경로다. 후자의 근거는 §4-1(워치독 각성).

---

## 4. 전경 서비스·위치 스트림·알림 (D11)

### 4-1. `GuideForegroundService` + wake lock

- `Service`(플랫폼, 라이브러리 0). `onStartCommand`: `ACTION_START` → **`try { startForeground(NOTIFICATION_ID, notification, FOREGROUND_SERVICE_TYPE_LOCATION) } catch (e: Exception) { GuideDiag.log("service start failed=${e::class.simpleName}"); stopSelf(); main.post { GuideSession.walk.onServiceStartFailed(e) }; return START_NOT_STICKY }`**(리뷰 B-3 — 잡지 못한 채 5초가 지나면 `ForegroundServiceDidNotStartInTimeException`으로 보행 중 프로세스가 죽고, 잡아도 호출부로는 전파되지 않는다) → `stream.open(onFix = { GuideSession.walk.handleFix(it) }, onProviderDisabled = { GuideSession.walk.handleProviderDisabled() })`(모델은 **매 호출 조회**, 리뷰 M-2). `ACTION_STOP`(알림 액션) → `GuideSession.walk.stopByUser()`(메인). 반환 `START_NOT_STICKY`. `onDestroy` → 스트림 닫기. `onTaskRemoved`(최근 앱에서 스와이프) → **세션 유지**(iOS 백그라운드 계약과 같다 — 사용자가 명시로 끄기 전엔 산다). 이후 알림 탭이 `MainActivity`를 띄우면 `GuideSession`(프로세스 싱글턴)이 그대로라 띠바·시트가 복원된다.
- 시작은 **전경에서만**(`Context.startForegroundService`) — 버튼 활성화가 곧 전경이다. Android 14+에서 위치 타입 FGS는 `ACCESS_FINE_LOCATION` **런타임 허가가 선행**되어야 `startForeground`가 `SecurityException`을 내지 않는다 — §3-2 ②가 ⑨보다 앞선다.
- **wake lock(리뷰 B-1)**: 전경 서비스는 스스로 CPU를 깨우지 않는다. 화면이 꺼진 채 fix가 끊기면(지하·터널) CPU를 깨울 것이 없어 기기가 깊은 절전에 들고, `Handler.postDelayed`의 시간축(`uptimeMillis`)이 멈춰 2초 워치독이 돌지 않는다 → 8초 `unreliable` 톤·15초 "신호 약함"·도착 추정·잊힌 세션 안전망이 **한꺼번에 멎어** "마지막 정상 톤 이후 영구 침묵"(INTEGRATIONS가 워치독을 만든 이유)이 안드로이드에서 재현된다 — **fix 두절이 곧 감시 중단**이라 두 축이 독립이 아니다. 그래서 세션 수명에 `PowerManager.PARTIAL_WAKE_LOCK`을 묶는다(`location` 전경 서비스의 표준 관행): `start` ⑧에서 획득, `stop()` ⑨에서 해제(어느 종료 경로든 `stop()`을 지나므로 누수 경로가 없다). `AlarmManager.setExactAndAllowWhileIdle`은 Doze 창 제약으로 8초 임계에 못 미쳐 기각. 배터리 대가는 세션 시간에 비례하고 세션은 A23 안전망(600초·1200초)이 닫는다. 워치독은 매 tick의 실제 간격을 `GuideDiag`에 남긴다(`watchdog dt=` — 2초를 크게 넘는 tick이 곧 절전 침입의 증거, §11-1b).
- ⚠ **D11 실측 항목(§11-1·1b)**: 전경에서 시작한 `location` 타입 FGS가 화면 꺼짐·다른 앱 전경에서 fix를 계속 받는가(Android 12+ while-in-use 규칙 — 문서 근거는 있으나 한소네 7(Android 15)에서 실측으로 닫는다) **그리고 fix가 끊겼을 때 워치독이 8초 안에 `unreliable`를 내는가**(후자가 D11의 진짜 위험). 실패하면 세션은 워치독의 `unreliable` 톤 + 15초 "신호 약함"으로 **정직하게** 드러난다(침묵 실패 없음).

### 4-2. `GuideLocationStream`

```kotlin
data class GuideFixPayload(
    val lat: Double, val lng: Double,
    val accuracy: Double,          // hasAccuracy() 거짓 → -1.0 (:kit `> 0` 가드)
    val speed: Double?,            // hasSpeed() 거짓 → null  (motionStep 계약, 0.0 금지)
    val speedAccuracy: Double?,    // hasSpeedAccuracy() 거짓 → null
    val course: Double,            // hasBearing() 거짓 → -1.0 (courseStep 계약, 0.0 금지)
    val courseAccuracy: Double,    // hasBearingAccuracy() 거짓 → -1.0
    val elapsedRealtimeMs: Long,   // location.elapsedRealtimeNanos / 1_000_000 — 나이의 기준(정수 나눗셈, AndroidLocationSource와 같은 표기)
)
```

- 요청: `LocationRequest.Builder(1_000L).setQuality(QUALITY_HIGH_ACCURACY).setMinUpdateDistanceMeters(0f)`(거리 필터 끔 — 데드밴드가 이미 필터, iOS `distanceFilter = none` 동형). `mainExecutor`. provider: `FUSED` → 없으면 **`GPS` 단독**(리뷰 m-7 — 안내 경로의 수용 술어 `isUsableFix`는 정확도 상한이 없고 조이는 것이 금지라, NETWORK의 1,500m fix가 그대로 추세·거리에 실린다. M2 단발 취득의 NETWORK 병행은 `shouldAcceptFix` 30m 게이트가 있어 무사한 것이고 여기엔 그 게이트가 없다).
- 나이 `age = (elapsedRealtime() - fix.elapsedRealtimeMs) / 1000.0`. 캐시 fix(첫 콜백)는 iOS와 같이 나이로 걸러진다(`isUsableFix` 5초·상세 10초).
- `onProviderDisabled(FUSED|GPS)` → `walk.handleProviderDisabled()` → `stopAndFail(unavailable, "beacon.weak")`. `onProviderEnabled`는 무시(세션은 이미 끝났다).
- 두 스트림(안내·`LocationStore` 단발)이 같은 `LocationManager`에 독립 리스너로 공존한다 — 끄는 쪽이 서로를 죽이지 않는다(iOS `isOneShotActive` 소유권 판별이 **불필요**). `LocationStore.currentCoordinate`는 안내 중에도 자기 게이트로 답한다 — iOS의 "추적 중엔 스트림 최신 fix로 답한다" 특례는 두지 않는다(재조회 origin은 §6-2가 모델 최신 fix를 직접 쓴다).

### 4-3. 알림 (`GuideNotification`)

- 채널 `guide`(`IMPORTANCE_LOW` — 소리·진동 없음, 이름 `android.guide.notificationChannel`), 플랫폼 `Notification.Builder(context, channel)`(androidx 없음 — `setSilent`는 `NotificationCompat` 전용이라 쓰지 않는다, 리뷰 m-3): `setOngoing(true)`·`setOnlyAlertOnce(true)`·`setCategory(CATEGORY_NAVIGATION)`·`setSmallIcon(R.drawable.ic_launcher_foreground)`.
- 제목 = `joinText(beacon.walkHeading, destinationLabel)`(시트 제목과 같은 문장). 본문 = **상태 한 줄** = `statusText`가 비어 있지 않으면 그것, 비면 띠바 요약(`guide.band.remaining`/`starting`) — 시트 상태 행·띠바와 같은 조립기(`bandSummaryText`)를 지난다. 본문이 바뀔 때만 `notify`(매 fix 갱신 금지 — 띠바 거리 10m 양자화가 그 빈도를 정한다).
- 액션 "안내 종료"(`beacon.stop`) → `PendingIntent.getService(ACTION_STOP)`. 알림 액션의 서비스 시작은 백그라운드 시작 제한을 받지만 우리 서비스는 **이미 전경으로 떠 있고** 알림 상호작용이 임시 허용 창을 준다(리뷰 m-15 "확인 필요" — §11-8이 실측). 다른 앱을 쓰는 중에 알림에서 종료하면 `isSpeechAllowed`가 거짓이라 종료 문장은 나가지 않고 **정지 톤만** 난다(의도 — §7-6).
- 본문 탭 → `PendingIntent.getActivity(Intent(context, MainActivity::class.java).addFlags(FLAG_ACTIVITY_NEW_TASK or FLAG_ACTIVITY_SINGLE_TOP))` — 매니페스트 `launchMode` 변경 없이 기존 인스턴스를 앞으로 가져온다(리뷰 M-5). **탭은 앱을 전경으로만 가져오고 시트를 펼치지 않는다**(§12-6): 펼침 신호를 `MainActivity`가 받아 넘길 자리(`onNewIntent`)가 android-m1 소유라 없고, `Activity.intent`는 `SINGLE_TOP` 재전달에서 갱신되지 않는다. 돌아온 화면엔 띠바가 있어 "안내 시트 펼치기" 한 번이 더 든다(iOS에도 없던 경로라 등가 손실이 없다).
- 종료 화면 상태(추적 끝, `arrivalDest != null`)에는 알림이 **없다** — 서비스가 `stop()`에서 내려갔다. 종료 사실은 띠바(`guide.band.arrived`/`ended`)가 든다.
- 프로세스가 시스템에 의해 죽으면 FGS 알림은 시스템이 지운다. 앱 재시작 시 `GuideSession`은 빈 상태라 유령 시트도 없다.

---

## 5. 오디오 (D10 재설계)

### 5-1. 톤 재생기 `GuideTonePlayer` (`SoundPool`)

- **AudioAttributes(코디네이터 전달 2026-09-16, android-m6 설계 리뷰 출처)**: 오픈소스 TalkBack은 `USAGE_ASSISTANCE_NAVIGATION_GUIDANCE`·`USAGE_ASSISTANT`·`USAGE_ALARM` 재생이 시작되면 진행 중인 자기 발화를 **전부 끊는다**(VoiceActionMonitor/AudioPlaybackMonitor). 안내 톤을 그 usage로 내면 2초마다 TalkBack 낭독이 잘린다. 그래서 톤은 **`USAGE_ASSISTANCE_SONIFICATION` + `CONTENT_TYPE_SONIFICATION`**(TalkBack 끊김과 무관, `STREAM_MUSIC`으로 매핑되어 미디어 볼륨 0 판정과 정합). 발화는 §5-3.
- `SoundPool.Builder().setMaxStreams(2).setAudioAttributes(위)`. 15개 `res/raw`는 **`GuideSession.attach`(앱 첫 컴포지션)에서 로드 시작**(`load` 비동기, 백그라운드 디코딩 — 버튼을 누를 무렵엔 끝나 있다, 리뷰 M-7). 그래도 로드 전 재생 요청이 오면: **시작 톤(`start`)만 보류 1개**로 들고 `setOnLoadCompleteListener`에서 재생(그 밖의 톤은 버린다 — 1초 미만 창의 추세 톤은 다음 fix가 대신한다).
- **리소스 이름 규칙(리뷰 m-13)**: 웹 파일 `public/sounds/guide/<이름>.mp3`(접두 없음: `left-pitch.mp3`) ↔ iOS `guide-<이름>.mp3` ↔ 안드로이드 `res/raw/guide_<이름 with - → _>.mp3`(`guide_left_pitch.mp3`). `BeaconTone.resourceName(scheme)`(`guide-left-pitch`)의 `-` → `_`가 안드로이드 이름이고, 웹 경로는 거기서 `guide_` 접두를 떼고 `_` → `-`다. 표는 `toneResource(tone, scheme): Int`(exhaustive `when` → `R.raw.guide_*`). 소스 가드가 ① `res/raw` 파일 이름 집합 == 13톤 × scheme의 변환 집합(15개) ② 각 파일 바이트 == 대응 웹 파일(위 두 단계 역변환)을 단언한다.
- **길이 정본은 상수 표 `ToneDurations`**(리뷰 m-1 — 런타임 측정은 두지 않는다. mp3 메타데이터 길이는 근사라 발화가 톤 꼬리와 겹칠 수 있다): closer 0.20 · farther 0.20 · nearby 2.20 · tick 0.48 · start 1.30 · stop 1.30 · ahead 0.68 · crosswalk 1.09 · left/right(pan·pitch) 0.40 · back 0.90 · warning 0.80 · unreliable 0.42(초, ffprobe 2026-09-16). `toneEndsAt = uptimeNow + ToneDurations[tone]`. 드리프트 가드(§10-1 ⑤'): JVM 테스트가 `res/raw` mp3의 **프레임 헤더를 세어**(MPEG-1/2 Layer III, Xing/Info 헤더 프레임 수 우선) 길이를 계산하고 표와 ±0.05초로 대조한다 — 소리 파일을 갈면 표가 빨개진다(iOS 햅틱 타이밍 주석 "소리 파일을 갈면 재분석"의 자동화판). `speechDeferThresholdSeconds` 0.6 선이 표를 정확히 가른다(`speechDeferMaxSeconds` 3.0 ≥ 2.2 + 0.15).
- **게인**(iOS `gains` 미러): closer/farther 0.35 · nearby 1 · tick 0.3 · start/stop/ahead/crosswalk/left/right/back 0.8 · warning 1 · unreliable 0.45.
- **선점**: 새 재생은 진행 중 스트림을 `stop`하고 교체(iOS `playing.stop()`).
- `play(tone)`: ① `toneEndsAt = null`(진입 즉시 — 조기 반환 경로 공통) ② `isSuppressed`면 return ③ **`if (!focus.acquire()) { GuideDiag.log("tone skipped focus"); return }`**(리뷰 M-10 — 포커스는 협약이라 잃어도 소리가 나므로 앱이 스스로 멈춘다) ④ 진동(§5-4) ⑤ `soundPool.play(...)` 반환 0이면 `isSilenced = true`, 아니면 `isSilenced = false`·`toneEndsAt` 대입·`focus.releaseAfter(duration + 0.15)`.
- **무음 진입 1회(리뷰 m-8, iOS `playTone` 동형)**: 모델의 `playTone` 창구가 재생 뒤 `tones.isSilenced`를 보고, 진입 에지에서만 `ResultHaptic.failure` + 문장 `android.beacon.soundUnavailable`(`silencedHapticFired` 래치, 무음이 풀리면 되돌린다). 시트 행은 상시.
- **`soundDegraded` 판정 축**: iOS "잠금·백그라운드에서 소리가 나는가"는 안드로이드에서 성립하지 않는다(FGS가 살아 있는 한 `SoundPool`은 화면 상태와 무관하게 난다). 남는 무음 원인은 **미디어 볼륨 0**이라 `audioManager.getStreamVolume(STREAM_MUSIC) == 0`을 세션 시작과 매 재생에 판정, 참이면 `soundDegraded = true` + 문장 `android.guide.mediaVolumeZero` 1회(`ResultHaptic.attention`) + 시트 행 상시. DND는 미디어 스트림을 막지 않는다(수용). `isBackgroundAudible` 개념은 두지 않는다.

### 5-2. `GuideAudioFocus` — 목표 계약 5항의 AudioFocus 판

iOS 오디오 세션 모델(카테고리 승격·원복·`didPromote`·소유권 이전·route 변경)은 안드로이드에 **해당 문제가 없다**. 안드로이드는 "소리를 내는 동안만 포커스를 쥐고, **못 쥐면 내지 않는다**"는 모델로 같은 목표를 달성한다. ⚠ 안드로이드 포커스는 **협약**이다 — `SoundPool.play`·`TextToSpeech.speak`는 포커스 없이도 소리를 내므로 "상실 중엔 내지 않는다"는 규칙이 앱 쪽에 있어야 iOS 계약 2(인터럽션)가 성립한다(리뷰 M-10).

```kotlin
class GuideAudioFocus(audioManager, main: Handler) {
    private var held = false
    fun acquire(): Boolean          // held면 true. 아니면 requestAudioFocus(GAIN_TRANSIENT_MAY_DUCK, 톤 attributes)
                                    // → GRANTED면 held = true·예약 반납 취소·true / FAILED·DELAYED면 held = false·false
    fun releaseAfter(seconds)       // 예약 반납(main.postDelayed). 새 acquire가 예약을 취소한다
    fun endSession(remaining)       // = releaseAfter(remaining + 0.15) — 잔여 재생 뒤 반납(iOS endSession 여유 0.15 포함)
    fun releaseNow()                // 테스트 전용
    onAudioFocusChange: LOSS·LOSS_TRANSIENT·LOSS_TRANSIENT_CAN_DUCK → held = false (다음 acquire가 재요청) / GAIN → 무시
}
```

| 목표 계약(kit-guide 보고) | AudioFocus 판 | 달성 |
|---|---|---|
| 1. 받아쓰기·TTS 점유 중 억제 | 억제는 오디오 층이 아니라 **모델 창구**(`outputSuppressed`, §5-5)가 막는다. 포커스는 무관 | ✔ |
| 2. 인터럽션 시작/종료 재조정("`.ended` 유실 대비") | `onAudioFocusChange(LOSS*)` → `held = false`. **다음 `play`/`speak`가 `acquire`로 재요청하고, 거절되면 내지 않는다**(통화 중 무음 — §12-7). GAIN 콜백에 의존하지 않는다(유실돼도 다음 재생이 되살린다) | ✔ |
| 3. route 변경: 메아리만 거르고 남의 탈취는 회복 | `SoundPool`은 플레이어가 route에 결박되지 않아 재생성이 없다. `ACTION_AUDIO_BECOMING_NOISY`는 2.2초 이하 큐라 **무시**(문서화). 채팅 TTS(M6)·음악 앱의 포커스 요청은 우리 LOSS*로 와 계약 2와 같은 경로 | ✔(해당 없음 + 2로 흡수) |
| 4. 원복은 우리가 승격했을 때만(`didPromote`) | `abandonAudioFocusRequest`는 **자기 `AudioFocusRequest` 핸들**에만 작용한다 — 구조적으로 남을 건드릴 수 없다 | ✔(구조) |
| 5. 소리 직후 종료가 소리를 자른다 → 잔여만큼 대기, 새 세션 시작은 미뤄진 원복 취소 | `releaseAfter(duration + 0.15)` 예약, `acquire`가 예약 취소, `endSession(remaining)`은 잔여 + 0.15 뒤 반납 | ✔ |

`GuideAudioSessionTests` 시나리오 18개 + 안드로이드 추가 1개의 판(리듀서 대신 `GuideAudioFocus` 단위 테스트 — 페이크 `AudioManager` 인터페이스로 JVM):

| # | iOS 시나리오 | 안드로이드 판 |
|---|---|---|
| 1 | 세션 시작은 .playback으로 승격 | `beginSession()`은 포커스를 잡지 않는다 — 첫 `play`의 `acquire`가 잡는다. 단언: `beginSession` 뒤 `held == false`, 첫 `play` 뒤 `held == true` |
| 2 | suppression 중 시작은 의도만 저장 | 억제 중 `play`는 no-op이라 `acquire`도 없다. 단언: 억제 중 `play` → 요청 0회 |
| 3 | suppression 해제 시 저장 의도 재적용 | 해제 뒤 첫 `play`가 `acquire`. 단언: 해제 후 `play` → 요청 1회 |
| 4 | 승격하지 않았으면 종료 시 원복 없음 | `endSession()`은 `held == false`면 `abandon` 0회 |
| 5 | 시작한 적 없는 종료는 세션 불변 | 동일(요청 0·반납 0) |
| 6 | 승격했으면 종료 시 .ambient 원복 | `held`면 `endSession(r)` → r + 0.15 뒤 `abandon` 1회 |
| 7 | 인터럽션 종료가 suppression 중 도착해도 해제 시 복구 | LOSS 뒤 억제 해제 뒤 `play` → `acquire` 재요청 1회 |
| 8 | route 변경은 플레이어 재생성 | 해당 없음(계약 3) — 문서만 |
| 9 | 세션 밖 인터럽션·route·탈취는 공유 세션 불변 | `held == false`에서 LOSS 콜백 → 상태 변화 0·반납 0 |
| 10 | 세션 밖 단발 재생은 .ambient 확보 | 세션 밖 `play`도 `acquire` → `releaseAfter`(같은 경로, 승격 구분 없음) |
| 11 | 억제 중 route 변경은 점유자 세션 불변 | 해당 없음 |
| 12 | 종료가 억제 중 도착하면 원복 자격 유지 | 억제 중 `endSession()`: `held`면 예약 반납은 그대로 진행(소리를 내지 않는 중이라 잘림 없음) — 단언: 반납 1회 |
| 13 | 이미 .playback인 세션의 인터럽션 종료도 재적용 | GAIN 콜백은 무시, 다음 `play`가 재요청 — 단언: LOSS 뒤 GAIN 뒤 `play` → 요청 1회 |
| 14 | 인터럽션 시작은 활성만 내리고 다음 확보가 재적용 | 계약 2 그대로 |
| 15 | 원복 자격은 마지막 적용 카테고리에서 유도(전수 열) | `held`는 `acquire` 성공/`abandon`/LOSS 세 전이만 — 상태 머신 3전이 단언 |
| 16 | 소유권 이전은 자격만 반납 | 재생기 인스턴스가 하나(M5도 같은 `GuideAudioFocus`를 공유) — 이전 개념 없음. 단언: 예약 반납 중 새 `acquire`가 예약을 취소하고 `held` 유지 |
| 17 | route 변경 사유 매핑 | 해당 없음 |
| 18 | 카테고리 탈취는 소유 중에만 재적용, 재생성 없음 | 계약 2·3으로 흡수 |
| **19** | (안드로이드 추가) 요청 거절 | `requestAudioFocus`가 `FAILED`(통화 중) → `acquire` false·`held` false·**`play`가 `soundPool.play`를 부르지 않는다**·`toneEndsAt == null`. 통화가 끝난 뒤 다음 `play` → 재요청 → GRANTED → 재생 |

### 5-3. 발화 `GuideSpeaker` (`TextToSpeech`)

- **채널 판정**: 안내 문장은 앱 자체 TTS **한 채널**로 발화한다(착수 프롬프트 지정). 근거: 안드로이드 접근성 통지(`announceForAccessibility`, API 34 deprecated / Compose live region)는 화면이 살아 있는 동안만 동작하고 한소네 자체 리더가 TalkBack이 아닐 수 있다 — 스크린 리더 유무·전경 여부와 무관한 채널이 필요하다. 대가 둘: ① TalkBack 낭독과 겹칠 수 있다(§11-4 실측) ② **점자 디스플레이에 문장이 오지 않는다** — 점자는 접근성 포커스가 놓인 요소만 표시하므로 시트 상태 행에 커서가 없는 한(걷는 중엔 시트를 훑지 않는 것이 정상) 안내 문장이 점자로 닿지 않는다(리뷰 M-8, D7 점자 축). 소리가 정본이라 기능이 죽진 않지만 §11-16이 이 축을 독립으로 실측하고, 그 결과가 §12-5 대안의 발동 조건이다.
- 따라서 **안내 시트에는 live region이 없다**(M1 `StatusLine` 관용구의 예외 — 같은 문장을 TTS와 TalkBack이 둘 다 읽는 이중 낭독 차단). 사용자 활성화의 직접 응답도 같은 채널(`announceNow`).
- **AudioAttributes**: `USAGE_MEDIA` + `CONTENT_TYPE_SPEECH`(코디네이터 전달 — `NAVIGATION_GUIDANCE`는 TalkBack 발화를 끊는다. 대안 `USAGE_ASSISTANCE_ACCESSIBILITY`(접근성 볼륨을 따르게)는 §11-4 실측 뒤 판정).
- `TextToSpeech(context, initListener)` — 앱 수명 싱글턴(재생성 비용·초기화 지연), 세션 시작에 `prepare()`. 초기화 완료 전 문장은 **최신 1개 보류**(latest-wins). `setLanguage(Locale.forLanguageTag(AppLocale.current))` — `LANG_MISSING_DATA`·`LANG_NOT_SUPPORTED`면 `ttsUnavailable = true`(시트 행 `android.guide.ttsUnavailable` 상시 + `ResultHaptic.failure` 1회 + 상태 행은 계속 갱신).
- `speak(text)`: ① `if (!focus.acquire()) { GuideDiag.log("speech skipped focus"); return false }`(리뷰 M-10) ② `utteranceId = ++seq` ③ `speak(text, QUEUE_FLUSH, params(위 attributes + `KEY_PARAM_UTTERANCE_ID`))` — **latest-wins**(임박 명령이 전문 뒤에 줄 서지 않는다). `onDone/onError/onStop(id)`(메인 반입)에서 **`id == 최신 seq`일 때만** `focus.releaseAfter(0.15)`(리뷰 m-2 — 플러시된 옛 발화의 `onStop`이 새 발화 도중 포커스를 반납하지 않게). 문장은 `spokenDistanceUnits(text, android.unit.spokenMeters)`를 지난다(iOS `spokenUnits` 동형 — TTS가 `m`을 어떻게 읽는지 §11-5 실측 뒤 정정 유지/제거).
- **배율**: `ListenSpeed.normalizeSpeed(저장값)`이 1.0이면 `setSpeechRate`를 **부르지 않는다** — 엔진이 시스템 TTS 기본 속도(설정 > 접근성 > 텍스트 음성 변환 > 말하기 속도)를 쓴다. 스크린 리더 사용자는 그 값을 이미 빠르게 맞춰 두므로 앱 고정값 1.0이 오히려 느리다. 1.5·2.0이면 `setSpeechRate(배율)`. **초기 표: 1.0 → 호출 없음(시스템 기본), 1.5 → 1.5f, 2.0 → 2.0f** — §11-6 실측으로 확정.
- `highPriority`: 안드로이드 TTS엔 우선순위 축이 없다 — 모든 문장이 flush(latest-wins)라 iOS `.high`의 목적(착지 낭독에 잠식되지 않음)은 채널 분리로 이미 달성된다. 인자는 호출부 의도 기록용으로 유지(계측 로그에 남긴다).
- **전경 게이트(iOS `isForeground`)의 안드로이드 판정(§12-3)**: `post()`는 억제 가드 → `GuideSession.isSpeechAllowed()` 순으로 판정하고 거짓이면 `missedAnnouncement = true`로 떨어뜨린다. `isSpeechAllowed = 앱 전경(Activity STARTED) ∨ 화면 꺼짐(!powerManager.isInteractive)`. 즉 **다른 앱이 전경**일 때만 음성을 막고(그 사용자는 그 앱을 스크린 리더로 읽는 중이라 우리 TTS가 겹친다 — iOS 규칙의 근거 그대로), **화면이 꺼진 채 걷는 주 사용 상황에서는 음성이 난다**(iOS는 VO 통지가 백그라운드에서 게시되지 않아 막았다 — 그 플랫폼 제약이 안드로이드엔 없다). 실측 §11-3.
- **전경 복귀 상환(리뷰 M-6 — iOS 불변식 그대로)**: `setForeground(true)`(백그라운드 경유 시)에서 ① 종료 화면 30분 만료 소거 ② **상환 블록은 `isTracking` 판정보다 앞이다** — 다른 앱 전경 중에 확정·추정 도착·잊힌 세션 종료가 나면 세션이 끝난 채 `missedAnnouncement`만 남는데, 가드 뒤에 두면 돌아온 사용자가 아무 말도 듣지 못한 채 종료 화면만 만난다. 합본 규칙: `owed = [pendingStepFreeNotice, pendingFinalApproachIntro, tail]`(`tail` = `statusText`가 비면 `currentGuidanceText`, `intro`와 같으면 생략), 장부를 먼저 지우고 `announce(owed) { onDropped: 장부 복원 }`. ③ 그 뒤 `isTracking` 가드(안드로이드는 앵커 리셋이 없어 가드 뒤에 남는 일이 없다 — §6-3).
- 전경 판정 입력: `GuideBottomBar`의 `DisposableEffect(LocalLifecycleOwner)`가 `ON_START/ON_STOP`을 `GuideSession.setForeground`로 넘긴다(`lifecycle-process` 의존성 추가 없이). `wasBackgrounded`는 `ON_STOP`에서 세운다. 전경 판정은 캐시가 아니라 **게시 시점 조회**(플래그 + `powerManager.isInteractive` 실조회).

### 5-4. 진동

- 톤 동기 진동(`ToneHaptics`): `Vibrator`(`VibratorManager.defaultVibrator`, API 31) + `VibrationEffect.createWaveform(timings, amplitudes, -1)`. 패턴은 iOS `haptic(for:)`의 시점·세기를 waveform 구간으로 옮긴 표(§10-1 JVM 테스트가 시점 합 ≤ `ToneDurations` 길이를 단언):
  - closer 탭 1(0ms, 40ms@115) · farther 탭 2(0·80ms) · nearby 종 타격 6(0·290·440·590·840·1100ms, 세기 255·190·205·215·190·130) · tick 지속 500ms@90 · unreliable 탭 3(0·150·400ms) · ahead 트릴 7(40·130·210·280·360·420·500ms) · crosswalk 비프 8(4×120ms 간격 ×2묶음, 묶음 간격 250ms) · left/right 탭 2(0·220ms, 둘째 강) · back 400ms 버즈 2회(간격 100ms, 세기 계단 감쇠) · warning 40ms@255 + 감쇠 300ms(3단) · start/stop 1300ms 엔벨로프(150·150·155·260·185·200·200ms 구간, 세기 0→38→140→255→255→180→77→0).
  - `hapticIsOptIn`(closer·tick·unreliable)은 `TrendHaptics.storageKey` 저장값(기본 꺼짐 — iOS 동형, 설정 UI는 설정 마일스톤)을 매 재생 시 읽는다.
- **안드로이드 차이(기록)**: 진동은 FGS가 살아 있는 한 **백그라운드에서도 난다**(iOS "햅틱은 백그라운드 미지원"의 반대). 그래도 "어떤 신호도 진동에만 싣지 않는다" 규칙은 유지한다 — 진동 없는 기기(한소네 미확인, §11-7)가 있고 소리가 정본이다.
- `ResultHaptic.fire(success|attention|failure)`: `createPredefined(EFFECT_CLICK)` / `createWaveform([0,40,60,40])` / `createWaveform([0,60,60,60,60,60])`(iOS notification 3종 질감 대응, §11-7 실기기 판정). **실험판 상수 켬**(착수 프롬프트 — 설정 마일스톤에서 스위치). 모델 창구 `resultHaptic(kind)`는 `outputSuppressed`면 건너뛴다("문장이 나가는 조건 = 진동이 나가는 조건"). 소스 가드가 `Vibrator`·`VibrationEffect` 참조를 `audio/` 두 파일로 잠근다.

### 5-5. 억제 소유자 집합 (`outputSuppressed`)

```kotlin
// GuideSession
private val suppressionOwners: MutableSet<Any> = Collections.newSetFromMap(IdentityHashMap())  // 동일성(iOS ObjectIdentifier) — equals 기반 HashSet 금지(리뷰 m-14)
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
3. `awaitingRoute`: `lastFixAt = now` · `noteSessionProgress` → **`if (routeFetchJob == null)`**(in-flight 가드 — 없으면 15초 창에 fix마다 조회, 리뷰 M-9) → `routeOriginStep(best, RouteOriginFix)` → `Fetch` → `fixWaitJob` 취소 + `startRouteFetch(origin, "accepted")` / `Wait(best)` → 보관(`best`가 바뀌면 `routeOriginBestAt = now`) + `routeOriginWait` 로그 → return. 15초 상한(`fixWaitWatch`)이 최선값(`age += 경과`)으로 조회하거나 `fallbackToBrief("guide.detailNoLocation")` + `lastStaleNoticeAt = now`.
4. `inFinalApproach` → `handleFinalApproach` → return.
5. `mode == detail` → `handleDetail` → return.
6. 간략(iOS 대입 목록 전부 — 리뷰 M-9): `brief` 로그 → `isUsableFix` 아니면 `routeTone(unreliable, arrived = arrivedNow)` → return. **`lastFixAt = now` · `lastStaleNoticeAt = null` · `lastFixCoord = (lat, lng)` · `lastFixCoordAt = now` · `noteSessionProgress` · `updateBandDistance(직선거리)`** → `beaconStep` → 간략 도착 창(`briefArrivalWindowStep` — entered면 `resetArrivalWindow` + `arrivalWindowEnteredAt` + 로그, exited면 로그 + reset, active면 `lastUsableDistanceToDest`·`advanceProgressAnchor`) → `beaconGateStep` → `routeTone(unreliable = weak, priority = nearbyTone ? nearby : null, trend = weak ? null : TrendInput(distance, max(15, acc), floor = acc, motion, walkCloserInterval), arrived = nearby)` → 통지(`text(for:)`, `statusText` 갱신, weak 제외 `lastGuidance`) → `maybePresumeArrival`. (`suppressNextNotice`는 없다 — §6-3.)

`handleDetail`: `accuracy > 0 && age ≤ 10` 아니면 `unreliable` 톤 → return. **`lastFixAt`·`lastStaleNoticeAt = null`·`lastFixCoord/At`·`noteSessionProgress`** → `guideStep(state, GuideFix, route, now, GuideTuning.walk)` → `backOnRoute/reacquired`면 하단 2행 기준 리셋 → `refreshLiveRows` → `fix` 로그(iOS 필드 전부) → `finalApproachEnter`면 `beginFinalApproach` + 같은 fix로 `handleFinalApproach` → return; `updateRemaining` → `routeTone(unreliable = uncertain|reacquiring, priority = BeaconTone.fromGuide(out.tone), eventOwned = event != null, trend = following|bundle ∧ !jumped ? TrendInput(remaining, 6, floor 5, motion, 2초) : null)` → 이벤트 없으면 `syncStatusTextWithPhase` / 있으면 `consume(event)`.

`consume(event)`(walk만): `AnnounceSteps`·`BundleReread` → `GuideText.unit`, `lastGuidance`, `statusText = ""`, 억제면 `pendingRecovery` / `Imminent(stage 0만 문장)` → `GuideText.imminentText(action)`, `statusText`, 억제 시 보관 안 함 / `Periodic` → `GuideText.periodicWalk(target = liveSteps[i].target)`, `statusIsNextPreview = true` / `WaypointReached` → `waypoint = null`·`clearProposal`·`rerouteToken += 1`·`nearby` 톤·`directions.viaArrived`(억제면 `pendingRecovery`) / `OffRoute` → 회차 시작 = `!offRoute`; `offRoute = true`·문장·회차 시작이면 `maybeFetchProposal` / `BackOnRoute` → `offRouteEndedByReroute = false`·`offRoute = false`·`clearProposal`·`ResultHaptic.success`·문장 / `UncertainEnter`·`UncertainExit`·`Reacquiring`·`Reacquired` → 문장 / `SpeedSuggest` → 무시 / `FarNotice`·`FinalApproachEnter` → 도달하지 않음(walk 프로파일·fix 처리부가 가른다).

`handleFinalApproach`: `isUsableFix` 아니면 `unreliable` → return. `lastFixAt`·`lastStaleNoticeAt = null`·`lastFixCoord/At`·`noteSessionProgress` → 직선거리·`lastUsableDistanceToDest`·띠바 거리·`advanceProgressAnchor` → `arrived = distance ≤ finalApproachArriveMeters` → `final` 로그 → `routeTone(trend = TrendInput(distance, max(15, acc), floor acc, motion, 2초), arrived)` → 진입 서술 1회(`GuideText.finalApproachEnter`, `lastFinalTickAt = now`, `ResultHaptic.attention`, 미게시면 `pendingFinalApproachIntro`) → return → 도착이면 `nearby` 톤·`stop()`·`arrivalDest = dest`·`endKind = arrived`·`loadArrivalHealth()`·문장(`guide.arrived`) → `maybePresumeArrival` → 15초 주기 `GuideText.finalApproachTick(distance, liveDirection, acc)`.

`liveDirection`: `courseStep(course, courseAccuracy, speed ?: -1.0, motion, age)` — `speed`가 null이면 `-1.0`(courseStep의 `speed >= 0.4` 가드가 `Unknown`을 낸다).

워치독 `tickWatchdog`(2초, wake lock 위): `reference = lastFixAt ?: startedAt` → `now - reference ≥ 8` → `routeTone(unreliable, arrived = arrivedNow)` → `maybePresumeArrival` → `maybeEndIdleSession` → `noticeStaleIfNeeded(force = false)`(15초·30초 재통지, `awaitingRoute` 중엔 침묵). 매 tick `watchdog dt=` 로그.

### 6-2. 경로 조회·재조회

- `fetchDetailData(origin, dest, variant, waypoint)` = `RouteService.walk(..., accessible, lang = DataLocale, includeGeometry = true, variant, via)` → `waypoint != null && briefing.waypoint == null`이면 null → `buildGuideRoute(steps.map { GuideStepGeometry(description, pathCoords, **action**) }, waypoint?.stepIndex)` → null이면 상세 부적격 → `DetailFetchResult(route, durationSeconds, stepFree(raw)·stepFreeStatus·stepFreeNotice, finalApproach, liveSteps = liveStepsFrom(route, steps.map { LiveStepFields(live?.target, live?.anchor, crossing ?: false) }))`. `Dispatchers.IO`에서 호출, 커밋은 메인. ⚠ **`GuideStepGeometry.action`을 빠뜨리면 walk 프로파일(서버 투영만 본다)에서 임박 큐가 전면 침묵한다** — 웹 테스트·타입 검사·Kit fixture가 전부 통과시키는 자리다(E16 축3, iOS `BeaconModel.swift:851`). `:kit` `RouteGeometry.kt`의 그 필드 KDoc("자동차 전용, 도보는 null")은 낡았다 — 정정은 `:kit` 무수정 규율상 코디네이터에 넘긴다(리뷰 m-12).
- 시작 조회 커밋(`fetchGuideRoute`)·재조회 커밋(`commitReroutedRoute`)·자동 채택(`fetchProposal`)은 iOS 동형(토큰·목적지·경유지 스냅샷 가드, `consumeStepFreeNotice`, `.high` 문장, `pendingStepFreeNotice` 상환 — 게시 실패·선점 시 `onDropped`가 장부를 복원한다).
- **재조회 origin**: iOS는 `LocationService.currentCoordinate()`(추적 중 스트림 최신 fix). 안드로이드는 `LocationStore`가 스트림을 모르므로 **모델의 마지막 수용 fix(`lastFixCoord`, 15초 이내)**를 origin으로 쓴다 — 없으면 재조회 실패 문장(`guide.rerouteFailed`). 자동 채택의 신선도 검사(`RerouteProposalGate.isFresh`, 취득점 30m·120초 + fix 15초)는 그대로.
- 조회 상한: `withTimeoutOrNull(15초)`(M3 `queryTimeoutMs` 동형) — 만료는 실패로 접는다(iOS는 URLSession 기본 상한).

### 6-3. iOS와 의도적으로 다른 것 (전부 플랫폼 차이 — 규칙 위반 아님)

| 자리 | iOS | 안드로이드 | 근거 |
|---|---|---|---|
| 백그라운드 복귀 앵커 리셋(`handleScenePhaseChange` 말미) + 그 짝 `suppressNextNotice`(복귀 직후 1회 삼킴) | 미선언 빌드만 리셋 | **둘 다 없음** | 스트림이 FGS로 계속 흘러 상태가 최신(iOS 선언 빌드와 같은 갈래). 리셋이 없으니 삼킬 재발화도 없다(리뷰 N-6) |
| 음성 전경 게이트 | 전경만 | 전경 ∨ 화면 꺼짐(§5-3) | VO 통지 제약 부재 |
| `isBackgroundAudible`/`soundDegraded` | 카테고리·활성 | 미디어 볼륨 0 | 카테고리 개념 없음 |
| 인터럽션 중 재생 | 시스템이 막는다 | 앱이 막는다(포커스 못 잡으면 안 낸다) | 포커스는 협약 |
| 진동 백그라운드 | 불가 | 가능(신호를 진동에만 싣지 않는 규칙은 유지) | 플랫폼 |
| 권한 회수 처리 | 델리게이트로 `stopAndFail` | 없음(프로세스 재시작) | 플랫폼 |
| 정밀 위치 | `reducedAccuracy` 팝업 | COARSE → 재요청(M3 동형) | 플랫폼 |
| 단조 시계 | `systemUptime`(잠자기 정지) + `ContinuousClock`(종료 화면) | `elapsedRealtime` 하나 + wake lock | 화면 꺼짐에도 fix가 계속 오므로 시계가 흐르는 것이 옳다(`RerouteProposal`·`sessionIdle`이 주머니 시간을 정직하게 센다); 타이머 축의 절전 정지는 wake lock이 막는다 |
| 재조회 origin | 위치 서비스 `currentCoordinate` | 모델 최신 fix(15초) | §6-2 |
| 알림 | 없음 | FGS 지속 알림 + 종료 액션 | D11 |
| 화면 유지 | `isIdleTimerDisabled`(세션 내내) | **시트가 펼쳐진 동안만** `FLAG_KEEP_SCREEN_ON`(§12-8) | iOS 수단은 앱을 살리는 장치였고 안드로이드는 FGS+wake lock이 그 일을 한다(리뷰 m-6). 손에 들고 시트를 읽는 동안만 켠다 — 주머니 사용(최소화·화면 꺼짐)에선 배터리·오터치만 는다 |
| `teardown`·`shutdown` | 화면 이탈 정리 | 없음(프로세스 수명) | §3-3 |

### 6-4. 규칙 대조표 (CLAUDE.md·INTEGRATIONS §실시간 길 안내 → 수단)

| 규칙 | 수단 |
|---|---|
| 톤 계층 배타 순서·`needsRebase` | `toneLayerStep` 입력 조립만(§6-1) — 간략 3단·상세 4단 입력이 iOS와 같은 값 |
| 도플러 3-state 정지, `speedUnknown`엔 tick 없음 | `motionStep`에 `hasSpeed()` 거짓을 **null**로(0.0 금지) |
| fix 부재 워치독(8초 톤·15초 음성·30초 재통지) — **fix 경로와 독립** | 메인 `Handler.postDelayed` 2초 루프 `tickWatchdog` **+ 세션 수명 부분 wake lock**(§4-1 — 없으면 fix 두절이 곧 절전이라 독립이 아니다) |
| 이탈 두 축·유도기 리듀서 소유 | `guideStep`만 부른다(방위 관측 인자 없음) |
| 도착 창·`briefArrivalWindowStep`·`resetArrivalWindow` 한 곳 | §6-1 간략·최종 접근 갱신부 |
| 결정 지점 두 층·임박 삼중 큐·`stage > 0` 무문장 | `consume(Imminent)` |
| 잊힌 세션 안전망(600초·1200초, 앵커 25m) | `noteSessionProgress`(세 경로 전부) + 워치독 `maybeEndIdleSession` |
| 톤 뒤 발화·단일 슬롯·`announceNow`만 즉시 | `DeferredAnnouncer(scope = Main, clock = uptimeNow, toneEndsAt = tones::toneEndsAt, post = ::post)` — 새 통지 경로는 `announce`/`announceNow`만(소스 가드: `speaker.speak(` 호출부는 `post` 한 곳). 톤 길이는 상수 표(§5-1) |
| 잘림 방지 대기 | `endSession(remaining)` 잔여 + 0.15 대기, `acquire`가 예약 취소(§5-2) |
| `outputSuppressed` 소유자 집합 | §5-5(동일성 집합) |
| 오디오 재생기 둘 → 소유권 이전 | 재생기 하나·포커스 하나(M5도 공유) — 이전 개념 소멸(§5-2 #16) |
| 종료 화면 동기 판정 | `stopLeavingSummary`: `StepCounter.liveSample`(라이브 누적, 거리 null → 보폭 환산)로 `isMeaningfulWalk` 동기 판정 |
| 세션 앱 수명·시트 최소화·소거는 닫기뿐 | `GuideSession`(§3-1)·`GuideBottomBar`(§7-2) |
| 통지 우선순위 판별선 | TTS 채널이라 잠식 없음(§5-3) — `highPriority`는 기록 |
| 결과 진동 3종·문장 조건 = 진동 조건 | §5-4 |
| 안내 origin은 정확도(`routeOriginStep`) + `routeOrigin` 로그 | §6-1 ③ |
| 정지 톤 뒤 원복 | `stop()` ⑩→⑪ 순서 |
| 추정 도착·잊힌 세션의 종은 전경만 | `isForeground`(Activity STARTED — 화면 꺼짐은 **전경이 아니다**: 주머니 속에서 한참 뒤 울리지 않게, iOS 판정의 취지. §5-3 `isSpeechAllowed`와는 다른 술어다) |
| 전경 복귀 상환은 추적 가드보다 앞 | §5-3 |
| 무음 진입 1회 진동·문장 | §5-1 래치 |
| 거리 표기 `formatDistance`만·낭독 `spokenDistanceUnits` | `GuideText`·행 렌더·TTS 창구 |
| 3-state | 상세/간략 폴백 문구 갈림, 걸음 요약 부재는 행 부재, `ttsUnavailable`·미디어 볼륨 0·`isSilenced`·서비스 시작 실패 문장 분리 |

---

## 7. 화면 ([4])

M1 §3 기본형·M2·M3 관용구(`mergedRow`·`ActionRow`·`tapTarget`·`headingText`·`FocusRequester`는 `focusable`/`clickable` **앞**·48dp·이모지 0)를 전부 승계한다. **이 화면에만 다른 것**: live region이 없다(§5-3). 착지 관용구는 M1~M3의 `runCatching { requester.requestFocus() }.onFailure { Log.w }` 그대로이고(`requestFocus()`는 `void`다 — Boolean 판정 금지, 리뷰 M-3) M4는 **"실패하면 600ms 뒤 한 번 더"**만 더한다: `runCatching { r.requestFocus() }.onFailure { delay(600); runCatching { r.requestFocus() }.onFailure { Log.w(...) } }`.

### 7-1. 시작 버튼 (`WalkGuideStartButton`, directions 슬롯)

- `WalkOutcomeRows`에 `guideStart: (@Composable (variant: WalkRouteVariant?) -> Unit)?` 인자를 더한다(기본값 null — M3 테스트 호환). `DirectionsForm`은 `AppConfig.experimentalGuidanceEnabled ∧ 도착 좌표 있음`일 때만 슬롯을 넘긴다: `{ variant -> WalkGuideStartButton(dest, label, accessible = s.stepFreeEnabled && lang == ko, variant, shortestAvailable = s.walkShortest != null, waypoint = s.via) }`. 도착 좌표·라벨 = `promotedDestination ?: (to as Place)`(iOS `trackedDestination` 동형); `to == Current`면 슬롯 null(버튼 없음).
- 버튼 라벨 `beacon.guideStartWalk` / `android.beacon.guideStartWalkShortest`(android-extra 신규), `tapTarget`, testTag `guide-start-walk`/`guide-start-walk-shortest`. 활성화 = `GuideSession.startWalk(request)`. 착지: 시작 즉시 시트가 뜨므로 이동 없음. 시트가 최소화되어 돌아오면 커서는 시스템 복원(버튼이 그대로 있다).
- 추적 중엔 버튼을 **숨기지 않는다**(누르면 `guide.alreadyActive` 거부 통지 — iOS 동형).

### 7-2. `GuideBottomBar` (AppRoot 삽입 한 자리)

```kotlin
// AppRoot: bottomBar = { GuideBottomBar { NavigationBar(...) } }
@Composable fun GuideBottomBar(tabs: @Composable () -> Unit) {
    val app = LocalContext.current.applicationContext; remember { GuideSession.attach(app) }   // 멱등
    GuidePermissionsLauncher()                       // rememberLauncherForActivityResult 손 등록(attach/detach)
    ForegroundObserver()                             // ON_START/ON_STOP → GuideSession.setForeground
    val ui by GuideSession.walk.ui.collectAsState()
    val showsSheet = GuideSession.hasScreen && !GuideSession.isMinimized
    KeepScreenOn(showsSheet)                         // 시트가 펼쳐진 동안만 activity.window FLAG_KEEP_SCREEN_ON(§12-8)
    Column { if (GuideSession.hasScreen && GuideSession.isMinimized) GuideBand(ui); tabs() }
    if (showsSheet) GuideSheet(ui)                   // ModalBottomSheet — 자기 윈도(Dialog)에 그려져 bottomBar 측정에 0 기여
}
```

- `ModalBottomSheet`(Material3 1.3+)는 `Dialog` 기반 별도 윈도라 `Scaffold.bottomBar` 슬롯 안에서 불러도 레이아웃에 기여하지 않는다 — **§10-2 androidTest가 확인**(리뷰 m-16 "확인 필요"). 안 되면 `GuideSheet()` 호출만 `AppRoot`의 `Scaffold` 바깥으로 옮긴다(삽입 자리가 둘이 되므로 그때 코디네이터 보고).
- 띠바(`GuideBand`): 버튼 하나 = 객체 하나. 시각 두 줄(요약·`guide.band.return`), 낭독 `joinText(spokenDistanceUnits(요약), guide.band.return)`(`clickable + clearAndSetSemantics` 관용구). 요약 = `guide.band.remaining(dest, formatDistance(bandDistanceMeters))` / `starting` / 종료 화면이면 `arrived`·`ended`. 활성화 → `returnedFromBand = true; isMinimized = false`. **최소화 직후 착지 = 띠바**(`FocusRequester`를 `clickable` 앞에, 한 프레임 + 400ms 뒤 착지 관용구).
- 시트(`GuideSheet`): `ModalBottomSheet(onDismissRequest = { isMinimized = true }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), dragHandle = null)`. 뒤로 키·바깥 탭·스와이프 = **최소화**(종료가 아니다). 내용은 `Column(verticalScroll)` + 최하단 고정 종료 버튼(스크롤 밖). 조망 페이지가 열려 있을 때는 시트 콘텐츠 안의 `BackHandler(enabled = overviewOpen)`이 뒤로 키를 먼저 받아 조망만 닫는다(`ModalBottomSheet` 자체 핸들러보다 안쪽이라 우선 — §10-2가 확인).

### 7-3. 안내 시트 읽기 순서 (= 시각 순서)

| 순서 | 요소 | 계약 |
|---|---|---|
| 1 | 제목 `Text(joinText(beacon.walkHeading, destinationLabel))` — 헤딩(`headingText`) + `mergedRow("guide-title", focus = titleFocus)`(단일 `Text`에만, 리뷰 N-1). **진입 기본 착지**. 접기 `IconButton`(`guide.minimize`, 48dp, `focusRequester(minimizeFocus)`)은 같은 `Row`의 **형제**(병합 밖) — 띠바 복귀(`returnedFromBand`) 시 착지 | |
| 2 | 진행 상황 버튼 `guide.progressButton` | 상세(경로 보유) → 조망 페이지(§7-4)로 시트 내용을 교체 / 간략 → `announceNow(progressText(), high)` + `statusText` 갱신 |
| 3 | 재조회 버튼(이탈 확정 시만) | 라벨 `isRerouting ? guide.rerouteBusy : guide.rerouteButton`(라벨이 곧 상태). 성공·자동 채택으로 사라질 때 **제목 착지**(`offRoute` false 전이 ∧ `reroutePressed ∨ offRouteEndedByReroute`) |
| 4 | 간략 주석 `beacon.straightLineNote`(`mode == brief`) | 비상호작용 행 |
| 5 | 남은 거리·시간(`remainingText`, 상세 ∧ !offRoute) | `TextRow(spoken = spokenDistanceUnits)` — 매 fix 갱신, 통지 없음 |
| 6 | 상세: 하단 2행(`liveTopText`·`liveNextText`) / 간략: 상태 행(`statusIsNextPreview ? guide.progressNext(statusText) : statusText`) | 비상호작용 행. 값이 null·빈 문자열이면 행 없음 |
| 7 | 소리 상태 행(`soundDegraded` → `android.guide.mediaVolumeZero`, `ttsUnavailable` → `android.guide.ttsUnavailable`, `isSilenced` → `android.beacon.soundUnavailable`) | 지속 상태라 상태 행과 자리를 다투지 않는다 |
| 8 | **최하단 고정** `beacon.stop` 버튼 | 스크롤 밖 `Column` 말미, `tapTarget`, testTag `guide-stop`. 활성화 → `stopByUser()` |

- 착지 절차: `LaunchedEffect(key) { withFrameNanos{}; delay(400); land(requester) }`(위 관용구 + 1회 재시도) — `ModalBottomSheet` 표시 애니메이션이 끝난 뒤 시스템이 포커스를 옮기므로 그보다 늦게 대입(iOS `landTitleFocus` 동형).
- 도착 전이(`arrivalDest` null → non-null): 포커스를 쥔 종료 버튼이 사라진다 — **도착 문장 착지**.

### 7-4. 조망 페이지 (시트 내용 교체, iOS `GuideOverviewSheet` 도보부)

상단 닫기 → 행(`android.guide.routeListCurrent`/`android.guide.routeListRow`, 경유지 구획 `directions.viaArrived`) → 말미 닫기. 헤더 = `progressText()`(헤딩, 진입 착지 — 낭독이 곧 조망 문장, 별도 통지 없음). 닫기·뒤로(`BackHandler`) → 시트 본문으로 복귀, 착지 = 진행 상황 버튼. 행동 슬롯(대안 보기)은 M4b.

### 7-5. 종료 화면 (같은 시트, `arrivalDest != null`)

| 순서 | 요소 |
|---|---|
| 1 | 헤딩 `joinText(endHeading, destinationLabel)` — `android.beacon.arrivedHeading`/`arrivedPresumedHeading`/`endedHeading` |
| 2 | 종료 문장(`guide.arrived`/`guide.arrivedPresumed`/`endText`) — **착지** |
| 3 | 걸음·칼로리 문장(있을 때만 — 걸음 센서 허가 ∧ 라이브 표본 ∧ ≥ 72걸음): `usedDefaultWeight ? android.beacon.healthSummaryWithWeight(steps, 65, kcal) : healthSummary(steps, kcal)` + 음식 비유(`WalkHealth.foodComparison` → `android.beacon.food.*` 리터럴 `when`) 한 객체(공백 결합) |
| 4 | 닫기 `actions.close` → `clearArrival()` |

- 체중은 `WalkHealth.weightStorageKey`를 `SharedPreferencesStore`로 읽는다(설정 UI 없음 — 항상 기본 체중 문장).
- 30분 만료(§3-3). 백그라운드에서 끝난 세션은 정지 톤·음성 없이 화면만 남는다(설계대로) — 단 **전경 복귀 상환**(§5-3)이 종료 문장을 한 번 말한다.

### 7-6. 통지·착지·진동 표

| 사건 | 문장(TTS) | 착지 | 진동 |
|---|---|---|---|
| 시작(상세 커밋) | `guide.detailStart` 원자 발화(+열화 문장 앞) | 시트 제목 | `start` 톤 진동 |
| 간략 폴백 | `guide.detailUnavailable(dest)`/`detailNoLocation` | — | — |
| 결정 지점 40m | 전문(`GuideText.unit`) | — | — |
| 임박 20·15·10m | 문장은 첫 단계만 | — | 행동별 톤 진동 매 단계 |
| 이탈 확정 | `guide.offRoute` | — | `warning` |
| 자동 채택·재조회 성공 | `android.guide.autoReroute`/`guide.rerouteDone` | 제목(버튼 소멸) | `ResultHaptic.success` |
| 재조회 실패 | `guide.rerouteFailed` | — | `failure` |
| 복귀 | `guide.backOnRoute` | — | `success` |
| 최종 접근 진입 | `guide.finalApproachRouteEnd + …` | — | `attention` |
| 확정·추정 도착 | `guide.arrived`/`arrivedPresumed` | 종료 문장 | `nearby` 톤 진동 |
| 사용자 종료(요약 있음) | `android.beacon.stopped` | 종료 문장 | `stop` 톤 진동 |
| 타 앱 전경 중 알림 액션 종료 | **없음**(전경 게이트 — 정지 톤만) | — | `stop` 톤 진동 |
| 통화 중(포커스 거절) | **없음**(톤도 없음 — §12-7) | — | 없음 |
| 미디어 볼륨 0 | `android.guide.mediaVolumeZero` 1회 | — | `attention` |
| 소리 재생 불가(`isSilenced` 진입) | `android.beacon.soundUnavailable` 1회 | — | `failure` 1회(래치) |
| TTS 불가 | (문장 불가 — 행만) | — | `failure` 1회 |
| 서비스 시작 실패 | `android.guide.serviceStartFailed` | — | `failure` |
| 거부(이미 안내 중) | `guide.alreadyActive` | — | — |

---

## 8. 계측 (`GuideDiag`)

- `GuideDiag.log(msg)`: `Log.i("GuideDiag", line)` + 파일 `context.getExternalFilesDir(null)/guide-diag.log`(2MB 초과 시 `guide-diag.old.log`로 교체). 게이트 `BuildConfig.DEBUG || BuildConfig.EXPERIMENTAL`(릴리스는 no-op, 문자열 조립 자체가 인라인 람다로 건너뛴다).
- 줄 형식은 iOS와 같다(`[GuideDiag] [ISO8601] session kind=walk` · `routeOrigin lat= lng= acc= age= reason=` · `routeOriginWait acc= age= best=` · `brief t= lat= lng= acc= motion= age= usable= dist= nearby=` · `fix t= … phase= d= event= perp= edgeHits= derived= vote= axes= votes= verdict=` · `finalEnter offset=` · `final t= dist= acc= arrived= introSpoken=` · `arrivalWindowEnter/Exit` · `presumedArrival reason= dist= window=` · `sessionIdleEnd reason=` · `briefHandoff reason=` · `endScreenExpired age=` · `arrivalHealth load= latencyMs=`) — 기존 리플레이 스크립트가 그대로 읽게. 추가 줄: `service start ok|failed=`·`watchdog dt=`·`focus lost=|granted|failed`·`tone skipped focus`·`speech skipped focus`·`tts init=`·`notify text=`(길이만).
- 회수: `adb pull /sdcard/Android/data/space.dodoplanet.gildongmu.dev/files/guide-diag.log ~/gildongmu-private/field-logs/android-<날짜>.log`. 저장소엔 커밋하지 않는다 — 루트 `.gitignore`에 `guide-diag*.log*`(현재 `docs/superpowers/specs/logs/*.log`만 있다 — `CLAUDE.md`의 "`.gitignore`가 막는다"는 서술이 사실보다 앞서 있다, 리뷰 N-2 → 코디네이터 보고 §12-1). 로그는 기기에만 생기므로 패턴은 방어선이다.

---

## 9. i18n

- 기존 키 재사용(생성 카탈로그 `strings.xml`과 기계 대조 완료 2026-09-16): `beacon.*`(walkHeading·stop·first·closer·farther·nearby·weak·denied·reduced·straightLineNote·guideStartWalk), `guide.*`(detailStart·bundle·handoff·finalApproach*·arrived·arrivedPresumed·endedIdle·dir*·offRoute·backOnRoute·imminent.*·live*·nextAction·nextStraight*·uncertain*·reacquiring·detailUnavailable·detailNoLocation·progressButton·progressOrdinal·progressCurrent·progressNext·remainingDistance·remainingTime·rerouteButton·rerouteBusy·rerouteFailed·rerouteDone·progressUncertain·progressOffRoute·progressFinalApproach·approx·rough·noGuidanceYet·alreadyActive·minimize·band.return·band.remaining·band.starting·band.arrived·band.ended·periodicStraight·periodicStraightNoName·nextDestination), `android.beacon.*`(soundUnavailable·stopped·arrivedHeading·arrivedPresumedHeading·endedHeading·healthSummary·healthSummaryWithWeight·food.*), `android.guide.*`(routeListCurrent·routeListRow), `directions.viaArrived`, `actions.close`, `android.unit.spokenMeters`.
- **android-extra 신규(6로케일)**: `android.beacon.guideStartWalkShortest`·`android.guide.autoReroute`(둘 다 ios-extra **비접두** 키라 변환 스크립트가 버린다 — 문안은 ios-extra 그대로, 리뷰 M-4) · `android.guide.mediaVolumeZero`("미디어 볼륨이 꺼져 있어 안내 소리가 나지 않습니다") · `android.guide.ttsUnavailable`("이 언어의 음성 안내를 쓸 수 없습니다. 화면의 안내 문장을 확인하세요") · `android.guide.serviceStartFailed`("안내 서비스를 시작하지 못했습니다. 앱을 화면에 띄운 채 다시 시작하세요") · `android.guide.notificationChannel`("도보 안내"). `%`가 없는 문장이라 거부 규칙 무관, `INTENDED_DIFFERENCES` 대상 아님(iOS에 없는 키).
- 문자열 창구 `GuideStrings.stringId(key)` 리터럴 표(M3 `DirectionsStrings` 관용구) + `GuideSourceGuardTest`가 소스의 키 모양 리터럴 전수를 표에 대조. `GuideText`는 `Strings` 주입(JVM 테스트는 `CatalogStrings` 재사용 — `directions/` 테스트 픽스처를 `guide/` 테스트가 import한다).
- 카탈로그 재생성: `node android/scripts/messages-to-android-strings.mjs`(신규 키는 순서 변경이 아니라 exit 0).

---

## 10. 게이트와 테스트 레인

### 10-1. JVM (`:app:testDebugUnitTest`)

- `WalkGuideModelTest`: 페이크 `RouteService`(`stubbedClient`), 페이크 `GuideTones`·`GuideSpeaker`·`StepCounter`·`GuideForegroundController`·`GuideAudioFocus`(인터페이스 — 실구현은 서비스·플랫폼), 주입 시계·`MainDispatcherExtension`. 시나리오: ① 시작 → 수용 fix → 상세 커밋 → 원자 발화 1회 ② 15초 무수용 → 최선값 조회 / 없음 → 간략 폴백 문장 ③ 상세 fix 열(공유 fixture `route-guide-scenarios.json`의 한 케이스를 좌표 열로) → 임박 stage 0만 문장·톤 3회 ④ 이탈 확정 → 자동 조회 1회·채택·`.high` 문장·`ResultHaptic.success` ⑤ 최종 접근 진입 서술 → 도착 → `stop`·`arrivalDest`·종료 문장 ⑥ 사용자 종료: 라이브 누적 72걸음 이상이면 종료 화면, 미만이면 없음(동기) ⑦ 억제 소유자 집합 `이전 ∧ 현재`, 동등한 두 소유자가 따로 셈됨 ⑧ 워치독 8초 `unreliable`·15초 문장·600초 세션 종료; **간략 모드에서 fix가 정상일 때 워치독 통지 0건** ⑨ 전경 게이트: 다른 앱 전경 → `missedAnnouncement` → 복귀 상환 1문장 / 화면 꺼짐 → 발화 / **다른 앱 전경 중 도착 → 세션 종료 뒤 복귀에도 종료 문장 상환** ⑩ 종료 화면 30분 만료 ⑪ 알림 본문 조립기 = 상태 문장 우선 ⑫ 거부(`alreadyActive`) **→ 종료 → 재시작 성공**(토큰 반납) ⑬ `attach` 2회 뒤 같은 모델·같은 상태 ⑭ 서비스 시작 실패 콜백 → `serviceStartFailed` 문장·`tracking` 아님·wake lock 해제 ⑮ 포커스 거절 시 톤·발화 0 → 허가 뒤 재생 ⑯ 조회 중 fix 5개 → `/api/route/walk` 호출 1회(in-flight 가드).
- `GuideAudioFocusTest`: §5-2 표의 19항 대응 단언(페이크 `AudioManager` 인터페이스).
- `GuideTonePlayerTest`(순수부): `toneResource` 전수·게인 표·`toneEndsAt` 대입 조건·보류 시작 톤 1개·`ToneHaptics` 시점 합 ≤ `ToneDurations`.
- `ToneDurationsTest`: `res/raw` mp3 프레임 헤더 계수 길이 == 표 ±0.05초(⑤').
- `GuideTextTest`: `CatalogStrings`로 실문장 단언(시작·주기·임박·최종 접근·조망 헤더·종료 화면 걸음 문장).
- `DeferredAnnouncer` 배선: 톤 뒤 발화가 `post`를 지연 호출하는지(`toneEndsAt` 주입 확인 1건).
- **소스 가드 `GuideSourceGuardTest`**: ① `GuideSession.startWalk(` 호출부 == `WalkGuideStartButton.kt` 1곳(+ 테스트) ② `startWalk` 본문에 `experimentalGuidanceEnabled` 가드 존재 ③ `TextToSpeech(`·`SoundPool`·`Vibrator`·`VibrationEffect`·`AudioFocusRequest` 참조는 `audio/` 지정 파일만 ④ `speaker.speak(` 호출부는 `WalkGuideModel.post` 한 곳 ⑤ `res/raw` 이름 집합 == `resourceName` 변환 집합(15개), 바이트 == 대응 웹 파일(§5-1 규칙) ⑥ `guide/`에서 `import android.location`은 `GuideLocationStream.kt`만 ⑦ 매니페스트에 `foregroundServiceType="location"` 서비스 1개, `ACCESS_BACKGROUND_LOCATION` 0(기존 가드), `MainActivity` `launchMode` 무변경 ⑧ 문자열 키 전수 매핑 ⑨ 시트에 `liveRegion` 0 ⑩ `androidx.core` import 0(플랫폼 API만) ⑪ `requestFocus()`는 `runCatching` 안에서만.

### 10-2. androidTest (`connectedDebugAndroidTest`, adb 연결 시)

- `GuideSheetA11yTest`: 페이크 모델 상태로 `AppRoot` 골격 안에서 시트를 띄워 ① 제목 헤딩·행 단일 노드·종료 버튼 48dp·ATF 검사 통과 ② 종료 화면 착지 문장 단일 노드 ③ **조망 열림 → 뒤로 키 → 조망만 닫히고 시트 유지**(리뷰 m-16) ④ `bottomBar` 슬롯에서 연 `ModalBottomSheet`가 탭 바를 밀지 않는다(탭 바 bounds 불변) ⑤ 최소화 → 띠바 노드 존재 → 활성화 → 시트 복귀.

### 10-3. 게이트 절차

README §7 락 안에서 `:kit:test :app:testDebugUnitTest :app:assembleDebug :app:assembleExperimental` + `VITEST_MAX_THREADS=2 npm run test:run`(`xcstrings-plural` 1건 실패 기대). vitest 쪽 영향: `android-strings-drift`(신규 키 왕복)·`mirror-registry`(kit 무수정) — 생성물 재생성 필수.

### 10-4. 변이 주입(커밋 뒤, 리뷰 m-10)

① `toneEndsAt` 주입을 `{ null }`로(톤 뒤 발화 소실 → `DeferredAnnouncer` 배선 테스트) ② `isSpeechAllowed`의 "화면 꺼짐" 항 제거(⑨) ③ 억제 종료를 `false` 고정으로(⑦) ④ 워치독 tick을 fix 콜백 안으로 옮기기(⑧ — 정상 fix에서 통지 0은 유지되나 8초 두절 케이스가 침묵). 넷 다 빨강이어야 한다.

---

## 11. 실기기 검증 항목 (한소네 7, `docs/FIELD-TEST.md` 형식 — 보고 파일에 대본으로 싣는다)

| # | 언제 | 무엇을 듣고 | 무엇을 답하나 |
|---|---|---|---|
| 1 | **D11**: 안내 시작 → 화면 끄고 3분 걷기 → 다른 앱(카톡) 열고 2분 | 화면 꺼짐·타 앱 전경에서 톤이 계속 나는가(closer/tick) | 로그 `fix t=` 줄이 끊김 없이 이어지면 D11 성립. 끊기면 §4-1 재판정(백그라운드 위치는 D11이 요청 금지 — 대안은 코디네이터) |
| 1b | **워치독**: 화면 끈 채 지하·건물 안으로 들어가 fix를 끊는다 | 8초 안에 `unreliable`가 나고 10초 간격으로 반복되는가, 15초에 "신호 약함"이 나는가 | 로그 `watchdog dt=`가 2초 근처면 wake lock 성립. dt가 수십 초로 벌어지면 절전 침입 — §4-1 수단 재판정 |
| 2 | 시작 직후 | 시작 톤 → `guide.detailStart` 문장이 톤 뒤에 나오는가(겹침 없음) | `speechDeferStep` 배선 |
| 3 | 화면 꺼짐 중 결정 지점 | 임박 톤 + 문장이 **둘 다** 나는가(§5-3 판정) / 다른 앱 전경에선 문장이 **안** 나고 복귀 시 현재 상태 1문장 | 음성 게이트 |
| 4 | TalkBack으로 시트를 훑는 중 주기 통지·톤 도착 | ① 톤이 TalkBack 낭독을 끊는가(`SONIFICATION`이면 끊지 않아야) ② 우리 TTS가 TalkBack을 끊는가·TalkBack이 우리 TTS를 끊는가 ③ 겹칠 때 어느 쪽이 덕킹되는가 ④ 톤 뒤 발화 지연이 TalkBack 낭독과 어떻게 얽히는가 | 겹침이 치명적이면 §12-5 대안 / TTS usage `ASSISTANCE_ACCESSIBILITY` 대안 |
| 5 | 주기 통지 "약 120m" | TTS가 `m`을 "미터"로 읽는가(정정 없이) | `spokenDistanceUnits` 유지/제거 |
| 6 | 시스템 TTS 속도를 빠르게 둔 채 | 안내 속도가 시스템 설정을 따르는가 | §5-3 배율 표 확정 |
| 7 | 임박 톤 5종·이탈·도착·start/stop | 진동이 나는가, 5종이 손에서 갈리는가, `ResultHaptic` 3종이 갈리는가 | 한소네 진동 유무 |
| 8 | 알림 그늘(다른 앱 사용 중) | "도보 안내, {dest}" + 상태 한 줄이 점자로 읽히는가, "안내 종료" 액션이 종료하는가(백그라운드 시작 제한 통과), 본문 탭이 앱을 앞으로 가져와 띠바가 보이는가 | D11 자산·§12-6 |
| 9 | 접기 → 띠바 | 띠바에 커서가 착지하는가, 펼치면 접기 버튼에 착지하는가 | 착지 표 |
| 10 | 시트 진입 | 제목 헤딩 착지, 스와이프 순서 = §7-3 표 | |
| 11 | 도착 | 종 → 도착 문장 착지 → 걸음·칼로리 문장 → 닫기 | 걸음 센서 유무 |
| 12 | 미디어 볼륨 0으로 시작 | `mediaVolumeZero` 문장·진동, 시트 행 | |
| 13 | 계단 회피 켠 채 시작 | 열화 문장이 시작 문장 앞에 결합되는가 | |
| 14 | 이탈(일부러 한 블록 돌기) | `warning` → `offRoute` → 자동 채택 문장 → 커서 제목 착지 | |
| 15 | 세션 중 전화 수신 | **통화 중** 톤·문장이 안 나는가(§12-7), 통화 뒤 다음 톤이 나는가(계약 2·#19) | |
| 16 | **점자**: 안내 중 시트를 훑지 않은 채 걷는다 | 점자 줄에 주기 통지·이탈·도착 문장이 나타나는가(안 나타나는 것이 예상) — 그것이 문제인가를 위원장이 판정 | §12-5 대안 발동 조건 |
| 17 | 설치 직후 첫 안내 시작 | 시작 톤이 나는가(보류 1개) | |
| 18 | 안내 중 앱 언어 전환·회전 | 세션·톤·시트가 살아 있는가(`attach` 멱등) | |
| 19 | 앱을 백그라운드로 보낸 직후 알림 액션 등으로 시작 시도 | `serviceStartFailed` 문장이 들리는가("신호 약함"이 아니라) | B-3 |

**D11 실측 계획**: #1과 #1b를 첫 실보행의 첫 두 항목으로 두고 결과를 spec §4-1에 한 줄로 기록한다(성립/불성립·기기·OS·날짜).

---

## 12. 판정 목록 (강한 디폴트 — 뒤집으려면 근거)

1. **소유권 근거는 착수 프롬프트**(§2)이고 프롬프트 밖 셋은 코디네이터 판정: ① `AppSourceGuardTest` 허용 목록에 `GuideLocationStream.kt` 1줄(A안, 권고 — 제가 additive로 고치거나 m1이 추가) / B안: android-m1이 `location/LocationSource`에 `subscribeGuide(onFix: GuideRawFix)`(약 20줄) 추가 ② 루트 `.gitignore` 1줄 ③ 계획 §2에 웨이브 3 소유권 절 신설(코디네이터). `LocationManager`는 리스너마다 독립 요청이라 두 스트림이 공존한다(iOS 단일 매니저 경합 없음).
2. **`ACTIVITY_RECOGNITION`·`WAKE_LOCK` 추가**(§3-4) — 프롬프트 additive 목록 밖. 전자는 걸음 요약(거부해도 안내는 돈다), 후자는 워치독 각성(B-1 — 없으면 안전망이 절전과 함께 멎는다). 기각 시: 전자는 종료 화면을 도착 문장 + 닫기만으로, 후자는 대안이 없다(워치독 계약 불성립을 spec에 기록).
3. **음성 전경 게이트 = 전경 ∨ 화면 꺼짐**(§5-3). 실측 #3.
4. **억제 소유자 집합 인터페이스는 `guide/`에 두고 배선은 소유 세션에 요청**(받아쓰기 android-m1, 채팅 TTS M6) — 지금 소비자 0.
5. **안내 문장 채널은 TTS 하나, 시트는 live region 없음**(§5-3). 실측 #4·#16이 치명적 겹침 또는 점자 부재를 문제로 판정하면 대안: **스크린 리더 활성 ∧ 앱 전경일 때만** 문장을 접근성 채널(시트 `StatusLine` polite live region — TalkBack이 읽고 점자에도 간다)로 보내고 TTS는 그때 침묵, 그 밖(화면 꺼짐·SR 없음)은 TTS. 판정 술어 `accessibilityManager.isEnabled && isTouchExplorationEnabled ∨ 활성 서비스에 스크린 리더`. 지금은 두지 않는다(YAGNI, 이중 낭독 위험).
6. **알림 본문 탭 = 앱 전경만**(§4-3). 시트 펼침은 띠바 한 번. `MainActivity`·매니페스트 `launchMode`를 건드리지 않는 유일한 수단.
7. **통화 중(포커스 거절) 무음**(§5-2 #19): 톤·문장 둘 다 내지 않는다. ⚠ **위원장 판정 사안** — 통화 위에 안내를 겹칠지는 사용 판단이다(코디네이터 경유 확인, 실측 #15). 겹치기로 판정되면 `LOSS_TRANSIENT` 중에도 톤만 내는 갈래를 §5-2에 더한다.
8. **화면 유지는 시트가 펼쳐진 동안만**(§6-3, 리뷰 m-6) — 손에 들고 읽는 동안의 편의이고, 프로세스 생존은 FGS + wake lock의 몫.
9. **TTS usage `MEDIA`+`SPEECH`, 톤 usage `ASSISTANCE_SONIFICATION`**(코디네이터 전달 — `NAVIGATION_GUIDANCE`는 TalkBack 발화를 끊는다). 대안 `ASSISTANCE_ACCESSIBILITY`는 실측 #4 뒤.
10. **톤 길이 정본은 상수 표 + mp3 프레임 계수 드리프트 가드**(§5-1). 런타임 측정 없음.
11. **포커스는 재생 단위 획득·지연 반납, 못 잡으면 내지 않는다**(§5-2). 세션 단위 보유(GAIN)는 다른 앱 미디어를 세션 내내 끊는다(iOS `.mixWithOthers` 판정과 충돌).
12. **TTS 배율 1.0 = 호출 없음(시스템 기본)**(§5-3).
13. **알림 본문 = 상태 문장 우선, 비면 띠바 요약; 갱신은 텍스트 변화 시만**(§4-3).
14. **`ResultHaptic` 상수 켬, 추세 진동 3종은 저장값(기본 꺼짐)**(§5-4).
15. **조망은 시트 내용 교체**(중첩 다이얼로그 없음, §7-4) — 뒤로 키는 시트 안 `BackHandler`가 먼저 받는다.
16. **재조회 origin은 모델 최신 fix 15초**(§6-2).
17. **시계 하나 `elapsedRealtime`**(§2) + wake lock(타이머 축).
18. **서비스 `START_NOT_STICKY`, `onTaskRemoved` 유지, 시작 실패는 서비스 안에서 잡아 모델로 되부른다**(§4-1).
19. **`POST_NOTIFICATIONS` 거부는 차단 아님**(§3-2 ③).
20. **`res/raw` 바이트 동일 가드는 `:app` JVM 테스트**(`src/**` 금지, §5-1).
21. **`AppRoot` 변경은 `bottomBar` 한 자리**(§7-2) — 시트·띠바·손·전경 관찰·화면 유지 전부 `GuideBottomBar` 안. `ModalBottomSheet`가 그 슬롯에서 못 돌면 그때 두 자리로(보고).
22. **GPS 폴백은 NETWORK 없이 단독**(§4-2).
23. **`teardown`/`shutdown` 없음**(§3-3).

## 13. 적대적 설계 리뷰 판정

1차(2026-09-16, `~/gildongmu-wt/android-m4-reports/review-m4-design.md`, 리뷰어 opus 별도 컨텍스트, spec `3f0b44cb`): **REQUEST_CHANGES** — BLOCKER 3·MAJOR 10·MINOR 16·NIT 6, 판정 문서 D1~D13 위반 0, 서버 계약 변경 0, `:kit` 무수정 ✔. 리뷰 총평: `:kit` API 대조·iOS 처리 순서·§6-3 차이 10행·오디오 계약 1·4·5는 정확, 결함은 전부 [3] 플랫폼 수단 층. 35건 전부 반영(기각 0): B-1 세션 수명 wake lock + `watchdog dt=` 로그 + 실측 #1b / B-2 소유권 근거를 착수 프롬프트로 정정(계획 §2 인용은 오기)하고 프롬프트 밖 셋을 판정 요청으로 / B-3 서비스 시작 실패를 서비스 안 try/catch → 필수 실패 콜백 → 전용 문장 / M-1 `sessionToken` 보관·`stop()` ④ 반납 / M-2 `attach` 멱등·서비스는 모델을 매 호출 조회 / M-3 `requestFocus` void — `runCatching` 관용구 + 1회 재시도 / M-4 `android.guide.autoReroute` 신규 키 + 인용 키 전량 기계 대조 / M-5 알림 탭은 Intent 플래그로 전경만(§12-6) / M-6 전경 복귀 상환이 추적 가드보다 앞 + 합본·`onDropped` 규칙 / M-7 SoundPool을 `attach`에서 로드 + 시작 톤 보류 1개 / M-8 점자 축 실측 #16 + §12-5 대안 구체화 / M-9 간략·상세·최종 접근 경로의 상태 갱신 목록 전부 + in-flight 가드 / M-10 포커스 못 잡으면 내지 않는다 + 시나리오 #19 + 통화 중 무음 판정(§12-7) / m-1 톤 길이 상수 정본 + 프레임 계수 가드 / m-2 `utteranceId` 최신만 반납 / m-3 플랫폼 `Notification.Builder`·`startForegroundService` / m-4 걸음 기준값·72걸음 / m-5 `StateFlow<WalkGuideUiState>` / m-6 화면 유지는 시트 표시 중만 / m-7 GPS 단독 폴백 / m-8 무음 진입 래치 / m-9 제공자 꺼짐도 동기 판정 / m-10 변이 4건 교체 / m-11 shutdown 없음 명시 / m-12 `action` 경고 + Kit KDoc 정정 보고 / m-13 리소스 두 단계 변환 규칙 / m-14 동일성 집합 / m-15 알림 액션 근거·타 앱 전경 종료 무문장 표기 / m-16 `BackHandler`·androidTest ③④ / N-1~N-6(표현·`/ 1_000_000`·0.15·`android.beacon.stopped`·`suppressNextNotice` 행·`.gitignore` 보고). 같은 개정에 코디네이터 전달(TalkBack `NAVIGATION_GUIDANCE` 끊김) 반영(§5-1·§5-3·§12-9·실측 #4). 2차(diff 재리뷰)는 아래에 기록한다.
