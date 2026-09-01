import Foundation
import Testing
@testable import GildongmuKit

/// 웹 정본과 같은 공유 fixture(`src/lib/__tests__/fixtures/end-screen-stale-cases.json`)를
/// 레포 상대 경로로 읽는다(사본 금지 — `SessionIdleTests` 관례 동형).
private struct FixtureFile: Decodable { let cases: [Case] }
private struct Case: Decodable {
    let name: String
    let secondsSinceEnd: Double
    let expect: Bool
}

private func loadCases() throws -> [Case] {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() }
    url.appendPathComponent("src/lib/__tests__/fixtures/end-screen-stale-cases.json")
    return try JSONDecoder().decode(FixtureFile.self, from: Data(contentsOf: url)).cases
}

@Test("종료 화면 수명 공유 fixture 동조")
func endScreenStaleMatchesSharedFixture() throws {
    for c in try loadCases() {
        #expect(isEndScreenStale(secondsSinceEnd: c.secondsSinceEnd) == c.expect, "\(c.name)")
    }
}

@Test("NaN·무한은 소거하지 않는다")
func endScreenStaleRejectsInvalid() {
    #expect(isEndScreenStale(secondsSinceEnd: .nan) == false)
    #expect(isEndScreenStale(secondsSinceEnd: .infinity) == false)
}
