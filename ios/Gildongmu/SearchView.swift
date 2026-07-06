import SwiftUI
import GildongmuKit

struct SearchView: View {
    @State private var model = SearchModel()
    /// 검색 완료 후 첫 결과로 VoiceOver 포커스 이동(웹 "settled 후 1회 포커스" 원칙의 iOS 문법).
    /// 행 키는 섹션 접두("attraction-"·"place-"·"address-"·"web-")로 List 전역 유일.
    @AccessibilityFocusState private var focusedRowID: String?

    var body: some View {
        NavigationStack {
            List {
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
            .navigationTitle("길동무")
            .searchable(text: $model.query, prompt: "장소, 주소 검색")
            .onSubmit(of: .search) { model.submit() }
            .onChange(of: model.resultsRevision) { focusedRowID = firstRowID }
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
            // 명소 섹션과 같은 List에 공존하므로 동일 id 행을 제거(ForEach 정체성 충돌·중복 낭독 방지)
            let filtered = places.filter { !attractionIDs.contains($0.id) }
            if !filtered.isEmpty {
                Section("장소") {
                    ForEach(filtered) { place in
                        NavigationLink(value: place) { PlaceRow(place: place) }
                            .accessibilityFocused($focusedRowID, equals: "place-\(place.id)")
                    }
                }
            }
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

/// 장소 행. 이름·카테고리를 하나의 접근성 객체로 합친다. 상세 진입은 M1.
struct PlaceRow: View {
    let place: Place

    var body: some View {
        VStack(alignment: .leading) {
            Text(place.name)
            Text(joined)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }

    /// falsy 조각 제거+쉼표 결합(웹 joinText 미러).
    private var joined: String {
        [place.category, place.roadAddress.isEmpty ? place.address : place.roadAddress]
            .filter { !$0.isEmpty }
            .joined(separator: ", ")
    }
}
