import Foundation
import Testing
@testable import GildongmuKit

/// 채팅 블록 파서의 줄 경계(E43 iOS 확인 후보 ③) — 공유 fixture
/// (`src/lib/__tests__/fixtures/chat-markdown-line-break-cases.json`)로 잠근다. CRLF는 줄 경계 하나(CommonMark 쪽,
/// 위원장 판정 2026-09-27)이고 안드로이드 `:kit` `ChatMarkdownTest`가 같은 fixture를 읽는다.
private func fixtureURL(_ name: String) -> URL {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() }
    url.appendPathComponent("src/lib/__tests__/fixtures/\(name)")
    return url
}

private struct LineBreakCase: Decodable {
    struct Block: Decodable { let kind: String; let text: String }
    let name: String
    let input: String
    let expect: [Block]
}

private func kindAndText(_ block: ChatMarkdownBlock) -> [String] {
    switch block {
    case .heading(let t): ["heading", t]
    case .listItem(let t): ["listItem", t]
    case .paragraph(let t): ["paragraph", t]
    }
}

@Test func chatMarkdownLineBreaksMatchSharedFixture() throws {
    struct File: Decodable { let cases: [LineBreakCase] }
    let data = try Data(contentsOf: fixtureURL("chat-markdown-line-break-cases.json"))
    let file = try JSONDecoder().decode(File.self, from: data)
    #expect(file.cases.count == 11)
    for c in file.cases {
        let got = parseChatMarkdownBlocks(c.input).map(kindAndText)
        #expect(got == c.expect.map { [$0.kind, $0.text] }, "\(c.name)")
    }
}
