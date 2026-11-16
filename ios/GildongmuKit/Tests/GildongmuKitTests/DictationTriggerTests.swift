import Testing
@testable import GildongmuKit

@Suite("dictationTriggerResponse (화면을 겨냥하지 않는 받아쓰기, E82 판정 10)")
struct DictationTriggerTests {
    private func c(_ id: Int, frontmost: Bool = true, active: Bool = false, order: Int) -> DictationTriggerCandidate {
        DictationTriggerCandidate(id: id, frontmost: frontmost, active: active, order: order)
    }

    @Test("받아쓰기가 있는 화면이면 두 동작 모두 그 버튼을 누른 것과 같다")
    func togglesFrontmost() {
        for source in [DictationTriggerSource.magicTap, .shortcut] {
            #expect(dictationTriggerResponse(source: source, inCall: false, micHot: false, candidates: [c(7, order: 1)]) == .toggle(id: 7))
        }
    }

    @Test("받아쓰기가 없는 화면: Magic Tap은 시스템에 넘기고(음악 재생·정지를 빼앗지 않는다) 단축어는 한 문장으로 알린다")
    func noTargetDiffersBySource() {
        #expect(dictationTriggerResponse(source: .magicTap, inCall: false, micHot: false, candidates: []) == .passToSystem)
        #expect(dictationTriggerResponse(source: .shortcut, inCall: false, micHot: false, candidates: []) == .announceNoTarget)
    }

    @Test("시트에 덮이거나 숨은 탭의 버튼은 대상이 아니다")
    func ignoresCoveredScreens() {
        let covered = [c(1, frontmost: false, order: 5), c(2, frontmost: false, active: true, order: 6)]
        #expect(dictationTriggerResponse(source: .magicTap, inCall: false, micHot: false, candidates: covered) == .passToSystem)
        #expect(dictationTriggerResponse(source: .shortcut, inCall: false, micHot: false, candidates: covered) == .announceNoTarget)
    }

    @Test("지금 화면의 버튼이 여럿이면 받아쓰는 중인 버튼이 먼저다(끝내기가 시작한 버튼에 간다)")
    func prefersActive() {
        let candidates = [c(1, active: true, order: 1), c(2, order: 9)]
        #expect(dictationTriggerResponse(source: .shortcut, inCall: false, micHot: false, candidates: candidates) == .toggle(id: 1))
    }

    @Test("받아쓰는 버튼이 없으면 가장 나중에 나타난 버튼이다")
    func prefersLatest() {
        let candidates = [c(1, order: 3), c(2, order: 8), c(3, frontmost: false, order: 12)]
        #expect(dictationTriggerResponse(source: .magicTap, inCall: false, micHot: false, candidates: candidates) == .toggle(id: 2))
    }

    @Test("통화 중의 Magic Tap은 받아쓰기가 있어도 시스템에 넘긴다(전화 끊기를 빼앗지 않는다)")
    func callKeepsSystemMagicTap() {
        let candidates = [c(1, order: 1), c(2, active: true, order: 2)]
        #expect(dictationTriggerResponse(source: .magicTap, inCall: true, micHot: false, candidates: candidates) == .passToSystem)
    }

    @Test("단축어는 통화 여부와 무관하게 같은 판정이다(시스템 기본 동작이 없다)")
    func shortcutIgnoresCall() {
        #expect(dictationTriggerResponse(source: .shortcut, inCall: true, micHot: false, candidates: [c(4, order: 1)]) == .toggle(id: 4))
        #expect(dictationTriggerResponse(source: .shortcut, inCall: true, micHot: false, candidates: []) == .announceNoTarget)
    }

    @Test("지금 화면에 버튼이 없는데 녹음 중이면 두 동작 모두 조용히 삼킨다(통지가 전사에 섞이지 않고 음악도 켜지지 않는다)")
    func swallowsWhileRecordingElsewhere() {
        let covered = [c(2, frontmost: false, active: true, order: 6)]
        for source in [DictationTriggerSource.magicTap, .shortcut] {
            #expect(dictationTriggerResponse(source: source, inCall: false, micHot: true, candidates: covered) == .swallow)
            #expect(dictationTriggerResponse(source: source, inCall: false, micHot: true, candidates: []) == .swallow)
        }
    }

    @Test("다른 곳에서 녹음 중이면 지금 화면의 쉬는 버튼을 켜지 않는다(두 번째 녹음 금지)")
    func micHotNeverStartsIdleButton() {
        let candidates = [c(1, frontmost: false, active: true, order: 1), c(2, order: 9)]
        for source in [DictationTriggerSource.magicTap, .shortcut] {
            #expect(dictationTriggerResponse(source: source, inCall: false, micHot: true, candidates: candidates) == .swallow)
            #expect(dictationTriggerResponse(source: source, inCall: false, micHot: true, candidates: [c(2, order: 9)]) == .swallow)
        }
    }

    @Test("녹음 중이어도 지금 화면의 받아쓰는 버튼이 먼저다(끝내기), 통화 중 Magic Tap은 그대로 시스템이다")
    func micHotKeepsToggleAndCall() {
        #expect(dictationTriggerResponse(source: .shortcut, inCall: false, micHot: true, candidates: [c(3, active: true, order: 1)]) == .toggle(id: 3))
        #expect(dictationTriggerResponse(source: .magicTap, inCall: true, micHot: true, candidates: []) == .passToSystem)
    }
}
