package space.dodoplanet.gildongmu.audio

import space.dodoplanet.gildongmu.kit.TrendHaptics
import space.dodoplanet.gildongmu.kit.KeyValueStore
import android.content.Context
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import space.dodoplanet.gildongmu.guide.GuideHaptics
import space.dodoplanet.gildongmu.guide.ResultHapticKind
import space.dodoplanet.gildongmu.kit.BeaconTone

/** `VibrationEffect.createWaveform` 입력(off 구간은 amplitude 0). */
data class Waveform(val timings: LongArray, val amplitudes: IntArray) {
    init { require(timings.size == amplitudes.size) }
}

/** 진동 플랫폼 포트(JVM 테스트는 페이크). */
interface VibratorPort {
    fun vibrate(waveform: Waveform)
    fun click()
}

private fun w(vararg pairs: Pair<Long, Int>) = Waveform(pairs.map { it.first }.toLongArray(), pairs.map { it.second }.toIntArray())

/**
 * 톤 동기 진동 표(spec §5-4 — iOS `haptic(for:)`의 시점·세기를 waveform 구간으로 옮긴 것). `ToneHapticsTest`가 시점 합 ≤
 * `ToneDurations` 길이를 단언한다. 진동은 FGS가 살아 있는 한 백그라운드에서도 나지만 "어떤 신호도 진동에만 싣지 않는다"는
 * 규칙은 유지한다(진동 없는 기기가 있고 소리가 정본).
 */
fun toneWaveform(tone: BeaconTone): Waveform = when (tone) {
    BeaconTone.closer -> w(0L to 0, 40L to 115)
    BeaconTone.farther -> w(0L to 0, 40L to 115, 40L to 0, 40L to 115)
    BeaconTone.nearby -> w(0L to 0, 40L to 255, 250L to 0, 40L to 190, 110L to 0, 40L to 205, 110L to 0, 40L to 215, 210L to 0, 40L to 190, 220L to 0, 40L to 130)
    BeaconTone.tick -> w(0L to 0, 480L to 90)
    BeaconTone.unreliable -> w(0L to 0, 40L to 140, 110L to 0, 40L to 140, 210L to 0, 40L to 140)
    BeaconTone.ahead -> w(40L to 0, 30L to 120, 60L to 0, 30L to 120, 50L to 0, 30L to 120, 40L to 0, 30L to 120, 50L to 0, 30L to 120, 30L to 0, 30L to 120, 50L to 0, 30L to 120)
    BeaconTone.crosswalk -> w(0L to 0, 60L to 200, 60L to 0, 60L to 200, 60L to 0, 60L to 200, 60L to 0, 60L to 200, 280L to 0, 60L to 200, 60L to 0, 60L to 200, 60L to 0, 60L to 200, 60L to 0, 60L to 200)
    BeaconTone.left, BeaconTone.right -> w(0L to 0, 40L to 140, 180L to 0, 60L to 230)
    BeaconTone.back -> w(0L to 0, 130L to 220, 140L to 160, 130L to 100, 100L to 0, 130L to 220, 140L to 160, 130L to 100)
    BeaconTone.warning -> w(0L to 0, 40L to 255, 100L to 180, 100L to 110, 100L to 50)
    BeaconTone.start, BeaconTone.stop -> w(150L to 38, 150L to 140, 155L to 255, 260L to 255, 185L to 180, 200L to 77, 200L to 0)
}

/**
 * 결과 진동 3종 창구(iOS `ResultHaptic.fire` 미러): success = 시스템 클릭, attention = 짧은 2연타, failure = 3연타. 1회성 결과·전이에만,
 * 반복 상태 통지엔 금지. 실험판 상수 켬(설정 마일스톤에서 스위치). 모델 창구가 `outputSuppressed`면 부르지 않는다.
 */
/** 결과 진동 3종 — iOS `ResultHaptic.fire`처럼 **설정 스위치(`TrendHaptics.storageKey`) 뒤**(옵트인 톤 진동과 같은 게이트; CLAUDE.md). 꺼져 있으면 무동작. */
class ResultHaptic(private val port: VibratorPort, private val store: KeyValueStore) : GuideHaptics {
    private val enabled: Boolean get() = store.getString(TrendHaptics.storageKey) == "true"

    override fun result(kind: ResultHapticKind) = if (!enabled) Unit else when (kind) {
        ResultHapticKind.success -> port.click()
        ResultHapticKind.attention -> port.vibrate(attention)
        ResultHapticKind.failure -> port.vibrate(failure)
    }

    companion object {
        val attention = w(0L to 0, 40L to 255, 60L to 0, 40L to 255)
        val failure = w(0L to 0, 60L to 255, 60L to 0, 60L to 255, 60L to 0, 60L to 255)
    }
}

/** 플랫폼 진동기(`VibratorManager.defaultVibrator`, API 31). 진동 없는 기기·예외는 조용히 무시한다(소리가 정본). */
class AndroidVibrator(context: Context) : VibratorPort {
    private val vibrator: Vibrator? = context.applicationContext.getSystemService(VibratorManager::class.java)?.defaultVibrator

    override fun vibrate(waveform: Waveform) {
        val v = vibrator ?: return
        if (!v.hasVibrator()) return
        runCatching { v.vibrate(VibrationEffect.createWaveform(waveform.timings, waveform.amplitudes, -1)) }
    }

    override fun click() {
        val v = vibrator ?: return
        if (!v.hasVibrator()) return
        runCatching { v.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_CLICK)) }
    }
}
