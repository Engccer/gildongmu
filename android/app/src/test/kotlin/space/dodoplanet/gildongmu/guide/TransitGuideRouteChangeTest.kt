package space.dodoplanet.gildongmu.guide

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import org.junit.jupiter.api.extension.RegisterExtension
import space.dodoplanet.gildongmu.MainDispatcherExtension
import space.dodoplanet.gildongmu.guide.ui.TransitRecoveryControls
import space.dodoplanet.gildongmu.guide.ui.TransitSheetControl
import space.dodoplanet.gildongmu.guide.ui.transitControlExists
import space.dodoplanet.gildongmu.guide.ui.transitDestChangeStatusKey
import space.dodoplanet.gildongmu.guide.ui.transitRecoveryControls
import space.dodoplanet.gildongmu.guide.ui.transitRecoveryStatusKey
import space.dodoplanet.gildongmu.kit.BeaconDest
import space.dodoplanet.gildongmu.kit.GuideSpeechClass
import space.dodoplanet.gildongmu.kit.TransitLabel
import space.dodoplanet.gildongmu.kit.TransitPhase
import space.dodoplanet.gildongmu.kit.models.TransitLegStop
import space.dodoplanet.gildongmu.kit.models.TransitRoute
import space.dodoplanet.gildongmu.kit.models.TransitRouteLeg
import space.dodoplanet.gildongmu.kit.models.TransitRouteSummary
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
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

private fun route(leg: TransitRouteLeg, key: String) = TransitRoute(
    summary = TransitRouteSummary(totalMinutes = 40, fare = 1500, transfers = 0, walkMinutes = 8, departName = "가", arriveName = "라"),
    legs = listOf(TransitRouteLeg(mode = "walk", minutes = 3), leg, TransitRouteLeg(mode = "walk", minutes = 5)),
    routeKey = key,
)

private val BUS_STOPS = busStops("가", "나", "다", "라")

private fun busRoute() = route(
    TransitRouteLeg(mode = "bus", lineName = "146", fromName = "가", toName = "라", stationCount = 3, minutes = 15, serviceRouteId = "R146", stops = BUS_STOPS),
    key = "bus0",
)

private fun fiveLineRoute(key: String = "sub0") = route(
    TransitRouteLeg(
        mode = "subway", lineName = "수도권 5호선", fromName = "천호", toName = "여의도", stationCount = 3, minutes = 15, serviceWayCode = 2,
        stops = subwayStops("천호", "강동", "올림픽공원", "여의도"),
    ),
    key = key,
)

private fun trackWith(code: String, msg: String, vehicleId: String = "v1") =
    """{"mode":"subway","status":"ok","rawCount":1,"items":[{"vehicleId":"$vehicleId","direction":"하행","message":"$msg","remainingStops":null,"destinationName":"방화","express":false,"arrivalCode":"$code"}]}"""

private val NEW_DEST = BeaconDest(37.4979, 127.0276)

/** M5 단계 3-2: 잘못 내림 복구(E78)·목적지 전환·조망 다른 경로. 판정은 :kit이고 여기는 모델의 배선(슬롯·토큰·결과 3-state·발화·폴 재개)을 잠근다. */
@OptIn(ExperimentalCoroutinesApi::class)
class TransitGuideRouteChangeTest {
    private val dispatcher = StandardTestDispatcher()

    @JvmField
    @RegisterExtension
    val main = MainDispatcherExtension(dispatcher)

    private val TransitGuideHarness.phase get() = model.ui.value.state?.phase
    private val TransitGuideHarness.ui get() = model.ui.value

    /** 서울버스 이미 탔어요로 riding — 복구의 출발점은 새 측위(deviceFix)다. */
    private fun TransitGuideHarness.rideBus() {
        model.start(busRoute(), "라 정류장", dest, accessible = false)
        model.boardAlready(express = null)
    }

    /** 지하철 v1을 골라 riding — 복구의 출발점은 「지금 어느 역인가」 질문(askStation)이다. */
    private suspend fun TestScope.rideSubway(h: TransitGuideHarness) {
        h.trackReplies += TransitGuideHarness.okTrack("v1") to 0L
        h.model.start(fiveLineRoute(), "여의도역", h.dest, accessible = false)
        settle()
        h.trackReplies += trackWith("0", "진입") to 0L
        h.model.board(h.ui.waitingLive.single(), TransitLabel("방화행", "To Banghwa"))
        settle()
        assertEquals(TransitPhase.riding, h.phase)
    }

