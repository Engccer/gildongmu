package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.ReverseGeocodeResponse
import kotlin.test.*

/** iOS DirectionsAddressStateTests의 판정 전수. 비동기 배선은 앱 DirectionsAddressTest가 검증한다. */
class DirectionsAddressStateTest {
    private fun response(original: String? = "주소", english: String? = "Address") = ReverseGeocodeResponse(original, english)

    @Test fun `역순 응답과 이전 오류는 최신 주소 쌍을 덮지 않는다`() {
        val state = DirectionsAddressState()
        val old = state.begin("en")
        val latest = state.begin("en")
        assertTrue(state.commit(response(), latest, "en", false))
        assertFalse(state.commit(response("옛 주소", "Old"), old, "en", false))
        assertFalse(state.commit(null, old, "en", false))
        assertEquals(DirectionsAddressState.Address("주소", "Address"), state.address)
    }

    @Test fun `취소된 측위와 응답은 수용하지 않는다`() {
        for (cancelTask in listOf(false, true)) {
            val state = DirectionsAddressState()
            val request = state.begin("en")
            if (!cancelTask) state.cancel()
            assertFalse(state.accepts(request, "en", cancelTask))
            assertFalse(state.commit(response(), request, "en", cancelTask))
            state.finish(request)
            assertFalse(state.hasLoaded)
            assertFalse(state.isLoading)
            assertEquals(DirectionsAddressState.Address(null, null), state.address)
        }
    }

    @Test fun `이전 요청의 종료는 최신 요청의 로딩을 끄지 않는다`() {
        val state = DirectionsAddressState()
        val old = state.begin("en")
        val latest = state.begin("en")
        assertFalse(state.accepts(old, "en", false))
        assertFalse(state.finish(old))
        assertTrue(state.isLoading)
        assertTrue(state.accepts(latest, "en", false))
        assertTrue(state.finish(latest))
        assertFalse(state.isLoading)
    }

    @Test fun `취소한 초기 로드는 재진입 시 재시도할 수 있다`() {
        val state = DirectionsAddressState()
        val old = state.begin("en")
        state.cancel()
        assertFalse(state.hasLoaded)
        assertFalse(state.isLoading)
        val latest = state.begin("en")
        assertFalse(state.commit(response("옛 주소", "Old"), old, "en", false))
        assertFalse(state.finish(old))
        assertFalse(state.hasLoaded)
        assertTrue(state.isLoading)
        assertTrue(state.commit(response(), latest, "en", false))
        assertTrue(state.hasLoaded)
        assertFalse(state.isLoading)
    }

    @Test fun `언어가 바뀌면 측위와 주소의 수용 자격이 없다`() {
        val state = DirectionsAddressState()
        val request = state.begin("en")
        assertEquals("en", request.language)
        assertFalse(state.accepts(request, "ko", false))
        assertFalse(state.commit(response(), request, "ko", false))
        state.finish(request)
        assertFalse(state.hasLoaded)
        assertFalse(state.isLoading)
    }

    @Test fun `취소는 주소를 보존하고 최신 오류와 원문 부재는 두 주소를 비운다`() {
        for (result in listOf(response(null, "Orphan"), null)) {
            val state = DirectionsAddressState()
            state.commit(response(), state.begin("en"), "en", false)
            state.begin("en")
            state.cancel()
            assertEquals(DirectionsAddressState.Address("주소", "Address"), state.address)
            assertTrue(state.commit(result, state.begin("en"), "en", false))
            assertEquals(DirectionsAddressState.Address(null, null), state.address)
            assertTrue(state.hasLoaded)
        }
    }

    @Test fun `영문이 없으면 응답의 로마자 후보를 사용한다`() {
        val state = DirectionsAddressState()
        state.commit(ReverseGeocodeResponse("주소", addressRoman = "Juso"), state.begin("en"), "en", false)
        assertEquals("Juso", state.address.english)
    }

    @Test fun `언어 초기화 뒤에도 이전 상태의 요청은 충돌하지 않는다`() {
        val oldState = DirectionsAddressState()
        val old = oldState.begin("en")
        val state = DirectionsAddressState()
        state.begin("en")
        assertFalse(state.commit(response(), old, "en", false))
        assertFalse(state.finish(old))
        assertTrue(state.isLoading)
    }

    @Test fun `비우기는 완료 표식을 내리고 요청 세대는 그대로 둔다(stale-origin N-3·F-3)`() {
        val state = DirectionsAddressState()
        assertTrue(state.commit(ReverseGeocodeResponse("옛 주소"), state.begin("ko"), "ko", false))
        assertTrue(state.hasLoaded)
        val request = state.begin("ko")
        state.clearAddress()
        assertEquals(DirectionsAddressState.Address(null, null), state.address)
        assertFalse(state.hasLoaded) // 취소돼도 재진입이 다시 받는다
        assertTrue(state.isLoading)
        assertTrue(state.commit(ReverseGeocodeResponse("주소"), request, "ko", false))
        assertEquals("주소", state.address.original)
        assertTrue(state.hasLoaded)
    }
}
