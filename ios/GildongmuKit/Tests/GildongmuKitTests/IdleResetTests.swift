import Testing
import Foundation
@testable import GildongmuKit

// 웹 `src/lib/__tests__/idle-reset.test.ts`의 대표 케이스 미러.

@Suite struct IdleResetTests {
    let now = Date(timeIntervalSince1970: 1_800_000_000)

    @Test func 기록이_없으면_리셋하지_않는다() {
        #expect(IdleReset.shouldReset(backgroundedAt: nil, now: now) == false)
    }

    @Test func 임계_이내_복귀는_리셋하지_않는다() {
        let at = now.addingTimeInterval(-IdleReset.interval + 1)
        #expect(IdleReset.shouldReset(backgroundedAt: at, now: now) == false)
    }

    @Test func 정확히_임계_경과는_리셋하지_않는다() {
        let at = now.addingTimeInterval(-IdleReset.interval)
        #expect(IdleReset.shouldReset(backgroundedAt: at, now: now) == false)
    }

    @Test func 임계_초과면_리셋한다() {
        let at = now.addingTimeInterval(-IdleReset.interval - 1)
        #expect(IdleReset.shouldReset(backgroundedAt: at, now: now) == true)
    }

    @Test func 미래_시각은_리셋하지_않는다() {
        let at = now.addingTimeInterval(60)
        #expect(IdleReset.shouldReset(backgroundedAt: at, now: now) == false)
    }
}
