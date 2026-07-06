# 길동무 iOS 네이티브 재개발: M0 구현 계획 (+ M1~M8 로드맵)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `ios/` 신규 트리에 GildongmuKit(SPM, UI 비의존)과 SwiftUI 앱 골격을 세우고, 검색 3섹션+명소 병치를 실기기에서 동작시킨다(M0). M1~M8은 로드맵으로 고정하고 각 마일스톤 경계에서 상세 plan을 새로 쓴다.

**Architecture:** 순수 API 클라이언트. 기존 Vercel `/api/*`를 변경 없이 소비한다(spec `2026-07-06-ios-native-rewrite-design.md` §3). GildongmuKit이 계약 모델·클라이언트·검색 오케스트레이션을 담고, 앱 타깃은 화면·서비스만 얹는다.

**Tech Stack:** Swift 6 + SwiftUI + `@Observable` + `NavigationStack` + Swift Testing. 서드파티 의존성 0.

## Global Constraints (spec §2 전사)

- 최소 지원 버전 **iOS 26**. availability guard 금지(잉여).
- 서드파티 의존성 **0이 기본값**. 추가는 spec 리스크 표의 예외 논의를 거친다.
- 지도 미탑재. 실주행은 딥링크 위임(M1).
- 좌표는 WGS84 십진 도(웹 계약 그대로).
- 접근성 정본은 `~/.claude/ACCESSIBILITY.md` + spec §5. 한 줄=한 객체는 `accessibilityElement(children: .combine)`, 통지는 `AccessibilityNotification.Announcement` 단일 채널.
- UI 라벨 이모지 금지, em dash 금지, 주석·문서 한국어.
- GildongmuKit은 UIKit/SwiftUI import 금지(dodo 이식 단위).
- 커밋은 의도 파일 pathspec만(`git add -A` 금지). 신규 파일은 `git add <경로> && git commit -- <경로>` 원자 실행.
- base URL: 릴리스 `https://gildongmu.vercel.app`, 디버그는 주입 가능.

## 파일 구조 (M0 완료 시점)

```text
ios/
├── .gitignore                         ← DerivedData·xcuserdata 제외
├── GildongmuKit/
│   ├── Package.swift
│   ├── Sources/GildongmuKit/
│   │   ├── Models/SearchModels.swift  ← Place·PlaceSearchResult·JusoAddress·WebSearchResult + envelope
│   │   ├── APIClient.swift            ← GET+디코딩+오류 정규화
│   │   └── SearchService.swift        ← 3섹션 병렬+웹 폴백+명소, 섹션 정렬
│   └── Tests/GildongmuKitTests/
│       ├── Fixtures/                  ← prod 실응답 캡처 JSON 4종
│       ├── SearchModelsTests.swift
│       ├── APIClientTests.swift
│       └── SearchServiceTests.swift
└── Gildongmu.xcodeproj/project.pbxproj ← objectVersion 77(폴더 동기화 그룹, pbxproj 최소화)
└── Gildongmu/
    ├── GildongmuApp.swift
    ├── SearchView.swift               ← 검색 화면(M0 유일 화면)
    └── SearchModel.swift              ← @Observable 상태
```

분해 원칙: 모델·클라이언트·오케스트레이션·화면이 각각 한 책임. Kit는 CLI(`swift test`)만으로 개발 가능해 **Xcode 26 설치와 병렬 진행**할 수 있다(Task 1~5는 Xcode 불필요).

---

### Task 0: 환경 준비 (사용자 조작 필요, Task 6 전까지만 완료되면 됨)

**Files:** 없음(시스템 설정)

- [ ] **Step 1: Xcode 26 설치 안내** (App Store 조작·sudo는 사용자 몫, 명령만 나열)

```bash
# 사용자: App Store에서 Xcode 26 설치(약 수십 GB) 후:
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
xcodebuild -downloadPlatform iOS   # 시뮬레이터 런타임(선택)
```

- [ ] **Step 2: 확인**

Run: `xcodebuild -version`
Expected: `Xcode 26.x`

- [ ] **Step 3: Apple ID 무료 팀 등록**: Xcode > Settings > Accounts에 Apple ID 추가(Personal Team 자동 생성). 실기기 연결 후 Settings > Privacy & Security > Developer Mode 켜기.

### Task 1: ios/ 골격 + GildongmuKit 패키지

**Files:**
- Create: `ios/.gitignore`, `ios/GildongmuKit/Package.swift`
- Create: `ios/GildongmuKit/Sources/GildongmuKit/Models/SearchModels.swift` (빈 자리표시 타입 1개)
- Test: `ios/GildongmuKit/Tests/GildongmuKitTests/SearchModelsTests.swift`

**Interfaces:**
- Produces: SPM 패키지 `GildongmuKit`(라이브러리), 테스트 실행 경로 `swift test --package-path ios/GildongmuKit`

- [ ] **Step 1: .gitignore와 Package.swift 작성**

`ios/.gitignore`:
```gitignore
DerivedData/
*.xcuserdatad/
xcuserdata/
.swiftpm/
.build/
```

`ios/GildongmuKit/Package.swift`:
```swift
// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "GildongmuKit",
    defaultLocalization: "ko",
    platforms: [.iOS(.v26), .macOS(.v26)],
    products: [.library(name: "GildongmuKit", targets: ["GildongmuKit"])],
    targets: [
        .target(name: "GildongmuKit"),
        .testTarget(
            name: "GildongmuKitTests",
            dependencies: ["GildongmuKit"],
            resources: [.copy("Fixtures")]
        ),
    ]
)
```

macOS 플랫폼 포함 이유: Kit는 Foundation만 쓰므로 Mac에서 `swift test`로 게이트를 돌린다(Xcode 불필요).

- [ ] **Step 2: 컴파일 확인용 최소 타입과 스모크 테스트**

