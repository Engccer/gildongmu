# N1 안내 세션 앱 승격 + 시트 최소화 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans(inline). 판정 근거: 태스크 1(소유권·진입점)이 2~7의 인터페이스를 정하고 같은 파일(`DirectionsTabView`·`GildongmuApp`)을 여러 태스크가 편집한다 — 순차 의존·단일 도메인이라 inline.

**Goal:** 안내 세션을 앱 수준으로 올려 탭 전환·시트 닫힘과 분리하고, 탭 바 위 띠바로 복귀시키며, 중복 시작은 거부한다.

**Architecture:** `GuideSession`(앱 싱글턴)이 `BeaconModel`·`TransitGuideModel`을 소유하고 시작 진입점·최소화 상태·핸드오프를 들며, 시트는 `GildongmuApp` 루트의 `.sheet(item:)` 하나, 띠바는 `.safeAreaInset(.bottom)`. `GuideSessionCoordinator`는 Kit으로 옮겨 거부 정책을 테스트한다.

**Tech Stack:** SwiftUI(iOS 18+), Swift Testing(Kit), Vitest(게이트 드리프트).

**Spec:** `docs/superpowers/specs/2026-08-22-guide-session-minimize-design.md`

## Global Constraints
- 안전 인자 기본값 금지(`accessible`·`kind`). 거리 표기는 `formatDistance`만, 낭독은 `spokenDistanceUnits`.
- 통지는 모델 `announce` 창구만(직접 `AccessibilityNotification` 게시 금지, 띠바는 live region 아님).
- i18n 키는 `guide`·`ios.guide` 네임스페이스, 6개 로케일 동시, `node ios/scripts/messages-to-xcstrings.mjs` 재생성.
- 새 Swift 파일은 pbxproj 충돌 1순위 — `GuideSession`·`GuideBandView`는 **기존 파일 `GuideSessionCoordinator.swift`(앱, 이름 유지)에** 넣는다. Kit 파일은 SPM이라 자유.

---

### Task 1: Coordinator Kit 이동 + 거부 정책 (테스트)
- Create `ios/GildongmuKit/Sources/GildongmuKit/GuideSessionCoordinator.swift`(`public`, `@MainActor`, `claim -> Int?`, `isActive`, `release`), `ios/GildongmuKit/Tests/GildongmuKitTests/GuideSessionCoordinatorTests.swift`(빈 claim 성공 / 점유 중 nil + stop 미호출 / release 뒤 성공 / 늦은 release 무시). 테스트용으로 `init()`을 public으로 두고 `shared`는 앱에서 `GuideSession`이 소유.
- Delete 앱 `GuideSessionCoordinator.swift` 내용 → 같은 파일에 Task 2의 `GuideSession` 작성.
- Run: `cd ios/GildongmuKit && swift test --filter GuideSessionCoordinatorTests`.

### Task 2: `GuideSession` + 모델 진입점
- `BeaconModel`: `toggle` 시작 분기가 `GuideSession.shared.startBeacon(request)`를 타도록 `StartRequest`를 `internal`로 열고 `func requestStart(_:)`(거부 게이트: `GuideSession.shared.isActive` → `announceNow(guide.alreadyActive, .high)`; 통과 시 `lastStartRequest` 기록 + `begin`). `start()`의 `claim` nil → 같은 통지 후 return. `stopByUser(endScreen:)` → `stopByUser()`(`.immediate` 동작만), `pendingEndScreen`·`presentPendingEndScreen`·`hasPendingEndScreen`·`stopBecauseDestinationChanged` 삭제. `bandDistanceMeters: Int?`(10m 양자화, `updateRemaining`과 간략 fix 경로에서 갱신, `start`·`changeDestination`·`stop`에서 nil).
- `TransitGuideModel`: `start(transitRoute:destinationLabel:dest:accessible:)` — 거부 판정 선행, `dest`·`accessible` 보관(`private(set)`), `claim` nil → 통지. `stopBecauseDestinationChanged` 삭제.
- `GuideSession`(앱 `GuideSessionCoordinator.swift`): `shared`, `coordinator`, `beacon`, `transit`, `isMinimized`, `returnedFromBand: GuideScreenKind?`, `waypointAvailable = false`, `isActive`, `hasScreen`, `screen`, `presentedScreen`, `startBeacon(_:)`, `startTransit(route:label:dest:accessible:)`, `acceptWalkHandoff()`(transit.stop → clearWalkHandoff → 600ms Task → beacon.requestStart walk), `cancelWalkHandoffTask()`, `handleScenePhaseChange`. `enum GuideScreenKind: Identifiable { beacon, transit }`.
- `GuideFormSyncStore`(같은 파일): `@MainActor @Observable`, `pending`, `take()`.
- Build: `xcodebuild -project ios/Gildongmu.xcodeproj -scheme Gildongmu -destination 'generic/platform=iOS Simulator' build` (이 시점엔 DirectionsTabView가 깨짐 — Task 3까지 묶어 빌드).

