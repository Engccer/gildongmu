package space.dodoplanet.gildongmu.audio

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaDataSource
import android.media.MediaPlayer
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import space.dodoplanet.gildongmu.kit.ListenSpeed
import space.dodoplanet.gildongmu.kit.MarkdownPlainText
import space.dodoplanet.gildongmu.speech.speechLanguageTag
import java.util.Locale

/** 기기 음성 합성 포트(JVM 테스트는 페이크). 콜백은 전부 메인 스레드. */
interface ChatSpeechPort {
    /** 엔진 준비(멱등). 실패(엔진 없음)는 false. */
    fun prepare(onReady: (Boolean) -> Unit)

    /** 준비 뒤 — 이 언어 태그의 보이스가 기기에 있는가(없으면 서버 음성으로 간다). */
    fun hasVoice(tag: String): Boolean

    /** 발화 시작(직전 발화는 끊는다). 끝나면 `onDone(failed)` 한 번 — 호출부가 세대로 늦은 콜백을 거른다. 시작 자체가 실패하면 false. */
    fun speak(text: String, tag: String, rate: Float, onDone: (failed: Boolean) -> Unit): Boolean

    fun stop()
}

/** 서버 MP3 재생 포트. 끝나면 `onDone(failed)` 한 번. */
interface ChatClipPort {
    fun play(mp3: ByteArray, speed: Float, onDone: (failed: Boolean) -> Unit): Boolean

    fun stop()
}

/** 채팅 듣기 전용 오디오 포커스(도보 안내 `GuideAudioFocus`와 다른 핸들). 잃으면 `onLost(duckOnly)`(메인) — `duckOnly`는 "잠깐 소리를 줄여 달라"(CAN_DUCK)다. */
interface ChatFocusPort {
    fun acquire(onLost: (duckOnly: Boolean) -> Unit): Boolean

    fun release()
}

/**
 * 채팅 답변 [듣기] 단일 진입점(iOS `TtsPlayer.playMessage`·웹 `useTtsPlayback` 미러). 앱에 하나(`ChatServices`) — 탭·장소 채팅이 같은 재생 1개를 본다.
 * - 입력은 마크다운 원문이고 여기서 `MarkdownPlainText.strip`으로 평문화한다. 같은 id 재호출은 정지 토글, 다른 id는 교체.
 * - 기기 음성이 정본이고, 현재 앱 언어의 보이스가 기기에 없을 때만 `POST /api/tts`(과금) MP3로 간다. 서버까지 실패하면 `onFailed`
 *   (웹 계약 — 로케일 보이스 없는 엔진으로 다른 언어를 읽히면 알아들을 수 없어 iOS의 기본 보이스 최후 낭독은 옮기지 않는다).
 * - 배속은 재생 시점에 읽는다: 기기 음성은 시스템 기본 속도 × 배율(1배 = 사용자가 둔 시스템 속도 — iOS 캘리브레이션 표의 "1배 = 기본 속도"와 같은 뜻),
 *   서버 MP3는 `PlaybackParams.speed`에 배율 그대로.
 * - 안내 우선: 자기 오디오 포커스를 쥐고 잃으면 정지한다(iOS `speakGuidance`의 `stop()` 동형). 단 "잠깐 줄여 달라"(CAN_DUCK)는 **도보 안내 세션이 살아 있을
 *   때만** 정지 사유다 — TalkBack도 오디오 덕킹(기본 켬)으로 말할 때마다 같은 요청을 보내므로, 그것까지 멈추면 SR 사용자는 스와이프 한 번에 낭독을 잃는다.
 *   안내와 TalkBack은 요청 종류로 구분되지 않아(둘 다 GAIN_TRANSIENT_MAY_DUCK) 세션 활성이 판별선이다.
 * - 늦은 콜백·늦은 서버 응답은 세대(`generation`)로 거른다. ⚠ 메인 스레드 전용.
 */
