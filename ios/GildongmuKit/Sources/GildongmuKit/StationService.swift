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

    public func meta(station: String) async throws -> StationMeta? {
        let response: StationMetaResponse = try await client.get(
            "/api/station/meta", query: stationQuery(station))
        return response.meta
    }

    public func korailFacilities(station: String) async throws -> StationFacilities? {
        let response: StationFacilitiesResponse = try await client.get(
            "/api/station/facilities", query: stationQuery(station))
        return response.facilities
    }

    public func metroFacilities(station: String) async throws -> SeoulMetroFacilities? {
        let response: SeoulMetroFacilitiesResponse = try await client.get(
            "/api/station/metro-facilities", query: stationQuery(station))
        return response.facilities
    }

    public func arrivals(station: String) async throws -> StationArrivals? {
        let response: StationArrivalResponse = try await client.get(
            "/api/station/subway-arrival", query: stationQuery(station))
        return response.arrivals
    }

    /// 첫차·막차 시간표. 미커버 역은 nil(graceful), 조회 실패는 throw
    /// (시간표는 의사결정 정보라 실패를 미커버로 위장하지 않는다, 스펙 §2-A).
    public func timetable(station: String) async throws -> StationTimetable? {
        let response: StationTimetableResponse = try await client.get(
            "/api/station/timetable", query: stationQuery(station))
        return response.timetable
    }
}

/// 날씨·공기질 조회 `GET ?lat=&lng=`. 두 fetch는 화면(모델)에서 독립 실행
/// (한쪽 실패가 다른 쪽을 안 죽임, 웹 allSettled 미러).
public struct ConditionsService: Sendable {
    let client: APIClient

    public init(client: APIClient) { self.client = client }

    private func coordQuery(lat: Double, lng: Double) -> [URLQueryItem] {
        [
            URLQueryItem(name: "lat", value: String(lat)),
            URLQueryItem(name: "lng", value: String(lng)),
        ]
    }

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
}
