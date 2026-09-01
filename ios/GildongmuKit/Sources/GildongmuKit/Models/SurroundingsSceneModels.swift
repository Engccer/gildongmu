import Foundation

// M1 도착지 부근 상황 재구성 — 서버 `/api/surroundings/scene` 응답 1:1 미러
// (웹 `src/lib/surroundings-scene.ts` Scene). 좌우·맞은편 계산은 전부 서버에
// 있고 앱은 소비만 한다(iOS 이식 착수 노트 2026-08-10: 계산 미러 불필요).

/// 장소 한 줄 재료. 한 줄 조립(거리+이름+길 단서)은 뷰가 i18n 템플릿으로 한다.
public struct SurroundingsSceneItem: Codable, Sendable, Hashable {
    public let name: String
    /// 이름 로마자(E28)
    public let nameRoman: String?
    public let distanceMeters: Int
    /// 앵커와 다른 도로일 때만 서버가 채운다(같은 도로면 잉여라 null).
    public let road: String?
    /// `road`의 로마자(주소 규칙, E28 후속) — 비-ko 장면 문장이 도로명 자리에 쓴다.
    public var roadRoman: String? = nil
    public let category: String
    // 장소 상세 진입 재료(M4 판정 ⑤, 2026-08-22) — `sceneItemToPlace`가 `Place`로 투영한다.
    public let id: String
    public let lat: Double
    public let lng: Double
    /// 카카오 category_name 전체 계층(상세의 역 판별에 필요).
    public let categoryRaw: String
    /// `categoryRaw`의 영문 경로(A28, 전부 등재일 때만)
    public let categoryEn: String?
    public let roadAddress: String?
    public let phone: String?
    public let link: String?

    public init(name: String, nameRoman: String? = nil, distanceMeters: Int, road: String?, category: String,
                id: String, lat: Double, lng: Double, categoryRaw: String, categoryEn: String? = nil,
                roadAddress: String?, phone: String?, link: String?) {
        self.name = name; self.nameRoman = nameRoman; self.distanceMeters = distanceMeters; self.road = road; self.category = category
        self.id = id; self.lat = lat; self.lng = lng; self.categoryRaw = categoryRaw; self.categoryEn = categoryEn
        self.roadAddress = roadAddress; self.phone = phone; self.link = link
    }
}

/// 묶음 하나. bucket은 frame에 따라 left|right|across|beyond 또는 8방위(n·ne·…).
/// 신규 값 추가에 깨지지 않도록 String(NearbyModels 원칙).
public struct SurroundingsSceneGroup: Codable, Sendable, Hashable {
    public let bucket: String
    public let items: [SurroundingsSceneItem]
}

public struct SurroundingsScene: Codable, Sendable {
    /// 위치 확인 문장 재료(행정동 + 도로명주소). 못 얻으면 null.
    public let place: String?
    /// `place`의 로마자(주소 규칙, E28).
    public var placeRoman: String? = nil
    /// "entrance" = 입구 기준 좌우, "compass" = 절대 방위 폴백(3-state).
    public let frame: String
    public let groups: [SurroundingsSceneGroup]
    public let total: Int
}

public struct SurroundingsSceneResponse: Codable, Sendable {
    /// null = 서버 키 미보유(게이트). 소비자가 구성 결함으로 다룬다(빈 결과로 위장 금지).
    public let data: SurroundingsScene?
}
