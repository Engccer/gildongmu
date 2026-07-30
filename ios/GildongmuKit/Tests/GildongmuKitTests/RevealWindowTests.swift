import Testing
@testable import GildongmuKit

@Suite
struct RevealWindowTests {

    /// 시나리오 1: 초기 visibleCount=10
    @Test func initialVisibleCount() {
        var window = RevealWindow()
        #expect(window.visibleCount == 10)
    }

    /// 시나리오 2: 단계 공개 — 첫 호출 10 반환, 두 번째 20 반환, 세 번째 nil
    @Test func revealMoreSequence() {
        var window = RevealWindow()

        // 첫 번째: revealMore(totalCount: 25) → 반환 10, visibleCount 20
        let firstIndex = window.revealMore(totalCount: 25)
        #expect(firstIndex == 10)
        #expect(window.visibleCount == 20)

        // 두 번째: revealMore(totalCount: 25) → 반환 20, visibleCount 25
        let secondIndex = window.revealMore(totalCount: 25)
        #expect(secondIndex == 20)
        #expect(window.visibleCount == 25)

        // 세 번째: revealMore(totalCount: 25) → 반환 nil, visibleCount 유지
        let thirdIndex = window.revealMore(totalCount: 25)
        #expect(thirdIndex == nil)
        #expect(window.visibleCount == 25)
    }

    /// 시나리오 3: totalCount <= visibleCount면 nil, visibleCount 불변
    @Test func revealMoreWhenAlreadyFullyVisible() {
        var window = RevealWindow()

        // visibleCount=10, totalCount=10 → nil, 불변
        let index1 = window.revealMore(totalCount: 10)
        #expect(index1 == nil)
        #expect(window.visibleCount == 10)

        // visibleCount=10, totalCount=5 → nil, 불변
        let index2 = window.revealMore(totalCount: 5)
        #expect(index2 == nil)
        #expect(window.visibleCount == 10)
    }

    /// 시나리오 4: reset() 후 visibleCount 10 복원
    @Test func resetRestoresInitialCount() {
        var window = RevealWindow()

        // visibleCount를 30으로 진행
        _ = window.revealMore(totalCount: 50)
        _ = window.revealMore(totalCount: 50)
        #expect(window.visibleCount == 30)

        // reset() 호출
        window.reset()
        #expect(window.visibleCount == 10)
    }
}
