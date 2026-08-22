# N1 안내 세션 앱 승격 + 안내 시트 최소화 — 설계 (2026-08-22)

> 피드백 2(2026-08-21 위원장): "안내 중에 다른 메뉴를 쓸 수 없다." 판정은 `docs/superpowers/plans/2026-08-22-feedback-260821-parallel-plan.md` §1 N1 행과 `docs/BACKLOG.md` N1이 정본이고 여기엔 그 판정을 구현하는 설계만 적는다. **설계 리뷰 대상**(안내 세션 상태 소유권 이동 — 글로벌 CLAUDE.md "설계 단계 적대적 리뷰" 조건 ①). 구현 방식 판정: inline(단일 도메인·순차 의존 — 소유권 이동이 뒤 태스크 전부의 인터페이스를 정한다).

## 1. 문제

`BeaconModel`·`TransitGuideModel`이 `DirectionsTabView`의 `@State`에 살고, 안내 시트의 `isPresented`가 `isTracking`에 1:1로 묶여 있다. 그래서:

- 시트를 닫는 것이 곧 중지다(스와이프·VO escape도 중지).
- 탭을 옮기면 `DirectionsTabView.onDisappear → teardown()`이 세션을 죽인다. 즉 **안내 중에는 다른 탭을 쓸 수 없다**.
- 길찾기 탭 `.id(directionsEpoch)` 재생성(프리필 진입·새로고침)도 모델을 버린다.

## 2. 결정 (판정 5건의 구현 형태)

### 2.1 소유권: `GuideSession` 앱 수준 싱글턴

```swift
@MainActor @Observable
final class GuideSession {
    static let shared = GuideSession()
    let beacon = BeaconModel()
    let transit = TransitGuideModel()
    /// 시트가 내려가 있고 띠바가 세션을 대표하는 상태. 세션이 완전히 끝나면 false로 돌아간다.
    var isMinimized = false

    /// 안내 화면이 존재해야 하는가 — 추적 중이거나, 세션 뒤에 남은 화면(도착·중지 종료
    /// 화면, 대중교통 도보 핸드오프 제안)이 있을 때. 시트 표시·띠바 표시의 공통 술어.
    var hasScreen: Bool
    /// 어느 화면인가 — `.sheet(item:)`의 item. 두 시트를 독립 Bool로 경쟁시키지 않는다
    /// (리뷰 M2: 한 갱신에서 한 시트가 내려가며 다른 시트가 올라오면 presentation이 무시될 수 있다).
    var screen: GuideScreenKind?   // .beacon / .transit — 둘 다면 beacon
    var presentedScreen: GuideScreenKind? { isMinimized ? nil : screen }
    /// 시작 요청의 단일 진입점(리뷰 C1·C2): 활성 세션이 있으면 거부 통지, 없으면 **다른
    /// 모델의 잔여 화면을 먼저 소거**하고 시작한다. 세션 활성 = coordinator 점유 ∨ 비콘 시작 대기(`starting`, 리뷰 M5).
    func startBeacon(_ request…) / func startTransit(…)
    /// 핸드오프 수락(리뷰 C5·C6): transit 종료(release 포함)·제안 소거·600ms 지연 Task 소유·비콘 시작을 한 전이로.
    func acceptWalkHandoff()
}
```

- `BeaconModel.toggle`은 **길찾기 탭 인라인 버튼(추적 중 "중지"·비추적 "직선거리 안내 시작" 겸용) 한 곳에만** 남고, 경로 행의 시작 버튼 3종(도보·최단·자동차)·대중교통 대안 버튼·핸드오프는 `GuideSession.startBeacon`/`startTransit`을 지난다(리뷰 C1 — `toggle`의 `isTracking` 분기가 "새 시작 = 기존 중지"를 다시 만든다). `toggle`의 시작 분기도 같은 진입점을 탄다. 게이트 드리프트 테스트는 `beacon.toggle(`·`beacon.restart(`에 `session.startBeacon(`·`session.acceptWalkHandoff(`를 더해 센다.
- 비콘 `lastStartRequest`는 거부 게이트를 통과한 뒤에만 기록한다(리뷰 m3 — 거부된 요청이 `restart()` 대상으로 남지 않게). 대중교통은 route 변환보다 거부 판정이 먼저다(리뷰 m2).

