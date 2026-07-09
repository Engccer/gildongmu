# 길동무 iOS M6b 구현 계획: 웹 동등성 누락분 7건

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 로드맵(M0~M8)에서 빠진 웹 기능 7건을 iOS에 이식해 "전체 기능 동등성" 완료 조건의 구멍을 막는다: ①무장애 관광지 내 주변 ②장소 상세 무장애 편의시설 ③현재 위치 정위(WhereAmI) ④버스 노선 경유 정류소 ⑤nearby 항목 채팅 진입 ⑥주소 복사 ⑦검색 칩 필터+카테고리 그룹핑+거리 정렬.

**Architecture:** M0~M6 패턴 연장. Kit(모델·서비스·순수 로직)+앱(화면) 분리, 웹 `/api/*` 계약 미러, fixture는 2026-07-10 실캡처 정본. M7(비콘)·M8(다국어·설정)은 이 plan 범위 밖(로드맵 유지).

**배경(격차 판정 근거):** M2가 "내 주변 6종"으로 계획됐지만 웹은 무장애 포함 7종. WhereAmI·BusRouteStops·복사 버튼·nearby 채팅 진입·칩 필터는 어느 마일스톤 범위에도 없었다. 채팅 self-fetch 렌더 카드류(V1 축소)·지도·PWA·인앱 언어 메뉴는 **의도적 제외**(PROGRESS 정본 결정)라 이 plan에 없다.

## Global Constraints (M0~M6 유지)

- 새 `.swift`·fixture는 폴더에 넣기만(파일시스템 동기화 그룹, pbxproj 편집 금지·불필요).
- 접근성: 한 줄=한 객체(`joinText`), 자동 등장 섹션 헤더 `.accessibilityAddTraits(.isHeader)`, 버튼으로 펼친 것엔 heading 잉여, 단일 Announcement 채널, `disabled` 금지(재진입은 in-flight 가드), 3-state(실패=throw ≠ 빈 결과 ≠ 정보 없음) 불뭉갬.
- 모델: `Codable & Sendable`(+`Identifiable`·`Hashable` 필요 시), status류는 String(enum 금지), envelope `XxxResponse` struct.
- UI 카피는 한국어 하드코딩(M8에서 String Catalog로 승격). **문구는 웹 `messages/ko.json` 해당 키를 읽어 그대로 미러**(새 문구 발명 금지).
- 상태 화면: `NearbyLoadState`+`ContentUnavailableView` 기존 공용 재사용(재정의 금지).
- 커밋: 의도 파일 pathspec만, 이메일 `engccer@gmail.com`.
- 웹 소스가 계약 정본: 각 태스크에 명시된 웹 파일을 **먼저 읽고** 미러한다(추측 금지).

## API 계약 (fixture 5종 커밋: Tests/GildongmuKitTests/Fixtures/)

캡처: 2026-07-10 로컬 dev(키 동일)+prod 혼합 실캡처. 스크래치 위치 `/private/tmp/claude-502/-Users-hunyongkim-Mac-Projects-gildongmu/07371597-3e6c-42f8-a0c4-8c30d863d5a3/scratchpad/`.

| 라우트 | 파라미터 | envelope | fixture |
|---|---|---|---|
| `/api/places/barrier-free` | `?lat=&lng=` | `{places: BarrierFreePlace[]}` — `{contentId,name,category(""),address,lat,lng,distanceMeters:Int}` | barrier-free-nearby.json |
| `/api/places/barrier-free/detail` | `?contentId=` | `{detail: BarrierFreeDetail?}` — `{contentId,name,facilities:[{key,label,value}]}` | barrier-free-detail.json |
| `/api/places/barrier-free/match` | `?lat=&lng=&name=` | `{detail: BarrierFreeDetail?}` — **절대 throw 안 함**(에러도 null) | barrier-free-match.json |
| `/api/where-am-i` | `?lat=&lng=` | `{data: WhereAmI?}` — `{address:{road?,jibun?}?, region:String?, nearestStation:{name,line?,bearing,distanceMeters}?, landmarks:[SurroundingPlace]}` | where-am-i.json |
| `/api/bus/route` | `?source=&routeId=[&cityCode]` (tago만 cityCode 필수) | `{stops: [{nodeId,name,order,lat,lng}]}` | bus-route-stops.json |

