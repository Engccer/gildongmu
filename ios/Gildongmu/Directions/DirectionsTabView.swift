import SwiftUI
import Observation
import Accessibility
import GildongmuKit

/// 장소 상세·검색 결과 "길찾기" 진입 채널(Task I4). 도착지 페이로드를 1회 전달한다.
/// `LaunchActionStore`와 관찰→즉시 소비 패턴은 동형이지만 별도 스토어로 분리했다:
/// 단축어 진입(AppShortcuts)은 항상 전체 세션 리셋(진행 채팅·검색 폐기)이 계약이지만,
/// 이건 사용자가 이미 쓰던 중인 인앱 탭 전환이라 다른 탭 상태를 보존해야 한다(리셋
/// 의미 자체가 다르다. 같은 스토어에 얹으면 그 분기를 억지로 갈라야 한다).
@Observable @MainActor
final class DirectionsPrefillStore {
    static let shared = DirectionsPrefillStore()
    /// 보류 프리필 도착지. GildongmuApp이 관찰해 즉시 nil 대입(1회 소비 확인)한 뒤
    /// 길찾기 탭 전환 + directionsEpoch 갱신(원자 교체: 새 DirectionsModel 재생성이라
    /// 이전 결과·필드 상태가 함께 폐기된다).
    var pending: DirectionsEndpoint?
}

/// 길찾기 필드 식별(출발지/도착지). 검색 시트 라우팅 공용.
enum DirectionsFieldTarget: String, Identifiable {
    case from, to
    var id: String { rawValue }
}

/// 수단별 15초 타임아웃(웹 AbortController 15_000 미러). 초과·상위 취소 시 하위 요청도 취소.
private struct DirectionsQueryTimeout: Error {}

private func withQueryTimeout<T: Sendable>(_ operation: @escaping @Sendable () async throws -> T) async throws -> T {
    try await withThrowingTaskGroup(of: T.self) { group in
        group.addTask { try await operation() }
        group.addTask {
            try await Task.sleep(for: .seconds(15))
            throw DirectionsQueryTimeout()
        }
        defer { group.cancelAll() }
        return try await group.next()!
    }
}

/// 길찾기 탭 상태 머신(웹 DirectionsView 미러). 필드는 원자 확정(시트 선택),
/// 조회는 3수단 병렬 + 수단별 4-state 분류(Kit DirectionsOutcomeClassifier).
/// 위치 권한 요청은 조회 실행 시점에만(LocationService 관례, 필드 기본값이 현재
/// 위치여도 탭 진입만으론 팝업 없음).
@Observable @MainActor
final class DirectionsModel {
    enum Phase: Equatable {
        case idle, needEndpoints, locating, loading, geoDenied, geoError
        case settled(successCount: Int)
    }

    private(set) var from: DirectionsEndpoint?
    private(set) var to: DirectionsEndpoint?
    private(set) var phase: Phase = .idle
    private(set) var results: DirectionsResults?
    /// 조회 완료 세대. 뷰가 포커스 이동 시점을 아는 신호(SearchModel.resultsRevision 동형).
    private(set) var resultsRevision = 0
    /// "현재 위치" 라벨에 병기할 역지오코딩 주소(F-B, 웹 currentAddress 미러).
    /// nil=주소 미확보 — 라벨은 "현재 위치"만(주소 없음=정보 없음, 거짓 표시 금지).
    private(set) var currentAddress: String?
    /// "현재 위치 사용" 강제 재측위 진행 신호. 필드 라벨 전환이 유일한 진행 표시.
    private(set) var isRefreshingCurrent = false
    private var hasLoadedCurrentAddress = false

    private let service = RouteService(client: APIClient(baseURL: AppConfig.apiBaseURL))
    private let searchService = SearchService(client: APIClient(baseURL: AppConfig.apiBaseURL))
    private var queryTask: Task<Void, Never>?
    /// 재진입 가드(웹 in-flight ref 미러): 진행 중 재탭은 무시(disabled 금지 계약의 짝).
    private var isInFlight = false

    init(prefilledDestination: DirectionsEndpoint? = nil) {
        from = .current
        to = prefilledDestination
    }

