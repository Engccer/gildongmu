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
import space.dodoplanet.gildongmu.kit.TransitWaitingEmptyReason
import space.dodoplanet.gildongmu.kit.buildTransitGuideRoute
import space.dodoplanet.gildongmu.kit.transitUnreachableReason
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

private fun route(vararg legs: TransitRouteLeg, key: String = "u0") = TransitRoute(
    summary = TransitRouteSummary(totalMinutes = 40, fare = 1500, transfers = legs.size - 1, walkMinutes = 8, departName = "천호", arriveName = "여의도"),
    legs = listOf(TransitRouteLeg(mode = "walk", minutes = 3)) + legs + listOf(TransitRouteLeg(mode = "walk", minutes = 5)),
    routeKey = key,
)

private fun subwayLeg(
    from: String, to: String, line: String = "수도권 5호선", via: List<TransitLegStop> = stops(from, "강동", "올림픽공원", to),
    expressStops: List<String>? = null,
) = TransitRouteLeg(
    mode = "subway", lineName = line, fromName = from, toName = to, stationCount = via.size - 1, minutes = 15,
    serviceWayCode = 2, stops = via, expressStops = expressStops,
)

private fun track(code: String, msg: String, vehicleId: String = "v1") =
    """{"mode":"subway","status":"ok","rawCount":1,"items":[{"vehicleId":"$vehicleId","direction":"하행","message":"$msg","remainingStops":null,"destinationName":"방화","express":false,"arrivalCode":"$code"}]}"""

/** M5 단계 2-2: 사용자 동작. 국면·관찰 값·발화·폴 예약을 잠근다(판정은 :kit). */
@OptIn(ExperimentalCoroutinesApi::class)
class TransitGuideUserActionsTest {
    private val dispatcher = StandardTestDispatcher()

    @JvmField
    @RegisterExtension
    val main = MainDispatcherExtension(dispatcher)

    private fun TransitGuideHarness.begin(r: TransitRoute = route(subwayLeg("천호", "여의도"))) =
        model.start(r, "여의도역", dest, accessible = false, aboard = null)

    private val TransitGuideHarness.phase get() = model.ui.value.state?.phase

    /** 대기 폴로 후보 v1을 채우고 시작한다. */
    private fun TransitGuideHarness.beginWithCandidate(r: TransitRoute = route(subwayLeg("천호", "여의도"))) {
        trackReplies += TransitGuideHarness.okTrack("v1") to 0L
        begin(r)
    }

    @Test fun `탑승부터 관측 승격과 하차 도착 뒤 다음 구간까지`() = transitTest(dispatcher) { h ->
        h.beginWithCandidate(route(subwayLeg("천호", "여의도"), subwayLeg("여의도", "강남", line = "수도권 9호선")))
        settle()
        assertNull(h.model.keepAliveWanted.value)
        val item = h.model.ui.value.waitingLive.single()
        // 선택 차량 조회: 승차역에서 「진입」을 관측하면 상태 머신이 riding으로 올린다.
        h.trackReplies += track("0", "진입") to 0L
        val urlsBefore = h.seenUrls.size
        h.model.board(item, TransitLabel("방화행", "To Banghwa"))
        assertEquals(TransitPhase.boarding, h.phase)
        assertEquals("방화행", h.model.ui.value.selectedDescription?.ko)
        assertNotNull(h.model.keepAliveWanted.value, "boarding은 keep-alive를 원한다(A46)")
        assertEquals(1, h.model.ui.value.userTransitionSeq)
        settle()
        assertTrue(h.seenUrls.size > urlsBefore, "선택 즉시 즉폴")
        assertEquals(TransitPhase.riding, h.phase, "관측 승격")
        assertNull(h.model.ui.value.boardOverrideIndex)
        // 하차 도착 선언 → arrived(확정) → 다음 구간.
        h.model.declareArrived()
        assertEquals(TransitPhase.arrived, h.phase)
        h.model.advance()
        settle()
        assertEquals(1, h.model.ui.value.state?.legIndex)
        assertEquals(TransitPhase.waiting, h.phase)
        assertNull(h.model.ui.value.selectedDescription, "전진이 선택 설명을 지운다")
        assertTrue(h.model.ui.value.isTracking)
    }

    @Test fun `대기 국면이 아니거나 도달 불가 차량이면 탑승하지 않는다`() = transitTest(dispatcher) { h ->
        h.beginWithCandidate()
        settle()
        val item = h.model.ui.value.waitingLive.single()
        h.model.confirmBoarded()
        assertEquals(TransitPhase.waiting, h.phase, "boarding이 아니면 confirmBoarded는 무동작")
        h.model.board(item, null)
        assertEquals(TransitPhase.boarding, h.phase)
        h.model.board(item, null)
        assertEquals(TransitPhase.boarding, h.phase, "boarding 중 재선택은 무시")
    }

