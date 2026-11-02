import Foundation
import Testing
@testable import GildongmuKit

// E70 여정 전이 표 공유 fixture(웹 `src/lib/journey/journey-step.ts` 미러, E70-f spec 2026-11-02 §7.2).
// 웹 vitest `journey-step.test.ts`와 같은 파일을 읽는다 — 표가 갈리면 같은 여정이 iOS와 웹에서 다른 단계로 간다.

private struct StepFile: Decodable {
    let starts: [Start]
    let cases: [Case]

    struct Shape: Decodable {
        let startsWithTaxi: Bool
        let alightDesignated: Bool
        let hasEgressWalk: Bool
        var kit: JourneyShape {
            JourneyShape(startsWithTaxi: startsWithTaxi, alightDesignated: alightDesignated, hasEgressWalk: hasEgressWalk)
        }
    }
    struct Phase: Decodable {
        let kind: String
        let stage: String
    }
    struct Event: Decodable {
        let kind: String
        let reason: String?
        let stage: String?
    }
    struct Start: Decodable {
        let shape: Shape
        let expect: Phase
    }
    struct Case: Decodable {
        let shape: Shape
        let phase: Phase
        let event: Event
        /// "ignore" · "end" 또는 다음 phase
        let expect: Expect
    }
    enum Expect: Decodable {
        case word(String)
        case phase(Phase)
        init(from decoder: Decoder) throws {
            let c = try decoder.singleValueContainer()
            if let s = try? c.decode(String.self) { self = .word(s) } else { self = .phase(try c.decode(Phase.self)) }
        }
    }
}

private func stage(_ s: String) -> JourneyStage { JourneyStage(rawValue: s)! }

private func phase(_ p: StepFile.Phase) -> JourneyPhase {
    switch p.kind {
    case "running": .running(stage(p.stage))
    case "transitioning": .transitioning(to: stage(p.stage))
    default: .failed(at: stage(p.stage))
    }
}

private func event(_ e: StepFile.Event) -> JourneyEvent {
    switch e.kind {
    case "stageEnded":
        switch e.reason {
        case "arrived": .stageEnded(.arrived)
        case "userStopped": .stageEnded(.userStopped)
        case "startFailed": .stageEnded(.startFailed)
        default: .stageEnded(.ended)
        }
    case "taxiDropped": .taxiDropped
    case "taxiBoarded": .taxiBoarded
    case "rideCompleted": .rideCompleted
    case "transitStopped": .transitStopped
    case "prepared": .prepared(stage(e.stage ?? ""))
    case "prepFailed": .prepFailed
    case "retry": .retry
    case "userEnded": .userEnded
    default: .staleTimeout
    }
}

private func loadStepFile() throws -> StepFile {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() }
    url.appendPathComponent("src/lib/__tests__/fixtures/journey-step-cases.json")
    return try JSONDecoder().decode(StepFile.self, from: Data(contentsOf: url))
}

@Test func journeyStepSharedStarts() throws {
    let file = try loadStepFile()
    for s in file.starts {
        #expect(JourneyState.start(id: UUID(), shape: s.shape.kit).phase == phase(s.expect))
    }
}

@Test func journeyStepSharedTable() throws {
    let file = try loadStepFile()
    #expect(file.cases.count > 250)
    let id = UUID()
    for c in file.cases {
        let state = JourneyState(journeyId: id, shape: c.shape.kit, phase: phase(c.phase), seq: 3)
        let result = journeyStep(state, event(c.event), token: JourneyToken(journeyId: id, seq: 3))
        let note = Comment(rawValue: "\(c.phase.kind).\(c.phase.stage) + \(c.event.kind)\(c.event.reason.map { "(\($0))" } ?? "")\(c.event.stage.map { "(\($0))" } ?? "")")
        switch (c.expect, result) {
        case (.word("ignore"), .ignore), (.word("end"), .end):
            break
        case (.phase(let p), .next(let next)):
            #expect(next.phase == phase(p), note)
            #expect(next.seq == 4, note)
        default:
            Issue.record(note)
        }
    }
}
