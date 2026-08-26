import Foundation
import Testing
@testable import GildongmuKit

/// 웹 정본과 같은 공유 fixture(`src/lib/__tests__/fixtures/session-idle-scenarios.json`)를
/// 레포 상대 경로로 읽는다(사본 금지 — `FinalApproachTests` 관례 동형).
private struct FixtureFile: Decodable { let scenarios: [Scenario] }
private struct Scenario: Decodable {
    let name: String
    let input: Input
    let expect: String?
    struct Input: Decodable {
        let secondsSinceUsableFix: Double
        let secondsSinceProgress: Double
    }
}

private func loadScenarios() throws -> [Scenario] {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() } // GildongmuKitTests→Tests→GildongmuKit→ios→repo
    url.appendPathComponent("src/lib/__tests__/fixtures/session-idle-scenarios.json")
    return try JSONDecoder().decode(FixtureFile.self, from: Data(contentsOf: url)).scenarios
}

@Test("공유 fixture 동조")
func sessionIdleMatchesSharedFixture() throws {
    for s in try loadScenarios() {
        let got = sessionIdleStep(
            secondsSinceUsableFix: s.input.secondsSinceUsableFix,
            secondsSinceProgress: s.input.secondsSinceProgress
        )
        #expect(got?.rawValue == s.expect, "\(s.name)")
    }
}

@Test("무효 입력은 nil")
func sessionIdleRejectsInvalid() {
    #expect(sessionIdleStep(secondsSinceUsableFix: -1, secondsSinceProgress: 0) == nil)
    #expect(sessionIdleStep(secondsSinceUsableFix: .nan, secondsSinceProgress: 0) == nil)
    #expect(sessionIdleStep(secondsSinceUsableFix: 0, secondsSinceProgress: .infinity) == nil)
}

@Test("국면 무관 안전망은 도착 추정보다 모든 축이 느슨하다")
func sessionIdleIsLooserThanPresumedArrival() {
    #expect(sessionIdleNoFixSeconds > presumedArrivalNoFixSeconds)
    #expect(sessionIdleStationarySeconds > presumedArrivalStationarySeconds)
    #expect(sessionProgressEpsilonMeters > progressEpsilonMeters)
}
