import Testing

@testable import GildongmuKit

@Suite("대중교통 유휴 폴 정지 한계 (E36 §4.2.6)")
struct TransitIdleTests {
    @Test("구간 소요가 없거나 짧으면 30분 하한")
    func floor() {
        #expect(transitIdlePollLimitMs(legMinutes: nil) == 30 * 60_000)
        #expect(transitIdlePollLimitMs(legMinutes: 0) == 30 * 60_000)
        #expect(transitIdlePollLimitMs(legMinutes: 10) == 30 * 60_000)
        #expect(transitIdlePollLimitMs(legMinutes: 15) == 30 * 60_000)
    }

    @Test("긴 구간은 소요의 2배")
    func doubleOfLeg() {
        #expect(transitIdlePollLimitMs(legMinutes: 16) == 32 * 60_000)
        #expect(transitIdlePollLimitMs(legMinutes: 40) == 80 * 60_000)
    }

    @Test("음수 소요는 하한으로 접는다")
    func negativeFolds() {
        #expect(transitIdlePollLimitMs(legMinutes: -5) == 30 * 60_000)
    }
}
