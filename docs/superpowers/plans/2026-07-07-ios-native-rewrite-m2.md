# 길동무 iOS M2 구현 계획: 위치 서비스 + 내 주변 6종

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When In Use 위치 서비스(공유 싱글턴)와 내 주변 6종 화면(지하철 도착·버스 도착·따릉이·소아 야간진료·아이 놀 곳·둘러보기)을 탭 구조로 제공한다.

**Architecture:** 모든 라우트가 `?lat=&lng=` 균일 계약. Kit에 도메인 모델+NearbyService(6 메서드), 앱에 LocationService 싱글턴(웹 geolocation 모듈 싱글턴의 iOS 판)과 TabView(검색·내 주변). 화면 5개는 지하철 예시 화면을 규범 패턴으로 미러링한다(파일 단위 분리로 병렬 구현 안전, pbxproj는 폴더 동기화라 무변경).

**Tech Stack:** M0·M1과 동일. 신규 의존성 0. CoreLocation(시스템).

## Global Constraints (M0·M1 plan 유지 + 추가)

- 위치 권한: When In Use만, **"내 주변" 기능 최초 사용 시점에 요청**(앱 시작 즉시 금지). `INFOPLIST_KEY_NSLocationWhenInUseUsageDescription` = "현재 위치에서 가까운 교통, 장소와 생활 정보를 찾기 위해 위치를 사용합니다."
- 3-state 불변식 화면 전수 적용: **권한 거부 / 조회 실패 / 0건**을 서로 다른 문장으로. 도착 정보는 `arrivalStatus: "unavailable"`(조회 실패)과 `arrivals: []`(정상적 없음)을 절대 뭉개지 않는다.
- 도착 낭독 정본: 지하철 `message`(arvlMsg2)·서울버스 `arrivalMessage`(arrmsg1) 완성 문장 그대로. TAGO 버스만 슬롯 조합. `express`(급행)·`lowFloor`(저상)는 텍스트로 흡수.
- 한 줄=한 객체: 도착편·대여소·장소 행은 단일 결합 텍스트. 역·정류소·기관 **이름만 heading trait**(`.accessibilityAddTraits(.isHeader)`), 도착편 목록엔 heading 미부여(웹 h4 규칙 미러).
- 새로고침: pull-to-refresh(`.refreshable`) = 위치 정밀 재취득 + 재조회(웹 `awaitGeolocation({force:true})` 계약). 재취득 실패 시 직전 성공 데이터 유지(데이터 포기 금지).
- 병렬 구현 규율: 화면 서브에이전트는 **자기 파일만 수정, 커밋 금지**(오케스트레이터가 통합 빌드 후 커밋). Kit·공용 파일은 Task A에서 선행 동결.

## API 계약 (전 라우트 `GET ?lat=..&lng=..`, 실패 시 4xx/5xx `{error}`)

| 라우트 | envelope | 항목 타입(웹 types.ts 미러) |
|---|---|---|
| `/api/station/subway-arrival/nearby` | `{stations:[...]}` | NearbySubwayStation: stationName, nameEn?, lines[String], distanceMeters, arrivalStatus("ok"/"unavailable"), arrivals[SubwayArrival] |
| `/api/bus/nearby` | `{stops:[...]}` | BusStop: nodeId, cityCode, name, stopNo?, lat, lng, distanceMeters, source("tago"/"seoul"), arrivalStatus, arrivals[BusArrival] |
| `/api/bike/nearby` | `{stations:[...]}` | BikeStation: stationId, name, lat, lng, distanceMeters, racksTotal, bikesAvailable |
| `/api/clinic/nearby` | `{clinics:[...]}` | NightClinic + openStatus{state("open"/"closed"/"unknown"), start, end}: id, name, address, phone, kind, emergencyClass, directions, lat, lng, distanceMeters, hours[8×{start,end}] |
| `/api/places/kids` | `{kids:[...]}` | KidsPlace: id, name, category, kind("kidscafe"/"playground"/"playcenter"/"park"), indoorOutdoor("indoor"/"outdoor"/"unknown"), distanceMeters, address, roadAddress?, lat, lng, phone?, link? |
| `/api/places/around` | `{places:[...]}` | SurroundingPlace: id, name, category(10종 키), categoryRaw, distanceMeters, bearing(8방위 문자), lat, lng, phone?, link? |

