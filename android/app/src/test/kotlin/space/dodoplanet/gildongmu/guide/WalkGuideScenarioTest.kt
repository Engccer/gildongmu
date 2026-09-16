package space.dodoplanet.gildongmu.guide

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.extension.RegisterExtension
import space.dodoplanet.gildongmu.AppConfig
import space.dodoplanet.gildongmu.MainDispatcherExtension
import space.dodoplanet.gildongmu.kit.BeaconDest
import space.dodoplanet.gildongmu.kit.BeaconTone
import space.dodoplanet.gildongmu.kit.HttpResponse
import space.dodoplanet.gildongmu.kit.RoutePoint
import space.dodoplanet.gildongmu.kit.WalkAction
import kotlin.math.PI
import kotlin.math.cos
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * spec §10-1 ③④⑤⑧⑨⑩⑮⑯⑱ — fix 열은 공유 fixture `route-guide-scenarios.json`과 같은 좌표계(북진 직선, `along`/`lateral` m).
 * 판정은 :kit 리듀서(그 fixture는 `RouteGuideTest`가 전수 돌린다) — 여기는 오케스트레이션(발화·톤·진동·상태·종료)이 그 판정을
 * 어떻게 소비하는지만 잠근다. 첫 fix(t=0)는 경로 origin으로 소비되고 리듀서는 그다음 fix부터 본다.
 */
@OptIn(ExperimentalCoroutinesApi::class)
private fun TestScope.settle() { runCurrent(); advanceTimeBy(1); runCurrent() }

@OptIn(ExperimentalCoroutinesApi::class)
class WalkGuideScenarioTest {
    private val dispatcher = StandardTestDispatcher()

    @JvmField
    @RegisterExtension
    val main = MainDispatcherExtension(dispatcher)

    @AfterEach fun restoreGate() { GuideSession.experimentalEnabled = { AppConfig.experimentalGuidanceEnabled } }

    private data class Seg(val len: Double, val desc: String, val action: String? = null, val target: String? = null)
    private data class Fix(val t: Double, val along: Double, val lateral: Double, val acc: Double)

    private fun routeJson(steps: List<Seg>, finalApproach: String? = null): String {
        var acc = 0.0
        val testSteps = steps.map { s ->
            val step = TestStep(s.desc, listOf(north(acc), north(acc + s.len)), target = s.target, action = s.action)
            acc += s.len
            step
        }
        return walkBriefingJson(testSteps, distanceMeters = acc.toInt(), finalApproach = finalApproach)
    }

    private fun GuideTestHarness.fixAt(f: Fix, base: Double): GuideFixPayload {
        clock.now = base + f.t
        val lat = lat0 + f.along * meterLat
        val lng = lng0 + (f.lateral * meterLat) / cos(lat0 * PI / 180)
        return GuideFixPayload(lat, lng, f.acc, 1.3, 0.3, -1.0, -1.0, (clock.now * 1000).toLong())
    }

    /** 시작 → 첫 fix로 조회 → 상세 커밋. 반환 = 시작 시각(fixture `t` 기준점). */
    private fun TestScope.startDetail(h: GuideTestHarness, fixes: List<Fix>): Double {
        h.model.requestStart(h.request)
        settle()
        val base = h.clock.now
        h.model.handleFix(h.fixAt(fixes[0], base))
        settle()
        assertEquals(GuideMode.detail, h.model.ui.value.mode)
        return base
    }

    private fun TestScope.feed(h: GuideTestHarness, fixes: List<Fix>, base: Double, from: Int = 1, until: Int = fixes.size) {
        for (i in from until until) {
            val prev = if (i == 0) 0.0 else fixes[i - 1].t
            h.model.handleFix(h.fixAt(fixes[i], base))
            advanceTimeBy(((fixes[i].t - prev) * 1000).toLong().coerceAtLeast(1))
            runCurrent()
        }
    }

