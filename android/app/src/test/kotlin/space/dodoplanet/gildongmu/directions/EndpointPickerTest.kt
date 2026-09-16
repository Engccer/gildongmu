package space.dodoplanet.gildongmu.directions

import androidx.compose.foundation.text.input.setTextAndPlaceCursorAtEnd
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import space.dodoplanet.gildongmu.kit.APIClient
import space.dodoplanet.gildongmu.kit.DirectionsEndpoint
import space.dodoplanet.gildongmu.kit.HttpResponse
import space.dodoplanet.gildongmu.kit.HttpTransport
import space.dodoplanet.gildongmu.kit.InMemoryKeyValueStore
import space.dodoplanet.gildongmu.kit.NearbyCoord
import space.dodoplanet.gildongmu.kit.RecentEndpoint
import space.dodoplanet.gildongmu.kit.RecentEndpointScope
import space.dodoplanet.gildongmu.kit.RecentSearchStore
import space.dodoplanet.gildongmu.kit.SearchService
import space.dodoplanet.gildongmu.kit.pathOf
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** spec §13-3·판정 32 — 추출된 끝점 검색 모델: ranking 가중·타깃별 selectCurrent·close가 잡을 취소하고 착지를 발급하지 않음·postNotice·manualLocation 스코프. */
@OptIn(ExperimentalCoroutinesApi::class)
class EndpointPickerTest {
    private val dispatcher = StandardTestDispatcher()
    private val selected = ArrayList<Pair<DirectionsEndpoint, DirectionsFieldTarget>>()

    private class Transport(val places: String) : HttpTransport {
        val urls = ArrayList<String>()
        override suspend fun get(url: String, timeoutMs: Long?): HttpResponse {
            urls += url
            return when (pathOf(url)) {
                "/api/places" -> HttpResponse(200, places)
                "/api/address/search" -> HttpResponse(200, """{"addresses":[],"query":"q"}""")
                else -> HttpResponse(404, "")
            }
        }
    }
    private val onePlace = """{"places":[{"id":"k1","name":"강동역","category":"교통","address":"서울","roadAddress":"","lat":37.53,"lng":127.13}],"provider":"kakao-local","query":"강동"}"""

    private fun picker(scope: TestScope, transport: Transport = Transport(onePlace), ranking: suspend () -> NearbyCoord? = { NearbyCoord(37.5, 127.1) }): EndpointPicker {
        val client = APIClient("https://example.test", transport)
        return EndpointPicker(SearchService(client), RecentSearchStore(InMemoryKeyValueStore()), CatalogStrings("ko"), dispatcher, scope, { "ko" }, ranking, closesOnSelect = true) { e, t -> selected += e to t }
    }

    @Test fun `open은 스코프별 최근 목록을 io에서 싣고 manualLocation은 도착지 스코프`() = runTest(dispatcher) {
        val store = RecentSearchStore(InMemoryKeyValueStore())
        store.recordEndpoint(RecentEndpoint("집", 37.5, 127.1), RecentEndpointScope.to)
        val p = EndpointPicker(SearchService(APIClient("https://example.test", Transport(onePlace))), store, CatalogStrings("ko"), dispatcher, this, { "ko" }, { null }, closesOnSelect = true) { _, _ -> }
        p.open(DirectionsFieldTarget.manualLocation); testScheduler.advanceUntilIdle()
        assertEquals(listOf("집"), p.state.value!!.recentEndpoints.map { it.label })
        assertEquals(RecentEndpointScope.to, DirectionsFieldTarget.manualLocation.recentScope)
    }

