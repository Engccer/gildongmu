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

// ── 도착 추정 판정 fixture 동조 (spec 2026-08-13) ──

private struct PresumedFixtureFile: Decodable {
    let stepScenarios: [PresumedStepScenario]
    let anchorScenarios: [AnchorScenario]
}

private struct PresumedStepScenario: Decodable {
    let name: String
    let profile: String
    let input: Input
    let expect: String?

    struct Input: Decodable {
        let inFinalApproach: Bool
        let secondsSinceUsableFix: Double
        let secondsSinceProgress: Double
        let lastKnownDistanceToDestMeters: Double?
    }
}

private struct AnchorScenario: Decodable {
    let name: String
    let epsilonMeters: Double
    let steps: [[Double]]
    let expectProgressedAt: [Int]
}

private func loadPresumedFixture() throws -> PresumedFixtureFile {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() }
    url.appendPathComponent("src/lib/__tests__/fixtures/presumed-arrival-scenarios.json")
    return try JSONDecoder().decode(PresumedFixtureFile.self, from: Data(contentsOf: url))
}

private func thresholds(for profile: String) throws -> PresumedArrivalThresholds {
    switch profile {
    case "walk": return .walk
    case "car": return .car
    default: throw NSError(domain: "fixture", code: 1, userInfo: [NSLocalizedDescriptionKey: "미지 프로파일 \(profile)"])
    }
}

@Test("도착 추정 판정 공유 fixture 동조")
func presumedArrivalMatchesSharedFixture() throws {
    for s in try loadPresumedFixture().stepScenarios {
        let got = presumedArrivalStep(
            inFinalApproach: s.input.inFinalApproach,
            secondsSinceUsableFix: s.input.secondsSinceUsableFix,
            secondsSinceProgress: s.input.secondsSinceProgress,
            lastKnownDistanceToDestMeters: s.input.lastKnownDistanceToDestMeters,
            thresholds: try thresholds(for: s.profile)
        )
        #expect(got?.rawValue == s.expect, "\(s.name)")
    }
}

@Test("프로파일: car는 두절이 더 짧고 나머지는 같다 (spec 2026-08-31 §3.2)")
func presumedArrivalProfiles() {
    #expect(PresumedArrivalThresholds.car.noFixSeconds < PresumedArrivalThresholds.walk.noFixSeconds)
    #expect(PresumedArrivalThresholds.car.stationarySeconds == PresumedArrivalThresholds.walk.stationarySeconds)
    #expect(PresumedArrivalThresholds.car.maxDistanceMeters == PresumedArrivalThresholds.walk.maxDistanceMeters)
}

@Test("진행 앵커 공유 fixture 동조")
func progressAnchorMatchesSharedFixture() throws {
    for s in try loadPresumedFixture().anchorScenarios {
        var anchor: RoutePoint? = nil
        var progressedAt: [Int] = []
        for (i, step) in s.steps.enumerated() {
            let out = advanceProgressAnchor(
                anchor: anchor, fix: toPoint(step), epsilonMeters: s.epsilonMeters
            )
            anchor = out.anchor
            if out.progressed { progressedAt.append(i) }
        }
        #expect(progressedAt == s.expectProgressedAt, "\(s.name)")
    }
}

@Test("도착 추정 무효 입력은 none")
func presumedArrivalRejectsInvalidInput() {
    #expect(presumedArrivalStep(
        inFinalApproach: true, secondsSinceUsableFix: -1,
        secondsSinceProgress: 0, lastKnownDistanceToDestMeters: 20, thresholds: .walk) == nil)
    #expect(presumedArrivalStep(
        inFinalApproach: true, secondsSinceUsableFix: .nan,
        secondsSinceProgress: 0, lastKnownDistanceToDestMeters: 20, thresholds: .walk) == nil)
    #expect(presumedArrivalStep(
        inFinalApproach: true, secondsSinceUsableFix: 200,
        secondsSinceProgress: .infinity, lastKnownDistanceToDestMeters: 20, thresholds: .walk) == nil)
    #expect(presumedArrivalStep(
        inFinalApproach: true, secondsSinceUsableFix: 200,
        secondsSinceProgress: 0, lastKnownDistanceToDestMeters: -5, thresholds: .walk) == nil)
}
