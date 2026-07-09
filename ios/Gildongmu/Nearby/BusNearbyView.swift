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
        if case .idle = state { state = .loading }
        do {
            let coord = try await LocationService.shared.currentCoordinate(force: force)
            let stops = try await service.busStops(lat: coord.lat, lng: coord.lng)
            state = .loaded(stops)
            announceLoaded(count: stops.count, unit: "정류소")
        } catch let error as LocationService.LocationError {
            if case .denied = error { state = .denied } else if case .loaded = state {} else { state = .failed }
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
                            Text("도착 정보를 가져오지 못했습니다")   // 조회 실패 ≠ 버스 없음
                        } else if stop.arrivals.isEmpty {
                            Text("도착 예정 버스가 없습니다")
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
                                .accessibilityHint("경유 정류소 보기")
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("버스 도착")
        .overlay { stateOverlay }
        .task { await model.load() }
        .refreshable { await model.load(force: true) }
    }

    /// 도착 한 줄 결합. 저상은 교통약자 정본이라 텍스트로 흡수.
    /// arrivalMessage(서울 완성 문장)가 있으면 그대로, 없으면(TAGO) 슬롯 조합.
    private func arrivalLine(_ arrival: BusArrival) -> String {
        let lowFloor = arrival.lowFloor ? "저상" : nil
        if let message = arrival.arrivalMessage, !message.isEmpty {
            return joinText(arrival.routeNo + "번", arrival.routeType, lowFloor, message)
        }
        return joinText(arrival.routeNo + "번", arrival.routeType, lowFloor,
                        "\(arrival.prevStationCount)정류장 전",
                        "약 \(max(1, arrival.arrivalSeconds / 60))분 후")
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
        case .loaded(let stops) where stops.isEmpty:
            ContentUnavailableView("주변에 버스 정류소가 없습니다", systemImage: "bus")
        default: EmptyView()
        }
    }
}
