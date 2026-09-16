package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse

/**
 * 진행 상태 진동(E30 실험판) — Kit `TrendHapticsTests` 미러. 스위치 대상 톤은 **정확히** 가까워짐·정지·신뢰 불가
 * 셋이다. 나머지 10종은 스위치와 무관하게 진동한다("꺼짐 = 현재 동작", 위원장 2026-09-13).
 */
class BeaconTonesTest {
    @Test fun `옵트인 톤은 closer·tick·unreliable 셋뿐이다`() {
        assertEquals(setOf(BeaconTone.closer, BeaconTone.tick, BeaconTone.unreliable), BeaconTone.entries.filter { it.hapticIsOptIn }.toSet())
    }

    @Test fun `우선 톤·이벤트 톤·세션 경계 톤은 옵트인이 아니다`() {
        val alwaysOn = listOf(
            BeaconTone.warning, BeaconTone.nearby, BeaconTone.farther, BeaconTone.ahead, BeaconTone.crosswalk,
            BeaconTone.left, BeaconTone.right, BeaconTone.back, BeaconTone.start, BeaconTone.stop,
        )
        for (tone in alwaysOn) assertFalse(tone.hapticIsOptIn, "$tone")
    }
}
