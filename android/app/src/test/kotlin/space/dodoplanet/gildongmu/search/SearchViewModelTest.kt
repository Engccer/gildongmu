package space.dodoplanet.gildongmu.search

import androidx.compose.foundation.text.input.setTextAndPlaceCursorAtEnd
import androidx.lifecycle.SavedStateHandle
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.extension.ExtendWith
import org.junit.jupiter.api.extension.RegisterExtension
import space.dodoplanet.gildongmu.MainDispatcherExtension
import space.dodoplanet.gildongmu.kit.APIClient
import space.dodoplanet.gildongmu.kit.HttpResponse
import space.dodoplanet.gildongmu.kit.HttpTransport
import space.dodoplanet.gildongmu.kit.InMemoryKeyValueStore
import space.dodoplanet.gildongmu.kit.RecentSearchStore
import space.dodoplanet.gildongmu.kit.SearchService
import space.dodoplanet.gildongmu.kit.pathOf
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
        searchingFor = { "'$it' 검색 중…" }, failed = "실패", empty = "없음", count = { "결과 $it 건" },
        deleted = "삭제했습니다", cleared = "모두 지웠습니다", clearedExceptPinned = "고정 제외 지움",
    )
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
    ) = SearchViewModel(SearchService(stubbedClient(handler)), store, { "ko" }, strings, saved, io = dispatcher)

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
        dispatcher.scheduler.runCurrent() // 기록·검색 중 상태까지
        assertTrue(m.state.value.isSearching)
        assertEquals("'강동' 검색 중…", m.state.value.notice.text)
        assertNull(m.state.value.bucket)
        assertEquals(listOf("강동"), m.state.value.recentQueries.map { it.text })
        dispatcher.scheduler.advanceUntilIdle()
        val s = m.state.value
        assertFalse(s.isSearching); assertFalse(s.failed)
        assertEquals(1, s.totalCount); assertEquals(1, s.resultsRevision)
        assertEquals("결과 1 건", s.notice.text)
        assertEquals("강동", s.outcome?.let { m.queryState.text.toString().trim() })
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
        assertTrue(broken.state.value.failed); assertEquals("실패", broken.state.value.notice.text)

        val empty = vm(byPath("/api/places" to HttpResponse(200, emptyPlaces), "/api/address/search" to HttpResponse(200, emptyAddr), "/api/search/web" to HttpResponse(200, emptyWeb)))
        empty.queryState.setTextAndPlaceCursorAtEnd("q"); empty.submit(); dispatcher.scheduler.advanceUntilIdle()
        assertFalse(empty.state.value.failed); assertEquals(0, empty.state.value.totalCount); assertEquals("없음", empty.state.value.notice.text)
    }

    @Test fun `새 제출은 앞 검색을 취소해 stale 결과가 상태를 쓰지 않는다`() = runTest(dispatcher) {
        val slow = object : HttpTransport {
            override suspend fun get(url: String, timeoutMs: Long?): HttpResponse {
                if (pathOf(url) == "/api/places") { delay(10_000); return HttpResponse(200, places) }
                return HttpResponse(200, emptyAddr)
            }
        }
        val m = SearchViewModel(SearchService(APIClient("https://example.test", slow)), RecentSearchStore(InMemoryKeyValueStore()), { "ko" }, strings, SavedStateHandle(), io = dispatcher)
        m.queryState.setTextAndPlaceCursorAtEnd("느림"); m.submit()
        dispatcher.scheduler.advanceTimeBy(100)
        m.queryState.setTextAndPlaceCursorAtEnd("빠름"); m.submit()
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals(1, m.state.value.resultsRevision)
        assertEquals("빠름", m.state.value.outcome?.places?.let { "빠름" })
        assertEquals(listOf("빠름", "느림"), m.state.value.recentQueries.map { it.text })
    }

    @Test fun `통지 seq는 같은 문장이라도 매번 증가한다`() = runTest(dispatcher) {
        val store = RecentSearchStore(InMemoryKeyValueStore()).also { it.recordQuery("a"); it.recordQuery("b") }
        val m = vm({ HttpResponse(404, "") }, store)
        dispatcher.scheduler.advanceUntilIdle()
        m.removeRecent("b"); val first = m.state.value.notice
        m.removeRecent("a"); val second = m.state.value.notice
        assertEquals(first.text, second.text); assertEquals(first.seq + 1, second.seq)
    }

    @Test fun `최근 검색 삭제의 착지 index는 다음 → 이전 → null`() = runTest(dispatcher) {
        val store = RecentSearchStore(InMemoryKeyValueStore()).also { it.recordQuery("a"); it.recordQuery("b"); it.recordQuery("c") } // [c, b, a]
        val m = vm({ HttpResponse(404, "") }, store)
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals(1, m.removeRecent("b")) // [c, a] → 다음 행 a
        assertEquals(0, m.removeRecent("a")) // [c] → 이전 행 c
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
}
