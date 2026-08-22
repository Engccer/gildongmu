import Testing
import Foundation
@testable import GildongmuKit

// "현재 위치 정위"(where-am-i) 계약 테스트 — Fixtures/where-am-i.json(2026-07-10 prod
// 실캡처, 길동 좌표)이 계약 정본. envelope {data:...}는 다른 nearby fixture와 달리
// 라우트가 {data: WhereAmIData | null}로 감싸므로 WhereAmIResponse로 디코딩한다.

@Test func whereAmIFixtureDecodes() throws {
    let response = try JSONDecoder().decode(WhereAmIResponse.self, from: fixture("where-am-i"))
    let data = try #require(response.data)
    #expect(data.region == "서울특별시 강동구 길동")
    #expect(data.address?.jibun == "서울 강동구 길동 247")
    #expect(data.address?.road == nil)
    #expect(data.nearestStation?.name == "길동")
    #expect(data.nearestStation?.line == "5호선")
    #expect(data.nearestStation?.bearing == "n")
    #expect(data.nearestStation?.distanceMeters == 336)
    // fixture는 12곳(cap 6은 narrative 빌더 책임, 모델 자체는 전량 보존)
    #expect(data.landmarks.count == 12)
}
