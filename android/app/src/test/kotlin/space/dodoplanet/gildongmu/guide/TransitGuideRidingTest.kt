package space.dodoplanet.gildongmu.guide

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import org.junit.jupiter.api.extension.RegisterExtension
import space.dodoplanet.gildongmu.MainDispatcherExtension
import space.dodoplanet.gildongmu.guide.TransitGuideHarness.PathReply
import space.dodoplanet.gildongmu.kit.TransitLabel
import space.dodoplanet.gildongmu.kit.TransitPhase
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

@OptIn(ExperimentalCoroutinesApi::class)
private fun TestScope.pass(ms: Long) { advanceTimeBy(ms); runCurrent() }

private fun subwayStops(vararg names: String) = names.mapIndexed { i, n -> TransitLegStop(name = n, lat = 37.5 + i * 0.01, lng = 127.0 + i * 0.01) }

private fun busStops(vararg names: String) = names.mapIndexed { i, n ->
    TransitLegStop(name = n, cityCode = "1000", arsId = "1000$i", localId = "20$i", lat = 37.5 + i * 0.01, lng = 127.0 + i * 0.01)
}

private fun route(leg: TransitRouteLeg) = TransitRoute(
    summary = TransitRouteSummary(totalMinutes = 40, fare = 1500, transfers = 0, walkMinutes = 8, departName = "가", arriveName = "라"),
    legs = listOf(TransitRouteLeg(mode = "walk", minutes = 3), leg, TransitRouteLeg(mode = "walk", minutes = 5)),
    routeKey = "r0",
)

private val SUBWAY_STOPS = subwayStops("천호", "강동", "올림픽공원", "여의도")
private val BUS_STOPS = busStops("가", "나", "다", "라")

private fun fiveLineRoute() = route(
    TransitRouteLeg(
        mode = "subway", lineName = "수도권 5호선", fromName = "천호", toName = "여의도", stationCount = 3, minutes = 15,
        serviceWayCode = 2, stops = SUBWAY_STOPS,
    ),
)

/** 서울 TOPIS 조건(서울 도시 코드·서비스 노선 ID)이 없는 버스 = 지방버스 추적(관측 잠금이라 riding 폴이 돈다). */
private fun tagoRoute() = route(
    TransitRouteLeg(
        mode = "bus", lineName = "9", fromName = "가", toName = "라", stationCount = 3, minutes = 15,
        stops = subwayStops("가", "나", "다", "라"),
    ),
)

private fun busRoute() = route(
    TransitRouteLeg(
        mode = "bus", lineName = "146", fromName = "가", toName = "라", stationCount = 3, minutes = 15,
        serviceRouteId = "R146", stops = BUS_STOPS,
    ),
)

private fun trackWith(code: String, msg: String, vehicleId: String = "v1") =
    """{"mode":"subway","status":"ok","rawCount":1,"items":[{"vehicleId":"$vehicleId","direction":"하행","message":"$msg","remainingStops":null,"destinationName":"방화","express":false,"arrivalCode":"$code"}]}"""

private fun found(station: String, age: Int? = 10) = """{"status":"found","station":"$station","dataAgeSeconds":${age ?: "null"}}"""

private const val LANES_OK = """{"status":"ok","routes":[{"routeId":"R740","lineName":"740"},{"routeId":"R9401","lineName":"9401"}],"unverified":0}"""

/** M5 단계 3-1: 승차 중 현재역(E35)·버스 정류장(E48)·정류장 재기준(E76). 판정은 :kit이고 여기는 모델의 배선(요청 결박·keep-alive·발화·재기준 leg)을 잠근다. */
@OptIn(ExperimentalCoroutinesApi::class)
class TransitGuideRidingTest {
    private val dispatcher = StandardTestDispatcher()

    @JvmField
    @RegisterExtension
    val main = MainDispatcherExtension(dispatcher)

    /** 지하철 v1을 골라 관측 승격(riding)까지 올린다 — 도착 피드는 승차역 「진입」 뒤 비어 있다(미관측). */
    private fun TransitGuideHarness.rideSubway() {
        trackReplies += TransitGuideHarness.okTrack("v1") to 0L
        model.start(fiveLineRoute(), "여의도역", dest, accessible = false)
    }

    private suspend fun TestScope.boardAndRide(h: TransitGuideHarness) {
        h.rideSubway()
        settle()
        h.trackReplies += trackWith("0", "진입") to 0L
        h.model.board(h.model.ui.value.waitingLive.single(), TransitLabel("방화행", "To Banghwa"))
        settle()
    }

