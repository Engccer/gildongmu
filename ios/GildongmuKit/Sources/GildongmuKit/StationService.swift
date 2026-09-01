import Foundation

/// 역 상세 4종 조회. 전 라우트 `GET ?station=<place.name>` 균일 계약(매칭은 서버 몫).
/// 미커버 역은 본문 null(성공 응답), 실패는 throw(APIError). 뷰는 둘 다 "섹션 미노출"로
/// 동일 처리하되(자동 등장 보조 정보의 graceful degrade) 도착 0건만 문장으로 노출.
public struct StationService: Sendable {
    let client: APIClient

    public init(client: APIClient) { self.client = client }

    private func stationQuery(_ station: String) -> [URLQueryItem] {
        [URLQueryItem(name: "station", value: station)]
    }

    /// `lang`(E27) — en이면 영문 필드(`linesEn`·도착 `*En`·`lineNameEn`)를 additive로 받는다. 비-ko만
    /// 파라미터를 실어 ko 요청은 종전과 같다. ⚠ 기본값 없음(RouteService.walk 규율).
    private func stationQuery(_ station: String, lang: String) -> [URLQueryItem] {
        var q = stationQuery(station)
        if lang != "ko" { q.append(URLQueryItem(name: "lang", value: lang)) }
        return q
    }

    public func meta(station: String, lang: String) async throws -> StationMeta? {
        let response: StationMetaResponse = try await client.get(
            "/api/station/meta", query: stationQuery(station, lang: lang))
        return response.meta
    }

    public func korailFacilities(station: String) async throws -> StationFacilities? {
        let response: StationFacilitiesResponse = try await client.get(
            "/api/station/facilities", query: stationQuery(station))
        return response.facilities
    }

    /// `lang=en`이면 음성유도기 `parts.lineEn`(영문 노선명)이 additive로 온다(E27 잔여). ⚠ 기본값 없음.
    public func metroFacilities(station: String, lang: String) async throws -> SeoulMetroFacilities? {
        let response: SeoulMetroFacilitiesResponse = try await client.get(
            "/api/station/metro-facilities", query: stationQuery(station, lang: lang))
        return response.facilities
    }

    public func arrivals(station: String, lang: String) async throws -> StationArrivals? {
        let response: StationArrivalResponse = try await client.get(
            "/api/station/subway-arrival", query: stationQuery(station, lang: lang))
        return response.arrivals
    }

    /// 첫차·막차 시간표. 미커버 역은 nil(graceful), 조회 실패는 throw
    /// (시간표는 의사결정 정보라 실패를 미커버로 위장하지 않는다, 스펙 §2-A).
    public func timetable(station: String, lang: String) async throws -> StationTimetable? {
        let response: StationTimetableResponse = try await client.get(
            "/api/station/timetable", query: stationQuery(station, lang: lang))
        return response.timetable
    }
}

/// 날씨·공기질·혼잡도 조회 `GET ?lat=&lng=`. 세 fetch는 화면(모델)에서 독립 실행
/// (한쪽 실패가 다른 쪽을 안 죽임, 웹 allSettled 미러).
public struct ConditionsService: Sendable {
    let client: APIClient

    public init(client: APIClient) { self.client = client }

    public func air(lat: Double, lng: Double) async throws -> AirQuality? {
        let response: AirNearbyResponse = try await client.get(
            "/api/air-quality/nearby", query: coordQuery(lat: lat, lng: lng))
        return response.air
    }

    public func weather(lat: Double, lng: Double) async throws -> Weather? {
        let response: WeatherNearbyResponse = try await client.get(
            "/api/weather/nearby", query: coordQuery(lat: lat, lng: lng))
        return response.weather
    }

    /// 실시간 인구 혼잡도. 본문 `area: null`은 조회 실패가 아니라 "여기는 서울 핫스팟 121곳이
    /// 아니다"라는 답이므로 nil을 그대로 돌려준다(화면은 침묵). 실패만 throw(APIError).
    public func congestion(lat: Double, lng: Double) async throws -> Congestion? {
        let response: CongestionNearbyResponse = try await client.get(
            "/api/congestion/nearby", query: coordQuery(lat: lat, lng: lng))
        return response.area
    }
}
