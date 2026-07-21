import Foundation

/// 자동차·대중교통·도보 경로 조회 `GET ?origin=lat,lng&dest=lat,lng`.
/// 출발지 불변식: origin은 호출자(화면)가 LocationService 좌표로 채운다.
/// 장소 좌표로 origin을 덮지 않는다(dest만 place, 웹 장소 앵커 불변식).
/// ⚠ car 응답은 envelope 없이 CarRouteBriefing 직접, transit·walk는 result envelope
/// (단 walk는 result가 optional — null은 "경로 없음"). 키 없음(404)은 여느 라우트와
/// 동형으로 APIError.badStatus로 그대로 전파(Kit 계층에서 흡수하지 않음).
public struct RouteService: Sendable {
    let client: APIClient

    public init(client: APIClient) { self.client = client }

    /// "lat,lng" 좌표 문자열 합성(웹 라우트 파라미터 계약)
    private func coordPair(_ lat: Double, _ lng: Double) -> String {
        "\(lat),\(lng)"
    }

    public func car(
        originLat: Double, originLng: Double,
        destLat: Double, destLng: Double,
        lang: String? = nil
    ) async throws -> CarRouteBriefing {
        var query = [
            URLQueryItem(name: "origin", value: coordPair(originLat, originLng)),
            URLQueryItem(name: "dest", value: coordPair(destLat, destLng)),
        ]
        if let lang { query.append(URLQueryItem(name: "lang", value: lang)) }
        return try await client.get("/api/route/car", query: query)
    }

    public func transit(
        originLat: Double, originLng: Double,
        destLat: Double, destLng: Double
    ) async throws -> TransitRouteResult {
        let envelope: TransitRouteEnvelope = try await client.get(
            "/api/route/transit",
            query: [
                URLQueryItem(name: "origin", value: coordPair(originLat, originLng)),
                URLQueryItem(name: "dest", value: coordPair(destLat, destLng)),
            ])
        return envelope.result
    }

    /// nil = 경로 없음(3-state, throw 아님). 키 없음(404)·조회 실패(502)는 여느 라우트와
    /// 동형으로 throw.
    public func walk(
        originLat: Double, originLng: Double,
        destLat: Double, destLng: Double
    ) async throws -> WalkRouteBriefing? {
        let envelope: WalkRouteEnvelope = try await client.get(
            "/api/route/walk",
            query: [
                URLQueryItem(name: "origin", value: coordPair(originLat, originLng)),
                URLQueryItem(name: "dest", value: coordPair(destLat, destLng)),
            ])
        return envelope.result
    }
}