    @Test fun `내릴 역 앞에서 끝나는 도달 불가 차량은 탑승을 거부한다`() = transitTest(dispatcher) { h ->
        val r = route(subwayLeg("천호", "여의도"))
        // 경유역 [천호, 강동, 올림픽공원, 여의도]에서 강동행은 내릴 역에 닿지 않는다.
        h.trackReplies += TransitGuideHarness.okTrack("v1", destinationName = "강동") to 0L
        h.begin(r)
        settle()
        val item = h.model.ui.value.waitingLive.single()
        val leg = buildTransitGuideRoute(r)!!.legs.first()
        assertNotNull(transitUnreachableReason(item, leg), "입력이 실제로 도달 불가여야 한다")
        h.model.board(item, null)
        assertEquals(TransitPhase.waiting, h.phase, "도달 불가 차량은 선택되지 않는다")
        assertEquals(0, h.model.ui.value.userTransitionSeq)
    }

    @Test fun `선택한 열차에 탔어요는 boarding에서 riding으로 선언한다`() = transitTest(dispatcher) { h ->
        h.beginWithCandidate()
        settle()
        h.model.board(h.model.ui.value.waitingLive.single(), null)
        settle()
        assertEquals(TransitPhase.boarding, h.phase)
        h.model.confirmBoarded()
        assertEquals(TransitPhase.riding, h.phase)
        assertEquals(2, h.model.ui.value.userTransitionSeq)
        assertFalse(h.model.ui.value.boardingManualAvailable)
    }

    @Test fun `이미 탔어요 근사 잠금은 riding이고 마지막 구간 advanceIntoWalkHandoff가 인계를 남긴다`() = transitTest(dispatcher) { h ->
        h.begin()
        settle()
        h.model.boardAlready(express = null)
        assertEquals(TransitPhase.riding, h.phase)
        assertEquals(true, h.model.isOnFinalLeg)
        assertEquals(5, h.model.finalLegWalkMinutes)
        val texts = h.speaker.texts.size
        assertTrue(h.model.advanceIntoWalkHandoff())
        settle()
        assertFalse(h.model.ui.value.isTracking)
        assertEquals(5, h.model.ui.value.pendingWalkHandoff?.walkMinutes)
        assertEquals("여의도역", h.model.ui.value.pendingWalkHandoff?.destinationLabel)
        assertFalse(h.speaker.texts.drop(texts).any { it.contains(h.catalog.get("transitGuide.doneWalk", "5")) }, "doneWalk는 침묵")
        h.model.clearWalkHandoff()
        assertNull(h.model.ui.value.pendingWalkHandoff)
    }

    @Test fun `advance는 마지막 구간에서 완료 문장을 낸다`() = transitTest(dispatcher) { h ->
        h.begin()
        settle()
        h.model.boardAlready(express = null)
        h.model.advance()
        settle()
        assertFalse(h.model.ui.value.isTracking)
        assertEquals(5, h.model.ui.value.pendingWalkHandoff?.walkMinutes)
        assertTrue(h.speaker.texts.any { it.contains(h.catalog.get("transitGuide.doneWalk", "5")) }, h.speaker.texts.toString())
    }

    @Test fun `환승 도보 훅이 있으면 전진을 커밋하지 않고 넘긴다`() = transitTest(dispatcher) { h ->
        val r = route(subwayLeg("천호", "여의도"), subwayLeg("여의도", "강남", line = "수도권 9호선"), key = "u1")
        // 둘째 구간 앞에 걷기 분을 둔다(환승 도보): 구간 사이 도보 leg.
        val withWalk = r.copy(legs = listOf(r.legs[0], r.legs[1], TransitRouteLeg(mode = "walk", minutes = 4), r.legs[2], r.legs[3]))
        var handed: TransitTransferWalkHandoff? = null
        var passed = 0
        h.model.onTransferWalk = { handed = it }
        h.model.onPassedPrewalk = { passed += 1 }
        h.begin(withWalk)
        settle()
        h.model.boardAlready(express = null)
        assertEquals(1, passed, "riding 진입이 승차 전 도보를 닫는다")
        h.model.advance()
        settle()
        val hand = assertNotNull(handed)
        assertEquals(1, hand.legIndex)
        assertEquals(0, h.model.ui.value.state?.legIndex, "전진은 커밋되지 않는다")
        assertEquals(2, passed, "넘기는 순간에도 한 번 더 알린다(A68)")
    }

