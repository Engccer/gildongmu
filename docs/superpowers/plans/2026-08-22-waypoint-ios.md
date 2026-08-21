# N4 경유지 iOS 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** iOS 길찾기 폼·안내 세션·장소 상세에 경유지 1개(도보·자동차)를 얹고, 경유지 도착을 알리되 안내를 멈추지 않는다.

**Architecture:** 서버 `via`·`waypoint{stepIndex,coord}` 계약(서버 spec)을 Kit 모델이 디코딩하고, Kit `RouteGuide` 리듀서가 `waypointStepIndex` 경계 통과를 `waypointReached` 이벤트로 낸다(웹 미러+공유 fixture). `BeaconModel`은 미도착 경유지를 세션 상태로 들고 모든 경로 fetch에 `via`를 싣다가 도착 통지 뒤 비운다. 폼·최근 경로·시트·장소 상세는 그 상태 위의 표면이다.

**Tech Stack:** Swift 6(SwiftUI·Observation·Swift Testing), TypeScript(Vitest) 미러, `messages/*.json` → xcstrings 생성.

**Spec:** `docs/superpowers/specs/2026-08-22-waypoint-ios-design.md`(이하 spec). 서버 계약: `docs/superpowers/specs/2026-08-22-waypoint-server-web-cli-design.md`.

**구현 방식 판정(AUTONOMY §구현 방식):** inline. 근거 — Task 1·2(Kit)가 뒤 태스크의 인터페이스(`via` 인자·`RouteWaypoint`·`waypointStepIndex`·이벤트)를 정하고, Task 4·5·6이 `DirectionsTabView`·`BeaconModel`·`BeaconTrackingSheet`를 연쇄로 고친다(같은 파일 순차 편집). 리뷰는 태스크 묶음별 서브에이전트(spec-compliance + code-quality)로 분리한다.

## Global Constraints

- `RouteService.walk/walkAlternatives/car`의 `via`는 **기본값 없는 필수 인자**(spec §2.2).
- `BeaconModel.StartRequest.waypoint`는 **필수 필드**(spec §4.1).
- 리듀서 블록 순서: W1 감지 → W2 pending 우선 발화 → 6a 임박 → W3 발화 → 6b 최종 접근(미도착 경유지면 금지) → 6c 전문(spec §2.5, 설계 리뷰 반영본). 웹·Kit 동형, 공유 fixture가 고정.
- 경유지 도착 = 통지 + `.nearby` 톤 + `waypoint = nil`, 경로·상태 불변(정지 없음).
- 세션 시작 진입점 수 불변(`guidance-gate-drift.test.ts` 6).
- i18n 신규 키 3개(`ios.guide.waypointChange`·`ios.guide.waypointSet`·`guide.changeWaypointHere`) 6개 로케일 동시, xcstrings는 `node ios/scripts/messages-to-xcstrings.mjs` 재생성 후 `node ios/scripts/check-xcstrings-keys.mjs`.
- 커밋은 pathspec(`git commit -- <files>`), `git add -A` 금지.
- Kit 테스트: `cd ios/GildongmuKit && swift test --filter <이름>`. 웹: `npm run test:run -- <파일>`. 앱 빌드: `xcodebuild -project ios/Gildongmu.xcodeproj -scheme Gildongmu -destination 'generic/platform=iOS Simulator' build`.

---

### Task 1: Kit 응답 모델·요청 `via`

**Files:**
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/Models/RouteModels.swift`(`CarRouteBriefing`·`WalkRouteBriefing`)
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/RouteService.swift`
- Modify: `ios/Gildongmu/Directions/DirectionsTabView.swift`(settle 3곳 `via: nil` 임시), `ios/Gildongmu/Directions/BeaconModel.swift`(`routeService.car/walk` 3곳 `via: nil` 임시)
- Test: `ios/GildongmuKit/Tests/GildongmuKitTests/RouteModelsTests.swift`(신규 또는 기존 모델 테스트 파일에 추가)

