import SwiftUI
import Accessibility
import GildongmuKit

struct SearchView: View {
    @State private var model = SearchModel()
    @State private var speech = SpeechService()
    /// 장소 섹션 분류·지역 필터(웹 bucket/region state 미러). 새 검색마다 초기화(runSearch).
    @State private var bucket: String?
    @State private var region: String?
    /// 검색 완료 후 첫 결과로 VoiceOver 포커스 이동(웹 "settled 후 1회 포커스" 원칙의 iOS 문법).
    /// 행 키는 섹션 접두("place-"·"address-"·"web-")로 List 전역 유일.
    @AccessibilityFocusState private var focusedRowID: String?
    /// 결과 행 커스텀 액션의 장소 채팅 sheet(내 주변 뷰들과 동형). 표시마다 새 대화.
    @State private var chatPlace: Place?
    /// 최근 검색(스펙 2026-07-26). 검색 전 초기 화면에만 노출, 기록은 runSearch 공용 경로.
    private let recentStore = RecentSearchStore()
    @State private var recentQueries: [String] = []
    @AccessibilityFocusState private var focusedRecentQuery: String?
    /// 목록 소멸 시 포커스 착지점 — 항상 존재하는 마이크 행(스펙 §5).
    @AccessibilityFocusState private var micRowFocused: Bool
    @State private var rowFocusTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
            List {
                Section { LocationBarView() }
                // 마이크는 위치 표시줄 다음 행: toolbar(내비 바)에 두면 VoiceOver가
                // 제목보다 먼저 읽는다(실기기 실측). WhatsApp식 홀드(2026-07-20 탭 토글
                // 대체): 검색어는 짧아 홀드 단일 동작만(잠금·취소 슬라이드는 채팅 전용).
                // 최종 텍스트를 검색어로 넣고 즉시 검색(웹 음성 검색 계약). partial은
                // 필드에 실시간 반영하지 않는다(필드 값 경합 회피, 최종만). 포커스 이동은
                // 하지 않는다 — 검색이 자동 실행되는 설계라 다음 행동(결과 확인)의
                // 목적지는 settled 후 첫 결과 행 포커스(resultsRevision onChange)가 담당.
                Section {
                    HoldDictationButton(
                        speech: speech,
                        hint: appLocalized("ios.voice.holdHintSearch"),
                        showsTitle: true,
                        onTranscript: { text in
                            // 후행 마침표 제거 — 통지·입력값·질의가 같은 문자열이어야
                            // 들은 것과 검색된 것이 어긋나지 않는다(VoiceQuery.swift 실측).
                            let query = normalizeVoiceQuery(text)
                            model.query = query
                            AccessibilityNotification.Announcement(query).post()
                            runSearch()
                        },
                        onPause: nil
                    )
                    .accessibilityFocused($micRowFocused)
                }
                // 최근 검색(스펙 2026-07-26): 검색 전 초기 상태에만. 행 활성화=재검색,
                // swipeActions 삭제가 VoiceOver 로터 커스텀 액션으로 자동 노출된다.
                if model.outcome == nil && !model.isSearching && !recentQueries.isEmpty {
                    Section(appLocalized("recent.title")) {
                        ForEach(recentQueries, id: \.self) { query in
                            Button(query) {
                                model.query = query
                                runSearch()
                            }
                            .accessibilityFocused($focusedRecentQuery, equals: query)
                            .swipeActions {
                                Button(appLocalized("recent.delete"), role: .destructive) {
                                    deleteRecent(query)
                                }
                            }
                        }
                        Button(appLocalized("recent.clearAll")) { clearRecent() }
                    }
                }
                if let outcome = model.outcome {
                    ForEach(Array(outcome.orderedSections.enumerated()), id: \.offset) { _, section in
                        sectionView(section)
                    }
                }
            }
            .navigationDestination(for: Place.self) { PlaceDetailView(place: $0) }
            // navigationTitle은 유지(상세 push 시 뒤로 버튼 라벨 "길동무" 보존),
            // 중앙 표시는 공통 길동무 메뉴가 대체(새로고침·설정).
            .navigationTitle(appLocalized("app.title"))
            .navigationBarTitleDisplayMode(.inline)
            .gildongmuTitleMenu()
            .searchable(text: $model.query, prompt: Text(appLocalized("ios.search.prompt")))
            .onSubmit(of: .search) { runSearch() }
            // 단축어 "음성 검색" 진입: App이 리셋·탭 전환을 마친 뒤 세운 플래그를
            // 재생성된 이 뷰가 소비해 마이크 시작(시작음·햅틱·권한은 기존 경로 그대로).
            // 홀드 없이 시작된 이 세션의 정지는 마이크 행 탭(HoldDictationButton의
            // 외부 시작 세션 공용 정지 경로)이 담당한다.
            .task {
                recentQueries = recentStore.queries()
                let store = LaunchActionStore.shared
                if store.voiceStartRequested {
                    store.voiceStartRequested = false
                    // 이 세션의 정지는 마이크 행 짧은 탭이므로 VO 커서를 미리 그 행에
                    // 놓는다(위원장 지시 2026-07-26). 화면 최상단에서 마이크까지
                    // 스와이프로 찾아가야 정지할 수 있던 번거로움을 없앤다. 홀드 경로엔
                    // 없던 문제다: 거기선 손가락이 이미 버튼 위에 있다.
                    micRowFocused = true
                    await speech.start()
                    // 권한·모델 다운로드 대기 중 커서가 밀려났으면 되돌린다.
                    // @AccessibilityFocusState는 양방향이라 이탈 시 false로 내려오므로
                    // 재대입이 no-op이 아니다(이미 마이크에 있으면 무발화 no-op).
                    if speech.isListening {
                        micRowFocused = true
                        // 커서가 실제로 이동했다면 라벨 낭독이 시작되는데, 여기는 이미
                        // 녹음 중이라 그 발화가 전사에 혼입된다(단축어 진입 혼입과 동일
                        // 계열) — 무음 통지로 즉시 삼킨다(녹음 중 SR 발화 0 계약, 헌장 §6).
                        interruptVoiceOverSpeech()
                    }
                }
            }
            .onChange(of: model.resultsRevision) { landFirstRowFocus(proxy) }
            // 마이크는 항상 폐기(화면을 떠난 뒤 유령 청취 방지 — 탭 전환·새로고침 재생성 포함).
            // ChatConversationView 동형 teardown: 없으면 오디오 세션·인식 Task가 고아로 남는다.
            .onDisappear {
                rowFocusTask?.cancel()
                Task { await speech.cancel() }
            }
            .alert(speechAlertMessage ?? "", isPresented: speechAlertBinding) {
                // 권한 거부는 설정으로만 해결된다. 안내에 그 화면을 여는 버튼을 함께
                // (위치 안내와 같은 계약, 리뷰 M-2 수용)
                if case .denied = speech.phase {
                    Button(appLocalized("ios.common.openSettings")) { openAppSettings() }
                }
                Button(appLocalized("ios.common.ok")) {}
            }
            .sheet(item: $chatPlace) { ChatView(place: $0) }
            .overlay {
                if model.isSearching {
                    ProgressView(appLocalized("ios.search.searching"))
                } else if model.failed {
                    // 3-state: "조회 실패"는 "결과 없음"과 다른 화면·문장(뭉개기 금지)
                    ContentUnavailableView(
                        appLocalized("ios.search.failedTitle"),
                        systemImage: "wifi.exclamationmark",
                        description: Text(appLocalized("ios.common.retryLater"))
                    )
                } else if model.outcome != nil && model.totalCount == 0 {
                    ContentUnavailableView.search
                }
            }
            }
        }
    }

    /// 결과 도착 시 첫 행으로 커서를 보낸다.
    ///
    /// ⚠ **동기 대입만으로는 안 된다.** `List`의 오프스크린 행은 AX 트리에서 컬링되고,
    /// 대상이 트리에 없으면 SwiftUI가 대입을 조용히 되돌린다. 이 화면은 첫 결과 위에
    /// 마이크 행·최근 검색어·필터가 있어 첫 행이 화면 밖일 수 있다(길찾기 검색 시트에서
    /// 같은 결함을 실기기로 확정, 2026-08-02). 채팅의 검증된 순서를 그대로 따른다:
    /// **가시화(scrollTo) → 지연 → 경합 바인딩 해제 → 대입 → 되돌림 검증 → 1회 재시도.**
    ///
    /// 통지 완료는 기다리지 않는다(위원장 판정): 안내가 잘리더라도 즉시 결과로 가는
    /// 쪽이 실사용 탐색이 빠르다.
    private func landFirstRowFocus(_ proxy: ScrollViewProxy) {
        guard let first = firstRow else { return }
        rowFocusTask?.cancel()
        rowFocusTask = Task { @MainActor in
            proxy.scrollTo(first.scroll, anchor: .top)
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            applyRowFocus(first.focus)

            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled, focusedRowID != first.focus else { return }
            proxy.scrollTo(first.scroll, anchor: .top)
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            applyRowFocus(first.focus)
        }
    }

    /// 경합하는 포커스 바인딩을 먼저 놓아야 대입이 먹는다.
    private func applyRowFocus(_ id: String) {
        micRowFocused = false
        focusedRecentQuery = nil
        focusedRowID = id
    }

    /// 새 검색 시작 지점(제출·음성 확정) 공용 경로. 분류·지역 필터를 초기화한 뒤
    /// 제출한다(웹 performSearch의 setBucket(null)/setRegion(null) 미러) — 필터
    /// 리셋은 결과 도착 전에 끝나므로 포커스 이동 시점엔 항상 무필터 상태다.
    private func runSearch() {
        recentQueries = recentStore.recordQuery(model.query)  // 제출 = 기록 시점(음성 경로 포함)
        bucket = nil
        region = nil
        model.submit()
    }

    /// 항목 삭제(스펙 §5 포커스 계약): 다음 항목 → 이전 항목 → 목록 소멸 시 마이크 행.
    /// 통지 1건 + 포커스 이동(이동 착지 라벨 낭독과 순서 무해 — polite 큐).
    private func deleteRecent(_ query: String) {
        guard let index = recentQueries.firstIndex(of: query) else { return }
        recentQueries = recentStore.removeQuery(query)
        AccessibilityNotification.Announcement(appLocalized("recent.deleted")).post()
        if recentQueries.isEmpty {
            micRowFocused = true
            return
        }
        focusedRecentQuery = recentQueries[min(index, recentQueries.count - 1)]
    }

    private func clearRecent() {
        recentStore.clearQueries()
        recentQueries = []
        AccessibilityNotification.Announcement(appLocalized("recent.cleared")).post()
        micRowFocused = true
    }

    /// denied·failed 안내(3-state: 거부와 실패, 실패는 다시 원인별로 다른 문장).
    /// 판정 정본은 speechAlertText — 확인 시 idle 복귀.
    private var speechAlertMessage: String? { speechAlertText(speech) }

    private var speechAlertBinding: Binding<Bool> {
        Binding(
            get: { speechAlertMessage != nil },
            set: { if !$0 { speech.reset() } }
        )
    }

    /// 포커스 이동 목표: 첫 섹션의 첫 행(orderedSections는 건수 내림차순).
    private var firstRowID: String? { firstRow?.focus }

    /// 첫 결과 행. `focus`는 포커스 바인딩 값(접두사 포함), `scroll`은 **ForEach 정체성**
    /// (= `scrollTo` 인자)이다. 둘은 다르다 — 접두사 붙은 키를 scrollTo에 넘기면
    /// 아무 행에도 안 걸려 가시화가 조용히 실패한다.
    private var firstRow: (focus: String, scroll: String)? {
        guard let outcome = model.outcome else { return nil }
        for section in outcome.orderedSections {
            switch section {
            case .places(let places):
                if let first = places.first { return ("place-\(first.id)", first.id) }
            case .addresses(let addresses):
                if let first = addresses.first { return ("address-\(first.roadAddr)", first.roadAddr) }
            case .web(let results):
                if let first = results.first { return ("web-\(first.url)", first.url) }
            }
        }
        return nil
    }

    @ViewBuilder
    private func sectionView(_ section: SearchSection) -> some View {
        switch section {
        case .places(let places):
            // 둘 이상 섹션 공존 시에만 장소 섹션 헤더(웹 showSectionHeadings 미러) —
            // 주소·웹 형제 섹션과 헤딩 점프 대칭을 맞춘다. 단독 섹션은 헤더 없이(과잉 방지).
            if (model.outcome?.orderedSections.count ?? 0) > 1 {
                Section(appLocalized("search.placeSection")) {
                    placesSectionView(places)
                }
            } else {
                placesSectionView(places)
            }
        case .addresses(let addresses):
            Section(appLocalized("search.addressSection")) {
                ForEach(addresses, id: \.roadAddr) { address in
                    // 한 줄=한 객체: 도로명+우편번호를 단일 텍스트로(웹 joinText 동형)
                    Text("\(address.roadAddr), \(address.zipNo)")
                        .accessibilityFocused($focusedRowID, equals: "address-\(address.roadAddr)")
                        .addressCopyActions(address)
                }
            }
        case .web(let results):
            Section(appLocalized("ios.search.webSection")) {
                ForEach(results, id: \.url) { result in
                    webRow(result)
                        .accessibilityFocused($focusedRowID, equals: "web-\(result.url)")
                }
            }
        }
    }

    /// 장소 섹션: 분류·지역 두 축 필터(AND 결합) + 정확도순 플랫 리스트.
    /// 버킷 Section 분할은 폐지(2026-07-21) — 고정 섹션 서열이 정확도 1위를
    /// 최하단에 매몰시키는 회귀 실측(웹 ResultList 미러). 버킷은 필터 축일 뿐이다.
    @ViewBuilder
    private func placesSectionView(_ places: [Place]) -> some View {
        let base = places
        if !base.isEmpty {
            // 칩/픽커 목록·카운트는 전체 결과(base) 기준 고정 — 선택해도 목록이 줄지
            // 않아 SR 탐색이 안정적이다(웹 bucketItems/regionItems 미러).
            let bucketItems = bucketsPresent(base).map { key in
                FilterChip(id: key, label: bucketLabel(key, lang: AppLanguage.current), count: filterPlaces(base, bucket: key).count)
            }
            let regionItems = regionsPresent(base).map { key in
                FilterChip(id: key, label: regionLabel(key, lang: AppLanguage.current), count: filterPlaces(base, region: key).count)
            }
            // 축 항목이 1개 이하면 그 축은 숨김(웹 ChipFilter "items.length <= 1" 미러)
            // 라벨·"전체"/"전국"은 ko.json category.filterLabel/all·region.filterLabel/all 정본 미러.
            if bucketItems.count > 1 {
                Picker(appLocalized("category.filterLabel"), selection: $bucket) {
                    Text(appLocalized("category.all")).tag(nil as String?)
                    ForEach(bucketItems) { item in
                        Text("\(item.label) (\(item.count))").tag(item.id as String?)
                    }
                }
                .pickerStyle(.menu)
            }
            if regionItems.count > 1 {
                Picker(appLocalized("region.filterLabel"), selection: $region) {
                    Text(appLocalized("region.all")).tag(nil as String?)
                    ForEach(regionItems) { item in
                        Text("\(item.label) (\(item.count))").tag(item.id as String?)
                    }
                }
                .pickerStyle(.menu)
            }
            let filtered = filterPlaces(filterPlaces(base, bucket: bucket), region: region)
            if filtered.isEmpty {
                Text(appLocalized("search.noFilterResults"))
            } else {
                ForEach(filtered) { place in
                    NavigationLink(value: place) {
                        PlaceRow(place: place, onAskAbout: { chatPlace = place })
                    }
                    .accessibilityFocused($focusedRowID, equals: "place-\(place.id)")
                }
            }
        }
    }

    /// 웹 결과 행. 외부 응답 URL은 비신뢰 데이터라 강제 언래핑 금지: 무효 URL은 텍스트로 강등.
    @ViewBuilder
    private func webRow(_ result: WebSearchResult) -> some View {
        if let url = URL(string: result.url) {
            Link(destination: url) { webRowContent(result) }
        } else {
            webRowContent(result)
        }
    }

    private func webRowContent(_ result: WebSearchResult) -> some View {
        VStack(alignment: .leading) {
            Text(result.title)
            Text(result.snippet)
        }
        .accessibilityElement(children: .combine)
    }
}

