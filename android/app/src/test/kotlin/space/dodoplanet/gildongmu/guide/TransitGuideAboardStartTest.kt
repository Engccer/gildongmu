package space.dodoplanet.gildongmu.guide

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import org.junit.jupiter.api.extension.RegisterExtension
import space.dodoplanet.gildongmu.MainDispatcherExtension
import space.dodoplanet.gildongmu.kit.TransitLabel
import space.dodoplanet.gildongmu.kit.TransitPhase
import space.dodoplanet.gildongmu.kit.buildTransitGuideRoute
import space.dodoplanet.gildongmu.kit.models.TransitLegStop
import space.dodoplanet.gildongmu.kit.models.TransitRoute
import space.dodoplanet.gildongmu.kit.models.TransitRouteLeg
import space.dodoplanet.gildongmu.kit.models.TransitRouteSummary
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
private fun TestScope.settle() { runCurrent(); advanceTimeBy(1); runCurrent() }

private fun stops(vararg names: String) = names.mapIndexed { i, n -> TransitLegStop(name = n, lat = 37.5 + i * 0.01, lng = 127.0 + i * 0.01) }

private fun subwayRoute(via: List<TransitLegStop>) = TransitRoute(
    summary = TransitRouteSummary(totalMinutes = 40, fare = 1500, transfers = 0, walkMinutes = 8, departName = "천호", arriveName = "여의도"),
    legs = listOf(
        TransitRouteLeg(mode = "walk", minutes = 3),
        TransitRouteLeg(
            mode = "subway", lineName = "수도권 5호선", fromName = "천호", toName = "여의도", stationCount = 3, minutes = 15,
            serviceWayCode = 2, stops = via,
        ),
        TransitRouteLeg(mode = "walk", minutes = 5),
    ),
    routeKey = "a0",
)

private fun trackBoth() =
    """{"mode":"subway","status":"ok","rawCount":2,"items":[""" +
        """{"vehicleId":"vDown","direction":"하행","message":"전역 출발","remainingStops":null,"destinationName":"방화","express":false,"arrivalCode":"2"},""" +
        """{"vehicleId":"vUp","direction":"상행","message":"전역 출발","remainingStops":null,"destinationName":"하남검단산","express":false,"arrivalCode":"2"}]}"""

/** E71: 지금 탄 열차에서 시작(iOS `start(... aboard:)`) — 대중교통 모델 몫. */
@OptIn(ExperimentalCoroutinesApi::class)
class TransitGuideAboardStartTest {
    private val dispatcher = StandardTestDispatcher()

    @JvmField
    @RegisterExtension
    val main = MainDispatcherExtension(dispatcher)

    private val full = stops("천호", "강동", "올림픽공원", "여의도")
    private val aboardDown = TransitAboardStart("하행")

    private fun TransitGuideHarness.firstLeg() = buildTransitGuideRoute(subwayRoute(full))!!.legs.first()

    @Test fun `지하철 첫 leg면 열차 고르기 국면으로 열고 방향을 잠그며 대기 문맥을 말하지 않는다`() = transitTest(dispatcher) { h ->
        h.trackReplies += trackBoth() to 0L
        h.model.start(subwayRoute(full), "여의도역", h.dest, accessible = false, aboard = aboardDown)
        val ui = h.model.ui.value
        assertEquals(TransitAboardStep.pickVehicle, ui.aboardStep)
        assertEquals("하행", ui.aboardDirection)
        assertEquals(0, ui.boardOverrideIndex)
        assertTrue(ui.aboardStartLandingPending)
        assertEquals(TransitPhase.waiting, ui.state?.phase)
        val waitContext = h.model.waitContextText(h.firstLeg(), isCurrentLeg = true)
        assertTrue(waitContext.isNotBlank())
        assertFalse(h.speaker.texts.joinToString(" ").contains(waitContext), "승차 중인 사람에게 대기 문맥은 거짓이라 뺀다")
        assertTrue(h.speaker.texts.isNotEmpty(), "시작 통지 자체는 나간다")
    }

    @Test fun `aboard가 없으면 종전 대기 시작이고 대기 문맥을 말한다`() = transitTest(dispatcher) { h ->
        h.model.start(subwayRoute(full), "여의도역", h.dest, accessible = false, aboard = null)
        val ui = h.model.ui.value
        assertNull(ui.aboardStep)
        assertNull(ui.aboardDirection)
        assertNull(ui.boardOverrideIndex)
        assertFalse(ui.aboardStartLandingPending)
        val waitContext = h.model.waitContextText(h.firstLeg(), isCurrentLeg = true)
        assertTrue(h.speaker.texts.joinToString(" ").contains(waitContext))
    }

