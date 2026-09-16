package space.dodoplanet.gildongmu.chat

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import space.dodoplanet.gildongmu.kit.APIError
import space.dodoplanet.gildongmu.kit.ChatService
import space.dodoplanet.gildongmu.kit.models.ChatRequestBody
import space.dodoplanet.gildongmu.kit.models.ChatStreamEvent
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/** POST 전송기(spec §5-1·§5-2): 로컬 소켓 서버로 본문·상태 분류·취소 시 즉시 반환을 잠근다. JVM `HttpURLConnection`. */
class ChatHttpTest {
    private val body = ChatRequestBody(messages = listOf(ChatRequestBody.Turn("user", "강남역 근처 카페")), locale = "ko")

    private class Recorded(val requestLine: String, val headers: Map<String, String>, val body: String)

    /** 한 번만 받는 서버. `respond`가 응답을 쓰고, `hold`면 `close()`까지 소켓을 열어 둔다. */
    private class OneShotServer(private val hold: Boolean = false, private val respond: (OutputStream) -> Unit) : AutoCloseable {
        private val server = ServerSocket(0, 1, InetAddress.getLoopbackAddress())
        private val release = CountDownLatch(1)
        val recorded = CompletableFuture<Recorded>()
        val base get() = "http://127.0.0.1:${server.localPort}"

        init {
            thread(isDaemon = true) {
                runCatching {
                    server.accept().use { socket ->
                        val input = socket.getInputStream()
                        val head = readHead(input)
                        val lines = head.split("\r\n")
                        val headers = lines.drop(1).filter { it.contains(':') }
                            .associate { it.substringBefore(':').trim().lowercase() to it.substringAfter(':').trim() }
                        val length = headers["content-length"]?.toInt() ?: 0
                        val bytes = ByteArray(length)
                        var read = 0
                        while (read < length) { val n = input.read(bytes, read, length - read); if (n < 0) break; read += n }
                        recorded.complete(Recorded(lines.first(), headers, String(bytes, Charsets.UTF_8)))
                        respond(socket.getOutputStream())
                        socket.getOutputStream().flush()
                        if (hold) release.await(10, TimeUnit.SECONDS)
                    }
                }
            }
        }

        private fun readHead(input: InputStream): String {
            val buf = ByteArrayOutputStream()
            var last4 = 0
            while (true) {
                val b = input.read()
                if (b < 0) break
                buf.write(b)
                last4 = (last4 shl 8) or b
                if (last4 == 0x0D0A0D0A) break
            }
            return buf.toString(Charsets.UTF_8.name())
        }

        override fun close() {
            release.countDown()
            server.close()
        }
    }

    @Test fun `POST 본문·헤더가 도착하고 2xx 스트림을 이벤트로 읽는다`() {
        val payload = "{\"type\":\"status\",\"categories\":[\"search_places\"]}\n{\"type\":\"done\",\"text\":\"답\"}\n".toByteArray()
        OneShotServer { out ->
            out.write("HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nContent-Length: ${payload.size}\r\nConnection: close\r\n\r\n".toByteArray())
            out.write(payload)
        }.use { server ->
            val events = runBlocking { withTimeout(10_000) { HttpChatStreamSource(server.base).events(body).toList() } }
            assertEquals(2, events.size)
            assertEquals("답", (events[1] as ChatStreamEvent.Done).text)
            val req = server.recorded.get(5, TimeUnit.SECONDS)
            assertEquals("POST ${ChatService.path} HTTP/1.1", req.requestLine)
            assertTrue(req.headers["content-type"]!!.startsWith("application/json"))
            assertEquals(ChatService.encodeBody(body), req.body)
        }
    }

    @Test fun `비-2xx는 오류 본문의 error를 message로 올린 BadStatus`() {
        val err = "{\"error\":\"rate_limited\"}".toByteArray()
        OneShotServer { out ->
            out.write("HTTP/1.1 429 Too Many Requests\r\nContent-Type: application/json\r\nContent-Length: ${err.size}\r\nConnection: close\r\n\r\n".toByteArray())
            out.write(err)
        }.use { server ->
            val e = assertFailsWith<APIError.BadStatus> { runBlocking { withTimeout(10_000) { HttpChatStreamSource(server.base).events(body).toList() } } }
            assertEquals(429, e.code)
            assertEquals("rate_limited", e.serverMessage)
        }
    }

