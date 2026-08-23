import Testing
import Foundation
@testable import GildongmuKit

@Test func 한국_좌표는_커버리지_안() {
    #expect(isInKorea(lat: 37.5665, lng: 126.978))
    #expect(!isInKorea(lat: 37.7749, lng: -122.4194))
}

/// 프리필터를 상수(≤132.0)로 두었을 때 잘려 나가던 구간 — 독도 영해 링은 동경 132.12까지 뻗는다.
@Test func 프리필터가_링을_잘라내지_않는다() {
    #expect(isInKorea(lat: 37.24, lng: 132.05))
    #expect(!isInKorea(lat: 37.24, lng: 132.2))
}

/// 웹 `coverage.test.ts`와 같은 공유 fixture(`korea-boundary-cases.json`) — 국경 판정 드리프트 가드.
private struct BoundaryCaseFile: Decodable {
    let cases: [Case]

    struct Case: Decodable {
        let name: String
        let lat: Double
        let lng: Double
        let inside: Bool
    }
}

@Test func 국경_공유_golden_전수() throws {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() }
    url.appendPathComponent("src/lib/__tests__/fixtures/korea-boundary-cases.json")
    let cases = try JSONDecoder().decode(BoundaryCaseFile.self, from: Data(contentsOf: url)).cases
    #expect(cases.count >= 15)
    // inside: true 케이스가 아홉이라, 리소스를 못 읽어 링이 비면(전 좌표 "밖") 여기서 즉시 실패한다.
    for c in cases {
        #expect(isInKorea(lat: c.lat, lng: c.lng) == c.inside, "\(c.name)")
    }
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
