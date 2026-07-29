import SwiftUI
import Observation
import Accessibility
import GildongmuKit

/// 현재 위치 정위. 리스트가 아니라 산문 두세 단락(Kit `buildLocationNarrativeKo`)이라
/// NearbyLoadState 대신 화면 로컬 상태 — ConditionsModel 동형(단일 결과 조립).
/// 3-state: nil(키 없음, empty)과 throw(조회 실패, failed)를 다른 문구로 분리한다
/// (웹 `messages/ko.json`의 whereAmI.empty/error 미러).
@Observable @MainActor
final class WhereAmIModel {
    enum State {
        case idle, loading
        case loaded(WhereAmIData, lat: Double, lng: Double, asOf: String)
        case empty    // data:null — 키 없음, 死기능 아님(throw와 다른 문구)
        case denied
        case outOfCoverage    // 서비스 지역 밖 — 실패 아님, spec 2026-07-29
        case failedLocation   // 위치 취득 실패(LocationError.unavailable)
        case failedServer     // 서버 조회 실패(그 외 throw)
    }

    private(set) var state: State = .idle
    private let service = WhereAmIService(client: APIClient(baseURL: AppConfig.apiBaseURL))
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
            // 위치 취득 직후 선분기(네트워크 생략) — 서버 마커 catch와 이중 방어.
            guard isInKorea(lat: coord.lat, lng: coord.lng) else {
                if case .loaded = state { announceOutOfCoverage() }
                state = .outOfCoverage
                return
            }
            let data = try await service.locate(lat: coord.lat, lng: coord.lng)
            if let data {
                let asOf = Self.timeFormatter.string(from: Date())
                state = .loaded(data, lat: coord.lat, lng: coord.lng, asOf: asOf)
                AccessibilityNotification.Announcement(appLocalized("ios.nearby.whereAmIReady")).post()
            } else if case .loaded = state {
                // 직전 성공 데이터가 있으면 유지(새로고침=재조회이지 데이터 포기 아님)
                announceRefreshFailed()
            } else {
                state = .empty
                AccessibilityNotification.Announcement(appLocalized("whereAmI.empty")).post()
            }
        } catch let error as LocationService.LocationError {
            if case .denied = error {
                // loaded에서 권한 취소로 전락하면 목록이 통째로 사라진다 — 무신호 화면 전환 방지 통지
                if case .loaded = state { announcePermissionLost() }
                state = .denied
            } else if case .loaded = state { announceRefreshFailed() } else { state = .failedLocation }
        } catch APIError.outOfCoverage {
            if case .loaded = state { announceOutOfCoverage() }
            state = .outOfCoverage
        } catch {
            if case .loaded = state { announceRefreshFailed() } else { state = .failedServer }
        }
    }

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

    var body: some View {
        List {
            if case .loaded(let data, let lat, let lng, let asOf) = model.state {
                Section {
                    // 산문 문단=한 접근성 객체(인라인 분절 금지). 완성 문장은 Kit이 조립.
                    ForEach(Array(buildLocationNarrative(data, lang: AppLanguage.current).enumerated()), id: \.offset) { _, paragraph in
                        Text(paragraph)
                    }
                    Button(appLocalized("ios.nearby.whereAmIChat")) {
                        chatPlace = whereAmIToPlace(data, lat: lat, lng: lng, lang: AppLanguage.current)
                    }
                } header: {
                    Text(appLocalized("ios.nearby.whereAmIAsOf", asOf)).accessibilityAddTraits(.isHeader)
                }
            }
        }
        .navigationTitle(appLocalized("whereAmI.button"))
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
        case .outOfCoverage:
            ContentUnavailableView(appLocalized("ios.common.outOfCoverage"), systemImage: "map")
        case .failedLocation:
            ContentUnavailableView(appLocalized("ios.nearby.whereAmIFailed"), systemImage: "wifi.exclamationmark",
                description: Text(appLocalized("ios.common.retryLater")))
        case .failedServer:
            ContentUnavailableView(appLocalized("ios.nearby.whereAmIServerFailed"), systemImage: "wifi.exclamationmark",
                description: Text(appLocalized("ios.common.retryLater")))
        case .empty:
            ContentUnavailableView(appLocalized("ios.nearby.whereAmIEmpty"), systemImage: "location.slash")
        default: EmptyView()
        }
    }
}
