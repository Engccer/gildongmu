import SwiftUI
import Observation
import GildongmuKit

/// 둘러보기 화면 한 커밋 payload(M4 spec §2.1). 세 조각(조망·장면·목록)을 한 fetch 안에서
/// 함께 받아 한 번에 커밋한다 — 코어 계약(첫 로드 착지 1회·통지 1회·latest-wins)을 그대로
/// 쓰기 위해서다. 조각별 실패는 payload 안에 남겨 그 자리에 실패 문장으로 렌더한다(침묵 금지).
struct AroundPayload: Sendable {
    let lat: Double
    let lng: Double
    /// nil = data null(전 키 부재) 또는 실패(overviewFailed로 가른다).
    let overview: NearbyOverview?
    let overviewFailed: Bool
    let scene: SurroundingsScene?
    let sceneFailed: Bool
    /// nil = 조회 실패(placesFailed). 0건은 빈 배열.
    let places: [SurroundingPlace]?
    let placesFailed: Bool
    /// 커밋 식별자 — 자동 펼침 장면의 "더 보기" 창을 새 커밋마다 리셋하는 근거.
    let commitID = UUID()
    /// 세 조각 전부 비었고 실패도 아닌 상태(전 키 부재) — 오버레이 empty 판정.
    /// 실패는 각 조각 자리의 문장이 말하므로 여기서 empty로 뭉개지 않는다.
    var isAllAbsent: Bool {
        overview == nil && !overviewFailed && scene == nil && !sceneFailed
            && !placesFailed && (places?.isEmpty ?? true)
    }
}

/// 둘러보기 — 현재 위치 확인 + 한눈에 보기 + 주변 상황 + 주변 가게(M4 통합, 2026-08-22).
/// NearbyLoadCore 껍데기(SubwayNearbyModel 규범 패턴). ⚠ 방위는 북 기준 절대 8방위만.
@Observable @MainActor
final class AroundNearbyModel {
    private var core: NearbyLoadCore<AroundPayload>!   // willCommit이 self 캡처 — IUO 2단 초기화
    private(set) var window = RevealWindow()
    var phase: NearbyLoadPhase<AroundPayload> { core.phase }
    var visibleCount: Int { window.visibleCount }

    init() {
        let service = NearbyService(client: APIClient(baseURL: AppConfig.apiBaseURL))
        core = NearbyLoadCore(
            coordinate: LocationService.nearbyCoordinateSource(),
            coverage: .korea,
            fetch: { coord, _ in
                guard let coord else { preconditionFailure("current 소스는 좌표 보장") }
                async let overviewR = settled { try await service.nearbyOverview(lat: coord.lat, lng: coord.lng) }
                async let sceneR = settled { try await service.surroundingsScene(lat: coord.lat, lng: coord.lng) }
                async let placesR = settled { try await service.surroundings(lat: coord.lat, lng: coord.lng) }
                let (overview, scene, places) = await (overviewR, sceneR, placesR)
                // 셋 다 실패해야 throw(코어 .failedServer). 하나라도 성공이면 loaded.
                if case .failure(let e) = overview, case .failure = scene, case .failure = places { throw e }
                return AroundPayload(
                    lat: coord.lat, lng: coord.lng,
                    overview: (try? overview.get()) ?? nil,
                    overviewFailed: overview.isFailure,
                    scene: (try? scene.get()) ?? nil,
                    sceneFailed: scene.isFailure,
                    places: try? places.get(),
                    placesFailed: places.isFailure)
            },
            willCommit: { [weak self] _ in self?.window.reset() },   // 커밋과 원자(스펙 §4)
            onEvent: nearbyAnnouncer(loaded: { _ in
                // 수동 위치일 때 "현재 위치"라고 알리지 않는다(전역 제약).
                ManualLocationStore.shared.current == nil
                    ? appLocalized("ios.nearby.aroundLoaded")
                    : appLocalized("ios.nearby.aroundLoadedManual")
            }))
    }

    func load(force: Bool = false) async { await core.load(force: force) }

    /// "더 보기": 공개 수를 늘리고 첫 새 항목 id를 반환한다(VO 포커스 이동 대상).
    func revealMore() -> String? {
        guard case .loaded(let payload) = phase, let places = payload.places,
              let firstNewIndex = window.revealMore(totalCount: places.count) else { return nil }
        return places[firstNewIndex].id
    }
}

/// allSettled 한 조각(서버 `Promise.allSettled` 동형) — 취소는 삼키지 않는다.
private func settled<T: Sendable>(_ op: @Sendable () async throws -> T) async -> Result<T, Error> {
    do { return .success(try await op()) } catch { return .failure(error) }
}

private extension Result {
    var isFailure: Bool { if case .failure = self { return true } else { return false } }
}

private let topRowID = "around-top"

struct AroundNearbyView: View {
    @State private var model = AroundNearbyModel()
    /// 위치 문장의 수동 위치 분기(LocationBarView 동형 관찰 패턴).
    @State private var manualLocationStore = ManualLocationStore.shared
    /// 장소 채팅 sheet(웹 계약 미러). 표시마다 새 ChatView = 장소마다 새 대화
    @State private var chatPlace: Place?
    /// 첫 로드 착지(위치 문장) + "더 보기" 첫 새 행 + 장면 더 보기가 한 바인딩을 쓴다.
    @AccessibilityFocusState private var focusedID: String?
    @State private var lander = NearbyFocusLander()

