import SwiftUI
import Observation
import GildongmuKit

/// 내 주변 따릉이 대여소 — NearbyLoadCore 껍데기(SubwayNearbyModel 규범 패턴 미러).
/// 정수 필드라 "0대"와 "정보 없음"의 구조적 혼동 없음.
@Observable @MainActor
final class BikeNearbyModel {
    private let core: NearbyLoadCore<[BikeStation]>
    var phase: NearbyLoadPhase<[BikeStation]> { core.phase }

    init() {
        let service = NearbyService(client: APIClient(baseURL: AppConfig.apiBaseURL))
        core = NearbyLoadCore(
            coordinate: LocationService.nearbyCoordinateSource(),
            coverage: .korea,
            fetch: { coord, _ in
                guard let coord else { preconditionFailure("current 소스는 좌표 보장") }
                return try await service.bikeStations(lat: coord.lat, lng: coord.lng)
            },
            onEvent: nearbyAnnouncer(loaded: { stations in
                nearbyLoadedMessage(count: stations.count, unit: appLocalized("ios.nearby.unitBike"))
            }))
    }

    func load(force: Bool = false) async { await core.load(force: force) }
}

struct BikeNearbyView: View {
    @State private var model = BikeNearbyModel()

    var body: some View {
        List {
            if case .loaded(let stations) = model.phase {
                ForEach(stations, id: \.stationId) { station in
                    // 한 줄 = 한 접근성 객체. 대여소명·거리·대여 가능·거치대를 단일 텍스트로 흡수(heading 없음).
                    Text(joinText(station.name, "\(station.distanceMeters)m",
                                  appLocalized("ios.nearby.bikesAvailable", String(station.bikesAvailable)), appLocalized("ios.nearby.racksTotal", String(station.racksTotal))))
                }
            }
        }
        .navigationTitle(appLocalized("ios.nearby.bike"))
        .nearbyStateOverlay {
            NearbyStateOverlayView(phase: model.phase, descriptor: .list(
                empty: NearbyOverlayCopy(appLocalized("ios.nearby.bikeEmpty"), systemImage: "bicycle"),
                isEmpty: \.isEmpty))
        }
        .task { await model.load() }
        .nearbyRefreshable { await model.load(force: true) }
    }
}
