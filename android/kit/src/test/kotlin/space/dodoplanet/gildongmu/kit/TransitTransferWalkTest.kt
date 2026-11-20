package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.TransitLegStop
import kotlin.math.abs
import kotlin.math.nextDown
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** E73 환승 도보 인계 판정(spec 2026-10-19-e73-transfer-walk-design.md §2·§4). 좌표는 합성이다. Kit 미러. */
class TransitTransferWalkTest {
    private val originLat = 37.5
    private val originLng = 127.0

    /** 위도 1도 ≈ 111,195m(Geo 지구 반지름 6,371,008.8m) — 북쪽으로 `m`미터 떨어진 위도. */
    private fun north(m: Double) = originLat + m / (6_371_008.8 * Math.PI / 180)

    private fun leg(
        mode: String = "bus", board: TransitLegStop?, alight: TransitLegStop?, walk: Int?,
        trackMode: TransitTrackMode? = TransitTrackMode.seoulBus,
    ) = TransitGuideLeg(
        mode = mode, lineName = if (mode == "bus") "100" else "수도권 1호선", trackMode = trackMode,
        boardName = board?.name ?: "승차", alightName = alight?.name ?: "하차",
        boardStop = board, alightStop = alight, viaStops = listOfNotNull(board, alight),
        stationCount = 3, routeId = null, wayCode = null, walkBeforeMinutes = walk, quickExit = null,
    )

    private fun twoLegRoute(gapMeters: Double, walk: Int? = 1, alight: TransitLegStop? = null): TransitGuideRoute {
        val firstAlight = alight ?: TransitLegStop(name = "가 정류장", lat = originLat, lng = originLng)
        return TransitGuideRoute(
            legs = listOf(
                leg(board = TransitLegStop(name = "출발", lat = 37.4, lng = 127.0), alight = firstAlight, walk = null),
                leg(
                    "subway", board = TransitLegStop(name = "나역", lat = north(gapMeters), lng = originLng),
                    alight = TransitLegStop(name = "다역", lat = 37.6, lng = 127.0), walk = walk, trackMode = TransitTrackMode.subway,
                ),
            ),
            walkAfterMinutes = 2,
        )
    }

    @Test fun `환승 도보 대상은 30m 이상부터`() {
        assertNull(transitTransferWalkTarget(twoLegRoute(gapMeters = 29.9), legIndex = 1))
        val target = transitTransferWalkTarget(twoLegRoute(gapMeters = 30.1), legIndex = 1)
        assertEquals("나역", target?.name)
        assertEquals(1, target?.minutes)
        // 상수는 E70 D6과 하나다.
        assertEquals(30.0, JourneyTuning.accessWalkMinMeters)
    }

    /** "30m 이상" — 정확히 30.0은 대상, 바로 아래 값은 아니다(`>`로 바뀌면 깨진다). */
    @Test fun `환승 도보 거리는 정확히 30m를 포함한다`() {
        assertTrue(transferWalkDistanceQualifies(30.0))
        assertFalse(transferWalkDistanceQualifies(30.0.nextDown()))
    }

    @Test fun `환승 도보 거리는 직선이거나 null`() {
        val route = twoLegRoute(gapMeters = 85.0)
        assertTrue(abs((transitTransferWalkMeters(route, legIndex = 1) ?: 0.0) - 85) < 0.01)
        assertNull(transitTransferWalkMeters(route, legIndex = 0))
        assertNull(transitTransferWalkMeters(route, legIndex = 2))
        val island = twoLegRoute(gapMeters = 85.0, alight = TransitLegStop(name = "y", lat = 0.0, lng = 0.0))
        assertNull(transitTransferWalkMeters(island, legIndex = 1))
    }

    @Test fun `환승 도보 대상은 그 구간의 승차 전 도보 대상과 같다`() {
        val route = twoLegRoute(gapMeters = 85.0, walk = 2)
        assertEquals(
            transitPrewalkTarget(TransitGuideRoute(legs = listOf(route.legs[1]), walkAfterMinutes = null)),
            transitTransferWalkTarget(route, legIndex = 1),
        )
    }

    @Test fun `맨 앞 구간과 범위 밖은 대상이 아니다`() {
        val route = twoLegRoute(gapMeters = 85.0)
        assertNull(transitTransferWalkTarget(route, legIndex = 0)) // 맨 앞 도보는 A25 몫
        assertNull(transitTransferWalkTarget(route, legIndex = 2))
        assertNull(transitTransferWalkTarget(route, legIndex = -1))
    }

