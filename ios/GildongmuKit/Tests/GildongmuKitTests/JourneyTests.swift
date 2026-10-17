import Testing
import Foundation
@testable import GildongmuKit

// E70 여정 전이 표(plan Task 4 · spec §6.1) 계약 테스트. 표의 행마다 한 건, 표 밖 (국면, 사건) 쌍은 전부 ignore.

private let journeyId = UUID(uuidString: "00000000-0000-0000-0000-0000000000E7")!

/// 택시 시작 · 하차 지정 · 출구 도보 있음 — 표의 모든 갈래를 지나는 기본 모양.
private let full = JourneyShape(startsWithTaxi: true, alightDesignated: true, hasEgressWalk: true)

private func state(_ phase: JourneyPhase, shape: JourneyShape = full, seq: Int = 5) -> JourneyState {
    JourneyState(journeyId: journeyId, shape: shape, phase: phase, seq: seq)
}

private func step(
    _ s: JourneyState, _ event: JourneyEvent, token: JourneyToken? = nil
) -> JourneyStepResult {
    journeyStep(s, event, token: token ?? s.token)
}

/// 기대: 다음 국면(seq는 언제나 +1) / 종료 / 무시.
enum JourneyExpect: Equatable {
    case next(JourneyPhase)
    case end
    case ignore
}

private func outcome(_ s: JourneyState, _ event: JourneyEvent) -> JourneyExpect {
    switch step(s, event) {
    case .ignore: return .ignore
    case .end: return .end
    case .next(let n):
        // `.next`는 같은 여정·같은 모양을 유지하고 seq만 +1 한다.
        #expect(n.journeyId == s.journeyId)
        #expect(n.shape == s.shape)
        #expect(n.seq == s.seq + 1)
        return .next(n.phase)
    }
}

struct JourneyRow: CustomTestStringConvertible, Sendable {
    let phase: JourneyPhase
    let event: JourneyEvent
    let expect: JourneyExpect
    var testDescription: String { "\(phase) + \(event) -> \(expect)" }
}

private let stageEnds: [JourneyStageEnd] = [.arrived, .userStopped, .startFailed, .ended]
private let allStages: [JourneyStage] = [.taxiIn, .access, .transit, .egress, .taxiOut]

/// 표 전체(`userEnded`는 따로). `rideCompleted`는 모양 의존이라 기본 모양 기준 한 행씩.
private let rows: [JourneyRow] = [
    // running(taxiIn)
    JourneyRow(phase: .running(.taxiIn), event: .stageEnded(.arrived), expect: .next(.transitioning(to: .access))),
    JourneyRow(phase: .running(.taxiIn), event: .taxiDropped, expect: .next(.transitioning(to: .access))),
    JourneyRow(phase: .running(.taxiIn), event: .stageEnded(.userStopped), expect: .end),
    JourneyRow(phase: .running(.taxiIn), event: .stageEnded(.startFailed), expect: .next(.failed(at: .taxiIn))),
    JourneyRow(phase: .running(.taxiIn), event: .stageEnded(.ended), expect: .next(.failed(at: .taxiIn))),
    // running(access)
    JourneyRow(phase: .running(.access), event: .stageEnded(.arrived), expect: .next(.transitioning(to: .transit))),
    JourneyRow(phase: .running(.access), event: .stageEnded(.startFailed), expect: .next(.transitioning(to: .transit))),
    JourneyRow(phase: .running(.access), event: .stageEnded(.ended), expect: .next(.transitioning(to: .transit))),
    JourneyRow(phase: .running(.access), event: .stageEnded(.userStopped), expect: .end),
    // running(transit)
    JourneyRow(phase: .running(.transit), event: .rideCompleted, expect: .next(.transitioning(to: .egress))),
    JourneyRow(phase: .running(.transit), event: .transitStopped, expect: .end),
    // running(egress)
    JourneyRow(phase: .running(.egress), event: .stageEnded(.arrived), expect: .next(.transitioning(to: .taxiOut))),
    JourneyRow(phase: .running(.egress), event: .taxiBoarded, expect: .next(.transitioning(to: .taxiOut))),
    JourneyRow(phase: .running(.egress), event: .stageEnded(.userStopped), expect: .end),
    JourneyRow(phase: .running(.egress), event: .stageEnded(.startFailed), expect: .next(.failed(at: .egress))),
    JourneyRow(phase: .running(.egress), event: .stageEnded(.ended), expect: .next(.failed(at: .egress))),
    // running(taxiOut)
    JourneyRow(phase: .running(.taxiOut), event: .stageEnded(.startFailed), expect: .next(.failed(at: .taxiOut))),
    JourneyRow(phase: .running(.taxiOut), event: .stageEnded(.arrived), expect: .end),
    JourneyRow(phase: .running(.taxiOut), event: .stageEnded(.userStopped), expect: .end),
    JourneyRow(phase: .running(.taxiOut), event: .stageEnded(.ended), expect: .end),
    // failed
    JourneyRow(phase: .failed(at: .taxiIn), event: .taxiDropped, expect: .next(.transitioning(to: .access))),
    JourneyRow(phase: .failed(at: .egress), event: .taxiBoarded, expect: .next(.transitioning(to: .taxiOut))),
] + allStages.flatMap { stage -> [JourneyRow] in
    [
        // transitioning(s)
        JourneyRow(phase: .transitioning(to: stage), event: .prepared(stage), expect: .next(.running(stage))),
        // access는 아래 별도 행(실패 대신 대중교통으로)
        JourneyRow(phase: .transitioning(to: stage), event: .prepFailed,
                   expect: stage == .access ? .next(.transitioning(to: .transit)) : .next(.failed(at: stage))),
        JourneyRow(phase: .transitioning(to: stage), event: .staleTimeout,
                   expect: stage == .access ? .next(.transitioning(to: .transit)) : .next(.failed(at: stage))),
        // failed(s)
        JourneyRow(phase: .failed(at: stage), event: .retry, expect: .next(.transitioning(to: stage))),
    ]
} + [
    // 접근 도보 30m 미만 생략: access를 건너뛰고 대중교통 준비 완료
    JourneyRow(phase: .transitioning(to: .access), event: .prepared(.transit), expect: .next(.running(.transit))),
]