**Interfaces:**
- Produces: `public struct RouteWaypoint: Codable, Sendable, Hashable { let stepIndex: Int; let coord: RoutePoint }`, `WalkRouteBriefing.waypoint: RouteWaypoint?`, `CarRouteBriefing.waypoint: RouteWaypoint?`, `RouteService.walk(..., variant:, via: (lat: Double, lng: Double)?)`, `walkAlternatives(..., via:)`, `car(..., via:)`.

- [ ] **Step 1: 디코딩 테스트**

```swift
@Test func walkBriefingDecodesOptionalWaypoint() throws {
    let json = #"{"distanceMeters":100,"durationSeconds":60,"steps":[],"waypoint":{"stepIndex":2,"coord":{"lat":37.5,"lng":127.1}}}"#
    let b = try JSONDecoder().decode(WalkRouteBriefing.self, from: Data(json.utf8))
    #expect(b.waypoint?.stepIndex == 2)
    let plain = #"{"distanceMeters":100,"durationSeconds":60,"steps":[]}"#
    #expect(try JSONDecoder().decode(WalkRouteBriefing.self, from: Data(plain.utf8)).waypoint == nil)
}
```
자동차도 동형(`guides:[]`·`taxiFare`·`tollFare` 포함).

- [ ] **Step 2: 실패 확인** — `swift test --filter walkBriefingDecodesOptionalWaypoint` → 컴파일 실패.
- [ ] **Step 3: 구현** — `RouteWaypoint` 추가, 두 브리핑에 `public let waypoint: RouteWaypoint?`(Car는 init에 `waypoint: RouteWaypoint? = nil` — 테스트 편의 init이라 기본값 허용, 디코딩 계약과 무관). `RouteService` 세 함수에 `via` 인자(기본값 없음):
```swift
if let via { query.append(URLQueryItem(name: "via", value: coordPair(via.lat, via.lng))) }
```
호출부 6곳에 `via: nil` 명시(Task 4·5가 실값으로 바꾼다).
- [ ] **Step 4: 통과 확인 + 앱 빌드.**
- [ ] **Step 5: Commit** `feat(N4-iOS): Kit 경로 응답 waypoint 디코딩 + RouteService via 필수 인자`

### Task 2: 리듀서 `waypointReached` (Kit + 웹 미러 + 공유 fixture)

**Files:**
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/RouteGeometry.swift`(`GuideRoute.waypointStepIndex`, `buildGuideRoute(_:waypointStepIndex:)`), `RouteGuide.swift`(`GuideState.waypointReached`, `GuideEvent.waypointReached`, 6a′ 블록, `guideStateAt`·`restateAt` 승계), `CarRouteGuide.swift`(`buildCarGuide(briefing:)`가 `briefing.waypoint?.stepIndex` 전달)
- Modify: `src/lib/route-geometry.ts`, `src/lib/route-guide.ts`, `src/hooks/useRouteGuide.ts`(switch에 `case "waypointReached": break;` — 웹 소비자 없음)
- Modify: `src/lib/__tests__/fixtures/route-guide-scenarios.json`(시나리오 2건), `src/lib/__tests__/route-guide.test.ts`·`ios/GildongmuKit/Tests/GildongmuKitTests/RouteGuideTests.swift`(로더에 `waypointStepIndex?` + `kindName`)

**Interfaces:**
- Produces: `buildGuideRoute(_ steps: [GuideStepGeometry], waypointStepIndex: Int? = nil) -> GuideRoute?`(범위 밖 → nil), `GuideRoute.waypointStepIndex: Int?`, `GuideEvent.waypointReached`, `GuideState.waypointReached: Bool`.

- [ ] **Step 1: fixture 시나리오 추가**
```json
{"name": "경유지 도착선 통과 1회 — 통지 뒤 계속(래치, 톤 없음)", "waypointStepIndex": 1,
 "steps": [{"len": 100, "desc": "직진A"}, {"len": 100, "desc": "직진B"}],
 "fixes": [{"t":0,"along":0,"lateral":0,"acc":10},{"t":10,"along":50,"lateral":0,"acc":10},{"t":20,"along":90,"lateral":0,"acc":10},{"t":30,"along":105,"lateral":0,"acc":10},{"t":40,"along":120,"lateral":0,"acc":10}],
 "expect": [{"afterFix":2,"eventNot":"waypointReached"},{"afterFix":3,"event":"waypointReached","toneNull":true},{"afterFix":4,"eventNot":"waypointReached"}]}
