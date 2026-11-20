package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.TransitLegStop
import space.dodoplanet.gildongmu.kit.models.TransitRoute
import space.dodoplanet.gildongmu.kit.models.TransitRouteLeg
import space.dodoplanet.gildongmu.kit.models.TransitRouteResult
import space.dodoplanet.gildongmu.kit.models.TransitRouteSummary
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** E78 잘못 내림 복구 판정(spec 2026-11-07-e78-wrong-stop-recovery-design.md §3·§5·§8). 좌표는 합성이다. Kit 미러. */
class TransitWrongStopRecoveryTest {
    private fun leg(mode: String = "bus", trackMode: TransitTrackMode?): TransitGuideLeg {
        val board = TransitLegStop(name = "가", lat = 37.5, lng = 127.0)
        val alight = TransitLegStop(name = "나", lat = 37.51, lng = 127.0)
        return TransitGuideLeg(
            mode = mode, lineName = if (mode == "bus") "100" else "수도권 2호선", trackMode = trackMode,
            boardName = "가", alightName = "나", boardStop = board, alightStop = alight, viaStops = listOf(board, alight),
            stationCount = 1, routeId = null, wayCode = null, walkBeforeMinutes = null, quickExit = null,
        )
    }

    private fun route(legs: List<TransitGuideLeg>) = TransitGuideRoute(legs = legs, walkAfterMinutes = null)

    @Test fun `복구 버튼은 승차 중이나 도착 뒤에만 서고 여정 밖에서만`() {
        assertTrue(transitRecoveryOffered(TransitPhase.riding, untrackable = false, inJourney = false))
        assertTrue(transitRecoveryOffered(TransitPhase.arrived, untrackable = false, inJourney = false))
        for (phase in listOf(TransitPhase.waiting, TransitPhase.boarding, TransitPhase.done)) {
            assertFalse(transitRecoveryOffered(phase, untrackable = false, inJourney = false), phase.name)
        }
        // 여정 단계는 국면과 무관하게 세우지 않는다(§5-3).
        assertFalse(transitRecoveryOffered(TransitPhase.riding, untrackable = false, inJourney = true))
        assertFalse(transitRecoveryOffered(TransitPhase.arrived, untrackable = false, inJourney = true))
    }

    @Test fun `추적 불가 구간은 대기 국면에 머물러도 선다`() {
        assertTrue(transitRecoveryOffered(TransitPhase.waiting, untrackable = true, inJourney = false))
        assertFalse(transitRecoveryOffered(TransitPhase.done, untrackable = true, inJourney = false))
        assertFalse(transitRecoveryOffered(TransitPhase.waiting, untrackable = true, inJourney = true))
    }

    @Test fun `출발점은 지하철만 역을 묻는다`() {
        assertEquals(TransitRecoveryOrigin.askStation, transitRecoveryOrigin(leg("subway", TransitTrackMode.subway)))
        // 추적 불가 지하철(비수도권)도 땅속이다 — 수단으로 가른다.
        assertEquals(TransitRecoveryOrigin.askStation, transitRecoveryOrigin(leg("subway", null)))
        assertEquals(TransitRecoveryOrigin.deviceFix, transitRecoveryOrigin(leg("bus", TransitTrackMode.seoulBus)))
        assertEquals(TransitRecoveryOrigin.deviceFix, transitRecoveryOrigin(leg("bus", TransitTrackMode.tagoBus)))
    }

    @Test fun `안내 가능은 모든 구간이 추적 가능해야 한다`() {
        assertTrue(transitRouteGuidable(route(listOf(leg(trackMode = TransitTrackMode.seoulBus), leg("subway", TransitTrackMode.subway)))))
        assertTrue(transitRouteGuidable(route(listOf(leg(trackMode = TransitTrackMode.tagoBus)))))
        assertFalse(transitRouteGuidable(route(listOf(leg(trackMode = TransitTrackMode.seoulBus), leg("subway", null)))))
        assertFalse(transitRouteGuidable(route(emptyList())))
    }

    @Test fun `후보 선택은 안내 불가와 변환 실패를 순서대로 건너뛴다`() {
        val good = route(listOf(leg(trackMode = TransitTrackMode.seoulBus)))
        val bad = route(listOf(leg("subway", null)))
        assertEquals(0, transitRecoveryPickIndex(listOf(good, bad)))
        // 추천이 안내 불가면 말없이 다음 후보(§3.3).
        assertEquals(2, transitRecoveryPickIndex(listOf(bad, null, good)))
        // 후보는 있으나 안내 가능 0 — 조회 0건과 다른 상태(§8-2).
        assertNull(transitRecoveryPickIndex(listOf(bad, null)))
        assertNull(transitRecoveryPickIndex(emptyList()))
    }

    @Test fun `조회 결과에서 바꿀 경로는 추천 다음 대안 순이다`() {
        fun transitRoute(key: String, legs: List<TransitRouteLeg>) = TransitRoute(
            summary = TransitRouteSummary(totalMinutes = 20, fare = 1500, transfers = 0, walkMinutes = 0),
            legs = legs, routeKey = key,
        )
        fun busLeg(line: String?) = TransitRouteLeg(
            mode = "bus", lineName = line, fromName = "가", toName = "나", stationCount = 1, minutes = 5,
            stops = listOf(TransitLegStop(name = "가", lat = 37.5, lng = 127.0), TransitLegStop(name = "나", lat = 37.51, lng = 127.0)),
        )
        // 노선 이름 없는 버스 구간은 추적 불가로 분류된다 — 추천이 그 경로면 대안으로 넘어간다.
        val unguidable = transitRoute("r0", listOf(busLeg(null)))
        val guidable = transitRoute("r1", listOf(busLeg("100")))
        assertEquals(false, buildTransitGuideRoute(unguidable)?.let { transitRouteGuidable(it) })
        assertEquals("r1", transitRecoveryRoute(TransitRouteResult(unguidable, listOf(guidable), totalCandidates = 2))?.routeKey)
        assertEquals("r1", transitRecoveryRoute(TransitRouteResult(guidable, listOf(unguidable), totalCandidates = 2))?.routeKey)
        assertNull(transitRecoveryRoute(TransitRouteResult(unguidable, emptyList(), totalCandidates = 1)))
    }
}