`Sources/GildongmuKit/Models/SearchModels.swift`:
```swift
import Foundation

/// 장소 하나. 웹 `src/lib/types.ts` Place의 미러(계약 정본은 웹).
public struct Place: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let category: String
    public let address: String
    public let roadAddress: String
    public let englishAddress: String?
    public let lat: Double
    public let lng: Double
    public let phone: String?
    public let link: String?
    public let distanceMeters: Double?
}
```

`Tests/GildongmuKitTests/SearchModelsTests.swift`:
```swift
import Testing
import Foundation
@testable import GildongmuKit

@Test func placeDecodesMinimalJSON() throws {
    let json = #"{"id":"k1","name":"강남역","category":"교통","address":"a","roadAddress":"r","lat":37.49,"lng":127.02}"#
    let place = try JSONDecoder().decode(Place.self, from: Data(json.utf8))
    #expect(place.name == "강남역")
    #expect(place.englishAddress == nil)
}
```

- [ ] **Step 3: 테스트 실패→통과 확인**

Run: `swift test --package-path ios/GildongmuKit`
Expected: PASS (1 test)

- [ ] **Step 4: Commit**

```bash
git add ios/.gitignore ios/GildongmuKit && git commit -m "feat(ios): GildongmuKit SPM 골격 + Place 계약 모델" -- ios/.gitignore ios/GildongmuKit
```

### Task 2: prod 실응답 fixture 캡처

**Files:**
- Create: `ios/GildongmuKit/Tests/GildongmuKitTests/Fixtures/{places,address,web,attractions}.json`

**Interfaces:**
- Produces: Task 3 계약 테스트의 입력. 실호출 캡처라 "fixture green ≠ 실계약" 갭이 없음.

- [ ] **Step 1: prod 4종 캡처** (좌표는 강남역 인근)

```bash
F=ios/GildongmuKit/Tests/GildongmuKitTests/Fixtures; mkdir -p $F
curl -s "https://gildongmu.vercel.app/api/places?query=%EA%B0%95%EB%82%A8%EC%97%AD&lat=37.4979&lng=127.0276" > $F/places.json
curl -s "https://gildongmu.vercel.app/api/address/search?query=%EC%84%B8%EC%A2%85%EB%8C%80%EB%A1%9C%20110" > $F/address.json
curl -s "https://gildongmu.vercel.app/api/search/web?query=%EA%B0%95%EB%82%A8%EC%97%AD%20%EB%A7%9B%EC%A7%91" > $F/web.json
curl -s "https://gildongmu.vercel.app/api/places/attractions?query=%EA%B2%BD%EB%B3%B5%EA%B6%81&lang=ko&lat=37.4979&lng=127.0276" > $F/attractions.json
python3 -c "import json,glob;[json.load(open(f)) for f in glob.glob('$F/*.json')];print('all valid')"
```

Expected: `all valid`. 각 파일에 `places`/`addresses`/`web` 키가 실데이터로 존재하는지 눈으로 확인(빈 배열이면 쿼리 바꿔 재캡처).

- [ ] **Step 2: Commit**

```bash
git add ios/GildongmuKit/Tests/GildongmuKitTests/Fixtures && git commit -m "test(ios): 검색 4종 prod 실응답 fixture 캡처" -- ios/GildongmuKit/Tests/GildongmuKitTests/Fixtures
```

### Task 3: 계약 모델 전체 + fixture 디코딩 테스트

**Files:**
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/Models/SearchModels.swift`
- Test: `ios/GildongmuKit/Tests/GildongmuKitTests/SearchModelsTests.swift`

**Interfaces:**
- Produces(정확 시그니처, 이후 태스크가 그대로 사용):
  - `PlaceSearchResult { places: [Place], provider: String, query: String }`
  - `AddressSearchResponse { addresses: [JusoAddress], query: String }`
  - `JusoAddress { roadAddr, roadAddrPart1, jibunAddr, engAddr, zipNo, bdNm: String }`
  - `WebSearchResponse { web: [WebSearchResult] }`
  - `WebSearchResult { title: String, url: String, snippet: String, date: String? }`
  - `APIErrorBody { error: String }`

- [ ] **Step 1: fixture 로더 헬퍼 + 실패하는 계약 테스트 작성**

`SearchModelsTests.swift`에 추가:
```swift
func fixture(_ name: String) throws -> Data {
    let url = Bundle.module.url(forResource: "Fixtures/\(name)", withExtension: "json")!
    return try Data(contentsOf: url)
}

@Test func placesFixtureDecodes() throws {
    let result = try JSONDecoder().decode(PlaceSearchResult.self, from: fixture("places"))
    #expect(!result.places.isEmpty)
    #expect(result.query == "강남역")
}

@Test func addressFixtureDecodes() throws {
    let result = try JSONDecoder().decode(AddressSearchResponse.self, from: fixture("address"))
    #expect(!result.addresses.isEmpty)
    #expect(result.addresses[0].zipNo.count == 5)
}

@Test func webFixtureDecodes() throws {
    let result = try JSONDecoder().decode(WebSearchResponse.self, from: fixture("web"))
    #expect(result.web.allSatisfy { !$0.url.isEmpty })
}

@Test func attractionsFixtureDecodes() throws {
    let result = try JSONDecoder().decode(PlaceSearchResult.self, from: fixture("attractions"))
    #expect(result.places.allSatisfy { $0.lat > 33 && $0.lat < 39 })
}
```

- [ ] **Step 2: 실패 확인**

Run: `swift test --package-path ios/GildongmuKit`
Expected: FAIL (`PlaceSearchResult` 미정의)

- [ ] **Step 3: 모델 구현** (`SearchModels.swift`에 추가)

```swift
/// 장소 검색 응답 envelope(`/api/places`·`/api/places/attractions` 공용).
/// provider는 웹에서 열거형이지만 신규 provider 추가에 깨지지 않도록 String으로 둔다.
public struct PlaceSearchResult: Codable, Sendable {
    public let places: [Place]
    public let provider: String
    public let query: String
}