---

### Task 1 (Kit): BarrierFree 모델+서비스+테스트

**Files:**
- Create: `ios/GildongmuKit/Sources/GildongmuKit/Models/BarrierFreeModels.swift`, `ios/GildongmuKit/Sources/GildongmuKit/BarrierFreeService.swift`
- Copy fixture: 스크래치 → `Fixtures/barrier-free-nearby.json`·`barrier-free-detail.json`·`barrier-free-match.json`
- Test: `Tests/GildongmuKitTests/BarrierFreeModelsTests.swift`

**Interfaces (Produces):**
```swift
public struct BarrierFreePlace: Codable, Sendable, Identifiable, Hashable {
    public var id: String { contentId }
    public let contentId: String, name: String, category: String, address: String
    public let lat: Double, lng: Double, distanceMeters: Int
}
public struct BarrierFreeFacility: Codable, Sendable, Hashable { public let key: String, label: String, value: String }
public struct BarrierFreeDetail: Codable, Sendable, Hashable { public let contentId: String, name: String, facilities: [BarrierFreeFacility] }
public struct BarrierFreeService: Sendable {
    public init(client: APIClient)
    public func nearby(lat: Double, lng: Double) async throws -> [BarrierFreePlace]
    public func detail(contentId: String) async throws -> BarrierFreeDetail?   // {detail:null}이면 nil
    public func match(lat: Double, lng: Double, name: String) async -> BarrierFreeDetail?  // 비-throw: 모든 실패를 nil로(웹 match 계약)
}
```

- [ ] 웹 정본 확인: `src/lib/types.ts`의 BarrierFreePlace·BarrierFreeDetail, `src/app/api/places/barrier-free/{route,detail/route,match/route}.ts`.
- [ ] fixture 3종 복사 → 디코딩 테스트(nearby 배열·detail 시설 라벨/값 비어있지 않음·match도 동일 envelope) + `{"detail":null}` 인라인 JSON nil 테스트 + `match`가 네트워크 오류에서 nil 반환하는 테스트(존재하지 않는 baseURL 주입).
- [ ] `swift test` 통과 후 커밋 `feat(ios): 무장애 관광 계약 모델+서비스(match 비-throw)`.

### Task 2 (Kit): WhereAmI 모델+ko 산문 빌더+서비스+테스트

**Files:**
- Create: `Models/WhereAmIModels.swift`, `WhereAmIService.swift`, `LocationNarrative.swift`
- Copy fixture: `Fixtures/where-am-i.json`
- Test: `Tests/GildongmuKitTests/WhereAmIModelsTests.swift`

**Interfaces (Produces):**
```swift
public struct WhereAmIAddress: Codable, Sendable, Hashable { public let road: String?, jibun: String? }
public struct WhereAmIStation: Codable, Sendable, Hashable { public let name: String, line: String?, bearing: String, distanceMeters: Int }
public struct WhereAmIData: Codable, Sendable {
    public let address: WhereAmIAddress?, region: String?
    public let nearestStation: WhereAmIStation?, landmarks: [SurroundingPlace]  // SurroundingPlace는 NearbyModels 기존 타입
}
public struct WhereAmIService: Sendable {
    public init(client: APIClient)
    public func locate(lat: Double, lng: Double) async throws -> WhereAmIData?  // {data:null}=nil(키 없음), 502=throw
}
public func buildLocationNarrativeKo(_ data: WhereAmIData) -> [String]  // 문단 배열(빈 조각 생략)
```

