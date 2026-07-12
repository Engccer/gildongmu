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
            announceLoaded(count: stations.count, unit: "대여소")
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
                                  "대여 가능 \(station.bikesAvailable)대", "거치대 \(station.racksTotal)대"))
                }
            }
        }
        .navigationTitle("따릉이 대여소")
        .nearbyStateOverlay { stateOverlay }
        .task { await model.load() }
        .nearbyRefreshable { await model.load(force: true) }
    }

    @ViewBuilder private var stateOverlay: some View {
        switch model.state {
        case .loading: ProgressView("확인 중")
        case .denied:
            ContentUnavailableView("위치 권한이 필요합니다", systemImage: "location.slash",
                description: Text("설정 앱에서 길동무 베타의 위치 접근을 허용해 주세요"))
        case .failed:
            ContentUnavailableView("정보를 가져오지 못했습니다", systemImage: "wifi.exclamationmark",
                description: Text("잠시 후 다시 시도해 주세요"))
        case .loaded(let stations) where stations.isEmpty:
            ContentUnavailableView("주변에 따릉이 대여소가 없습니다", systemImage: "bicycle")
        default: EmptyView()
        }
    }
}
