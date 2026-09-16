package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** Kit `TransitGuideTests` 미러. */
class TransitGuideTest {
    @Test fun `출구 번호 형식 게이트`() {
        assertEquals("2-1", transitValidExitNo(" 2-1 "))
        assertNull(transitValidExitNo("1 2"))
        assertNull(transitValidExitNo("3번 출구"))
        assertNull(transitValidExitNo(null))
        assertNull(transitValidExitNo("１２")) // 전각 숫자는 JS `\d`처럼 거른다
    }
}
