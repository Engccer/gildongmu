package space.dodoplanet.gildongmu.location

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** 권한 요청 손(위치 `AndroidPermissionGate`·안내 `GuidePermissionsImpl`)의 한 칸: 붙인 주인만 뗀다(재리뷰 지적 3). */
class OwnedSlotTest {
    @Test fun `옛 주인의 늦은 해제는 새 주인의 손을 지우지 않는다`() {
        val slot = OwnedSlot<String>()
        val old = Any()
        val new = Any()
        slot.attach(old, "옛 손")
        slot.attach(new, "새 손") // 새 액티비티가 먼저 붙고
        assertFalse(slot.detach(old)) // 옛 액티비티의 onDestroy가 늦게 온다
        assertEquals("새 손", slot.value)
        assertTrue(slot.detach(new))
        assertNull(slot.value)
    }
}
