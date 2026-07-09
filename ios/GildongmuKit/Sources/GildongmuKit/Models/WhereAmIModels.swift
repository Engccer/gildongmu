import Foundation

// "현재 위치 정위"(where-am-i) 계약 모델 — 웹 `src/lib/types.ts`의 WhereAmI 미러.
// GET /api/where-am-i envelope: 키 없음→{data:null}, 네 조각 전부 비면 502(throw), 그 외 200+data.

/// 주소 한 조각. road/jibun 둘 다 없으면 상위 address 자체가 nil(라우트 계약).
public struct WhereAmIAddress: Codable, Sendable, Hashable {
    public let road: String?
    public let jibun: String?
}

/// 가장 가까운 도시철도역(1km 내). bearing은 8방위 소문자(SurroundingPlace와 동형).
public struct WhereAmIStation: Codable, Sendable, Hashable {
    public let name: String
    public let line: String?
    public let bearing: String
    public let distanceMeters: Int
}

/// "현재 위치 정위" 조립 결과 — 주소·행정동·근접역·주변 기준점 네 조각.
public struct WhereAmIData: Codable, Sendable {
    public let address: WhereAmIAddress?
    public let region: String?
    public let nearestStation: WhereAmIStation?
    /// 주변 기준점(거리순). cap은 라우트가 아니라 buildLocationNarrativeKo가 적용.
    public let landmarks: [SurroundingPlace]
}

public struct WhereAmIResponse: Codable, Sendable {
    public let data: WhereAmIData?
}
