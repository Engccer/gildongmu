import SwiftUI
import Observation
import Accessibility
import GildongmuKit

/// 길찾기 필드 후보 검색 모델(웹 EndpointField 미러): 장소+주소 병렬 상위 5건씩.
/// 웹 폴백 없음(includeWeb=false, 후보엔 좌표가 필요해 무의미 + 유료 호출 회피).
/// 주소 후보는 좌표가 없어 선택 시점에 지오코딩으로 확정한다.
@Observable @MainActor
final class EndpointSearchModel {
    var query = ""
    private(set) var places: [Place] = []
    private(set) var addresses: [JusoAddress] = []
    /// 0건·실패의 시각 안내(3-state: 없음≠실패). 후보 있는 성공은 목록이 정본이라 비운다.
    private(set) var notice = ""
    private(set) var isSearching = false
    private var searchTask: Task<Void, Never>?
    /// 지오코딩 재진입 가드(웹 geocodeRef 미러)
    private var isGeocodingInFlight = false

    private let service = SearchService(client: APIClient(baseURL: AppConfig.apiBaseURL))

    func submit() {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        searchTask?.cancel()   // 진행 중 검색 폐기: stale 응답 차단
        isSearching = true
        searchTask = Task {
            // 허용된 세션이면 좌표를 실어 근접 블렌딩(SearchModel 동형, 팝업 없음).
            let coordinate = await LocationService.shared.coordinateIfAuthorized()
            let outcome = await service.search(
                query: trimmed, lat: coordinate?.lat, lng: coordinate?.lng,
                lang: AppLanguage.dataLocale, includeWeb: false)
            guard !Task.isCancelled else { return }
            // 미니 검색은 필드 확정용이라 상위 5건씩만(전체 탐색은 검색 탭이 담당).
            places = Array(outcome.places.items.prefix(5))
            addresses = Array(outcome.addresses.items.prefix(5))
            isSearching = false
            let count = places.count + addresses.count
            let message: String
            if count > 0 {
                message = appLocalized("directions.candidateCount", String(count))
                notice = ""
            } else if outcome.allFailed {
                // 3-state: "0건"과 "조회 실패"를 뭉개지 않는다(양쪽 다 실패했을 때만 오류).
                message = appLocalized("directions.candidateError")
                notice = message
            } else {
                message = appLocalized("directions.candidateNone")
                notice = message
            }
            AccessibilityNotification.Announcement(message).post()
        }
    }

    func cancel() {
        searchTask?.cancel()
    }

    /// 주소 후보 선택: 지오코딩 성공 시에만 확정. 실패는 coordError 통지 + 시트 유지(nil).
    func geocode(_ address: JusoAddress) async -> DirectionsEndpoint? {
        if isGeocodingInFlight { return nil }
        isGeocodingInFlight = true
        defer { isGeocodingInFlight = false }
        let target = address.roadAddrPart1.isEmpty ? address.roadAddr : address.roadAddrPart1
        do {
            guard let match = try await service.geocode(query: target).first else {
                announceCoordError()
                return nil
            }
            return .place(label: target, lat: match.lat, lng: match.lng)
        } catch {
            announceCoordError()
            return nil
        }
    }

    private func announceCoordError() {
        notice = appLocalized("directions.coordError")
        AccessibilityNotification.Announcement(notice).post()
    }
}

/// 출발지/도착지 후보 검색 시트. 선택 즉시 닫히고 필드에 원자 확정된다.
/// 닫힘 후 VO 포커스는 시트를 연 필드 버튼으로 복귀(시스템 기본)하고, 확정 확인은
/// 필드의 라벨+값 낭독이 담당한다(웹 resolveAndClose 선점 포커스의 iOS 문법,
/// 별도 완료 통지를 더하지 않는다).
struct DirectionsEndpointSearchView: View {
    let target: DirectionsFieldTarget
    let onSelect: (DirectionsEndpoint) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var model = EndpointSearchModel()
    @State private var speech = SpeechService()
    /// 최근 장소(스펙 2026-07-26) — 출발지/도착지 공유 목록, 시트 열릴 때 로드.
    private let recentStore = RecentSearchStore()
    @State private var recentEndpoints: [RecentEndpoint] = []
    @AccessibilityFocusState private var focusedRecent: RecentEndpoint?
    /// 목록 소멸 시 포커스 착지점 — 항상 존재하는 마이크 행(스펙 §5, SearchView 동형).
    @AccessibilityFocusState private var micRowFocused: Bool

