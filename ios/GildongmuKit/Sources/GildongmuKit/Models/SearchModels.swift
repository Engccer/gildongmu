import Foundation

/// 장소 하나. 웹 `src/lib/types.ts` Place의 미러(계약 정본은 웹).
public struct Place: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    /// 이름 로마자(서버 `romanize.ts`, E28). 한글 이름에만 실린다 — 비-ko는 `bilingualName`으로 병기.
    public var nameRoman: String? = nil
    public let category: String
    /// 분류 경로의 영문(서버 `kakao-category.ts`, A28). 세그먼트 전부 등재일 때만 실린다 —
    /// 비-ko 표시는 `pickCategory`가 부재를 원문으로 폴백. 판정(`isStation`·칩 버킷)은 `category`만.
    public var categoryEn: String? = nil
    public let address: String
    public let roadAddress: String
    public let englishAddress: String?
    public let lat: Double
    public let lng: Double
    public let phone: String?
    public let link: String?
    public let distanceMeters: Double?
}

/// 장소 검색 정렬 축(웹 `PlaceSort` 미러). review = 네이버 리뷰 개수순 단독
/// (값 없음·최대 5건·좌표 무시, spec 2026-08-17-naver-review-sort).
public enum PlaceSort: String, Sendable, Codable {
    case accuracy
    case review
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

/// `/api/geocode/reverse` 응답 envelope. address는 매칭 없으면 null
/// (3-state: 정보 없음 — 조회 실패는 HTTP 오류로 throw된다).
public struct ReverseGeocodeResponse: Codable, Sendable {
    public let address: String?
    /// `lang=en` 요청에서만: juso 공식 영문 주소. 없으면 `addressRoman`(규칙 로마자)이 폴백이다(E28).
    public var addressEn: String? = nil
    public var addressRoman: String? = nil
    /// 비-ko 1순위 표시 후보(공식 영문 → 로마자). ko 요청은 nil.
    public var english: String? { addressEn ?? addressRoman }
}

/// 라우트 오류 응답 `{ "error": "..." }`.
public struct APIErrorBody: Codable, Sendable {
    public let error: String
}
