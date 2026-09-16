package space.dodoplanet.gildongmu.location

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.extension.RegisterExtension
import space.dodoplanet.gildongmu.MainDispatcherExtension
import space.dodoplanet.gildongmu.directions.CatalogStrings
import space.dodoplanet.gildongmu.directions.DirectionsFieldTarget
import space.dodoplanet.gildongmu.kit.APIClient
import space.dodoplanet.gildongmu.kit.HttpResponse
import space.dodoplanet.gildongmu.kit.HttpTransport
import space.dodoplanet.gildongmu.kit.InMemoryKeyValueStore
import space.dodoplanet.gildongmu.kit.RecentSearchStore
import space.dodoplanet.gildongmu.kit.SearchService
import space.dodoplanet.gildongmu.kit.models.Place
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** spec §13-3 `commit` — in-flight·진행 통지(측위 갈래에서만)·적격 origin·Fine 아니면 팝업 0·Current는 clear·취소는 set 0·set 뒤 done. */
@OptIn(ExperimentalCoroutinesApi::class)
class ManualLocationPickerViewModelTest {
    @JvmField @RegisterExtension val main = MainDispatcherExtension()
    private var nowSec = 10_000.0

    private class Rig(val src: FakeSource, val gate: FakeGate, val location: LocationStore, val manual: ManualLocationStore, val vm: ManualLocationPickerViewModel)

    private fun rig(permission: LocationPermission = LocationPermission.Fine): Rig {
        val src = FakeSource(); val gate = FakeGate(permission)
        val location = LocationStore(src, gate, epochNow = { nowSec })
        val manual = ManualLocationStore(MemStore()) { nowSec }.also { it.hydrate() }
        val transport = object : HttpTransport {
            override suspend fun get(url: String, timeoutMs: Long?) = when (space.dodoplanet.gildongmu.kit.pathOf(url)) {
                "/api/geocode" -> HttpResponse(200, """{"matches":[{"addressName":"서울 강동구 천호대로 1","lat":37.55,"lng":127.15}],"query":"q"}""")
                else -> HttpResponse(404, "")
            }
        }
        val vm = ManualLocationPickerViewModel(
            SearchService(APIClient("https://example.test", transport)), RecentSearchStore(InMemoryKeyValueStore()), CatalogStrings("ko"),
            main.dispatcher, { "ko" }, { null }, manual, location, { nowSec },
        )
        return Rig(src, gate, location, manual, vm)
    }
    private val place = Place(id = "k1", name = "길동역", nameRoman = "Gildong", category = "", address = "", roadAddress = "", lat = 37.53, lng = 127.13)

    @Test fun `Place + Fine → 진행 통지 1회·측위 1회·적격 origin·set 뒤 done, 화면은 열린 채, 연타 무시`() = runTest(main.dispatcher) {
        val r = rig(); runCurrent()
        assertEquals(DirectionsFieldTarget.manualLocation, r.vm.picker.state.value!!.target)
        r.vm.picker.selectPlace(place); runCurrent()
        val p = assertNotNull(r.vm.picker.state.value) // 지정 중에도 열려 있다 — 통지가 이 화면의 창구에서 난다
        assertEquals("현재 위치 확인 중", p.notice.text); assertEquals(1, p.notice.seq)
        assertEquals(1, r.src.subscriptions); assertFalse(r.vm.done.value); assertNull(r.manual.current.value)
        r.vm.picker.selectPlace(place); runCurrent() // 연타 — 두 번째 측위·통지 없음
        assertEquals(1, r.src.subscriptions); assertEquals(1, r.vm.picker.state.value!!.notice.seq)
        r.src.emit(accuracy = 10.0, lat = 37.5); runCurrent()
        val m = assertNotNull(r.manual.current.value)
        assertEquals("길동역", m.label); assertEquals("Gildong", m.labelRoman); assertEquals(37.53, m.lat); assertEquals(127.13, m.lng)
        val o = assertNotNull(m.origin); assertEquals(37.5, o.lat); assertEquals(10.0, o.accuracy); assertEquals(nowSec, o.at)
        assertTrue(r.vm.done.value); assertEquals(0, r.gate.requests)
    }