- `GildongmuApp`이 `GuideSession.shared`를 들고 `DirectionsTabView(session:)`로 **주입**한다. `DirectionsTabView`는 더 이상 모델을 만들지 않는다(`@State beacon`·`@State transitGuide` 삭제).
- `.onDisappear`의 `beacon.teardown()`·`transitGuide.teardown()` **삭제**. `model.cancel()`·`walkHandoffTask` 취소는 남는다(조회·핸드오프는 탭 소유).
- `scenePhase` 전달(`handleScenePhaseChange`)은 `GildongmuApp.onChange(of: scenePhase)`로 이동(탭이 안 보여도 전경·배경 전환을 받아야 한다).
- 유휴 리셋 예외(`!GuideSessionCoordinator.shared.isActive`)는 그대로 — 모델이 `.id` 밖에 있어 리셋이 세션을 죽이지는 않지만, 리셋은 탭을 채팅으로 돌리고 길찾기 폼을 지우므로 안내 중엔 여전히 건너뛴다.
- `GuideSessionCoordinator`(상호 배제)는 **Kit으로 이동**해 테스트 가능하게 한다(Foundation만 의존). 역할 분리: Coordinator = 배타 정책, `GuideSession` = 모델 소유·표시 상태.

### 2.2 시트는 앱 루트에서 띄운다

두 `.sheet`(비콘·대중교통)를 `DirectionsTabView`에서 `GildongmuApp`의 `TabView` 아래로 옮긴다(`.id` 바깥 — 언어 전환·세션 리셋에도 유지).

```
.sheet(item: presentedScreenBinding)   // get: session.presentedScreen
set(nil):   session.isMinimized = true   // 항상. 콜백 시점의 모델 상태로 의미를 정하지 않는다
```

- **시트를 내리는 모든 제스처(스와이프·VO escape) = 최소화**. 종전 "닫기 = 중지/소거"를 전부 버린다. 근거: 되돌릴 수 없는 동작을 제스처 하나에 걸어 둘 이유가 없어졌고(띠바가 복귀 경로), dismiss 콜백이 모델 상태를 읽어 뜻을 정하는 구조가 경합의 원천이다(리뷰 C3·C4 — 추적 중 시작한 스와이프가 도착 직후 완료되면 방금 생긴 도착 화면을 지운다). 그래서 **잔여 화면(도착·중지 종료 화면, 핸드오프 제안)의 소거는 그 화면의 "닫기" 버튼이 명시적으로 `clearArrival()`·`clearWalkHandoff()`를 부른다**(지금은 `dismiss()`라 바인딩 setter를 지난다 — 바꿔야 한다). 소거되면 `hasScreen`이 false가 되어 시트가 스스로 내려간다. 잔여 화면을 스와이프로 내리면 띠바에 "{dest} 도착"/"안내 종료" 요약이 남고, 돌아가 닫거나 새 안내를 시작하면(§2.1 잔여 소거) 사라진다.
- 중지는 시트의 "안내 종료" 버튼과 길찾기 탭 인라인 "중지" 버튼만.
- 비콘의 `stopByUser(endScreen: .afterDismiss)` 경로(스와이프 중지)는 호출자가 사라지므로 제거하고 `.immediate`만 남긴다. `presentPendingEndScreen`·`pendingEndScreen`·`hasPendingEndScreen`도 함께 삭제(리뷰 C8의 "중지 요약" 혼동 원천 — 이제 중지 요약은 시트가 열린 채 그 자리에서 뜬다).
- 시트 콜백 중 길찾기 탭 폼에 닿아야 하는 것 2개는 **스토어 채널**로 바꾼다(시트가 탭을 모른다):
  - `onDestinationCommitted(endpoint)` → `GuideFormSyncStore.shared.pending = endpoint`. `DirectionsTabView`가 `onChange`+`task`(탭이 안 보였을 때 쌓인 값 소비)로 받아 종전 `syncFormAfterGuidanceChange`를 수행한다. 탭이 그 사이 재생성됐어도 `task`가 소비하므로 유실 없음.
  - `onWalkHandoff` → `GuideSession.startWalkHandoff()`. 필요한 값은 목적지 좌표·라벨(`TransitGuideModel`이 `start`에서 `dest: BeaconDest`를 함께 보관 — 새 인자)과 계단 회피 여부(`transit.start`에 `accessible: Bool` 인자로 함께 넘긴다 — 종전엔 핸드오프 시점에 탭 폼의 `stepFreeEnabled`를 읽었는데, 세션이 탭과 분리되면 그 값은 세션 시작 시점에 고정돼야 한다. `BeaconModel.begin`의 "세션 시작 시점 값이 세션 내내 유효" 계약과 같다). `detailDest`도 `transit.dest`에서 읽는다.