    /** 서울버스가 아닌 새 경로(지하철) — 채택하면 같은 세션의 leg가 바뀐다. */
    private fun adoptable() = fiveLineRoute("adopt")

    private fun TransitGuideHarness.nonRouteUrls() = seenUrls.filterNot { it.contains("/api/route/transit") }

    private fun TransitGuideHarness.fix(index: Int) = GuideFixPayload(
        lat = BUS_STOPS[index].lat, lng = BUS_STOPS[index].lng, accuracy = 5.0, speed = null, speedAccuracy = null,
        course = -1.0, courseAccuracy = -1.0, elapsedRealtimeMs = (now() * 1000).toLong(),
    )

    // ── 잘못 내림 복구 E78 ──

    @Test fun `복구 진입 뒤 위치와 재조회를 거쳐 새 경로를 채택하면 같은 세션의 leg가 바뀌고 폴이 다시 돈다`() = transitTest(dispatcher) { h ->
        h.rideBus()
        settle()
        assertTrue(h.model.recoveryOffered, "버스 riding에서 버튼이 선다")
        h.queueRoute(adoptable())
        h.speaker.spoken.clear()
        h.model.beginRecovery()
        assertEquals(PendingRecovery.Phase.loading, h.ui.pendingRecovery?.phase, "버스는 곧장 조회 중")
        assertTrue(h.speaker.spoken.any { it.second && it.first == h.catalog.get("android.transitGuide.destChangeLoading") }, "조회 중 통지(.high)")
        settle()
        assertEquals(listOf(true), h.coordinateCalls, "복구의 측위는 force")
        assertEquals(1, h.routeCalls.size)
        assertNull(h.ui.pendingRecovery, "채택하면 슬롯이 비워진다")
        assertNull(h.ui.recoveryOutcome)
        assertEquals("subway", h.model.currentLeg?.mode, "같은 세션의 경로 교체")
        assertEquals(TransitPhase.waiting, h.phase)
        assertEquals(0, h.ui.state?.legIndex)
        assertTrue(h.speaker.texts.any { it.startsWith(h.catalog.get("android.transitGuide.routeSwitched")) }, "경로 교체 첫 문장: ${h.speaker.texts}")
        assertTrue(h.haptics.fired.contains(ResultHapticKind.success))
        val before = h.nonRouteUrls().size
        h.trackReplies += TransitGuideHarness.okTrack("v9") to 0L
        pass(60_000)
        assertTrue(h.nonRouteUrls().size > before, "새 세션의 폴이 다시 돈다")
    }

    @Test fun `승차 전 도보가 먼저인 새 경로는 훅이 있으면 환승 도보 인계로 넘기고 안내문 앞 문장을 싣는다`() = transitTest(dispatcher) { h ->
        h.rideBus()
        settle()
        val handoffs = mutableListOf<TransitTransferWalkHandoff>()
        h.model.onTransferWalk = { handoffs += it }
        var passed = 0
        h.model.onPassedPrewalk = { passed += 1 }
        h.queueRoute(adoptable())
        h.model.beginRecovery()
        settle()
        val handoff = assertNotNull(handoffs.singleOrNull(), "승차 전 도보 대상이면 인계")
        assertEquals(0, handoff.legIndex)
        assertEquals(h.catalog.get("android.transitGuide.routeSwitched"), handoff.lead)
        assertEquals(1, passed, "옛 승차 전 도보의 실패 줄을 지운다")
        assertNull(h.ui.pendingRecovery)
        assertEquals("bus", h.model.currentLeg?.mode, "이 모델은 인계에서 끝난다(교체는 도보 뒤 startAfterPrewalk)")
    }

