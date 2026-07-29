import Testing
import Foundation
@testable import GildongmuKit

@Test func 한국_좌표는_커버리지_안() {
    #expect(isInKorea(lat: 37.5665, lng: 126.978))
    #expect(!isInKorea(lat: 37.7749, lng: -122.4194))
}

// StubURLProtocol.handler 공유 상태를 쓰므로 StubNetworkTests 직렬 스위트에 편입.
extension StubNetworkTests {
    @Test func 마커_응답은_outOfCoverage_오류로_던진다() async {
        StubURLProtocol.handler = { _ in (200, Data(#"{"outOfCoverage":true}"#.utf8)) }
        await #expect(throws: APIError.self) {
            struct Dummy: Decodable, Sendable {}
            let _: Dummy = try await stubbedClient().get("/api/route/walk", query: [])
        }
    }

    @Test func 정상_페이로드는_outOfCoverage_필드_없이_그대로_디코딩된다() async throws {
        StubURLProtocol.handler = { _ in
            (200, Data(#"{"places":[],"provider":"kakao-local","query":"강남"}"#.utf8))
        }
        let result: PlaceSearchResult = try await stubbedClient().get("/api/places", query: [])
        #expect(result.provider == "kakao-local")
    }
}