- 종전 `.onChange(of: model.endpoint(for: .to))`의 **자동 중지 삭제**(`stopBecauseDestinationChanged` 호출 2곳·`guidanceInitiatedEndpoint` 플래그 삭제). 판정 "경로 조회는 허용"이 정확히 이 자리다 — 세션이 자기 목적지(`dest`·`destinationLabel`)를 들고 있어 폼이 바뀌어도 옛 목적지를 추적하는 창은 생기지 않는다(그 함수가 막던 위험의 전제가 사라졌다). `stopBecauseDestinationChanged` 자체는 다른 호출자가 없으면 함께 지운다.
- 검색 시트 받아쓰기 중 억제(`outputSuppressed`)는 탭의 `searchTarget` onChange에 두되 **두 모델 모두**에 건다(리뷰 C9 — 최소화된 대중교통 안내 중 목적지 음성 검색이 통지에 오염된다). 탭 `onDisappear`에서 둘 다 `false`로 되돌린다(리뷰 M4 — 시트가 열린 채 탭 트리가 재생성되면 억제가 영영 남는다). ~~⚠ 다른 탭의 받아쓰기(검색 탭 마이크·채팅)는 이 억제를 받지 않는다 — N1 뒤 열린 항목(§7).~~ **K1 ④(2026-08-23)로 닫혔다**: `SpeechService`가 시작(`phase = .requesting` 직후, 마이크가 뜨거워지기 전)에 `GuideSession.setDictationActive(true)`를 걸고 모든 종료 경로(권한 거부·취소·실패·정지·엔진 실패 콜백)에서 푼다. 억제 플래그는 시트도 쓰는 공유 Bool이라 종료는 `이전 값 ∧ 현재 값`이다 — 무조건 false면 열린 검색 시트의 억제를 깨고, 무조건 이전 값이면 그 사이 닫힌 시트의 해제를 되살려 안내가 영구 침묵한다.

### 2.3 띠바(`GuideBandView`)

- **위치(K1 ②, 2026-08-23 개정)**: 탭 바 **바로 위**. 종전 구현은 `.safeAreaInset(edge:.bottom)`을 TabView 자체에 걸어 inset이 탭 바 자리에 그려졌고, 탭 바가 시각·VoiceOver 모두에서 사라졌다(실기기 2026-08-22 — 띠바가 화면 첫 객체). 지금은 iOS 26.1+ `tabViewBottomAccessory(isEnabled:)`(26.0은 내용 비우기), 18~25는 각 `Tab` **콘텐츠**의 `safeAreaInset`(`withGuideBand`) — 콘텐츠 safe area가 탭 바를 제외하므로 탭 바 위에 놓이고 VO 순서가 콘텐츠 → 띠바 → 탭 바다. 액세서리 모디파이어는 조건부로 붙였다 떼지 않는다(TabView 정체성 변경 = 탭 상태 소멸). 시뮬 18.6·26 둘 다 탭 바 가시·AX 순서 확인(2026-08-23).
- 문구(K1 ③): `guide.band.return` = "안내 시트 펼치기"(종전 "안내로 돌아가기").

