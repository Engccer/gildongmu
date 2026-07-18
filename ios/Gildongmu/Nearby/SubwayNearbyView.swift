import SwiftUI
import Observation
import Accessibility
import GildongmuKit

/// 내 주변 지하철 도착. 3-state(권한 거부/조회 실패/0건) 분리와
/// 도착 문장 정본(message=arvlMsg2)이 규범. 다른 5개 화면이 이 패턴을 미러링한다.
@Observable @MainActor
final class SubwayNearbyModel {
    private(set) var state: NearbyLoadState<NearbySubwayStation> = .idle
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
            let stations = try await service.subwayArrivals(lat: coord.lat, lng: coord.lng)
            state = .loaded(stations)
            announceLoaded(count: stations.count, unit: String(localized: "ios.nearby.unitStation"))
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

struct SubwayNearbyView: View {
    @State private var model = SubwayNearbyModel()

    var body: some View {
        List {
            if case .loaded(let stations) = model.state {
                ForEach(stations, id: \.stationName) { station in
                    Section {
                        // 역명만 heading(웹 h4 규칙). 노선·거리는 같은 줄에 흡수.
                        Text(joinText(station.stationName, station.lines.joined(separator: ", "), "\(station.distanceMeters)m"))
                            .accessibilityAddTraits(.isHeader)
                        if station.arrivalStatus == "unavailable" {
                            Text(String(localized: "ios.nearby.arrivalUnavailable"))   // 조회 실패 ≠ 열차 없음
                        } else if station.arrivals.isEmpty {
                            Text(String(localized: "ios.station.noArrivals"))
                        } else {
                            ForEach(Array(station.arrivals.enumerated()), id: \.offset) { _, arrival in
                                // 완성 문장 정본 message 그대로. 급행은 텍스트로 흡수.
                                Text(joinText(arrival.line, arrival.express ? String(localized: "subwayArrival.express") : nil, arrival.trainLineNm, arrival.message))
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle(String(localized: "ios.nearby.subway"))
        .nearbyStateOverlay { stateOverlay }
        .task { await model.load() }
        .nearbyRefreshable { await model.load(force: true) }
    }

    @ViewBuilder private var stateOverlay: some View {
        switch model.state {
        case .loading: ProgressView(String(localized: "ios.common.checking"))
        case .denied:
            ContentUnavailableView(String(localized: "ios.common.geoDeniedTitle"), systemImage: "location.slash",
                description: Text(String(localized: "ios.common.geoDeniedDesc")))
        case .failed:
            ContentUnavailableView(String(localized: "ios.common.failedTitle"), systemImage: "wifi.exclamationmark",
                description: Text(String(localized: "ios.common.retryLater")))
        case .loaded(let stations) where stations.isEmpty:
            ContentUnavailableView(String(localized: "ios.nearby.subwayEmpty"), systemImage: "tram")
        default: EmptyView()
        }
    }
}
