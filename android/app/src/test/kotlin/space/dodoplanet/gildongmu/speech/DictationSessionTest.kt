package space.dodoplanet.gildongmu.speech

import android.speech.SpeechRecognizer
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

/** 받아쓰기 세션 상태 머신(M6 spec §6)을 가짜 인식기·가짜 효과로 잠근다. 실제 인식기·TalkBack 동작은 실기기 판정(spec §8-10·11). */
class DictationSessionTest {
    private class FakePort : RecognizerPort {
        var support: ((RecognizerSupport) -> Unit)? = null
        var download: ((DownloadResult) -> Unit)? = null
        val listeners = ArrayList<RecognizerListener>()
        val tags = ArrayList<String>()
        var starts = 0
        var stops = 0
        var cancels = 0
        override fun checkSupport(languageTag: String, onResult: (RecognizerSupport) -> Unit) { tags += languageTag; support = onResult }
        override fun download(languageTag: String, onResult: (DownloadResult) -> Unit) { download = onResult }
        var onStart: () -> Unit = {}
        override fun start(languageTag: String, listener: RecognizerListener) { starts++; listeners += listener; onStart() }
        var onStop: () -> Unit = {}
        override fun stop() { stops++; onStop() }
        override fun cancel() { cancels++ }
        val listener get() = listeners.last()
    }

    private class FakeEffects(private val ignoreCancel: Boolean = false) : DictationEffects {
        var startTones = 0
        var stopTones = 0
        var interrupts = 0
        var releases = 0
        val timers = ArrayList<Pair<Long, () -> Unit>>()
        override fun startTone() { startTones++ }
        override fun stopTone() { stopTones++ }
        override fun interruptScreenReader() { interrupts++ }
        override fun postDelayed(ms: Long, block: () -> Unit): () -> Unit {
            val entry = ms to block
            timers += entry
            return { if (!ignoreCancel) timers.remove(entry) }
        }
        override fun release() { releases++ }

        /** 해당 지연의 타이머를 (남아 있으면) 실행한다. */
        fun fire(ms: Long) {
            val entry = timers.firstOrNull { it.first == ms } ?: error("타이머 없음: $ms")
            timers.remove(entry)
            entry.second()
        }

        fun has(ms: Long) = timers.any { it.first == ms }
    }

    private val port = FakePort()
    private val effects = FakeEffects()
    private val transcripts = ArrayList<String>()
    private val notices = ArrayList<DictationNotice>()
    private val session = DictationSession(port, effects, { "ko-KR" }, { transcripts += it }, { notices += it })

    /** 설치된 언어로 청취까지(onReady 포함). */
    private fun listen() {
        session.toggle()
        port.support!!(RecognizerSupport.Installed)
        effects.fire(INTERRUPT_SETTLE_MS)
        port.listener.onReady()
    }

    @Test fun `지원 판정 — 언어 표기 정규화`() {
        assertEquals(RecognizerSupport.Installed, supportDecision("ko-KR", listOf("ko-KR"), emptyList(), emptyList()))
        assertEquals(RecognizerSupport.Installed, supportDecision("ko-KR", listOf("ko_KR"), emptyList(), emptyList()))
        assertEquals(RecognizerSupport.Installed, supportDecision("ko-KR", listOf("ko"), emptyList(), emptyList()))
        assertEquals(RecognizerSupport.NeedsDownload, supportDecision("ko-KR", listOf("en-US"), listOf("ko-KR"), emptyList()))
        assertEquals(RecognizerSupport.NeedsDownload, supportDecision("ko-KR", emptyList(), emptyList(), listOf("ko-KR")))
        assertEquals(RecognizerSupport.Unsupported, supportDecision("ko-KR", listOf("en-US", "ko-KP"), emptyList(), emptyList()))
    }

    @Test fun `언어 태그 표(iOS speechLocaleIdentifier 미러)`() {
        assertEquals(
            listOf("ko-KR", "en-US", "es-ES", "fr-FR", "it-IT", "ja-JP", "ko-KR"),
            listOf("ko", "en", "es", "fr", "it", "ja", "de").map(::speechLanguageTag),
        )
    }

