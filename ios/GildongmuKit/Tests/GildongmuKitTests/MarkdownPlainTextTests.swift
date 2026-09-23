import Foundation
import Testing
@testable import GildongmuKit

/// TTS 낭독·복사용 마크다운 평문 변환 — 웹 `markdownToPlainText`와 같은 공유 fixture
/// (`src/lib/__tests__/fixtures/markdown-plain-text-cases.json`)를 읽는다.
private func fixtureURL(_ name: String) -> URL {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() }
    url.appendPathComponent("src/lib/__tests__/fixtures/\(name)")
    return url
}

private struct PlainTextCase: Decodable {
    let name: String
    let input: String
    let expect: String
}

@Test func markdownPlainTextMatchesSharedFixture() throws {
    struct File: Decodable { let cases: [PlainTextCase] }
    let file = try JSONDecoder().decode(File.self, from: Data(contentsOf: fixtureURL("markdown-plain-text-cases.json")))
    #expect(file.cases.count >= 34)
    for c in file.cases {
        #expect(MarkdownPlainText.strip(from: c.input) == c.expect, "\(c.name)")
    }
}
