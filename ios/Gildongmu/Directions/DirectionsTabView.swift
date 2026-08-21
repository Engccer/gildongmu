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

/// 길찾기 필드 식별(출발지/도착지) + 수동 위치 지정. 검색 시트 라우팅 공용
/// (`manualLocation`은 `LocationBarView`가 `DirectionsEndpointSearchView`를 재사용하는
/// 별도 진입로다 — 길찾기 탭의 from/to 상태 머신(`DirectionsModel`)과는 무관하다).
enum DirectionsFieldTarget: String, Identifiable {
    case from, to, via, manualLocation
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
    /// 경유지(N4, 선택 사항, 1개). `.place`만 — 검색 시트 `.via` 타깃은 "현재 위치 사용"
    /// 버튼을 내지 않아 `.current`가 구조적으로 들어오지 않는다. 도착지와 같은 원자 확정.
    private(set) var via: DirectionsEndpoint?
    private(set) var phase: Phase = .idle
    private(set) var results: DirectionsResults?
    /// 최단 도보 경로(M3, `alternatives=1`의 `shortest`). **`results`의 도보 결과와
    /// 같은 응답에서 온 쌍만** 함께 노출한다(spec §4 스냅샷 교체 — 다른 조회 세대의
    /// 결과를 조합하지 않는다). nil = 미조회·최단 실패 흡수·Tmap 키 부재(전부
    /// "최단 행을 그리지 않는다"로 행동이 같다).
    private(set) var walkShortest: WalkRouteBriefing?
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
    /// 최근 조회 경로(스펙 2026-08-10). 결과 없는 화면에서만 뷰가 노출한다.
    /// init 로드는 읽기 전용이라 State(initialValue:) 재평가에도 안전(기록 부수효과 금지).
    private(set) var recentRoutes: [RecentRoute]
    private let recentStore = RecentSearchStore()
    /// 도보 단독 재조회 완료 세대. 뷰가 도보 heading으로 포커스를 옮기는 신호
    /// (resultsRevision과 분리 — 전체 조회는 첫 성공 수단, 토글 재조회는 항상 도보).
    private(set) var walkRefetchRevision = 0
    /// "현재 위치" 라벨에 병기할 역지오코딩 주소(F-B, 웹 currentAddress 미러).
    /// nil=주소 미확보 — 라벨은 "현재 위치"만(주소 없음=정보 없음, 거짓 표시 금지).
    private(set) var currentAddress: String?
    /// `results`가 마지막으로 확정될 때 출발지가 수동 위치였는가(웹 originSource
    /// 미러, DirectionsView.tsx). "지금 수동 위치가 켜져 있는가"가 아니라 **화면에
    /// 보이는 이 경로가 어느 좌표에서 계산됐는가**가 판정 축이다 — 조회 뒤 수동
    /// 위치를 껐다 켰다 해도 이 값은 그 조회 시점 그대로다(안내 시작 사전 고지의
    /// 근거, 정정 1~3). ⚠ `results`와 **항상 같은 순간에만** 커밋한다(성공 경로
    /// 단 한 곳) — 커버리지 밖 등 중간 return에서 `true·results=nil` 조합이
    /// 관찰 가능한 채로 남지 않도록(fix 라운드 1 Minor 2).
    private(set) var resultsUsedManualOrigin = false
    /// 이 조회의 목적지가 출입구로 승격됐으면 그 이름·좌표(A11). nil이면 승격 없음
    /// — **조회 실패와 구분하지 않는다**(둘 다 대표 좌표로 안내하므로 행동이 같다).
    ///
    /// ⚠ **승격본은 입력 필드가 아니라 여기 산다.** `trackedDestination`·
    /// `destinationPlaceName`이 `endpoint(for: .to)`에서 직접 파생되므로, 필드를
    /// 그대로 두면서 "안내가 승격본을 쓴다"는 계약은 이 필드 없이는 성립하지 않는다
    /// (그 상태로 두면 브리핑은 정문까지인데 안내 세션은 본관으로 가고, 화면은
    /// "정문까지 안내합니다"라고 말한다 — 거짓 문장).
    ///
    /// ⚠ `results`와 **같은 순간에만** 커밋한다(`resultsUsedManualOrigin` 동형) —
    /// 중간 return에서 승격본만 먼저 선 상태가 관찰 가능하면 안 된다.
    private(set) var promotedDestination: (label: String, lat: Double, lng: Double)?
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
    private var lastCoords: (origin: (lat: Double, lng: Double), dest: (lat: Double, lng: Double), via: (lat: Double, lng: Double)?)?

    init(prefilledDestination: DirectionsEndpoint? = nil) {
        from = .current
        to = prefilledDestination
        recentRoutes = RecentSearchStore().routes()
    }

    var isBusy: Bool { phase == .locating || phase == .loading || stepFreeBusy }

    func endpoint(for target: DirectionsFieldTarget) -> DirectionsEndpoint? {
        switch target {
        case .from: from
        case .to, .manualLocation: to
        case .via: via
        }
    }

    /// 필드 확정은 항상 엔드포인트 전체 교체(원자). 이전 결과는 새 질의와 무관해져 폐기.
    func setEndpoint(_ endpoint: DirectionsEndpoint, for target: DirectionsFieldTarget) {
        if target == .via { setVia(endpoint); return }
        if target == .from { from = endpoint } else { to = endpoint }
        recordRecent(endpoint, scope: target == .from ? .from : .to)
        clearResults()
    }

    /// 경유지 확정(N4) — 도착지와 같은 원자 교체 + 경유지 전용 최근 목록 기록. 장소만
    /// 받는다(현재 위치는 경유지가 될 수 없다 — 서버 spec §3).
    func setVia(_ endpoint: DirectionsEndpoint) {
        guard case .place = endpoint else { return }
        via = endpoint
        recordRecent(endpoint, scope: .via)
        clearResults()
    }

    /// 경유지 삭제 — 필드가 바뀌는 것이라 결과도 폐기한다(setEndpoint 동형).
    func clearVia() {
        guard via != nil else { return }
        via = nil
        clearResults()
    }