class ChatTtsPlayer(
    private val speech: ChatSpeechPort,
    private val clip: ChatClipPort,
    private val focus: ChatFocusPort,
    private val fetchServer: suspend (text: String, locale: String) -> ByteArray,
    private val scope: CoroutineScope,
    /** 저장된 배율(`ListenSpeed.storageKey`). */
    private val speed: () -> Double,
    /** 앱 언어 코드(`ko`·`en`…) — 서버 요청 `locale`과 음성 태그의 원천. */
    private val appLanguage: () -> String,
    /** 시스템 TTS 기본 속도(1.0 = 보통). */
    private val systemRate: () -> Float = { 1f },
    /** 도보 안내 세션이 살아 있는가(`GuideSession.isActive`) — CAN_DUCK 상실을 정지로 볼지의 판별선. */
    private val guideActive: () -> Boolean = { false },
) {
    private val _playingId = MutableStateFlow<Long?>(null)

    /** 재생(서버 왕복 포함) 중인 메시지 id — 버튼 라벨 전환(듣기 ↔ 재생 중지)의 유일한 원천. */
    val playingId: StateFlow<Long?> = _playingId.asStateFlow()

    private var generation = 0
    private var serverJob: Job? = null
    /** 마지막 서버 MP3 한 칸(iOS `audioCache` 축소판) — 같은 답변을 멈췄다 다시 들을 때 과금 호출을 되풀이하지 않는다. */
    private var cachedMp3: Pair<Long, ByteArray>? = null

    /** 같은 id면 정지, 아니면 기존 재생을 끊고 이 답변을 읽는다. 실패(포커스 거절·서버 실패·합성 오류)는 `onFailed` 한 번. */
    fun toggle(id: Long, markdown: String, onFailed: () -> Unit) {
        if (_playingId.value == id) {
            stop()
            return
        }
        stop()
        val text = MarkdownPlainText.strip(markdown)
        if (text.isEmpty()) return
        val gen = generation
        _playingId.value = id
        if (!focus.acquire(onLost = { duckOnly -> if (gen == generation && (!duckOnly || guideActive())) stop() })) {
            finish(gen, failed = true, onFailed)
            return
        }
        val speedValue = ListenSpeed.normalizeSpeed(speed())
        val lang = appLanguage()
        val tag = speechLanguageTag(lang) // iOS `AppLanguage.speechLocaleIdentifier`(받아쓰기와 같은 표)
        speech.prepare { ready ->
            if (gen != generation) return@prepare
            if (ready && speech.hasVoice(tag)) {
                val started = speech.speak(text, tag, systemRate() * speedValue.toFloat()) { failed -> finish(gen, failed, onFailed) }
                if (!started) finish(gen, failed = true, onFailed)
            } else {
                serverJob = scope.launch {
                    val mp3 = cachedMp3?.takeIf { it.first == id }?.second ?: try {
                        fetchServer(text, lang).also { cachedMp3 = id to it }
                    } catch (e: CancellationException) {
                        throw e
                    } catch (_: Exception) { // 네트워크·비-2xx·502 fallback 전부 — 통지가 유일한 증거다
                        finish(gen, failed = true, onFailed)
                        return@launch
                    }
                    if (gen != generation) return@launch
                    if (!clip.play(mp3, speedValue.toFloat()) { failed -> finish(gen, failed, onFailed) }) finish(gen, failed = true, onFailed)
                }
            }
        }
    }

    /** 화면 이탈·전송·받아쓰기 시작·포커스 상실. 재생이 없으면 아무 일도 없다(세대만 오른다). */
    fun stop() {
        generation++
        serverJob?.cancel()
        serverJob = null
        speech.stop()
        clip.stop()
        focus.release()
        _playingId.value = null
    }

    private fun finish(gen: Int, failed: Boolean, onFailed: () -> Unit) {
        if (gen != generation) return
        generation++ // 같은 세대의 두 번째 콜백(오류 뒤 onStop 류)을 거른다
        serverJob = null
        if (failed) {
            // 긴 답변의 한 조각이 실패해도 남은 조각이 큐에서 계속 읽히지 않게(실패 통지 뒤 소리가 이어지면 멈출 수단이 없다)
            speech.stop()
            clip.stop()
        }
        focus.release()
        _playingId.value = null
        if (failed) onFailed()
    }
}

/**
 * 엔진 입력 상한(`TextToSpeech.getMaxSpeechInputLength`, 보통 4000자)에 맞춘 분할(순수). 줄바꿈 경계에서 탐욕적으로 묶고, 한 줄이 상한을 넘으면
 * 공백 경계, 그것도 없으면 상한에서 자르되 서로게이트 쌍은 가르지 않는다. 경계 문자는 앞 조각에 남기고 공백만 남은 조각은 버린다.
 */
fun chunkForSpeech(text: String, max: Int): List<String> {
    require(max > 0)
    val out = ArrayList<String>()
    var rest = text
    while (rest.length > max) {
        val window = rest.substring(0, max)
        var cut = (window.lastIndexOf('\n').takeIf { it > 0 } ?: window.lastIndexOf(' ').takeIf { it > 0 })?.plus(1) ?: max
        if (cut > 1 && Character.isLowSurrogate(rest[cut]) && Character.isHighSurrogate(rest[cut - 1])) cut--
        out += rest.substring(0, cut)
        rest = rest.substring(cut)
    }
    if (rest.isNotEmpty()) out += rest
    return out.filter { it.isNotBlank() }
}

