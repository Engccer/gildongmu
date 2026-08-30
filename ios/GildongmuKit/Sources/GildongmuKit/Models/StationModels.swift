import Foundation

// 역 상세 4종 + 날씨·공기질·혼잡도 도메인 모델: 웹 `src/lib/types.ts` 미러
// (계약 정본은 웹 + Fixtures/station-*.json·air-nearby.json·weather-nearby.json prod 실캡처).
// 미커버 역·데이터 부재는 envelope 본문 null(graceful degrade, 뷰가 섹션 미노출).
// status·grade·label류 문자열은 신규 값 추가에 깨지지 않도록 String으로 둔다(기존 원칙).

// MARK: - 역 메타

/// 한 역의 메타 요약: 같은 역명의 여러 노선 레코드를 하나로 집계(웹 StationMeta 미러).
public struct StationMeta: Codable, Sendable, Hashable {
    /// 한글 역명(대표)
    public let name: String
    /// 영문 역명
    public let nameEn: String
    /// 한자 역명(있으면)
    public let nameHanja: String?
    /// 이 역명을 지나는 노선들(환승역은 여럿)
    public let lines: [String]
    /// `lines`의 영문(`lang=en`에만, E27 표 — 하나라도 미지면 배열 전체 nil)
    public let linesEn: [String]?
    /// 환승역 여부
    public let isTransfer: Bool
    /// 운영기관명. JSON 키 "operator"는 Swift 예약어라 이름만 변경
    public let operatorName: String

    enum CodingKeys: String, CodingKey {
        case name, nameEn, nameHanja, lines, linesEn, isTransfer
        case operatorName = "operator"
    }
}

public struct StationMetaResponse: Codable, Sendable {
    /// 미커버 역 null(graceful)
    public let meta: StationMeta?
}

// MARK: - 코레일 교통약자 시설

/// 철도역 교통약자 편의시설(코레일 406역, 도시철도 미포함).
/// 수 필드는 Int? 3-state: nil="정보 없음" ≠ 0="없음" ≠ n="n대". 절대 뭉개지 않는다.
public struct StationFacilities: Codable, Sendable, Hashable {
    public let stationName: String
    /// 장애인 화장실 유무
    public let accessibleToilet: Bool
    /// 휠체어 리프트 수. nil은 "정보 없음"
    public let wheelchairLifts: Int?
    /// 장애인 경사로/통로 유무
    public let accessibleSlope: Bool
    /// 엘리베이터 수. nil은 "정보 없음"
    public let elevators: Int?
}

public struct StationFacilitiesResponse: Codable, Sendable {
    public let facilities: StationFacilities?
}

// MARK: - 서울 지하철 교통약자 시설

/// 시설 인스턴스 하나(엘리베이터 1대 등). 위치·층·가동현황이 낭독 정본.
public struct SeoulMetroFacility: Codable, Sendable, Hashable {
    /// 시설명 예: "승강기)엘리베이터-강동 내부 1호기"
    public let name: String
    /// 상세 위치(없으면 nil)
    public let location: String?
    /// 층 정보(해당 없으면 nil)
    public let floors: String?
    /// 가동현황 "normal"/"stopped". 엘리베이터·에스컬레이터만, 그 외 nil
    public let operatingStatus: String?
    /// 시설별 보조 설명(화장실 종류·상행/하행 등, 없으면 nil)
    public let detail: String?
    /// 서버 합성 한국어(`name`·`detail`)의 구조화 원재료(A26, 웹 `SeoulMetroFacilityParts` 미러).
    /// 앱이 자기 언어로 조립한다(`StationSections`). 구버전 응답엔 없다 — 그때는 문자열 그대로.
    public let parts: SeoulMetroFacilityParts?
}

/// `SeoulMetroFacility.parts` — 그룹 종류별로 쓰는 필드가 다르다: voiceGuide `location`(+환승역만
/// `line`), restroom `restroomType`·`wheelchairAccessible`, elevatorLocation `compass`·`meters`·`dong`.
public struct SeoulMetroFacilityParts: Codable, Sendable, Hashable {
    public let location: String?
    /// 노선 번호(예 "5") — "호선"은 앱이 단다.
    public let line: String?
    public let restroomType: String?
    public let wheelchairAccessible: Bool?
    /// 8방위 코드 n·ne·e·se·s·sw·w·nw
    public let compass: String?
    public let meters: Int?
    public let dong: String?
}

/// 한 시설 종류의 묶음. 데이터가 있는 종류만 포함.
public struct SeoulMetroFacilityGroup: Codable, Sendable, Hashable {
    /// 종류 키(elevator·escalator·wheelchairLift·movingWalk·wheelchairCharger·
    /// safetyPlatform·signLangPhone·helper·restroom). 한국어 라벨 매핑은 뷰 몫
    public let kind: String
    public let facilities: [SeoulMetroFacility]
}