`GildongmuApp`의 `TabView`에 `.safeAreaInset(edge: .bottom)`으로 붙인다 → 탭 바 바로 위, 모든 탭 공통. 표시 조건 `session.hasScreen && session.isMinimized`.

- **접근성 객체 하나 = 버튼 하나**. 라벨 = 요약 문장 + "안내로 돌아가기"(`guide.band.return`). 시각은 두 줄(요약 / 돌아가기)이어도 `.accessibilityElement(children: .combine)`이 아니라 버튼 라벨로 직접 합친다. 최소 높이 44pt.
- 요약 문장(수단별, 위원장 판정):

| 상태 | 문장 키 | 예 |
|---|---|---|
| 비콘 상세(walk·car, 경로 있음) | `guide.band.remaining` `{dest}까지 남은 거리 {distance}` | 신명중학교까지 남은 거리 850m |
| 비콘 간략(경로 없음·폴백) | 같은 키, 거리는 직선 거리 | |
| 비콘 도착 종료 화면(`endKind == .arrived/.presumed`) | `guide.band.arrived` `{dest} 도착` | |
| 비콘 중지 종료 화면(`endKind == .stopped`, 걸음 요약) | `guide.band.ended` `{dest} 안내 종료` | 리뷰 C8 |
| 대중교통 목적지 변경 대기(`pendingDestChange != nil`, loading·loaded) | `guide.band.transitDestChangePending` `{label}로 목적지 변경, 경로 선택 대기` | 리뷰 M3 |
| 대중교통 목적지 변경 실패(`failed`·`empty`) | `guide.band.transitDestChangeFailed` `{label}로 목적지 변경 실패, 안내 화면에서 확인` | 코드 리뷰 i2 |
| 대중교통 waiting·boarding | `guide.band.transitWaiting` `{stop}에서 {line} 탑승 기다리는 중` | |
| 대중교통 riding, 잔여 수 있음 | `guide.band.transitRiding` `{line} 탑승 중, 남은 정거장 {count}개` | |
| 대중교통 riding, 잔여 수 없음 | `guide.band.transitRidingNoCount` `{line} 탑승 중` | |
| 대중교통 arrived·핸드오프 제안 | `guide.band.transitArrived` `{dest} 도착` | |