    @Test fun `복구 슬롯이 있는 동안 하차 한 마디는 0이다`() = transitTest(dispatcher) { h ->
        h.rideBus()
        settle()
        h.queueRoute(adoptable(), delayMs = 600_000)
        h.model.beginRecovery()
        settle()
        h.model.handleServiceFix(h.fix(3))
        pass(1_000)
        h.model.handleServiceFix(h.fix(3))
        pass(1_000)
        assertFalse(h.speaker.texts.contains(h.catalog.get("transitGuide.alightStopReached", "라")), "하차 한 마디 0: ${h.speaker.texts}")
        assertNotNull(h.ui.pendingRecovery)
    }

    // 폴 주기가 0보다 큰 잠금(지하철 식별 잠금)이어야 게이트가 실제로 걸린다 — 근사 잠금 버스는 슬롯이 없어도 주기 0이다.
    @Test fun `복구 슬롯이 있는 동안 주기 폴과 복귀 즉폴은 0이고 슬롯이 없으면 복귀 즉폴이 나간다`() = transitTest(dispatcher) { h ->
        rideSubway(h)
        val base = h.nonRouteUrls().size
        h.model.setForeground(false)
        h.model.setForeground(true)
        settle()
        assertTrue(h.nonRouteUrls().size > base, "전제: 슬롯 없이 복귀하면 즉폴이 나간다")
        h.model.beginRecovery()
        settle()
        assertNotNull(h.ui.pendingRecovery)
        val before = h.nonRouteUrls().size
        pass(120_000)
        assertEquals(before, h.nonRouteUrls().size, "슬롯 동안 주기 폴 0")
        h.model.setForeground(false)
        h.model.setForeground(true)
        pass(120_000)
        assertEquals(before, h.nonRouteUrls().size, "슬롯 동안 복귀 즉폴 0")
        assertNotNull(h.ui.pendingRecovery)
    }

    @Test fun `복구 중 사용자 조작은 복구를 이기고 늦은 응답은 버려진다`() = transitTest(dispatcher) { h ->
        h.rideBus()
        settle()
        h.queueRoute(adoptable(), delayMs = 5_000)
        h.model.beginRecovery()
        settle()
        assertNotNull(h.ui.pendingRecovery)
        h.speaker.spoken.clear()
        h.model.declareArrived()
        assertNull(h.ui.pendingRecovery, "사용자 조작이 복구를 이긴다")
        assertNull(h.ui.recoveryOutcome)
        pass(10_000)
        assertEquals("bus", h.model.currentLeg?.mode, "토큰이 바뀐 뒤의 응답은 채택되지 않는다")
        assertNull(h.ui.recoveryOutcome, "결과 행도 세우지 않는다")
        assertFalse(h.speaker.texts.any { it.startsWith(h.catalog.get("android.transitGuide.routeSwitched")) })
    }

    @Test fun `복구 취소 뒤의 늦은 응답은 버려진다`() = transitTest(dispatcher) { h ->
        rideSubway(h)
        h.model.beginRecovery()
        assertEquals(PendingRecovery.Phase.pickStation, h.ui.pendingRecovery?.phase, "지하철은 역부터 묻는다")
        h.queueRoute(adoptable(), delayMs = 5_000)
        h.model.recoverFrom(stationAt = 1)
        settle()
        assertEquals(PendingRecovery.Phase.loading, h.ui.pendingRecovery?.phase)
        h.model.cancelRecovery()
        assertNull(h.ui.pendingRecovery)
        pass(10_000)
        assertNull(h.ui.recoveryOutcome)
        assertEquals(TransitPhase.riding, h.phase, "옛 안내가 복구 없이 이어진다")
    }

    @Test fun `역 고르기 취소는 즉폴로 현재 상태를 다시 판정한다`() = transitTest(dispatcher) { h ->
        rideSubway(h)
        h.model.beginRecovery()
        settle()
        val before = h.nonRouteUrls().size
        pass(60_000)
        assertEquals(before, h.nonRouteUrls().size, "역 질문 동안 폴이 없다")
        assertEquals(0, h.routeCalls.size, "역을 고르기 전엔 조회하지 않는다")
        h.model.cancelRecovery()
        settle()
        assertNull(h.ui.pendingRecovery)
        assertTrue(h.nonRouteUrls().size > before, "취소가 폴을 다시 세운다")
    }

