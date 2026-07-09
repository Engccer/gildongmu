import Foundation

// 무장애 여행 정보 도메인 모델 — 웹 `src/lib/types.ts` BarrierFreePlace·BarrierFreeDetail 미러
// (계약 정본은 웹 + Fixtures/barrier-free-*.json). 한국관광공사 KorWithService2 정규화 결과.

/// 무장애 여행 관광지 하나 — 좌표기반 검색(locationBasedList2) 결과 + 계산 거리.
public struct BarrierFreePlace: Codable, Sendable, Identifiable, Hashable {
    public var id: String { contentId }

    public let contentId: String
    public let name: String
    /// contenttypeid 라벨(빈 문자열 허용 — Task 1 비범위)
    public let category: String
    public let address: String
    public let lat: Double
    public let lng: Double
    /// 출발 좌표로부터 Haversine 거리(m, 반올림)
    public let distanceMeters: Int
}

/// 무장애 편의시설 항목 하나 — 화이트리스트 키·한글 라벨·서술형 값.
/// 값이 비어있지 않은 것만 포함된다(3-state 중 "값 있음"만).
public struct BarrierFreeFacility: Codable, Sendable, Hashable {
    /// 원본 필드 키(예: "wheelchair")
    public let key: String
    /// 한글 라벨(예: "휠체어 대여")
    public let label: String
    /// 서술형 텍스트(비어있지 않음)
    public let value: String
}

/// 무장애 여행 편의시설 상세 — KorWithService2 detailWithTour2 정규화.
/// facilities는 값이 있는 화이트리스트 항목만 담는다(빈 배열 가능).
public struct BarrierFreeDetail: Codable, Sendable, Hashable {
    public let contentId: String
    public let name: String
    public let facilities: [BarrierFreeFacility]
}

/// `/api/places/barrier-free` 응답 envelope.
public struct BarrierFreeNearbyResponse: Codable, Sendable {
    public let places: [BarrierFreePlace]
}

/// `/api/places/barrier-free/detail`·`/match` 공용 응답 envelope.
/// 둘 다 실패·미커버를 `{"detail":null}`로 표현한다(throw 아님, 웹 계약).
public struct BarrierFreeDetailResponse: Codable, Sendable {
    public let detail: BarrierFreeDetail?
}