/// 장소 행. 이름·카테고리를 하나의 접근성 객체로 합친다.
/// 화면 버튼 대신 VoiceOver 커스텀 액션(로터)으로 전화·길찾기 제공(spec §4).
struct PlaceRow: View {
    let place: Place
    /// 도메인 화면(내 주변)이 보조 줄을 대체할 때 주입(진료 상태·실내외·방위 등).
    /// nil이면 기본 조합(카테고리·주소·거리) — 검색 탭·채팅 카드 무변경.
    var secondaryOverride: String? = nil
    /// 장소 채팅 진입(검색 결과 전용 — sheet 상태를 가진 화면만 넘긴다).
    /// 채팅 카드 내 재사용은 nil로 액션 미노출(채팅 안에서 채팅 재진입 순환 방지).
    var onAskAbout: (() -> Void)? = nil
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading) {
            Text(place.name)
            // 낭독만 거리 단위 풀어쓰기(m→minutes 오독 대응). combine이 자식 라벨을 합친다.
            distanceText(joined)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
        // ⚠ 선언은 역순: VoiceOver 쓸기 메뉴가 빌더 선언의 역순으로 노출된다(실기기 관측).
        // 사용자 경험 순서: 주소 복사하기 → 카카오맵 → 네이버 지도 → 길찾기 → 전화 걸기 → 물어보기.
        // 보유한 데이터만 낸다(빈 도로명·빈 전화 = 죽은 액션).
        .accessibilityActions {
            if let onAskAbout {
                Button(appLocalized("ios.place.askAbout", place.name)) { onAskAbout() }
            }
            if let phone = place.phone, !phone.isEmpty,
               let telURL = URL(string: "tel:\(phone.replacingOccurrences(of: "-", with: ""))") {
                Button(appLocalized("ios.place.call")) { openURL(telURL) }
            }
            // 길찾기 탭 도착지 프리필 진입(Task I4). 다음 두 딥링크(외부 앱 위임)와
            // 짝지어 "이 장소로 가는 법" 그룹 안에 둔다.
            Button(appLocalized("directions.toHere")) {
                DirectionsPrefillStore.shared.pending = .place(label: place.name, lat: place.lat, lng: place.lng)
            }
            Button(appLocalized("ios.route.naver")) {
                if let url = buildNaverRouteDeeplink(mode: .walk, dest: dest, appname: AppConfig.appIdentifier) {
                    openURL(url)
                }
            }
            Button(appLocalized("ios.route.kakao")) {
                if let url = buildKakaoRouteDeeplink(mode: .walk, dest: dest) { openURL(url) }
            }
            if !place.roadAddress.isEmpty {
                Button(appLocalized("ios.place.copyAddress")) { copyAddressToPasteboard(place.roadAddress) }
            }
        }
    }

    private var dest: RouteDestination { RouteDestination(lat: place.lat, lng: place.lng, name: place.name) }

    /// falsy 조각 제거+쉼표 결합(웹 joinText 미러). 거리는 있을 때만 마지막 조각으로.
    private var joined: String {
        if let secondaryOverride { return secondaryOverride }
        var parts = [place.category, place.roadAddress.isEmpty ? place.address : place.roadAddress]
        if let distance = place.distanceMeters {
            // ko.json place.distance "약 {distance}" 정본 미러.
            parts.append(appLocalized("place.distance", formatDistance(Int(distance.rounded()))))
        }
        return parts.filter { !$0.isEmpty }.joined(separator: ", ")
    }
}

/// 장소 필터 픽커 항목(분류·지역 공용). 라벨은 이미 로컬라이즈된 문자열.
private struct FilterChip: Identifiable {
    let id: String
    let label: String
    let count: Int
}
