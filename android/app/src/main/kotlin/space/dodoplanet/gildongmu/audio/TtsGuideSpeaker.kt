package space.dodoplanet.gildongmu.audio

import android.content.Context
import android.media.AudioAttributes
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import space.dodoplanet.gildongmu.guide.GuideDiag
import space.dodoplanet.gildongmu.guide.GuideSpeaker
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
}

/**
 * 발화 창구(spec §5-3). 안내 문장은 앱 TTS 한 채널이다 — 접근성 통지는 화면이 살아 있는 동안만 동작하고 한소네 리더가 TalkBack이
 * 아닐 수 있다. 초기화 전 문장은 최신 1개 보류(latest-wins), `speak`는 `QUEUE_FLUSH`(임박 명령이 전문 뒤에 줄 서지 않는다),
 * 포커스를 못 잡으면 내지 않는다, 반납은 **최신 utterance의 onDone**에서만(플러시된 옛 발화의 onStop이 새 발화 도중 반납하지
 * 않게). 배율은 `ListenSpeed.normalizeSpeed` 1.0이면 `setRate` 호출 없음(시스템 TTS 속도 — SR 사용자가 이미 빠르게 둔 값).
 * 낭독 정정(`spokenDistanceUnits`)은 모델 `post`가 지난다(호출부 한 곳).
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
    private var seq = 0

    override var isUnavailable = false
        private set

    override fun prepare() {
        if (ready || preparing || isUnavailable) return
        preparing = true
        tts.init { ok ->
            preparing = false
            if (!ok) {
                isUnavailable = true
                if (pending != null) { pending = null; onPendingDropped() }
                GuideDiag.log("tts init failed")
                return@init
            }
            ready = true
            isUnavailable = !tts.setLanguage(language())
            if (isUnavailable) {
                GuideDiag.log("tts language unsupported ${language()}")
                if (pending != null) { pending = null; onPendingDropped() }
                return@init
            }
            val rate = ListenSpeed.normalizeSpeed(store.getString(ListenSpeed.storageKey)?.toDoubleOrNull())
            if (rate != 1.0) tts.setRate(rate.toFloat())
            tts.setProgressListener { id -> if (id == seq.toString()) focus.releaseAfter(0.15) }
            val held = pending
            pending = null
            if (held != null) speak(held.first, held.second)
        }
    }

    /** 반환 = 게시했는가(초기화 전 보류도 게시 예정이라 true). 언어 미지원·포커스 거절·엔진 실패는 false. */
    override fun speak(text: String, highPriority: Boolean): Boolean {
        if (isUnavailable) return false
        if (!ready) {
            pending = text to highPriority
            prepare()
            return true
        }
        if (!focus.acquire()) { GuideDiag.log("speech skipped focus"); return false }
        seq++
        val ok = tts.speakFlush(text, seq.toString())
        if (!ok) { GuideDiag.log("speech failed id=$seq"); focus.releaseAfter(0.15); return false }
        GuideDiag.log { "speak id=$seq high=$highPriority len=${text.length}" }
        return true
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