    @Test fun `환승 도보 훅이 없으면 종전 전진을 커밋한다`() = transitTest(dispatcher) { h ->
        val r = route(subwayLeg("천호", "여의도"), subwayLeg("여의도", "강남", line = "수도권 9호선"), key = "u1")
        val withWalk = r.copy(legs = listOf(r.legs[0], r.legs[1], TransitRouteLeg(mode = "walk", minutes = 4), r.legs[2], r.legs[3]))
        h.begin(withWalk)
        settle()
        h.model.boardAlready(express = null)
        h.model.advance()
        settle()
        assertEquals(1, h.model.ui.value.state?.legIndex)
    }

    @Test fun `재승차 픽커는 지하철 승차 중에 열리고 취소하면 닫힌다`() = transitTest(dispatcher) { h ->
        h.beginWithCandidate()
        settle()
        h.model.board(h.model.ui.value.waitingLive.single(), null)
        h.model.confirmBoarded()
        assertEquals(TransitPhase.riding, h.phase)
        h.model.beginReboard()
        assertTrue(h.model.ui.value.reboardPickerActive)
        h.model.cancelReboard()
        assertFalse(h.model.ui.value.reboardPickerActive)
        h.model.beginReboard()
        h.model.changeBoarding(1)
        settle()
        assertFalse(h.model.ui.value.reboardPickerActive)
        assertEquals(TransitPhase.waiting, h.phase)
        assertEquals(1, h.model.ui.value.boardOverrideIndex)
        assertEquals("강동", h.model.boardOverrideName)
        // 탑승 변경 취소: 직전 잠금·국면(riding)으로 복귀.
        h.model.cancelChangeBoarding()
        assertEquals(TransitPhase.riding, h.phase)
    }

    @Test fun `탑승 변경 진입은 픽커 없이 곧장 재선택하는 수단도 있다`() = transitTest(dispatcher) { h ->
        h.beginWithCandidate()
        settle()
        h.model.board(h.model.ui.value.waitingLive.single(), null)
        assertEquals(TransitPhase.boarding, h.phase)
        h.model.changeBoarding()
        assertEquals(TransitPhase.waiting, h.phase)
        h.model.cancelChangeBoarding()
        assertEquals(TransitPhase.boarding, h.phase, "boarding에서 변경했으면 boarding으로 복귀")
    }

    @Test fun `하차 선언은 대기와 승차 중 어디서든 확정 도착으로 끝낸다`() = transitTest(dispatcher) { h ->
        h.begin()
        settle()
        val urls = h.seenUrls.size
        h.model.declareArrived()
        assertEquals(TransitPhase.arrived, h.phase)
        assertEquals(true, h.model.ui.value.state?.arrivedCertain)
        settle()
        advanceTimeBy(120_000); runCurrent()
        assertEquals(urls, h.seenUrls.size, "확정 도착은 폴 주기 0")
        h.model.declareArrived()
        assertEquals(TransitPhase.arrived, h.phase)
    }

    @Test fun `이미 탔어요 역 선택에서 열차 선택으로 riding 직행한다`() = transitTest(dispatcher) { h ->
        h.beginWithCandidate()
        settle()
        h.model.beginAboard()
        assertEquals(TransitAboardStep.pickStation, h.model.ui.value.aboardStep)
        h.model.pickAboardStation(1)
        assertEquals(TransitAboardStep.pickVehicle, h.model.ui.value.aboardStep)
        assertEquals(1, h.model.ui.value.boardOverrideIndex)
        h.trackReplies += TransitGuideHarness.okTrack("v1") to 0L
        settle()
        val item = h.model.waitingCandidatesPool().single()
        h.model.pickAnotherAboardStation()
        assertEquals(TransitAboardStep.pickStation, h.model.ui.value.aboardStep)
        h.model.pickAboardStation(2)
        h.model.boardAboard(item, TransitLabel("방화행"))
        assertEquals(TransitPhase.riding, h.phase)
        assertNull(h.model.ui.value.aboardStep)
        assertNull(h.model.ui.value.boardOverrideIndex, "riding 진입이 기준 역을 푼다")
        assertEquals("방화행", h.model.ui.value.selectedDescription?.ko)
        assertFalse(h.model.consumeAboardStartLanding())
        assertFalse(h.model.ui.value.aboardStartLandingPending)
    }

    @Test fun `이미 탔어요 역 선택에서 하차역을 고르면 도착 선언이다`() = transitTest(dispatcher) { h ->
        h.begin()
        settle()
        h.model.beginAboard()
        h.model.pickAboardStation(3)
        assertEquals(TransitPhase.arrived, h.phase)
        assertNull(h.model.ui.value.aboardStep)
        h.model.cancelAboard()
        assertNull(h.model.ui.value.aboardStep)
    }

