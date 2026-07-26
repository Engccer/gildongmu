import SwiftUI
import Observation
import Accessibility
import GildongmuKit

/// 내 주변 무장애 관광지. SubwayNearbyModel 규범 패턴 미러(3-state 권한 거부/조회 실패/0건).
/// 편의시설 상세는 이 화면이 아니라 장소 상세의 BarrierFreeInfoSection이 match 라우트로
/// 자동 로드한다(같은 소스 좌표라 50m∩이름 매칭) — 항목별 펼침 UI로 lazy 로드하던 방식은 폐기.
@Observable @MainActor
final class BarrierFreeNearbyModel {
    private(set) var state: NearbyLoadState<BarrierFreePlace> = .idle
    private let service = BarrierFreeService(client: APIClient(baseURL: AppConfig.apiBaseURL))
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
            let places = try await service.nearby(lat: coord.lat, lng: coord.lng)
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

struct BarrierFreeNearbyView: View {
    @State private var model = BarrierFreeNearbyModel()
    /// 장소 채팅 sheet(웹 계약 미러). 표시마다 새 ChatView = 장소마다 새 대화
    @State private var chatPlace: Place?

    var body: some View {
        List {
            if case .loaded(let places) = model.state {
                // 편의시설의 발견 경로는 상세의 BarrierFreeInfoSection 자동 섹션으로 대체.
                ForEach(places) { place in
                    NavigationLink {
                        PlaceDetailView(place: barrierFreePlaceToPlace(place))
                    } label: {
                        PlaceRow(
                            place: barrierFreePlaceToPlace(place),
                            secondaryOverride: joinText(
                                place.address,
                                appLocalized("place.distance", formatDistanceKo(Double(place.distanceMeters)))),
                            onAskAbout: { chatPlace = barrierFreePlaceToPlace(place) })
                    }
                }
                if !places.isEmpty {
                    Section {
                        Text(appLocalized("barrierFreeInfo.source"))
                    }
                }
            }
        }
        .navigationTitle(appLocalized("ios.nearby.barrierFree"))
        .nearbyStateOverlay { stateOverlay }
        .task { await model.load() }
        .nearbyRefreshable { await model.load(force: true) }
        .sheet(item: $chatPlace) { ChatView(place: $0) }
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
            ContentUnavailableView(appLocalized("ios.nearby.barrierFreeEmpty"), systemImage: "figure.roll")
        default: EmptyView()
        }
    }
}
