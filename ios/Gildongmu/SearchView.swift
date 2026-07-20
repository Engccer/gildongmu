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

    var body: some View {
        NavigationStack {
            List {
                // 마이크는 검색 필드 바로 다음 행: toolbar(내비 바)에 두면 VoiceOver가
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
                            model.query = text
                            AccessibilityNotification.Announcement(text).post()
                            runSearch()
                        },
                        onPause: nil
                    )
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
                let store = LaunchActionStore.shared
                if store.voiceStartRequested {
                    store.voiceStartRequested = false
                    await speech.start()
                }
            }
            .onChange(of: model.resultsRevision) { focusedRowID = firstRowID }
            // 마이크는 항상 폐기(화면을 떠난 뒤 유령 청취 방지 — 탭 전환·새로고침 재생성 포함).
            // ChatConversationView 동형 teardown: 없으면 오디오 세션·인식 Task가 고아로 남는다.
            .onDisappear {
                Task { await speech.cancel() }
            }
            .alert(speechAlertMessage ?? "", isPresented: speechAlertBinding) {
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

    /// 새 검색 시작 지점(제출·음성 확정) 공용 경로. 분류·지역 필터를 초기화한 뒤
    /// 제출한다(웹 performSearch의 setBucket(null)/setRegion(null) 미러) — 필터
    /// 리셋은 결과 도착 전에 끝나므로 포커스 이동 시점엔 항상 무필터 상태다.
    private func runSearch() {
        bucket = nil
        region = nil
        model.submit()
    }

    /// denied·failed 안내(3-state: 실패와 거부를 다른 문장으로). 확인 시 idle 복귀.
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

    /// 포커스 이동 목표: 첫 섹션의 첫 행(orderedSections는 건수 내림차순).
    private var firstRowID: String? {
        guard let outcome = model.outcome else { return nil }
        for section in outcome.orderedSections {
            switch section {
            case .places(let places):
                if let first = places.first { return "place-\(first.id)" }
            case .addresses(let addresses):
                if let first = addresses.first { return "address-\(first.roadAddr)" }
            case .web(let results):
                if let first = results.first { return "web-\(first.url)" }
            }
        }
        return nil
    }

    @ViewBuilder
    private func sectionView(_ section: SearchSection) -> some View {
        switch section {
        case .places(let places):
            placesSectionView(places)
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

    /// 장소 섹션: 분류·지역 두 축 필터(AND 결합) + 버킷별 Section 분할.
    /// 웹 PlaceSearch.tsx 575-660행 미러(칩 대신 iOS 문법의 Picker 2종).
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
                // 헤더 "{label} {count}건"은 ko.json category.groupHeading 정본 미러.
                ForEach(Array(groupPlacesByBucket(filtered).enumerated()), id: \.offset) { _, group in
                    Section(appLocalized("category.groupHeading", bucketLabel(group.bucket, lang: AppLanguage.current), String(group.places.count))) {
                        ForEach(group.places) { place in
                            NavigationLink(value: place) {
                                PlaceRow(place: place, onAskAbout: { chatPlace = place })
                            }
                            .accessibilityFocused($focusedRowID, equals: "place-\(place.id)")
                        }
                    }
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
    /// 장소 채팅 진입(검색 결과 전용 — sheet 상태를 가진 화면만 넘긴다).
    /// 채팅 카드 내 재사용은 nil로 액션 미노출(채팅 안에서 채팅 재진입 순환 방지).
    var onAskAbout: (() -> Void)? = nil
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading) {
            Text(place.name)
            Text(joined)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
        // ⚠ 선언은 역순: VoiceOver 쓸기 메뉴가 빌더 선언의 역순으로 노출된다(실기기 관측).
        // 사용자 경험 순서: 주소 복사하기 → 카카오맵 → 네이버 지도 → 전화 걸기 → 물어보기.
        // 보유한 데이터만 낸다(빈 도로명·빈 전화 = 죽은 액션).
        .accessibilityActions {
            if let onAskAbout {
                Button(appLocalized("ios.place.askAbout", place.name)) { onAskAbout() }
            }
            if let phone = place.phone, !phone.isEmpty,
               let telURL = URL(string: "tel:\(phone.replacingOccurrences(of: "-", with: ""))") {
                Button(appLocalized("ios.place.call")) { openURL(telURL) }
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
        var parts = [place.category, place.roadAddress.isEmpty ? place.address : place.roadAddress]
        if let distance = place.distanceMeters {
            // ko.json place.distance "약 {distance}" 정본 미러.
            parts.append(appLocalized("place.distance", formatDistanceKo(distance)))
        }
        return parts.filter { !$0.isEmpty }.joined(separator: ", ")
    }
}

/// 웹 `src/lib/format.ts` formatDistance 미러: 1,000m 미만은 "{m}m", 이상은
/// 소수 첫째자리 "{km}km". GildongmuKit의 동형 함수는 private이라(Kit 비수정
/// 범위) 여기 로컬로 둔다.
private func formatDistanceKo(_ meters: Double) -> String {
    if meters < 1000 { return "\(Int(meters.rounded()))m" }
    return String(format: "%.1fkm", meters / 1000)
}

/// 장소 필터 픽커 항목(분류·지역 공용). 라벨은 이미 로컬라이즈된 문자열.
private struct FilterChip: Identifiable {
    let id: String
    let label: String
    let count: Int
}
