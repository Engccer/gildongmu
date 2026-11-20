package space.dodoplanet.gildongmu.guide

import space.dodoplanet.gildongmu.guide.ui.transitStartFailureShown
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.extension.RegisterExtension
import space.dodoplanet.gildongmu.MainDispatcherExtension
import space.dodoplanet.gildongmu.kit.TransitPhase
import space.dodoplanet.gildongmu.kit.models.TransitLegExit
import space.dodoplanet.gildongmu.kit.models.TransitLegStop
import space.dodoplanet.gildongmu.kit.models.TransitRoute
import space.dodoplanet.gildongmu.kit.models.TransitRouteLeg
import space.dodoplanet.gildongmu.kit.models.TransitRouteSummary
import space.dodoplanet.gildongmu.location.LocationPermission
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

/** 도보 워치독이 무한 루프라 `advanceUntilIdle`은 끝나지 않는다 — 현재 시각의 태스크만 소진한다. */
@OptIn(ExperimentalCoroutinesApi::class)
private fun TestScope.settle() { runCurrent(); advanceTimeBy(1); runCurrent() }

/** 가상 시간을 `ms`만큼 밀고 그 시각의 태스크를 소진한다. */
@OptIn(ExperimentalCoroutinesApi::class)
private fun TestScope.after(ms: Long) { advanceTimeBy(ms); runCurrent() }

private fun stops(vararg names: String) = names.mapIndexed { i, n -> TransitLegStop(name = n, lat = 37.5 + i * 0.01, lng = 127.0 + i * 0.01) }

/** 앞 도보 3분 + 탑승 구간들 + 말미 도보 5분. 탑승역 좌표가 있어 승차 전 도보 대상이 선다(`transitPrewalkTarget`). */
private fun route(vararg legs: TransitRouteLeg, key: String = "u0") = TransitRoute(
    summary = TransitRouteSummary(totalMinutes = 40, fare = 1500, transfers = legs.size - 1, walkMinutes = 8, departName = "천호", arriveName = "여의도"),
    legs = listOf(TransitRouteLeg(mode = "walk", minutes = 3)) + legs + listOf(TransitRouteLeg(mode = "walk", minutes = 5)),
    routeKey = key,
)

private fun subwayLeg(
    from: String, to: String, line: String = "수도권 5호선", via: List<TransitLegStop> = stops(from, "강동", "올림픽공원", to), exit: TransitLegExit? = null,
) = TransitRouteLeg(
    mode = "subway", lineName = line, fromName = from, toName = to, stationCount = via.size - 1, minutes = 15, serviceWayCode = 2, stops = via, exit = exit,
)

/** 두 탑승 구간 사이에 걷기 4분(환승 도보 E73). */
private fun transferRoute(): TransitRoute {
    val r = route(subwayLeg("천호", "여의도"), subwayLeg("여의도", "강남", line = "수도권 9호선"), key = "u1")
    return r.copy(legs = listOf(r.legs[0], r.legs[1], TransitRouteLeg(mode = "walk", minutes = 4), r.legs[2], r.legs[3]))
}

private const val PREWALK_START_TAIL = "도보 안내를 먼저 시작합니다."
private const val PREWALK_BRIDGE_TAIL = "도보 안내를 시작할 수 없어 승차 대기로 바로 넘어갑니다."