- 거리 수치는 `BeaconModel`에 새 `bandDistanceMeters: Int?`(상세: `max(0, route.totalMeters - state.d)`, 간략: 마지막 fix 직선 거리, 둘 다 기존 갱신 지점에서 같이 씀. **10m 이상 변했을 때만 갱신**하고 목적지 변경·세션 시작에서 nil — 리뷰 M7·M8: 매 fix 라벨 갱신은 커서가 띠바에 있을 때 발화를 과밀하게 한다). 시각 표기는 `formatDistance`, 접근성 라벨은 거기에 `spokenDistanceUnits`(리뷰 M6 — VO가 `850m`을 minutes로 읽는다). 거리가 아직 없으면(첫 fix 전) `guide.band.starting` `{dest}까지 안내 중`.
- 대중교통 값은 **순수 함수** `guideBandSummary(phase:legLabel:stopLabel:remaining:hasHandoff:hasDestChange:) -> GuideBandSummary`(Kit, 테스트)가 고르고 문장은 앱이 붙인다. 입력에 핸드오프 제안·목적지 변경 대기가 들어간다(리뷰 C7 — 도착 뒤 `state == nil`이라 state만으로는 arrived를 알 수 없다).
- 띠바는 **live region이 아니다**. 수치 갱신은 라벨만 바꾼다(VO는 포커스된 요소의 라벨 변경을 낭독하므로 커서를 띠바에 두면 갱신이 들리고, 다른 곳에 있으면 조용하다). 안내 통지는 종전대로 모델의 `announce` 채널이 낸다 — 어느 탭에서든 들린다.
- 띠바가 사라지면 `bandFocused`·착지 재시도 Task를 초기화한다(리뷰 M9 — 다음 세션의 띠바 삽입이 포커스를 탈취한다).
- **알려진 한계(수용)**: 최소화 뒤 설정·장소 상세 같은 다른 시트를 열면 띠바는 그 모달 뒤에 있다(리뷰 M11). 모달을 닫으면 띠바가 있다 — 모달 안에 복귀 버튼을 두지 않는다(잉여). 띠바에 커서를 둔 채 다른 탭에서 세션이 끝나면 커서가 이탈한다(리뷰 M10) — 통지가 이미 나갔고 안정 착지점이 탭마다 다르므로 손대지 않는다.

### 2.4 중복 시작 거부

`GuideSessionCoordinator.claim`의 정책을 반전한다: 다른 소유자가 있으면 **중지하지 않고 `nil`을 돌려준다**.

```swift
func claim(stop: @escaping () -> Void) -> Int?   // nil = 거부
```

- `BeaconModel.start`·`TransitGuideModel.start`는 **권한 대기 전에** `coordinator.isActive`를 보고 즉시 거부 통지(`guide.alreadyActive` "이미 안내 중입니다. 먼저 진행 중인 안내를 종료하세요.", `.high` — 버튼 활성화의 직접 응답)하고 `claim`이 nil이면 같은 통지 후 반환(경합 최종 게이트). 비콘은 `fail(...)`이 아니라 통지만(실패 상태줄에 "재시작" 제안이 붙는 경로가 아니다).
- **자기 세션 계승은 claim을 거치지 않는다**: `changeDestination`·`restart`(이미 release 뒤)·대중교통→도보 핸드오프(transit은 arrived에서 state=nil, release 완료 뒤 600ms). 리뷰 관점: 핸드오프 수락 시점에 transit 세션이 release됐음을 `startWalkHandoff`가 `precondition`이 아니라 동작으로 보장한다(`clearWalkHandoff()` 선행 — 종전 동일).
- 길찾기 탭의 시작 버튼 3종은 숨기지 않는다(판정 "거부+통지"). 대신 라벨 뒤에 상태를 붙이지도 않는다 — 띠바가 이미 화면에 있다.

### 2.5 장소 상세 버튼 2

`PlaceDetailView` 길찾기 섹션, `showsDirectionsEntry`와 같은 게이트 안, "여기까지 길찾기" 바로 뒤:

- **"여기로 목적지 변경"**(`guide.changeDestHere`): 어느 모델이든 추적 중일 때만. 비콘 → `beacon.changeDestination(dest:label:)`(성공 시 `GuideFormSyncStore`에도 기록, 통지는 모델의 `ios.guide.destChanged` 그대로). 대중교통 → `transit.prepareDestinationChange(dest:label:)` + 통지 `guide.transitDestChangePrepared`("대중교통 경로를 찾고 있습니다. 안내 화면에서 경로를 선택하세요.", `.high`). **시트를 자동으로 올리지 않는다**(리뷰 M3 — 장소 상세가 이미 시트(채팅·주변)인 경로에서 루트 시트 presentation이 거부돼 상태만 보이지 않게 진행된다). 띠바가 "경로 선택 대기"를 보여 주고 사용자가 띠바로 돌아가면 기존 `.destChangeStatus` 착지가 후보를 보여 준다. 둘 다 사용자가 둘러보던 화면에 머문다.
- **"여기를 경유지로 추가"**(`guide.addWaypointHere`): 자리와 라벨만. 표시 조건 `GuideSession.shared.waypointAvailable`(지금은 `false` 상수, N4-iOS가 비콘 세션의 경유지 지원 여부로 바꾼다). `#if` 없음.
- 안내 시트 안에서 연 장소 상세(`showsDirectionsEntry: false`)에는 둘 다 없다(같은 목적지).