    @Test fun `위치 실패와 조회 실패와 경로 없음과 안내 불가는 서로 다른 결과다`() {
        val seen = mutableMapOf<RecoveryOutcome, String>()
        for (case in listOf("location", "fetch", "none", "unguidable")) {
            transitTest(StandardTestDispatcher()) { h ->
                // 가상 시간은 케이스마다 독립이라 디스패처를 새로 만든다.
                h.rideBus()
                settle()
                when (case) {
                    "location" -> h.coordinateFails = true
                    "fetch" -> h.queueRoute(null, status = 500)
                    "none" -> h.queueRoute(null)
                    else -> h.queueRoute(h.untrackableRoute())
                }
                h.model.beginRecovery()
                settle()
                val outcome = assertNotNull(h.ui.recoveryOutcome, case)
                assertNull(h.ui.pendingRecovery)
                seen[outcome] = case
                assertEquals(if (case == "location") 0 else 1, h.routeCalls.size, "측위 실패는 조회를 부르지 않는다")
                assertEquals("bus", h.model.currentLeg?.mode, "채택 없음: 옛 안내 유지")
                val expectedHaptic = if (outcome == RecoveryOutcome.noLocation || outcome == RecoveryOutcome.fetchFailed) ResultHapticKind.failure else ResultHapticKind.attention
                assertTrue(h.haptics.fired.contains(expectedHaptic), "$case: ${h.haptics.fired}")
            }
        }
        assertEquals(
            mapOf(
                RecoveryOutcome.noLocation to "location", RecoveryOutcome.fetchFailed to "fetch",
                RecoveryOutcome.noRoute to "none", RecoveryOutcome.noGuidable to "unguidable",
            ),
            seen,
        )
    }

    @Test fun `다시 시도는 버스면 새 측위부터 통지 없이 지하철이면 같은 역으로 다시 조회한다`() = transitTest(dispatcher) { h ->
        h.rideBus()
        settle()
        h.coordinateFails = true
        h.model.beginRecovery()
        settle()
        assertEquals(RecoveryOutcome.noLocation, h.ui.recoveryOutcome)
        h.coordinateFails = false
        h.queueRoute(adoptable())
        h.speaker.spoken.clear()
        h.model.retryRecovery()
        assertFalse(h.speaker.texts.contains(h.catalog.get("android.transitGuide.destChangeLoading")), "다시 시도는 조회 중 통지를 겹치지 않는다")
        settle()
        assertEquals(2, h.coordinateCalls.size, "버스는 누름마다 새 측위")
        assertEquals("subway", h.model.currentLeg?.mode)
        assertNull(h.ui.recoveryOutcome)
    }

    @Test fun `지하철 조회 실패의 다시 시도는 같은 역 좌표로 조회한다`() = transitTest(dispatcher) { h ->
        rideSubway(h)
        h.model.beginRecovery()
        h.queueRoute(null, status = 500)
        h.model.recoverFrom(stationAt = 2)
        settle()
        assertEquals(RecoveryOutcome.fetchFailed, h.ui.recoveryOutcome)
        h.queueRoute(adoptable())
        h.model.retryRecovery()
        settle()
        assertEquals(2, h.routeCalls.size)
        assertEquals(h.routeCalls[0].substringAfter("origin="), h.routeCalls[1].substringAfter("origin="), "같은 역")
        assertEquals(emptyList(), h.coordinateCalls, "지하철 복구는 측위를 부르지 않는다")
        assertEquals("subway", h.model.currentLeg?.mode)
    }

    @Test fun `역을 고르지 않고 유휴 상한이 지나면 질문을 거두고 유휴 정지로 간다`() = transitTest(dispatcher) { h ->
        rideSubway(h)
        h.model.beginRecovery()
        assertEquals(0, h.ui.recoveryWithdrawnSeq)
        pass(31 * 60 * 1000L)
        assertNull(h.ui.pendingRecovery)
        assertEquals(1, h.ui.recoveryWithdrawnSeq, "시트가 이 순번으로 질문을 닫는다")
        assertTrue(h.ui.idlePaused, "유휴 정지 판정으로 곧장 간다")
    }

