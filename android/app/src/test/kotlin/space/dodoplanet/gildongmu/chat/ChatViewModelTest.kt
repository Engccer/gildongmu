package space.dodoplanet.gildongmu.chat

import androidx.compose.foundation.text.input.setTextAndPlaceCursorAtEnd
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModelStore
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.extension.RegisterExtension
import space.dodoplanet.gildongmu.MainDispatcherExtension
import space.dodoplanet.gildongmu.directions.CatalogStrings
import space.dodoplanet.gildongmu.kit.InMemoryKeyValueStore
import space.dodoplanet.gildongmu.kit.models.AddressMatch
import space.dodoplanet.gildongmu.kit.models.ChatRenderPayload
import space.dodoplanet.gildongmu.kit.models.ChatRequestBody
import space.dodoplanet.gildongmu.kit.models.ChatSource
import space.dodoplanet.gildongmu.kit.models.ChatStreamEvent
import space.dodoplanet.gildongmu.kit.models.JusoAddress
import space.dodoplanet.gildongmu.kit.models.Place
import space.dodoplanet.gildongmu.kit.models.PlaceSort
import java.io.IOException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** iOS `ChatModel` 계약을 JVM에서 잠근다(spec §4·§9). 전송은 페이크 flow, 문장은 실제 카탈로그. */
@OptIn(ExperimentalCoroutinesApi::class)
class ChatViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @JvmField
    @RegisterExtension
    val main = MainDispatcherExtension(dispatcher)

    private val catalog = CatalogStrings("ko")
    private val strings = ChatStrings(
        failed = { catalog.get("android.chat.failed") },
        emptyAnswer = { catalog.get("android.chat.emptyAnswer") },
        progressFallback = { catalog.get("android.chat.progressFallback") },
        progressSearching = { catalog.get("chat.progress.searching", it) },
        toolLabel = { c -> if (toolLabelId(c) != null) catalog.get("chat.progress.tool.$c") else c },
        addressNotFound = { catalog.get("search.addressCoordFailed") },
        addressLookupFailed = { catalog.get("directions.coordError") },
    )

    private class Sounds : ChatSounds {
        var sends = 0
        var receives = 0
        override fun send() { sends++ }
        override fun receive() { receives++ }
    }

    private class Location(var coordinate: ChatRequestBody.Coordinate? = null, var failure: Exception? = null) : ChatLocation {
        var primes = 0
        override suspend fun prime() { primes++; failure?.let { throw it } }
        override fun last() = coordinate
    }

    private class Stream(var next: (ChatRequestBody) -> Flow<ChatStreamEvent>) : ChatStreamSource {
        val bodies = ArrayList<ChatRequestBody>()
        override fun events(body: ChatRequestBody): Flow<ChatStreamEvent> { bodies += body; return next(body) }
    }

    private class Suggestions(var result: suspend () -> List<String> = { listOf("다음 질문") }) : ChatSuggestionsSource {
        var calls = 0
        override suspend fun fetch(lastUser: String, lastAssistant: String, locale: String, placeName: String?): List<String> { calls++; return result() }
    }

    private val place = Place(id = "k1", name = "강동역", category = "교통,수송 > 지하철,전철 > 수도권5호선", address = "서울 강동구", roadAddress = "서울 강동구 천호대로", lat = 37.5358, lng = 127.1323)
    private val cafe = Place(id = "c1", name = "카페 길동", category = "", address = "a", roadAddress = "r", lat = 37.5, lng = 127.1)
    private val address = JusoAddress("서울특별시 중구 세종대로 110 (태평로1가)", "서울특별시 중구 세종대로 110", "서울특별시 중구 태평로1가 31", "110 Sejong-daero", "04524", "")

    private val done = ChatStreamEvent.Done(
        "강동역 근처 카페입니다.",
        listOf(ChatRenderPayload.Places(listOf(cafe), PlaceSort.accuracy)),
        listOf(ChatSource("source.kakao")),
    )

    private class Fixture(
        val vm: ChatViewModel,
        val stream: Stream,
        val suggestions: Suggestions,
        val location: Location,
        val sounds: Sounds,
        val consent: ChatConsentStore,
        val geocodes: MutableList<String>,
    )

    private fun make(
        place: Place? = null,
        granted: Boolean = true,
        events: (ChatRequestBody) -> Flow<ChatStreamEvent> = { flowOf(ChatStreamEvent.Status(listOf("search_places")), done) },
        suggestions: Suggestions = Suggestions(),
        location: Location = Location(ChatRequestBody.Coordinate(37.53, 127.13)),
        geocode: suspend (String) -> AddressMatch? = { null },
    ): Fixture {
        val consent = ChatConsentStore(InMemoryKeyValueStore()).also { if (granted) it.grant() }
        val stream = Stream(events)
        val sounds = Sounds()
        val geocodes = ArrayList<String>()
        val vm = ChatViewModel(place, stream, suggestions, { q -> geocodes += q; geocode(q) }, consent, location, { "ko" }, { "ko" }, strings, sounds, SavedStateHandle())
        return Fixture(vm, stream, suggestions, location, sounds, consent, geocodes)
    }

    @Test fun `동의가 없으면 전송하지 않는다(이중 방어)`() = runTest(dispatcher) {
        val f = make(granted = false)
        assertFalse(f.vm.send("질문"))
        advanceUntilIdle()
        assertEquals(0, f.vm.state.value.messages.size)
        assertEquals(0, f.sounds.sends)
        assertEquals(0, f.stream.bodies.size)
    }

    @Test fun `빈 문자열·스트리밍 중 전송은 받지 않는다`() = runTest(dispatcher) {
        val f = make(events = { flow { awaitCancellation() } })
        assertFalse(f.vm.send("   "))
        assertTrue(f.vm.send("첫 질문"))
        assertFalse(f.vm.send("둘째 질문"))
        assertEquals(1, f.vm.state.value.messages.size)
    }

    @Test fun `전송은 질문을 붙이고 전송음·스트리밍 상태·통지 비움`() = runTest(dispatcher) {
        val f = make(events = { flow { awaitCancellation() } })
        f.vm.announce("이전 통지")
        assertTrue(f.vm.send("  강동역 근처 카페  "))
        val s = f.vm.state.value
        assertEquals(ChatRole.user, s.messages.single().role)
        assertEquals("강동역 근처 카페", s.messages.single().text)
        assertTrue(s.isStreaming)
        assertEquals(1, f.sounds.sends)
        assertEquals("", s.notice.text)
    }

    @Test fun `status 이벤트는 도구 라벨 진행 문장을 통지한다`() = runTest(dispatcher) {
        val notices = ArrayList<String>()
        val gate = CompletableDeferred<Unit>()
        val f = make(events = {
            flow {
                emit(ChatStreamEvent.Status(listOf("search_places", "get_weather")))
                gate.await()
                emit(ChatStreamEvent.Status(emptyList()))
                emit(ChatStreamEvent.Status(listOf("x_tool")))
                awaitCancellation()
            }
        })
        f.vm.send("질문")
        advanceUntilIdle()
        notices += f.vm.state.value.notice.text
        gate.complete(Unit)
        advanceUntilIdle()
        assertEquals("장소, 날씨 조회 중", notices.single())
        assertEquals("x_tool 조회 중", f.vm.state.value.notice.text)
    }

    @Test fun `done은 답변·완료음·세대·follow-up을 커밋한다`() = runTest(dispatcher) {
        val f = make()
        f.vm.send("강동역 근처 카페")
        advanceUntilIdle()
        val s = f.vm.state.value
        val answer = s.messages.last()
        assertEquals(ChatRole.assistant, answer.role)
        assertFalse(answer.failed)
        assertEquals(done.text, answer.text)
        assertEquals(done.renders, answer.renders)
        assertEquals(done.sources, answer.sources)
        assertFalse(s.isStreaming)
        assertEquals(1, s.answerRevision)
        assertEquals(1, f.sounds.receives)
        assertEquals("", s.notice.text)
        assertEquals(1, f.suggestions.calls)
        assertEquals(listOf("다음 질문"), s.followUps)
    }

    @Test fun `error 이벤트·스트림 예외·done 뒤 예외는 실패 답변이고 follow-up을 부르지 않는다`() = runTest(dispatcher) {
        val cases = listOf<(ChatRequestBody) -> Flow<ChatStreamEvent>>(
            { flowOf(ChatStreamEvent.Error("chat_failed")) },
            { flow { throw IOException("down") } },
            { flow { emit(done); throw IOException("broken line") } },
        )
        for (events in cases) {
            val f = make(events = events)
            f.vm.send("질문")
            advanceUntilIdle()
            val answer = f.vm.state.value.messages.last()
            assertTrue(answer.failed)
            assertEquals("답변을 가져오지 못했습니다.", answer.text)
            assertEquals(1, f.sounds.receives)
            assertEquals(1, f.vm.state.value.answerRevision)
            assertEquals(0, f.suggestions.calls)
        }
    }

    @Test fun `빈 done text는 준비하지 못함 문장`() = runTest(dispatcher) {
        val f = make(events = { flowOf(ChatStreamEvent.Done("", emptyList(), emptyList())) })
        f.vm.send("질문")
        advanceUntilIdle()
        assertEquals("답변을 준비하지 못했습니다", f.vm.state.value.messages.last().text)
        assertFalse(f.vm.state.value.messages.last().failed)
    }

    @Test fun `취소로 닫힌 스트림이 IOException으로 끝나도 답변·완료음·세대가 없다`() = runTest(dispatcher) {
        val f = make(events = { flow { try { awaitCancellation() } finally { throw IOException("socket closed") } } })
        f.vm.send("질문")
        advanceUntilIdle()
        ViewModelStore().apply { put("chat", f.vm) }.clear()
        advanceUntilIdle()
        assertEquals(1, f.vm.state.value.messages.size)
        assertEquals(0, f.sounds.receives)
        assertEquals(0, f.vm.state.value.answerRevision)
    }

    @Test fun `일반 채팅 요청 본문 — 측위 1회·좌표·로케일·히스토리(실패 포함)·장소 없음`() = runTest(dispatcher) {
        var failFirst = true
        val f = make(events = { if (failFirst) { failFirst = false; flowOf(ChatStreamEvent.Error("x")) } else flowOf(done) })
        f.vm.send("첫 질문")
        advanceUntilIdle()
        f.vm.send("둘째 질문")
        advanceUntilIdle()
        val body = f.stream.bodies.last()
        assertEquals(2, f.location.primes)
        assertEquals(ChatRequestBody.Coordinate(37.53, 127.13), body.userLocation)
        assertEquals("ko", body.locale)
        assertNull(body.placeContext)
        assertEquals(
            listOf("user" to "첫 질문", "assistant" to "답변을 가져오지 못했습니다.", "user" to "둘째 질문"),
            body.messages.map { it.role to it.text },
        )
    }

    @Test fun `측위 예외는 삼키고 좌표 없이 전송한다`() = runTest(dispatcher) {
        val f = make(location = Location(null, SecurityException("revoked")))
        f.vm.send("질문")
        advanceUntilIdle()
        assertNull(f.stream.bodies.single().userLocation)
        assertFalse(f.vm.state.value.messages.last().failed)
    }

    @Test fun `장소 채팅은 측위하지 않고 장소 앵커를 싣는다`() = runTest(dispatcher) {
        val f = make(place = place)
        f.vm.send("이 역 주변에 뭐가 있어?")
        advanceUntilIdle()
        val ctx = assertNotNull(f.stream.bodies.single().placeContext)
        assertEquals(0, f.location.primes)
        assertEquals(ChatRequestBody.PlaceContext("강동역", 37.5358, 127.1323, place.category, true), ctx)
        assertEquals(ChatRequestBody.Coordinate(37.53, 127.13), f.stream.bodies.single().userLocation)

        val g = make(place = cafe)
        g.vm.send("질문")
        advanceUntilIdle()
        val cafeCtx = assertNotNull(g.stream.bodies.single().placeContext)
        assertNull(cafeCtx.category)
        assertEquals(false, cafeCtx.isStation)
    }

    @Test fun `새 전송은 칩을 비우고 늦게 온 옛 제안을 커밋하지 않는다`() = runTest(dispatcher) {
        val late = CompletableDeferred<List<String>>()
        val suggestions = Suggestions { late.await() }
        val f = make(suggestions = suggestions)
        f.vm.send("첫 질문")
        advanceUntilIdle()
        assertEquals(1, suggestions.calls)
        suggestions.result = { listOf("새 제안") }
        f.stream.next = { flow { awaitCancellation() } }
        f.vm.send("둘째 질문")
        late.complete(listOf("옛 제안"))
        advanceUntilIdle()
        assertEquals(emptyList(), f.vm.state.value.followUps)
    }

    @Test fun `sendDraft는 받아들였을 때만 초안을 비우고 칩 전송은 초안을 건드리지 않는다`() = runTest(dispatcher) {
        val f = make(events = { flow { awaitCancellation() } })
        f.vm.draft.setTextAndPlaceCursorAtEnd("입력 중")
        assertTrue(f.vm.send("추천 질문"))
        assertEquals("입력 중", f.vm.draft.text.toString())
        assertFalse(f.vm.sendDraft())
        assertEquals("입력 중", f.vm.draft.text.toString())

        val g = make(events = { flow { awaitCancellation() } })
        g.vm.draft.setTextAndPlaceCursorAtEnd("강동역")
        assertTrue(g.vm.sendDraft())
        assertEquals("", g.vm.draft.text.toString())
        assertEquals("강동역", g.vm.state.value.messages.single().text)
    }

    @Test fun `주소 해석 — 성공·0건·조회 실패 문장이 갈린다`() = runTest(dispatcher) {
        val ok = make(geocode = { AddressMatch(addressName = "", lat = 37.56, lng = 126.97) })
        val placeResult = assertNotNull(ok.vm.resolveAddress(address))
        assertEquals("juso-${address.roadAddr}", placeResult.id)
        assertEquals(listOf("서울특별시 중구 세종대로 110"), ok.geocodes)

        val none = make(geocode = { null })
        assertNull(none.vm.resolveAddress(address))
        assertEquals("이 주소의 좌표를 찾지 못해 상세를 열 수 없습니다.", none.vm.state.value.notice.text)

        val broken = make(geocode = { throw IOException("down") })
        assertNull(broken.vm.resolveAddress(address))
        assertEquals("선택한 주소의 좌표를 확인하지 못했습니다.", broken.vm.state.value.notice.text)
    }

    @Test fun `주소 해석 in-flight 가드는 진행 중 재탭을 무시하고 취소 뒤 풀린다`() = runTest(dispatcher) {
        val gate = CompletableDeferred<AddressMatch?>()
        val f = make(geocode = { gate.await() })
        val first = launch { f.vm.resolveAddress(address) }
        advanceUntilIdle()
        assertNull(f.vm.resolveAddress(address))
        assertEquals(1, f.geocodes.size)
        first.cancel()
        advanceUntilIdle()
        val third = launch { f.vm.resolveAddress(address) }
        advanceUntilIdle()
        assertEquals(2, f.geocodes.size)
        third.cancel()
    }

    @Test fun `전사 병합 — 공백 초안은 버리고 타이핑 초안 뒤에 붙인다`() = runTest(dispatcher) {
        val f = make()
        f.vm.draft.setTextAndPlaceCursorAtEnd("  ")
        assertEquals("강남역", f.vm.mergeTranscript("강남역"))
        f.vm.draft.setTextAndPlaceCursorAtEnd("근처")
        assertEquals("근처 카페", f.vm.mergeTranscript("카페"))
        assertEquals("근처 카페", f.vm.draft.text.toString())
    }

    @Test fun `전송·지우기는 전사 통지를 비운다`() = runTest(dispatcher) {
        val f = make(events = { flow { awaitCancellation() } })
        f.vm.announce("강남역")
        f.vm.clearDraft()
        assertEquals("", f.vm.state.value.notice.text)
        f.vm.announce("강남역")
        f.vm.send("강남역")
        assertEquals("", f.vm.state.value.notice.text)
    }

    @Test fun `복귀 키는 한 번만 소비된다`() = runTest(dispatcher) {
        val f = make()
        f.vm.rememberReturnFocus("card-2-0-c1")
        assertEquals("card-2-0-c1", f.vm.takeReturnFocus())
        assertNull(f.vm.takeReturnFocus())
    }
}
