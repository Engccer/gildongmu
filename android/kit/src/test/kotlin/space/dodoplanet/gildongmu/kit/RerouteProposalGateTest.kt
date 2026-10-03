package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * 이탈 시 제안(E10ⓑ) 순수 게이트 — 신선도(수단별 이동 상한/120초)·세션당 조회 상한(5회). Kit `RerouteProposalGateTests`·
 * 웹 `reroute-proposal-gate.test.ts` 미러. 상수는 잠정값(spec §6, 실보행 판정 대상)이라 경계 ±1을 못 박는다.
 */
class RerouteProposalGateTest {
    private val base = RerouteProposal(originLat = 37.5386, originLng = 127.1230, acquiredAt = 1_000.0)

    /** 위도 1도 ≈ 111,320m — 테스트 이동량은 위도 오프셋으로 만든다. */
    private fun moved(meters: Double) = Pair(base.originLat + meters / 111_320.0, base.originLng)

    private fun fresh(meters: Double, now: Double, maxDrift: Double): Boolean {
        val (lat, lng) = moved(meters)
        return RerouteProposalGate.isFresh(base, now, lat, lng, maxDrift)
    }

    @Test fun `도보는 30m, 자동차는 150m까지 신선하다`() {
        assertEquals(30.0, GuideTuning.walk.rerouteMaxDriftM)
        assertEquals(150.0, GuideTuning.car.rerouteMaxDriftM)
        assertTrue(fresh(29.0, 1_001.0, GuideTuning.walk.rerouteMaxDriftM))
        assertFalse(fresh(31.0, 1_001.0, GuideTuning.walk.rerouteMaxDriftM))
        assertTrue(fresh(140.0, 1_001.0, GuideTuning.car.rerouteMaxDriftM))
        assertFalse(fresh(160.0, 1_001.0, GuideTuning.car.rerouteMaxDriftM))
    }

    @Test fun `120초를 넘기면 제자리여도 낡았다`() {
        assertTrue(fresh(0.0, 1_000.0 + RerouteProposalGate.maxAgeSeconds, 30.0))
        assertFalse(fresh(0.0, 1_000.0 + RerouteProposalGate.maxAgeSeconds + 1, 30.0))
    }

    @Test fun `상한 5회째까지 허용 6회째 거부`() {
        assertTrue(RerouteProposalGate.mayFetch(0))
        assertTrue(RerouteProposalGate.mayFetch(4))
        assertFalse(RerouteProposalGate.mayFetch(5))
    }

    @Test fun `시간축 단독 판정은 좌표 없이 만료를 가른다`() {
        assertTrue(RerouteProposalGate.isFreshInTime(base, 1_119.0))
        assertFalse(RerouteProposalGate.isFreshInTime(base, 1_121.0))
    }
}
