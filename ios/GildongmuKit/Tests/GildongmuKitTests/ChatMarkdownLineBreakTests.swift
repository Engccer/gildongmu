import Foundation
import Testing
@testable import GildongmuKit

/// 채팅 블록 파서의 줄 경계(E43 iOS 확인 후보 ③) — 공유 fixture
/// (`src/lib/__tests__/fixtures/chat-markdown-line-break-cases.json`)로 현행 Swift 동작을 잠근다. 안드로이드 `:kit`과
/// 웹이 CRLF에서 갈리는 차이는 fixture 머리와 BACKLOG E43에 있다(고치지 않고 잠근다).
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
    #expect(file.cases.count == 10)
    for c in file.cases {
        let got = parseChatMarkdownBlocks(c.input).map(kindAndText)
        #expect(got == c.expect.map { [$0.kind, $0.text] }, "\(c.name)")
    }
}