- [ ] 웹 정본 확인: `src/lib/where-am-i.ts`의 `buildLocationNarrative`·`stripRegionPrefix`, `messages/ko.json`의 `whereAmI.narrative.*`·`direction.*`·`category.*` 문구. iOS는 t.rich 태그 없이 같은 ko 문장을 평문 조립(방위 ko 라벨: n=북쪽 등 8방위, 랜드마크 cap 6, stripRegionPrefix 동작 포함).
- [ ] fixture 디코딩 + narrative 테스트: fixture 데이터로 문단 산출(주소·역·랜드마크 포함), 조각 결손 케이스(address nil이면 해당 문장 생략), stripRegionPrefix 중복 제거 확인.
- [ ] `swift test` 통과 후 커밋 `feat(ios): 현재 위치 정위 계약 모델+ko 산문 빌더`.

### Task 3 (Kit): 버스 노선 경유 정류소 모델+서비스

**Files:**
- Modify: `Models/NearbyModels.swift`(BusRouteStop 추가), `NearbyService.swift`(메서드 추가)
- Copy fixture: `Fixtures/bus-route-stops.json`
- Test: `Tests/GildongmuKitTests/NearbyModelsTests.swift`에 추가

**Interfaces (Produces):**
```swift
public struct BusRouteStop: Codable, Sendable, Hashable { public let nodeId: String, name: String, order: Int, lat: Double, lng: Double }
// NearbyService에 추가:
public func busRouteStops(source: String, cityCode: String?, routeId: String) async throws -> [BusRouteStop]
// query: source·routeId 항상, cityCode는 source=="tago"일 때만 포함(웹 BusRouteStops.tsx 미러)
```

- [ ] 웹 정본 확인: `src/app/api/bus/route/route.ts`(zod: tago는 cityCode 필수), `src/components/BusRouteStops.tsx`.
- [ ] fixture 디코딩 테스트(order 오름차순 확인 포함). `swift test` 후 커밋 `feat(ios): 버스 노선 경유 정류소 계약`.

### Task 4 (Kit): Place 합성 헬퍼 4종

**Files:**
- Create: `PlaceProjection.swift`
- Test: `Tests/GildongmuKitTests/PlaceProjectionTests.swift`

**Interfaces (Produces):**
```swift
public func nightClinicToPlace(_ c: NightClinic) -> Place
public func kidsPlaceToPlace(_ k: KidsPlace) -> Place
public func surroundingPlaceToPlace(_ p: SurroundingPlace) -> Place
public func whereAmIToPlace(_ data: WhereAmIData, lat: Double, lng: Double) -> Place
```

- [ ] 웹 정본을 **필드 단위로 미러**: `src/lib/nearby-place.ts`·`src/lib/where-am-i-place.ts`(id 합성 규칙·category 소스: clinic=kind, kids=category, surrounding=categoryRaw, whereAmI=**빈 문자열**(역 오분류 방지) — category는 채팅 프롬프트 라우팅 키다). Kit 실제 모델 필드명이 웹과 다르면 iOS 모델 쪽 이름을 따르되 값 매핑은 웹과 동일하게.
- [ ] 테스트: 4종 각각 category·좌표·이름 매핑, whereAmI category=="" 고정.
- [ ] `swift test` 후 커밋 `feat(ios): nearby→Place 합성 헬퍼(채팅 진입용)`.

### Task 5 (Kit): 검색 버킷·지역 필터+거리 정렬 순수 로직

**Files:**
- Create: `SearchFilters.swift`
- Test: `Tests/GildongmuKitTests/SearchFiltersTests.swift`

