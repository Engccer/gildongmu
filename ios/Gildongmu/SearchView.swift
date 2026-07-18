import SwiftUI
import Accessibility
import GildongmuKit

struct SearchView: View {
    /// 제목 탭 → 처음으로(웹 헤더 제목 하드 링크 동형). 세션 epoch 증가로 전체 재생성.
    @Environment(\.resetSession) private var resetSession
    @State private var model = SearchModel()
    @State private var speech = SpeechService()
    /// 장소 섹션 분류·지역 필터(웹 bucket/region state 미러). 새 검색마다 초기화(runSearch).
    @State private var bucket: String?
    @State private var region: String?
    /// 검색 완료 후 첫 결과로 VoiceOver 포커스 이동(웹 "settled 후 1회 포커스" 원칙의 iOS 문법).
    /// 행 키는 섹션 접두("attraction-"·"place-"·"address-"·"web-")로 List 전역 유일.
    @AccessibilityFocusState private var focusedRowID: String?

    var body: some View {
        NavigationStack {
            List {
                // 마이크는 검색 필드 바로 다음 행: toolbar(내비 바)에 두면 VoiceOver가
                // 제목보다 먼저 읽는다(실기기 실측). 라벨 변화가 상태 신호(disabled 금지).
                Section {
                    Button(action: toggleMic) {
                        Label(
                            // "음성 입력" 금지: 받아쓴 내용의 "음성"과 라벨이 SR에서 혼동(채팅 동일 교훈)
                            speech.isListening ? "받아쓰기 중지" : "받아쓰기 시작",
                            systemImage: speech.isListening ? "mic.fill" : "mic"
                        )
                    }
                }
                if let outcome = model.outcome {
                    if !outcome.attractions.items.isEmpty {
                        Section("명소") {
                            ForEach(outcome.attractions.items) { place in
                                NavigationLink(value: place) { PlaceRow(place: place) }
                                    .accessibilityFocused($focusedRowID, equals: "attraction-\(place.id)")
                            }
                        }
                    }
                    ForEach(Array(outcome.orderedSections.enumerated()), id: \.offset) { _, section in
                        sectionView(section, attractionIDs: Set(outcome.attractions.items.map(\.id)))
                    }
                }
            }
            .navigationDestination(for: Place.self) { PlaceDetailView(place: $0) }
            // navigationTitle은 유지(상세 push 시 뒤로 버튼 라벨 "길동무" 보존),
            // 중앙 표시는 principal 버튼이 대체 — 탭하면 초기 화면 복귀.
            .navigationTitle("길동무")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Button("길동무") { resetSession() }
                }
            }
            .searchable(text: $model.query, prompt: "장소, 주소 검색")
            .onSubmit(of: .search) { runSearch() }
            // 단축어 "음성 검색" 진입: App이 리셋·탭 전환을 마친 뒤 세운 플래그를
            // 재생성된 이 뷰가 소비해 마이크 시작(시작음·햅틱·권한은 기존 경로 그대로).
            .task {
                let store = LaunchActionStore.shared
                if store.voiceStartRequested {
                    store.voiceStartRequested = false
                    await speech.start()
                }
            }
            .onChange(of: model.resultsRevision) { focusedRowID = firstRowID }
            .alert(speechAlertMessage ?? "", isPresented: speechAlertBinding) {
                Button("확인") {}
            }
            .overlay {
                if model.isSearching {
                    ProgressView("검색 중")
                } else if model.failed {
                    // 3-state: "조회 실패"는 "결과 없음"과 다른 화면·문장(뭉개기 금지)
                    ContentUnavailableView(
                        "검색에 실패했습니다",
                        systemImage: "wifi.exclamationmark",
                        description: Text("잠시 후 다시 시도해 주세요")
                    )
                } else if model.outcome != nil && model.totalCount == 0 {
                    ContentUnavailableView.search
                }
            }
        }
    }

    /// 음성 입력 토글: 최종 텍스트를 검색어로 넣고 즉시 검색(웹 음성 검색 계약).
    /// partial은 검색 필드에 실시간 반영하지 않는다(필드 값 경합 회피, 최종만).
    /// 재진입은 SpeechService의 phase 가드가 차단.
    /// 전사 성공은 침묵 금지(헌장 §6 받아쓰기 완료): 받아쓴 결과 원문을 polite 통지.
    /// 포커스 이동은 하지 않는다 — 검색이 자동 실행되는 설계라 다음 행동(결과 확인)의
    /// 목적지는 settled 후 첫 결과 행 포커스(resultsRevision onChange)가 이미 담당한다.
    private func toggleMic() {
        Task {
            if speech.isListening {
                if let text = await speech.stop() {
                    model.query = text
                    AccessibilityNotification.Announcement(text).post()
                    runSearch()
                }
            } else {
                await speech.start()
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
        case .denied: "설정에서 마이크 접근을 허용해 주세요"
        case .failed: "음성 인식을 시작하지 못했습니다. 다시 시도해 주세요"
        default: nil
        }
    }

    private var speechAlertBinding: Binding<Bool> {
        Binding(
            get: { speechAlertMessage != nil },
            set: { if !$0 { speech.reset() } }
        )
    }

    /// 포커스 이동 목표: 명소 최우선(최상단 병치), 없으면 첫 섹션의 첫 행.
    private var firstRowID: String? {
        guard let outcome = model.outcome else { return nil }
        if let first = outcome.attractions.items.first { return "attraction-\(first.id)" }
        let attractionIDs = Set(outcome.attractions.items.map(\.id))
        for section in outcome.orderedSections {
            switch section {
            case .places(let places):
                if let first = places.first(where: { !attractionIDs.contains($0.id) }) {
                    return "place-\(first.id)"
                }
            case .addresses(let addresses):
                if let first = addresses.first { return "address-\(first.roadAddr)" }
            case .web(let results):
                if let first = results.first { return "web-\(first.url)" }
            }
        }
        return nil
    }

    @ViewBuilder
    private func sectionView(_ section: SearchSection, attractionIDs: Set<String>) -> some View {
        switch section {
        case .places(let places):
            placesSectionView(places, attractionIDs: attractionIDs)
        case .addresses(let addresses):
            Section("주소") {
                ForEach(addresses, id: \.roadAddr) { address in
                    // 한 줄=한 객체: 도로명+우편번호를 단일 텍스트로(웹 joinText 동형)
                    Text("\(address.roadAddr), \(address.zipNo)")
                        .accessibilityFocused($focusedRowID, equals: "address-\(address.roadAddr)")
                }
            }
        case .web(let results):
            Section("웹 검색") {
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
    private func placesSectionView(_ places: [Place], attractionIDs: Set<String>) -> some View {
        // 명소 섹션과 같은 List에 공존하므로 동일 id 행을 제거(ForEach 정체성 충돌·중복 낭독 방지)
        let base = places.filter { !attractionIDs.contains($0.id) }
        if !base.isEmpty {
            // 칩/픽커 목록·카운트는 전체 결과(base) 기준 고정 — 선택해도 목록이 줄지
            // 않아 SR 탐색이 안정적이다(웹 bucketItems/regionItems 미러).
            let bucketItems = bucketsPresent(base).map { key in
                FilterChip(id: key, label: bucketLabelKo(key), count: filterPlaces(base, bucket: key).count)
            }
            let regionItems = regionsPresent(base).map { key in
                FilterChip(id: key, label: regionLabelKo(key), count: filterPlaces(base, region: key).count)
            }
            // 축 항목이 1개 이하면 그 축은 숨김(웹 ChipFilter "items.length <= 1" 미러)
            // 라벨·"전체"/"전국"은 ko.json category.filterLabel/all·region.filterLabel/all 정본 미러.
            if bucketItems.count > 1 {
                Picker("분류로 거르기", selection: $bucket) {
                    Text("전체").tag(nil as String?)
                    ForEach(bucketItems) { item in
                        Text("\(item.label) (\(item.count))").tag(item.id as String?)
                    }
                }
                .pickerStyle(.menu)
            }
            if regionItems.count > 1 {
                Picker("지역으로 거르기", selection: $region) {
                    Text("전국").tag(nil as String?)
                    ForEach(regionItems) { item in
                        Text("\(item.label) (\(item.count))").tag(item.id as String?)
                    }
                }
                .pickerStyle(.menu)
            }
            let filtered = filterPlaces(filterPlaces(base, bucket: bucket), region: region)
            if filtered.isEmpty {
                Text("선택한 필터에 해당하는 결과가 없습니다.")
            } else {
                // 헤더 "{label} {count}건"은 ko.json category.groupHeading 정본 미러.
                ForEach(Array(groupPlacesByBucket(filtered).enumerated()), id: \.offset) { _, group in
                    Section("\(bucketLabelKo(group.bucket)) \(group.places.count)건") {
                        ForEach(group.places) { place in
                            NavigationLink(value: place) { PlaceRow(place: place) }
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
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading) {
            Text(place.name)
            Text(joined)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityActions {
            if let phone = place.phone, !phone.isEmpty,
               let telURL = URL(string: "tel:\(phone.replacingOccurrences(of: "-", with: ""))") {
                Button("전화 걸기") { openURL(telURL) }
            }
            Button("네이버 지도 길찾기") {
                if let url = buildNaverRouteDeeplink(mode: .walk, dest: dest, appname: AppConfig.appIdentifier) {
                    openURL(url)
                }
            }
            Button("카카오맵 길찾기") {
                if let url = buildKakaoRouteDeeplink(mode: .walk, dest: dest) { openURL(url) }
            }
        }
    }

    private var dest: RouteDestination { RouteDestination(lat: place.lat, lng: place.lng, name: place.name) }

    /// falsy 조각 제거+쉼표 결합(웹 joinText 미러). 거리는 있을 때만 마지막 조각으로.
    private var joined: String {
        var parts = [place.category, place.roadAddress.isEmpty ? place.address : place.roadAddress]
        if let distance = place.distanceMeters {
            // ko.json place.distance "약 {distance}" 정본 미러.
            parts.append("약 \(formatDistanceKo(distance))")
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
