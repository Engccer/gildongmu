package space.dodoplanet.gildongmu.guide

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import org.junit.jupiter.api.extension.RegisterExtension
import space.dodoplanet.gildongmu.MainDispatcherExtension
import space.dodoplanet.gildongmu.kit.BeaconDest
import space.dodoplanet.gildongmu.kit.HttpResponse
import space.dodoplanet.gildongmu.kit.RoutePoint
import space.dodoplanet.gildongmu.location.LocationPermission
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
private fun TestScope.settle() { runCurrent(); advanceTimeBy(1); runCurrent() }

private fun p(r: RoutePoint) = "{\"lat\":${r.lat},\"lng\":${r.lng}}"

/** 북진 1km 자동차 경로(도로 하나) — `CarGuideModelTest`의 축약판. */
private fun carRouteJson(): String {
    val end = north(1000.0)
    return "{\"distanceMeters\":1000,\"durationSeconds\":300,\"taxiFare\":0,\"tollFare\":0,\"guides\":[" +
        "{\"name\":\"길동사거리\",\"guidance\":\"천호대로를 따라 1000m 이동\",\"distanceMeters\":1000,\"durationSeconds\":300," +
        "\"pathCoords\":[${p(north(0.0))},${p(end)}],\"roadLinks\":[{\"name\":\"천호대로\",\"distanceMeters\":1000}]}" +
        "],\"provider\":\"tmap\",\"terminalCoord\":${p(end)}}"
}

