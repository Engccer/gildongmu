# 길동무 iOS M1 구현 계획: 장소 상세·딥링크·커스텀 액션

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 검색 결과에서 장소 상세로 들어가 한영 주소·전화·네이버/카카오 딥링크를 쓸 수 있게 하고, 검색 행에 VoiceOver 커스텀 액션을 붙인다. M0의 `try?` 단순화를 3-state로 해소한다.

**Architecture:** spec `2026-07-06-ios-native-rewrite-design.md` §3·§4. 딥링크 빌더는 웹 `src/lib/deeplink.ts`·`deeplink-kakao.ts`의 Swift 미러(GildongmuKit). 앱 실행은 `openURL` 완료 콜백으로 미설치 폴백(`canOpenURL`·`LSApplicationQueriesSchemes` 불필요: open은 화이트리스트 없이 시도 가능).

**Tech Stack:** M0과 동일. 신규 의존성 0.

## Global Constraints (M0 plan과 동일 + 추가)

- M0 plan의 Global Constraints 전부 유지(iOS 26·의존성 0·한 줄=한 객체·pathspec 커밋·한국어 주석·em dash 금지).
- 실행 방식: 단일 세션+서브에이전트. Agent Teams는 M2(내 주변 6종, 진짜 팬아웃)부터 검토. M1은 한 수직 슬라이스라 팀 동기화 비용 > 이득.
- 웹 딥링크 의미론 보존: nmap은 `appname=space.dodoplanet.gildongmu` 필수, 목적지 한반도 권역 검증(위도 31.43~44.35, 경도 122.37~132.0), 출발지 생략=현재 위치 출발, 카카오 장소 상세는 `Place.id`의 `"kakao-"` 접두 제거 후 전달.
- 테스트: `swift test --package-path ios/GildongmuKit`, 앱 빌드: `cd ios && xcodebuild -project Gildongmu.xcodeproj -scheme Gildongmu -destination 'generic/platform=iOS' build CODE_SIGNING_ALLOWED=NO`.

## 파일 구조 (M1 완료 시점 신규·변경)

```text
ios/GildongmuKit/Sources/GildongmuKit/
├── Deeplink.swift                 ← 신규: 네이버·카카오 딥링크 빌더(웹 미러)
└── SearchService.swift            ← 변경: SectionState 3-state
ios/GildongmuKit/Tests/GildongmuKitTests/
├── DeeplinkTests.swift            ← 신규
└── SearchServiceTests.swift       ← 변경
ios/Gildongmu/
├── AppConfig.swift                ← 신규: base URL 주입(M0 이월)
├── PlaceDetailView.swift          ← 신규
├── SearchModel.swift              ← 변경: AppConfig·3-state 반영
└── SearchView.swift               ← 변경: NavigationLink·커스텀 액션·3-state 반영
```

---

### Task 1: Deeplink 빌더 (GildongmuKit, 웹 미러)

**Files:**
- Create: `ios/GildongmuKit/Sources/GildongmuKit/Deeplink.swift`
- Test: `ios/GildongmuKit/Tests/GildongmuKitTests/DeeplinkTests.swift`

**Interfaces (Produces):**
- `enum RouteMode: String, CaseIterable, Sendable { case walk, publicTransit, car, bike }`
- `struct RouteDestination: Sendable { let lat: Double; let lng: Double; let name: String }`
- `func isInKorea(lat: Double, lng: Double) -> Bool`
- `func buildNaverRouteDeeplink(mode: RouteMode, dest: RouteDestination, appname: String) -> URL?` (권역 밖이면 nil)
- `func buildKakaoRouteDeeplink(mode: RouteMode, dest: RouteDestination) -> URL?`
- `func buildKakaoPlaceDeeplink(kakaoPlaceId: String) -> URL?`
- `func buildKakaoWebRouteUrl(mode: RouteMode, dest: RouteDestination) -> URL?` (미설치 폴백)

- [ ] **Step 1: 실패하는 테스트** (`DeeplinkTests.swift`)

