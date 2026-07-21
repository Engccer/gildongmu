import Foundation

/// 장소 하나. 웹 `src/lib/types.ts` Place의 미러(계약 정본은 웹).
public struct Place: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let category: String
    public let address: String
    public let roadAddress: String
    public let englishAddress: String?
    public let lat: Double
    public let lng: Double
    public let phone: String?
    public let link: String?
    public let distanceMeters: Double?
}

/// 장소 검색 응답 envelope(`/api/places`).
/// provider는 웹에서 열거형이지만 신규 provider 추가에 깨지지 않도록 String으로 둔다.
public struct PlaceSearchResult: Codable, Sendable {
    public let places: [Place]
    public let provider: String
    public let query: String
}

/// 행안부 도로명주소(juso) 정규화 결과. 웹 JusoAddress 미러.
public struct JusoAddress: Codable, Sendable, Hashable {
    public let roadAddr: String
    public let roadAddrPart1: String
    public let jibunAddr: String
    public let engAddr: String
    public let zipNo: String
    public let bdNm: String
}

public struct AddressSearchResponse: Codable, Sendable {
    public let addresses: [JusoAddress]
    public let query: String
}

/// Perplexity 웹 검색 결과. 웹 WebSearchResult 미러.
public struct WebSearchResult: Codable, Sendable, Hashable {
    public let title: String
    public let url: String
    public let snippet: String
    public let date: String?
}

public struct WebSearchResponse: Codable, Sendable {
    public let web: [WebSearchResult]
}

/// 주소 지오코딩 결과 하나. 웹 AddressMatch 미러(도로명/지번은 존재하는 것만 채워진다).
public struct AddressMatch: Codable, Sendable, Hashable {
    public let addressName: String
    public let roadAddress: String?
    public let jibunAddress: String?
    public let postalCode: String?
    public let lat: Double
    public let lng: Double
}

/// `/api/geocode` 응답 envelope.
public struct GeocodeResponse: Codable, Sendable {
    public let matches: [AddressMatch]
    public let query: String
}

/// 라우트 오류 응답 `{ "error": "..." }`.
public struct APIErrorBody: Codable, Sendable {
    public let error: String
}
