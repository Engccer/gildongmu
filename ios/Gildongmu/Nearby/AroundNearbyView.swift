import SwiftUI
import Observation
import GildongmuKit

/// 내 주변 둘러보기 — NearbyLoadCore 껍데기(SubwayNearbyModel 규범 패턴 미러).
/// 평면 행이라 Section·heading 없이 한 항목을 단일 텍스트로 합친다.
/// ⚠ 방위는 북 기준 절대 8방위만(heading 없는 기기라 정면-상대 방향 금지).
@Observable @MainActor
final class AroundNearbyModel {
    private var core: NearbyLoadCore<[SurroundingPlace]>!   // willCommit이 self 캡처 — IUO 2단 초기화
    private(set) var window = RevealWindow()
    var phase: NearbyLoadPhase<[SurroundingPlace]> { core.phase }
    var visibleCount: Int { window.visibleCount }

    init() {
        let service = NearbyService(client: APIClient(baseURL: AppConfig.apiBaseURL))
        core = NearbyLoadCore(
            coordinate: LocationService.nearbyCoordinateSource(),
            coverage: .korea,
            fetch: { coord, _ in
                guard let coord else { preconditionFailure("current 소스는 좌표 보장") }
                return try await service.surroundings(lat: coord.lat, lng: coord.lng)
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

struct AroundNearbyView: View {
    @State private var model = AroundNearbyModel()
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
                        // 보조 텍스트 정보량은 현행 유지(카테고리·방위·거리). ⚠ 방위는 북 기준 절대 8방위만.
                        NavigationLink {
                            PlaceDetailView(place: surroundingPlaceToPlace(place))
                        } label: {
                            PlaceRow(
                                place: surroundingPlaceToPlace(place),
                                secondaryOverride: joinText(
                                    categoryPiece(place.categoryRaw), bearingLabel(place.bearing),
                                    appLocalized("place.distance", formatDistance(place.distanceMeters))),
                                onAskAbout: { chatPlace = surroundingPlaceToPlace(place) })
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
        .navigationTitle(appLocalized("ios.nearby.around"))
        .nearbyStateOverlay {
            NearbyStateOverlayView(phase: model.phase, descriptor: .list(
                empty: NearbyOverlayCopy(appLocalized("ios.nearby.aroundEmpty"), systemImage: "mappin.and.ellipse"),
                isEmpty: \.isEmpty))
        }
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
}
