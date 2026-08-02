import SwiftUI
import Observation
import GildongmuKit

/// 내 주변 무장애 관광지 — NearbyLoadCore 껍데기(SubwayNearbyModel 규범 패턴 미러).
/// 편의시설 상세는 이 화면이 아니라 장소 상세의 BarrierFreeInfoSection이 match 라우트로
/// 자동 로드한다(같은 소스 좌표라 50m∩이름 매칭) — 항목별 펼침 UI로 lazy 로드하던 방식은 폐기.
@Observable @MainActor
final class BarrierFreeNearbyModel {
    private var core: NearbyLoadCore<[BarrierFreePlace]>!   // willCommit이 self 캡처 — IUO 2단 초기화
    private(set) var window = RevealWindow()
    var phase: NearbyLoadPhase<[BarrierFreePlace]> { core.phase }
    var visibleCount: Int { window.visibleCount }

    init() {
        let service = BarrierFreeService(client: APIClient(baseURL: AppConfig.apiBaseURL))
        core = NearbyLoadCore(
            coordinate: LocationService.nearbyCoordinateSource(),
            coverage: .korea,
            fetch: { coord, _ in
                guard let coord else { preconditionFailure("current 소스는 좌표 보장") }
                return try await service.nearby(lat: coord.lat, lng: coord.lng)
            },
            willCommit: { [weak self] _ in self?.window.reset() },   // 커밋과 원자(스펙 §4)
            onEvent: nearbyAnnouncer(loaded: { places in
                nearbyLoadedMessage(count: places.count, unit: appLocalized("ios.nearby.unitPlace"))
            }))
    }

    func load(force: Bool = false) async { await core.load(force: force) }

    /// "더 보기": 공개 수를 늘리고 첫 새 항목 id를 반환한다(VO 포커스 이동 대상).
    func revealMore() -> String? {
        guard case .loaded(let places) = phase,
              let firstNewIndex = window.revealMore(totalCount: places.count) else { return nil }
        return places[firstNewIndex].id
    }
}

struct BarrierFreeNearbyView: View {
    @State private var model = BarrierFreeNearbyModel()
    /// 장소 채팅 sheet(웹 계약 미러). 표시마다 새 ChatView = 장소마다 새 대화
    @State private var chatPlace: Place?
    /// "더 보기" 후 첫 새 행으로 VO 커서 이동(V1 포커스 계약 복제).
    @AccessibilityFocusState private var focusedPlaceID: String?
    @State private var lander = NearbyFocusLander()

    /// 첫 항목 ID. nil→값 전이가 곧 "로드 완료"다(0건·실패는 nil 유지, 이동 없음).
    private var firstRowID: String? {
        guard case .loaded(let places) = model.phase else { return nil }
        return places.first?.id
    }

    var body: some View {
        // ScrollViewReader+proxy.scrollTo 선행(ClinicNearbyView 미러): List는 화면 밖
        // 행을 AX 트리에서 컬링하므로 scrollTo로 먼저 가시화한 뒤에 포커스를 대입한다.
        ScrollViewReader { proxy in
            List {
                if case .loaded(let places) = model.phase {
                    // 편의시설의 발견 경로는 상세의 BarrierFreeInfoSection 자동 섹션으로 대체.
                    ForEach(places.prefix(model.visibleCount)) { place in
                        NavigationLink {
                            PlaceDetailView(place: barrierFreePlaceToPlace(place))
                        } label: {
                            PlaceRow(
                                place: barrierFreePlaceToPlace(place),
                                secondaryOverride: joinText(
                                    place.address,
                                    appLocalized("place.distance", formatDistance(place.distanceMeters))),
                                onAskAbout: { chatPlace = barrierFreePlaceToPlace(place) })
                        }
                        .id(place.id)
                        .accessibilityFocused($focusedPlaceID, equals: place.id)
                    }
                    if places.count > model.visibleCount {
                        Button(appLocalized("actions.showMore")) {
                            if let id = model.revealMore() {
                                proxy.scrollTo(id, anchor: .top)
                                DispatchQueue.main.async { focusedPlaceID = id }
                            }
                        }
                    }
                    // 출처는 항상 마지막 행 유지 — "더 보기" 버튼은 항상 그 앞.
                    if !places.isEmpty {
                        Section {
                            Text(appLocalized("barrierFreeInfo.source"))
                        }
                    }
                }
            }
            .nearbyFocusOnLoad(
                id: firstRowID, lander: lander, proxy: proxy,
                current: { focusedPlaceID },
                apply: { focusedPlaceID = $0 })
        }
        .navigationTitle(appLocalized("ios.nearby.barrierFree"))
        .nearbyStateOverlay {
            NearbyStateOverlayView(
                phase: model.phase,
                onPreciseGranted: { Task { await model.load(force: true) } },
                descriptor: .list(
                empty: NearbyOverlayCopy(appLocalized("ios.nearby.barrierFreeEmpty"), systemImage: "figure.roll"),
                isEmpty: \.isEmpty))
        }
        .task { await model.load() }
        .nearbyRefreshable { await model.load(force: true) }
        .sheet(item: $chatPlace) { ChatView(place: $0) }
    }
}