**Interfaces (Produces):**
```swift
public func bucketsPresent(_ places: [Place]) -> [String]          // 등장 버킷 키, 웹 순서 미러
public func filterPlaces(_ places: [Place], bucket: String?) -> [Place]
public func regionsPresent(_ places: [Place]) -> [String]
public func filterPlaces(_ places: [Place], region: String?) -> [Place]
public func bucketLabelKo(_ key: String) -> String                  // ko.json category.* 미러
public func regionLabelKo(_ key: String) -> String                  // ko.json region.* 미러
public func groupPlacesByBucket(_ places: [Place]) -> [(bucket: String, places: [Place])]
public func sortPlacesByDistance(_ places: [Place], lat: Double, lng: Double) -> [Place]  // Haversine, distanceMeters 부여
```

- [ ] 웹 정본 확인: `src/lib/category.ts`(버킷 판정 규칙·순서)·`src/lib/region.ts`(지역 축)·`src/components/PlaceSearch.tsx:575-660`(두 축 AND, 칩 목록·카운트는 전체 결과 고정, 축 항목 ≤1이면 그 축 숨김)·거리 정렬(`sortPlacesByDistance` 위치도 category/region 인근 lib에서 확인). 판정 규칙(category_name 매칭 등)을 케이스 단위로 미러.
- [ ] 테스트: 버킷 판정 대표 케이스(웹 테스트 `src/lib/__tests__` 있으면 기대값 재사용), AND 결합, 거리 정렬·distanceMeters 부여.
- [ ] `swift test` 후 커밋 `feat(ios): 검색 버킷·지역 필터+거리 정렬 로직`.

### Task 6 (앱): 무장애 관광지 내 주변 화면+허브

**Files:**
- Create: `ios/Gildongmu/Nearby/BarrierFreeNearbyView.swift`
- Modify: `ios/Gildongmu/NearbyHubView.swift`("소아 야간진료" 다음에 "무장애 관광지" 삽입 — 웹 순서 미러)

**Interfaces (Consumes):** Task 1의 `BarrierFreeService`.

- [ ] `SubwayNearbyView` 복제 패턴: `@Observable @MainActor` 모델+`NearbyLoadState<BarrierFreePlace>`+in-flight 가드+`announceLoaded(count:unit:"곳")`+`.refreshable`.
- [ ] 항목 행: `joinText(place.name, place.address, "\(place.distanceMeters)m")` 헤더 `.isHeader`(웹 h4 동형 — 정적 리스트 항목 점프 경로) + 행 아래 `DisclosureGroup("무장애 편의시설 보기")` 펼침 시 lazy `detail(contentId:)`(캐시 dict, in-flight Set) → 시설 행 평문 `Text("\(label) \(value)")`. 3-state: 로딩 "불러오는 중" / nil·빈 "등록된 편의시설 정보가 없습니다"(ko.json `barrierFreeNearby.facilitiesEmpty` 미러) / throw "편의시설 조회에 실패했습니다". 펼침은 버튼이 발견 경로라 heading 불부여.
- [ ] 출처 행: ko.json `barrierFreeNearby.source` 미러.
- [ ] 빌드 확인 후 커밋 `feat(ios): 무장애 관광지 내 주변(편의시설 펼침)`.

### Task 7 (앱): 장소 상세 — 무장애 편의시설 자동 섹션+주소 복사

**Files:**
- Create: `ios/Gildongmu/BarrierFreeInfoSection.swift`
- Modify: `ios/Gildongmu/PlaceDetailView.swift`

**Interfaces (Consumes):** Task 1의 `BarrierFreeService.match`(비-throw).

- [ ] 자동 섹션: `@Observable` 모델이 `.task`에서 `match(lat:lng:name:)` — nil·시설 0건이면 **무음 미노출**(false positive 차단이 설계, 웹 미러), 있으면 Section 헤더 "무장애 편의시설" `.isHeader`(자동 등장 발견 경로) + 시설 행 평문 + 출처 행. place 변경 대응은 뷰 정체성(id)으로 자연 해소.
- [ ] 주소 복사: 웹 `src/components/PlaceDetail.tsx:81-99`를 먼저 읽고 복사 대상 필드 우선순위를 그대로 미러. 주소 행들 다음에 `Button("주소 복사")` — `UIPasteboard.general.string` 설정 후 `AccessibilityNotification.Announcement("주소가 클립보드에 복사됨")`(ko.json `place.addressCopied`). 버튼은 별도 객체(주소 텍스트와 합치지 않음 — 인터랙티브 분리 원칙).
- [ ] 빌드 확인 후 커밋 `feat(ios): 상세 무장애 편의시설 자동 섹션+주소 복사`.