/// 행안부 도로명주소(juso) 정규화 결과. 웹 JusoAddress 미러.
public struct JusoAddress: Codable, Sendable, Hashable {
    public let roadAddr: String
    public let roadAddrPart1: String
    public let jibunAddr: String
    public let engAddr: String
    public let zipNo: String
    public let bdNm: String
}

public struct AddressSearchResponse: Codable, Sendable {
    public let addresses: [JusoAddress]
    public let query: String
}

/// Perplexity 웹 검색 결과. 웹 WebSearchResult 미러.
public struct WebSearchResult: Codable, Sendable, Hashable {
    public let title: String
    public let url: String
    public let snippet: String
    public let date: String?
}

public struct WebSearchResponse: Codable, Sendable {
    public let web: [WebSearchResult]
}

/// 라우트 오류 응답 `{ "error": "..." }`.
public struct APIErrorBody: Codable, Sendable {
    public let error: String
}
```

- [ ] **Step 4: 통과 확인 후 Commit**

Run: `swift test --package-path ios/GildongmuKit` Expected: PASS (5 tests)
```bash
git commit -m "feat(ios): 검색 계약 모델 4종 + prod fixture 계약 테스트" -- ios/GildongmuKit
```

### Task 4: APIClient

**Files:**
- Create: `ios/GildongmuKit/Sources/GildongmuKit/APIClient.swift`
- Test: `ios/GildongmuKit/Tests/GildongmuKitTests/APIClientTests.swift`

**Interfaces:**
- Produces:
  - `APIClient.init(baseURL: URL, session: URLSession = .shared)`
  - `func get<T: Decodable & Sendable>(_ path: String, query: [URLQueryItem]) async throws -> T`
  - `enum APIError: Error { case badStatus(code: Int, message: String?), decoding(any Error), network(any Error) }`

- [ ] **Step 1: URLProtocol 목 기반 실패 테스트 작성**

`APIClientTests.swift`:
```swift
import Testing
import Foundation
@testable import GildongmuKit

