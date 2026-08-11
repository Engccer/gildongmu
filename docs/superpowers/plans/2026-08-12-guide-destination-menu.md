# 안내 시트 목적지 메뉴 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 실시간 안내 시트 제목을 컨텍스트 메뉴로 바꿔 "장소 상세 보기"와 "목적지 바꾸기"(검색·최근 목록, 끊김 없는 전환)를 제공한다.

**Architecture:** 스펙 `docs/superpowers/specs/2026-08-12-guide-destination-menu-design.md`가 정본. 새 기계 최소화 — 도보·자동차는 `awaitingRoute` 보류+fix 트리거 경로 재획득 재사용, 대중교통은 `pollTask` 취소가 곧 세대 경계, 검색은 `DirectionsEndpointSearchView` 재사용.

**Tech Stack:** SwiftUI(@Observable), GildongmuKit, messages→xcstrings 파이프라인.

**구현 방식 판정(자율성 헌장):** inline. 근거 — 태스크가 같은 파일(BeaconModel·두 시트·DirectionsTabView)을 연쇄 수정하고 모델 API 시그니처가 뷰 배선을 정하는 강한 순차 의존이며, 최종 게이트가 실기기 VoiceOver라 탐색적이다.

## Global Constraints

- 접근성 헌장 준수: 활성화 응답 통지 `.high`, 한 줄=한 객체(`joinText`), 포커스 착지는 "가시화→지연→대입→검증→1회 재시도" 정본 패턴.
- 통지 문장은 완성 문장 조립(슬롯 채우기 금지).
- i18n 키는 6로케일(messages/*.json) 동시 추가 후 `node ios/scripts/messages-to-xcstrings.mjs app` 재생성(수기 xcstrings 편집 금지).
- 새 Swift 파일은 `ios/Gildongmu/` 하위에 두면 자동 포함(폴더 동기화 그룹 — pbxproj 편집 금지).
- 커밋은 의도 파일 pathspec만(`git add -A` 금지). 신규 파일은 `git add <파일> && git commit -- <파일들>` 원자 실행.
- 앱 타깃(BeaconModel 등)은 단위 테스트 레인이 없다(Kit 전용 관례) — 게이트는 시뮬 빌드+기존 스위트+실기기.

---

### Task 1: i18n 키 추가

**Files:**
- Modify: `messages/ko.json`, `messages/en.json`, `messages/es.json`, `messages/fr.json`, `messages/it.json`, `messages/ja.json`
- Regenerate: `ios/Gildongmu/Resources/Localizable.xcstrings`

**Interfaces:**
- Produces: 아래 9키. 이후 모든 태스크의 `appLocalized` 호출이 이 키를 쓴다.

- [ ] **Step 1: ko.json에 키 추가** (`ios` 네임스페이스 안, 기존 `ios.guide.*`·`ios.transitGuide.*` 인접 위치에)

ko 값(다른 로케일은 같은 구조로 번역, en 예시 병기):

```json
"guide": {
  "destMenuDetail": "장소 상세 보기",          // en: "View place details"
  "destMenuChange": "목적지 바꾸기",            // en: "Change destination"
  "destChanged": "새 목적지 {name}.",           // en: "New destination: {name}."
  "destChangedFetching": "경로를 조회하고 있습니다.", // en: "Finding a new route."
},
"transitGuide": {
  "destChangeHeading": "새 경로 선택, {name}",   // en: "Choose a new route, {name}"
  "destChangeLoading": "새 경로를 조회하고 있습니다.", // en: "Finding new routes."
  "destChangeNone": "새 목적지로 가는 대중교통 경로가 없습니다.", // en: "No transit route to the new destination."
  "destChangeError": "경로 조회에 실패했습니다.",  // en: "Route lookup failed."
  "destChangeRefetched": "위치가 바뀌어 경로를 다시 조회했습니다.", // en: "Routes refreshed for your current location."
  "destChangeCancel": "목적지 변경 취소"          // en: "Cancel destination change"
}
```

⚠ 실제 키 경로는 기존 파일의 중첩 구조를 따른다(`ios.guide.destMenuDetail` 형태 — 기존 `ios.guide.routeListRow` 인접에 두고 구조를 맞출 것).

- [ ] **Step 2: 나머지 5로케일에 같은 키 추가** (es/fr/it/ja는 해당 언어 번역)

- [ ] **Step 3: 키 패리티 게이트 실행**

Run: `npx vitest run src/i18n --reporter=basic 2>&1 | tail -5` (i18n-messages 테스트 파일 경로는 `git grep -l i18n-messages src` 로 확인)
Expected: PASS

- [ ] **Step 4: xcstrings 재생성 + 린터**

Run: `node ios/scripts/messages-to-xcstrings.mjs app && node ios/scripts/check-xcstrings-keys.mjs`
Expected: 재생성 완료, 린터 통과(신규 키는 아직 미사용이라 미사용 경고가 나면 무시 기준 확인 — 사용처는 이후 태스크가 추가)

- [ ] **Step 5: 커밋**

```bash
git add messages/*.json ios/Gildongmu/Resources/Localizable.xcstrings
git commit -m "feat(guide): 목적지 메뉴 i18n 키 6로케일 추가" -- messages ios/Gildongmu/Resources/Localizable.xcstrings
```

---

### Task 2: BeaconModel.changeDestination

**Files:**
- Modify: `ios/Gildongmu/Directions/BeaconModel.swift`

**Interfaces:**
- Consumes: Task 1의 `ios.guide.destChanged`·`ios.guide.destChangedFetching`.
- Produces: `@discardableResult func changeDestination(dest:label:) -> Bool` (true = 세션에 반영됨 → 호출부가 폼 동기화), `announce(_:highPriority:bypassSuppression:)`.

- [ ] **Step 1: announce에 bypassSuppression 파라미터 추가** (기존 호출부 불변)

```swift
@discardableResult
private func announce(
    _ message: String, highPriority: Bool = false, bypassSuppression: Bool = false
) -> Bool {
    guard bypassSuppression || !outputSuppressed else { return false }
    // …기존 본문 그대로…
```

- [ ] **Step 2: changeDestination 구현** (`stopBecauseDestinationChanged` 근처에 추가)

```swift
/// 목적지 전환(스펙 2026-08-12 §3.1) — 같은 세션의 경로 재획득. 세션(톤·위치 스트림·
/// 워치독)은 유지하고 경로·목적지 종속 상태만 내려놓은 뒤, 다음 수용 fix가
/// fetchGuideRoute를 트리거한다(start()와 같은 기계 — 옛 경로 발화 창을 구조적으로 차단).
/// 반환 false = 세션이 이미 죽어 선택을 폐기(스펙 §3.2 — 호출부는 폼도 건드리지 않는다).
@discardableResult
func changeDestination(dest newDest: BeaconDest, label: String) -> Bool {
    guard isTracking else { return false }
    if dest == newDest {
        // 같은 좌표 재선택(§3.2): 재조회 없이 확인 통지만. 라벨은 최신본으로.
        destinationLabel = label
        announce(appLocalized("ios.guide.destChanged", label),
                 highPriority: true, bypassSuppression: true)
        return true
    }
    dest = newDest
    destinationLabel = label
    // — 경로 종속 상태 초기화(stop()의 부분집합, §3.1 목록) —
    routeFetchTask?.cancel(); routeFetchTask = nil
    fixWaitTask?.cancel(); fixWaitTask = nil
    rerouteToken += 1
    routeFetchToken += 1
    isRerouting = false
    offRoute = false
    guideRoute = nil
    guideRouteDurationSeconds = nil
    guideState = nil
    lastGuidance = nil
    remainingText = nil
    currentGuidanceText = nil
    clearLiveRows()
    displayUnits = []
    liveSteps = []
    liveBaselineD = 0
    roadSpans = []
    etaTask?.cancel(); etaTask = nil
    etaSeconds = nil; etaUpdatedAt = nil; etaCallCount = 0
    pendingRecovery = nil
    pendingStepFreeNotice = nil
    lastStepFree = nil
    resetFinalApproach(geometry: nil)
    mode = .brief
    statusText = ""
    // — 목적지 종속 추세 초기화(간략 안내의 접근/이탈 추세는 옛 목적지 기준) —
    beaconState = .initial
    gateState = .initial
    toneState = .initial
    // motionState(도플러)·유도기 버퍼(guideState 소거로 새 조회 시 initialDerivationState)·
    // accessible은 위치·세션 종속이라 승계(§3.1).
    // — 즉시 확인 통지(§3.1: 억제 우회 — 검색 시트 dismiss와 억제 해제의 경합) —
    let fetching = AppLanguage.dataLocale == "ko"
    let ack = fetching
        ? appLocalized("ios.guide.destChanged", label) + " "
            + appLocalized("ios.guide.destChangedFetching")
        : appLocalized("ios.guide.destChanged", label)
    announce(ack, highPriority: true, bypassSuppression: true)
    if fetching {
        awaitingRoute = true
        startFixWaitWatch(token: routeFetchToken)
    }
    return true
}
```

⚠ `rerouteInFlight` 리셋 여부는 실제 선언(defer가 되돌리는지) 확인 후 결정 — `performReroute`의 defer가 자기 호출에서 되돌리므로 건드리지 않는 것이 기본. ⚠ 유도기 버퍼 승계: 스펙 §3.1은 승계라 했으나 `guideState`를 nil로 내리면 다음 `fetchGuideRoute`의 `initialGuideState`가 냉시동한다 — `performReroute`처럼 `courseDerivation`을 살리려면 nil 대입 전에 `let carried = guideState?.courseDerivation`로 보관했다가 fetch 성공 경로에서 잇는 구현이 필요한지 `fetchGuideRoute`의 `initialGuideState` 호출 시그니처를 보고 판단하라(현행 `fetchGuideRoute`는 courseDerivation 인자 없이 부른다 — 보관·전달 인자를 추가하는 쪽이 스펙 §3.1 승계 조항의 정확한 구현이다).

- [ ] **Step 3: 빌드 확인**

Run: `xcodebuild -project ios/Gildongmu.xcodeproj -scheme Gildongmu -destination 'platform=iOS Simulator,name=iPhone 16' build 2>&1 | tail -3`
Expected: BUILD SUCCEEDED (스킴 이름이 다르면 `xcodebuild -list -project ios/Gildongmu.xcodeproj`로 확인)

- [ ] **Step 4: 커밋**

```bash
git commit -m "feat(guide): BeaconModel 목적지 전환 — 세션 유지 경로 재획득" -- ios/Gildongmu/Directions/BeaconModel.swift
```

---

### Task 3: TransitGuideModel 2단 확정 기계

**Files:**
- Modify: `ios/Gildongmu/Directions/TransitGuideModel.swift`

**Interfaces:**
- Consumes: Task 1 키, `RouteService.transit(originLat:originLng:destLat:destLng:includeStops:)`.
- Produces: `outputSuppressed: Bool`, `pendingDestChange: PendingDestChange?`(`.phase`: loading/loaded/empty/failed), `prepareDestinationChange(dest:label:)`, `commitDestinationChange(_ route: TransitRoute) -> Bool`, `cancelDestinationChange()`.

- [ ] **Step 1: 상태·서비스 추가**

```swift
/// 목적지 전환 준비 상태(스펙 §4). nil = 진행 중인 전환 없음.
struct PendingDestChange {
    let dest: BeaconDest
    let label: String
    var phase: Phase
    var fetchedAt: Date?
    enum Phase: Equatable { case loading, loaded(TransitRouteResult), empty, failed }
}
private(set) var pendingDestChange: PendingDestChange?
/// latest-wins 토큰(§4.1) — 취소·재시도가 늦은 응답을 폐기한다.
private var destChangeToken = 0
/// stale 후보 문턱(§4.2, 잠정값 — 실사용 판정 대상).
private static let destChangeStaleSeconds: TimeInterval = 120
/// 검색 시트가 열린 동안 통지·톤 억제(스펙 §5.4, BeaconModel 동형).
/// stop()이 무조건 해제한다(잔류 억제로 다음 세션 무음 방지).
var outputSuppressed = false {
    didSet { tones.isSuppressed = outputSuppressed }
}
private let routeService = RouteService(client: APIClient(baseURL: AppConfig.apiBaseURL))
```

⚠ `announce(_:highPriority:)`(line ~595)에 `guard !outputSuppressed else { return }` 첫 가드를 추가한다(비콘 동형). ⚠ `BeaconDest`가 이 파일에서 보이는지 확인(같은 앱 타깃이면 import 불요).

- [ ] **Step 2: prepare/fetch/commit/cancel/changeRoute 구현**

```swift
// MARK: - 목적지 전환(스펙 2026-08-12 §4)

func prepareDestinationChange(dest: BeaconDest, label: String) {
    guard isTracking else { return }
    destChangeToken += 1
    let token = destChangeToken
    pendingDestChange = PendingDestChange(dest: dest, label: label, phase: .loading, fetchedAt: nil)
    Task { await fetchDestChangeCandidates(token: token) }
}

private func fetchDestChangeCandidates(token: Int) async {
    guard let pending = pendingDestChange else { return }
    do {
        let origin = try await LocationService.shared.currentCoordinate()
        guard token == destChangeToken, isTracking else { return }
        let result = try await routeService.transit(
            originLat: origin.lat, originLng: origin.lng,
            destLat: pending.dest.lat, destLng: pending.dest.lng,
            includeStops: true)
        guard token == destChangeToken, isTracking else { return }
        if let result {
            pendingDestChange?.phase = .loaded(result)
            pendingDestChange?.fetchedAt = Date()
        } else {
            pendingDestChange?.phase = .empty
        }
    } catch {
        guard token == destChangeToken, isTracking else { return }
        pendingDestChange?.phase = .failed
    }
}

/// 후보 선택 = 확정(§4.1·§4.3). false = 확정 불발(세션 사망·stale 재조회) —
/// 호출부는 폼 동기화를 하지 않는다.
func commitDestinationChange(_ route: TransitRoute) -> Bool {
    guard isTracking, let pending = pendingDestChange,
          case .loaded = pending.phase else { return false }
    // stale 후보 가드(§4.2): 조회 후 120초 경과면 그 후보로 확정하지 않고 재조회.
    if let fetchedAt = pending.fetchedAt,
       Date().timeIntervalSince(fetchedAt) > Self.destChangeStaleSeconds {
        destChangeToken += 1
        let token = destChangeToken
        pendingDestChange?.phase = .loading
        pendingDestChange?.fetchedAt = nil
        announce(appLocalized("ios.transitGuide.destChangeRefetched"))
        Task { await fetchDestChangeCandidates(token: token) }
        return false
    }
    guard changeRoute(transitRoute: route, destinationLabel: pending.label) else { return false }
    pendingDestChange = nil
    return true
}

func cancelDestinationChange() {
    destChangeToken += 1
    pendingDestChange = nil
}

/// 세션 연속 경로 교체(§4.3). pollTask 취소가 곧 세대 경계다 — 루프의
/// `Task.isCancelled` 가드가 옛 응답 커밋을 이미 막는다(별도 세대 카운터 불요).
/// `state`는 이 동기 함수 안에서만 갈아끼워 nil을 스치지 않는다(시트 presentation).
private func changeRoute(transitRoute: TransitRoute, destinationLabel: String) -> Bool {
    guard let guideRoute = buildTransitGuideRoute(transitRoute) else { return false }
    pollTask?.cancel()
    pollTask = nil
    pendingWalkHandoff = nil
    self.route = guideRoute
    self.destinationLabel = destinationLabel
    seq = 0
    retained = [:]
    tagoResolved = [:]
    tagoUnsupported = []
    waitingLive = []
    waitingDeparted = []
    waitingReason = nil
    refreshAnnounce = false
    state = initTransitGuide(route: guideRoute, now: nowMs())
    let first = guideRoute.legs[0]
    var parts = [
        appLocalized("ios.guide.destChanged", destinationLabel),
        appLocalized("transitGuide.started", String(guideRoute.legs.count)),
        waitContextText(first),
    ]
    if first.trackMode == nil { parts.append(appLocalized("transitGuide.untrackable")) }
    // 활성화 응답(후보 버튼이 사라지는 전이) — .high(헌장 §6).
    announce(parts.joined(separator: " "), highPriority: true)
    restartPollLoop(immediate: true)
    return true
}
```

- [ ] **Step 3: stop()에 전환 상태 소거 추가**

`stop()` 본문 끝에:

```swift
destChangeToken += 1
pendingDestChange = nil
outputSuppressed = false
```

- [ ] **Step 4: 빌드 확인** (Task 2 Step 3과 동일 명령)

- [ ] **Step 5: 커밋**

```bash
git commit -m "feat(guide): TransitGuideModel 목적지 전환 2단 확정 — 사이드 채널 후보·stale 가드·세션 연속 교체" -- ios/Gildongmu/Directions/TransitGuideModel.swift
```

---

### Task 4: GuideTitleMenu + PlaceDetailView 파라미터 + 최소 Place

**Files:**
- Create: `ios/Gildongmu/Directions/GuideTitleMenu.swift`
- Modify: `ios/Gildongmu/PlaceDetailView.swift`

**Interfaces:**
- Produces: `GuideTitleMenu(heading:label:onShowDetail:onChangeDestination:)`, `guideDestinationPlace(dest:label:) -> Place`, `PlaceDetailView(place:showsDirectionsEntry:)`.

- [ ] **Step 1: GuideTitleMenu.swift 작성**

```swift
import GildongmuKit
import SwiftUI

/// 안내 시트 추적 섹션 헤더의 제목 메뉴(스펙 2026-08-12 §1). 라벨은 종전 헤더와 같은
/// 합친 한 줄이라 VoiceOver가 "수단 안내, 목적지, 팝업 버튼"으로 낭독하고, 헤딩
/// trait를 유지해 헤딩 로터 항행을 보존한다(실기기 판정 §8 — 어색하면 폴백:
/// 헤더 텍스트 유지 + 섹션 첫 행 메뉴 버튼).
struct GuideTitleMenu: View {
    let heading: String
    let label: String
    let onShowDetail: () -> Void
    let onChangeDestination: () -> Void

    var body: some View {
        Menu(joinText(heading, label)) {
            Button(appLocalized("ios.guide.destMenuDetail"), action: onShowDetail)
            Button(appLocalized("ios.guide.destMenuChange"), action: onChangeDestination)
        }
        .accessibilityAddTraits(.isHeader)
    }
}

/// 안내 목적지의 최소 Place 변환(스펙 §2 — cultureEventToPlace 선례).
/// 주소·카테고리 빈 값이어도 상세의 주변 섹션은 좌표만으로 성립한다.
func guideDestinationPlace(dest: BeaconDest, label: String) -> Place {
    Place(
        id: "guide-dest:\(dest.lat),\(dest.lng)", name: label, category: "",
        address: "", roadAddress: "", englishAddress: nil,
        lat: dest.lat, lng: dest.lng, phone: nil, link: nil, distanceMeters: nil)
}
```

⚠ `Place`에 public memberwise init이 없으면 기존 `*ToPlace` 변환 함수의 생성 방식을 그대로 따른다.

- [ ] **Step 2: PlaceDetailView에 showsDirectionsEntry 추가**

`let place: Place` 아래에 `var showsDirectionsEntry: Bool = true` 저장 프로퍼티를 추가하고, 두 init(`init(place:)`·`init(place:domainSection:)`)에 `showsDirectionsEntry: Bool = true` 파라미터를 통과시킨다(기본값 유지 = 기존 호출부 전부 불변). `Button(appLocalized("directions.toHere"))` 블록을 `if showsDirectionsEntry { … }`로 감싼다.

- [ ] **Step 3: 빌드 확인 + 커밋**

```bash
git add ios/Gildongmu/Directions/GuideTitleMenu.swift
git commit -m "feat(guide): 제목 메뉴 공용 뷰 + 장소 상세 길찾기 진입 게이트" -- ios/Gildongmu/Directions/GuideTitleMenu.swift ios/Gildongmu/PlaceDetailView.swift
```

---

### Task 5: 도보·자동차 배선 (BeaconTrackingSheet + DirectionsTabView)

**Files:**
- Modify: `ios/Gildongmu/Directions/BeaconTrackingSheet.swift`
- Modify: `ios/Gildongmu/Directions/DirectionsTabView.swift`

**Interfaces:**
- Consumes: Task 2 `changeDestination`, Task 4 `GuideTitleMenu`·`guideDestinationPlace`·`showsDirectionsEntry`.
- Produces: `BeaconTrackingSheet(model:onStop:onDestinationCommitted:)`, `DirectionsModel.runQuery(silently:)`, 탭의 `guidanceInitiatedEndpoint` 가드.

- [ ] **Step 1: BeaconTrackingSheet에 메뉴·시트 2종 배선**

상태 추가:

```swift
let onDestinationCommitted: (DirectionsEndpoint) -> Void
@State private var changeDestPresented = false
@State private var showPlaceDetail = false
```

추적 섹션 헤더 교체(도착 섹션 헤더는 불변):

```swift
} header: {
    GuideTitleMenu(
        heading: appLocalized(
            model.sessionKind == .car ? "beacon.carHeading" : "beacon.walkHeading"),
        label: model.destinationLabel,
        onShowDetail: { showPlaceDetail = true },
        onChangeDestination: { changeDestPresented = true })
}
```

시트·억제 배선(기존 `.sheet(isPresented: $showRouteList)` 인접에):

```swift
// 목적지 검색(스펙 §3): 최근 목록 포함 기존 시트 재사용. 세션이 죽었으면
// changeDestination이 false를 돌려 폼도 건드리지 않는다(§3.2).
.sheet(isPresented: $changeDestPresented) {
    DirectionsEndpointSearchView(target: .to) { endpoint in
        guard case .place(let label, let lat, let lng) = endpoint else { return }
        if model.changeDestination(dest: BeaconDest(lat: lat, lng: lng), label: label) {
            onDestinationCommitted(endpoint)
        }
        Task { await landStopFocus() }
    }
}
// 검색 시트에 받아쓰기 마이크가 있다 — 열린 동안 톤·통지 전부 억제(스펙 §5.4).
.onChange(of: changeDestPresented) { model.outputSuppressed = changeDestPresented }
// 장소 상세(스펙 §2): 표준 중첩 시트, 안내 신호는 유지(억제 없음).
.sheet(isPresented: $showPlaceDetail) {
    if let dest = model.dest {
        NavigationStack {
            PlaceDetailView(
                place: guideDestinationPlace(dest: dest, label: model.destinationLabel),
                showsDirectionsEntry: false)
        }
    }
}
```

- [ ] **Step 2: DirectionsModel에 무통지 조회 모드**

```swift
/// 안내 주도 재조회(스펙 §5.3): 완료·실패 통지를 전부 삼킨다. 결과는 시트 뒤
/// 화면 최신화용이라 통지가 안내 발화와 경합할 이유가 없다.
private var silentQuery = false

func runQuery(silently: Bool = false) {
    if isInFlight { return }
    silentQuery = silently
    // …기존 본문 그대로…
}

private func announce(_ message: String) {
    guard !silentQuery else { return }
    AccessibilityNotification.Announcement(message).post()
}
```

⚠ 기존 `runQuery()` 호출부는 기본값으로 전부 불변.

- [ ] **Step 3: 탭의 가드 통과 + 폼 동기화**

`DirectionsTabView`에 상태 추가:

```swift
/// 안내 주도 목적지 변경의 값 결합 1회 소비 플래그(스펙 §5.2 — Boolean 금지).
@State private var guidanceInitiatedEndpoint: DirectionsEndpoint?
```

기존 onChange 교체:

```swift
.onChange(of: model.endpoint(for: .to)) { _, newValue in
    // 안내 주도 변경(스펙 §5.2): 예상 값과 일치하는 1회만 중지를 생략한다.
    if let expected = guidanceInitiatedEndpoint, expected == newValue {
        guidanceInitiatedEndpoint = nil
        return
    }
    guidanceInitiatedEndpoint = nil
    beacon.stopBecauseDestinationChanged()
    transitGuide.stopBecauseDestinationChanged()
}
```

동기화 함수 + 시트 호출부:

```swift
/// 안내 주도 목적지 변경의 폼 동기화(스펙 §5): 출발지=현재 위치(세션과 의미 일치),
/// 도착지=새 목적지(최근 기록은 setEndpoint 경로), 무통지 재조회.
private func syncFormAfterGuidanceChange(_ endpoint: DirectionsEndpoint) {
    guard endpoint != model.endpoint(for: .to) else { return }  // §3.2 동일값 무변화
    if model.endpoint(for: .from) != .current { model.setEndpoint(.current, for: .from) }
    guidanceInitiatedEndpoint = endpoint
    model.setEndpoint(endpoint, for: .to)
    model.runQuery(silently: true)
}
```

```swift
BeaconTrackingSheet(
    model: beacon,
    onStop: { beacon.stop(playStopTone: true) },
    onDestinationCommitted: { syncFormAfterGuidanceChange($0) }
)
```

⚠ `setEndpoint(.current, for: .from)`은 `.to` onChange를 발화시키지 않고, `recordRecent`는 `.place`만 기록하므로 부작용 없음.

- [ ] **Step 4: 빌드 확인 + 커밋**

```bash
git commit -m "feat(guide): 도보·자동차 안내 중 목적지 전환 배선 — 값 결합 가드·무통지 재조회" -- ios/Gildongmu/Directions/BeaconTrackingSheet.swift ios/Gildongmu/Directions/DirectionsTabView.swift
```

---

### Task 6: 대중교통 배선 (TransitTrackingSheet + 탭 파라미터)

**Files:**
- Modify: `ios/Gildongmu/Directions/TransitTrackingSheet.swift`
- Modify: `ios/Gildongmu/Directions/DirectionsTabView.swift`

**Interfaces:**
- Consumes: Task 3 모델 API, Task 4 뷰·헬퍼, Task 5 `syncFormAfterGuidanceChange`. `transitRouteEntries`·`TransitRouteEntry`(DirectionsTabView.swift 파일 하단 `private` — **`private` 키워드를 제거해 internal로 승격**, `transitSummaryText`도 같은 방식으로 소재 확인 후 승격).
- Produces: `TransitTrackingSheet(model:onStop:onWalkHandoff:detailDest:onDestinationCommitted:)`.

- [ ] **Step 1: 파라미터·상태 추가**

```swift
/// 장소 상세 앵커(모델은 라벨만 알므로 탭의 trackedDestination 좌표를 받는다).
let detailDest: BeaconDest?
let onDestinationCommitted: (DirectionsEndpoint) -> Void
@State private var changeDestPresented = false
@State private var showPlaceDetail = false
@AccessibilityFocusState private var destChangeStatusFocused: Bool
@AccessibilityFocusState private var focusedDestChangeRoute: String?
private static let destChangeStatusId = "transit-dest-change-status"
```

- [ ] **Step 2: 헤더를 메뉴로 교체** (핸드오프 섹션 헤더는 불변)

```swift
} header: {
    GuideTitleMenu(
        heading: appLocalized("beacon.transitHeading"),
        label: model.destinationLabel,
        onShowDetail: { showPlaceDetail = true },
        onChangeDestination: { changeDestPresented = true })
}
```

- [ ] **Step 3: 후보 섹션 + 시트 배선**

본문 List에 메인 Section 다음, `walkHandoffSection` 분기와 병렬로:

```swift
if model.state != nil { destChangeSection(proxy: proxy) }
```

```swift
/// 새 경로 후보 섹션(스펙 §4). 확정 전이라 메인 컨트롤(옛 목적지 안내)은 그대로
/// 남는다 — 중간 상태를 만들지 않는 것이 계약이고, 화면의 두 섹션 공존이 그 표현이다.
@ViewBuilder private func destChangeSection(proxy: ScrollViewProxy) -> some View {
    if let pending = model.pendingDestChange {
        Section {
            switch pending.phase {
            case .loading:
                Text(appLocalized("ios.transitGuide.destChangeLoading"))
                    .accessibilityFocused($destChangeStatusFocused)
                    .id(Self.destChangeStatusId)
            case .empty:
                Text(appLocalized("ios.transitGuide.destChangeNone"))
                    .accessibilityFocused($destChangeStatusFocused)
                    .id(Self.destChangeStatusId)
            case .failed:
                Text(appLocalized("ios.transitGuide.destChangeError"))
                    .accessibilityFocused($destChangeStatusFocused)
                    .id(Self.destChangeStatusId)
            case .loaded(let result):
                ForEach(transitRouteEntries(result), id: \.route.routeKey) { entry in
                    Button(joinText(entry.name, transitSummaryText(entry.route.summary))) {
                        if model.commitDestinationChange(entry.route) {
                            onDestinationCommitted(.place(
                                label: pending.label,
                                lat: pending.dest.lat, lng: pending.dest.lng))
                            Task { await landStopFocus() }
                        } else {
                            // stale 재조회(§4.2) — 상태 행으로 복귀(선택 행이 사라진다).
                            landDestChangeStatusFocus(proxy)
                        }
                    }
                    .accessibilityFocused($focusedDestChangeRoute, equals: entry.route.routeKey)
                }
            }
            Button(appLocalized("ios.transitGuide.destChangeCancel")) {
                model.cancelDestinationChange()
                Task { await landStopFocus() }
            }
        } header: {
            Text(appLocalized("ios.transitGuide.destChangeHeading", pending.label))
                .accessibilityAddTraits(.isHeader)
        }
    }
}
```

시트·억제·포커스 배선(body 말미):

```swift
.sheet(isPresented: $changeDestPresented) {
    DirectionsEndpointSearchView(target: .to) { endpoint in
        guard case .place(let label, let lat, let lng) = endpoint else { return }
        model.prepareDestinationChange(
            dest: BeaconDest(lat: lat, lng: lng), label: label)
    }
}
.onChange(of: changeDestPresented) { _, presented in
    model.outputSuppressed = presented
    // 검색 시트가 닫히고 전환이 준비 중이면 상태 행 착지(스펙 §4.4).
    if !presented, model.pendingDestChange != nil { landDestChangeStatusFocus(proxy) }
}
.onChange(of: model.pendingDestChange?.phase) { _, phase in
    guard let phase else { return }
    switch phase {
    case .loaded(let result):
        // 첫 후보 착지(정본 패턴). 항목 정체성 = routeKey.
        guard let first = transitRouteEntries(result).first?.route.routeKey else { return }
        Task { @MainActor in
            proxy.scrollTo(first)
            try? await Task.sleep(for: .milliseconds(400))
            focusedDestChangeRoute = first
            try? await Task.sleep(for: .milliseconds(600))
            guard focusedDestChangeRoute != first else { return }
            focusedDestChangeRoute = first
        }
    case .empty, .failed:
        landDestChangeStatusFocus(proxy)  // 조회 중 행이 사라지는 전이(헌장 §5)
    case .loading: break  // 시트 닫힘 onChange가 이미 착지
    }
}
.sheet(isPresented: $showPlaceDetail) {
    if let dest = detailDest {
        NavigationStack {
            PlaceDetailView(
                place: guideDestinationPlace(dest: dest, label: model.destinationLabel),
                showsDirectionsEntry: false)
        }
    }
}
```

```swift
/// 상태 행 착지 — 정본 시퀀스(가시화→지연→대입→검증→1회 재시도).
private func landDestChangeStatusFocus(_ proxy: ScrollViewProxy) {
    Task { @MainActor in
        proxy.scrollTo(Self.destChangeStatusId)
        try? await Task.sleep(for: .milliseconds(400))
        destChangeStatusFocused = true
        try? await Task.sleep(for: .milliseconds(600))
        guard !destChangeStatusFocused else { return }
        destChangeStatusFocused = true
    }
}
```

⚠ `.onChange`가 `proxy`를 쓰므로 배선 위치는 `ScrollViewReader` 클로저 안이어야 한다(기존 `.task`·`.onChange` 위치와 동일 레벨).

- [ ] **Step 4: 탭 호출부 갱신**

```swift
TransitTrackingSheet(
    model: transitGuide,
    onStop: { transitGuide.stop(playStopTone: true) },
    onWalkHandoff: trackedDestination.map { tracked in
        { startWalkHandoff(tracked: tracked) }
    },
    detailDest: trackedDestination?.dest,
    onDestinationCommitted: { syncFormAfterGuidanceChange($0) }
)
```

- [ ] **Step 5: `transitRouteEntries`·`TransitRouteEntry`·`transitSummaryText` private 승격** (정의 이동 없이 `private`만 제거, 주석에 "TransitTrackingSheet 후보 섹션이 공유" 한 줄)

- [ ] **Step 6: 빌드 확인 + 커밋**

```bash
git commit -m "feat(guide): 대중교통 안내 중 목적지 전환 — 후보 2단 확정·포커스 계약" -- ios/Gildongmu/Directions/TransitTrackingSheet.swift ios/Gildongmu/Directions/DirectionsTabView.swift
```

---

### Task 7: 게이트·문서·마무리

**Files:**
- Run: 기존 스위트, 시뮬 스모크
- Modify: `docs/superpowers/specs/2026-08-12-guide-destination-menu-design.md`(§8 현실 갱신), `PROGRESS.md`·`CHANGELOG.md`·`docs/BACKLOG.md`·`PORTS.md`

- [ ] **Step 1: 웹 게이트** — `npm run test:run 2>&1 | tail -5` (messages 변경이 i18n 게이트에 걸리지 않는지 전체 확인)
- [ ] **Step 2: Kit 테스트** — `xcodebuild test -project ios/Gildongmu.xcodeproj -scheme Gildongmu -destination 'platform=iOS Simulator,name=iPhone 16' 2>&1 | tail -5` (기존 테스트 레인 명령이 다르면 그 관례로)
- [ ] **Step 3: 시뮬 스모크** — xcodebuildmcp `simulator build-and-run` + `snapshot-ui`로 ①안내 시트 헤더가 팝업 버튼으로 잡히는지 ②메뉴 항목 2종 노출 ③후보 섹션 렌더를 확인(라벨 회귀 신호용 — 낭독 정본은 실기기)
- [ ] **Step 4: 스펙 §8 갱신** — 단위 테스트 항목을 실제 레인 현실(앱 타깃 무레인 → 시뮬 스모크 대체)로 고치고 커밋
- [ ] **Step 5: 문서 분배** — CHANGELOG(서사)·PROGRESS(상태 한 줄)·BACKLOG(실기기 판정 대기 항목: 헤딩+메뉴 낭독, stale 문턱 120초, 실보행 재현)·PORTS(웹 이식 후보 행)
- [ ] **Step 6: 리뷰 게이트** — code-reviewer 서브에이전트에 diff 범위(마일스톤 전체) 리뷰 의뢰 → 지적 처리 → push
- [ ] **Step 7: 실기기 배포** — 병렬 세션 확인 후 `./ios/deploy-device.sh` (Experimental 여부는 실시간 안내 게이트 구성 확인 후 결정: `AppConfig.realtimeGuidanceEnabled`가 아직 `#if EXPERIMENTAL`이면 `CONFIGURATION=Experimental`)
