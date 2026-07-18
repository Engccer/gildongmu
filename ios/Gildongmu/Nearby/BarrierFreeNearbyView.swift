import SwiftUI
import Observation
import Accessibility
import GildongmuKit

/// 편의시설 상세 로드 상태(항목별). 3-state 불변식: 로딩 중 / 로드완료(빈 배열 포함) / 조회 실패.
enum BarrierFreeDetailLoadState {
    case loading
    case loaded(BarrierFreeDetail?)
    case failed
}

/// 내 주변 무장애 관광지. SubwayNearbyModel 규범 패턴 미러(3-state 권한 거부/조회 실패/0건).
/// 항목별 편의시설 상세는 펼침(DisclosureGroup) 시 lazy 로드하고 contentId로 캐시한다.
@Observable @MainActor
final class BarrierFreeNearbyModel {
    private(set) var state: NearbyLoadState<BarrierFreePlace> = .idle
    private(set) var detailStates: [String: BarrierFreeDetailLoadState] = [:]
    private let service = BarrierFreeService(client: APIClient(baseURL: AppConfig.apiBaseURL))
    /// 재진입 가드(웹 in-flight ref 가드 미러): 로드 진행 중 재호출은 즉시 무시
    private var isLoadingInFlight = false
    /// 항목별 상세 fetch 중복 차단(더블 트리거 시 같은 contentId 재요청 방지)
    private var detailInFlight: Set<String> = []

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

    /// 펼칠 때만 편의시설 상세를 조회한다. 캐시 hit·in-flight면 재요청하지 않는다.
    func loadDetailIfNeeded(contentId: String) async {
        if detailStates[contentId] != nil { return }
        if detailInFlight.contains(contentId) { return }
        detailInFlight.insert(contentId)
        detailStates[contentId] = .loading
        defer { detailInFlight.remove(contentId) }
        do {
            let detail = try await service.detail(contentId: contentId)
            detailStates[contentId] = .loaded(detail)
        } catch {
            detailStates[contentId] = .failed
        }
    }
}

struct BarrierFreeNearbyView: View {
    @State private var model = BarrierFreeNearbyModel()

    var body: some View {
        List {
            if case .loaded(let places) = model.state {
                ForEach(places) { place in
                    BarrierFreePlaceSection(place: place, model: model)
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

/// 무장애 관광지 항목 하나. 이름행은 heading(웹 h4 규칙), 편의시설은 DisclosureGroup 펼침 시 lazy 로드
/// (버튼이 발견 경로라 heading 미부여).
private struct BarrierFreePlaceSection: View {
    let place: BarrierFreePlace
    let model: BarrierFreeNearbyModel
    @State private var isExpanded = false

    var body: some View {
        Section {
            DisclosureGroup(appLocalized("ios.nearby.showFacilitiesFor", place.name), isExpanded: $isExpanded) {
                facilitiesContent
            }
        } header: {
            // 장소명·주소·거리를 한 줄 = 한 접근성 객체로 합친다(웹 h4 규칙 미러).
            Text(joinText(place.name, place.address, "\(place.distanceMeters)m"))
                .accessibilityAddTraits(.isHeader)
        }
        .task(id: isExpanded) {
            guard isExpanded else { return }
            await model.loadDetailIfNeeded(contentId: place.contentId)
        }
    }

    @ViewBuilder private var facilitiesContent: some View {
        switch model.detailStates[place.contentId] {
        case .none, .loading:
            Text(appLocalized("barrierFreeNearby.facilitiesLoading"))
        case .loaded(let detail):
            if let facilities = detail?.facilities, !facilities.isEmpty {
                // 평문 단일 텍스트(definition list 금지, SR "용어/정의" 낭독 회피).
                ForEach(facilities, id: \.key) { facility in
                    Text("\(facility.label) \(facility.value)")
                }
            } else {
                Text(appLocalized("barrierFreeNearby.facilitiesEmpty"))
            }
        case .failed:
            Text(appLocalized("ios.nearby.facilitiesFailed"))
        }
    }
}
