import SwiftUI
import Observation
import Accessibility
import GildongmuKit

/// 길찾기 필드 후보 검색 모델(웹 EndpointField 미러): 장소+주소 병렬 상위 5건씩.
/// 웹 폴백 없음(includeWeb=false, 후보엔 좌표가 필요해 무의미 + 유료 호출 회피).
/// 주소 후보는 좌표가 없어 선택 시점에 지오코딩으로 확정한다.
@Observable @MainActor
final class EndpointSearchModel {
    var query = ""
    private(set) var places: [Place] = []
    private(set) var addresses: [JusoAddress] = []
    /// 0건·실패의 시각 안내(3-state: 없음≠실패). 후보 있는 성공은 목록이 정본이라 비운다.
    private(set) var notice = ""
    private(set) var isSearching = false
    /// tri-state: "검색 전"(최근 섹션 노출)과 "검색함(진행중·0건·실패 불문)"을 구분(웹
    /// candidates===null·SearchView outcome==nil 미러). 시트 수명=1회라 리셋 경로 없음(YAGNI).
    private(set) var hasSearched = false
    /// 후보 도착 세대. 뷰가 첫 후보로 포커스를 옮기는 신호(웹 candidateRevision 동형).
    private(set) var resultsRevision = 0
    private var searchTask: Task<Void, Never>?
    /// 지오코딩 재진입 가드(웹 geocodeRef 미러)
    private var isGeocodingInFlight = false
    /// 역 칸(E70) — 주소 후보를 담지 않는다. 건수 통지·0건 판정·첫 후보 착지가 보이는 후보 기준이 된다.
    var stationsOnly = false
    /// 역 칸의 정류장 줄(E70-e spec §3). 정류장 이름 검색은 제출 때 장소 검색과 병렬로 돌고, 거리는 근접 블렌딩과 같은 기준점에서 잰다.
    struct StopRow: Identifiable {
        let hit: JourneyStopHit
        let distance: Int?
        var id: String { "\(hit.name)|\(hit.lat)|\(hit.lng)" }
    }
    private(set) var stops: [StopRow] = []
    /// 정류장 검색만 실패 — 정류장 자리에 한 줄(장소 줄·받은 정류장 줄은 그대로).
    private(set) var stopsFailed = false
    /// 일부만 받았다 — 정류장 줄 뒤에 할 일을 말하는 한 줄.
    private(set) var stopsTruncated = false
    /// 대상 지역을 못 정했다 — 장소·정류장이 둘 다 0건일 때만 기존 「정류소 정보가 제공되지 않습니다」를 더한다.
    private(set) var showsNoBusData = false
    /// 역 칸에서 장소 검색이 실패했는데 정류장 줄이 있다 — 역 장소 줄이 없는 이유가 "역 없음"이 아니라 "조회 실패"임을 알린다.
    private(set) var showsPlacesFailure = false
    /// 길찾기 화면의 출발·도착 좌표 중 알려진 것(둘 다 없으면 정류장 검색을 하지 않는다).
    var stopOrigin: (lat: Double, lng: Double)?
    var stopDest: (lat: Double, lng: Double)?

    private let service = SearchService(client: APIClient(baseURL: AppConfig.apiBaseURL))
    private let routeService = RouteService(client: APIClient(baseURL: AppConfig.apiBaseURL))

    /// 역 장소 줄(카카오 순서 그대로) → 정류장 줄 → 그 밖 장소 줄 — 고를 수 있는 것이 먼저다. 역 칸이 아니면 장소 전부가 앞쪽이다.
    var selectablePlaces: [Place] { stationsOnly ? places.filter { stationLayoutKind($0) != nil } : places }
    var otherPlaces: [Place] { stationsOnly ? places.filter { stationLayoutKind($0) == nil } : [] }

