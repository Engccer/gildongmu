import Foundation

/// "현재 위치 정위" 조회. GET /api/where-am-i?lat=&lng= envelope {data: WhereAmIData?}:
/// 키 없음→data:null(nil 반환, 死기능 아님), 네 조각 전부 비면 502(throw), 그 외 200+data.
public struct WhereAmIService: Sendable {
    let client: APIClient

    public init(client: APIClient) { self.client = client }

    public func locate(lat: Double, lng: Double) async throws -> WhereAmIData? {
        let response: WhereAmIResponse = try await client.get(
            "/api/where-am-i",
            query: [
                URLQueryItem(name: "lat", value: String(lat)),
                URLQueryItem(name: "lng", value: String(lng)),
            ])
        return response.data
    }
}
