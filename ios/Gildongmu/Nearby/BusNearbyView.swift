import SwiftUI
import Observation
import Accessibility
import GildongmuKit

/// 내 주변 버스 도착. 지하철 화면(SubwayNearbyView)의 규범 패턴을 미러링한다:
/// 3-state(권한 거부/조회 실패/0건) 분리, 도착 문장 정본은 서울 TOPIS arrivalMessage(arrmsg1),
/// TAGO는 arrivalMessage가 nil이라 슬롯(정류장 수·초)을 조합해 렌더.
@Observable @MainActor
final class BusNearbyModel {
    private(set) var state: NearbyLoadState<BusStop> = .idle
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
            // 위치 취득 직후 선분기(네트워크 생략) — 서버 마커 catch와 이중 방어.
            guard isInKorea(lat: coord.lat, lng: coord.lng) else {
                if case .loaded = state { announceOutOfCoverage() }
                state = .outOfCoverage
                return
            }
            let stops = try await service.busStops(lat: coord.lat, lng: coord.lng)
            state = .loaded(stops)
            announceLoaded(count: stops.count, unit: appLocalized("ios.nearby.unitStop"))
        } catch let error as LocationService.LocationError {
            if case .denied = error {
                // loaded에서 권한 취소로 전락하면 목록이 통째로 사라진다 — 무신호 화면 전환 방지 통지
                if case .loaded = state { announcePermissionLost() }
                state = .denied
            } else if case .loaded = state { announceRefreshFailed() } else { state = .failed }
        } catch APIError.outOfCoverage {
            if case .loaded = state { announceOutOfCoverage() }
            state = .outOfCoverage
        } catch {
            // 조회 실패: 직전 성공 데이터가 있으면 유지(새로고침=재조회이지 데이터 포기 아님)
            if case .loaded = state { announceRefreshFailed() } else { state = .failed }
        }
    }
}

struct BusNearbyView: View {
    @State private var model = BusNearbyModel()

    var body: some View {
        List {
            if case .loaded(let stops) = model.state {
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
        .navigationTitle(appLocalized("ios.nearby.bus"))
        .nearbyStateOverlay { stateOverlay }
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

    @ViewBuilder private var stateOverlay: some View {
        switch model.state {
        case .loading: ProgressView(appLocalized("ios.common.checking"))
        case .denied:
            ContentUnavailableView(appLocalized("ios.common.geoDeniedTitle"), systemImage: "location.slash",
                description: Text(appLocalized("ios.common.geoDeniedDesc")))
        case .failed:
            ContentUnavailableView(appLocalized("ios.common.failedTitle"), systemImage: "wifi.exclamationmark",
                description: Text(appLocalized("ios.common.retryLater")))
        case .outOfCoverage:
            ContentUnavailableView(appLocalized("ios.common.outOfCoverage"), systemImage: "map")
        case .loaded(let stops) where stops.isEmpty:
            ContentUnavailableView(appLocalized("ios.nearby.busEmpty"), systemImage: "bus")
        default: EmptyView()
        }
    }
}
