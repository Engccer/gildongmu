import Foundation
import Testing
@testable import GildongmuKit

/// 웹 정본과 같은 공유 fixture(`src/lib/__tests__/fixtures/manual-location-scenarios.json`)를
/// 소비해 두 판정이 갈리지 않게 한다(드리프트 가드).
private struct Scenarios: Decodable {
    struct FixJSON: Decodable { let lat: Double; let lng: Double; let accuracy: Double; let at: Double }
    struct ManualJSON: Decodable {
        let revision: Int; let label: String; let lat: Double; let lng: Double
        let origin: FixJSON?; let setAt: Double
    }
    struct Case: Decodable {
        let name: String; let manual: ManualJSON; let fix: FixJSON?
        let now: Double; let expect: String
    }
    let cases: [Case]
}

private func loadScenarios() throws -> Scenarios {
    // Kit 테스트는 repo 루트 기준 상대 경로로 웹 fixture를 읽는다(기존 관례).
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() } // GildongmuKitTests→Tests→GildongmuKit→ios→repo
    url.appendPathComponent("src/lib/__tests__/fixtures/manual-location-scenarios.json")
    return try JSONDecoder().decode(Scenarios.self, from: Data(contentsOf: url))
}

@Test func 공유_fixture로_웹과_같은_판정을_낸다() throws {
    let scenarios = try loadScenarios()
    #expect(scenarios.cases.count >= 10)
    for c in scenarios.cases {
        let manual = ManualLocation(
            revision: c.manual.revision, label: c.manual.label,
            lat: c.manual.lat, lng: c.manual.lng,
            origin: c.manual.origin.map { ManualFix(lat: $0.lat, lng: $0.lng, accuracy: $0.accuracy, at: $0.at) },
            setAt: c.manual.setAt
        )
        let fix = c.fix.map { ManualFix(lat: $0.lat, lng: $0.lng, accuracy: $0.accuracy, at: $0.at) }
        let verdict = judgeManualLocation(manual: manual, fix: fix, now: c.now)
        #expect(verdict.rawValue == c.expect, "\(c.name): got \(verdict.rawValue), want \(c.expect)")
    }
}

@Test func 상수가_웹과_같고_두_축이_분리돼_있다() {
    #expect(ManualLocationPolicy.movedMeters == 100)
    #expect(ManualLocationPolicy.judgeCeilingMeters == 100)
    #expect(ManualLocationPolicy.fixMaxAgeSeconds == 10)
}

/// 소스 가드(Task 13): 안내(BeaconModel)는 수동 위치를 참조하지 않는다 — 실좌표만
/// 쓴다. `effectiveCoordinate`를 부르는 순간 이 불변식이 깨진다.
@Test func 안내_모델이_수동_위치를_참조하지_않는다() throws {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() } // GildongmuKitTests→Tests→GildongmuKit→ios→repo
    url.appendPathComponent("ios/Gildongmu/Directions/BeaconModel.swift")
    let src = try String(contentsOf: url, encoding: .utf8)
    #expect(!src.contains("effectiveCoordinate"), "안내는 실좌표만 쓴다")
}