    @Test fun `환승 도보 대상은 승차 전 도보 조건을 따른다`() {
        assertNull(transitTransferWalkTarget(twoLegRoute(gapMeters = 85.0, walk = null), legIndex = 1))
        assertNull(transitTransferWalkTarget(twoLegRoute(gapMeters = 85.0, walk = 0), legIndex = 1))
        val base = twoLegRoute(gapMeters = 85.0)
        for (bad in listOf(TransitLegStop(name = "x", lat = 0.0, lng = 0.0), TransitLegStop(name = "x", lat = Double.NaN, lng = 127.0))) {
            val route = TransitGuideRoute(
                legs = listOf(base.legs[0], leg("subway", board = bad, alight = base.legs[1].alightStop, walk = 1)),
                walkAfterMinutes = null,
            )
            assertNull(transitTransferWalkTarget(route, legIndex = 1))
        }
    }

    @Test fun `앞 구간 하차 좌표를 모르면 거리를 건너뛴다`() {
        // 앞 구간 하차 좌표가 없거나 무효면 거리를 잴 수 없다 — 분 >= 1이면 대상(빠진 안내보다 군더더기).
        val base = twoLegRoute(gapMeters = 5.0)
        val missing = TransitGuideRoute(
            legs = listOf(leg(board = base.legs[0].boardStop, alight = null, walk = null), base.legs[1]), walkAfterMinutes = null,
        )
        assertEquals("나역", transitTransferWalkTarget(missing, legIndex = 1)?.name)
        val island = twoLegRoute(gapMeters = 5.0, alight = TransitLegStop(name = "y", lat = 0.0, lng = 0.0))
        assertEquals("나역", transitTransferWalkTarget(island, legIndex = 1)?.name)
    }

    @Test fun `withoutWalkBefore는 그 구간만 지우고 원본을 지킨다`() {
        val route = TransitGuideRoute(
            legs = listOf(leg(board = null, alight = null, walk = 3), leg(board = null, alight = null, walk = 2), leg(board = null, alight = null, walk = 4)),
            walkAfterMinutes = 5,
        )
        val out = withoutWalkBefore(route, legIndex = 1)
        assertEquals(listOf(3, null, 4), out.legs.map { it.walkBeforeMinutes })
        assertEquals(5, out.walkAfterMinutes)
        assertEquals(2, route.legs[1].walkBeforeMinutes) // 원본 불변
        assertEquals(
            withoutPrewalk(route).legs.map { it.walkBeforeMinutes },
            withoutWalkBefore(route, legIndex = 0).legs.map { it.walkBeforeMinutes },
        )
        assertEquals(listOf(3, 2, 4), withoutWalkBefore(route, legIndex = 3).legs.map { it.walkBeforeMinutes })
    }

    @Test fun `구간에서 시작하는 안내 상태는 그 구간의 대기 국면이다`() {
        val route = TransitGuideRoute(
            legs = listOf(
                leg(board = null, alight = null, walk = null),
                leg("bus", board = null, alight = null, walk = 1, trackMode = null),
                leg("subway", board = null, alight = null, walk = null, trackMode = TransitTrackMode.subway),
            ),
            walkAfterMinutes = null,
        )
        val untracked = initTransitGuide(route = route, startingAt = 1, now = 0.0)
        assertTrue(untracked.legIndex == 1 && untracked.phase == TransitPhase.waiting && untracked.signal == TransitSignal.untrackable)
        assertTrue(untracked.lastSeq == 0 && untracked.phaseGen == 0 && untracked.pollCount == 0)
        val tracked = initTransitGuide(route = route, startingAt = 2, now = 0.0)
        assertTrue(tracked.legIndex == 2 && tracked.signal == TransitSignal.notYetVisible)
        // 다음 구간 전진이 주는 국면·신호와 같다(handleAdvance).
        val arrived = initTransitGuide(route = route, now = 0.0).copy(phase = TransitPhase.arrived)
        val advanced = transitGuideStep(state = arrived, input = TransitGuideInput.Advance, route = route, now = 0.0).state
        assertTrue(advanced.legIndex == untracked.legIndex && advanced.phase == untracked.phase && advanced.signal == untracked.signal)
        // 범위 밖은 0번 구간.
        assertEquals(0, initTransitGuide(route = route, startingAt = 9, now = 0.0).legIndex)
    }
}
