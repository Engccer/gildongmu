# iOS Nearby 11모델 상태 골격 추출 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) 구문.

**Goal:** 11개 Nearby 모델의 복제된 `load()` 상태 머신을 GildongmuKit의 `NearbyLoadCore<Payload>`(계약 테스트 선행)로 수렴하고, 뷰 오버레이 11벌을 공유 1벌로 수렴하며, 취소 잠복 결함을 중앙 1곳에서 수정한다.

**Architecture:** 스펙 `docs/superpowers/specs/2026-07-31-ios-nearby-skeleton-design.md`가 정본(전이표 §5 = 동결 계약). Kit에 기계+계약 테스트를 먼저 green으로 만들고, 11모델을 도메인 구성만 남는 껍데기로 모델 1개=커밋 1개 이관한다.

**Tech Stack:** Swift 6.2 strict concurrency, SPM Swift Testing(Kit), Observation, SwiftUI(앱 층만).

## Global Constraints

- **행동 byte-identical**: 화면 카피·상태 전이·통지 문자열·타이밍 불변. 유일한 의도적 변경 = 취소(스펙 §5 #17 + 커밋 게이트).
- 오버레이·통지의 **모든 i18n 키·아이콘은 현행 코드에서 그대로 이관**(신규 키 0, 문구 변경 0). 이관 커밋 리뷰는 스펙 §6 변이 좌표 표+본 계획 §디스크립터 표를 체크리스트로 diff 대조.
- 주입 클로저는 전부 `@MainActor`, `Payload: Sendable` 값 타입만(스펙 §4).
- 커밋은 pathspec만(`git add <파일> && git commit -m "..." -- <파일>` — `-m`은 `--` 앞, `git add -A` 금지). **push 금지**(컨트롤러 몫).
- 매 커밋 게이트: `cd ios/GildongmuKit && swift test` green + 앱 빌드 green(`xcodebuild -project ios/Gildongmu.xcodeproj -scheme Gildongmu -destination 'generic/platform=iOS' build` 또는 컨트롤러 안내 명령).
- 주석·커밋 메시지 한국어, 변수·함수명 영어. 이모지·em dash 금지.

## 파일 구조

- Create: `ios/GildongmuKit/Sources/GildongmuKit/NearbyLoadCore.swift` (기계 정본)
- Create: `ios/GildongmuKit/Sources/GildongmuKit/RevealWindow.swift`
- Create: `ios/GildongmuKit/Tests/GildongmuKitTests/NearbyLoadCoreTests.swift`
- Create: `ios/GildongmuKit/Tests/GildongmuKitTests/RevealWindowTests.swift`
- Create: `ios/Gildongmu/Nearby/NearbyOverlay.swift` (디스크립터+공유 오버레이 뷰)
- Modify: `ios/Gildongmu/Nearby/NearbyLoadState.swift` (구 enum 제거→어댑터·이벤트 매퍼·메시지 빌더, `joinText` 유지)
- Modify: `ios/Gildongmu/Nearby/*.swift` 11개 뷰 파일(모델 껍데기화+오버레이 교체)
- 불변: `LocationService.swift`, `NearbyRefresh.swift`, 각 도메인 Service, 웹 전체.

---

### Task 1: Kit `NearbyLoadCore` + 전이표 계약 테스트

**Files:**
- Create: `ios/GildongmuKit/Sources/GildongmuKit/NearbyLoadCore.swift`
- Test: `ios/GildongmuKit/Tests/GildongmuKitTests/NearbyLoadCoreTests.swift`

**Interfaces (Produces — 이후 전 태스크가 소비):**

```swift
public typealias NearbyCoord = (lat: Double, lng: Double)
public enum NearbyLoadPhase<Payload: Sendable> { case idle, loading, loaded(Payload), empty, denied, outOfCoverage, failedLocation, failedServer }
public enum NearbyLocationError: Error { case denied, unavailable }
public enum NearbyCoordinateSource { case current(@MainActor (_ force: Bool) async throws -> NearbyCoord), none }
public enum NearbyCoverage { case korea, none }
public enum NearbyLoadEvent<Payload: Sendable> { case loaded(Payload), emptyResult, refreshFailed, permissionLost, wentOutOfCoverage }
@Observable @MainActor public final class NearbyLoadCore<Payload: Sendable> {
    public private(set) var phase: NearbyLoadPhase<Payload>
    public init(coordinate:coverage:fetch:willCommit:onEvent:)
    public func load(force: Bool = false) async
}
```

- [ ] **Step 1: 계약 테스트 작성(red)** — 전이표 §5 전 케이스. 테스트 파일 골격:

```swift
import Testing
@testable import GildongmuKit

/// NearbyLoadCore 계약 테스트 — 스펙 §5 전이표가 동결 계약(케이스 번호 주석 병기).
/// stub은 클로저 주입: 좌표·fetch를 CheckedContinuation으로 보류해 in-flight·취소를 재현한다.
@MainActor
struct NearbyLoadCoreTests {
    /// 이벤트 로그: 순서 단언용(불변식 ⑤ — 이벤트 시점에 phase가 이미 커밋되어 있어야 한다)
    final class EventLog { var events: [String] = [] }
    // 헬퍼: makeCore(coverage:coordResult:fetchResult:) — 각 테스트가 조립
}
```

  필수 케이스(각각 별도 `@Test`, 번호는 전이표):
  1. #1 in-flight: fetch를 continuation으로 보류 → `load()` 재호출이 fetch 2회째를 만들지 않음.
  2. #2·#3 시작 전이: idle→loading(보류 중 phase 검사), loaded→loaded 유지.
  3. #4·#5 좌표 denied: 첫 로드→denied·이벤트 0 / loaded 중→denied+`permissionLost`.
  4. #6·#7 좌표 unavailable: 첫→failedLocation·이벤트 0 / loaded 중→loaded 유지+`refreshFailed`.
  5. #8·#9 coverage=korea 해외 좌표(예: 도쿄 35.68, 139.69): 첫→outOfCoverage·fetch 미호출 / loaded 중→outOfCoverage+`wentOutOfCoverage`.
  6. coverage=none + 해외 좌표 → fetch 호출됨(선분기 없음).
  7. #10 성공: loaded(payload)+`loaded` 이벤트, `willCommit`이 phase 대입 전 호출(로그 순서 `["willCommit","phase=loaded","event=loaded"]`).
  8. #11·#12 fetch nil: loaded 중→유지+`refreshFailed` / 첫→empty+`emptyResult`.
  9. #13·#14 fetch `APIError.outOfCoverage`: 첫→outOfCoverage / loaded 중→+`wentOutOfCoverage`.
  10. #15·#16 fetch 일반 throw: 첫→failedServer / loaded 중→유지+`refreshFailed`.
  11. `.none` 좌표 소스: getCoordinate 미호출·fetch에 `nil` coord 전달.
  12. force 전달: getCoordinate가 받은 force 값 기록(true/false 각 1회).
  13. #17 오류형 취소: fetch가 `CancellationError` throw — entry=idle→idle 복원 / entry=failedServer(재시도)→failedServer 복원 / entry=loaded→loaded 유지. 전부 이벤트 0.
  14. #17 `URLError(.cancelled)` throw → 복원.
  15. #17 협력적 취소(커밋 게이트): `Task { await core.load() }` 를 fetch 보류 중 `cancel()` → stub이 **성공값을 반환**해도 커밋·이벤트 없음·entry 복원. 좌표 단계 판도 작성(좌표 보류 중 cancel → 좌표 성공 반환 → fetch 미호출·복원).
  16. #17 래핑 취소 방어: fetch가 임의 오류를 throw + 태스크는 취소 상태 → 복원(refreshFailed 미발화).
  17. 취소 후 in-flight 해제: 위 취소 케이스 직후 같은 core로 `load()` 재호출이 정상 완주.
- [ ] **Step 2: `swift test` 실행 — 컴파일 실패(red) 확인**
- [ ] **Step 3: 구현** — 정본 코드(그대로 사용):

```swift
import Foundation
import Observation

/// 좌표 튜플 — 앱 LocationService.currentCoordinate 반환형과 동일 shape.
public typealias NearbyCoord = (lat: Double, lng: Double)

/// 내 주변 정규 상태 8종. 앱의 구 NearbyLoadState를 정규화(failed를 위치/서버로 분해,
/// empty 추가 — WhereAmI data:null 전용, "부재 ≠ 0건 ≠ 실패" 3-state의 타입 표현).
public enum NearbyLoadPhase<Payload: Sendable> {
    case idle
    case loading
    case loaded(Payload)
    case empty
    case denied
    case outOfCoverage
    case failedLocation
    case failedServer
}

/// 좌표 어댑터 오류(앱 LocationService.LocationError의 Kit 번역).
/// 어댑터 계약: 취소는 원본 그대로 rethrow — 절대 unavailable로 뭉개지 않는다(스펙 §4).
public enum NearbyLocationError: Error {
    case denied
    case unavailable
}

/// 좌표 소스: current = 위치 어댑터 주입, none = 파라미터형(좌표 단계 생략, coord=nil).
public enum NearbyCoordinateSource {
    case current(@MainActor (_ force: Bool) async throws -> NearbyCoord)
    case none
}

/// korea = isInKorea 선분기(웹 coverage 미러, upstream 미호출 쿼터 보호). none = 무제한.
public enum NearbyCoverage {
    case korea
    case none
}

/// 통지 이벤트 — Kit은 발화하지 않는다(앱 매퍼가 VO Announcement로 변환, 스펙 §4).
public enum NearbyLoadEvent<Payload: Sendable> {
    case loaded(Payload)
    case emptyResult
    case refreshFailed
    case permissionLost
    case wentOutOfCoverage
}

/// 내 주변 화면 공통 load() 상태 머신 정본. 전이표는 스펙
/// docs/superpowers/specs/2026-07-31-ios-nearby-skeleton-design.md §5(동결 계약).
/// 취소 2겹 방어(#17): 오류형(CancellationError·URLError.cancelled) + 커밋 게이트
/// (각 await 복귀 직후·커밋 직전 Task.isCancelled) — 협력적 취소가 성공값을 반환해도
/// 떠난 화면에 커밋·통지하지 않는다.
@Observable @MainActor
public final class NearbyLoadCore<Payload: Sendable> {
    public private(set) var phase: NearbyLoadPhase<Payload> = .idle

    private let coordinate: NearbyCoordinateSource
    private let coverage: NearbyCoverage
    private let fetch: @MainActor (_ coord: NearbyCoord?, _ previous: Payload?) async throws -> Payload?
    private let willCommit: @MainActor (Payload) -> Void
    private let onEvent: @MainActor (NearbyLoadEvent<Payload>) -> Void
    /// 재진입 가드(구 모델 isLoadingInFlight 계승): 진행 중 재호출은 즉시 무시(#1)
    private var isLoadingInFlight = false

    public init(
        coordinate: NearbyCoordinateSource,
        coverage: NearbyCoverage,
        fetch: @escaping @MainActor (_ coord: NearbyCoord?, _ previous: Payload?) async throws -> Payload?,
        willCommit: @escaping @MainActor (Payload) -> Void = { _ in },
        onEvent: @escaping @MainActor (NearbyLoadEvent<Payload>) -> Void
    ) {
        self.coordinate = coordinate
        self.coverage = coverage
        self.fetch = fetch
        self.willCommit = willCommit
        self.onEvent = onEvent
    }

    public func load(force: Bool = false) async {
        if isLoadingInFlight { return }
        isLoadingInFlight = true
        defer { isLoadingInFlight = false }   // 불변식 ④ — 취소 포함 전 경로 해제

        let entry = phase
        let previous: Payload? = if case .loaded(let p) = entry { p } else { nil }
        // 직전 성공 데이터가 있으면 유지한 채 재조회, 그 외는 로딩 표시(#2·#3)
        if case .loaded = entry {} else { phase = .loading }

        // #17: 취소 복원 — loaded는 유지(대체된 적 없음), 그 외는 entry로(.loading 고착 금지)
        func restoreOnCancellation() {
            if case .loaded = entry { return }
            phase = entry
        }

        do {
            var coord: NearbyCoord?
            if case .current(let getCoordinate) = coordinate {
                let got = try await getCoordinate(force)
                guard !Task.isCancelled else { return restoreOnCancellation() }
                // 위치 취득 직후 선분기(네트워크 생략) — 서버 마커 catch와 이중 방어(#8·#9)
                if case .korea = coverage, !isInKorea(lat: got.lat, lng: got.lng) {
                    phase = .outOfCoverage
                    if case .loaded = entry { onEvent(.wentOutOfCoverage) }
                    return
                }
                coord = got
            }
            let result = try await fetch(coord, previous)
            guard !Task.isCancelled else { return restoreOnCancellation() }
            if let payload = result {
                willCommit(payload)              // 부가 상태(리빌 창 리셋)와 원자 커밋
                phase = .loaded(payload)         // #10 — 커밋 후 이벤트(불변식 ⑤)
                onEvent(.loaded(payload))
            } else if case .loaded = entry {
                onEvent(.refreshFailed)          // #11 — 데이터 유지(재조회이지 포기 아님)
            } else {
                phase = .empty                   // #12
                onEvent(.emptyResult)
            }
        } catch {
            // 커밋 게이트: 어떤 오류든 취소된 태스크면 오판·통지 없이 복원(#17)
            guard !Task.isCancelled else { return restoreOnCancellation() }
            switch error {
            case is CancellationError:
                restoreOnCancellation()
            case let urlError as URLError where urlError.code == .cancelled:
                restoreOnCancellation()
            case NearbyLocationError.denied:     // #4·#5 — 권한 전락은 무신호 화면 전환 방지 통지
                phase = .denied
                if case .loaded = entry { onEvent(.permissionLost) }
            case NearbyLocationError.unavailable: // #6·#7
                if case .loaded = entry { onEvent(.refreshFailed) } else { phase = .failedLocation }
            case APIError.outOfCoverage:         // #13·#14 — 서버 마커 이중 방어
                phase = .outOfCoverage
                if case .loaded = entry { onEvent(.wentOutOfCoverage) }
            default:                             // #15·#16
                if case .loaded = entry { onEvent(.refreshFailed) } else { phase = .failedServer }
            }
        }
    }
}
```

- [ ] **Step 4: `swift test` green 확인**
- [ ] **Step 5: 커밋** — `git add ios/GildongmuKit/Sources/GildongmuKit/NearbyLoadCore.swift ios/GildongmuKit/Tests/GildongmuKitTests/NearbyLoadCoreTests.swift && git commit -m "feat(ios): NearbyLoadCore 상태 머신 + 전이표 계약 테스트 (Kit)" -- ios/GildongmuKit/Sources/GildongmuKit/NearbyLoadCore.swift ios/GildongmuKit/Tests/GildongmuKitTests/NearbyLoadCoreTests.swift`

---

### Task 2: Kit `RevealWindow` + 테스트

**Files:**
- Create: `ios/GildongmuKit/Sources/GildongmuKit/RevealWindow.swift`
- Test: `ios/GildongmuKit/Tests/GildongmuKitTests/RevealWindowTests.swift`

**Interfaces (Produces):** `RevealWindow` — Task 5의 revealMore 4종 모델이 소비.

- [ ] **Step 1: 테스트 작성(red)** — ① 초기 visibleCount=10 ② `revealMore(totalCount: 25)` → 반환 10(첫 새 인덱스)·visibleCount 20 → 재호출 반환 20·visibleCount 25 → 재호출 nil ③ `totalCount <= visibleCount`면 nil·불변 ④ `reset()` 후 10 복원.
- [ ] **Step 2: 구현** — 정본 코드:

```swift
/// "더 보기" 단계 공개 창 — 웹 useRevealMore·구 모델 revealMore의 수치 로직 공용화.
/// 초기 10·+10은 웹 NEARBY_INITIAL_VISIBLE/REVEAL_STEP과 동일 값 유지.
public struct RevealWindow: Sendable {
    public static let initialVisible = 10
    public static let revealStep = 10
    public private(set) var visibleCount = RevealWindow.initialVisible

    public init() {}

    /// 새 로드 커밋 시 초기값 복원(NearbyLoadCore.willCommit에서 호출).
    public mutating func reset() { visibleCount = Self.initialVisible }

    /// 공개 수를 늘리고 첫 새 항목 인덱스를 반환(VO 포커스 이동 대상). 더 없으면 nil.
    public mutating func revealMore(totalCount: Int) -> Int? {
        guard visibleCount < totalCount else { return nil }
        let firstNewIndex = visibleCount
        visibleCount = min(visibleCount + Self.revealStep, totalCount)
        return firstNewIndex
    }
}
```

- [ ] **Step 3: `swift test` green → 커밋** — `git commit -m "feat(ios): RevealWindow 더 보기 창 로직 (Kit)" -- <두 파일>`

---

### Task 3: 앱 공유 계층 + 규범 이관 1호(Subway)

**Files:**
- Create: `ios/Gildongmu/Nearby/NearbyOverlay.swift`
- Modify: `ios/Gildongmu/Nearby/NearbyLoadState.swift`
- Modify: `ios/Gildongmu/Nearby/SubwayNearbyView.swift`
- (pbxproj는 폴더 참조라 신규 파일 자동 포함 — 빌드로 확인)

**Interfaces (Produces — Task 4~6이 소비):**
- `LocationService.nearbyCoordinateSource() -> NearbyCoordinateSource`
- `nearbyAnnouncer(loaded:emptyResult:) -> @MainActor (NearbyLoadEvent<P>) -> Void`
- `nearbyLoadedMessage(count:unit:) -> String`
- `NearbyOverlayCopy` / `NearbyOverlayDescriptor<Payload>`(`.list`/`.plain`/`.absentCapable`) / `NearbyStateOverlayView`

- [ ] **Step 1: `NearbyLoadState.swift` 재편** — 구 `NearbyLoadState` enum은 **아직 유지**(미이관 모델이 소비 중 — Task 6 뒤 Task 7에서 제거). `joinText`·기존 announce 3종 유지. 추가:

```swift
/// NearbyLoadCore 좌표 소스 어댑터. currentCoordinate는 typed throws(LocationError)라
/// 취소가 오류로 나올 수 없고(커밋 게이트가 방어 정본), denied/unavailable만 번역한다.
extension LocationService {
    static func nearbyCoordinateSource() -> NearbyCoordinateSource {
        .current { force in
            do {
                return try await LocationService.shared.currentCoordinate(force: force)
            } catch {
                if case .denied = error { throw NearbyLocationError.denied }
                throw NearbyLocationError.unavailable
            }
        }
    }
}

/// 완료 통지 문구 — 구 announceLoaded의 메시지 조립부(문자열 불변). 0건도 문장으로.
@MainActor
func nearbyLoadedMessage(count: Int, unit: String) -> String {
    count == 0
        ? appLocalized("ios.nearby.announceEmpty")
        : appLocalized("ios.nearby.announceCount", unit, String(count))
}

/// 이벤트→VO 발화 매퍼 1벌(스펙 §4): 전락 통지 3종은 기존 announce* 그대로,
/// loaded 문구만 도메인 클로저. emptyResult는 WhereAmI만 문구를 준다.
@MainActor
func nearbyAnnouncer<Payload>(
    loaded: @escaping @MainActor (Payload) -> String,
    emptyResult: String? = nil
) -> @MainActor (NearbyLoadEvent<Payload>) -> Void {
    { event in
        switch event {
        case .loaded(let payload):
            AccessibilityNotification.Announcement(loaded(payload)).post()
        case .emptyResult:
            if let emptyResult {
                AccessibilityNotification.Announcement(emptyResult).post()
            }
        case .refreshFailed: announceRefreshFailed()
        case .permissionLost: announcePermissionLost()
        case .wentOutOfCoverage: announceOutOfCoverage()
        }
    }
}
```

- [ ] **Step 2: `NearbyOverlay.swift` 작성** — 유효 조합만 생성(스펙 §8 codex M1):

```swift
import SwiftUI
import GildongmuKit

/// 오버레이 한 칸의 카피(제목·아이콘·설명) — 전부 현행 switch에서 그대로 이관.
struct NearbyOverlayCopy {
    let title: String
    let systemImage: String
    let description: String?

    init(_ title: String, systemImage: String, description: String? = nil) {
        self.title = title
        self.systemImage = systemImage
        self.description = description
    }

    /// 기본 실패 카피(8종 리스트 도메인의 구 .failed와 동일)
    static var defaultFailure: NearbyOverlayCopy {
        NearbyOverlayCopy(appLocalized("ios.common.failedTitle"), systemImage: "wifi.exclamationmark",
                          description: appLocalized("ios.common.retryLater"))
    }
}

/// 상태 오버레이 디스크립터 — 전용 팩토리 3종만 허용(불법 조합 타입 차단):
/// list = 리스트 도메인(0건 카피 필수), plain = 비리스트(0건·부재 없음),
/// absentCapable = WhereAmI(.empty 카피 보유).
struct NearbyOverlayDescriptor<Payload> {
    let loadingText: String
    let isEmpty: (Payload) -> Bool
    let emptyList: NearbyOverlayCopy?
    let failedLocation: NearbyOverlayCopy
    let failedServer: NearbyOverlayCopy
    let absent: NearbyOverlayCopy?

    static func list(
        empty: NearbyOverlayCopy,
        isEmpty: @escaping (Payload) -> Bool,
        loadingText: String = appLocalized("ios.common.checking"),
        failedLocation: NearbyOverlayCopy = .defaultFailure,
        failedServer: NearbyOverlayCopy = .defaultFailure
    ) -> Self {
        Self(loadingText: loadingText, isEmpty: isEmpty, emptyList: empty,
             failedLocation: failedLocation, failedServer: failedServer, absent: nil)
    }

    static func plain(
        loadingText: String = appLocalized("ios.common.checking"),
        failedLocation: NearbyOverlayCopy = .defaultFailure,
        failedServer: NearbyOverlayCopy = .defaultFailure
    ) -> Self {
        Self(loadingText: loadingText, isEmpty: { _ in false }, emptyList: nil,
             failedLocation: failedLocation, failedServer: failedServer, absent: nil)
    }

    static func absentCapable(
        absent: NearbyOverlayCopy,
        failedLocation: NearbyOverlayCopy,
        failedServer: NearbyOverlayCopy
    ) -> Self {
        Self(loadingText: appLocalized("ios.common.checking"), isEmpty: { _ in false }, emptyList: nil,
             failedLocation: failedLocation, failedServer: failedServer, absent: absent)
    }
}

/// 공유 상태 오버레이 — 구 11벌 stateOverlay switch의 정본.
/// denied·outOfCoverage 카피는 전 도메인 동일이라 고정(현행과 byte-identical).
struct NearbyStateOverlayView<Payload: Sendable>: View {
    let phase: NearbyLoadPhase<Payload>
    let descriptor: NearbyOverlayDescriptor<Payload>

    var body: some View {
        switch phase {
        case .loading:
            ProgressView(descriptor.loadingText)
        case .denied:
            ContentUnavailableView(appLocalized("ios.common.geoDeniedTitle"), systemImage: "location.slash",
                description: Text(appLocalized("ios.common.geoDeniedDesc")))
        case .outOfCoverage:
            ContentUnavailableView(appLocalized("ios.common.outOfCoverage"), systemImage: "map")
        case .failedLocation:
            copyView(descriptor.failedLocation)
        case .failedServer:
            copyView(descriptor.failedServer)
        case .empty:
            if let absent = descriptor.absent { copyView(absent) }
        case .loaded(let payload):
            if descriptor.isEmpty(payload), let empty = descriptor.emptyList { copyView(empty) }
        case .idle:
            EmptyView()
        }
    }

    @ViewBuilder private func copyView(_ copy: NearbyOverlayCopy) -> some View {
        if let description = copy.description {
            ContentUnavailableView(copy.title, systemImage: copy.systemImage,
                description: Text(description))
        } else {
            ContentUnavailableView(copy.title, systemImage: copy.systemImage)
        }
    }
}
```

- [ ] **Step 3: Subway 이관(규범 원형 — 이후 이관 전부 이 형태 미러)** — `SubwayNearbyView.swift`의 모델·오버레이 교체(뷰 body의 도메인 렌더는 무변경):

```swift
/// 내 주변 지하철 도착 — NearbyLoadCore 껍데기(규범 원형). 상태 머신·전이표는 Kit 정본.
@Observable @MainActor
final class SubwayNearbyModel {
    private let core: NearbyLoadCore<[NearbySubwayStation]>
    var phase: NearbyLoadPhase<[NearbySubwayStation]> { core.phase }

    init() {
        let service = NearbyService(client: APIClient(baseURL: AppConfig.apiBaseURL))
        core = NearbyLoadCore(
            coordinate: LocationService.nearbyCoordinateSource(),
            coverage: .korea,
            fetch: { coord, _ in
                guard let coord else { preconditionFailure("current 소스는 좌표 보장") }
                return try await service.subwayArrivals(lat: coord.lat, lng: coord.lng)
            },
            onEvent: nearbyAnnouncer(loaded: { stations in
                nearbyLoadedMessage(count: stations.count, unit: appLocalized("ios.nearby.unitStation"))
            }))
    }

    func load(force: Bool = false) async { await core.load(force: force) }
}
```

  뷰: `if case .loaded(let stations) = model.phase`로 치환, `stateOverlay` 프로퍼티 삭제 후
  `.nearbyStateOverlay { NearbyStateOverlayView(phase: model.phase, descriptor: .list(empty: NearbyOverlayCopy(appLocalized("ios.nearby.subwayEmpty"), systemImage: "tram"), isEmpty: \.isEmpty)) }`.
  (`isEmpty: \.isEmpty`가 컴파일 안 되면 `{ $0.isEmpty }`.)
- [ ] **Step 4: `swift test` + 앱 빌드 green 확인**
- [ ] **Step 5: 커밋** — `git commit -m "refactor(ios): nearby 공유 계층(어댑터·통지 매퍼·오버레이) + Subway 이관 1호" -- <4개 파일>`

---

### Task 4: 단순 3종 이관 — Bus·Bike·BusRouteStops (커밋 3개)

**Files:** `BusNearbyView.swift`, `BikeNearbyView.swift`, `BusRouteStopsView.swift`

각각 Task 3 Subway 원형을 미러. 좌표(스펙 §6 표와 아래만 다름):

| 모델 | fetch | unit 키 | empty 카피 | 비고 |
|---|---|---|---|---|
| Bus | `service.busStops(lat:lng:)` | `ios.nearby.unitStop` | `ios.nearby.busEmpty` / `bus` | |
| Bike | `service.bikeStations(lat:lng:)` | `ios.nearby.unitBike` | `ios.nearby.bikeEmpty` / `bicycle` | |
| BusRouteStops | `service.busRouteStops(source:cityCode:routeId:)` | `ios.nearby.unitStop` | `ios.nearby.routeStopsEmpty` / `bus` | 아래 상세 |

- [ ] **Step 1: Bus 이관 → 테스트·빌드 → 커밋** (`refactor(ios): BusNearby 껍데기 이관`)
- [ ] **Step 2: Bike 이관 → 테스트·빌드 → 커밋**
- [ ] **Step 3: BusRouteStops 이관** — 파라미터형 원형: `coordinate: .none`, `coverage: .none`, 모델 init이 파라미터를 받아 fetch 클로저가 캡처. 뷰는 `init(source:cityCode:routeId:routeNo:)`에서 `_model = State(initialValue: BusRouteStopsModel(source:…))`(⚠ `State(initialValue:)` 인자는 body 재평가마다 재실행·폐기될 수 있으므로 **순수 생성만** — 메모리 [[swiftui-state-initialvalue-side-effect]]). `.task`/`.nearbyRefreshable`은 `await model.load(force:)`로 단순화(파라미터는 이미 모델 안). 디스크립터: `.list(empty: …routeStopsEmpty/bus, isEmpty: …, loadingText: appLocalized("ios.nearby.routeStopsLoading"), failedLocation: 실패카피, failedServer: 실패카피)` — 실패 카피는 현행 그대로 `NearbyOverlayCopy(appLocalized("ios.nearby.routeStopsFailed"), systemImage: "wifi.exclamationmark")`(description 없음). denied·outOfCoverage·failedLocation은 도달 불가(좌표 단계 없음).
- [ ] **Step 4: 커밋**

---

### Task 5: revealMore 4종 이관 — Kids·Around·BarrierFree·Clinic (커밋 4개)

**Files:** `KidsNearbyView.swift`, `AroundNearbyView.swift`, `BarrierFreeNearbyView.swift`, `ClinicNearbyView.swift`

revealMore 원형(Kids 기준 — 나머지 3종 미러):

```swift
@Observable @MainActor
final class KidsNearbyModel {
    private var core: NearbyLoadCore<[KidsPlace]>!   // willCommit이 self 캡처 — IUO 2단 초기화
    private(set) var window = RevealWindow()
    var phase: NearbyLoadPhase<[KidsPlace]> { core.phase }
    var visibleCount: Int { window.visibleCount }

    init() {
        let service = NearbyService(client: APIClient(baseURL: AppConfig.apiBaseURL))
        core = NearbyLoadCore(
            coordinate: LocationService.nearbyCoordinateSource(),
            coverage: .korea,
            fetch: { coord, _ in
                guard let coord else { preconditionFailure("current 소스는 좌표 보장") }
                return try await service.kidsPlaces(lat: coord.lat, lng: coord.lng)
            },
            willCommit: { [weak self] _ in self?.window.reset() },   // 커밋과 원자(스펙 §4)
            onEvent: nearbyAnnouncer(loaded: { places in
                nearbyLoadedMessage(count: places.count, unit: appLocalized("ios.nearby.unitPlace"))
            }))
    }

    func load(force: Bool = false) async { await core.load(force: force) }

    /// "더 보기": 공개 수를 늘리고 첫 새 항목 id를 반환(VO 포커스 이동 대상).
    func revealMore() -> String? {
        guard case .loaded(let places) = phase,
              let firstNewIndex = window.revealMore(totalCount: places.count) else { return nil }
        return places[firstNewIndex].id
    }
}
```

  뷰 변경: `model.state`→`model.phase`, `model.visibleCount` 그대로(포워딩), revealMore 뷰 블록(ScrollViewReader·scrollTo·`DispatchQueue.main.async` 포커스)은 **무변경 유지**(스펙 §8). 디스크립터 empty 좌표: Kids=`kidsEmpty`/`figure.and.child.holdinghands`, Around=`aroundEmpty`/`mappin.and.ellipse`, BarrierFree=`barrierFreeEmpty`/`figure.roll`, Clinic=`clinicEmpty`/`cross.case`.

- [ ] **Step 1: Kids 이관 → 테스트·빌드 → 커밋**
- [ ] **Step 2: Around 이관 → 커밋** (fetch `service.surroundings`)
- [ ] **Step 3: BarrierFree 이관 → 커밋** (fetch `service.nearby`(BarrierFreeService), 출처 행 등 뷰 무변경)
- [ ] **Step 4: Clinic 이관 → 커밋** — payload에 summary 흡수:

```swift
struct ClinicPayload: Sendable {
    let clinics: [NightClinic]
    let summary: ClinicSummary   // ClinicSummary에 Sendable 준수 추가
}
// fetch: { coord, _ in
//     let response = try await service.clinics(lat: coord.lat, lng: coord.lng)
//     return ClinicPayload(
//         clinics: response.clinics,
//         summary: ClinicSummary(basis: response.basis ?? "weekday",
//                                supplementFailed: response.supplementFailed ?? false))
// }
// loaded 통지는 payload.clinics.count 기준 unitPlace. 뷰의 model.summary 접근은
// `if case .loaded(let payload) = model.phase` 안에서 payload.summary로 치환
// (구버전 "loaded와 함께 갱신·nil 폴백" 의미는 payload 동봉으로 자동 충족).
```

---

### Task 6: 이형 3종 이관 — WhereAmI·WalkInfra·Conditions (커밋 3개)

**Files:** `WhereAmIView.swift`, `WalkInfraNearbyView.swift`, `ConditionsView.swift`

- [ ] **Step 1: WhereAmI 이관 → 커밋** — 부재(.empty)·실패 분리 카피의 유일 사용자:

```swift
struct WhereAmIPayload: Sendable {
    let data: WhereAmIData
    let lat: Double
    let lng: Double
    let asOf: String
}
// fetch: { coord, _ in
//     guard let coord else { preconditionFailure("current 소스는 좌표 보장") }
//     guard let data = try await service.locate(lat: coord.lat, lng: coord.lng) else { return nil }  // nil = 부재 → .empty
//     return WhereAmIPayload(data: data, lat: coord.lat, lng: coord.lng,
//                            asOf: Self.timeFormatter.string(from: Date()))
// }
// onEvent: nearbyAnnouncer(
//     loaded: { _ in appLocalized("ios.nearby.whereAmIReady") },
//     emptyResult: appLocalized("whereAmI.empty"))
// 디스크립터: .absentCapable(
//     absent: NearbyOverlayCopy(appLocalized("ios.nearby.whereAmIEmpty"), systemImage: "location.slash"),
//     failedLocation: NearbyOverlayCopy(appLocalized("ios.nearby.whereAmIFailed"), systemImage: "wifi.exclamationmark", description: appLocalized("ios.common.retryLater")),
//     failedServer: NearbyOverlayCopy(appLocalized("ios.nearby.whereAmIServerFailed"), systemImage: "wifi.exclamationmark", description: appLocalized("ios.common.retryLater")))
// 뷰: if case .loaded(let p) = model.phase → p.data/p.lat/p.lng/p.asOf.
```

- [ ] **Step 2: WalkInfra 이관 → 커밋** — `coverage: .none`(의도 계약 — OSM 전 지구, 스펙 §6 주의: 절대 .korea로 "정리"하지 말 것). payload `(walk: WalkInfrastructure, asOf: String)` 구조체. loaded 통지 `WalkInfraModel.liveSummary(walk)` 로직은 자유 함수 `walkInfraLiveSummary(_:)`로 이동(문자열 불변). 디스크립터: `.plain(loadingText: appLocalized("walkInfra.loading"), failedLocation: NearbyOverlayCopy(appLocalized("ios.common.failedTitle"), systemImage: "location.slash", description: appLocalized("ios.common.retryLater")), failedServer: NearbyOverlayCopy(appLocalized("walkInfra.error"), systemImage: "wifi.exclamationmark", description: appLocalized("ios.common.retryLater")))` — ⚠ failedLocation 아이콘이 다른 도메인과 달리 `location.slash`(현행 그대로, "정리" 금지).
- [ ] **Step 3: Conditions 이관 → 커밋** — 조각 병합·통지 3형:

```swift
struct ConditionsPayload: Sendable {
    let weather: Weather?
    let air: AirQuality?
    let freshWeather: Bool   // 이번 호출 성공 여부 — 통지 판정 전용(누적 검사 금지 계약)
    let freshAir: Bool
}
// fetch: { coord, previous in
//     guard let coord else { preconditionFailure("current 소스는 좌표 보장") }
//     async let weatherOutcome = Self.fetchWeather(service, lat: coord.lat, lng: coord.lng)
//     async let airOutcome = Self.fetchAir(service, lat: coord.lat, lng: coord.lng)
//     let (weatherResult, airResult) = await (weatherOutcome, airOutcome)
//     if weatherResult.outOfCoverage || airResult.outOfCoverage { throw APIError.outOfCoverage }
//     return ConditionsPayload(
//         weather: weatherResult.value ?? previous?.weather,   // 새로고침 실패 조각은 직전 성공 유지
//         air: airResult.value ?? previous?.air,
//         freshWeather: weatherResult.value != nil,
//         freshAir: airResult.value != nil)
// }
// fetchWeather/fetchAir nonisolated static 헬퍼는 현행 그대로 이동(취소 흡수 포함 —
// 떠난 화면 방어는 코어 커밋 게이트가 정본, 스펙 §6).
// onEvent: nearbyAnnouncer(loaded: { p in
//     if p.freshWeather && p.freshAir { appLocalized("ios.nearby.conditionsReady") }
//     else if p.freshWeather || p.freshAir { appLocalized("ios.nearby.conditionsPartial") }
//     else { appLocalized("ios.common.failedTitle") }
// })
// 디스크립터: .plain(). 뷰: if case .loaded(let p) = model.phase → weatherSection(p.weather)…
// (구 Phase enum 삭제 — done↔loaded 대응, 조각 프로퍼티는 payload로).
```

---

### Task 7: 구 골격 제거 + 죽은 코드 청소 (커밋 1개)

**Files:** `ios/Gildongmu/Nearby/NearbyLoadState.swift`

- [ ] **Step 1:** 전 모델 이관 완료 확인 후 구 `NearbyLoadState<Item>` enum과 `announceLoaded(count:unit:)` 삭제(소비자 0 — `grep -rn "NearbyLoadState<\|announceLoaded(" ios/`로 확인). `joinText`·`announceRefreshFailed`·`announcePermissionLost`·`announceOutOfCoverage`·어댑터·매퍼·`nearbyLoadedMessage`는 유지. 파일 doc 주석을 "공용 enum" 서술에서 "이벤트→VO 매퍼·어댑터" 서술로 갱신.
- [ ] **Step 2:** `swift test`+빌드 green → 커밋.

---

### Task 8: 시뮬레이터 실측 + 문서 갱신

- [ ] **Step 1: 시뮬 실측** — `xcodebuildmcp` CLI로 `simulator build-and-run` 후 11화면 순회(허브 → 각 화면 진입): loaded 정상 렌더 + 오버레이 카피 확인(스냅샷 `snapshot-ui`로 라벨 회귀 신호 확인 — 판정 정본은 실기기 VO). 위치 권한 거부 케이스는 시뮬 설정으로 1개 화면 이상 확인.
- [ ] **Step 2: CLAUDE.md(repo) 갱신** — "iOS 채팅…" 계열 항목 근처에 신규 nearby 공유 계층 규칙 1줄: 신규 iOS nearby 화면은 `NearbyLoadCore` 구성으로 만들고 load() 상태 머신 복붙 금지(전이표는 스펙 정본). `python ../sync_agent_docs.py` 실행(워크스페이스 루트 기준 경로 주의).
- [ ] **Step 3: PROGRESS.md 갱신** — 운영 표 최상단에 마일스톤 행(커밋 범위·수치·판정 기록·잔여 실기기 VO 스모크 4시나리오: ①로딩 중 pop 무통지 ②loaded 새로고침 실패 통지+데이터 유지 ③권한 회수 전락 통지 ④더 보기 포커스). "미해결·보류"의 레거시 감사 이월 ③ 종결 표기.
- [ ] **Step 4: 커밋** — 문서 3파일 pathspec.

---

## 최종 게이트 (컨트롤러 수행)

1. 최종 whole-branch 리뷰(most capable, superpowers code-reviewer 템플릿) + a11y-auditor 감사.
2. push(자동배포 없음 — iOS 전용 변경) + 실기기 연결 시 `ios/deploy-device.sh` 배포.
3. TTS·최종 보고(잔여: 위원장 실기기 VO 스모크 4시나리오).
