package space.dodoplanet.gildongmu.directions

import androidx.lifecycle.SavedStateHandle
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.extension.RegisterExtension
import space.dodoplanet.gildongmu.MainDispatcherExtension
import space.dodoplanet.gildongmu.kit.*
import kotlin.coroutines.Continuation
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine
import kotlin.test.*

/** 취소에 협조하지 않는 측위·전송을 테스트가 원하는 순서로 끝낸다. */
@OptIn(ExperimentalCoroutinesApi::class)
class DirectionsAddressTest {
    private val dispatcher = StandardTestDispatcher()
    @JvmField @RegisterExtension val main = MainDispatcherExtension(dispatcher)
    private val seoul = NearbyCoord(37.5385, 127.1355)
    private val destination = DirectionsEndpoint.Place("역", 37.4979, 127.0276)

    private class Gate<T> {
        val pending = ArrayDeque<Continuation<T>>()
        suspend fun wait(): T = suspendCoroutine { pending.addLast(it) }
        fun finish(value: T) = pending.removeFirst().resume(value)
    }

    private inner class Harness {
        var language = "en"
        val locations = Gate<NearbyCoord>()
        val replies = Gate<HttpResponse>()
        val urls = mutableListOf<String>()
        val client = APIClient("https://example.test", object : HttpTransport {
            override suspend fun get(url: String, timeoutMs: Long?): HttpResponse {
                if (pathOf(url) != "/api/geocode/reverse") return HttpResponse(502, "")
                urls += url
                return replies.wait()
            }
        })
        val model = DirectionsViewModel(
            RouteService(client), SearchService(client), RecentSearchStore(InMemoryKeyValueStore()),
            object : EndpointLocator {
                override suspend fun currentCoordinate(force: Boolean) = locations.wait()
                override suspend fun coordinateForRanking() = locations.wait()
                override suspend fun requestPreciseLocation() = false
            }, { language }, CatalogStrings("ko"), SavedStateHandle(),
            prefill = MutableStateFlow(null), io = dispatcher,
        )
        fun run() = dispatcher.scheduler.runCurrent()
        fun reply(original: String = "새 주소", english: String = "New address") =
            replies.finish(HttpResponse(200, """{"address":"$original","addressEn":"$english"}"""))
    }

    @Test fun `초기 로딩 중 재진입은 측위를 중복하지 않는다`() = runTest(dispatcher) {
        val h = Harness()
        h.model.loadCurrentAddressIfAuthorized(); h.run()
        h.model.loadCurrentAddressIfAuthorized(); h.run()
        assertEquals(1, h.locations.pending.size)
        h.locations.finish(seoul); h.run(); h.reply(); h.run()
    }

    @Test fun `필드 변경 뒤 늦은 측위는 주소 요청을 시작하지 않는다`() = runTest(dispatcher) {
        val h = Harness()
        h.model.refreshCurrentLocation(); h.run()
        h.model.setEndpoint(destination, DirectionsFieldTarget.from)
        h.locations.finish(seoul); h.run()
        assertTrue(h.urls.isEmpty())
        assertFalse(h.model.state.value.isRefreshingCurrent)
    }

    @Test fun `언어 변경 전 측위는 주소 요청 자격을 잃는다`() = runTest(dispatcher) {
        val h = Harness()
        h.model.loadCurrentAddressIfAuthorized(); h.run()
        h.language = "ko"
        h.locations.finish(seoul); h.run()
        assertTrue(h.urls.isEmpty())
        h.model.loadCurrentAddressIfAuthorized(); h.run()
        assertEquals(1, h.locations.pending.size)
        h.locations.finish(seoul); h.run(); h.reply(); h.run()
        assertTrue(queryOf(h.urls.single()).split('&').contains("lang=ko"))
    }

