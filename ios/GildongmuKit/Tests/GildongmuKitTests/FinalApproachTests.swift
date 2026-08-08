import Foundation
import Testing
@testable import GildongmuKit

/// 웹 정본과 같은 공유 fixture(`src/lib/__tests__/fixtures/final-approach-scenarios.json`)를
/// 레포 상대 경로로 직접 읽어 같은 경계표를 단언한다(사본 금지 — 드리프트 원천 차단,
/// `RouteGuideTests` 관례 동형).
private let mPerDegLat = 111_320.0
private let mPerDegLng = 111_320.0 * cos(37.5 * .pi / 180)

private struct FixtureFile: Decodable {
    let scenarios: [Scenario]
}

private struct Scenario: Decodable {
    let name: String
    let segments: [[Double]]
    let dest: [Double]
    let expect: Expect

    struct Expect: Decodable {
        let offsetMeters: Double?
        let relativeBearing: Double?
        let bearingUnavailable: String?
        let direction: String?
    }
}

private func loadScenarios() throws -> [Scenario] {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() } // GildongmuKitTests→Tests→GildongmuKit→ios→repo
    url.appendPathComponent("src/lib/__tests__/fixtures/final-approach-scenarios.json")
    let data = try Data(contentsOf: url)
    return try JSONDecoder().decode(FixtureFile.self, from: data).scenarios
}

private func toPoint(_ v: [Double]) -> RoutePoint {
    RoutePoint(lat: 37.5 + v[0] / mPerDegLat, lng: 127.1 + v[1] / mPerDegLng)
}

@Test("공유 fixture 동조")
func finalApproachMatchesSharedFixture() throws {
    for s in try loadScenarios() {
        let route = try #require(
            buildGuideRoute([
                GuideStepGeometry(description: "고정", pathCoords: s.segments.map(toPoint))
            ]),
            "\(s.name) 경로 조립"
        )
        let out = try #require(
            computeFinalApproach(route: route, dest: toPoint(s.dest)), "\(s.name) 기하"
        )
        if let want = s.expect.offsetMeters {
            #expect(abs(out.offsetMeters - want) < 1.0, "\(s.name) 오프셋")
        }
        if let want = s.expect.relativeBearing {
            let got = try #require(out.relativeBearing, "\(s.name) 상대각 존재")
            #expect(abs(got - want) < 1.0, "\(s.name) 상대각")
        }
        if let want = s.expect.bearingUnavailable {
            #expect(out.bearingUnavailable?.rawValue == want, "\(s.name) 부재 사유")
            #expect(out.relativeBearing == nil, "\(s.name) 상대각은 비어야 한다")
        }
        if let want = s.expect.direction {
            let got = try #require(out.relativeBearing, "\(s.name) 상대각 존재")
            #expect(relativeDirection(got).rawValue == want, "\(s.name) 방향")
        }
    }
}

@Test("4분할 경계 소유권 — 부등호까지 웹과 같다")
func relativeDirectionBoundaries() {
    let table: [(Double, RelativeDirection)] = [
        (0, .ahead), (45, .ahead), (45.1, .right),
        (-45, .ahead), (-45.1, .left),
        (135, .right), (135.1, .behind),
        (-135, .left), (-135.1, .behind),
        (180, .behind), (-180, .behind),
    ]
    for (theta, want) in table {
        #expect(relativeDirection(theta) == want, "\(theta)도")
    }
}
