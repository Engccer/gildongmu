import Foundation

// 내 주변 6종 도메인 모델 — 웹 `src/lib/types.ts` 미러(계약 정본은 웹 + Fixtures/*-nearby.json).
// distanceMeters는 전 라우트가 정수(m)로 반올림해 내려준다(Haversine·카카오 정본 공통).
// status·kind류 문자열은 신규 값 추가에 깨지지 않도록 String으로 둔다(SearchModels provider와 동일 원칙).

// MARK: - 지하철 도착

/// 한 역에 도착 예정인 열차 하나. 낭독 정본은 완성 문장 `message`(arvlMsg2) —
/// arrivalSeconds를 슬롯형으로 환산하면 운행종료에도 비0이라 오발화(웹 계약).
public struct SubwayArrival: Codable, Sendable, Hashable {
    /// 호선명(subwayId 코드 매핑, 미매핑 코드면 nil)
    public let line: String?
    /// 상/하행 또는 내/외선
    public let direction: String
    /// 행선 안내 완성 문구("{종착역}행 - {주요경유}방면") — 종착 낭독 정본
    public let trainLineNm: String
    /// 종착역명(trainLineNm에 포함되나 정합·필터용 보조)
    public let destination: String
    /// 도착 메시지(완성 문장, 낭독 정본. 예 "곧 도착"·"전역 출발")
    public let message: String
    /// 현재 위치(arvlMsg3, 없을 수 있음)
    public let currentLocation: String?
    /// 도착 예정(초). 0이면 진입/도착
    public let arrivalSeconds: Int
    /// 급행 여부 — 텍스트로 흡수해 표시
    public let express: Bool
}

/// 내 주변 지하철역 + 실시간 도착 묶음.
public struct NearbySubwayStation: Codable, Sendable, Hashable {
    /// 역명("역" 접미사 제거)
    public let stationName: String
    /// 영문 역명(seed 메타, 없을 수 있음)
    public let nameEn: String?
    /// 이 역을 지나는 노선들(환승역은 여럿)
    public let lines: [String]
    public let distanceMeters: Int
    /// "ok"(arrivals 정본, 0건=정상적 열차 없음) / "unavailable"(조회 실패 — "열차 없음"과 절대 뭉개지 않음)
    public let arrivalStatus: String
    public let arrivals: [SubwayArrival]
}

public struct SubwayNearbyResponse: Codable, Sendable {
    public let stations: [NearbySubwayStation]
}

// MARK: - 버스 도착

/// 정류소에 도착 예정인 버스 하나.
public struct BusArrival: Codable, Sendable, Hashable {
    public let routeId: String
    /// 노선번호(예 "272")
    public let routeNo: String
    /// 노선유형(한글, 예 "간선버스")
    public let routeType: String
    public let arrivalSeconds: Int
    /// 남은 정류장 수
    public let prevStationCount: Int
    /// 저상버스 여부 — 교통약자 정본, 텍스트로 흡수해 표시
    public let lowFloor: Bool
    /// 완성 도착 문장(낭독 정본). 서울 TOPIS만 채움(arrmsg1) — TAGO는 nil이라 슬롯 조합 렌더
    public let arrivalMessage: String?
    /// 제공자("tago"/"seoul")
    public let source: String
}

/// 내 주변 버스 정류소 + 도착 묶음.
public struct BusStop: Codable, Sendable, Hashable {
    public let nodeId: String
    public let cityCode: String
    /// 정류소명(한글)
    public let name: String
    /// 정류소 표지판 번호(없을 수 있음)
    public let stopNo: String?
    public let lat: Double
    public let lng: Double
    public let distanceMeters: Int
    /// 제공자("tago"/"seoul")
    public let source: String
    /// "ok" / "unavailable" — 지하철과 동형 3-state
    public let arrivalStatus: String
    public let arrivals: [BusArrival]
}

public struct BusNearbyResponse: Codable, Sendable {
    public let stops: [BusStop]
}

// MARK: - 따릉이

