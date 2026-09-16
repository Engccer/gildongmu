package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.APIErrorBody
import space.dodoplanet.gildongmu.kit.models.ChatRequestBody
import space.dodoplanet.gildongmu.kit.models.ChatStreamEvent

/**
 * NDJSON 한 줄을 채팅 이벤트로 디코딩하는 순수 함수. Kit `ChatService.swift` 미러. 스트림 배관과 분리해
 * 단위 테스트 대상으로 삼는다(스트림 자체는 실기기 실호출 게이트). 깨진 줄은 `APIError.Decoding`으로 던진다 —
 * 커스텀 직렬화의 `jsonPrimitive` 접근은 `SerializationException`이 아닌 `IllegalArgumentException`을 낼 수 있어
 * `APIClient`와 같이 둘 다 접는다(`SerializationException`은 그 하위형).
 */
fun decodeChatEventLine(line: String): ChatStreamEvent = try {
    KitJson.decodeFromString(ChatStreamEvent.serializer(), line)
} catch (e: IllegalArgumentException) {
    throw APIError.Decoding(e)
}

/**
 * POST /api/chat NDJSON 스트림 소비의 판정 부분(D5 경계). **POST·스트리밍 전송은 :app(M6)**이 안드로이드
 * HTTP 스택으로 구현하고, 요청 본문·예산·상태 분류·줄 처리는 여기를 지난다.
 */
object ChatService {
    const val path = "/api/chat"

    /** 서버 maxDuration(120초)보다 긴 180초(웹 useChat의 "클라가 더 길게" 계약). */
    const val timeoutMs = 180_000L

    /** 요청 본문 JSON. userLocation·placeContext는 null이면 키 자체를 생략한다(`KitJson` explicitNulls=false). */
    fun encodeBody(body: ChatRequestBody): String = KitJson.encodeToString(ChatRequestBody.serializer(), body)

    /**
     * 응답 상태 분류. 2xx면 null(스트림 소비로 진행), 아니면 오류 본문(짧은 JSON)의 `error`를 message로
     * 승격한 `APIError.BadStatus`. 본문이 그 모양이 아니면 message 없음.
     */
    fun statusError(status: Int, errorBody: String): APIError.BadStatus? {
        if (status in 200..299) return null
        val message = runCatching { KitJson.decodeFromString(APIErrorBody.serializer(), errorBody).error }.getOrNull()
        return APIError.BadStatus(status, message)
    }

    /** 스트림 한 줄 처리: 양끝 공백을 걷고 빈 줄은 null(건너뜀), 그 외는 디코딩(실패는 `APIError.Decoding` — 스트림 종료 사유). */
    fun eventFromStreamLine(line: String): ChatStreamEvent? {
        val trimmed = line.trim()
        if (trimmed.isEmpty()) return null
        return decodeChatEventLine(trimmed)
    }
}
