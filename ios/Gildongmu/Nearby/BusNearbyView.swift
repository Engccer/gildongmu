import SwiftUI
import Observation
import GildongmuKit

/// 내 주변 버스 도착 — NearbyLoadCore 껍데기(SubwayNearbyModel 규범 패턴 미러).
/// 도착 문장 정본은 서울 TOPIS arrivalMessage(arrmsg1), TAGO는 arrivalMessage가 nil이라
/// 슬롯(정류장 수·초)을 조합해 렌더.
/// anchor: nil = 현재 위치(내 주변 허브), 좌표 = 그 좌표 고정(장소 상세 "이 장소 주변").
@Observable @MainActor
final class BusNearbyModel {
    private let core: NearbyLoadCore<[BusStop]>
    var phase: NearbyLoadPhase<[BusStop]> { core.phase }

    init(anchor: PlaceAnchor? = nil) {
        let service = NearbyService(client: APIClient(baseURL: AppConfig.apiBaseURL))
        core = NearbyLoadCore(
            coordinate: anchor.map { .fixed($0.coord) } ?? LocationService.nearbyCoordinateSource(),
            coverage: .korea,
            fetch: { coord, _ in
                guard let coord else { preconditionFailure("current·fixed 소스는 좌표 보장") }
                return try await service.busStops(lat: coord.lat, lng: coord.lng)
            },
            onEvent: nearbyAnnouncer(loaded: { stops in
                nearbyLoadedMessage(count: stops.count, unit: appLocalized("ios.nearby.unitStop"))
            }))
    }

    func load(force: Bool = false) async { await core.load(force: force) }
}

struct BusNearbyView: View {
    private let anchor: PlaceAnchor?
    @State private var model: BusNearbyModel

    /// anchor 기본값 nil = 현재 위치(내 주변 허브 호출처 무변경).
    /// State(initialValue:) 인자는 순수 생성만(부수효과 금지) — [[swiftui-state-initialvalue-side-effect]]
    init(anchor: PlaceAnchor? = nil) {
        self.anchor = anchor
        _model = State(initialValue: BusNearbyModel(anchor: anchor))
    }

    var body: some View {
        List {
            if case .loaded(let stops) = model.phase {
                // 정류소명 중복 실존(같은 이름 서로 다른 nodeId) → id는 nodeId
                ForEach(stops, id: \.nodeId) { stop in
                    Section {
                        // 정류소명만 heading(웹 h4 규칙). 표지판 번호·거리는 같은 줄에 흡수.
                        Text(joinText(stop.name, stop.stopNo, "\(stop.distanceMeters)m"))
                            .accessibilityAddTraits(.isHeader)
                        if stop.arrivalStatus == "unavailable" {
                            Text(appLocalized("ios.nearby.arrivalUnavailable"))   // 조회 실패 ≠ 버스 없음
                        } else if stop.arrivals.isEmpty {
                            Text(appLocalized("ios.nearby.noBusArrivals"))
                        } else {
                            ForEach(Array(stop.arrivals.enumerated()), id: \.offset) { _, arrival in
                                NavigationLink {
                                    BusRouteStopsView(
                                        source: stop.source,
                                        cityCode: stop.source == "tago" ? stop.cityCode : nil,
                                        routeId: arrival.routeId,
                                        routeNo: arrival.routeNo)
                                } label: {
                                    Text(arrivalLine(arrival))
                                }
                                .accessibilityHint(appLocalized("ios.nearby.routeStopsHint"))
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle(nearbyTitle(appLocalized("ios.nearby.bus"), anchor: anchor))
        .nearbyStateOverlay {
            NearbyStateOverlayView(phase: model.phase, descriptor: .list(
                empty: NearbyOverlayCopy(appLocalized("ios.nearby.busEmpty"), systemImage: "bus"),
                isEmpty: \.isEmpty))
        }
        .task { await model.load() }
        .nearbyRefreshable { await model.load(force: true) }
    }

    /// 도착 한 줄 결합. 저상은 교통약자 정본이라 텍스트로 흡수.
    /// arrivalMessage(서울 완성 문장)가 있으면 그대로, 없으면(TAGO) 슬롯 조합.
    private func arrivalLine(_ arrival: BusArrival) -> String {
        let lowFloor = arrival.lowFloor ? appLocalized("ios.nearby.lowFloor") : nil
        if let message = arrival.arrivalMessage, !message.isEmpty {
            return joinText(appLocalized("ios.nearby.routeNo", arrival.routeNo), arrival.routeType, lowFloor, message)
        }
        return joinText(appLocalized("ios.nearby.routeNo", arrival.routeNo), arrival.routeType, lowFloor,
                        "\(arrival.prevStationCount)정류장 전",
                        appLocalized("ios.nearby.minutesAway", String(max(1, arrival.arrivalSeconds / 60))))
    }
}