    var body: some View {
        NavigationStack {
            List {
                // 마이크는 검색 필드 바로 다음 행(SearchView 동형 배선, F-C). 검색 계열
                // 계약: 홀드 단일 동작 — 최종 전사를 쿼리에 넣고 즉시 후보 검색(잠금·취소
                // 슬라이드 없음). 전사 원문을 polite 통지한 뒤 결과 통지는 submit()의
                // 후보 수 통지가 담당. 포커스는 건드리지 않는다(선택은 후보 목록 스와이프).
                Section {
                    HoldDictationButton(
                        speech: speech,
                        hint: appLocalized("ios.voice.holdHintSearch"),
                        showsTitle: true,
                        onTranscript: { text in
                            model.query = text
                            AccessibilityNotification.Announcement(text).post()
                            model.submit()
                        },
                        onPause: nil
                    )
                    .accessibilityFocused($micRowFocused)
                }
                // "현재 위치 사용"은 출발지 전용(웹 동형, 도착지를 현재 위치로 두는 건 스왑이 담당)
                if target == .from {
                    Button(appLocalized("directions.useCurrentLocation")) { select(.current) }
                }
                if !model.notice.isEmpty {
                    Text(model.notice)
                }
                // 최근 장소(스펙 2026-07-26): 후보 검색 전 상태에만. 행 활성화=재검색 없이
                // 즉시 확정, swipeActions 삭제가 VoiceOver 로터로 자동 노출된다. 기록은
                // select→onSelect→setEndpoint가 담당(이중 기록 금지).
                if model.places.isEmpty && model.addresses.isEmpty && !recentEndpoints.isEmpty {
                    Section(appLocalized("recent.title")) {
                        ForEach(recentEndpoints, id: \.self) { endpoint in
                            Button(endpoint.label) {
                                select(.place(label: endpoint.label, lat: endpoint.lat, lng: endpoint.lng))
                            }
                            .accessibilityFocused($focusedRecent, equals: endpoint)
                            .swipeActions {
                                Button(appLocalized("recent.delete"), role: .destructive) {
                                    deleteRecent(endpoint)
                                }
                            }
                        }
                        Button(appLocalized("recent.clearAll")) { clearRecent() }
                    }
                }
                ForEach(model.places) { place in
                    Button {
                        select(.place(label: place.name, lat: place.lat, lng: place.lng))
                    } label: {
                        // 한 줄 = 한 객체: 이름+주소 단일 텍스트(웹 joinText 동형)
                        Text(joinText(place.name, place.roadAddress.isEmpty ? place.address : place.roadAddress))
                    }
                }
                ForEach(model.addresses, id: \.roadAddr) { address in
                    Button(address.roadAddr) {
                        Task {
                            if let endpoint = await model.geocode(address) { select(endpoint) }
                        }
                    }
                }
            }
            .navigationTitle(sheetTitle)
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $model.query, prompt: Text(appLocalized("ios.search.prompt")))
            .onSubmit(of: .search) { model.submit() }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(appLocalized("actions.close")) { dismiss() }
                }
            }
            .overlay {
                if model.isSearching {
                    ProgressView(appLocalized("ios.search.searching"))
                }
            }
            .alert(speechAlertMessage ?? "", isPresented: speechAlertBinding) {
                Button(appLocalized("ios.common.ok")) {}
            }
            .task {
                recentEndpoints = recentStore.endpoints()
            }
            // 마이크는 항상 폐기(시트가 닫히면 뷰가 소멸하므로 유령 청취 방지 —
            // SearchView 동형 teardown). 검색 Task도 함께 취소.
            .onDisappear {
                model.cancel()
                Task { await speech.cancel() }
            }
        }
    }

    /// denied·failed 안내(3-state, SearchView 미러). 확인 시 idle 복귀.
    private var speechAlertMessage: String? {
        switch speech.phase {
        case .denied: appLocalized("ios.voice.denied")
        case .failed: appLocalized("ios.voice.failed")
        default: nil
        }
    }

    private var speechAlertBinding: Binding<Bool> {
        Binding(
            get: { speechAlertMessage != nil },
            set: { if !$0 { speech.reset() } }
        )
    }

    private var sheetTitle: String {
        target == .from ? appLocalized("directions.searchFrom") : appLocalized("directions.searchTo")
    }

    private func select(_ endpoint: DirectionsEndpoint) {
        onSelect(endpoint)
        dismiss()
    }

    /// 항목 삭제(스펙 §5): 다음 항목 → 이전 항목 → 목록 소멸 시 마이크 행. 통지 1건.
    private func deleteRecent(_ endpoint: RecentEndpoint) {
        guard let index = recentEndpoints.firstIndex(of: endpoint) else { return }
        recentEndpoints = recentStore.removeEndpoint(endpoint)
        AccessibilityNotification.Announcement(appLocalized("recent.deleted")).post()
        if recentEndpoints.isEmpty {
            micRowFocused = true
            return
        }
        focusedRecent = recentEndpoints[min(index, recentEndpoints.count - 1)]
    }

    private func clearRecent() {
        recentStore.clearEndpoints()
        recentEndpoints = []
        AccessibilityNotification.Announcement(appLocalized("recent.cleared")).post()
        micRowFocused = true
    }
}
