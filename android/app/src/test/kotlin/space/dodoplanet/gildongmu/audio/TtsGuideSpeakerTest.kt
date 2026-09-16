package space.dodoplanet.gildongmu.audio

import android.media.AudioManager
import space.dodoplanet.gildongmu.kit.InMemoryKeyValueStore
import space.dodoplanet.gildongmu.kit.ListenSpeed
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class FakeTts : TtsPort {
    var onReady: ((Boolean) -> Unit)? = null
    var languageOk = true
    val languages = mutableListOf<String>()
    val rates = mutableListOf<Float>()
    val spoken = mutableListOf<Pair<String, String>>()
    var speakOk = true
    var onDone: ((String) -> Unit)? = null
    override fun init(onReady: (Boolean) -> Unit) { this.onReady = onReady }
    override fun setLanguage(tag: String): Boolean { languages += tag; return languageOk }
    override fun setRate(rate: Float) { rates += rate }
    override fun speakFlush(text: String, utteranceId: String): Boolean { spoken += text to utteranceId; return speakOk }
    override fun setProgressListener(onDone: (String) -> Unit) { this.onDone = onDone }
}

/** spec §5-3 — 보류 1문장·언어 미지원·포커스 거절·최신 id만 반납·배율 표. */
class TtsGuideSpeakerTest {
    private val tts = FakeTts()
    private val port = FakeFocusPort()
    private val sched = FakeScheduler()
    private val focus = GuideAudioFocus(port, sched.post)
    private val store = InMemoryKeyValueStore()
    private val speaker = TtsGuideSpeaker(tts, focus, store, { "ko" })

    @Test fun `초기화 전 두 문장 → 준비 뒤 최신 1개만`() {
        assertTrue(speaker.speak("a", false))
        assertTrue(speaker.speak("b", true))
        assertEquals(emptyList(), tts.spoken)
        tts.onReady!!(true)
        assertEquals(listOf("b" to "1"), tts.spoken)
        assertEquals(listOf("ko"), tts.languages)
        assertFalse(speaker.isUnavailable)
    }

    @Test fun `초기화 실패 → isUnavailable, 보류 버림, 이후 speak false`() {
        speaker.speak("a", false)
        tts.onReady!!(false)
        assertTrue(speaker.isUnavailable)
        assertEquals(emptyList(), tts.spoken)
        assertFalse(speaker.speak("c", false))
    }

    @Test fun `언어 미지원 → isUnavailable·speak false`() {
        tts.languageOk = false
        speaker.prepare()
        tts.onReady!!(true)
        assertTrue(speaker.isUnavailable)
        assertFalse(speaker.speak("a", false))
        assertEquals(emptyList(), tts.spoken)
    }

    @Test fun `포커스 거절 → speakFlush 0·false`() {
        speaker.prepare(); tts.onReady!!(true)
        port.nextResult = AudioManager.AUDIOFOCUS_REQUEST_FAILED
        assertFalse(speaker.speak("a", false))
        assertEquals(emptyList(), tts.spoken)
    }

    @Test fun `반납은 최신 utterance의 onDone에서만 — 옛 id는 무시`() {
        speaker.prepare(); tts.onReady!!(true)
        speaker.speak("a", false)   // id 1
        speaker.speak("b", false)   // id 2 (flush)
        tts.onDone!!("1")
        sched.runDue(1.0)
        assertEquals(0, port.abandons)
        assertTrue(focus.held)
        tts.onDone!!("2")
        sched.runDue(0.1)
        assertEquals(0, port.abandons)
        sched.runDue(0.1)
        assertEquals(1, port.abandons)
    }

    @Test fun `엔진 실패 → false + 반납 예약`() {
        speaker.prepare(); tts.onReady!!(true)
        tts.speakOk = false
        assertFalse(speaker.speak("a", false))
        sched.runDue(0.2)
        assertEquals(1, port.abandons)
    }

    @Test fun `배율 — 저장값 없음·1_0은 setRate 호출 0, 1_5는 1_5f, 2_0은 2_0f`() {
        speaker.prepare(); tts.onReady!!(true)
        assertEquals(emptyList(), tts.rates)
        val s15 = FakeTts(); store.putString(ListenSpeed.storageKey, "1.5")
        TtsGuideSpeaker(s15, focus, store, { "ko" }).prepare(); s15.onReady!!(true)
        assertEquals(listOf(1.5f), s15.rates)
        val s20 = FakeTts(); store.putString(ListenSpeed.storageKey, "2.0")
        TtsGuideSpeaker(s20, focus, store, { "ko" }).prepare(); s20.onReady!!(true)
        assertEquals(listOf(2.0f), s20.rates)
        val bad = FakeTts(); store.putString(ListenSpeed.storageKey, "9")
        TtsGuideSpeaker(bad, focus, store, { "ko" }).prepare(); bad.onReady!!(true)
        assertEquals(emptyList(), bad.rates)
        assertNull(null)
    }

    @Test fun `prepare는 멱등 — 초기화 중 재호출에 init 1회`() {
        var inits = 0
        val p = object : TtsPort by tts { override fun init(onReady: (Boolean) -> Unit) { inits++; tts.init(onReady) } }
        val s = TtsGuideSpeaker(p, focus, store, { "ko" })
        s.prepare(); s.prepare()
        assertEquals(1, inits)
        tts.onReady!!(true)
        s.prepare()
        assertEquals(1, inits)
    }
}