/**
 * M5 §6-6·§6-8 도보 인계 단계: `GuideSession`이 대중교통 시작·승차 전 도보(A25)·환승 도보(E73)·하차 인계(E34/E84)·재시작(A68)을 한 전이 순서로 잇는다.
 * 앱 조립(`attach`)과 같은 모양으로 두 모델이 한 벌의 포트를 공유하고, 모델 훅은 `attachForTest`가 배선한다.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class GuideTransitHandoffTest {
    private val dispatcher = StandardTestDispatcher()

    @JvmField
    @RegisterExtension
    val main = MainDispatcherExtension(dispatcher)

    private fun joint(body: suspend TestScope.(GuideTestHarness, TransitGuideHarness) -> Unit) = runTest(dispatcher) {
        val w = GuideTestHarness(dispatcher)
        val t = TransitGuideHarness(dispatcher, shared = w)
        w.controller.route = GuideSession::serviceStartFailed
        GuideSession.attachForTest(w.model, w.coordinator, t.model, w.speaker)
        try { body(w, t) } finally {
            w.close()
            t.close()
            GuideSession.attachForTest(w.model, w.coordinator)
        }
    }

    private fun TransitGuideHarness.request(r: TransitRoute = route(subwayLeg("천호", "여의도"))) =
        TransitStartRequest(r, "여의도역", dest, accessible = false)

    @Test fun `승차 전 도보 도착 뒤 600ms에 대중교통이 그 구간에서 선다`() = joint { w, t ->
        GuideSession.startTransit(t.request())
        settle()
        // 실제 beginBeacon을 지난 도보 세션: 표식이 살아 있다(연결 자신의 시작은 취소 게이트를 지나지 않는다).
        assertTrue(w.model.isTracking)
        val station = assertNotNull(w.model.ui.value.prewalkTarget, "승차 전 도보 표식")
        assertEquals("천호", station.ko.removeSuffix("역"))
        assertFalse(t.model.isTracking)
        assertTrue(w.speaker.texts.any { it.endsWith(PREWALK_START_TAIL) }, w.speaker.texts.toString())

        w.model.declarePrewalkArrival()
        settle()
        assertFalse(w.model.isTracking)
        assertNull(w.model.ui.value.arrivalDest, "승차 전 도보는 종료 화면을 남기지 않는다")
        after(590)
        assertFalse(t.model.isTracking, "600ms 전에는 서지 않는다")
        after(20)
        assertTrue(t.model.isTracking)
        assertEquals(0, t.model.ui.value.state?.legIndex)
        assertNull(t.model.ui.value.route?.legs?.first()?.walkBeforeMinutes, "걸어 왔으니 앞 도보를 다시 말하지 않는다(prewalkCompleted)")
    }

    @Test fun `승차 전 도보 시작 실패는 다리 문장 낭독을 기다린 뒤 걷기 전 상태로 대중교통을 연다`() = joint { w, t ->
        w.perms.enabled = false
        w.speaker.isSpeaking = true  // 도보 모델의 원인·다리 통지가 아직 낭독 중
        GuideSession.startTransit(t.request())
        settle()
        assertFalse(w.model.isTracking)
        assertNull(w.model.ui.value.prewalkTarget, "시작 실패가 표식을 지운다")
        assertTrue(w.speaker.texts.any { it.endsWith(PREWALK_BRIDGE_TAIL) }, w.speaker.texts.toString())
        after(2_000)
        assertFalse(t.model.isTracking, "낭독이 끝날 때까지 기다린다")
        w.speaker.isSpeaking = false
        after(150)
        assertTrue(t.model.isTracking)
        assertEquals(3, t.model.ui.value.route?.legs?.first()?.walkBeforeMinutes, "아직 걷지 않았다(prewalkCompleted = false)")
    }

    @Test fun `시작 실패 대기에는 8초 상한이 있다`() = joint { w, t ->
        w.perms.enabled = false
        w.speaker.isSpeaking = true
        GuideSession.startTransit(t.request())
        settle()
        after(7_900)
        assertFalse(t.model.isTracking)
        after(200)
        assertTrue(t.model.isTracking, "낭독이 끝나지 않아도 상한에서 연다")
    }

    @Test fun `환승 도보는 대중교통을 멈추고 600ms 뒤 걷기, 도착하면 다음 구간 대기로 돌아온다`() = joint { w, t ->
        t.model.start(transferRoute(), "여의도역", t.dest, accessible = false)
        settle()
        t.model.boardAlready(express = null)
        t.model.advance()  // 훅 → GuideSession.transitTransferWalk
        settle()
        assertFalse(t.model.isTracking)
        assertFalse(w.model.isTracking)
        after(610)
        assertTrue(w.model.isTracking)
        assertNotNull(w.model.ui.value.prewalkTarget, "환승 도보도 같은 연결이다")
        w.model.declarePrewalkArrival()
        settle()
        after(610)
        assertTrue(t.model.isTracking)
        assertEquals(1, t.model.ui.value.state?.legIndex, "걸어서 닿은 구간에서 다시 선다")
        assertEquals(TransitPhase.waiting, t.model.ui.value.state?.phase)
    }

    @Test fun `환승 도보 대기 중 다른 세션이 점유하면 인계를 버린다`() = joint { w, t ->
        t.model.start(transferRoute(), "여의도역", t.dest, accessible = false)
        settle()
        t.model.boardAlready(express = null)
        t.model.advance()
        settle()
        // 취소 게이트를 지나지 않는 점유(연결 없는 재시작 등)를 코디네이터 점유로 흉내 낸다.
        assertNotNull(w.coordinator.claim(stop = {}))
        after(610)
        assertFalse(w.model.isTracking, "점유 중엔 걷기를 시작하지 않는다")
        assertNull(w.model.ui.value.prewalkTarget)
        assertNull(w.model.onSessionEnd, "남의 세션에 종료 훅을 걸지 않는다")
        assertFalse(t.model.isTracking)
    }

    @Test fun `외부 시작은 대기 중인 환승 인계를 취소한다`() = joint { w, t ->
        t.model.start(transferRoute(), "여의도역", t.dest, accessible = false)
        settle()
        t.model.boardAlready(express = null)
        t.model.advance()
        settle()
        GuideSession.startWalk(w.request)
        settle()
        assertTrue(w.model.isTracking)
        after(1_000)
        assertNull(w.model.ui.value.prewalkTarget, "취소된 인계가 외부 세션에 표식을 걸지 않는다")
        assertNull(w.model.onSessionEnd)
        w.model.stopByUser()
        settle()
        after(1_000)
        assertFalse(t.model.isTracking, "외부 세션이 끝나도 대중교통이 다시 서지 않는다")
    }

    @Test fun `하차 인계는 출구를 싣고 출구 대기 창의 출구 문장은 한 번만 나간다`() = joint { w, t ->
        // 하차역 좌표 = 하네스의 기준 위치(다른 역 판정이 창을 버리지 않게).
        val here = w.fix(0.0)
        val via = stops("천호", "강동", "올림픽공원") + TransitLegStop(name = "여의도", lat = here.lat, lng = here.lng)
        t.model.start(route(subwayLeg("천호", "여의도", via = via, exit = TransitLegExit(alight = "3"))), "여의도역", t.dest, accessible = false)
        settle()
        t.model.boardAlready(express = null)
        assertTrue(t.model.advanceIntoWalkHandoff())
        GuideSession.acceptWalkHandoff()
        settle()
        assertFalse(t.model.isTracking)
        assertNull(t.model.ui.value.pendingWalkHandoff, "인계 제안은 소비된다")
        after(610)
        assertTrue(w.model.isTracking)
        assertEquals("3", w.model.ui.value.exitHoldExit, "출구 인계가 시작 요청에 실렸다")
        val exitLine = "3번 출구로 나가세요."
        assertEquals(1, w.speaker.texts.count { it.contains(exitLine) }, w.speaker.texts.toString())
        // 역 안(부정확) fix는 창을 잡아 둔다 — 문장을 다시 내지 않는다.
        repeat(3) { w.walkTo(0.0, seconds = 2.0, accuracy = 60.0); settle() }
        assertEquals("3", w.model.ui.value.exitHoldExit)
        // 출구 밖 수용 fix(게시 4초 뒤)가 창을 닫고 조회한다. 시작 요약은 출구를 다시 싣지 않는다.
        w.walkTo(0.0, seconds = 2.0, accuracy = 5.0)
        settle()
        after(100)
        assertNull(w.model.ui.value.exitHoldExit, "수용 fix가 창을 닫는다")
        assertEquals(1, w.speaker.texts.count { it.contains(exitLine) }, w.speaker.texts.toString())
    }

    @Test fun `하차 인계의 출구 문장은 시작음의 1회 소리 경고와 한 통지로 나간다`() = joint { w, t ->
        val here = w.fix(0.0)
        val via = stops("천호", "강동", "올림픽공원") + TransitLegStop(name = "여의도", lat = here.lat, lng = here.lng)
        t.model.start(route(subwayLeg("천호", "여의도", via = via, exit = TransitLegExit(alight = "3"))), "여의도역", t.dest, accessible = false)
        settle()
        t.model.boardAlready(express = null)
        assertTrue(t.model.advanceIntoWalkHandoff())
        w.tones.isSilenced = true
        GuideSession.acceptWalkHandoff()
        settle()
        after(610)
        settle()
        val warning = w.catalog.get("android.beacon.soundUnavailable")
        assertTrue(w.speaker.texts.any { it.contains("3번 출구로 나가세요.") && it.contains(warning) }, w.speaker.texts.toString())
    }

    @Test fun `재시작은 승차 전 도보 연결을 다시 건다`() = joint { w, t ->
        w.perms.location = LocationPermission.Coarse
        GuideSession.startTransit(t.request())
        settle()
        assertFalse(w.model.isTracking)
        assertTrue(w.model.ui.value.status.isFailure)
        after(9_000)
        assertTrue(t.model.isTracking, "시작 실패 뒤 대중교통이 섰다")
        t.model.stop(playStopTone = false)
        // 정확한 위치를 허용하고 길찾기의 재시작을 누른다.
        w.perms.location = LocationPermission.Fine
        GuideSession.restartBeacon()
        settle()
        assertTrue(w.model.isTracking)
        assertNotNull(w.model.ui.value.prewalkTarget, "재시작이 승차 전 도보 표식을 다시 건다")
        w.model.declarePrewalkArrival()
        settle()
        after(610)
        assertTrue(t.model.isTracking, "도착하면 다시 대중교통으로 잇는다")
    }

    @Test fun `승차 전 도보 시작 실패는 그 경로의 대중교통 시작 버튼 아래에만 실패 행을 세운다`() = joint { w, t ->
        w.perms.location = LocationPermission.Coarse
        val request = t.request()
        GuideSession.startTransit(request)
        settle()
        val route = request.route
        assertSame(route, GuideSession.transitStartRoute.value?.route, "내용이 같은 앞 테스트의 경로가 남아 있어도 이번 객체를 싣는다")
        val ui = w.model.ui.value
        assertTrue(ui.status.isFailure)
        assertTrue(transitStartFailureShown(ui, GuideSession.transitStartRoute.value, route))
        assertFalse(transitStartFailureShown(ui, GuideSession.transitStartRoute.value, route.copy()), "키가 같은 새 조회의 경로 객체 아래엔 없다")
        after(9_000)
        t.model.stop(playStopTone = false)
        // 도보 공개 시작은 표식을 지운다 — 그 도보의 실패가 대중교통 버튼 아래로 가지 않게.
        GuideSession.startWalk(WalkStartRequest(t.dest, "목적지", accessible = false, variant = null, line = null, alternate = null, waypoint = null, exitLead = null))
        settle()
        assertNull(GuideSession.transitStartRoute.value)
        assertFalse(transitStartFailureShown(w.model.ui.value, GuideSession.transitStartRoute.value, route))
    }

    @Test fun `탔다 신호는 승차 전 도보 재시작 줄을 거둔다`() = joint { w, t ->
        w.perms.location = LocationPermission.Coarse
        GuideSession.startTransit(t.request())
        settle()
        after(9_000)
        assertTrue(t.model.isTracking)
        assertTrue(w.model.ui.value.status.isFailure)
        t.model.boardAlready(express = null)  // 훅 → GuideSession.transitPassedPrewalk
        assertFalse(w.model.ui.value.status.isFailure, "그 계획을 지나간 실패 줄은 거둔다(A68)")
    }

    @Test fun `승차 전 도보 없이 곧장 서는 대중교통도 톤을 싣고 시트를 펼친 채 선다`() = joint { w, t ->
        val direct = route(subwayLeg("천호", "여의도")).let { it.copy(legs = it.legs.drop(1)) }  // 앞 도보 없음 — 승차 전 도보 대상 없음
        GuideSession.isMinimized = true
        val before = w.tones.preloads
        GuideSession.startTransit(t.request(direct))
        settle()
        assertNull(w.model.ui.value.prewalkTarget)
        assertTrue(t.model.isTracking, "곧장 대중교통이 선다")
        assertTrue(w.tones.preloads > before, "톤 프리로드")
        assertFalse(GuideSession.isMinimized, "접힌 띠바로 서지 않는다")
    }

    @Test fun `승차 전 도보 도착 뒤 대중교통은 시트를 펼친 채 선다`() = joint { w, t ->
        GuideSession.startTransit(t.request())
        settle()
        assertTrue(w.model.isTracking)
        GuideSession.isMinimized = true
        w.model.declarePrewalkArrival()
        settle()
        after(610)
        assertTrue(t.model.isTracking)
        assertFalse(GuideSession.isMinimized)
    }

    @Test fun `승차 전 도보 시작 중 서비스 시작 실패는 다리 문장을 낭독한다`() = joint { w, t ->
        w.controller.failOnStart = IllegalStateException("denied")
        GuideSession.startTransit(t.request())
        settle()
        assertFalse(w.model.isTracking)
        assertTrue(w.speaker.texts.any { it.endsWith(PREWALK_BRIDGE_TAIL) }, w.speaker.texts.toString())
    }

    @Test fun `승차 전 도보 시작 잡이 던져도 다리 문장을 낭독한다`() = joint { w, t ->
        w.perms.failNotifications = IllegalStateException("boom")
        GuideSession.startTransit(t.request())
        settle()
        assertFalse(w.model.isTracking)
        assertTrue(w.speaker.texts.any { it.endsWith(PREWALK_BRIDGE_TAIL) }, w.speaker.texts.toString())
    }
}
