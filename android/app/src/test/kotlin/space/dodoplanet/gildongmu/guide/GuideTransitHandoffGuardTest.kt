package space.dodoplanet.gildongmu.guide

import space.dodoplanet.gildongmu.kit.Fixtures
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * M5 §6-6 도보 인계의 소스 가드(iOS guidance-gate-drift 동형). 전이 순서가 곧 계약이라 호출부 표와 순서를 소스 수준에서 잠근다 — 테스트는 경로 하나를
 * 밟지만, 새 호출부(시트 단계)가 연결을 우회하는 것은 이 표가 잡는다.
 */
class GuideTransitHandoffGuardTest {
    private val app = Fixtures.repoRoot.resolve("android/app/src/main")
    private val pkg = app.resolve("kotlin/space/dodoplanet/gildongmu")
    private val guide = pkg.resolve("guide")
    private val allSources = pkg.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
    private val session = guide.resolve("GuideSession.kt").readText()

    /** 주석 줄을 뺀 코드 줄(호출부 판정이 KDoc의 예시 문장에 속지 않게). */
    private fun code(text: String): String = text.lines().filterNot { it.trimStart().let { l -> l.startsWith("*") || l.startsWith("/**") || l.startsWith("//") } }.joinToString("\n")

    /** `GuideSession.kt`에서 `marker`로 시작하는 함수의 본문(다음 4칸 들여쓰기 닫는 괄호까지). */
    private fun body(marker: String): String = session.substringAfter(marker).substringBefore("\n    }\n")

    private fun callersOutsideSession(pattern: Regex): List<String> =
        allSources.filter { it.name != "GuideSession.kt" && pattern.containsMatchIn(code(it.readText())) }.map { it.name }

    @Test fun `① startTransit 호출부는 길찾기 대중교통 시작 버튼 하나`() {
        assertEquals(listOf("TransitGuideStartButton.kt"), callersOutsideSession(Regex("""\bstartTransit\(""")))
        // 시작 게이트(iOS `transitGuideStartable`)를 지난 경로에만 버튼이 선다 — 도보 전용 경로의 죽은 버튼 차단.
        val button = guide.resolve("ui/TransitGuideStartButton.kt").readText()
        assertTrue(button.contains("if (buildTransitGuideRoute(route) != null) TransitGuideStartButton("), "시작 게이트")
        // 진입점이 열렸으니 두 모델 훅이 배선돼 있어야 한다(⑥) — 비어 있으면 `completeOrAdvance`가 환승 도보를 건너뛴다.
        assertTrue(body("private fun wireTransitHooks(").contains("model.onTransferWalk = ::transitTransferWalk"))
        // 시작 실패 행 표식: 대중교통 시작만 세우고 도보·자동차 공개 시작은 지운다(거부 판정 뒤).
        // 지난 도보의 실패도 거둔다 — 승차 전 도보 없는 경로가 인계 도보의 옛 실패 행을 물려받지 않게(리뷰 지적 1).
        assertTrue(body("fun startTransit(").let { b -> b.indexOf("refuseIfActive()").let { r -> r >= 0 && r < b.indexOf("walk.clearFailure()") && b.indexOf("walk.clearFailure()") < b.indexOf("_transitStartRoute.value = TransitStartMark(request.route)") } })
        for (fn in listOf("fun startWalk(", "fun startCar(")) assertTrue(body(fn).let { b -> b.indexOf("refuseIfActive()").let { r -> r >= 0 && r < b.indexOf("_transitStartRoute.value = null") } }, fn)
        // 버튼은 키가 아니라 경로 객체로 가른다 — `routeKey`는 한 응답 안에서만 유일하다(리뷰 지적 2).
        assertTrue(button.contains("started?.route === route"), "객체 동일성")
        // 슬롯 배선: 길찾기 화면이 넘기고 대중교통 펼침 본문의 첫 항목으로 그린다(null로 바꾸면 버튼이 조용히 사라진다).
        val dirs = pkg.resolve("directions")
        assertTrue(code(dirs.resolve("DirectionsScreen.kt").readText()).contains("guideStart = transitGuideStartSlot(s)"), "길찾기 화면 배선")
        val rows = dirs.resolve("RouteRows.kt").readLines()
        val open = rows.indexOfFirst { "DisclosureRow(" in it && "tag = \"transit-\$key\"" in it }
        val first = rows.drop(open + 1).first { it.isNotBlank() && !it.trim().startsWith("//") }
        assertEquals("guideStart?.invoke(entry.route, entry.name)", first.trim(), "펼침 본문 첫 항목")
        // 인계 도보의 시작 실패 행(B28): 길찾기 선두, 추적 중 「안내 종료」 블록 뒤에 선다(빠지면 인계 실패가 화면 어디에도 남지 않는다).
        val screen = code(dirs.resolve("DirectionsScreen.kt").readText())
        assertTrue(screen.indexOf("directions-guide-stop").let { stop -> stop >= 0 && stop < screen.indexOf("GuideHandoffFailureRow()") && screen.indexOf("GuideHandoffFailureRow()") < screen.indexOf("val results = s.results") }, "선두 실패 행 배선")
        assertEquals(1, Regex("""\bstartTransit\(""").findAll(code(session)).count(), "정의 한 곳뿐")
        assertTrue(body("fun startTransit(").contains("refuseIfActive()"), "공개 시작은 거부 판정을 먼저 지난다")
    }

