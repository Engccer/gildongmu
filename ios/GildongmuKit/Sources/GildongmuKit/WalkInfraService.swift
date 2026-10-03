import Foundation

/// 내 주변 보행 인프라 조회. GET /api/walk/nearby?lat=&lng= → {walk: WalkInfrastructure}.
/// 게이트 없음(음향신호기=무인증 seed, OSM=무키 공개 인스턴스)이라 항상 노출 가능.
/// 한 소스만 실패해도 200 부분 결과(SourceStatus로 보존), 両소스 전멸만 503(throw).
/// 커버리지 마커 없음(웹 라우트 동형 — OSM은 전 세계, 음향신호기는 unsupported로 자기 표기).
public struct WalkInfraService: Sendable {
    let client: APIClient

    public init(client: APIClient) { self.client = client }

    public func nearby(lat: Double, lng: Double) async throws -> WalkInfrastructure {
        let envelope: WalkInfraEnvelope = try await client.get(
            "/api/walk/nearby", query: coordQuery(lat: lat, lng: lng))
        return envelope.walk
    }
}