    private val longAhead = listOf(Seg(200.0, "직진A", target = "장미공원"), Seg(100.0, "우회전B", action = "right"))
    private val longAheadFixes = (0..11).map { Fix(it * 8.0, it * 16.0, 0.0, 10.0) }

    @Test fun `③ 선행 낭독 — 40m 앞에서 다음 스텝 전문 1회, 상태 행은 비운다, 행동 톤 없음`() = guideTest(dispatcher, { HttpResponse(200, routeJson(longAhead)) }) { h ->
        val base = startDetail(h, longAheadFixes)
        h.speaker.spoken.clear()
        h.tones.played.clear()
        feed(h, longAheadFixes, base, until = 10)   // fix 9까지: 잔여 > 40m
        assertFalse(h.speaker.texts.contains("우회전B"))
        feed(h, longAheadFixes, base, from = 10, until = 11)  // fix 10(along 160, 잔여 40m)
        assertEquals(1, h.speaker.texts.count { it == "우회전B" })
        assertEquals("", h.model.ui.value.statusText)
        assertTrue(h.tones.played.none { it == BeaconTone.right || it == BeaconTone.ahead })
        feed(h, longAheadFixes, base, from = 11)
        assertEquals(1, h.speaker.texts.count { it == "우회전B" })
        assertEquals(0, h.model.ui.value.currentStepIndex)
    }

    private val imminentSteps = listOf(Seg(200.0, "직진A", target = "장미공원"), Seg(100.0, "장미공원에서 오른쪽으로 돌아 천호대로를 따라 100m 이동", action = "right"))
    /** 176m까지 16m/8초, 그 뒤 5m/4초로 20·15·10m 경계를 **차례로** 지난다 — 첫 진입이 10m 안이면 stage 2뿐이라 문장이 없다(소급 없음, kit 계약). */
    private val imminentFixes = (0..11).map { Fix(it * 8.0, it * 16.0, 0.0, 10.0) } + listOf(Fix(92.0, 181.0, 0.0, 10.0), Fix(96.0, 186.0, 0.0, 10.0), Fix(100.0, 191.0, 0.0, 10.0))

    @Test fun `③' 임박 큐 — 20m 앞 행동 톤(오른쪽) + 명령형 문장 1회, 상태 행에 남고 lastGuidance는 전문 유지`() = guideTest(dispatcher, { HttpResponse(200, routeJson(imminentSteps)) }) { h ->
        val base = startDetail(h, imminentFixes)
        h.speaker.spoken.clear()
        h.tones.played.clear()
        feed(h, imminentFixes, base)
        val imminent = h.catalog.get("guide.imminent.right")
        assertEquals(3, h.tones.played.count { it == BeaconTone.right }, h.tones.played.toString())
        assertEquals(1, h.speaker.texts.count { it == imminent }, h.speaker.texts.toString())
        assertEquals(imminent, h.model.ui.value.statusText)
        // 진행 상황은 임박 명령이 아니라 전문을 되읽는다(lastGuidance 불변).
        assertTrue(h.model.progressText().contains("현재 안내, "), h.model.progressText())
    }

    @Test fun `⑯ 조회 중 fix 5개 → 경로 호출 1회`() = guideTest(dispatcher) { h ->
        h.model.requestStart(h.request)
        settle()
        repeat(5) { h.walkTo(0.0, seconds = 1.0) }
        settle()
        assertEquals(1, h.transport.seenUrls.size)
        assertEquals(GuideMode.detail, h.model.ui.value.mode)
    }

