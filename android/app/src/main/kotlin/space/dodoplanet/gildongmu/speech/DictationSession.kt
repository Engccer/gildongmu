package space.dodoplanet.gildongmu.speech

import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.ModelDownloadListener
import android.speech.RecognitionListener
import android.speech.RecognitionSupport
import android.speech.RecognitionSupportCallback
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.view.accessibility.AccessibilityManager
import androidx.annotation.RequiresApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import space.dodoplanet.gildongmu.kit.hasSpeechContent
import java.util.Locale

// 받아쓰기 세션(M6 spec §6, 코디네이터 승인 — `speech/`에 새 파일만). 채팅이 첫 소비자이고 검색·길찾기 마이크가 재사용한다.
// 온디바이스 인식기만 쓴다 — 개인정보 신고 "오디오 미수집"이 이 한 줄에 걸린다(서버 인식 폴백 금지, iOS `requiresOnDeviceRecognition`과 같은 층).

/** 앱 언어 → 인식 언어 태그(iOS `AppLanguage.speechLocaleIdentifier` 미러, 자동 감지 금지). */
fun speechLanguageTag(appLang: String): String = when (appLang) {
    "en" -> "en-US"
    "es" -> "es-ES"
    "fr" -> "fr-FR"
    "it" -> "it-IT"
    "ja" -> "ja-JP"
    else -> "ko-KR"
}

enum class RecognizerSupport { Installed, NeedsDownload, Unsupported, Unknown }

enum class DownloadResult { Ready, Scheduled, Failed }

/** 지원 목록 판정. 표기(`ko-KR`·`ko_KR`·`ko`)가 섞여 오므로 언어+지역으로 정규화한다 — 표기 불일치가 "지원하는데 미지원"으로 위장하지 않게. */
fun supportDecision(tag: String, installed: List<String>, supported: List<String>, pending: List<String>): RecognizerSupport {
    val target = Locale.forLanguageTag(tag)
    fun matches(list: List<String>) = list.any { raw ->
        val candidate = Locale.forLanguageTag(raw.replace('_', '-'))
        candidate.language == target.language && (candidate.country.isEmpty() || target.country.isEmpty() || candidate.country == target.country)
    }
    return when {
        matches(installed) -> RecognizerSupport.Installed
        matches(supported) || matches(pending) -> RecognizerSupport.NeedsDownload
        else -> RecognizerSupport.Unsupported
    }
}

enum class DictationFailure { StartFailed, Interrupted, Locale, OnDevice, Audio }

sealed class DictationErrorOutcome {
    /** 정상 종결(누적분 전달). */
    data object Finish : DictationErrorOutcome()
    data object Denied : DictationErrorOutcome()
    data class Fail(val kind: DictationFailure) : DictationErrorOutcome()
}

/** 인식기 오류 코드 판정. `listening` = 인식기가 준비 신호를 보냈다(마이크가 켜졌다) — 시작 실패와 도중 끊김의 문장이 다르다. */
fun dictationErrorOutcome(code: Int, stopping: Boolean, listening: Boolean): DictationErrorOutcome = when {
    code == SpeechRecognizer.ERROR_NO_MATCH || code == SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> DictationErrorOutcome.Finish
    code == SpeechRecognizer.ERROR_CLIENT && stopping -> DictationErrorOutcome.Finish
    code == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> DictationErrorOutcome.Denied
    code == SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED -> DictationErrorOutcome.Fail(DictationFailure.Locale)
    code == SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> DictationErrorOutcome.Fail(DictationFailure.OnDevice)
    code == SpeechRecognizer.ERROR_AUDIO || code == SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> DictationErrorOutcome.Fail(DictationFailure.Audio)
    else -> DictationErrorOutcome.Fail(if (listening) DictationFailure.Interrupted else DictationFailure.StartFailed)
}