    func submit() {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        hasSearched = true   // 검색 시작 시점(진행 중에도 최근 섹션 숨김, SearchView !isSearching 배제 동형)
        searchTask?.cancel()   // 진행 중 검색 폐기: stale 응답 차단
        isSearching = true
        searchTask = Task {
            // 허용된 세션이면 좌표를 실어 근접 블렌딩(SearchModel 동형, 팝업 없음).
            let coordinate = await LocationService.shared.coordinateForRanking()
            async let stopOutcome = searchStops(trimmed, reference: coordinate)
            let outcome = await service.search(
                query: trimmed, lat: coordinate?.lat, lng: coordinate?.lng,
                lang: AppLanguage.dataLocale, includeWeb: false)
            let stopResult = await stopOutcome
            guard !Task.isCancelled else { return }
            // 미니 검색은 필드 확정용이라 상위 5건씩만(전체 탐색은 검색 탭이 담당).
            places = Array(outcome.places.items.prefix(5))
            addresses = stationsOnly ? [] : Array(outcome.addresses.items.prefix(5))
            stops = stopResult?.rows ?? []
            stopsFailed = stopResult?.failed ?? false
            stopsTruncated = stopResult?.truncated ?? false
            isSearching = false
            resultsRevision += 1
            let count = places.count + addresses.count + stops.count
            showsNoBusData = count == 0 && (stopResult?.unsearched ?? false)
            // 역 칸은 주소를 버리므로 장소 트랙의 성패만 본다(주소 성공이 장소 실패를 가리지 않는다).
            let placesFailed = stationsOnly ? outcome.places.isFailed : outcome.allFailed
            showsPlacesFailure = stationsOnly && placesFailed && count > 0
            var message: String
            var haptic: ResultHaptic.Kind
            if count > 0 {
                message = appLocalized("directions.candidateCount", count)
                notice = ""
                haptic = .success
                // 실패는 줄만 두면 훑어야 알게 된다 — 건수 뒤에 한 문장씩 덧붙이고 진동도 그에 맞춘다(3-state).
                if showsPlacesFailure {
                    message += " " + appLocalized("directions.candidateError")
                    haptic = .attention
                }
                if stopsFailed {
                    message += " " + appLocalized("ios.journey.stopSearchFailed")
                    haptic = .attention
                }
            } else if placesFailed {
                // 3-state: "0건"과 "조회 실패"를 뭉개지 않는다.
                message = appLocalized("directions.candidateError")
                notice = message
                haptic = .failure
            } else {
                message = appLocalized("directions.candidateNone")
                notice = message
                haptic = .attention
                if stopsFailed { message += " " + appLocalized("ios.journey.stopSearchFailed") }
            }
            if showsNoBusData { message += " " + appLocalized("ios.common.unavailableHere.noBusData") }
            ResultHaptic.fire(haptic)
            AccessibilityNotification.Announcement(message).post()
        }
    }

    func cancel() {
        searchTask?.cancel()
    }

    /// 지금 탄 열차 역 검색(E71)으로 바뀐다 — 같은 시트가 지하철역만 받는 검색으로 다시 시작한다. 앞선 후보·주소·정류장 줄은
    /// 이 모드의 계약(지하철역만, 정류장 검색 없음)과 맞지 않아 비운다.
    func startAboardSearch() {
        searchTask?.cancel()
        query = ""
        places = []
        addresses = []
        stops = []
        notice = ""
        isSearching = false
        hasSearched = false
        stopsFailed = false
        stopsTruncated = false
        showsNoBusData = false
        showsPlacesFailure = false
        stationsOnly = true
        stopOrigin = nil
        stopDest = nil
    }

    /// 서버 `q`의 trim 길이 계약(2~30자) — 밖이면 정류장 검색을 하지 않는다(400이 실패 줄로 위장하지 않게).
    private static let stopQueryLengths = 2...30

    private struct StopSearchOutcome {
        let rows: [StopRow]
        let failed: Bool
        let truncated: Bool
        let unsearched: Bool
    }

    /// 역 칸 + 두 글자 이상 + 알려진 좌표가 있을 때만 정류장 검색을 한다. 던지면 실패 한 줄(미유도 지역은 `unsearched`가 따로 말한다).
    private func searchStops(_ text: String, reference: (lat: Double, lng: Double)?) async -> StopSearchOutcome? {
        guard stationsOnly, Self.stopQueryLengths.contains(text.count), stopOrigin != nil || stopDest != nil else { return nil }
        do {
            let result = try await routeService.journeyStops(query: text, origin: stopOrigin, dest: stopDest)
            var rows = result.stops.map { hit in
                StopRow(
                    hit: hit,
                    distance: reference.map {
                        Int(haversineMeters(lat1: $0.lat, lng1: $0.lng, lat2: hit.lat, lng2: hit.lng).rounded())
                    })
            }
            // 거리순(기준점이 없으면 서버 순서 그대로). 정렬은 안정적이지 않으므로 거리 있는 쪽만 가른다.
            if reference != nil { rows.sort { ($0.distance ?? .max) < ($1.distance ?? .max) } }
            return StopSearchOutcome(
                rows: Array(rows.prefix(5)), failed: result.failed, truncated: result.truncated,
                unsearched: result.unsearched)
        } catch APIError.outOfCoverage {
            // 서비스 지역 밖은 실패가 아니다 — 정류장 줄·실패 줄 없이 장소 결과가 정본이다.
            return StopSearchOutcome(rows: [], failed: false, truncated: false, unsearched: false)
        } catch {
            return StopSearchOutcome(rows: [], failed: true, truncated: false, unsearched: false)
        }
    }