    @Test fun `오류 코드 판정`() {
        assertEquals(DictationErrorOutcome.Finish, dictationErrorOutcome(SpeechRecognizer.ERROR_NO_MATCH, stopping = false, listening = true))
        assertEquals(DictationErrorOutcome.Finish, dictationErrorOutcome(SpeechRecognizer.ERROR_SPEECH_TIMEOUT, stopping = false, listening = true))
        assertEquals(DictationErrorOutcome.Finish, dictationErrorOutcome(SpeechRecognizer.ERROR_CLIENT, stopping = true, listening = true))
        assertEquals(DictationErrorOutcome.Denied, dictationErrorOutcome(SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS, stopping = false, listening = false))
        assertEquals(DictationErrorOutcome.Fail(DictationFailure.Locale), dictationErrorOutcome(SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, false, false))
        assertEquals(DictationErrorOutcome.Fail(DictationFailure.OnDevice), dictationErrorOutcome(SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE, false, false))
        assertEquals(DictationErrorOutcome.Fail(DictationFailure.Audio), dictationErrorOutcome(SpeechRecognizer.ERROR_AUDIO, false, true))
        assertEquals(DictationErrorOutcome.Fail(DictationFailure.Audio), dictationErrorOutcome(SpeechRecognizer.ERROR_RECOGNIZER_BUSY, false, false))
        assertEquals(DictationErrorOutcome.Fail(DictationFailure.Interrupted), dictationErrorOutcome(SpeechRecognizer.ERROR_SERVER_DISCONNECTED, false, true))
        assertEquals(DictationErrorOutcome.Fail(DictationFailure.StartFailed), dictationErrorOutcome(SpeechRecognizer.ERROR_SERVER_DISCONNECTED, false, false))
        assertEquals(DictationErrorOutcome.Fail(DictationFailure.StartFailed), dictationErrorOutcome(SpeechRecognizer.ERROR_CLIENT, stopping = false, listening = false))
    }

    @Test fun `청취 시작 순서 — 라벨 전환 뒤 낭독 끊기 → 인식기 시작 → 준비되면 한 번 더 끊고 시작음`() {
        session.toggle()
        assertEquals(DictationPhase.Starting, session.phase.value)
        assertTrue(session.isActive.value)
        assertEquals(listOf("ko-KR"), port.tags)
        port.support!!(RecognizerSupport.Installed)
        assertEquals(DictationPhase.Listening, session.phase.value)
        assertEquals(0, port.starts)
        assertEquals(0, effects.interrupts)
        effects.fire(INTERRUPT_SETTLE_MS)
        assertEquals(1, effects.interrupts)
        assertEquals(1, port.starts)
        assertEquals(0, effects.startTones)
        port.listener.onReady()
        assertEquals(2, effects.interrupts)
        assertEquals(1, effects.startTones)
        port.listener.onReady() // 구현이 반복 호출해도 세션당 1회
        assertEquals(2, effects.interrupts)
        assertEquals(1, effects.startTones)
    }

    @Test fun `다운로드 필요 — 준비 중은 통지 없이·마이크 없음, 끝나도 청취하지 않고 통지(Ready·Scheduled·Failed)`() {
        session.toggle()
        port.support!!(RecognizerSupport.NeedsDownload)
        assertEquals(DictationPhase.Preparing, session.phase.value)
        assertFalse(session.isActive.value) // 마이크가 없다 — 완료 착지·통지를 보류하지 않는다
        assertEquals(emptyList(), notices)
        port.download!!(DownloadResult.Ready)
        assertEquals(DictationPhase.Idle, session.phase.value)
        assertEquals(0, port.starts)
        assertEquals(listOf<DictationNotice>(DictationNotice.DownloadReady), notices)

        session.toggle(); port.support!!(RecognizerSupport.NeedsDownload); port.download!!(DownloadResult.Scheduled)
        assertEquals(DictationNotice.DownloadRequested, notices.last())
        assertEquals(DictationPhase.Idle, session.phase.value)
        session.toggle(); port.support!!(RecognizerSupport.NeedsDownload); port.download!!(DownloadResult.Failed)
        assertEquals(DictationNotice.DownloadFailed, notices.last())
        assertEquals(DictationPhase.Idle, session.phase.value)
        assertEquals(0, port.starts)
        assertEquals(3, port.cancels) // 세 갈래 모두 인식기를 해제한다(destroy 누락 방지)
    }

