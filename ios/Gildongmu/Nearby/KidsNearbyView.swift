import SwiftUI
import Observation
import GildongmuKit

/// 내 주변 아이 놀 곳 — NearbyLoadCore 껍데기(SubwayNearbyModel 규범 패턴 미러).
/// 평면 행이라 Section·heading 없이 한 항목을 단일 텍스트로 합친다.
/// indoorOutdoor는 3-state라 unknown도 문장으로 표시(생략 금지).
@Observable @MainActor
final class KidsNearbyModel {
    private var core: NearbyLoadCore<[KidsPlace]>!   // willCommit이 self 캡처 — IUO 2단 초기화
    private(set) var window = RevealWindow()
    var phase: NearbyLoadPhase<[KidsPlace]> { core.phase }
    var visibleCount: Int { window.visibleCount }

    init() {
        let service = NearbyService(client: APIClient(baseURL: AppConfig.apiBaseURL))
        core = NearbyLoadCore(
            coordinate: LocationService.nearbyCoordinateSource(),
            coverage: .korea,
            fetch: { coord, _ in
                guard let coord else { preconditionFailure("current 소스는 좌표 보장") }
                return try await service.kidsPlaces(lat: coord.lat, lng: coord.lng)
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

struct KidsNearbyView: View {
    @State private var model = KidsNearbyModel()
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
                    ForEach(places.prefix(model.visibleCount)) { place in
                        // 보조 텍스트 정보량은 현행 유지(종류·실내외·거리·주소), 이름은 PlaceRow 1행에 결합.
                        NavigationLink {
                            PlaceDetailView(place: kidsPlaceToPlace(place))
                        } label: {
                            PlaceRow(
                                place: kidsPlaceToPlace(place),
                                secondaryOverride: joinText(
                                    kindLabel(place.kind), inOutLabel(place.indoorOutdoor),
                                    appLocalized("place.distance", formatDistance(place.distanceMeters)),
                                    place.roadAddress ?? place.address),
                                onAskAbout: { chatPlace = kidsPlaceToPlace(place) })
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
                }
            }
            .nearbyFocusOnLoad(
                id: firstRowID, lander: lander, proxy: proxy,
                current: { focusedPlaceID },
                apply: { focusedPlaceID = $0 })
        }
        .navigationTitle(appLocalized("ios.nearby.kids"))
        .nearbyStateOverlay {
            NearbyStateOverlayView(
                phase: model.phase,
                onPreciseGranted: { Task { await model.load(force: true) } },
                descriptor: .list(
                empty: NearbyOverlayCopy(appLocalized("ios.nearby.kidsEmpty"), systemImage: "figure.and.child.holdinghands"),
                isEmpty: \.isEmpty))
        }
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
}
