package space.dodoplanet.gildongmu.audio

import space.dodoplanet.gildongmu.guide.ResultHapticKind
import space.dodoplanet.gildongmu.kit.BeaconTone
import space.dodoplanet.gildongmu.kit.LeftRightToneScheme
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class FakeVibrator : VibratorPort {
    val waveforms = mutableListOf<Waveform>()
    var clicks = 0
    override fun vibrate(waveform: Waveform) { waveforms += waveform }
    override fun click() { clicks++ }
}

/** spec §5-4 — 진동 시점 합은 톤 길이를 넘지 않고, 타격 수는 표대로. */
class ToneHapticsTest {
    private fun taps(w: Waveform) = w.amplitudes.count { it > 0 }

    @Test fun `13톤 — 시점 합 ≤ 톤 길이 + 50ms, 배열 길이 일치`() {
        for (tone in BeaconTone.entries) {
            val w = toneWaveform(tone)
            assertEquals(w.timings.size, w.amplitudes.size, tone.name)
            assertTrue(w.timings.sum() <= (ToneDurations.seconds(tone, LeftRightToneScheme.pitch) * 1000 + 50).toLong(), "$tone ${w.timings.sum()}")
            assertTrue(taps(w) >= 1, tone.name)
        }
    }

    @Test fun `타격 수 — closer 1·farther 2·nearby 6·crosswalk 8·ahead 7·unreliable 3·left 2`() {
        assertEquals(1, taps(toneWaveform(BeaconTone.closer)))
        assertEquals(2, taps(toneWaveform(BeaconTone.farther)))
        assertEquals(6, taps(toneWaveform(BeaconTone.nearby)))
        assertEquals(8, taps(toneWaveform(BeaconTone.crosswalk)))
        assertEquals(7, taps(toneWaveform(BeaconTone.ahead)))
        assertEquals(3, taps(toneWaveform(BeaconTone.unreliable)))
        assertEquals(2, taps(toneWaveform(BeaconTone.left)))
        assertContentEquals(toneWaveform(BeaconTone.left).timings, toneWaveform(BeaconTone.right).timings)
        assertContentEquals(toneWaveform(BeaconTone.start).timings, toneWaveform(BeaconTone.stop).timings)
    }

    @Test fun `결과 진동 3종 — success 클릭, attention 2연타, failure 3연타, 설정 스위치가 꺼져 있으면 무동작(iOS 동형)`() {
        val port = FakeVibrator()
        val store = space.dodoplanet.gildongmu.kit.InMemoryKeyValueStore()
        val h = ResultHaptic(port, store)
        h.result(ResultHapticKind.success); h.result(ResultHapticKind.failure)
        assertEquals(0, port.clicks); assertEquals(0, port.waveforms.size) // 스위치 기본 off
        store.putString(space.dodoplanet.gildongmu.kit.TrendHaptics.storageKey, "true")
        h.result(ResultHapticKind.success)
        assertEquals(1, port.clicks)
        h.result(ResultHapticKind.attention)
        assertContentEquals(longArrayOf(0, 40, 60, 40), port.waveforms.last().timings)
        h.result(ResultHapticKind.failure)
        assertContentEquals(longArrayOf(0, 60, 60, 60, 60, 60), port.waveforms.last().timings)
        assertEquals(2, port.waveforms.size)
    }
}