### 2.6 VoiceOver 포커스 계약

- **접기 버튼**(`guide.minimize` "안내 시트 접기", K1 ③ 2026-08-23 개정 — 종전 "안내 최소화" 행 버튼): 두 시트 모두 **NavigationStack `toolbar(.topBarTrailing)` 아이콘 버튼**(`arrow.down.right.and.arrow.up.left`, 시각 텍스트가 없어 `accessibilityLabel` 정당). 위원장 판정: 한 행을 차지하면 매 진입마다 스와이프 비용(YouTube 전체화면 접기 아이콘 레퍼런스). `TransitTrackingSheet`는 `SheetControl.minimize` case로 `landControlFocus(.minimize, proxy:)`, `BeaconTrackingSheet`는 `minimizeFocused: Bool` 바인딩(단일 요소라 Bool 허용)으로 착지 대상 — 띠바 복귀 착지 계약(`returnedFromBand`)은 그대로. NavigationStack은 이 toolbar를 위해서만 있고 제목은 없다(제목 메뉴는 종전대로 섹션 헤더 `GuideTitleMenu`). 조망 모달(`RouteOverviewSheet`)은 "나브바 요소가 섹션 헤더보다 먼저 착지 후보"라 toolbar를 안 쓰는데, 안내 시트는 열릴 때 착지가 명시(`landStopFocus`)라 그 제약이 없다.
- **최소화 → 띠바 착지**: 시트 dismiss 뒤 VO 커서가 최상단으로 이탈하는 것이 실기기 확정이라, `GildongmuApp`이 `@AccessibilityFocusState bandFocused`를 들고 "지연 → 대입 → 검증 → 1회 재시도" 패턴(`landFocusAfterResolve` 동형)으로 띠바 버튼에 착지한다. 통지 없음 — 띠바 라벨이 곧 상태다.
- **복귀 → 시트 안 이전 위치**: 띠바로 돌아온 시트는 `.task` 첫 착지를 **최소화 버튼**에 둔다(`GuideSession.returnedFromBand: GuideScreenKind?` 1회 플래그 — 같은 종류의 시트만 소비한다, 리뷰 m1). 사용자가 최소화할 때 커서를 두고 떠난 컨트롤이 바로 그 버튼이라 "이전 위치"가 문자 그대로 성립한다. 스와이프·escape로 최소화한 경우는 떠난 자리를 알 수 없어 종전 기본 착지(중지·상태에 따른 `.task` 분기)를 쓴다.
- 세션이 **띠바 상태에서 끝나면**(도착 뒤 종료 화면 닫기·중지 버튼은 시트 안에만 있으므로 사실상 도착·실패·목적지 변경 실패 경로) 띠바가 사라진다 — 커서가 띠바에 있었다면 이탈한다. 이때는 통지가 이미 나갔고 복귀할 자리가 없으므로 현재 탭의 **탭 바 선택 항목**으로 보내지 않고 그대로 둔다(종전 `landBeaconStartFocus`는 길찾기 탭이 보일 때만 의미가 있어, 길찾기 탭이 선택돼 있을 때만 수행).

## 3. 상태·전이 표

