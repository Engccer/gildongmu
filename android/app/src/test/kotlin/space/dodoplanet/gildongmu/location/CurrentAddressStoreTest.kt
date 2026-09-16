package space.dodoplanet.gildongmu.location

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import space.dodoplanet.gildongmu.kit.APIClient
import space.dodoplanet.gildongmu.kit.HttpResponse
import space.dodoplanet.gildongmu.kit.HttpTransport
import space.dodoplanet.gildongmu.kit.SearchService
import space.dodoplanet.gildongmu.kit.stubbedClient
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** spec §12-4 — 좌표당·언어당 1회, 옛 주소 먼저 폐기, 미허용은 미확정, 취소는 확정 아님, 스냅샷 갱신. */
@OptIn(ExperimentalCoroutinesApi::class)
class CurrentAddressStoreTest {
    private val dispatcher = StandardTestDispatcher()

    private class Source(var stored: LocationStore.StoredFix?) : LocationSource {
        var now = 100_000L
        override fun isLocationEnabled() = true
        override fun hasProvider(name: String) = true
        override fun subscribe(provider: String, onFix: (RawFix) -> Unit): AutoCloseable = AutoCloseable { }
        override fun elapsedRealtimeMs() = now
    }
    private class Gate(var value: LocationPermission) : PermissionGate {
        override fun current() = value
        override suspend fun request() = value
    }

    /** 신선한 캐시를 심어 두면 `coordinateForDisplay`가 측위 없이 그 좌표를 준다. */
    private fun storeAt(lat: Double, lng: Double, gate: Gate = Gate(LocationPermission.Fine)): LocationStore {
        val src = Source(null)
        return LocationStore(src, gate).also { it.stored = LocationStore.StoredFix(lat, lng, 10.0, src.now - 1_000) }
    }

    @Test fun `좌표당 1회, 언어가 바뀌면 다시, 좌표가 갈리면 옛 주소 먼저 폐기`() = runTest(dispatcher) {
        var calls = 0
        val gateThird = CompletableDeferred<Unit>()
        val transport = object : HttpTransport {
            override suspend fun get(url: String, timeoutMs: Long?): HttpResponse {
                calls++
                if (calls == 3) gateThird.await() // 좌표가 갈린 뒤의 조회를 붙잡아 "옛 주소 먼저 폐기"를 관찰한다
                return HttpResponse(200, if ("lang=en" in url) """{"address":"천호대로 1","addressEn":"1 Cheonho-daero"}""" else """{"address":"천호대로 1"}""")
            }
        }
        val loc = storeAt(37.5, 127.1)
        val store = CurrentAddressStore(loc, SearchService(APIClient("https://example.test", transport)))
        store.ensureLoaded("ko"); assertEquals(1, calls); assertEquals("천호대로 1", store.state.value.address); assertNull(store.state.value.english)
        store.ensureLoaded("ko"); assertEquals(1, calls)
        store.ensureLoaded("en"); assertEquals(2, calls); assertEquals("1 Cheonho-daero", store.state.value.english)
        loc.stored = LocationStore.StoredFix(37.6, 127.2, 10.0, 99_000)
        val job = launch { store.ensureLoaded("en") }
        runCurrent()
        assertEquals(3, calls); assertNull(store.state.value.address) // 새 주소가 오기 전에 옛 주소가 비워졌다
        gateThird.complete(Unit); runCurrent(); job.join()
        assertEquals("천호대로 1", store.state.value.address)
    }

    @Test fun `미허용이면 네트워크 0·loadedKey 미확정 — 허용 뒤 조회되고 스냅샷은 권한을 반영한다`() = runTest(dispatcher) {
        var calls = 0
        val gate = Gate(LocationPermission.None)
        val loc = storeAt(37.5, 127.1, gate)
        val store = CurrentAddressStore(loc, SearchService(stubbedClient { calls++; HttpResponse(200, """{"address":"길동"}""") }))
        store.ensureLoaded("ko"); assertEquals(0, calls); assertEquals(LocationPermission.None, store.state.value.permission)
        gate.value = LocationPermission.Fine
        store.ensureLoaded("ko"); assertEquals(1, calls); assertEquals("길동", store.state.value.address); assertEquals(LocationPermission.Fine, store.state.value.permission)
    }

    @Test fun `취소는 확정이 아니다 — 다시 부르면 한 번 더 조회한다`() = runTest(dispatcher) {
        var calls = 0
        val hang = CompletableDeferred<Unit>()
        val transport = object : HttpTransport {
            override suspend fun get(url: String, timeoutMs: Long?): HttpResponse { calls++; if (calls == 1) hang.await(); return HttpResponse(200, """{"address":"길동"}""") }
        }
        val search = SearchService(APIClient("https://example.test", transport))
        val store = CurrentAddressStore(storeAt(37.5, 127.1), search)
        val job = launch { store.ensureLoaded("ko") }
        runCurrent(); assertEquals(1, calls)
        job.cancel(); runCurrent()
        assertNull(store.state.value.address)
        store.ensureLoaded("ko"); assertEquals(2, calls); assertEquals("길동", store.state.value.address)
    }

    @Test fun `역지오코딩 실패는 그 좌표의 확정 결과(재시도 없음), 주소 없음`() = runTest(dispatcher) {
        var calls = 0
        val store = CurrentAddressStore(storeAt(37.5, 127.1), SearchService(stubbedClient { calls++; HttpResponse(500, "") }))
        store.ensureLoaded("ko"); store.ensureLoaded("ko")
        assertEquals(1, calls); assertNull(store.state.value.address); assertTrue(store.state.value.hasCoordinate); assertFalse(store.state.value.lastFixFailed)
    }
}
