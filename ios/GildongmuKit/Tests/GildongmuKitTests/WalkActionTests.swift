import Foundation
import Testing
@testable import GildongmuKit

/// 웹 정본과 같은 공유 fixture(`src/lib/__tests__/fixtures/walk-action-cases.json`)를
/// 레포 상대 경로로 직접 읽어 같은 경계표를 단언한다(사본 금지 — 드리프트 원천 차단,
/// `RouteGuideTests`의 fixture 직접 읽기 관례 동형).
private struct CaseFile: Decodable {
    let cases: [Case]

    struct Case: Decodable {
        let desc: String
        let expect: String?
    }
}

private func loadCases() throws -> [CaseFile.Case] {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() }  // GildongmuKitTests→Tests→GildongmuKit→ios→repo
    url.appendPathComponent("src/lib/__tests__/fixtures/walk-action-cases.json")
    return try JSONDecoder().decode(CaseFile.self, from: Data(contentsOf: url)).cases
}

@Test func walkActionSharedTable() throws {
    for c in try loadCases() {
        #expect(
            walkStepAction(c.desc)?.rawValue == c.expect,
            "\(c.desc.isEmpty ? "(빈 문장)" : c.desc) → \(c.expect ?? "nil")"
        )
    }
}
