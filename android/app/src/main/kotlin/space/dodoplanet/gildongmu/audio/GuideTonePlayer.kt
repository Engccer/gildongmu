package space.dodoplanet.gildongmu.audio

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.SoundPool
import space.dodoplanet.gildongmu.guide.GuideDiag
import space.dodoplanet.gildongmu.guide.GuideTones
import space.dodoplanet.gildongmu.kit.BeaconTone
import space.dodoplanet.gildongmu.kit.KeyValueStore
import space.dodoplanet.gildongmu.kit.LeftRightToneScheme
import space.dodoplanet.gildongmu.kit.TrendHaptics
import kotlin.math.max

/** 소리 플랫폼 포트(`SoundPool` 래핑, JVM 테스트는 페이크). `play` 반환 0 = 실패. */
interface SoundPort {
    fun load(resId: Int, onLoaded: () -> Unit)
    fun play(resId: Int, gain: Float): Int
    fun stop(streamId: Int)
    fun isLoaded(resId: Int): Boolean
}

fun interface VolumePort {
    fun isMediaVolumeZero(): Boolean
}

/**
 * 톤 재생기(spec §5-1, iOS `BeaconTonePlayer`의 안드로이드 판). `play` 순서가 계약: ① `toneEndsAt = null` ② 억제 ③ 진동(포커스 판정보다
 * 앞 — 소리가 죽는 순간 대체 채널까지 끄지 않는다) ④ 포커스 못 잡으면 소리 없음(거절 3회 지속 = `focusDenied`) ⑤ 재생·`toneEndsAt`·
 * 반납 예약. 로드 전 요청은 시작 톤 1개만 보류해 로드 완료에 **같은 경로**로 재생한다. 미디어 볼륨 0 판정은 위임.
 *
 * ⚠ 메인 스레드 전용. 좌우 방식·추세 진동 스위치는 매 재생 시 저장소를 읽는다(전환이 다음 톤부터 반영).
 */
class GuideTonePlayer(
    private val sound: SoundPort,
    private val focus: GuideAudioFocus,
    private val vibrator: VibratorPort,
    private val volume: VolumePort,
    private val store: KeyValueStore,
    private val clock: () -> Double,
    private val resource: (BeaconTone, LeftRightToneScheme) -> Int = ::toneResource,
) : GuideTones {
    private var preloaded = false
    private var pendingStart = false
    private var playingStream = 0
    private var playingEndsAt: Double? = null
    private var deniedStreak = 0

    override var toneEndsAt: Double? = null
        private set
    override var isSilenced = false
        private set
    override var focusDenied = false
        private set
    override var isSuppressed = false
    override val isMediaVolumeZero: Boolean get() = volume.isMediaVolumeZero()

    private val scheme: LeftRightToneScheme
        get() = store.getString(LeftRightToneScheme.storageKey)?.let(LeftRightToneScheme::fromRawValue) ?: LeftRightToneScheme.default
    private val trendHapticsEnabled: Boolean get() = store.getString(TrendHaptics.storageKey) == "true"

    /** 15개 리소스 로드 시작(멱등). 시작 톤이 보류 중이면 그 리소스의 로드 완료가 재생을 되살린다. */
    override fun preload() {
        if (preloaded) return
        preloaded = true
        val ids = BeaconTone.entries.flatMap { t -> LeftRightToneScheme.entries.map { s -> resource(t, s) } }.distinct()
        for (id in ids) {
            sound.load(id) {
                if (pendingStart && id == resource(BeaconTone.start, scheme)) {
                    pendingStart = false
                    play(BeaconTone.start)
                }
            }
        }
    }

    /** 세션 시작 — 끝난 세션의 미뤄진 반납을 취소한다. 포커스는 첫 `play`가 잡는다. */
    override fun beginSession() {
        pendingStart = false
        focus.cancelPendingRelease()
    }

    /** 세션 종료 — 잔여 재생 + 0.15초 뒤 반납(정지 톤이 잘리지 않게). */
    override fun endSession() {
        val remaining = playingEndsAt?.let { max(0.0, it - clock()) } ?: 0.0
        focus.endSession(remaining)
    }

    override fun play(tone: BeaconTone) {
        toneEndsAt = null                                                       // ①
        if (isSuppressed) return                                                // ②
        val scheme = scheme
        val resId = resource(tone, scheme)
        if (!sound.isLoaded(resId)) {
            if (tone == BeaconTone.start) pendingStart = true
            GuideDiag.log("tone notLoaded ${tone.rawValue} pendingStart=$pendingStart")
            return
        }
        if (!tone.hapticIsOptIn || trendHapticsEnabled) vibrator.vibrate(toneWaveform(tone))   // ③
        if (!focus.acquire()) {                                                 // ④
            deniedStreak++
            if (deniedStreak >= 3 && !focusDenied) { focusDenied = true; GuideDiag.log("focus denied streak=$deniedStreak") }
            GuideDiag.log("tone skipped focus ${tone.rawValue}")
            return
        }
        deniedStreak = 0
        focusDenied = false
        if (playingStream != 0) sound.stop(playingStream)                       // 선점
        val stream = sound.play(resId, toneGain(tone))                          // ⑤
        if (stream == 0) {
            isSilenced = true
            playingStream = 0
            playingEndsAt = null
            GuideDiag.log("tone playFailed ${tone.rawValue}")
            return
        }
        isSilenced = false
        playingStream = stream
        val duration = ToneDurations.seconds(tone, scheme)
        toneEndsAt = clock() + duration
        playingEndsAt = toneEndsAt
        focus.releaseAfter(duration + 0.15)
    }
}

