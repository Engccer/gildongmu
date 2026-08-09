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
                // 수동 위치일 때 "현재 위치"라고 알리지 않는다(전역 제약) — 자기가
                // 지금 어디 있나를 묻는 전용 화면이라, 지정한 좌표를 GPS 판정처럼
                // 낭독하면 사용자는 GPS가 고쳐졌다고 믿는다.
                loaded: { _ in
                    ManualLocationStore.shared.current == nil
                        ? appLocalized("ios.nearby.whereAmIReady")
                        : appLocalized("whereAmI.manualReady")
                },
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
    /// 헤더·화면 제목의 수동 위치 분기(LocationBarView 동형 관찰 패턴).
    @State private var manualLocationStore = ManualLocationStore.shared
    /// 장소 채팅 sheet(웹 계약 미러). 표시마다 새 ChatView = 조회마다 새 대화
    @State private var chatPlace: Place?
    /// 착지 대상은 조회 시각 헤더(이 화면의 첫 요소).
    @AccessibilityFocusState private var focusedTop: String?
    @State private var lander = NearbyFocusLander()

    /// 결과 헤더. 조회 완료 시 VO 커서가 착지하는 자리라 **이 화면에서 위치 출처를
    /// 선언하는 문구**다 — 수동 위치일 때 "현재 위치"라고 말하면 사용자는 GPS가
    /// 고쳐졌다고 믿는다. 검증 가능/불가 표기는 표시줄과 같은 훅이 소유한다.
    /// 웹 `WhereAmI.tsx`의 heading과 같은 조립이다(라벨 + `whereAmI.asOf`).
    private func headerText(_ asOf: String) -> String {
        guard let manual = manualLocationLabel(manualLocationStore) else {
            return appLocalized("ios.nearby.whereAmIAsOf", asOf)
        }
        return "\(manual) \(appLocalized("whereAmI.asOf", asOf))"
    }

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
                    Text(headerText(payload.asOf))
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
        .navigationTitle(
            manualLocationStore.current == nil
                ? appLocalized("whereAmI.button")
                : appLocalized("whereAmI.manualButton")
        )
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
