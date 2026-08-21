import Testing
@testable import GildongmuKit

struct GuideBandTests {
    @Test func 목적지_변경_대기가_최우선이다() {
        let s = guideBandSummary(phase: .riding, boardStop: "A", line: "2호선", remaining: 3,
                                 hasWalkHandoff: false, destChangeLabel: "학교")
        #expect(s == .destChangePending(label: "학교"))
    }

    @Test func 목적지_변경_실패는_대기와_구분된다() {
        let s = guideBandSummary(phase: .riding, boardStop: nil, line: nil, remaining: nil,
                                 hasWalkHandoff: false, destChangeLabel: "학교", destChangeFailed: true)
        #expect(s == .destChangeFailed(label: "학교"))
    }

    @Test func 핸드오프_제안은_state가_없어도_도착이다() {
        let s = guideBandSummary(phase: nil, boardStop: nil, line: nil, remaining: nil,
                                 hasWalkHandoff: true, destChangeLabel: nil)
        #expect(s == .arrived)
    }

    @Test func waiting과_boarding은_같은_대기_요약이다() {
        for phase in [TransitPhase.waiting, .boarding] {
            let s = guideBandSummary(phase: phase, boardStop: "천호역", line: "5호선", remaining: nil,
                                     hasWalkHandoff: false, destChangeLabel: nil)
            #expect(s == .waiting(stop: "천호역", line: "5호선"))
        }
    }

    @Test func riding은_잔여_수_유무를_보존한다() {
        #expect(guideBandSummary(phase: .riding, boardStop: nil, line: "370", remaining: 4,
                                 hasWalkHandoff: false, destChangeLabel: nil) == .riding(line: "370", remaining: 4))
        #expect(guideBandSummary(phase: .riding, boardStop: nil, line: "370", remaining: nil,
                                 hasWalkHandoff: false, destChangeLabel: nil) == .riding(line: "370", remaining: nil))
    }

    @Test func 도착_완료_국면은_arrived다() {
        for phase in [TransitPhase.arrived, .done] {
            #expect(guideBandSummary(phase: phase, boardStop: nil, line: nil, remaining: nil,
                                     hasWalkHandoff: false, destChangeLabel: nil) == .arrived)
        }
    }

    @Test func 아무것도_없으면_nil이다() {
        #expect(guideBandSummary(phase: nil, boardStop: nil, line: nil, remaining: nil,
                                 hasWalkHandoff: false, destChangeLabel: nil) == nil)
    }
}
