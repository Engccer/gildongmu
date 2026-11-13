import Foundation
import Testing
@testable import GildongmuKit

/// 출구 대기(E84) 판정 — 공유 fixture `src/lib/__tests__/fixtures/exit-hold-cases.json`을 레포 상대 경로로 읽는다
/// (사본 금지, `SessionIdleTests` 관례 동형).
private struct FixtureFile: Decodable {
    struct Constants: Decodable {
        let exitHoldMaxSeconds: Double
        let exitHoldRecentWindowSeconds: Double
        let exitHoldStationMaxMeters: Double
        let exitLeadRepeatWindowSeconds: Double
    }
    struct Fix: Decodable {
        let lat: Double
        let lng: Double
        let accuracy: Double
        let ageSeconds: Double
        var value: RouteOriginFix { RouteOriginFix(lat: lat, lng: lng, accuracy: accuracy, ageSeconds: ageSeconds) }
    }
    struct Sample: Decodable {
        let fix: Fix
        let at: Double
        var value: ExitHoldSample { ExitHoldSample(fix: fix.value, at: at) }
    }
    struct Step: Decodable {
        struct Expect: Decodable {
            let kind: String
            let reason: String?
            let accuracy: Double?
            let ageSeconds: Double?
        }
        let name: String
        let elapsed: Double
        let fix: Fix
        let isFirstStorable: Bool
        let stationDistance: Double?
        let recent: [Sample]
        let now: Double
        let expect: Expect
    }
    struct Recent: Decodable {
        struct Expect: Decodable {
            let accuracy: Double
            let ageSeconds: Double
        }
        let name: String
        let samples: [Sample]
        let now: Double
        let expect: Expect?
    }
    struct Prefix: Decodable {
        let name: String
        let hasExit: Bool
        let dropped: Bool
        let secondsSincePosted: Double?
        let expect: Bool
    }
    struct Stationary: Decodable {
        let name: String
        let secondsSinceProgress: Double
        let secondsSinceFix: Double
        let expect: Double
    }
    let constants: Constants
    let steps: [Step]
    let recentBest: [Recent]
    let prefix: [Prefix]
    let stationary: [Stationary]
}

private func loadFixture() throws -> FixtureFile {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() } // GildongmuKitTests→Tests→GildongmuKit→ios→repo
    url.appendPathComponent("src/lib/__tests__/fixtures/exit-hold-cases.json")
    return try JSONDecoder().decode(FixtureFile.self, from: Data(contentsOf: url))
}

@Suite struct ExitHoldTests {
    @Test("상수는 fixture와 같다(잠정값을 바꾸면 fixture도 함께)")
    func constants() throws {
        let c = try loadFixture().constants
        #expect(exitHoldMaxSeconds == c.exitHoldMaxSeconds)
        #expect(exitHoldRecentWindowSeconds == c.exitHoldRecentWindowSeconds)
        #expect(exitHoldStationMaxMeters == c.exitHoldStationMaxMeters)
        #expect(exitLeadRepeatWindowSeconds == c.exitLeadRepeatWindowSeconds)
    }

    @Test("fix 한 건 판정 fixture")
    func steps() throws {
        let steps = try loadFixture().steps
        #expect(steps.count >= 10)
        for s in steps {
            let got = exitHoldStep(
                elapsed: s.elapsed, fix: s.fix.value, isFirstStorable: s.isFirstStorable,
                stationDistance: s.stationDistance, recent: s.recent.map(\.value), now: s.now)
            switch (s.expect.kind, got) {
            case ("wait", .wait), ("abandon", .abandon):
                break
            case let ("fetch", .fetch(origin, reason)):
                #expect(reason.rawValue == s.expect.reason, "\(s.name)")
                #expect(origin.accuracy == s.expect.accuracy, "\(s.name)")
                #expect(origin.ageSeconds == s.expect.ageSeconds, "\(s.name)")
            default:
                Issue.record("\(s.name): expected \(s.expect.kind), got \(got)")
            }
        }
    }

    @Test("최근 창 최선값 fixture")
    func recentBest() throws {
        for r in try loadFixture().recentBest {
            let got = exitHoldRecentBest(samples: r.samples.map(\.value), now: r.now)
            #expect(got?.accuracy == r.expect?.accuracy, "\(r.name)")
            #expect(got?.ageSeconds == r.expect?.ageSeconds, "\(r.name)")
        }
    }

    @Test("출구 문장 접두 fixture — 출구 없음은 언제나 거짓")
    func prefix() throws {
        for p in try loadFixture().prefix {
            #expect(
                exitLeadPrefixNeeded(hasExit: p.hasExit, dropped: p.dropped, secondsSincePosted: p.secondsSincePosted)
                    == p.expect, "\(p.name)")
        }
    }

    @Test("무이동 축 경과 fixture")
    func stationary() throws {
        for s in try loadFixture().stationary {
            #expect(
                exitHoldStationaryElapsed(secondsSinceProgress: s.secondsSinceProgress, secondsSinceFix: s.secondsSinceFix)
                    == s.expect, "\(s.name)")
        }
    }

    @Test("조율값: 출구 대기 창의 두절 임계는 900초")
    func tuning() {
        #expect(GuideTuning.walk.sessionIdleNoFixExitHoldSeconds == 900)
        #expect(GuideTuning.car.sessionIdleNoFixExitHoldSeconds == 900)
    }
}
