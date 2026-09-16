package space.dodoplanet.gildongmu.location

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import space.dodoplanet.gildongmu.kit.KitJson
import space.dodoplanet.gildongmu.kit.ManualFix
import space.dodoplanet.gildongmu.kit.ManualLocation
import space.dodoplanet.gildongmu.kit.NearbyCoord
import space.dodoplanet.gildongmu.kit.NearbyCoordinateSource
import space.dodoplanet.gildongmu.kit.NearbyLocationError
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** spec §13-2·판정 38 — 수동 우선, force는 판정 먼저, ranking은 수동이면 측위 0, hydration 불변식, 어댑터 번역. */
@OptIn(ExperimentalCoroutinesApi::class)
class EffectiveLocationTest {
    private val dispatcher = StandardTestDispatcher()
    private var nowSec = 10_000.0

    private class Rig(val src: FakeSource, val location: LocationStore, val manual: ManualLocationStore, val effective: EffectiveLocation)

    private fun rig(permission: LocationPermission = LocationPermission.Fine, hydrate: Boolean = true, stored: String? = null): Rig {
        val src = FakeSource(); val location = LocationStore(src, FakeGate(permission), epochNow = { nowSec })
        val mem = MemStore(); if (stored != null) mem.map[ManualLocationStore.KEY] = stored
        val manual = ManualLocationStore(mem) { nowSec }; if (hydrate) manual.hydrate()
        val judge = ManualLocationJudge(manual, location, { nowSec }, {}, { "해제됨" })
        return Rig(src, location, manual, EffectiveLocation(location, manual, judge))
    }

    private fun <T> kotlinx.coroutines.CoroutineScope.attempt(block: suspend () -> T) =
        async { try { Result.success(block()) } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) { Result.failure(e) } }

    @Test fun `수동이 있으면 그 좌표(측위 0), 없으면 GPS`() = runTest(dispatcher) {
        val r = rig(); r.manual.set("길동역", null, 37.5, 127.1, null)
        assertEquals(NearbyCoord(37.5, 127.1), r.effective.coordinate(force = false)); assertEquals(0, r.src.subscriptions)
        r.manual.clear()
        val d = async { r.effective.coordinate(force = false) }; runCurrent(); r.src.emit(accuracy = 10.0, lat = 37.9)
        assertEquals(NearbyCoord(37.9, 127.1), d.await())
    }

    @Test fun `force는 판정을 먼저 돌리고, drop이면 GPS로 넘어간다`() = runTest(dispatcher) {
        val r = rig(); r.manual.set("길동역", null, 37.5, 127.1, ManualFix(37.5, 127.1, 20.0, nowSec))
        val d = async { r.effective.coordinate(force = true) }; runCurrent()
        r.src.emit(accuracy = 10.0, lat = 37.503) // 판정 측위 → drop → clear
        runCurrent()
        assertNull(r.manual.current.value); assertEquals(2, r.src.subscriptions) // force 조회는 캐시를 건너뛰어 다시 측위(iOS 동형)
        r.src.emit(accuracy = 10.0, lat = 37.504)
        assertEquals(NearbyCoord(37.504, 127.1), d.await())
    }

    @Test fun `force는 keep이면 판정 측위 1회 뒤 수동 좌표를 돌려준다(재측위 없음)`() = runTest(dispatcher) {
        val r = rig(); r.manual.set("길동역", null, 37.5, 127.1, ManualFix(37.5, 127.1, 20.0, nowSec))
        val d = async { r.effective.coordinate(force = true) }; runCurrent()
        r.src.emit(accuracy = 10.0, lat = 37.5001) // 판정 측위 → keep
        assertEquals(NearbyCoord(37.5, 127.1), d.await()); assertEquals(1, r.src.subscriptions)
        assertEquals(space.dodoplanet.gildongmu.kit.ManualVerdict.keep, r.manual.verdict.value)
    }

    @Test fun `ranking — 수동이면 측위 0, 없으면 gps soft 게이트`() = runTest(dispatcher) {
        val r = rig(permission = LocationPermission.None); r.manual.set("길동역", null, 37.5, 127.1, null)
        assertEquals(NearbyCoord(37.5, 127.1), r.effective.coordinateForRanking()); assertEquals(0, r.src.subscriptions)
        r.manual.clear(); assertNull(r.effective.coordinateForRanking())
    }

    @Test fun `hydration 전 호출은 join 뒤 수동을 돌려준다(불변식)`() = runTest(dispatcher) {
        val stored = KitJson.encodeToString(ManualLocation.serializer(), ManualLocation(1, "길동역", null, 37.5, 127.1, null, 1.0))
        val r = rig(hydrate = false, stored = stored)
        val d = async { r.effective.coordinateForRanking() }; runCurrent()
        assertTrue(d.isActive) // hydration을 기다린다
        r.manual.hydrate(); runCurrent()
        assertEquals(NearbyCoord(37.5, 127.1), d.await()); assertEquals(0, r.src.subscriptions)
    }

    @Test fun `prime — 수동이면 측위 0, 없으면 soft 상한 GPS, last는 수동 우선 저장 좌표(채팅 앵커)`() = runTest(dispatcher) {
        val r = rig(); assertNull(r.effective.last())
        val d = async { r.effective.prime(2_000) }; runCurrent(); r.src.emit(accuracy = 10.0, lat = 37.9); d.await()
        assertEquals(NearbyCoord(37.9, 127.1), r.effective.last()); assertEquals(1, r.src.subscriptions)
        r.manual.set("길동역", null, 37.5, 127.1, null)
        r.effective.prime(2_000); assertEquals(1, r.src.subscriptions) // 수동 상태의 GPS 측위는 판정뿐(판정 35)
        assertEquals(NearbyCoord(37.5, 127.1), r.effective.last())
    }

    @Test fun `last — hydration 전 호출은 스스로 hydrate해 저장된 수동 좌표를 돌려준다(장소 채팅 콜드 스타트 창)`() = runTest(dispatcher) {
        val stored = KitJson.encodeToString(ManualLocation.serializer(), ManualLocation(1, "길동역", null, 37.5, 127.1, null, 1.0))
        val r = rig(hydrate = false, stored = stored)
        assertEquals(NearbyCoord(37.5, 127.1), r.effective.last())
        val d = async { r.effective.coordinateForRanking() }; runCurrent(); assertEquals(NearbyCoord(37.5, 127.1), d.await()) // join도 이미 풀려 있다
    }

    @Test fun `코어 어댑터는 세 원인을 NearbyLocationError로 번역한다`() = runTest(dispatcher) {
        val coarse = (rig(permission = LocationPermission.Coarse).effective.nearbyCoordinateSource() as NearbyCoordinateSource.Current)
        assertEquals(NearbyLocationError.ReducedAccuracy, attempt { coarse.getCoordinate(false) }.await().exceptionOrNull())
        val none = (rig(permission = LocationPermission.None).effective.nearbyCoordinateSource() as NearbyCoordinateSource.Current)
        assertEquals(NearbyLocationError.Denied, attempt { none.getCoordinate(false) }.await().exceptionOrNull())
        val off = rig(); off.src.enabled = false
        assertEquals(NearbyLocationError.Unavailable, attempt { (off.effective.nearbyCoordinateSource() as NearbyCoordinateSource.Current).getCoordinate(false) }.await().exceptionOrNull())
    }
}
