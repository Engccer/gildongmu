package space.dodoplanet.gildongmu.location

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import space.dodoplanet.gildongmu.kit.NearbyCoord
import space.dodoplanet.gildongmu.kit.NearbyCoordinateSource
import space.dodoplanet.gildongmu.kit.NearbyLocationError
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** spec §4 위치 계층 계약. 플랫폼은 페이크(구독 콜백을 테스트가 직접 부른다), 시간은 가상 시계. */
@OptIn(ExperimentalCoroutinesApi::class)
class LocationStoreTest {
    private class FakeSource(var enabled: Boolean = true, val providers: Set<String> = setOf(LocationSource.FUSED)) : LocationSource {
        var now = 100_000L
        val listeners = LinkedHashMap<String, (RawFix) -> Unit>()
        var closed = 0
        override fun isLocationEnabled() = enabled
        override fun hasProvider(name: String) = name in providers
        override fun subscribe(provider: String, onFix: (RawFix) -> Unit): AutoCloseable {
            listeners[provider] = onFix
            return AutoCloseable { closed++; listeners.remove(provider) }
        }
        override fun elapsedRealtimeMs() = now
        fun emit(accuracy: Double, ageSeconds: Double = 0.0, lat: Double = 37.5, lng: Double = 127.1) {
            val fix = RawFix(lat, lng, accuracy, now - (ageSeconds * 1000).toLong())
            listeners.values.toList().forEach { it(fix) }
        }
    }

    private class FakeGate(var value: LocationPermission, private val afterRequest: LocationPermission = value) : PermissionGate {
        var requests = 0
        override fun current() = value
        override suspend fun request(): LocationPermission { requests++; value = afterRequest; return value }
    }

    private val dispatcher = StandardTestDispatcher()
    private val logs = ArrayList<String>()
    private fun store(src: FakeSource, gate: PermissionGate) = LocationStore(src, gate) { logs += it }

