package space.dodoplanet.gildongmu.location

import space.dodoplanet.gildongmu.kit.Fixtures
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
        assertEquals(new, slot.owner)
        assertTrue(slot.detach(new))
        assertNull(slot.value)
        assertNull(slot.owner)
    }

    /** 안내 권한 창 대기는 그 창을 띄운 손의 주인이 뗄 때 풀린다 — 주인이 바뀐 뒤 옛 화면이 사라지면 결과가 오지 않아 60초를 멈췄다(리뷰 지적). */
    @Test fun `안내 권한 대기는 창을 띄운 주인의 해제로 풀린다`() {
        val code = Fixtures.repoRoot.resolve("android/app/src/main/kotlin/space/dodoplanet/gildongmu/guide/GuidePermissionsImpl.kt").readText()
        assertTrue(code.contains("waiter = permission to deferred\n        waiterOwner = hand.owner"))
        val detach = code.substringAfter("fun detach(owner: Any) {").substringBefore("\n    }")
        assertTrue(Regex("""hand\.detach\(owner\)\s+if \(waiterOwner !== owner\) return\s+waiter\?\.second\?\.complete\(Unit\)""").containsMatchIn(detach), detach)
    }
}
