package space.dodoplanet.gildongmu.chat

import kotlinx.coroutines.runBlocking
import space.dodoplanet.gildongmu.kit.APIError
import space.dodoplanet.gildongmu.kit.Fixtures
import space.dodoplanet.gildongmu.kit.models.ChatStreamEvent
import java.io.InputStream
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertTrue

/** NDJSON 리더(spec §5-3): 줄 분리는 `:kit` `splitStreamLines`만, 청크 경계와 무관해야 한다. */
class ChatStreamReaderTest {
    private val ndjson = Fixtures.kit("chat-stream.ndjson").toByteArray()

    /** 매 read가 최대 n바이트만 주는 스트림 — 네트워크 청크 경계 재현. */
    private class Chunked(private val bytes: ByteArray, private val n: Int) : InputStream() {
        private var pos = 0
        override fun read(): Int = if (pos < bytes.size) bytes[pos++].toInt() and 0xFF else -1
        override fun read(b: ByteArray, off: Int, len: Int): Int {
            if (pos >= bytes.size) return -1
            val k = minOf(len, n, bytes.size - pos)
            System.arraycopy(bytes, pos, b, off, k)
            pos += k
            return k
        }
    }

    private fun events(bytes: ByteArray, n: Int): List<ChatStreamEvent> = runBlocking {
        val out = ArrayList<ChatStreamEvent>()
        readChatStream(Chunked(bytes, n)) { out.add(it) }
        out
    }

    @Test fun `읽기 버퍼는 8KB 이상이다(splitStreamLines가 꼬리를 매번 재스캔)`() {
        assertTrue(STREAM_READ_BUFFER_BYTES >= 8192)
    }

    @Test fun `청크 크기와 무관하게 같은 이벤트`() {
        val whole = events(ndjson, 8192)
        assertIs<ChatStreamEvent.Status>(whole.first())
        assertIs<ChatStreamEvent.Done>(whole.last())
        for (n in listOf(1, 7, 100)) assertEquals(whole, events(ndjson, n), "청크 $n")
    }

    @Test fun `개행 없는 마지막 줄·CRLF·빈 줄`() {
        val body = "{\"type\":\"status\",\"categories\":[]}\r\n\r\n{\"type\":\"error\",\"code\":\"x\"}".toByteArray()
        assertEquals(listOf(ChatStreamEvent.Status(emptyList()), ChatStreamEvent.Error("x")), events(body, 3))
    }

    @Test fun `다중 바이트 글자가 청크 경계에서 끊겨도 온전하다`() {
        val body = "{\"type\":\"done\",\"text\":\"강동역 주변\"}\n".toByteArray()
        assertEquals("강동역 주변", assertIs<ChatStreamEvent.Done>(events(body, 1).single()).text)
    }

    @Test fun `깨진 줄은 Decoding 오류로 스트림을 끝낸다`() {
        assertFailsWith<APIError.Decoding> { events("{\"type\":\n".toByteArray(), 8192) }
    }

    @Test fun `U+2028 날 문자는 줄을 쪼갠다 — 서버 결함(A44 후보)의 현행 계약이고 앱에서 우회하지 않는다`() {
        val lineSeparator = Char(0x2028) // 보이지 않는 문자를 소스에 날로 두지 않는다(편집기 정규화로 테스트 의도가 사라진다)
        val body = "{\"type\":\"done\",\"text\":\"가${lineSeparator}나\"}\n".toByteArray()
        assertFailsWith<APIError.Decoding> { events(body, 8192) }
    }
}
