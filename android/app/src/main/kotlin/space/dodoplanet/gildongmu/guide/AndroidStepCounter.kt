package space.dodoplanet.gildongmu.guide

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler

/**
 * 세션 걸음 누적(spec §3-2 ⑥). `TYPE_STEP_COUNTER`는 부팅 이후 누적이라 기준값은 **세션 첫 이벤트의 값**이고(그 앞 걸음은
 * 유실 — iOS "첫 라이브 콜백 전 중지는 요약 없음" 수용과 같은 성질), 표본 = 현재 − 기준값. 거리는 항상 null — 안드로이드에
 * 만보계 거리가 없고 보폭 환산은 :kit `WalkHealth`가 한다(임계 50m ≈ 72걸음). `stop()`은 갱신만 멈추고 값은 남긴다.
 */
class AndroidStepCounter(context: Context, private val main: Handler) : StepCounter, SensorEventListener {
    private val manager = context.applicationContext.getSystemService(SensorManager::class.java)
    private val sensor: Sensor? = manager?.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
    private var base: Float? = null
    private var registered = false

    override var liveSample: StepSample? = null
        private set

    override fun start() {
        base = null
        liveSample = null
        val s = sensor ?: return
        val m = manager ?: return
        if (registered) return
        registered = runCatching { m.registerListener(this, s, SensorManager.SENSOR_DELAY_NORMAL, main) }.getOrDefault(false)
    }

    override fun stop() {
        if (!registered) return
        registered = false
        runCatching { manager?.unregisterListener(this) }
    }

    override fun onSensorChanged(event: SensorEvent) {
        val value = event.values.firstOrNull() ?: return
        val b = base ?: value.also { base = it }
        liveSample = StepSample((value - b).toInt().coerceAtLeast(0), null)
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
}
