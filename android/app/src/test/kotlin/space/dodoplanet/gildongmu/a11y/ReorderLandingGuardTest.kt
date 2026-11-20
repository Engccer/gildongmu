package space.dodoplanet.gildongmu.a11y

import space.dodoplanet.gildongmu.kit.Fixtures
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * 순서 바꾸기 뒤 옮긴 행 다시 착지(재감사 1-2, iOS `keepFocusAfterMove`). 노드만 옮기면 행이 화면 밖으로 나갈 때 한소네 커서가 화면 제목으로
 * 떨어졌다(실기기 2026-11-21). 순서 바꾸기 작업 메뉴를 다는 화면은 전부 옮긴 행에 `bringIntoViewRequester`를 달고 이동 뒤 `pending`을 세운다.
 */
class ReorderLandingGuardTest {
    private val app = Fixtures.repoRoot.resolve("android/app/src/main/kotlin/space/dodoplanet/gildongmu")

    @Test fun `순서 바꾸기 작업 메뉴를 다는 화면은 옮긴 행을 다시 착지시킨다`() {
        val users = app.walkTopDown().filter { it.isFile && it.extension == "kt" && it.name != "ReorderActions.kt" }
            .filter { it.readText().contains("reorderCustomActions(") }.toList()
        assertEquals(setOf("SearchScreen.kt", "DirectionsScreen.kt", "EndpointSearchContent.kt"), users.map { it.name }.toSet())
        for (f in users) {
            val code = f.readText()
            assertTrue(code.contains("rememberMovedRowLanding {"), "${f.name}: 착지 도우미")
            assertTrue(Regex("""bringIntoViewRequester\((moved\w*\.bringFor|bringFor)\(""").containsMatchIn(code), "${f.name}: 행 가시화")
            assertTrue(Regex("""moved\w*\.pending = """).containsMatchIn(code), "${f.name}: 이동 뒤 착지 요청")
        }
    }

    @Test fun `착지는 스크롤을 기다린 뒤 포커스를 주고 일을 마친 뒤 신호를 끈다`() {
        val code = app.resolve("a11y/ReorderActions.kt").readText().substringAfter("fun rememberMovedRowLanding(")
        val bring = code.indexOf(".bringIntoView()")
        val focus = code.indexOf(".requestFocus()")
        val off = code.indexOf("landing.pending = null")
        assertTrue(bring in 0 until focus && focus < off, "가시화 → 포커스 → 신호 끄기 순서")
    }
}
