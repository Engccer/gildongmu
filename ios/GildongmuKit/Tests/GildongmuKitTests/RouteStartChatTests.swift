import Testing
import Foundation
@testable import GildongmuKit

// E83 채팅 경로 카드의 [안내 시작](Kit): 렌더 디코딩, 계약 밖 렌더의 강등, 도착지별 묶기, 길찾기 화면과 함께 쓰는 시작 판정,
// 요청 본문 능력 신고. Fixtures/chat-route-start-render.json은 spec `2026-11-14-e83-chat-route-start-design.md` §4의
// 렌더 셋(도보·자동차·대중교통)이고 웹 테스트와 공유한다. `transit.result`는 route-transit.json의 결과와 같은 모양이다.

private func fixtureRenders() throws -> [[String: Any]] {
    let url = try #require(Bundle.module.url(forResource: "Fixtures/chat-route-start-render", withExtension: "json"))
    return try #require(try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [[String: Any]])
}

private func decodeRenders(_ renders: [[String: Any]]) throws -> [ChatRenderPayload] {
    let line = try JSONSerialization.data(withJSONObject: ["type": "done", "text": "답", "renders": renders, "sources": []])
    guard case .done(_, let decoded, _) = try decodeChatEventLine(String(decoding: line, as: UTF8.self)) else {
        Issue.record("done 이벤트여야 한다")
        return []
    }
    return decoded
}

private func payloads(_ renders: [ChatRenderPayload]) -> [RouteStartChatPayload] {
    renders.compactMap { if case .routeStart(let payload) = $0 { payload } else { nil } }
}

@Suite struct RouteStartDecodeTests {
    @Test func fixture의_키는_계약의_아홉_개다() throws {
        for render in try fixtureRenders() {
            #expect(Set(render.keys) == [
                "type", "mode", "dest", "destLabel", "destRoman", "via", "accessible", "carProvider", "transit",
            ])
        }
    }

    @Test func 수단_셋이_디코딩된다() throws {
        let decoded = payloads(try decodeRenders(try fixtureRenders()))
        #expect(decoded.map(\.mode) == [.walk, .car, .transit])
        let walk = decoded[0], car = decoded[1], transit = decoded[2]
        #expect(walk.dest == RoutePoint(lat: 37.4979, lng: 127.0276))
        #expect(walk.destLabel == "강남역")
        #expect(walk.destRoman == nil)
        #expect(walk.accessible)
        #expect(walk.via == nil)
        #expect(walk.transit == nil)
        #expect(car.via?.label == "잠실역")
        #expect(car.via?.lat == 37.5133)
        #expect(car.carProvider == "tmap")
        #expect(!car.accessible)
        #expect(transit.via == nil)
        #expect(transit.carProvider == nil)
        #expect(transit.transit?.origin == RoutePoint(lat: 37.538, lng: 127.14))
        #expect(transit.transit?.queriedAt == 1_800_000_000_000)
        #expect(transit.transit?.manualOrigin == false)
        // 결과는 길찾기 화면의 대중교통 결과 타입 그대로다 — 추천 경로와 대안이 선다.
        #expect(transit.transit?.result.recommended.routeKey == "p0")
        #expect(transit.transit?.result.alternatives.count == 2)
    }

    @Test func 로마자와_수동_위치가_디코딩된다() throws {
        var renders = try fixtureRenders()
        renders[2]["destRoman"] = "Gangnam Station"
        var transit = try #require(renders[2]["transit"] as? [String: Any])
        transit["manualOrigin"] = true
        renders[2]["transit"] = transit
        let decoded = payloads(try decodeRenders(renders))
        #expect(decoded[2].destRoman == "Gangnam Station")
        #expect(decoded[2].transit?.manualOrigin == true)
    }

    @Test func 계약_밖_렌더는_답을_잃지_않고_unsupported로_접힌다() throws {
        var renders = try fixtureRenders()
        renders[0]["mode"] = "bike"  // 모르는 수단
        renders[1].removeValue(forKey: "accessible")  // 빠진 필수 키
        renders[2]["transit"] = NSNull()  // 대중교통인데 결과가 없다
        var walkWithTransit = try fixtureRenders()[0]
        walkWithTransit["transit"] = try fixtureRenders()[2]["transit"]  // 도보인데 결과가 실렸다
        renders.append(walkWithTransit)
        renders.append(["type": "web-results", "results": [["title": "t", "url": "https://a.b", "snippet": "s"]]])
        let decoded = try decodeRenders(renders)
        #expect(decoded.count == 5)
        for render in decoded.prefix(4) {
            guard case .unsupported = render else { Issue.record("계약 밖 렌더는 .unsupported"); return }
        }
        guard case .webResults = decoded[4] else { Issue.record("다른 렌더는 그대로"); return }
    }
}