/// 한 지하철역의 교통약자 시설 전체(서울교통공사 1~8호선 + 보강 그룹 2종).
public struct SeoulMetroFacilities: Codable, Sendable, Hashable {
    public let stationName: String
    /// 호선(첫 매칭 기준, 없으면 nil)
    public let line: String?
    public let groups: [SeoulMetroFacilityGroup]
    /// 보강 소스(OA-21212 엘리베이터 위치 폴백) 실패 시 true. wksn 주 조회는 정상이었으나
    /// 보강만 실패했을 때만 표기(실패 은폐 금지, 스펙 §2-C). 구버전 서버 응답 호환을 위해 옵션.
    public let supplementFailed: Bool?
}

public struct SeoulMetroFacilitiesResponse: Codable, Sendable {
    public let facilities: SeoulMetroFacilities?
}

// MARK: - 역 실시간 도착

/// 역명 기준 실시간 도착 묶음. SubwayArrival은 NearbyModels 기존 타입 재사용.
public struct StationArrivals: Codable, Sendable, Hashable {
    public let stationName: String
    public let arrivals: [SubwayArrival]
}

public struct StationArrivalResponse: Codable, Sendable {
    public let arrivals: StationArrivals?
}

// MARK: - 역 첫차·막차 시간표

/// TAGO 지하철 노선정보에서 파생한 시간표 편성 하나(첫차 또는 막차, 웹 TimetableTrain 미러).
public struct TimetableTrain: Codable, Sendable, Hashable {
    /// 출발 시각("HH:mm" 원문 그대로. 00~02시대 심야 편성도 이 시각 그대로 표기)
    public let time: String
    /// 00~02시대 심야 편성이면 true(서비스데이 정렬 보정 표기용, 서버가 이미 산출)
    public let nextDay: Bool?
    /// 종착역명(한글)
    public let terminus: String
    /// 종착역명(영문, seed 매칭으로 병기 가능할 때만)
    public let terminusEn: String?
}

/// 한 방향(상행 또는 하행)의 첫차·막차 쌍.
public struct TimetableDirection: Codable, Sendable, Hashable {
    /// "up"/"down"(TAGO upDownTypeCode 매핑)
    public let direction: String
    public let first: TimetableTrain
    public let last: TimetableTrain
}

/// 한 노선의 시간표(환승역은 노선별로 여러 개가 배열에 담긴다). 매칭된 노선은 coverage와 무관하게 전부 실린다(A19).
public struct TimetableLine: Codable, Sendable, Hashable {
    /// 노선 표시명(예 "5호선"·"수인분당선")
    public let lineName: String
    /// "ok"/"noTrains"/"unknown"/"unavailable" — ok만 directions가 비지 않는다(웹 TimetableLineCoverage 미러).
    /// 옵셔널인 이유: 웹 배포가 앱보다 먼저라 구서버 응답엔 이 필드가 없다(그때 directions 빈 노선은 오지 않는다).
    public let coverage: String?
    public let directions: [TimetableDirection]
    /// `lineName`이 TAGO 축약명에 서버가 "선"을 덧붙인 것일 때만 그 원형(예 "수인분당", A26).
    /// 앱은 이것으로 접미를 자기 언어로 단다(`timetable.lineSuffixed`); nil이면 `lineName` 그대로.
    public let lineCore: String?
    /// 영문 노선명(`lang=en`에만, E27 표 — `lineCore` 접미 조립보다 우선). 표 미스면 nil
    public let lineNameEn: String?
}

/// 역 첫차·막차 시간표 전체(웹 StationTimetable 미러).
/// dailyType은 조회에 쓴 서비스데이 타입. 공휴일 판정 실패 시 요일 폴백은
/// partial이 아니라 dailyType 기준 라벨 명시로 정직성을 담보한다(스펙 §1-A-3).
public struct StationTimetable: Codable, Sendable, Hashable {
    public let stationName: String
    /// "weekday"/"saturday"/"sunday": 조회에 사용한 서비스데이 타입
    public let dailyType: String
    /// 일부 노선·방향 시간표 호출이 실패해 불완전한 결과면 true(무운행 위장 금지)
    public let partial: Bool?
    public let lines: [TimetableLine]
}

/// 미커버 역 null(graceful). upstream 실패는 라우트가 502로 throw(3-state, 문장 노출 몫은 뷰).
public struct StationTimetableResponse: Codable, Sendable {
    public let timetable: StationTimetable?
}

// MARK: - 공기질

/// 오염물질 하나의 측정. 등급 단어가 낭독 정본, 수치는 보강.
/// 측정 장애·부재면 value nil + grade "unknown"(값 없이도 단어는 남는다).
public struct AirPollutant: Codable, Sendable, Hashable {
    public let value: Double?
    /// "good"/"moderate"/"bad"/"veryBad"/"unknown"
    public let grade: String
}