### Task 8 (앱): 현재 위치 정위 화면+채팅 진입

**Files:**
- Create: `ios/Gildongmu/Nearby/WhereAmIView.swift`
- Modify: `ios/Gildongmu/NearbyHubView.swift`(최상단 "현재 위치 확인" — 웹 idle 홈 최상단 미러)

**Interfaces (Consumes):** Task 2 `WhereAmIService`·`buildLocationNarrativeKo`, Task 4 `whereAmIToPlace`.

- [ ] nearby 패턴 미러(모델+LocationService+in-flight+`.refreshable`(정밀 재취득)). loaded 시 산문 문단들을 각각 `Text`(문단=한 객체, 인라인 분절 금지) + 기준 시각 행(ko.json `whereAmI.asOf` 미러) + 완료 통지 "현재 위치를 확인했습니다" 1회.
- [ ] nil(키 없음)=화면 진입 자체는 허용하되 "위치 정보를 가져오지 못했습니다"(3-state: throw와 동일 문구 금지 — 웹 empty/error 문구를 ko.json에서 미러).
- [ ] 채팅 진입: 산문 아래 `Button("내 현재 위치에 관해 물어보기")` → `.sheet(item:)`으로 `ChatView(place: whereAmIToPlace(data, lat:, lng:))`.
- [ ] 빌드 확인 후 커밋 `feat(ios): 현재 위치 정위 화면(산문+채팅 진입)`.

### Task 9 (앱): 버스 도착 행 → 경유 정류소 push

**Files:**
- Create: `ios/Gildongmu/Nearby/BusRouteStopsView.swift`
- Modify: `ios/Gildongmu/Nearby/BusNearbyView.swift`

**Interfaces (Consumes):** Task 3 `busRouteStops(source:cityCode:routeId:)`.

- [ ] 도착 행을 `NavigationLink`로 승격(라벨은 기존 joinText 문장 그대로, `.accessibilityHint("경유 정류소 보기")`). 목적지 `BusRouteStopsView(source: stop.source, cityCode: stop.source == "tago" ? stop.cityCode : nil, routeId: arrival.routeId, routeNo: arrival.routeNo)`.
- [ ] BusRouteStopsView: 제목 "\(routeNo)번 경유 정류소"(ko.json `bus.routeStopsHeading` 미러), 로딩/빈/실패 3-state(`bus.routeStops{Loading,Empty,Error}` 미러), 행 `Text("\(stop.order), \(stop.name)")` 순번 포함 단일 텍스트.
- [ ] BusStop·BusArrival에 routeId가 앱 계층까지 흐르는지 확인(모델엔 이미 존재), 빌드 후 커밋 `feat(ios): 버스 노선 경유 정류소 화면`.

### Task 10 (앱): nearby 3종 채팅 진입(진료·키즈·둘러보기)

**Files:**
- Modify: `ios/Gildongmu/Nearby/ClinicNearbyView.swift`, `KidsNearbyView.swift`, `AroundNearbyView.swift`

**Interfaces (Consumes):** Task 4 합성 헬퍼 3종, 기존 `ChatView(place:)`.

