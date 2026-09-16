package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** Kit `RevealWindowTests` 미러. */
class RevealWindowTest {
    /** 시나리오 1: 초기 visibleCount=10 */
    @Test fun initialVisibleCount() {
        assertEquals(10, RevealWindow().visibleCount)
    }

    /** 시나리오 2: 단계 공개 — 첫 호출 10 반환, 두 번째 20 반환, 세 번째 null */
    @Test fun revealMoreSequence() {
        val window = RevealWindow()
        assertEquals(10, window.revealMore(totalCount = 25))
        assertEquals(20, window.visibleCount)
        assertEquals(20, window.revealMore(totalCount = 25))
        assertEquals(25, window.visibleCount)
        assertNull(window.revealMore(totalCount = 25))
        assertEquals(25, window.visibleCount)
    }

    /** 시나리오 3: totalCount <= visibleCount면 null, visibleCount 불변 */
    @Test fun revealMoreWhenAlreadyFullyVisible() {
        val window = RevealWindow()
        assertNull(window.revealMore(totalCount = 10))
        assertEquals(10, window.visibleCount)
        assertNull(window.revealMore(totalCount = 5))
        assertEquals(10, window.visibleCount)
    }

    /** 시나리오 4: reset() 후 visibleCount 10 복원 */
    @Test fun resetRestoresInitialCount() {
        val window = RevealWindow()
        window.revealMore(totalCount = 50)
        window.revealMore(totalCount = 50)
        assertEquals(30, window.visibleCount)
        window.reset()
        assertEquals(10, window.visibleCount)
    }
}