private let allPhases: [JourneyPhase] =
    allStages.map { .running($0) } + allStages.map { .transitioning(to: $0) } + allStages.map { .failed(at: $0) }

private let allEvents: [JourneyEvent] =
    stageEnds.map { .stageEnded($0) }
    + [.taxiDropped, .taxiBoarded, .rideCompleted, .transitStopped]
    + allStages.map { .prepared($0) }
    + [.prepFailed, .retry, .staleTimeout]

@Suite struct JourneyTransitionTests {
    @Test("전이 표의 행", arguments: rows)
    func tableJourneyRow(_ row: JourneyRow) {
        #expect(outcome(state(row.phase), row.event) == row.expect)
    }

    @Test func everythingOutsideTheTableIsIgnored() {
        var checked = 0
        for phase in allPhases {
            for event in allEvents {
                if rows.contains(where: { $0.phase == phase && $0.event == event }) { continue }
                #expect(outcome(state(phase), event) == .ignore, "\(phase) + \(event)")
                checked += 1
            }
        }
        // 모든 (국면, 사건) 쌍에서 표의 행을 뺀 수 — 표 행이 서로 겹치거나 목록 밖이면 숫자가 어긋난다.
        #expect(checked == allPhases.count * allEvents.count - rows.count)
    }

    @Test func userEndedEndsFromEveryPhase() {
        for phase in allPhases {
            #expect(outcome(state(phase), .userEnded) == .end, "\(phase)")
        }
    }

    // MARK: rideCompleted — 모양 의존(위 표 행은 기본 모양 기준)

    @Test func rideCompletedFollowsShape() {
        let walkToStand = JourneyShape(startsWithTaxi: true, alightDesignated: true, hasEgressWalk: true)
        let noEgressWalk = JourneyShape(startsWithTaxi: true, alightDesignated: true, hasEgressWalk: false)
        let noAlight = JourneyShape(startsWithTaxi: true, alightDesignated: false, hasEgressWalk: false)
        // 하차 지정 + 출구 도보 → egress, 출구 후보 없음(none) → 곧장 taxiOut, 하차 미지정 → 여정 끝
        #expect(outcome(state(.running(.transit), shape: walkToStand), .rideCompleted) == .next(.transitioning(to: .egress)))
        #expect(outcome(state(.running(.transit), shape: noEgressWalk), .rideCompleted) == .next(.transitioning(to: .taxiOut)))
        #expect(outcome(state(.running(.transit), shape: noAlight), .rideCompleted) == .end)
        // 하차 미지정이면 hasEgressWalk가 참이어도 끝(모순 입력 방어: alightDesignated가 우선)
        let contradictory = JourneyShape(startsWithTaxi: false, alightDesignated: false, hasEgressWalk: true)
        #expect(outcome(state(.running(.transit), shape: contradictory), .rideCompleted) == .end)
    }

    // MARK: 시작

    @Test func startBeginsTransitioningToFirstStage() {
        let withTaxi = JourneyState.start(id: journeyId, shape: full)
        #expect(withTaxi.phase == .transitioning(to: .taxiIn))
        #expect(withTaxi.seq == 1)
        #expect(withTaxi.token == JourneyToken(journeyId: journeyId, seq: 1))

        let transitFirst = JourneyState.start(
            id: journeyId, shape: JourneyShape(startsWithTaxi: false, alightDesignated: true, hasEgressWalk: false))
        #expect(transitFirst.phase == .transitioning(to: .transit))
        #expect(transitFirst.seq == 1)
    }

