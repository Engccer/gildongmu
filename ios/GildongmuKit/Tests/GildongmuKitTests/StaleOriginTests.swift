import Foundation
import Testing
@testable import GildongmuKit

/// 웹 `stale-origin.test.ts`와 같은 공유 fixture(`stale-fix-age-cases.json`)를 읽어 같은 경계표를 단언한다.
private struct StaleOriginFixture: Decodable {
    struct AgeCase: Decodable {
        let name: String
        let ageSeconds: Double
        let expect: Expect
        struct Expect: Decodable {
            let unit: String
            let count: Int
        }
    }
    let ageCases: [AgeCase]
}

private func loadStaleOriginFixture() throws -> StaleOriginFixture {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() }
    url.appendPathComponent("src/lib/__tests__/fixtures/stale-fix-age-cases.json")
    return try JSONDecoder().decode(StaleOriginFixture.self, from: Data(contentsOf: url))
}

private func expected(_ e: StaleOriginFixture.AgeCase.Expect) -> StaleFixAge? {
    switch e.unit {
    case "justNow": .justNow
    case "minutes": .minutes(e.count)
    case "hours": .hours(e.count)
    default: nil
    }
}

@Test("옛 위치 시간 표현 공유 fixture 동조")
func staleFixAgeMatchesSharedFixture() throws {
    let cases = try loadStaleOriginFixture().ageCases
    #expect(!cases.isEmpty)
    for c in cases {
        #expect(staleFixAge(ageSeconds: c.ageSeconds) == expected(c.expect), "\(c.name)")
    }
}

@Test("비유한 값은 옛 위치가 아니다")
func staleFixAgeRejectsNonFinite() {
    #expect(staleFixAge(ageSeconds: .nan) == nil)
    #expect(staleFixAge(ageSeconds: .infinity) == nil)
}
