import Foundation
import Testing
@testable import GildongmuKit

/// 웹 `bilingual-name.test.ts`와 같은 fixture를 읽는다 — 규칙이 한 벌임을 강제.
private struct BilingualCase: Decodable {
    let id: String
    let locale: String
    let ko: String
    let en: String?
    let roman: String?
    let primary: String
    let secondary: String?
}

private struct BilingualCaseFile: Decodable {
    let cases: [BilingualCase]
}

private func loadBilingualCases() throws -> [BilingualCase] {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() }  // GildongmuKitTests→Tests→GildongmuKit→ios→repo
    url.appendPathComponent("src/lib/__tests__/fixtures/bilingual-name-cases.json")
    let data = try Data(contentsOf: url)
    return try JSONDecoder().decode(BilingualCaseFile.self, from: data).cases
}

@Suite("BilingualName — 공유 fixture")
struct BilingualNameTests {
    @Test func fixtureIsNotEmpty() throws {
        #expect(try loadBilingualCases().count >= 10)
    }

    @Test func matchesSharedFixture() throws {
        for c in try loadBilingualCases() {
            let got = bilingualName(lang: c.locale, ko: c.ko, en: c.en, roman: c.roman)
            #expect(got.primary == c.primary, "\(c.id) primary")
            #expect(got.secondary == c.secondary, "\(c.id) secondary")
        }
    }

    @Test func displayIsOneLineParenthesis() {
        #expect(BilingualName(primary: "Seolleung", secondary: "선릉역").display == "Seolleung (선릉역)")
        #expect(BilingualName(primary: "CU", secondary: nil).display == "CU")
    }

    @Test func hasHangulMirrorsWeb() {
        #expect(hasHangul("강동성심병원"))
        #expect(hasHangul("ㄱ"))
        #expect(!hasHangul("GS25"))
        #expect(!hasHangul(""))
    }
}
