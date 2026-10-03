import Foundation
import Testing
@testable import GildongmuKit

/// 웹 `clock-direction.test.ts`와 같은 공유 fixture(`clock-direction-cases.json`) — 세 벌 동조 가드.
private struct CaseFile: Decodable {
    let cases: [Case]

    struct Case: Decodable {
        let reference: Double
        let target: Double
        let relative: Double
        let hour: Int
    }
}

private func loadCases() throws -> [CaseFile.Case] {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() }
    url.appendPathComponent("src/lib/__tests__/fixtures/clock-direction-cases.json")
    return try JSONDecoder().decode(CaseFile.self, from: Data(contentsOf: url)).cases
}

@Test func clockDirectionSharedCases() throws {
    let cases = try loadCases()
    #expect(cases.count >= 15)
    for c in cases {
        let rel = relativeBearing(reference: c.reference, target: c.target)
        #expect(rel >= 0 && rel < 360)
        #expect(abs(rel - c.relative) < 1e-6, "\(c.reference)→\(c.target)")
        #expect(clockHour(rel) == c.hour, "\(c.reference)→\(c.target) = \(c.hour)시")
    }
}
