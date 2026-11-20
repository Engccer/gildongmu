package space.dodoplanet.gildongmu.guide

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import org.junit.jupiter.api.extension.RegisterExtension
import space.dodoplanet.gildongmu.MainDispatcherExtension
import space.dodoplanet.gildongmu.guide.ui.TRANSIT_OVERVIEW_REBOARD_ID
import space.dodoplanet.gildongmu.guide.ui.TransitOverviewExit
import space.dodoplanet.gildongmu.guide.ui.TransitOverviewItem
import space.dodoplanet.gildongmu.guide.ui.TransitOverviewLatch
import space.dodoplanet.gildongmu.guide.ui.transitAltFromBoardStopLabel
import space.dodoplanet.gildongmu.guide.ui.transitAltHeaderText
import space.dodoplanet.gildongmu.guide.ui.transitOverviewHeaderText
import space.dodoplanet.gildongmu.guide.ui.transitOverviewPerformReboard
import space.dodoplanet.gildongmu.guide.ui.transitOverviewRows
import space.dodoplanet.gildongmu.guide.ui.transitOverviewSilenceText
import space.dodoplanet.gildongmu.kit.TransitLabel
import space.dodoplanet.gildongmu.kit.TransitOverviewSilenceSignal
import space.dodoplanet.gildongmu.kit.TransitPhase
import space.dodoplanet.gildongmu.kit.joinText
import space.dodoplanet.gildongmu.kit.models.TransitLegStop
import space.dodoplanet.gildongmu.kit.models.TransitRoute
import space.dodoplanet.gildongmu.kit.models.TransitRouteLeg
import space.dodoplanet.gildongmu.kit.models.TransitRouteSummary
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
private fun TestScope.settle() { runCurrent(); advanceTimeBy(1); runCurrent() }

private val STOPS = listOf("가", "나", "다", "라").mapIndexed { i, n ->
    TransitLegStop(name = n, cityCode = "1000", arsId = "1000$i", localId = "20$i", lat = 37.5 + i * 0.01, lng = 127.0 + i * 0.01)
}

private fun busRoute(key: String = "bus0") = TransitRoute(
    summary = TransitRouteSummary(totalMinutes = 40, fare = 1500, transfers = 0, walkMinutes = 8, departName = "가", arriveName = "라"),
    legs = listOf(
        TransitRouteLeg(mode = "walk", minutes = 3),
        TransitRouteLeg(mode = "bus", lineName = "146", fromName = "가", toName = "라", stationCount = 3, minutes = 15, serviceRouteId = "R146", stops = STOPS),
        TransitRouteLeg(mode = "walk", minutes = 5),
    ),
    routeKey = key,
)

private fun otherRoute() = TransitRoute(
    summary = TransitRouteSummary(totalMinutes = 30, fare = 1500, transfers = 0, walkMinutes = 8, departName = "천호", arriveName = "여의도"),
    legs = listOf(
        TransitRouteLeg(mode = "walk", minutes = 3),
        TransitRouteLeg(mode = "subway", lineName = "수도권 5호선", fromName = "천호", toName = "여의도", stationCount = 8, minutes = 20, serviceWayCode = 2),
        TransitRouteLeg(mode = "walk", minutes = 5),
    ),
    routeKey = "alt0",
)

