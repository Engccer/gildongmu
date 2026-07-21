import SwiftUI
import Observation
import Accessibility
import GildongmuKit

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

    private let service = RouteService(client: APIClient(baseURL: AppConfig.apiBaseURL))
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
        clearResults()
    }

    /// 출발↔도착 원자 교환(웹 swapFields 동형, 미확정 nil도 그대로 교환).
    func swap() {
        (from, to) = (to, from)
        clearResults()
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
/// - 결과는 수단 고정 순서(대중교통→도보→자동차) 섹션, 수단 heading `.isHeader`.
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
                }
            }
            // 완료 시 첫 성공 수단 heading으로 1회 포커스(성공 0건이면 nil 대입 = 이동 없음).
            .onChange(of: model.resultsRevision) { focusedModeHeading = model.results?.firstSuccess }
            // 탭 전환·epoch 재생성 시 진행 조회 폐기(늦은 응답이 초기화 화면을 되채우는 경합 차단).
            .onDisappear { model.cancel() }
        }
    }

    /// 필드 한 줄 = 한 객체: "출발지, 현재 위치"처럼 라벨+값 단일 텍스트(쉼표 결합).
    /// 미확정 필드는 검색 유도 라벨이 곧 버튼 이름.
    private func fieldText(_ target: DirectionsFieldTarget) -> String {
        let label = target == .from ? appLocalized("directions.from") : appLocalized("directions.to")
        switch model.endpoint(for: target) {
        case .current:
            return "\(label), \(appLocalized("directions.currentLocation"))"
        case .place(let name, _, _):
            return "\(label), \(name)"
        case nil:
            return target == .from ? appLocalized("directions.searchFrom") : appLocalized("directions.searchTo")
        }
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