    @Test fun `지원 조회 중(Starting) 탭은 무시한다 — 라벨이 같아 취소가 무신호가 된다`() {
        session.toggle()
        session.toggle()
        assertEquals(DictationPhase.Starting, session.phase.value)
        port.support!!(RecognizerSupport.Installed)
        assertEquals(DictationPhase.Listening, session.phase.value)
    }

    @Test fun `미지원 언어는 온디바이스 미지원 통지·Unknown은 그대로 청취 시도`() {
        session.toggle()
        port.support!!(RecognizerSupport.Unsupported)
        assertEquals(DictationNotice.Failure(DictationFailure.OnDevice), notices.single())
        assertEquals(DictationPhase.Idle, session.phase.value)
        assertEquals(1, port.cancels)
        session.toggle()
        port.support!!(RecognizerSupport.Unknown)
        assertEquals(DictationPhase.Listening, session.phase.value)
    }

    @Test fun `분할 결과를 모아 세션 끝에 한 번 전달하고 자동 종료에도 끝소리가 난다`() {
        listen()
        port.listener.onSegment("강남역")
        port.listener.onSegment("근처 카페")
        port.listener.onEnd(null)
        assertEquals(listOf("강남역 근처 카페"), transcripts)
        assertEquals(1, effects.stopTones)
        assertEquals(DictationPhase.Idle, session.phase.value)
        assertFalse(session.isActive.value)
        assertEquals(1, port.cancels)
    }

    @Test fun `분할 미지원 구현은 onEnd 최종 후보를 쓴다·문장부호뿐인 전사는 버린다`() {
        listen()
        port.listener.onEnd("강남역")
        listen()
        port.listener.onEnd(".")
        assertEquals(listOf("강남역"), transcripts)
    }

    @Test fun `정지 — 끝소리 즉시·인식기 정지, 결과가 오면 전달하고 끝소리는 한 번`() {
        listen()
        port.listener.onSegment("강남역")
        session.toggle()
        assertEquals(1, effects.stopTones)
        assertEquals(1, port.stops)
        port.listener.onEnd(null)
        assertEquals(listOf("강남역"), transcripts)
        assertEquals(1, effects.stopTones)
    }

    @Test fun `정지 뒤 종결 콜백이 없으면 3초 상한에 누적분으로 끝내고 늦은 콜백은 무시`() {
        listen()
        port.listener.onSegment("강남역")
        val late = port.listener
        session.toggle()
        effects.fire(STOP_FINALIZE_TIMEOUT_MS)
        assertEquals(listOf("강남역"), transcripts)
        assertEquals(DictationPhase.Idle, session.phase.value)
        assertEquals(1, port.cancels)
        late.onEnd("늦은 결과")
        assertEquals(listOf("강남역"), transcripts)
    }

    @Test fun `정지 즉시 종결 콜백을 내는 구현에서도 전달 1회·남는 타이머 없음`() {
        listen()
        port.listener.onSegment("강남역")
        val listener = port.listener
        port.onStop = { listener.onEnd(null) }
        session.toggle()
        assertEquals(listOf("강남역"), transcripts)
        assertTrue(effects.timers.isEmpty())
        assertEquals(1, effects.stopTones)
    }

    @Test fun `종결 직후 재시작한 세션을 옛 캡·상한이 끊지 않는다`() {
        listen()
        session.toggle()
        port.listener.onEnd(null)
        assertTrue(effects.timers.isEmpty())
        listen()
        assertEquals(1, effects.timers.count { it.first == LISTEN_CAP_MS })
        assertFalse(effects.has(STOP_FINALIZE_TIMEOUT_MS))
        assertEquals(DictationPhase.Listening, session.phase.value)
    }

    @Test fun `이중 정지는 한 번만`() {
        listen()
        session.toggle()
        session.toggle()
        assertEquals(1, port.stops)
    }

    @Test fun `60초 캡은 정지 경로와 같다`() {
        listen()
        port.listener.onSegment("길게 말한 내용")
        effects.fire(LISTEN_CAP_MS)
        assertEquals(1, port.stops)
        assertEquals(1, effects.stopTones)
        port.listener.onEnd(null)
        assertEquals(listOf("길게 말한 내용"), transcripts)
    }

