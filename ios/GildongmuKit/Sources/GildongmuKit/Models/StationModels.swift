import Foundation

// 역 상세 4종 + 날씨·공기질 도메인 모델: 웹 `src/lib/types.ts` 미러
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
    /// 환승역 여부
    public let isTransfer: Bool
    /// 운영기관명. JSON 키 "operator"는 Swift 예약어라 이름만 변경
    public let operatorName: String

    enum CodingKeys: String, CodingKey {
        case name, nameEn, nameHanja, lines, isTransfer
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
}

/// 한 시설 종류의 묶음. 데이터가 있는 종류만 포함.
public struct SeoulMetroFacilityGroup: Codable, Sendable, Hashable {
    /// 종류 키(elevator·escalator·wheelchairLift·movingWalk·wheelchairCharger·
    /// safetyPlatform·signLangPhone·helper·restroom). 한국어 라벨 매핑은 뷰 몫
    public let kind: String
    public let facilities: [SeoulMetroFacility]
}

/// 한 지하철역의 교통약자 시설 전체(서울교통공사 1~8호선).
public struct SeoulMetroFacilities: Codable, Sendable, Hashable {
    public let stationName: String
    /// 호선(첫 매칭 기준, 없으면 nil)
    public let line: String?
    public let groups: [SeoulMetroFacilityGroup]
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
