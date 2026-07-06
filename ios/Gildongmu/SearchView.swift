import SwiftUI
import GildongmuKit

struct SearchView: View {
    @State private var model = SearchModel()

    var body: some View {
        NavigationStack {
            List {
                if let outcome = model.outcome {
                    if !outcome.attractions.isEmpty {
                        Section("명소") {
                            ForEach(outcome.attractions) { PlaceRow(place: $0) }
                        }
                    }
                    ForEach(Array(outcome.sections.enumerated()), id: \.offset) { _, section in
                        sectionView(section)
                    }
                }
            }
            .navigationTitle("길동무")
            .searchable(text: $model.query, prompt: "장소, 주소 검색")
            .onSubmit(of: .search) { model.submit() }
            .overlay {
                if model.isSearching { ProgressView("검색 중") }
            }
        }
    }

    @ViewBuilder
    private func sectionView(_ section: SearchSection) -> some View {
        switch section {
        case .places(let places):
            Section("장소") { ForEach(places) { PlaceRow(place: $0) } }
        case .addresses(let addresses):
            Section("주소") {
                ForEach(addresses, id: \.roadAddr) { address in
                    // 한 줄=한 객체: 도로명+우편번호를 단일 텍스트로(웹 joinText 동형)
                    Text("\(address.roadAddr), \(address.zipNo)")
                }
            }
        case .web(let results):
            Section("웹 검색") {
                ForEach(results, id: \.url) { result in
                    Link(destination: URL(string: result.url)!) {
                        VStack(alignment: .leading) {
                            Text(result.title)
                            Text(result.snippet)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            }
        }
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
