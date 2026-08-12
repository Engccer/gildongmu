import Foundation
import Testing
@testable import GildongmuKit

/// M3 `shortest` additive 필드의 하위 호환 계약(spec §8 리뷰 #17).
/// "Codable은 미지 필드를 무시한다"를 가정이 아니라 fixture로 확정한다 —
/// 응답 6종(기본·shortest 객체·shortest null·result null·미지 필드·stepFreeNotice)이
/// 직전 배포판과 같은 envelope 타입으로 전부 디코딩되어야 한다.
@Suite struct WalkRouteEnvelopeCompatTests {
    private func decode(_ json: String) throws -> WalkRouteEnvelope {
        try JSONDecoder().decode(WalkRouteEnvelope.self, from: Data(json.utf8))
    }

    @Test func 기본_응답_shortest_부재() throws {
        let e = try decode(#"{"result":{"distanceMeters":880,"durationSeconds":780,"steps":[{"description":"직진"}]}}"#)
        #expect(e.result != nil)
        #expect(e.shortest == nil)
    }

    @Test func shortest_객체() throws {
        let e = try decode(#"{"result":{"distanceMeters":880,"durationSeconds":780,"steps":[{"description":"직진"}]},"shortest":{"distanceMeters":715,"durationSeconds":660,"steps":[{"description":"직진"}]}}"#)
        #expect(e.result?.distanceMeters == 880)
        #expect(e.shortest?.distanceMeters == 715)
    }

    @Test func shortest_null은_부재와_동일하게_nil() throws {
        let e = try decode(#"{"result":{"distanceMeters":880,"durationSeconds":780,"steps":[{"description":"직진"}]},"shortest":null}"#)
        #expect(e.result != nil)
        #expect(e.shortest == nil)
    }

    @Test func result_null_경로없음() throws {
        let e = try decode(#"{"result":null}"#)
        #expect(e.result == nil)
        #expect(e.shortest == nil)
    }

    @Test func 미지_필드_무시() throws {
        let e = try decode(#"{"result":{"distanceMeters":880,"durationSeconds":780,"steps":[{"description":"직진"}]},"unknownFutureField":1}"#)
        #expect(e.result != nil)
    }

    @Test func stepFreeNotice_최단_전용_문장() throws {
        let e = try decode(#"{"result":{"distanceMeters":715,"durationSeconds":660,"steps":[{"description":"직진"}],"stepFree":"unavailable","stepFreeNotice":"최단 경로에는 계단 회피가 적용되지 않습니다. 계단이 포함될 수 있습니다."}}"#)
        #expect(e.result?.stepFreeStatus == .unavailable)
        #expect(e.result?.stepFreeNotice?.contains("최단") == true)
    }
}
