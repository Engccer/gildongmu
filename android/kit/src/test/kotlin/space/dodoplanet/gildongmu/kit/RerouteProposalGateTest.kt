package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * 이탈 시 제안(E10ⓑ) 순수 게이트 — 신선도(30m/120초)·세션당 조회 상한(5회). Kit `RerouteProposalGateTests` 미러.
 * 상수는 잠정값(spec §6, 실보행 판정 대상)이라 경계 ±1을 못 박는다.
 */
class RerouteProposalGateTest {
    private val base = RerouteProposal(originLat = 37.5386, originLng = 127.1230, acquiredAt = 1_000.0)

    /** 위도 1도 ≈ 111,320m — 테스트 이동량은 위도 오프셋으로 만든다. */
    private fun moved(meters: Double) = Pair(base.originLat + meters / 111_320.0, base.originLng)

    @Test fun `이동 29m 경과 119초는 fresh`() {
        val (lat, lng) = moved(29.0)
        assertTrue(RerouteProposalGate.isFresh(base, 1_119.0, lat, lng))
    }

    @Test fun `이동 31m는 만료`() {
        val (lat, lng) = moved(31.0)
        assertFalse(RerouteProposalGate.isFresh(base, 1_001.0, lat, lng))
    }

    @Test fun `경과 121초는 만료`() {
        assertFalse(RerouteProposalGate.isFresh(base, 1_121.0, base.originLat, base.originLng))
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