    /** 실패를 값으로 — `async` 자식의 예외는 부모 `runTest`를 함께 실패시켜 `assertFailsWith`에 닿지 못한다. */
    private fun <T> kotlinx.coroutines.CoroutineScope.attempt(block: suspend () -> T) =
        async { try { Result.success(block()) } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) { Result.failure(e) } }
    private fun kindOf(r: Result<*>): LocationException.Kind = (r.exceptionOrNull() as LocationException).kind

    @Test fun `수용 정확도 fix가 오면 즉시 반환하고 구독을 닫는다`() = runTest(dispatcher) {
        val src = FakeSource(); val s = store(src, FakeGate(LocationPermission.Fine))
        val d = async { s.currentCoordinate() }; runCurrent()
        src.emit(accuracy = 12.0)
        assertEquals(NearbyCoord(37.5, 127.1), d.await())
        assertEquals(1, src.closed); assertEquals(0, src.listeners.size) // 닫힌 뒤 비어 있다
        assertEquals(12.0, s.stored?.accuracy)
    }

    @Test fun `타임아웃이면 이번 취득의 최선값이고 스토어 옛 값은 폴백이 아니다`() = runTest(dispatcher) {
        val src = FakeSource(); val s = store(src, FakeGate(LocationPermission.Fine))
        s.stored = LocationStore.StoredFix(1.0, 1.0, 20.0, src.now - 5_000) // 옛 값(정확하지만 이번 취득 아님)
        val d = async { s.currentCoordinate(force = true) }; runCurrent()
        src.emit(accuracy = 80.0, lat = 37.6); src.emit(accuracy = 60.0, lat = 37.7) // 30m 초과·100m 이하 → 저장만
        advanceTimeBy(8_001); runCurrent()
        assertEquals(NearbyCoord(37.7, 127.1), d.await())
        val d2 = attempt { s.currentCoordinate(force = true) }; runCurrent(); advanceTimeBy(8_001); runCurrent()
        assertEquals(LocationException.Kind.Unavailable, kindOf(d2.await()))
        assertEquals(37.7, s.stored?.lat) // 실패해도 저장된 좌표는 남는다
    }

    @Test fun `캐시가 신선하고 정확하면 측위 없이 반환한다`() = runTest(dispatcher) {
        val src = FakeSource(); val s = store(src, FakeGate(LocationPermission.None))
        s.stored = LocationStore.StoredFix(37.1, 127.2, 10.0, src.now - 30_000)
        assertEquals(NearbyCoord(37.1, 127.2), s.currentCoordinate())
        assertEquals(0, src.listeners.size)
        src.now += 31_000 // 61초 — TTL 밖
        val d = attempt { s.currentCoordinate() }; runCurrent()
        assertEquals(LocationException.Kind.Denied, kindOf(d.await()))
    }

    @Test fun `COARSE만이면 ReducedAccuracy이고 측위하지 않는다`() = runTest(dispatcher) {
        val src = FakeSource(); val gate = FakeGate(LocationPermission.Coarse); val s = store(src, gate)
        val d = attempt { s.currentCoordinate() }; runCurrent()
        assertEquals(LocationException.Kind.ReducedAccuracy, kindOf(d.await()))
        assertEquals(0, gate.requests); assertEquals(0, src.listeners.size)
    }

    @Test fun `권한 없음은 다이얼로그 뒤 재판정 — 거부면 Denied, 허용이면 취득`() = runTest(dispatcher) {
        val denied = FakeGate(LocationPermission.None, afterRequest = LocationPermission.None)
        val d = attempt { store(FakeSource(), denied).currentCoordinate() }; runCurrent()
        assertEquals(LocationException.Kind.Denied, kindOf(d.await()))
        assertEquals(1, denied.requests)

        val src = FakeSource(); val granted = FakeGate(LocationPermission.None, afterRequest = LocationPermission.Fine)
        val d2 = async { store(src, granted).currentCoordinate() }; runCurrent()
        src.emit(accuracy = 5.0)
        assertEquals(NearbyCoord(37.5, 127.1), d2.await()); assertEquals(1, granted.requests)
    }

    @Test fun `기기 위치 꺼짐은 권한 뒤 취득 앞에서 즉시 Unavailable`() = runTest(dispatcher) {
        val src = FakeSource(enabled = false); val gate = FakeGate(LocationPermission.None, afterRequest = LocationPermission.Fine)
        val d = attempt { store(src, gate).currentCoordinate() }; runCurrent()
        assertEquals(LocationException.Kind.Unavailable, kindOf(d.await()))
        assertEquals(1, gate.requests) // 권한을 먼저 묻는다
        assertEquals(0, src.listeners.size) // 8초를 기다리지 않는다
    }

    @Test fun `융합 제공자가 없으면 GPS(+NETWORK)를 구독하고 로그를 남긴다`() = runTest(dispatcher) {
        val src = FakeSource(providers = setOf(LocationSource.GPS, LocationSource.NETWORK)); val s = store(src, FakeGate(LocationPermission.Fine))
        val d = async { s.currentCoordinate() }; runCurrent()
        assertEquals(listOf(LocationSource.GPS, LocationSource.NETWORK), src.listeners.keys.toList())
        src.emit(accuracy = 8.0); d.await()
        assertEquals(2, src.closed)
        assertEquals(listOf("locationProviders=[gps, network]"), logs)

        val none = FakeSource(providers = emptySet())
        val d2 = attempt { store(none, FakeGate(LocationPermission.Fine)).currentCoordinate() }; runCurrent()
        assertEquals(LocationException.Kind.Unavailable, kindOf(d2.await()))
    }

    @Test fun `취소되면 구독을 닫는다`() = runTest(dispatcher) {
        val src = FakeSource(); val s = store(src, FakeGate(LocationPermission.Fine))
        val d = async { s.currentCoordinate() }; runCurrent()
        assertEquals(1, src.listeners.size)
        d.cancel(); runCurrent()
        assertEquals(1, src.closed); assertEquals(0, src.listeners.size)
    }

    @Test fun `ranking은 권한 없으면 팝업 없이 null이고 실패는 스토어 폴백`() = runTest(dispatcher) {
        val gate = FakeGate(LocationPermission.None, afterRequest = LocationPermission.Fine)
        assertNull(store(FakeSource(), gate).coordinateForRanking()); assertEquals(0, gate.requests)

        val src = FakeSource(); val s = store(src, FakeGate(LocationPermission.Fine))
        s.stored = LocationStore.StoredFix(37.3, 127.3, 90.0, src.now - 100_000) // 100초 전, 90m — softTTL 300s·storeCeiling 100m 안이라 재사용
        assertEquals(NearbyCoord(37.3, 127.3), s.coordinateForRanking()); assertEquals(0, src.listeners.size)
        src.now += 400_000 // 캐시 만료 → 2초 상한 취득 → fix 0 → 스토어 폴백
        val d = async { s.coordinateForRanking() }; runCurrent(); advanceTimeBy(2_001); runCurrent()
        assertEquals(NearbyCoord(37.3, 127.3), d.await())
    }

    @Test fun `hasAccuracy 거짓(-1)은 저장도 수용도 안 된다`() = runTest(dispatcher) {
        val src = FakeSource(); val s = store(src, FakeGate(LocationPermission.Fine))
        val d = attempt { s.currentCoordinate() }; runCurrent()
        src.emit(accuracy = -1.0)
        advanceTimeBy(8_001); runCurrent()
        assertEquals(LocationException.Kind.Unavailable, kindOf(d.await()))
        assertNull(s.stored)
    }

    @Test fun `코어 어댑터는 세 원인을 NearbyLocationError로 번역한다`() = runTest(dispatcher) {
        val src = FakeSource(); val s = store(src, FakeGate(LocationPermission.Coarse))
        val source = s.nearbyCoordinateSource() as NearbyCoordinateSource.Current
        val d = attempt { source.getCoordinate(false) }; runCurrent()
        assertEquals(NearbyLocationError.ReducedAccuracy, d.await().exceptionOrNull())
    }
}