/**
 * 여정(E70) 단계 표식(iOS `journeyChain`·`markChained`·`lastFailure`·`endsWithoutScreen`)의 도보·자동차 모델 몫. 표식이 걸린 세션은 종료 화면을 남기지 않고,
 * 잊힌 세션 안전망이 돌지 않으며, 도착 문장을 표식이 정하고, 시작 실패의 원인을 `lastFailure`가 보존한다. 배경 자동 인계의 권한(M5 §7-4)도 여기서 잠근다.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class WalkGuideJourneyChainTest {
    private val dispatcher = StandardTestDispatcher()

    @JvmField
    @RegisterExtension
    val main = MainDispatcherExtension(dispatcher)

    private val finalApproachJson = "{\"offsetMeters\":20,\"relativeBearing\":0,\"bearingUnavailable\":null}"
    private val arrivalRoute = walkBriefingJson(
        steps = listOf(TestStep("천호대로를 따라 300m 이동", listOf(north(0.0), north(300.0)), target = "길동역")),
        distanceMeters = 300, finalApproach = finalApproachJson,
    )

    private fun GuideTestHarness.reasons(): MutableList<BeaconEndReason> =
        mutableListOf<BeaconEndReason>().also { sink -> model.onSessionEnd = { sink += it } }

    /** 시작 → 첫 fix → 15m씩 걸어 최종 접근을 지나 목적지(북 315m) 12m 안에서 도착한다. */
    private fun TestScope.walkToArrival(h: GuideTestHarness) {
        h.model.requestStart(h.request)
        settle()
        h.model.handleFix(h.fix(0.0, accuracy = 8.0)); settle()
        for (i in 1..20) {
            h.clock.now += 10.0
            h.model.handleFix(h.fix(i * 15.0, accuracy = 8.0)); advanceTimeBy(10_000); runCurrent()
        }
        h.clock.now += 5.0
        h.model.handleFix(h.fix(308.0, accuracy = 8.0)); runCurrent()
        advanceTimeBy(1); runCurrent()
    }

    @Test fun `표식 있는 도보 도착 — 종료 화면 없음, onSessionEnd(arrived), 도착 문장은 arrivalText`() = guideTest(dispatcher, { HttpResponse(200, arrivalRoute) }) { h ->
        val text = h.catalog.get("android.journey.arrivedStation", "길동")
        val reasons = h.reasons()
        h.model.markChained(arrivalText = text, bridgesStartFailure = false)
        walkToArrival(h)
        val ui = h.model.ui.value
        assertEquals(GuideStatus.idle, ui.status)
        assertNull(ui.arrivalDest, "여정 단계는 종료 화면을 남기지 않는다")
        assertFalse(ui.hasScreen)
        assertEquals(text, ui.statusText)
        assertEquals(text to true, h.speaker.spoken.last())
        assertEquals(listOf(BeaconEndReason.arrived), reasons)
        assertNull(h.model.journeyChain, "stop()이 표식을 지운다")
    }

    @Test fun `표식의 arrivalText가 null이면 기본 도착 문장`() = guideTest(dispatcher, { HttpResponse(200, arrivalRoute) }) { h ->
        val reasons = h.reasons()
        h.model.markChained(arrivalText = null, bridgesStartFailure = false)
        walkToArrival(h)
        assertNull(h.model.ui.value.arrivalDest)
        assertEquals(h.catalog.get("guide.arrived") to true, h.speaker.spoken.last())
        assertEquals(listOf(BeaconEndReason.arrived), reasons)
    }

    @Test fun `표식 없는 도보 도착은 종전대로 종료 화면을 남긴다(대조)`() = guideTest(dispatcher, { HttpResponse(200, arrivalRoute) }) { h ->
        val reasons = h.reasons()
        walkToArrival(h)
        assertNotNull(h.model.ui.value.arrivalDest)
        assertEquals(listOf(BeaconEndReason.arrived), reasons)
    }

    @Test fun `접근 도보 시작 실패 — accessFailedWith 한 통지(high), 상태 줄은 원인만, lastFailure에 키와 해결 수단`() = guideTest(dispatcher) { h ->
        h.perms.location = LocationPermission.None
        h.perms.requestResult = LocationPermission.None
        val reasons = h.reasons()
        h.model.markChained(arrivalText = null, bridgesStartFailure = true)
        h.model.requestStart(h.request)
        settle()
        val reason = h.catalog.get("beacon.denied")
        assertEquals(reason, h.model.ui.value.statusText)
        assertEquals(listOf(h.catalog.get("android.journey.accessFailedWith", reason) to true), h.speaker.spoken)
        assertEquals(JourneyFailure("beacon.denied", FailResolution.settings), h.model.lastFailure)
        assertEquals(listOf(BeaconEndReason.startFailed), reasons)
        assertNull(h.model.journeyChain, "시작 실패 판정이 표식을 거둔다")
    }

    @Test fun `다리 문장이 없는 단계(bridgesStartFailure false)의 시작 실패는 원인 문장만`() = guideTest(dispatcher) { h ->
        h.perms.location = LocationPermission.None
        h.perms.requestResult = LocationPermission.None
        h.model.markChained(arrivalText = null, bridgesStartFailure = false)
        h.model.requestStart(h.request)
        settle()
        assertEquals(listOf(h.catalog.get("beacon.denied")), h.speaker.texts)
        assertEquals(JourneyFailure("beacon.denied", FailResolution.settings), h.model.lastFailure)
    }

    @Test fun `새 시작이 lastFailure를 비운다, clearFailure는 건드리지 않는다`() = guideTest(dispatcher) { h ->
        h.perms.location = LocationPermission.None
        h.perms.requestResult = LocationPermission.None
        h.model.requestStart(h.request)
        settle()
        assertNotNull(h.model.lastFailure)
        h.model.clearFailure()
        assertNotNull(h.model.lastFailure, "시트 행의 거둠은 여정의 원인 보존을 지우지 않는다")
        h.perms.location = LocationPermission.Fine
        h.model.requestStart(h.request)
        assertNull(h.model.lastFailure, "시작 즉시 비운다")
        settle()
        assertEquals(GuideStatus.tracking, h.model.ui.value.status)
        assertNull(h.model.lastFailure)
    }

    @Test fun `표식 있는 자동차 확정 도착 — 종료 화면·도보 인계 제안 없이 onSessionEnd(arrived)만`() = guideTest(dispatcher, { HttpResponse(200, carRouteJson()) }) { h ->
        val reasons = h.reasons()
        h.model.markChained(arrivalText = null, bridgesStartFailure = false)
        h.model.requestStart(CarStartRequest(BeaconDest(north(1000.0).lat, lng0), "길동역", waypoint = null))
        settle()
        h.model.handleFix(h.carFix(0.0, 8.0)); settle()
        var d = 8.0
        while (d <= 976.0) {
            h.clock.now += 8.0; h.model.handleFix(h.carFix(d, 3.0)); advanceTimeBy(8_000); runCurrent(); d += 24.0
        }
        repeat(6) { h.clock.now += 2.0; h.model.handleFix(h.carFix(985.0, 0.0)); advanceTimeBy(2_000); runCurrent() }
        val ui = h.model.ui.value
        assertEquals(GuideStatus.idle, ui.status)
        assertNull(ui.arrivalDest)
        assertNull(ui.arrivalSessionKind)
        assertNull(h.model.takeCarWalkHandoff(), "여기서 도보 안내 시작 제안이 없다")
        assertEquals(listOf(BeaconEndReason.arrived), reasons)
        assertEquals(h.catalog.get("guide.arrived"), ui.statusText)
    }

    @Test fun `잊힌 세션 안전망 — 표식 없으면 600초 두절에 끝나고(대조), 표식 있으면 돌지 않는다`() {
        for (chained in listOf(false, true)) guideTest(dispatcher, { HttpResponse(200, "{\"result\":null}") }) { h ->
            if (chained) h.model.markChained(arrivalText = null, bridgesStartFailure = false)
            h.model.requestStart(h.request)
            settle()
            h.model.handleFix(h.fix(0.0)); settle()
            h.clock.now += 700.0; advanceTimeBy(700_000); runCurrent()
            if (chained) {
                assertEquals(GuideStatus.tracking, h.model.ui.value.status, "여정 단계는 지하 진입·정차가 정상이다")
                assertTrue(h.speaker.texts.none { it == h.catalog.get("guide.endedIdle") })
            } else {
                assertEquals(GuideStatus.idle, h.model.ui.value.status)
                assertEquals(h.catalog.get("guide.endedIdle"), h.speaker.texts.last())
            }
        }
    }

    @Test fun `stop()이 표식을 지우되 종료 화면 판정은 stop() 앞 캡처값을 쓴다`() = guideTest(dispatcher) { h ->
        h.model.markChained(arrivalText = null, bridgesStartFailure = false)
        h.model.requestStart(h.request)
        settle()
        assertNotNull(h.model.journeyChain)
        h.steps.liveSample = StepSample(steps = 400, distanceMeters = 300.0)  // 의미 있는 보행 — 표식이 없으면 종료 화면이 남는다
        h.model.stopByUser(); settle()
        assertNull(h.model.journeyChain)
        assertNull(h.model.ui.value.arrivalDest, "캡처한 표식이 종료 화면을 막는다")
    }

    @Test fun `clearPrewalk가 여정 표식도 거둔다`() = guideTest(dispatcher) { h ->
        h.model.markChained(arrivalText = "x", bridgesStartFailure = true)
        assertEquals(JourneyChainMark("x", true), h.model.journeyChain)
        h.model.clearPrewalk()
        assertNull(h.model.journeyChain)
    }

    @Test fun `배경 여정 시작 + 위치 권한 없음 — 묻지 않고 곧장 시작 실패(denied·settings)`() = guideTest(dispatcher) { h ->
        h.env.foreground = false
        h.perms.location = LocationPermission.None
        h.perms.requestResult = LocationPermission.Fine  // 물었다면 허용되었을 것 — 묻지 않았음을 가른다
        val reasons = h.reasons()
        h.model.markChained(arrivalText = null, bridgesStartFailure = true)
        h.model.requestStart(h.request)
        settle()
        assertEquals(0, h.perms.locationRequests)
        assertEquals(GuideStatus.denied, h.model.ui.value.status)
        assertEquals(FailResolution.settings, h.model.ui.value.failResolution)
        assertEquals(h.catalog.get("beacon.denied"), h.model.ui.value.statusText)
        assertEquals(0, h.controller.starts)
        assertEquals(JourneyFailure("beacon.denied", FailResolution.settings), h.model.lastFailure)
        assertEquals(listOf(BeaconEndReason.startFailed), reasons)
    }

    @Test fun `배경 여정 시작 + 걸음·알림 권한 없음 — 묻지 않고 그대로 시작`() = guideTest(dispatcher) { h ->
        h.env.foreground = false
        h.perms.activity = false
        h.model.markChained(arrivalText = null, bridgesStartFailure = false)
        h.model.requestStart(h.request)
        settle()
        assertEquals(GuideStatus.tracking, h.model.ui.value.status)
        assertEquals(0, h.perms.notificationRequests)
        assertEquals(0, h.perms.locationRequests)
        assertEquals(0, h.steps.starts)
        assertEquals(1, h.controller.starts)
    }

    @Test fun `전경 여정 시작은 종전대로 묻는다`() = guideTest(dispatcher) { h ->
        h.perms.location = LocationPermission.None
        h.perms.requestResult = LocationPermission.Fine
        h.model.markChained(arrivalText = null, bridgesStartFailure = false)
        h.model.requestStart(h.request)
        settle()
        assertEquals(1, h.perms.locationRequests)
        assertEquals(1, h.perms.notificationRequests)
        assertEquals(GuideStatus.tracking, h.model.ui.value.status)
        assertEquals(1, h.steps.starts)
    }

    @Test fun `배경 + 표식 없어도 여정 중 시작(taxiOut·승차 전 도보)은 묻지 않는다(리뷰 지적 1)`() = guideTest(dispatcher) { h ->
        h.env.foreground = false
        h.model.inJourney = { true }
        h.perms.location = LocationPermission.None
        h.perms.requestResult = LocationPermission.Fine
        h.model.requestStart(h.request)
        settle()
        assertEquals(0, h.perms.locationRequests)
        assertEquals(GuideStatus.denied, h.model.ui.value.status)
    }

    @Test fun `경유지 진입점 - 추적 중 ko면 서고, 여정 중이면 숨는다(iOS waypointAvailable journey == nil)`() = guideTest(dispatcher) { h ->
        assertFalse(h.model.waypointAvailable(), "추적 전")
        h.model.requestStart(h.request)
        settle()
        assertEquals(GuideStatus.tracking, h.model.ui.value.status)
        assertTrue(h.model.waypointAvailable())
        h.model.inJourney = { true }
        assertFalse(h.model.waypointAvailable())
    }

    @Test fun `배경이어도 표식 없는 시작은 종전대로 묻는다`() = guideTest(dispatcher) { h ->
        h.env.foreground = false
        h.perms.location = LocationPermission.None
        h.perms.requestResult = LocationPermission.Fine
        h.model.requestStart(h.request)
        settle()
        assertEquals(1, h.perms.locationRequests)
        assertEquals(GuideStatus.tracking, h.model.ui.value.status)
    }

    private fun GuideTestHarness.carFix(meters: Double, speed: Double) =
        north(meters).let { GuideFixPayload(it.lat, it.lng, 5.0, speed, 0.5, -1.0, -1.0, (clock.now * 1000).toLong()) }
}
