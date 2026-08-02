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
    /// 넷을 뭉개지 않는다 — "ok"(arrivals 정본, 0건=정상적 열차 없음) /
    /// "unavailable"(조회 실패) / "closed"(운행 시간 밖 확정, firstTime 동반) /
    /// "unknown"(실시간 미제공 역이거나 판정 불가).
    public let arrivalStatus: String
    public let arrivals: [SubwayArrival]
    /// 다음 첫차 "HH:MM"(closed일 때만). 서버가 그 역 시간표로 판정한 값이다.
    public let firstTime: String?
}

/// 조회 반경 안에 역이 0건일 때만 실리는 최근접 역 1곳.
/// 반경 밖이므로 "그 자리에서 탈 수 있다"는 뜻이 아니라, 거리를 보고
/// "걸어갈 만한가 / 이 지역엔 도시철도가 없는가"를 사용자가 판단하기 위한 정보다.
public struct NearestSubwayStation: Codable, Sendable, Hashable {
    public let stationName: String
    public let nameEn: String?
    public let lines: [String]
    public let distanceMeters: Int
}

public struct SubwayNearbyResponse: Codable, Sendable {
    public let stations: [NearbySubwayStation]
    /// 0건일 때만 서버가 싣는다(결과가 있으면 잉여라 부재).
    public let nearest: NearestSubwayStation?
}

/// 화면 payload — 목록과 "0건일 때의 최근접 역"을 함께 옮긴다.
/// 배열만 옮기면 0건 안내에 쓸 정보가 상태 머신을 통과하지 못한다.
public struct SubwayNearbyResult: Sendable {
    public let stations: [NearbySubwayStation]
    public let nearest: NearestSubwayStation?

    public init(stations: [NearbySubwayStation], nearest: NearestSubwayStation?) {
        self.stations = stations
        self.nearest = nearest
    }
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
    /// "ok" / "unavailable" 2-state — 지하철과 달리 시간표 조인이 없어 운행 시간
    /// 밖을 가려내지 못한다(버스는 실시간이 빈 것과 운행 종료를 구분할 소스가 없다).
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
    /// 달빛어린이병원 지정 여부 — 지정 명부 true, 일반 소아과 보완 소스 false.
    /// 커버리지 확장(2026-07-26)으로 두 소스가 섞이면서 품질 보증 유무가 정보가 됐다.
    /// 구버전 응답 호환을 위해 optional(부재 = 구분 정보 없음).
    public let designated: Bool?
}

public struct ClinicNearbyResponse: Codable, Sendable {
    public let clinics: [NightClinic]
    /// 병합 후 전체 수(절단 전) — "N곳 중 M곳" 표기용. 구버전 응답은 nil.
    public let total: Int?
    /// 지정 명부(달빛) 분 — radiusMeters 내.
    public let designatedTotal: Int?
    /// 보완 소스(일반 소아청소년과) 분 — supplementRadiusMeters 내.
    public let supplementTotal: Int?
    public let radiusMeters: Int?
    public let supplementRadiusMeters: Int?
    /// 진료시간 판정 축("holiday"/"weekday") — 어느 기준으로 읽었는지 UI가 밝힌다.
    public let basis: String?
    /// 보완 소스 조회 실패 — 지정 기관만 표시 중임을 밝힌다(은폐 금지).
    public let supplementFailed: Bool?
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

// MARK: - 버스 노선 경유 정류소

/// 노선 경유 정류소 하나(도착 항목 lazy 펼치기 전용). 거의 불변 데이터라 서버가 하루 캐시(웹 계약).
public struct BusRouteStop: Codable, Sendable, Hashable {
    public let nodeId: String
    public let name: String
    /// 정류소 순번(nodeord) — 오름차순
    public let order: Int
    public let lat: Double
    public let lng: Double
}

public struct BusRouteStopsResponse: Codable, Sendable {
    public let stops: [BusRouteStop]
}

// MARK: - 문화행사

/// 근처 문화행사 하나(서울 `culturalEventInfo` 슬림 투영, 웹 CultureEvent 미러).
/// 오늘 진행 중인 것만 서버가 판정해 내려주므로 앱에서 날짜를 다시 해석하지 않는다.
public struct CultureEvent: Codable, Sendable, Identifiable, Hashable {
    /// HMPG_ADDR의 cultcode("seoul-" 접두) 또는 제목|장소|시작일 복합키
    public let id: String
    public let title: String
    /// "전시/미술"·"교육/체험"·"콘서트" 등
    public let category: String
    public let place: String
    /// 자치구
    public let district: String
    /// 원본 완성 표기("2026-06-04~2026-08-23") — 재조합 금지
    public let dateText: String
    /// "19:30"·"10:00 ~ 18:00 (월요일 휴관)" 등 자유텍스트
    public let timeText: String
    public let isFree: Bool
    /// 유료일 때만 존재하는 요금 원문
    public let fee: String?
    /// "누구나"·"24개월이상 관람가능" 등 자유텍스트
    public let target: String
    /// 상세·예매 페이지 — 유일한 후속 행동
    public let link: String?
    public let lat: Double
    public let lng: Double
    public let distanceMeters: Int
}

public struct EventsNearbyResponse: Codable, Sendable {
    public let events: [CultureEvent]
    /// 반경 내 절단 전 전체 수
    public let total: Int
}
