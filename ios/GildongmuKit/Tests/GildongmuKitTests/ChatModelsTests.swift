import Testing
import Foundation
@testable import GildongmuKit

/// chat-stream.ndjson fixture(prod 실캡처)를 줄 단위로 읽는다.
private func chatFixtureLines() throws -> [String] {
    let url = Bundle.module.url(forResource: "Fixtures/chat-stream", withExtension: "ndjson")!
    let text = try String(contentsOf: url, encoding: .utf8)
    return text.split(separator: "\n").map(String.init).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
}

@Test func chatFixtureStatusLineDecodes() throws {
    let lines = try chatFixtureLines()
    guard case .status(let categories) = try decodeChatEventLine(lines[0]) else {
        Issue.record("첫 줄은 status 이벤트여야 한다")
        return
    }
    #expect(!categories.isEmpty)
}

@Test func chatFixtureDoneLineDecodes() throws {
    let lines = try chatFixtureLines()
    guard case .done(let text, let renders, let sources) = try decodeChatEventLine(lines[1]) else {
        Issue.record("둘째 줄은 done 이벤트여야 한다")
        return
    }
    #expect(!text.isEmpty)
    // fixture의 air-quality 카드는 V1 미탑재 render → .unsupported로 강등(미지 타입 무시 계약)
    #expect(renders.contains { if case .unsupported = $0 { true } else { false } })
    #expect(sources.first?.label == "source.airkorea")
    #expect(sources.first?.url == nil)
}

@Test func unknownEventTypeDecodesToUnknown() throws {
    // 전방 호환: 미지 이벤트 type은 오류가 아니라 .unknown(무시 대상)
    guard case .unknown = try decodeChatEventLine(#"{"type":"future-x","payload":{"a":1}}"#) else {
        Issue.record("미지 type은 .unknown이어야 한다")
        return
    }
}

@Test func errorEventDecodes() throws {
    guard case .error(let code) = try decodeChatEventLine(#"{"type":"error","code":"chat_failed"}"#) else {
        Issue.record("error 이벤트 디코딩 실패")
        return
    }
    #expect(code == "chat_failed")
}

@Test func supportedRenderVariantsDecode() throws {
    let line = #"""
    {"type":"done","text":"t","renders":[
      {"type":"places","places":[{"id":"kakao-1","name":"스타벅스","category":"카페","address":"서울","roadAddress":"서울 강동구 천호대로","lat":37.5,"lng":127.1}]},
      {"type":"addresses","results":[{"roadAddr":"서울 강동구 천호대로 1","roadAddrPart1":"서울 강동구 천호대로 1","jibunAddr":"서울 강동구 길동 1","engAddr":"1 Cheonho-daero","zipNo":"05398","bdNm":""}]},
      {"type":"web-results","results":[{"title":"제목","url":"https://example.com","snippet":"요약"}]},
      {"type":"subway-nearby"}
    ],"sources":[]}
    """#.replacingOccurrences(of: "\n", with: "")
    guard case .done(_, let renders, _) = try decodeChatEventLine(line) else {
        Issue.record("done 디코딩 실패")
        return
    }
    #expect(renders.count == 4)
    guard case .places(let places) = renders[0] else { Issue.record("places 아님"); return }
    #expect(places[0].name == "스타벅스")
    guard case .addresses(let addresses) = renders[1] else { Issue.record("addresses 아님"); return }
    #expect(addresses[0].zipNo == "05398")
    guard case .webResults(let web) = renders[2] else { Issue.record("web-results 아님"); return }
    #expect(web[0].url == "https://example.com")
    // self-fetch 파라미터 카드류는 V1 미탑재 → .unsupported
    guard case .unsupported = renders[3] else { Issue.record("unsupported 아님"); return }
}

@Test func invalidJSONLineThrows() {
    #expect(throws: (any Error).self) {
        try decodeChatEventLine("not-json")
    }
}

@Test func chatRequestBodyEncodesContract() throws {
    let body = ChatRequestBody(
        messages: [.init(role: "user", text: "여기 공기질 어때?")],
        userLocation: .init(lat: 37.53, lng: 127.13),
        locale: "ko",
        placeContext: .init(name: "강동역", lat: 37.535, lng: 127.132, category: "지하철역", isStation: true)
    )
    let data = try JSONEncoder().encode(body)
    let json = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    let messages = try #require(json["messages"] as? [[String: Any]])
    #expect(messages[0]["role"] as? String == "user")
    #expect((json["userLocation"] as? [String: Any])?["lat"] as? Double == 37.53)
    #expect(json["locale"] as? String == "ko")
    let pc = try #require(json["placeContext"] as? [String: Any])
    #expect(pc["name"] as? String == "강동역")
    #expect(pc["isStation"] as? Bool == true)
}

@Test func chatRequestBodyOmitsNilOptionals() throws {
    let body = ChatRequestBody(
        messages: [.init(role: "user", text: "안녕")],
        userLocation: nil,
        locale: "ko",
        placeContext: nil
    )
    let data = try JSONEncoder().encode(body)
    let json = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    // 서버 계약: userLocation·placeContext는 없으면 키 자체를 생략(undefined 의미론)
    #expect(json["userLocation"] == nil)
    #expect(json["placeContext"] == nil)
}

@Test func parseChatMarkdownBlocksSplitsHeadingListAndParagraph() {
    // prod 실호출 실측 형태: ### 헤딩 + "* **볼드**: 설명" 리스트 + 단락들
    let input = "### 편의점 및 마트\n* **CU 강동풍차점**: 북동쪽 10m\n  - 세부 항목\n1. 순서 목록\n\n첫 단락 첫 줄\n첫 단락 둘째 줄\n\n둘째 단락 **강조** 유지"
    #expect(parseChatMarkdownBlocks(input) == [
        .heading("편의점 및 마트"),
        .listItem("• **CU 강동풍차점**: 북동쪽 10m"),
        .listItem("• 세부 항목"),
        .listItem("1. 순서 목록"),
        .paragraph("첫 단락 첫 줄\n첫 단락 둘째 줄"),
        .paragraph("둘째 단락 **강조** 유지"),
    ])
}

@Test func parseChatMarkdownBlocksPlainTextIsSingleParagraph() {
    // 블록 문법이 없으면 단락 하나(내부 줄바꿈·중간 해시 보존), 줄 시작 *기울임*은 리스트 아님
    let input = "안녕하세요. # 중간 해시 유지\n*기울임*은 리스트 아님"
    #expect(parseChatMarkdownBlocks(input) == [.paragraph(input)])
}