```swift
import Testing
import Foundation
@testable import GildongmuKit

private let gangnam = RouteDestination(lat: 37.4979, lng: 127.0276, name: "강남역")

@Test func naverRouteDeeplinkMirrorsWebFormat() {
    let url = buildNaverRouteDeeplink(mode: .walk, dest: gangnam, appname: "space.dodoplanet.gildongmu")
    let s = url!.absoluteString
    #expect(s.hasPrefix("nmap://route/walk?"))
    #expect(s.contains("dlat=37.4979") && s.contains("dlng=127.0276"))
    #expect(s.contains("appname=space.dodoplanet.gildongmu"))
    // 출발지 생략 = 현재 위치 출발(웹 계약)
    #expect(!s.contains("slat="))
}

@Test func kakaoRouteDeeplinkUsesOfficialByParams() {
    let url = buildKakaoRouteDeeplink(mode: .publicTransit, dest: gangnam)
    let s = url!.absoluteString
    #expect(s.hasPrefix("kakaomap://route?"))
    #expect(s.contains("ep=37.4979,127.0276"))
    #expect(s.contains("by=publictransit"))
}

@Test func outsideKoreaReturnsNil() {
    let paris = RouteDestination(lat: 48.85, lng: 2.35, name: "Paris")
    #expect(buildNaverRouteDeeplink(mode: .car, dest: paris, appname: "a") == nil)
    #expect(buildKakaoRouteDeeplink(mode: .car, dest: paris) == nil)
    #expect(isInKorea(lat: 37.5, lng: 127.0) == true)
}

@Test func kakaoPlaceDeeplinkAndWebFallback() {
    #expect(buildKakaoPlaceDeeplink(kakaoPlaceId: "26338954")!.absoluteString == "kakaomap://place?id=26338954")
    let web = buildKakaoWebRouteUrl(mode: .walk, dest: gangnam)!.absoluteString
    #expect(web.hasPrefix("https://map.kakao.com/link/by/walk/"))
    #expect(web.contains("37.4979"))
}
```

- [ ] **Step 2: 실패 확인**: `swift test --package-path ios/GildongmuKit` Expected: FAIL

- [ ] **Step 3: 구현** (`Deeplink.swift`)

```swift
import Foundation

/// 네이버·카카오 지도 앱 딥링크 빌더. 웹 `src/lib/deeplink.ts`·`deeplink-kakao.ts` 미러.
/// 실주행 내비는 네이티브 지도 앱에 위임한다(spec §4). 권역 밖 목적지는 nil.

/// 좌표 유효 범위: 한반도 권역(네이버 공식 문서 기준, 웹과 동일 상수).
public func isInKorea(lat: Double, lng: Double) -> Bool {
    lat >= 31.43 && lat <= 44.35 && lng >= 122.37 && lng <= 132.0
}

/// 길찾기 이동 수단. rawValue는 nmap route 경로 세그먼트와 일치(publicTransit만 "public").
public enum RouteMode: String, CaseIterable, Sendable {
    case walk, publicTransit = "public", car, bike

    /// kakaomap://route 의 by 파라미터(공식: car, publictransit, foot, bicycle)
    var kakaoBy: String {
        switch self {
        case .walk: "foot"
        case .publicTransit: "publictransit"
        case .car: "car"
        case .bike: "bicycle"
        }
    }

    /// map.kakao.com/link/by/{수단} 경로 세그먼트
    var kakaoWebBy: String {
        switch self {
        case .walk: "walk"
        case .publicTransit: "traffic"
        case .car: "car"
        case .bike: "bicycle"
        }
    }
}

public struct RouteDestination: Sendable {
    public let lat: Double
    public let lng: Double
    public let name: String
    public init(lat: Double, lng: Double, name: String) {
        self.lat = lat
        self.lng = lng
        self.name = name
    }
}

/// 네이버 지도 길찾기 딥링크. 출발지 생략 = 앱이 현재 위치 출발(웹 계약 동일).
/// appname은 nmap 스킴 필수 파라미터.
public func buildNaverRouteDeeplink(mode: RouteMode, dest: RouteDestination, appname: String) -> URL? {
    guard isInKorea(lat: dest.lat, lng: dest.lng) else { return nil }
    var components = URLComponents()
    components.scheme = "nmap"
    components.host = "route"
    components.path = "/\(mode.rawValue)"
    components.queryItems = [
        URLQueryItem(name: "dlat", value: String(dest.lat)),
        URLQueryItem(name: "dlng", value: String(dest.lng)),
        URLQueryItem(name: "dname", value: dest.name),
        URLQueryItem(name: "appname", value: appname),
    ]
    return components.url
}

/// 카카오맵 길찾기 딥링크. 출발지(sp) 생략 = 현재 위치 출발.
public func buildKakaoRouteDeeplink(mode: RouteMode, dest: RouteDestination) -> URL? {
    guard isInKorea(lat: dest.lat, lng: dest.lng) else { return nil }
    var components = URLComponents()
    components.scheme = "kakaomap"
    components.host = "route"
    components.queryItems = [
        URLQueryItem(name: "ep", value: "\(dest.lat),\(dest.lng)"),
        URLQueryItem(name: "by", value: mode.kakaoBy),
    ]
    return components.url
}

/// 카카오맵 장소 상세 딥링크. 호출 측이 Place.id의 "kakao-" 접두를 제거해 전달한다.
public func buildKakaoPlaceDeeplink(kakaoPlaceId: String) -> URL? {
    var components = URLComponents()
    components.scheme = "kakaomap"
    components.host = "place"
    components.queryItems = [URLQueryItem(name: "id", value: kakaoPlaceId)]
    return components.url
}

/// 길찾기 웹 URL: 카카오맵 미설치 폴백(웹 계약: /link/by/{수단}/{이름},{위도},{경도}).
public func buildKakaoWebRouteUrl(mode: RouteMode, dest: RouteDestination) -> URL? {
    guard isInKorea(lat: dest.lat, lng: dest.lng) else { return nil }
    let name = dest.name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? dest.name
    return URL(string: "https://map.kakao.com/link/by/\(mode.kakaoWebBy)/\(name),\(dest.lat),\(dest.lng)")
}
```

