package space.dodoplanet.gildongmu.audio

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import java.io.IOException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** 채팅 듣기 재생기(iOS `TtsPlayer.playMessage`·웹 `useTtsPlayback` 계약): 기기 음성 우선·서버 폴백·토글·교체·세대·포커스 상실 정지·실패 통지. */
class ChatTtsPlayerTest {
    private class Speech(var ready: Boolean = true, var voice: Boolean = true, var startOk: Boolean = true) : ChatSpeechPort {
        val spoken = ArrayList<Triple<String, String, Float>>()
        var stops = 0
        var done: ((Boolean) -> Unit)? = null
        var pendingReady: ((Boolean) -> Unit)? = null
        var deferReady = false

        override fun prepare(onReady: (Boolean) -> Unit) { if (deferReady) pendingReady = onReady else onReady(ready) }
        override fun hasVoice(tag: String) = voice
        override fun speak(text: String, tag: String, rate: Float, onDone: (Boolean) -> Unit): Boolean {
            if (!startOk) return false
            spoken += Triple(text, tag, rate); done = onDone; return true
        }
        override fun stop() { stops++ }
    }

    private class Clip(var ok: Boolean = true) : ChatClipPort {
        val played = ArrayList<Pair<ByteArray, Float>>()
        var done: ((Boolean) -> Unit)? = null
        var stops = 0
        override fun play(mp3: ByteArray, speed: Float, onDone: (Boolean) -> Unit): Boolean { if (!ok) return false; played += mp3 to speed; done = onDone; return true }
        override fun stop() { stops++ }
    }

    private class Focus(var grant: Boolean = true) : ChatFocusPort {
        var held = false
        var onLost: ((Boolean) -> Unit)? = null
        override fun acquire(onLost: (Boolean) -> Unit): Boolean { this.onLost = onLost; held = grant; return grant }
        override fun release() { held = false }
    }

    private class Env(scope: TestScope, speed: Double = 1.0, lang: String = "ko", systemRate: Float = 1f, server: suspend (String, String) -> ByteArray = { _, _ -> byteArrayOf(1, 2, 3) }) {
        var guide = false
        val speech = Speech()
        val clip = Clip()
        val focus = Focus()
        val requests = ArrayList<Pair<String, String>>()
        var failures = 0
        val onFailed: () -> Unit = { failures++ }
        val player = ChatTtsPlayer(speech, clip, focus, { t, l -> requests += t to l; server(t, l) }, scope, { speed }, { lang }, { systemRate }, { guide })
    }

    private val dispatcher = StandardTestDispatcher()

    @Test fun `기기 보이스가 있으면 평문을 기기 음성으로, 배율은 시스템 속도에 곱하고 서버는 부르지 않는다`() = runTest(dispatcher) {
        val e = Env(this, speed = 1.5, lang = "ja", systemRate = 2f)
        e.player.toggle(7, "## 제목\n**굵게**", e.onFailed)
        assertEquals(Triple("제목\n굵게", "ja-JP", 3f), e.speech.spoken.single())
        assertEquals(7L, e.player.playingId.value)
        assertTrue(e.focus.held)
        advanceUntilIdle()
        assertTrue(e.requests.isEmpty())
        e.speech.done!!(false)
        assertNull(e.player.playingId.value)
        assertEquals(false, e.focus.held)
        assertEquals(0, e.failures)
    }

    @Test fun `같은 답변을 다시 누르면 정지, 다른 답변은 교체 — 옛 발화의 늦은 콜백은 새 재생을 되돌리지 못한다`() = runTest(dispatcher) {
        val e = Env(this)
        e.player.toggle(1, "하나", e.onFailed)
        val first = e.speech.done!!
        e.player.toggle(2, "둘", e.onFailed)
        assertEquals(2L, e.player.playingId.value)
        first(true) // 교체로 끊긴 옛 발화의 오류 콜백
        assertEquals(2L, e.player.playingId.value)
        assertEquals(0, e.failures)
        val stopsBefore = e.speech.stops
        e.player.toggle(2, "둘", e.onFailed)
        assertNull(e.player.playingId.value)
        assertEquals(stopsBefore + 1, e.speech.stops) // 라벨만이 아니라 소리도 끊는다
        assertEquals(listOf("하나", "둘"), e.speech.spoken.map { it.first })
    }

