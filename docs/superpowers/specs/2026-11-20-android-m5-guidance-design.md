# 안드로이드 M5: 자동차·대중교통 실시간 안내 설계 (2026-11-20)

> **위치**: 판정 정본 `2026-09-15-android-app-decisions.md`(D1~D13, 재논의 금지), 도보 선례 `2026-09-16-android-m4-walk-guidance-design.md`(M4)·`2026-09-27-android-walk-session-edits-design.md`(M4b), 병렬 계획 `docs/superpowers/plans/2026-11-20-android-parity-m5-parallel-plan.md` §1·§2 위에 선 M5 spec. 요구사항 정본은 `docs/BACKLOG.md` §5 E43 「M5 자동차·대중교통 안내」(2026-11-20 등가성 점검 목록)와 §4 B17(주행 중 몫)이다.
>
> **기준은 iOS 정식판(Release 구성)이다.** iOS는 2.0(2026-10-01)에서 자동차·대중교통 안내를 정식판으로 졸업시켰다. 안드로이드도 정식 기능 구성(`debug`·`release`)에 넣고 실험 게이트를 두지 않는다(계획 §1). iOS 실험판에만 있는 것(운전자 모드 피커 B1 ⑤, 채팅 경로 카드 안내 시작 E83, 나들이 E51, 상단 줄 새로고침)은 범위 밖이다.
>
> **설계 판별**(`~/.claude/reference/work-principles.md` 「설계 리뷰 판별 기준」): 이 spec은 새 세션 수단(자동차)과 세 세션이 공유할 시작 진입점·전경 서비스·시트 호스트의 모양을 정하므로 **설계 리뷰 대상**이다. 판정 계층은 `:kit`에 이미 있거나(자동차 `Car*.kt`·`GuideTuning.car`) 공유 fixture로 잠긴 이식(`CarTrafficAhead`)이라 리뷰 초점은 [3] 실행 계층의 세션 구조와 상태 전이다.

---

## 1. 세 세션의 범위 분해

M5는 **자동차(`and-m5-car`) → 대중교통(`and-m5-transit`) → 여정(`and-journey`)** 순으로 직렬이다. 앞 세션이 정한 진입점 모양이 뒤 세션의 인터페이스다.

| BACKLOG E43 M5 항목 | 세션 | 비고 |
|---|---|---|
| 자동차 안내 시작 진입점(길찾기 자동차 결과의 「자동차 안내 시작」) | 자동차 | `:kit` `canStartCarGuide` |
| 대중교통 안내 시작 진입점 | 대중교통 | §3 경계의 `startTransit` |
| 자동차 세션: 임박·주기 K2, 현재 도로 E56, 지점·방면 E61, 새 정체 E80(B17 주행 중 몫), 경유지 접근 예고, 도착·도보 인계 | 자동차 | §4 |
| 두 시트의 전화 걸기 E90 | 자동차(도보·자동차 시트) · 대중교통(대중교통 시트) | 도보·자동차 시트는 M4b 뒤 이미 제목 메뉴 첫 항목이다(§4-9) |
| 대중교통 세션 전체: 승차 후보·급행 A16, 상태 문장 E38~E41, 승차 중 현재역 E35·E48, 백그라운드 폴·톤 E36·E79, 노선 선택 E76, 잘못 내림 복구 E78, 떠난 열차 A74 | 대중교통 | |
| 도보 인계: 승차 전 도보 A25, 하차 인계 E34, 환승 도보 E73, 출구 대기 E84 | 대중교통 | `:kit` `ExitHold`·`GuideTuning.sessionIdleNoFixExitHoldSeconds`도 대중교통 몫 |
| 새 소식 시트 B27 ⑤, 도보 첫 사용 공지(`WalkGuideNoticeSheet`) 문안 | 대중교통 | 공지 문안 「대중교통과 자동차 실시간 안내는 준비 중이에요」는 대중교통 세션이 바꾼다(자동차 세션은 손대지 않는다) |
| 여정 세션 B26 | 여정 | 대중교통 통합 뒤, §7 |

자동차 세션이 이번에 하지 않는 것: 운전자 모드(듣는 사람은 정식판 기본값 동승자만), 제목 행 밀기 동작·경로 새로고침·「지금 여기는 어디?」(B16 — iOS는 2026-10-27 정식판이지만 안드로이드는 `GuideSheet.kt`를 B25 → B16 순서로 고치는 별도 묶음이다), 안내 시트 정보 띠(B25, `and-route` 몫).

## 2. 세션 공유 구조

### 2-1. 모델: 자동차는 도보 모델의 수단 축이다 (iOS `BeaconModel` 동형)

iOS는 `BeaconModel` 하나가 도보·자동차를 맡고(`sessionKind: GuideSessionKind`, `tuning`은 수단에서 유도) 대중교통은 `TransitGuideModel`이 따로다. 안드로이드도 같다: **자동차는 `WalkGuideModel`의 `sessionKind = car` 세션**이고 대중교통은 새 모델이다.

- 근거: 자동차 세션의 실행 계층(fix 파이프라인·워치독·이탈 두 축·자동 재조회·도착 창·잊힌 세션 안전망·톤 뒤 발화·E53 채널·억제 소유자 집합·종료 화면·시트·띠바·알림·전경 서비스)은 도보와 같은 코드다. 모델을 가르면 이 전부를 복제하거나 공통 기반으로 추상화해야 하고, 둘 다 iOS와의 1:1 대조(이식의 유일한 검증 수단)를 깨뜨린다. 도보 실보행으로 확정한 규칙이 자동차 쪽 사본에서 조용히 갈라지는 것이 더 큰 위험이다.
- **수단 차이의 두 층**: ① 임계·시간 상수는 `GuideTuning` 데이터다(`tuning`은 `sessionKind`에서 유도하는 계산 속성, iOS `tuning` getter 동형 — `GuideTuning.car`. 운전자 `carDriver`는 두지 않는다). 잊힌 세션 안전망(`sessionIdleNoFixSeconds` 900·무이동 축 없음)·도착 추정 임계(`PresumedArrivalThresholds.car` 두절 120초)·기하 없는 최종 접근 진입이 전부 이 데이터로 갈린다. ② 문장·통지·조회 대상이 갈리는 행동(자동차 문장 틀, ETA 재조회, 현재 도로, 경유지 접근 예고, 도착 판정 `carArrivalStep`, 걸음 센서·종료 요약 없음)은 iOS의 `sessionKind == .car` 분기를 **같은 자리에 같은 조건으로** 옮긴다. guidance 규칙의 「`sessionKind` switch 금지」는 안전망 임계를 데이터로 두라는 규칙이고(①), iOS가 분기로 둔 행동(②)을 데이터로 바꾸지 않는다.
- 이름: 클래스 이름 `WalkGuideModel`·`WalkGuideUiState`는 이번에 바꾸지 않는다(같은 웨이브의 `and-route`가 `GuideSheet.kt`·`GuideBand.kt`에서, `and-common`이 `AppRoot.kt`에서 이 이름을 쓴다 — 개명은 병렬 rebase 충돌만 낳는다). KDoc 머리에 「도보·자동차 공용(iOS `BeaconModel`)」을 적는다. 개명은 M5 끝(여정 통합 뒤) doc-audit 후보로 넘긴다.

### 2-2. 시작 요청과 진입점

```kotlin
/** iOS `BeaconModel.StartRequest`의 안드로이드 판 — 수단별 data class 둘이 한 봉인 타입을 이룬다. 어느 필드에도 기본값 없음(A4·A13). */
sealed interface BeaconStartRequest { val dest: BeaconDest; val label: String; val waypoint: GuideWaypoint? }
data class WalkStartRequest(dest, label, accessible, variant, line, alternate, waypoint) : BeaconStartRequest   // 기존 그대로
data class CarStartRequest(dest: BeaconDest, label: String, waypoint: GuideWaypoint?) : BeaconStartRequest     // 신설

object GuideSession {
    fun startWalk(request: WalkStartRequest)   // 기존 시그니처 불변
    fun startCar(request: CarStartRequest)     // 신설 — 자동차 안내의 유일한 시작 진입점
    // 대중교통 세션이 더한다: fun startTransit(request: TransitStartRequest)
}
```

- 공개 시작 함수(`startWalk`·`startCar`, 대중교통 세션의 `startTransit`)는 첫 줄에서 거부 판정 하나(`refuseIfActive()`: `isActive`면 `guide.alreadyActive`, iOS 동형)를 공유하고, 통과하면 거부 판정이 없는 비공개 본문 `beginBeacon(request)`(직전 실패 행 소거·착지 표식 초기화·주변 확인 소거 → 프리로드 → `walk.requestStart(request)`)을 부른다. 대중교통 세션이 여는 내부 인계(승차 전 도보·하차 인계)는 `beginBeacon`을 직접 부른다 — 대중교통 세션이 아직 활성이라 거부 판정을 지나면 인계가 막힌다. 자동차 도착 뒤 도보 인계는 자동차 세션이 이미 끝난 뒤라 iOS처럼 공개 `startWalk`를 지난다(§4-8).
- `WalkGuideModel.requestStart(request: BeaconStartRequest)` 하나가 받고 `lastStartRequest: BeaconStartRequest?`가 재시작(`restart()` — 정밀 위치 허용 뒤 복구)에 그대로 쓰인다. **자동차 세션이 재시작 뒤 도보가 되는 A13 동형 결함**을 타입이 막는다(요청 자체가 수단을 든다). `sessionKind`는 요청 타입에서 유도하고 따로 넘기지 않는다.
- `CarStartRequest`에는 `labelRoman`이 없다: 안드로이드 `WalkStartRequest`도 아직 라틴 표기 축(A55)이 없고 자동차는 ko 데이터에서만 시작한다(`canStartCarGuide`). 대중교통·영문 축을 더할 때 둘에 함께 더한다.
- **소스 가드**(`GuideSourceGuardTest`, iOS `guidance-gate-drift.test.ts` 정신): `startWalk(` 호출부는 `WalkGuideStartButton.kt`와 `GuideSession.acceptCarWalkHandoff`(자동차 도착 뒤 도보 인계 — §4-8) 둘, `startCar(` 호출부는 `CarGuideStartButton.kt` 하나, `walk.requestStart(` 호출부는 `GuideSession.kt` 하나로 잠근다. 대중교통 세션은 `startTransit(`을 같은 식으로 더한다.

### 2-3. 시작 버튼

- 도보: 기존 `WalkGuideStartButton`(줄 펼침 본문 첫 항목) 그대로.
- 자동차: 새 `guide/ui/CarGuideStartButton.kt`. 길찾기 결과 자동차 섹션의 **헤딩 바로 뒤, 경로 줄 앞**(iOS `DirectionsTabView` 자동차 섹션과 같은 자리)에 둔다 — `DirectionsScreen.kt`의 `is DirectionsModeOutcome.Car ->` 갈래가 이 컴포저블을 부르고 그 뒤에 `CarOutcomeRows`를 부른다(`RouteRows.kt`는 고치지 않는다). 버튼은 `canStartCarGuide(dataLocale, briefing.provider)`이고 도착지가 현재 위치가 아닐 때만 선다(죽은 버튼 금지). 시작 실패 행은 도보처럼 버튼 아래에 그린다(`lastStartKind == car`일 때).

### 2-4. 전경 서비스·알림

하나다(`GuideForegroundService`, `location` 타입). 자동차는 같은 모델이라 서비스·스트림·알림이 손대지 않고 따라온다(알림 본문은 `bandSummaryText`가 모델 상태에서 만든다). 대중교통 세션은 서비스가 fix를 넘길 곳을 고르는 한 지점(`GuideSession`의 활성 모델 라우팅)을 더한다(§3).

### 2-5. 시트 호스트·띠바

`GuideBottomBar`가 띠바와 시트를 든다. 자동차는 도보와 같은 `GuideSheet`(iOS `BeaconTrackingSheet` 공용)를 쓰고 수단 차이는 모델이 내는 줄 문장이다(§4-6). 대중교통 세션은 `GuideSession`에 어느 시트를 띄울지(`screen: GuideScreenKind { beacon, transit }`, iOS `presentedScreen` 동형)를 더하고 `GuideBottomBar`가 그것으로 시트를 고른다.

### 2-6. 오디오 채널