    private fun TransitGuideHarness.positionLookups() = seenUrls.count { it.contains("/api/transit/position") }

    private fun TransitGuideHarness.fix(index: Int, accuracy: Double = 5.0, stops: List<TransitLegStop> = BUS_STOPS) = GuideFixPayload(
        lat = stops[index].lat, lng = stops[index].lng, accuracy = accuracy, speed = null, speedAccuracy = null,
        course = -1.0, courseAccuracy = -1.0, elapsedRealtimeMs = (now() * 1000).toLong(),
    )

    /** 서울버스 이미 탔어요로 riding(근사 잠금) — 대기 목록·차량 선택을 건너뛴다. */
    private fun TransitGuideHarness.rideBus() {
        model.start(busRoute(), "라 정류장", dest, accessible = false)
        model.boardAlready(express = null)
    }

    private val TransitGuideHarness.phase get() = model.ui.value.state?.phase

    // ── E35 승차 중 현재역 ──

    @Test fun `지하철 riding에서 도착 피드가 없으면 현재역을 조회하고 상태 문장이 현재역 문장이 된다`() = transitTest(dispatcher) { h ->
        h.queuePath("/api/transit/position", PathReply(200, found("강동")))
        boardAndRide(h)
        assertEquals(TransitPhase.riding, h.phase)
        assertTrue(h.positionLookups() >= 1, "riding 폴 뒤에 위치 조회가 돈다")
        val position = assertNotNull(h.model.ui.value.ridingPosition)
        assertEquals(1, position.stopIndex, "강동 = 경유역 인덱스 1")
        assertTrue(h.model.ui.value.positionClock > 0.0, "조회 시점에 시계를 굳힌다")
        val s = assertNotNull(h.model.ui.value.state)
        val leg = assertNotNull(h.model.currentLeg)
        val expected = h.catalog.get("transitGuide.currentStation", "강동")
        assertEquals(expected, h.model.positionStatusText(s, leg, h.model.ui.value.positionClock))
        assertEquals(1, h.model.viaStopHereIndex, "경유역 목록의 현재 위치도 같은 값")
        assertTrue(h.model.statusLineText(s, leg, h.model.ui.value.positionClock, speaksLocated = true).contains(expected))
        assertFalse(h.model.statusLineText(s, leg, h.model.ui.value.positionClock, speaksLocated = false).contains(expected), "조망 머리 문장은 현재역을 싣지 않는다")
        h.speaker.spoken.clear()
        h.model.announceProgress()
        settle()
        assertTrue(h.speaker.texts.any { it.contains(expected) }, "진행 상황 낭독이 현재역을 말한다: ${h.speaker.texts}")
    }

    @Test fun `조회 중 탑승 변경으로 결박이 바뀐 뒤의 늦은 응답은 버린다`() = transitTest(dispatcher) { h ->
        h.queuePath("/api/transit/position", PathReply(200, found("올림픽공원"), delayMs = 5_000))
        boardAndRide(h)
        assertEquals(1, h.positionLookups(), "조회가 나가 있다")
        assertNull(h.model.ui.value.ridingPosition)
        h.model.changeBoarding()
        assertEquals(TransitPhase.waiting, h.phase)
        pass(6_000)
        assertNull(h.model.ui.value.ridingPosition, "결박이 바뀐 뒤 도착한 응답은 새 결박에 흡수되지 않는다")
        val s = assertNotNull(h.model.ui.value.state)
        val leg = assertNotNull(h.model.currentLeg)
        assertNull(h.model.positionStatusText(s, leg, h.model.ui.value.positionClock))
    }

