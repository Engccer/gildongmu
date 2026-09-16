package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertEquals

/** Swift `Double.rounded()`(0에서 먼 반올림) 미러 계약. 소비자가 음수를 넘겨도 경계가 흔들리지 않게 잠근다. */
class SwiftRoundingTest {
    @Test fun `점5는 0에서 먼 쪽이다 — 짝수 반올림도 양의 방향 반올림도 아니다`() {
        assertEquals(3.0, 2.5.roundedAwayFromZero())
        assertEquals(-3.0, (-2.5).roundedAwayFromZero())
        assertEquals(1.0, 0.5.roundedAwayFromZero())
        assertEquals(-1.0, (-0.5).roundedAwayFromZero())
    }

    @Test fun `부동소수 경계 — 0점5 바로 아래와 큰 정수`() {
        assertEquals(0.0, 0.49999999999999994.roundedAwayFromZero())
        assertEquals(1e16, 1e16.roundedAwayFromZero())
        assertEquals(302.0, 302.4.roundedAwayFromZero())
    }
}
