package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.APIErrorBody
import space.dodoplanet.gildongmu.kit.models.ChatRequestBody
import space.dodoplanet.gildongmu.kit.models.ChatStreamEvent

/**
 * NDJSON 한 줄을 채팅 이벤트로 디코딩하는 순수 함수. Kit `ChatService.swift` 미러. 스트림 배관과 분리해
 * 단위 테스트 대상으로 삼는다(스트림 자체는 실기기 실호출 게이트). 깨진 줄은 `APIError.Decoding`으로 던진다 —
 * 커스텀 직렬화의 `jsonPrimitive` 접근은 `SerializationException`이 아닌 `IllegalArgumentException`을 낼 수 있어
 * `APIClient`와 같이 둘 다 접는다(`SerializationException`은 그 하위형). 스트림에서는 `ChatService.splitStreamLines`가
 * Swift `bytes.lines`와 같은 경계로 나누고 `eventFromStreamLine`이 다듬은 한 줄을 받는다.
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

    /**
     * 스트림 한 줄 처리: 양끝 공백을 걷고 빈 줄은 null(건너뜀), 그 외는 디코딩(실패는 `APIError.Decoding` — 스트림 종료 사유).
     * `line`은 [splitStreamLines]가 나눈 한 줄이어야 한다(Swift `bytes.lines`와 같은 경계 — 줄 끝 CR이 남지 않는다).
     */
    fun eventFromStreamLine(line: String): ChatStreamEvent? {
        val trimmed = line.trimSwiftWhitespaces()
        if (trimmed.isEmpty()) return null
        return decodeChatEventLine(trimmed)
    }

    /**
     * 스트림 바이트를 줄로 나눈다 — Swift `bytes.lines`(AsyncLineSequence) 미러(2026-09-16 실측): 경계는 LF·VT·FF·CR·NEL·LS·PS
     * (CRLF는 CR 뒤 빈 줄로 흡수), **빈 줄은 내지 않는다**(공백만 있는 줄은 낸다), 줄은 UTF-8로 풀고 깨진 바이트는 U+FFFD다.
     * 호출자는 직전 [ChatStreamLines.remainder] 뒤에 새 청크를 이어 넘기고, 스트림이 끝나면 `endOfStream = true`로 한 번 더
     * 부른다(남은 꼬리가 마지막 줄). 글자·경계의 다중 바이트가 청크 사이에서 끊겨도 꼬리에 남아 다음 호출에서 이어진다.
     */
    fun splitStreamLines(buffer: ByteArray, endOfStream: Boolean): ChatStreamLines {
        val lines = ArrayList<String>()
        var start = 0
        var i = 0
        while (i < buffer.size) {
            val width = lineBreakWidth(buffer, i)
            if (width == 0) { i += 1; continue }
            if (i > start) lines.add(String(buffer, start, i - start, Charsets.UTF_8))
            i += width
            start = i
        }
        if (endOfStream && start < buffer.size) {
            lines.add(String(buffer, start, buffer.size - start, Charsets.UTF_8))
            start = buffer.size
        }
        return ChatStreamLines(lines, buffer.copyOfRange(start, buffer.size))
    }

    /** `i`에서 시작하는 줄 경계의 바이트 길이, 경계가 아니면 0. NEL `C2 85`·LS `E2 80 A8`·PS `E2 80 A9`는 UTF-8 다중 바이트다. */
    private fun lineBreakWidth(b: ByteArray, i: Int): Int {
        fun at(k: Int) = if (k < b.size) b[k].toInt() and 0xFF else -1
        return when {
            at(i) in 0x0A..0x0D -> 1
            at(i) == 0xC2 && at(i + 1) == 0x85 -> 2
            at(i) == 0xE2 && at(i + 1) == 0x80 && (at(i + 2) == 0xA8 || at(i + 2) == 0xA9) -> 3
            else -> 0
        }
    }
}

/** [ChatService.splitStreamLines] 결과 — [lines]는 완성된 줄, [remainder]는 다음 청크 앞에 이어 붙일 미완성 꼬리 바이트. */
class ChatStreamLines(val lines: List<String>, val remainder: ByteArray)
