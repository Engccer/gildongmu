import Foundation
import Testing

@testable import GildongmuKit

// MARK: - A32 도착 한 줄의 현재역 꼬리 — 웹과 같은 공유 fixture(`subway-arrival-tail-cases.json`)

private struct TailCase: Decodable {
    let name: String
    let message: String?
    let currentLocation: String?
    let expect: Bool
}

@Test func currentLocationTailMatchesSharedFixture() throws {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() }
    url.appendPathComponent("src/lib/__tests__/fixtures/subway-arrival-tail-cases.json")
    struct File: Decodable { let cases: [TailCase] }
    let file = try JSONDecoder().decode(File.self, from: Data(contentsOf: url))
    #expect(file.cases.count >= 20)
    for c in file.cases {
        let got = subwayShowsCurrentLocationTail(message: c.message, currentLocation: c.currentLocation)
        #expect(got == c.expect, "\(c.name): \(String(describing: c.message)) / \(String(describing: c.currentLocation))")
    }
}

/// 실패 방향이 현행(붙이는 쪽)인지 — 미지 문법이 들어와도 정보가 사라지지 않는다.
@Test func unknownGrammarKeepsTail() {
    #expect(subwayShowsCurrentLocationTail(message: "우리가 모르는 새 문장", currentLocation: "강일"))
}

/// 문장이 현재역을 담으면 꼬리는 빠진다 — 같은 역이 한 접근성 객체에서 두 번 낭독되던 자리.
@Test func containedStationDropsTail() {
    #expect(!subwayShowsCurrentLocationTail(message: "6분 후 (강일)", currentLocation: "강일"))
}
