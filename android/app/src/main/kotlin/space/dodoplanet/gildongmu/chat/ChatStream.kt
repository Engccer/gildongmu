package space.dodoplanet.gildongmu.chat

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.flow.flowOn
import space.dodoplanet.gildongmu.kit.ChatService
import space.dodoplanet.gildongmu.kit.ChatSuggestionsService
import space.dodoplanet.gildongmu.kit.models.ChatRequestBody
import space.dodoplanet.gildongmu.kit.models.ChatStreamEvent
import java.io.InputStream

/** 읽기 버퍼 — `ChatService.splitStreamLines`가 미완성 꼬리를 매번 재스캔하므로 작게 잡지 않는다(병렬 계획 §5-5 M6 입력). */
const val STREAM_READ_BUFFER_BYTES = 8192

/**
 * NDJSON 바이트 스트림 → 채팅 이벤트(spec §5-3). 줄 분리는 `:kit` `splitStreamLines`만(Swift `bytes.lines` 실측 미러) — 앱에서 줄을 새로
 * 나누지 않는다. 깨진 줄은 `APIError.Decoding`이 그대로 올라가 스트림 실패가 된다(iOS 동형). U+2028 같은 날 문자는 서버 결함(A44 후보)이고
 * 여기서 우회하지 않는다.
 */
suspend fun readChatStream(input: InputStream, bufferSize: Int = STREAM_READ_BUFFER_BYTES, emit: suspend (ChatStreamEvent) -> Unit) {
    val chunk = ByteArray(bufferSize)
    var remainder = ByteArray(0)
    while (true) {
        currentCoroutineContext().ensureActive()
        val n = input.read(chunk)
        if (n < 0) break
        if (n == 0) continue
        val split = ChatService.splitStreamLines(remainder + chunk.copyOf(n), endOfStream = false)
        remainder = split.remainder
        for (line in split.lines) ChatService.eventFromStreamLine(line)?.let { emit(it) }
    }
    for (line in ChatService.splitStreamLines(remainder, endOfStream = true).lines) ChatService.eventFromStreamLine(line)?.let { emit(it) }
}

/** `/api/chat` 이벤트 스트림. ViewModel이 수집하고, 수집 취소가 연결을 닫는다. */
fun interface ChatStreamSource {
    fun events(body: ChatRequestBody): Flow<ChatStreamEvent>
}

class HttpChatStreamSource(private val baseUrl: String) : ChatStreamSource {
    override fun events(body: ChatRequestBody): Flow<ChatStreamEvent> = channelFlow {
        ChatHttp.post(baseUrl + ChatService.path, ChatService.encodeBody(body), ChatService.timeoutMs) { status, stream ->
            // 오류 본문은 짧은 JSON이라 전부 모아 message로 승격(iOS 동형). 2xx 본문은 스트림으로만 읽는다.
            if (status !in 200..299) ChatService.statusError(status, stream.readBytes().decodeToString())?.let { throw it }
            readChatStream(stream) { send(it) }
        }
    }.flowOn(Dispatchers.IO)
}

/** follow-up 질문 제안(spec §4-2). 어떤 실패도 빈 목록(칩은 없어도 되는 보조 컨트롤), 취소만 전파. */
fun interface ChatSuggestionsSource {
    suspend fun fetch(lastUser: String, lastAssistant: String, locale: String, placeName: String?): List<String>
}

class HttpChatSuggestionsSource(private val baseUrl: String) : ChatSuggestionsSource {
    override suspend fun fetch(lastUser: String, lastAssistant: String, locale: String, placeName: String?): List<String> = try {
        ChatHttp.post(
            baseUrl + ChatSuggestionsService.path,
            ChatSuggestionsService.encodeBody(lastUser, lastAssistant, locale, placeName),
            ChatSuggestionsService.timeoutMs,
        ) { status, stream -> ChatSuggestionsService.followUps(status, stream.readBytes().decodeToString()) }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        emptyList()
    }
}