/// 가장 가까운 측정소의 실시간 공기질(웹 AirQuality 미러).
public struct AirQuality: Codable, Sendable, Hashable {
    /// 측정소명
    public let stationName: String
    /// 현재 위치로부터 거리(km, 에어코리아 정본)
    public let distanceKm: Double
    /// 측정소 주소
    public let addr: String
    /// 측정 시각(예 "2026-07-07 07:00")
    public let dataTime: String
    /// 통합대기환경지수(KHAI)
    public let khai: AirPollutant
    /// 미세먼지(PM10)
    public let pm10: AirPollutant
    /// 초미세먼지(PM2.5)
    public let pm25: AirPollutant
}

public struct AirNearbyResponse: Codable, Sendable {
    public let air: AirQuality?
}

// MARK: - 날씨

/// 코드+라벨 쌍(하늘상태·강수형태 공용). 부재면 code nil + label "unknown".
public struct WeatherCode: Codable, Sendable, Hashable {
    public let code: Int?
    /// sky: "clear"/"partlyCloudy"/"cloudy"/"unknown",
    /// precipitation: "none"/"rain"/"rainSnow"/"snow"/"shower"/"unknown"
    public let label: String
}

/// 기상청 격자 좌표(디버그·캐시 키).
public struct WeatherGrid: Codable, Sendable, Hashable {
    public let nx: Int
    public let ny: Int
}

/// 이 지역 날씨: 초단기실황+단기예보 합성(웹 Weather 미러).
/// 상태 단어가 낭독 정본, 수치는 보강. 부분 성공 가능, 없는 값은 nil(해당 줄 생략).
public struct Weather: Codable, Sendable, Hashable {
    public let sky: WeatherCode
    public let precipitation: WeatherCode
    /// 현재기온(°C), 부재 nil
    public let tempC: Double?
    /// 일 최고기온, 부재 nil
    public let tempMax: Double?
    /// 일 최저기온, 부재 nil
    public let tempMin: Double?
    /// 습도(%), 부재 nil
    public let humidity: Double?
    /// 강수확률(%), 부재 nil
    public let precipProbability: Double?
    /// 조회 기준 시각 "HH:mm"
    public let baseTime: String
    public let grid: WeatherGrid
}

public struct WeatherNearbyResponse: Codable, Sendable {
    public let weather: Weather?
}

// MARK: - 실시간 인구 혼잡도

/// 혼잡도 등급어 → 표시 키(웹 `congestion-level.ts` 미러).
/// `citydata_ppltn`은 등급어를 **한국어로만** 준다. 닫힌 집합(4단계)이라 앱이 번역할 수 있지만,
/// 서울시가 단계를 늘리면 표에 없는 값이 온다. 그때 nil을 돌려 소비자가 **원문을 그대로**
/// 낭독하게 한다(빈 값으로 조용히 삼키지 않는다).
public enum CongestionLevelKey: String, Sendable, CaseIterable {
    case relaxed
    case normal
    case slightlyBusy
    case busy

    /// 등급어 원문에서 키를 판정. 미등재 값은 nil(원문 낭독 폴백).
    public init?(levelText raw: String) {
        switch raw.trimmingCharacters(in: .whitespacesAndNewlines) {
        case "여유": self = .relaxed
        case "보통": self = .normal
        case "약간 붐빔": self = .slightlyBusy
        case "붐빔": self = .busy
        default: return nil
        }
    }
}

/// 사용자가 서 있는 서울 핫스팟 영역의 실시간 혼잡도(웹 `CongestionAreaReading` 미러).
/// 라우트가 예보와 인구수를 걷어낸 투영이라 이 모델에도 그 필드가 없다.
/// "76,000명"은 행동으로 옮길 수 없는 수치이고 등급어가 이미 답이다.
public struct Congestion: Codable, Sendable, Hashable {
    /// 서울시 영역 코드("POI014")
    public let code: String
    /// 영역 이름("강남역"): 어디의 혼잡도인지 알리는 정본
    public let name: String
    /// 등급어 원문("붐빔"). 4단계 밖 값도 통과하므로 표시 계층이 `CongestionLevelKey`로 번역한다
    public let level: String
    /// 완성 문장(한국어 자유 텍스트). 번역 수단이 없어 ko 로케일에서만 노출한다
    public let message: String
    /// 기준 시각("2026-08-01 13:40"). 실시간 데이터의 신선도는 행동을 바꾼다
    public let asOf: String
}

public struct CongestionNearbyResponse: Codable, Sendable {
    /// null은 **오류가 아니다**: "여기는 서울시가 혼잡도를 재는 121곳이 아니다"(서울의 91%).
    /// 조회 실패는 throw(APIError)로 갈라진다.
    public let area: Congestion?
}
