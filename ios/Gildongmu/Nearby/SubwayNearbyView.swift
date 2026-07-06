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
        if case .idle = state { state = .loading }
        do {
            let coord = try await LocationService.shared.currentCoordinate(force: force)
            let stations = try await service.subwayArrivals(lat: coord.lat, lng: coord.lng)
            state = .loaded(stations)
            announceLoaded(count: stations.count, unit: "역")
        } catch let error as LocationService.LocationError {
            if case .denied = error { state = .denied } else if case .loaded = state {} else { state = .failed }
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
                            Text("도착 정보를 가져오지 못했습니다")   // 조회 실패 ≠ 열차 없음
                        } else if station.arrivals.isEmpty {
                            Text("도착 예정 열차가 없습니다")
                        } else {
                            ForEach(Array(station.arrivals.enumerated()), id: \.offset) { _, arrival in
                                // 완성 문장 정본 message 그대로. 급행은 텍스트로 흡수.
                                Text(joinText(arrival.line, arrival.express ? "급행" : nil, arrival.trainLineNm, arrival.message))
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("지하철 도착")
        .overlay { stateOverlay }
        .task { await model.load() }
        .refreshable { await model.load(force: true) }
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
            ContentUnavailableView("주변에 지하철역이 없습니다", systemImage: "tram")
        default: EmptyView()
        }
    }
}