    @Test fun `시트가 최소화돼 있으면 복구 결과 문장을 통지로 내고 떠 있으면 내지 않는다`() {
        for (minimized in listOf(true, false)) {
            transitTest(StandardTestDispatcher()) { h ->
                h.rideBus()
                settle()
                h.minimized = minimized
                h.queueRoute(null)
                h.speaker.spoken.clear()
                h.model.beginRecovery()
                settle()
                val text = h.catalog.get("android.transitGuide.recoveryNoRoute")
                assertEquals(minimized, h.speaker.texts.contains(text), "minimized=$minimized: ${h.speaker.texts}")
            }
        }
    }

    // ── 목적지 전환 ──

    @Test fun `목적지 전환은 후보를 준비하고 확정하면 새 목적지로 계속한다`() = transitTest(dispatcher) { h ->
        h.rideBus()
        settle()
        h.queueRoute(adoptable())
        h.model.prepareDestinationChange(NEW_DEST, "강남역", null)
        assertIs<DestChangePhase.Loading>(h.ui.pendingDestChange?.phase)
        assertEquals("bus", h.model.currentLeg?.mode, "확정 전엔 세션 불변")
        settle()
        assertEquals(listOf(false), h.coordinateCalls)
        val loaded = assertIs<DestChangePhase.Loaded>(h.ui.pendingDestChange?.phase)
        h.speaker.spoken.clear()
        assertTrue(h.model.commitDestinationChange(loaded.result.recommended))
        assertNull(h.ui.pendingDestChange)
        assertEquals(NEW_DEST, h.ui.dest)
        assertEquals("강남역", h.ui.destinationLabel)
        assertEquals("subway", h.model.currentLeg?.mode)
        assertEquals(TransitPhase.waiting, h.phase)
        assertTrue(h.speaker.texts.any { it.contains("강남역") }, "목적지가 바뀌었다는 첫 문장: ${h.speaker.texts}")
    }

    @Test fun `목적지 전환 후보는 경로 없음과 조회 실패와 위치 실패가 서로 다르고 취소는 전체 무효다`() = transitTest(dispatcher) { h ->
        h.rideBus()
        settle()
        h.queueRoute(null)
        h.model.prepareDestinationChange(NEW_DEST, "강남역", null)
        settle()
        assertIs<DestChangePhase.Empty>(h.ui.pendingDestChange?.phase)
        h.queueRoute(null, status = 500)
        h.model.prepareDestinationChange(NEW_DEST, "강남역", null)
        settle()
        assertIs<DestChangePhase.Failed>(h.ui.pendingDestChange?.phase)
        h.coordinateFails = true
        h.model.prepareDestinationChange(NEW_DEST, "강남역", null)
        settle()
        assertIs<DestChangePhase.Failed>(h.ui.pendingDestChange?.phase)
        h.model.cancelDestinationChange()
        assertNull(h.ui.pendingDestChange)
        assertEquals(h.dest, h.ui.dest, "옛 목적지 그대로")
        assertFalse(h.model.commitDestinationChange(busRoute()), "후보 없는 확정은 불발")
    }

    @Test fun `120초가 지난 후보는 확정하지 않고 재조회한다`() = transitTest(dispatcher) { h ->
        h.rideBus()
        settle()
        h.queueRoute(adoptable())
        h.model.prepareDestinationChange(NEW_DEST, "강남역", null)
        settle()
        val loaded = assertIs<DestChangePhase.Loaded>(h.ui.pendingDestChange?.phase)
        pass(121_000)
        h.queueRoute(adoptable())
        h.speaker.spoken.clear()
        assertFalse(h.model.commitDestinationChange(loaded.result.recommended), "stale 후보 확정 금지")
        assertIs<DestChangePhase.Loading>(h.ui.pendingDestChange?.phase)
        assertEquals(h.dest, h.ui.dest)
        assertTrue(h.speaker.spoken.any { it.second && it.first == h.catalog.get("android.transitGuide.destChangeRefetched") })
        settle()
        assertIs<DestChangePhase.Loaded>(h.ui.pendingDestChange?.phase)
        assertEquals(2, h.routeCalls.size)
    }