    var isBusy: Bool { phase == .locating || phase == .loading }

    func endpoint(for target: DirectionsFieldTarget) -> DirectionsEndpoint? {
        target == .from ? from : to
    }

    /// 필드 확정은 항상 엔드포인트 전체 교체(원자). 이전 결과는 새 질의와 무관해져 폐기.
    func setEndpoint(_ endpoint: DirectionsEndpoint, for target: DirectionsFieldTarget) {
        if target == .from { from = endpoint } else { to = endpoint }
        recordRecent(endpoint)
        clearResults()
    }

    /// 출발↔도착 원자 교환(웹 swapFields 동형, 미확정 nil도 그대로 교환). 기록 없음
    /// (스펙 §5 — 재배치일 뿐 새 확정이 아니다).
    func swap() {
        (from, to) = (to, from)
        clearResults()
    }

    /// 최근 장소 기록(스펙 2026-07-26): 확정 단일 경로(setEndpoint)에서만
    /// `.place`를 기록한다("현재 위치" 제외 — 좌표가 매번 바뀌어 기록 의미가 없다).
    /// 프리필 도착지 기록은 `GildongmuApp.consumeDirectionsPrefill`이 담당한다
    /// (init은 App body 재평가마다 반복 호출되어 여기서 기록하면 삭제된 최근 장소가
    /// 부활하는 부수효과가 있었다 — 스펙 §5 삭제 계약 위반, 2026-07-26 리뷰 수정).
    private func recordRecent(_ endpoint: DirectionsEndpoint?) {
        if case .place(let label, let lat, let lng) = endpoint {
            RecentSearchStore().recordEndpoint(RecentEndpoint(label: label, lat: lat, lng: lng))
        }
    }

    /// 필드가 바뀌면 이전 결과·상태 문구를 폐기하고 진행 중이던 조회를 취소한다(웹
    /// setResults(null) 동형 + 늦은 응답이 초기화 화면을 되채우고 거짓 통지·포커스
    /// 점프를 내는 경합 차단). performQuery의 기존 guard !Task.isCancelled 가드들이
    /// 취소 신호를 받아 stale write(결과·통지·포커스)를 막는다.
    private func clearResults() {
        queryTask?.cancel()
        isInFlight = false
        results = nil
        phase = .idle
    }

    /// 화면 이탈·epoch 재생성 시 진행 조회 폐기(I2 계약: 뷰 로컬 상태 + 명시 cancel).
    /// 탭 전환 취소 후 재진입 시 조회 버튼 고착 방지(취소된 태스크는 말미 가드로 리셋 불가).
    func cancel() {
        queryTask?.cancel()
        isInFlight = false
    }

    /// 이미 위치가 허용된 세션에서만 조용히 주소를 병기한다(탭 진입만으론 권한 팝업
    /// 금지 — coordinateIfAuthorized 관례). 미허용·실패면 라벨은 "현재 위치" 그대로.
    func loadCurrentAddressIfAuthorized() async {
        guard !hasLoadedCurrentAddress, from == .current || to == .current else { return }
        guard let coord = await LocationService.shared.coordinateIfAuthorized() else { return }
        hasLoadedCurrentAddress = true
        await syncCurrentAddress(lat: coord.lat, lng: coord.lng)
    }

    /// "현재 위치" 재선택(F-B) = 강제 재측위 + 주소 새로고침. 진행 신호는 필드 라벨
    /// 전환뿐이고 갱신 신호는 라벨(주소)의 변화 자체(별도 통지 중복 금지). 재측위
    /// 실패는 조용히 직전 라벨 유지(새로고침=재조회이지 데이터 포기 아님).
    func refreshCurrentLocation() {
        if isRefreshingCurrent { return }
        isRefreshingCurrent = true
        Task {
            defer { isRefreshingCurrent = false }
            guard let coord = try? await LocationService.shared.currentCoordinate(force: true) else { return }
            hasLoadedCurrentAddress = true
            await syncCurrentAddress(lat: coord.lat, lng: coord.lng)
        }
    }

