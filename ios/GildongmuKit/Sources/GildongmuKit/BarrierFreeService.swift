import Foundation

/// 옵트인 확장 요청 — 라우트 기본 상한(8)은 limit 미지정 소비자(CLI/MCP)용,
/// "더 보기" 재료는 이 앱이 limit으로 명시 확보한다(웹 FETCH_LIMIT 미러).
private let fetchLimit = 50

/// 무장애 여행 정보 조회. `nearby`는 여느 서비스와 같이 throw(APIError) —
/// 3-state 매핑은 뷰모델 몫. `match`만 예외: 웹 계약상 실패를 전부 `{"detail":null}`로
/// 반환하는 매칭 보조 엔드포인트라, 네트워크·디코딩 오류까지 nil로 수렴시켜
/// 호출부(장소 상세)가 무음 미노출할 수 있게 한다.
/// `/api/places/barrier-free/detail` 라우트는 웹·CLI가 소비 — iOS 필요 시 재도입.
public struct BarrierFreeService: Sendable {
    let client: APIClient

    public init(client: APIClient) { self.client = client }

    public func nearby(lat: Double, lng: Double) async throws -> [BarrierFreePlace] {
        let response: BarrierFreeNearbyResponse = try await client.get(
            "/api/places/barrier-free",
            query: [
                URLQueryItem(name: "lat", value: String(lat)),
                URLQueryItem(name: "lng", value: String(lng)),
                URLQueryItem(name: "limit", value: String(fetchLimit)),
            ])
        return response.places
    }

    /// 비-throw: 네트워크 오류·디코딩 오류·`{"detail":null}` 모두 nil로 수렴(웹 match 계약).
    public func match(lat: Double, lng: Double, name: String) async -> BarrierFreeDetail? {
        let response: BarrierFreeDetailResponse? = try? await client.get(
            "/api/places/barrier-free/match",
            query: [
                URLQueryItem(name: "lat", value: String(lat)),
                URLQueryItem(name: "lng", value: String(lng)),
                URLQueryItem(name: "name", value: name),
            ])
        return response?.detail
    }
}
