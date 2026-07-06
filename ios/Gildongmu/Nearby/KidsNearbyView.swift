import SwiftUI
import Observation
import Accessibility
import GildongmuKit

/// 내 주변 아이 놀 곳. 규범(SubwayNearbyView) 패턴 미러: 평면 행이라 Section·heading 없이
/// 한 항목을 단일 텍스트로 합친다. indoorOutdoor는 3-state라 unknown도 문장으로 표시(생략 금지).
@Observable @MainActor
final class KidsNearbyModel {
    private(set) var state: NearbyLoadState<KidsPlace> = .idle
    private let service = NearbyService(client: APIClient(baseURL: AppConfig.apiBaseURL))

    func load(force: Bool = false) async {
        if case .idle = state { state = .loading }
        do {
            let coord = try await LocationService.shared.currentCoordinate(force: force)
            let places = try await service.kidsPlaces(lat: coord.lat, lng: coord.lng)
            state = .loaded(places)
            announceLoaded(count: places.count, unit: "곳")
        } catch let error as LocationService.LocationError {
            if case .denied = error { state = .denied } else if case .loaded = state {} else { state = .failed }
        } catch {
            // 조회 실패: 직전 성공 데이터가 있으면 유지(새로고침=재조회이지 데이터 포기 아님)
            if case .loaded = state { announceRefreshFailed() } else { state = .failed }
        }
    }
}

struct KidsNearbyView: View {
    @State private var model = KidsNearbyModel()

    var body: some View {
        List {
            if case .loaded(let places) = model.state {
                ForEach(places) { place in
                    // 이름·종류·실내외·거리·주소를 한 줄 = 한 접근성 객체로 합친다.
                    Text(joinText(place.name, kindLabel(place.kind), inOutLabel(place.indoorOutdoor),
                                  "\(place.distanceMeters)m", place.roadAddress ?? place.address))
                }
            }
        }
        .navigationTitle("아이 놀 곳")
        .overlay { stateOverlay }
        .task { await model.load() }
        .refreshable { await model.load(force: true) }
    }

    /// kind 코드 → 한글 라벨. 미지 값은 원문 그대로 노출(계약 확장에 깨지지 않게).
    private func kindLabel(_ kind: String) -> String {
        switch kind {
        case "kidscafe": return "키즈카페"
        case "playground": return "놀이터"
        case "playcenter": return "놀이센터"
        case "park": return "공원"
        default: return kind
        }
    }

    /// indoor/outdoor 3-state: unknown도 "실내외 정보 없음"으로 명시(0건·미확인 혼동 방지).
    private func inOutLabel(_ value: String) -> String {
        switch value {
        case "indoor": return "실내"
        case "outdoor": return "실외"
        default: return "실내외 정보 없음"
        }
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
        case .loaded(let places) where places.isEmpty:
            ContentUnavailableView("주변에 아이 놀 곳이 없습니다", systemImage: "figure.and.child.holdinghands")
        default: EmptyView()
        }
    }
}
