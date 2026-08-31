import SwiftUI
import Observation
import GildongmuKit

/// 버스 노선 경유 정류소(도착 행에서 push) — NearbyLoadCore 껍데기, 파라미터형 원형
/// (coordinate: .none·coverage: .none — 좌표 단계 생략, init 파라미터를 fetch 클로저가 캡처).
/// 거의 불변 데이터라 서버가 하루 캐시(웹 BusRouteStops.tsx 미러).
@Observable @MainActor
final class BusRouteStopsModel {
    private let core: NearbyLoadCore<[BusRouteStop]>
    var phase: NearbyLoadPhase<[BusRouteStop]> { core.phase }

    init(source: String, cityCode: String?, routeId: String) {
        let service = NearbyService(client: APIClient(baseURL: AppConfig.apiBaseURL))
        core = NearbyLoadCore(
            coordinate: .none,
            coverage: .none,
            fetch: { _, _ in
                try await service.busRouteStops(source: source, cityCode: cityCode, routeId: routeId)
            },
            onEvent: nearbyAnnouncer(loaded: { stops in
                nearbyLoadedMessage(count: stops.count, kind: .busStops)
            }))
    }

    func load(force: Bool = false) async { await core.load(force: force) }
}

struct BusRouteStopsView: View {
    let routeNo: String
    @State private var model: BusRouteStopsModel

    init(source: String, cityCode: String?, routeId: String, routeNo: String) {
        self.routeNo = routeNo
        // State(initialValue:) 인자는 순수 생성만(부수효과 금지) — [[swiftui-state-initialvalue-side-effect]]
        _model = State(initialValue: BusRouteStopsModel(source: source, cityCode: cityCode, routeId: routeId))
    }

    var body: some View {
        List {
            if case .loaded(let stops) = model.phase {
                // 순번 오름차순 데이터, id는 nodeId(정류소명 중복 실존)
                ForEach(stops, id: \.nodeId) { stop in
                    Text("\(stop.order), \(stop.name)")
                }
            }
        }
        .navigationTitle(appLocalized("ios.nearby.routeStopsTitle", routeNo))
        .nearbyStateOverlay {
            let failedCopy = NearbyOverlayCopy(appLocalized("ios.nearby.routeStopsFailed"), systemImage: "wifi.exclamationmark")
            NearbyStateOverlayView(
                phase: model.phase,
                onPreciseGranted: { Task { await model.load(force: true) } },
                descriptor: .list(
                empty: NearbyOverlayCopy(appLocalized("ios.nearby.routeStopsEmpty"), systemImage: "bus"),
                isEmpty: \.isEmpty,
                loadingText: appLocalized("ios.nearby.routeStopsLoading"),
                failedLocation: failedCopy,
                failedServer: failedCopy))
        }
        .task { await model.load() }
        .nearbyRefreshable { await model.load(force: true) }
    }
}
