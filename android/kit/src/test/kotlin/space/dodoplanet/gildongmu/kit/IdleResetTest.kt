package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** 웹 `idle-reset.test.ts` 대표 케이스 — Kit `IdleResetTests` 미러(시각은 초 단위 Double). */
class IdleResetTest {
    private val now = 1_800_000_000.0

    @Test fun `기록이 없으면 리셋하지 않는다`() {
        assertFalse(IdleReset.shouldReset(null, now))
    }

    @Test fun `임계 이내 복귀는 리셋하지 않는다`() {
        assertFalse(IdleReset.shouldReset(now - IdleReset.interval + 1, now))
    }

    @Test fun `정확히 임계 경과는 리셋하지 않는다`() {
        assertFalse(IdleReset.shouldReset(now - IdleReset.interval, now))
    }

    @Test fun `임계 초과면 리셋한다`() {
        assertTrue(IdleReset.shouldReset(now - IdleReset.interval - 1, now))
    }

    @Test fun `미래 시각은 리셋하지 않는다`() {
        assertFalse(IdleReset.shouldReset(now + 60, now))
    }
}