    @Test fun `준비 중 탭은 취소 — 늦게 온 다운로드 완료가 마이크를 켜지 않는다`() {
        session.toggle()
        port.support!!(RecognizerSupport.NeedsDownload)
        session.toggle()
        assertEquals(DictationPhase.Idle, session.phase.value)
        port.download!!(DownloadResult.Ready)
        assertEquals(0, port.starts)
        assertEquals(DictationPhase.Idle, session.phase.value)
    }

    @Test fun `낭독 끊기 대기 중 정지는 인식기를 켜지 않고 취소한다`() {
        session.toggle()
        port.support!!(RecognizerSupport.Installed)
        session.toggle()
        assertEquals(DictationPhase.Idle, session.phase.value)
        assertFalse(effects.has(INTERRUPT_SETTLE_MS))
        assertEquals(0, port.starts)
        assertEquals(0, effects.stopTones)
    }

    @Test fun `취소 뒤 옛 세션 콜백은 새 세션에 붙지 않는다`() {
        listen()
        val old = port.listener
        old.onSegment("옛")
        session.cancel()
        assertEquals(0, effects.stopTones)
        listen()
        old.onSegment("섞이면 안 됨")
        old.onEnd("옛 결과")
        port.listener.onSegment("새")
        port.listener.onEnd(null)
        assertEquals(listOf("새"), transcripts)
    }

    @Test fun `청취 중 오류 — 누적분이 있으면 전달하고 실패 통지는 없다, 없으면 끊김 통지`() {
        listen()
        port.listener.onSegment("강남역")
        port.listener.onError(SpeechRecognizer.ERROR_SERVER_DISCONNECTED)
        assertEquals(listOf("강남역"), transcripts)
        assertEquals(emptyList(), notices)
        assertEquals(DictationPhase.Idle, session.phase.value)

        listen()
        port.listener.onError(SpeechRecognizer.ERROR_SERVER_DISCONNECTED)
        assertEquals(DictationNotice.Failure(DictationFailure.Interrupted), notices.single())
    }

    @Test fun `준비 신호 전 오디오 오류는 오디오 실패 통지이고 소리가 없다`() {
        session.toggle()
        port.support!!(RecognizerSupport.Installed)
        effects.fire(INTERRUPT_SETTLE_MS)
        port.listener.onError(SpeechRecognizer.ERROR_AUDIO)
        assertEquals(DictationNotice.Failure(DictationFailure.Audio), notices.single())
        assertEquals(0, effects.stopTones)
        assertEquals(DictationPhase.Idle, session.phase.value)
    }

    @Test fun `권한 거부 — Denied 유지와 통지, 다시 누르면 시작`() {
        session.markDenied()
        assertEquals(DictationPhase.Denied, session.phase.value)
        assertEquals(DictationNotice.Denied, notices.single())
        session.toggle()
        assertIs<DictationPhase.Starting>(session.phase.value)
    }

    @Test fun `인식기가 권한 오류를 내면 Denied`() {
        listen()
        port.listener.onError(SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS)
        assertEquals(DictationPhase.Denied, session.phase.value)
        assertEquals(DictationNotice.Denied, notices.single())
    }

    @Test fun `detach — 청취 중이면 정상 정지 경로로 누적분을 전달한 뒤 효과를 해제한다(구성 변경)`() {
        listen()
        port.listener.onSegment("회전 전에 말한 내용")
        session.detach()
        assertEquals(1, port.stops)
        assertEquals(1, effects.stopTones)
        assertEquals(0, effects.releases)
        port.listener.onEnd(null)
        assertEquals(listOf("회전 전에 말한 내용"), transcripts)
        assertEquals(1, effects.releases)
    }

    @Test fun `detach — 상한 만료로 끝나도 효과를 해제한다`() {
        listen()
        session.detach()
        effects.fire(STOP_FINALIZE_TIMEOUT_MS)
        assertEquals(1, effects.releases)
    }

    @Test fun `detach — 청취 전이면 dispose와 같다`() {
        session.toggle()
        session.detach()
        assertEquals(DictationPhase.Idle, session.phase.value)
        assertEquals(1, effects.releases)
        assertEquals(0, port.stops)
    }