    /// 주소 후보 선택: 지오코딩 성공 시에만 확정. 실패는 coordError 통지 + 시트 유지(nil).
    func geocode(_ address: JusoAddress) async -> DirectionsEndpoint? {
        if isGeocodingInFlight { return nil }
        isGeocodingInFlight = true
        defer { isGeocodingInFlight = false }
        let target = address.roadAddrPart1.isEmpty ? address.roadAddr : address.roadAddrPart1
        do {
            guard let match = try await service.geocode(query: target).first else {
                announceCoordError()
                return nil
            }
            // 라틴 표기는 지정 시점의 juso 공식 영문 주소(E28) — 수동 위치 지정이 스토어까지 옮긴다.
            let roman = address.engAddr.trimmingCharacters(in: .whitespaces)
            return .place(label: target, lat: match.lat, lng: match.lng, labelRoman: roman.isEmpty ? nil : roman)
        } catch {
            announceCoordError()
            return nil
        }
    }

    private func announceCoordError() {
        notice = appLocalized("directions.coordError")
        ResultHaptic.fire(.failure)
        AccessibilityNotification.Announcement(notice).post()
    }
}

/// 출발지/도착지 후보 검색 시트. 선택 즉시 닫히고 필드에 원자 확정된다.
/// 닫힘 후 VO 포커스는 시트를 연 필드 버튼으로 복귀(시스템 기본)하고, 확정 확인은
/// 필드의 라벨+값 낭독이 담당한다(웹 resolveAndClose 선점 포커스의 iOS 문법,
/// 별도 완료 통지를 더하지 않는다).
struct DirectionsEndpointSearchView: View {
    let target: DirectionsFieldTarget
    let onSelect: (DirectionsEndpoint) -> Void
    /// 자동차로 갈아탈 역 칸(E70 §5.1)의 결과 — 끝점이 아니라 장소 그대로(역 판정·노선 힌트에 분류가 필요하다).
    /// 역 칸 대상에서만 쓰인다. `DirectionsEndpoint`(Kit 공유·최근 기록 저장 포맷)는 넓히지 않는다.
    let onSelectStation: ((RecentStation) -> Void)?
    /// 출발지 칸의 「지금 탄 열차에서 출발」(E71)의 결과 — 역을 장소 그대로 돌려준다(노선 힌트가 필요하다). 실험판 여정 입력이 설 때만
    /// 값이 있고, 없으면 출발지 시트에 그 행이 없다.
    let onSelectAboardStation: ((RecentStation) -> Void)?
    /// 정류장 이름 검색의 지역 근거(E70-e) — 길찾기 화면의 출발·도착 중 알려진 좌표. 역 칸 대상에서만 쓰인다.
    let stopOrigin: (lat: Double, lng: Double)?
    let stopDest: (lat: Double, lng: Double)?

    /// 끝점 칸(출발·도착·경유지·수동 위치) — 역 칸 전용 인자가 없다.
    init(target: DirectionsFieldTarget, onSelect: @escaping (DirectionsEndpoint) -> Void) {
        self.target = target
        self.onSelect = onSelect
        self.onSelectStation = nil
        self.onSelectAboardStation = nil
        self.stopOrigin = nil
        self.stopDest = nil
    }

    /// 역 칸 — 정류장 검색의 지역 근거를 기본값 없이 받는다(빠뜨리면 정류장 검색이 조용히 꺼진다).
    init(
        target: DirectionsFieldTarget, onSelect: @escaping (DirectionsEndpoint) -> Void,
        onSelectStation: @escaping (RecentStation) -> Void,
        onSelectAboardStation: ((RecentStation) -> Void)?,
        stopOrigin: (lat: Double, lng: Double)?, stopDest: (lat: Double, lng: Double)?
    ) {
        self.target = target
        self.onSelect = onSelect
        self.onSelectStation = onSelectStation
        self.onSelectAboardStation = onSelectAboardStation
        self.stopOrigin = stopOrigin
        self.stopDest = stopDest
    }
    @Environment(\.dismiss) private var dismiss
    @State private var model = EndpointSearchModel()
    @State private var speech = SpeechService()
    /// 최근 장소(스펙 2026-07-26) — 출발지·도착지 분리 목록(위원장 지시 2026-07-26),
    /// 이 시트의 필드 스코프만 시트 열릴 때 로드.
    private let recentStore = RecentSearchStore()
    // manualLocation은 전용 스코프가 없다 — "도착지" 최근 목록을 재사용한다(자주 가는
    // 곳이 지금 서 있는 곳의 후보이기도 하다는 취지, 무해한 재사용이지 오류가 아니다).
    private var recentScope: RecentEndpointScope {
        switch target {
        case .from: .from
        case .via: .via  // 경유지 전용 목록(N4) — 도착지 목록과 섞지 않는다
        case .to, .manualLocation: .to
        case .boardStation, .alightStation: .to  // 역 칸은 최근 목록을 보이지 않는다(`isStationTarget`)
        }
    }

