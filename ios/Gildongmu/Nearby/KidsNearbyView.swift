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
            let places = try await service.kidsPlaces(lat: coord.lat, lng: coord.lng)
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

struct KidsNearbyView: View {
    @State private var model = KidsNearbyModel()
    /// 장소 채팅 sheet(웹 계약 미러). 표시마다 새 ChatView = 장소마다 새 대화
    @State private var chatPlace: Place?

    var body: some View {
        List {
            if case .loaded(let places) = model.state {
                ForEach(places) { place in
                    // 보조 텍스트 정보량은 현행 유지(종류·실내외·거리·주소), 이름은 PlaceRow 1행에 결합.
                    NavigationLink {
                        PlaceDetailView(place: kidsPlaceToPlace(place))
                    } label: {
                        PlaceRow(
                            place: kidsPlaceToPlace(place),
                            secondaryOverride: joinText(
                                kindLabel(place.kind), inOutLabel(place.indoorOutdoor),
                                appLocalized("place.distance", formatDistanceKo(Double(place.distanceMeters))),
                                place.roadAddress ?? place.address),
                            onAskAbout: { chatPlace = kidsPlaceToPlace(place) })
                    }
                }
            }
        }
        .navigationTitle(appLocalized("ios.nearby.kids"))
        .nearbyStateOverlay { stateOverlay }
        .task { await model.load() }
        .nearbyRefreshable { await model.load(force: true) }
        .sheet(item: $chatPlace) { ChatView(place: $0) }
    }

    /// kind 코드 → 한글 라벨. 미지 값은 원문 그대로 노출(계약 확장에 깨지지 않게).
    private func kindLabel(_ kind: String) -> String {
        switch kind {
        case "kidscafe": return appLocalized("kidsNearby.kind.kidscafe")
        case "playground": return appLocalized("kidsNearby.kind.playground")
        case "playcenter": return appLocalized("kidsNearby.kind.playcenter")
        case "park": return appLocalized("ios.nearby.kidsPark")
        default: return kind
        }
    }

    /// indoor/outdoor 3-state: unknown도 "실내외 정보 없음"으로 명시(0건·미확인 혼동 방지).
    private func inOutLabel(_ value: String) -> String {
        switch value {
        case "indoor": return appLocalized("kidsNearby.indoor.indoor")
        case "outdoor": return appLocalized("kidsNearby.indoor.outdoor")
        default: return appLocalized("kidsNearby.indoor.unknown")
        }
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
            ContentUnavailableView(appLocalized("ios.nearby.kidsEmpty"), systemImage: "figure.and.child.holdinghands")
        default: EmptyView()
        }
    }
}