- [ ] **Step 4: 통과 확인 후 Commit**

```bash
git add ios/GildongmuKit/Sources/GildongmuKit/Deeplink.swift ios/GildongmuKit/Tests/GildongmuKitTests/DeeplinkTests.swift && git commit -m "feat(ios): 네이버·카카오 딥링크 빌더(웹 미러) + 테스트" -- ios/GildongmuKit
```

### Task 2: SearchService 3-state (M0 `try?` 단순화 해소)

**Files:**
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/SearchService.swift`
- Modify: `ios/GildongmuKit/Tests/GildongmuKitTests/SearchServiceTests.swift`

**Interfaces (Produces, 기존 소비자 갱신 필요):**
- `enum SectionState<Element: Sendable>: Sendable { case loaded([Element]); case failed }` + `var items: [Element]`, `var isFailed: Bool`
- `SearchOutcome`: `attractions/places/addresses/web: SectionState<...>` + `var allFailed: Bool`(계산) + `var orderedSections: [SearchSection]`(계산, 기존 정렬 규칙)
- `orderedSections(places:addresses:web:)` 전역 함수는 SearchOutcome 계산 프로퍼티로 흡수(전역 제거)

- [ ] **Step 1: 테스트 갱신**: 기존 4개 테스트를 새 shape로 고치고 부분 실패 가시성 테스트 추가:

```swift
@Test func partialFailureIsVisiblePerSection() async throws {
    StubURLProtocol.handler = { request in
        switch request.url!.path() {
        case "/api/places": return (502, Data(#"{"error":"실패"}"#.utf8))
        case "/api/places/attractions": return (200, Data(#"{"places":[],"provider":"none","query":"q"}"#.utf8))
        case "/api/address/search": return (200, Data(#"{"addresses":[],"query":"q"}"#.utf8))
        case "/api/search/web": return (200, Data(#"{"web":[]}"#.utf8))
        default: return (404, Data())
        }
    }
    let outcome = await SearchService(client: stubbedClient()).search(query: "q", lat: nil, lng: nil, lang: "ko")
    #expect(outcome.places.isFailed)
    #expect(!outcome.addresses.isFailed)
    #expect(outcome.allFailed == false)
}
```

기존 테스트 매핑: `webFallbackOnlyWhenBothEmpty`·`attractionsRideSeparateTrack`·`sectionFailureIsIsolated`·`totalFailureIsSignaledNotSilenced`는 `outcome.orderedSections`·`outcome.attractions.items`·`outcome.allFailed`로 표현만 바꾼다(의미 동일). `orderedSectionsSortsByCountDesc`는 SearchOutcome 생성자 기반으로 재작성.

- [ ] **Step 2: 구현.** `search()`는 각 결과를 `result.map { .loaded($0...) } ?? .failed`로 변환. 웹 폴백 발동 조건은 "places.items와 addresses.items 둘 다 빈 배열"(실패 포함, 기존 의미 유지). 미발동 시 `web = .loaded([])`. `allFailed = places.isFailed && addresses.isFailed`.

- [ ] **Step 3: 앱 컴파일 유지보수.** `SearchModel.totalCount`·`SearchView`가 `outcome.orderedSections`·`outcome.attractions.items`를 쓰도록 갱신(로직 불변).

- [ ] **Step 4: swift test 전체 통과 + 앱 빌드 통과 확인 후 Commit**

```bash
git commit -m "refactor(ios): SearchService 섹션별 3-state(SectionState) 전환" -- ios/GildongmuKit ios/Gildongmu
```

### Task 3: AppConfig base URL 주입 (M0 이월)

**Files:**
- Create: `ios/Gildongmu/AppConfig.swift`
- Modify: `ios/Gildongmu/SearchModel.swift`

```swift
import Foundation

/// 앱 전역 설정. base URL은 릴리스 고정, 디버그는 스킴 환경변수로 로컬 dev 전환(spec §6).
enum AppConfig {
    static var apiBaseURL: URL {
        #if DEBUG
        if let override = ProcessInfo.processInfo.environment["GILDONGMU_API_BASE_URL"],
           let url = URL(string: override) {
            return url
        }
        #endif
        return URL(string: "https://gildongmu.vercel.app")!
    }

    /// nmap 딥링크 필수 appname(웹 NEXT_PUBLIC_APP_IDENTIFIER와 동일값)
    static let appIdentifier = "space.dodoplanet.gildongmu"
}
```

- [ ] SearchModel의 `APIClient(baseURL:)`을 `AppConfig.apiBaseURL`로 교체, 빌드 확인, Commit:
```bash
git add ios/Gildongmu/AppConfig.swift && git commit -m "feat(ios): AppConfig base URL 주입(디버그 env 오버라이드)" -- ios/Gildongmu
```

### Task 4: PlaceDetailView + NavigationStack 진입

**Files:**
- Create: `ios/Gildongmu/PlaceDetailView.swift`
- Modify: `ios/Gildongmu/SearchView.swift`

**iOS 문법(spec §4):** 상세 진입은 `NavigationLink(value:)` + `.navigationDestination(for: Place.self)`. 뒤로가기 제스처·복귀 포커스는 시스템 표준. 진입 시 포커스는 자동으로 상세 첫 요소로 이동(시스템), 명시 이동은 실기기 검증 후 필요 시에만(과잉 방지).

- [ ] **Step 1: PlaceDetailView 구현**

```swift
import SwiftUI
import GildongmuKit

/// 장소 상세. 정보 정본은 텍스트 리스트(지도 없음). 실주행은 딥링크 위임(spec §4).
struct PlaceDetailView: View {
    let place: Place
    @Environment(\.openURL) private var openURL

    var body: some View {
        List {
            Section {
                // 한 줄=한 객체: 라벨 볼드 분절 대신 단일 텍스트(웹 정본 규칙)
                if !place.category.isEmpty { Text(place.category) }
                if !place.roadAddress.isEmpty { Text("도로명 주소, \(place.roadAddress)") }
                if !place.address.isEmpty { Text("지번 주소, \(place.address)") }
                if let english = place.englishAddress, !english.isEmpty {
                    Text("영문 주소, \(english)")
                }
                if let phone = place.phone, !phone.isEmpty,
                   let telURL = URL(string: "tel:\(phone.replacingOccurrences(of: "-", with: ""))") {
                    // 인터랙티브 요소는 별도 객체가 정상(합치지 말 것)
                    Link("전화 걸기, \(phone)", destination: telURL)
                }
            }

            Section("길찾기") {
                Button("네이버 지도 길찾기") { openNaverRoute() }
                Button("카카오맵 길찾기") { openKakaoRoute() }
                if let kakaoId = kakaoPlaceId {
                    Button("카카오맵 장소 정보") { openKakaoPlace(kakaoId) }
                }
            }
        }
        .navigationTitle(place.name)
        .navigationBarTitleDisplayMode(.large)
    }

    /// Place.id "kakao-" 접두가 있을 때만 카카오 장소 상세 체인 유효(웹 계약)
    private var kakaoPlaceId: String? {
        place.id.hasPrefix("kakao-") ? String(place.id.dropFirst("kakao-".count)) : nil
    }

    private var destination: RouteDestination {
        RouteDestination(lat: place.lat, lng: place.lng, name: place.name)
    }

    /// 도보 기본(1급 사용자 주 시나리오). 모드 선택 UI는 M4 경로 브리핑에서.
    private func openNaverRoute() {
        guard let url = buildNaverRouteDeeplink(mode: .walk, dest: destination, appname: AppConfig.appIdentifier) else { return }
        openWithFallback(url)
    }

    private func openKakaoRoute() {
        guard let url = buildKakaoRouteDeeplink(mode: .walk, dest: destination) else { return }
        openWithFallback(url)
    }

    private func openKakaoPlace(_ id: String) {
        guard let url = buildKakaoPlaceDeeplink(kakaoPlaceId: id) else { return }
        openWithFallback(url)
    }

    /// 앱 미설치(스킴 미처리) 시 카카오 웹 지도로 폴백. canOpenURL 화이트리스트 불필요.
    private func openWithFallback(_ url: URL) {
        openURL(url) { accepted in
            if !accepted, let fallback = buildKakaoWebRouteUrl(mode: .walk, dest: destination) {
                openURL(fallback)
            }
        }
    }
}
```

- [ ] **Step 2: SearchView 연결.** PlaceRow를 `NavigationLink(value: place) { PlaceRow(place: place) }`로 감싸고(명소·장소 두 곳), List에 `.navigationDestination(for: Place.self) { PlaceDetailView(place: $0) }` 추가. 접근성 포커스 modifier는 NavigationLink 바깥에 유지.

- [ ] **Step 3: 빌드 확인 후 Commit**
```bash
git add ios/Gildongmu/PlaceDetailView.swift && git commit -m "feat(ios): 장소 상세 화면(한영 주소·전화·딥링크+웹 폴백)" -- ios/Gildongmu
```

### Task 5: PlaceRow 커스텀 액션(로터)

**Files:**
- Modify: `ios/Gildongmu/SearchView.swift`

**iOS 문법(spec §4 핵심):** 화면 버튼을 늘리는 대신 행 하나에 VoiceOver 커스텀 액션 부착. 기본 활성화=상세 진입, 액션: 전화(있으면)·네이버 길찾기·카카오맵 길찾기. 시각 UI는 그대로(버튼 0개 추가).

- [ ] **Step 1: 구현.** PlaceRow에 openURL 환경과 액션 부착:

```swift
struct PlaceRow: View {
    let place: Place
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading) {
            Text(place.name)
            Text(joined)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityActions {
            if let phone = place.phone, !phone.isEmpty,
               let telURL = URL(string: "tel:\(phone.replacingOccurrences(of: "-", with: ""))") {
                Button("전화 걸기") { openURL(telURL) }
            }
            Button("네이버 지도 길찾기") {
                if let url = buildNaverRouteDeeplink(mode: .walk, dest: dest, appname: AppConfig.appIdentifier) {
                    openURL(url)
                }
            }
            Button("카카오맵 길찾기") {
                if let url = buildKakaoRouteDeeplink(mode: .walk, dest: dest) { openURL(url) }
            }
        }
    }

    private var dest: RouteDestination { RouteDestination(lat: place.lat, lng: place.lng, name: place.name) }
    // joined는 기존 그대로
}
```

- [ ] **Step 2: 빌드 확인 후 Commit**
```bash
git commit -m "feat(ios): 검색 행 VoiceOver 커스텀 액션(전화·네이버·카카오 길찾기)" -- ios/Gildongmu/SearchView.swift
```

### Task 6: 실기기 M1 게이트

- [ ] 실기기 빌드·설치(오케스트레이터가 CLI 수행: `-allowProvisioningUpdates` 빌드 + `devicectl install/launch`)
- [ ] VoiceOver 게이트: ① 검색→행 활성화→상세 진입, 상세 정보가 단일 텍스트들로 낭독 ② 뒤로가기(2손가락 스크럽 또는 뒤로 버튼) 후 원래 행 근처로 복귀 ③ 행에서 로터 액션 메뉴에 전화·네이버·카카오 노출, 실행 시 앱 handoff(미설치면 웹 폴백) ④ 전화 링크 활성화 시 통화 확인 시트
- [ ] PROGRESS.md M1 기록 + Commit

## Self-Review 결과

- **Spec coverage:** M1 로드맵 항목(상세·한영 주소·tel·딥링크+폴백·커스텀 액션·3-state 해소) 전부 태스크 매핑. base URL 이월분 Task 3 처리.
- **Placeholder scan:** 없음. Task 2는 리팩터라 diff 지시 방식(기존 코드가 정본)으로 서술하고 신규 코드는 전문 수록.
- **Type consistency:** `RouteDestination`·`RouteMode`(Task 1) ↔ Task 4·5 사용부 일치. `SectionState.items`·`orderedSections`(Task 2) ↔ Task 2 Step 3 앱 갱신 일치. `AppConfig.appIdentifier`(Task 3) ↔ Task 4·5 사용 일치.
