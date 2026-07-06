import SwiftUI
import Observation
import Accessibility
import GildongmuKit

/// 내 주변 둘러보기. 규범(SubwayNearbyView) 패턴 미러: 평면 행이라 Section·heading 없이
/// 한 항목을 단일 텍스트로 합친다. ⚠ 방위는 북 기준 절대 8방위만(heading 없는 기기라 정면-상대 방향 금지).
@Observable @MainActor
final class AroundNearbyModel {
    private(set) var state: NearbyLoadState<SurroundingPlace> = .idle
    private let service = NearbyService(client: APIClient(baseURL: AppConfig.apiBaseURL))

    func load(force: Bool = false) async {
        if case .idle = state { state = .loading }
        do {
            let coord = try await LocationService.shared.currentCoordinate(force: force)
            let places = try await service.surroundings(lat: coord.lat, lng: coord.lng)
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

struct AroundNearbyView: View {
    @State private var model = AroundNearbyModel()

    var body: some View {
        List {
            if case .loaded(let places) = model.state {
                ForEach(places) { place in
                    // 이름·카테고리·방위·거리를 한 줄 = 한 접근성 객체로 합친다.
                    Text(joinText(place.name, categoryPiece(place.categoryRaw),
                                  bearingLabel(place.bearing), "\(place.distanceMeters)m"))
                }
            }
        }
        .navigationTitle("둘러보기")
        .overlay { stateOverlay }
        .task { await model.load() }
        .refreshable { await model.load(force: true) }
    }

    /// category_name 전체 계층 중 마지막 " > " 조각만(가장 구체적인 분류).
    private func categoryPiece(_ raw: String) -> String {
        raw.components(separatedBy: " > ").last ?? raw
    }

    /// 소문자 8방위(fixture 실측) → 북 기준 절대 방위 한글 + "쪽". 미지 값은 방위 조각 생략(nil).
    private func bearingLabel(_ bearing: String) -> String? {
        let korean: String?
        switch bearing {
        case "n": korean = "북"
        case "ne": korean = "북동"
        case "e": korean = "동"
        case "se": korean = "남동"
        case "s": korean = "남"
        case "sw": korean = "남서"
        case "w": korean = "서"
        case "nw": korean = "북서"
        default: korean = nil
        }
        return korean.map { $0 + "쪽" }
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
            ContentUnavailableView("주변에 표시할 장소가 없습니다", systemImage: "mappin.and.ellipse")
        default: EmptyView()
        }
    }
}