sealed class DictationPhase {
    data object Idle : DictationPhase()
    /** 지원 조회 중(짧다). 라벨은 "받아쓰기 시작" 그대로라 탭은 무시한다. */
    data object Starting : DictationPhase()
    /** 인식 모델 다운로드 대기(수십 초~분). 라벨 "음성 인식 준비 중"이 신호, 마이크 없음. 끝나도 청취로 넘어가지 않는다. */
    data object Preparing : DictationPhase()
    /** 라벨 "받아쓰기 중지". */
    data object Listening : DictationPhase()
    /** 권한 거부 — 화면이 설정 열기 버튼을 세운다. */
    data object Denied : DictationPhase()
}

sealed class DictationNotice {
    /** 다운로드가 예약만 됐다 — 잠시 뒤 다시 누르면 된다. */
    data object DownloadRequested : DictationNotice()
    /** 다운로드가 끝났다 — 다시 누르면 받아쓴다(수 분 뒤 사용자 의사 없이 마이크를 켜지 않는다). */
    data object DownloadReady : DictationNotice()
    data object DownloadFailed : DictationNotice()
    data object Denied : DictationNotice()
    data class Failure(val kind: DictationFailure) : DictationNotice()
}

interface RecognizerListener {
    fun onReady()
    fun onSegment(text: String)
    /** 세션 끝. 분할 모드면 null(누적분이 결과), 분할 미지원 구현이면 최종 후보. */
    fun onEnd(finalText: String?)
    fun onError(code: Int)
}

/** 인식기 포트(세션 상태 머신이 JVM에서 가짜 인식기로 돈다, 콜백은 메인 스레드) — 계약: `cancel` 뒤 리스너 콜백 0(어댑터는 `destroy`로 보장하고, 세션의 세대 확인이 이중 방어). */
interface RecognizerPort {
    fun checkSupport(languageTag: String, onResult: (RecognizerSupport) -> Unit)
    fun download(languageTag: String, onResult: (DownloadResult) -> Unit)
    fun start(languageTag: String, listener: RecognizerListener)
    fun stop()
    /** 인식기 취소 + 해제(없으면 무시). */
    fun cancel()
}

interface DictationEffects {
    fun startTone()
    fun stopTone()
    /** 진행 중 스크린 리더 낭독 끊기. 접근성 서비스가 꺼져 있으면 아무것도 하지 않는다(꺼진 기기에서 부르면 크래시). */
    fun interruptScreenReader()
    /** 메인 스레드 지연 실행. 반환값은 취소. */
    fun postDelayed(ms: Long, block: () -> Unit): () -> Unit
    fun release()
}

/** 라벨 변경("받아쓰기 중지") 낭독이 시작될 틈 — 그 뒤에 끊고 마이크를 켠다(두 프레임을 넉넉히 포함). */
const val INTERRUPT_SETTLE_MS = 150L

/** 정지 뒤 인식기 종결 콜백을 기다리는 상한 — 콜백을 내지 않는 구현에서 "중지"에 갇히지 않게. */
const val STOP_FINALIZE_TIMEOUT_MS = 3_000L

/** 한 세션 청취 상한 — 분할 세션을 요청하므로 무기한 청취를 막는다. 도달하면 정지와 같다(자동 전송 없음). */
const val LISTEN_CAP_MS = 60_000L

/**
 * 받아쓰기 세션(탭 토글, 헌장 §6 ⓐ). 결과는 [onTranscript] **단일 채널**(수동 정지·캡·상한 만료·인식기 자체 종료 공통),
 * 실패·준비 안내는 [onNotice]. 모든 인식기 콜백은 시작 시점의 세대를 확인한다 — 취소·재시작 사이의 늦은 콜백이 새 세션을 건드리지 못한다.
 */
