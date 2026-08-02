import SwiftUI
import Observation
import GildongmuKit

/// 산문·채팅 진입·조회 시각을 한 커밋으로 묶는 payload — 좌표는 장소 채팅 앵커에 쓰인다.
struct WhereAmIPayload: Sendable {
    let data: WhereAmIData
    let lat: Double
    let lng: Double
    let asOf: String
}

/// 현재 위치 정위 — NearbyLoadCore 껍데기. 리스트가 아니라 산문 두세 단락
/// (Kit `buildLocationNarrativeKo`)이라 0건 카피가 없고, 대신 부재(data:null — 키 없음)를
/// 조회 실패(throw)와 다른 문구로 분리한다(웹 `messages/ko.json` whereAmI.empty/error 미러).
/// 11종 중 코어 `.empty` 경로의 유일 사용자.
@Observable @MainActor
final class WhereAmIModel {
    private let core: NearbyLoadCore<WhereAmIPayload>
    var phase: NearbyLoadPhase<WhereAmIPayload> { core.phase }

    init() {
        let service = WhereAmIService(client: APIClient(baseURL: AppConfig.apiBaseURL))
        core = NearbyLoadCore(
            coordinate: LocationService.nearbyCoordinateSource(),
            coverage: .korea,
            fetch: { coord, _ in
                guard let coord else { preconditionFailure("current 소스는 좌표 보장") }
                // nil = data:null(키 없음) → 코어가 .empty로. 死기능 아니라 throw와 다른 문구.
                guard let data = try await service.locate(lat: coord.lat, lng: coord.lng) else { return nil }
                return WhereAmIPayload(data: data, lat: coord.lat, lng: coord.lng,
                                       asOf: Self.timeFormatter.string(from: Date()))
            },
            onEvent: nearbyAnnouncer(
                loaded: { _ in appLocalized("ios.nearby.whereAmIReady") },
                emptyResult: appLocalized("whereAmI.empty")))
    }

    func load(force: Bool = false) async { await core.load(force: force) }

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter
    }()
}

struct WhereAmIView: View {
    @State private var model = WhereAmIModel()
    /// 장소 채팅 sheet(웹 계약 미러). 표시마다 새 ChatView = 조회마다 새 대화
    @State private var chatPlace: Place?
    /// 착지 대상은 조회 시각 헤더(이 화면의 첫 요소).
    @AccessibilityFocusState private var focusedTop: String?
    @State private var lander = NearbyFocusLander()

    /// nil→값 전이가 곧 "로드 완료"다(실패는 nil 유지, 이동 없음).
    private var topID: String? {
        guard case .loaded = model.phase else { return nil }
        return "whereami-top"
    }

    var body: some View {
        ScrollViewReader { proxy in
        List {
            if case .loaded(let payload) = model.phase {
                Section {
                    // 산문 문단=한 접근성 객체(인라인 분절 금지). 완성 문장은 Kit이 조립.
                    ForEach(Array(buildLocationNarrative(payload.data, lang: AppLanguage.current).enumerated()), id: \.offset) { _, paragraph in
                        // 앱에서 거리 밀도가 가장 높은 산문이라 낭독 변환 필수(리뷰 I-2)
                        distanceText(paragraph)
                    }
                    Button(appLocalized("ios.nearby.whereAmIChat")) {
                        chatPlace = whereAmIToPlace(payload.data, lat: payload.lat, lng: payload.lng, lang: AppLanguage.current)
                    }
                } header: {
                    Text(appLocalized("ios.nearby.whereAmIAsOf", payload.asOf))
                        .accessibilityAddTraits(.isHeader)
                        .id("whereami-top")
                        .accessibilityFocused($focusedTop, equals: "whereami-top")
                }
            }
        }
        .nearbyFocusOnLoad(
            id: topID, lander: lander, proxy: proxy,
            current: { focusedTop },
            apply: { focusedTop = $0 })
        }
        .navigationTitle(appLocalized("whereAmI.button"))
        .nearbyStateOverlay {
            NearbyStateOverlayView(
                phase: model.phase,
                onPreciseGranted: { Task { await model.load(force: true) } },
                descriptor: .absentCapable(
                absent: NearbyOverlayCopy(appLocalized("ios.nearby.whereAmIEmpty"), systemImage: "location.slash"),
                failedLocation: NearbyOverlayCopy(appLocalized("ios.nearby.whereAmIFailed"),
                                                  systemImage: "wifi.exclamationmark",
                                                  description: appLocalized("ios.common.retryLater")),
                failedServer: NearbyOverlayCopy(appLocalized("ios.nearby.whereAmIServerFailed"),
                                                systemImage: "wifi.exclamationmark",
                                                description: appLocalized("ios.common.retryLater"))))
        }
        .task { await model.load() }
        .nearbyRefreshable { await model.load(force: true) }
        .sheet(item: $chatPlace) { ChatView(place: $0) }
    }
}