### Task 3: `DirectionsTabView` 탈소유
- `@State beacon/transitGuide` → `private let session = GuideSession.shared` + `private var beacon { session.beacon }`·`transitGuide`.
- 두 `.sheet` 블록 삭제, `onDisappear`의 teardown 삭제 + `outputSuppressed=false` 2종, `.onChange(of: scenePhase)` 삭제, `.onChange(endpoint .to)` 자동 중지 삭제(`guidanceInitiatedEndpoint` 삭제), `startWalkHandoff` 삭제(`walkHandoffTask` 삭제).
- 시작 버튼: 경로 행 3종·대중교통 대안은 `session.startBeacon(...)`/`session.startTransit(...)`; 인라인 겸용 버튼만 `beacon.toggle`. `stopByUser(endScreen:)` 호출 갱신.
- 폼 동기화: `.onChange(of: GuideFormSyncStore.shared.pending)`+`.task`에서 `take()` → `syncFormAfterGuidanceChange`(플래그 없이 setEndpoint+silent runQuery).
- 시트 닫힘 포커스 복귀(`landBeaconStartFocus`)는 `session.isMinimized`·`hasScreen` 변화에 묶어 길찾기 탭이 보일 때만.

### Task 4: 루트 시트 + 띠바 + 포커스 (`GildongmuApp.swift`, `GuideBandView`)
- `.sheet(item:)` 바인딩(set nil → `isMinimized = true`), 내용은 `BeaconTrackingSheet(model:onStop:onDestinationCommitted:)`/`TransitTrackingSheet(model:onStop:onWalkHandoff:detailDest:onDestinationCommitted:)` — `onWalkHandoff: { session.acceptWalkHandoff() }`, `onDestinationCommitted: { GuideFormSyncStore.shared.pending = $0 }`.
- `.onChange(of: session.hasScreen)` false → `isMinimized=false`, `returnedFromBand=nil`, `bandFocused=false`.
- `.onChange(of: session.isMinimized)` true → `landBandFocus()`(지연 350ms → 대입 → 검증 → 1회 재시도).
- `.safeAreaInset(edge: .bottom) { if hasScreen && isMinimized { GuideBandView(session:) } }`: 단일 Button(라벨 = 요약 + `guide.band.return`), 액션 `returnedFromBand = screen; isMinimized = false`.
- 요약 문장: `GuideBandText.summary(session:)`(앱) ← Kit `guideBandSummary(...)`(Task 5).
- scenePhase 전달을 여기로.
- 유휴 리셋 예외 `!session.isActive`.

### Task 5: Kit `GuideBand.swift` + 테스트
- `public enum GuideBandSummary: Equatable { case waiting(stop:line:), riding(line:remaining:Int?), arrived, destChangePending(label:) }`, `public func guideBandSummary(phase: TransitPhase?, legStop: String?, legLine: String?, remaining: Int?, hasHandoff: Bool, destChangeLabel: String?) -> GuideBandSummary?`. 우선순위: destChange > handoff(arrived) > phase(arrived/done→arrived, riding→riding, waiting/boarding→waiting) > nil.
- 테스트 6케이스.

### Task 6: 시트 최소화 버튼 + 닫기 명시화
- `BeaconTrackingSheet`: `onMinimize` 콜백·`minimizeFocused` Bool, "안내 종료" 앞에 `guide.minimize` 버튼, `.task`에서 `returnedFromBand == .beacon`이면 최소화 버튼 착지(소비). 도착·요약 화면 "닫기" → `onClose`(=`model.clearArrival()`), `dismiss()` 제거. `onStop` 호출부 갱신.
- `TransitTrackingSheet`: `SheetControl.minimize`, 같은 규칙, 핸드오프 제안 "닫기" → `model.clearWalkHandoff()`.
- `PlaceDetailView`: 길찾기 섹션에 `guide.changeDestHere`(추적 중)·`guide.addWaypointHere`(`waypointAvailable`) 버튼.

### Task 7: i18n·게이트·문서
- `messages/*.json` 6개: `guide.alreadyActive`, `guide.minimize`, `guide.band.return`, `guide.band.remaining`, `guide.band.starting`, `guide.band.arrived`, `guide.band.ended`, `guide.band.transitWaiting`, `guide.band.transitRiding`, `guide.band.transitRidingNoCount`, `guide.band.transitArrived`, `guide.band.transitDestChangePending`, `guide.changeDestHere`, `guide.addWaypointHere`, `guide.transitDestChangePrepared`. xcstrings 재생성·키 린트.
- `guidance-gate-drift.test.ts` 갱신(파일 3개·호출 4종) + 2026-08-15 spec §3.2 표.
- `npm run test:run`, Kit `swift test`, 시뮬 빌드. 문서 분배(CHANGELOG·BACKLOG N1 종결+후속·PROGRESS·CLAUDE.md 함정) → 리뷰 → 통합 → 실기기 2구성 배포.
