package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import space.dodoplanet.gildongmu.kit.models.ChatRenderPayload
import space.dodoplanet.gildongmu.kit.models.ChatRequestBody
import space.dodoplanet.gildongmu.kit.models.ChatStreamEvent
import space.dodoplanet.gildongmu.kit.models.PlaceSort
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Kit `ChatModelsTests`의 모델 부분. 줄 디코딩은 여기서 `KitJson`으로 직접 한다(`decodeChatEventLine`은
 * CORE `ChatService`, 마크다운 블록 분할 `parseChatMarkdownBlocks`는 CORE `ChatMarkdown` 이식 때).
 */
class ChatModelsTest {
    private fun decodeLine(line: String) = KitJson.decodeFromString(ChatStreamEvent.serializer(), line)

    private fun fixtureLines() = Fixtures.kit("chat-stream.ndjson").lines().filter { it.isNotBlank() }

    @Test fun chatFixtureStatusLineDecodes() {
        val status = assertIs<ChatStreamEvent.Status>(decodeLine(fixtureLines()[0]))
        assertTrue(status.categories.isNotEmpty())
    }

    @Test fun chatFixtureDoneLineDecodes() {
        val done = assertIs<ChatStreamEvent.Done>(decodeLine(fixtureLines()[1]))
        assertTrue(done.text.isNotEmpty())
        assertTrue(done.renders.any { it is ChatRenderPayload.Unsupported })
        assertEquals("source.airkorea", done.sources.first().label)
        assertNull(done.sources.first().url)
    }

    @Test fun unknownEventTypeDecodesToUnknown() {
        assertIs<ChatStreamEvent.Unknown>(decodeLine("""{"type":"future-x","payload":{"a":1}}"""))
    }

    @Test fun errorEventDecodes() {
        assertEquals("chat_failed", assertIs<ChatStreamEvent.Error>(decodeLine("""{"type":"error","code":"chat_failed"}""")).code)
    }

    @Test fun supportedRenderVariantsDecode() {
        val line = """{"type":"done","text":"t","renders":[
          {"type":"places","places":[{"id":"kakao-1","name":"스타벅스","category":"카페","address":"서울","roadAddress":"서울 강동구 천호대로","lat":37.5,"lng":127.1}]},
          {"type":"addresses","results":[{"roadAddr":"서울 강동구 천호대로 1","roadAddrPart1":"서울 강동구 천호대로 1","jibunAddr":"서울 강동구 길동 1","engAddr":"1 Cheonho-daero","zipNo":"05398","bdNm":""}]},
          {"type":"web-results","results":[{"title":"제목","url":"https://example.com","snippet":"요약"}]},
          {"type":"subway-nearby"}
        ],"sources":[]}""".replace("\n", "")
        val done = assertIs<ChatStreamEvent.Done>(decodeLine(line))
        assertEquals(4, done.renders.size)
        assertEquals("스타벅스", assertIs<ChatRenderPayload.Places>(done.renders[0]).places[0].name)
        assertEquals("05398", assertIs<ChatRenderPayload.Addresses>(done.renders[1]).addresses[0].zipNo)
        assertEquals("https://example.com", assertIs<ChatRenderPayload.WebResults>(done.renders[2]).results[0].url)
        assertIs<ChatRenderPayload.Unsupported>(done.renders[3])
    }

    /** 필수 키 부재·null 값·판별자 부재는 전부 SerializationException이다 — APIClient가 Decoding으로 접는 유일한 형태. */
    @Test fun missingRequiredKeysThrowSerializationException() {
        assertFailsWith<SerializationException> { decodeLine("""{"type":"done"}""") }
        assertFailsWith<SerializationException> { decodeLine("""{"type":"done","text":null}""") }
        assertFailsWith<SerializationException> { decodeLine("""{"type":"error"}""") }
        assertFailsWith<SerializationException> { decodeLine("""{"type":"status","categories":[1]}""") }
        assertFailsWith<SerializationException> { decodeLine("""{"text":"판별자 없음"}""") }
        assertFailsWith<SerializationException> { KitJson.decodeFromString(ChatRenderPayload.serializer(), """{"type":"places"}""") }
        assertFailsWith<SerializationException> { KitJson.decodeFromString(ChatRenderPayload.serializer(), """{"places":[]}""") }
    }

    @Test fun invalidJSONLineThrows() {
        assertFailsWith<SerializationException> { decodeLine("not-json") }
        assertFailsWith<SerializationException> { decodeLine("[1,2]") }
    }

    @Test fun chatRequestBodyEncodesContract() {
        val body = ChatRequestBody(
            messages = listOf(ChatRequestBody.Turn("user", "여기 공기질 어때?")),
            userLocation = ChatRequestBody.Coordinate(37.53, 127.13),
            locale = "ko",
            placeContext = ChatRequestBody.PlaceContext("강동역", 37.535, 127.132, category = "지하철역", isStation = true),
        )
        val json: JsonObject = KitJson.parseToJsonElement(KitJson.encodeToString(ChatRequestBody.serializer(), body)).jsonObject
        assertEquals("user", json.getValue("messages").jsonArray[0].jsonObject.getValue("role").jsonPrimitive.content)
        assertEquals(37.53, json.getValue("userLocation").jsonObject.getValue("lat").jsonPrimitive.content.toDouble())
        assertEquals("ko", json.getValue("locale").jsonPrimitive.content)
        val pc = json.getValue("placeContext").jsonObject
        assertEquals("강동역", pc.getValue("name").jsonPrimitive.content)
        assertEquals("true", pc.getValue("isStation").jsonPrimitive.content)
    }

    @Test fun chatRequestBodyOmitsNullOptionals() {
        val body = ChatRequestBody(messages = listOf(ChatRequestBody.Turn("user", "안녕")), userLocation = null, locale = "ko", placeContext = null)
        val json = KitJson.parseToJsonElement(KitJson.encodeToString(ChatRequestBody.serializer(), body)).jsonObject
        // 서버 계약: userLocation·placeContext는 없으면 키 자체를 생략(undefined 의미론)
        assertFalse(json.containsKey("userLocation"))
        assertFalse(json.containsKey("placeContext"))
    }

    @Test fun nearbyRendersWithPlacesDecodeAsPlaces() {
        val line = """{"type":"done","text":"t","renders":[
          {"type":"clinics-nearby","places":[{"id":"A1","name":"길동소아과","category":"의원","address":"","roadAddress":"서울 강동구 천호대로 1","lat":37.5,"lng":127.1}]},
          {"type":"kids-nearby"},
          {"type":"surroundings-nearby","places":[]}
        ],"sources":[]}""".replace("\n", "")
        val done = assertIs<ChatStreamEvent.Done>(decodeLine(line))
        assertEquals("길동소아과", assertIs<ChatRenderPayload.Places>(done.renders[0]).places[0].name)
        assertIs<ChatRenderPayload.Unsupported>(done.renders[1])
        assertIs<ChatRenderPayload.Unsupported>(done.renders[2])
    }

    @Test fun placesRenderDecodesReviewSortAndDefaultsToAccuracy() {
        val review = assertIs<ChatRenderPayload.Places>(KitJson.decodeFromString(ChatRenderPayload.serializer(), """{"type":"places","places":[],"sort":"review"}"""))
        assertEquals(PlaceSort.review, review.sort)
        val plain = assertIs<ChatRenderPayload.Places>(KitJson.decodeFromString(ChatRenderPayload.serializer(), """{"type":"places","places":[]}"""))
        assertEquals(PlaceSort.accuracy, plain.sort)
    }
}