class DictationSession(
    private val port: RecognizerPort,
    private val effects: DictationEffects,
    private val languageTag: () -> String,
    private val onTranscript: (String) -> Unit,
    private val onNotice: (DictationNotice) -> Unit,
) {
    private val _phase = MutableStateFlow<DictationPhase>(DictationPhase.Idle)
    val phase: StateFlow<DictationPhase> = _phase.asStateFlow()

    private val _isActive = MutableStateFlow(false)

    /** 지원 조회·청취 중(마이크가 켜졌거나 곧 켜진다) — 화면이 통지·완료 착지를 보류하는 조건(녹음 중 스크린 리더 발화 0). 다운로드 대기는 제외. */
    val isActive: StateFlow<Boolean> = _isActive.asStateFlow()

    private var generation = 0
    private var portStarted = false
    private var ready = false
    private var stopping = false
    private var stopTonePlayed = false
    private var releaseWhenIdle = false
    private val segments = ArrayList<String>()
    private val timers = ArrayList<() -> Unit>()

    /** 버튼 한 번. 청취 중이면 정지(정지 중이면 무시), 다운로드 대기면 취소, 지원 조회 중이면 무시, 그 밖이면 시작. */
    fun toggle() {
        when (_phase.value) {
            DictationPhase.Listening -> stop()
            DictationPhase.Preparing -> cancel()
            DictationPhase.Starting -> Unit
            DictationPhase.Idle, DictationPhase.Denied -> start()
        }
    }

    /** 결과 없이 폐기(화면 이탈 등). 전달·통지·소리 없음. */
    fun cancel() {
        generation += 1
        val hadSession = _phase.value != DictationPhase.Idle && _phase.value != DictationPhase.Denied
        clearTimers()
        if (hadSession) port.cancel()
        resetSession()
        setPhase(DictationPhase.Idle)
        releaseIfDetached()
    }

    private fun releaseIfDetached() {
        if (!releaseWhenIdle) return
        releaseWhenIdle = false
        effects.release()
    }

    fun markDenied() {
        cancel()
        setPhase(DictationPhase.Denied)
        onNotice(DictationNotice.Denied)
    }

    /** 화면 이탈(탭 전환·pop): 취소 + 효과 해제. */
    fun dispose() {
        cancel()
        effects.release()
    }

    /**
     * 구성 변경(회전 등 Activity 재생성): 청취 중이면 취소 대신 **정상 정지 경로**로 누적분을 전달하고(전달 콜백은 살아남는 ViewModel 초안에
     * 병합된다) 끝나면 효과를 해제한다. 청취 전이면 [dispose]와 같다.
     */
    fun detach() {
        if (_phase.value == DictationPhase.Listening && portStarted) {
            releaseWhenIdle = true
            stop()
        } else {
            dispose()
        }
    }

    private fun start() {
        generation += 1
        val gen = generation
        resetSession()
        setPhase(DictationPhase.Starting)
        val tag = languageTag()
        port.checkSupport(tag) { support ->
            if (gen != generation) return@checkSupport
            when (support) {
                RecognizerSupport.Installed, RecognizerSupport.Unknown -> beginListening(gen, tag)
                RecognizerSupport.NeedsDownload -> {
                    setPhase(DictationPhase.Preparing)
                    port.download(tag) { result ->
                        if (gen != generation) return@download
                        when (result) {
                            DownloadResult.Ready -> endWithNotice(DictationNotice.DownloadReady)
                            DownloadResult.Scheduled -> endWithNotice(DictationNotice.DownloadRequested)
                            DownloadResult.Failed -> endWithNotice(DictationNotice.DownloadFailed)
                        }
                    }
                }
                RecognizerSupport.Unsupported -> endWithNotice(DictationNotice.Failure(DictationFailure.OnDevice))
            }
        }
    }

    private fun beginListening(gen: Int, tag: String) {
        setPhase(DictationPhase.Listening)
        timers += effects.postDelayed(INTERRUPT_SETTLE_MS) {
            if (gen != generation) return@postDelayed
            effects.interruptScreenReader()
            portStarted = true
            port.start(tag, listener(gen))
            timers += effects.postDelayed(LISTEN_CAP_MS) { if (gen == generation) stop() }
        }
    }

    private fun stop() {
        if (_phase.value != DictationPhase.Listening || stopping) return
        if (!portStarted) {
            cancel() // 마이크가 켜지기 전 — 받은 것이 없다
            return
        }
        val gen = generation
        stopping = true
        playStopToneOnce()
        // 상한을 먼저 무장한다 — 정지 즉시 종결 콜백을 내는 구현이면 종결이 이 타이머까지 해제한다
        timers += effects.postDelayed(STOP_FINALIZE_TIMEOUT_MS) { if (gen == generation) finish(accumulated(null)) }
        port.stop()
    }

    private fun listener(gen: Int) = object : RecognizerListener {
        override fun onReady() {
            if (gen != generation || ready) return // 구현이 반복 호출해도 세션당 1회
            ready = true
            effects.interruptScreenReader()
            effects.startTone()
        }

        override fun onSegment(text: String) {
            if (gen != generation) return
            segments += text
        }

        override fun onEnd(finalText: String?) {
            if (gen != generation) return
            finish(accumulated(finalText))
        }

        override fun onError(code: Int) {
            if (gen != generation) return
            when (val outcome = dictationErrorOutcome(code, stopping, ready)) {
                DictationErrorOutcome.Finish -> finish(accumulated(null))
                DictationErrorOutcome.Denied -> {
                    teardown()
                    setPhase(DictationPhase.Denied)
                    onNotice(DictationNotice.Denied)
                }
                is DictationErrorOutcome.Fail -> {
                    val text = accumulated(null)
                    teardown()
                    setPhase(DictationPhase.Idle)
                    // 받아쓴 것이 있으면 오류 하나로 잃지 않는다 — 전사 통지가 결과이고 소리가 끝 신호다
                    if (!deliver(text)) onNotice(DictationNotice.Failure(outcome.kind))
                }
            }
        }
    }

    /** 종결은 한 곳: 끝소리 1회(마이크가 켜졌던 세션만) → 인식기 해제 → Idle → 발화가 담긴 전사만 전달. */
    private fun finish(text: String?) {
        teardown()
        setPhase(DictationPhase.Idle)
        deliver(text)
    }

    private fun teardown() {
        if (ready) playStopToneOnce()
        generation += 1
        clearTimers()
        port.cancel()
        resetSession()
        releaseIfDetached()
    }

    private fun deliver(text: String?): Boolean {
        val trimmed = text?.trim().orEmpty()
        if (!hasSpeechContent(trimmed)) return false
        onTranscript(trimmed)
        return true
    }

    private fun endWithNotice(notice: DictationNotice) {
        generation += 1
        clearTimers()
        resetSession()
        setPhase(DictationPhase.Idle)
        onNotice(notice)
    }

    private fun accumulated(finalText: String?): String? =
        if (segments.isNotEmpty()) segments.joinToString(" ") else finalText

    private fun playStopToneOnce() {
        if (stopTonePlayed) return
        stopTonePlayed = true
        effects.stopTone()
    }

    private fun clearTimers() {
        timers.forEach { it() }
        timers.clear()
    }

    private fun resetSession() {
        portStarted = false
        ready = false
        stopping = false
        stopTonePlayed = false
        segments.clear()
    }

    private fun setPhase(phase: DictationPhase) {
        _phase.value = phase
        _isActive.value = phase == DictationPhase.Starting || phase == DictationPhase.Listening
    }
}

