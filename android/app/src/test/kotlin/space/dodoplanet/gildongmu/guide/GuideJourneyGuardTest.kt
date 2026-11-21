package space.dodoplanet.gildongmu.guide

import space.dodoplanet.gildongmu.kit.Fixtures
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * 여정(B26, M5 §7-7) 세션 조율의 소스 가드 — 호출부 표·첫 줄 가드·안전 인자(기본값 없음)를 소스 수준에서 잠근다. 전이는 `GuideSessionJourneyTest`가 밟는다.
 */
class GuideJourneyGuardTest {
    private val pkg = Fixtures.repoRoot.resolve("android/app/src/main/kotlin/space/dodoplanet/gildongmu")
    private val guide = pkg.resolve("guide")
    private val allSources = pkg.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
    private val session = guide.resolve("GuideSession.kt").readText()

    private fun code(text: String): String = text.lines().filterNot { it.trimStart().let { l -> l.startsWith("*") || l.startsWith("/**") || l.startsWith("//") } }.joinToString("\n")
    private fun body(marker: String): String = session.substringAfter(marker).substringBefore("\n    }\n")

    @Test fun `startJourney 호출부는 길찾기 여정 결과 하나뿐이다(B29 채팅 카드가 둘째로 더한다)`() {
        val callers = allSources.filter { it.name != "GuideSession.kt" && Regex("""\bstartJourney\(""").containsMatchIn(code(it.readText())) }.map { it.name }
        assertTrue(callers.all { it == "JourneyResultRows.kt" }, "허용 밖 호출부: $callers")
        // 공개 시작 함수의 거부 판정을 먼저 지난다.
        assertTrue(body("fun startJourney(").let { b -> b.indexOf("refuseIfActive()") in 0 until b.indexOf("JourneyState.start(") })
    }

    @Test fun `beginTransit 호출부는 공개 대중교통 시작과 여정 단계 시작 둘`() {
        val calls = Regex("""(?<!fun )\bbeginTransit\(""").findAll(code(session)).count()
        assertEquals(2, calls)
        assertTrue(body("fun startTransit(").contains("beginTransit(request, aboard = null)"))
        assertTrue(body("private fun startJourneyStage(").contains("aboard = plan.aboard"))
    }

    @Test fun `startJourneyStage 첫 줄 가드는 token·도보 시작·도보 추적·대중교통 추적·계획 네 항이다`() {
        val guard = body("private fun startJourneyStage(").lines().first { it.trimStart().startsWith("if (journey?.token != token") }
        for (term in listOf("journey?.token != token", "walk.ui.value.starting", "walk.isTracking", "transit.isTracking", "plan == null")) {
            assertTrue(guard.contains(term), term)
        }
    }

    @Test fun `점유 두 층 — isOccupied는 여정을 보고 거부 판정은 isOccupied를 본다`() {
        assertTrue(session.contains("val isOccupied: Boolean get() = isActive || journey != null"))
        assertFalse(Regex("""val isActive: Boolean get\(\) = [^\n]*journey""").containsMatchIn(session), "모델 입구가 보는 isActive에 여정을 넣지 않는다")
        assertTrue(body("private fun refuseIfActive(").contains("if (!isOccupied) return false"))
    }

    @Test fun `aboard·markChained는 기본값이 없다`() {
        val transit = guide.resolve("TransitGuideModel.kt").readText()
        assertTrue(Regex("""fun start\([^)]*aboard: TransitAboardStart\?\)""").containsMatchIn(transit), "transit.start")
        assertTrue(session.contains("private fun beginTransit(request: TransitStartRequest, aboard: TransitAboardStart?)"))
        assertTrue(guide.resolve("JourneyPlan.kt").readText().contains("val aboard: TransitAboardStart?,\n"), "JourneyPlan")
        val walk = guide.resolve("WalkGuideModel.kt").readText()
        assertTrue(walk.contains("fun markChained(arrivalText: String?, bridgesStartFailure: Boolean)"))
        for (src in listOf(transit, session, walk)) assertFalse(Regex("""aboard: TransitAboardStart\? =""").containsMatchIn(src))
    }

    @Test fun `여정 단계가 연 도보 시작은 연결을 지우지 않는다(beginBeacon 예외)`() {
        assertTrue(body("private fun beginBeacon(").contains("if (!launchingPrewalk && !launchingJourneyStage) cancelPrewalk()"))
        assertTrue(body("private fun launchJourneyBeacon(").let { it.indexOf("launchingJourneyStage = true") in 0 until it.indexOf("beginBeacon(request)") })
    }

    @Test fun `서비스 넘김 — 손잡이가 보유자 판정을 묻고, 알림 종료는 세대별 requestCode, 리스너는 세대를 캡처한다(§7-4)`() {
        assertTrue(session.contains("controller.retainer = ::retainServiceForJourney"))
        assertTrue(body("private fun retainServiceForJourney(").contains("is JourneyPhase.Failed) return null"), "실패 국면은 들지 않는다")
        val notification = guide.resolve("GuideNotification.kt").readText()
        assertTrue(notification.contains("STOP_REQUEST_BASE + generation"))
        val service = guide.resolve("GuideForegroundService.kt").readText()
        assertTrue(service.contains("onFix = { fix -> GuideSession.serviceFix(gen, fix) }"))
        assertFalse(service.contains("generation?.let { GuideSession.serviceFix("), "실행 시점 세대 읽기 금지")
    }
}
