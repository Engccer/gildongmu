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
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
private fun TestScope.settle() { runCurrent(); advanceTimeBy(1); runCurrent() }

private fun p(r: RoutePoint) = "{\"lat\":${r.lat},\"lng\":${r.lng}}"

/** 북진 자동차 경로(두 안내, 도로 둘) — 600m 천호대로 뒤 우회전, 400m 양재대로. `congestion`은 JSON 그대로(null이면 키 없음). */
private fun carJson(provider: String = "tmap", congestion: String? = null, durationSeconds: Int = 300, origin: RoutePoint = north(0.0)): String {
    val mid = RoutePoint(origin.lat + 600 * meterLat, origin.lng)
    val end = north(1000.0)
    return buildString {
        append("{\"distanceMeters\":1000,\"durationSeconds\":$durationSeconds,\"taxiFare\":0,\"tollFare\":0,\"guides\":[")
        append("{\"name\":\"길동사거리\",\"guidance\":\"천호대로를 따라 600m 이동 후 우회전\",\"distanceMeters\":600,\"durationSeconds\":120,")
        append("\"pathCoords\":[${p(origin)},${p(mid)}],\"roadLinks\":[{\"name\":\"천호대로\",\"distanceMeters\":600}],\"action\":\"right\",\"at\":\"길동사거리\"},")
        append("{\"name\":\"\",\"guidance\":\"양재대로를 따라 400m 이동\",\"distanceMeters\":400,\"durationSeconds\":80,")
        append("\"pathCoords\":[${p(mid)},${p(end)}],\"roadLinks\":[{\"name\":\"양재대로\",\"distanceMeters\":400}]}")
        append("],\"provider\":\"$provider\",\"terminalCoord\":${p(end)}")
        if (congestion != null) append(",\"congestion\":$congestion")
        append("}")
    }
}

/** 북쪽 `from`m에서 `length`m 정체(이름 있는 도로). */
private fun jam(from: Double, length: Double, road: String = "양재대로") =
    "{\"road\":\"$road\",\"startMeters\":${from.toInt()},\"lengthMeters\":${length.toInt()},\"start\":${p(north(from))},\"end\":${p(north(from + length))}}"

