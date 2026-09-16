package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** 안내 세션 단일성 — Kit `GuideSessionCoordinatorTests` 미러. */
class GuideSessionCoordinatorTest {
    @Test fun `빈 상태 claim은 성공한다`() {
        val c = GuideSessionCoordinator()
        assertNotNull(c.claim {})
        assertTrue(c.isActive)
    }

    @Test fun `점유 중 claim은 거부되고 기존 세션을 중지하지 않는다`() {
        val c = GuideSessionCoordinator()
        var stopped = false
        assertNotNull(c.claim { stopped = true })
        assertNull(c.claim {})
        assertFalse(stopped)
        assertTrue(c.isActive)
    }

    @Test fun `release 뒤 재claim은 성공한다`() {
        val c = GuideSessionCoordinator()
        val t = checkNotNull(c.claim {})
        c.release(t)
        assertFalse(c.isActive)
        assertNotNull(c.claim {})
    }

    @Test fun `늦은 release는 새 소유자를 지우지 않는다`() {
        val c = GuideSessionCoordinator()
        val old = checkNotNull(c.claim {})
        c.release(old)
        val new = checkNotNull(c.claim {})
        c.release(old) // stale
        assertTrue(c.isActive)
        c.release(new)
        assertFalse(c.isActive)
    }

    @Test fun `stopCurrent는 소유자 stop을 부르고 비운다`() {
        val c = GuideSessionCoordinator()
        var stopped = false
        c.claim { stopped = true }
        c.stopCurrent()
        assertTrue(stopped)
        assertFalse(c.isActive)
    }
}
