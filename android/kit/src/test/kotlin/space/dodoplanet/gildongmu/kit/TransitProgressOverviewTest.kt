package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import space.dodoplanet.gildongmu.kit.models.TransitLegStop
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** 진행 상황 조망 — Kit `TransitProgressOverviewTests` 미러. 공유 fixture로 디스크립터 동일을 대조한다(spec 2026-08-23 §3·§10). */
class TransitProgressOverviewTest {
    @Serializable
    private data class ScenarioFile(val scenarios: List<Scenario>) {
        @Serializable
        data class Leg(
            val mode: String,
            val lineName: String,
            val trackMode: String? = null,
            val boardName: String,
            val alightName: String,
            val viaStops: List<String>,
            val stationCount: Int? = null,
            val walkBeforeMinutes: Int? = null,
        )

        @Serializable
        data class Route(val legs: List<Leg>, val walkAfterMinutes: Int? = null)

        @Serializable
        data class State(val legIndex: Int, val phase: String, val signal: String, val currentLocation: String? = null, val arrivedCertain: Boolean)

        @Serializable
        data class Scenario(val name: String, val state: State, val route: Route, val expected: TransitOverview)
    }

    private fun toRoute(r: ScenarioFile.Route) = TransitGuideRoute(
        legs = r.legs.map { l ->
            TransitGuideLeg(
                mode = l.mode, lineName = l.lineName,
                trackMode = l.trackMode?.let { tm -> TransitTrackMode.entries.firstOrNull { it.name == tm } ?: fail("미지 trackMode $tm") },
                boardName = l.boardName, alightName = l.alightName, boardStop = null, alightStop = null,
                viaStops = l.viaStops.map { TransitLegStop(name = it, lat = 0.0, lng = 0.0) },
                stationCount = l.stationCount, routeId = null, wayCode = null, walkBeforeMinutes = l.walkBeforeMinutes,
            )
        },
        walkAfterMinutes = r.walkAfterMinutes,
    )

    @Test fun `공유 시나리오 표`() {
        val scenarios = Fixtures.sharedJson("transit-progress-overview-scenarios.json", ScenarioFile.serializer()).scenarios
        assertTrue(scenarios.size >= 12)
        for (sc in scenarios) {
            val route = toRoute(sc.route)
            val state = initTransitGuide(route, 0.0).copy(
                legIndex = sc.state.legIndex,
                phase = TransitPhase.entries.firstOrNull { it.name == sc.state.phase } ?: fail("미지 phase ${sc.state.phase}"),
                signal = TransitSignal.entries.firstOrNull { it.name == sc.state.signal } ?: fail("미지 signal ${sc.state.signal}"),
                currentLocation = sc.state.currentLocation,
                arrivedCertain = sc.state.arrivedCertain,
            )
            assertEquals(sc.expected, transitProgressOverview(state, route), "scenario ${sc.name}")
        }
    }

    /** 직렬화 왕복 — 웹 JSON 모양(kind 판별·null 명시)과 같은 인코딩인지. */
    @Test fun `행 직렬화 왕복과 stationCount null 명시`() {
        val rows = listOf(
            TransitOverviewRow.Walk(3),
            TransitOverviewRow.Leg(0, "subway", "5호선", "a", "b", TransitOverviewLegStatus.current, null),
            TransitOverviewRow.Stop(1, "x", TransitOverviewStopRole.via, true),
            TransitOverviewRow.StopsUnavailable,
            TransitOverviewRow.Silence(TransitOverviewSilenceSignal.neverSeen),
        )
        val serializer = ListSerializer(TransitOverviewRow.serializer())
        val text = KitJson.encodeToString(serializer, rows)
        assertEquals(rows, KitJson.decodeFromString(serializer, text))
        assertTrue(text.contains("\"stationCount\":null"), text)
    }
}