/**
 * 자동차 실시간 안내(M5 spec §4, iOS `BeaconModel`의 `sessionKind == .car` 갈래): 시작 조회의 요청 축·걸음 축 부재·현재 도로 행, 카카오 폴백의
 * 간략 강등, 도착 뒤 도보 인계, 6분 재조회의 새 정체 한 문장(E80 §5 순서). 판정(`newCarJamsAhead`·`carArrivalStep`·`roadNameAt`)은 :kit이
 * 잠그고, 여기는 모델이 그 판정을 언제 부르고 무엇을 말하는지만 잠근다.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class CarGuideModelTest {
    private val dispatcher = StandardTestDispatcher()

    @JvmField
    @RegisterExtension
    val main = MainDispatcherExtension(dispatcher)

    private val dest = BeaconDest(north(1000.0).lat, lng0)
    private val request = CarStartRequest(dest, "길동역", waypoint = null)

    private fun GuideTestHarness.carFix(meters: Double, speed: Double = 8.0) =
        north(meters).let { GuideFixPayload(it.lat, it.lng, 5.0, speed, 0.5, -1.0, -1.0, (clock.now * 1000).toLong()) }

    /** 8초마다 `step`m씩 `from`에서 `to`까지 달린다(가상 시계와 모델 시계를 함께 민다). */
    private fun TestScope.drive(h: GuideTestHarness, from: Double, to: Double, step: Double = 8.0, speed: Double = 1.0) {
        var d = from
        while (d <= to) {
            h.clock.now += 8.0
            h.model.handleFix(h.carFix(d, speed))
            advanceTimeBy(8_000); runCurrent()
            d += step
        }
    }

    private fun TestScope.startCar(h: GuideTestHarness) {
        h.model.requestStart(request)
        settle()
        h.model.handleFix(h.carFix(0.0)); settle()
    }

    @Test fun `시작 — 정체·기하를 함께 조회하고 걸음 축 없이 상세로, 현재 도로 행이 선다`() = guideTest(dispatcher, walkResponder = { HttpResponse(200, carJson()) }) { h ->
        startCar(h)
        val ui = h.model.ui.value
        assertEquals(GuideMode.detail, ui.mode)
        assertEquals(GuideSessionKind.car, ui.sessionKind)
        val url = h.transport.seenUrls.single { it.contains("/api/route/car") }
        assertTrue(url.contains("traffic=1") && url.contains("includeGeometry=1"), url)
        assertTrue(h.transport.seenUrls.none { it.contains("/api/route/walk") })
        // 자동차는 걸음을 세지 않는다(iOS `sessionStart = kind == .walk ? … : nil`).
        assertEquals(0, h.steps.starts)
        assertEquals("현재 도로, 천호대로", ui.currentRoadText)
        assertTrue(h.speaker.texts.any { it.startsWith("길동역까지 자동차 안내 시작. ") }, h.speaker.texts.toString())
        h.model.stopByUser(); settle()
        assertEquals(GuideSessionKind.walk, h.model.ui.value.sessionKind)
        assertNull(h.model.ui.value.currentRoadText)
    }

    @Test fun `카카오 폴백은 기하가 없어 간략으로 강등한다`() = guideTest(dispatcher, walkResponder = { HttpResponse(200, carJson(provider = "kakao")) }) { h ->
        startCar(h)
        assertEquals(GuideMode.brief, h.model.ui.value.mode)
        assertNull(h.model.ui.value.currentRoadText)
    }

    @Test fun `도착 — 부근 정차가 도착이고 종료 화면이 도보 인계를 내준다(걸음 요약 없음)`() = guideTest(dispatcher, walkResponder = { HttpResponse(200, carJson()) }) { h ->
        startCar(h)
        // 앞 도보 세션이 남긴 걸음 값처럼 센서에 표본이 있어도 자동차 종료 화면은 걸음 요약을 만들지 않는다.
        h.steps.liveSample = StepSample(steps = 1200, distanceMeters = 900.0)
        drive(h, 8.0, 976.0, step = 24.0, speed = 3.0)
        // 목적지 부근에서 멈춘다(정지 판정은 속도 0 연속).
        repeat(6) { h.clock.now += 2.0; h.model.handleFix(h.carFix(985.0, speed = 0.0)); advanceTimeBy(2_000); runCurrent() }
        val ui = h.model.ui.value
        assertNotNull(ui.arrivalDest, "도착 종료 화면")
        assertEquals(SessionEndKind.arrived, ui.endKind)
        assertEquals(GuideSessionKind.car, ui.arrivalSessionKind)
        assertNull(ui.arrivalHealth)
        val handoff = h.model.takeCarWalkHandoff()
        assertEquals(WalkStartRequest(dest, "길동역", accessible = false, variant = null, line = null, alternate = null, waypoint = null, exitLead = null), handoff)
        assertNull(h.model.ui.value.arrivalDest, "인계가 종료 화면을 지운다")
    }

    @Test fun `6분 재조회 — 기준선이 없으면 말없이 기준선, 다음 회차의 새 정체 하나만 말한다`() {
        var calls = 0
        guideTest(dispatcher, walkResponder = { url ->
            calls += 1
            when (calls) {
                1 -> HttpResponse(200, carJson())                                                          // 시작: 정체 정보 없음
                2 -> HttpResponse(200, carJson(origin = originOf(url)!!, congestion = "{\"jams\":[${jam(700.0, 200.0)}]}"))
                else -> HttpResponse(200, carJson(origin = originOf(url)!!, congestion = "{\"jams\":[${jam(700.0, 200.0)},${jam(900.0, 80.0, road = "")}]}"))
            }
        }) { h ->
            startCar(h)
            drive(h, 1.0, 46.0, step = 1.0)                       // 46회 × 8초 = 368초 — 첫 재조회
            assertEquals(2, calls)
            assertTrue(h.speaker.texts.none { it.contains("정체가 새로 생겼습니다") }, "기준선 회차는 말하지 않는다")
            drive(h, 47.0, 92.0, step = 1.0)                      // 두 번째 재조회
            assertEquals(3, calls)
            val jams = h.speaker.texts.filter { it.contains("정체가 새로 생겼습니다") }
            // 아는 정체(700m)는 빼고 새 무명 정체(900m) 하나만, 지금 위치(92m)에서 시작까지. 음성은 단위를 풀어 읽는다(기존 TTS 경로).
            assertEquals(1, jams.size, jams.toString())
            assertTrue(Regex("""^80\d 미터 앞에 80 미터 정체가 새로 생겼습니다\.$""").matches(jams.single()), jams.single())
        }
    }
}
