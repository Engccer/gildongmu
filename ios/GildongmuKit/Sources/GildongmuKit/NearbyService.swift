import Foundation

/// 내 주변 6종 조회. 전 라우트 `GET ?lat=&lng=` 균일 계약(M2 plan).
/// 실패는 throw(APIError) — 3-state(권한 거부/조회 실패/0건) 매핑은 뷰모델 몫.
public struct NearbyService: Sendable {
    let client: APIClient

    public init(client: APIClient) { self.client = client }

    private func coordQuery(lat: Double, lng: Double) -> [URLQueryItem] {
        [
            URLQueryItem(name: "lat", value: String(lat)),
            URLQueryItem(name: "lng", value: String(lng)),
        ]
    }

    public func subwayArrivals(lat: Double, lng: Double) async throws -> [NearbySubwayStation] {
        let response: SubwayNearbyResponse = try await client.get(
            "/api/station/subway-arrival/nearby", query: coordQuery(lat: lat, lng: lng))
        return response.stations
    }

    public func busStops(lat: Double, lng: Double) async throws -> [BusStop] {
        let response: BusNearbyResponse = try await client.get(
            "/api/bus/nearby", query: coordQuery(lat: lat, lng: lng))
        return response.stops
    }

    public func bikeStations(lat: Double, lng: Double) async throws -> [BikeStation] {
        let response: BikeNearbyResponse = try await client.get(
            "/api/bike/nearby", query: coordQuery(lat: lat, lng: lng))
        return response.stations
    }

    public func clinics(lat: Double, lng: Double) async throws -> [NightClinic] {
        let response: ClinicNearbyResponse = try await client.get(
            "/api/clinic/nearby", query: coordQuery(lat: lat, lng: lng))
        return response.clinics
    }

    public func kidsPlaces(lat: Double, lng: Double) async throws -> [KidsPlace] {
        let response: KidsNearbyResponse = try await client.get(
            "/api/places/kids", query: coordQuery(lat: lat, lng: lng))
        return response.kids
    }

    public func surroundings(lat: Double, lng: Double) async throws -> [SurroundingPlace] {
        let response: AroundNearbyResponse = try await client.get(
            "/api/places/around", query: coordQuery(lat: lat, lng: lng))
        return response.places
    }

    /// 노선 경유정류소(lazy 펼치기). cityCode는 source=="tago"일 때만 쿼리에 포함(웹 BusRouteStops.tsx 미러).
    public func busRouteStops(source: String, cityCode: String?, routeId: String) async throws -> [BusRouteStop] {
        var query = [
            URLQueryItem(name: "source", value: source),
            URLQueryItem(name: "routeId", value: routeId),
        ]
        if source == "tago", let cityCode {
            query.append(URLQueryItem(name: "cityCode", value: cityCode))
        }
        let response: BusRouteStopsResponse = try await client.get("/api/bus/route", query: query)
        return response.stops
    }
}
