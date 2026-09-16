package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** follow-up 제안 파싱(Kit `ChatSuggestionsServiceTests` 미러) + :kit에 남긴 상태 분류·요청 본문. */
class ChatSuggestionsServiceTest {
    private fun parse(json: String) = ChatSuggestionsService.parse(json)

    @Test fun suggestionsParseNormalThree() {
        assertEquals(listOf("근처 카페는?", "가는 길 알려줘", "영업시간은?"), parse("""{"suggestions":["근처 카페는?","가는 길 알려줘","영업시간은?"]}"""))
    }

    @Test fun suggestionsParseTruncatesToThree() {
        assertEquals(listOf("a", "b", "c"), parse("""{"suggestions":["a","b","c","d","e"]}"""))
    }

    @Test fun suggestionsParseMissingKeyIsEmpty() {
        assertTrue(parse("{}").isEmpty())
        assertTrue(parse("""{"other":["a"]}""").isEmpty())
    }

    @Test fun suggestionsParseNonArrayIsEmpty() {
        assertTrue(parse("""{"suggestions":"a"}""").isEmpty())
        assertTrue(parse("""{"suggestions":null}""").isEmpty())
        assertTrue(parse("""{"suggestions":{"a":1}}""").isEmpty())
    }

    @Test fun suggestionsParseSkipsNonStringAndBlankItems() {
        assertEquals(listOf("a", "b"), parse("""{"suggestions":[1,"a",null," ","b",{"x":1}]}"""))
    }

    @Test fun suggestionsParseInvalidJSONIsEmpty() {
        assertTrue(parse("<html>").isEmpty())
        assertTrue(parse("").isEmpty())
        assertTrue(parse("""["a"]""").isEmpty())
    }

    /** 비-2xx는 칩 없음(오류가 아니다). */
    @Test fun followUpsIgnoreBodyOnNon2xx() {
        assertTrue(ChatSuggestionsService.followUps(429, """{"suggestions":["a"]}""").isEmpty())
        assertEquals(listOf("a"), ChatSuggestionsService.followUps(200, """{"suggestions":["a"]}"""))
    }

    /** 요청 본문(서버 zod 스키마): placeName이 없으면 키 생략. */
    @Test fun encodeBodyMirrorsServerSchema() {
        val json = KitJson.parseToJsonElement(ChatSuggestionsService.encodeBody("질문", "답변", "ko", null)).jsonObject
        assertEquals("질문", json.getValue("lastUserMessage").jsonPrimitive.content)
        assertEquals("답변", json.getValue("lastAssistantMessage").jsonPrimitive.content)
        assertEquals("ko", json.getValue("locale").jsonPrimitive.content)
        assertFalse(json.containsKey("placeName"))
        val withPlace = KitJson.parseToJsonElement(ChatSuggestionsService.encodeBody("q", "a", "en", "강동역")).jsonObject
        assertEquals("강동역", withPlace.getValue("placeName").jsonPrimitive.content)
    }
}
