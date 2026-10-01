import Foundation

// ── 나들이 이정표 분류(spec 2026-09-26 §6.4) ──
// 주변 낭독 세 단계 중 "이정표만"이 무엇을 말하는가를 정하는 표. 판정 축은 둘러보기 응답의
// 카테고리 **키**(`/api/places/around`의 `category`, 카카오 category_group_code의 투영) 하나다 —
// 이름 부분 문자열로 가르지 않는다. 표는 코드 상수 하나이고 실보행 판정으로 조정한다(§15).
// 나들이는 카카오 분류 18종을 받는다(E58 ②, `NearbyService.outingSurroundings`). 공원은 카카오 분류에 없어
// 대표 명소만 관광명소(`attraction`)로 온다.

public enum OutingLandmarkTier: String, Sendable, Equatable {
    /// 길을 잡는 기준점 — "이정표만" 단계에서도 말한다.
    case landmark
    /// 그 밖의 가게 — "전부" 단계에서만 말한다.
    case shop
}

/// 이정표 등급 카테고리 키(카카오 18종 중). 나머지 키와 미지 키는 전부 가게다.
public let outingLandmarkCategories: Set<String> = ["subway", "public", "hospital", "attraction", "school"]

public func outingLandmarkTier(category: String) -> OutingLandmarkTier {
    outingLandmarkCategories.contains(category) ? .landmark : .shop
}

/// 주변 낭독 세 단계(§7.2). 저장 값은 rawValue(`@AppStorage`).
public enum OutingNarration: String, Sendable, Equatable, CaseIterable {
    /// 지나침·도로명·횡단보도 문장을 내지 않는다(비프·시작·종료만).
    case off
    /// 이정표 등급만.
    case landmarks
    /// 두 등급 모두.
    case all

    public static let storageKey = "outingNarration"
    public static let `default`: OutingNarration = .all

    /// 시트 버튼을 한 번 누른 뒤의 단계(E54 순환: 전부 → 이정표만 → 끔 → 전부).
    public var next: OutingNarration {
        switch self {
        case .all: .landmarks
        case .landmarks: .off
        case .off: .all
        }
    }

    /// 이 단계에서 그 등급의 장소를 말하는가.
    public func speaks(_ tier: OutingLandmarkTier) -> Bool {
        switch self {
        case .off: false
        case .landmarks: tier == .landmark
        case .all: true
        }
    }
}
