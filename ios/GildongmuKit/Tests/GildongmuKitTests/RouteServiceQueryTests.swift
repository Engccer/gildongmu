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
            originLat: 37.5, originLng: 127.0, destLat: 37.6, destLng: 127.1, accessible: true, via: nil)
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
            originLat: 37.5, originLng: 127.0, destLat: 37.6, destLng: 127.1, accessible: false, via: nil)
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
            accessible: false, includeGeometry: true, via: nil)
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
            originLat: 37.5, originLng: 127.0, destLat: 37.6, destLng: 127.1, accessible: false, via: nil)
        #expect(capturedQuery?.contains(where: { $0.name == "includeGeometry" }) == false)
    }

    /// M3 전환·재조회의 accessible 보존 게이트(spec §3.2 ⚠ — A4 회귀 축).
    /// variant가 붙어도 accessible이 조용히 탈락하지 않아야 한다.
    @Test func walkVariantKeepsAccessible() async throws {
        var capturedQuery: [URLQueryItem]?
        StubURLProtocol.handler = { request in
            capturedQuery = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems
            return (200, Data(#"{"result":null}"#.utf8))
        }
        _ = try await RouteService(client: stubbedClient()).walk(
            originLat: 37.5, originLng: 127.0, destLat: 37.6, destLng: 127.1,
            accessible: true, includeGeometry: true, variant: .shortest, via: nil)
        #expect(capturedQuery?.contains(where: { $0.name == "variant" && $0.value == "shortest" }) == true)
        #expect(capturedQuery?.contains(where: { $0.name == "accessible" && $0.value == "true" }) == true)
        #expect(capturedQuery?.contains(where: { $0.name == "includeGeometry" && $0.value == "1" }) == true)
    }

    /// 대조: variant 미지정이면 파라미터 자체를 생략한다(기존 요청 byte-identical).
    @Test func walkDefaultOmitsVariantParam() async throws {
        var capturedQuery: [URLQueryItem]?
        StubURLProtocol.handler = { request in
            capturedQuery = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems
            return (200, Data(#"{"result":null}"#.utf8))
        }
        _ = try await RouteService(client: stubbedClient()).walk(
            originLat: 37.5, originLng: 127.0, destLat: 37.6, destLng: 127.1, accessible: false, via: nil)
        #expect(capturedQuery?.contains(where: { $0.name == "variant" }) == false)
    }

    /// 대안 병렬 조회도 accessible을 보존하고 alternatives=1을 명시한다(spec §3.1).
    @Test func walkAlternativesKeepsAccessible() async throws {
        var capturedQuery: [URLQueryItem]?
        StubURLProtocol.handler = { request in
            capturedQuery = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems
            return (200, Data(#"{"result":null}"#.utf8))
        }
        _ = try await RouteService(client: stubbedClient()).walkAlternatives(
            originLat: 37.5, originLng: 127.0, destLat: 37.6, destLng: 127.1, accessible: true, via: nil)
        #expect(capturedQuery?.contains(where: { $0.name == "alternatives" && $0.value == "1" }) == true)
        #expect(capturedQuery?.contains(where: { $0.name == "accessible" && $0.value == "true" }) == true)
        // 조회 화면 전용 — 기하는 싣지 않는다(조합표: alternatives+includeGeometry는 400).
        #expect(capturedQuery?.contains(where: { $0.name == "includeGeometry" }) == false)
    }
}

// 경유지(N4): `via`는 "위도,경도" 한 파라미터(서버 spec §2.1). nil이면 파라미터 자체를
// 생략해 기존 요청과 byte-identical(옵트인 필드는 키 자체가 없다).
extension StubNetworkTests {
    @Test func walkViaSendsLatLngPair() async throws {
        var capturedQuery: [URLQueryItem]?
        StubURLProtocol.handler = { request in
            capturedQuery = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems
            return (200, Data(#"{"result":null}"#.utf8))
        }
        _ = try await RouteService(client: stubbedClient()).walk(
            originLat: 37.5, originLng: 127.0, destLat: 37.6, destLng: 127.1, accessible: false,
            via: (lat: 37.55, lng: 127.05))
        #expect(capturedQuery?.contains(where: { $0.name == "via" && $0.value == "37.55,127.05" }) == true)
    }

    @Test func carViaNilOmitsParam() async throws {
        var capturedQuery: [URLQueryItem]?
        StubURLProtocol.handler = { request in
            capturedQuery = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems
            return (200, Data(#"{"distanceMeters":1,"durationSeconds":1,"taxiFare":0,"tollFare":0,"guides":[]}"#.utf8))
        }
        _ = try await RouteService(client: stubbedClient()).car(
            originLat: 37.5, originLng: 127.0, destLat: 37.6, destLng: 127.1, via: nil)
        #expect(capturedQuery?.contains(where: { $0.name == "via" }) == false)
    }
}