    /// 역 칸(E70) — 최근 끝점·주소 후보를 보이지 않는다(분류가 없어 역인지 알 수 없다, spec §5.1). 반복 여정은 최근 경로가
    /// 통째로 복원한다.
    private var isStationTarget: Bool { target == .boardStation || target == .alightStation }
    /// 지금 탄 열차 역 검색 모드(E71) — 출발지 시트가 그 자리에서 바뀐다(닫았다 다시 띄우면 그 사이 커서가 최상단으로 떨어진다).
    /// 최근 목록·주소 후보·현재 위치 행이 없고 지하철역만 받는다는 점이 역 칸과 같아 목록 조건은 둘을 함께 본다.
    @State private var aboardMode = false
    private var stationsOnlyView: Bool { isStationTarget || aboardMode }
    @State private var recentEndpoints: [RecentEndpoint] = []
    @AccessibilityFocusState private var focusedRecent: RecentEndpoint?
    /// 고정 항목 이동 뒤 커서 유지 재시도(E67).
    @State private var reorderFocusTask: Task<Void, Never>?
    /// 목록 소멸 시 포커스 착지점 — 항상 존재하는 마이크 행(스펙 §5, SearchView 동형).
    @AccessibilityFocusState private var micRowFocused: Bool
    /// 시트 진입 시 검색 필드로 커서를 보낸다. 안 하면 커서가 시트 최상단에 머물러
    /// 사용자가 "검색하러 열었는데" 필드까지 스와이프해 내려가야 한다(실기기 확인).
    @FocusState private var searchFieldFocused: Bool
    /// 후보 도착 시 첫 후보로 이동(웹 계약 동형). 목록이 곧 이 화면의 목적이다.
    ///
    /// ⚠ **Bool 바인딩을 여러 행에 `equals:`로 붙이면 안 된다.** 첫 행만 `equals: true`,
    /// 나머지가 전부 `equals: false`가 되어 초기 상태(false)에서 **나머지 행 전부가
    /// 동시에 포커스를 주장**한다. 실기기에서 "결과 중 5~6번째에 랜덤 착지"로
    /// 나타났다(2026-08-02). 같은 파일의 `focusedRecent`처럼 **항목 정체성**을 값으로
    /// 쓰는 것이 정본이다.
    @AccessibilityFocusState private var focusedCandidate: String?
    @State private var candidateFocusTask: Task<Void, Never>?

    /// 후보 행의 안정 키. 장소와 주소가 한 목록에 섞이므로 접두사로 네임스페이스를 가른다.
    private static func candidateKey(place: Place) -> String { "place:\(place.id)" }
    private static func candidateKey(address: JusoAddress) -> String { "addr:\(address.roadAddr)" }
    private static func candidateKey(stop: EndpointSearchModel.StopRow) -> String { "stop:\(stop.id)" }