세부 필드(옵셔널 여부·중첩)는 **Fixtures/*-nearby.json(2026-07-07 prod 실캡처, 커밋됨)이 정본**. SubwayArrival: line?, direction, trainLineNm, destination, message, currentLocation?, arrivalSeconds, express. BusArrival: routeId, routeNo, routeType, arrivalSeconds, prevStationCount, lowFloor, arrivalMessage?, source.

---

### Task A: 기반 동결 (Kit 모델·서비스 + LocationService + 탭·허브 + 스텁 5개)

**Files:**
- Create: `ios/GildongmuKit/Sources/GildongmuKit/Models/NearbyModels.swift` (위 표 전부 Codable+Sendable, envelope 6종: `SubwayNearbyResponse{stations}`·`BusNearbyResponse{stops}`·`BikeNearbyResponse{stations}`·`ClinicNearbyResponse{clinics}`·`KidsNearbyResponse{kids}`·`AroundNearbyResponse{places}`)
- Create: `ios/GildongmuKit/Sources/GildongmuKit/NearbyService.swift`
- Test: `ios/GildongmuKit/Tests/GildongmuKitTests/NearbyModelsTests.swift` (fixture 6종 디코딩, 각 1개 이상 필드 심층 검증: 지하철 arrivals[0].message 비어있지 않음, clinic openStatus.state가 3값 중 하나, around bearing 비어있지 않음 등)
- Create: `ios/Gildongmu/LocationService.swift`, `ios/Gildongmu/NearbyHubView.swift`
- Create: `ios/Gildongmu/Nearby/SubwayNearbyView.swift` (완전 구현, 규범 패턴)
- Create: `ios/Gildongmu/Nearby/BusNearbyView.swift`·`BikeNearbyView.swift`·`ClinicNearbyView.swift`·`KidsNearbyView.swift`·`AroundNearbyView.swift` (5개 스텁: `Text("준비 중")`)
- Modify: `ios/Gildongmu/GildongmuApp.swift` (TabView), `ios/Gildongmu.xcodeproj/project.pbxproj` (위치 usage description 키 2곳)

**Interfaces (Produces, B 태스크가 그대로 사용):**

```swift
// NearbyService (Kit): 실패는 throw(APIError). 3-state 매핑은 뷰모델 몫.
public struct NearbyService: Sendable {
    public init(client: APIClient)
    public func subwayArrivals(lat: Double, lng: Double) async throws -> [NearbySubwayStation]
    public func busStops(lat: Double, lng: Double) async throws -> [BusStop]
    public func bikeStations(lat: Double, lng: Double) async throws -> [BikeStation]
    public func clinics(lat: Double, lng: Double) async throws -> [NightClinic]
    public func kidsPlaces(lat: Double, lng: Double) async throws -> [KidsPlace]
    public func surroundings(lat: Double, lng: Double) async throws -> [SurroundingPlace]
}

// LocationService (앱): 공유 싱글턴. 각 화면은 CLLocationManager 직접 생성 금지(spec §3).
@Observable @MainActor
final class LocationService: NSObject, CLLocationManagerDelegate {
    static let shared = LocationService()
    enum LocationError: Error { case denied, unavailable }
    /// 권한 요청(최초 1회 시스템 팝업) + 현재 위치 1회 취득.
    /// force=true면 캐시를 버리고 정밀 재취득(웹 awaitGeolocation({force:true}) 계약).
    /// 실패해도 직전 성공 좌표는 lastCoordinate에 유지된다.
    func currentCoordinate(force: Bool = false) async throws(LocationError) -> (lat: Double, lng: Double)
    private(set) var lastCoordinate: (lat: Double, lng: Double)?
}

// 도메인 화면 상태 공통 enum (각 화면 파일 안에 정의하지 말고 Nearby/NearbyLoadState.swift 공용)
enum NearbyLoadState<Item> {
    case idle, loading
    case loaded([Item])      // 빈 배열 = 정상적 0건
    case denied              // 위치 권한 거부
    case failed              // 조회 실패
}
```

- [ ] Kit 모델·서비스·테스트 TDD(fixture 디코딩 실패 확인→구현→통과). `swift test` 전체 통과 확인.
- [ ] LocationService 구현: `requestWhenInUseAuthorization` → `requestLocation()`(1회 취득), continuation으로 async 브리지. 거부 상태(`denied`/`restricted`)면 즉시 `.denied` throw. force면 기존 좌표 무시하고 재취득, 실패 시 throw하되 `lastCoordinate` 보존.
- [ ] GildongmuApp을 TabView로: Tab("검색", systemImage: "magnifyingglass") { SearchView() } / Tab("내 주변", systemImage: "location") { NearbyHubView() }. 아이콘은 SFSymbol(장식, 시스템이 라벨 낭독).
- [ ] NearbyHubView: NavigationStack + List에 6개 NavigationLink(지하철 도착·버스 도착·따릉이 대여소·소아 야간진료·아이 놀 곳·둘러보기). 위치 요청은 여기서 하지 않는다(각 도메인 화면 진입 시).
- [ ] pbxproj Debug·Release 두 buildSettings에 `INFOPLIST_KEY_NSLocationWhenInUseUsageDescription = "현재 위치에서 가까운 교통, 장소와 생활 정보를 찾기 위해 위치를 사용합니다.";` 추가.
- [ ] SubwayNearbyView 완전 구현(아래 규범 패턴). 스텁 5개 생성. 빌드 통과 확인 후 전체 Commit(2개: Kit / 앱).

**규범 패턴(SubwayNearbyView + SubwayNearbyModel, 같은 파일):**

```swift
import SwiftUI
import Observation
import Accessibility
import GildongmuKit

/// 내 주변 지하철 도착. 3-state(권한 거부/조회 실패/0건) 분리와
/// 도착 문장 정본(message=arvlMsg2)이 규범. 다른 5개 화면이 이 패턴을 미러링한다.
@Observable @MainActor
final class SubwayNearbyModel {
    private(set) var state: NearbyLoadState<NearbySubwayStation> = .idle
    private let service = NearbyService(client: APIClient(baseURL: AppConfig.apiBaseURL))

    func load(force: Bool = false) async {
        if case .idle = state { state = .loading }
        do {
            let coord = try await LocationService.shared.currentCoordinate(force: force)
            let stations = try await service.subwayArrivals(lat: coord.lat, lng: coord.lng)
            state = .loaded(stations)
            announceLoaded(count: stations.count, unit: "역")
        } catch let error as LocationService.LocationError {
            if case .denied = error { state = .denied } else if case .loaded = state {} else { state = .failed }
        } catch {
            // 조회 실패: 직전 성공 데이터가 있으면 유지(새로고침=재조회이지 데이터 포기 아님)
            if case .loaded = state { announceRefreshFailed() } else { state = .failed }
        }
    }
}

struct SubwayNearbyView: View {
    @State private var model = SubwayNearbyModel()

    var body: some View {
        List {
            if case .loaded(let stations) = model.state {
                ForEach(stations, id: \.stationName) { station in
                    Section {
                        // 역명만 heading(웹 h4 규칙). 노선·거리는 같은 줄에 흡수.
                        Text(joinText(station.stationName, station.lines.joined(separator: ", "), "\(station.distanceMeters)m"))
                            .accessibilityAddTraits(.isHeader)
                        if station.arrivalStatus == "unavailable" {
                            Text("도착 정보를 가져오지 못했습니다")   // 조회 실패 ≠ 열차 없음
                        } else if station.arrivals.isEmpty {
                            Text("도착 예정 열차가 없습니다")
                        } else {
                            ForEach(Array(station.arrivals.enumerated()), id: \.offset) { _, arrival in
                                // 완성 문장 정본 message 그대로. 급행은 텍스트로 흡수.
                                Text(joinText(arrival.line, arrival.express ? "급행" : nil, arrival.trainLineNm, arrival.message))
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("지하철 도착")
        .overlay { stateOverlay }
        .task { await model.load() }
        .refreshable { await model.load(force: true) }
    }

    @ViewBuilder private var stateOverlay: some View {
        switch model.state {
        case .loading: ProgressView("확인 중")
        case .denied:
            ContentUnavailableView("위치 권한이 필요합니다", systemImage: "location.slash",
                description: Text("설정 앱에서 길동무 베타의 위치 접근을 허용해 주세요"))
        case .failed:
            ContentUnavailableView("정보를 가져오지 못했습니다", systemImage: "wifi.exclamationmark",
                description: Text("잠시 후 다시 시도해 주세요"))
        case .loaded(let stations) where stations.isEmpty:
            ContentUnavailableView("주변에 지하철역이 없습니다", systemImage: "tram")
        default: EmptyView()
        }
    }
}
```

`joinText(_ parts: String?...) -> String`(nil·빈 문자열 제거, ", " 결합)은 `ios/Gildongmu/Nearby/NearbyLoadState.swift`에 공용 헬퍼로 둔다(웹 `joinText` 미러). `announceLoaded`/`announceRefreshFailed`는 `AccessibilityNotification.Announcement` 단일 채널 헬퍼(같은 파일).

### Task B1~B5: 나머지 5개 화면 (병렬, 각자 자기 파일만, 커밋 금지)

각 화면은 규범 패턴(모델+뷰 한 파일, load/refreshable/3-state overlay/단일 통지)을 그대로 미러링하고 행 구성만 다르다:

- **BusNearbyView**: Section당 정류소. 헤더 `joinText(name, stopNo, "\(distanceMeters)m")`. `arrivalStatus` 분기 동일. 도착행: `arrivalMessage`가 있으면(서울) `joinText(routeNo+"번", routeType, lowFloor ? "저상" : nil, arrivalMessage)`, 없으면(TAGO) `joinText(routeNo+"번", routeType, lowFloor ? "저상" : nil, "\(prevStationCount)정류장 전", "약 \(max(1, arrivalSeconds/60))분 후")`.
- **BikeNearbyView**: 평면 행. `joinText(name, "\(distanceMeters)m", "대여 가능 \(bikesAvailable)대", "거치대 \(racksTotal)대")`. 0대와 정보 구조상 혼동 없음(정수 필드).
- **ClinicNearbyView**: Section당 기관. 헤더 `joinText(name, kind, "\(distanceMeters)m")`(heading). 진료상태 행: openStatus.state가 "open"이면 "지금 진료 중"+end를 "HH시 MM분까지"로, "closed"면 "지금은 진료하지 않습니다", "unknown"이면 "진료시간 정보 없음"(3-state 문장 분리). 주소·directions 행(비면 생략). 전화는 별도 `Link`(인터랙티브 분리 원칙).
- **KidsNearbyView**: 평면 행. kind 라벨(kidscafe=키즈카페·playground=놀이터·playcenter=놀이센터·park=공원), indoorOutdoor(indoor=실내·outdoor=실외·unknown은 **생략**이 아니라 "실내외 정보 없음"). `joinText(name, kindLabel, inOutLabel, "\(distanceMeters)m", roadAddress ?? address)`.
- **AroundNearbyView**: 평면 행. bearing 8방위 한글(N=북·NE=북동·E=동·SE=남동·S=남·SW=남서·W=서·NW=북서, fixture 값 확인 후 매핑 보정). categoryRaw는 마지막 " > " 조각만. `joinText(name, categoryPiece, bearingKorean+"쪽", "\(distanceMeters)m")`. ⚠ heading 없는 기기라 정면-상대 방향 금지(북 기준 절대 방위만, 웹 계약).

수용 기준(공통): 스텁 대체 후 앱 빌드 통과, 3-state overlay·refreshable·통지 포함, UI 라벨 이모지 금지, 인터랙티브 요소 결합 금지.

### Task C: 통합 (오케스트레이터)

- [ ] 전체 빌드·수정, `swift test` 회귀 확인, 화면 5개 일괄 커밋, push, 실기기 설치.
- [ ] M2 게이트(실기기): 내 주변 탭 → 지하철 진입 시 위치 권한 팝업(앱 시작 즉시 아님) → 허용 후 역·도착 낭독 / 설정에서 거부 후 재진입 시 거부 문장 / pull-to-refresh 재조회 / 6개 화면 각 1회 진입 낭독 확인.
- [ ] PROGRESS.md M2 기록.

## Self-Review 결과

- **Spec coverage:** M2 로드맵(LocationService·6종 화면·거리 표기·권한 3경로·새로고침 재취득) 전부 매핑. 지하철·버스 arrivalStatus, 진료 3-state, 둘러보기 방위 금지 규칙 등 CLAUDE.md 함정 카탈로그 반영.
- **Placeholder scan:** B 태스크는 규범 패턴 참조 방식이나 행 구성·라벨·분기를 전부 명시했으므로 구현 재량은 표현이 아니라 기계적 치환 수준.
- **Type consistency:** NearbyService 메서드명·NearbyLoadState·joinText가 Task A 정의와 B 사용부 일치. envelope 이름 6종 일관.