    @Test fun `⑧ 워치독 — fix 정상이면 통지 0, 두절 8초 unreliable·15초 신호 약함·600초 세션 종료(종료 화면)`() = guideTest(dispatcher, { HttpResponse(200, "{\"result\":null}") }) { h ->
        h.model.requestStart(h.request)
        settle()
        h.walkTo(0.0)      // 원점 — 경로 없음 → 간략 폴백
        settle()
        assertEquals(GuideMode.brief, h.model.ui.value.mode)
        h.speaker.spoken.clear()
        h.tones.played.clear()
        repeat(8) { i ->
            h.walkTo(10.0 * (i + 1), seconds = 2.0, accuracy = 8.0)
            advanceTimeBy(2_000); runCurrent()
        }
        assertEquals(0, h.tones.played.count { it == BeaconTone.unreliable })
        assertFalse(h.speaker.texts.contains(h.catalog.get("beacon.weak")))
        // fix 두절.
        h.clock.now += 8.5; advanceTimeBy(8_500); runCurrent()
        assertEquals(1, h.tones.played.count { it == BeaconTone.unreliable })
        h.clock.now += 7.0; advanceTimeBy(7_000); runCurrent()
        assertEquals(1, h.speaker.texts.count { it == h.catalog.get("beacon.weak") })
        assertEquals(h.catalog.get("beacon.weak"), h.model.ui.value.statusText)
        h.steps.liveSample = StepSample(200, null)
        h.clock.now += 600.0; advanceTimeBy(600_000); runCurrent()
        assertEquals(GuideStatus.idle, h.model.ui.value.status)
        assertEquals(h.catalog.get("guide.endedIdle") to true, h.speaker.spoken.last())
        assertEquals(SessionEndKind.stopped, h.model.ui.value.endKind)
        assertNotNull(h.model.ui.value.arrivalDest)
        assertEquals(200, h.model.ui.value.arrivalHealth?.steps)
        assertFalse(h.coordinator.isActive)
    }

    private val finalSteps = listOf(Seg(300.0, "천호대로를 따라 300m 이동", target = "길동역"))
    private val finalApproachJson = "{\"offsetMeters\":20,\"relativeBearing\":0,\"bearingUnavailable\":null}"

    @Test fun `⑤ 최종 접근 — 진입 배치 서술(attention 진동) → 15m 안 도착(nearby 톤·종료 화면 arrived·문장 high)`() = guideTest(dispatcher, { HttpResponse(200, routeJson(finalSteps, finalApproachJson)) }) { h ->
        // 10초·15m 간격(40초 공백은 재획득 국면을 연다). 기하가 있으면 진입선은 종점(잔여 ≤ max(하한, 정확도))이라 300m까지 간다.
        val fixes = (0..20).map { Fix(it * 10.0, it * 15.0, 0.0, 8.0) }
        val base = startDetail(h, fixes)
        h.speaker.spoken.clear(); h.haptics.fired.clear(); h.tones.played.clear()
        feed(h, fixes, base)
        val intro = h.speaker.texts.last()
        assertTrue(intro.startsWith(h.catalog.get("guide.finalApproachRouteEnd")), intro)
        assertEquals(listOf(ResultHapticKind.attention), h.haptics.fired)
        assertNull(h.model.ui.value.remainingText)
        assertEquals(h.model.ui.value.statusText, h.model.ui.value.liveTopText)  // 화면 두 행은 원문, 발화만 낭독 정정
        assertNull(h.model.ui.value.currentStepIndex)
        assertEquals(GuideStatus.tracking, h.model.ui.value.status)
        // 다음 fix: 목적지(북 320m)에서 12m → 도착.
        h.model.handleFix(h.fixAt(Fix(205.0, 308.0, 0.0, 8.0), base)); runCurrent()
        val ui = h.model.ui.value
        assertEquals(GuideStatus.idle, ui.status)
        assertEquals(SessionEndKind.arrived, ui.endKind)
        assertEquals(h.dest, ui.arrivalDest)
        assertEquals(h.catalog.get("guide.arrived"), ui.statusText)
        assertEquals(h.catalog.get("guide.arrived") to true, h.speaker.spoken.last())
        assertTrue(h.tones.played.contains(BeaconTone.nearby))
        assertFalse(h.coordinator.isActive)
        assertTrue(ui.hasScreen)
        assertEquals("길동역 도착", bandSummaryText(ui, h.catalog))
    }