    /// 좌표의 대표 주소를 라벨 병기용으로 동기화. 역지오코딩 실패·매칭 없음은 nil로
    /// 정직하게 비운다(옛 좌표의 주소를 남기지 않는다). 주소는 부가 정보라 조회
    /// 흐름은 어떤 경우에도 막지 않는다.
    private func syncCurrentAddress(lat: Double, lng: Double) async {
        currentAddress = (try? await searchService.reverseGeocode(lat: lat, lng: lng)) ?? nil
    }

    func runQuery() {
        if isInFlight { return }
        guard let from, let to else {
            phase = .needEndpoints
            announce(appLocalized("directions.needEndpoints"))
            return
        }
        isInFlight = true
        queryTask = Task {
            await performQuery(from: from, to: to)
            // 취소된(옛) 태스크가 뒤늦게 깨어나 그 사이 clearResults가 이미 리셋했거나
            // 새로 시작된 조회의 isInFlight를 덮어쓰지 않도록.
            guard !Task.isCancelled else { return }
            isInFlight = false
        }
    }

    private func performQuery(from: DirectionsEndpoint, to: DirectionsEndpoint) async {
        results = nil
        // 현재 위치 endpoint는 조회 시점에 측위(권한 팝업도 이 시점, 캐시 좌표 재사용).
        var current: (lat: Double, lng: Double)?
        if from == .current || to == .current {
            phase = .locating
            do {
                current = try await LocationService.shared.currentCoordinate()
                // 측위 성공 → 라벨 병기 주소도 그 좌표로 동기화(표시 전용, 조회 흐름과
                // 독립인 비구조 태스크 — clearResults의 조회 취소에 안 딸려간다).
                if let acquired = current {
                    hasLoadedCurrentAddress = true
                    Task { await self.syncCurrentAddress(lat: acquired.lat, lng: acquired.lng) }
                }
            } catch {
                guard !Task.isCancelled else { return }
                // 거부와 취득 실패는 다른 문장(3-state): 거부는 설정 경로, 실패는 검색 우회 안내.
                if case .denied = error {
                    phase = .geoDenied
                    announce(appLocalized("ios.common.geoDeniedDesc"))
                } else {
                    phase = .geoError
                    announce(appLocalized("directions.geoError"))
                }
                return
            }
        }
        guard !Task.isCancelled,
              let origin = coordinate(of: from, current: current),
              let dest = coordinate(of: to, current: current) else { return }
        phase = .loading

        // 3수단 병렬. 도보는 앱 언어 ko 전용(웹 prefersEnglish 분기 동형, 조회 자체 생략).
        let includeWalk = AppLanguage.current == "ko"
        let lang = AppLanguage.dataLocale
        let service = self.service
        async let transitSettled = Self.settleTransit(service, origin: origin, dest: dest)
        async let walkSettled = Self.settleWalk(service, include: includeWalk, origin: origin, dest: dest)
        async let carSettled = Self.settleCar(service, origin: origin, dest: dest, lang: lang)
        let (transit, walk, car) = await (transitSettled, walkSettled, carSettled)
        guard !Task.isCancelled else { return }

        var outcomes: [DirectionsMode: DirectionsModeOutcome] = [
            .transit: DirectionsOutcomeClassifier.classify(transit: transit),
            .car: DirectionsOutcomeClassifier.classify(car: car),
        ]
        if let walk { outcomes[.walk] = DirectionsOutcomeClassifier.classify(walk: walk) }

        let built = DirectionsResults(outcomes: outcomes)
        results = built
        phase = .settled(successCount: built.successCount)
        resultsRevision += 1
        // 완료 통지는 합산 1문장뿐(수단별 개별 통지 금지). 포커스 이동은 뷰가 revision으로.
        announce(built.successCount > 0
            ? appLocalized("directions.readySummary", String(built.successCount))
            : appLocalized("directions.allFailed"))
    }

    private func coordinate(
        of endpoint: DirectionsEndpoint, current: (lat: Double, lng: Double)?
    ) -> (lat: Double, lng: Double)? {
        switch endpoint {
        case .current: current
        case .place(_, let lat, let lng): (lat: lat, lng: lng)
        }
    }

    private func announce(_ message: String) {
        AccessibilityNotification.Announcement(message).post()
    }

