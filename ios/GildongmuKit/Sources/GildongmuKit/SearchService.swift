import Foundation

/// 섹션 하나의 3-state: 성공(빈 배열 포함)과 조회 실패를 분리한다.
/// "0건"과 "실패"를 뭉개지 않는 3-state 불변식의 타입 표현(뷰가 섹션별로 실패를 낭독 가능).
public enum SectionState<Element: Sendable>: Sendable {
    case loaded([Element])
    case failed

    public var items: [Element] {
        if case .loaded(let items) = self { return items }
        return []
    }

    public var isFailed: Bool {
        if case .failed = self { return true }
        return false
    }
}

/// 검색 결과 섹션 하나. 순서는 SearchOutcome.orderedSections가 정한다.
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

/// 한 검색의 최종 산출.
public struct SearchOutcome: Sendable {
    public let places: SectionState<Place>
    public let addresses: SectionState<JusoAddress>
    public let web: SectionState<WebSearchResult>

    public init(
        places: SectionState<Place>,
        addresses: SectionState<JusoAddress>,
        web: SectionState<WebSearchResult>
    ) {
        self.places = places
        self.addresses = addresses
        self.web = web
    }

    /// 정본 두 트랙(장소·주소) 호출이 모두 실패했는가. 3-state 불변식의 신호:
    /// 뷰가 "결과 없음"과 "조회 실패"를 분리해 낭독한다. 빈 결과의 성공 응답은 false.
    public var allFailed: Bool { places.isFailed && addresses.isFailed }

    /// 빈 섹션 제외 + 건수 내림차순(웹 orderResultSections 미러, 안정 정렬).
    public var orderedSections: [SearchSection] {
        let all: [SearchSection] = [.places(places.items), .addresses(addresses.items), .web(web.items)]
        return all.filter { $0.count > 0 }.sorted { $0.count > $1.count }
    }
}

/// 검색 오케스트레이션. 웹 runQuerySearch의 의미론 미러:
/// 장소+주소 병렬, 웹은 둘 다 0건일 때만, 섹션 실패는 SectionState.failed로 격리.
/// 좌표는 있으면 그대로 API로 전달해 서버(카카오 정확도순+근접 블렌딩)가 정렬을
/// 담당한다(정확도순 전환, 웹 스펙 2026-07-20 미러). 클라 재정렬은 하지 않는다.
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

        let places: SectionState<Place> = (await placesTask).map { .loaded($0.places) } ?? .failed
        let addresses: SectionState<JusoAddress> = (await addressTask).map { .loaded($0.addresses) } ?? .failed

        // 웹 폴백: 정본 두 트랙이 모두 빈 결과일 때만(실패도 빈 결과로 취급, 기존 의미 유지).
        var web: SectionState<WebSearchResult> = .loaded([])
        if places.items.isEmpty && addresses.items.isEmpty {
            let webResponse: WebSearchResponse? = try? await client.get("/api/search/web", query: [URLQueryItem(name: "query", value: query)])
            web = webResponse.map { .loaded($0.web) } ?? .failed
        }
        return SearchOutcome(places: places, addresses: addresses, web: web)
    }
}
