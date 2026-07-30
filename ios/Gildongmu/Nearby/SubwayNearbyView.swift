import SwiftUI
import Observation
import GildongmuKit

/// 내 주변 지하철 도착 — NearbyLoadCore 껍데기(규범 원형). 상태 머신·전이표는 Kit 정본.
@Observable @MainActor
final class SubwayNearbyModel {
    private let core: NearbyLoadCore<[NearbySubwayStation]>
    var phase: NearbyLoadPhase<[NearbySubwayStation]> { core.phase }

    init() {
        let service = NearbyService(client: APIClient(baseURL: AppConfig.apiBaseURL))
        core = NearbyLoadCore(
            coordinate: LocationService.nearbyCoordinateSource(),
            coverage: .korea,
            fetch: { coord, _ in
                guard let coord else { preconditionFailure("current 소스는 좌표 보장") }
                return try await service.subwayArrivals(lat: coord.lat, lng: coord.lng)
            },
            onEvent: nearbyAnnouncer(loaded: { stations in
                nearbyLoadedMessage(count: stations.count, unit: appLocalized("ios.nearby.unitStation"))
            }))
    }

    func load(force: Bool = false) async { await core.load(force: force) }
}

struct SubwayNearbyView: View {
    @State private var model = SubwayNearbyModel()

    var body: some View {
        List {
            if case .loaded(let stations) = model.phase {
                ForEach(stations, id: \.stationName) { station in
                    Section {
                        // 역명만 heading(웹 h4 규칙). 노선·거리는 같은 줄에 흡수.
                        Text(joinText(station.stationName, station.lines.joined(separator: ", "), "\(station.distanceMeters)m"))
                            .accessibilityAddTraits(.isHeader)
                        if station.arrivalStatus == "unavailable" {
                            Text(appLocalized("ios.nearby.arrivalUnavailable"))   // 조회 실패 ≠ 열차 없음
                        } else if station.arrivals.isEmpty {
                            Text(appLocalized("ios.station.noArrivals"))
                        } else {
                            ForEach(Array(station.arrivals.enumerated()), id: \.offset) { _, arrival in
                                // 완성 문장 정본 message 그대로. 급행은 텍스트로 흡수.
                                Text(joinText(arrival.line, arrival.express ? appLocalized("subwayArrival.express") : nil, arrival.trainLineNm, arrival.message))
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle(appLocalized("ios.nearby.subway"))
        .nearbyStateOverlay {
            NearbyStateOverlayView(phase: model.phase, descriptor: .list(
                empty: NearbyOverlayCopy(appLocalized("ios.nearby.subwayEmpty"), systemImage: "tram"),
                isEmpty: \.isEmpty))
        }
        .task { await model.load() }
        .nearbyRefreshable { await model.load(force: true) }
    }
}
