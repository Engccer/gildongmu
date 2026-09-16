package space.dodoplanet.gildongmu.kit.models

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.buildClassSerialDescriptor
import kotlinx.serialization.descriptors.element
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** 응답 하단 출처 하나. 웹 SourceAttribution 미러(label은 i18n 키, url은 선택). */
@Serializable
data class ChatSource(val label: String, val url: String? = null)

/**
 * 렌더 페이로드: 웹 RenderPayload의 V1 부분집합. props-driven 3종(places·addresses·web-results)만
 * 파싱하고, self-fetch 카드류와 미지 타입은 전부 `Unsupported`로 강등한다(산문이 정본).
 * Kit `ChatRenderPayload` 미러 — sealed 케이스는 PascalCase.
 */
@Serializable(with = ChatRenderPayloadSerializer::class)
sealed class ChatRenderPayload {
    /** sort는 리뷰순(네이버)일 때 review — 카드 묶음 헤딩이 갈리는 유일한 재료. 서버가 싣지 않으면 accuracy. */
    data class Places(val places: List<Place>, val sort: PlaceSort) : ChatRenderPayload()
    data class Addresses(val addresses: List<JusoAddress>) : ChatRenderPayload()
    data class WebResults(val results: List<WebSearchResult>) : ChatRenderPayload()
    data object Unsupported : ChatRenderPayload()
}

object ChatRenderPayloadSerializer : KSerializer<ChatRenderPayload> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("ChatRenderPayload") {
        element<String>("type")
    }

    override fun deserialize(decoder: Decoder): ChatRenderPayload {
        val input = decoder as JsonDecoder
        val obj = input.decodeJsonElement().asObjectOrThrow("ChatRenderPayload")
        val json = input.json
        // 판별자 부재는 깨진 응답(throw), 미지 값은 전방 호환(Unsupported) — 둘을 같은 것으로 접지 않는다.
        return when (obj.requiredString("type")) {
            "places" -> {
                val sort = if (obj.optionalPrimitive("sort")?.contentOrNull == "review") PlaceSort.review else PlaceSort.accuracy
                ChatRenderPayload.Places(json.decodeFromJsonElement(ListSerializer(Place.serializer()), obj.required("places")), sort)
            }
            "addresses" -> ChatRenderPayload.Addresses(json.decodeFromJsonElement(ListSerializer(JusoAddress.serializer()), obj.required("results")))
            "web-results" -> ChatRenderPayload.WebResults(json.decodeFromJsonElement(ListSerializer(WebSearchResult.serializer()), obj.required("results")))
            // 웹은 self-fetch 카드(타입만)이고, 서버가 앱을 위해 같은 렌더에 공통 Place 투영(`nearby-place.ts`)을
            // `places`로 싣는다. 있으면 장소 카드로 취급, 없으면(옛 서버) 종전대로 미표시.
            "clinics-nearby", "kids-nearby", "surroundings-nearby", "barrier-free-nearby" -> {
                val places = obj["places"]?.takeIf { it !is JsonNull }
                    ?.let { json.decodeFromJsonElement(ListSerializer(Place.serializer()), it) }
                if (!places.isNullOrEmpty()) ChatRenderPayload.Places(places, PlaceSort.accuracy) else ChatRenderPayload.Unsupported
            }
            else -> ChatRenderPayload.Unsupported
        }
    }

    override fun serialize(encoder: Encoder, value: ChatRenderPayload) {
        throw UnsupportedOperationException("ChatRenderPayload는 디코딩 전용이다")
    }
}

/** NDJSON 스트리밍 이벤트(1줄 1이벤트). 웹 ChatStreamEvent 미러 + 전방 호환: 미지 type은 `Unknown`. */
@Serializable(with = ChatStreamEventSerializer::class)
sealed class ChatStreamEvent {
    data class Status(val categories: List<String>) : ChatStreamEvent()
    data class Done(val text: String, val renders: List<ChatRenderPayload>, val sources: List<ChatSource>) : ChatStreamEvent()
    data class Error(val code: String) : ChatStreamEvent()
    data object Unknown : ChatStreamEvent()
}

object ChatStreamEventSerializer : KSerializer<ChatStreamEvent> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("ChatStreamEvent") {
        element<String>("type")
    }

    override fun deserialize(decoder: Decoder): ChatStreamEvent {
        val input = decoder as JsonDecoder
        val obj = input.decodeJsonElement().asObjectOrThrow("ChatStreamEvent(한 줄 = 한 이벤트 객체)")
        val json = input.json
        return when (obj.requiredString("type")) {
            "status" -> ChatStreamEvent.Status(obj.requiredArray("categories").map {
                (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content ?: throw SerializationException("categories 원소는 문자열이어야 한다")
            })
            "done" -> ChatStreamEvent.Done(
                text = obj.requiredString("text"),
                renders = obj["renders"]?.takeIf { it !is JsonNull }
                    ?.let { json.decodeFromJsonElement(ListSerializer(ChatRenderPayloadSerializer), it) } ?: emptyList(),
                sources = obj["sources"]?.takeIf { it !is JsonNull }
                    ?.let { json.decodeFromJsonElement(ListSerializer(ChatSource.serializer()), it) } ?: emptyList(),
            )
            "error" -> ChatStreamEvent.Error(obj.requiredString("code"))
            else -> ChatStreamEvent.Unknown
        }
    }

    override fun serialize(encoder: Encoder, value: ChatStreamEvent) {
        throw UnsupportedOperationException("ChatStreamEvent는 디코딩 전용이다")
    }
}

/** POST /api/chat 요청 body. 웹 ChatRequest 미러. userLocation·placeContext는 null이면 키 자체를 생략한다(KitJson explicitNulls=false). */
@Serializable
data class ChatRequestBody(
    val messages: List<Turn>,
    val userLocation: Coordinate? = null,
    val locale: String,
    val placeContext: PlaceContext? = null,
) {
    /** 대화 턴 하나. role은 "user" | "assistant"(웹 계약 문자열 그대로). */
    @Serializable
    data class Turn(val role: String, val text: String)

    @Serializable
    data class Coordinate(val lat: Double, val lng: Double)

    /** 장소 앵커(웹 불변식): 주변 도구 기준 좌표는 이 장소, 길찾기 출발지는 userLocation. */
    @Serializable
    data class PlaceContext(
        val name: String,
        val lat: Double,
        val lng: Double,
        val category: String? = null,
        val isStation: Boolean? = null,
    )
}