| 사건 | hasScreen | isMinimized | 시트 | 띠바 |
|---|---|---|---|---|
| 시작 성공 | true | false | 올라옴 | 없음 |
| 최소화 버튼·스와이프·escape(추적 중) | true | true | 내려감 | 보임(착지) |
| 띠바 버튼 | true | false | 올라옴(최소화 버튼 착지) | 없음 |
| 도착(최소화 중) | true(종료 화면) | true | 내려간 채 | "{dest} 도착" |
| 도착(시트 열림) | true | false | 도착 화면 | 없음 |
| 시트 "안내 종료"(도보 의미 보행) | true(중지 요약) | false | 요약 화면 | 없음 |
| 시트 "안내 종료"(그 외)·탭 인라인 "중지" | false | false | 내려감 | 없음 |
| 잔여 화면 "닫기" 버튼(`clear…()`) | false | **false로 리셋** | 없음 | 없음 |
| 다른 수단 시작 시도 | 불변 | 불변 | 불변 | 불변 + 거부 통지 |
| 목적지 변경(장소 상세, 대중교통) | true | 불변 | 불변 | "…경로 선택 대기" |

`isMinimized` 리셋은 `GildongmuApp`의 `.onChange(of: session.hasScreen)`이 false 전이에서 명시적으로 수행한다(리뷰 M1 — 계산 프로퍼티 관찰만으로 부수 효과가 돌지 않는다). 모델은 최소화를 모른다.

## 4. 가드·테스트

- `GuideSessionCoordinatorTests`(Kit): 빈 상태 claim 성공 / 점유 중 claim nil + 기존 stop 미호출 / release 뒤 재claim 성공 / 늦은 release가 새 토큰을 지우지 않음.
- `GuideBandTests`(Kit): `guideBandSummary` — waiting·boarding→waiting 요약, riding remaining 유무, 핸드오프 제안→arrived, 목적지 변경 대기, state 없음+제안 없음→nil.
- `guidance-gate-drift.test.ts`: 세션 시작 호출 전수를 `DirectionsTabView.swift`+`GildongmuApp.swift`+`GuideSession.swift`에서 `beacon.toggle(`·`beacon.restart(`·`session.startBeacon(`·`session.acceptWalkHandoff(`로 센다. 총수는 구현 뒤 고정하고 2026-08-15 spec §3.2 표를 갱신한다.
- `GuideFormSyncStore.take()`는 `@MainActor`에서 읽고 비우는 한 연산이다(리뷰 M12).
- 실기기(위원장, 실험판·정식판): ①도보 안내 중 채팅 탭으로 이동해 질문 → 통지·톤 계속 ②띠바 라벨에 거리 갱신 ③복귀 착지 = 최소화 버튼 ④안내 중 길찾기 조회 가능·시작은 거부 통지 ⑤검색 탭 장소 상세 "여기로 목적지 변경"(도보·대중교통 각 1회) ⑥백그라운드 복귀(10분 초과)에서 세션 유지.

## 5. 범위 밖

경유지 버튼의 동작(N4-iOS), 다른 탭 받아쓰기 중 톤 억제, 웹(시트 구조가 없다), E15 진행 상황 조망 공통화.

## 6. 설계 리뷰 결과 (codex exec 적대적 리뷰, 2026-08-22, spec+코디네이터·앱 루트·시트 블록·모델 시작/종료 발췌 주입)