    @Test fun `보이스가 없으면 서버 MP3를 배율 그대로 재생하고, 응답 전에도 재생 중 라벨이다`() = runTest(dispatcher) {
        val gate = CompletableDeferred<Unit>()
        val e = Env(this, speed = 2.0, lang = "en", server = { _, _ -> gate.await(); byteArrayOf(9) })
        e.speech.voice = false
        e.player.toggle(3, "- 항목", e.onFailed)
        advanceUntilIdle()
        assertEquals(listOf("• 항목" to "en"), e.requests)
        assertEquals(3L, e.player.playingId.value)
        gate.complete(Unit)
        advanceUntilIdle()
        assertEquals(2f, e.clip.played.single().second)
        e.clip.done!!(false)
        assertNull(e.player.playingId.value)
        assertEquals(0, e.failures)
    }

    @Test fun `엔진이 없거나 준비에 실패해도 서버로 간다`() = runTest(dispatcher) {
        val e = Env(this)
        e.speech.ready = false
        e.player.toggle(1, "본문", e.onFailed)
        advanceUntilIdle()
        assertEquals(1, e.requests.size)
        assertEquals(1, e.clip.played.size)
    }

    @Test fun `서버 실패·재생 실패·합성 실패·포커스 거절은 통지 한 번, 라벨은 되돌아온다`() = runTest(dispatcher) {
        val server = Env(this, server = { _, _ -> throw IOException("502") })
        server.speech.voice = false
        server.player.toggle(1, "본문", server.onFailed)
        advanceUntilIdle()
        assertEquals(1, server.failures); assertNull(server.player.playingId.value)

        val clip = Env(this)
        clip.speech.voice = false
        clip.clip.ok = false
        clip.player.toggle(1, "본문", clip.onFailed)
        advanceUntilIdle()
        assertEquals(1, clip.failures)

        val synth = Env(this)
        synth.player.toggle(1, "본문", synth.onFailed)
        val stopsBefore = synth.speech.stops
        synth.speech.done!!(true)
        assertEquals(stopsBefore + 1, synth.speech.stops) // 긴 답변의 남은 조각이 실패 뒤 계속 읽히지 않게
        synth.speech.done!!(false) // 같은 세대의 두 번째 콜백은 무시
        assertEquals(1, synth.failures)

        val focus = Env(this)
        focus.focus.grant = false
        focus.player.toggle(1, "본문", focus.onFailed)
        assertEquals(1, focus.failures)
        assertTrue(focus.speech.spoken.isEmpty())
        assertNull(focus.player.playingId.value)
    }

    @Test fun `포커스를 잃으면 조용히 정지한다 — 끝난 세대의 상실은 새 재생을 멈추지 않는다`() = runTest(dispatcher) {
        val e = Env(this)
        e.player.toggle(1, "본문", e.onFailed)
        val lost = e.focus.onLost!!
        val stopsBefore = e.speech.stops
        lost(false)
        assertNull(e.player.playingId.value)
        assertEquals(stopsBefore + 1, e.speech.stops)
        assertEquals(0, e.failures)
        e.player.toggle(2, "다음", e.onFailed)
        lost(false) // 옛 재생의 상실 콜백
        assertEquals(2L, e.player.playingId.value)
    }

    @Test fun `잠깐 줄여 달라(CAN_DUCK)는 도보 안내 세션 중에만 정지 — TalkBack 덕킹에는 계속 읽는다`() = runTest(dispatcher) {
        val e = Env(this)
        e.player.toggle(1, "본문", e.onFailed)
        e.focus.onLost!!(true)
        assertEquals(1L, e.player.playingId.value)
        e.guide = true
        e.focus.onLost!!(true)
        assertNull(e.player.playingId.value)
    }