/**
 * 대중교통 조망 행 조립(M5 단계 5-E, iOS `TransitOverviewAdapter`) — 순수 함수가 fixture 상태에서 iOS와 같은 문장·순서·정체성을 내는지, 그리고 「다른 경로」
 * 조회 → 확정 흐름이 모델 계약대로 가는지(Compose 페이지는 이 함수들과 모델 호출만 배선한다).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TransitOverviewRowsTest {
    private val dispatcher = StandardTestDispatcher()

    @JvmField
    @RegisterExtension
    val main = MainDispatcherExtension(dispatcher)

    private val TransitGuideHarness.ui get() = model.ui.value

    private fun TransitGuideHarness.rideBus() {
        model.start(busRoute(), "라 정류장", dest, accessible = false)
        model.boardAlready(express = null)
    }

    @Test fun `헤더는 구간 순번 문장과 상태 문장을 한 줄로 잇고 현재역을 말하지 않는다`() = transitTest(dispatcher) { h ->
        h.rideBus()
        settle()
        val s = checkNotNull(h.ui.state)
        val leg = checkNotNull(h.model.currentLeg)
        val ordinal = checkNotNull(h.model.overview).legOrdinal
        val expected = listOf(
            h.catalog.get("transitGuide.overviewOrdinal", ordinal.count.toString(), ordinal.n.toString()),
            h.model.statusLineText(s, leg, now = h.ui.positionClock, speaksLocated = false),
        ).joinToString(" ")
        assertEquals(expected, transitOverviewHeaderText(h.model, h.ui, h.catalog))
        assertTrue(expected.startsWith("1구간 중 1번째 구간.") || expected.contains("번째 구간."), expected)
    }

    @Test fun `행은 원본 행 인덱스 정체성과 iOS 문장 틀을 따른다`() = transitTest(dispatcher) { h ->
        h.rideBus()
        settle()
        val rows = transitOverviewRows(h.model, h.ui, h.catalog, isEn = false, latch = TransitOverviewLatch())
        val ids = rows.map { it.id }
        val legId = ids.first { it.startsWith("leg-") }
        assertTrue(ids.indexOf(legId) < ids.indexOfFirst { it.startsWith("stop-") }, "구간 행 뒤에 정차역 행: $ids")
        val leg = rows.first { it.id == legId } as TransitOverviewItem.Text
        val expected = joinText(
            h.catalog.get("transitGuide.overviewLeg", "1", "146", "가", "라"),
            h.catalog.get("transitGuide.overviewLegCurrent"),
            h.catalog.get("transitGuide.stationCountAbout", "3"),
        )
        assertEquals(expected, leg.text)
        assertTrue(rows.filterIsInstance<TransitOverviewItem.Text>().none { it.text.contains("·") }, "가운뎃점 금지")
        // 탑승 버스를 못 찾은 riding은 순수 계층이 침묵 행과 탈출구를 현재 구간 바로 뒤에 낸다.
        assertEquals(ids.indexOf(legId) + 1, ids.indexOf("silence"), ids.toString())
        assertEquals(ids.indexOf("silence") + 1, ids.indexOf(TRANSIT_OVERVIEW_REBOARD_ID), ids.toString())
        assertEquals(h.catalog.get("transitGuide.changeBoarding"), (rows.single { it.id == TRANSIT_OVERVIEW_REBOARD_ID } as TransitOverviewItem.Action).label)
        // 정차역 행: 승차·하차 표식 틀(`viaBoard`·`viaAlight`)이 붙는다.
        val stopTexts = rows.filter { it.id.startsWith("stop-") }.map { (it as TransitOverviewItem.Text).text }
        assertTrue(stopTexts.isNotEmpty() && stopTexts.first().contains("가") && stopTexts.last().contains("라"), stopTexts.toString())
    }

    @Test fun `래치된 침묵 행과 탈출구는 신호가 회복돼도 남고 문구만 바뀐다`() = transitTest(dispatcher) { h ->
        h.trackReplies += TransitGuideHarness.okTrack("v1") to 0L
        h.model.start(h.subwayRoute(), "여의도역", h.dest, accessible = false)
        settle()
        h.trackReplies += """{"mode":"subway","status":"ok","rawCount":1,"items":[{"vehicleId":"v1","direction":"하행","message":"진입","remainingStops":null,"destinationName":"방화","express":false,"arrivalCode":"0"}]}""" to 0L
        h.model.board(h.ui.waitingLive.single(), TransitLabel("방화행", "To Banghwa"))
        settle()
        assertEquals(TransitPhase.riding, h.ui.state?.phase)
        val latch = TransitOverviewLatch()
        val rows = transitOverviewRows(h.model, h.ui, h.catalog, isEn = false, latch = latch)
        // 순수 계층이 침묵 행·탈출구를 내면 렌더와 동시에 래치된다 — 추적이 회복돼 순수 계층이 더 내지 않아도 행은 남는다.
        val silence = assertNotNull(latch.silence)
        assertTrue(latch.reboard)
        assertEquals(TransitOverviewItem.Action(TRANSIT_OVERVIEW_REBOARD_ID, h.catalog.get("transitGuide.changeBoarding")), rows.single { it.id == TRANSIT_OVERVIEW_REBOARD_ID })
        val ids = rows.map { it.id }
        assertEquals(ids.indexOfFirst { it.startsWith("leg-") } + 1, ids.indexOf("silence"), "현재 구간 바로 뒤: $ids")
        assertEquals(ids.indexOf("silence") + 1, ids.indexOf(TRANSIT_OVERVIEW_REBOARD_ID))
        // 회복 문구(래치만 남은 행)는 같은 행이 문구만 바꾼 것이다.
        assertEquals(h.catalog.get("transitGuide.signalRecovered"), transitOverviewSilenceText(h.model, h.ui, h.catalog, silence, recovered = true))
    }

    @Test fun `탑승 변경은 누른 시점에 riding일 때만 닫힘 뒤 행동을 낸다`() = transitTest(dispatcher) { h ->
        h.model.start(busRoute(), "라 정류장", h.dest, accessible = false)
        settle()
        assertEquals(TransitPhase.waiting, h.ui.state?.phase)
        assertNull(transitOverviewPerformReboard(h.ui), "승차 전엔 낡은 행동이라 아무것도 하지 않는다")
        h.model.boardAlready(express = null)
        settle()
        assertEquals(TransitPhase.riding, h.ui.state?.phase)
        assertEquals(TransitOverviewExit.beginReboard, transitOverviewPerformReboard(h.ui))
    }

    @Test fun `다른 경로 조회 뒤 확정하면 같은 세션의 경로가 바뀌고 슬롯이 비워진다`() = transitTest(dispatcher) { h ->
        h.rideBus()
        settle()
        h.queueRoute(otherRoute())
        val token = assertNotNull(h.model.prepareAltRoutes(declaredBoardStop = false))
        assertEquals(h.catalog.get("android.transitGuide.altHeading"), transitAltHeaderText(h.model, h.ui, h.catalog, isEn = false), "조회 중 헤더는 기준 없는 문장")
        settle()
        val loaded = assertIs<AltRoutesPhase.Loaded>(h.ui.pendingAltRoutes?.phase)
        assertEquals(AltRouteCommit.committed, h.model.commitAltRoute(loaded.result.recommended, token))
        assertNull(h.ui.pendingAltRoutes)
        assertEquals("subway", h.model.currentLeg?.mode)
    }

    @Test fun `승차 전 위치 실패는 승차역 선언 행을 세우고 선언한 조회의 헤더는 승차역을 말한다`() = transitTest(dispatcher) { h ->
        h.coordinateFails = true
        h.model.start(busRoute(), "라 정류장", h.dest, accessible = false)
        settle()
        assertNull(transitAltFromBoardStopLabel(h.model, h.ui, h.catalog, isEn = false).takeIf { h.ui.pendingAltRoutes != null }, "조회 전엔 판정할 슬롯이 없다")
        h.model.prepareAltRoutes(declaredBoardStop = false)
        settle()
        val failed = assertIs<AltRoutesPhase.Failed>(h.ui.pendingAltRoutes?.phase)
        assertEquals(AltFailReason.noLocation, failed.reason)
        assertEquals(h.catalog.get("android.transitGuide.altFromBoardStop", "가"), transitAltFromBoardStopLabel(h.model, h.ui, h.catalog, isEn = false))
        h.queueRoute(otherRoute())
        h.model.prepareAltRoutes(declaredBoardStop = true)
        settle()
        assertIs<AltRoutesPhase.Loaded>(h.ui.pendingAltRoutes?.phase)
        assertEquals(h.catalog.get("android.transitGuide.altHeadingFrom", "가"), transitAltHeaderText(h.model, h.ui, h.catalog, isEn = false))
    }
}