    @Test fun `⑨ 다른 앱 전경 중 도착 → 세션이 끝난 뒤 복귀해도 도착 문장을 갚는다(추적 가드 앞)`() = guideTest(dispatcher, { HttpResponse(200, routeJson(finalSteps, finalApproachJson)) }) { h ->
        // 10초·15m 간격(40초 공백은 재획득 국면을 연다). 기하가 있으면 진입선은 종점(잔여 ≤ max(하한, 정확도))이라 300m까지 간다.
        val fixes = (0..20).map { Fix(it * 10.0, it * 15.0, 0.0, 8.0) }
        val base = startDetail(h, fixes)
        h.env.foreground = false
        h.env.interactive = true
        h.model.setForeground(false)
        h.speaker.spoken.clear()
        feed(h, fixes, base)
        h.model.handleFix(h.fixAt(Fix(205.0, 308.0, 0.0, 8.0), base)); runCurrent()
        assertEquals(emptyList(), h.speaker.spoken)
        assertEquals(GuideStatus.idle, h.model.ui.value.status)
        h.env.foreground = true
        h.model.setForeground(true)
        // 진입 서술 장부는 stop()의 resetFinalApproach가 비운다(iOS 동형 — 끝난 경로의 배치 서술은 갚지 않는다). 남는 것은 도착 문장.
        assertEquals(listOf(h.catalog.get("guide.arrived")), h.speaker.texts)
    }

    private val offRouteSteps = listOf(Seg(500.0, "직진", target = "길동역"))
    private val offRouteFixes = listOf(Fix(0.0, 0.0, 0.0, 10.0), Fix(5.0, 100.0, 80.0, 10.0), Fix(13.0, 100.0, 80.0, 10.0), Fix(21.0, 100.0, 80.0, 10.0), Fix(29.0, 100.0, 80.0, 10.0))

    @Test fun `④ 이탈 확정 → 문장·warning 톤 → 자동 조회 1회 → 채택 문장(high)·success 진동·offRoute 해제`() = guideTest(dispatcher, { HttpResponse(200, routeJson(offRouteSteps)) }) { h ->
        val base = startDetail(h, offRouteFixes)
        h.speaker.spoken.clear(); h.tones.played.clear(); h.haptics.fired.clear()
        feed(h, offRouteFixes, base)
        assertTrue(h.speaker.texts.contains(h.catalog.get("guide.offRoute")))
        assertTrue(h.tones.played.contains(BeaconTone.warning))
        settle()
        assertEquals(2, h.transport.seenUrls.size, "시작 조회 + 자동 재조회")
        val ui = h.model.ui.value
        assertFalse(ui.offRoute)
        assertTrue(ui.offRouteEndedByReroute)
        val adopted = h.speaker.spoken.last()
        assertTrue(adopted.first.startsWith("새 경로로 다시 안내합니다. 안내 1개, 총 "), adopted.first)
        assertTrue(adopted.first.endsWith(". 직진"), adopted.first)
        assertTrue(adopted.second)
        assertEquals(listOf(ResultHapticKind.success), h.haptics.fired)
        assertEquals(GuideMode.detail, ui.mode)
    }

    @Test fun `④' 이탈 중 수동 재조회 — 진행 중이면 재진입 거부, 실패 응답이면 rerouteFailed·failure 진동`() = guideTest(dispatcher, { url ->
        if (url.contains("origin=37.5385")) HttpResponse(200, routeJson(offRouteSteps)) else HttpResponse(502, "{}")
    }) { h ->
        val base = startDetail(h, offRouteFixes)
        feed(h, offRouteFixes, base)
        settle()  // 자동 조회는 502 → 회차 종결(통지 없음), 이탈 유지
        assertTrue(h.model.ui.value.offRoute)
        h.speaker.spoken.clear(); h.haptics.fired.clear()
        h.model.requestReroute()
        assertTrue(h.model.ui.value.isRerouting)
        h.model.requestReroute()   // 재진입 no-op
        settle()
        assertFalse(h.model.ui.value.isRerouting)
        assertEquals(h.catalog.get("guide.rerouteFailed") to true, h.speaker.spoken.single())
        assertEquals(listOf(ResultHapticKind.failure), h.haptics.fired)
        assertEquals(3, h.transport.seenUrls.size)
        assertTrue(h.model.ui.value.offRoute)
    }

