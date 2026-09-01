import Foundation
import Testing
@testable import GildongmuKit

/// 하단 2행 파생 계층 공유 시나리오 러너(spec 2026-08-11 §8-1).
///
/// 웹 정본과 같은 공유 fixture(`src/lib/__tests__/fixtures/guide-live-rows-scenarios.json`)와
/// `messages/ko.json`을 레포 상대 경로로 직접 읽어(RouteGuideTests 관례 동형, 사본 금지),
/// 디스크립터를 ko 템플릿으로 렌더한 **최종 문자열**을 대조한다 — 키 존재·인자 어순
/// 드리프트까지 이 파일이 잠근다. 렌더 규칙은 웹 guide-live-rows.test.ts와 동일해야 한다.

private struct LiveScenarioFile: Decodable {
    let scenarios: [LiveScenario]
}

private struct LiveScenario: Decodable {
    let name: String
    /// 수단(문구 키 선택). 미지정 walk.
    let kind: String?
    /// 회전 접근 전환 잔여(m). 미지정 walkTurnApproachMeters.
    let turnApproachM: Double?
    let steps: [Step]
    let baselineD: Double
    let inputs: [Input]
    let expect: [Expectation]

    struct Step: Decodable {
        let len: Double
        let desc: String
        let target: String?
        let anchor: String?
        let action: String?
        /// 서버 횡단 구간 플래그(A26) — 웹 러너와 같은 fixture 필드.
        let crossing: Bool?
    }

    struct Input: Decodable {
        let d: Double
        let phase: String
        let reset: Bool?
        let baselineD: Double?
    }

    struct Expectation: Decodable {
        let afterInput: Int
        let top: String
        let next: String
    }
}

/// ko.json에서 러너가 쓰는 키만 디코딩한다(전체 스키마 종속 금지).
private struct KoMessages: Decodable {
    let guide: Guide

    struct Guide: Decodable {
        let offRoute: String
        let uncertain: String
        let reacquiring: String
        let imminent: [String: String]
        let carImminent: [String: String]
        let carLiveAction: [String: String]
        let liveStraight: String
        let liveStraightNoName: String
        let liveTurnIn: String
        let liveAction: [String: String]
        let nextAction: String
        let nextStraight: String
        let nextStraightNoName: String
        let progressNext: String
    }
}

private func repoURL(_ relative: String) -> URL {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() } // GildongmuKitTests→Tests→GildongmuKit→ios→repo
    url.appendPathComponent(relative)
    return url
}

private func fmt(_ template: String, _ args: [String: String]) -> String {
    var out = template
    for (key, value) in args {
        out = out.replacingOccurrences(of: "{\(key)}", with: value)
    }
    return out
}

private func phaseFrom(_ raw: String) -> GuidePhase {
    switch raw {
    case "following": return .following
    case "bundle": return .bundle
    case "uncertain": return .uncertain
    case "reacquiring": return .reacquiring
    case "offRoute": return .offRoute
    case "finalApproach": return .finalApproach
    default: fatalError("unknown phase \(raw)")
    }
}

/// 행동 구는 수단별이다(K2 §4) — 디스크립터는 같고 렌더 키만 갈린다(GuideText 동형).
private func renderTop(_ top: LiveTopRow?, _ g: KoMessages.Guide, car: Bool) -> String {
    guard let top else { return "" }
    let phrases = car ? g.carLiveAction : g.liveAction
    let imminents = car ? g.carImminent : g.imminent
    switch top {
    case .offRoute: return g.offRoute
    case .uncertain: return g.uncertain
    case .reacquiring: return g.reacquiring
    case let .crossing(text): return text
    case let .turnSoon(action): return imminents[action.rawValue] ?? ""
    case let .turnIn(meters, action):
        return fmt(g.liveTurnIn, ["n": String(meters), "action": phrases[action.rawValue] ?? ""])
    case let .straight(meters, target):
        guard let target else { return fmt(g.liveStraightNoName, ["n": String(meters)]) }
        return fmt(g.liveStraight, ["target": target, "n": String(meters)])
    }
}

private func renderNext(_ next: LiveNextRow?, _ g: KoMessages.Guide, car: Bool) -> String {
    guard let next else { return "" }
    let phrases = car ? g.carLiveAction : g.liveAction
    let step: String
    switch next {
    case let .action(action, anchor):
        let phrase = phrases[action.rawValue] ?? ""
        step = anchor.map { fmt(g.nextAction, ["anchor": $0, "action": phrase]) } ?? phrase
    case let .straight(meters, target):
        step = target.map { fmt(g.nextStraight, ["target": $0, "n": String(meters)]) }
            ?? fmt(g.nextStraightNoName, ["n": String(meters)])
    case let .crossing(action), let .turn(action):
        step = phrases[action.rawValue] ?? ""
    }
    return fmt(g.progressNext, ["step": step])
}

