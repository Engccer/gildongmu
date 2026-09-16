package space.dodoplanet.gildongmu.audio

import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Handler
import space.dodoplanet.gildongmu.guide.GuideDiag

fun interface Cancellable {
    fun cancel()
}

/** 오디오 포커스 플랫폼 포트(JVM 테스트는 페이크). `request`는 `AudioManager.AUDIOFOCUS_REQUEST_*` 값을 돌려준다. */
interface AudioFocusPort {
    fun request(listener: (Int) -> Unit): Int
    fun abandon()
}

/**
 * 목표 계약 5항의 AudioFocus 판(spec §5-2): 소리를 내는 동안만 포커스를 쥐고, **못 쥐면 내지 않는다**(포커스는 협약 — `SoundPool`·
 * TTS는 포커스 없이도 소리를 내므로 이 규칙이 앱 쪽에 있어야 인터럽션 계약이 성립한다). LOSS*는 `held`만 내리고 다음 `acquire`가
 * 재요청한다(GAIN 콜백에 의존하지 않는다). 반납은 잔여 재생 + 0.15초 뒤 예약이고 새 `acquire`가 예약을 취소한다.
 *
 * ⚠ 메인 스레드 전용(동기화 없음). `abandonAudioFocusRequest`는 자기 핸들에만 작용해 구조적으로 남을 건드리지 않는다.
 */
class GuideAudioFocus(
    private val port: AudioFocusPort,
    private val postDelayed: (delayMs: Long, block: () -> Unit) -> Cancellable,
) {
    var held = false
        private set
    private var pending: Cancellable? = null

    private val listener: (Int) -> Unit = { change ->
        when (change) {
            AudioManager.AUDIOFOCUS_LOSS, AudioManager.AUDIOFOCUS_LOSS_TRANSIENT, AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                if (held) GuideDiag.log("focus lost change=$change")
                held = false
            }
            else -> Unit
        }
    }

    /** 재생 직전. `held`면 true. 아니면 요청 — GRANTED만 true(FAILED·DELAYED는 false). 예약된 반납은 취소한다. */
    fun acquire(): Boolean {
        cancelPendingRelease()
        if (held) return true
        held = port.request(listener) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        return held
    }

    /** 예약 반납 — 새 예약이 옛 예약을 대체한다. */
    fun releaseAfter(seconds: Double) {
        cancelPendingRelease()
        pending = postDelayed((seconds * 1000).toLong().coerceAtLeast(0)) {
            pending = null
            releaseNow()
        }
    }

    /** 세션 종료 — 잔여 재생 + 0.15초 뒤 반납(iOS `endSession` 여유 동형). */
    fun endSession(remainingSeconds: Double) = releaseAfter(remainingSeconds + 0.15)

    /** 새 세션 시작이 미뤄진 반납을 취소한다(끝난 세션의 반납이 새 세션 한복판에 떨어지지 않게). */
    fun cancelPendingRelease() {
        pending?.cancel()
        pending = null
    }

    /** 즉시 반납(예약 실행·테스트 전용). 쥐고 있을 때만 `abandon`. */
    fun releaseNow() {
        cancelPendingRelease()
        if (!held) return
        held = false
        port.abandon()
    }
}

/** 플랫폼 포트 — `AudioFocusRequest(GAIN_TRANSIENT_MAY_DUCK)` + 톤 attributes. */
class AndroidAudioFocusPort(private val audioManager: AudioManager, private val attributes: AudioAttributes) : AudioFocusPort {
    private var current: AudioFocusRequest? = null

    override fun request(listener: (Int) -> Unit): Int {
        val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
            .setAudioAttributes(attributes)
            .setOnAudioFocusChangeListener { listener(it) }
            .build()
        current = req
        return audioManager.requestAudioFocus(req)
    }

    override fun abandon() {
        val req = current ?: return
        current = null
        audioManager.abandonAudioFocusRequest(req)
    }
}

/** `Handler.postDelayed` 기반 예약(메인 핸들러). */
fun handlerPostDelayed(handler: Handler): (Long, () -> Unit) -> Cancellable = { ms, block ->
    val runnable = Runnable { block() }
    handler.postDelayed(runnable, ms)
    Cancellable { handler.removeCallbacks(runnable) }
}