    /** 읽기가 `disconnect()` 전까지 막히는 가짜 연결 — 취소 → 감시자 disconnect → 읽기 해제 → 즉시 반환 계약을 JDK 내부 동작과 무관하게 잠근다. */
    private open class StalledConnection(private val status: Int = 200) : HttpURLConnection(URL("http://stalled.test/api/chat")) {
        val disconnected = CountDownLatch(1)
        var disconnectCalls = 0
        var outputStreamCalls = 0
        val fixedLength get() = fixedContentLength
        override fun connect() = Unit
        override fun usingProxy() = false
        override fun disconnect() { disconnectCalls++; disconnected.countDown() }
        override fun getOutputStream(): OutputStream { outputStreamCalls++; return ByteArrayOutputStream() }
        override fun getResponseCode() = status
        override fun getErrorStream(): InputStream? = null
        override fun getInputStream(): InputStream = object : InputStream() {
            private val first = "{\"type\":\"status\",\"categories\":[]}\n".toByteArray()
            private var pos = 0
            override fun read(): Int = throw UnsupportedOperationException()
            override fun read(b: ByteArray, off: Int, len: Int): Int {
                if (pos < first.size) { val k = minOf(len, first.size - pos); System.arraycopy(first, pos, b, off, k); pos += k; return k }
                disconnected.await(10, TimeUnit.SECONDS)
                throw IOException("closed by disconnect")
            }
        }
    }

    @Test fun `멈춘 스트림에서 수집을 취소하면 감시자가 disconnect해 곧 반환한다`() {
        val connection = StalledConnection()
        runBlocking {
            val first = CompletableDeferred<Unit>()
            val job = launch(Dispatchers.Default) {
                ChatHttp.post("http://stalled.test/api/chat", "{}", 180_000, open = { connection }) { _, stream ->
                    readChatStream(stream) { first.complete(Unit) }
                }
            }
            withTimeout(5_000) { first.await() }
            withTimeout(2_000) { job.cancelAndJoin() }
        }
        assertTrue(connection.disconnectCalls >= 1)
        assertEquals(2, connection.fixedLength) // "{}" 고정 길이 본문
        assertEquals(180_000, connection.readTimeout)
        assertEquals(180_000, connection.connectTimeout)
    }

    @Test fun `연결을 연 직후 취소되면 요청을 보내지 않고 감시자가 연결을 닫는다`() {
        val connection = StalledConnection()
        val jobRef = java.util.concurrent.atomic.AtomicReference<kotlinx.coroutines.Job>()
        runBlocking {
            withTimeout(5_000) {
                val job = launch(Dispatchers.Default, start = kotlinx.coroutines.CoroutineStart.LAZY) {
                    ChatHttp.post("http://stalled.test/api/chat", "{}", 180_000, open = { jobRef.get().cancel(); connection }) { _, _ -> Unit }
                }
                jobRef.set(job)
                job.start()
                job.join()
            }
        }
        assertEquals(0, connection.outputStreamCalls)
        assertTrue(connection.disconnectCalls >= 1)
    }

    @Test fun `오류 본문이 없는 비-2xx도 BadStatus(메시지 없음)`() {
        val connection = StalledConnection(status = 503)
        val e = assertFailsWith<APIError.BadStatus> {
            runBlocking {
                withTimeout(5_000) {
                    ChatHttp.post("http://stalled.test/api/chat", "{}", 180_000, open = { connection }) { status, stream ->
                        space.dodoplanet.gildongmu.kit.ChatService.statusError(status, stream.readBytes().decodeToString())?.let { throw it }
                    }
                }
            }
        }
        assertEquals(503, e.code)
        assertEquals(null, e.serverMessage)
    }

    @Test fun `follow-up 칩 전송 실패는 빈 목록`() {
        val closedPort = ServerSocket(0, 1, InetAddress.getLoopbackAddress()).use { it.localPort }
        val result = runBlocking { withTimeout(10_000) { HttpChatSuggestionsSource("http://127.0.0.1:$closedPort").fetch("질문", "답", "ko", null) } }
        assertEquals(emptyList(), result)
    }

    @Test fun `follow-up 칩 2xx는 kit 파서가 최대 3개로 자른다`() {
        val json = "{\"suggestions\":[\"a\",\"b\",\"c\",\"d\"]}".toByteArray()
        OneShotServer { out ->
            out.write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${json.size}\r\nConnection: close\r\n\r\n".toByteArray())
            out.write(json)
        }.use { server ->
            val result = runBlocking { withTimeout(10_000) { HttpChatSuggestionsSource(server.base).fetch("질문", "답", "ko", "강남역") } }
            assertEquals(listOf("a", "b", "c"), result)
            assertTrue(server.recorded.get(5, TimeUnit.SECONDS).body.contains("\"placeName\":\"강남역\""))
        }
    }
}
