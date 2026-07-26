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
            let places = try await service.surroundings(lat: coord.lat, lng: coord.lng)
            state = .loaded(places)
            announceLoaded(count: places.count, unit: appLocalized("ios.nearby.unitPlace"))
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

struct AroundNearbyView: View {
    @State private var model = AroundNearbyModel()
    /// 장소 채팅 sheet(웹 계약 미러). 표시마다 새 ChatView = 장소마다 새 대화
    @State private var chatPlace: Place?

    var body: some View {
        List {
            if case .loaded(let places) = model.state {
                ForEach(places) { place in
                    // 보조 텍스트 정보량은 현행 유지(카테고리·방위·거리). ⚠ 방위는 북 기준 절대 8방위만.
                    NavigationLink {
                        PlaceDetailView(place: surroundingPlaceToPlace(place))
                    } label: {
                        PlaceRow(
                            place: surroundingPlaceToPlace(place),
                            secondaryOverride: joinText(
                                categoryPiece(place.categoryRaw), bearingLabel(place.bearing),
                                appLocalized("place.distance", formatDistanceKo(Double(place.distanceMeters)))),
                            onAskAbout: { chatPlace = surroundingPlaceToPlace(place) })
                    }
                }
            }
        }
        .navigationTitle(appLocalized("ios.nearby.around"))
        .nearbyStateOverlay { stateOverlay }
        .task { await model.load() }
        .nearbyRefreshable { await model.load(force: true) }
        .sheet(item: $chatPlace) { ChatView(place: $0) }
    }

    /// category_name 전체 계층 중 마지막 " > " 조각만(가장 구체적인 분류).
    private func categoryPiece(_ raw: String) -> String {
        raw.components(separatedBy: " > ").last ?? raw
    }

    /// 소문자 8방위(fixture 실측) → 북 기준 절대 방위 한글 + "쪽". 미지 값은 방위 조각 생략(nil).
    private func bearingLabel(_ bearing: String) -> String? {
        let korean: String?
        switch bearing {
        case "n": korean = appLocalized("surroundingsNearby.direction.n")
        case "ne": korean = appLocalized("surroundingsNearby.direction.ne")
        case "e": korean = appLocalized("surroundingsNearby.direction.e")
        case "se": korean = appLocalized("surroundingsNearby.direction.se")
        case "s": korean = appLocalized("surroundingsNearby.direction.s")
        case "sw": korean = appLocalized("surroundingsNearby.direction.sw")
        case "w": korean = appLocalized("surroundingsNearby.direction.w")
        case "nw": korean = appLocalized("surroundingsNearby.direction.nw")
        default: korean = nil
        }
        return korean.map { appLocalized("ios.nearby.directionSuffixed", $0) }
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
        case .loaded(let places) where places.isEmpty:
            ContentUnavailableView(appLocalized("ios.nearby.aroundEmpty"), systemImage: "mappin.and.ellipse")
        default: EmptyView()
        }
    }
}