    @Test fun `지원 조회가 응답하지 않으면 상한 뒤 시작 실패로 끝내고 인식기를 해제한다`() {
        session.toggle()
        assertTrue(session.isActive.value)
        effects.fire(SUPPORT_CHECK_TIMEOUT_MS)
        assertEquals(DictationPhase.Idle, session.phase.value)
        assertFalse(session.isActive.value)
        assertEquals(DictationNotice.Failure(DictationFailure.StartFailed), notices.single())
        assertEquals(1, port.cancels)
        port.support!!(RecognizerSupport.Installed) // 늦은 응답은 무시
        assertEquals(0, port.starts)
    }

    @Test fun `지원 조회 중 서비스 연결 실패는 시작 실패로 끝낸다`() {
        session.toggle()
        port.support!!(RecognizerSupport.ConnectionFailed)
        assertEquals(DictationNotice.Failure(DictationFailure.StartFailed), notices.single())
        assertEquals(DictationPhase.Idle, session.phase.value)
        assertEquals(1, port.cancels)
        assertFalse(effects.has(SUPPORT_CHECK_TIMEOUT_MS))
    }

    @Test fun `준비 신호 전 정지는 정지음 없이(시작음을 들은 적이 없다) 끝낸다`() {
        session.toggle()
        port.support!!(RecognizerSupport.Installed)
        effects.fire(INTERRUPT_SETTLE_MS)
        session.toggle()
        assertEquals(0, effects.stopTones)
        port.listener.onEnd(null)
        assertEquals(0, effects.stopTones)
    }

    @Test fun `빈 분할 조각은 누적하지 않는다`() {
        listen()
        port.listener.onSegment("강남역")
        port.listener.onSegment("  ")
        port.listener.onSegment("근처")
        port.listener.onEnd(null)
        assertEquals(listOf("강남역 근처"), transcripts)
    }

    @Test fun `정지 직후 화면을 떠나도 정지 경로를 완주해 전사를 전달하고 해제한다`() {
        listen()
        port.listener.onSegment("떠나기 전에 말한 내용")
        session.toggle()
        session.dispose()
        assertEquals(0, effects.releases)
        port.listener.onEnd(null)
        assertEquals(listOf("떠나기 전에 말한 내용"), transcripts)
        assertEquals(1, effects.releases)
    }

    @Test fun `캡은 인식기 시작 앞에 무장된다(동기 오류 뒤 남는 타이머 없음)`() {
        session.toggle()
        port.support!!(RecognizerSupport.Installed)
        port.onStart = { port.listener.onError(SpeechRecognizer.ERROR_AUDIO) }
        effects.fire(INTERRUPT_SETTLE_MS)
        assertTrue(effects.timers.isEmpty())
    }

    @Test fun `타이머 취소가 먹지 않아도 세대·국면 확인이 옛 타이머를 무해하게 만든다`() {
        val port2 = FakePort()
        val effects2 = FakeEffects(ignoreCancel = true)
        val got = ArrayList<String>()
        val s2 = DictationSession(port2, effects2, { "ko-KR" }, { got += it }, {})
        s2.toggle(); port2.support!!(RecognizerSupport.Installed)
        effects2.fire(SUPPORT_CHECK_TIMEOUT_MS) // 응답이 온 뒤의 지원 조회 상한 — 청취를 끊지 않는다
        assertEquals(DictationPhase.Listening, s2.phase.value)
        effects2.fire(INTERRUPT_SETTLE_MS); port2.listener.onReady(); port2.listener.onSegment("첫")
        s2.toggle(); port2.listener.onEnd(null)
        assertEquals(listOf("첫"), got)

        s2.toggle(); port2.support!!(RecognizerSupport.Installed); effects2.fire(INTERRUPT_SETTLE_MS)
        port2.listener.onReady(); port2.listener.onSegment("둘")
        effects2.fire(STOP_FINALIZE_TIMEOUT_MS) // 첫 세션의 옛 상한
        effects2.fire(LISTEN_CAP_MS) // 첫 세션의 옛 캡
        assertEquals(DictationPhase.Listening, s2.phase.value)
        assertEquals(listOf("첫"), got)
        s2.toggle(); port2.listener.onEnd(null)
        assertEquals(listOf("첫", "둘"), got)
    }

    @Test fun `dispose는 취소하고 효과를 해제한다`() {
        listen()
        session.dispose()
        assertEquals(DictationPhase.Idle, session.phase.value)
        assertEquals(1, port.cancels)
        assertEquals(1, effects.releases)
        assertTrue(effects.timers.isEmpty())
    }
}
