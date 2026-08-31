import Foundation
import Testing
@testable import GildongmuKit

/// 표시 투영 공유 fixture(E27 잔여 ①) — 웹 `transit-display.test.ts`와 같은 파일을 돌린다.
private struct DisplayFixture: Decodable {
    struct LegCase: Decodable {
        let name: String
        let leg: TransitGuideLeg
        let boardOverrideIndex: Int?
        let expect: TransitDisplayLeg
    }
    struct ItemCase: Decodable {
        let name: String
        let item: TransitTrackItem
        let expect: TransitDisplayItem
    }
    let legs: [LegCase]
    let items: [ItemCase]
}

private func loadDisplayFixture() throws -> DisplayFixture {
    let url = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("src/lib/__tests__/fixtures/transit-display-cases.json")
    return try JSONDecoder().decode(DisplayFixture.self, from: Data(contentsOf: url))
}

@Test func transitDisplayProjectionMatchesSharedFixture() throws {
    let fixture = try loadDisplayFixture()
    // ⚠ 케이스 0건이면 아래 루프가 공허하게 통과한다(경로 오타가 "합격"으로 위장) — 수를 먼저 본다.
    #expect(fixture.legs.count >= 5)
    #expect(fixture.items.count >= 4)
    for c in fixture.legs {
        let got = transitDisplayLeg(c.leg, boardOverrideIndex: c.boardOverrideIndex)
        #expect(got == c.expect, "leg: \(c.name)")
    }
    for c in fixture.items {
        let got = transitDisplayItem(c.item)
        #expect(got == c.expect, "item: \(c.name)")
    }
}
