package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertEquals

/** Kit `RouteGuideTests` 미러. 행동 → 소리 표는 Kit `WalkActionTests`(FOUNDATION 유예분)다. */
class RouteGuideTest {
    @Test fun `행동별 임박 큐 소리`() {
        assertEquals(GuideTone.crosswalk, imminentTone(WalkAction.crosswalk))
        assertEquals(GuideTone.left, imminentTone(WalkAction.left))
        assertEquals(GuideTone.right, imminentTone(WalkAction.right))
        assertEquals(GuideTone.back, imminentTone(WalkAction.back))
        // 지하보도는 "그 외" — 횡단보도 비프는 음향신호기의 인용이라 붙이면 거짓 인용이 된다.
        assertEquals(GuideTone.ahead, imminentTone(WalkAction.underpass))
    }

    /** 갈래 선택은 회전과 같은 소리(K2 §3.1). */
    @Test fun `갈래 선택은 회전과 같은 소리`() {
        assertEquals(GuideTone.left, imminentTone(WalkAction.keepLeft))
        assertEquals(GuideTone.right, imminentTone(WalkAction.keepRight))
    }
}
