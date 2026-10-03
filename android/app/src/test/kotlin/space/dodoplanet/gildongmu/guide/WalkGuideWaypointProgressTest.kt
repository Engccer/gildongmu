package space.dodoplanet.gildongmu.guide

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import org.junit.jupiter.api.extension.RegisterExtension
import space.dodoplanet.gildongmu.MainDispatcherExtension
import space.dodoplanet.gildongmu.kit.BeaconDest
import space.dodoplanet.gildongmu.kit.BeaconTone
import space.dodoplanet.gildongmu.kit.Fixtures
import space.dodoplanet.gildongmu.kit.HttpResponse
import kotlin.math.PI
import kotlin.math.cos
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
private fun TestScope.settle() { runCurrent(); advanceTimeBy(1); runCurrent() }

/**
 * N4 경유지 진행 표시 등가성 4항(spec 2026-09-24 §4.1·§6, iOS `BeaconModel` 동형): 접근 예고 발화·도착 문장(ko 방향 조사)·남은 거리
 * 행의 다음 목표·경유지를 지난 세션의 행. 판정(W0·W4·`guideNextTarget`)은 :kit `RouteGuideTest`가 공유 fixture로 잠그고, 여기는 그
 * 판정을 모델이 어떻게 말하고 보이는지만 잠근다.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class WalkGuideWaypointProgressTest {
    private val dispatcher = StandardTestDispatcher()

    @JvmField
    @RegisterExtension
    val main = MainDispatcherExtension(dispatcher)

    /** 경유지 도착선 = 150m(스텝 1 시작), 총 400m. 경유지를 빼고 조회하면 400m 단일 스텝. */
    private val responder: (String) -> HttpResponse = { url ->
        if (url.contains("via=")) HttpResponse(200, walkBriefingJson(listOf(TestStep("직진A", listOf(north(0.0), north(150.0))), TestStep("직진B", listOf(north(150.0), north(400.0)))), distanceMeters = 400, durationSeconds = 400, waypointStepIndex = 1))
        else HttpResponse(200, walkBriefingJson(listOf(TestStep("직진C", listOf(north(0.0), north(400.0)))), distanceMeters = 400, durationSeconds = 400))
    }

    private val via = GuideWaypoint(BeaconDest(north(150.0).lat, lng0), "장미공원")

    private fun GuideTestHarness.fixAt(along: Double, lateral: Double = 0.0, acc: Double = 8.0): GuideFixPayload {
        val lat = lat0 + along * meterLat
        val lng = lng0 + (lateral * meterLat) / cos(lat0 * PI / 180)
        return GuideFixPayload(lat, lng, acc, 1.3, 0.3, -1.0, -1.0, (clock.now * 1000).toLong())
    }

    /** 시작 → 첫 fix로 경유지 경로 상세 커밋. */
    private fun TestScope.startWithVia(h: GuideTestHarness, label: String = "길동역") {
        h.model.requestStart(h.request.copy(label = label, waypoint = via))
        settle()
        h.model.handleFix(h.fixAt(0.0)); settle()
        assertEquals(GuideMode.detail, h.model.ui.value.mode)
    }

    /** 8초마다 8m씩(1m/s) `from`에서 `to`까지 걷는다. */
    private fun TestScope.walk(h: GuideTestHarness, from: Double, to: Double, lateral: Double = 0.0) {
        var d = from
        while (d <= to) {
            h.clock.now += 8.0
            h.model.handleFix(h.fixAt(d, lateral))
            advanceTimeBy(8_000); runCurrent()
            d += 8.0
        }
    }

    private fun GuideTestHarness.approachTexts() = speaker.texts.filter { it.startsWith("경유지 장미공원까지 ") }

    @Test fun `접근 예고 1회 — 톤·상태 행·마지막 안내에 남기지 않고, 행은 경유지 목표에서 목적지 목표로`() = guideTest(dispatcher, responder) { h ->
        startWithVia(h)
        // 시간은 총 소요의 **경유지 잔여** 비례(400초 × 150/400 ≈ 3분 — 총 잔여였다면 7분).
        assertEquals("경유지 장미공원까지 150m, 약 3분", h.model.ui.value.remainingText)
        h.tones.played.clear()
        walk(h, 8.0, 136.0)   // 도착선(150m) 직전까지
        val approach = h.approachTexts()
        assertEquals(1, approach.size, h.speaker.texts.toString())
        val meters = Regex("^경유지 장미공원까지 ([0-9]+) 미터$").find(approach.single())?.groupValues?.get(1)?.toInt()
        assertTrue(meters != null && meters in 1..50, "예고는 접근선(50m) 안의 거리 한 조각: ${approach.single()}")
        assertFalse(h.model.ui.value.statusText.startsWith("경유지 장미공원까지"), "예고는 상태 행에 두지 않는다")
        assertFalse(h.model.progressText().contains("경유지 장미공원까지"), "예고는 마지막 안내를 덮지 않는다")
        assertFalse(h.tones.played.contains(BeaconTone.nearby), "도착 종은 도착에만")
        walk(h, 144.0, 200.0)
        assertEquals(1, h.approachTexts().size, "도착 뒤 다시 나가지 않는다")
        assertEquals(1, h.tones.played.count { it == BeaconTone.nearby })
        assertTrue(h.speaker.texts.contains("경유지 장미공원 도착. 이제 목적지 길동역으로 안내합니다"), h.speaker.texts.toString())
        val row = h.model.ui.value.remainingText!!
        assertTrue(row.startsWith("목적지 길동역까지 "), row)
        assertTrue(row.contains("약 "), "목적지 목표는 총 소요 비례 시간을 붙인다: $row")
    }

    @Test fun `출력 억제 중이면 예고를 발화하지도 보관하지도 않는다 — 도착 문장만 갚는다`() = guideTest(dispatcher, responder) { h ->
        startWithVia(h)
        h.model.outputSuppressed = true
        walk(h, 8.0, 160.0)
        h.model.outputSuppressed = false
        assertEquals(emptyList(), h.approachTexts(), h.speaker.texts.toString())
        assertEquals("경유지 장미공원 도착. 이제 목적지 길동역으로 안내합니다", h.speaker.texts.last())
    }

    @Test fun `도착 문장의 ko 방향 조사 — 받침 없음은 로, 받침 모르는 이름도 로`() = guideTest(dispatcher, responder) { h ->
        startWithVia(h, label = "학교")
        walk(h, 8.0, 160.0)
        assertTrue(h.speaker.texts.contains("경유지 장미공원 도착. 이제 목적지 학교로 안내합니다"), h.speaker.texts.toString())
        h.model.stopByUser()
        h.speaker.spoken.clear()
        startWithVia(h, label = "GS25")
        walk(h, 8.0, 160.0)
        assertTrue(h.speaker.texts.contains("경유지 장미공원 도착. 이제 목적지 GS25로 안내합니다"), h.speaker.texts.toString())
    }

    @Test fun `경유지를 지난 세션은 경유지 없는 재조회 경로에서도 행이 목적지 목표다 — 새 세션은 초기화`() = guideTest(dispatcher, responder) { h ->
        startWithVia(h)
        walk(h, 8.0, 200.0)
        assertTrue(h.model.ui.value.remainingText!!.startsWith("목적지 길동역까지 "))
        h.transport.seenUrls.clear()
        walk(h, 200.0, 232.0, lateral = 80.0)   // 이탈 확정 = 돌아가기 국면(E63, 조회 없음)
        settle()
        assertTrue(h.transport.seenUrls.isEmpty(), h.transport.seenUrls.toString())
        for (lateral in listOf(110.0, 120.0, 130.0, 140.0)) walk(h, 232.0, 232.0, lateral = lateral)   // 계속 멀어짐 → 자동 재조회(경유지 없이) 채택
        settle()
        assertTrue(h.model.ui.value.offRouteEndedByReroute, h.speaker.texts.toString())
        assertFalse(h.transport.seenUrls.any { it.contains("via=") })
        assertTrue(h.model.ui.value.remainingText!!.startsWith("목적지 길동역까지 "), h.model.ui.value.remainingText)
        // 새 세션(경유지 없음)은 종전 "남은 거리" 행이다.
        h.model.stopByUser()
        h.model.requestStart(h.request)
        settle()
        h.model.handleFix(h.fixAt(0.0)); settle()
        assertTrue(h.model.ui.value.remainingText!!.startsWith("남은 거리 "), h.model.ui.value.remainingText)
    }

    @Test fun `프로파일 — 도보 튜닝 원본을 쓴다(경유지 접근 예고를 끄는 사본 금지)`() {
        val model = Fixtures.repoRoot.resolve("android/app/src/main/kotlin/space/dodoplanet/gildongmu/guide/WalkGuideModel.kt").readText()
        assertTrue(model.contains("private val tuning = GuideTuning.walk\n"))
        assertFalse(model.contains("waypointApproachM = null"))
    }
}
