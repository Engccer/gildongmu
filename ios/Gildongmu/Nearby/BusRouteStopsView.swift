import SwiftUI
import Observation
import GildongmuKit

/// 버스 노선 경유 정류소(도착 행에서 push). 거의 불변 데이터라 서버가 하루 캐시(웹 BusRouteStops.tsx 미러).
@Observable @MainActor
final class BusRouteStopsModel {
    private(set) var state: NearbyLoadState<BusRouteStop> = .idle
    private let service = NearbyService(client: APIClient(baseURL: AppConfig.apiBaseURL))
    /// 재진입 가드(웹 in-flight ref 가드 미러, M2 공통 패턴)
    private var isLoadingInFlight = false

    func load(source: String, cityCode: String?, routeId: String) async {
        if isLoadingInFlight { return }
        isLoadingInFlight = true
        defer { isLoadingInFlight = false }
        // 직전 성공 데이터가 있으면 유지한 채 재조회, 그 외(첫 로드·실패 후 재시도)는 로딩 표시
        if case .loaded = state {} else { state = .loading }
        do {
            let stops = try await service.busRouteStops(source: source, cityCode: cityCode, routeId: routeId)
            state = .loaded(stops)
            announceLoaded(count: stops.count, unit: appLocalized("ios.nearby.unitStop"))
        } catch {
            // 조회 실패: 직전 성공 데이터가 있으면 유지(새로고침=재조회이지 데이터 포기 아님)
            if case .loaded = state { announceRefreshFailed() } else { state = .failed }
        }
    }
}

struct BusRouteStopsView: View {
    let source: String
    let cityCode: String?
    let routeId: String
    let routeNo: String
    @State private var model = BusRouteStopsModel()

    var body: some View {
        List {
            if case .loaded(let stops) = model.state {
                // 순번 오름차순 데이터, id는 nodeId(정류소명 중복 실존)
                ForEach(stops, id: \.nodeId) { stop in
                    Text("\(stop.order), \(stop.name)")
                }
            }
        }
        .navigationTitle(appLocalized("ios.nearby.routeStopsTitle", routeNo))
        .nearbyStateOverlay { stateOverlay }
        .task { await model.load(source: source, cityCode: cityCode, routeId: routeId) }
        .nearbyRefreshable { await model.load(source: source, cityCode: cityCode, routeId: routeId) }
    }

    @ViewBuilder private var stateOverlay: some View {
        switch model.state {
        case .loading: ProgressView(appLocalized("ios.nearby.routeStopsLoading"))
        case .failed:
            ContentUnavailableView(appLocalized("ios.nearby.routeStopsFailed"), systemImage: "wifi.exclamationmark")
        case .loaded(let stops) where stops.isEmpty:
            ContentUnavailableView(appLocalized("ios.nearby.routeStopsEmpty"), systemImage: "bus")
        default: EmptyView()
        }
    }
}