    /// 경유지 라벨(결과 행 "경유지 {label} 도착"·시작 요청용). 서버는 라벨을 모른다.
    var viaLabel: String? {
        if case .place(let label, _, _) = via { return label }
        return nil
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

    /// 최근 경로 기록(스펙 §1.2): settled 도달 시 1곳. 실패 phase·outOfCoverage·취소는
    /// 여기 도달하지 않는다. current는 nil 투영 — 측위된 실좌표를 굳히지 않는다.
    private func recordRecentRoute(from: DirectionsEndpoint, to: DirectionsEndpoint, via: DirectionsEndpoint?) {
        recentRoutes = recentStore.recordRoute(
            RecentRoute(from: Self.recentSide(from), to: Self.recentSide(to), via: via.flatMap(Self.recentSide)))
    }

    private static func recentSide(_ endpoint: DirectionsEndpoint) -> RecentEndpoint? {
        if case .place(let label, let lat, let lng) = endpoint {
            return RecentEndpoint(label: label, lat: lat, lng: lng)
        }
        return nil
    }

    func removeRecentRoute(_ route: RecentRoute) {
        recentRoutes = recentStore.removeRoute(route)
    }

    /// 모두 지우기 — 고정은 보존한다(스펙 2026-08-12 §3). 남은 목록으로 갱신.
    func clearRecentRoutes() {
        recentRoutes = recentStore.clearRoutes()
    }

    /// 고정 토글(스펙 2026-08-12 §4): 저장은 store가 불변식 정렬로 하되, 화면 배열은
    /// 그 자리에서 항목만 교체한다(토글 순간 행이 이동하면 VO 포커스가 유실된다 —
    /// 정렬은 다음 로드부터).
    func setRoutePinned(_ route: RecentRoute, pinned: Bool) {
        guard let index = recentRoutes.firstIndex(of: route) else { return }
        recentStore.setRoutePinned(route, pinned: pinned)
        recentRoutes[index] = RecentRoute(from: route.from, to: route.to, via: route.via, pinned: pinned)
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
        walkShortest = nil
        resultsUsedManualOrigin = false
        promotedDestination = nil
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
            guard let coord = try? await ManualLocationJudge.effectiveCoordinate(force: true) else { return }
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

    /// 안내 주도 재조회(스펙 2026-08-12 §5.3)는 silently=true — 완료·실패 통지를
    /// 전부 삼킨다. 결과는 안내 시트 뒤 화면 최신화용이라 통지가 안내 발화와 경합할
    /// 이유가 없다. stale 경합은 기존 latest-wins(queryTask 취소·isInFlight)가 그대로.
    func runQuery(silently: Bool = false) {
        if isInFlight { return }
        silentQuery = silently
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
        walkShortest = nil // 스냅샷 교체(spec §4) — 이전 세대 대안을 지우고 시작
        resultsUsedManualOrigin = false
        promotedDestination = nil
        // 현재 위치 endpoint는 조회 시점에 측위(권한 팝업도 이 시점, 캐시 좌표 재사용).
        // effectiveCoordinate는 수동 위치가 켜져 있으면 그 좌표를 돌려준다(웹
        // awaitEffectiveLocation 동형) — "현재 위치"의 앱 전역 의미가 수동 위치일
        // 때는 통일돼야 하기 때문(F-B 재측위도 같은 이유로 동일 함수를 쓴다).
        var current: (lat: Double, lng: Double)?
        // 이 조회의 **출발지**가 수동 위치였는지(안내 시작 고지 근거 — 도착지만 현재
        // 위치인 조회는 대상이 아니다: 안내 출발지는 그때도 실좌표라 화면과 어긋나는
        // 것이 없다). 로컬로만 들고 있다가 성공 경로에서 `results`와 같은 순간에만
        // 인스턴스 프로퍼티에 커밋한다 — 커버리지 밖 등 중간 return에서 값만 먼저
        // 서고 `results`는 여전히 nil인 조합이 관찰 가능한 채로 남지 않도록.
        var usedManualOrigin = false
        if from == .current || to == .current {
            phase = .locating
            // 호출 직전 스냅샷(effectiveCoordinate 내부의 분기 판정과 같은 turn) —
            // 측위 대기 중(await) 수동 위치가 새로 켜지는 레이스에서 실제로는 GPS로
            // 받아온 좌표를 수동 기원으로 오분류하지 않는다.
            usedManualOrigin = from == .current && ManualLocationStore.shared.current != nil
            do {
                current = try await ManualLocationJudge.effectiveCoordinate(force: false)
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
              let queried = coordinate(of: to, current: current) else { return }
        // 경유지 좌표(N4). 장소만이라 current 불필요. 한국 밖이면 서버도 outOfCoverage를
        // 주지만 여기서 먼저 막아 upstream 호출을 0으로(출발·도착 선분기 동형).
        let viaCoord = via.flatMap { coordinate(of: $0, current: nil) }
        if let viaCoord, !isInKorea(lat: viaCoord.lat, lng: viaCoord.lng) {
            phase = .outOfCoverage
            announce(appLocalized("ios.common.outOfCoverage"))
            return
        }

        // A11 출입구 승격 — 이름 있는 장소 목적지에만, ko 데이터 로케일에서만(도보 경로
        // 자체가 ko 전용이고 카카오 출입구 이름은 한국어 고유명사다). 승격본은 여기서
        // 확정되어 전 수단 조회·안내 세션·계단 회피 재조회가 **같은 목적지**를 쓴다
        // (§5.1 — 조회마다 다른 목적지를 갖지 않는다). 실패·부재는 조용히 원래 목적지.
        // ⚠ 승격 왕복도 이 조회의 일부라 **그 전에** loading으로 넘긴다. 아니면 그
        // 사이 화면이 직전 phase(settled)에 머물면서 결과만 비어 있는 창이 생긴다.
        phase = .loading
        var entrance: EntranceMatch?
        if case .place(let label, _, _) = to, AppLanguage.dataLocale == "ko" {
            entrance = await searchService.destinationEntrance(
                name: label, lat: queried.lat, lng: queried.lng,
                fromLat: origin.lat, fromLng: origin.lng
            )
            guard !Task.isCancelled else { return }
        }
        // ⚠ `dest`는 **let**이어야 한다 — 아래 `async let` 3수단이 캡처하므로 가변이면
        // Swift 동시성이 data race로 거부한다(빌드 실패로 드러났다).
        let promoted = entrance.map { (label: $0.name, lat: $0.lat, lng: $0.lng) }
        let dest = promoted.map { (lat: $0.lat, lng: $0.lng) } ?? queried
        lastCoords = (origin: origin, dest: dest, via: viaCoord)

        // 3수단 병렬. 도보는 앱 언어 ko 전용(웹 prefersEnglish 분기 동형, 조회 자체 생략).
        let includeWalk = AppLanguage.current == "ko"
        let lang = AppLanguage.dataLocale
        let service = self.service
        let accessible = stepFreeEnabled
        // 대중교통은 경유지가 있으면 호출하지 않는다(ODsay 미지원 — 서버 spec §2.1).
        // "경로 없음"이 아니라 "미지원"이라 별도 상태로 섹션에 사유를 남긴다.
        async let transitSettled = Self.settleTransit(service, include: viaCoord == nil, origin: origin, dest: dest)
        async let walkSettled = Self.settleWalk(service, include: includeWalk, origin: origin, dest: dest, accessible: accessible, via: viaCoord)
        async let carSettled = Self.settleCar(service, origin: origin, dest: dest, lang: lang, via: viaCoord)
        let (transit, walk, car) = await (transitSettled, walkSettled, carSettled)
        guard !Task.isCancelled else { return }

        var outcomes: [DirectionsMode: DirectionsModeOutcome] = [
            .transit: transit.map { DirectionsOutcomeClassifier.classify(transit: $0) } ?? .unsupportedWaypoint,
            .car: DirectionsOutcomeClassifier.classify(car: car),
        ]
        // 추천은 현행 분류 그대로, 최단은 같은 응답에서만 커밋(spec §4 — 커버리지
        // 밖 등 중간 return에서 노출되지 않도록 로컬에 들었다가 results와 함께 커밋).
        var shortestCandidate: WalkRouteBriefing?
        if let walk {
            outcomes[.walk] = DirectionsOutcomeClassifier.classify(walk: walk.map(\.result))
            if case .success(let pair) = walk { shortestCandidate = pair.shortest }
        }

        // 서버 마커 이중 방어 — 위 "cur" 선분기를 통과했어도 place 종단점(검색 선택)이
        // 한국 밖일 수 있다. 한 수단이라도 감지하면 나머지 결과를 버리고 화면 전체를 전환한다.
        if outcomes.values.contains(where: { $0.isOutOfCoverage }) {
            phase = .outOfCoverage
            announce(appLocalized("ios.common.outOfCoverage"))
            return
        }

        let built = DirectionsResults(outcomes: outcomes)
        results = built
        walkShortest = shortestCandidate
        resultsUsedManualOrigin = usedManualOrigin
        promotedDestination = promoted
        phase = .settled(successCount: built.successCount)
        hasQueriedOnce = true
        recordRecentRoute(from: from, to: to, via: via)
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
            await refetchWalk(origin: coords.origin, dest: coords.dest, via: coords.via)
            guard !Task.isCancelled else { return }
            isInFlight = false
            stepFreeBusy = false
        }
    }

    private func refetchWalk(
        origin: (lat: Double, lng: Double), dest: (lat: Double, lng: Double), via: (lat: Double, lng: Double)?
    ) async {
        let service = self.service
        let accessible = stepFreeEnabled
        let settled = await Self.settleWalk(service, include: true, origin: origin, dest: dest, accessible: accessible, via: via)
        guard !Task.isCancelled, let settled, let current = results else { return }
        // lastCoords는 이미 커버리지 검증을 통과한 좌표라 재조회에서 서버 마커가 다시
        // 뜰 일은 사실상 없다 — 그래도 도달 시 화면 전체 전환 대신 도보 오류로 안내한다
        // (웹 동형: 부분 재조회가 다른 수단 결과까지 버리게 하지 않는다).
        var outcome = DirectionsOutcomeClassifier.classify(walk: settled.map(\.result))
        if outcome.isOutOfCoverage { outcome = .error }
        // 순서는 settled 스냅샷을 보존한다(E11 spec §2 규칙 3) — 재계산 init 금지.
        results = current.replacingWalk(outcome)
        // 최단도 같은 응답 쌍으로 교체(실패 응답이면 nil — 세대 혼합 금지, spec §4).
        walkShortest = (try? settled.get())?.shortest
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

    /// 무통지 조회 표식(§5.3). 다음 runQuery 진입이 매번 다시 정한다 — 수동 조회가
    /// 뒤따르면 자연 복원되고, 진행 중 조회는 하나뿐이라(isInFlight) 혼선이 없다.
    private var silentQuery = false

    private func announce(_ message: String) {
        guard !silentQuery else { return }
        AccessibilityNotification.Announcement(message).post()
    }

    // 수단별 settle 래퍼: 실패를 throw 대신 Result로 뭉쳐 병렬 소비를 단순화(웹 fetchMode 동형).

    /// `include=false`(경유지 조회)면 호출 자체를 생략하고 nil — 호출부가 `.unsupportedWaypoint`로.
    nonisolated private static func settleTransit(
        _ service: RouteService, include: Bool, origin: (lat: Double, lng: Double), dest: (lat: Double, lng: Double)
    ) async -> Result<TransitRouteResult?, any Error>? {
        guard include else { return nil }
        do {
            return .success(try await withQueryTimeout {
                // includeStops: 실시간 안내의 승차·하차 정류소 데이터원(B2 §7) —
                // 시작 시 재조회 없이 브리핑과 같은 경로를 안내한다(§2 경로 동일성).
                try await service.transit(
                    originLat: origin.lat, originLng: origin.lng,
                    destLat: dest.lat, destLng: dest.lng,
                    includeStops: true)
            })
        } catch { return .failure(error) }
    }

    nonisolated private static func settleWalk(
        _ service: RouteService, include: Bool, origin: (lat: Double, lng: Double), dest: (lat: Double, lng: Double),
        accessible: Bool, via: (lat: Double, lng: Double)?
    ) async -> Result<(result: WalkRouteBriefing?, shortest: WalkRouteBriefing?), any Error>? {
        guard include else { return nil }
        do {
            return .success(try await withQueryTimeout {
                // 추천+최단 병렬(M3, alternatives=1). 기본 실패는 서버가 502로
                // 던지고(.failure), 최단 실패만 shortest nil로 흡수된다(spec §3.1).
                try await service.walkAlternatives(
                    originLat: origin.lat, originLng: origin.lng, destLat: dest.lat, destLng: dest.lng,
                    accessible: accessible, via: via)
            })
        } catch { return .failure(error) }
    }

    nonisolated private static func settleCar(
        _ service: RouteService, origin: (lat: Double, lng: Double), dest: (lat: Double, lng: Double), lang: String,
        via: (lat: Double, lng: Double)?
    ) async -> Result<CarRouteBriefing, any Error> {
        do {
            return .success(try await withQueryTimeout {
                try await service.car(originLat: origin.lat, originLng: origin.lng, destLat: dest.lat, destLng: dest.lng, lang: lang, via: via)
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
    /// 최근 경로 목록 항목 포커스(⚠ Bool 바인딩 다중 부착 금지 — 항목 정체성 옵셔널
    /// 바인딩이 정본, endpoint 시트 `focusedRecent` 동형).
    @AccessibilityFocusState private var focusedRecentRoute: RecentRoute?
    /// 펼침이 **기본값과 다른** 대중교통 경로의 `routeKey`(웹 toggledRoutes 동형).
    /// 새 조회 결과는 다른 경로들이므로 resultsRevision 변화 시 초기화한다.
    /// ⚠ "펼쳐진 것"을 담는 게 아니다 — 추천은 기본 펼침, 대안은 기본 접힘이라
    ///   한 집합으로 둘을 다루려면 이 의미여야 하고, 비우면 각자의 기본 상태가 된다.
    /// ⚠ 배열 인덱스가 아니라 키다. 강등 정렬·재조회로 표시 순서가 바뀌면 인덱스는
    ///   다른 경로를 가리키고, 표시 번호는 축 라벨이 붙은 대안을 건너뛰어 또 다른
    ///   좌표계다. 둘 중 어느 것도 상태 키로 쓰지 않는다(spec §4.2).
    @State private var expandedAlts: Set<String> = []
    /// 도보 상세 펼침 상태(spec §4.4). nil = 자동(문턱 판정), 값 = 사용자 조작 결과.
    /// 새 조회에서만 자동으로 되돌리고, 계단 회피 토글 재조회에서는 보존한다
    /// (그 재조회는 사용자가 도보 섹션 안에서 일으킨 것이라 맥락이 이어진다).
    @State private var walkExpandedOverride: Bool?
    /// 최단 도보 행 펼침(M3). 대중교통 대안 동형 — 기본 접힘, 새 조회에서 원복.
    @State private var walkShortestExpanded = false
    /// 안내 세션은 앱 수명(N1, `GuideSession`) — 이 뷰는 소유하지 않고 빌려 쓴다.
    /// 탭 전환·`.id` 재생성·시트 닫힘이 세션을 끝내지 않는다. 시트는 루트가 띄운다.
    private let session = GuideSession.shared
    private var beacon: BeaconModel { session.beacon }
    private var transitGuide: TransitGuideModel { session.transit }
    /// 도보 안내 1회성 공지(spec 2026-08-15 §5). 저장은 확인 버튼만 — 시스템 닫기
    /// (드래그·VoiceOver 탈출)는 저장하지 않아 다음 탭 진입에 다시 뜬다.
    @State private var walkNoticePresented = false
    /// 필드 라벨의 수동 위치 분기(LocationBarView 동형 관찰 패턴).
    @State private var manualLocationStore = ManualLocationStore.shared
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
    /// 안내 시작 버튼 3종(간략 폴백·도보·자동차)의 포커스 정체성. ⚠ Bool 바인딩을
    /// 여러 행에 붙이는 함정 회피 — 항목 정체성 옵셔널 바인딩이 정본(repo 규칙).
    /// ⚠ 대안은 `routeKey`로 식별한다(표시 번호·배열 인덱스 둘 다 포커스 키 금지).
    enum GuideStartButton: Hashable { case fallback, walk, walkShortest, car, transitAlt(String) }
    @AccessibilityFocusState private var guideStartFocused: GuideStartButton?
    /// 시트가 닫힐 때 되돌아갈 시작 버튼(방금 떠나온 자리).
    @State private var lastGuideStart: GuideStartButton = .fallback

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
                    // 경유지(N4, 선택 사항) — 도착지와 경로 조회 사이. 확정되면 필드 버튼
                    // (탭=재검색) + 삭제 버튼으로 바뀐다. 삭제는 자기를 누른 버튼을 없애므로
                    // 조회 버튼을 선점한다(헌장 §5). 도착지 확정 후 포커스는 종전대로 조회
                    // 버튼이다(선택 사항이 기본 흐름을 늘리면 안 된다 — 위원장 판정).
                    if let viaLabel = model.viaLabel {
                        Button("\(appLocalized("directions.via")), \(viaLabel)") { searchTarget = .via }
                            .accessibilityFocused($focusedEndpointField, equals: .via)
                        Button(appLocalized("directions.removeVia")) {
                            submitFocused = true
                            model.clearVia()
                        }
                    } else {
                        Button(appLocalized("directions.addVia")) { searchTarget = .via }
                            .accessibilityFocused($focusedEndpointField, equals: .via)
                    }
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
                // 최근 경로(스펙 2026-08-10 §1.3): 결과 없는 화면에서만 — 결과 아래 20행은 탐색
                // 방해. 실패 phase에서는 보인다(다른 경로를 고르는 우회로). swipeActions 삭제가
                // VoiceOver 로터로 자동 노출된다(endpoint 시트 동형).
                if model.results == nil && !model.isBusy && !model.recentRoutes.isEmpty {
                    Section {
                        // 고정 항목은 라벨 접미사 "고정됨"(한 줄 = 한 객체), 고정 토글이
                        // 삭제보다 앞(위원장 지시 2026-08-12) — 로터 커스텀 액션 자동 노출.
                        // ⚠ id: \.self 금지 — pinned가 Hashable에 포함되어 토글이 행을
                        // 파괴(포커스 이탈)한다. Identifiable(출발·도착 쌍 키)로 제자리 유지.
                        ForEach(model.recentRoutes) { route in
                            Button(route.pinned
                                ? joinText(recentRouteLabel(route), appLocalized("recent.pinned"))
                                : recentRouteLabel(route)
                            ) { activateRecentRoute(route) }
                                .accessibilityFocused($focusedRecentRoute, equals: route)
                                .swipeActions {
                                    Button(appLocalized(route.pinned ? "recent.unpin" : "recent.pin")) {
                                        togglePinRecentRoute(route)
                                    }
                                    Button(appLocalized("recent.delete"), role: .destructive) {
                                        deleteRecentRoute(route)
                                    }
                                }
                        }
                        Button(appLocalized("recentRoutes.clearAll")) { clearRecentRoutes() }
                    } header: {
                        Text(appLocalized("recentRoutes.title"))
                            .accessibilityAddTraits(.isHeader)
                    }
                }
                // 간략 폴백 + 실패 상태 + 추적 이중 방어 섹션(B1 §3.1 재편).
                // 수단별 시작 버튼이 각 수단 섹션으로 내려갔으므로, 이 선두 섹션은
                // ①시작 가능한 수단 안내가 0개일 때의 간략 폴백 ②권한 거부·정밀
                // 꺼짐 같은 시작 실패 상태와 해결 버튼 ③추적 중 중지 이중 방어(시트가
                // 어떤 이유로 뜨지 않아도 중지 수단이 화면에 남는다, 리뷰 C-1)만 맡는다.
                // 도착지가 "현재 위치"면 무의미하므로 숨긴다(기존 계약).
                if beacon.isTracking
                    || (model.hasQueriedOnce && trackedDestination != nil
                        && (briefFallbackVisible || !beacon.statusText.isEmpty)),
                   let tracked = trackedDestination {
                    Section {
                        // 이 버튼은 두 얼굴이다: 추적 중엔 중지 이중 방어(항상 유효),
                        // 비추적이면 간략 단독 시작(실험판 전용 — 정식판의 간략 상태는
                        // 세션이 경로를 잃었을 때의 내부 강등뿐이다, spec 2026-08-15
                        // §3.3). 정식판 실패 상태 경로로 섹션이 떠도 이 버튼이 남으면
                        // 봉인이 뚫리므로, 둘 다 아니면 버튼을 두지 않는다(섹션은 실패
                        // 상태 표시와 해결 버튼으로 계속 유효하다).
                        if beacon.isTracking || AppConfig.experimentalGuidanceEnabled {
                            Button(beacon.isTracking
                                ? appLocalized("beacon.stop")
                                : appLocalized("beacon.briefGuideStart")
                            ) {
                                lastGuideStart = .fallback
                                announceGuideStartIfManualOrigin()
                                beacon.toggle(
                                    dest: tracked.dest, label: tracked.label, kind: .walk,
                                    accessible: model.stepFreeEnabled, waypoint: sessionWaypoint
                                )
                            }
                            .accessibilityFocused($guideStartFocused, equals: .fallback)
                        }
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
                                        case .granted:
                                            // ⚠ 인자를 여기서 다시 조립하지 않는다(A13).
                                            // 시작 인자는 모델이 들고 있고, 재시작은 그
                                            // 한 벌을 그대로 쓴다 — 여기서 다시 적으면
                                            // 최단 경로가 추천 경로로, 자동차가 도보로
                                            // 조용히 바뀐다.
                                            beacon.restart()
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
                        // 직선거리 주석은 인라인(시작 전)에 두지 않는다 — 상세 모드로
                        // 열리면 거짓이 되고, 참인 곳(간략 추적 중)은 시트가 보여준다
                        // (위원장 실기기 판정 2026-08-03).
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
                            // 수단별 안내 시작 버튼(B1 §3.1) — 수단 heading 착지 후
                            // 첫 스와이프 거리. 게이트가 죽은 버튼을 사전 차단한다.
                            // 라벨은 수단별 짧은 형(위원장 판정 2026-08-06, 공통 라벨
                            // 번복): VO 로터 버튼 목록은 헤딩 문맥 없이 버튼 이름만
                            // 나열해 동일 라벨 3개가 구분 불가다.
                            // ⚠ 도보 시작 버튼은 여기 없다(M3) — 경로가 추천·최단
                            // 복수가 되어 버튼이 경로에 귀속되고, 대중교통과 같은
                            // 이유로 각 행 disclosure 안에 있다(outcomeRows).
                            if mode == .car, carGuideStartable,
                               let tracked = trackedDestination {
                                Button(appLocalized("beacon.guideStartCar")) {
                                    lastGuideStart = .car
                                    announceGuideStartIfManualOrigin()
                                    session.startBeacon(BeaconModel.StartRequest(
                                        dest: tracked.dest, label: tracked.label, kind: .car,
                                        accessible: false, variant: nil, shortestAvailable: false,
                                        waypoint: sessionWaypoint
                                    ))
                                }
                                .accessibilityFocused($guideStartFocused, equals: .car)
                            }
                            // 대중교통 안내 시작 버튼은 여기 없다 — 경로가 복수라
                            // 버튼이 경로에 귀속되어야 하고(라벨이 곧 그 경로 이름),
                            // 아래 목록의 각 disclosure 안에 하나씩 있다. 도보·자동차는
                            // 경로가 하나라 비교 대상이 없어 이 자리가 맞다.
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
                    model.setEndpoint(endpoint, for: target)  // .via는 setVia로 라우팅
                    // "현재 위치 사용" 선택은 강제 재측위 + 주소 새로고침 트리거(F-B).
                    if endpoint == .current { model.refreshCurrentLocation() }
                    // 확정으로 닫힐 때만 착지점을 예약한다(취소는 콜백이 없다).
                    focusAfterResolve = target
                }
            }
            // 안내 시트(비콘·대중교통)는 여기 없다 — 세션이 앱 수명이라 루트
            // `GildongmuApp`이 `.sheet(item:)` 하나로 띄운다(N1 spec §2.2).
            // 도보 안내 정식 출시 1회성 공지(spec §5). 다른 두 시트와 달리 세션 상태에
            // 묶이지 않는다 — 첫 진입에는 어느 시트도 떠 있지 않아 경합이 없다.
            // ⚠ `interactiveDismissDisabled`를 붙이지 않는다(§5.1) — 저장이 확인
            // 버튼에만 걸려 있어, 읽지 않고 닫은 사용자에게는 다음 진입에 다시 뜬다.
            .sheet(isPresented: $walkNoticePresented) {
                WalkGuideNoticeSheet {
                    UserDefaults.standard.set(true, forKey: WalkGuideNotice.key)
                    walkNoticePresented = false
                }
            }
            // 안내 화면이 사라지면(중지·잔여 화면 닫기) 시작 버튼으로 돌려보낸다(방금
            // 떠나온 자리). 최소화(띠바)는 화면이 남아 있으므로 대상이 아니다 — 그때는
            // 루트가 띠바에 착지시킨다. 이 탭이 보이지 않으면 대입은 no-op이다.
            .onChange(of: session.hasScreen) { _, has in
                guard !has else { return }
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
                // 새 조회 = 새 경로들이라 도보 접힘도 자동 판정으로 되돌린다(spec §4.4).
                walkExpandedOverride = nil
                walkShortestExpanded = false
            }
            // 계단 회피 토글 재조회 완료 시엔 항상 도보 heading으로(웹 walkHeadingRef 동형).
            .onChange(of: model.walkRefetchRevision) { focusedModeHeading = .walk }
            // 탭 전환·epoch 재생성 시 진행 조회 폐기(늦은 응답이 초기화 화면을 되채우는 경합 차단).
            // 전경 전용 계약의 구현부. ⚠ 행 수준이 아니라 **화면 수준**이어야 한다 —
            // List는 lazy라 행에 붙이면 도보 안내를 읽으려 스크롤하는 순간 추적이 죽는다.
            // ⚠ 세션은 여기서 끝내지 않는다(N1) — 탭 전환은 안내 중 정상 행동이다.
            // 검색 시트 억제는 시트가 열린 채 탭 트리가 재생성되면 영영 남으므로 해제
            // (설계 리뷰 M4).
            .onDisappear {
                model.cancel()
                beacon.outputSuppressed = false
                transitGuide.outputSuppressed = false
            }
            // 검색 시트가 뜬 동안 톤과 통지를 모두 죽인다. 시트에 받아쓰기가 있고
            // 헌장 §6의 불변식은 "녹음 중 SR 발화 0"인데, polite 통지는 VoiceOver가
            // 실제로 말하는 음성이라 톤보다 전사 오염 위험이 크다. 추적은 유지한다.
            // 두 모델 모두 억제한다(설계 리뷰 C9 — 최소화된 대중교통 안내도 이 탭의
            // 음성 검색 중엔 조용해야 한다).
            .onChange(of: searchTarget) {
                beacon.outputSuppressed = searchTarget != nil
                transitGuide.outputSuppressed = searchTarget != nil
                guard searchTarget == nil, let resolved = focusAfterResolve else { return }
                focusAfterResolve = nil
                landFocusAfterResolve(from: resolved)
            }
            // 폼 도착지 변경은 세션을 멈추지 않는다(N1 — 경로 조회는 안내 중에도 허용).
            // 세션이 자기 목적지를 들고 있어 폼이 바뀌어도 옛 목적지 추적 창은 없다.
            // 안내 주도 목적지 변경은 루트 시트가 스토어로 보내고 여기서 폼에 반영한다.
            .onChange(of: GuideFormSyncStore.shared.pending) { _, pending in
                guard pending != nil else { return }
                consumeGuideFormSync()
            }
            .onChange(of: GuideFormSyncStore.shared.pendingWaypoint) { _, pending in
                guard pending != nil else { return }
                consumeGuideFormSync()
            }
            // 이미 허용된 세션이면 진입 시 조용히 현재 위치 주소를 병기(권한 팝업 없음).
            .task {
                // 도보 안내 공지(spec §5.2 — 미확인 ∧ 한국어). 조회를 기다리지 않고
                // 탭 진입 즉시 판정한다. 한국어 전용인 이유는 도보 안내 자체가
                // `walkGuideStartable`의 ko 게이트 안에만 존재하기 때문이다 — 다른
                // 언어 사용자에게 띄우면 없는 기능을 설명하는 공지가 된다.
                if !WalkGuideNotice.confirmed, AppLanguage.dataLocale == "ko" {
                    walkNoticePresented = true
                }
                consumeGuideFormSync()
                await model.loadCurrentAddressIfAuthorized()
            }
        }
    }

    private func recentRouteLabel(_ route: RecentRoute) -> String {
        let from = route.from?.label ?? appLocalized("directions.currentLocation")
        let to = route.to?.label ?? appLocalized("directions.currentLocation")
        if let via = route.via?.label {
            // ko 목적격 조사는 라벨 받침에 따라 갈려 문자열 자원에 박을 수 없다 — 호출부가
            // 붙이고 한글이 아닌 이름은 조사 없이 물러난다(웹 routeItemLabel 동형).
            let viaText = AppLanguage.current == "ko" ? via + (KoreanParticle.object(via) ?? "") : via
            return appLocalized("recentRoutes.itemVia", from, to, viaText)
        }
        return appLocalized("recentRoutes.item", from, to)
    }

    private func directionsEndpoint(_ side: RecentEndpoint?) -> DirectionsEndpoint {
        side.map { .place(label: $0.label, lat: $0.lat, lng: $0.lng) } ?? .current
    }

    /// 안내 주도 목적지 변경의 폼 동기화(스펙 2026-08-12 §5): 출발지=현재 위치(안내
    /// 세션이 실제로 그렇다 — 재조회 결과의 출발점 의미 일치, 리뷰 M1), 도착지=새
    /// 목적지(최근 목록 기록은 setEndpoint 기존 경로), 무통지 재조회. 같은 목적지
    /// 재선택은 전부 생략한다. 탭이 안 보이는 동안 쌓인 값은 `.task`가 소비한다.
    private func consumeGuideFormSync() {
        let store = GuideFormSyncStore.shared
        var changed = false
        if let endpoint = store.take(), endpoint != model.endpoint(for: .to) {
            if model.endpoint(for: .from) != .current { model.setEndpoint(.current, for: .from) }
            model.setEndpoint(endpoint, for: .to)
            changed = true
        }
        // 안내 주도 경유지 추가·변경(N4)도 같은 줄 — 폼의 경유지를 세션과 맞추고 무통지 재조회.
        if let via = store.takeWaypoint(), via != model.via {
            model.setVia(via)
            changed = true
        }
        guard changed else { return }
        model.runQuery(silently: true)
    }

    /// 활성화 = 두 필드 원자 확정 + 즉시 조회(스펙 §1.4). 결과 도착 시 이 섹션이 통째로
    /// 사라지므로 포커스를 먼저 조회 버튼으로 선점한다(헌장 §5 — 제거될 요소에 커서를
    /// 남기지 않는다). setEndpoint 경유라 endpoint 최근 목록 기록도 기존 규칙대로 따라온다.
    private func activateRecentRoute(_ route: RecentRoute) {
        submitFocused = true
        model.setEndpoint(directionsEndpoint(route.from), for: .from)
        model.setEndpoint(directionsEndpoint(route.to), for: .to)
        // 경유지도 원자 확정의 일부(N4): 있으면 세우고 없으면 지운다 — 이전 질의의
        // 경유지가 최근 경로 활성화에 딸려 가지 않는다.
        if let via = route.via {
            model.setVia(.place(label: via.label, lat: via.lat, lng: via.lng))
        } else {
            model.clearVia()
        }
        model.runQuery()
    }

    /// 삭제 포커스: 다음 항목 → 이전 항목 → 목록 소멸 시 조회 버튼(스펙 §1.5,
    /// endpoint 시트의 마이크 행에 대응하는 이 화면의 안정 착지점). 통지는 `.high` —
    /// 이 핸들러가 자기를 누른 버튼(행)을 사라지게 해 포커스가 다른 컨트롤로
    /// 옮겨가는데, 기본 우선순위면 VO가 그 컨트롤 라벨을 낭독하며 통지를 잠식한다
    /// (헌장 §6, BeaconModel.announce 동형).
    private func deleteRecentRoute(_ route: RecentRoute) {
        guard let index = model.recentRoutes.firstIndex(of: route) else { return }
        model.removeRecentRoute(route)
        var deletedMessage = AttributedString(appLocalized("recent.deleted"))
        deletedMessage.accessibilitySpeechAnnouncementPriority = .high
        AccessibilityNotification.Announcement(deletedMessage).post()
        if model.recentRoutes.isEmpty {
            submitFocused = true
            return
        }
        focusedRecentRoute = model.recentRoutes[min(index, model.recentRoutes.count - 1)]
    }

    /// 고정 토글(스펙 2026-08-12 §4): 모델이 화면 자리를 유지한 채 항목만 교체하고,
    /// 포커스를 갱신된 값으로 재확정 — 새 라벨 낭독이 상태 신호(헌장 §5, pinned가
    /// 정체성에 포함되어 같은 값 no-op이 아니다. endpoint 시트 동형).
    private func togglePinRecentRoute(_ route: RecentRoute) {
        let pinned = !route.pinned
        model.setRoutePinned(route, pinned: pinned)
        focusedRecentRoute = RecentRoute(from: route.from, to: route.to, via: route.via, pinned: pinned)
    }

    /// 전체 지우기(고정 보존 — 스펙 2026-08-12 §3). **우선순위는 분기로 가른다**
    /// (위원장 판정 2026-08-16): 목록이 전부 사라질 때만 섹션이 소멸해 포커스가 조회
    /// 버튼으로 옮겨가므로 그때만 `.high`(위 `deleteRecentRoute`와 같은 이유 — 기본
    /// 우선순위면 VO가 새 컨트롤 라벨을 낭독하며 통지를 잠식한다). 고정이 남으면
    /// 섹션·버튼이 그대로라 **포커스 무이동**이고, 잠식할 것이 없으니 끊을 이유도 없다.
    /// ⚠ 종전에는 두 분기 모두 `.high`라 검색 시트(`DirectionsEndpointSearchView`)와
    /// 갈려 있었다 — 판별선은 키가 아니라 **포커스가 움직이는지**다.
    private func clearRecentRoutes() {
        model.clearRecentRoutes()
        let emptied = model.recentRoutes.isEmpty
        let key = emptied ? "recentRoutes.cleared" : "recent.clearedExceptPinned"
        var clearedMessage = AttributedString(appLocalized(key))
        if emptied { clearedMessage.accessibilitySpeechAnnouncementPriority = .high }
        AccessibilityNotification.Announcement(clearedMessage).post()
        if emptied { submitFocused = true }
    }

    /// 웹 `focusAfterResolve` 계약의 iOS 판: 출발지를 고르면 도착지 입력으로,
    /// 도착지·경유지를 고르면 조회 버튼으로 보낸다(셋 다 "다음에 할 일"이다).
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

    /// 대중교통 완료 → 남은 도보 안내(A안, §14.2 피드백 #6). 시트 dismiss 애니메이션이
    /// 끝난 뒤 비콘을 열어야 한다 — 같은 계층의 두 시트는 동시 presentation이 안 되므로
    /// 전환 지연이 필수(landFocusAfterResolve와 같은 근거의 시간차). 도보 경로 실패는
    /// BeaconModel의 fallbackToBrief가 흡수한다(추가 게이트 불필요 — 이 핸드오프는
    /// 대중교통 세션 안에서만 호출되고 그 세션이 `experimentalGuidanceEnabled ∧ ko`
    /// 게이트 안에서만 존재한다, spec 2026-08-15 §3.2 964행).
    /// ⚠ 지연 발화는 실제 부수효과(GPS 추적 시작)라 no-op 대입류와 달리 취소가
    /// 필수다 — 지연 창에 화면을 떠나면 보이지 않는 곳에서 좀비 세션이 시작된다
    /// (독립 리뷰 MAJOR). onDisappear가 이 Task를 취소한다.
    /// 추적 시트가 닫힌 뒤 시작 버튼 착지. 지연·검증·1회 재시도는 위
    /// `landFocusAfterResolve`와 같은 패턴이다(시트 dismiss 애니메이션이 끝나며
    /// 시스템이 커서를 최상단으로 되돌리므로 그보다 늦게 대입해야 이긴다).
    ///
    /// 다른 탭에서 세션이 끝나도 불리지만, 보이지 않는 뷰에 대한 대입은 no-op이라
    /// 따로 가르지 않는다.
    private func landBeaconStartFocus() {
        // 도보 시작 버튼이 경로 행 disclosure 안으로 이동(M3)해, 접힌 행 안의 버튼은
        // AX 트리에 없어 대입이 조용히 되돌려진다(오프스크린 컬링과 같은 기제) —
        // 대입 전에 소유 행을 강제 펼친다(a11y 감사 HIGH 2026-08-12). 최단 행이
        // 새 조회에서 사라졌으면(.walkShortest인데 walkShortest nil — 최단 실패
        // 흡수·스냅샷 교체) 항상 존재하는 추천 행 버튼으로 폴백한다.
        // transitAlt는 종전 동작 유지(M3 비범위 — 대안 행 접힘은 기존 계약).
        var target = lastGuideStart
        switch target {
        case .walk:
            walkExpandedOverride = true
        case .walkShortest:
            if model.walkShortest == nil {
                target = .walk
                walkExpandedOverride = true
            } else {
                walkShortestExpanded = true
            }
        default:
            break
        }
        let landTarget = target
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(400))
            guideStartFocused = landTarget
            try? await Task.sleep(for: .milliseconds(600))
            guard guideStartFocused != landTarget else { return }
            guideStartFocused = landTarget
        }
    }

    /// 수단별 안내 시작 게이트(B1 §3.1). 도보 = 경로 성공 ∧ ko, 자동차 = 경로 성공
    /// ∧ ko ∧ provider tmap(카카오 폴백은 기하 미지원 — 누르자마자 강등되는 죽은
    /// 버튼을 판별자가 사전 차단). 대중교통 버튼은 B2 전까지 만들지 않는다.
    private var walkGuideStartable: Bool {
        guard AppLanguage.dataLocale == "ko", let results = model.results,
              case .walk = results.outcomes[.walk] else { return false }
        return true
    }

    private var carGuideStartable: Bool {
        guard AppConfig.experimentalGuidanceEnabled,
              AppLanguage.dataLocale == "ko", let results = model.results,
              case let .car(briefing) = results.outcomes[.car],
              briefing.provider == "tmap"
        else { return false }
        return true
    }

    /// 대중교통 게이트(B2 §3.1): 경로 성공 ∧ ko ∧ 탑승 leg ≥ 1(도보 전용 제외).
    /// 추적 불가 leg는 게이트 축이 아니라 세션 안의 정직 상태다. 성립하면 시작에
    /// 넘길 recommended를 그대로 돌려준다(재조회 없음 — 브리핑과 같은 경로, §2).
    private var transitGuideStartable: TransitRoute? {
        guard AppConfig.experimentalGuidanceEnabled,
              AppLanguage.dataLocale == "ko", let results = model.results,
              case let .transit(result) = results.outcomes[.transit],
              buildTransitGuideRoute(result.recommended) != nil
        else { return nil }
        return result.recommended
    }

    /// 대안 경로 시작 게이트(M5 선행분, recommended 전용 해제): 추천과 같은 축
    /// (플래그 ∧ ko ∧ 탑승 leg ≥ 1)을 경로 단위로 판정한다.
    private func altTransitGuideStartable(_ route: TransitRoute) -> Bool {
        AppConfig.experimentalGuidanceEnabled
            && AppLanguage.dataLocale == "ko"
            && buildTransitGuideRoute(route) != nil
    }

    /// 간략 폴백 게이트: 시작 가능한 수단 안내 0개 ∧ 조회 settled(§3.1 — "모든 수단
    /// 실패"가 아니라 "시작 가능 0개". en 로케일·카카오 폴백만 성공한 조합에서
    /// 막다른 화면을 만들지 않는다).
    ///
    /// ⚠ 봉인 플래그 가드가 **여기에도** 필요하다. 아래 판정은 "수단 게이트 0개"라,
    /// 플래그로 세 게이트를 끄면 이 값이 오히려 항상 true가 되어 간략 안내 버튼만
    /// 남는다(봉인의 정반대). 폴백은 "수단이 안 되니 간략이라도"이지 "안내 자체가
    /// 없음"이 아니다.
    private var briefFallbackVisible: Bool {
        guard AppConfig.experimentalGuidanceEnabled else { return false }
        guard case .settled = model.phase else { return false }
        return !walkGuideStartable && !carGuideStartable && transitGuideStartable == nil
    }

    /// 안내 시작의 직접 응답: 이 결과가 수동 위치에서 계산됐다면(`resultsUsedManualOrigin`,
    /// 웹 originSource 미러 — 조회 뒤 수동 위치를 껐다 켰다 해도 화면의 경로가 어디서
    /// 계산됐는지는 바뀌지 않는다) "현재 위치에서 시작한다"를 그
    /// 순간에만 말한다(spec 2026-08-09 §4 "안내 시작 통지"). BeaconModel은 여전히
    /// 실좌표만 쓰므로(소스 가드) 차단이 아니라 고지다.
    ///
    /// 결과 화면 상시 정적 텍스트였던 종전 자리를 폐기한 이유(위원장 판정 2026-08-17):
    /// 그 정보로 갈리는 행동은 안내 시작뿐이라, 안내를 시작하지 않는 사용자(실내에서
    /// 미리 경로만 듣는 수동 위치의 주 용도)에겐 매 조회마다 지나가야 하는 잡음이었다.
    ///
    /// `.high`인 이유: 시작 즉시 추적 시트가 떠 포커스가 그리로 옮겨가고, 기본 우선순위
    /// 통지는 그 착지 낭독에 잠식돼 무발화된다(CLAUDE.md "iOS 통지 우선순위" 판별선 —
    /// 이 문장은 착지 라벨로 대체될 수 없다). 대중교통→도보 핸드오프(`GuideSession.acceptWalkHandoff`)는
    /// 대상이 아니다 — 사용자 활성화가 아니고 그 세션은 이미 실좌표 위에서 돌고 있었다.
    ///
    /// ⚠ `beacon.toggle`은 추적 중이면 **정지**다(간략 폴백 버튼은 두 얼굴 — 추적 중엔
    /// 라벨이 "중지"). 정지하는데 "시작합니다"는 오낭독이라 시작 경로에서만 말한다
    /// (리뷰 검출). 가드를 호출부가 아니라 여기 두는 이유: 호출부 넷이 각자 검사하면
    /// 하나가 빠진다.
    private func announceGuideStartIfManualOrigin() {
        guard !beacon.isTracking, model.resultsUsedManualOrigin else { return }
        var message = AttributedString(appLocalized("manualLocation.guideStartsFromCurrent"))
        message.accessibilitySpeechAnnouncementPriority = .high
        AccessibilityNotification.Announcement(message).post()
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
    /// ⚠ **승격본(A11)이 있으면 그쪽이 목적지다.** 입력 필드는 사용자가 고른 원명을
    /// 유지하고(최근 경로·URL도 원명), 안내·경로 층만 승격본을 쓴다 — 그 비대칭이
    /// 의도이며, 결과 이름(승격본) 자체가 차이의 유일한 표시다(spec §4·N1. 별도 고지
    /// 문장은 2026-08-18 폐기).
    private var trackedDestination: (label: String, dest: BeaconDest)? {
        if let promoted = model.promotedDestination {
            return (promoted.label, BeaconDest(lat: promoted.lat, lng: promoted.lng))
        }
        guard case .place(let label, let lat, let lng) = model.endpoint(for: .to) else { return nil }
        return (label, BeaconDest(lat: lat, lng: lng))
    }

    /// 안내 세션에 넘길 경유지(N4) — 폼의 경유지 그대로(경로 조회와 같은 좌표·라벨).
    /// 안내 시작 버튼 4곳이 전부 이 값을 쓴다(한 곳이 빠지면 경유지 없는 안내가 조용히
    /// 시작된다 — `StartRequest.waypoint`에 기본값이 없는 이유).
    private var sessionWaypoint: BeaconModel.Waypoint? {
        guard case .place(let label, let lat, let lng) = model.via else { return nil }
        return BeaconModel.Waypoint(dest: BeaconDest(lat: lat, lng: lng), label: label)
    }

    /// 마지막 도보 구간이 가리킬 목적지 이름(spec §4.3). "현재 위치"는 좌표이지
    /// 장소 이름이 아니라 nil이고, 그때 표시 계층이 "목적지까지"라는 구간 의미로
    /// 떨어진다(이름 부재와 구간 의미 부재는 다른 층이다).
    private var destinationPlaceName: String? {
        if let promoted = model.promotedDestination { return promoted.label }
        guard case .place(let label, _, _) = model.endpoint(for: .to) else { return nil }
        return label
    }

    /// 필드 한 줄 = 한 객체: "출발지, 현재 위치"처럼 라벨+값 단일 텍스트(쉼표 결합).
    /// 미확정 필드는 검색 유도 라벨이 곧 버튼 이름.
    private func fieldText(_ target: DirectionsFieldTarget) -> String {
        let label = target == .from ? appLocalized("directions.from") : appLocalized("directions.to")  // via는 위 폼 인라인
        switch model.endpoint(for: target) {
        case .current:
            return "\(label), \(currentLocationText)"
        case .place(let name, _, _):
            return "\(label), \(name)"
        case nil:
            return target == .from ? appLocalized("directions.searchFrom") : appLocalized("directions.searchTo")
        }
    }

    /// 현재 위치 값 텍스트(F-B): 수동 위치가 켜져 있으면 그 라벨(표시줄과 **같은 훅**을
    /// 써 검증 가능/불가 판정선이 갈리지 않게 한다 — 3-state 정직성), 그 외 재측위 중 →
    /// 진행 라벨, 주소 확보 → 주소 병기, 기본 "현재 위치". 한 줄 = 한 객체(필드
    /// 버튼 단일 텍스트에 흡수).
    private var currentLocationText: String {
        if let manual = manualLocationLabel(manualLocationStore) { return manual }
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
            // 추천·대안을 한 목록으로 낸다(disclosure를 쌓은 accordion). 라벨·컨트롤·
            // 본문 구성이 모두 같고 **초기 펼침 상태만** 다르다 — 추천만 펼친 채로
            // 시작한다. 종전엔 추천만 라벨 없이 통째로 펼쳐져 있어 같은 지위의
            // 경로들이 서로 다른 컨트롤로 보였다(위원장 지적 2026-08-07).
            ForEach(transitRouteEntries(result), id: \.route.routeKey) { entry in
                DisclosureGroup(isExpanded: Binding(
                    get: {
                        expandedAlts.contains(entry.route.routeKey)
                            ? !entry.defaultExpanded : entry.defaultExpanded
                    },
                    set: { expanded in
                        if expanded == entry.defaultExpanded {
                            expandedAlts.remove(entry.route.routeKey)
                        } else {
                            expandedAlts.insert(entry.route.routeKey)
                        }
                    }
                )) {
                    // 안내 시작은 경로에 귀속된다. 세션 UI는 별도 시트라 disclosure
                    // 접힘이 세션을 죽이지 않는다(웹과 다름. 웹은 세션 UI가 접힘
                    // 안에 있어 활성 경로의 접힘 클릭을 무시해야 한다).
                    if altTransitGuideStartable(entry.route), let tracked = trackedDestination {
                        Button(appLocalized("beacon.guideStartTransitAlt", entry.name)) {
                            lastGuideStart = .transitAlt(entry.route.routeKey)
                            session.startTransit(
                                route: entry.route, destinationLabel: tracked.label,
                                dest: tracked.dest, accessible: model.stepFreeEnabled
                            )
                        }
                        .accessibilityFocused(
                            $guideStartFocused, equals: .transitAlt(entry.route.routeKey))
                    }
                    // 라벨이 이미 요약이라 본문은 구간만(인접 중복 금지).
                    TransitRouteRows(
                        route: entry.route, includeSummary: false,
                        destinationName: destinationPlaceName)
                } label: {
                    Text(joinText(entry.name, transitSummaryText(entry.route.summary)))
                }
            }
        case .walk(let briefing):
            // 추천·최단 2행 disclosure(M3 spec §4, 대중교통 대안 동형). 라벨이 곧
            // 요약 전문이라 본문은 단계만 낸다. 한 줄 = 한 접근성 객체(쉼표 결합).
            // 추천 행 기본 펼침은 종전 문턱 판정 유지(장거리 도보 상세는 채택
            // 가능성이 사실상 0인데 수백 행으로 페이지 끝단을 채운다 — 위원장 판정
            // 2026-08-07), 최단 행은 대안 동형으로 기본 접힘.
            // ⚠ 계단 회피 토글은 이 접힘 **밖**(섹션 상단)이지만, 안내 시작 버튼은
            //   경로가 복수가 되며 대중교통과 같은 이유로 각 행 **안**에 있다(버튼이
            //   경로에 귀속 — 라벨과 행이 같은 경로를 가리켜야 한다).
            DisclosureGroup(isExpanded: Binding(
                get: {
                    walkExpandedOverride
                        ?? (walkDisplayMinutes(briefing) <= walkCollapseThresholdMinutes)
                },
                set: { walkExpandedOverride = $0 }
            )) {
                if walkGuideStartable, let tracked = trackedDestination {
                    Button(appLocalized("beacon.guideStartWalk")) {
                        lastGuideStart = .walk
                        announceGuideStartIfManualOrigin()
                        session.startBeacon(BeaconModel.StartRequest(
                            dest: tracked.dest, label: tracked.label, kind: .walk,
                            accessible: model.stepFreeEnabled, variant: nil,
                            shortestAvailable: model.walkShortest != nil,
                            waypoint: sessionWaypoint
                        ))
                    }
                    .accessibilityFocused($guideStartFocused, equals: .walk)
                }
                WalkRouteRows(briefing: briefing, includeSummary: false, omitNoticeStep: true,
                              waypointLabel: model.viaLabel)
            } label: {
                // stepFreeNotice는 両행 라벨에 병기한다(a11y 감사 — 안전 문장이 접힘
                // 뒤에 갇히면 안 되고, 접힘 상태에선 라벨이 유일한 전달 채널이다).
                distanceText(joinText(
                    appLocalized("ios.directions.walkRecommended"),
                    walkSummaryText(briefing),
                    briefing.stepFreeNotice))
            }
            // 최단 행: 같은 응답에서 온 쌍만(model.walkShortest 계약). 실패·부재 시
            // 행 자체를 그리지 않는다(死행 금지, spec §4). stepFreeNotice는 요약 뒤
            // 쉼표 병기 — 기본 접힘이라 라벨이 유일한 전달 채널이다.
            if let shortest = model.walkShortest {
                DisclosureGroup(isExpanded: $walkShortestExpanded) {
                    if walkGuideStartable, let tracked = trackedDestination {
                        Button(appLocalized("beacon.guideStartWalkShortest")) {
                            lastGuideStart = .walkShortest
                            announceGuideStartIfManualOrigin()
                            session.startBeacon(BeaconModel.StartRequest(
                                dest: tracked.dest, label: tracked.label, kind: .walk,
                                accessible: model.stepFreeEnabled, variant: .shortest,
                                shortestAvailable: false, waypoint: sessionWaypoint
                            ))
                        }
                        .accessibilityFocused($guideStartFocused, equals: .walkShortest)
                    }
                    WalkRouteRows(briefing: shortest, includeSummary: false, omitNoticeStep: true,
                                  waypointLabel: model.viaLabel)
                } label: {
                    distanceText(joinText(
                        appLocalized("ios.directions.walkShortest"),
                        walkSummaryText(shortest),
                        shortest.stepFreeNotice))
                }
            }
        case .car(let briefing): CarRouteRows(briefing: briefing, waypointLabel: model.viaLabel)
        case .empty: Text(noRouteText(mode))
        case .error: Text(errorText(mode))
        // 경유지 미지원(N4, 대중교통) — 실패도 경로 없음도 아닌 정직 상태 한 문장.
        case .unsupportedWaypoint: Text(appLocalized("directions.unsupportedWaypoint"))
        case .gated, .outOfCoverage, nil: EmptyView()  // displayedModes가 걸러 도달하지 않는다
        }
    }
}

/// 대중교통 경로 목록의 한 항목(추천·대안 공통 — 컨트롤이 같고 초기 펼침만 다르다).
/// TransitTrackingSheet의 목적지 전환 후보 섹션도 공유한다(스펙 2026-08-12 §4.1 —
/// 같은 라벨 조립이라 private 해제).
struct TransitRouteEntry {
    let route: TransitRoute
    let name: String
    let defaultExpanded: Bool
}

/// 추천은 축 라벨을 갖지 않는다(`annotateHighlights`: "자기보다 나은 자기는 없다") —
/// 고정 이름이 정답이다. 대안은 축 이름(가장 빠른·환승이 가장 적은)이 번호보다 구분에
/// 강하고, 같은 이름을 라벨과 안내 시작 버튼이 공유해야 VO 로터에서 고른 버튼과 화면의
/// 항목이 같은 것으로 들린다(spec §4.1·§4.2).
func transitRouteEntries(_ result: TransitRouteResult) -> [TransitRouteEntry] {
    [TransitRouteEntry(
        route: result.recommended,
        name: appLocalized("route.transit.recommended"),
        defaultExpanded: true)]
        + result.alternatives.map {
            TransitRouteEntry(
                route: $0, name: transitAlternativeName($0), defaultExpanded: false)
        }
}
