import Testing
import Foundation
@testable import GildongmuKit

// E70-b 채팅 여정 카드(Kit): 렌더 디코딩, 깨진 카드의 강등, 신선도 판정(웹 journey-card-freshness.test.ts와 같은 경계),
// 요청 본문 능력 신고. Fixtures/chat-journey-render.json은 서버 `journey-tool.ts`의 render 모양에
// 실호출 여정 응답(journey-live-both, 홍대입구 승차 → 잠실 하차)을 담은 것이다.

private func journeyRenderJSON() throws -> String {
    let url = try #require(Bundle.module.url(forResource: "Fixtures/chat-journey-render", withExtension: "json"))
    return try String(contentsOf: url, encoding: .utf8)
}

private func doneLine(render: String) -> String {
    #"{"type":"done","text":"답","renders":[\#(render)],"sources":[]}"#
}

@Suite struct JourneyChatDecodeTests {
    @Test func 여정_렌더가_디코딩된다() throws {
        guard case .done(_, let renders, _) = try decodeChatEventLine(doneLine(render: try journeyRenderJSON())),
              case .journey(let payload)? = renders.first
        else { Issue.record("journey 렌더여야 한다"); return }
        #expect(payload.result.variants.first?.kind == .designated)
        #expect(payload.origin == RoutePoint(lat: 37.5563, lng: 126.9236))
        #expect(payload.queriedAt == 1_800_000_000_000)
        #expect(payload.manualOrigin == false)
        #expect(payload.board?.label == "홍대입구")
        #expect(payload.board?.line == "수도권 2호선")
        #expect(payload.alight?.label == "잠실")
        #expect(payload.alight?.line == nil)
        #expect(payload.destLabel == "잠실역")
        #expect(payload.destRoman == nil)
    }

    @Test func 지정_역이_없는_null은_nil이다() throws {
        var object = try #require(try JSONSerialization.jsonObject(with: Data(try journeyRenderJSON().utf8)) as? [String: Any])
        object["board"] = NSNull()
        object["alight"] = NSNull()
        object["destRoman"] = "Jamsil"
        object["manualOrigin"] = true
        let json = String(decoding: try JSONSerialization.data(withJSONObject: object), as: UTF8.self)
        guard case .done(_, let renders, _) = try decodeChatEventLine(doneLine(render: json)),
              case .journey(let payload)? = renders.first
        else { Issue.record("journey 렌더여야 한다"); return }
        #expect(payload.board == nil)
        #expect(payload.alight == nil)
        #expect(payload.destRoman == "Jamsil")
        #expect(payload.manualOrigin)
    }

    @Test func 깨진_여정_렌더는_답을_잃지_않고_unsupported로_접힌다() throws {
        var object = try #require(try JSONSerialization.jsonObject(with: Data(try journeyRenderJSON().utf8)) as? [String: Any])
        object.removeValue(forKey: "queriedAt")
        let json = String(decoding: try JSONSerialization.data(withJSONObject: object), as: UTF8.self)
        // 같은 답의 다른 렌더(웹 결과)는 살아남는다.
        let web = #"{"type":"web-results","results":[{"title":"t","url":"https://a.b","snippet":"s"}]}"#
        let line = #"{"type":"done","text":"답","renders":[\#(json),\#(web)],"sources":[]}"#
        guard case .done(let text, let renders, _) = try decodeChatEventLine(line) else {
            Issue.record("done 이벤트여야 한다"); return
        }
        #expect(text == "답")
        #expect(renders.count == 2)
        guard case .unsupported = renders[0] else { Issue.record("깨진 카드는 .unsupported"); return }
        guard case .webResults = renders[1] else { Issue.record("다른 렌더는 그대로"); return }
    }
}

@Suite struct JourneyCardFreshnessTests {
    private let origin = RoutePoint(lat: 37.55, lng: 126.95)
    private let queriedAt = 1_800_000_000_000.0
    /// 북쪽으로 m미터 옮긴 좌표(위도 1도 = 111,195m, 웹 테스트와 같은 환산).
    private func north(_ m: Double) -> RoutePoint { RoutePoint(lat: origin.lat + m / 111_195, lng: origin.lng) }

    @Test func 방금_조회했고_같은_자리면_신선하다() {
        #expect(journeyCardFreshness(origin: origin, queriedAtMs: queriedAt, fix: origin, nowMs: queriedAt + 1000) == .fresh)
    }

    @Test func 나이_상한은_포함_경계다() {
        let limit = JourneyCardPolicy.maxAgeMs
        #expect(journeyCardFreshness(origin: origin, queriedAtMs: queriedAt, fix: origin, nowMs: queriedAt + limit) == .fresh)
        #expect(journeyCardFreshness(origin: origin, queriedAtMs: queriedAt, fix: origin, nowMs: queriedAt + limit + 1) == .expired)
    }

    @Test func 거리_상한_안쪽은_신선하고_넘으면_이동이다() {
        let limit = JourneyCardPolicy.maxDriftMeters
        #expect(journeyCardFreshness(origin: origin, queriedAtMs: queriedAt, fix: north(limit - 5), nowMs: queriedAt) == .fresh)
        #expect(journeyCardFreshness(origin: origin, queriedAtMs: queriedAt, fix: north(limit + 5), nowMs: queriedAt) == .moved)
    }

    @Test func 측위_실패면_방금_조회한_카드여도_신선하지_않다() {
        #expect(journeyCardFreshness(origin: origin, queriedAtMs: queriedAt, fix: nil, nowMs: queriedAt) == .noFix)
    }

    @Test func 깨진_시각과_좌표는_신선으로_새지_않는다() {
        #expect(journeyCardFreshness(origin: origin, queriedAtMs: .nan, fix: origin, nowMs: queriedAt) == .expired)
        #expect(journeyCardFreshness(
            origin: origin, queriedAtMs: queriedAt, fix: RoutePoint(lat: .nan, lng: origin.lng), nowMs: queriedAt) == .moved)
    }

    @Test func 수치는_웹과_같다() {
        #expect(JourneyCardPolicy.maxAgeMs == 600_000)
        #expect(JourneyCardPolicy.maxDriftMeters == 100)
    }
}

@Suite struct ChatRequestCapabilitiesTests {
    private func json(_ body: ChatRequestBody) throws -> [String: Any] {
        try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(body)) as? [String: Any])
    }

    @Test func 능력을_싣지_않으면_종전_키만_나간다() throws {
        let body = ChatRequestBody(messages: [.init(role: "user", text: "안녕")], userLocation: nil, locale: "ko", placeContext: nil)
        let object = try json(body)
        #expect(Set(object.keys) == ["messages", "locale"])
    }

    @Test func 능력과_수동_위치는_함께_실린다() throws {
        let body = ChatRequestBody(
            messages: [.init(role: "user", text: "안녕")], userLocation: .init(lat: 37.5, lng: 127), locale: "ko",
            placeContext: nil, capabilities: ["journey"], userLocationManual: false)
        let object = try json(body)
        #expect(object["capabilities"] as? [String] == ["journey"])
        #expect(object["userLocationManual"] as? Bool == false)
    }
}