- [ ] 각 뷰에 `@State private var chatPlace: Place?` + `.sheet(item: $chatPlace) { ChatView(place: $0) }`.
- [ ] 각 항목 행에 **`contextMenu`(시각 경로) + `accessibilityAction`(로터 경로) 동일 라벨** "\(이름)에 관해 물어보기"(ko.json `placeChat.launchFor` 미러) → `chatPlace = xxxToPlace(item)`. 기존 행 시맨틱(한 줄=한 객체) 불변.
- [ ] 웹 대조: 채팅 진입은 이 3종+WhereAmI+장소상세가 전부(무장애·버스·따릉이·지하철엔 없음 — 추가 금지).
- [ ] 빌드 확인 후 커밋 `feat(ios): 내 주변 항목 채팅 진입(컨텍스트 메뉴+로터)`.

### Task 11 (앱): 검색 칩 필터+그룹핑+거리 정렬

**Files:**
- Modify: `ios/Gildongmu/SearchView.swift`, `ios/Gildongmu/SearchModel.swift`

**Interfaces (Consumes):** Task 5 전부.

- [ ] SearchModel: 결과 도착 시 `LocationService.shared`의 **보유 좌표가 있으면**(신규 권한 요청 금지 — 웹 userCoords 미러) `sortPlacesByDistance` 적용. `@State bucket: String?`·`region: String?` 두 축.
- [ ] 장소 섹션: 두 `Picker`(.menu 스타일) "분류"·"지역" — 항목: "전체"+`bucketsPresent`/`regionsPresent`(각 라벨+건수 "카페 (3)", 카운트는 전체 결과 고정 — 웹 미러). 축 항목 ≤1이면 그 Picker 숨김. AND 결합 결과가 0이면 "조건에 맞는 결과가 없습니다"(ko.json `search.noFilterResults` 미러).
- [ ] 필터 적용 목록을 `groupPlacesByBucket`으로 버킷 Section 분할(헤더=버킷 ko 라벨). 명소 섹션·주소·웹 섹션은 불변. 행 정체성·포커스 이동(첫 행 focusedRowID) 로직이 필터와 충돌하지 않는지 확인(필터 변경은 포커스 이동 트리거 아님 — 결과 도착만 트리거).
- [ ] PlaceRow에 distanceMeters 있으면 웹 `formatDistance`(`src/lib/format.ts`: 1,000m 미만 "\(Int(m))m", 이상 소수 1자리 "x.ykm") + ko.json `place.distance`("약 {distance}") 접두를 미러한 조각 추가. 그룹 Section 헤더는 건수 포함, Picker 축 라벨·전체 문구는 `category.*`/`region.*` ko.json 미러. (리뷰 fix로 정정: 최초 안의 "\(Int(m))m" 고정 리터럴은 웹 표기와 어긋난 plan 결함이었음)
- [ ] 빌드 확인 후 커밋 `feat(ios): 검색 분류·지역 필터+카테고리 그룹핑+거리 정렬`.

### Task 12 (통합, 오케스트레이터): 게이트·문서·push

- [ ] `swift test`(Kit 전체)·`xcodebuild build`(시뮬레이터 대상) 통과.
- [ ] code-reviewer 서브에이전트 리뷰 → fix 반영.
- [ ] PROGRESS.md 갱신: M6b 코드 완료, 격차 판정 근거(웹 7종 대조), 의도적 제외 재확인, prod 실시간 3종 upstream 장애 진단 기록(서울시 ConnectTimeout·TAGO 세션 고갈, 키·코드 무관), 실기기 게이트 대기 목록에 M6b 추가.
- [ ] pathspec 커밋·push(자동배포는 웹 파일 무변경이라 무영향).

## Self-Review

- 격차 7건 ↔ Task 매핑: ①=1+6, ②=1+7, ③=2+8, ④=3+9, ⑤=4+10, ⑥=7, ⑦=5+11. 전부 커버.
- 타입 일관성: BarrierFreeService·WhereAmIService·busRouteStops·합성 4종·SearchFilters 시그니처가 소비 태스크(6~11)와 일치.
- 실기기 VoiceOver 게이트(항목 heading·펼침·로터 액션·산문 낭독)는 사용자 몫 — M4·M5·M6 게이트 대기와 함께 일괄.
