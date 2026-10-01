package space.dodoplanet.gildongmu.audio

import android.content.Context
import android.media.AudioAttributes
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import space.dodoplanet.gildongmu.guide.GuideDiag
import space.dodoplanet.gildongmu.guide.GuideSpeaker
import space.dodoplanet.gildongmu.kit.DeviceSpeechDrop
import space.dodoplanet.gildongmu.kit.KeyValueStore
import space.dodoplanet.gildongmu.kit.ListenSpeed
import java.util.Locale

/** TTS 플랫폼 포트(JVM 테스트는 페이크). */
interface TtsPort {
    fun init(onReady: (Boolean) -> Unit)
    fun setLanguage(tag: String): Boolean
    fun setRate(rate: Float)
    fun speakFlush(text: String, utteranceId: String): Boolean
    fun setProgressListener(onDone: (String) -> Unit)
    fun stop()
}

/**
 * 발화 창구(spec §5-3). 안내 문장은 앱 TTS 한 채널이다 — 접근성 통지는 화면이 살아 있는 동안만 동작하고 한소네 리더가 TalkBack이
 * 아닐 수 있다. 초기화 전 문장은 최신 1개 보류(latest-wins), `speak`는 `QUEUE_FLUSH`(임박 명령이 전문 뒤에 줄 서지 않는다),
 * 포커스를 못 잡으면 내지 않는다, 반납은 **최신 utterance의 onDone**에서만(플러시된 옛 발화의 onStop이 새 발화 도중 반납하지
 * 않게). 배율은 `ListenSpeed.normalizeSpeed` 1.0이면 `setRate` 호출 없음(시스템 TTS 속도 — SR 사용자가 이미 빠르게 둔 값).
 * 낭독 정정(`spokenDistanceUnits`)은 모델 `post`가 지난다(호출부 한 곳).
 *
 * 발화마다 토큰(= utteranceId 수)을 돌려주고(E53 기기 음성 대기 칸의 "지금 이 칸의 문장" 판정), 아직 끝나지 않은 발화를 새 발화가 끊거나(`QUEUE_FLUSH`)
 * 초기화 전 보류 문장을 새 문장이 갈아 치우면 끊긴 토큰을 [onInterrupted]에 `superseded`로, 보류 문장이 초기화 실패로 버려지면 `undelivered`로 알린다
 * (iOS `TtsPlayer.observeGuidanceInterruption` 동형). 안드로이드 TTS엔 일시정지 상태가 없어 "말하는 중"과 "합성기에 남음"이 같다.
 */