```
두 번째: 경유지 다음 스텝이 "우회전B"(결정 지점)이고 fix가 임박 경계(endD-20)와 도착선을 같은 fix에 넘는 구성 — `afterFix`에 `imminent` 먼저, 다음 fix에 `waypointReached`. 스텝 `[{"len":100,"desc":"직진A"},{"len":30,"desc":"우회전B"},{"len":100,"desc":"직진C"}]`, fixes along 0→60(전문 40m)→112(도착선 100·임박선 110 동시 통과)→118: expect afterFix 2 `imminent`, afterFix 3 `waypointReached`.
- [ ] **Step 2: 두 로더가 `waypointStepIndex`를 읽어 `routeFrom`에 전달**하게 고치고 실행 → 실패(이벤트 없음).
- [ ] **Step 3: Kit 구현**
  - `GuideRoute`에 `public let waypointStepIndex: Int?`(memberwise 유지 — 내부 생성). `buildGuideRoute` 말미: `if let w = waypointStepIndex, !(1..<spans.count).contains(w) { return nil }`.
  - `GuideState`에 `public var waypointReached: Bool`; `guideStateAt` 초기 `false`; `restateAt`는 `prev.waypointReached` 승계(**승계 목록 한 곳** 규칙 — `guideStateAt`에 인자 `waypointReached: Bool = false` 추가).
  - `guideStep` 6a 블록 직후:
```swift
// 6a′) 경유지 도착(N4): 도착선(경유지 스텝 startD) 통과 1회. 임박 큐 뒤(시점 박힌
//      명령이 이긴다 — 도착선은 다음 fix에도 넘어 있어 한 fix 지연으로 잃는 것이 없다),
//      최종 접근·전문 낭독 앞. 이탈 판정 중엔 선언하지 않는다(6a·6b 동형). 톤 없음 —
//      도착 종은 오케스트레이터가 `.nearby`로 낸다.
if let w = route.waypointStepIndex, !next.waypointReached, !isOff,
   d >= route.steps[w].startD {
    next.waypointReached = true
    next.lastAnnouncedAt = now
    return emit(next, .waypointReached, nil)
}
```
  - `CarRouteGuide.buildCarGuide`의 `buildGuideRoute(` 호출에 `waypointStepIndex: briefing.waypoint?.stepIndex`.
- [ ] **Step 4: 웹 미러** — `route-geometry.ts` `buildGuideRoute(steps, opts?: { waypointStepIndex?: number })`, `GuideRoute.waypointStepIndex?: number`, `route-guide.ts` state `waypointReached: boolean`(guideStateAt false, restateAt 승계), 이벤트 `{ kind: "waypointReached" }`, 같은 블록. `useRouteGuide.ts` switch에 no-op case.
- [ ] **Step 5: 통과 확인** — `swift test --filter sharedScenarioTable`, `npm run test:run -- route-guide`. 범위 밖 index nil 단위 테스트(Kit `RouteGeometryTests` 또는 RouteGuideTests에 `@Test func waypointIndexOutOfRangeRejectsRoute`).
- [ ] **Step 6: Commit** `feat(N4): RouteGuide waypointReached 이벤트 — Kit·웹 미러 + 공유 fixture`

### Task 3: 최근 경로 `via`

**Files:**
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/RecentSearchStore.swift`(`RecentRoute.via`, `sameRoute`, `id`, `withPinned`, `RecentEndpointScope.via`)
- Test: `ios/GildongmuKit/Tests/GildongmuKitTests/RecentSearchStoreTests.swift`

- [ ] **Step 1: 테스트**
```swift
@Test func routeViaDistinguishesIdentityAndSurvivesPin() {
    let store = RecentSearchStore(defaults: freshDefaults("via"))
    let a = RecentEndpoint(label: "A", lat: 37.5, lng: 127.1)
    let b = RecentEndpoint(label: "B", lat: 37.6, lng: 127.2)
    let c = RecentEndpoint(label: "C", lat: 37.55, lng: 127.15)
    store.recordRoute(RecentRoute(from: a, to: b))
    let list = store.recordRoute(RecentRoute(from: a, to: b, via: c))
    #expect(list.count == 2)
    let pinned = store.setRoutePinned(RecentRoute(from: a, to: b, via: c), pinned: true)
    #expect(pinned.first?.via?.label == "C" && pinned.first?.pinned == true)
}
@Test func legacyRouteWithoutViaDecodes() throws {
    let json = #"{"from":null,"to":{"label":"B","lat":37.6,"lng":127.2}}"#
    let r = try JSONDecoder().decode(RecentRoute.self, from: Data(json.utf8))
    #expect(r.via == nil && r.pinned == false)
}
```
- [ ] **Step 2: 실패 확인 → Step 3: 구현**(`init(from:to:via: RecentEndpoint? = nil, pinned: Bool = false)`, decodeIfPresent, `sameRoute`에 `sameSide(a.via, b.via)`, `id` `"\(from)>\(to)>\(via?.id ?? "-")"`, `withPinned`·`setRoutePinned` 클로저에 via 전달, `RecentEndpointScope`에 `case via`).
- [ ] **Step 4: 통과 + Commit** `feat(N4-iOS): RecentRoute via — 동일 판정·고정 보존·구버전 디코딩`

### Task 4: 길찾기 폼·조회·결과·최근 경로

**Files:**
- Modify: `ios/Gildongmu/Directions/DirectionsTabView.swift`(`DirectionsFieldTarget.via`, `DirectionsModel.via/setVia/clearVia`, `performQuery` via 전달·transit 분기·`lastCoords.via`·`refetchWalk`·`recordRecentRoute`, 폼 버튼 2, `focusAfterResolve` `.via`, 결과 행 라벨, 최근 경로 라벨·활성화)
- Modify: `ios/Gildongmu/Directions/DirectionsEndpointSearchView.swift`(`sheetTitle` `.via` → `directions.searchVia`, `recentScope` switch에 `.via`)
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/Directions.swift`(`DirectionsModeOutcome.unsupportedWaypoint`)
- Modify: `ios/Gildongmu/RouteBriefing.swift`(`WalkRouteRows.waypointLabel`·`CarRouteRows.waypointLabel`)
- Test: `ios/GildongmuKit/Tests/GildongmuKitTests/DirectionsTests.swift`

- [ ] **Step 1: Kit 테스트** — `.unsupportedWaypoint`는 `isSuccess=false`, `displayedModes`에 남고 순서는 비성공군.
```swift
@Test func unsupportedWaypointIsDisplayedButNotSuccess() {
    let r = DirectionsResults(outcomes: [.transit: .unsupportedWaypoint, .car: .car(carFixture)])
    #expect(r.displayedModes == [.car, .transit] && r.successCount == 1)
}
```
- [ ] **Step 2: 구현(모델)**
  - `enum DirectionsFieldTarget { case from, to, via, manualLocation }`.
  - `DirectionsModel`: `private(set) var via: DirectionsEndpoint?`; `func setVia(_ e: DirectionsEndpoint) { guard case .place = e else { return }; via = e; recordRecent(e, scope: .via); clearResults() }`; `func clearVia() { via = nil; clearResults() }`.
  - `performQuery`: via 좌표 `viaCoord = via.flatMap { coordinate(of: $0, current: nil) }`; `isInKorea` 선분기에 via 포함; `lastCoords`에 `via: viaCoord` 추가(튜플 확장); `settleWalk/settleCar`에 `via:` 전달; transit은 `viaCoord == nil`일 때만 `settleTransit`, 아니면 outcome `.unsupportedWaypoint`; `recordRecentRoute(from:to:via:)`.
  - `refetchWalk`도 `lastCoords.via` 전달.
  - `DirectionsEndpointSearchView`: `sheetTitle` `.via: appLocalized("directions.searchVia")`, `recentScope`를 switch로(`.from`→.from, `.via`→.via, 나머지 .to).
- [ ] **Step 3: 구현(뷰)** — 도착지 버튼 뒤:
```swift
if let via = model.via, case .place(let name, _, _) = via {
    Button("\(appLocalized("directions.via")), \(name)") { searchTarget = .via }
    Button(appLocalized("directions.removeVia")) {
        submitFocused = true          // 자기를 없애는 버튼 — 조회 버튼 선점(헌장 §5)
        model.clearVia()
    }
} else {
    Button(appLocalized("directions.addVia")) { searchTarget = .via }
}
```
시트 콜백: `target == .via ? model.setVia(endpoint) : model.setEndpoint(endpoint, for: target)`. `applyResolvedFocus`: `.via`는 `.to`와 같이 `submitFocused = true`; `landFocusAfterResolve`의 `landed` 판정도 `.from`만 도착지 필드, 나머지는 `submitFocused`.
결과: `outcomeRows`에서 `.walk`·`.car`에 `waypointLabel: viaLabel`(`model.via`의 라벨) 전달. `WalkRouteRows`: `ForEach` 안에서 `if let w = briefing.waypoint, index == w.stepIndex, let label = waypointLabel { distanceText(appLocalized("directions.viaArrived", label)) }`를 스텝 행 **앞**에. `CarRouteRows` 동형(`guides` 인덱스). 대중교통 `.unsupportedWaypoint: Text(appLocalized("directions.unsupportedWaypoint"))`.
최근 경로: `recentRouteLabel`은 `route.via`가 있으면 `recentRoutes.itemVia`(from,to,via), `activateRecentRoute`는 `route.via.map { model.setVia(.place(...)) } ?? model.clearVia()` 후 조회.
- [ ] **Step 4: 빌드 + Kit 테스트 통과 + 시뮬레이터 실호출**(천호역→길동, 경유 강동역: 도보·자동차 섹션에 "경유지 강동역 도착" 행, 대중교통 섹션 미지원 문장, 최근 경로 문장).
- [ ] **Step 5: Commit** `feat(N4-iOS): 길찾기 폼 경유지 추가·삭제, 3좌표 조회, 대중교통 미지원 표시, 최근 경로 경유 문장`

### Task 5: 안내 세션 경유지 상태·도착 통지

**Files:**
- Modify: `ios/Gildongmu/Directions/BeaconModel.swift`(`Waypoint`, `waypoint`, `StartRequest.waypoint`, `begin`, `fetchDetailData` via+stepIndex, ETA car via, `reacquireRoute()` 추출, `setWaypoint`, `consume` `.waypointReached`, `routeStepDescriptions` 라벨 행, 커밋 가드 `waypoint` 일치)
- Modify: `ios/Gildongmu/Directions/DirectionsTabView.swift`(시작 버튼 3곳 `waypoint:` 전달, 간략 폴백 `beacon.toggle` 호출에 `waypoint:`), `ios/Gildongmu/Directions/GuideSessionCoordinator.swift`(`acceptWalkHandoff` `waypoint: nil`)
- Modify: `ios/Gildongmu/Directions/BeaconTrackingSheet.swift`(조망 모달이 `routeStepDescriptions`를 그대로 쓰므로 변경 없음 확인)

- [ ] **Step 1: 상태·요청**
```swift
struct Waypoint: Equatable { let dest: BeaconDest; let label: String }
private(set) var waypoint: Waypoint?
struct StartRequest { ...; let waypoint: Waypoint? }   // 기본값 없음
```
`toggle(...)`에 `waypoint: Waypoint?` 인자 추가(기본값 없음 — 호출부 1곳). `begin`: `waypoint = request.waypoint`. `stop()`/세션 종료 초기화에 `waypoint = nil`.
- [ ] **Step 2: fetch** — `fetchDetailData`에서 `let via = waypoint.map { (lat: $0.dest.lat, lng: $0.dest.lng) }`; walk·car 호출에 `via: via`; `buildGuideRoute(..., waypointStepIndex: briefing.waypoint?.stepIndex)`, 자동차는 `buildCarGuide`가 이미 전달. **`via != nil && briefing.waypoint == nil`이면 `return nil`**. ETA 갱신 `routeService.car(..., via: waypoint.map{...})`. 재조회·제안·프리뷰·시작 fetch의 커밋 가드에 `self.waypoint == waypointAtFetch`(fetch 직전 스냅샷) 추가.
- [ ] **Step 3: `reacquireRoute()` 추출** — `changeDestination`의 `routeFetchTask?.cancel()`부터 `toneState = .initial`까지를 `private func reacquireRoute()`로 옮기고 `changeDestination`이 호출. `setWaypoint`:
```swift
@discardableResult
func setWaypoint(dest newDest: BeaconDest, label: String) -> Bool {
    guard isTracking else { return false }
    if waypoint?.dest == newDest {
        waypoint = Waypoint(dest: newDest, label: label)
        announceNow(appLocalized("ios.guide.waypointSet", label), highPriority: true, bypassSuppression: true)
        return true
    }
    waypoint = Waypoint(dest: newDest, label: label)
    reacquireRoute()
    announceNow(appLocalized("ios.guide.waypointSet", label), highPriority: true, bypassSuppression: true)
    awaitingRoute = true
    startFixWaitWatch(token: routeFetchToken)
    return true
}
```
(`changeDestination`의 `fetching = dataLocale == "ko"` 분기는 `waypointAvailable` 게이트가 ko를 보장하므로 여기선 생략하지 않고 동일 분기 유지 — 비ko면 reacquire 없이 통지만.)
- [ ] **Step 4: 도착 소비** — `consume(event:)`:
```swift
case .waypointReached:
    guard let w = waypoint else { break }
    playTone(.nearby)
    let text = appLocalized("directions.viaArrived", w.label)
    statusText = text
    if outputSuppressed { pendingRecovery = text } else { announce(text) }
    waypoint = nil
```
`routeStepDescriptions`: `waypointStepIndex` 앞에 `directions.viaArrived` 행 삽입 — 라벨은 `waypointLabelForRoute`(도착 뒤에도 행이 남도록 `lastWaypointLabel`을 도착 시 보관).
- [ ] **Step 5: 호출부** — `DirectionsTabView` 시작 버튼 3곳 `waypoint: sessionWaypoint`(`model.via`의 `.place` → `Waypoint`), 간략 폴백 `beacon.toggle(..., waypoint: sessionWaypoint)`, `acceptWalkHandoff` `waypoint: nil`.
- [ ] **Step 6: 빌드 + `npm run test:run -- guidance-gate-drift`(6 유지) + 시뮬레이터: 경유지 조회 → 도보 안내 시작 → 조망 모달에 "경유지 강동역 도착" 행.**
- [ ] **Step 7: Commit** `feat(N4-iOS): 안내 세션 경유지 — StartRequest·fetch via·setWaypoint·도착 통지 후 계속`

### Task 6: 시트 버튼·장소 상세·폼 동기화·i18n

**Files:**
- Modify: `ios/Gildongmu/Directions/BeaconTrackingSheet.swift`(버튼 + `.via` 검색 시트 + `onWaypointCommitted`), `ios/Gildongmu/GildongmuApp.swift`(콜백 연결), `ios/Gildongmu/Directions/GuideSessionCoordinator.swift`(`waypointAvailable`, `GuideFormSyncStore.postWaypoint/takeWaypoint`), `ios/Gildongmu/PlaceDetailView.swift`(버튼 동작·라벨), `ios/Gildongmu/Directions/DirectionsTabView.swift`(`consumeGuideFormSync` via)
- Modify: `messages/{ko,en,es,fr,it,ja}.json`, 생성물 xcstrings 2벌

- [ ] **Step 1: i18n** — `ios.guide.waypointChange`("{label}, 경유지 변경"), `ios.guide.waypointSet`("경유지 {label}, 경로를 다시 조회합니다"), `guide.changeWaypointHere`("여기로 경유지 변경") 6로케일. `node ios/scripts/messages-to-xcstrings.mjs && node ios/scripts/check-xcstrings-keys.mjs`, `npm run test:run -- i18n-messages`.
- [ ] **Step 2: 시트** — 최소화와 중지 사이:
```swift
Button(model.waypoint.map { appLocalized("ios.guide.waypointChange", $0.label) }
       ?? appLocalized("directions.addVia")) { waypointPresented = true }
```
`.sheet(isPresented: $waypointPresented) { DirectionsEndpointSearchView(target: .via) { endpoint in guard case .place(let label, let lat, let lng) = endpoint else { return }; if model.setWaypoint(dest: BeaconDest(lat: lat, lng: lng), label: label) { onWaypointCommitted(endpoint) }; Task { await landStopFocus() } } }`, `.onChange(of: waypointPresented) { model.outputSuppressed = $1 }`(목적지 변경 시트와 OR — 두 플래그 중 하나라도 열려 있으면 억제). 도착 화면에는 두지 않는다.
- [ ] **Step 3: 세션·스토어** — `var waypointAvailable: Bool { beacon.isTracking && AppLanguage.dataLocale == "ko" }`. `GuideFormSyncStore`: `private(set) var pendingWaypoint: DirectionsEndpoint?`, `postWaypoint`, `takeWaypoint`. 앱 루트: `onWaypointCommitted: { GuideFormSyncStore.shared.postWaypoint($0) }`.
- [ ] **Step 4: 장소 상세** — 라벨 `guideSession.beacon.waypoint == nil ? "guide.addWaypointHere" : "guide.changeWaypointHere"`, 동작 `if guideSession.beacon.setWaypoint(dest:label:) { GuideFormSyncStore.shared.postWaypoint(.place(...)) }`.
- [ ] **Step 5: 탭 동기화** — `consumeGuideFormSync`에 `if let via = store.takeWaypoint() { model.setVia(via); model.runQuery(silently: true) }`; `.onChange(of: GuideFormSyncStore.shared.pendingWaypoint)`도 같은 소비.
- [ ] **Step 6: 빌드 + 시뮬레이터(안내 중 시트 "경유지 추가" → 통지 → 라벨 "C, 경유지 변경" → 길찾기 탭 폼에 경유지 반영) + Commit** `feat(N4-iOS): 안내 시트·장소 상세 경유지 버튼, 폼 동기화`

### Task 7: 리뷰·게이트·문서·통합

- [ ] 묶음 리뷰(서브에이전트 2종: spec-compliance·code-quality) — 지적 처리 후 커밋.
- [ ] `npm run test:run`, `cd ios/GildongmuKit && swift test`, 앱 빌드, `guidance-gate-drift` 6 확인.
- [ ] 문서 분배: `CHANGELOG.md`(2026-08-22 N4-iOS 소제목), `docs/BACKLOG.md` N4(iOS 항목 종결 → 실기기 판정 5항목 + 웹 실시간 경유지 후속 유지, N1 "띠바 경유지 도착 상태" 닫기), `PROGRESS.md` 상태 한 줄, `CLAUDE.md` 함정(경유지 `via` 필수 인자·도착 후 nil·리듀서 6a′ 순서), spec §8 리뷰 결과.
- [ ] 통합(plan §3): `git fetch origin && git rebase origin/main` → xcstrings 재생성 → `npm run test:run` → `git push origin feat/n4-waypoint-ios:main` → 코디네이터 보고.
- [ ] 실기기 배포 두 구성(`./ios/deploy-device.sh`, `CONFIGURATION=Experimental ./ios/deploy-device.sh`) → 코디네이터 보고.