/// 따릉이 대여소 하나. 정수 필드라 "0대"와 "정보 없음"의 구조적 혼동 없음.
public struct BikeStation: Codable, Sendable, Hashable {
    /// 대여소 ID(예 "ST-2749")
    public let stationId: String
    /// 대여소명(번호 접두 포함 원문)
    public let name: String
    public let lat: Double
    public let lng: Double
    public let distanceMeters: Int
    /// 거치대 총수
    public let racksTotal: Int
    /// 대여 가능 자전거 수
    public let bikesAvailable: Int
}

public struct BikeNearbyResponse: Codable, Sendable {
    public let stations: [BikeStation]
}

// MARK: - 소아 야간진료

/// 진료시간 한 칸 — HHMM 정수(예 1800, 2400=자정). 그 요일 정보가 없으면 둘 다 nil(=마감 아님, "정보 없음").
public struct ClinicHours: Codable, Sendable, Hashable {
    public let start: Int?
    public let end: Int?
}

/// 소아 야간진료 기관 하나. openStatus는 라우트가 요청 시점 KST로 덧붙이는 필드.
public struct NightClinic: Codable, Sendable, Identifiable, Hashable {
    /// 진료 상태 3-state — "정보 없음(unknown)"과 "마감(closed)"을 뭉개지 않는다.
    public struct OpenStatus: Codable, Sendable, Hashable {
        /// "open" / "closed" / "unknown"
        public let state: String
        /// 그 요일 진료 시작/종료 HHMM(없으면 nil)
        public let start: Int?
        public let end: Int?
    }

    /// 기관 ID(hpid)
    public let id: String
    public let name: String
    public let address: String
    /// 대표 전화 — 없으면 ""
    public let phone: String
    /// 기관 종별(예 "의원"/"병원")
    public let kind: String
    /// 응급의료기관 분류명
    public let emergencyClass: String
    /// 찾아오는 길 안내 — 없으면 ""
    public let directions: String
    public let lat: Double
    public let lng: Double
    public let distanceMeters: Int
    /// 월~일·공휴일 진료시간(8칸)
    public let hours: [ClinicHours]
    /// 현재 진료 상태(라우트 계산)
    public let openStatus: OpenStatus
}

public struct ClinicNearbyResponse: Codable, Sendable {
    public let clinics: [NightClinic]
}

// MARK: - 아이 놀 곳

/// 아이 놀 곳 하나(카카오 화이트리스트 정규화).
public struct KidsPlace: Codable, Sendable, Identifiable, Hashable {
    /// 카카오 장소 id("kakao-" 접두)
    public let id: String
    public let name: String
    /// 카카오 category_name 전체 계층
    public let category: String
    /// "kidscafe" / "playground" / "playcenter" / "park"
    public let kind: String
    /// "indoor" / "outdoor" / "unknown" — 3-state, unknown도 문장으로 표시
    public let indoorOutdoor: String
    public let distanceMeters: Int
    public let address: String
    public let roadAddress: String?
    public let lat: Double
    public let lng: Double
    public let phone: String?
    /// 카카오맵 상세 페이지
    public let link: String?
}

public struct KidsNearbyResponse: Codable, Sendable {
    public let kids: [KidsPlace]
}

// MARK: - 둘러보기

/// 둘러보기 장소 하나. bearing은 북 기준 절대 8방위 — heading 없는 기기라 정면-상대 방향 금지(웹 계약).
public struct SurroundingPlace: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    /// 카테고리 키(10종: convenience·subway·restaurant·cafe·bank·pharmacy·hospital·mart·public·attraction)
    public let category: String
    /// 카카오 category_name 전체 계층(보조 표시)
    public let categoryRaw: String
    public let distanceMeters: Int
    /// 8방위 소문자("n"·"ne"·"e"·"se"·"s"·"sw"·"w"·"nw") — fixture 실측
    public let bearing: String
    public let lat: Double
    public let lng: Double
    public let phone: String?
    public let link: String?
}

public struct AroundNearbyResponse: Codable, Sendable {
    public let places: [SurroundingPlace]
}
