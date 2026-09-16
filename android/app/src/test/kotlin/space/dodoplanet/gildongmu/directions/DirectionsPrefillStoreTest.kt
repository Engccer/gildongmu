package space.dodoplanet.gildongmu.directions

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** spec §5 1회 소비 스토어. */
class DirectionsPrefillStoreTest {
    private val p = DirectionsPrefill(DirectionsPrefillRole.to, "강남역", 37.49, 127.02, "Gangnam Station")

    @Test fun `offer 뒤 take는 한 번만 참`() {
        DirectionsPrefillStore.offer(p)
        assertEquals(p, DirectionsPrefillStore.pending.value)
        assertTrue(DirectionsPrefillStore.take(p))
        assertNull(DirectionsPrefillStore.pending.value)
        assertFalse(DirectionsPrefillStore.take(p))
    }

    @Test fun `다른 값이 이미 놓였으면 옛 값의 take는 거짓`() {
        val other = p.copy(role = DirectionsPrefillRole.from)
        DirectionsPrefillStore.offer(p)
        DirectionsPrefillStore.offer(other)
        assertFalse(DirectionsPrefillStore.take(p))
        assertTrue(DirectionsPrefillStore.take(other))
    }
}
