package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.int
import space.dodoplanet.gildongmu.kit.models.TransitLegStop
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** E48 버스 승차 중 현재 정류장 — Kit `TransitBusStopTests` 미러. 공유 fixture `transit-bus-stop-cases.json` 전 케이스를 돈다. */
class TransitBusStopTest {
    @Serializable
    private data class FixtureState(
        val legIndex: Int,
        val phase: String,
        val phaseGen: Int,
        val signal: String,
        val currentLocation: String? = null,
        /** A69 알림 판정이 읽는 도착 피드 잔여(없으면 null). */
        val remaining: Int? = null,
    )

    @Serializable
    private data class FixtureStop(val name: String, val lat: Double, val lng: Double)

    @Serializable
    private data class FixtureLeg(val mode: String? = null, val trackMode: String? = null, val viaStops: List<FixtureStop>? = null)

    @Serializable
    private data class StepExpected(val tracker: TransitBusStopTracker? = null, val verdict: TransitBusStopVerdict, val nearestIndex: Int? = null)

    @Serializable
    private data class AlightStep(
        val fix: TransitDeviceFix,
        val now: Double,
        val state: FixtureState? = null,
        val expected: Expected,
    ) {
        @Serializable
        data class Expected(val speak: Boolean, val notice: TransitBusAlightNotice)
    }

    @Serializable
    private data class Case(
        val name: String,
        val fn: String,
        val state: FixtureState,
        val leg: FixtureLeg? = null,
        val tracker: TransitBusStopTracker? = null,
        val mark: TransitBusStopMark? = null,
        val fix: TransitDeviceFix? = null,
        val now: Double? = null,
        val overview: TransitOverview? = null,
        val notice: TransitBusAlightNotice? = null,
        val steps: List<AlightStep>? = null,
        val expected: JsonElement? = null,
    )

    @Serializable
    private data class CaseFile(val leg: FixtureLeg, val cases: List<Case>)

    private fun makeLeg(base: FixtureLeg, override: FixtureLeg?): TransitGuideLeg {
        val mode = override?.mode ?: base.mode ?: fail("mode")
        val trackMode = override?.trackMode ?: base.trackMode
        val stops = (override?.viaStops ?: base.viaStops ?: emptyList()).map { TransitLegStop(name = it.name, lat = it.lat, lng = it.lng) }
        return TransitGuideLeg(
            mode = mode, lineName = if (mode == "subway") "수도권 5호선" else "340",
            trackMode = trackMode?.let { tm -> TransitTrackMode.entries.firstOrNull { it.name == tm } },
            boardName = stops.firstOrNull()?.name ?: "", alightName = stops.lastOrNull()?.name ?: "",
            boardStop = null, alightStop = null, viaStops = stops,
            stationCount = null, routeId = null, wayCode = null, walkBeforeMinutes = null,
        )
    }

    private fun makeState(s: FixtureState, route: TransitGuideRoute): TransitGuideState = initTransitGuide(route, 0.0).copy(
        legIndex = s.legIndex,
        phase = TransitPhase.entries.firstOrNull { it.name == s.phase } ?: fail("미지 phase ${s.phase}"),
        phaseGen = s.phaseGen,
        signal = TransitSignal.entries.firstOrNull { it.name == s.signal } ?: fail("미지 signal ${s.signal}"),
        currentLocation = s.currentLocation,
        remaining = s.remaining,
    )

    @Test fun `공유 fixture 전 케이스`() {
        val file = Fixtures.sharedJson("transit-bus-stop-cases.json", CaseFile.serializer())
        assertTrue(file.cases.size >= 50)
        var ran = 0
        for (c in file.cases) {
            val leg = makeLeg(file.leg, c.leg)
            // 결박 교체 case가 legIndex 1을 쓰므로 경로에 같은 leg를 두 번 싣는다.
            val route = TransitGuideRoute(legs = listOf(leg, leg), walkAfterMinutes = null)
            val state = makeState(c.state, route)
            val now = c.now ?: 0.0
            val exp = c.expected
            when (c.fn) {
                "step" -> {
                    val out = transitBusStopStep(c.tracker, state, leg, c.fix ?: fail("fix"), now)
                    val expected = KitJson.decodeFromJsonElement(StepExpected.serializer(), exp ?: fail("expected"))
                    assertEquals(expected.verdict, out.verdict, c.name)
                    assertEquals(expected.tracker, out.tracker, c.name)
                    assertEquals(expected.nearestIndex, out.nearestIndex, c.name)
                }
                "mark" -> {
                    val expected = if (exp == null || exp is JsonNull) null else KitJson.decodeFromJsonElement(TransitBusStopMark.serializer(), exp)
                    assertEquals(expected, transitBusStopMark(state, leg, c.tracker, now), c.name)
                }
                "viaHere" -> {
                    val expected = if (exp == null || exp is JsonNull) null else (exp as JsonPrimitive).int
                    assertEquals(expected, transitViaStopHereIndexWithBusStop(state, leg, null, c.mark, now), c.name)
                }
                "overview" -> {
                    val out = transitOverviewApplyingBusStop(c.overview ?: fail("overview"), state, leg, c.mark)
                    assertEquals(KitJson.decodeFromJsonElement(TransitOverview.serializer(), exp ?: fail("expected")), out, c.name)
                }
                "alightNotice" -> {
                    // 시퀀스: 단계마다 추적기 → 알림 기록, 기대값은 단계별 (speak, notice).
                    var tracker = c.tracker
                    var notice = c.notice
                    for ((i, st) in (c.steps ?: fail("steps")).withIndex()) {
                        val stepState = st.state?.let { makeState(it, route) } ?: state
                        val r = transitBusStopStep(tracker, stepState, leg, st.fix, st.now)
                        tracker = r.tracker
                        val out = transitBusAlightNoticeStep(notice, stepState, leg, r, st.fix, st.now)
                        notice = out.notice
                        assertEquals(st.expected.speak, out.speak, "${c.name} #$i")
                        assertEquals(st.expected.notice, out.notice, "${c.name} #$i")
                    }
                }
                else -> fail("unknown fn ${c.fn}")
            }
            ran++
        }
        assertEquals(file.cases.size, ran)
    }

    /** 비유한 좌표 정류장은 후보가 아니다(JSON은 NaN을 싣지 못한다 — 웹 같은 이름 테스트와 짝). */
    @Test fun `비유한 좌표 정류장은 후보가 아니다`() {
        val stops = listOf(
            TransitLegStop(name = "a", lat = 37.5, lng = 127.0),
            TransitLegStop(name = "b", lat = Double.NaN, lng = 127.0),
            TransitLegStop(name = "c", lat = 37.508, lng = 127.0),
        )
        val leg = TransitGuideLeg(
            mode = "bus", lineName = "340", trackMode = TransitTrackMode.seoulBus, boardName = "a", alightName = "c",
            boardStop = null, alightStop = null, viaStops = stops,
            stationCount = null, routeId = null, wayCode = null, walkBeforeMinutes = null,
        )
        val state = initTransitGuide(TransitGuideRoute(legs = listOf(leg), walkAfterMinutes = null), 0.0).copy(phase = TransitPhase.riding)
        val out = transitBusStopStep(null, state, leg, TransitDeviceFix(lat = 37.508, lng = 127.0, accuracy = 10.0, ageSeconds = 0.0), 1000.0)
        assertEquals(2, out.tracker?.pendingIndex)
    }
}
