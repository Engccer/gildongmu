import Foundation
import Testing
@testable import GildongmuKit

/// 웹 `car-action.test.ts`와 같은 공유 fixture(`car-action-cases.json`) — 코드 표 드리프트 가드.
private struct CaseFile: Decodable {
    let cases: [Case]

    struct Case: Decodable {
        let turnType: Int
        let action: String?
    }
}

private func loadCases() throws -> [CaseFile.Case] {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() }
    url.appendPathComponent("src/lib/__tests__/fixtures/car-action-cases.json")
    return try JSONDecoder().decode(CaseFile.self, from: Data(contentsOf: url)).cases
}

@Test func carActionSharedTable() throws {
    let cases = try loadCases()
    #expect(cases.count >= 40)
    for c in cases {
        #expect(carActionFromTurnType(c.turnType)?.rawValue == c.action, "turnType \(c.turnType) → \(c.action ?? "nil")")
    }
}

/// 서버 응답의 미지 `action` 값은 디코딩 실패가 아니라 nil이다(K2 §2.3 — 구버전 앱이 상세 전체를 잃지 않게).
@Test func unknownActionDecodesToNil() throws {
    let json = #"{"name":"","guidance":"교차로에서 우회전 후 100m 이동","distanceMeters":0,"durationSeconds":0,"action":"hyperspace"}"#
    let g = try JSONDecoder().decode(CarRouteGuide.self, from: Data(json.utf8))
    #expect(g.action == nil)
    let known = #"{"name":"","guidance":"x","distanceMeters":0,"durationSeconds":0,"action":"keepRight"}"#
    #expect(try JSONDecoder().decode(CarRouteGuide.self, from: Data(known.utf8)).action == .keepRight)
}
