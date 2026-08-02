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
        case idle, needEndpoints, locating, loading, geoDenied, geoReduced, geoError
        case outOfCoverage  // 서비스 지역 밖 — 실패 아님, spec 2026-07-29
        case settled(successCount: Int)
    }

    private(set) var from: DirectionsEndpoint?
    private(set) var to: DirectionsEndpoint?
    private(set) var phase: Phase = .idle
    private(set) var results: DirectionsResults?
    /// 조회 완료 세대. 뷰가 포커스 이동 시점을 아는 신호(SearchModel.resultsRevision 동형).
    private(set) var resultsRevision = 0
    /// 이 세션에서 조회를 한 번이라도 마쳤는가. `results`는 필드 변경·재조회 시작에
    /// 폐기되지만(clearResults·performQuery 첫 줄), **거리 추적 섹션의 노출 조건은
    /// "지금 결과가 있는가"가 아니라 "목적지가 확정됐는가"**다. results로 판정하면
    /// 추적 중 출발지를 바꾸거나 재조회하는 순간 중지 버튼이 화면에서 사라져
    /// 탭 이탈 말고는 멈출 방법이 없어진다(리뷰 C-1).
    private(set) var hasQueriedOnce = false
    /// 계단 회피(도보 전용) 토글 상태(웹 stepFreeEnabled 미러). 조회 전 토글은 상태만
    /// 바꿔 다음 조회에 반영, 조회 후 토글은 도보만 재조회한다(toggleStepFree).
    private(set) var stepFreeEnabled = false
    /// 토글 재조회 진행 신호(웹 stepFreeBusy 미러). isBusy에 합산되어 그 15초 창에서도
    /// 조회 버튼이 같은 "조회 중" 라벨을 낸다(멀쩡해 보이는데 무시되는 버튼 방지).
    private(set) var stepFreeBusy = false
    /// 도보 단독 재조회 완료 세대. 뷰가 도보 heading으로 포커스를 옮기는 신호
    /// (resultsRevision과 분리 — 전체 조회는 첫 성공 수단, 토글 재조회는 항상 도보).
    private(set) var walkRefetchRevision = 0
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
    /// 토글 재조회도 **같은** 가드를 공유한다(웹 계약 동형) — 분리하면 토글끼리의
    /// 연타만 막고 "조회"와의 교차 레이스는 못 막는다.
    private var isInFlight = false
    /// 직전 조회에 쓴 해석 좌표(웹 lastCoordsRef 미러). 토글 재조회가 재측위 없이 재사용.
    private var lastCoords: (origin: (lat: Double, lng: Double), dest: (lat: Double, lng: Double))?

    init(prefilledDestination: DirectionsEndpoint? = nil) {
        from = .current
        to = prefilledDestination
    }

    var isBusy: Bool { phase == .locating || phase == .loading || stepFreeBusy }

    func endpoint(for target: DirectionsFieldTarget) -> DirectionsEndpoint? {
        target == .from ? from : to
    }

    /// 필드 확정은 항상 엔드포인트 전체 교체(원자). 이전 결과는 새 질의와 무관해져 폐기.
    func setEndpoint(_ endpoint: DirectionsEndpoint, for target: DirectionsFieldTarget) {
        if target == .from { from = endpoint } else { to = endpoint }
        recordRecent(endpoint, scope: target == .from ? .from : .to)
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
    /// 출발지·도착지는 분리 스코프 저장(위원장 지시 2026-07-26 — 공유 목록 폐기).
    /// 프리필 도착지 기록은 `GildongmuApp.consumeDirectionsPrefill`이 담당한다
    /// (init은 App body 재평가마다 반복 호출되어 여기서 기록하면 삭제된 최근 장소가
    /// 부활하는 부수효과가 있었다 — 스펙 §5 삭제 계약 위반, 2026-07-26 리뷰 수정).
    private func recordRecent(_ endpoint: DirectionsEndpoint?, scope: RecentEndpointScope) {
        if case .place(let label, let lat, let lng) = endpoint {
            RecentSearchStore().recordEndpoint(RecentEndpoint(label: label, lat: lat, lng: lng), scope: scope)
        }
    }

    /// 필드가 바뀌면 이전 결과·상태 문구를 폐기하고 진행 중이던 조회를 취소한다(웹
    /// setResults(null) 동형 + 늦은 응답이 초기화 화면을 되채우고 거짓 통지·포커스
    /// 점프를 내는 경합 차단). performQuery의 기존 guard !Task.isCancelled 가드들이
    /// 취소 신호를 받아 stale write(결과·통지·포커스)를 막는다.
    private func clearResults() {
        queryTask?.cancel()
        isInFlight = false
        stepFreeBusy = false
        results = nil
        phase = .idle
    }

    /// 화면 이탈·epoch 재생성 시 진행 조회 폐기(I2 계약: 뷰 로컬 상태 + 명시 cancel).
    /// 탭 전환 취소 후 재진입 시 조회 버튼 고착 방지(취소된 태스크는 말미 가드로 리셋 불가).
    func cancel() {
        queryTask?.cancel()
        isInFlight = false
        stepFreeBusy = false
    }

    /// 이미 위치가 허용된 세션에서만 조용히 주소를 병기한다(탭 진입만으론 권한 팝업
    /// 금지 — coordinateForDisplay 관례). 미허용·실패면 라벨은 "현재 위치" 그대로.
    func loadCurrentAddressIfAuthorized() async {
        guard !hasLoadedCurrentAddress, from == .current || to == .current else { return }
        guard let coord = await LocationService.shared.coordinateForDisplay() else { return }
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
                // 좌표 해석 시점 선분기 — 현재 위치가 서비스 지역 밖이면 조회 자체를
                // 중단한다(수단별 fetch·주소 동기화 전부 생략). 오류가 아니라 커버리지
                // 안내이므로 일반 phase로 표기(웹 DirectionsView 동형).
                if let acquired = current, !isInKorea(lat: acquired.lat, lng: acquired.lng) {
                    phase = .outOfCoverage
                    announce(appLocalized("ios.common.outOfCoverage"))
                    return
                }
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
                } else if case .reducedAccuracy = error {
                    // 권한은 있으나 정밀 위치가 꺼진 상태. `geoDenied`를 재사용하면
                    // 통지는 "정확한 위치를 켜"인데 화면에 남는 지속 텍스트는 "위치
                    // 접근을 허용해"가 되어, 통지가 흘러간 뒤 커서를 상태 줄에 두면
                    // 이미 켜 둔 권한을 다시 찾으러 간다(지속 텍스트가 정본이다).
                    phase = .geoReduced
                    announce(appLocalized("ios.common.geoReducedDesc"))
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
        lastCoords = (origin: origin, dest: dest)
        phase = .loading

        // 3수단 병렬. 도보는 앱 언어 ko 전용(웹 prefersEnglish 분기 동형, 조회 자체 생략).
        let includeWalk = AppLanguage.current == "ko"
        let lang = AppLanguage.dataLocale
        let service = self.service
        let accessible = stepFreeEnabled
        async let transitSettled = Self.settleTransit(service, origin: origin, dest: dest)
        async let walkSettled = Self.settleWalk(service, include: includeWalk, origin: origin, dest: dest, accessible: accessible)
        async let carSettled = Self.settleCar(service, origin: origin, dest: dest, lang: lang)
        let (transit, walk, car) = await (transitSettled, walkSettled, carSettled)
        guard !Task.isCancelled else { return }

        var outcomes: [DirectionsMode: DirectionsModeOutcome] = [
            .transit: DirectionsOutcomeClassifier.classify(transit: transit),
            .car: DirectionsOutcomeClassifier.classify(car: car),
        ]
        if let walk { outcomes[.walk] = DirectionsOutcomeClassifier.classify(walk: walk) }

        // 서버 마커 이중 방어 — 위 "cur" 선분기를 통과했어도 place 종단점(검색 선택)이
        // 한국 밖일 수 있다. 한 수단이라도 감지하면 나머지 결과를 버리고 화면 전체를 전환한다.
        if outcomes.values.contains(where: { $0.isOutOfCoverage }) {
            phase = .outOfCoverage
            announce(appLocalized("ios.common.outOfCoverage"))
            return
        }

        let built = DirectionsResults(outcomes: outcomes)
        results = built
        phase = .settled(successCount: built.successCount)
        hasQueriedOnce = true
        resultsRevision += 1
        // 완료 통지는 합산 1문장뿐(수단별 개별 통지 금지). 포커스 이동은 뷰가 revision으로.
        announce(built.successCount > 0
            ? appLocalized("directions.readySummary", String(built.successCount))
            : appLocalized("directions.allFailed"))
    }

    /// 계단 회피 토글(웹 toggleStepFree 동형): 이미 조회된 결과가 있으면 도보만 새
    /// 상태로 재조회하고(대중교통·자동차 유지), 조회 전이면 상태만 바꿔 다음 조회에
    /// 반영한다. 재조회는 "조회"와 같은 isInFlight·queryTask를 공유해 교차 레이스가
    /// 구조적으로 불가능하다(진행 중 재탭은 상태 변화 없이 무시 — 토글 시각값도 불변).
    func toggleStepFree() {
        if isInFlight { return }
        stepFreeEnabled.toggle()
        guard results != nil, let coords = lastCoords else { return }
        isInFlight = true
        stepFreeBusy = true
        queryTask = Task {
            await refetchWalk(origin: coords.origin, dest: coords.dest)
            guard !Task.isCancelled else { return }
            isInFlight = false
            stepFreeBusy = false
        }
    }

    private func refetchWalk(origin: (lat: Double, lng: Double), dest: (lat: Double, lng: Double)) async {
        let service = self.service
        let accessible = stepFreeEnabled
        let settled = await Self.settleWalk(service, include: true, origin: origin, dest: dest, accessible: accessible)
        guard !Task.isCancelled, let settled, let current = results else { return }
        // lastCoords는 이미 커버리지 검증을 통과한 좌표라 재조회에서 서버 마커가 다시
        // 뜰 일은 사실상 없다 — 그래도 도달 시 화면 전체 전환 대신 도보 오류로 안내한다
        // (웹 동형: 부분 재조회가 다른 수단 결과까지 버리게 하지 않는다).
        var outcome = DirectionsOutcomeClassifier.classify(walk: settled)
        if outcome.isOutOfCoverage { outcome = .error }
        var outcomes = current.outcomes
        outcomes[.walk] = outcome
        results = DirectionsResults(outcomes: outcomes)
        // 재조회 완료 신호는 도보 heading 포커스 이동뿐(웹 동형, 별도 통지 중복 금지).
        walkRefetchRevision += 1
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
        _ service: RouteService, include: Bool, origin: (lat: Double, lng: Double), dest: (lat: Double, lng: Double),
        accessible: Bool
    ) async -> Result<WalkRouteBriefing?, any Error>? {
        guard include else { return nil }
        do {
            return .success(try await withQueryTimeout {
                try await service.walk(
                    originLat: origin.lat, originLng: origin.lng, destLat: dest.lat, destLng: dest.lng,
                    accessible: accessible)
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
    /// 펼쳐진 대중교통 대안 인덱스(웹 expandedAlts 동형). 새 조회 결과는 다른
    /// 경로들이므로 resultsRevision 변화 시 초기화한다.
    @State private var expandedAlts: Set<Int> = []
    @State private var beacon = BeaconModel()
    @Environment(\.scenePhase) private var scenePhase
    /// 시트에서 끝점을 확정한 뒤 포커스를 보낼 곳(웹 `focusAfterResolve` 대응).
    /// 실기기 확인(2026-08-02): 시트가 닫히면 VO 커서가 **화면 최상단으로 이탈**한다.
    /// 사용자는 방금 고른 다음 행동 지점(도착지 입력·조회 버튼)까지 다시 스와이프해
    /// 내려가야 한다. 취소로 닫으면 콜백이 안 오므로 nil이고, 그때는 iOS 기본
    /// 복원 동작에 맡긴다(재현되지 않은 것을 손대지 않는다).
    @AccessibilityFocusState private var focusedEndpointField: DirectionsFieldTarget?
    @AccessibilityFocusState private var submitFocused: Bool
    @State private var focusAfterResolve: DirectionsFieldTarget?
    /// 추적 시트가 닫힌 뒤 돌아갈 자리. 시트 dismiss가 VO 커서를 화면 최상단으로
    /// 떨어뜨리는 것은 이 저장소에서 실기기로 확인된 사실이다.
    @AccessibilityFocusState private var beaconStartFocused: Bool

    /// I4 프리필 지점: 장소 상세 "여기까지 길찾기"가 도착지를 넘긴다(파라미터 하나).
    init(prefilledDestination: DirectionsEndpoint? = nil) {
        _model = State(initialValue: DirectionsModel(prefilledDestination: prefilledDestination))
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button(fieldText(.from)) { searchTarget = .from }
                        .accessibilityFocused($focusedEndpointField, equals: .from)
                    Button(appLocalized("directions.swap")) { model.swap() }
                    Button(fieldText(.to)) { searchTarget = .to }
                        .accessibilityFocused($focusedEndpointField, equals: .to)
                    Button(submitText) { model.runQuery() }
                        .accessibilityFocused($submitFocused)
                    // 시각 상태 표시(통지는 모델의 단일 Announcement가 담당, live 복제 아님)
                    if !statusText.isEmpty {
                        Text(statusText)
                            .foregroundStyle(.secondary)
                    }
                    // "설정 앱에서 …" 안내에는 해결 버튼을 함께(NearbyOverlay 동형).
                    // ⚠ reduced는 설정 열기가 아니라 그 자리 시스템 팝업이다.
                    // openSettingsURLString이 여는 화면에는 정확한 위치 토글이 없다
                    // (위원장 실기기 확인 2026-08-02).
                    if model.phase == .geoDenied {
                        Button(appLocalized("ios.common.openSettings")) { openAppSettings() }
                    }
                    if model.phase == .geoReduced {
                        Button(appLocalized("ios.common.allowPrecise")) {
                            Task { @MainActor in
                                switch await LocationService.shared.requestTemporaryPreciseAccuracy() {
                                case .granted: model.runQuery()
                                case .denied:
                                    AccessibilityNotification.Announcement(appLocalized("ios.common.geoReducedDesc")).post()
                                case .alreadyInFlight: break
                                }
                            }
                        }
                    }
                }
                // 목적지 거리 추적. 수단 섹션들보다 **앞**에 둔다 — 도보 섹션은
                // 인라인 전개라 수백 행이 될 수 있어(천호역 실측) 뒤에 두면 선형 주파
                // 비용이 몇 행에서 수백 행으로 뒤집힌다. 조회 완료 시 포커스가 첫 성공
                // 수단 heading으로 가므로 거기서 heading 로터 1회면 닿는다.
                //
                // 노출 조건은 경로 성공 여부가 아니라 **목적지 확정 여부**다. 수단 조회가
                // 전부 실패해도 목적지 좌표는 확정돼 있고, 경로를 못 찾은 상황일수록
                // 방향 감각이 더 필요하다. 도착지가 "현재 위치"면 무의미하므로 숨긴다.
                // 노출 조건은 "지금 결과가 있는가"가 아니라 "조회를 한 번 마쳤는가"다.
                // 추적 중이면 결과·목적지 상태와 무관하게 항상 렌더한다(중지 수단을
                // 화면에서 빼앗지 않기 위한 이중 방어).
                if beacon.isTracking || (model.hasQueriedOnce && trackedDestination != nil),
                   let tracked = trackedDestination {
                    Section {
                        // 추적이 시작되면 시트가 이 화면을 덮으므로 아래 컨트롤은 닿을 수
                        // 없다. 그래도 라벨·동작을 토글로 두는 것은 이중 방어다. 시트가
                        // 어떤 이유로 뜨지 않아도 중지 수단이 화면에 남는다(리뷰 C-1).
                        Button(beacon.isTracking
                            ? appLocalized("beacon.stop") : appLocalized("beacon.start")
                        ) {
                            beacon.toggle(dest: tracked.dest, label: tracked.label)
                        }
                        .accessibilityFocused($beaconStartFocused)
                        // 가시 상태 1줄. VoiceOver를 끈 사용자에게도 변화가 보여야 한다
                        // (라벨만 바뀌고 화면이 그대로면 심사에서 무반응으로 보인다).
                        // 추적 중 상태는 시트가 보여주므로 여기선 비추적 상태만이다. 권한
                        // 거부·위치 서비스 꺼짐은 시트가 아예 뜨지 않는 경로다.
                        if !beacon.isTracking, !beacon.statusText.isEmpty {
                            distanceText(beacon.statusText).foregroundStyle(.secondary)
                            // 해결 수단이 있는 실패에만 노출. reduced는 그 자리 시스템
                            // 팝업이고, 허용되면 같은 목적지로 즉시 재시작한다.
                            switch beacon.failResolution {
                            case .settings:
                                Button(appLocalized("ios.common.openSettings")) { openAppSettings() }
                            case .precise:
                                Button(appLocalized("ios.common.allowPrecise")) {
                                    Task { @MainActor in
                                        switch await LocationService.shared.requestTemporaryPreciseAccuracy() {
                                        case .granted: beacon.toggle(dest: tracked.dest, label: tracked.label)
                                        case .denied:
                                            AccessibilityNotification.Announcement(appLocalized("ios.common.geoReducedDesc")).post()
                                        case .alreadyInFlight: break
                                        }
                                    }
                                }
                            case .none:
                                EmptyView()
                            }
                        }
                        Text(appLocalized("beacon.straightLineNote"))
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } header: {
                        // 무엇을 추적 중인지가 화면에 있어야 한다. 웹은 장소 상세 안이라
                        // 바로 위 heading이 장소명이었지만 길찾기 결과엔 그 맥락이 없다.
                        Text(joinText(appLocalized("beacon.heading"), tracked.label))
                            .accessibilityAddTraits(.isHeader)
                    }
                }
                if let results = model.results {
                    ForEach(results.displayedModes, id: \.self) { mode in
                        Section {
                            // 계단 회피 토글은 도보 섹션에만(웹 동형 — 결과 유무·오류와
                            // 무관하게 섹션이 보이면 노출). 켬/끔 낭독이 상태 신호이고,
                            // 재조회 중엔 라벨에 "조회 중"을 병기한다(웹 aria-busy 대응 —
                            // 방금 조작한 요소가 스스로 진행을 확인시키는 라벨 전환 관례).
                            if mode == .walk {
                                Toggle(stepFreeToggleText, isOn: Binding(
                                    get: { model.stepFreeEnabled },
                                    set: { _ in model.toggleStepFree() }
                                ))
                            }
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
                    // 확정으로 닫힐 때만 착지점을 예약한다(취소는 콜백이 없다).
                    focusAfterResolve = target
                }
            }
            // 추적 중 화면. 표시 여부를 `isTracking`에 직접 묶어 **중지 = 닫힘**을
            // 1:1로 만든다. 권한 거부처럼 추적이 시작되지 않는 경로는 이 시트가 아예
            // 뜨지 않고 위 인라인 상태 줄이 사유를 말한다.
            //
            // 위 검색 시트와 동시에 뜰 수 없다: 추적 중에는 이 시트가 화면을 덮어
            // 끝점 버튼에 닿을 수 없고, 시작하려면 검색 시트가 닫혀 있어야 한다.
            .sheet(isPresented: Binding(
                get: { beacon.isTracking },
                // 스와이프·VoiceOver escape로 닫는 경로. 중지와 같은 처리를 해야
                // "닫혔는데 추적은 살아 있는" 좀비 상태가 생기지 않는다.
                set: { presented in
                    guard !presented else { return }
                    beacon.stop(playStopTone: true)
                }
            )) {
                // 목적지 이름을 뷰의 `trackedDestination`이 아니라 **모델**에서 읽는다.
                // 도착지가 "현재 위치"로 바뀌면 뷰 쪽 값은 nil이 되는데 같은 변화가
                // 추적도 멈추므로, 뷰에서 파생하면 닫히는 길에 빈 시트가 한 프레임 스친다.
                BeaconTrackingSheet(
                    model: beacon,
                    onStop: { beacon.stop(playStopTone: true) }
                )
            }
            // 시트가 닫히면 시작 버튼으로 돌려보낸다(방금 떠나온 자리).
            .onChange(of: beacon.isTracking) { _, tracking in
                guard !tracking else { return }
                landBeaconStartFocus()
            }
            // 완료 시 첫 성공 수단 heading으로 1회 포커스(성공 0건이면 nil 대입 = 이동 없음).
            // 조회 완료 시 **포커스를 옮기지 않는다**(위원장 판정 2026-08-02).
            // 종전엔 첫 성공 수단 heading으로 보냈는데, 거리 추적 섹션이 조회 버튼과
            // 수단 섹션 **사이**에 생기면서 그 점프가 섹션을 통째로 건너뛰게 됐다.
            // 조회 버튼에 머물면 다음 스와이프가 상태 → 거리 추적 → 수단 순서로
            // 자연히 이어진다. 완료 자체는 단일 통지(수단 수 합산)가 이미 알린다.
            // ⚠ 계단 회피 토글 재조회(walkRefetchRevision)는 별개다. 사용자가 도보
            // 섹션 안에서 조작한 것이라 그 heading으로 돌려보내는 게 맞다.
            .onChange(of: model.resultsRevision) {
                expandedAlts = []
            }
            // 계단 회피 토글 재조회 완료 시엔 항상 도보 heading으로(웹 walkHeadingRef 동형).
            .onChange(of: model.walkRefetchRevision) { focusedModeHeading = .walk }
            // 탭 전환·epoch 재생성 시 진행 조회 폐기(늦은 응답이 초기화 화면을 되채우는 경합 차단).
            // 전경 전용 계약의 구현부. ⚠ 행 수준이 아니라 **화면 수준**이어야 한다 —
            // List는 lazy라 행에 붙이면 도보 안내를 읽으려 스크롤하는 순간 추적이 죽는다.
            .onDisappear {
                model.cancel()
                beacon.teardown()
            }
            // 검색 시트가 뜬 동안 톤과 통지를 모두 죽인다. 시트에 받아쓰기가 있고
            // 헌장 §6의 불변식은 "녹음 중 SR 발화 0"인데, polite 통지는 VoiceOver가
            // 실제로 말하는 음성이라 톤보다 전사 오염 위험이 크다. 추적은 유지한다.
            .onChange(of: searchTarget) {
                beacon.outputSuppressed = searchTarget != nil
                guard searchTarget == nil, let resolved = focusAfterResolve else { return }
                focusAfterResolve = nil
                landFocusAfterResolve(from: resolved)
            }
            // 목적지가 바뀌면 옛 목적지를 추적하는 창이 생긴다. resultsRevision이 아니라
            // 좌표 변화로 잡는 이유는 setEndpoint가 revision을 올리지 않기 때문이다.
            .onChange(of: model.endpoint(for: .to)) { beacon.stopBecauseDestinationChanged() }
            .onChange(of: scenePhase) { beacon.handleScenePhaseChange(to: scenePhase) }
            // 이미 허용된 세션이면 진입 시 조용히 현재 위치 주소를 병기(권한 팝업 없음).
            .task { await model.loadCurrentAddressIfAuthorized() }
        }
    }

    /// 웹 `focusAfterResolve` 계약의 iOS 판: 출발지를 고르면 도착지 입력으로,
    /// 도착지를 고르면 조회 버튼으로 보낸다(둘 다 "다음에 할 일"이다).
    ///
    /// 지연·재시도는 채팅(`ChatConversationView`)의 검증된 패턴을 따른다. 시트 dismiss
    /// 애니메이션이 끝나며 시스템이 포커스를 되돌리므로, 그보다 늦게 대입해야 이긴다.
    private func landFocusAfterResolve(from target: DirectionsFieldTarget) {
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(400))
            applyResolvedFocus(target)
            try? await Task.sleep(for: .milliseconds(600))
            // 먹지 않았으면 1회만 재시도(무한 재대입은 커서를 붙잡아 되레 방해가 된다).
            let landed = target == .from ? focusedEndpointField == .to : submitFocused
            guard !landed else { return }
            applyResolvedFocus(target)
        }
    }

    /// 추적 시트가 닫힌 뒤 시작 버튼 착지. 지연·검증·1회 재시도는 위
    /// `landFocusAfterResolve`와 같은 패턴이다(시트 dismiss 애니메이션이 끝나며
    /// 시스템이 커서를 최상단으로 되돌리므로 그보다 늦게 대입해야 이긴다).
    ///
    /// 화면을 떠나며 멈춘 경우(`onDisappear` → `teardown`)에도 불리지만, 사라진
    /// 뷰에 대한 대입은 no-op이라 따로 가르지 않는다.
    private func landBeaconStartFocus() {
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(400))
            beaconStartFocused = true
            try? await Task.sleep(for: .milliseconds(600))
            guard !beaconStartFocused else { return }
            beaconStartFocused = true
        }
    }

    private func applyResolvedFocus(_ target: DirectionsFieldTarget) {
        if target == .from {
            focusedEndpointField = .to
        } else {
            focusedEndpointField = nil
            submitFocused = true
        }
    }

    /// 거리 추적 대상. 도착지가 좌표를 가진 장소일 때만 성립한다
    /// ("현재 위치"가 목적지면 자기까지의 거리라 무의미).
    private var trackedDestination: (label: String, dest: BeaconDest)? {
        guard case .place(let label, let lat, let lng) = model.endpoint(for: .to) else { return nil }
        return (label, BeaconDest(lat: lat, lng: lng))
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

    /// 토글 재조회 중 라벨 병기(한 줄 = 한 객체, 쉼표 결합). 이 창의 재탭은 가드로
    /// 무시되므로 라벨이 유일한 진행 신호다.
    private var stepFreeToggleText: String {
        let label = appLocalized("route.pedestrian.stepFreeToggle")
        return model.stepFreeBusy ? "\(label), \(appLocalized("ios.directions.searching"))" : label
    }

    private var statusText: String {
        switch model.phase {
        case .idle: ""
        case .needEndpoints: appLocalized("directions.needEndpoints")
        case .locating: appLocalized("directions.locating")
        case .loading: appLocalized("directions.loading")
        case .geoDenied: appLocalized("ios.common.geoDeniedDesc")
        case .geoReduced: appLocalized("ios.common.geoReducedDesc")
        case .geoError: appLocalized("directions.geoError")
        case .outOfCoverage: appLocalized("ios.common.outOfCoverage")
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

    /// 수단 섹션 본문. 대중교통은 추천 경로 전체 + 대안은 요약 라벨 DisclosureGroup
    /// (웹 disclosure 버튼 동형) — 펼치면 추천 수준의 구간 상세. 라벨이 이미 요약이라
    /// 펼침 본문은 구간만(includeSummary=false, 인접 중복 금지).
    @ViewBuilder
    private func outcomeRows(_ mode: DirectionsMode, _ outcome: DirectionsModeOutcome?) -> some View {
        switch outcome {
        case .transit(let result):
            TransitRouteRows(route: result.recommended)
            ForEach(Array(result.alternatives.enumerated()), id: \.offset) { i, route in
                DisclosureGroup(isExpanded: Binding(
                    get: { expandedAlts.contains(i) },
                    set: { expanded in
                        if expanded { expandedAlts.insert(i) } else { expandedAlts.remove(i) }
                    }
                )) {
                    TransitRouteRows(route: route, includeSummary: false)
                } label: {
                    Text(joinText(
                        appLocalized("route.transit.alternativeHeading", String(i + 1)),
                        transitSummaryText(route.summary)))
                }
            }
        case .walk(let briefing): WalkRouteRows(briefing: briefing)
        case .car(let briefing): CarRouteRows(briefing: briefing)
        case .empty: Text(noRouteText(mode))
        case .error: Text(errorText(mode))
        case .gated, .outOfCoverage, nil: EmptyView()  // displayedModes가 걸러 도달하지 않는다
        }
    }
}
