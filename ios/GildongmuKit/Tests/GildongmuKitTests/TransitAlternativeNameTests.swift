import Foundation
import Testing
@testable import GildongmuKit

// 대안 경로 이름 조립 규칙(spec 2026-09-24 §4.1). 웹 `transit-alternative-name.test.ts`·`:kit`
// `TransitAlternativeNameTest`와 같은 공유 fixture(`transit-alternative-name-cases.json`)를 읽는다.
// 판정은 전부 서버가 끝냈고 이 계층은 축·표시 번호를 키 조각으로 옮기기만 한다.

private struct CaseFile: Decodable {
    let cases: [Case]

    struct Case: Decodable {
        let name: String
        let highlight: [String]?
        let displayIndex: Int?
        let parts: [Part]
    }

    struct Part: Decodable, Equatable {
        let key: String
        let index: Int?
    }
}

private func loadCases() throws -> [CaseFile.Case] {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() }
    url.appendPathComponent("src/lib/__tests__/fixtures/transit-alternative-name-cases.json")
    return try JSONDecoder().decode(CaseFile.self, from: Data(contentsOf: url)).cases
}

@Suite("대안 경로 표시 이름")
struct TransitAlternativeNameTests {
    @Test("공유 fixture 전 항목")
    func sharedCases() throws {
        let cases = try loadCases()
        #expect(cases.count >= 10)
        for c in cases {
            let got = TransitAlternativeName.parts(highlight: c.highlight, displayIndex: c.displayIndex)
                .map { CaseFile.Part(key: $0.key, index: $0.index) }
            #expect(got == c.parts, "\(c.name)")
        }
    }
}