    /// nil→값 전이가 곧 "로드 완료"다(실패는 nil 유지, 이동 없음). 착지는 **위치 문장 1회**뿐
    /// (spec §2.1) — 장면·목록은 같은 커밋이라 늦게 와서 포커스를 끌 수 없다.
    private var topID: String? {
        guard case .loaded = model.phase else { return nil }
        return topRowID
    }

    /// 위치 문장 — 이 화면에서 위치 출처(GPS vs 수동)를 선언하는 **유일한 자리**
    /// (종전 WhereAmIView.headerText 책임 승계). 표시줄의 "조회 기준"과 층이 다르다.
    private func hereLine(_ payload: AroundPayload) -> String {
        let place = payload.overview?.place
        if manualLocationStore.current == nil {
            return place.map { appLocalized("ios.nearby.aroundHere", $0) }
                ?? appLocalized("ios.nearby.aroundHereNoPlace")
        }
        return place.map { appLocalized("ios.nearby.aroundHereManual", $0) }
            ?? appLocalized("ios.nearby.aroundHereManualNoPlace")
    }

    var body: some View {
        // ScrollViewReader+proxy.scrollTo 선행(ClinicNearbyView 미러): List는 화면 밖
        // 행을 AX 트리에서 컬링하므로 scrollTo로 먼저 가시화한 뒤에 포커스를 대입한다.
        ScrollViewReader { proxy in
            List {
                if case .loaded(let payload) = model.phase {
                    // 1. 위치 문장(헤딩, 착지 지점) — 내가 어디 서 있는지가 먼저 오는 질문이다.
                    Text(hereLine(payload))
                        .font(.headline)
                        .accessibilityAddTraits(.isHeader)
                        .id(topRowID)
                        .accessibilityFocused($focusedID, equals: topRowID)

                    // 2. 한눈에 보기 — 불릿 5개, 항목당 한 문장(각 단일 Text = 한 접근성 객체).
                    overviewSection(payload)

                    // 3. 주변 상황 — 자동 펼침(헤딩이 발견 경로, 포커스 이동 없음).
                    SurroundingsSceneAutoSection(
                        scene: payload.scene, failed: payload.sceneFailed, commitID: payload.commitID,
                        proxy: proxy, focusedID: $focusedID)

                    // 4. 이 위치에 관해 물어보기.
                    if let overview = payload.overview {
                        Button(appLocalized("ios.nearby.whereAmIChat")) {
                            chatPlace = overviewAnchorPlace(
                                overview, lat: payload.lat, lng: payload.lng, lang: AppLanguage.current)
                        }
                    }

                    // 5. 주변 가게와 시설(종전 둘러보기 목록 — 500m·10종·더 보기).
                    placesSection(payload, proxy: proxy)
                }
            }
            .nearbyFocusOnLoad(
                id: topID, lander: lander, proxy: proxy,
                current: { focusedID },
                apply: { focusedID = $0 })
        }
        .navigationTitle(appLocalized("ios.nearby.around"))
        .nearbyStateOverlay {
            NearbyStateOverlayView(
                phase: model.phase,
                onPreciseGranted: { Task { await model.load(force: true) } },
                descriptor: .list(
                empty: NearbyOverlayCopy(appLocalized("ios.nearby.aroundEmpty"), systemImage: "mappin.and.ellipse"),
                isEmpty: \.isAllAbsent))
        }
        .task { await model.load() }
        .nearbyRefreshable { await model.load(force: true) }
        .sheet(item: $chatPlace) { ChatView(place: $0) }
    }

    @ViewBuilder
    private func overviewSection(_ payload: AroundPayload) -> some View {
        if let overview = payload.overview {
            // 헤딩 + 반경 부제 한 줄(반경은 여기서 한 번만 — 불릿 안에 반복하지 않는다).
            Text("\(appLocalized("whereAmI.overview.heading")) \(appLocalized("whereAmI.overview.radius", formatDistance(overview.radiusMeters)))")
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
            ForEach(Array(buildOverviewLines(overview, lang: AppLanguage.current).enumerated()), id: \.offset) { _, line in
                // 거리 밀도가 높은 문장이라 낭독 변환 필수(m → 로케일 단어).
                distanceText(line)
            }
        } else if payload.overviewFailed {
            Text(appLocalized("whereAmI.overview.heading"))
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
            Text(appLocalized("whereAmI.overview.failed"))
        }
    }

    @ViewBuilder
    private func placesSection(_ payload: AroundPayload, proxy: ScrollViewProxy) -> some View {
        Text(appLocalized("ios.nearby.aroundPlacesHeading"))
            .font(.headline)
            .accessibilityAddTraits(.isHeader)
        if let places = payload.places {
            if places.isEmpty {
                Text(appLocalized("ios.nearby.aroundEmpty"))
            }
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
                .accessibilityFocused($focusedID, equals: place.id)
            }
            if places.count > model.visibleCount {
                Button(appLocalized("actions.showMore")) {
                    if let id = model.revealMore() {
                        proxy.scrollTo(id, anchor: .top)
                        DispatchQueue.main.async { focusedID = id }
                    }
                }
            }
        } else {
            Text(appLocalized("ios.nearby.aroundPlacesFailed"))
        }
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