@Suite struct RouteStartGroupTests {
    @Test func 같은_도착지의_렌더는_카드_하나이고_버튼_순서는_도보_자동차_대중교통이다() throws {
        // 서버가 보낸 순서와 무관하다 — 뒤집어 넣어도 버튼 순서는 같다.
        let groups = routeStartCardGroups(try decodeRenders(try fixtureRenders().reversed()))
        #expect(groups.count == 1)
        #expect(groups[0].modes.map(\.mode) == [.walk, .car, .transit])
        #expect(groups[0].destLabel == "강남역")
        // [길찾기에서 열기]의 경유지는 버튼 순서로 처음 만나는 것이다(도보에는 없고 자동차에 있다).
        #expect(groups[0].via?.label == "잠실역")
    }

    @Test func 수단_하나만_물은_답은_그_버튼_하나다() throws {
        let groups = routeStartCardGroups(try decodeRenders([try fixtureRenders()[0]]))
        #expect(groups.count == 1)
        #expect(groups[0].modes.map(\.mode) == [.walk])
        #expect(groups[0].car == nil)
        #expect(groups[0].transit == nil)
        #expect(groups[0].via == nil)
    }

    @Test func 같은_수단이_둘이면_첫_것만_쓴다() throws {
        var second = try fixtureRenders()[0]
        second["accessible"] = false
        let groups = routeStartCardGroups(try decodeRenders([try fixtureRenders()[0], second]))
        #expect(groups.count == 1)
        #expect(groups[0].modes.count == 1)
        #expect(groups[0].walk?.accessible == true)
    }

    @Test func 도착지가_둘이면_묶음이_둘이고_처음_나온_순서다() throws {
        var other = try fixtureRenders()[1]
        other["dest"] = ["lat": 37.5133, "lng": 127.1001]
        other["destLabel"] = "잠실역"
        other["via"] = NSNull()
        let fixture = try fixtureRenders()
        let groups = routeStartCardGroups(try decodeRenders([fixture[2], other, fixture[0]]))
        #expect(groups.map(\.destLabel) == ["강남역", "잠실역"])
        #expect(groups[0].modes.map(\.mode) == [.walk, .transit])
        #expect(groups[1].modes.map(\.mode) == [.car])
    }

    @Test func 다른_렌더와_접힌_렌더는_묶음에_들지_않는다() throws {
        var broken = try fixtureRenders()[1]
        broken.removeValue(forKey: "dest")
        let web: [String: Any] = ["type": "web-results", "results": [["title": "t", "url": "https://a.b", "snippet": "s"]]]
        #expect(routeStartCardGroups(try decodeRenders([broken, web])).isEmpty)
        #expect(routeStartCardGroups([]).isEmpty)
    }
}

@Suite struct GuideStartPredicateTests {
    @Test func 자동차_안내는_한국어_데이터와_tmap_경로일_때만_시작할_수_있다() {
        #expect(canStartCarGuide(dataLocale: "ko", provider: "tmap"))
        #expect(!canStartCarGuide(dataLocale: "en", provider: "tmap"))
        #expect(!canStartCarGuide(dataLocale: "ko", provider: "kakao"))
        #expect(!canStartCarGuide(dataLocale: "ko", provider: nil))
    }

    @Test func 도보_기본_줄은_조회_화면의_첫_줄이다() {
        // 서버 `getWalkRouteLines`의 순서: ko `[shortest, …]`, 그 밖 `[recommended, shortest]`.
        #expect(WalkLineKind.firstLine(dataLocale: "ko") == .shortest)
        #expect(WalkLineKind.firstLine(dataLocale: "en") == .recommended)
        #expect(WalkLineKind.startLine(accessible: false, dataLocale: "ko") == .shortest)
        #expect(WalkLineKind.startLine(accessible: false, dataLocale: "en") == .recommended)
    }

    @Test func 계단_회피를_청하면_언어와_무관하게_그_줄이다() {
        #expect(WalkLineKind.startLine(accessible: true, dataLocale: "ko") == .accessible)
        #expect(WalkLineKind.startLine(accessible: true, dataLocale: "en") == .accessible)
        // 줄의 투영이 안내 요청 축과 맞는다(계단 회피 줄만 accessible, 최단 줄만 variant).
        #expect(WalkLineKind.accessible.accessible && WalkLineKind.accessible.variant == nil)
        #expect(!WalkLineKind.shortest.accessible && WalkLineKind.shortest.variant == .shortest)
        #expect(!WalkLineKind.recommended.accessible && WalkLineKind.recommended.variant == nil)
    }
}

@Suite struct RouteStartCapabilityTests {
    @Test func 능력_둘을_실으면_그_순서대로_나간다() throws {
        let body = ChatRequestBody(
            messages: [.init(role: "user", text: "안녕")], userLocation: nil, locale: "en", placeContext: nil,
            capabilities: ["journey", "route-start"], userLocationManual: true)
        let object = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(body)) as? [String: Any])
        #expect(object["capabilities"] as? [String] == ["journey", "route-start"])
        #expect(object["userLocationManual"] as? Bool == true)
    }
}
