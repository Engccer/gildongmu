package space.dodoplanet.gildongmu.location

import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import space.dodoplanet.gildongmu.kit.KeyValueStore
import space.dodoplanet.gildongmu.kit.KitJson
import space.dodoplanet.gildongmu.kit.ManualFix
import space.dodoplanet.gildongmu.kit.ManualLocation
import space.dodoplanet.gildongmu.kit.ManualVerdict
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** spec §13-1 — 왕복·손상 폐기·revision 단조·verdict 비영속·hydration 불변식. */
class ManualLocationStoreTest {
    internal class MemStore : KeyValueStore {
        val map = HashMap<String, String>()
        override fun getString(key: String) = map[key]
        override fun putString(key: String, value: String) { map[key] = value }
    }

    private fun manual(revision: Int = 1, origin: ManualFix? = ManualFix(37.5, 127.1, 20.0, 1000.0), label: String = "길동역") =
        ManualLocation(revision, label, "Gildong", 37.5, 127.1, origin, 1000.0)
    private fun encoded(m: ManualLocation) = KitJson.encodeToString(ManualLocation.serializer(), m)

    @Test fun `set은 revision 단조·setAt 지금·verdict 초기화·저장, clear는 비운다`() {
        val mem = MemStore()
        val s = ManualLocationStore(mem) { 2000.0 }
        s.hydrate()
        s.set("길동역", "Gildong", 37.5, 127.1, ManualFix(37.5, 127.1, 20.0, 1990.0))
        val first = assertNotNull(s.current.value)
        assertEquals(1, first.revision); assertEquals(2000.0, first.setAt); assertEquals("Gildong", first.labelRoman)
        assertTrue(mem.map[ManualLocationStore.KEY]!!.isNotEmpty())
        s.setVerdict(ManualVerdict.keep); assertEquals(ManualVerdict.keep, s.verdict.value)
        s.setVerdict(ManualVerdict.keep) // 같은 값은 무시
        s.set("천호역", null, 37.6, 127.2, null)
        assertEquals(2, s.current.value!!.revision); assertNull(s.verdict.value)
        s.clear()
        assertNull(s.current.value); assertNull(s.verdict.value); assertEquals("", mem.map[ManualLocationStore.KEY])
        s.clear() // 멱등
    }

    @Test fun `set은 isValid 실패면 저장하지 않는다`() {
        val mem = MemStore(); val s = ManualLocationStore(mem); s.hydrate()
        s.set(" ", null, 37.5, 127.1, null)
        assertNull(s.current.value); assertNull(mem.map[ManualLocationStore.KEY])
    }

    @Test fun `hydrate — 저장값 복원, verdict는 비영속, 두 번째 호출 no-op`() {
        val mem = MemStore(); mem.map[ManualLocationStore.KEY] = encoded(manual())
        val s = ManualLocationStore(mem); s.hydrate()
        assertEquals("길동역", s.current.value!!.label); assertNull(s.verdict.value)
        mem.map[ManualLocationStore.KEY] = encoded(manual(label = "다른"))
        s.hydrate(); assertEquals("길동역", s.current.value!!.label)
    }

    @Test fun `hydrate — 손상·범위 밖·NaN은 폐기하고 저장소를 비운다`() {
        for (raw in listOf("{not json", encoded(manual(origin = ManualFix(37.5, 127.1, 0.0, 1000.0))), encoded(manual().copy(lng = 181.0)), """{"revision":1,"label":"x","lat":1.0,"lng":2.0,"origin":null,"setAt":"NaN"}""")) {
            val mem = MemStore(); mem.map[ManualLocationStore.KEY] = raw
            val s = ManualLocationStore(mem); s.hydrate()
            assertNull(s.current.value, raw); assertEquals("", mem.map[ManualLocationStore.KEY], raw)
        }
        val empty = MemStore(); val e = ManualLocationStore(empty); e.hydrate(); assertNull(e.current.value); assertNull(empty.map[ManualLocationStore.KEY])
    }

    @Test fun `isValid — 라벨 공백·NaN·범위 밖·origin 정확도 0 거부, origin null은 허용`() {
        assertTrue(ManualLocationStore.isValid(manual()))
        assertTrue(ManualLocationStore.isValid(manual(origin = null)))
        assertFalse(ManualLocationStore.isValid(manual(label = " ")))
        assertFalse(ManualLocationStore.isValid(manual().copy(lat = Double.NaN)))
        assertFalse(ManualLocationStore.isValid(manual().copy(lng = 181.0)))
        assertFalse(ManualLocationStore.isValid(manual().copy(setAt = Double.POSITIVE_INFINITY)))
        assertFalse(ManualLocationStore.isValid(manual(origin = ManualFix(37.5, 127.1, -5.0, 1000.0))))
        assertFalse(ManualLocationStore.isValid(manual(origin = ManualFix(37.5, 127.1, 20.0, Double.NaN))))
    }

    @Test fun `awaitHydrated는 hydrate 완료를 기다린다`() = runTest {
        val mem = MemStore(); mem.map[ManualLocationStore.KEY] = encoded(manual())
        val s = ManualLocationStore(mem)
        val waiter = launch { s.awaitHydrated(); assertNotNull(s.current.value) }
        assertTrue(waiter.isActive)
        s.hydrate(); waiter.join()
    }
}
