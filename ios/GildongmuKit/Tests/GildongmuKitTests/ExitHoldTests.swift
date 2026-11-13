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
        let exitHoldObservationGapSeconds: Double
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
        let storableSince: Double?
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
    struct StorableRun: Decodable {
        let name: String
        let previousStart: Double?
        let previousSampleAt: Double?
        let now: Double
        let expect: Double
    }
    /// 순서 있는 시나리오: 세션 시작(0초)부터 fix·창 닫힘·워치독 틱을 차례로 먹인다.
    struct IdleScenario: Decodable {
        struct Event: Decodable {
            let t: Double
            let kind: String
            let progressed: Bool?
            let expect: String?
        }
        let name: String
        let hold: Bool
        let events: [Event]
    }
    let constants: Constants
    let steps: [Step]
    let recentBest: [Recent]
    let prefix: [Prefix]
    let storableRun: [StorableRun]
    let idleScenarios: [IdleScenario]
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
        #expect(exitHoldObservationGapSeconds == c.exitHoldObservationGapSeconds)
    }

    @Test("fix 한 건 판정 fixture")
    func steps() throws {
        let steps = try loadFixture().steps
        #expect(steps.count >= 14)
        for s in steps {
            let got = exitHoldStep(
                elapsed: s.elapsed, fix: s.fix.value, isFirstStorable: s.isFirstStorable,
                stationDistance: s.stationDistance, recent: s.recent.map(\.value), storableSince: s.storableSince,
                now: s.now)
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

    @Test("보관 가능 fix 연속 구간 fixture")
    func storableRun() throws {
        for r in try loadFixture().storableRun {
            #expect(
                exitHoldStorableRunStart(previousStart: r.previousStart, previousSampleAt: r.previousSampleAt, now: r.now)
                    == r.expect, "\(r.name)")
        }
    }

    /// 창과 잊힌 세션 안전망 — **순서 있는 시나리오**. 산술 한 줄이 아니라 「긴 두절 뒤 첫 fix」「창이 닫힌 직후」의
    /// 틱에서 세션이 끝나지 않는지를 본다(코드 리뷰 M1 재현 셋). 모델 배선(fix마다 하한 갱신 → 틱마다 판정)을 그대로 따른다.
    @Test("창과 안전망 시나리오 fixture — 출구 없는 세션은 종전과 같다")
    func idleScenarios() throws {
        let scenarios = try loadFixture().idleScenarios
        #expect(scenarios.count >= 10)
        for scenario in scenarios {
            var lastFixAt: Double?
            var lastProgressAt: Double?
            var floors = ExitHoldIdleFloors()
            var holdActive = scenario.hold
            for event in scenario.events {
                switch event.kind {
                case "fix":
                    if holdActive {
                        floors = exitHoldIdleFloorsAfterFix(
                            floors, now: event.t, previousFixAt: lastFixAt, startedAt: 0).floors
                    }
                    lastFixAt = event.t
                    if event.progressed == true { lastProgressAt = event.t }
                case "close":
                    holdActive = false
                    floors = exitHoldIdleFloorsAfterClose(now: event.t)
                case "tick":
                    let got = exitHoldAwareSessionIdleStep(
                        now: event.t, startedAt: 0, lastFixAt: lastFixAt, lastProgressAt: lastProgressAt,
                        floors: floors, holdActive: holdActive, tuning: .walk, presumedArrivalCanFire: false)
                    #expect(got?.rawValue == event.expect, "\(scenario.name) t=\(event.t)")
                    if !scenario.hold {
                        // 출구 없는 세션: 종전 식(`max(startedAt, last ?? startedAt)` + `sessionIdleStep`)과 같은 값이다.
                        let legacy = sessionIdleStep(
                            secondsSinceUsableFix: event.t - max(0, lastFixAt ?? 0),
                            secondsSinceProgress: sessionIdleStationaryElapsed(
                                secondsSinceProgress: event.t - max(0, lastProgressAt ?? 0), presumedArrivalCanFire: false),
                            noFixSeconds: GuideTuning.walk.sessionIdleNoFixSeconds)
                        #expect(got == legacy, "\(scenario.name) t=\(event.t) legacy")
                    }
                default:
                    Issue.record("\(scenario.name): unknown event \(event.kind)")
                }
            }
        }
    }

    @Test("자동차 조율값은 창이 없어도 무이동 축이 없다")
    func carHasNoStationaryAxis() {
        #expect(exitHoldAwareSessionIdleStep(
            now: 800, startedAt: 0, lastFixAt: 799, lastProgressAt: nil, floors: ExitHoldIdleFloors(),
            holdActive: false, tuning: .car, presumedArrivalCanFire: false) == nil)
    }

    @Test("조율값: 출구 대기 창의 두절 임계는 900초")
    func tuning() {
        #expect(GuideTuning.walk.sessionIdleNoFixExitHoldSeconds == 900)
        #expect(GuideTuning.car.sessionIdleNoFixExitHoldSeconds == 900)
    }
}
