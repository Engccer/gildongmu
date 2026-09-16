package space.dodoplanet.gildongmu.location

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import space.dodoplanet.gildongmu.kit.ManualFix
import space.dodoplanet.gildongmu.kit.ManualVerdict
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/** spec §13-2 — run()의 갈래·CAS·재진입·디바운스·취소·silent·통지 1회. */
@OptIn(ExperimentalCoroutinesApi::class)
class ManualLocationJudgeTest {
    private val dispatcher = StandardTestDispatcher()
    private var nowSec = 10_000.0
    private val notices = ArrayList<String>()

    private class Rig(val src: FakeSource, val gate: FakeGate, val location: LocationStore, val manual: ManualLocationStore, val judge: ManualLocationJudge)

    private fun rig(permission: LocationPermission = LocationPermission.Fine, origin: ManualFix? = ManualFix(37.5, 127.1, 20.0, 9_990.0), withManual: Boolean = true, interval: Double = 30.0): Rig {
        val src = FakeSource(); val gate = FakeGate(permission)
        val location = LocationStore(src, gate, epochNow = { nowSec })
        val manual = ManualLocationStore(MemStore()) { nowSec }.also { it.hydrate() }
        if (withManual) manual.set("길동역", null, 37.5, 127.1, origin)
        val judge = ManualLocationJudge(manual, location, { nowSec }, { notices += it }, { "해제됨" }, interval)
        return Rig(src, gate, location, manual, judge)
    }

    @Test fun `수동 없음 → 측위 0·결과 없음`() = runTest(dispatcher) {
        val r = rig(withManual = false); r.judge.run(); assertEquals(0, r.src.subscriptions); assertNull(r.manual.verdict.value)
    }

    @Test fun `origin 없음 → undecidable, 측위 0`() = runTest(dispatcher) {
        val r = rig(origin = null); r.judge.run(); assertEquals(ManualVerdict.undecidable, r.manual.verdict.value); assertEquals(0, r.src.subscriptions)
    }

    @Test fun `권한 Fine 아님 → undecidable, request 0, 측위 0`() = runTest(dispatcher) {
        for (p in listOf(LocationPermission.None, LocationPermission.Coarse)) {
            val r = rig(permission = p); r.judge.run()
            assertEquals(ManualVerdict.undecidable, r.manual.verdict.value); assertEquals(0, r.gate.requests); assertEquals(0, r.src.subscriptions)
        }
    }

    @Test fun `keep — 가까운 fix, drop — 100m 넘게 떨어진 fix는 clear + 통지 1회, undecidable — fix 없음`() = runTest(dispatcher) {
        val keep = rig(); val k = async { keep.judge.run() }; runCurrent(); keep.src.emit(accuracy = 10.0, lat = 37.5001); k.await()
        assertEquals(ManualVerdict.keep, keep.manual.verdict.value); assertNotNull(keep.manual.current.value); assertEquals(0, notices.size)

        val drop = rig(); val d = async { drop.judge.run() }; runCurrent(); drop.src.emit(accuracy = 10.0, lat = 37.503); d.await() // ≈330m − 30m > 100m
        assertNull(drop.manual.current.value); assertNull(drop.manual.verdict.value); assertEquals(listOf("해제됨"), notices)

        val none = rig(); val u = async { none.judge.run() }; runCurrent(); advanceTimeBy(8_001); runCurrent(); u.await()
        assertEquals(ManualVerdict.undecidable, none.manual.verdict.value); assertNotNull(none.manual.current.value)
        assertEquals(false, none.location.lastFixFailed) // silent — 표시줄 실패 표식 미갱신
    }

    @Test fun `CAS — 판정 중 재지정이면 옛 결과 폐기(해제 없음·verdict 미기록)`() = runTest(dispatcher) {
        val r = rig(); val d = async { r.judge.run() }; runCurrent()
        r.manual.set("천호역", null, 37.6, 127.2, ManualFix(37.6, 127.2, 20.0, nowSec)) // revision 2
        r.src.emit(accuracy = 10.0, lat = 37.503); d.await() // 옛 위치 기준으로는 drop
        assertEquals("천호역", r.manual.current.value!!.label); assertNull(r.manual.verdict.value); assertEquals(0, notices.size)
    }

    @Test fun `동시 트리거 2회 → 측위 1회·통지 1회`() = runTest(dispatcher) {
        val r = rig(); val a = async { r.judge.run() }; val b = async { r.judge.run() }; runCurrent()
        assertEquals(1, r.src.subscriptions)
        r.src.emit(accuracy = 10.0, lat = 37.503); a.await(); b.await()
        assertEquals(1, r.src.subscriptions); assertEquals(1, notices.size)
    }

    @Test fun `30초 안 재호출은 건너뛰고 force는 예외`() = runTest(dispatcher) {
        val r = rig(); val a = async { r.judge.run() }; runCurrent(); r.src.emit(accuracy = 10.0, lat = 37.5001); a.await()
        nowSec += 5
        r.judge.run(); assertEquals(1, r.src.subscriptions)
        val f = async { r.judge.run(force = true) }; runCurrent(); assertEquals(2, r.src.subscriptions); r.src.emit(accuracy = 10.0, lat = 37.5001); f.await()
        nowSec += 31
        val c = async { r.judge.run() }; runCurrent(); assertEquals(3, r.src.subscriptions); r.src.emit(accuracy = 10.0, lat = 37.5001); c.await()
    }

    @Test fun `취소는 통과하고 결과를 남기지 않는다`() = runTest(dispatcher) {
        val r = rig(); val job = launch { r.judge.run() }; runCurrent(); assertEquals(1, r.src.subscriptions)
        job.cancel(); runCurrent()
        assertNull(r.manual.verdict.value); assertNotNull(r.manual.current.value); assertEquals(0, notices.size); assertEquals(1, r.src.closed)
    }
}