    @Test fun `시트 첫 착지 표식은 한 번만 소비된다`() = transitTest(dispatcher) { h ->
        h.model.start(subwayRoute(full), "여의도역", h.dest, accessible = false, aboard = aboardDown)
        assertTrue(h.model.consumeAboardStartLanding())
        assertFalse(h.model.consumeAboardStartLanding())
        assertFalse(h.model.ui.value.aboardStartLandingPending)
        assertEquals(TransitAboardStep.pickVehicle, h.model.ui.value.aboardStep, "표식 소비는 국면을 건드리지 않는다")
    }

    @Test fun `첫 leg가 추적 불가이면 aboard를 건너뛰고 종전 대기 시작이다`() = transitTest(dispatcher) { h ->
        h.model.start(h.untrackableRoute(), "나", h.dest, accessible = false, aboard = aboardDown)
        val ui = h.model.ui.value
        assertNull(ui.aboardStep)
        assertNull(ui.aboardDirection)
        assertNull(ui.boardOverrideIndex)
        assertFalse(ui.aboardStartLandingPending)
    }

    @Test fun `경유역이 비어 있으면 aboard를 건너뛰고 종전 대기 시작이다`() = transitTest(dispatcher) { h ->
        h.model.start(subwayRoute(emptyList()), "여의도역", h.dest, accessible = false, aboard = aboardDown)
        val ui = h.model.ui.value
        assertNull(ui.aboardStep)
        assertNull(ui.aboardDirection)
        assertFalse(ui.aboardStartLandingPending)
    }

    @Test fun `승차 전 도보 뒤 시작은 aboard가 없다`() = transitTest(dispatcher) { h ->
        val guideRoute = buildTransitGuideRoute(subwayRoute(full))!!
        h.model.startAfterPrewalk(guideRoute, startLeg = 0, destinationLabel = "여의도역", dest = h.dest, accessible = false, prewalkCompleted = true)
        val ui = h.model.ui.value
        assertNull(ui.aboardStep)
        assertNull(ui.aboardDirection)
        assertFalse(ui.aboardStartLandingPending)
    }

    @Test fun `열차 후보는 고른 방향만 남는다`() = transitTest(dispatcher) { h ->
        h.trackReplies += trackBoth() to 0L
        h.model.start(subwayRoute(full), "여의도역", h.dest, accessible = false, aboard = aboardDown)
        settle()
        assertEquals(setOf("vDown", "vUp"), h.model.ui.value.waitingLive.map { it.vehicleId }.toSet(), "원 목록엔 두 방향이 있다")
        assertEquals(listOf("vDown"), h.model.waitingCandidatesPool().map { it.vehicleId })
    }

    @Test fun `이미 탔어요 일반 흐름은 방향 잠금이 없어 두 방향 후보를 모두 본다`() = transitTest(dispatcher) { h ->
        h.trackReplies += trackBoth() to 0L
        h.model.start(subwayRoute(full), "여의도역", h.dest, accessible = false, aboard = null)
        settle()
        h.model.beginAboard()
        h.model.pickAboardStation(1)
        h.trackReplies += trackBoth() to 0L
        settle()
        assertEquals(setOf("vDown", "vUp"), h.model.waitingCandidatesPool().map { it.vehicleId }.toSet())
    }

    @Test fun `boardAboard는 잠근 방향과 다른 열차를 거부하고 같은 방향은 riding으로 간다`() = transitTest(dispatcher) { h ->
        h.trackReplies += trackBoth() to 0L
        h.model.start(subwayRoute(full), "여의도역", h.dest, accessible = false, aboard = aboardDown)
        settle()
        val up = h.model.ui.value.waitingLive.first { it.vehicleId == "vUp" }
        val down = h.model.ui.value.waitingLive.first { it.vehicleId == "vDown" }
        h.model.boardAboard(up, TransitLabel("하남검단산행"))
        assertEquals(TransitPhase.waiting, h.model.ui.value.state?.phase, "반대 방향은 식별 잠금을 세우지 않는다")
        assertEquals(TransitAboardStep.pickVehicle, h.model.ui.value.aboardStep)
        h.model.boardAboard(down, TransitLabel("방화행"))
        assertEquals(TransitPhase.riding, h.model.ui.value.state?.phase)
        assertNull(h.model.ui.value.aboardStep)
        assertNull(h.model.ui.value.aboardDirection, "riding 진입이 방향 잠금을 푼다")
        assertFalse(h.model.ui.value.aboardStartLandingPending)
    }

    @Test fun `stop이 aboard 표식을 푼다`() = transitTest(dispatcher) { h ->
        h.model.start(subwayRoute(full), "여의도역", h.dest, accessible = false, aboard = aboardDown)
        assertNotNull(h.model.ui.value.aboardDirection)
        h.model.stop(playStopTone = false)
        val ui = h.model.ui.value
        assertNull(ui.aboardStep)
        assertNull(ui.aboardDirection)
        assertNull(ui.boardOverrideIndex)
        assertFalse(ui.aboardStartLandingPending)
        assertFalse(h.model.consumeAboardStartLanding())
    }
}