    @Test fun `주소 후보 → 지오코딩 좌표와 juso 영문 주소(labelRoman)로 지정, 권한 없음이면 origin null`() = runTest(main.dispatcher) {
        val r = rig(LocationPermission.None); runCurrent()
        r.vm.picker.selectAddress(space.dodoplanet.gildongmu.kit.models.JusoAddress(roadAddr = "서울 강동구 천호대로 1", roadAddrPart1 = "서울 강동구 천호대로 1", jibunAddr = "길동 1", engAddr = "1 Cheonho-daero, Gangdong-gu, Seoul", zipNo = "05300", bdNm = ""))
        runCurrent()
        val m = assertNotNull(r.manual.current.value)
        assertEquals("서울 강동구 천호대로 1", m.label); assertEquals("1 Cheonho-daero, Gangdong-gu, Seoul", m.labelRoman); assertEquals(37.55, m.lat); assertEquals(127.15, m.lng); assertNull(m.origin)
        assertTrue(r.vm.done.value)
    }

    @Test fun `유효하지 않은 좌표는 저장하지 않고 실패를 말하며 pop하지 않는다(3-state)`() = runTest(main.dispatcher) {
        val r = rig(LocationPermission.None); runCurrent()
        r.vm.picker.selectPlace(place.copy(lat = Double.NaN)); runCurrent()
        assertNull(r.manual.current.value); assertFalse(r.vm.done.value)
        assertEquals("선택한 주소의 좌표를 확인하지 못했습니다.", r.vm.picker.state.value!!.notice.text)
    }

    @Test fun `Place + Fine, 측위 실패(8초 무응답) → origin null로 set·done, 지정 측위는 silent가 아니라 실패 표식이 선다`() = runTest(main.dispatcher) {
        val r = rig(); runCurrent()
        r.vm.picker.selectPlace(place); runCurrent(); advanceTimeBy(8_001); runCurrent()
        val m = assertNotNull(r.manual.current.value); assertNull(m.origin)
        assertTrue(r.vm.done.value); assertTrue(r.location.lastFixFailed)
    }

    @Test fun `Place + 권한 없음 → 측위 0·통지 0·권한 요청 0·origin null·done(판정 37)`() = runTest(main.dispatcher) {
        for (permission in listOf(LocationPermission.None, LocationPermission.Coarse)) {
            val r = rig(permission); runCurrent()
            r.vm.picker.selectPlace(place); runCurrent()
            assertEquals(0, r.src.subscriptions, permission.name); assertEquals(0, r.gate.requests)
            val m = assertNotNull(r.manual.current.value); assertNull(m.origin); assertEquals("길동역", m.label)
            assertTrue(r.vm.done.value)
        }
    }

    @Test fun `Current(되돌리기) → clear 즉시, 측위 0·통지 0·done`() = runTest(main.dispatcher) {
        val r = rig(); r.manual.set("옛 위치", null, 37.5, 127.1, null); runCurrent()
        r.vm.picker.selectCurrent(); runCurrent()
        assertNull(r.manual.current.value); assertEquals(0, r.src.subscriptions); assertEquals(0, r.vm.picker.state.value!!.notice.seq)
        assertTrue(r.vm.done.value)
    }

    @Test fun `취소 → 측위 구독 해제·set 0·done 아님, 그 뒤 새 확정은 받는다`() = runTest(main.dispatcher) {
        val r = rig(); runCurrent()
        r.vm.picker.selectPlace(place); runCurrent(); assertEquals(1, r.src.subscriptions)
        r.vm.cancel(); runCurrent()
        assertEquals(1, r.src.closed)
        r.src.emit(accuracy = 10.0, lat = 37.5); runCurrent()
        assertNull(r.manual.current.value); assertFalse(r.vm.done.value)
        r.vm.picker.selectPlace(place); runCurrent(); assertEquals(2, r.src.subscriptions) // in-flight 가드는 취소된 잡을 붙들지 않는다
    }
}