    @Test fun `submitCandidates는 ranking 좌표를 실어 검색하고 세대·통지를 올린다`() = runTest(dispatcher) {
        val t = Transport(onePlace); val p = picker(this, t)
        p.open(DirectionsFieldTarget.to); p.state.value!!.queryState.setTextAndPlaceCursorAtEnd("강동"); p.submitCandidates()
        assertTrue(p.state.value!!.isSearching); testScheduler.advanceUntilIdle()
        val s = p.state.value!!
        assertEquals(1, s.places.size); assertEquals(1, s.candidateRevision); assertFalse(s.isSearching); assertEquals("후보 1건을 찾았습니다.", s.notice.text)
        assertTrue(t.urls.first { pathOf(it) == "/api/places" }.contains("lat=37.5"))
    }

    @Test fun `selectCurrent는 from·manualLocation에서만 onSelect(Current), to·via는 무시`() = runTest(dispatcher) {
        val p = picker(this)
        for ((target, expect) in listOf(DirectionsFieldTarget.to to 0, DirectionsFieldTarget.via to 0, DirectionsFieldTarget.from to 1, DirectionsFieldTarget.manualLocation to 2)) {
            p.open(target); p.selectCurrent()
            assertEquals(expect, selected.size, target.name)
        }
        assertEquals(DirectionsEndpoint.Current to DirectionsFieldTarget.manualLocation, selected.last())
        assertNull(p.state.value) // 확정 뒤 닫힌다
    }

    @Test fun `close는 진행 중 검색을 취소하고 타깃을 돌려주며 착지를 발급하지 않는다(발급은 호스트)`() = runTest(dispatcher) {
        val p = picker(this)
        p.open(DirectionsFieldTarget.from); p.state.value!!.queryState.setTextAndPlaceCursorAtEnd("강동"); p.submitCandidates()
        assertEquals(DirectionsFieldTarget.from, p.close())
        testScheduler.advanceUntilIdle()
        assertNull(p.state.value); assertTrue(selected.isEmpty()); assertNull(p.close())
    }

    @Test fun `closesOnSelect=false면 확정 뒤에도 열려 있고(지정 화면) 진행 중 검색은 취소된다`() = runTest(dispatcher) {
        val p = EndpointPicker(SearchService(APIClient("https://example.test", Transport(onePlace))), RecentSearchStore(InMemoryKeyValueStore()), CatalogStrings("ko"), dispatcher, this, { "ko" }, { null }, closesOnSelect = false) { e, t -> selected += e to t }
        p.open(DirectionsFieldTarget.manualLocation); p.state.value!!.queryState.setTextAndPlaceCursorAtEnd("강동"); p.submitCandidates()
        p.selectCurrent(); testScheduler.advanceUntilIdle()
        assertEquals(1, selected.size); assertEquals(DirectionsFieldTarget.manualLocation, p.state.value!!.target)
        assertTrue(p.state.value!!.places.isEmpty()) // 확정이 취소한 검색은 상태를 바꾸지 않는다
        p.postNotice("현재 위치 확인 중"); assertEquals("현재 위치 확인 중", p.state.value!!.notice.text)
    }

    @Test fun `postNotice는 단일 창구의 seq를 올린다`() = runTest(dispatcher) {
        val p = picker(this); p.open(DirectionsFieldTarget.manualLocation)
        p.postNotice("현재 위치 확인 중"); assertEquals(1, p.state.value!!.notice.seq); assertEquals("현재 위치 확인 중", p.state.value!!.notice.text)
        p.postNotice("현재 위치 확인 중"); assertEquals(2, p.state.value!!.notice.seq)
    }

    @Test fun `selectPlace는 nameRoman을 싣고 닫는다`() = runTest(dispatcher) {
        val p = picker(this); p.open(DirectionsFieldTarget.from)
        p.selectPlace(space.dodoplanet.gildongmu.kit.models.Place(id = "k1", name = "강동역", nameRoman = "Gangdong", category = "", address = "", roadAddress = "", lat = 37.53, lng = 127.13))
        val (e, t) = selected.single(); assertEquals(DirectionsFieldTarget.from, t)
        assertEquals(DirectionsEndpoint.Place("강동역", 37.53, 127.13, "Gangdong"), e); assertNull(p.state.value)
    }
}