class TtsGuideSpeaker(
    private val tts: TtsPort,
    private val focus: GuideAudioFocus,
    private val store: KeyValueStore,
    private val language: () -> String,
    /** 초기화 실패·언어 미지원으로 보류 문장을 버릴 때(호출부가 상환 장부를 세운다). */
    private val onPendingDropped: () -> Unit = {},
) : GuideSpeaker {
    private var ready = false
    private var preparing = false
    private var pending: Pair<String, Boolean>? = null
    /** 보류 문장의 토큰(준비되면 이 id로 말한다). */
    private var pendingToken: Int? = null
    private var seq = 0
    /** 지금 엔진에 남아 있는 최신 발화의 id — 그 id의 완료(onDone·onStop·onError)가 지운다. */
    private var speakingId: Int? = null

    override var isUnavailable = false
        private set

    /** 안내 문장이 말하는 중이거나 초기화를 기다리며 보류돼 있다(E57 착지 대기 — 끝은 발화 완료 콜백이 알린다). */
    override val isSpeaking: Boolean get() = speakingId != null || pending != null

    override fun stop() {
        if (speakingId == null) return
        speakingId = null
        tts.stop()
        focus.releaseAfter(0.15)
    }

    override fun isSpeakingToken(token: Int): Boolean = token == speakingId || token == pendingToken

    override var onInterrupted: ((token: Int, reason: DeviceSpeechDrop) -> Unit)? = null

    /** 보류 문장을 버린다(초기화 실패·언어 미지원). */
    private fun dropPending() {
        if (pending == null) return
        pending = null
        val token = pendingToken
        pendingToken = null
        onPendingDropped()
        token?.let { onInterrupted?.invoke(it, DeviceSpeechDrop.undelivered) }
    }

    override fun prepare() {
        if (ready || preparing || isUnavailable) return
        preparing = true
        tts.init { ok ->
            preparing = false
            if (!ok) {
                isUnavailable = true
                dropPending()
                GuideDiag.log("tts init failed")
                return@init
            }
            ready = true
            isUnavailable = !tts.setLanguage(language())
            if (isUnavailable) {
                GuideDiag.log("tts language unsupported ${language()}")
                dropPending()
                return@init
            }
            val rate = ListenSpeed.normalizeSpeed(store.getString(ListenSpeed.storageKey)?.toDoubleOrNull())
            if (rate != 1.0) tts.setRate(rate.toFloat())
            tts.setProgressListener { id ->
                if (id == speakingId?.toString()) {
                    speakingId = null
                    focus.releaseAfter(0.15)
                }
            }
            val held = pending
            val heldToken = pendingToken
            pending = null
            pendingToken = null
            if (held != null && heldToken != null && flush(held.first, held.second, heldToken) == null) onInterrupted?.invoke(heldToken, DeviceSpeechDrop.undelivered)
        }
    }

    /** 반환 = 발화 토큰(초기화 전 보류도 게시 예정이라 토큰). 언어 미지원·포커스 거절·엔진 실패는 null. */
    override fun speak(text: String, highPriority: Boolean): Int? {
        if (isUnavailable) return null
        if (!ready) {
            pendingToken?.let { onInterrupted?.invoke(it, DeviceSpeechDrop.superseded) } // 보류 1개(latest-wins) — 밀린 문장
            seq++
            pending = text to highPriority
            pendingToken = seq
            prepare()
            return seq
        }
        seq++
        return flush(text, highPriority, seq)
    }

    /** 엔진에 낸다(`QUEUE_FLUSH`) — 아직 끝나지 않은 직전 발화는 이 발화가 끊는다(끊긴 토큰을 알린다). */
    private fun flush(text: String, highPriority: Boolean, id: Int): Int? {
        if (!focus.acquire()) { GuideDiag.log("speech skipped focus"); return null }
        val cut = speakingId
        val ok = tts.speakFlush(text, id.toString())
        speakingId = null
        cut?.let { onInterrupted?.invoke(it, DeviceSpeechDrop.superseded) }
        if (!ok) { GuideDiag.log("speech failed id=$id"); focus.releaseAfter(0.15); return null }
        speakingId = id
        GuideDiag.log { "speak id=$id high=$highPriority len=${text.length}" }
        return id
    }
}

/** 플랫폼 포트 — 앱 수명 `TextToSpeech`. `onInit(SUCCESS)` 뒤 `setAudioAttributes(USAGE_MEDIA + CONTENT_TYPE_SPEECH)` 1회. 콜백은 메인 반입. */
class AndroidTtsPort(private val context: Context) : TtsPort {
    private val main = Handler(Looper.getMainLooper())
    private var tts: TextToSpeech? = null

    override fun init(onReady: (Boolean) -> Unit) {
        var engine: TextToSpeech? = null
        engine = TextToSpeech(context.applicationContext) { status ->
            val ok = status == TextToSpeech.SUCCESS
            if (ok) runCatching {
                engine?.setAudioAttributes(
                    AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build(),
                )
            }
            main.post { onReady(ok) }
        }
        tts = engine
    }

    override fun setLanguage(tag: String): Boolean {
        val result = tts?.setLanguage(Locale.forLanguageTag(tag)) ?: return false
        return result != TextToSpeech.LANG_MISSING_DATA && result != TextToSpeech.LANG_NOT_SUPPORTED
    }

    override fun setRate(rate: Float) { tts?.setSpeechRate(rate) }

    override fun stop() { tts?.stop() }

    override fun speakFlush(text: String, utteranceId: String): Boolean =
        tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, utteranceId) == TextToSpeech.SUCCESS

    override fun setProgressListener(onDone: (String) -> Unit) {
        tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) = Unit
            override fun onDone(utteranceId: String?) { utteranceId?.let { id -> main.post { onDone(id) } } }
            @Deprecated("플랫폼 시그니처")
            override fun onError(utteranceId: String?) { utteranceId?.let { id -> main.post { onDone(id) } } }
            override fun onError(utteranceId: String?, errorCode: Int) { utteranceId?.let { id -> main.post { onDone(id) } } }
            override fun onStop(utteranceId: String?, interrupted: Boolean) { utteranceId?.let { id -> main.post { onDone(id) } } }
        })
    }
}