포커스 하나·톤 재생기 하나·TTS 하나(`GuideSession.attach`가 조립, M4 §5-2 #16). 자동차는 같은 모델이라 그대로 쓴다. 기기 음성 대기 칸(`DeviceSpeechQueue`)은 모델마다 하나다(지금 `WalkGuideModel` 안). ⚠ 2026-11-21 정정: 종전 「iOS는 세 모델 공유 칸」은 틀렸다 — iOS는 모델마다 `GuideSpeechOutput.makeDeviceQueue`로 자기 칸을 만들고 TTS 재생기 하나를 공유하며, 끊김 관찰자를 칸마다 등록한다(`TtsPlayer.observeGuidanceInterruption`이 목록). 대중교통 세션의 처방은 §6-5.

## 3. `and-m5-transit`이 받을 경계

| 자리 | 자동차 세션이 남기는 모양 | 대중교통 세션이 할 일 |
|---|---|---|
| 시작 진입점 | `GuideSession.refuseIfActive()`(거부 판정 한 곳) → 비공개 `beginBeacon`(판정 없음) · `startWalk`·`startCar` | `startTransit(TransitStartRequest)`도 `refuseIfActive()`를 먼저 부른다. 승차 전 도보·하차 인계처럼 대중교통이 도보를 여는 내부 인계는 `beginBeacon`을 직접 부르고 그 호출부를 소스 가드에 더한다. 모델 안의 `coordinator.claim`은 따로 기존 점유자를 거부하므로, 인계는 앞 모델의 `release`(그 모델 `stop()`)가 뒤 모델의 `claim`보다 먼저임을 순서로 보장한다(iOS 하차 인계의 600ms 지연 자리) |
| 세션 점유 | `:kit` `GuideSessionCoordinator`(claim·release, 메인 전용) | 대중교통 모델도 같은 코디네이터에서 claim한다 |
| 전경 서비스 | `GuideForegroundService`가 `GuideSession.walk`에 직결돼 있다: fix·위치 꺼짐·알림 문장, **알림 「안내 종료」(`ACTION_STOP` → `walk.stopByUser()`)**, **`startForeground` 실패(`walk.onServiceStartFailed`)** | 다섯 경로를 모두 활성 세션 소유자로 보내는 한 지점을 서비스에 더한다. 시작 실패는 그 시작을 요청한 세션 세대에만 전달한다(인계 직후 늦게 온 실패가 새 세션을 접지 않게). 대중교통 keep-alive(E36·A46)도 이 서비스다 |
| 시트·띠바 | `GuideBottomBar` → `GuideSheet`(도보·자동차) | `GuideScreenKind`와 대중교통 시트를 더한다 |
| 오디오 | `GuideSession.attach`의 포커스·톤·TTS | 대중교통 모델에 같은 인스턴스를 주입하고, 대기 칸은 모델마다 두되 TTS 콜백을 토큰으로 발행 모델에 보낸다(§6-5) |
| 억제 소유자 집합 | `GuideSession.setOutputSuppressed`가 `walk.outputSuppressed`만 만진다 | 두 모델에 함께 건다 |
| 도보 인계 받기 | `WalkStartRequest`(기본값 없음). 출구 인계(E84 `exitLead`)는 아직 없다 | `WalkStartRequest`에 `exitLead`를 더하고(기본값 없음) 출구 대기 창을 이식한다 |
| 전화 걸기 E90 | 도보·자동차 시트 제목 메뉴 첫 항목(기존) | 대중교통 시트 제목 메뉴에 같은 번호부(`AppConfig.placePhoneBook`)로 |

## 4. 자동차 세션 상세 (iOS `BeaconModel` `sessionKind == .car` 절단면)

판정 계층은 `:kit`에 있다: `GuideTuning.car`(임박 `max(15m, v×6초)`·표본 부족 60m·`silentCatchUp`·정숙 시간·경유지 접근 `max(150m, v×60초)`·안전망 두절 900초·무이동 축 없음·도착 추정 두절 120초·무이동 300초·150m·기하 없이 150m에서 최종 접근), `CarAction`(서버 `action` 투영), `buildCarGuide`·`roadNameAt`·`carSpokenLandmark`(E56·E61), `carArrivalStep`(40m·정지·정확도 ≤ 30m), `guideSpeechChannel`(E53). 새로 옮기는 것은 `CarTrafficAhead.kt`(E80, 공유 fixture `car-jams-ahead-cases.json`)뿐이다. 앱 층은 iOS 분기를 같은 자리·같은 조건으로 옮긴다. 문장은 iOS가 쓰는 키(`guide.car*`·`guide.currentRoad`·`guide.carRoadNow`·`ios.beacon.carWalkHandoffStart` → `android.beacon.carWalkHandoffStart`)를 그대로 쓴다(생성물에 이미 있다).

### 4-1. 시작

- 길찾기 자동차 섹션의 「자동차 안내 시작」(§2-3) → `GuideSession.startCar(CarStartRequest(dest, label, waypoint))`. 경유지는 조회에 쓴 경유지 그대로(A13).
- `requestStart`·`start`는 도보와 같은 순서다. 자동차만 다른 것: 걸음 센서·`ACTIVITY_RECOGNITION` 요청 없음(iOS `sessionStart = kind == .walk ? Date() : nil`), 로그 `session kind=car listener=passenger`, 출구 대기 없음.
- 듣는 사람은 동승자 고정이다(iOS 정식판은 설정 피커가 실험판에만 있어 저장값이 늘 기본값이다). 그래서 `tuning`은 `GuideTuning.car`, 운전자 채널(`carCommand`·`driverNotice`·`speakGuidance`)은 옮기지 않는다.

### 4-2. 경로 조회 (시작·재조회·재획득)

- `fetchDetailData`가 수단으로 갈린다: `routes.car(origin, dest, lang = dataLocale, includeGeometry = true, via, traffic = true)` → 경유지를 보냈는데 표지가 없으면 null → `provider != "tmap"`이면 null(카카오 폴백은 기하 미지원 — 간략 강등) → `buildCarGuide` 실패면 null. 결과에 `roadSpans`와 정체(`congestion?.jams`)를 싣고, 계단 회피·최종 접근 기하·라이브 조각은 없다.
- 커밋(`fetchGuideRoute` 성공): `roadSpans`·아는 정체(`knownCarJams = jams?.map(KnownCarJam)`, null이면 정보 없음)를 세션에 두고, ETA를 1회차로 세고(`etaCallCount = 1`, 응답 소요가 양수면 `etaSeconds`·`etaUpdatedAt`) 6분 주기 타이머를 켠다. 시작 문장은 `guide.carStart`(iOS `GuideText.carStart`), 현재 도로 행을 바로 계산한다.
- `traffic` 인자는 `and-route`가 `RouteService.car`에 넣는다(기본값 없음). 그 통합 전에는 안내 조회 자리를 짜 두지 않는다 — 정체 기준선 없이 시작하면 첫 재조회가 기존 정체를 전부 새것으로 말한다(E80 §5).

### 4-3. 임박·주기·원거리 예고 (K2·E61)

리듀서 이벤트별 수단 분기(iOS `consume`):

| 이벤트 | 도보 | 자동차(동승자) |
|---|---|---|
| `announceSteps`(전문) | 결정 지점까지 실위치 거리 머리말(`announceAhead`) | 머리말 없음, 유닛 문장 원문. 억제 복구의 「들어선 뒤」 문장도 유닛 전체 |
| `imminent` stage 0 | `imminentText(action, crossingClock)` | `carImminentText(action, landmark)` — 그 결정 지점 스텝의 `carLandmark`를 `carSpokenLandmark`(비-ko는 한글 이름 뺌)로 거른 지점·방면 문장(`guide.carImminentAtToward`·`At`·`Toward`), 없으면 `guide.carImminent.*` |
| `periodic` | `periodicWalk`(실위치 잔여) | `periodicCar`(리듀서 잔여): 다음 스텝에 행동이 있으면 `guide.carPeriodicAt`(지점)·`guide.carPeriodic`, 없으면 도보와 같은 종전 문장 |
| `farNotice` | 같은 `farNotice` 문장 | 같다 |
| `reacquired` | 회복 문장만 | 회복 문장 + 지금 유닛 전문(전역 재투영 뒤 다음 경계까지 침묵하지 않게, K2 §3.4) |

- 행동은 서버 `action`만 읽는다(문장 분류 폴백 금지 — 없으면 침묵). `buildCarGuide`가 이미 `CarAction.guideAction`을 스텝에 싣는다.
- 하단 2행: 윗줄·아랫줄의 행동구는 수단별(`guide.carLiveAction.*`)이고 `turnApproachMeters`가 `tuning`(속도 함수)으로 「잠시 후」 전환 시점을 정한다. 앱의 `GuideText.liveTop`·`liveNext`·`liveActionPhrase`·`progress`에 수단 인자를 더한다(iOS `kind:` 인자 동형, 기본값 없음).
- **자동차 실행 안내는 리듀서의 정숙 시간 기준을 적는다**: 억제 복구 발화·전경 복귀 갚기 뒤 `guideState.lastAnnouncedAt = now`(iOS `sessionKind == .car` 두 자리 — 경유지 접근 예고는 리듀서가 스스로 적는다, 가드 `car-waypoint-approach-guard.test.ts`의 안드로이드 판을 `GuideSourceGuardTest`에 둔다).

### 4-4. 현재 도로 (E56)

- `currentRoadText = roadNameAt(roadSpans, d)?.let { guide.currentRoad(it) }` — 진행거리를 믿을 수 있는 국면(`following`·`bundle`)의 매 fix와 커밋 지점에서 갱신하고, 같은 값이면 대입하지 않는다(커서 위 재낭독 방지). 모르면 null(줄 없음, 통지 없음). 스텝 문장을 파싱하지 않는다.
- 시트: 상세·이탈 아님·값 있음일 때 하단 2행 **앞**에 한 줄(iOS `BeaconTrackingSheet` 순서). 착지 대상 행은 아니다(E57 표: 남은 거리 → 윗줄 → 상태). 진행 상황 문장에는 `guide.carRoadNow` 머리말(§4-7).
- 전경 복귀 상환이 상태 행이 비었을 때 쓰는 문장: 자동차는 하단 2행 윗줄, 없으면 현재 도로 행(iOS `handleScenePhaseChange` 동형).

### 4-5. 주행 중 재조회와 새 정체 (E80, B17 주행 중 몫)

- 6분(`carEtaIntervalSeconds` 360) 주기, 세션당 10회(`carEtaCallCap`, 시작 조회 포함), 상세 모드·이탈 아님에서만. 횟수는 조회 전에 센다(iOS 동형 — 원점을 못 얻은 회차도 한 회). 원점은 위치 스토어가 아니라 **세션의 마지막 수용 fix**이고, iOS `currentCoordinate()`의 추적 중 재사용 게이트와 같은 술어 `canReuseCachedFix(정확도, 나이)`(정확도 ≤ 30m·나이 ≤ 60초, 나이는 **측정 시각** 기준)를 지나야 한다 — 그래서 모델은 마지막 fix의 정확도와 측정 시각을 좌표와 함께 둔다. 지나지 못하면 이번 회차는 조용히 직전 ETA를 유지한다(낡음 판정은 `etaUpdatedAt`이 맡는다).
- 응답 커밋 가드: 조회 토큰·추적 중·상세·목적지 동일·소요 > 0. 그러면 ETA 갱신 → 남은 거리 행 갱신 → `announceNewCarJam`.
- `announceNewCarJam` 호출부 규칙 넷(iOS·웹 동형, **이 순서로 검사한다**): ① `provider == "tmap"`이고 정체 정보가 있는 응답만 ② 응답 시점에 이탈이면 아무것도 바꾸지 않는다(기준선 채택도 하지 않는다 — 이탈 중 받은 정체가 복귀 뒤 경로의 기준선으로 굳지 않게) ③ 아는 정체가 null(기준선 없음)이면 이번 정보를 말없이 기준선으로 ④ 보류 통지(`deferredAnnouncer.hasPending`)·기기 음성 대기 칸·**TTS가 말하는 중**(`speaker.isSpeaking`)이면 밀어내지 않고 건너뛴다 — 안드로이드 전경 발화는 앞 문장을 끊으므로(README §3 안내 음성 채널) 말하는 중 판정이 iOS보다 더 필요하다. 판정은 `newCarJamsAhead(polyline, totalMeters, d, known, fresh)`, 알릴 하나만 아는 정체에 더하고, 통지가 버려지면(`onDropped`) 되돌린다. 문장 `guide.carNewJam`(도로 이름 있음)·`guide.carNewJamUnnamed`, 분류 `actionable`.
- 진행 상황 문장: ETA가 `carEtaStaleSeconds`(420) 넘게 낡았으면 `guide.etaStale` 병기(3-state — 낡은 값을 지금 값처럼 말하지 않는다).
- 남은 시간: 자동차는 ETA 카운트다운이고 경유지 목표엔 없다(null — 날조 금지).

### 4-6. 안내 시트·띠바 (`GuideSheet.kt`는 `and-route` 통합 뒤)

- 제목 헤딩: `beacon.carHeading`(도보 `beacon.walkHeading`).
- 정보 행 순서(상세): 남은 거리 → **현재 도로** → 윗줄(지금 할 일) → 아랫줄(다음 안내) → 상태. 간략 강등이면 종전대로 상태 행.
- 제목 메뉴(전화 걸기 → 장소 상세 → 목적지 바꾸기)와 경유지 추가·변경·삭제는 자동차에서도 같다(iOS 동형). 조망의 「대안 경로 보기」는 도보만(`alternativePreviewAvailable`이 도보 조건).
- 이탈: 상태 행·윗줄은 벗어난 쪽만(도보와 같은 규칙), 시계 문장은 `guide.carOffRouteClock`·`guide.carOffRouteBehind`(도보 `offRouteReturnClock`·`offRouteTurnBack`), 상태 행의 국면 문장은 도보와 같은 `guide.offRoute`다(의도된 iOS 차이: iOS `carOffRoute`는 안드로이드에 없는 「경로 새로고침」을 가리킨다, B16). E69 「경로 다시 조회」는 도보와 같은 조건(자동 판정이 손을 든 회차).
- `B25` 정보 띠가 들어오면 자동차도 같은 띠를 쓴다(현재 도로 행은 띠 밖 — iOS는 띠 비율 1:2:1에 현재 도로를 넣지 않는다).

### 4-7. 진행 상황(「진행 상황 듣기」)

`progress(…, walk = false)` 문장 앞에 현재 링크 도로(`guide.carRoadNow`), 뒤에 ETA 낡음(§4-5)을 붙인다 — 진행거리를 믿을 수 있는 국면에서만.

### 4-8. 도착과 도보 인계

- 도착은 최종 접근 단계에서 `carArrivalStep(distance, accuracy, motion)`(40m·정지·정확도 ≤ 30m, 15m 무조건 분기 없음). 자동차는 최종 접근 기하가 없어 진입 서술이 없고(`entersFinalApproachWithoutGeometry`), 도착 추정은 `PresumedArrivalThresholds.car`(두절 120초·무이동 300초·150m 이내, `guide.arrivedPresumed`)다 — 도보와 같은 코드가 데이터로 갈린다.
- `arrivalSessionKind`를 `stop()` **앞**에서 기록한다(`stop()`이 수단을 도보로 되돌린다 — iOS 설계 리뷰 B10). 종료 화면에 걸음 요약이 없고, 「여기서 도보 안내 시작」(`android.beacon.carWalkHandoffStart`) 버튼이 선다 → `GuideSession.acceptCarWalkHandoff()`: 종료 화면 소거 → 같은 목적지·경유지 없음·계단 회피 없음·줄 없음으로 `startWalk`(같은 모델이라 대중교통 인계의 600ms 지연 없음).
- 도보 인계 버튼은 종료 화면의 체중 권유 두 줄 자리 다음, 주변 확인 앞(iOS 순서).

### 4-9. 전화 걸기 (E90)

도보·자동차 시트는 M4b 뒤 이미 제목 메뉴 첫 항목이 「전화 걸기」다(`guideTitleMenuItems`, 번호는 `AppConfig.placePhoneBook.guideDestinationPhone`). 자동차는 같은 시트라 추가 구현이 없다. 확인할 것: 길찾기 도착지를 고른 자리가 번호를 적는다(`noteDestination` — 끝점 검색, `and-common` 소유) → 자동차 세션에서도 메뉴 항목이 선다(JVM 테스트 한 건).

### 4-10. 잊힌 세션 안전망·백그라운드 음성

- 안전망: `sessionIdleStep(fix 두절, 무이동 = null, tuning.sessionIdleNoFixSeconds)` — 자동차는 900초·무이동 축 없음(데이터). 터널 안에서 끝나지 않게 한 위원장 판정(2026-10-03).
- 백그라운드 음성(E53): 채널 술어 `guideSpeechChannel`이 수단을 모른다(분류만 본다). 자동차 동승자는 도보와 같이 행동 문장만 기기 음성으로(토글 켬), 주기·상태 문장은 백그라운드에서 버린다. 새 정체 문장은 `actionable`이라 잠금 중에도 말한다.

### 4-11. 톤

도보와 같은 계층(`toneLayerStep`)이고 정지 fix는 톤을 내지 않는다(E55). 자동차가 다른 것은 임계가 `tuning`인 것뿐이다(재생기 불변).

### 4-12. 검증

- `:kit`: `CarTrafficAheadTest`(공유 fixture `car-jams-ahead-cases.json` 전수, Swift `CarTrafficAheadTests` 미러), `GuideStartTest`.
- 앱 JVM(`WalkGuideModelTest` 페이크 레인 — 위치 fix를 직접 넣고 TTS·톤 페이크의 발화 목록을 본다): 자동차 시작이 `routes.car(includeGeometry, traffic)`를 부르고 카카오·기하 없음이면 간략 강등 / 임박 문장이 지점·방면을 싣고 `action` 없으면 침묵 / 현재 도로 행이 링크 경계에서 바뀌고 이름 없는 링크면 사라짐 / ETA 재조회 6분·10회 캡·이탈 동결 / 새 정체 규칙 넷과 되돌림 / 도착 40m·정지에서 종료 화면 + 도보 인계 버튼 → 도보 세션 시작 / 재시작(`restart`)이 자동차로 다시 시작(A13) / 잊힌 세션 900초.
- 소스 가드(`GuideSourceGuardTest`): 시작 호출부(§2-2), 자동차 정숙 시간 기록 두 자리, `routes.car(` 안내 호출이 `traffic = true`와 `includeGeometry = true`를 싣는다.
- 실기기(한소네 7, 실내): 길찾기 자동차 결과에 「자동차 안내 시작」이 헤딩 바로 뒤에 들리는가, 누르면 시트 제목이 「자동차 안내」로 열리고 시작 문장이 들리는가, 제목 메뉴의 전화 걸기가 다이얼 화면을 여는가, 안내 종료. 주행이 필요한 항목(임박·현재 도로·정체·도착 인계)은 실주행 판정으로 BACKLOG §2에 남긴다.

## 5. 설계 리뷰 판정 (codex adversarial-review 1회, 2026-11-20)

| 지적 | 판정 | 반영 |
|---|---|---|
| 자동차 ETA 재조회 원점이 나이만 보면 정확도 나쁜 좌표로 조회한다 | 수용(iOS `currentCoordinate()` 추적 중 재사용 게이트와 어긋난 사실) | §4-5 `canReuseCachedFix`·측정 시각 |
| 거부 판정을 `beginBeacon` 안에 두면 내부 인계가 같은 함수로 거부 없이 지날 수 없다(모순) | 수용 | §2-2·§3: 공개 함수의 `refuseIfActive()` + 판정 없는 `beginBeacon` |
| 전경 서비스의 알림 종료·시작 실패가 도보 모델에 직결돼 있는데 경계 표에 없다 | 수용(대중교통 경계 누락) | §3 전경 서비스 행 |
| 새 정체 규칙의 검사 순서가 이탈 전에 기준선을 채택한다 | 수용(iOS 순서와 다른 서술) | §4-5 순서 명시 |
| 도보 인계 실패 시 종료 화면이 먼저 사라져 실패 문장·복구 버튼 자리가 없다 | 기각 — iOS `acceptCarWalkHandoff`와 같은 순서이고, 인계 직전 자동차 세션이 정밀 위치 권한·위치 켬을 방금 충족했다(실패 문장은 낭독·진동으로 나간다) | — |
| 경로 재획득(목적지·경유지 변경)마다 ETA 횟수가 1로 돌아간다 | 기각 — iOS `fetchGuideRoute`가 같은 자리에서 같은 값을 쓴다(사용자가 연 재획득만 늘린다, 미러 우선) | — |

## 6. 대중교통 세션 상세 (`and-m5-transit`, iOS `TransitGuideModel`·`GuideSession` 대중교통 절단면)

> 설계 판별: 새 세션 모델과 두 모델이 공유하는 경계(전경 서비스·오디오·시트 호스트·도보 인계)의 모양을 정하므로 설계 리뷰 대상이다. 판정 계층은 `:kit`에 있다(`TransitGuide`의 리듀서 `transitGuideStep`·`initTransitGuide`·`buildTransitGuideRoute`·폴 주기 `transitPollIntervalMs`, `TransitGuideText`·`TransitGuideTone`·`TransitIdle`·`TransitProgressOverview`·`TransitTrackService`, 단계 1이 옮기는 `ExitHold`·`TransitTransferWalk`·`TransitWrongStopRecovery`·`TransitBackgroundTone`·`TransitRidingPosition`·`TransitBusStop`과 노선 선택 E76 함수). 앱 층은 iOS를 같은 자리·같은 조건으로 옮긴다. 낭독 문장은 iOS가 쓰는 `transitGuide.*` 키 그대로다(iOS 앱 코드가 쓰는 136키가 안드로이드 생성물에 모두 있다, 2026-11-21 대조).

### 6-1. 모델 구조

- **`guide/TransitGuideModel.kt` 한 클래스**(iOS `TransitGuideModel.swift` 1:1, 함수 이름·순서 동일). 도보 모델과 나누는 이유는 iOS와 같다(§2-1): 상태 기계가 리듀서 `transitGuideStep`이고 fix 파이프라인이 없다. 파일을 기능별로 쪼개지 않는다 — iOS와 줄 단위로 대조하는 것이 이식의 유일한 검증 수단이다(`WalkGuideModel.kt`와 같은 판단).
- **관찰 상태는 `ui: StateFlow<TransitGuideUiState>` 하나**(도보 `WalkGuideUiState` 동형). iOS `@Observable`이 뷰에 내보내는 값(`state`·`route`·`waitingLive`·`waitingDeparted`·`waitingReason`·`pendingWalkHandoff`·`pendingDestChange`·`pendingAltRoutes`·`pendingRecovery`·`ridingPosition`·`busStopMark`·`boardOverrideIndex`·`reboardPickerActive`·`aboardStep`·`expressBlockedNote`·`idlePaused` 등)만 담고, `@ObservationIgnored`인 것(폴 작업·장부·세대·캐시)은 모델의 비공개 필드다. 시트의 파생 값(iOS 계산 속성 `overview`·`viaStopHereIndex`·`currentLeg`·`isOnFinalLeg`·`finalLegWalkMinutes`)은 모델의 공개 함수로 둔다.
- **포트**(전부 생성자 주입, 기본값 없음): `routes: RouteService`(목적지 전환·다른 경로·잘못 내림 복구 재조회), `track: TransitTrackService`, `position: TransitPositionService`, `strings`, `dataLocale`, `controller: GuideForegroundController`(§6-4), `permissions: GuidePermissions`(keep-alive 판정은 현재 권한만 읽고 요청하지 않는다 — iOS 「대중교통 시작은 권한 요청 지점이 아니다」), `tones`, `speaker`, `haptics`, `env: GuideEnvironment`, `coordinator`, `scope`, `clock`. 같은 포트 인스턴스를 두 모델이 공유한다(§6-5). 기기 음성 대기 칸(`DeviceSpeechQueue`)은 모델이 자기 것을 만든다(iOS 동형).
- **문장 렌더러**: `guide/TransitGuideTextRenderer.kt`(iOS `TransitGuideTextRenderer.swift` 미러) — Kit `TransitGuideText`의 구조화 줄을 앱 문자열로 조립한다. 언어 판정 `transitGuideIsEn`은 iOS와 같은 술어(데이터 로케일이 en)를 앱 함수로 둔다.
- **세션 점유**: `coordinator.claim(stop = { stop() })`(iOS 동형). 모델 입구 둘(`start`·`startAfterPrewalk`)은 `GuideSession.isActive`면 거부 통지(`guide.alreadyActive`)를 내고 돌아간다 — iOS가 모델 입구에서도 거부하는 것과 같다(외부 시작은 `GuideSession`이 먼저 걸러 여기까지 오지 않는다).

### 6-2. 수명과 상태 전이

| 입구 | iOS | 안드로이드 |
|---|---|---|
| 시작 | `start(transitRoute:destinationLabel:destinationRoman:dest:accessible:aboard:)` | `start(route, destinationLabel, dest, accessible)` — `aboard`(E71 지금 탄 열차)는 iOS에서도 여정(`startJourney`)만 넘기므로 여정 세션(`and-journey`)이 인자를 더한다. `destinationRoman`은 §2-2처럼 세 요청에 함께 더할 때까지 없다(데이터 로케일 ko 전제) |
| 도보 뒤 시작 | `startAfterPrewalk(guideRoute:startLeg:…:prewalkCompleted:)` | 같은 이름·인자, `prewalkCompleted` 기본값 없음(걸어서 닿았으면 그 구간의 도보 문맥을 지운 경로 — `withoutWalkBefore`) |
| 정지 | `stop(playStopTone:)`·`stopForTransferWalk()`(여정 훅 보존)·`clearWalkHandoff()`·`teardown()` | 같다. 여정 훅(`onJourneyRideCompleted`·`onJourneyStopped`·`journeyNextIsWalk`)은 필드만 두고 여정 세션이 배선한다 |
| 전경 전이 | `handleScenePhaseChange` | `setForeground(foreground)`(도보 동형 — `GuideSession.setForeground`가 두 모델에 넘긴다). 복귀 인계(`deviceSpeech.handOver()`)가 추적 가드 **앞**인 순서, 복귀 즉폴, 버린 통지가 있을 때만 현재 상태 한 문장(`returnStatusText`) |

- 상태 전이는 전부 리듀서다: 입력(`TransitGuideInput` — 폴 결과·사용자 선언·전진)을 `dispatch`가 넣고, 나온 이벤트를 `handle(event)`가 톤·통지로 바꾼다(iOS `dispatch`·`handle`·`announcementText` 그대로). 앱이 국면을 직접 쓰지 않는다.
- 사용자 동작(iOS `board`·`confirmBoarded`·`boardApprox`·`advance`·`advanceIntoWalkHandoff`·`beginReboard`·`cancelReboard`·`changeBoarding(at:)`·`changeBoarding()`·`cancelChangeBoarding`·`boardAlready(express:)`·`beginAboard`·`pickAboardStation`·`boardAboard`·`declareArrived`·`refreshWaiting`·`announceProgress`)은 같은 이름의 공개 함수다. 전부 `touchUserAction()`(유휴 재개)을 지난다.
- 급행(A16): 대기 목록의 종착 차단·급행 병기·급행 확인 프롬프트(`expressPrompt`)는 iOS 판정 그대로.
- 떠난 열차(A74): 폴이 사라진 후보를 `retained`에 180초 보존하고 「N분 전 떠남」 줄(`waitingDeparted`)을 만든다(iOS `retainSeconds`).
- 하차 인계 신호: 마지막 구간 완료(`completeOrAdvance`)가 `stop()` 뒤에 `pendingWalkHandoff`(`TransitWalkHandoff(destinationLabel, walkMinutes, exitAlight, alightLat, alightLng)`)를 남긴다 — 한 턴 수명 신호이고 같은 턴에 `GuideSession.acceptWalkHandoff()`가 소비한다(§6-6).
- 환승 도보 신호: 다음 구간 앞 도보가 걷기 안내 대상(`transitTransferWalkTarget`)이면 전진을 커밋하지 않고 `GuideSession.transitTransferWalk(TransitTransferWalkHandoff(…))`를 부른다(§6-6).

### 6-3. 폴과 유휴

- 폴 루프는 코루틴 하나(`pollJob`, iOS `pollTask`)다: `restartPollLoop(immediate)` → 주기 `transitPollIntervalMs(state)`(0이면 즉폴도 없음, A37) → 매 회차 직전 `enterIdleIfDue()` → `pollOnce()`(도착 정보 `track`) → `refreshPosition(seq)`(승차 중 현재역 E35, 도착 폴 계측 밖) → 다음 주기. 잘못 내림 복구 중·유휴 정지 중엔 예약하지 않는다.
- 취소 가드: 폴 결과는 세대(`phaseGen`·`seq`·세션 토큰)가 맞을 때만 `dispatch`한다. 복귀 즉폴이 옛 작업을 취소하고 그 결과를 버리는 것이 3-state 방어선이다(iOS 설계 리뷰 O2 — 백그라운드에서 끊긴 요청이 `failed`로 도착해 「조회 실패」를 지어내지 않게).
- 유휴 정지(E36): 마지막 조작 뒤 `transitIdlePollLimitMs(legMinutes)`가 지나면 폴·keep-alive를 멈추고 정지음 + `transitGuide.idlePaused`(분류 `deferrable`). 재개는 사용자 조작·전경 복귀(`transitGuide.resumed` + 상태, 즉시 창구 `highPriority`).
- 백그라운드 톤(E79): `playTone(tone, allowedInBackground)`의 허용 집합은 Kit `transitToneAllowedInBackground`(단계 1 이식). 정지 fix 같은 도보 규칙은 없다(대중교통 톤은 리듀서 이벤트에서만 난다).

### 6-4. 전경 서비스: 소유자 한 지점과 keep-alive

**판정**: 서비스는 하나(`GuideForegroundService`, `location` 타입)이고, 서비스의 다섯 경로(fix·위치 꺼짐·알림 문장·알림 「안내 종료」·`startForeground` 실패)는 `GuideSession.serviceOwner()` 한 지점이 고른 소유자에게 간다.

```kotlin
/** 전경 서비스가 말을 거는 세션 쪽 — 도보·자동차(`WalkGuideModel`)와 대중교통(`TransitGuideModel`)이 구현한다. */
interface GuideServiceOwner {
    val locationProfile: StateFlow<GuideLocationProfile?>   // null = 서비스가 필요 없다
    val notificationText: Flow<Pair<String, String>>        // (제목, 본문) — 서비스는 distinctUntilChanged만
    fun handleServiceFix(fix: GuideFixPayload)
    fun handleProviderDisabled()
    fun stopFromNotification()                               // 알림 「안내 종료」 = 시트의 안내 종료와 같은 함수
    fun onServiceStartFailed(generation: Int, error: Throwable)
    val serviceGeneration: Int?                              // 이 모델이 지금 쥔 서비스 요청의 세대(없으면 null)
}
enum class GuideLocationProfile { beacon, keepAlive, keepAliveBus }
```

- **소유자 선택**: `serviceOwner()` = 도보 모델이 시작 중이거나 추적 중이면 도보, 아니면 대중교통이 추적 중이면 대중교통, 아니면 null(서비스는 `stopSelf`). 매 콜백 시점에 조회하고 인스턴스를 붙들지 않는다(종전 규칙 유지). 둘이 동시에 추적하는 순간은 코디네이터 점유가 막는다(인계는 앞 모델 `stop()`이 뒤 모델 `claim`보다 먼저).
- **세대는 다섯 경로 전부에 붙는다**(설계 리뷰 반영): `GuideForegroundController.start(generation: Int)`. 세대는 `GuideSession.nextServiceGeneration()`이 하나씩 올려 주고, 요청한 모델이 `serviceGeneration`으로 든다(정지하면 null). 서비스는 받은 세대를 지금 세대로 들고(재사용 시작이면 새 세대로 바꾸고 알림·프로파일 구독을 새 소유자로 다시 건다), fix·위치 꺼짐·스트림 열기 실패·알림 「안내 종료」 인텐트(PendingIntent extra에 발급 당시 세대)·`startForeground` 실패를 모두 세대와 함께 `GuideSession`에 넘긴다. 세션은 `serviceOwner()?.serviceGeneration == 세대`일 때만 전달하고, 아니면 로그 한 줄로 버린다 — 인계 직후 앞 세션의 늦은 이벤트가 새 세션을 끝내지 않게.
- **동기 시작 거부**: Android 12+는 백그라운드에서 `startForegroundService` 호출 자체가 예외(`ForegroundServiceStartNotAllowedException`, Android 14+ 위치 타입은 `SecurityException`)로 거부된다 — 서비스 안의 실패 콜백까지 가지 않는다. 컨트롤러가 이 예외를 잡아 같은 세대의 시작 실패로 넘긴다(도보는 세션 실패, 대중교통은 아래 keep-alive 규칙).
- **도보·자동차**: 지금 동작 그대로(프로파일 `beacon` = 1초·고정밀, 실패 = 세션 실패 `onServiceStartFailed`).
- **대중교통 keep-alive**(E36·A46·E48, iOS `updateKeepAlive`): (boarding ∨ riding) ∧ 폴 주기 > 0 ∧ 유휴 아님 ∧ **위치 권한이 이미 있음**이면 서비스를 켜고, 아니면 끈다. 권한이 없으면 열지 않고 세션당 로그 한 줄(`keepAlive denied`) — 권한 창을 띄우지 않는다. 프로파일은 버스 승차 중 정류장 표식이 적용될 때(`transitBusStopApplies`) `keepAliveBus`(고정밀·1초·거리 필터 없음, iOS 10m급·필터 없음), 그 밖 `keepAlive`(`QUALITY_LOW_POWER`·간격 60초·최소 거리 500m, iOS 1km급·500m). 서비스는 프로파일이 바뀌면 스트림을 다시 연다. **시작 실패는 세션을 끝내지 않는다**(iOS `startKeepAliveUpdates`가 false를 돌려주는 것과 같은 자리): 로그 한 줄, keep-alive 꺼진 채 계속(전경 폴은 돈다).
- **wake lock**: 대중교통 keep-alive도 서비스 수명 wake lock을 든다(폴 코루틴이 절전에서 멎지 않게 — iOS에선 keep-alive 위치 갱신이 앱을 깨워 둔다). 대기 국면(waiting)에 화면을 끄면 iOS처럼 폴이 멎을 수 있다 — iOS 정본 동작이고 복귀 즉폴이 갚는다. ⚠ boarding·riding에서도 관측 공백은 생길 수 있다: Doze(정지한 채 화면이 꺼진 기기)는 wake lock을 무시하고 네트워크를 막는다. 새 동작을 더하지 않고(iOS도 같은 백그라운드 제약이 있고 3-state 신호가 공백을 「모름」으로 말한다) 실승차 판정 항목으로 남긴다: 화면을 끈 채 승차해 도착·하차 문장이 제때 나는가, 늦었으면 복귀 낭독이 마지막 관측 시각을 정직하게 말하는가(BACKLOG §2, 진입점 단계가 행을 만든다).
- **원함과 가동을 가른다**(설계 리뷰 반영): 모델은 `keepAliveWanted`(iOS `updateKeepAlive`의 판정)와 `keepAliveRunning`(서비스가 실제로 떴는가)을 따로 든다. keep-alive를 켜는 흔한 전이(대기 → boarding)는 사용자 선택(전경)이라 걸리지 않고, riding은 boarding에서 켜진 서비스의 프로파일만 바꾼다(A46). 그러나 리듀서가 추정 도착(arrived)에서 재관측으로 riding에 돌아오는 전이는 화면이 잠긴 채 일어날 수 있고, 그때는 서비스가 이미 꺼져 다시 켜야 한다 — 백그라운드라 거부되면 원함은 남고 가동은 거짓이며, **전경 복귀(`setForeground(true)`)가 원함을 다시 판정해 켠다**. JVM 테스트에 「잠금 중 추정 도착 → 재관측 → 시작 거부 → 복귀 시 가동」을 넣는다.
- **keep-alive fix**: 대중교통의 `handleServiceFix`는 버스 정류장 판정(`transitBusStopStep`)과 하차 정류장 한 마디(A69)만 먹는다(iOS `ingestKeepAliveFix`, 리듀서 입력이 아니다).
- **알림**: 제목은 대중교통 시트 제목 문자열, 본문은 띠바 문장(`guideBandSummary`)이다. 알림 「안내 종료」는 시트의 「안내 종료」와 같은 함수(정지음 + 정지 문장).

### 6-5. 오디오·억제

- 포커스·톤 재생기·TTS·진동은 `GuideSession.attach`가 한 벌 만들어 두 모델에 주입한다(§2-6). **의도된 iOS 차이**: iOS 대중교통은 톤 재생기를 따로 든다(`BeaconTonePlayer(label: "transit")`). 안드로이드는 재생기 하나(M4 §5-2 #16)이고 세션이 동시에 둘 돌지 않으므로 iOS의 「소유권 이전(`.ownershipTransferred`)」 장치는 필요 없다. 인계 순서(앞 세션 정지음 → 600ms → 뒤 세션 시작음)는 같은 재생기에서 그대로 난다.
- **기기 음성 대기 칸은 모델마다 하나**(iOS 동형, §2-6 정정): 대중교통 모델이 자기 `DeviceSpeechQueue`를 만든다. 전경 복귀의 인계(`handOver()`)는 각 모델이 **자기 칸에서만** 꺼내므로 다른 모델의 문장을 가져가지 않는다(설계 리뷰 반영 — 공유 칸이었다면 먼저 복귀한 모델이 남의 문장을 비웠다). 세션 경계마다 `deviceSpeech.reset()`(E53 §4.2 ⑤)은 자기 칸만 비운다.
- **TTS 콜백은 토큰으로 발행 모델에 간다**: TTS 포트의 콜백 둘(`speaker.onInterrupted(token, reason)`, `TtsGuideSpeaker(onPendingDropped)`)은 지금 `walk`에 직결된 단일 콜백이다. `GuideSession`이 한 번 받아 **두 모델 모두에** 넘기고, 각 모델은 자기가 발행한 토큰일 때만 반응한다(iOS 관찰자 목록 동형 — 칸이 `isSpeakingToken`으로 자기 토큰을 가린다). `onPendingDropped`는 보류 문장의 토큰을 실어 보내도록 바꾼다(지금 인자 없음) — 승차 전 도보 시작 문장(대중교통이 냄)의 초기화 실패 버림이 곧 시작한 도보 모델의 `missedAnnouncement`를 세우지 않게.
- **억제 소유자 집합**: `setOutputSuppressed(active, owner)`가 두 모델의 `outputSuppressed`를 함께 건다. 이전 값(`suppressionPrior`)은 모델마다 따로 든다. 대중교통의 `outputSuppressed` 해제는 iOS처럼 억제 중 버린 마지막 문장(`droppedWhileSuppressed`)을 한 번 다시 낸다(버스 하차 한 마디는 제외, iOS 설계 리뷰 2차).

### 6-6. 시작과 도보 인계 (`GuideSession`, iOS `GuideSession` 대중교통 절단면)

```kotlin
/** 대중교통 안내 시작 요청 — 기본값 없음. */
data class TransitStartRequest(val route: TransitRoute, val destinationLabel: String, val dest: BeaconDest, val accessible: Boolean)

object GuideSession {
    fun startTransit(request: TransitStartRequest)   // isAttached → refuseIfActive() → beginTransit(request)
    private fun beginTransit(request: TransitStartRequest)          // 승차 전 도보 판정(A25)이 여기서 갈린다
    fun acceptWalkHandoff()                           // 하차 인계(E34) — 대중교통 시트의 「남은 도보 안내 시작」
    fun transitTransferWalk(handoff: TransitTransferWalkHandoff)  // 환승 도보(E73)·잘못 내림 복구의 걷기(E78)
    fun transitPassedPrewalk()                        // A68: 탔다·경로를 바꿨다 → 승차 전 도보 재시작 줄을 거둔다
    fun restartBeacon()                               // 길찾기 [정확한 위치 허용] 재시작의 유일한 경로(A13·A68)
}
```

- **승차 전 도보(A25)**: `beginTransit`이 `buildTransitGuideRoute` → `transitPrewalkTarget`으로 첫 승차 앞 도보가 걷기 대상인지 본다. 대상이면 `PrewalkContext`(id·경로·시작 구간 0·목적지·계단 회피·역 라벨·도보 분·`isTransfer = false`·`lead = null`)를 세우고 `launchPrewalk` → 승차역까지 도보 세션을 **`beginBeacon`으로**(거부 판정 없음 — §3) 연다. 아니면 곧장 `transit.start`.
- **`launchPrewalk`**(iOS 동형): 컨텍스트 저장 → `prewalkRestart` 저장 → `walk.markPrewalk(station, transfer)` → `walk.onSessionEnd = { reason -> endPrewalk(context.id, reason) }` → 시작 문장(`transitPrewalkStartLine`, 환승은 `highPriority`)을 대중교통 창구로 → 도보 시작 → 동기 거부면 곧장 `endPrewalk(id, startFailed)`.
- **`endPrewalk(id, reason)`**: id가 다르면 무시. `arrived` → 600ms 뒤 `transit.startAfterPrewalk(prewalkCompleted = true)`. `startFailed` → 도보 모델의 원인·다리 문장이 끝나기를 기다렸다가(`walk.announcementsSettled()`를 100ms마다, 상한 8초 — iOS는 VoiceOver가 켜졌을 때만 기다리지만 안드로이드는 안내 문장이 늘 TTS라 늘 기다린다) `startAfterPrewalk(prewalkCompleted = false)`. 환승 도보 중 `locationLost` → 600ms 뒤 같은 대기 후 `prewalkCompleted = true`. 그 밖(`userStopped`·`locationLost`·`ended`)은 아무 문장도 내지 않는다(도보 모델이 사유 뒤에 이미 붙였다).
- **도보 모델 쪽 신설**: `enum class BeaconEndReason { arrived, startFailed, userStopped, locationLost, ended }`와 `onSessionEnd` 훅(정지 경로마다 사유를 한 번), `markPrewalk`·`clearPrewalk`(승차 전 도보 표식 — 시작 문장·정지 꼬리 문장 「대중교통 안내도 종료했습니다」(환승)·다리 문장(A67 시작 실패 「도보 안내를 시작할 수 없어 승차 대기로 바로 넘어갑니다」)이 이 표식을 읽는다). 문장은 iOS `BeaconModel`의 해당 자리 키 그대로.
- **하차 인계(E34·E84)**: 마지막 구간 시트의 「남은 도보 안내 시작」 → `transit.advanceIntoWalkHandoff()`가 참이면 `acceptWalkHandoff()`: 인계 값에서 출구(`transitValidExitNo(exitAlight)`)와 하차역 좌표로 `ExitLead`를 **`stop()` 전에** 읽고 → `transit.stop()` → `clearWalkHandoff()` → 600ms 뒤 공개 `startWalk(WalkStartRequest(…, exitLead))`(대중교통이 이미 끝나 거부 판정을 그대로 지난다 — iOS `startBeacon` 동형. §3 표의 「하차 인계는 `beginBeacon`」은 이것으로 고친다). 잘못 내림 복구의 「걸어가기」는 인계 값 없이 들어와 출구가 실리지 않는다(iOS 동형).
- **환승 도보(E73)**: `transitTransferWalk(handoff)` → `transit.stopForTransferWalk()`(정지음 없음) → 600ms 뒤 점유가 없으면 `launchPrewalk(isTransfer = true, lead = handoff.lead)` + `beginBeacon`, 점유가 있으면 버린다(로그 `transferWalk abandoned`).
- **600ms 대기 작업은 `prewalkJob` 한 칸**이고 외부 시작 진입이 `cancelPrewalk()`로 함께 취소한다(iOS `prewalkTask`). ⚠ **연결이 스스로 연 도보 시작은 취소하지 않는다**(설계 리뷰 반영, iOS `launchingPrewalk`): `launchPrewalk`가 `launchingPrewalk = true` 아래에서 `beginBeacon`을 부르고, `beginBeacon`은 `if (!launchingPrewalk) { retirePrewalkRestart(); cancelPrewalk() }`다 — 이 예외가 없으면 방금 세운 컨텍스트를 지워 `endPrewalk(id)`가 도착을 버리고 역에서 안내가 끊긴다. JVM 테스트는 실제 `beginBeacon`을 지나 도착 600ms 뒤 지정 구간이 열리는지(승차 전 도보·환승 도보 둘) 본다. 하차 인계의 대기는 `walkHandoffJob` 따로(iOS 동형).
- **출구 대기(E84)**: `WalkStartRequest.exitLead: ExitLead?`(기본값 없음, `ExitLead(exit, stationLat, stationLng)`). 도보 모델이 출구 문장 `guide.exitLeadStart`를 첫 시작류 통지 앞에 한 번 싣고(`exitLeadPrefixNeeded`), Kit `ExitHold` 창을 연다 — 창 동안 fix 게이트와 잊힌 세션 안전망 두절 임계(`GuideTuning.sessionIdleNoFixExitHoldSeconds`)를 iOS `BeaconModel`의 `openExitHold`·`exitHold` 자리 그대로 따른다. 자동차·다른 도보 시작 호출부는 `exitLead = null`을 명시한다. `restart()`는 `lastStartRequest`의 출구를 그대로 다시 쓴다(iOS `exitHold?.lead`).
- **재시작(A13·A68)**: 길찾기 실패 줄의 [정확한 위치 허용]은 `walk.restart()` 직접 호출(지금 `WalkGuideStartButton.kt`)을 `GuideSession.restartBeacon()`으로 바꾼다 — 직전 시작이 승차 전 도보였으면 연결을 다시 걸어 도착 뒤 대중교통으로 잇는다. `retirePrewalkRestart`의 거두는 자리는 iOS 그대로(승차 전 도보가 아닌 시작·대중교통이 그 계획을 지나감).
- **소스 가드**(`GuideSourceGuardTest` ①-2를 넓힌다): `startTransit(` 호출부는 대중교통 시작 버튼 파일 하나, `beginBeacon(` 호출부는 `GuideSession.kt` 안의 공개 시작 함수 둘·승차 전 도보·환승 도보·`restartBeacon` 자리, `startWalk(`은 기존 둘에 하차 인계 하나, `transit.start(`·`startAfterPrewalk(` 호출부는 `GuideSession.kt` 하나, `walk.restart()` 호출부는 `GuideSession.kt` 하나.

### 6-7. 시트·띠바

- **`GuideSession.screen: GuideScreenKind?`**(`beacon`·`transit`, iOS `screen` 동형): 도보 모델에 화면이 있으면 `beacon`(인계 600ms 창에서 도보가 이긴다), 아니면 대중교통이 추적 중이거나 `pendingWalkHandoff`가 있으면 `transit`. `hasScreen`·띠바·`reopenAfterNestedScreen`은 이 값을 본다. `GuideBottomBar`가 이 값으로 `GuideSheet` 또는 새 `TransitGuideSheet`를 고른다(한 호스트, 두 시트를 따로 띄우지 않는다 — iOS 설계 리뷰 M2).
- **`guide/ui/TransitGuideSheet.kt`**(iOS `TransitTrackingSheet.swift` 1:1): 행 순서는 iOS `sheetBody` 그대로(제목 → 상태 문장 → 경유역 목록 → 국면 컨트롤 → 공통). 국면별 컨트롤 집합·버튼 라벨·작업 메뉴 순서는 iOS 그대로이고, 줄은 `mergedRow` 한 접근성 객체(§4 「한 줄 = 한 객체」), 낭독용 거리 풀어쓰기를 줄 이름에 얹지 않는다(A75).
- **착지**(E38 위원장 판정): 시트 진입·국면 전이·역 선택 취소 복귀·띠바 복귀의 착지 대상은 **상태 문장 행 하나**다. 예외는 자기 질문을 여는 화면(역 선택 질문 헤딩·급행 확인 헤딩·차량 선택 목록 라벨)과 목적지 전환·잘못 내림 복구 상태 행. 안드로이드 착지 기구는 도보 시트의 `GuideSheetLanding`(첫 정보 행 착지·배경 이월·`sheetReturnSeq`)을 대상 키만 바꿔 쓴다.
- **제목 메뉴**: 전화 걸기(E90, `AppConfig.placePhoneBook.guideDestinationPhone`, 번호가 없으면 항목 없음) → 장소 상세 → 목적지 바꾸기 — 도보 시트 `guideTitleMenuItems`와 같은 번호부·같은 순서(iOS 대중교통 시트 제목 메뉴와 대조해 다르면 iOS를 따른다).
- **띠바**: 대중교통이면 Kit `guideBandSummary`(목적지 변경 대기 > 하차 인계 > 국면, 이미 이식돼 있다)의 문장.

### 6-8. 검증

- `:kit`: 단계 1 이식 파일마다 Swift 테스트 미러 + 공유 fixture 전 케이스(`exit-hold-cases`·`transit-riding-position-cases`·`transit-bus-stop-cases` 등).
- 앱 JVM(페이크 레인 — `WalkGuideModelTest`·`CarGuideModelTest` 선례, 도착 정보·위치 조회는 페이크 서비스, 시계는 가짜 시계): 모델 단계는 iOS `TransitGuideModel`의 각 공개 함수가 낸 발화 목록·국면·폴 예약을 본다(시작 문장, 대기 → 탑승 → 승차 → 도착 → 다음 구간, 완료와 `pendingWalkHandoff`, 유휴 정지·재개, 백그라운드 톤 허용 집합, 떠난 열차 180초, 취소 가드가 옛 폴 결과를 버림). 경계 단계는 서비스 소유자 선택·다섯 경로의 세대 거름(인계 직후 앞 세션의 위치 꺼짐·알림 종료가 새 세션을 끝내지 않음)·동기 시작 거부·keep-alive 원함과 가동의 분리와 복귀 재시도·프로파일 전환·억제 집합·TTS 콜백의 토큰 라우팅·두 모델이 붙은 상태에서 도보·대중교통 각각의 잠금 해제 낭독. 인계 단계는 승차 전 도보 도착 → 600ms → 대중교통 시작 구간, 시작 실패 → 통지 대기 → 대중교통, 환승 도보, 하차 인계의 출구 실림, 재시작이 연결을 다시 거는 것.
- 소스 가드: §6-6 호출부 표, 서비스 콜백이 `GuideSession.walk`를 직접 부르지 않음(`serviceOwner()`만).
- 실기기(한소네 7, 실내): 시작 진입점 단계에서 처음 닿는다 — 대중교통 결과 줄 펼침의 시작 버튼, 시트 제목·상태 문장 착지, 차량 선택 목록, 제목 메뉴 전화 걸기가 다이얼 화면을 여는 것까지, 안내 종료. 실승차가 필요한 항목(도착 관측·승차 중 현재역·하차 인계·출구 대기·환승 도보·잘못 내림 복구·백그라운드 폴)은 BACKLOG §2 실승차 판정 행으로 남긴다.

### 6-9. 단계 분해와 각 단계가 남기는 인터페이스

계획 문서의 순서(모델 → 서비스·오디오 → 시트 → 시작 진입점 → 도보 인계 → 공지)에서 **시작 진입점을 도보 인계 뒤로** 옮긴다: 승차 전 도보(A25)가 `beginTransit` 안에서 갈리므로 진입점을 여는 순간 인계가 있어야 하고, 하차 인계가 없으면 마지막 구간의 「남은 도보 안내 시작」이 죽은 버튼이다. 진입점 전 단계는 사용자가 닿지 않는 코드로 통합한다(플래그·실험 게이트 없음). 진입점 전 단계에는 화면을 띄울 길이 없으므로 한소네 점검은 진입점 단계에서 전 구간을 한 번에 본다(그 전 화면 단계는 코드 리뷰·접근성 감사·Compose 단위 테스트).

| 단계 | 내용 | 남기는 인터페이스 |
|---|---|---|
| 1 (이 세션) | §6, `:kit` 이식(§6 머리) | Kit 함수·타입(등록부 `mirrors/guide.json` ported) |
| 2 모델 핵심 | `TransitGuideModel` 수명·폴·유휴·전경 전이·리듀서 배선·통지·톤·사용자 동작 전부(A16·A74 포함)·`TransitGuideTextRenderer`·`TransitGuideUiState`. 서비스·세션 배선 없음(포트 페이크) | `TransitGuideModel` 생성자(§6-1 포트), `start`·`startAfterPrewalk`·`stop`·`stopForTransferWalk`·`setForeground`, `ui`, `pendingWalkHandoff`, `keepAliveWanted: StateFlow<GuideLocationProfile?>`(판정만, 서비스는 아직) |
| 3 모델 확장 | 승차 중 현재역 E35(`refreshPosition`)·버스 정류장 E48(`handleServiceFix`)·노선 선택·잠금 E76·잘못 내림 복구 E78·목적지 전환·다른 경로 | 같은 클래스의 공개 함수(iOS 이름) |
| 4 서비스·오디오 경계 | §6-4·§6-5: `GuideServiceOwner`·세대·프로파일·wake lock·알림 문장, `GuideSession.transit`·`attach` 조립, `DeviceSpeechQueue`·TTS 콜백 라우팅, 억제 집합, `GuideScreenKind` | `GuideSession.transit`, `serviceOwner()`, `screen` |
| 5 시트 | §6-7 `TransitGuideSheet`·`GuideBottomBar` 선택·띠바·착지·제목 메뉴 E90·경유역 장소 상세 | 시트가 부르는 모델 함수 |
| 6 도보 인계 | §6-6 승차 전 도보·하차 인계·환승 도보·복구 걷기·출구 대기 E84·재시작 A68·도보 모델 훅 | `GuideSession.startTransit`(아직 호출부 없음), `acceptWalkHandoff`, `transitTransferWalk` |
| 7 진입점·공지 | 길찾기 대중교통 경로 줄 펼침 첫 항목의 시작 버튼(iOS `beacon.guideStartTransitAlt`, 조건 `buildTransitGuideRoute != null`, 경로마다) — `DirectionsScreen.kt`가 대중교통 줄에 슬롯을 넘기고 `RouteRows.kt`는 슬롯 자리만, 시작 실패 줄(`lastStartKind`에 대중교통 표식), 새 소식 시트(B27 ⑤)·`WalkGuideNoticeSheet` 문안, BACKLOG E43 M5 갱신과 §2 실승차 행, 한소네 전 구간 | — |

- 단계마다 `origin/main`에 통합한다. 문맥이 크게 불어나면 그 단계에서 끊고 통합 보고 인계 절에 남은 단계를 적는다.
- 단계 2·3은 iOS 한 파일을 두 번에 나눠 옮기므로, 단계 2는 단계 3 몫의 필드·분기를 **빈 자리 없이 비워 두지 않는다**: iOS 함수가 단계 3 기능을 부르는 자리는 단계 2에서 그 호출을 빼고 `// 단계 3: <iOS 함수 이름>` 한 줄을 남긴다(단계 3이 grep으로 전수 회수). 이 표식은 단계 3 통합 때 0이어야 한다(소스 가드).

### 6-10. 설계 리뷰 판정 (codex adversarial-review 1회, 2026-11-21)

| 지적 | 판정 | 반영 |
|---|---|---|
| 모든 `beginBeacon`이 `cancelPrewalk()`를 부르면 승차 전 도보가 자기 연결을 지운다 | 수용(iOS `launchingPrewalk` 예외 누락) | §6-6 600ms 항목 |
| 세대가 시작 실패에만 붙어 앞 세션의 늦은 위치 꺼짐·알림 종료가 새 세션을 끝낸다 | 수용 | §6-4 세대 다섯 경로 |
| 잠금 중 추정 도착 → riding 복귀에서 서비스 재시작이 동기 예외로 거부된다 | 수용 | §6-4 동기 시작 거부·원함과 가동 분리 |
| 공유 대기 칸이면 먼저 복귀한 모델이 남의 문장을 꺼낸다 | 수용 — 처방은 iOS 사실(모델마다 칸)로 | §2-6 정정, §6-5 |
| 토큰 없는 보류 버림이 다음 모델에 기록된다 | 수용 | §6-5 토큰 라우팅 |
| Doze에선 boarding·riding도 폴이 멎는다 | 부분 수용 — 서술을 고치고 실승차 판정 항목으로 남긴다. 새 상태 표시는 iOS 정본에 없어 더하지 않는다 | §6-4 wake lock 항목 |

## 7. 여정 상세 (`and-journey`, B26 — iOS E70·E70-e·E71·E77 정식판)

> 설계 판별: 세션 셋(도보·자동차·대중교통)을 잇는 상위 상태 기계와 그 점유·화면·전경 서비스의 모양을 정하므로 **설계 리뷰 대상**이다. 판정 계층은 `:kit` `Journey.kt`(단계 1 이식, `journeyStep` 전이 표·`JourneyShape`·`journeyNeedsAccessWalk`·`journeyTransferGuess`·aboard 묶음, 공유 fixture `journey-step-cases`·`journey-transfer-guess`·`journey-station-pairs`·`journey-display-names`·`journey-line-names`)에 있고, 앱 층은 iOS `GuideSessionCoordinator.swift` 여정 몫·`DirectionsTabView.swift`·`DirectionsEndpointSearchView.swift`·`JourneyResultRows.swift`·`JourneySheet.swift`를 같은 함수 이름·같은 순서·같은 문장 키로 옮긴다. 낭독 문장은 iOS가 쓰는 `ios.journey.*` 85키(안드로이드 생성물 `android_journey_*`에 전부 있다, 2026-11-21 대조)와 기존 키 그대로다.

### 7-1. 범위·게이트·비목표

- **게이트는 데이터 로케일 ko 하나**(iOS `journeyInputEnabled = AppLanguage.dataLocale == "ko"`, 정식판 포함 — 실험 플래그는 iOS에서 졸업해 없다). 입력 컨트롤·조회가 여정으로 가는 조건·최근 경로의 여정 문장과 역 복원·출발지 시트의 「지하철역 검색」 행이 모두 이 술어 하나를 본다(안드로이드 `dataLocale == "ko"`, `canStartCarGuide`와 같은 관용구). 로케일이 ko 밖으로 바뀌면 지금 탄 열차를 푼다(iOS `onChange(of: journeyInputEnabled)` → `clearAboard()`).
- **범위**: 입력(E77 입구 버튼 하나 → 검색 → 확인 질문, 역·정류장 칸, 남은 쪽 추가, 「갈아탈 역/정류장 지우기」), 정류장 줄(E70-e), 지금 탄 열차(E71 출발지 시트 행·노선/방면 단계 줄), 여정 조회와 3-state, 결과 줄과 「안내 시작」, 최근 경로의 역 필드(기록·복원·줄 문장), 여정 안내 세션(§7-3)과 여정 시트(§7-5).
- **비목표**: 채팅 여정 카드(E70-b, 이 작업 뒤 B29 — §7-8), iOS 실험판 전용(나들이 E51 등). 웹 여정(E70-f)은 참고만.

### 7-2. `:kit` (단계 1, 완료 커밋 `b2488083`)

`Journey.kt`(iOS `Journey.swift` 전부, `JourneyTuning`은 여기 정의로 합치고 `TransitTransferWalk.kt` 임시본 삭제), `models/RouteModels.kt` 여정 모델, `RouteService.journey`·`journeyStops`·`JourneyStationQuery`, `RecentSearchStore.kt`의 `RecentStation`·`JourneyStationKind`(관용 디코딩)·`RecentRoute.boardStation`/`alightStation`. Swift 테스트 57건 = Kotlin 57건. ⚠ `RecentRoute`의 두 역 필드는 앱 컴파일 때문에 `pinned` 뒤 기본값 `null`로 들어갔다 — **단계 4가 기본값을 지우고**(안전 인자 규율) 앱의 `togglePin` 재구성(`DirectionsViewModel` — 지금 역 필드를 떨군다)을 `copy(pinned = …)`로, `recordRoute` 호출을 역 필드 명시로 바꾼다.

### 7-3. 세션 조율 (`GuideSession` 여정 몫, iOS `GuideSessionCoordinator` E70 절 1:1)

```kotlin
/** 여정 계획(iOS `JourneyPlan`) — 기본값 없음. `aboard`는 안전 인자(E71). */
data class JourneyPlan(val variant: JourneyVariant, val egress: EgressOption?, val destLabel: String, val dest: BeaconDest, val aboard: TransitAboardStart?) { val shape: JourneyShape }
/** 지금 탄 열차에서 시작(iOS `TransitAboardStart`) — `direction`은 updnLine 원문. */
data class TransitAboardStart(val direction: String)
/** 여정 실패의 원인(iOS `journeyFailure` 튜플) — 그 모델이 이미 낸 실패 문장 키와 해결 수단. */
data class JourneyFailure(val key: String, val resolution: FailResolution)
/** 여정 시트가 관찰하는 값(Compose 수집용, iOS `@Observable` 몫). */
data class JourneyUiState(val phase: JourneyPhase, val failure: JourneyFailure?)

object GuideSession {
    val journeyUi: StateFlow<JourneyUiState?>          // null = 여정 없음
    val isOccupied: Boolean                             // isActive || journey != null
    fun startJourney(plan: JourneyPlan)                 // 길찾기 여정 결과의 「안내 시작」만 부른다
    fun journeyAction(event: JourneyEvent)              // 시트 버튼 입구 — 누른 순간의 token을 싣는다
    private fun advanceJourney(event: JourneyEvent, token: JourneyToken)   // 단계가 끝나는 사건의 유일한 입구
    private fun prepareJourneyStage(stage, token, delayed, waitsForWalkSpeech)
    private fun startJourneyStage(stage, token)         // begin*을 부르는 여정 쪽 유일한 자리
    private fun launchJourneyBeacon(request: BeaconStartRequest, token)
    private fun finishJourney(stopSessions: Boolean)
}
```

- **이름 결정**: iOS `JourneyPlan.destRoman`은 두지 않는다(대중교통·도보 요청에 라틴 표기 축이 없고 여정은 ko 전용, §2-2). 택시 단계의 `carListener: .passenger`는 안드로이드에 운전자 모드가 없어 자리째 없다(청취자는 늘 동승자).
- **점유 두 층**(iOS 빌더 점검 1): `isActive`(코디네이터 점유 ∨ 도보 시작 대기)는 그대로 — 모델 입구 셋(`walk.requestStart`·`transit.start`·`startAfterPrewalk`)이 본다. 새 `isOccupied = isActive || journey != null`을 `refuseIfActive()`와 `restartBeacon()`의 거부 판정이 본다(여정 중 외부 시작·정밀 위치 재시작은 「이미 안내 중입니다」). 여정이 없으면 `isOccupied == isActive`라 기존 동작 불변.
- **시작** `startJourney`: `isAttached` → `refuseIfActive()` → `cancelPrewalk()` → `retirePrewalkRestart()` → `walk.clearArrival()` → `transit.clearWalkHandoff()` → `JourneyState.start(id, plan.shape)` → 첫 단계 `advanceJourney(Prepared(first))`(준비 없이 곧장 — 여정 시트가 한 턴 끼지 않게).
- **전이** `advanceJourney`: `journeyStep` 결과가 `Ignore`면 반환, `End`면 `finishJourney(stopSessions = event == UserEnded)`, `Next`면 커밋 뒤 국면별로 — `Transitioning(stage)`: 실패 원인 소거, 버튼 사건(`TaxiDropped`·`TaxiBoarded`)이면 도는 도보·자동차 세션 `walk.stop()`, `prepareJourneyStage(delayed = event != Retry, waitsForWalkSpeech = 접근 도보 시작 실패 다리)`. `Running(stage)`: `startJourneyStage`. `Failed`: 준비 작업 취소, 원인 = (동기 거부가 아니고 사건이 `StageEnded(ended|startFailed)`)면 `walk.lastFailure`, 30초 초과(`StaleTimeout`)면 상태 문장을 한 번 `highPriority`로 낸다.
- **준비** `prepareJourneyStage`: `journeyJob` 한 칸(취소·교체), 시작 시각 기록(단조 시계, 30초 상한용) → `delayed`면 `JourneyTuning.handoffDelayMs` → `waitsForWalkSpeech`면 `walk.announcementsSettled()`를 100ms마다 상한 8초(§6-6 `endPrewalk`처럼 안드로이드는 늘 기다린다 — 안내 문장이 늘 TTS) → 접근 도보면 **캐시 위치**(force 없음, iOS `currentCoordinate(force: false)`)로 `journeyNeedsAccessWalk`가 거짓이면 `transit`으로 → `advanceJourney(Prepared(ready))`. 측위 실패면 접근 도보를 시작한다(빠진 안내보다 군더더기가 낫다).
- **단계 시작** `startJourneyStage`: 첫 줄 가드 `journey?.token == token && !walk.starting && !walk.isTracking && !transit.isTracking && plan != null` — 거짓이면 로그, 지금 token이면 `StageEnded(startFailed)`(세션 없는 running에 멈추지 않게). 단계별:
  - `taxiIn`·`access`: 승차 지점(`variant.boardStation`) 없으면 시작 실패. `walk.markChained(arrivalText = 버스면 android.journey.arrivedStop / 아니면 android.journey.arrivedStation(표시 이름), bridgesStartFailure = stage == access)`, 접근 도보면 `walk.markPrewalk(TransitLabel(board.name), transfer = false)`도. `launchJourneyBeacon(taxiIn이면 CarStartRequest(dest, label, waypoint = null), 아니면 WalkStartRequest(dest, label, accessible = false, variant = null, line = null, alternate = null, waypoint = null, exitLead = null))`. 라벨은 버스면 정류장 이름 원문, 아니면 표시 이름 + 「역」.
  - `transit`: 훅 배선 — `transit.onJourneyStopped = { advanceJourney(TransitStopped, token) }`, 역 B 지정이면 `onJourneyRideCompleted = { advanceJourney(RideCompleted, token) }`·`journeyNextIsWalk = shape.hasEgressWalk` → `beginTransit(TransitStartRequest(variant.transit, 목적지 라벨(역 B 지정이면 그 역·정류장, 아니면 plan.destLabel), dest(같은 규칙), accessible = false), aboard = plan.aboard)` → 불변식(대중교통도 도보도 서지 않음)이 깨지면 로그 + 시작 실패.
  - `egress`: `plan.egress` 없으면 시작 실패. 출구 종류별 `markChained(android.journey.arrivedExit(label) | arrivedStand | null, bridgesStartFailure = false)` → 도보 시작(목적지 = 출구 좌표, 라벨 = `option.placeName`).
  - `taxiOut`: chained 아님(여정의 마지막 세션 — 일반 자동차 종료 화면을 남긴다). `CarStartRequest(plan.dest, plan.destLabel, null)`.
- **`launchJourneyBeacon`**: `walk.onSessionEnd = { r -> advanceJourney(StageEnded(JourneyStageEnd.from(r)), token) }`(`locationLost`·`ended` → `ended`) → `launchingJourneyStage = true` → `beginBeacon(request)` → false → 동기 거부(시작 대기도 추적도 아님)면 `walk.clearPrewalk()`·`ignoreFailureCause = true`·시작 실패·`false`.
- **`beginBeacon` 예외 확장**(iOS 동형): `if (!launchingPrewalk) retirePrewalkRestart()`, `if (!launchingPrewalk && !launchingJourneyStage) cancelPrewalk()`. 여정 단계가 건 종료 훅을 지우지 않게.
- **`beginTransit(request, aboard: TransitAboardStart?)`**: 공개 `startTransit(request)`은 `beginTransit(request, aboard = null)`. `aboard != null`이면 승차 전 도보 판정을 건너뛴다(iOS `guard … aboard == nil`). `transit.start(route, destinationLabel, dest, accessible, aboard)`와 `transit.startAfterPrewalk(…)` 안의 시작 본문은 `aboard` 인자를 기본값 없이 받는다(`startAfterPrewalk`는 늘 `null`).
- **승차 전 도보와의 교차**(iOS 다섯 자리 그대로): `launchPrewalk`의 `prewalkRestart = if (journey == null) context else null`, `endPrewalk` 도착·재개 뒤 대중교통이 서지 않았고 여정이 `Running(transit)`이면 시작 실패, **환승 도보 중 위치 상실(`locationLost && context.isTransfer`)은 먼저 갈라 여정 훅을 둔 채 같은 구간 승차 대기로 재개**(`resumeTransitAfterWalkSpeech(prewalkCompleted = true)`, 지금 안드로이드 갈래 그대로), 그 밖의 사용자 정지·위치 상실·끊김이면 `TransitStopped`, `transitTransferWalk`가 점유로 버려질 때 `Running(transit)`이면 시작 실패, 하차 인계(`acceptWalkHandoff`)는 여정 안에서 쓰지 않는다(역 B 지정이면 `.done`이 `onJourneyRideCompleted`를 부르고 인계 신호를 세우지 않는다 — 대중교통 모델에 이미 있다).
- **전경 복귀**: `setForeground(true)`에서 `Transitioning`이 `JourneyTuning.staleTransitionSeconds`(30초)보다 오래면 `advanceJourney(StaleTimeout)`(조용한 영구 대기 금지). 시계는 주입된 단조 시계.
- **`finishJourney(stopSessions)`**: 상태·계획·원인·준비 작업·시각을 지우고 대중교통 훅 셋을 비운다. `stopSessions`(여정 시트 「안내 종료」)면 `cancelPrewalk()` 후 도는 세션을 정지음과 함께 멈춘다. 서비스 보유(§7-4)도 여기서 푼다.
- **도보 모델 쪽 신설**(iOS `BeaconModel` 동형): `JourneyChainMark(arrivalText: String?, bridgesStartFailure: Boolean)`, `markChained(arrivalText, bridgesStartFailure)`(기본값 없음, `requestStart` 앞에 건다), `endsWithoutScreen = prewalkTarget != null || journeyChain != null`(여정 단계 세션은 종료 화면을 남기지 않고 잊힌 세션 안전망이 돌지 않는다), 도착 문장 = `arrivalText ?: 기본`, 접근 도보 시작 실패는 `android.journey.accessFailedWith(원인)` 한 통지(`highPriority`, 상태 줄은 원인만), `stop()` 앞에서 표식을 캡처. `lastFailure: JourneyFailure?`(실패 문장 키·해결 수단 — `fail`·`stopAndFail`이 세우고 시작마다 비운다). 자동차 확정 도착도 `endsWithoutScreen`이면 종료 화면과 「여기서 도보 안내 시작」을 만들지 않고 `onSessionEnd(arrived)`만 낸다(iOS `taxiArrived` 자리).
- **대중교통 모델 쪽**: `start`의 `aboard`(iOS `TransitGuideModel.start` 385~418): `aboardStarted = aboard != null && startLeg == 0 && 첫 leg 지하철 && viaStops 비지 않음`이면 `aboardDirection = aboard.direction`·`aboardStartLandingPending = true`·`aboardStep = pickVehicle`·`boardOverrideIndex = 0`, 시작 통지에 대기 문맥을 붙이지 않는다. 열차 후보 풀은 `journeyAboardTrainItems(candidates, aboardDirection)`(지금 근사 자리 — 「여정 이식 때 Kit 함수로 바꾼다」 주석 — 를 Kit 함수로), `boardAboard`의 방향 재확인. 여정 중인가(`inJourney`, iOS `GuideSession.journey != nil`)는 지금처럼 여정 훅 배선으로 본다(대중교통 단계 동안 둘은 같은 값이다).

### 7-4. 전경 서비스: 여정 동안 단계 경계에서 내리지 않는다 (안드로이드 고유)

**문제**: 단계 세션이 끝나면 지금 서비스는 내려간다(`controller.stop(gen)` → `stopService`). 택시 확정 도착 → 접근 도보, 출구 도착 → 택시처럼 **누르지 않은 자동 인계**는 화면이 꺼진 채(주머니 속) 일어나기 쉽고, 600ms 뒤 다음 단계가 `startForegroundService`를 부르면 Android 12+는 백그라운드 시작으로 거부한다(공식 문서 「Restrictions on starting a foreground service from the background」: 이미 전경 서비스가 돌았다는 사실은 면제 사유가 아니고, 14+ 위치 타입은 `SecurityException`). 접근 도보는 대중교통으로 넘어가지만(전이 표) 택시 단계는 실패 시트에서 멈춘다. iOS에는 이 제약이 없다.

**판정**: 여정이 살아 있는 동안에는 서비스를 **이어받는다**.

- **여정 보유자**: `GuideSession` 안의 `JourneyServiceHolder : GuideServiceOwner`. `serviceOwner()` = 도보(시작 중·추적 중) > 대중교통(추적 중이고 서비스 세대를 쥠) > **여정 보유자(여정 있음)** > null. 보유자의 `locationProfile`은 `keepAlive`(저전력 — 위치 값은 쓰지 않는다, 서비스·wake lock을 살려 두는 몫), 알림 문장은 도는 단계 세션의 것(없으면 제목은 기존 알림 채널 이름, 본문은 여정 상태 문장 `journeyStatusText`), `handleServiceFix`·`handleProviderDisabled`는 무시(로그), 알림 「안내 종료」는 `journeyAction(UserEnded)`, 시작 실패는 해당 없음(보유자는 서비스를 **시작하지 않는다**).
- **넘김**: `controller.stop(gen)`이 지금 세대의 정지를 받았을 때 여정이 있고 실패 국면이 아니면(`keepForJourney()`) `stopService` 대신 보유자에게 새 세대를 주고 떠 있는 서비스에 **프로세스 안 호출로** 넘긴다(서비스의 재사용 시작 경로 — 세대 교체·알림·프로파일 구독 재결속). ⚠ 재결속은 정지 호출 안에서 하지 않고 **다음 메인 턴**에 한다(설계 리뷰 반영): `WalkGuideModel.stop()`은 `controller.stop`을 부른 뒤에 `serviceGeneration`·추적 표식을 비우므로, 그 안에서 재결속하면 `serviceOwner()`가 아직 도보를 돌려줘 결속이 세대 불일치로 끝난다. 그 사이 서비스 이벤트는 컨트롤러의 지금 세대(보유자 것)와 맞지 않아 버려진다. 다음 단계 모델의 `controller.start(gen)`은 서비스가 떠 있으면(컨트롤러가 든 생존 표식, 정지 요청 시 동기로 내린다) 역시 프로세스 안 호출로 넘기고 `startForegroundService`를 부르지 않는다. 떠 있지 않으면 종전대로 시작한다(전경 첫 단계 등).
- **풀기**: `finishJourney`가 보유를 풀고, 그때 소유자가 보유자뿐이면 서비스를 내린다. 여정 대중교통 단계에서 대중교통이 keep-alive를 원하지 않는 동안(대기)에도 보유자가 서비스를 든다 — 여정 밖 대중교통(대기 중 서비스 없음)과 다른 **의도된 차이**이고, 효과는 대기 폴이 화면을 끈 동안에도 wake lock 아래서 도는 것이다.
- **권한**: 보유자는 서비스를 시작하지 않으므로 권한 창도 새 거부 경로도 없다. 첫 단계가 서비스 없이 시작됐으면(대기 중인 대중교통) 넘길 서비스가 없고 종전 동작이다.
- **실패 국면은 들지 않는다**(설계 리뷰 반영): `Failed`를 커밋할 때 보유자만 서비스를 들고 있으면 내린다(여정 상태·실패 원인은 남는다). 실패 시트의 재시도·해결 수단은 사용자 동작이라 전경에서 종전 경로로 다시 시작한다. 잠금 화면에 둔 실패 시트가 위치 구독과 wake lock을 무기한 쥐지 않게.
- **세대 거름이 넘김을 통과하도록 고친다**(설계 리뷰 반영, 세대가 바뀌는 모든 재사용 시작에 해당): ①알림 「안내 종료」 `PendingIntent`는 세대마다 다른 requestCode로 발급한다 — 지금은 requestCode 하나에 `FLAG_UPDATE_CURRENT`라 새 알림이 옛 PendingIntent의 extra까지 새 세대로 바꿔 거름을 통과한다. ②위치 리스너의 `onFix`·`onProviderDisabled`는 등록 시점의 세대를 캡처하고, 재결속은 옛 리스너를 먼저 해제한다 — 지금은 콜백 실행 시점의 가변 `generation`을 읽어 옛 리스너의 늦은 콜백이 새 세대로 전달된다.
- **배경 자동 인계의 권한**(설계 리뷰 반영): 여정 단계가 연 도보·자동차 시작(`markChained`·`launchingJourneyStage`)은 앱이 전경일 때만 권한을 묻고, 배경이면 현재 허용값만 읽는다 — 걸음·알림은 없으면 없는 대로 시작하고, 위치가 없으면 묻지 않고 곧장 시작 실패(`beacon.denied`·`settings`, 실패 시트가 「설정 열기」를 준다). 지금 `GuidePermissionsImpl.ask()`는 결과가 오지 않으면 60초를 기다리고, 여정은 이미 `Running(access)`라 30초 복구도 닿지 않는다.
- **구현(단계 2)**: 판정은 `guide/GuideServiceRelay.kt`(안드로이드 의존 없음, `GuideServiceRelayTest`), 실제 조작은 `AndroidGuideController`가 붙인다(시작·정지·`GuideForegroundService.live` 재결속·메인 핸들러). 소유자 순서는 도보 > 서비스를 쥔 대중교통 > 여정 보유자 > 서비스 없이 대기하는 대중교통(여정 밖 동작 불변). 배경에서 권한을 묻지 않는 조건은 표식이 아니라 「여정이 살아 있다」다(표식 없는 taxiOut·대중교통 단계가 연 승차 전 도보도 포함, 코드 리뷰 반영). 대중교통 유휴 정지는 보유를 푼다(잊힌 여정이 wake lock을 밤새 쥐지 않게). 보유자 알림은 여정 국면과 대중교통 상태 둘 다를 따라간다. 배경 인계의 걸음 센서는 포트에 현재 허용값 읽기가 없어 이미 허용돼 있어도 쓰지 않는다(여정 단계 세션은 종료 화면이 없어 걸음 요약이 쓰일 자리가 없다).
- **넘길 서비스가 없는 여정**(대기 중 대중교통으로 시작): 화면을 끈 뒤 첫 서비스 시작(자동 승차 승격의 keep-alive)이 거부되면 §6-4 「원함과 가동」 규칙 그대로 — 원함만 남고 전경 복귀가 다시 켠다. 새 동작은 없다.

### 7-5. 안내 화면

- **화면 종류**: `GuideScreenKind`에 `journey`를 더한다. `guideScreenKind(walk, transit, journey)` = 도보 화면 > 대중교통(추적·하차 인계 신호) > 여정(`Transitioning`·`Failed`) > null(`Running`은 그 단계 세션의 시트 — 정지 직후 한 턴 동안 여정 시트가 끼어 깜빡이지 않게). `GuideBottomBar`가 `journey`면 새 `guide/ui/JourneySheet.kt`를 고른다(한 호스트).
- **`JourneySheet`**(iOS `JourneySheet.swift`): 상태 문장 한 줄(`journeyStatusText`: 실패가 아니면 `directions.loading`, 실패면 원인 키 → 단계별 `android.journey.egressStartFailed` · `taxiOutFailed`(taxiIn·taxiOut) · `route.transit.error`(transit·access)) → 실패일 때만: 해결 수단(`settings` → 「설정 열기」, `precise` → 「정확한 위치 허용」 승인 시 `Retry`), 「경로 다시 조회」(`guide.rerouteButton`, `stage != egress || failure != null`), `taxiIn`이면 「자동차에서 내렸어요」, `egress`면 「자동차에 탔어요」 → 「안내 종료」(`UserEnded`). 버튼은 누르기 전에 상태 문장 행으로 커서를 옮긴 뒤 사건을 보낸다(누른 버튼이 사라지는 전이). 착지는 **실패일 때만** 상태 문장 행(준비 중엔 곧 다음 단계 시트가 덮는다). 띠바 문장도 `journeyStatusText`.
- **도보·자동차 시트**: 여정 `Running(taxiIn)`이면 「자동차에서 내렸어요」, `Running(egress)`이면 「자동차에 탔어요」 버튼 하나를 「안내 종료」 위에 둔다(iOS `journeyStageButton`).
- **대중교통 시트**: `journeyNextIsWalk != null`이면 마지막 구간에서 인계 버튼 자리가 「다음 구간」(`transitGuide.advance`)이고 누르면 `advance()`만(다음 단계는 `.done` 콜백이 연다).
- **여정 중 숨김**(iOS `journey == nil` 조건 자리 전수): 제목 메뉴 「목적지 바꾸기」, 경유지 추가·변경, 대안 경로 보기(조망 동작), 대중교통 「다른 경로」. 바꾸면 계획과 갈라진다(iOS 판정 25). 구현은 iOS 소스의 `journey == nil`·`journey != nil` 전수를 대조표로 옮긴다.
- 문자열은 안내 문자열 표(`GuideStrings.kt`)에 매핑과 가드를 함께 넣는다(없는 키는 실행 중 던진다).

### 7-6. 길찾기 화면 (입력·조회·결과·최근 경로)

- **모델**(`DirectionsViewModel`, iOS `DirectionsModel` 여정 몫 1:1): 상태 `boardStation`·`alightStation: RecentStation?`, `aboardOrigin: AboardOrigin?`(역·노선·방면), `aboardDirectionsState`(idle·loading·loaded·lines·unavailable·failed), `journeyOutcome`(`Found`·`NoRoute`·`Failed`·`AboardNoRoute(opposite)`), `journeyVariantIndex`·`journeyEgressIndex`, `pendingTransfer`. 함수 `setJourneyStation`·`clearJourneyStations`·`clearJourneyStation`·`setJourneyStations`·`startAboard`·`loadAboardDirections`(15초 상한, 세대 가드)·`settleAboardDirections`·`chooseAboardLine`·`chooseAboardDirection`·`retryAboardDirections`·`clearAboard`·`performJourney`. 배타 규칙: 역 칸·경유지·지금 탄 열차는 서로 지운다(D14·R12), `swap()`은 두 역 칸도 맞바꾸고 aboard면 아무것도 안 한다, `setEndpoint(from)`은 aboard를 푼다.
- **조회**: `runQuery`가 ko ∧ (역 칸 ∨ aboard)면 `performJourney`로 간다(aboard인데 ko 밖이면 조회하지 않는다). 3-state는 결과 섹션이 아니라 상태 줄이 말한다(`route.transit.noRoute`·`route.transit.error`·aboard 문장). 성공이면 aboard가 아닐 때만 최근 경로에 역 필드와 함께 기록. 조회 완료 시 포커스는 조회 버튼에 머문다.
- **입력 줄 순서**(iOS `Tab:1260-1345`): 출발지 → (aboard 방면 전) 단계 줄 → 바꾸기(aboard 아님) → 도착지 → 경유지 칸 + 「경유지 삭제」 또는 입구 버튼 「경유지/자동차 환승 추가」(역 칸·aboard 아님) → aboard면 역 B 칸·추가 → 역 칸(채운 칸만, 이름은 종류별 키) + 남은 쪽 추가 + 「갈아탈 역/정류장 지우기」 → 조회 → 상태 줄. 줄마다 한 접근성 객체(`joinText`, 쉼표).
- **검색**(`EndpointPicker`·`EndpointSearchContent`): 대상 `transfer`·`boardStation`·`alightStation`과 출발지 aboard 모드를 더한다. 후보 순서 장소 → 장소 실패 한 줄 → 정류장 줄(`journeyStops`, 2~30자, 기준 좌표 하나 이상, 거리순 5건, 3-state 문장) → 기타 장소(역 칸) → 주소(입구만). 역 칸에서 역이 아닌 장소는 시트에 남아 `android.journey.notStation`(`highPriority`), aboard 모드는 지하철역만(`aboardNotSubway`). 입구에서 역·정류장을 고르면 확정하지 않고 시트를 닫은 뒤 확인 질문을 띄운다.
- **확인 질문**: 짐작 `journeyTransferGuess`(시트가 닫힐 때 정해 버튼 순서가 흔들리지 않게) → 질문 문장(6갈래 `ask*`) + 짐작이 첫 버튼인 세 답 + 「닫기」. 안드로이드는 Compose 대화상자(제목 = 질문 문장, 버튼 넷, 첫 버튼에 `landingTarget` 착지). 답이면 칸을 세우고 새 칸으로, 경유만이면 경유지 줄로, 닫기·뒤로 가기는 아무것도 바꾸지 않고 입구 버튼으로 커서.
- **지금 탄 열차**: 출발지 시트 「현재 위치 사용」 다음 행 「지하철역 검색」(ko만) → 역 → `startAboard` → 단계 줄(노선 질문·방면 질문·실패·열차 없음엔 「새로고침」·정보 없음은 문장만). 방면 전 조회 버튼은 단계 줄로 커서. 출발지 칸 문장 `aboardField`·`aboardFieldDirection`. 최근 경로에 저장하지 않는다(R11).
- **결과**(새 `directions/JourneyResultRows.kt`, iOS 앱 층 소속이라 `:kit`이 아니라 앱): 못 찾음 줄 → (변형 둘 이상이면) 변형 선택 버튼(선택 상태는 `selected` 시맨틱) + 고른 변형 제목(헤딩) → 합계 줄 → 택시 앞 줄 → 대중교통 구간 줄(기존 대중교통 결과 줄 재사용 — `RouteRows.kt`의 구간 줄 그리기를 함수로 꺼내 둘이 쓴다) → 출구 선택(둘 이상이면 버튼) → 「안내 시작」(aboard면 `beacon.start`, 아니면 `beacon.guideStartTransitAlt(제목)`) → `GuideSession.startJourney(JourneyPlan(…, aboard = aboardOrigin?.direction?.let { TransitAboardStart(it.direction) }))`. 도착지가 현재 위치면 버튼 없음. 결과가 있으면 최근 경로 섹션을 숨긴다.
- **최근 경로**: 줄 문장 `recentJourneyLabel`(ko·역 있을 때만 `recentRoute*` 넷), 복원 `activateRecentRoute`가 ko ∧ 역 있음이면 `setJourneyStations`, 역 없음이면 남은 칸을 비운다.

### 7-7. 검증

- `:kit`: 단계 1(Swift 57 = Kotlin 57, 공유 fixture 다섯).
- 앱 JVM(페이크 레인, `CarGuideModelTest`·`TransitGuideModelTest`·`GuideTransitHandoff*` 선례): 세션 단계는 전이 전수(택시 → 접근 도보 → 대중교통 → 출구 도보 → 택시, 접근 도보 생략 30m, 역 B 미지정 = 말미 도보 인계, 출구 none = transit → taxiOut), 버튼 사건과 자동 도착 경쟁(먼저 온 것만), 낡은 token 콜백 버림, 동기 거부 → 시작 실패, 접근 도보 시작 실패 → 통지 대기 → 대중교통, 실패 시트 재시도, 30초 복귀 실패와 한 번 통지, 여정 중 외부 시작·정밀 위치 재시작 거부, `UserEnded`가 도는 세션을 멈춤, 승차 전 도보 교차 다섯 자리, aboard 시작(열차 고르기 국면·통지 문맥 없음·방향 잠금), **서비스 넘김**(단계 경계에서 `stopService`·`startForegroundService` 0회, 세대 교체, 여정 종료 시 내림, 앞 단계 늦은 이벤트 버림).
- 소스 가드(`GuideSourceGuardTest` 넓힘): `startJourney(` 호출부는 `JourneyResultRows.kt` 하나, `beginBeacon(` 호출부에 `launchJourneyBeacon`, `beginTransit(`에 `startJourneyStage`, `startJourneyStage` 첫 줄 가드 네 항, `isOccupied`가 `journey`를 보고 `isActive`는 보지 않음, `aboard` 인자 기본값 없음(`transit.start`·`beginTransit`·`JourneyPlan`), `markChained` 기본값 없음.
- Compose 단위: 여정 시트 국면별 행·버튼·착지, 입력 상태 여섯 갈래의 줄 순서, 확인 질문 버튼 순서와 답별 결과, 결과 줄 순서, aboard 단계 줄.
- 실기기(한소네 7, 실내, 진입점 단계): 입력 메뉴·입구 검색·확인 질문·역 칸·남은 쪽 추가·지우기·정류장 줄·지금 탄 열차 단계 줄·결과 줄·「안내 시작」 → 첫 단계 시트 → 버튼 사건(「자동차에서 내렸어요」 → 접근 도보 또는 대중교통, 「자동차에 탔어요」) → 여정 시트(준비·실패) → 안내 종료. 실차·실승차가 필요한 것(택시 확정 도착 자동 인계, 화면 끈 채 단계 넘김, 하차 → 출구 도보, aboard 열차 고르기)은 BACKLOG §2 행.

### 7-8. 채팅 여정 카드 판정 재검토

2026-11-21 위원장 판정: 안드로이드 채팅에도 여정 카드를 넣되 길찾기 여정(B26)이 끝난 뒤 별도 작업(BACKLOG B29)으로 한다. 이 설계는 카드가 쓸 입구만 남긴다: 카드의 「안내 시작」은 `GuideSession.startJourney(plan: JourneyPlan)`을 부르고(`aboard = null`, 카드는 지금 탄 열차 출발을 다루지 않는다), §7-7 호출부 소스 가드는 그때 카드 파일을 두 번째 호출부로 더한다.

### 7-9. 단계 분해와 각 단계가 남기는 인터페이스

진입점(입력 메뉴·결과의 「안내 시작」)은 본체가 완결된 마지막 단계에서 연다. 그 전 단계는 사용자가 닿지 않는 코드로 통합한다(플래그 없음).

| 단계 | 내용 | 남기는 인터페이스 |
|---|---|---|
| 1 | §7, `:kit` 이식(§7-2) | `Journey.kt` 함수·타입, `RouteService.journey`·`journeyStops`, `RecentStation`·`RecentRoute` 역 필드 |
| 2 세션 ✅ 2026-11-21 | §7-3·§7-4: `GuideSession` 여정 상태·전이·준비·단계 시작·종료·`isOccupied`·복귀 30초, 도보 `markChained`·`lastFailure`·`endsWithoutScreen`, 대중교통 `start(…, aboard)`·후보 방향 잠금, 서비스 보유자·넘김 | `GuideSession.startJourney(JourneyPlan)`(호출부 없음), `journeyAction(JourneyEvent)`, `journeyUi`, `isOccupied`, `JourneyPlan`·`TransitAboardStart`·`JourneyFailure`·`JourneyUiState` |
| 3 화면(안내) | §7-5: `GuideScreenKind.journey`·`JourneySheet`·띠바·도보/자동차 시트 여정 버튼·대중교통 시트 「다음 구간」·여정 중 숨김 | 시트가 부르는 `journeyAction` |
| 4 길찾기 모델 | §7-6 모델 몫: `DirectionsViewModel` 여정 상태·조회·aboard 방면·최근 경로 역 필드(기본값 제거·`togglePin` 수정) | 화면이 부를 모델 함수(iOS 이름) |
| 5 길찾기 화면(진입점 개방) | §7-6 화면 몫: 입구 버튼·검색 대상 셋·정류장 줄·확인 질문·역 칸·aboard 행과 단계 줄·결과 줄·「안내 시작」·최근 경로 줄 문장, BACKLOG B26·E43 M5·PROGRESS 갱신, §2 실차·실승차 행, 한소네 전 국면 | — |

- 앱 단계(2~5)는 들어가기 전에 `git fetch`로 `and-fix` 통합분을 확인하고 그 위로 rebase한다(`DirectionsScreen.kt`·`GuideSession.kt`·`RouteRows.kt` 겹침은 양쪽을 살린다).
- 한소네 점검: 단계 2·4는 화면이 없어 JVM·리뷰로, 단계 3은 띄울 길이 없어(진입점 없음) Compose 단위 + 접근성 감사로, 단계 5에서 여정 시트를 포함한 전 국면을 기기에서 한 번씩 띄운다(점유를 나눠서). 닿지 못한 항목은 이유를 적어 BACKLOG §2로.

### 7-10. 설계 리뷰 판정 (codex adversarial-review 1회, 2026-11-21)

| 지적 | 판정 | 반영 |
|---|---|---|
| 정지 호출 안에서 재결속하면 `serviceOwner()`가 아직 도보라 결속이 실패한다 | 수용 | §7-4 넘김: 다음 메인 턴 재결속 |
| 알림 종료 PendingIntent가 requestCode 하나 + `FLAG_UPDATE_CURRENT`라 옛 동작이 새 세대를 싣는다 | 수용 | §7-4 세대 거름 ① |
| 위치 리스너 콜백이 실행 시점의 가변 세대를 읽는다 | 수용 | §7-4 세대 거름 ② |
| 환승 도보 위치 상실을 `TransitStopped`로 적었다(iOS·안드로이드는 같은 구간 재개) | 수용 — 서술 오류 | §7-3 승차 전 도보 교차 |
| 배경 자동 인계의 도보 시작이 걸음 권한 응답을 60초 기다린다 | 수용 | §7-4 배경 자동 인계의 권한 |
| 실패 시트 동안 서비스·wake lock을 무기한 쥔다 | 수용 | §7-4 실패 국면은 들지 않는다 |