    @Test fun `⑩ 종료 화면은 백그라운드를 거친 복귀에서 30분이 지났으면 소거된다`() = guideTest(dispatcher) { h ->
        h.model.requestStart(h.request)
        settle()
        h.steps.liveSample = StepSample(100, null)
        h.model.stopByUser()
        assertNotNull(h.model.ui.value.arrivalDest)
        // 백그라운드 없이 29분: 유지.
        h.clock.now += 29 * 60.0
        h.model.setForeground(true)
        assertNotNull(h.model.ui.value.arrivalDest)
        // 백그라운드 경유 31분: 소거.
        h.model.setForeground(false)
        h.clock.now += 2 * 60.0
        h.model.setForeground(true)
        assertNull(h.model.ui.value.arrivalDest)
        assertFalse(h.model.ui.value.hasScreen)
    }

    @Test fun `⑮ 오디오 포커스 거절 — 3회 연속에 failure 진동 1회·문장 장부, 허가 뒤 재생·해제·문장 상환 1회`() = guideTest(dispatcher, { HttpResponse(200, "{\"result\":null}") }) { h ->
        h.tones.focusDeniedNext = 3
        h.model.requestStart(h.request)   // 시작 톤 = 거절 1
        settle()
        h.clock.now += 15.5; advanceTimeBy(16_000); runCurrent()  // 15초 무수용 → 간략 폴백(워치독 8초 unreliable = 거절 2)
        assertEquals(emptyList(), h.tones.played)
        assertFalse(h.model.ui.value.focusDenied)
        h.clock.now += 10.0; advanceTimeBy(10_000); runCurrent()   // unreliable 재통지 10초 = 거절 3
        assertTrue(h.model.ui.value.focusDenied)
        assertEquals(listOf(ResultHapticKind.failure), h.haptics.fired)
        assertFalse(h.speaker.texts.any { it.contains(h.catalog.get("android.guide.focusDenied")) })
        h.clock.now += 10.0; advanceTimeBy(10_000); runCurrent()   // 허가 → 재생
        assertEquals(listOf(BeaconTone.unreliable), h.tones.played)
        assertFalse(h.model.ui.value.focusDenied)
        h.speaker.spoken.clear()
        h.model.announceNow("다음 문장")
        assertEquals(listOf(h.catalog.get("android.guide.focusDenied") + " 다음 문장"), h.speaker.texts)
        h.model.announceNow("그다음")
        assertEquals("그다음", h.speaker.texts.last())
        assertEquals(1, h.haptics.fired.size)
    }

    @Test fun `⑱ 정식 빌드(게이트 거짓) — startWalk는 아무것도 만들지 않고 setForeground·setOutputSuppressed는 예외 없이 돈다`() = guideTest(dispatcher) { h ->
        GuideSession.attachForTest(h.model, h.coordinator)
        GuideSession.experimentalEnabled = { false }
        GuideSession.startWalk(h.request)
        settle()
        GuideSession.setForeground(false)
        GuideSession.setForeground(true)
        val owner = Any()
        GuideSession.setOutputSuppressed(true, owner)
        GuideSession.setOutputSuppressed(false, owner)
        assertFalse(GuideSession.isActive)
        assertFalse(GuideSession.hasScreen)
        assertEquals(0, h.controller.starts)
        assertEquals(0, h.tones.preloads)
        assertFalse(h.model.outputSuppressed)
    }