    @Test fun `② beginBeacon 호출부는 spec 6-6 표 네 곳`() {
        val calls = Regex("""(?<!fun )\bbeginBeacon\(""").findAll(code(session)).count()
        assertEquals(4, calls, "startWalk·startCar·beginTransit·transitTransferWalk")
        for (fn in listOf("fun startWalk(", "fun startCar(", "private fun beginTransit(", "fun transitTransferWalk(")) {
            assertTrue(body(fn).contains("beginBeacon("), fn)
        }
        assertEquals(emptyList(), callersOutsideSession(Regex("""\bbeginBeacon\(""")))
        // 연결이 스스로 연 시작은 연결을 지우지 않는다(iOS 설계 리뷰) — 취소 게이트는 본문 맨 앞, 예외 플래그 아래.
        val begin = body("private fun beginBeacon(").trimStart().substringAfter("{").trimStart()
        assertTrue(begin.startsWith("if (!launchingPrewalk) {"), begin.take(80))
        val gate = begin.substringBefore("}")
        assertTrue(gate.contains("retirePrewalkRestart()") && gate.contains("cancelPrewalk()"), gate)
        assertTrue(body("private fun launchPrewalk(").let { it.indexOf("launchingPrewalk = true") in 0 until it.indexOf("startWalk()") })
    }

    @Test fun `③ startWalk 호출부는 시작 버튼, 자동차 인계, 하차 인계 세 곳`() {
        assertEquals(listOf("WalkGuideStartButton.kt"), callersOutsideSession(Regex("""GuideSession\.startWalk\(""")))
        // 인자 없는 `startWalk()`는 `launchPrewalk`의 시작 람다 매개변수다(iOS 같은 이름) — 공개 함수 호출이 아니다.
        val calls = Regex("""(?<!fun )\bstartWalk\((?!\))""").findAll(code(session)).count()
        assertEquals(2, calls, "acceptCarWalkHandoff·acceptWalkHandoff")
        assertTrue(body("fun acceptCarWalkHandoff()").contains("startWalk(request)"))
        assertTrue(body("fun acceptWalkHandoff()").contains("startWalk("))
    }

    @Test fun `④ 대중교통 시작 창구는 GuideSession 한 곳`() {
        assertEquals(emptyList(), callersOutsideSession(Regex("""\btransit\.start\(|\.startAfterPrewalk\(""")))
        assertEquals(1, Regex("""\btransit\.start\(""").findAll(code(session)).count(), "beginTransit의 승차 전 도보 없는 분기")
        assertTrue(body("private fun beginTransit(").contains("transit.start("))
    }

    @Test fun `⑤ 도보 재시작은 restartBeacon 한 곳`() {
        assertEquals(emptyList(), callersOutsideSession(Regex("""\.restart\(\)""")))
        assertEquals(2, Regex("""\bwalk\.restart\(\)""").findAll(code(session)).count())
        val restart = body("fun restartBeacon()")
        assertTrue(restart.contains("refuseIfActive()") && restart.contains("walk.restart()") && restart.contains("launchPrewalk(context.renewed())"), restart)
        assertTrue(pkg.resolve("guide/ui/WalkGuideStartButton.kt").readText().contains("GuideSession.restartBeacon()"))
    }

    @Test fun `⑥ 대중교통 모델 훅은 GuideSession이 배선한다`() {
        val wire = body("private fun wireTransitHooks(")
        assertTrue(wire.contains("model.onTransferWalk = ::transitTransferWalk"), wire)
        assertTrue(wire.contains("model.onPassedPrewalk = ::transitPassedPrewalk"), wire)
        assertTrue(body("fun attach(").contains("wireTransitHooks(transit)"), "앱 조립")
        assertTrue(body("internal fun attachForTest(").contains("wireTransitHooks(it)"), "테스트 조립도 같은 배선")
        assertEquals(emptyList(), callersOutsideSession(Regex("""\.onTransferWalk\s*=|\.onPassedPrewalk\s*=""")))
    }

    @Test fun `⑦ 하차 인계는 출구를 정지 앞에서 읽고 같은 전이 순서를 지킨다`() {
        val accept = body("fun acceptWalkHandoff()")
        val order = listOf("pendingWalkHandoff", "transit.stop(", "transit.clearWalkHandoff()", "walkHandoffJob = uiScope.launch", "delay(HANDOFF_GAP_MS)", "startWalk(")
        val at = order.map { accept.indexOf(it) }
        assertTrue(at.all { it >= 0 } && at == at.sorted(), order.zip(at).toString())
        // 출구 값을 싣는 자리는 이 한 곳(나머지 시작 요청은 `exitLead = null`을 적는다).
        val lead = Regex("""(?<!val )\bexitLead = (?!null\b)""")
        assertEquals(1, lead.findAll(code(session)).count())
        assertTrue(lead.containsMatchIn(accept))
        assertEquals(listOf("WalkGuideModel.kt"), callersOutsideSession(lead), "모델 안은 저장 요청 동기화(`exitHold?.lead`) 한 곳")
    }

    @Test fun `⑧ 단계 6 표식은 남지 않는다`() {
        val markers = allSources.flatMap { f -> f.readLines().withIndex().filter { "단계 6:" in it.value }.map { "${f.name}:${it.index + 1}" } }
        assertEquals(emptyList(), markers)
    }
}
