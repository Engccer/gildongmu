package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.SerializationException
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

    @Test fun invalidJSONLineThrows() {
        assertFailsWith<SerializationException> { decodeChatEventLine("not-json") }
    }

    /** 스트림 소비: 양끝 공백을 걷고 빈 줄은 건너뛴다. 나머지는 이벤트로. */
    @Test fun streamLineTrimsAndSkipsBlank() {
        assertNull(ChatService.eventFromStreamLine(""))
        assertNull(ChatService.eventFromStreamLine("   \t"))
        assertEquals("chat_failed", assertIs<ChatStreamEvent.Error>(ChatService.eventFromStreamLine("  {\"type\":\"error\",\"code\":\"chat_failed\"}  ")).code)
        assertFailsWith<SerializationException> { ChatService.eventFromStreamLine("not-json") }
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
