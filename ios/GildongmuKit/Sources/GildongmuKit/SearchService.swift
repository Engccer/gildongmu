import Foundation

/// 검색 결과 섹션 하나. 순서는 orderedSections가 정한다.
public enum SearchSection: Sendable {
    case places([Place])
    case addresses([JusoAddress])
    case web([WebSearchResult])

    public var count: Int {
        switch self {
        case .places(let v): v.count
        case .addresses(let v): v.count
        case .web(let v): v.count
        }
    }
}

/// 한 검색의 최종 산출. attractions는 별도 트랙(뷰가 건수 무관 최상단 병치).
public struct SearchOutcome: Sendable {
    public let attractions: [Place]
    public let sections: [SearchSection]
    /// 정본 두 트랙(장소·주소) 호출이 모두 실패했는가. 3-state 불변식의 신호:
    /// 뷰가 "결과 없음"과 "조회 실패"를 분리해 낭독한다. 빈 결과의 성공 응답은 false.
    public let allFailed: Bool
}

/// 빈 섹션 제외 + 건수 내림차순(웹 orderResultSections 미러, 안정 정렬).
public func orderedSections(places: [Place], addresses: [JusoAddress], web: [WebSearchResult]) -> [SearchSection] {
    let all: [SearchSection] = [.places(places), .addresses(addresses), .web(web)]
    return all.filter { $0.count > 0 }.sorted { $0.count > $1.count }
}

/// 검색 오케스트레이션. 웹 runQuerySearch의 의미론 미러:
/// 장소+주소(+ko 명소) 병렬, 웹은 둘 다 0건일 때만, 섹션 실패는 빈 배열로 격리.
public struct SearchService: Sendable {
    let client: APIClient
    public init(client: APIClient) { self.client = client }

    public func search(query: String, lat: Double?, lng: Double?, lang: String) async -> SearchOutcome {
        var coordQuery: [URLQueryItem] = [URLQueryItem(name: "query", value: query)]
        if let lat, let lng {
            coordQuery.append(URLQueryItem(name: "lat", value: String(lat)))
            coordQuery.append(URLQueryItem(name: "lng", value: String(lng)))
        }
        async let placesTask: PlaceSearchResult? = try? client.get("/api/places", query: coordQuery + [URLQueryItem(name: "lang", value: lang)])
        async let addressTask: AddressSearchResponse? = try? client.get("/api/address/search", query: [URLQueryItem(name: "query", value: query)])
        // 명소는 ko 전용(웹 계약). en은 장소 병합 검색이 커버.
        async let attractionsTask: PlaceSearchResult? = lang == "ko"
            ? (try? client.get("/api/places/attractions", query: coordQuery + [URLQueryItem(name: "lang", value: lang)]))
            : nil

        let placesResult = await placesTask
        let addressResult = await addressTask
        let places = placesResult?.places ?? []
        let addresses = addressResult?.addresses ?? []
        let attractions = (await attractionsTask)?.places ?? []

        var web: [WebSearchResult] = []
        if places.isEmpty && addresses.isEmpty {
            let webResponse: WebSearchResponse? = try? await client.get("/api/search/web", query: [URLQueryItem(name: "query", value: query)])
            web = webResponse?.web ?? []
        }
        return SearchOutcome(
            attractions: attractions,
            sections: orderedSections(places: places, addresses: addresses, web: web),
            allFailed: placesResult == nil && addressResult == nil
        )
    }
}
