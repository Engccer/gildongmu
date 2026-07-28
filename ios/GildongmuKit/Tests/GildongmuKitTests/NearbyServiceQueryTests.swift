import Testing
import Foundation
@testable import GildongmuKit

// StubURLProtocol.handler 공유 상태를 쓰므로 StubNetworkTests 직렬 스위트에 편입.
// "더 보기" 단계 공개(웹 계약 미러): kidsPlaces·surroundings·BarrierFreeService.nearby는
// limit=50을 옵트인 명시 요청해야 하고, 비대상 메서드(clinics)는 오염되지 않아야 한다.
extension StubNetworkTests {
    @Test func kidsPlacesRequestsFetchLimit() async throws {
        var capturedQuery: [URLQueryItem]?
        StubURLProtocol.handler = { request in
            capturedQuery = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems
            return (200, Data(#"{"kids":[]}"#.utf8))
        }
        _ = try await NearbyService(client: stubbedClient()).kidsPlaces(lat: 37.5, lng: 127.0)
        #expect(capturedQuery?.contains(where: { $0.name == "limit" && $0.value == "50" }) == true)
    }

    @Test func surroundingsRequestsFetchLimit() async throws {
        var capturedQuery: [URLQueryItem]?
        StubURLProtocol.handler = { request in
            capturedQuery = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems
            return (200, Data(#"{"places":[]}"#.utf8))
        }
        _ = try await NearbyService(client: stubbedClient()).surroundings(lat: 37.5, lng: 127.0)
        #expect(capturedQuery?.contains(where: { $0.name == "limit" && $0.value == "50" }) == true)
    }

    @Test func barrierFreeNearbyRequestsFetchLimit() async throws {
        var capturedQuery: [URLQueryItem]?
        StubURLProtocol.handler = { request in
            capturedQuery = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems
            return (200, Data(#"{"places":[]}"#.utf8))
        }
        _ = try await BarrierFreeService(client: stubbedClient()).nearby(lat: 37.5, lng: 127.0)
        #expect(capturedQuery?.contains(where: { $0.name == "limit" && $0.value == "50" }) == true)
    }

    /// 대조: clinics는 limit 확장 대상이 아니다 — 오염 방지 단언.
    @Test func clinicsDoesNotRequestFetchLimit() async throws {
        var capturedQuery: [URLQueryItem]?
        StubURLProtocol.handler = { request in
            capturedQuery = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems
            return (200, Data(#"{"clinics":[]}"#.utf8))
        }
        _ = try await NearbyService(client: stubbedClient()).clinics(lat: 37.5, lng: 127.0)
        #expect(capturedQuery?.contains(where: { $0.name == "limit" }) == false)
    }
}
