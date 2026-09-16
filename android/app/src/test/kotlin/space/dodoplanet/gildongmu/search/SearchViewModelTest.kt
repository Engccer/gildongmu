package space.dodoplanet.gildongmu.search

import androidx.compose.foundation.text.input.setTextAndPlaceCursorAtEnd
import androidx.lifecycle.SavedStateHandle
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.extension.RegisterExtension
import space.dodoplanet.gildongmu.MainDispatcherExtension
import space.dodoplanet.gildongmu.kit.APIClient
import space.dodoplanet.gildongmu.kit.HttpResponse
import space.dodoplanet.gildongmu.kit.HttpTransport
import space.dodoplanet.gildongmu.kit.InMemoryKeyValueStore
import space.dodoplanet.gildongmu.kit.NearbyCoord
import space.dodoplanet.gildongmu.kit.models.PlaceSort
import space.dodoplanet.gildongmu.kit.RecentSearchStore
import space.dodoplanet.gildongmu.kit.SearchService
import space.dodoplanet.gildongmu.kit.pathOf
import space.dodoplanet.gildongmu.kit.queryOf
import space.dodoplanet.gildongmu.kit.stubbedClient
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** iOS `SearchModel` 계약을 JVM에서 잠근다. 전송·저장소는 :kit testFixtures 스텁. */
@OptIn(ExperimentalCoroutinesApi::class)
class SearchViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @JvmField
    @RegisterExtension
    val main = MainDispatcherExtension(dispatcher)

    private val strings = SearchStrings(
        searchingFor = { "'$it' 검색 중…" }, failed = { "실패" }, empty = { "없음" }, count = { "결과 $it 건" },
        deleted = { "삭제했습니다" }, cleared = { "모두 지웠습니다" }, clearedExceptPinned = { "고정 제외 지움" },
    )
    private val placesK2 = """{"places":[{"id":"k2","name":"강남역","category":"교통,수송 > 지하철","address":"서울 강남구","roadAddress":"서울 강남구 강남대로","lat":37.49,"lng":127.02}],"provider":"kakao-local","query":"강남"}"""
    private val places = """{"places":[{"id":"k1","name":"강동역","category":"교통,수송 > 지하철","address":"서울 강동구","roadAddress":"서울 강동구 천호대로","lat":37.5,"lng":127.1}],"provider":"kakao-local","query":"강동"}"""
    private val emptyPlaces = """{"places":[],"provider":"none","query":"q"}"""
    private val emptyAddr = """{"addresses":[],"query":"q"}"""
    private val emptyWeb = """{"web":[]}"""

    private fun byPath(vararg routes: Pair<String, HttpResponse>): (String) -> HttpResponse = { url ->
        routes.firstOrNull { it.first == pathOf(url) }?.second ?: HttpResponse(404, "")
    }

    private fun vm(
        handler: (String) -> HttpResponse,
        store: RecentSearchStore = RecentSearchStore(InMemoryKeyValueStore()),
        saved: SavedStateHandle = SavedStateHandle(),
        dataLocale: String = "ko",
        coordinate: suspend () -> NearbyCoord? = { null },
    ) = SearchViewModel(SearchService(stubbedClient(handler)), store, { dataLocale }, strings, saved, io = dispatcher, coordinate = coordinate)

    private val mergedPlaces = """{"places":[{"id":"k1","name":"강동역","category":"교통","address":"서울 강동구","roadAddress":"서울 강동구 천호대로","lat":37.5,"lng":127.1,"distanceMeters":120}],"provider":"merged","query":"강동"}"""

    @Test fun `제출은 기록·필터 리셋·검색 중 통지·결과 통지·세대 증가 순이다`() = runTest(dispatcher) {
        // 전송이 중단점 없이 즉시 답하면 runCurrent가 검색을 끝까지 돌려 중간 상태를 볼 수 없다 — 지연 전송으로 관측한다.
        val slow = object : HttpTransport {
            override suspend fun get(url: String, timeoutMs: Long?): HttpResponse {
                delay(1_000)
                return if (pathOf(url) == "/api/places") HttpResponse(200, places) else HttpResponse(200, emptyAddr)
            }
        }
        val m = SearchViewModel(SearchService(APIClient("https://example.test", slow)), RecentSearchStore(InMemoryKeyValueStore()), { "ko" }, strings, SavedStateHandle(), io = dispatcher)
        m.queryState.setTextAndPlaceCursorAtEnd(" 강동 ")
        m.setBucket("food")
        m.submit()
        assertTrue(m.state.value.isSearching) // 동기 진입(iOS와 같다) — 버튼 가드가 첫 디스패치를 기다리지 않는다
        dispatcher.scheduler.runCurrent() // 기록까지
        assertEquals("'강동' 검색 중…", m.state.value.notice.text); assertNull(m.state.value.notice.haptic) // 진행 통지는 진동 없음
        assertNull(m.state.value.bucket)
        assertEquals(listOf("강동"), m.state.value.recentQueries.map { it.text })
        dispatcher.scheduler.advanceUntilIdle()
        val s = m.state.value
        assertFalse(s.isSearching); assertFalse(s.failed)
        assertEquals(1, s.totalCount); assertEquals(1, s.resultsRevision)
        assertEquals("결과 1 건", s.notice.text); assertEquals(space.dodoplanet.gildongmu.a11y.HapticKind.success, s.notice.haptic)
        assertEquals(listOf("k1"), s.outcome?.places?.items?.map { it.id })
    }

    @Test fun `빈 질의는 무시된다`() = runTest(dispatcher) {
        val m = vm(handler = { HttpResponse(500, "") })
        m.queryState.setTextAndPlaceCursorAtEnd("   ")
        m.submit()
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals(0, m.state.value.resultsRevision); assertFalse(m.state.value.isSearching)
    }

    @Test fun `장소·주소 둘 다 실패면 failed, 빈 성공이면 empty`() = runTest(dispatcher) {
        val broken = vm(handler = { HttpResponse(502, """{"error":"실패"}""") })
        broken.queryState.setTextAndPlaceCursorAtEnd("q"); broken.submit(); dispatcher.scheduler.advanceUntilIdle()
        assertTrue(broken.state.value.failed); assertEquals("실패", broken.state.value.notice.text); assertEquals(space.dodoplanet.gildongmu.a11y.HapticKind.failure, broken.state.value.notice.haptic)

        val empty = vm(byPath("/api/places" to HttpResponse(200, emptyPlaces), "/api/address/search" to HttpResponse(200, emptyAddr), "/api/search/web" to HttpResponse(200, emptyWeb)))
        empty.queryState.setTextAndPlaceCursorAtEnd("q"); empty.submit(); dispatcher.scheduler.advanceUntilIdle()
        assertFalse(empty.state.value.failed); assertEquals(0, empty.state.value.totalCount); assertEquals("없음", empty.state.value.notice.text); assertEquals(space.dodoplanet.gildongmu.a11y.HapticKind.attention, empty.state.value.notice.haptic)
    }

    @Test fun `새 제출은 앞 검색을 취소하고 나중 질의의 응답만 상태에 남는다`() = runTest(dispatcher) {
        // 첫 질의(강동)는 10초 뒤 k1, 둘째(강남)는 1초 뒤 k2 — 취소가 없으면 k1이 나중에 도착해 상태를 덮는다.
        val transport = object : HttpTransport {
            override suspend fun get(url: String, timeoutMs: Long?): HttpResponse {
                if (pathOf(url) != "/api/places") return HttpResponse(200, emptyAddr)
                val gangdong = queryOf(url).contains("query=%EA%B0%95%EB%8F%99")
                delay(if (gangdong) 10_000 else 1_000)
                return HttpResponse(200, if (gangdong) places else placesK2)
            }
        }
        val m = SearchViewModel(SearchService(APIClient("https://example.test", transport)), RecentSearchStore(InMemoryKeyValueStore()), { "ko" }, strings, SavedStateHandle(), io = dispatcher)
        m.queryState.setTextAndPlaceCursorAtEnd("강동"); m.submit()
        dispatcher.scheduler.advanceTimeBy(100)
        m.queryState.setTextAndPlaceCursorAtEnd("강남"); m.submit()
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals(1, m.state.value.resultsRevision)
        assertEquals(listOf("k2"), m.state.value.outcome?.places?.items?.map { it.id })
        assertEquals(listOf("강남", "강동"), m.state.value.recentQueries.map { it.text })
    }

    @Test fun `제출은 최근 검색 첫 로드를 기다린 뒤 기록해 로드가 기록을 덮지 않는다`() = runTest(dispatcher) {
        val store = RecentSearchStore(InMemoryKeyValueStore()).also { it.recordQuery("옛것") }
        val m = vm(byPath("/api/places" to HttpResponse(200, places), "/api/address/search" to HttpResponse(200, emptyAddr)), store)
        m.queryState.setTextAndPlaceCursorAtEnd("새것"); m.submit() // init 로드가 아직 돌지 않았다
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals(listOf("새것", "옛것"), m.state.value.recentQueries.map { it.text })
    }

    @Test fun `통지 seq는 같은 문장이라도 매번 증가한다`() = runTest(dispatcher) {
        val store = RecentSearchStore(InMemoryKeyValueStore()).also { it.recordQuery("a"); it.recordQuery("b") }
        val m = vm({ HttpResponse(404, "") }, store)
        dispatcher.scheduler.advanceUntilIdle()
        m.removeRecent("b"); val first = m.state.value.notice
        m.removeRecent("a"); val second = m.state.value.notice
        assertEquals(first.text, second.text); assertEquals(first.seq + 1, second.seq)
    }

    @Test fun `최근 검색 삭제의 착지 대상은 다음 → 이전 → null`() = runTest(dispatcher) {
        val store = RecentSearchStore(InMemoryKeyValueStore()).also { it.recordQuery("a"); it.recordQuery("b"); it.recordQuery("c") } // [c, b, a]
        val m = vm({ HttpResponse(404, "") }, store)
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals("a", m.removeRecent("b")) // [c, a] → 다음 행 a
        assertEquals("c", m.removeRecent("a")) // [c] → 이전 행 c
        assertNull(m.removeRecent("c")) // 소멸
        assertNull(m.removeRecent("ghost"))
    }

    @Test fun `고정 토글은 자리를 유지하고 저장소에 반영된다`() = runTest(dispatcher) {
        val kv = InMemoryKeyValueStore()
        val store = RecentSearchStore(kv).also { it.recordQuery("a"); it.recordQuery("b") } // [b, a]
        val m = vm({ HttpResponse(404, "") }, store)
        dispatcher.scheduler.advanceUntilIdle()
        m.togglePinRecent("a")
        assertEquals(listOf("b", "a"), m.state.value.recentQueries.map { it.text })
        assertTrue(m.state.value.recentQueries[1].pinned)
        assertEquals(listOf("a", "b"), RecentSearchStore(kv).queries().map { it.text }) // 저장소는 고정 블록 앞
    }

    @Test fun `모두 지우기는 고정을 남기고 남으면 다른 문장을 낸다`() = runTest(dispatcher) {
        val store = RecentSearchStore(InMemoryKeyValueStore()).also { it.recordQuery("a"); it.recordQuery("b"); it.setQueryPinned("a", true) }
        val m = vm({ HttpResponse(404, "") }, store)
        dispatcher.scheduler.advanceUntilIdle()
        m.clearRecent()
        assertEquals(listOf("a"), m.state.value.recentQueries.map { it.text }); assertEquals("고정 제외 지움", m.state.value.notice.text)
        m.togglePinRecent("a"); m.clearRecent()
        assertTrue(m.state.value.recentQueries.isEmpty()); assertEquals("모두 지웠습니다", m.state.value.notice.text)
    }

    @Test fun `프로세스 재생성 뒤 검색어만 복원된다`() = runTest(dispatcher) {
        val m = vm({ HttpResponse(404, "") }, saved = SavedStateHandle(mapOf(SearchViewModel.QUERY_KEY to "강동")))
        assertEquals("강동", m.queryState.text.toString()); assertNull(m.state.value.outcome)
        m.clearQuery(); assertEquals("", m.queryState.text.toString())
    }

    // ── M2 §3-3: 좌표 가중(직렬)·리뷰순 토글·pop 복귀 키

    @Test fun `제출은 좌표를 먼저 기다린 뒤 lat·lng를 싣고 거리가 행에 흐른다`() = runTest(dispatcher) {
        val urls = ArrayList<String>()
        val m = vm(handler = { url -> urls += url; if (pathOf(url) == "/api/places") HttpResponse(200, mergedPlaces) else HttpResponse(200, emptyAddr) },
            coordinate = { delay(500); NearbyCoord(37.5, 127.0) })
        m.queryState.setTextAndPlaceCursorAtEnd("강동"); m.submit()
        dispatcher.scheduler.advanceTimeBy(100); dispatcher.scheduler.runCurrent()
        assertTrue(urls.none { pathOf(it) == "/api/places" }) // 좌표 전에 검색을 보내지 않는다(직렬)
        dispatcher.scheduler.advanceUntilIdle()
        val places = urls.first { pathOf(it) == "/api/places" }
        assertTrue(queryOf(places).contains("lat=37.5") && queryOf(places).contains("lng=127.0"), places)
        assertEquals(120.0, m.state.value.outcome?.places?.items?.first()?.distanceMeters)
    }

    @Test fun `리뷰순 토글 노출은 ko + 네이버 관측 래치`() = runTest(dispatcher) {
        val ko = vm(byPath("/api/places" to HttpResponse(200, mergedPlaces), "/api/address/search" to HttpResponse(200, emptyAddr)))
        ko.queryState.setTextAndPlaceCursorAtEnd("강동"); ko.submit(); dispatcher.scheduler.advanceUntilIdle()
        assertTrue(ko.state.value.canSortByReview)
        val kakaoOnly = vm(byPath("/api/places" to HttpResponse(200, places), "/api/address/search" to HttpResponse(200, emptyAddr)))
        kakaoOnly.queryState.setTextAndPlaceCursorAtEnd("강동"); kakaoOnly.submit(); dispatcher.scheduler.advanceUntilIdle()
        assertFalse(kakaoOnly.state.value.canSortByReview)
        val en = vm(byPath("/api/places" to HttpResponse(200, mergedPlaces), "/api/address/search" to HttpResponse(200, emptyAddr)), dataLocale = "en")
        en.queryState.setTextAndPlaceCursorAtEnd("gangdong"); en.submit(); dispatcher.scheduler.advanceUntilIdle()
        assertFalse(en.state.value.canSortByReview)
    }

    @Test fun `토글은 입력창을 마지막 질의로 되돌리고 sort=review로 재조회하며 착지 없음`() = runTest(dispatcher) {
        val urls = ArrayList<String>()
        val m = vm(handler = { url -> urls += url; if (pathOf(url) == "/api/places") HttpResponse(200, mergedPlaces) else HttpResponse(200, emptyAddr) })
        m.queryState.setTextAndPlaceCursorAtEnd("강동"); m.submit(); dispatcher.scheduler.advanceUntilIdle()
        m.queryState.setTextAndPlaceCursorAtEnd("다른 글"); m.setBucket("food")
        m.toggleSort(); dispatcher.scheduler.advanceUntilIdle()
        assertEquals("강동", m.queryState.text.toString())
        assertEquals(PlaceSort.review, m.state.value.sort); assertNull(m.state.value.bucket)
        assertTrue(queryOf(urls.last { pathOf(it) == "/api/places" }).contains("sort=review"))
        assertEquals(2, m.state.value.resultsRevision); assertEquals(2, m.consumedRevision) // 착지 없음
        // 다음 일반 제출에도 sort 유지
        m.submit(); dispatcher.scheduler.advanceUntilIdle()
        assertTrue(queryOf(urls.last { pathOf(it) == "/api/places" }).contains("sort=review"))
    }

    @Test fun `리뷰순 재조회의 장소 트랙 실패는 정렬을 되돌리고, 일반 제출 실패는 되돌리지 않는다`() = runTest(dispatcher) {
        var fail = false
        val m = vm(handler = { url -> if (pathOf(url) == "/api/places") (if (fail) HttpResponse(502, "") else HttpResponse(200, mergedPlaces)) else HttpResponse(200, emptyAddr) })
        m.queryState.setTextAndPlaceCursorAtEnd("강동"); m.submit(); dispatcher.scheduler.advanceUntilIdle()
        fail = true
        m.toggleSort(); dispatcher.scheduler.advanceUntilIdle()
        assertEquals(PlaceSort.accuracy, m.state.value.sort) // 롤백
        fail = false
        m.toggleSort(); dispatcher.scheduler.advanceUntilIdle()
        assertEquals(PlaceSort.review, m.state.value.sort)
        fail = true
        m.submit(); dispatcher.scheduler.advanceUntilIdle() // 일반 제출 실패
        assertEquals(PlaceSort.review, m.state.value.sort)
    }

    @Test fun `검색 중이거나 제출 이력이 없으면 토글을 무시한다`() = runTest(dispatcher) {
        val m = vm(handler = { HttpResponse(404, "") })
        m.toggleSort(); assertEquals(PlaceSort.accuracy, m.state.value.sort)
        m.queryState.setTextAndPlaceCursorAtEnd("q"); m.submit()
        m.toggleSort(); assertEquals(PlaceSort.accuracy, m.state.value.sort) // isSearching
        dispatcher.scheduler.advanceUntilIdle()
    }

    @Test fun `pop 복귀 키는 결과가 있을 때 한 번만, 결과가 없으면 null`() = runTest(dispatcher) {
        val m = vm(handler = { HttpResponse(404, "") })
        m.rememberReturnFocus("place-k1")
        assertNull(m.takeReturnFocus()) // outcome 없음 → 시도 없이 지운다
        val loaded = vm(byPath("/api/places" to HttpResponse(200, places), "/api/address/search" to HttpResponse(200, emptyAddr)))
        loaded.queryState.setTextAndPlaceCursorAtEnd("강동"); loaded.submit(); dispatcher.scheduler.advanceUntilIdle()
        loaded.rememberReturnFocus("place-k1")
        assertEquals("place-k1", loaded.takeReturnFocus()); assertNull(loaded.takeReturnFocus())
    }
}