/**
 * 받아쓰기 세션 생성의 유일한 자리(D9 게이트 — API 33 미만·온디바이스 인식 불가면 null = 버튼 0).
 * `Build.VERSION.SDK_INT` 분기는 린트가 API 33 전용 호출을 보증받는 형태다(`Dictation.isAvailable`과 같은 선).
 */
fun dictationSessionOrNull(
    context: Context,
    languageTag: () -> String,
    onTranscript: (String) -> Unit,
    onNotice: (DictationNotice) -> Unit,
): DictationSession? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || !Dictation.isAvailable(context)) return null
    val app = context.applicationContext
    return DictationSession(AndroidRecognizerPort(app), AndroidDictationEffects(app), languageTag, onTranscript, onNotice)
}

@RequiresApi(Build.VERSION_CODES.TIRAMISU)
private class AndroidRecognizerPort(private val context: Context) : RecognizerPort {
    private var recognizer: SpeechRecognizer? = null

    private fun obtain(): SpeechRecognizer =
        recognizer ?: SpeechRecognizer.createOnDeviceSpeechRecognizer(context).also { recognizer = it }

    private fun intent(tag: String) = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
        .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        .putExtra(RecognizerIntent.EXTRA_LANGUAGE, tag)

    override fun checkSupport(languageTag: String, onResult: (RecognizerSupport) -> Unit) {
        obtain().checkRecognitionSupport(intent(languageTag), context.mainExecutor, object : RecognitionSupportCallback {
            override fun onSupportResult(support: RecognitionSupport) = onResult(
                supportDecision(languageTag, support.installedOnDeviceLanguages, support.supportedOnDeviceLanguages, support.pendingOnDeviceLanguages),
            )

            override fun onError(error: Int) = onResult(RecognizerSupport.Unknown)
        })
    }

