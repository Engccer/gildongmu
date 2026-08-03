import Foundation

// 경로 브리핑 도메인 모델: 웹 /api/route/car·/api/route/transit·/api/route/walk 계약 미러
// (계약 정본은 Fixtures/route-car.json·route-transit.json·route-walk.json).
// 단위 함정 주의: durationSeconds=초·totalMinutes/walkMinutes/minutes=분·fare류=원.
// mode는 신규 값 추가에 깨지지 않도록 String으로 둔다(기존 원칙).

// MARK: - 자동차 경로

/// 자동차 안내 구간의 링크별 도로명·길이(B1 기하 옵트인 — 무명 링크는 name nil).
public struct CarRoadLink: Codable, Sendable, Hashable {
    public let name: String?
    public let distanceMeters: Double

    public init(name: String?, distanceMeters: Double) {
        self.name = name
        self.distanceMeters = distanceMeters
    }
}

/// 자동차 경로 안내 구간 하나. guidance(한국어 완성 안내문)가 낭독 정본,
/// 빈 문자열이면 뷰가 name으로 폴백(둘 다 비면 행 생략).
/// pathCoords·roadLinks는 `includeGeometry=1` 요청에서만 오는 B1 기하(옵셔널).
public struct CarRouteGuide: Codable, Sendable, Hashable {
    /// 지점명(교차로·시설명). 빈 문자열 실측 존재(옵셔널 아님)
    public let name: String
    /// 안내문(예 "올림픽대교 왕십리역 방면으로 우회전")
    public let guidance: String
    /// 이 구간 거리(m)
    public let distanceMeters: Int
    /// 이 구간 소요(초)
    public let durationSeconds: Int
    /// 동작 이후 구간 폴리라인(기하 옵트인 전용)
    public let pathCoords: [RoutePoint]?
    /// 링크별 도로명·길이(기하 옵트인 전용)
    public let roadLinks: [CarRoadLink]?

    public init(
        name: String, guidance: String, distanceMeters: Int, durationSeconds: Int,
        pathCoords: [RoutePoint]? = nil, roadLinks: [CarRoadLink]? = nil
    ) {
        self.name = name
        self.guidance = guidance
        self.distanceMeters = distanceMeters
        self.durationSeconds = durationSeconds
        self.pathCoords = pathCoords
        self.roadLinks = roadLinks
    }
}

/// 자동차 경로 브리핑. ⚠ /api/route/car 응답은 envelope 없이 이 타입 직접.
public struct CarRouteBriefing: Codable, Sendable, Hashable {
    /// 총 거리(m)
    public let distanceMeters: Int
    /// 총 소요(초). 밀리초 아님(NCP ms→서버가 초로 정규화, 단위 회귀 테스트 대상)
    public let durationSeconds: Int
    /// 예상 택시 요금(원)
    public let taxiFare: Int
    /// 통행료(원). 0이면 뷰가 생략
    public let tollFare: Int
    /// 턴바이턴 안내 구간들
    public let guides: [CarRouteGuide]
    /// ko 서비스 provider 판별자("tmap"/"kakao") — 자동차 안내 버튼 게이트(B1 §3.1).
    /// en(NCP) 응답·구버전 서버는 nil.
    public let provider: String?

    public init(
        distanceMeters: Int, durationSeconds: Int, taxiFare: Int, tollFare: Int,
        guides: [CarRouteGuide], provider: String? = nil
    ) {
        self.distanceMeters = distanceMeters
        self.durationSeconds = durationSeconds
        self.taxiFare = taxiFare
        self.tollFare = tollFare
        self.guides = guides
        self.provider = provider
    }
}

// MARK: - 대중교통 경로

/// 한 경로의 요약. 전부 분·원 단위(ODsay 정규화 후).
public struct TransitRouteSummary: Codable, Sendable, Hashable {
    /// 총 소요(분)
    public let totalMinutes: Int
    /// 요금(원)
    public let fare: Int
    /// 환승 횟수
    public let transfers: Int
    /// 도보 합계(분)
    public let walkMinutes: Int
    /// 출발 정류장·역명(없으면 nil)
    public let departName: String?
    /// 도착 정류장·역명(없으면 nil)
    public let arriveName: String?
}

/// 경로 구간 하나. mode "walk"/"bus"/"subway".
/// walk leg는 lineName·fromName·toName·stationCount 전부 nil(뷰의 "도보 N분" 단일 분기 근거).
public struct TransitRouteLeg: Codable, Sendable, Hashable {
    public let mode: String
    /// 노선명(예 "수도권 5호선"·"342"), walk는 nil
    public let lineName: String?
    /// 승차 지점명
    public let fromName: String?
    /// 하차 지점명
    public let toName: String?
    /// 경유 역·정류장 수
    public let stationCount: Int?
    /// 이 구간 소요(분)
    public let minutes: Int
    /// 운행 시간 판정("running"·"outside"·"unknown"). 버스만, 그 외 nil
    public let serviceStatus: String?
    /// 첫차 시각 "04:00"(판정된 경우만)
    public let firstServiceTime: String?
    /// 막차 시각 "22:30"(판정된 경우만)
    public let lastServiceTime: String?
}

/// 대중교통 경로 하나(요약 + 구간들).
public struct TransitRoute: Codable, Sendable, Hashable {
    public let summary: TransitRouteSummary
    public let legs: [TransitRouteLeg]
}

/// 추천 1건 + 대안들. 대안은 뷰가 요약만 표시(미니멀).
public struct TransitRouteResult: Codable, Sendable, Hashable {
    public let recommended: TransitRoute
    public let alternatives: [TransitRoute]
}

/// /api/route/transit envelope(자동차와 달리 result로 감싼다). ⚠ result는 optional.
/// null은 ODsay 경로 없음(graceful, 3-state: 조회 실패 아님, walk envelope와 동형).
public struct TransitRouteEnvelope: Codable, Sendable {
    public let result: TransitRouteResult?
}

// MARK: - 도보 경로

/// 도보 안내 단계 하나. description이 낭독 정본(완성 문장, 예 "천호대로를 따라 119m 이동").
/// distanceMeters는 optional — 현재 서버가 미전송(웹 계약상 옵셔널 필드).
/// pathCoords는 `includeGeometry=1` 요청에서만 오는 스텝 폴리라인(실시간 상세 안내용).
/// 미요청 응답엔 없으므로 옵셔널이고, 요청해도 스텝별로 빠질 수 있다.
public struct WalkRouteStep: Codable, Sendable, Hashable {
    public let description: String
    public let distanceMeters: Int?
    public let pathCoords: [RoutePoint]?
}

/// 도보 경로 브리핑(자동차 CarRouteBriefing과 동형, 지도 없이 완결되는 텍스트 정본).
public struct WalkRouteBriefing: Codable, Sendable, Hashable {
    /// 총 거리(m)
    public let distanceMeters: Int
    /// 총 소요(초)
    public let durationSeconds: Int
    /// 안내 단계들
    public let steps: [WalkRouteStep]
}

/// /api/route/walk envelope. ⚠ transit과 달리 result가 optional —
/// null은 "경로 없음"(3-state: 조회 실패 아님, throw 대상 아님).
public struct WalkRouteEnvelope: Codable, Sendable {
    public let result: WalkRouteBriefing?
}