    @Test fun `주기 통지 — 직진 구간은 target 단문(statusIsNextPreview), 마지막 스텝은 목적지 틀`() = guideTest(dispatcher, { HttpResponse(200, routeJson(listOf(Seg(300.0, "천호대로를 따라 300m 이동", target = "장미공원"), Seg(100.0, "장미공원에서 오른쪽", action = "right")), finalApproachJson)) }) { h ->
        val fixes = (0..12).map { Fix(it * 10.0, it * 12.0, 0.0, 8.0) }
        val base = startDetail(h, fixes)
        h.speaker.spoken.clear()
        feed(h, fixes, base)
        val periodic = h.speaker.texts.firstOrNull { it.contains("직진하세요") }
        assertNotNull(periodic, h.speaker.texts.toString())
        assertTrue(periodic.startsWith("장미공원까지 "), periodic)
        assertTrue(h.model.ui.value.statusIsNextPreview)
        assertNotNull(h.model.ui.value.liveTopText)
    }

    @Test fun `주기 통지 — 마지막 스텝은 "{dest}까지 {distance}" 틀`() = guideTest(dispatcher, { HttpResponse(200, routeJson(finalSteps, finalApproachJson)) }) { h ->
        val fixes = (0..12).map { Fix(it * 10.0, it * 12.0, 0.0, 8.0) }
        val base = startDetail(h, fixes)
        h.speaker.spoken.clear()
        feed(h, fixes, base)
        assertTrue(h.speaker.texts.any { it.startsWith("길동역까지 ") && it.endsWith(" 미터") }, h.speaker.texts.toString())
        assertFalse(h.speaker.texts.any { it.contains("직진하세요") })
    }

    @Suppress("unused")
    private val origin: RoutePoint = north(0.0)
    @Suppress("unused")
    private val rightAction = WalkAction.right

    @Test fun `⑦ 억제 중 실행 안내는 최신 1개만 보관 → 해제 시 1회 복구 발화, 억제 중 종료는 그 문장을 버린다`() = guideTest(dispatcher, { HttpResponse(200, routeJson(longAhead)) }) { h ->
        val base = startDetail(h, longAheadFixes)
        h.speaker.spoken.clear()
        h.model.outputSuppressed = true
        feed(h, longAheadFixes, base)   // fix 10에서 "우회전B" 실행 안내 → 억제 중이라 보관
        assertEquals(emptyList(), h.speaker.spoken)
        h.model.outputSuppressed = false
        assertEquals(listOf("우회전B"), h.speaker.texts)
    }

    @Test fun `⑦' 억제 중 종료 — 보관된 실행 안내가 종료 직후 발화되지 않는다`() = guideTest(dispatcher, { HttpResponse(200, routeJson(longAhead)) }) { h ->
        val base = startDetail(h, longAheadFixes)
        h.speaker.spoken.clear()
        h.model.outputSuppressed = true
        feed(h, longAheadFixes, base)
        h.model.stopByUser()
        settle()
        assertFalse(h.speaker.texts.contains("우회전B"), h.speaker.texts.toString())
        assertFalse(h.model.outputSuppressed)
    }

    @Test fun `⑤' 최종 접근 주기 통지 — 진입 서술 뒤 15초 안에는 없고, 15초 뒤 1회`() = guideTest(dispatcher, { HttpResponse(200, routeJson(finalSteps, finalApproachJson)) }) { h ->
        val fixes = (0..20).map { Fix(it * 10.0, it * 15.0, 0.0, 8.0) }
        val base = startDetail(h, fixes)
        feed(h, fixes, base)
        h.speaker.spoken.clear()
        // 목적지는 북 315m — 진입 fix(300m, 거리 15m)가 도착 반경 안이어도 서술이 먼저다(⑰). 이후 fix는 16m 밖에서 맴돈다.
        for ((t, along) in listOf(205.0 to 296.0, 210.0 to 297.0, 214.0 to 298.0)) { h.model.handleFix(h.fixAt(Fix(t, along, 0.0, 8.0), base)); runCurrent() }
        assertEquals(emptyList(), h.speaker.spoken, "서술 15초 안에는 주기 통지가 없다")
        h.model.handleFix(h.fixAt(Fix(216.0, 298.5, 0.0, 8.0), base)); runCurrent()
        assertEquals(1, h.speaker.spoken.size)
        assertTrue(h.speaker.texts.single().endsWith("입니다."), h.speaker.texts.single())
        assertEquals(GuideStatus.tracking, h.model.ui.value.status)
    }

