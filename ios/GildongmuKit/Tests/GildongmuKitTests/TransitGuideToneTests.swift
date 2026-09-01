import Foundation
import Testing
@testable import GildongmuKit

/// 웹 정본과 같은 공유 fixture(`transit-guide-tone-scenarios.json`)를 읽어 리듀서
/// (`transitGuideStep`)와 층(`transitToneStep`)을 **이어서** 돌린다(spec 2026-09-02 §2.7 —
/// 층 단독 fixture는 phaseGen 리셋·신호 전이·도착 억제를 지나지 않는다). routes·locks는
/// `transit-guide-scenarios.json`을 참조한다(TransitGuideTests 관례, 사본 금지).

private struct BaseFixture: Decodable {
    let routes: [String: TransitGuideRoute]
    let locks: [String: TransitLock]
}

private struct ToneFixture: Decodable {
    let scenarios: [Scenario]
    struct Scenario: Decodable {
        let name: String
        let route: String
        let steps: [Step]
    }
    struct Step: Decodable {
        let at: Double
        let input: Input
        let expect: Expect
    }
    struct Input: Decodable {
        let kind: String
        let lock: String?
        let seq: Int?
        let phaseGen: Int?
        let poll: Poll?
    }
    struct Poll: Decodable {
        let kind: String
        let items: [TransitTrackItem]?
    }
    struct Expect: Decodable {
        // "명시 null"(무음·앵커 없음·이벤트 없음)과 "미지정"을 구분한다.
        let tone: String??
        let anchor: Int??
        let event: String??
        let phase: String?
        let signal: String?

        enum CodingKeys: String, CodingKey { case tone, anchor, event, phase, signal }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            tone = c.contains(.tone) ? .some(try c.decodeIfPresent(String.self, forKey: .tone)) : .none
            anchor = c.contains(.anchor) ? .some(try c.decodeIfPresent(Int.self, forKey: .anchor)) : .none
            event = c.contains(.event) ? .some(try c.decodeIfPresent(String.self, forKey: .event)) : .none
            phase = try c.decodeIfPresent(String.self, forKey: .phase)
            signal = try c.decodeIfPresent(String.self, forKey: .signal)
        }
    }
}

private func fixtureURL(_ name: String) -> URL {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() } // GildongmuKitTests→Tests→GildongmuKit→ios→repo
    url.appendPathComponent("src/lib/__tests__/fixtures/\(name)")
    return url
}

private func toInput(_ raw: ToneFixture.Input, locks: [String: TransitLock]) throws -> TransitGuideInput {
    switch raw.kind {
    case "board":
        guard let ref = raw.lock, let lock = locks[ref] else { throw FixtureError.badLock }
        return .board(lock)
    case "confirmBoarded": return .confirmBoarded
    case "restoreBoarding": return .restoreBoarding
    case "changeBoarding": return .changeBoarding
    case "advance": return .advance
    case "poll":
        guard let seq = raw.seq, let gen = raw.phaseGen, let p = raw.poll else { throw FixtureError.badPoll }
        let poll: TransitTrackPoll = switch p.kind {
        case "ok": .ok(p.items ?? [])
        case "empty": .empty
        case "unsupported": .unsupported
        case "failed": .failed
        default: throw FixtureError.badPoll
        }
        return .poll(seq: seq, phaseGen: gen, poll: poll)
    default:
        throw FixtureError.badKind(raw.kind)
    }
}

private enum FixtureError: Error { case badLock, badPoll, badKind(String) }

private func eventKind(_ e: TransitGuideEvent?) -> String? {
    guard let e else { return nil }
    switch e {
    case .boarded: return "boarded"
    case .vehicleSelected: return "vehicleSelected"
    case .approaching: return "approaching"
    case .vehiclePassed: return "vehiclePassed"
    case .trackingStarted: return "trackingStarted"
    case .countdown: return "countdown"
    case .messageChanged: return "messageChanged"
    case .arrived: return "arrived"
    case .backOnTrack: return "backOnTrack"
    case .approxVehicleChanged: return "approxVehicleChanged"
    case .signalLost: return "signalLost"
    case .neverSeen: return "neverSeen"
    case .upstreamFailed: return "upstreamFailed"
    case .signalRecovered: return "signalRecovered"
    case .legAdvanced: return "legAdvanced"
    case .boardingReset: return "boardingReset"
    case .capSlowed: return "capSlowed"
    }
}

struct TransitGuideToneTests {
    @Test func sharedFixtureScenarios() throws {
        let base = try JSONDecoder().decode(BaseFixture.self, from: Data(contentsOf: fixtureURL("transit-guide-scenarios.json")))
        let tone = try JSONDecoder().decode(ToneFixture.self, from: Data(contentsOf: fixtureURL("transit-guide-tone-scenarios.json")))
        #expect(!tone.scenarios.isEmpty)
        for scenario in tone.scenarios {
            guard let route = base.routes[scenario.route] else {
                Issue.record("route 없음: \(scenario.route)")
                continue
            }
            var state = initTransitGuide(route: route, now: 0)
            var toneState = TransitToneState.initial
            for (i, step) in scenario.steps.enumerated() {
                let ctx = "\(scenario.name) step \(i)"
                let before = state
                let result = transitGuideStep(state: before, input: try toInput(step.input, locks: base.locks), route: route, now: step.at)
                state = result.state
                let out = transitToneStep(state: toneState, before: before, after: result.state, event: result.event, now: step.at / 1000)
                toneState = out.state
                if case let .some(expected) = step.expect.tone {
                    #expect(out.tone?.rawValue == expected, Comment(rawValue: ctx))
                }
                if case let .some(anchor) = step.expect.anchor {
                    #expect(toneState.anchorRemaining == anchor, Comment(rawValue: ctx))
                }
                if case let .some(event) = step.expect.event {
                    #expect(eventKind(result.event) == event, Comment(rawValue: "\(ctx) event"))
                }
                if let phase = step.expect.phase {
                    #expect(result.state.phase.rawValue == phase, Comment(rawValue: ctx))
                }
                if let signal = step.expect.signal {
                    #expect(result.state.signal.rawValue == signal, Comment(rawValue: ctx))
                }
            }
        }
    }

    @Test func certainArrivalFreezesLayer() {
        let s = TransitToneState(anchorRemaining: 3, wasUnreliable: true, lastUnreliableAt: 0)
        let out = transitToneLayerStep(
            state: s,
            input: TransitToneInput(unreliable: true, eventOwned: false, remaining: 0, arrivedCertain: true),
            now: 500)
        #expect(out.tone == nil)
        #expect(out.state == s)
    }

    @Test func eventOwnedBeatsUnreliableAndRebasesTimer() {
        let s = TransitToneState(anchorRemaining: 5, wasUnreliable: true, lastUnreliableAt: 0)
        let out = transitToneLayerStep(
            state: s,
            input: TransitToneInput(unreliable: true, eventOwned: true, remaining: nil, arrivedCertain: false),
            now: 300)
        #expect(out.tone == nil)
        #expect(out.state.lastUnreliableAt == 300)
        let quiet = TransitToneInput(unreliable: true, eventOwned: false, remaining: nil, arrivedCertain: false)
        #expect(transitToneLayerStep(state: out.state, input: quiet, now: 300 + transitUnreliableIntervalSeconds - 1).tone == nil)
        #expect(transitToneLayerStep(state: out.state, input: quiet, now: 300 + transitUnreliableIntervalSeconds).tone == .unreliable)
    }
}