    // 수단별 settle 래퍼: 실패를 throw 대신 Result로 뭉쳐 병렬 소비를 단순화(웹 fetchMode 동형).

    nonisolated private static func settleTransit(
        _ service: RouteService, origin: (lat: Double, lng: Double), dest: (lat: Double, lng: Double)
    ) async -> Result<TransitRouteResult?, any Error> {
        do {
            return .success(try await withQueryTimeout {
                try await service.transit(originLat: origin.lat, originLng: origin.lng, destLat: dest.lat, destLng: dest.lng)
            })
        } catch { return .failure(error) }
    }

    nonisolated private static func settleWalk(
        _ service: RouteService, include: Bool, origin: (lat: Double, lng: Double), dest: (lat: Double, lng: Double)
    ) async -> Result<WalkRouteBriefing?, any Error>? {
        guard include else { return nil }
        do {
            return .success(try await withQueryTimeout {
                try await service.walk(originLat: origin.lat, originLng: origin.lng, destLat: dest.lat, destLng: dest.lng)
            })
        } catch { return .failure(error) }
    }

    nonisolated private static func settleCar(
        _ service: RouteService, origin: (lat: Double, lng: Double), dest: (lat: Double, lng: Double), lang: String
    ) async -> Result<CarRouteBriefing, any Error> {
        do {
            return .success(try await withQueryTimeout {
                try await service.car(originLat: origin.lat, originLng: origin.lng, destLat: dest.lat, destLng: dest.lng, lang: lang)
            })
        } catch { return .failure(error) }
    }
}

/// 길찾기 탭 본체(Task I3, 스펙 §6). 웹 DirectionsView 동형 계약:
/// - 필드는 탭→검색 시트 선택(원자 확정), 스왑은 두 필드 원자 교환.
/// - 조회 버튼은 disabled 금지: 라벨 전환("경로 조회"→"조회 중")+모델 가드(포커스 유지).
/// - 결과는 수단 고정 순서(대중교통→자동차→도보) 섹션, 수단 heading `.isHeader`.
///   수단별 3-state(경로 없음≠오류) + 게이트 404는 섹션 자체 미노출.
/// - 완료 시 단일 Announcement(합산 1문장) + 첫 성공 수단 heading 포커스(0건이면 이동 없음).
struct DirectionsTabView: View {
    @State private var model: DirectionsModel
    @State private var searchTarget: DirectionsFieldTarget?
    @AccessibilityFocusState private var focusedModeHeading: DirectionsMode?

