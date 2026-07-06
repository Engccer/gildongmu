import Testing
import Foundation
@testable import GildongmuKit

final class StubURLProtocol: URLProtocol {
    nonisolated(unsafe) static var handler: ((URLRequest) -> (Int, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let (status, data) = Self.handler!(request)
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

func stubbedClient() -> APIClient {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [StubURLProtocol.self]
    return APIClient(baseURL: URL(string: "https://example.test")!, session: URLSession(configuration: config))
}

/// StubURLProtocol.handler가 전역 공유 상태라 스텁 사용 테스트는 이 스위트에서 직렬 실행한다.
@Suite(.serialized) struct StubNetworkTests {}

extension StubNetworkTests {
    @Test func getDecodesSuccessPayload() async throws {
        StubURLProtocol.handler = { request in
            #expect(request.url?.path() == "/api/places")
            #expect(request.url?.query()?.contains("query=%EA%B0%95%EB%82%A8") == true)
            return (200, Data(#"{"places":[],"provider":"kakao-local","query":"강남"}"#.utf8))
        }
        let result: PlaceSearchResult = try await stubbedClient()
            .get("/api/places", query: [URLQueryItem(name: "query", value: "강남")])
        #expect(result.provider == "kakao-local")
    }

    @Test func getThrowsBadStatusWithServerMessage() async throws {
        StubURLProtocol.handler = { _ in (502, Data(#"{"error":"장소 검색에 실패했습니다."}"#.utf8)) }
        await #expect(throws: APIError.self) {
            let _: PlaceSearchResult = try await stubbedClient().get("/api/places", query: [])
        }
    }
}