    @Test fun `언어 변경 뒤 늦은 주소는 커밋하지 않고 재진입 때 다시 읽는다`() = runTest(dispatcher) {
        val h = Harness()
        h.model.loadCurrentAddressIfAuthorized(); h.run()
        h.locations.finish(seoul); h.run()
        h.language = "ko"
        h.reply("옛 주소", "Old"); h.run()
        assertNull(h.model.state.value.currentAddress)
        h.model.loadCurrentAddressIfAuthorized(); h.run()
        assertEquals(1, h.locations.pending.size)
        h.locations.finish(seoul); h.run(); h.reply(); h.run()
        assertEquals("새 주소", h.model.state.value.currentAddress)
    }

    @Test fun `이전 측위의 종료가 최신 새로고침의 로딩을 끄지 않는다`() = runTest(dispatcher) {
        val h = Harness()
        h.model.refreshCurrentLocation(); h.run()
        h.model.setEndpoint(destination, DirectionsFieldTarget.to)
        h.model.refreshCurrentLocation(); h.run()
        assertEquals(2, h.locations.pending.size)
        h.locations.finish(seoul); h.run()
        assertTrue(h.model.state.value.isRefreshingCurrent)
        assertTrue(h.urls.isEmpty())
        h.locations.finish(seoul); h.run(); h.reply(); h.run()
        assertFalse(h.model.state.value.isRefreshingCurrent)
        assertEquals("New address", h.model.state.value.currentAddressEnglish)
    }

    @Test fun `경로 조회 측위도 필드 변경 후 주소를 되살리지 않는다`() = runTest(dispatcher) {
        val h = Harness()
        h.model.setEndpoint(destination, DirectionsFieldTarget.to)
        h.model.runQuery(); h.run()
        h.model.swap()
        h.locations.finish(seoul); h.run()
        assertTrue(h.urls.isEmpty())
        assertEquals(DirectionsPhase.Idle, h.model.state.value.phase)
    }

    @Test fun `이전 주소의 종료도 최신 새로고침의 로딩을 끄지 않는다`() = runTest(dispatcher) {
        val h = Harness()
        h.model.refreshCurrentLocation(); h.run()
        h.locations.finish(seoul); h.run()
        h.model.setEndpoint(destination, DirectionsFieldTarget.to)
        h.model.refreshCurrentLocation(); h.run()
        h.reply("옛 주소", "Old"); h.run()
        assertTrue(h.model.state.value.isRefreshingCurrent)
        assertNull(h.model.state.value.currentAddress)
        h.locations.finish(seoul); h.run(); h.reply(); h.run()
        assertEquals("새 주소", h.model.state.value.currentAddress)
        assertFalse(h.model.state.value.isRefreshingCurrent)
    }

    @Test fun `로드 완료 뒤 언어 변경 재진입은 주소 쌍을 다시 읽는다`() = runTest(dispatcher) {
        val h = Harness()
        h.model.loadCurrentAddressIfAuthorized(); h.run()
        h.locations.finish(seoul); h.run(); h.reply(); h.run()
        h.model.loadCurrentAddressIfAuthorized(); h.run()
        assertTrue(h.locations.pending.isEmpty())
        h.language = "ko"
        h.model.loadCurrentAddressIfAuthorized(); h.run()
        assertNull(h.model.state.value.currentAddress)
        assertNull(h.model.state.value.currentAddressEnglish)
        h.locations.finish(seoul); h.run(); h.reply("한국어 주소", "Korean address"); h.run()
        assertEquals("한국어 주소", h.model.state.value.currentAddress)
        assertEquals(2, h.urls.size)
    }

    @Test fun `최신 주소 오류는 이전 주소 쌍을 비우며 새로고침은 중복하지 않는다`() = runTest(dispatcher) {
        val h = Harness()
        h.model.loadCurrentAddressIfAuthorized(); h.run()
        h.locations.finish(seoul); h.run(); h.reply(); h.run()
        h.model.refreshCurrentLocation(); h.model.refreshCurrentLocation(); h.run()
        assertEquals(1, h.locations.pending.size)
        h.locations.finish(seoul); h.run()
        h.replies.finish(HttpResponse(502, "")); h.run()
        assertNull(h.model.state.value.currentAddress)
        assertNull(h.model.state.value.currentAddressEnglish)
        assertFalse(h.model.state.value.isRefreshingCurrent)
    }
}