    @Test fun `조회 실패는 현재역을 지우지 않고 모름 응답은 조회 수만 센다`() = transitTest(dispatcher) { h ->
        h.queuePath("/api/transit/position", PathReply(200, found("강동")))
        h.queuePath("/api/transit/position", PathReply(500, ""))
        h.queuePath("/api/transit/position", PathReply(200, """{"status":"notFound","total":40}"""))
        boardAndRide(h)
        val first = assertNotNull(h.model.ui.value.ridingPosition)
        assertEquals(1, first.stopIndex)
        assertEquals(1, first.lookups)
        pass(60_000)
        val afterFail = assertNotNull(h.model.ui.value.ridingPosition)
        assertEquals(1, afterFail.stopIndex, "조회 실패는 직전 현재역을 지우지 않는다")
        assertEquals(1, afterFail.lookups, "실패는 조회 수에 들지 않는다")
        pass(60_000)
        val afterNotFound = assertNotNull(h.model.ui.value.ridingPosition)
        assertEquals(1, afterNotFound.stopIndex, "보존 창 안의 모름(notFound)도 래치를 지우지 않는다(Kit 규칙)")
        assertEquals(2, afterNotFound.lookups, "받은 응답은 센다")
        val s = assertNotNull(h.model.ui.value.state)
        assertNotNull(h.model.positionStatusText(s, assertNotNull(h.model.currentLeg), h.model.ui.value.positionClock))
    }

    @Test fun `유휴 정지는 미관측 구간의 현재역 래치를 비운다`() = transitTest(dispatcher) { h ->
        h.queuePath("/api/transit/position", PathReply(200, found("강동")))
        boardAndRide(h)
        assertEquals(1, assertNotNull(h.model.ui.value.ridingPosition).stopIndex)
        // 유휴 한계: max(30분, 2×구간 소요) — 조작 없이 넘기면 폴·keep-alive·현재역이 멈춘다.
        pass(31 * 60 * 1000L)
        assertTrue(h.model.ui.value.idlePaused)
        assertNull(h.model.ui.value.ridingPosition?.stopIndex, "유휴 정지가 래치를 비운다(결박·조회 수는 남는다)")
        assertNull(h.model.viaStopHereIndex)
    }

    // ── E48 버스 정류장·keep-alive ──

    @Test fun `버스 승차 중이면 keep-alive 프로파일이 버스용이고 내리면 꺼진다`() = transitTest(dispatcher) { h ->
        h.model.start(tagoRoute(), "라 정류장", h.dest, accessible = false)
        settle()
        h.model.boardApprox()
        h.model.confirmBoarded()
        settle()
        assertEquals(TransitPhase.riding, h.phase)
        assertEquals(GuideLocationProfile.keepAliveBus, h.model.keepAliveWanted.value, "버스 승차 중 = 정류장 판정이 가를 정밀도")
        h.model.declareArrived()
        assertEquals(TransitPhase.arrived, h.phase)
        assertNull(h.model.keepAliveWanted.value, "arrived는 keep-alive를 원하지 않는다")
    }

    @Test fun `지하철 승차 중은 일반 keep-alive이고 세션 종료가 끈다`() = transitTest(dispatcher) { h ->
        boardAndRide(h)
        assertEquals(GuideLocationProfile.keepAlive, h.model.keepAliveWanted.value)
        h.model.stop(playStopTone = false)
        assertNull(h.model.keepAliveWanted.value)
    }

    @Test fun `서비스 fix로 정류장 표식이 서고 만료 타이머가 표식을 거둔다`() = transitTest(dispatcher) { h ->
        h.rideBus()
        settle()
        h.model.handleServiceFix(h.fix(1))
        assertNull(h.model.ui.value.busStopMark, "앞으로는 같은 정류장이 두 번 이어서 관측돼야 옮긴다")
        pass(1_000)
        h.model.handleServiceFix(h.fix(1))
        assertEquals(1, h.model.ui.value.busStopMark?.stopIndex)
        assertEquals(1, h.model.viaStopHereIndex)
        // 보존 창(90초) 뒤 fix가 끊겨도 타이머가 표식을 거둔다.
        pass(91_000)
        assertNull(h.model.ui.value.busStopMark)
        assertNull(h.model.viaStopHereIndex)
    }

    @Test fun `하차 정류장 접근 fix로 하차 한 마디는 한 번만 나간다`() = transitTest(dispatcher) { h ->
        h.rideBus()
        settle()
        val text = h.catalog.get("transitGuide.alightStopReached", "라")
        h.model.handleServiceFix(h.fix(3))
        pass(1_000)
        assertFalse(h.speaker.texts.contains(text), "적격 fix 한 건은 아직 도착이 아니다")
        h.model.handleServiceFix(h.fix(3))
        pass(1_000)
        assertEquals(1, h.speaker.texts.count { it == text }, "연속 두 건이면 도착: ${h.speaker.texts}")
        h.model.handleServiceFix(h.fix(3))
        pass(1_000)
        h.model.handleServiceFix(h.fix(3))
        pass(1_000)
        assertEquals(1, h.speaker.texts.count { it == text }, "정류장에 서 있는 동안 다시 말하지 않는다")
    }

