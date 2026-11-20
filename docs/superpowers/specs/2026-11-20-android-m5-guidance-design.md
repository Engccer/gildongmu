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
| 여정 세션 B26 | 여정 | 대중교통 통합 뒤 |

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

- 두 시작 함수는 같은 본문(`beginBeacon`)을 지난다: 거부 게이트(`isActive`면 `guide.alreadyActive`) → 직전 실패 행 소거·착지 표식 초기화·주변 확인 소거 → 프리로드 → `walk.requestStart(request)`. 거부 게이트를 함수마다 복제하지 않는다(iOS `refuseIfActive` 한 곳).
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

포커스 하나·톤 재생기 하나·TTS 하나(`GuideSession.attach`가 조립, M4 §5-2 #16). 자동차는 같은 모델이라 그대로 쓴다. 기기 음성 대기 칸(`DeviceSpeechQueue`)은 지금 `WalkGuideModel` 안에 있다 — iOS는 「세 모델 공유 칸」이므로 대중교통 세션이 칸을 `GuideSession`으로 올려 두 모델에 주입한다(자동차 세션은 옮기지 않는다: 소비자가 하나일 때 공유 구조를 미리 만들지 않는다).

## 3. `and-m5-transit`이 받을 경계

| 자리 | 자동차 세션이 남기는 모양 | 대중교통 세션이 할 일 |
|---|---|---|
| 시작 진입점 | `GuideSession.beginBeacon`(거부 게이트 한 곳) · `startWalk`·`startCar` | `startTransit(TransitStartRequest)`를 같은 거부 게이트 뒤에 더한다. 승차 전 도보·하차 인계처럼 대중교통이 도보를 여는 내부 인계는 거부 게이트 없는 `beginBeacon` 경로(iOS `beginBeacon` 동형)로 열고, 그 호출부를 소스 가드에 더한다 |
| 세션 점유 | `:kit` `GuideSessionCoordinator`(claim·release, 메인 전용) | 대중교통 모델도 같은 코디네이터에서 claim한다 |
| 전경 서비스 | `GuideForegroundService`가 `GuideSession.walk`로 fix·위치 꺼짐·알림 문장을 보낸다 | 활성 모델로 보내는 한 지점(`GuideSession.activeFixSink` 류)을 서비스에 더한다. 대중교통 keep-alive(E36·A46)도 이 서비스다 |
| 시트·띠바 | `GuideBottomBar` → `GuideSheet`(도보·자동차) | `GuideScreenKind`와 대중교통 시트를 더한다 |
| 오디오 | `GuideSession.attach`의 포커스·톤·TTS | 대중교통 모델에 같은 인스턴스를 주입하고 `DeviceSpeechQueue`를 `GuideSession`으로 올린다(§2-6) |
| 억제 소유자 집합 | `GuideSession.setOutputSuppressed`가 `walk.outputSuppressed`만 만진다 | 두 모델에 함께 건다 |
| 도보 인계 받기 | `WalkStartRequest`(기본값 없음). 출구 인계(E84 `exitLead`)는 아직 없다 | `WalkStartRequest`에 `exitLead`를 더하고(기본값 없음) 출구 대기 창을 이식한다 |
| 전화 걸기 E90 | 도보·자동차 시트 제목 메뉴 첫 항목(기존) | 대중교통 시트 제목 메뉴에 같은 번호부(`AppConfig.placePhoneBook`)로 |

## 4. 자동차 세션 상세 (iOS `BeaconModel` `sessionKind == .car` 절단면)

판정 계층은 `:kit`에 있다: `GuideTuning.car`(임박 `max(15m, v×6초)`·표본 부족 60m·`silentCatchUp`·정숙 시간·경유지 접근 `max(150m, v×60초)`·안전망 두절 900초·무이동 축 없음·도착 추정 두절 120초·무이동 300초·150m·기하 없이 150m에서 최종 접근), `CarAction`(서버 `action` 투영), `buildCarGuide`·`roadNameAt`·`carSpokenLandmark`(E56·E61), `carArrivalStep`(40m·정지·정확도 ≤ 30m), `guideSpeechChannel`(E53). 새로 옮기는 것은 `CarTrafficAhead.kt`(E80, 공유 fixture `car-jams-ahead-cases.json`)뿐이다. 앱 층은 iOS 분기를 같은 자리·같은 조건으로 옮긴다. 문장은 iOS가 쓰는 키(`guide.car*`·`guide.currentRoad`·`guide.carRoadNow`·`ios.guide.carOffRoute` → `android.guide.carOffRoute`·`ios.beacon.carWalkHandoffStart` → `android.beacon.carWalkHandoffStart`)를 그대로 쓴다(생성물에 이미 있다).

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
- **자동차 실행 안내는 리듀서의 정숙 시간 기준을 적는다**: 억제 복구 발화·전경 복귀 갚기·경유지 접근 예고 뒤 `guideState.lastAnnouncedAt = now`(iOS `sessionKind == .car` 두 자리, 가드 `car-waypoint-approach-guard.test.ts`의 안드로이드 판을 `GuideSourceGuardTest`에 둔다).

### 4-4. 현재 도로 (E56)

- `currentRoadText = roadNameAt(roadSpans, d)?.let { guide.currentRoad(it) }` — 진행거리를 믿을 수 있는 국면(`following`·`bundle`)의 매 fix와 커밋 지점에서 갱신하고, 같은 값이면 대입하지 않는다(커서 위 재낭독 방지). 모르면 null(줄 없음, 통지 없음). 스텝 문장을 파싱하지 않는다.
- 시트: 상세·이탈 아님·값 있음일 때 하단 2행 **앞**에 한 줄(iOS `BeaconTrackingSheet` 순서). 착지 대상 행은 아니다(E57 표: 남은 거리 → 윗줄 → 상태). 진행 상황 문장에는 `guide.carRoadNow` 머리말(§4-7).
- 전경 복귀 상환이 상태 행이 비었을 때 쓰는 문장: 자동차는 하단 2행 윗줄, 없으면 현재 도로 행(iOS `handleScenePhaseChange` 동형).

### 4-5. 주행 중 재조회와 새 정체 (E80, B17 주행 중 몫)

- 6분(`carEtaIntervalSeconds` 360) 주기, 세션당 10회(`carEtaCallCap`, 시작 조회 포함), 상세 모드·이탈 아님에서만. 원점은 위치 스토어가 아니라 **세션의 마지막 fix**다(안드로이드 위치 스토어엔 TTL이 없고 안내 스트림이 이미 1초마다 신선한 좌표를 준다 — iOS `currentCoordinate()`가 같은 신선도를 얻는 수단이다. 마지막 fix가 `freshFixSeconds`보다 낡았으면 이번 회차를 건너뛰고 횟수를 세지 않는다).
- 응답 커밋 가드: 조회 토큰·추적 중·상세·목적지 동일·소요 > 0. 그러면 ETA 갱신 → 남은 거리 행 갱신 → `announceNewCarJam`.
- `announceNewCarJam` 호출부 규칙 넷(iOS·웹 동형): ① `provider == "tmap"`인 응답의 정체만 ② 아는 정체가 null(기준선 없음)이면 이번 정보를 말없이 기준선으로 ③ 응답 시점에 이탈이면 말하지 않는다 ④ 보류 통지(`deferredAnnouncer.hasPending`)·기기 음성 대기 칸·**TTS가 말하는 중**(`speaker.isSpeaking`)이면 밀어내지 않고 건너뛴다 — 안드로이드 전경 발화는 앞 문장을 끊으므로(README §3 안내 음성 채널) 말하는 중 판정이 iOS보다 더 필요하다. 판정은 `newCarJamsAhead(polyline, totalMeters, d, known, fresh)`, 알릴 하나만 아는 정체에 더하고, 통지가 버려지면(`onDropped`) 되돌린다. 문장 `guide.carNewJam`(도로 이름 있음)·`guide.carNewJamUnnamed`, 분류 `actionable`.
- 진행 상황 문장: ETA가 `carEtaStaleSeconds`(420) 넘게 낡았으면 `guide.etaStale` 병기(3-state — 낡은 값을 지금 값처럼 말하지 않는다).
- 남은 시간: 자동차는 ETA 카운트다운이고 경유지 목표엔 없다(null — 날조 금지).

### 4-6. 안내 시트·띠바 (`GuideSheet.kt`는 `and-route` 통합 뒤)

- 제목 헤딩: `beacon.carHeading`(도보 `beacon.walkHeading`).
- 정보 행 순서(상세): 남은 거리 → **현재 도로** → 윗줄(지금 할 일) → 아랫줄(다음 안내) → 상태. 간략 강등이면 종전대로 상태 행.
- 제목 메뉴(전화 걸기 → 장소 상세 → 목적지 바꾸기)와 경유지 추가·변경·삭제는 자동차에서도 같다(iOS 동형). 조망의 「대안 경로 보기」는 도보만(`alternativePreviewAvailable`이 도보 조건).
- 이탈: 상태 행·윗줄은 벗어난 쪽만(도보와 같은 규칙), 시계 문장은 `guide.carOffRouteClock`·`guide.carOffRouteBehind`(도보 `offRouteReturnClock`·`offRouteTurnBack`), 상태 행의 국면 문장은 `android.guide.carOffRoute`(도보 `guide.offRoute`). E69 「경로 다시 조회」는 도보와 같은 조건(자동 판정이 손을 든 회차).
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
