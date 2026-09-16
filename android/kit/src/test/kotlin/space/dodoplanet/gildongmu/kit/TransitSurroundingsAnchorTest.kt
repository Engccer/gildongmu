package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.TransitLegStop
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** E15-2 주변 확인 앵커 판정 — Kit `TransitSurroundingsAnchorTests` 미러. */
class TransitSurroundingsAnchorTest {
    private fun stop(name: String, lat: Double, lng: Double) = TransitLegStop(name = name, lat = lat, lng = lng)

    private fun leg(trackMode: TransitTrackMode?, stops: List<TransitLegStop>) = TransitGuideLeg(
        mode = if (trackMode == TransitTrackMode.subway) "subway" else "bus", lineName = "2호선", trackMode = trackMode,
        boardName = stops.firstOrNull()?.name ?: "", alightName = stops.lastOrNull()?.name ?: "",
        boardStop = stops.firstOrNull(), alightStop = if (stops.size > 1) stops.last() else null,
        viaStops = stops, stationCount = null, routeId = null, wayCode = null, walkBeforeMinutes = null,
    )

    private val subwayStops = listOf(stop("강동", 37.535, 127.132), stop("천호", 37.538, 127.123), stop("광나루", 37.545, 127.103))

    private fun state(l: TransitGuideLeg, phase: TransitPhase, signal: TransitSignal, current: String?) =
        initTransitGuide(TransitGuideRoute(listOf(l), walkAfterMinutes = null), 0.0).copy(phase = phase, signal = signal, currentLocation = current)

    @Test fun `조망이 현재역을 확정할 때만 현재역이다`() {
        val l = leg(TransitTrackMode.subway, subwayStops)
        assertEquals(TransitSurroundingsAnchor.CurrentStation(subwayStops[1]), transitSurroundingsAnchor(state(l, TransitPhase.riding, TransitSignal.tracking, "천호"), l))
    }

    @Test fun `동명 역이면 하차역으로 떨어진다`() {
        val loop = listOf(stop("성수", 37.544, 127.056), stop("뚝섬", 37.547, 127.047), stop("성수", 37.544, 127.056))
        val l = leg(TransitTrackMode.subway, loop)
        assertEquals(TransitSurroundingsAnchor.AlightStop(loop[2]), transitSurroundingsAnchor(state(l, TransitPhase.riding, TransitSignal.tracking, "성수"), l))
    }

    @Test fun `대기 중이면 하차역`() {
        val l = leg(TransitTrackMode.subway, subwayStops)
        assertEquals(TransitSurroundingsAnchor.AlightStop(subwayStops[2]), transitSurroundingsAnchor(state(l, TransitPhase.waiting, TransitSignal.tracking, "천호"), l))
    }

    @Test fun `버스 승차 중이면 하차역`() {
        val l = leg(TransitTrackMode.seoulBus, subwayStops)
        assertEquals(TransitSurroundingsAnchor.AlightStop(subwayStops[2]), transitSurroundingsAnchor(state(l, TransitPhase.riding, TransitSignal.tracking, "천호"), l))
    }

    @Test fun `신호 소실이면 하차역`() {
        val l = leg(TransitTrackMode.subway, subwayStops)
        assertEquals(TransitSurroundingsAnchor.AlightStop(subwayStops[2]), transitSurroundingsAnchor(state(l, TransitPhase.riding, TransitSignal.signalLost, "천호"), l))
    }

    @Test fun `하차역이 없으면 앵커도 없다`() {
        val l = leg(TransitTrackMode.subway, listOf(stop("강동", 37.535, 127.132)))
        assertNull(transitSurroundingsAnchor(state(l, TransitPhase.waiting, TransitSignal.tracking, null), l))
    }
}