/**
 * 채팅 재생의 오디오 속성 — `USAGE_MEDIA`(TalkBack은 ASSISTANT·NAVIGATION_GUIDANCE 재생 시작에 발화를 끊는다, 효과음과 같은 이유).
 * 지연 생성: 파일 클래스 초기화에서 플랫폼 API를 부르면 같은 파일의 순수 함수를 쓰는 JVM 테스트가 깨진다.
 */
private val CHAT_AUDIO: AudioAttributes by lazy {
    AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()
}

/**
 * 엔진 콜백이 지금 재생을 끝내는가(순수). 발화 id는 `chat-<묶음>-<조각>`이고 **콜백 인자의 id**로만 가른다 — 옛 묶음(교체·정지로 끊긴 발화)의
 * `onStop`·`onError`는 비동기로 늦게 와서 그때의 "현재" 값을 읽으면 새 재생을 끝내 버린다. 오류·중단은 조각과 무관하게 끝, 정상 완료는 마지막 조각만.
 */
fun chatUtteranceEnds(utteranceId: String?, batch: Int, lastIndex: Int, ended: Boolean): Boolean {
    val prefix = "chat-$batch-"
    if (utteranceId == null || !utteranceId.startsWith(prefix)) return false
    val index = utteranceId.removePrefix(prefix).toIntOrNull() ?: return false
    return ended || index == lastIndex
}

/** 플랫폼 포트 — 채팅 전용 `TextToSpeech`(도보 안내 엔진과 따로, 한 엔진의 `QUEUE_FLUSH`가 서로를 끊지 않게). 긴 답변은 `chunkForSpeech`로 나눠 큐에 잇는다. */
class AndroidChatSpeech(private val context: Context) : ChatSpeechPort {
    private val main = Handler(Looper.getMainLooper())
    private var tts: TextToSpeech? = null
    private var ready = false
    private val waiting = ArrayList<(Boolean) -> Unit>()
    /** 현재 발화 묶음 번호·마지막 조각·완료 콜백 — 메인 스레드에서만 읽고 쓴다(엔진 콜백은 id만 들고 메인으로 넘어온다). */
    private var batch = 0
    private var lastIndex = 0
    private var done: ((Boolean) -> Unit)? = null

    override fun prepare(onReady: (Boolean) -> Unit) {
        if (ready) { onReady(true); return }
        waiting += onReady
        if (tts != null) return
        var engine: TextToSpeech? = null
        engine = TextToSpeech(context.applicationContext) { status ->
            val ok = status == TextToSpeech.SUCCESS
            main.post {
                if (ok) {
                    engine?.setAudioAttributes(CHAT_AUDIO)
                    engine?.setOnUtteranceProgressListener(listener)
                } else {
                    // 실패는 캐시하지 않는다 — 다음 [듣기]가 다시 시도한다(엔진을 나중에 설치·활성화한 경우)
                    engine?.shutdown()
                    tts = null
                }
                ready = ok
                val callbacks = waiting.toList()
                waiting.clear()
                callbacks.forEach { it(ok) }
            }
        }
        tts = engine
    }

    override fun hasVoice(tag: String): Boolean {
        val result = tts?.isLanguageAvailable(Locale.forLanguageTag(tag)) ?: return false
        return result >= TextToSpeech.LANG_AVAILABLE
    }

    override fun speak(text: String, tag: String, rate: Float, onDone: (Boolean) -> Unit): Boolean {
        val engine = tts ?: return false
        val lang = engine.setLanguage(Locale.forLanguageTag(tag))
        if (lang == TextToSpeech.LANG_MISSING_DATA || lang == TextToSpeech.LANG_NOT_SUPPORTED) return false
        engine.setSpeechRate(rate)
        val chunks = chunkForSpeech(text, TextToSpeech.getMaxSpeechInputLength())
        batch++
        lastIndex = chunks.lastIndex
        done = onDone
        chunks.forEachIndexed { i, chunk ->
            val mode = if (i == 0) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD
            if (engine.speak(chunk, mode, Bundle(), "chat-$batch-$i") != TextToSpeech.SUCCESS) {
                done = null
                engine.stop()
                return false
            }
        }
        return true
    }

    override fun stop() {
        done = null
        tts?.stop()
    }

