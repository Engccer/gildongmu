package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertEquals

/** 대중교통 유휴 폴 정지 한계(E36 §4.2.6) — Kit `TransitIdleTests` 미러. */
class TransitIdleTest {
    @Test fun `구간 소요가 없거나 짧으면 30분 하한`() {
        for (m in listOf(null, 0, 10, 15)) assertEquals(30 * 60_000.0, transitIdlePollLimitMs(m), "$m")
    }

    @Test fun `긴 구간은 소요의 2배`() {
        assertEquals(32 * 60_000.0, transitIdlePollLimitMs(16))
        assertEquals(80 * 60_000.0, transitIdlePollLimitMs(40))
    }

    @Test fun `음수 소요는 하한으로 접는다`() {
        assertEquals(30 * 60_000.0, transitIdlePollLimitMs(-5))
    }
}