    @Test fun `같은 답변을 다시 들으면 서버를 다시 부르지 않는다(마지막 한 칸 캐시), 다른 답변은 부른다`() = runTest(dispatcher) {
        val e = Env(this)
        e.speech.voice = false
        e.player.toggle(1, "본문", e.onFailed); advanceUntilIdle()
        e.player.toggle(1, "본문", e.onFailed) // 정지
        e.player.toggle(1, "본문", e.onFailed); advanceUntilIdle()
        assertEquals(1, e.requests.size)
        assertEquals(2, e.clip.played.size)
        e.player.toggle(2, "다른", e.onFailed); advanceUntilIdle()
        assertEquals(2, e.requests.size)
    }

    @Test fun `엔진 콜백은 인자 id로만 가른다 — 옛 묶음의 늦은 중단·오류는 새 재생을 끝내지 않는다`() {
        assertTrue(chatUtteranceEnds("chat-2-3", batch = 2, lastIndex = 3, ended = false))
        assertEquals(false, chatUtteranceEnds("chat-2-1", batch = 2, lastIndex = 3, ended = false)) // 중간 조각 완료
        assertTrue(chatUtteranceEnds("chat-2-1", batch = 2, lastIndex = 3, ended = true)) // 중간 조각 오류·중단은 끝
        assertEquals(false, chatUtteranceEnds("chat-1-0", batch = 2, lastIndex = 0, ended = true)) // 교체로 끊긴 옛 발화의 onStop
        assertEquals(false, chatUtteranceEnds("chat-12-0", batch = 1, lastIndex = 0, ended = true)) // 접두 겹침
        assertEquals(false, chatUtteranceEnds(null, batch = 1, lastIndex = 0, ended = true))
    }

    @Test fun `정지 뒤 도착한 서버 응답은 재생하지 않는다, 준비 중 정지도 같다`() = runTest(dispatcher) {
        val gate = CompletableDeferred<Unit>()
        val e = Env(this, server = { _, _ -> gate.await(); byteArrayOf(1) })
        e.speech.voice = false
        e.player.toggle(1, "본문", e.onFailed)
        advanceUntilIdle()
        e.player.stop()
        gate.complete(Unit)
        advanceUntilIdle()
        assertTrue(e.clip.played.isEmpty())

        val slow = Env(this)
        slow.speech.deferReady = true
        slow.player.toggle(1, "본문", slow.onFailed)
        slow.player.stop()
        slow.speech.pendingReady!!(true)
        assertTrue(slow.speech.spoken.isEmpty())
        assertEquals(0, slow.failures)
    }

    @Test fun `평문이 비면 재생하지 않는다`() = runTest(dispatcher) {
        val e = Env(this)
        e.player.toggle(1, "***", e.onFailed)
        assertNull(e.player.playingId.value)
        assertTrue(e.speech.spoken.isEmpty())
    }

    @Test fun `chunkForSpeech — 상한 안에서 줄바꿈·공백 경계로 나누고 합치면 원문`() {
        assertEquals(listOf("가나다"), chunkForSpeech("가나다", 10))
        val text = "첫 줄입니다\n둘째 줄\n셋째"
        val chunks = chunkForSpeech(text, 8)
        assertTrue(chunks.all { it.length <= 8 })
        assertEquals(text, chunks.joinToString(""))
        assertEquals(listOf("abc", "def", "g"), chunkForSpeech("abcdefg", 3)) // 경계가 없으면 상한에서 자른다
        assertEquals(listOf("ab ", "cd"), chunkForSpeech("ab cd", 4))
        val emoji = "a" + String(Character.toChars(0x1F600)) + "b" // 서로게이트 쌍을 가르지 않는다
        assertEquals(listOf("a", String(Character.toChars(0x1F600)), "b"), chunkForSpeech(emoji, 2))
    }
}