    @Test fun `⑨' 타 앱 전경 중 실행 안내(상태 행 비움) → 복귀 상환은 마지막 안내를 꼬리로 읽는다`() = guideTest(dispatcher, { HttpResponse(200, routeJson(longAhead)) }) { h ->
        val base = startDetail(h, longAheadFixes)
        h.env.foreground = false
        h.model.setForeground(false)
        h.speaker.spoken.clear()
        feed(h, longAheadFixes, base)   // "우회전B" 실행 안내가 타 앱 전경에 걸린다(statusText는 비어 있다)
        assertEquals(emptyList(), h.speaker.spoken)
        assertEquals("", h.model.ui.value.statusText)
        h.env.foreground = true
        h.model.setForeground(true)
        assertEquals(listOf("우회전B"), h.speaker.texts)
    }

    @Test fun `경유지 있는 세션의 간략 폴백 — 조용히 버리지 않고 waypointDropped를 high로 붙인다, 재시작 인자도 경유지 없이`() = guideTest(dispatcher, { HttpResponse(200, routeJson(longAhead)) }) { h ->
        val via = GuideWaypoint(BeaconDest(north(100.0).lat, lng0), "장미공원")
        h.model.requestStart(h.request.copy(waypoint = via))
        settle()
        h.walkTo(0.0)   // 응답에 waypoint 표지가 없다 → 상세 부적격 → 간략 폴백
        settle()
        assertTrue(h.transport.seenUrls.single().contains("via="))
        assertEquals(GuideMode.brief, h.model.ui.value.mode)
        val spoken = h.speaker.spoken.last()
        assertTrue(spoken.first.endsWith(h.catalog.get("android.guide.waypointDropped", "장미공원")), spoken.first)
        assertTrue(spoken.second)
        // 실패 뒤 재시작이 경유지를 되살리지 않는다.
        h.model.stopByUser()
        h.transport.seenUrls.clear()
        h.model.restart(); settle(); h.walkTo(0.0); settle()
        assertFalse(h.transport.seenUrls.single().contains("via="))
    }

    @Test fun `경유지 도착 — nearby 톤·viaArrived 문장, 이후 재조회는 경유지 없이`() = guideTest(dispatcher, { url ->
        if (url.contains("via=")) HttpResponse(200, walkBriefingJson(listOf(TestStep("직진A", listOf(north(0.0), north(150.0)), target = "장미공원"), TestStep("직진B", listOf(north(150.0), north(400.0)))), distanceMeters = 400, waypointStepIndex = 1))
        else HttpResponse(200, routeJson(listOf(Seg(400.0, "직진"))))
    }) { h ->
        val via = GuideWaypoint(BeaconDest(north(150.0).lat, lng0), "장미공원")
        val fixes = (0..30).map { Fix(it * 8.0, it * 8.0, 0.0, 8.0) }   // 240m까지 1m/s
        h.model.requestStart(h.request.copy(waypoint = via))
        settle()
        h.model.handleFix(h.fixAt(fixes[0], h.clock.now)); settle()
        assertEquals(GuideMode.detail, h.model.ui.value.mode)
        assertEquals(1 to "경유지 장미공원 도착", h.model.ui.value.routeWaypointRow)
        val base = h.clock.now
        h.tones.played.clear()
        feed(h, fixes, base)
        assertTrue(h.tones.played.contains(BeaconTone.nearby), h.tones.played.toString())
        assertTrue(h.speaker.texts.contains(h.catalog.get("directions.viaArrived", "장미공원")), h.speaker.texts.toString())
        assertNull(h.model.ui.value.routeWaypointRow?.takeIf { false })
    }
}