    /// I4 프리필 지점: 장소 상세 "여기까지 길찾기"가 도착지를 넘긴다(파라미터 하나).
    init(prefilledDestination: DirectionsEndpoint? = nil) {
        _model = State(initialValue: DirectionsModel(prefilledDestination: prefilledDestination))
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button(fieldText(.from)) { searchTarget = .from }
                    Button(appLocalized("directions.swap")) { model.swap() }
                    Button(fieldText(.to)) { searchTarget = .to }
                    Button(submitText) { model.runQuery() }
                    // 시각 상태 표시(통지는 모델의 단일 Announcement가 담당, live 복제 아님)
                    if !statusText.isEmpty {
                        Text(statusText)
                            .foregroundStyle(.secondary)
                    }
                }
                if let results = model.results {
                    ForEach(results.displayedModes, id: \.self) { mode in
                        Section {
                            outcomeRows(mode, results.outcomes[mode])
                        } header: {
                            Text(headingText(mode))
                                .accessibilityAddTraits(.isHeader)
                                .accessibilityFocused($focusedModeHeading, equals: mode)
                        }
                    }
                }
            }
            .navigationTitle(appLocalized("ios.tab.directions"))
            .navigationBarTitleDisplayMode(.inline)
            .gildongmuTitleMenu()
            .sheet(item: $searchTarget) { target in
                DirectionsEndpointSearchView(target: target) { endpoint in
                    model.setEndpoint(endpoint, for: target)
                    // "현재 위치 사용" 선택은 강제 재측위 + 주소 새로고침 트리거(F-B).
                    if endpoint == .current { model.refreshCurrentLocation() }
                }
            }
            // 완료 시 첫 성공 수단 heading으로 1회 포커스(성공 0건이면 nil 대입 = 이동 없음).
            .onChange(of: model.resultsRevision) { focusedModeHeading = model.results?.firstSuccess }
            // 탭 전환·epoch 재생성 시 진행 조회 폐기(늦은 응답이 초기화 화면을 되채우는 경합 차단).
            .onDisappear { model.cancel() }
            // 이미 허용된 세션이면 진입 시 조용히 현재 위치 주소를 병기(권한 팝업 없음).
            .task { await model.loadCurrentAddressIfAuthorized() }
        }
    }

    /// 필드 한 줄 = 한 객체: "출발지, 현재 위치"처럼 라벨+값 단일 텍스트(쉼표 결합).
    /// 미확정 필드는 검색 유도 라벨이 곧 버튼 이름.
    private func fieldText(_ target: DirectionsFieldTarget) -> String {
        let label = target == .from ? appLocalized("directions.from") : appLocalized("directions.to")
        switch model.endpoint(for: target) {
        case .current:
            return "\(label), \(currentLocationText)"
        case .place(let name, _, _):
            return "\(label), \(name)"
        case nil:
            return target == .from ? appLocalized("directions.searchFrom") : appLocalized("directions.searchTo")
        }
    }

    /// 현재 위치 값 텍스트(F-B): 재측위 중 → 진행 라벨, 주소 확보 → 주소 병기,
    /// 그 외 기본 "현재 위치". 한 줄 = 한 객체(필드 버튼 단일 텍스트에 흡수).
    private var currentLocationText: String {
        if model.isRefreshingCurrent { return appLocalized("directions.refreshingCurrent") }
        if let address = model.currentAddress {
            return appLocalized("directions.currentLocationNear", address)
        }
        return appLocalized("directions.currentLocation")
    }

    /// 진행 중 라벨 전환이 상태 신호(채팅 보내기 버튼 관례, disabled 금지).
    private var submitText: String {
        model.isBusy ? appLocalized("ios.directions.searching") : appLocalized("directions.submit")
    }

    private var statusText: String {
        switch model.phase {
        case .idle: ""
        case .needEndpoints: appLocalized("directions.needEndpoints")
        case .locating: appLocalized("directions.locating")
        case .loading: appLocalized("directions.loading")
        case .geoDenied: appLocalized("ios.common.geoDeniedDesc")
        case .geoError: appLocalized("directions.geoError")
        case .settled(let count):
            count > 0 ? appLocalized("directions.readySummary", String(count)) : appLocalized("directions.allFailed")
        }
    }

    private func headingText(_ mode: DirectionsMode) -> String {
        switch mode {
        case .transit: appLocalized("route.public")
        case .walk: appLocalized("route.pedestrian.heading")
        case .car: appLocalized("route.car")
        }
    }

    private func errorText(_ mode: DirectionsMode) -> String {
        switch mode {
        case .transit: appLocalized("route.transit.error")
        case .walk: appLocalized("route.pedestrian.error")
        case .car: appLocalized("route.briefing.error")
        }
    }

    /// car는 경로 없음 상태가 없어(브리핑 직접 응답, empty 미생성) 도달하지 않는다.
    private func noRouteText(_ mode: DirectionsMode) -> String {
        switch mode {
        case .transit: appLocalized("route.transit.noRoute")
        case .walk, .car: appLocalized("route.pedestrian.noRoute")
        }
    }

    /// 수단 섹션 본문. 대중교통은 추천 경로만(웹 동형, 대안은 브리핑 단독 화면 전용).
    @ViewBuilder
    private func outcomeRows(_ mode: DirectionsMode, _ outcome: DirectionsModeOutcome?) -> some View {
        switch outcome {
        case .transit(let result): TransitRouteRows(route: result.recommended)
        case .walk(let briefing): WalkRouteRows(briefing: briefing)
        case .car(let briefing): CarRouteRows(briefing: briefing)
        case .empty: Text(noRouteText(mode))
        case .error: Text(errorText(mode))
        case .gated, nil: EmptyView()  // displayedModes가 걸러 도달하지 않는다
        }
    }
}