/** `SoundPool` 포트 — `USAGE_MEDIA` + `CONTENT_TYPE_SONIFICATION`(TalkBack 끊김 판정 축은 usage, MEDIA는 무관; STREAM_MUSIC 매핑). */
class AndroidSoundPort(private val context: Context) : SoundPort {
    private val pool = SoundPool.Builder().setMaxStreams(2).setAudioAttributes(toneAudioAttributes).build()
    private val soundIds = HashMap<Int, Int>()       // resId → soundId
    private val resIds = HashMap<Int, Int>()         // soundId → resId
    private val loaded = HashSet<Int>()              // resId
    private val callbacks = HashMap<Int, () -> Unit>()

    init {
        pool.setOnLoadCompleteListener { _, sampleId, status ->
            val res = resIds[sampleId] ?: return@setOnLoadCompleteListener
            if (status != 0) { GuideDiag.log("tone loadFailed res=$res status=$status"); return@setOnLoadCompleteListener }
            loaded += res
            callbacks.remove(res)?.invoke()
        }
    }

    override fun load(resId: Int, onLoaded: () -> Unit) {
        if (resId in loaded) { onLoaded(); return }
        callbacks[resId] = onLoaded
        if (soundIds.containsKey(resId)) return
        val sid = pool.load(context, resId, 1)
        soundIds[resId] = sid
        resIds[sid] = resId
    }

    override fun play(resId: Int, gain: Float): Int {
        val sid = soundIds[resId] ?: return 0
        return pool.play(sid, gain, gain, 1, 0, 1f)
    }

    override fun stop(streamId: Int) = pool.stop(streamId)
    override fun isLoaded(resId: Int): Boolean = resId in loaded
}

class AndroidVolumePort(private val audioManager: AudioManager) : VolumePort {
    override fun isMediaVolumeZero(): Boolean = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC) == 0
}

/** 톤 attributes(spec §5-1). `ASSISTANCE_SONIFICATION`은 `STREAM_SYSTEM`이라 무음 모드에서 죽는다 — 쓰지 않는다. */
val toneAudioAttributes: AudioAttributes by lazy {
    AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
}
