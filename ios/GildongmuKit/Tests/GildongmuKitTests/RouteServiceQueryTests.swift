import Testing
import Foundation
@testable import GildongmuKit

// StubURLProtocol.handler 공유 상태를 쓰므로 StubNetworkTests 직렬 스위트에 편입.
// 도보 계단 회피(웹 `?accessible=true` 계약) 쿼리 미러: 켜면 accessible=true를 명시하고,
// 기본값(false)이면 파라미터 자체를 생략해 기존 요청과 byte-identical이어야 한다
// (서버 zod가 "true"/"false" 외 값을 400으로 거부 — 조용한 강등 금지 계약).
extension StubNetworkTests {
    @Test func walkAccessibleRequestsAccessibleTrue() async throws {
        var capturedQuery: [URLQueryItem]?
        StubURLProtocol.handler = { request in
            capturedQuery = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems
            return (200, Data(#"{"result":null}"#.utf8))
        }
        _ = try await RouteService(client: stubbedClient()).walk(
            originLat: 37.5, originLng: 127.0, destLat: 37.6, destLng: 127.1, accessible: true)
        #expect(capturedQuery?.contains(where: { $0.name == "accessible" && $0.value == "true" }) == true)
    }

    /// 대조: 기본 모드는 accessible 파라미터를 보내지 않는다(기존 요청 byte-identical).
    @Test func walkDefaultOmitsAccessibleParam() async throws {
        var capturedQuery: [URLQueryItem]?
        StubURLProtocol.handler = { request in
            capturedQuery = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems
            return (200, Data(#"{"result":null}"#.utf8))
        }
        _ = try await RouteService(client: stubbedClient()).walk(
            originLat: 37.5, originLng: 127.0, destLat: 37.6, destLng: 127.1, accessible: false)
        #expect(capturedQuery?.contains(where: { $0.name == "accessible" }) == false)
    }

    /// 실시간 상세 안내용 기하 옵트인(웹 `?includeGeometry=1` 계약).
    /// 서버가 "1"만 허용하고 그 외 값은 400이므로 문자열 그대로 보낸다.
    @Test func walkIncludeGeometryRequestsFlagOne() async throws {
        var capturedQuery: [URLQueryItem]?
        StubURLProtocol.handler = { request in
            capturedQuery = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems
            return (200, Data(#"{"result":null}"#.utf8))
        }
        _ = try await RouteService(client: stubbedClient()).walk(
            originLat: 37.5, originLng: 127.0, destLat: 37.6, destLng: 127.1,
            accessible: false, includeGeometry: true)
        #expect(capturedQuery?.contains(where: { $0.name == "includeGeometry" && $0.value == "1" }) == true)
    }

    /// 대조: 기본값은 파라미터 자체를 생략한다(기존 요청 byte-identical, accessible 동형).
    @Test func walkDefaultOmitsIncludeGeometryParam() async throws {
        var capturedQuery: [URLQueryItem]?
        StubURLProtocol.handler = { request in
            capturedQuery = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems
            return (200, Data(#"{"result":null}"#.utf8))
        }
        _ = try await RouteService(client: stubbedClient()).walk(
            originLat: 37.5, originLng: 127.0, destLat: 37.6, destLng: 127.1, accessible: false)
        #expect(capturedQuery?.contains(where: { $0.name == "includeGeometry" }) == false)
    }
}