    @Test fun `이미 탔어요 취소와 대기 아님 가드`() = transitTest(dispatcher) { h ->
        h.begin()
        settle()
        h.model.beginAboard()
        h.model.cancelAboard()
        assertNull(h.model.ui.value.aboardStep)
        h.model.pickAboardStation(1)
        assertNull(h.model.ui.value.aboardStep, "역 묻기 단계가 아니면 무시")
        h.model.boardAlready(express = null)
        h.model.beginAboard()
        assertNull(h.model.ui.value.aboardStep, "대기가 아니면 무시")
    }

    @Test fun `급행 확인에서 통과 급행이면 잠그지 않고 차단 문장을 남긴다`() = transitTest(dispatcher) { h ->
        h.begin(route(subwayLeg("천호", "여의도", line = "수도권 9호선", expressStops = listOf("천호", "강동"))))
        settle()
        h.model.boardAlready(express = true)
        assertEquals(TransitPhase.waiting, h.phase)
        assertNotNull(h.model.ui.value.expressBlockedNote)
        assertTrue(h.model.ui.value.expressBlockedNote!!.contains("여의도"))
        // 일반으로 답하면 잠금이 서고 차단 문장은 지워진다.
        h.model.boardAlready(express = false)
        assertEquals(TransitPhase.riding, h.phase)
        assertNull(h.model.ui.value.expressBlockedNote)
    }

    @Test fun `급행이 하차역에 서면 급행 선언 잠금이다`() = transitTest(dispatcher) { h ->
        h.begin(route(subwayLeg("천호", "여의도", line = "수도권 9호선", expressStops = listOf("천호", "여의도"))))
        settle()
        h.model.boardAlready(express = true)
        assertEquals(TransitPhase.riding, h.phase)
        assertEquals(true, h.model.ui.value.state?.lock?.express)
        assertNull(h.model.ui.value.expressBlockedNote)
    }

    @Test fun `착지 폴백은 빈 문장을 내지 않고 높은 우선순위로 즉시 낸다`() = transitTest(dispatcher) { h ->
        h.begin()
        settle()
        val before = h.speaker.texts.size
        h.model.announceLandingFallback("")
        settle()
        assertEquals(before, h.speaker.texts.size)
        h.model.announceLandingFallback("착지 라벨")
        settle()
        assertEquals("착지 라벨", h.speaker.texts.last())
    }

    @Test fun `새로고침은 다음 대기 폴 결과를 직접 응답으로 통지한다`() = transitTest(dispatcher) { h ->
        h.begin()
        settle()
        val before = h.speaker.texts.size
        val urls = h.seenUrls.size
        h.trackReplies += TransitGuideHarness.okTrack("v9") to 0L
        h.model.refreshWaiting()
        settle()
        assertTrue(h.seenUrls.size > urls, "즉폴")
        assertTrue(h.speaker.texts.size > before, "직접 응답 통지: ${h.speaker.texts}")
        assertEquals(listOf("v9"), h.model.ui.value.waitingLive.map { it.vehicleId })
        assertTrue(h.speaker.texts.contains(h.catalog.get("transitGuide.waitingCount", 1)), h.speaker.texts.toString())
    }

    @Test fun `새로고침이 조회 실패면 0개가 아니라 조회 실패 사유를 말한다`() = transitTest(dispatcher) { h ->
        h.begin()
        settle()
        h.failNextTrack = true
        h.model.refreshWaiting()
        settle()
        assertEquals(TransitWaitingEmptyReason.unavailable, h.model.ui.value.waitingReason)
        assertTrue(h.speaker.texts.contains(h.catalog.get("transitGuide.noCandidatesUnavailable")), h.speaker.texts.toString())
        assertFalse(h.speaker.texts.contains(h.catalog.get("transitGuide.waitingCount", 0)), h.speaker.texts.toString())
    }

    @Test fun `사용자 동작이 유휴 정지를 푼다`() = transitTest(dispatcher) { h ->
        h.begin()
        settle()
        advanceTimeBy(90 * 60_000L)
        runCurrent()
        assertTrue(h.model.ui.value.idlePaused)
        val urls = h.seenUrls.size
        h.model.refreshWaiting()
        settle()
        assertFalse(h.model.ui.value.idlePaused)
        assertTrue(h.speaker.texts.any { it.contains(h.catalog.get("transitGuide.resumed")) }, h.speaker.texts.toString())
        assertTrue(h.seenUrls.size > urls)
    }

    @Test fun `탑승 변경 진입도 유휴 정지를 푼다`() = transitTest(dispatcher) { h ->
        h.begin()
        settle()
        advanceTimeBy(90 * 60_000L)
        runCurrent()
        assertTrue(h.model.ui.value.idlePaused, "먼저 유휴 정지에 들어가 있어야 한다")
        h.model.beginReboard()
        assertFalse(h.model.ui.value.idlePaused)
        assertTrue(h.model.ui.value.reboardPickerActive)
    }
}