@Test func liveRowsSharedScenarioTable() throws {
    let file = try JSONDecoder().decode(
        LiveScenarioFile.self,
        from: Data(contentsOf: repoURL("src/lib/__tests__/fixtures/guide-live-rows-scenarios.json"))
    )
    let ko = try JSONDecoder().decode(
        KoMessages.self, from: Data(contentsOf: repoURL("messages/ko.json"))
    )
    for sc in file.scenarios {
        var acc = 0.0
        let steps: [LiveStepInput] = sc.steps.map { s in
            let input = LiveStepInput(
                description: s.desc, startD: acc, endD: acc + s.len,
                target: s.target, anchor: s.anchor,
                action: s.action.flatMap(WalkAction.init(rawValue:)),
                crossing: s.crossing ?? false
            )
            acc += s.len
            return input
        }
        let car = sc.kind == "car"
        let units = buildDisplayUnits(steps)
        var state: LiveRowsState?
        var baselineD = sc.baselineD
        var results: [(top: String, next: String)] = []
        for input in sc.inputs {
            if input.reset == true {
                state = nil
                if let b = input.baselineD { baselineD = b }
            }
            let out = guideLiveRows(
                prev: state, units: units, d: input.d,
                baselineD: baselineD, phase: phaseFrom(input.phase),
                turnApproachM: sc.turnApproachM ?? walkTurnApproachMeters
            )
            state = out.state
            results.append((renderTop(out.top, ko.guide, car: car), renderNext(out.next, ko.guide, car: car)))
        }
        for ex in sc.expect {
            #expect(results[ex.afterInput].top == ex.top, "\(sc.name) #\(ex.afterInput) top")
            #expect(results[ex.afterInput].next == ex.next, "\(sc.name) #\(ex.afterInput) next")
        }
    }
}

/// 횡단 유닛 판정은 서버 플래그로(A26) — ko "건너" 부분 문자열에 의존하지 않는다.
@Suite("횡단 유닛 판정(언어 무관)")
struct CrossingStepTests {
    @Test("행동이 crosswalk/underpass이고 서버가 crossing을 표시했을 때만 참")
    func flagDecides() {
        #expect(isCrossingStep(.crosswalk, crossing: true))
        #expect(isCrossingStep(.underpass, crossing: true))
        #expect(!isCrossingStep(.left, crossing: true))
        #expect(!isCrossingStep(.crosswalk, crossing: false))
        #expect(!isCrossingStep(nil, crossing: true))
    }

    @Test("en 문장(Tmap)도 플래그만 있으면 횡단 유닛이 된다")
    func englishCrossingUnit() {
        let steps = [
            LiveStepInput(description: "Walk 50m", startD: 0, endD: 50),
            LiveStepInput(
                description: "Cross the crosswalk, then walk 30m", startD: 50, endD: 80,
                action: .crosswalk, crossing: true),
            LiveStepInput(description: "Turn left, then walk 40m", startD: 80, endD: 120, action: .left),
        ]
        let units = buildDisplayUnits(steps)
        #expect(units.map(\.crossing) == [false, true, false])
        #expect(units[1].crossingText == "Cross the crosswalk, then walk 30m")
        #expect(units[0].endAction == .crosswalk)
    }

    @Test("플래그 없는 crosswalk 행동(지명 '횡단보도' 이동 스텝)은 횡단 유닛이 아니다")
    func placeNameIsNotCrossing() {
        let steps = [
            LiveStepInput(description: "천호역 횡단보도까지 100m 이동", startD: 0, endD: 100, action: .crosswalk)
        ]
        #expect(buildDisplayUnits(steps)[0].crossing == false)
    }

    @Test("liveStepsFrom은 응답 스텝의 crossing을 표시 입력으로 옮긴다")
    func liveStepsCarryCrossing() throws {
        let route = try #require(buildGuideRoute([
            GuideStepGeometry(
                description: "a",
                pathCoords: [RoutePoint(lat: 37.5, lng: 127.1), RoutePoint(lat: 37.5001, lng: 127.1)]),
            GuideStepGeometry(
                description: "b",
                pathCoords: [RoutePoint(lat: 37.5001, lng: 127.1), RoutePoint(lat: 37.5002, lng: 127.1)],
                action: .crosswalk),
        ]))
        let out = liveStepsFrom(route: route, steps: [
            (target: nil, anchor: nil, crossing: false),
            (target: nil, anchor: nil, crossing: true),
        ])
        #expect(out[0].crossing == false)
        #expect(out[1].crossing == true)
        #expect(out[1].action == .crosswalk)
    }
}