    @Test fun `억제 중 버려진 하차 한 마디는 해제 때 되살리지 않는다`() = transitTest(dispatcher) { h ->
        h.rideBus()
        settle()
        val text = h.catalog.get("transitGuide.alightStopReached", "라")
        h.model.outputSuppressed = true
        h.model.handleServiceFix(h.fix(3))
        pass(1_000)
        h.model.handleServiceFix(h.fix(3))
        pass(1_000)
        assertFalse(h.speaker.texts.contains(text), "억제 중엔 발화 0")
        h.model.outputSuppressed = false
        settle()
        assertFalse(h.speaker.texts.contains(text), "위치 재검증 없는 재생은 정류장을 벗어난 뒤의 거짓이 된다: ${h.speaker.texts}")
    }

    // ── E76 서울버스 정류장 재기준 ──

    @Test fun `서울버스 탑승 변경에서 고른 정류장 기준 leg로 바뀌고 같은 세대의 집합 응답만 반영한다`() = transitTest(dispatcher) { h ->
        h.rideBus()
        settle()
        h.model.beginReboard()
        assertTrue(h.model.ui.value.reboardPickerActive)
        // 첫 고름(1번 정류장)의 응답은 늦고, 그 사이 새 leg에서 다른 정류장을 고른다 — 늦은 응답은 버려진다.
        h.queuePath("phase=lanes", PathReply(200, LANES_OK, delayMs = 3_000))
        h.model.changeBoarding(1)
        h.queuePath("phase=lanes", PathReply(200, LANES_OK.replace("R740", "R7400"), delayMs = 500))
        h.model.changeBoarding(1)
        runCurrent()
        assertEquals(TransitPhase.waiting, h.phase)
        val leg = assertNotNull(h.model.currentLeg)
        assertEquals(BUS_STOPS[2].arsId, leg.boardStop?.arsId, "고른 정류장 기준")
        assertEquals(2, leg.viaStops.size)
        assertTrue(leg.lanesPending)
        val lanesUrls = h.seenUrls.filter { it.contains("phase=lanes") }
        assertEquals(2, lanesUrls.size)
        assertTrue(lanesUrls[0].contains("arsId=${BUS_STOPS[1].arsId}"))
        assertTrue(lanesUrls[1].contains("arsId=${BUS_STOPS[2].arsId}"))
        pass(600)
        val filled = assertNotNull(h.model.currentLeg)
        assertFalse(filled.lanesPending, "같은 세대(두 번째)의 응답만 반영")
        assertEquals(listOf("R146", "R7400", "R9401"), filled.lanes?.map { it.key })
        pass(3_000)
        assertEquals(listOf("R146", "R7400", "R9401"), h.model.currentLeg?.lanes?.map { it.key }, "첫 세대의 늦은 응답은 버려졌다")
    }

    @Test fun `재기준을 취소하면 탑승 변경 직전의 원본 leg로 되돌아간다`() = transitTest(dispatcher) { h ->
        h.rideBus()
        settle()
        val original = assertNotNull(h.model.currentLeg)
        h.model.beginReboard()
        h.queuePath("phase=lanes", PathReply(200, LANES_OK))
        h.model.changeBoarding(1)
        settle()
        assertEquals(BUS_STOPS[1].arsId, h.model.currentLeg?.boardStop?.arsId)
        h.model.cancelChangeBoarding()
        settle()
        assertEquals(original.boardStop, h.model.currentLeg?.boardStop, "원래 승차 정류장")
        assertEquals(original.viaStops, h.model.currentLeg?.viaStops)
        assertEquals(TransitPhase.riding, h.phase, "직전 국면으로 복귀")
    }

    @Test fun `정류장 목록 밖 인덱스는 재기준 없이 원래 leg 대기로 간다`() = transitTest(dispatcher) { h ->
        h.rideBus()
        settle()
        val original = assertNotNull(h.model.currentLeg)
        h.model.beginReboard()
        h.model.changeBoarding(0)
        settle()
        assertEquals(TransitPhase.waiting, h.phase)
        assertEquals(original, h.model.currentLeg, "첫 정류장(원래 승차)은 leg를 바꾸지 않는다")
        assertTrue(h.seenUrls.none { it.contains("phase=lanes") })
    }
}
