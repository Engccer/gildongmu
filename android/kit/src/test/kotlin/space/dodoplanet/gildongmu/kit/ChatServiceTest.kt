package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.json.jsonObject
import space.dodoplanet.gildongmu.kit.models.ChatRequestBody
import space.dodoplanet.gildongmu.kit.models.ChatStreamEvent
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * 채팅 스트림의 :kit 판정 부분. Kit `ChatModelsTests`가 `decodeChatEventLine`으로 도는 케이스(모델 디코딩 자체는
 * FOUNDATION `ChatModelsTest`가 덮는다)와, 스트림 소비자에서 떼어 낸 상태 분류·줄 처리(POST·스트리밍 전송은 :app M6).
 */
class ChatServiceTest {
    private fun fixtureLines() = Fixtures.kit("chat-stream.ndjson").lines().filter { it.isNotBlank() }

    @Test fun chatFixtureLinesDecodeThroughDecodeChatEventLine() {
        val lines = fixtureLines()
        assertTrue(assertIs<ChatStreamEvent.Status>(decodeChatEventLine(lines[0])).categories.isNotEmpty())
        assertTrue(assertIs<ChatStreamEvent.Done>(decodeChatEventLine(lines[1])).text.isNotEmpty())
    }

    @Test fun unknownAndErrorEventsDecode() {
        assertIs<ChatStreamEvent.Unknown>(decodeChatEventLine("""{"type":"future-x","payload":{"a":1}}"""))
        assertEquals("chat_failed", assertIs<ChatStreamEvent.Error>(decodeChatEventLine("""{"type":"error","code":"chat_failed"}""")).code)
    }

    /** 깨진 줄은 전부 `APIError.Decoding` — JSON 아님, 필수 키 부재, 직렬화기의 `jsonPrimitive` 접근이 내는 `IllegalArgumentException`까지. */
    @Test fun invalidLineThrowsDecoding() {
        assertFailsWith<APIError.Decoding> { decodeChatEventLine("not-json") }
        assertFailsWith<APIError.Decoding> { decodeChatEventLine("""{"type":"done"}""") }
        assertFailsWith<APIError.Decoding> {
            decodeChatEventLine("""{"type":"done","text":"t","renders":[{"type":"places","sort":{},"places":[]}]}""")
        }
    }

    /** 스트림 소비: 양끝 공백을 걷고 빈 줄은 건너뛴다. 나머지는 이벤트로. */
    @Test fun streamLineTrimsAndSkipsBlank() {
        assertNull(ChatService.eventFromStreamLine(""))
        assertNull(ChatService.eventFromStreamLine("   \t"))
        assertEquals("chat_failed", assertIs<ChatStreamEvent.Error>(ChatService.eventFromStreamLine("  {\"type\":\"error\",\"code\":\"chat_failed\"}  ")).code)
        assertFailsWith<APIError.Decoding> { ChatService.eventFromStreamLine("not-json") }
    }

    /** Swift `bytes.lines` 실측 표(2026-09-16, AsyncStream 바이트 → `.lines`)를 그대로 옮겼다. */
    @Test fun streamLinesMatchSwiftAsyncLineSequence() {
        fun linesOf(bytes: ByteArray) = ChatService.splitStreamLines(bytes, endOfStream = true).lines
        fun lines(text: String) = linesOf(text.toByteArray())
        val (vt, ff, nel, ls, ps) = listOf(0x0B, 0x0C, 0x85, 0x2028, 0x2029).map { it.toChar() }
        assertEquals(listOf("a", "b"), lines("a\nb"))
        assertEquals(listOf("a", "b", "c", "d"), lines("a\r\nb\rc\n\nd\n"))
        assertEquals(listOf("a", "b", "c", "d"), lines("a${nel}b${ls}c${ps}d"))
        assertEquals(listOf("a", "b", "c"), lines("a${vt}b${ff}c"))
        assertEquals(emptyList<String>(), lines("\n\n"))
        assertEquals(emptyList<String>(), lines("\r\n\r\n"))
        assertEquals(emptyList<String>(), lines(""))
        assertEquals(listOf("a"), lines("a\r"))
        assertEquals(listOf("a", "b"), lines("a\r\r\nb"))
        assertEquals(listOf("a", "b"), lines("a\n\rb"))
        assertEquals(listOf("  \t", "{}"), lines("  \t\n{}"))
        assertEquals(listOf("a${0xFFFD.toChar()}", "b"), linesOf(byteArrayOf(0x61, 0xFF.toByte(), 0x0A, 0x62)))
    }

    /** 청크가 어느 바이트에서 끊겨도(한글·LS·NEL의 다중 바이트 한가운데 포함) 한 번에 나눈 것과 같다. 끝나지 않은 꼬리는 줄로 내지 않는다. */
    @Test fun streamLinesAreChunkBoundaryIndependent() {
        val bytes = "{\"a\":1}\r\n가${0x2028.toChar()}나${0x85.toChar()}\n  \n끝".toByteArray()
        val whole = ChatService.splitStreamLines(bytes, endOfStream = true).lines
        assertEquals(listOf("{\"a\":1}", "가", "나", "  ", "끝"), whole)
        for (cut in 0..bytes.size) {
            val first = ChatService.splitStreamLines(bytes.copyOfRange(0, cut), endOfStream = false)
            val second = ChatService.splitStreamLines(first.remainder + bytes.copyOfRange(cut, bytes.size), endOfStream = true)
            assertEquals(whole, first.lines + second.lines, "cut=$cut")
            assertEquals(0, second.remainder.size)
        }
        val open = ChatService.splitStreamLines("끝".toByteArray(), endOfStream = false)
        assertEquals(emptyList<String>(), open.lines)
        assertEquals("끝", open.remainder.toString(Charsets.UTF_8))
    }

    /** 비-2xx는 오류 본문의 `error`를 message로 승격한 BadStatus, 2xx는 null(스트림 소비로 진행). */
    @Test fun statusErrorPromotesErrorBody() {
        assertNull(ChatService.statusError(200, ""))
        val bad = assertNotNull(ChatService.statusError(429, """{"error":"rate_limited"}"""))
        assertEquals(429, bad.code)
        assertEquals("rate_limited", bad.serverMessage)
        assertNull(assertNotNull(ChatService.statusError(502, "<html>")).serverMessage)
    }

    /** 요청 본문 계약: userLocation·placeContext는 null이면 키 자체를 생략(서버 undefined 의미론). */
    @Test fun encodeBodyOmitsNullOptionals() {
        val json = KitJson.parseToJsonElement(
            ChatService.encodeBody(ChatRequestBody(listOf(ChatRequestBody.Turn("user", "안녕")), userLocation = null, locale = "ko", placeContext = null)),
        ).jsonObject
        assertTrue(json.containsKey("messages"))
        assertFalse(json.containsKey("userLocation"))
        assertFalse(json.containsKey("placeContext"))
    }

    @Test fun budgetIsLongerThanServerMaxDuration() {
        assertEquals("/api/chat", ChatService.path)
        assertTrue(ChatService.timeoutMs > 120_000L)
    }
}
