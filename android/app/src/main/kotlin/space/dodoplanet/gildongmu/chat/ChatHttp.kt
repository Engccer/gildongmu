package space.dodoplanet.gildongmu.chat

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayInputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * 채팅 POST 한 곳(스트림·follow-up 공용, spec §5-1). `net/HttpUrlConnectionTransport`는 GET 전용 `:kit` 인터페이스라 쓰지 않는다(D5 — POST·스트림은 M6 몫).
 * 타임아웃은 연결·읽기 둘 다 같은 **유휴** 상한(iOS URLSession `timeoutInterval` 의미)이고 값은 `:kit` 상수다.
 */
object ChatHttp {
    /**
     * `read`는 상태 코드와 본문 스트림(2xx면 응답, 아니면 오류 본문 — 없으면 빈 스트림)을 받는다. 전부 IO 스레드에서 돈다.
     * 블로킹 읽기는 코루틴 취소를 보지 못하므로 감시 코루틴이 취소 시 연결을 닫아 읽기를 즉시 깨운다(소켓 닫기도 IO 스레드).
     * 감시자는 모든 경로에서 해제한다 — 남으면 부모가 자식 완료를 기다려 스트림이 끝나지 않는다.
     * ⚠ 읽기를 깨우는 것은 플랫폼 구현이다: 안드로이드(OkHttp 기반)는 `disconnect()`가 호출을 취소해 읽기를 끝내는 구현이지만(기기 확인은 spec §8), JVM 표준 구현은
     * 청크 스트림 읽기 중이면 깨우지 못한다(2026-09-16 실측). 그래서 JVM 테스트는 [open]으로 가짜 연결을 넣어 계약만 잠그고, 기기 동작은 실기기 판정(spec §8)이다.
     */
    suspend fun <T> post(
        url: String,
        body: String,
        timeoutMs: Long,
        open: (String) -> HttpURLConnection = { URL(it).openConnection() as HttpURLConnection },
        read: suspend (status: Int, stream: InputStream) -> T,
    ): T =
        withContext(Dispatchers.IO) {
            val connection = open(url)
            val watcher = launch {
                try {
                    awaitCancellation()
                } finally {
                    connection.disconnect()
                }
            }
            try {
                val bytes = body.toByteArray(Charsets.UTF_8)
                connection.requestMethod = "POST"
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.connectTimeout = timeoutMs.toInt()
                connection.readTimeout = timeoutMs.toInt()
                connection.setFixedLengthStreamingMode(bytes.size)
                connection.outputStream.use { it.write(bytes) }
                val status = connection.responseCode
                val stream = if (status in 200..299) connection.inputStream else connection.errorStream ?: ByteArrayInputStream(ByteArray(0))
                stream.use { read(status, it) }
            } catch (e: Exception) {
                // 취소가 연결을 닫아 깨운 읽기는 IOException으로 끝난다 — 취소 중이면 그것을 실패로 올리지 않고 취소로 바꾼다
                // (코루틴은 취소 뒤의 비취소 예외를 근본 원인으로 삼아 부모에 실패로 전파한다, spec §4-1 리뷰 M1).
                if (e !is CancellationException) ensureActive()
                throw e
            } finally {
                watcher.cancel()
                connection.disconnect()
            }
        }
}
