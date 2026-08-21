import Testing
@testable import GildongmuKit

@MainActor
struct GuideSessionCoordinatorTests {
    @Test func 빈_상태_claim은_성공한다() {
        let c = GuideSessionCoordinator()
        #expect(c.claim(stop: {}) != nil)
        #expect(c.isActive)
    }

    @Test func 점유_중_claim은_거부되고_기존_세션을_중지하지_않는다() {
        let c = GuideSessionCoordinator()
        var stopped = false
        let first = c.claim(stop: { stopped = true })
        #expect(first != nil)
        #expect(c.claim(stop: {}) == nil)
        #expect(!stopped)
        #expect(c.isActive)
    }

    @Test func release_뒤_재claim은_성공한다() {
        let c = GuideSessionCoordinator()
        let t = c.claim(stop: {})!
        c.release(t)
        #expect(!c.isActive)
        #expect(c.claim(stop: {}) != nil)
    }

    @Test func 늦은_release는_새_소유자를_지우지_않는다() {
        let c = GuideSessionCoordinator()
        let old = c.claim(stop: {})!
        c.release(old)
        let new = c.claim(stop: {})!
        c.release(old)  // stale
        #expect(c.isActive)
        c.release(new)
        #expect(!c.isActive)
    }

    @Test func stopCurrent는_소유자_stop을_부르고_비운다() {
        let c = GuideSessionCoordinator()
        var stopped = false
        _ = c.claim(stop: { stopped = true })
        c.stopCurrent()
        #expect(stopped)
        #expect(!c.isActive)
    }
}