    override fun download(languageTag: String, onResult: (DownloadResult) -> Unit) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            obtain().triggerModelDownload(intent(languageTag), context.mainExecutor, object : ModelDownloadListener {
                override fun onProgress(completedPercent: Int) = Unit
                override fun onSuccess() = onResult(DownloadResult.Ready)
                override fun onScheduled() = onResult(DownloadResult.Scheduled)
                override fun onError(error: Int) = onResult(DownloadResult.Failed)
            })
        } else {
            // API 33은 완료 신호가 없다 — 요청만 걸고 "준비 중"(나중에 다시 누르면 된다)
            obtain().triggerModelDownload(intent(languageTag))
            onResult(DownloadResult.Scheduled)
        }
    }

    override fun start(languageTag: String, listener: RecognizerListener) {
        val r = obtain()
        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) = listener.onReady()
            override fun onBeginningOfSpeech() = Unit
            override fun onRmsChanged(rmsdB: Float) = Unit
            override fun onBufferReceived(buffer: ByteArray?) = Unit
            override fun onEndOfSpeech() = Unit
            override fun onError(error: Int) = listener.onError(error)
            override fun onResults(results: Bundle?) = listener.onEnd(first(results))
            override fun onPartialResults(partialResults: Bundle?) = Unit
            override fun onEvent(eventType: Int, params: Bundle?) = Unit
            override fun onSegmentResults(segmentResults: Bundle) {
                first(segmentResults)?.let(listener::onSegment)
            }

            override fun onEndOfSegmentedSession() = listener.onEnd(null)
        })
        // 분할 세션: 말을 멈춰도 정지를 누를 때까지 이어 받기를 요청한다(구현이 무시할 수 있음 — spec §8-10)
        r.startListening(
            intent(languageTag)
                .putExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION, RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS)
                .putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, LISTEN_CAP_MS.toInt()),
        )
    }

    override fun stop() {
        recognizer?.stopListening()
    }

    override fun cancel() {
        recognizer?.let {
            it.cancel()
            it.destroy()
        }
        recognizer = null
    }

    private fun first(bundle: Bundle?): String? = bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
}

private class AndroidDictationEffects(context: Context) : DictationEffects {
    private val app = context.applicationContext
    private val handler = Handler(Looper.getMainLooper())
    private var tones: ToneGenerator? = null

    /**
     * 시작·정지음. `STREAM_SYSTEM`(= 보조 효과음 용도) — TalkBack이 발화를 끊는 용도(안내·비서·알람)가 아니고, 새 음원 파일이 필요 없다.
     * 생성 실패(오디오 자원 부족)는 소리 없음으로 접는다(부가 신호).
     */
    private fun tone(type: Int) {
        val generator = tones ?: try {
            ToneGenerator(AudioManager.STREAM_SYSTEM, TONE_VOLUME).also { tones = it }
        } catch (e: RuntimeException) {
            null
        }
        generator?.startTone(type, TONE_MS)
    }

    override fun startTone() = tone(ToneGenerator.TONE_PROP_BEEP)

    override fun stopTone() = tone(ToneGenerator.TONE_PROP_ACK)

    override fun interruptScreenReader() {
        val manager = app.getSystemService(AccessibilityManager::class.java) ?: return
        if (manager.isEnabled) manager.interrupt()
    }

    override fun postDelayed(ms: Long, block: () -> Unit): () -> Unit {
        val runnable = Runnable(block)
        handler.postDelayed(runnable, ms)
        return { handler.removeCallbacks(runnable) }
    }

    override fun release() {
        tones?.release()
        tones = null
    }

    private companion object {
        const val TONE_VOLUME = 80
        const val TONE_MS = 150
    }
}
