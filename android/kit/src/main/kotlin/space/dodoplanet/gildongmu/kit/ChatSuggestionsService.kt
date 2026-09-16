package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** POST /api/chat/suggestions 요청 본문(서버 zod 스키마 미러). placeName null은 키 생략. */
@Serializable
internal data class ChatSuggestionsRequestBody(
    val lastUserMessage: String,
    val lastAssistantMessage: String,
    val locale: String,
    val placeName: String?,
)

/**
 * 채팅 답변 뒤 follow-up 질문 제안(spec 2026-08-24 §3.3)의 판정 부분. Kit `ChatSuggestionsService.swift` 미러.
 * **POST 전송은 :app(M6)**이 맡는다(D5 경계). 전송 실패·타임아웃·디코딩 불가는 빈 목록(바깥 코루틴 취소는 전파한다) —
 * 칩은 없어도 되는 보조 컨트롤이라 어떤 실패도 "칩 없음"이지 오류가 아니다.
 */
object ChatSuggestionsService {
    const val path = "/api/chat/suggestions"

    /** 서버 제한(3개)과 같은 상한. 서버가 더 주더라도 여기서 절단한다. */
    const val maxSuggestions = 3

    /** 본 답변 뒤에 비동기로 붙는 보조 요청이라 예산을 명시한다(Swift `timeoutSeconds` 6초). */
    const val timeoutMs = 6_000L

    fun encodeBody(lastUserMessage: String, lastAssistantMessage: String, locale: String, placeName: String?): String =
        KitJson.encodeToString(
            ChatSuggestionsRequestBody.serializer(),
            ChatSuggestionsRequestBody(lastUserMessage, lastAssistantMessage, locale, placeName),
        )

    /** 응답 상태·본문 → 제안 목록. 2xx가 아니면 빈 목록. */
    fun followUps(status: Int, body: String): List<String> =
        if (status in 200..299) parse(body) else emptyList()

    /**
     * 응답 본문 `{suggestions: string[]}` → 제안 목록. `suggestions` 부재·비배열은 빈 목록, 비문자열·공백
     * 원소는 건너뛰고 최대 `maxSuggestions`개로 절단한다. 최상위가 객체가 아니거나 JSON이 아니면 빈 목록.
     */
    fun parse(body: String): List<String> {
        val root = runCatching { KitJson.parseToJsonElement(body) }.getOrNull() as? JsonObject ?: return emptyList()
        val list = root["suggestions"] as? JsonArray ?: return emptyList()
        return list.asSequence()
            .mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content?.trim() }
            .filter { it.isNotEmpty() }
            .take(maxSuggestions)
            .toList()
    }
}
