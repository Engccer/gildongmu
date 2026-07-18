import SwiftUI
import Observation
import Accessibility
import GildongmuKit

/// 내 주변 따릉이 대여소. SubwayNearbyModel 규범 패턴 미러(3-state 권한 거부/조회 실패/0건 분리).
/// 정수 필드라 "0대"와 "정보 없음"의 구조적 혼동 없음.
@Observable @MainActor
final class BikeNearbyModel {
    private(set) var state: NearbyLoadState<BikeStation> = .idle
    private let service = NearbyService(client: APIClient(baseURL: AppConfig.apiBaseURL))
    /// 재진입 가드(웹 in-flight ref 가드 미러): 로드 진행 중 재호출은 즉시 무시
    private var isLoadingInFlight = false

    func load(force: Bool = false) async {
        if isLoadingInFlight { return }
        isLoadingInFlight = true
        defer { isLoadingInFlight = false }
        // 직전 성공 데이터가 있으면 유지한 채 재조회, 그 외(첫 로드·실패 후 재시도)는 로딩 표시
        if case .loaded = state {} else { state = .loading }
        do {
            let coord = try await LocationService.shared.currentCoordinate(force: force)
            let stations = try await service.bikeStations(lat: coord.lat, lng: coord.lng)
            state = .loaded(stations)
            announceLoaded(count: stations.count, unit: appLocalized("ios.nearby.unitBike"))
        } catch let error as LocationService.LocationError {
            if case .denied = error {
                // loaded에서 권한 취소로 전락하면 목록이 통째로 사라진다 — 무신호 화면 전환 방지 통지
                if case .loaded = state { announcePermissionLost() }
                state = .denied
            } else if case .loaded = state { announceRefreshFailed() } else { state = .failed }
        } catch {
            // 조회 실패: 직전 성공 데이터가 있으면 유지(새로고침=재조회이지 데이터 포기 아님)
            if case .loaded = state { announceRefreshFailed() } else { state = .failed }
        }
    }
}

struct BikeNearbyView: View {
    @State private var model = BikeNearbyModel()

    var body: some View {
        List {
            if case .loaded(let stations) = model.state {
                ForEach(stations, id: \.stationId) { station in
                    // 한 줄 = 한 접근성 객체. 대여소명·거리·대여 가능·거치대를 단일 텍스트로 흡수(heading 없음).
                    Text(joinText(station.name, "\(station.distanceMeters)m",
                                  appLocalized("ios.nearby.bikesAvailable", String(station.bikesAvailable)), appLocalized("ios.nearby.racksTotal", String(station.racksTotal))))
                }
            }
        }
        .navigationTitle(appLocalized("ios.nearby.bike"))
        .nearbyStateOverlay { stateOverlay }
        .task { await model.load() }
        .nearbyRefreshable { await model.load(force: true) }
    }

    @ViewBuilder private var stateOverlay: some View {
        switch model.state {
        case .loading: ProgressView(appLocalized("ios.common.checking"))
        case .denied:
            ContentUnavailableView(appLocalized("ios.common.geoDeniedTitle"), systemImage: "location.slash",
                description: Text(appLocalized("ios.common.geoDeniedDesc")))
        case .failed:
            ContentUnavailableView(appLocalized("ios.common.failedTitle"), systemImage: "wifi.exclamationmark",
                description: Text(appLocalized("ios.common.retryLater")))
        case .loaded(let stations) where stations.isEmpty:
            ContentUnavailableView(appLocalized("ios.nearby.bikeEmpty"), systemImage: "bicycle")
        default: EmptyView()
        }
    }
}
