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
    /// tri-state: "검색 전"(최근 섹션 노출)과 "검색함(진행중·0건·실패 불문)"을 구분(웹
    /// candidates===null·SearchView outcome==nil 미러). 시트 수명=1회라 리셋 경로 없음(YAGNI).
    private(set) var hasSearched = false
    private var searchTask: Task<Void, Never>?
    /// 지오코딩 재진입 가드(웹 geocodeRef 미러)
    private var isGeocodingInFlight = false

    private let service = SearchService(client: APIClient(baseURL: AppConfig.apiBaseURL))

    func submit() {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        hasSearched = true   // 검색 시작 시점(진행 중에도 최근 섹션 숨김, SearchView !isSearching 배제 동형)
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
    /// 최근 장소(스펙 2026-07-26) — 출발지·도착지 분리 목록(위원장 지시 2026-07-26),
    /// 이 시트의 필드 스코프만 시트 열릴 때 로드.
    private let recentStore = RecentSearchStore()
    private var recentScope: RecentEndpointScope { target == .from ? .from : .to }
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
                            // 후행 마침표 제거(SearchView 동형). 출발·도착 후보는 주소
                            // 비중이 높아 마침표 한 글자에 juso가 0건으로 전멸한다.
                            let query = normalizeVoiceQuery(text)
                            model.query = query
                            AccessibilityNotification.Announcement(query).post()
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
                // 최근 장소(스펙 2026-07-26): 후보 검색 전 상태에만(hasSearched tri-state —
                // "아직 검색 안 함"과 "검색함(0건·실패 포함)"을 구분, places/addresses.isEmpty만
                // 쓰면 0건 노출 후 재노출되는 회귀). 행 활성화=재검색 없이 즉시 확정,
                // swipeActions 삭제가 VoiceOver 로터로 자동 노출된다. 기록은
                // select→onSelect→setEndpoint가 담당(이중 기록 금지).
                if !model.hasSearched && !recentEndpoints.isEmpty {
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
            // 상단 고정(.always 포함): iOS 26 시트 기본값은 하단 배치라 검색 탭과
            // 해부 구조(필드→마이크→최근→결과)가 어긋나고, 시트 안에서도 마이크 행
            // (상단)과 필드(하단)가 분리된다 — 검색 탭과 동일한 상단 드로어로 통일
            // (2026-07-26 위원장 승인, 하단 통일안은 VO 선형 순서 훼손으로 기각).
            .searchable(
                text: $model.query,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: Text(appLocalized("ios.search.prompt")))
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
                recentEndpoints = recentStore.endpoints(recentScope)
            }
            // 마이크는 항상 폐기(시트가 닫히면 뷰가 소멸하므로 유령 청취 방지 —
            // SearchView 동형 teardown). 검색 Task도 함께 취소.
            .onDisappear {
                model.cancel()
                Task { await speech.cancel() }
            }
        }
    }

    /// denied·failed 안내(SearchView 미러, 판정 정본은 speechAlertText). 확인 시 idle 복귀.
    private var speechAlertMessage: String? { speechAlertText(speech) }

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
        recentEndpoints = recentStore.removeEndpoint(endpoint, scope: recentScope)
        AccessibilityNotification.Announcement(appLocalized("recent.deleted")).post()
        if recentEndpoints.isEmpty {
            micRowFocused = true
            return
        }
        focusedRecent = recentEndpoints[min(index, recentEndpoints.count - 1)]
    }

    private func clearRecent() {
        recentStore.clearEndpoints(recentScope)
        recentEndpoints = []
        AccessibilityNotification.Announcement(appLocalized("recent.cleared")).post()
        micRowFocused = true
    }
}