    @Test func taxiStartRunsThroughToTaxiOut() {
        // 한 번에 끝까지: 시작 → taxiIn → access(30m 이상) → transit → egress → taxiOut → 끝
        var s = JourneyState.start(id: journeyId, shape: full)
        func advance(_ e: JourneyEvent, expect phase: JourneyPhase) {
            guard case .next(let n) = step(s, e) else { Issue.record("\(e) 가 전이하지 않았다"); return }
            #expect(n.phase == phase)
            s = n
        }
        advance(.prepared(.taxiIn), expect: .running(.taxiIn))
        advance(.taxiDropped, expect: .transitioning(to: .access))
        advance(.prepared(.access), expect: .running(.access))
        advance(.stageEnded(.arrived), expect: .transitioning(to: .transit))
        advance(.prepared(.transit), expect: .running(.transit))
        advance(.rideCompleted, expect: .transitioning(to: .egress))
        advance(.prepared(.egress), expect: .running(.egress))
        advance(.taxiBoarded, expect: .transitioning(to: .taxiOut))
        advance(.prepared(.taxiOut), expect: .running(.taxiOut))
        #expect(step(s, .stageEnded(.arrived)) == .end)
        #expect(s.seq == 9 + 1)   // 전이 아홉 번 + 시작 seq 1
    }

    // MARK: 낡은 사건·경쟁

    @Test func staleTokenIsIgnoredEvenForUserEnded() {
        let s = state(.running(.taxiIn), seq: 5)
        let old = JourneyToken(journeyId: journeyId, seq: 4)
        let future = JourneyToken(journeyId: journeyId, seq: 6)
        let other = JourneyToken(journeyId: UUID(), seq: 5)
        for t in [old, future, other] {
            #expect(step(s, .taxiDropped, token: t) == .ignore)
            #expect(step(s, .userEnded, token: t) == .ignore)
        }
        #expect(step(s, .taxiDropped, token: s.token) != .ignore)
    }

    /// 사용자가 「택시에서 내렸어요」를 누른 직후 자동 도착 판정이 같은 seq로 도착하는 경쟁(Review Focus 4).
    @Test func taxiDroppedThenAutoArrivalWithSameTokenTransitionsOnce() {
        let s = state(.running(.taxiIn))
        let token = s.token
        guard case .next(let after) = journeyStep(s, .taxiDropped, token: token) else {
            Issue.record("첫 사건이 전이하지 않았다")
            return
        }
        #expect(after.phase == .transitioning(to: .access))
        // 두 번째 사건은 같은 (낡은) token을 들고 오므로 새 상태에서 무시된다.
        #expect(journeyStep(after, .stageEnded(.arrived), token: token) == .ignore)
        // 반대 순서도 같다.
        guard case .next(let after2) = journeyStep(s, .stageEnded(.arrived), token: token) else {
            Issue.record("도착이 전이하지 않았다")
            return
        }
        #expect(journeyStep(after2, .taxiDropped, token: token) == .ignore)
    }

    // MARK: 접근 도보 문턱

    @Test func accessWalkThresholdIsThirtyMeters() {
        // 위도 1도 ≈ 111,195m → 29m·31m에 해당하는 위도 차
        let base = 37.5573
        let meter = 1.0 / 111_194.9
        #expect(!journeyNeedsAccessWalk(fromLat: base, fromLng: 126.956, toLat: base + 29 * meter, toLng: 126.956))
        #expect(journeyNeedsAccessWalk(fromLat: base, fromLng: 126.956, toLat: base + 31 * meter, toLng: 126.956))
        #expect(JourneyTuning.accessWalkMinMeters == 30)
        #expect(JourneyTuning.handoffDelayMs == 600)
        #expect(JourneyTuning.staleTransitionSeconds == 30)
    }

    // MARK: 표시 이름(웹 displayStationName 미러 — 공유 fixture 전수)

    private struct DisplayNameFile: Decodable {
        struct Case: Decodable { let input: String; let expected: String }
        let cases: [Case]
    }

    @Test func displayNameSharedFixture() throws {
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { url.deleteLastPathComponent() }
        url.appendPathComponent("src/lib/__tests__/fixtures/journey-display-names.json")
        let file = try JSONDecoder().decode(DisplayNameFile.self, from: Data(contentsOf: url))
        #expect(!file.cases.isEmpty)
        for c in file.cases {
            #expect(journeyStationDisplayName(c.input) == c.expected, "\(c.input)")
        }
    }

    @Test func displayNameExtraCases() {
        #expect(journeyStationDisplayName("인천공항1터미널역 공항철도") == "인천공항1터미널")
    }
}