    @Test fun `목적지 전환 준비는 진행 중인 복구를 이긴다`() = transitTest(dispatcher) { h ->
        h.rideBus()
        settle()
        h.queueRoute(adoptable(), delayMs = 5_000)
        h.model.beginRecovery()
        settle()
        h.queueRoute(adoptable())
        h.model.prepareDestinationChange(NEW_DEST, "강남역", null)
        assertNull(h.ui.pendingRecovery, "경쟁 조작이 복구를 이긴다")
        pass(10_000)
        assertEquals("bus", h.model.currentLeg?.mode, "복구의 늦은 응답은 채택되지 않는다")
    }

    // ── 조망 다른 경로 ──

    @Test fun `다른 경로는 토큰이 맞을 때만 확정되고 취소는 자기 토큰만 지운다`() = transitTest(dispatcher) { h ->
        h.rideBus()
        settle()
        h.queueRoute(adoptable())
        val token = assertNotNull(h.model.prepareAltRoutes(declaredBoardStop = false))
        settle()
        val pending = assertNotNull(h.ui.pendingAltRoutes)
        assertEquals(AltOriginEvidence.Gps, pending.origin)
        val loaded = assertIs<AltRoutesPhase.Loaded>(pending.phase)
        h.model.cancelAltRoutes(token + 99)
        assertNotNull(h.ui.pendingAltRoutes, "남의 토큰은 지우지 않는다")
        assertEquals(AltRouteCommit.sessionEnded, h.model.commitAltRoute(loaded.result.recommended, token = token + 99))
        assertEquals("bus", h.model.currentLeg?.mode)
        assertEquals(AltRouteCommit.committed, h.model.commitAltRoute(loaded.result.recommended, token = token))
        assertNull(h.ui.pendingAltRoutes)
        assertEquals("subway", h.model.currentLeg?.mode)
        h.model.cancelAltRoutes(token)
    }

    @Test fun `다른 경로 후보가 낡으면 같은 근거로 재조회하고 위치 실패는 실패 행이다`() = transitTest(dispatcher) { h ->
        h.rideBus()
        settle()
        h.queueRoute(adoptable())
        val token = assertNotNull(h.model.prepareAltRoutes(declaredBoardStop = false))
        settle()
        val loaded = assertIs<AltRoutesPhase.Loaded>(h.ui.pendingAltRoutes?.phase)
        pass(121_000)
        h.queueRoute(adoptable())
        h.speaker.spoken.clear()
        assertEquals(AltRouteCommit.refetching, h.model.commitAltRoute(loaded.result.recommended, token = token))
        assertTrue(h.speaker.spoken.any { it.second && it.first == h.catalog.get("android.transitGuide.altRefetching") })
        assertTrue((h.ui.pendingAltRoutes?.token ?: token) > token, "재조회는 새 토큰")
        settle()
        assertIs<AltRoutesPhase.Loaded>(h.ui.pendingAltRoutes?.phase)
        h.coordinateFails = true
        h.model.prepareAltRoutes(declaredBoardStop = false)
        settle()
        val failed = assertIs<AltRoutesPhase.Failed>(h.ui.pendingAltRoutes?.phase)
        assertEquals(AltFailReason.noLocation, failed.reason, "승차 중이라 현재역 폴백도 없는 자리는 위치 실패")
    }

    @Test fun `승차역 기준 선언은 대기 국면에서 측위 없이 승차역 좌표로 조회한다`() = transitTest(dispatcher) { h ->
        h.trackReplies += TransitGuideHarness.okTrack("v1") to 0L
        h.model.start(fiveLineRoute(), "여의도역", h.dest, accessible = false)
        settle()
        h.queueRoute(adoptable())
        h.model.prepareAltRoutes(declaredBoardStop = true)
        settle()
        assertEquals(AltOriginEvidence.BoardStopDeclared, h.ui.pendingAltRoutes?.origin)
        assertEquals(emptyList(), h.coordinateCalls)
        assertIs<AltRoutesPhase.Loaded>(h.ui.pendingAltRoutes?.phase)
    }