final class StubURLProtocol: URLProtocol {
    nonisolated(unsafe) static var handler: ((URLRequest) -> (Int, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let (status, data) = Self.handler!(request)
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

func stubbedClient() -> APIClient {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [StubURLProtocol.self]
    return APIClient(baseURL: URL(string: "https://example.test")!, session: URLSession(configuration: config))
}

@Test func getDecodesSuccessPayload() async throws {
    StubURLProtocol.handler = { request in
        #expect(request.url?.path() == "/api/places")
        #expect(request.url?.query()?.contains("query=%EA%B0%95%EB%82%A8") == true)
        return (200, Data(#"{"places":[],"provider":"kakao-local","query":"강남"}"#.utf8))
    }
    let result: PlaceSearchResult = try await stubbedClient()
        .get("/api/places", query: [URLQueryItem(name: "query", value: "강남")])
    #expect(result.provider == "kakao-local")
}

@Test func getThrowsBadStatusWithServerMessage() async throws {
    StubURLProtocol.handler = { _ in (502, Data(#"{"error":"장소 검색에 실패했습니다."}"#.utf8)) }
    await #expect(throws: APIError.self) {
        let _: PlaceSearchResult = try await stubbedClient().get("/api/places", query: [])
    }
}
```

- [ ] **Step 2: 실패 확인**: Run 위와 동일. Expected: FAIL (`APIClient` 미정의)

- [ ] **Step 3: 구현** (`APIClient.swift`)

```swift
import Foundation

/// 라우트 오류 3분류. 3-state 불변식(spec §6)의 전송 계층 받침대:
/// "빈 결과"는 성공 디코딩의 빈 배열이고, 여기의 오류는 전부 "조회 실패"다.
public enum APIError: Error, Sendable {
    case badStatus(code: Int, message: String?)
    case decoding(any Error)
    case network(any Error)
}

/// Vercel `/api/*` 소비 전용 최소 클라이언트. base URL 주입(디버그 로컬 dev 지원).
public struct APIClient: Sendable {
    public let baseURL: URL
    let session: URLSession

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    public func get<T: Decodable & Sendable>(_ path: String, query: [URLQueryItem]) async throws -> T {
        var components = URLComponents(url: baseURL.appending(path: path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(from: components.url!)
        } catch {
            throw APIError.network(error)
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let message = try? JSONDecoder().decode(APIErrorBody.self, from: data).error
            throw APIError.badStatus(code: status, message: message)
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.decoding(error)
        }
    }
}
```

- [ ] **Step 4: 통과 확인 후 Commit**

```bash
git commit -m "feat(ios): APIClient GET+오류 정규화 + URLProtocol 목 테스트" -- ios/GildongmuKit
```

### Task 5: SearchService (3섹션 병렬 + 웹 폴백 + 명소 병치)

**Files:**
- Create: `ios/GildongmuKit/Sources/GildongmuKit/SearchService.swift`
- Test: `ios/GildongmuKit/Tests/GildongmuKitTests/SearchServiceTests.swift`

**Interfaces:**
- Consumes: `APIClient.get(_:query:)`, Task 3 모델 전부
- Produces:
  - `struct SearchOutcome: Sendable { attractions: [Place], sections: [SearchSection] }`
  - `enum SearchSection: Sendable { case places([Place]), addresses([JusoAddress]), web([WebSearchResult]) }` (각 `var count: Int`)
  - `SearchService.init(client: APIClient)`
  - `func search(query: String, lat: Double?, lng: Double?, lang: String) async -> SearchOutcome`
  - 순수 함수 `orderedSections(places:addresses:web:) -> [SearchSection]`

**웹 계약과 동일해야 하는 의미론(웹 CLAUDE.md "검색창 3섹션 결정론 병렬" 절 정본):**
장소+주소는 항상 병렬, 웹은 둘 다 0건일 때만 폴백, 섹션 순서는 건수 내림차순, 명소(ko만)는 결과 있으면 건수 무관 최상단 별도 트랙, 개별 섹션 실패는 다른 섹션을 죽이지 않는다(빈 배열로 격리, 단 로그).

- [ ] **Step 1: 실패하는 테스트 작성** (`SearchServiceTests.swift`)

```swift
import Testing
import Foundation
@testable import GildongmuKit

@Test func orderedSectionsSortsByCountDesc() {
    let sections = orderedSections(
        places: [], 
        addresses: [JusoAddress(roadAddr: "r", roadAddrPart1: "r1", jibunAddr: "j", engAddr: "e", zipNo: "04524", bdNm: "")],
        web: []
    )
    #expect(sections.count == 1)  // 빈 섹션은 제외
    if case .addresses(let a) = sections[0] { #expect(a.count == 1) } else { Issue.record("주소 섹션이 최상단이어야 함") }
}

@Test func webFallbackOnlyWhenBothEmpty() async throws {
    // StubURLProtocol 재사용: places·address 빈 응답, web은 1건
    StubURLProtocol.handler = { request in
        switch request.url!.path() {
        case "/api/places", "/api/places/attractions":
            return (200, Data(#"{"places":[],"provider":"none","query":"q"}"#.utf8))
        case "/api/address/search":
            return (200, Data(#"{"addresses":[],"query":"q"}"#.utf8))
        case "/api/search/web":
            return (200, Data(#"{"web":[{"title":"t","url":"https://x","snippet":"s","date":null}]}"#.utf8))
        default: return (404, Data())
        }
    }
    let outcome = await SearchService(client: stubbedClient()).search(query: "q", lat: nil, lng: nil, lang: "ko")
    #expect(outcome.sections.count == 1)
    if case .web(let w) = outcome.sections[0] { #expect(w.count == 1) } else { Issue.record("웹 폴백 섹션이어야 함") }
}

@Test func attractionsRideSeparateTrack() async throws {
    StubURLProtocol.handler = { request in
        switch request.url!.path() {
        case "/api/places/attractions":
            return (200, Data(#"{"places":[{"id":"a1","name":"경복궁","category":"여행 > 관광,명소","address":"a","roadAddress":"r","lat":37.58,"lng":126.98}],"provider":"kakao-attractions","query":"q"}"#.utf8))
        case "/api/places":
            return (200, Data(#"{"places":[{"id":"p1","name":"경복궁역","category":"교통","address":"a","roadAddress":"r","lat":37.57,"lng":126.97}],"provider":"kakao-local","query":"q"}"#.utf8))
        case "/api/address/search":
            return (200, Data(#"{"addresses":[],"query":"q"}"#.utf8))
        default: return (404, Data())
        }
    }
    let outcome = await SearchService(client: stubbedClient()).search(query: "q", lat: nil, lng: nil, lang: "ko")
    #expect(outcome.attractions.count == 1)   // 명소는 별도 트랙(최상단 병치는 뷰 책임)
    #expect(outcome.sections.count == 1)      // 웹 폴백 미발동(장소 1건 존재)
}

@Test func sectionFailureIsIsolated() async throws {
    StubURLProtocol.handler = { request in
        switch request.url!.path() {
        case "/api/places":
            return (502, Data(#"{"error":"실패"}"#.utf8))
        case "/api/places/attractions":
            return (200, Data(#"{"places":[],"provider":"none","query":"q"}"#.utf8))
        case "/api/address/search":
            return (200, Data(#"{"addresses":[{"roadAddr":"세종대로 110","roadAddrPart1":"세종대로 110","jibunAddr":"태평로1가","engAddr":"110 Sejong-daero","zipNo":"04524","bdNm":""}],"query":"q"}"#.utf8))
        default: return (404, Data())
        }
    }
    let outcome = await SearchService(client: stubbedClient()).search(query: "q", lat: nil, lng: nil, lang: "ko")
    #expect(outcome.sections.count == 1)  // 주소는 살아 있음(장소 502에 안 죽음)
}
```

- [ ] **Step 2: 실패 확인**: Expected: FAIL (`SearchService` 미정의)

- [ ] **Step 3: 구현** (`SearchService.swift`)

```swift
import Foundation

/// 검색 결과 섹션 하나. 순서는 orderedSections가 정한다.
public enum SearchSection: Sendable {
    case places([Place])
    case addresses([JusoAddress])
    case web([WebSearchResult])

    public var count: Int {
        switch self {
        case .places(let v): v.count
        case .addresses(let v): v.count
        case .web(let v): v.count
        }
    }
}

/// 한 검색의 최종 산출. attractions는 별도 트랙(뷰가 건수 무관 최상단 병치).
public struct SearchOutcome: Sendable {
    public let attractions: [Place]
    public let sections: [SearchSection]
}

/// 빈 섹션 제외 + 건수 내림차순(웹 orderResultSections 미러, 안정 정렬).
public func orderedSections(places: [Place], addresses: [JusoAddress], web: [WebSearchResult]) -> [SearchSection] {
    let all: [SearchSection] = [.places(places), .addresses(addresses), .web(web)]
    return all.filter { $0.count > 0 }.sorted { $0.count > $1.count }
}

/// 검색 오케스트레이션. 웹 runQuerySearch의 의미론 미러:
/// 장소+주소(+ko 명소) 병렬, 웹은 둘 다 0건일 때만, 섹션 실패는 빈 배열로 격리.
public struct SearchService: Sendable {
    let client: APIClient
    public init(client: APIClient) { self.client = client }

    public func search(query: String, lat: Double?, lng: Double?, lang: String) async -> SearchOutcome {
        var coordQuery: [URLQueryItem] = [URLQueryItem(name: "query", value: query)]
        if let lat, let lng {
            coordQuery.append(URLQueryItem(name: "lat", value: String(lat)))
            coordQuery.append(URLQueryItem(name: "lng", value: String(lng)))
        }
        async let placesTask: PlaceSearchResult? = try? client.get("/api/places", query: coordQuery + [URLQueryItem(name: "lang", value: lang)])
        async let addressTask: AddressSearchResponse? = try? client.get("/api/address/search", query: [URLQueryItem(name: "query", value: query)])
        // 명소는 ko 전용(웹 계약). en은 장소 병합 검색이 커버.
        async let attractionsTask: PlaceSearchResult? = lang == "ko"
            ? (try? client.get("/api/places/attractions", query: coordQuery + [URLQueryItem(name: "lang", value: lang)]))
            : nil

        let places = (await placesTask)?.places ?? []
        let addresses = (await addressTask)?.addresses ?? []
        let attractions = (await attractionsTask)?.places ?? []

        var web: [WebSearchResult] = []
        if places.isEmpty && addresses.isEmpty {
            let webResponse: WebSearchResponse? = try? await client.get("/api/search/web", query: [URLQueryItem(name: "query", value: query)])
            web = webResponse?.web ?? []
        }
        return SearchOutcome(attractions: attractions, sections: orderedSections(places: places, addresses: addresses, web: web))
    }
}
```

주의: `try?` 격리는 M0 단순화다. M1에서 "전 섹션 실패 vs 빈 결과" 구분(3-state)을 위해 섹션별 상태 enum으로 확장한다(로드맵 M1 참조). 이 단순화는 테스트 `sectionFailureIsIsolated`가 문서화한다.

- [ ] **Step 4: 통과 확인 후 Commit**

Run: `swift test --package-path ios/GildongmuKit` Expected: PASS (전체)
```bash
git commit -m "feat(ios): SearchService 3섹션 병렬+웹 폴백+명소 트랙" -- ios/GildongmuKit
```

### Task 6: Xcode 앱 타깃 (objectVersion 77 최소 pbxproj)

**요구:** Task 0 완료(Xcode 26).

**Files:**
- Create: `ios/Gildongmu.xcodeproj/project.pbxproj`
- Create: `ios/Gildongmu/GildongmuApp.swift`

**Interfaces:**
- Consumes: GildongmuKit 라이브러리(로컬 패키지 참조 `../GildongmuKit` 상대경로 아님 주의: 프로젝트가 `ios/`에 있으므로 `GildongmuKit`)
- Produces: 앱 타깃 `Gildongmu`(Bundle ID `space.dodoplanet.gildongmu`), 스킴 `Gildongmu`

- [ ] **Step 1: pbxproj 작성.** objectVersion 77의 파일시스템 동기화 그룹을 쓴다: `ios/Gildongmu/` 폴더 내용이 자동으로 타깃 소스가 되어, **이후 파일 추가가 pbxproj를 건드리지 않는다**(spec §8.1 pbxproj 병렬 편집 지뢰의 구조적 회피).

`ios/Gildongmu.xcodeproj/project.pbxproj`:
```text
// !$*UTF8*$!
{
	archiveVersion = 1;
	classes = {
	};
	objectVersion = 77;
	objects = {

/* Begin PBXBuildFile section */
		AA0001 /* GildongmuKit in Frameworks */ = {isa = PBXBuildFile; productRef = AC0001 /* GildongmuKit */; };
/* End PBXBuildFile section */

/* Begin PBXFileReference section */
		AB0001 /* Gildongmu.app */ = {isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = Gildongmu.app; sourceTree = BUILT_PRODUCTS_DIR; };
/* End PBXFileReference section */

/* Begin PBXFileSystemSynchronizedRootGroup section */
		AD0001 /* Gildongmu */ = {isa = PBXFileSystemSynchronizedRootGroup; explicitFileTypes = {}; explicitFolders = (); path = Gildongmu; sourceTree = "<group>"; };
/* End PBXFileSystemSynchronizedRootGroup section */

/* Begin PBXFrameworksBuildPhase section */
		AE0001 /* Frameworks */ = {
			isa = PBXFrameworksBuildPhase;
			buildActionMask = 2147483647;
			files = (
				AA0001 /* GildongmuKit in Frameworks */,
			);
			runOnlyForDeploymentPostprocessing = 0;
		};
/* End PBXFrameworksBuildPhase section */

/* Begin PBXGroup section */
		AF0001 = {
			isa = PBXGroup;
			children = (
				AD0001 /* Gildongmu */,
				AF0002 /* Products */,
			);
			sourceTree = "<group>";
		};
		AF0002 /* Products */ = {
			isa = PBXGroup;
			children = (
				AB0001 /* Gildongmu.app */,
			);
			name = Products;
			sourceTree = "<group>";
		};
/* End PBXGroup section */

/* Begin PBXNativeTarget section */
		B00001 /* Gildongmu */ = {
			isa = PBXNativeTarget;
			buildConfigurationList = B40002 /* Build configuration list for PBXNativeTarget "Gildongmu" */;
			buildPhases = (
				B10001 /* Sources */,
				AE0001 /* Frameworks */,
				B20001 /* Resources */,
			);
			buildRules = (
			);
			dependencies = (
			);
			fileSystemSynchronizedGroups = (
				AD0001 /* Gildongmu */,
			);
			name = Gildongmu;
			packageProductDependencies = (
				AC0001 /* GildongmuKit */,
			);
			productName = Gildongmu;
			productReference = AB0001 /* Gildongmu.app */;
			productType = "com.apple.product-type.application";
		};
/* End PBXNativeTarget section */

/* Begin PBXProject section */
		B30001 /* Project object */ = {
			isa = PBXProject;
			attributes = {
				BuildIndependentTargetsInParallel = 1;
				LastUpgradeCheck = 2600;
			};
			buildConfigurationList = B40001 /* Build configuration list for PBXProject "Gildongmu" */;
			developmentRegion = ko;
			hasScannedForEncodings = 0;
			knownRegions = (
				ko,
				en,
				es,
				fr,
				it,
				Base,
			);
			mainGroup = AF0001;
			packageReferences = (
				B50001 /* XCLocalSwiftPackageReference "GildongmuKit" */,
			);
			preferredProjectObjectVersion = 77;
			productRefGroup = AF0002 /* Products */;
			projectDirPath = "";
			projectRoot = "";
			targets = (
				B00001 /* Gildongmu */,
			);
		};
/* End PBXProject section */

/* Begin PBXResourcesBuildPhase section */
		B20001 /* Resources */ = {
			isa = PBXResourcesBuildPhase;
			buildActionMask = 2147483647;
			files = (
			);
			runOnlyForDeploymentPostprocessing = 0;
		};
/* End PBXResourcesBuildPhase section */

/* Begin PBXSourcesBuildPhase section */
		B10001 /* Sources */ = {
			isa = PBXSourcesBuildPhase;
			buildActionMask = 2147483647;
			files = (
			);
			runOnlyForDeploymentPostprocessing = 0;
		};
/* End PBXSourcesBuildPhase section */

/* Begin XCBuildConfiguration section */
		B60001 /* Debug */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				CLANG_ANALYZER_NONNULL = YES;
				DEBUG_INFORMATION_FORMAT = dwarf;
				ENABLE_TESTABILITY = YES;
				GCC_OPTIMIZATION_LEVEL = 0;
				IPHONEOS_DEPLOYMENT_TARGET = 26.0;
				ONLY_ACTIVE_ARCH = YES;
				SDKROOT = iphoneos;
				SWIFT_ACTIVE_COMPILATION_CONDITIONS = "DEBUG $(inherited)";
				SWIFT_OPTIMIZATION_LEVEL = "-Onone";
				SWIFT_VERSION = 6.0;
			};
			name = Debug;
		};
		B60002 /* Release */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				DEBUG_INFORMATION_FORMAT = "dwarf-with-dsym";
				IPHONEOS_DEPLOYMENT_TARGET = 26.0;
				SDKROOT = iphoneos;
				SWIFT_COMPILATION_MODE = wholemodule;
				SWIFT_VERSION = 6.0;
				VALIDATE_PRODUCT = YES;
			};
			name = Release;
		};
		B60003 /* Debug */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				ASSETCATALOG_COMPILER_GENERATE_ASSET_SYMBOL_EXTENSIONS = YES;
				CODE_SIGN_STYLE = Automatic;
				CURRENT_PROJECT_VERSION = 1;
				ENABLE_PREVIEWS = YES;
				GENERATE_INFOPLIST_FILE = YES;
				INFOPLIST_KEY_UILaunchScreen_Generation = YES;
				INFOPLIST_KEY_UISupportedInterfaceOrientations = UIInterfaceOrientationPortrait;
				LD_RUNPATH_SEARCH_PATHS = "$(inherited) @executable_path/Frameworks";
				MARKETING_VERSION = 0.1.0;
				PRODUCT_BUNDLE_IDENTIFIER = space.dodoplanet.gildongmu;
				PRODUCT_NAME = "$(TARGET_NAME)";
				TARGETED_DEVICE_FAMILY = 1;
			};
			name = Debug;
		};
		B60004 /* Release */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				ASSETCATALOG_COMPILER_GENERATE_ASSET_SYMBOL_EXTENSIONS = YES;
				CODE_SIGN_STYLE = Automatic;
				CURRENT_PROJECT_VERSION = 1;
				ENABLE_PREVIEWS = YES;
				GENERATE_INFOPLIST_FILE = YES;
				INFOPLIST_KEY_UILaunchScreen_Generation = YES;
				INFOPLIST_KEY_UISupportedInterfaceOrientations = UIInterfaceOrientationPortrait;
				LD_RUNPATH_SEARCH_PATHS = "$(inherited) @executable_path/Frameworks";
				MARKETING_VERSION = 0.1.0;
				PRODUCT_BUNDLE_IDENTIFIER = space.dodoplanet.gildongmu;
				PRODUCT_NAME = "$(TARGET_NAME)";
				TARGETED_DEVICE_FAMILY = 1;
			};
			name = Release;
		};
/* End XCBuildConfiguration section */

/* Begin XCConfigurationList section */
		B40001 /* Build configuration list for PBXProject "Gildongmu" */ = {
			isa = XCConfigurationList;
			buildConfigurations = (
				B60001 /* Debug */,
				B60002 /* Release */,
			);
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = Release;
		};
		B40002 /* Build configuration list for PBXNativeTarget "Gildongmu" */ = {
			isa = XCConfigurationList;
			buildConfigurations = (
				B60003 /* Debug */,
				B60004 /* Release */,
			);
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = Release;
		};
/* End XCConfigurationList section */

/* Begin XCLocalSwiftPackageReference section */
		B50001 /* XCLocalSwiftPackageReference "GildongmuKit" */ = {
			isa = XCLocalSwiftPackageReference;
			relativePath = GildongmuKit;
		};
/* End XCLocalSwiftPackageReference section */

/* Begin XCSwiftPackageProductDependency section */
		AC0001 /* GildongmuKit */ = {
			isa = XCSwiftPackageProductDependency;
			productName = GildongmuKit;
		};
/* End XCSwiftPackageProductDependency section */
	};
	rootObject = B30001 /* Project object */;
}
```

- [ ] **Step 2: 앱 진입점** (`ios/Gildongmu/GildongmuApp.swift`)

```swift
import SwiftUI

@main
struct GildongmuApp: App {
    var body: some Scene {
        WindowGroup {
            SearchView()
        }
    }
}
```

(SearchView는 Task 7에서 작성. 이 시점 빌드 확인은 Task 7 후에 한다.)

- [ ] **Step 3: 프로젝트 인식 검증**

Run: `cd ios && xcodebuild -list -project Gildongmu.xcodeproj`
Expected: Targets에 `Gildongmu`, Schemes에 `Gildongmu`(스킴은 Xcode가 자동 생성).

**폴백:** xcodebuild가 pbxproj를 거부하면 Xcode GUI로 신규 iOS App 프로젝트를 `ios/`에 같은 이름·Bundle ID로 생성(File > New > Project > iOS App, SwiftUI, 언어 Swift)하고 File > Add Package Dependencies > Add Local로 `GildongmuKit` 추가. GUI 생성이어도 이후 태스크는 동일.

- [ ] **Step 4: Commit**

```bash
git add ios/Gildongmu.xcodeproj ios/Gildongmu && git commit -m "feat(ios): Xcode 앱 타깃(objectVersion 77, 폴더 동기화) + GildongmuKit 연결" -- ios/Gildongmu.xcodeproj ios/Gildongmu
```

### Task 7: SearchModel + SearchView (M0 유일 화면)

**Files:**
- Create: `ios/Gildongmu/SearchModel.swift`, `ios/Gildongmu/SearchView.swift`

**Interfaces:**
- Consumes: `SearchService.search(query:lat:lng:lang:)`, `SearchOutcome`, `SearchSection`
- Produces: `SearchView()` (GildongmuApp이 사용)

**iOS 문법 재설계 원칙(spec §4):** `.searchable`(시스템 표준 검색 필드: VoiceOver·받아쓰기·클리어 버튼 무료), 결과는 `List` Section, 행은 `.accessibilityElement(children: .combine)`, 완료 통지는 `AccessibilityNotification.Announcement` 1회. M0은 위치 미사용(좌표 nil, M2에서 LocationService 연결).

- [ ] **Step 1: SearchModel** (`SearchModel.swift`)

```swift
import Foundation
import Observation
import GildongmuKit

/// 검색 화면 상태. 요청 세대 관리는 Task 취소로(웹 request-id ref의 iOS 문법).
@Observable
@MainActor
final class SearchModel {
    var query = ""
    private(set) var outcome: SearchOutcome?
    private(set) var isSearching = false
    private(set) var failed = false
    private var searchTask: Task<Void, Never>?

    private let service = SearchService(
        client: APIClient(baseURL: URL(string: "https://gildongmu.vercel.app")!)
    )

    func submit() {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        searchTask?.cancel()   // 진행 중 검색 폐기: stale 응답 차단
        isSearching = true
        failed = false
        searchTask = Task {
            let result = await service.search(query: trimmed, lat: nil, lng: nil, lang: "ko")
            guard !Task.isCancelled else { return }
            outcome = result
            isSearching = false
            announce(result)
        }
    }

    /// 단일 통지 채널(웹 combinedLiveMessage의 iOS 문법).
    private func announce(_ result: SearchOutcome) {
        let total = result.attractions.count + result.sections.reduce(0) { $0 + $1.count }
        let message = total == 0 ? "검색 결과가 없습니다" : "검색 결과 \(total)건"
        AccessibilityNotification.Announcement(message).post()
    }
}
```

- [ ] **Step 2: SearchView** (`SearchView.swift`)

```swift
import SwiftUI
import GildongmuKit

struct SearchView: View {
    @State private var model = SearchModel()

    var body: some View {
        NavigationStack {
            List {
                if let outcome = model.outcome {
                    if !outcome.attractions.isEmpty {
                        Section("명소") {
                            ForEach(outcome.attractions) { PlaceRow(place: $0) }
                        }
                    }
                    ForEach(Array(outcome.sections.enumerated()), id: \.offset) { _, section in
                        sectionView(section)
                    }
                }
            }
            .navigationTitle("길동무")
            .searchable(text: $model.query, prompt: "장소, 주소 검색")
            .onSubmit(of: .search) { model.submit() }
            .overlay {
                if model.isSearching { ProgressView("검색 중") }
            }
        }
    }

    @ViewBuilder
    private func sectionView(_ section: SearchSection) -> some View {
        switch section {
        case .places(let places):
            Section("장소") { ForEach(places) { PlaceRow(place: $0) } }
        case .addresses(let addresses):
            Section("주소") {
                ForEach(addresses, id: \.roadAddr) { address in
                    // 한 줄=한 객체: 도로명+우편번호를 단일 텍스트로(웹 joinText 동형)
                    Text("\(address.roadAddr), \(address.zipNo)")
                }
            }
        case .web(let results):
            Section("웹 검색") {
                ForEach(results, id: \.url) { result in
                    Link(destination: URL(string: result.url)!) {
                        VStack(alignment: .leading) {
                            Text(result.title)
                            Text(result.snippet)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            }
        }
    }
}

/// 장소 행. 이름·카테고리를 하나의 접근성 객체로 합친다. 상세 진입은 M1.
struct PlaceRow: View {
    let place: Place

    var body: some View {
        VStack(alignment: .leading) {
            Text(place.name)
            Text(joined)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }

    /// falsy 조각 제거+쉼표 결합(웹 joinText 미러).
    private var joined: String {
        [place.category, place.roadAddress.isEmpty ? place.address : place.roadAddress]
            .filter { !$0.isEmpty }
            .joined(separator: ", ")
    }
}
```

- [ ] **Step 3: 빌드 확인**

Run: `cd ios && xcodebuild -project Gildongmu.xcodeproj -scheme Gildongmu -destination 'generic/platform=iOS' build CODE_SIGNING_ALLOWED=NO`
Expected: BUILD SUCCEEDED

- [ ] **Step 4: Commit**

```bash
git add ios/Gildongmu && git commit -m "feat(ios): 검색 화면(searchable+3섹션+명소, 한 줄=한 객체)" -- ios/Gildongmu
```

### Task 8: 실기기 설치 + M0 게이트

**Files:** 없음(검증)

- [ ] **Step 1: 서명·설치.** Xcode에서 프로젝트 열기 > Signing & Capabilities > Team에 Personal Team 선택 > iPhone 연결(케이블 또는 Wi-Fi) > Run. 첫 실행 시 iPhone에서 Settings > General > VPN & Device Management > 개발자 앱 신뢰.

- [ ] **Step 2: M0 VoiceOver 게이트(실기기, 전부 통과해야 M0 완료)**

1. 앱 실행, 검색 필드 도달, "강남역" 입력·실행
2. "검색 결과 N건" 자동 통지 낭독
3. 명소·장소·주소 섹션 헤더가 로터 헤딩 탐색으로 점프 가능
4. 장소 행이 이름+카테고리+주소를 **한 번에**(스와이프 1회) 낭독
5. "존재하지않는쿼리12345"로 웹 폴백 섹션 또는 "결과 없음" 통지 확인
6. 비행기 모드에서 검색: 앱이 죽지 않고 결과 없음 상태

- [ ] **Step 3: 실호출 게이트**: prod API 실데이터가 화면에 렌더됨을 확인(fixture green ≠ 완료).

- [ ] **Step 4: PROGRESS.md 갱신 + Commit**

PROGRESS.md 상단에 M0 완료 항목 추가(날짜·게이트 결과·다음 단계 M1).
```bash
git commit -m "docs: M0 완료 기록(실기기 VoiceOver 게이트 통과)" -- PROGRESS.md
```

---

## M1~M8 로드맵 (각 마일스톤 경계에서 상세 plan 신규 작성)

spec §7이 정본. 여기엔 각 마일스톤의 착수 조건·핵심 태스크 묶음·게이트만 적는다. 상세 plan(파일 단위·코드 포함)은 직전 마일스톤 완료 후 그 시점 코드베이스 기준으로 새로 쓴다(선작성하면 스테일해져 오히려 해악).

| 마일스톤 | 착수 조건 | 핵심 태스크 묶음 | 게이트 |
|---|---|---|---|
| M1 장소 상세 | M0 게이트 통과 | PlaceDetail 화면(NavigationStack push), 한영 주소, `tel:` 발신, 네이버·카카오 딥링크(`LSApplicationQueriesSchemes`)+HTTPS 폴백, 커스텀 액션 1차(행에 길찾기·전화 로터), SearchService 3-state 확장(`try?` 단순화 해소) | 검색→상세→복귀 포커스 보존, 딥링크 handoff 실기기 |
| M2 위치+내 주변 | M1 완료 | LocationService(When In Use, 최초 사용 시점 요청, 공유 싱글턴), 내 주변 6종 화면(지하철·버스·따릉이·소아진료·아이놀곳·둘러보기), 거리 표기 | 권한 허용·거부·재시도 3경로, 새로고침 정밀 재취득 |
| M3 역·환경 | M2 완료 | 역 메타·실시간 도착(`arvlMsg2` 완성 문장 정본)·교통약자 시설, 날씨·공기질(자동 등장 섹션: 헤딩 로터 발견 경로) | 도착 문장 낭독 정본, 3-state(0건·unknown·실패) 분리 |
| M4 경로 브리핑 | M2 완료(M3와 병행 가능) | 자동차(ko 카카오·en NCP)·대중교통(ODsay) 텍스트 브리핑 화면, 출발지=실위치 불변식 | 단위 함정(ms·분) 회귀 테스트, 브리핑 낭독 흐름 |
| M5 채팅 | M1 완료 | NDJSON 스트림 파서(Kit)+`URLSession.bytes`, 채팅 sheet, `AttributedString(markdown:)` 검증(부족 시 의존성 예외 논의), 카드·출처, 장소 앵커 불변식 | 진행 통지·완료 포커스·이중 낭독 0 |
| M6 음성 입력 | M5 완료 | SpeechAnalyzer 통합, 효과음+햅틱(CoreHaptics) 통지, 한국어 품질 실측, 미달 언어 `/api/speech-to-text` 폴백 | 녹음 시작·정지·취소 VoiceOver 흐름, 품질 판정 기록 |
| M7 거리 비콘 | M2 완료 | 백그라운드 위치+오디오 세션 spike 선행, 공간 오디오·햅틱 비콘, 명시적 중지 | 화면 잠금 동작, 배터리 실측, 중지 보장 |
| M8 마감 | M1~M7 전부 | String Catalog 5개 언어, 설정 화면, 아이콘·런치 스크린, 통합 VoiceOver QA(2026-06-21 spec §8.1의 14개 시나리오) | 전 시나리오 실기기 통과 = 전체 동등성 선언 |

**실행 방식(spec §8):** M0은 단일 세션. M1~M4는 Agent Teams 후보(팀원별 파일 비겹침, pbxproj는 폴더 동기화 그룹이라 파일 추가에도 무변경). M5~M7 단일 세션+서브에이전트. 리뷰는 마일스톤 직전 codex-rescue, 커밋 직전 coderabbit, 매 마일스톤 실기기 VoiceOver.

## Self-Review 결과

- **Spec coverage:** spec §2(결정 표)·§3(구조)·§6(계약) 전부 M0 태스크에 매핑됨. §4·§5의 상세·나머지 기능·§7 후속 마일스톤은 로드맵 표가 커버(마일스톤 경계 상세 plan 원칙 명시).
- **Placeholder scan:** TBD·TODO 없음. Task 5의 `try?` 단순화는 placeholder가 아니라 테스트로 문서화된 의도적 M0 범위이며 M1 확장 항목으로 예약.
- **Type consistency:** `SearchOutcome`·`SearchSection`·`orderedSections`·`APIClient.get` 시그니처가 Task 5·7에서 동일. fixture 파일명(`places`·`address`·`web`·`attractions`)이 Task 2·3에서 일치.
