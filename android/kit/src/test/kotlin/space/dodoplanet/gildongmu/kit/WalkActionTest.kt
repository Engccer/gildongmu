package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * 행동 열거형의 raw 값 계약(서버 투영 문자열·공유 fixture 표기).
 */
class WalkActionTest {
    @Test fun `raw 값은 Swift 표기와 같다`() {
        assertEquals(listOf("left", "right", "back", "crosswalk", "underpass", "keepLeft", "keepRight"), WalkAction.entries.map { it.rawValue })
        assertEquals(WalkAction.keepLeft, WalkAction.fromRawValue("keepLeft"))
        assertNull(WalkAction.fromRawValue("teleport"))
    }
}