| # | 지적 | 판정 | 반영 |
|---|---|---|---|
| C1 | 시작 버튼이 `toggle`이면 기존 안내를 종료한다 | **수용** | §2.1 `GuideSession.startBeacon/startTransit` 단일 진입점, `toggle`은 인라인 겸용 버튼 한 곳 |
| C2 | 잔여 화면(종료·핸드오프)은 점유가 없어 새 세션과 공존 | **수용** | 시작 진입점이 다른 모델 잔여를 먼저 소거 |
| C3·C4 | `isMinimized`·dismiss 콜백이 모델 상태로 뜻을 정해 경합 | **수용** | dismiss = 항상 최소화, 잔여 소거는 "닫기" 버튼의 명시 `clear…()` |
| C5·C6 | 핸드오프의 release 보장·Task 소유권 모순 | **수용** | `acceptWalkHandoff()` 한 전이, Task는 세션 소유 |
| C7 | transit 도착 요약 입력 부재 | **수용** | 순수 함수 입력에 `hasHandoff`·`hasDestChange` |
| C8 | 중지 요약을 "도착"으로 낭독 | **수용** | `endKind`로 `guide.band.ended` 분기, `.afterDismiss` 경로 삭제 |
| C9 | 검색 시트 억제가 transit에 없음 | **수용** | 두 모델 동시 억제 |
| M1 | 리셋 계약 미명시 | **수용** | 앱 루트 `onChange(hasScreen)` |
| M2 | 두 Bool 시트 경쟁 | **수용** | `.sheet(item:)` 단일 |
| M3 | 장소 상세가 시트일 때 루트 시트 presentation 거부 | **수용** | 자동 올림 폐기, 통지+띠바 "경로 선택 대기" |
| M4 | 억제 잔류 | **수용** | `onDisappear` 해제 |
| M5 | 시작 대기는 active가 아님 | **수용** | `isActive = coordinator ∨ beacon.starting` |
| M6 | `spokenDistanceUnits` 누락 | **수용** | 접근성 라벨에 적용 |
| M7·M8 | 라벨 과밀·음수 거리 | **수용** | 10m 양자화·`max(0,…)`·목적지 변경 시 nil |
| M9 | `bandFocused` 잔류 | **수용** | 띠바 소멸 시 초기화 |
| M10 | 띠바 소멸 시 타 탭 착지점 없음 | 기각 | 통지가 이미 나갔고 탭별 안정 착지점이 없다 — 알려진 한계로 기록 |
| M11 | 다른 모달이 띠바를 가림 | 기각 | 모달을 닫으면 띠바가 있다. 모달마다 복귀 버튼은 잉여 |
| M12 | 스토어 원자 소비 | **수용** | `take()` |
| m1 | `returnedFromBand` 종류 미결합 | **수용** | `GuideScreenKind?` |
| m2 | transit 변환 실패가 거부 통지보다 먼저 | **수용** | 거부 판정 선행 |
| m3 | 거부된 요청이 `lastStartRequest`에 남음 | **수용** | 게이트 통과 뒤 기록 |

## 7. N1 뒤 열리는 항목 (→ `docs/BACKLOG.md`)

- 검색·채팅 탭 받아쓰기 중 안내 톤·통지 억제(`outputSuppressed`를 `SpeechService` 시작·종료에 연결).
- 띠바에 경유지 도착 상태(N4-iOS).
- 검색·채팅 탭 받아쓰기 중 억제 — **K1 ④로 종결(2026-08-23, §2.2)**.

## 8. 구현 리뷰 결과 (독립 서브에이전트, spec+diff, 2026-08-22)

C 0·M 0. m1(transit 거부 통지가 `outputSuppressed`에 묻힘 — 비콘 창구 `announceNow(bypassSuppression:)`로 통일) 수용. i2(목적지 변경 실패 국면에서 띠바가 "대기"로 남음 — `destChangeFailed` 분기 추가) 수용. i1(`stopCurrent()` 미사용)은 보류 — teardown 방어선으로 남긴다.

## 9. K1 개정 (2026-08-23, 실사용 피드백 2026-08-22 ①④)

탭 순서 검색 - 길찾기 - 내 주변 - 채팅, 기본 탭 검색(`AppTab` 케이스 순서 = 탭 바 순서, `AppTab.initial`). 띠바 위치(§2.3)·접기 toolbar 버튼(§2.6)·문구 2종·받아쓰기 억제(§2.2)는 해당 절에 반영. 설계 리뷰는 생략 — 검증된 계약의 재배치(새 불변식·외부 통합·비가역 변경 없음)이고 실기기 VO 순서가 게이트. 실기기 관찰 항목은 `docs/FIELD-TEST.md` N1③.