    /// 렌더 순서(역 장소 → 정류장 → 그 밖 장소 → 주소)와 일치하는 첫 후보. 둘 다 비면 nil.
    /// `focus`는 포커스 바인딩 값, `scroll`은 ForEach 정체성(= scrollTo 인자)이다.
    private var firstCandidate: (focus: String, scroll: String)? {
        if let place = model.selectablePlaces.first {
            return (Self.candidateKey(place: place), place.id)
        }
        if let stop = model.stops.first {
            return (Self.candidateKey(stop: stop), stop.id)
        }
        if let place = model.otherPlaces.first {
            return (Self.candidateKey(place: place), place.id)
        }
        if !stationsOnlyView, let address = model.addresses.first {
            return (Self.candidateKey(address: address), address.roadAddr)
        }
        return nil
    }

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
            List {
                // 마이크는 검색 필드 바로 다음 행(SearchView 동형 배선, F-C). 검색 계열
                // 계약: 홀드 단일 동작 — 최종 전사를 쿼리에 넣고 즉시 후보 검색(잠금·취소
                // 슬라이드 없음). 전사 원문을 polite 통지한 뒤 결과 통지는 submit()의
                // 후보 수 통지가 담당. 포커스는 건드리지 않는다(선택은 후보 목록 스와이프).
                Section {
                    HoldDictationButton(
                        speech: speech,
                        hint: appLocalized("ios.voice.holdHintSearch"),
                        showsTitle: true,
                        onTranscript: { text in
                            // 후행 마침표 제거(SearchView 동형). 출발·도착 후보는 주소
                            // 비중이 높아 마침표 한 글자에 juso가 0건으로 전멸한다.
                            let query = normalizeVoiceQuery(text)
                            model.query = query
                            AccessibilityNotification.Announcement(query).post()
                            model.submit()
                        },
                        onPause: nil
                    )
                    .accessibilityFocused($micRowFocused)
                }
                // 출발지에서는 "현재 위치 사용"이 GPS 선택을, 수동 위치 지정 맥락에서는
                // 지정 해제를 뜻한다. 도착지에는 노출하지 않는다(스왑이 담당).
                if (target == .from || target == .manualLocation) && !aboardMode {
                    Button(appLocalized(target == .manualLocation
                                        ? "manualLocation.useGps"
                                        : "directions.useCurrentLocation")) {
                        select(.current)
                    }
                }
                // 지금 탄 열차에서 출발(E71): 「현재 위치 사용」 바로 다음 행. 누르면 이 시트가 역 검색으로 바뀌고 이 행과 「현재 위치 사용」
                // 행이 사라지므로, 행이 사라지기 전에 항상 있는 마이크 행으로 커서를 선점한 뒤 검색 필드로 옮긴다(헌장 §5).
                if target == .from, onSelectAboardStation != nil, !aboardMode {
                    Button(appLocalized("ios.journey.aboardStart")) {
                        micRowFocused = true
                        model.startAboardSearch()
                        aboardMode = true
                        landAboardSearchField()
                    }
                }
                if !model.notice.isEmpty {
                    Text(model.notice)
                }
                // 최근 장소(스펙 2026-07-26): 후보 검색 전 상태에만(hasSearched tri-state —
                // "아직 검색 안 함"과 "검색함(0건·실패 포함)"을 구분, places/addresses.isEmpty만
                // 쓰면 0건 노출 후 재노출되는 회귀). 행 활성화=재검색 없이 즉시 확정,
                // swipeActions 삭제가 VoiceOver 로터로 자동 노출된다. 기록은
                // select→onSelect→setEndpoint가 담당(이중 기록 금지).
                if !stationsOnlyView && !model.hasSearched && !recentEndpoints.isEmpty {
                    Section(appLocalized("recent.title")) {
                        // 고정 항목은 라벨 접미사 "고정됨"(한 줄 = 한 객체), 고정 토글이
                        // 삭제보다 앞(위원장 지시 2026-08-12) — 로터 커스텀 액션 자동 노출.
                        // 고정이 둘 이상이면 고정 행에 순서 바꾸기 로터 액션(E67).
                        // ⚠ id: \.self 금지 — pinned가 Hashable에 포함되어 토글이 행을
                        // 파괴(포커스 이탈)한다. Identifiable(좌표 4자리 키)로 제자리 유지.
                        ForEach(recentEndpoints) { endpoint in
                            Button {
                                select(.place(label: endpoint.label, lat: endpoint.lat, lng: endpoint.lng, labelRoman: endpoint.labelRoman))
                            } label: {
                                let name = bilingual(endpoint.label, roman: endpoint.labelRoman)
                                let pin = endpoint.pinned ? appLocalized("recent.pinned") : nil
                                bilingualLine(visible: joinText(name.display, pin), accessible: joinText(name.primary, pin))
                            }
                            .accessibilityFocused($focusedRecent, equals: endpoint)
                            .reorderActions(pinnedMoves(endpoint)) { move in
                                moveRecent(endpoint, move, reveal: { proxy.scrollTo(endpoint.id) })
                            }
                            .swipeActions {
                                Button(appLocalized(endpoint.pinned ? "recent.unpin" : "recent.pin")) {
                                    togglePinRecent(endpoint)
                                }
                                Button(appLocalized("recent.delete"), role: .destructive) {
                                    deleteRecent(endpoint)
                                }
                            }
                        }
                        Button(appLocalized("recent.clearAll")) { clearRecent() }
                    }
                }
                ForEach(model.selectablePlaces) { place in placeRow(place) }
                if model.showsPlacesFailure {
                    Text(appLocalized("directions.candidateError"))
                }
                ForEach(model.stops) { stop in
                    Button {
                        selectStop(stop.hit)
                    } label: {
                        // 한 줄 = 한 객체: 이름, 「정류장」, 거리(기준점이 없으면 거리 조각 없음). 이름은 원문 그대로(깎지 않는다).
                        Text(joinText(
                            stop.hit.name, appLocalized("ios.journey.busStopKind"),
                            stop.distance.map(formatDistance)))
                    }
                    .accessibilityFocused($focusedCandidate, equals: Self.candidateKey(stop: stop))
                }
                if model.stopsFailed {
                    Text(appLocalized("ios.journey.stopSearchFailed"))
                }
                if model.stopsTruncated {
                    Text(appLocalized("ios.journey.stopSearchTruncated"))
                }
                if model.showsNoBusData {
                    Text(appLocalized("ios.common.unavailableHere.noBusData"))
                }
                ForEach(model.otherPlaces) { place in placeRow(place) }
                ForEach(stationsOnlyView ? [] : model.addresses, id: \.roadAddr) { address in
                    Button {
                        Task {
                            if let endpoint = await model.geocode(address) { select(endpoint) }
                        }
                    } label: {
                        // juso 공식 영문 주소(`engAddr`)가 원천이라 로마자보다 앞선다(웹 동형).
                        let name = bilingual(address.roadAddr, en: address.engAddr, roman: nil)
                        bilingualLine(visible: name.display, accessible: name.primary)
                    }
                    .accessibilityFocused($focusedCandidate, equals: Self.candidateKey(address: address))
                }
            }
            .navigationTitle(sheetTitle)
            .navigationBarTitleDisplayMode(.inline)
            .onChange(of: model.resultsRevision) { landFirstCandidateFocus(proxy) }
            // 상단 고정(.always 포함): iOS 26 시트 기본값은 하단 배치라 검색 탭과
            // 해부 구조(필드→마이크→최근→결과)가 어긋나고, 시트 안에서도 마이크 행
            // (상단)과 필드(하단)가 분리된다 — 검색 탭과 동일한 상단 드로어로 통일
            // (2026-07-26 위원장 승인, 하단 통일안은 VO 선형 순서 훼손으로 기각).
            .searchable(
                text: $model.query,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: Text(aboardMode ? appLocalized("ios.journey.aboardStationField") : appLocalized("ios.search.prompt")))
            .searchFocused($searchFieldFocused)
            .onSubmit(of: .search) { model.submit() }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(appLocalized("actions.close")) { dismiss() }
                }
            }
            .overlay {
                if model.isSearching {
                    ProgressView(appLocalized("ios.search.searching"))
                }
            }
            .alert(speechAlertMessage ?? "", isPresented: speechAlertBinding) {
                // 권한 거부는 설정으로만 해결된다. 안내에 그 화면을 여는 버튼을 함께
                // (위치 안내와 같은 계약, 리뷰 M-2 수용)
                if case .denied = speech.phase {
                    Button(appLocalized("ios.common.openSettings")) { openAppSettings() }
                }
                Button(appLocalized("ios.common.ok")) {}
            }
            .task {
                model.stationsOnly = isStationTarget
                model.stopOrigin = stopOrigin
                model.stopDest = stopDest
                searchFieldFocused = true
                recentEndpoints = recentStore.endpoints(recentScope)
            }
            // 마이크는 항상 폐기(시트가 닫히면 뷰가 소멸하므로 유령 청취 방지 —
            // SearchView 동형 teardown). 검색 Task도 함께 취소.
            .onDisappear {
                model.cancel()
                candidateFocusTask?.cancel()
                Task { await speech.cancel() }
            }
            }
        }
    }

    private func placeRow(_ place: Place) -> some View {
        Button {
            if aboardMode {
                selectAboardStation(place)
            } else if isStationTarget {
                selectStation(place)
            } else {
                select(.place(label: place.name, lat: place.lat, lng: place.lng, labelRoman: place.nameRoman))
            }
        } label: {
            // 한 줄 = 한 객체: 이름+주소 단일 텍스트(웹 joinText 동형). 비-ko는 이름이 로마자
            // 병기(E28) — 시각 `Roman (한글), 주소`, 낭독은 괄호 없이. 확정 라벨은 원명 그대로.
            let name = bilingual(place.name, roman: place.nameRoman)
            let address = place.roadAddress.isEmpty ? place.address : place.roadAddress
            bilingualLine(
                visible: joinText(name.display, address),
                accessible: joinText(name.primary, address))
        }
        .accessibilityFocused($focusedCandidate, equals: Self.candidateKey(place: place))
    }

    /// 후보 도착 시 첫 후보로 커서를 보낸다.
    ///
    /// ⚠ **동기 대입만으로는 안 된다**(실기기 2회 실패, 2026-08-02). `List`의 오프스크린
    /// 행은 **AX 트리에서 컬링**되고, 대상이 트리에 없으면 SwiftUI가 대입을 되돌린다.
    /// 출발지 시트는 "현재 위치 사용" 행이 하나 더 있어 첫 결과가 더 아래로 밀리는데,
    /// 출발지만 무이동이고 도착지는 엉뚱한 행에 착지한 증상 차이가 이걸로 설명된다.
    ///
    /// 그래서 채팅(`ChatConversationView`)의 검증된 순서를 그대로 따른다:
    /// **가시화(scrollTo) → 지연 → 경합 바인딩 해제 → 대입 → 되돌림 검증 → 1회 재시도.**
    /// 검색 제출로 키보드가 내려가며 레이아웃이 흔들리는 구간이라 지연이 특히 필요하다.
    private func landFirstCandidateFocus(_ proxy: ScrollViewProxy) {
        guard model.resultsRevision > 0, let first = firstCandidate else { return }
        candidateFocusTask?.cancel()
        candidateFocusTask = Task { @MainActor in
            proxy.scrollTo(first.scroll, anchor: .top)
            // ⚠ 통지 완료를 기다리지 않는다(위원장 판정 2026-08-02). 기다리면 안내가
            // 온전히 들리지만 실사용에선 **탐색이 느려진다**. 안내가 잘리더라도 즉시
            // 첫 후보로 가는 쪽이 낫다 — 건수는 부가 정보이고 목록이 목적이다.
            // 지연은 스크롤·AX 트리 정착에 필요한 최소치만 남긴다.
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            applyCandidateFocus(first.focus)
            #if DEBUG
            chatFocusLog("[endpoint-search] assigned first candidate=\(first.focus)")
            #endif

            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled else { return }
            // 되돌림(nil 리셋)이 대입 실패의 진짜 신호다.
            guard focusedCandidate != first.focus else { return }
            #if DEBUG
            chatFocusLog("[endpoint-search] retry (focusedCandidate=\(focusedCandidate ?? "nil"))")
            #endif
            proxy.scrollTo(first.scroll, anchor: .top)
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            applyCandidateFocus(first.focus)
        }
    }

    /// 지금 탄 열차 역 검색으로 바뀐 뒤 커서를 검색 필드로 보낸다. 검색 필드엔 접근성 포커스 바인딩이 없고 키보드 포커스(`@FocusState`)가 VoiceOver
    /// 커서를 끈다 — 필드는 시트가 열릴 때 이미 first responder라 같은 값 재대입은 no-op이므로(`applyCandidateFocus`가 문서화한 함정),
    /// 경합 바인딩을 먼저 놓고(false) 한 틱 뒤 대입한다. 그 사이 커서는 선점해 둔 마이크 행에 있다.
    private func landAboardSearchField() {
        candidateFocusTask?.cancel()
        candidateFocusTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(150))
            guard !Task.isCancelled else { return }
            searchFieldFocused = false
            micRowFocused = false
            try? await Task.sleep(for: .milliseconds(100))
            guard !Task.isCancelled else { return }
            searchFieldFocused = true
        }
    }

    /// 경합하는 포커스 바인딩을 먼저 놓아야 대입이 먹는다(채팅의 `isSendFocused = false` 동형).
    private func applyCandidateFocus(_ key: String) {
        searchFieldFocused = false
        micRowFocused = false
        focusedRecent = nil
        focusedCandidate = key
    }

    /// denied·failed 안내(SearchView 미러, 판정 정본은 speechAlertText). 확인 시 idle 복귀.
    private var speechAlertMessage: String? { speechAlertText(speech) }

    private var speechAlertBinding: Binding<Bool> {
        Binding(
            get: { speechAlertMessage != nil },
            set: { if !$0 { speech.reset() } }
        )
    }

    // ⚠ 이분 삼항(target == .from ? A : B)으로 두면 manualLocation이 조용히 "도착지
    // 검색" 제목으로 떨어진다(실제로 이 자리에서 나던 결함, 전수 확인 중 발견) —
    // exhaustive switch로 새 타깃이 기존 분기에 흡수되지 않게 한다.
    private var sheetTitle: String {
        switch target {
        case .from: aboardMode ? appLocalized("ios.journey.aboardStationField") : appLocalized("directions.searchFrom")
        case .to: appLocalized("directions.searchTo")
        case .via: appLocalized("directions.searchVia")
        case .manualLocation: appLocalized("manualLocation.pickTitle")
        case .boardStation: appLocalized("ios.journey.boardField")
        case .alightStation: appLocalized("ios.journey.alightField")
        }
    }

    /// 역 칸은 역이나 정류장만 받는다(spec §5.1): 이 줄은 장소 줄이고 지하철·철도역이 아니면 칸에 넣지 않고 시트를 연 채 polite 통지.
    private func selectStation(_ place: Place) {
        guard stationLayoutKind(place) != nil else {
            // 화면 변화 없는 활성화 응답이라 `.high`(통지 우선순위 판별선 — 기본이면 VO 활성화 처리에 묻혀 무반응으로 들린다).
            var message = AttributedString(appLocalized("ios.journey.notStation"))
            message.accessibilitySpeechAnnouncementPriority = .high
            AccessibilityNotification.Announcement(message).post()
            ResultHaptic.fire(.attention)
            return
        }
        onSelectStation?(RecentStation(
            label: place.name, lat: place.lat, lng: place.lng, line: journeyLineHint(place), kind: nil))
        dismiss()
    }

    /// 지금 탄 열차 역 검색(E71): 지하철역만 받는다(실시간 도착이 닿는 노선이 첫 판의 범위, spec §5.1). 아니면 시트를 연 채 통지한다.
    /// 장소 이름이 라벨이고(노선이 함께 들려야 한다) 노선 힌트는 역 칸과 같은 추출이다.
    private func selectAboardStation(_ place: Place) {
        guard stationLayoutKind(place) == .subway else {
            // 화면 변화 없는 활성화 응답이라 `.high`(selectStation과 같은 근거).
            var message = AttributedString(appLocalized("ios.journey.notStation"))
            message.accessibilitySpeechAnnouncementPriority = .high
            AccessibilityNotification.Announcement(message).post()
            ResultHaptic.fire(.attention)
            return
        }
        onSelectAboardStation?(RecentStation(
            label: place.name, lat: place.lat, lng: place.lng, line: journeyLineHint(place), kind: nil))
        dismiss()
    }

    /// 정류장 칸(E70-e): 이름은 원문 그대로, 노선 힌트 없음.
    private func selectStop(_ hit: JourneyStopHit) {
        onSelectStation?(RecentStation(label: hit.name, lat: hit.lat, lng: hit.lng, line: nil, kind: .busStop))
        dismiss()
    }

    private func select(_ endpoint: DirectionsEndpoint) {
        reorderFocusTask?.cancel()
        onSelect(endpoint)
        dismiss()
    }

    /// 항목 삭제(스펙 §5): 다음 항목 → 이전 항목 → 목록 소멸 시 마이크 행. 통지 1건.
    /// 통지는 `.high`(위원장 판정 2026-08-16 — 판별선은 **포커스가 움직이는지**다):
    /// 자기를 누른 행이 사라져 포커스가 반드시 옮겨가므로, 기본 우선순위면 VO가
    /// 착지 라벨을 낭독하며 통지를 잠식한다(헌장 §6, `SearchView.deleteRecent` 동형).
    private func deleteRecent(_ endpoint: RecentEndpoint) {
        guard let index = recentEndpoints.firstIndex(of: endpoint) else { return }
        recentEndpoints = recentStore.removeEndpoint(endpoint, scope: recentScope)
        var deletedMessage = AttributedString(appLocalized("recent.deleted"))
        deletedMessage.accessibilitySpeechAnnouncementPriority = .high
        AccessibilityNotification.Announcement(deletedMessage).post()
        if recentEndpoints.isEmpty {
            micRowFocused = true
            return
        }
        focusedRecent = recentEndpoints[min(index, recentEndpoints.count - 1)]
    }

    /// 고정 토글(스펙 2026-08-12 §4): 화면 자리는 유지하고(정렬은 다음 로드부터)
    /// 그 항목만 교체, 포커스를 갱신된 값으로 재확정 — 새 라벨 낭독이 상태 신호
    /// (헌장 §5, pinned가 정체성에 포함되어 같은 값 no-op이 아니다. SearchView 동형).
    private func togglePinRecent(_ endpoint: RecentEndpoint) {
        guard let index = recentEndpoints.firstIndex(of: endpoint) else { return }
        let updated = RecentEndpoint(
            label: endpoint.label, lat: endpoint.lat, lng: endpoint.lng, pinned: !endpoint.pinned,
            labelRoman: endpoint.labelRoman)
        recentEndpoints[index] = updated
        recentStore.setEndpointPinned(endpoint, scope: recentScope, pinned: updated.pinned)
        focusedRecent = updated
    }

    /// 고정 행에서 할 수 있는 이동(E67). 기준은 화면의 고정 순서다(spec §2.2, `SearchView` 동형).
    private func pinnedMoves(_ endpoint: RecentEndpoint) -> [ReorderMove] {
        guard endpoint.pinned else { return [] }
        let pins = recentEndpoints.filter(\.pinned)
        guard let index = pins.firstIndex(where: { $0.id == endpoint.id }) else { return [] }
        return Reorder.availableMoves(index: index, count: pins.count)
    }

    /// 고정 항목 이동(E67, spec §2.2·§2.3, `SearchView.moveRecent` 동형).
    private func moveRecent(_ endpoint: RecentEndpoint, _ move: ReorderMove, reveal: @escaping () -> Void) {
        let pins = recentEndpoints.filter(\.pinned)
        guard let index = pins.firstIndex(where: { $0.id == endpoint.id }) else { return }
        recentEndpoints = recentStore.reorderPinnedEndpoints(Reorder.moved(pins, from: index, move), scope: recentScope)
        guard let position = recentEndpoints.firstIndex(where: { $0.id == endpoint.id }) else { return }
        let moved = recentEndpoints[position]
        announceReorderPosition(position + 1)
        reorderFocusTask?.cancel()
        reorderFocusTask = keepFocusAfterMove(
            reveal: reveal, isLanded: { focusedRecent == moved }, assign: { focusedRecent = moved })
    }

    private func clearRecent() {
        recentEndpoints = recentStore.clearEndpoints(recentScope)
        if recentEndpoints.isEmpty {
            // 섹션 소멸로 포커스가 마이크 행으로 옮겨간다 — 잠식 방지 .high(SearchView 동형).
            var cleared = AttributedString(appLocalized("recent.cleared"))
            cleared.accessibilitySpeechAnnouncementPriority = .high
            AccessibilityNotification.Announcement(cleared).post()
            micRowFocused = true
        } else {
            // 고정이 남아 섹션·버튼이 그대로다 — 포커스 무이동, 기본 우선순위(SearchView 동형).
            AccessibilityNotification.Announcement(appLocalized("recent.clearedExceptPinned")).post()
        }
    }
}