    private fun deliver(id: String?, ended: Boolean, failed: Boolean) {
        main.post {
            if (!chatUtteranceEnds(id, batch, lastIndex, ended)) return@post
            val callback = done ?: return@post
            done = null
            callback(failed)
        }
    }

    private val listener = object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String?) = Unit
        override fun onDone(utteranceId: String?) = deliver(utteranceId, ended = false, failed = false)
        @Deprecated("플랫폼 시그니처")
        override fun onError(utteranceId: String?) = deliver(utteranceId, ended = true, failed = true)
        override fun onError(utteranceId: String?, errorCode: Int) = deliver(utteranceId, ended = true, failed = true)
        // 현재 묶음의 중단은 엔진 쪽 중단(우리 정지·교체는 묶음 번호가 이미 바뀌었다) — 실패가 아니라 끝으로 본다
        override fun onStop(utteranceId: String?, interrupted: Boolean) = deliver(utteranceId, ended = true, failed = false)
    }
}

/** 플랫폼 포트 — 서버 MP3를 메모리에서 `MediaPlayer`로. 배속은 준비 뒤 `PlaybackParams.speed`(준비된 플레이어에 속도를 주면 재생이 시작된다). */
class AndroidChatClip : ChatClipPort {
    private var player: MediaPlayer? = null

    override fun play(mp3: ByteArray, speed: Float, onDone: (Boolean) -> Unit): Boolean {
        stop()
        val mp = MediaPlayer()
        player = mp
        return try {
            mp.setAudioAttributes(CHAT_AUDIO)
            mp.setDataSource(ByteArrayMediaSource(mp3))
            mp.setOnPreparedListener {
                if (player !== it) return@setOnPreparedListener
                // 기기가 이 속도를 거부하면(IllegalArgument·IllegalState) 크래시 대신 실패로
                val started = runCatching {
                    it.playbackParams = it.playbackParams.setSpeed(speed)
                    if (!it.isPlaying) it.start()
                }
                if (started.isFailure) { stop(); onDone(true) }
            }
            mp.setOnCompletionListener { if (player === it) { stop(); onDone(false) } }
            mp.setOnErrorListener { p, _, _ -> if (player === p) { stop(); onDone(true) }; true }
            mp.prepareAsync()
            true
        } catch (e: Exception) {
            Log.w("ChatTtsPlayer", "MP3 재생 준비 실패", e)
            stop()
            false
        }
    }

    override fun stop() {
        val mp = player ?: return
        player = null
        mp.release()
    }
}

private class ByteArrayMediaSource(private val data: ByteArray) : MediaDataSource() {
    override fun readAt(position: Long, buffer: ByteArray, offset: Int, size: Int): Int {
        if (position >= data.size) return -1
        val count = minOf(size.toLong(), data.size - position).toInt()
        System.arraycopy(data, position.toInt(), buffer, offset, count)
        return count
    }

    override fun getSize(): Long = data.size.toLong()

    override fun close() = Unit
}

/**
 * 플랫폼 포트 — `AUDIOFOCUS_GAIN_TRANSIENT`(음악은 멈춘다) + `setWillPauseWhenDucked(true)`: 자동 덕킹이면 앱에 알리지 않는데, TTS 소리는 엔진
 * 프로세스라 덕킹도 안 된다 — 알림을 받아 멈추는 것이 안내 우선의 유일한 경로다.
 */
class AndroidChatFocus(private val audioManager: AudioManager) : ChatFocusPort {
    private val main = Handler(Looper.getMainLooper())
    private var current: AudioFocusRequest? = null

    override fun acquire(onLost: (duckOnly: Boolean) -> Unit): Boolean {
        release()
        val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
            .setAudioAttributes(CHAT_AUDIO)
            .setWillPauseWhenDucked(true)
            .setOnAudioFocusChangeListener({ change ->
                if (change < 0) onLost(change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK)
            }, main)
            .build()
        val granted = audioManager.requestAudioFocus(req) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        current = req.takeIf { granted }
        return granted
    }

    override fun release() {
        val req = current ?: return
        current = null
        audioManager.abandonAudioFocusRequest(req)
    }
}

/** 시스템 TTS 기본 속도(설정 → 텍스트 음성 변환 속도, 100 = 보통). 사용자가 빠르게 둔 속도를 1배의 기준으로 삼는다. */
fun systemTtsRate(context: Context): Float =
    Settings.Secure.getInt(context.contentResolver, Settings.Secure.TTS_DEFAULT_RATE, 100) / 100f
