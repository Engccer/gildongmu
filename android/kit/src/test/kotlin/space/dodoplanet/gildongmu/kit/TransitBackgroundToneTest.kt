package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** E79 백그라운드 톤 허용 집합 전수(spec 2026-11-07-e79-transit-background-tones-design.md §2 표). Kit 미러. */
class TransitBackgroundToneTest {
    private fun allowed(event: TransitGuideEvent) = transitToneAllowedInBackground(TransitBackgroundToneSource.Event(event))
    private fun trend(tone: BeaconTone) = transitToneAllowedInBackground(TransitBackgroundToneSource.Trend(tone))

    @Test fun `승차 중 진행음과 도착음은 백그라운드에서 낸다`() {
        assertTrue(allowed(TransitGuideEvent.TrackingStarted("m", null, 3, null)))
        assertTrue(allowed(TransitGuideEvent.Countdown(2, "m", null, null, null, null)))
        assertTrue(allowed(TransitGuideEvent.Countdown(1, "m", null, null, null, null)))
        assertTrue(allowed(TransitGuideEvent.ArrivingAtAlightStop))
        assertTrue(allowed(TransitGuideEvent.Arrived(certain = true)))
        assertTrue(allowed(TransitGuideEvent.Arrived(certain = false)))
        assertTrue(allowed(TransitGuideEvent.LegAdvanced(legIndex = 1, final = true)))
        assertTrue(transitToneAllowedInBackground(TransitBackgroundToneSource.AlightReached))
        assertTrue(trend(BeaconTone.closer))
        assertTrue(trend(BeaconTone.farther))
    }

    @Test fun `신호 잃음 반복음과 경고음은 내지 않는다`() {
        assertFalse(trend(BeaconTone.unreliable))
        assertFalse(allowed(TransitGuideEvent.SignalLost))
        assertFalse(allowed(TransitGuideEvent.NeverSeen))
        assertFalse(allowed(TransitGuideEvent.UpstreamFailed))
        assertFalse(allowed(TransitGuideEvent.VehiclePassed))
    }

    @Test fun `고른 차량을 기다리는 동안의 다가옴 소리도 낸다`() {
        assertTrue(allowed(TransitGuideEvent.Approaching(2, "m", null)))
        assertTrue(allowed(TransitGuideEvent.Approaching(1, "m", null)))
        assertTrue(allowed(TransitGuideEvent.Approaching(null, "m", null)))
        assertTrue(allowed(TransitGuideEvent.ArrivingAtBoardStop))
        assertTrue(allowed(TransitGuideEvent.Boarded(0, TransitBoardedCause.observed)))
        // 서울버스는 정차 신호가 없어 승차 전이가 출발 관측뿐이다 — 빼면 잠금 화면 서울버스 승차가 무음이 된다.
        assertTrue(allowed(TransitGuideEvent.Boarded(0, TransitBoardedCause.departed)))
    }

    // A74: 승차 확인을 청하는 두 문장은 지금 행동해야 하는 문장이라 도착 관측 승차와 같은 등급이다.
    @Test fun `승차 확인 문장은 백그라운드에서도 낸다`() {
        assertTrue(allowed(TransitGuideEvent.BoardConfirmNeeded))
        assertTrue(allowed(TransitGuideEvent.BoardConfirmLapsed))
    }

    @Test fun `사용자 조작 응답은 전경만이다`() {
        assertFalse(allowed(TransitGuideEvent.Boarded(0, TransitBoardedCause.declared)))
        assertFalse(allowed(TransitGuideEvent.LegAdvanced(legIndex = 1, final = false)))
        assertFalse(allowed(TransitGuideEvent.VehicleSelected(legIndex = 0)))
    }

    @Test fun `추세 층의 다른 소리는 허용하지 않는다`() {
        for (tone in BeaconTone.entries) {
            if (tone != BeaconTone.closer && tone != BeaconTone.farther) assertFalse(trend(tone), tone.name)
        }
    }
}
