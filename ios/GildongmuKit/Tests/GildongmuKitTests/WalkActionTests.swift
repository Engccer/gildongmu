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
    let cases = try loadCases()
    // fixture가 비면 아래 루프가 0건 단언으로 조용히 통과한다.
    #expect(cases.count >= 14)
    for c in cases {
        #expect(
            walkStepAction(c.desc)?.rawValue == c.expect,
            "\(c.desc.isEmpty ? "(빈 문장)" : c.desc) → \(c.expect ?? "nil")"
        )
    }
}


/// 갈래 선택은 회전과 같은 소리(K2 §3.1, 웹 walk-action.test.ts 동형).
@Test func keepActionsShareTurnTones() {
    #expect(imminentTone(.keepLeft) == .left)
    #expect(imminentTone(.keepRight) == .right)
    // walkStepAction은 keep*을 내지 않는다 — 자동차 갈래 문장도 침묵.
    #expect(walkStepAction("한남대교남단에서 한남대교 방면으로 오른쪽 길로 들어선 뒤 올림픽대로를 따라 500m 이동") == nil)
}