    @Test fun `세션 종료는 세 슬롯과 결과 행을 모두 비운다`() = transitTest(dispatcher) { h ->
        h.rideBus()
        settle()
        h.queueRoute(null)
        h.model.beginRecovery()
        settle()
        assertNotNull(h.ui.recoveryOutcome)
        h.queueRoute(adoptable())
        h.model.prepareDestinationChange(NEW_DEST, "강남역", null)
        h.model.prepareAltRoutes(declaredBoardStop = false)
        h.model.stop(playStopTone = false)
        assertNull(h.ui.pendingDestChange)
        assertNull(h.ui.pendingAltRoutes)
        assertNull(h.ui.pendingRecovery)
        assertNull(h.ui.recoveryOutcome)
        settle()
        assertNull(h.ui.pendingDestChange, "정지 뒤 걸려 있던 조회 작업이 슬롯을 되살리지 않는다")
        assertFalse(h.model.recoveryOffered)
    }

    // ── 5-D: 시트가 읽는 상태 ──

    @Test fun `검색으로 고른 역에서 복구하면 조회 중 행을 거쳐 결과 행 키와 버튼 집합이 선다`() = transitTest(dispatcher) { h ->
        rideSubway(h)
        h.model.beginRecovery()
        val picking = transitRecoveryControls(h.ui, h.model.recoveryOffered, walkAvailable = h.ui.dest != null)
        assertEquals(TransitRecoveryControls(picking = true, start = false, retry = false, walk = false), picking, "역 질문이 버튼 자리를 대신한다")
        h.queueRoute(null, delayMs = 5_000)
        h.model.recoverFrom(37.55, 127.05)
        settle()
        assertEquals(PendingRecovery.Phase.loading, h.ui.pendingRecovery?.phase)
        assertEquals("android.transitGuide.destChangeLoading", transitRecoveryStatusKey(h.ui))
        pass(10_000)
        assertEquals(RecoveryOutcome.noRoute, h.ui.recoveryOutcome)
        assertEquals("android.transitGuide.recoveryNoRoute", transitRecoveryStatusKey(h.ui))
        val after = transitRecoveryControls(h.ui, h.model.recoveryOffered, walkAvailable = true)
        assertEquals(TransitRecoveryControls(picking = false, start = true, retry = false, walk = true), after, "경로 없음의 다음 행동은 걸어가기 하나")
        assertEquals(false, transitRecoveryControls(h.ui, h.model.recoveryOffered, walkAvailable = false)?.walk)
    }

    @Test fun `목적지 전환 준비는 상태 행에서 후보로 가고 후보가 실리면 행이 없고 확정이면 비운다`() = transitTest(dispatcher) { h ->
        h.rideBus()
        settle()
        h.queueRoute(null)
        h.model.prepareDestinationChange(NEW_DEST, "강남역", null)
        assertEquals("android.transitGuide.destChangeLoading", transitDestChangeStatusKey(h.ui))
        settle()
        assertEquals("android.transitGuide.destChangeNone", transitDestChangeStatusKey(h.ui), "0건은 조회 실패와 다른 문장")
        h.queueRoute(adoptable())
        h.model.prepareDestinationChange(NEW_DEST, "강남역", null)
        settle()
        val loaded = assertIs<DestChangePhase.Loaded>(h.ui.pendingDestChange?.phase)
        assertNull(transitDestChangeStatusKey(h.ui), "후보가 실리면 상태 행이 없다")
        assertFalse(transitControlExists(h.ui, TransitSheetControl.destChangeStatus, false, false))
        assertTrue(h.model.commitDestinationChange(loaded.result.recommended))
        assertNull(h.ui.pendingDestChange)
    }

    @Test fun `시트의 1회성 결과는 문장과 진동을 함께 내고 억제 중이면 진동도 없다`() = transitTest(dispatcher) { h ->
        h.rideBus()
        settle()
        h.model.announceExternalResult("번호를 찾지 못했습니다.", highPriority = true, speechClass = GuideSpeechClass.actionable, haptic = ResultHapticKind.attention)
        settle()
        assertTrue(h.speaker.texts.contains("번호를 찾지 못했습니다."), h.speaker.texts.toString())
        assertEquals(listOf(ResultHapticKind.attention), h.haptics.fired)
        h.haptics.fired.clear()
        h.model.outputSuppressed = true
        h.model.announceExternalResult("억제", highPriority = true, speechClass = GuideSpeechClass.actionable, haptic = ResultHapticKind.failure)
        assertEquals(emptyList(), h.haptics.fired, "문장이 나가는 조건 = 진동이 나가는 조건")
    }
}
