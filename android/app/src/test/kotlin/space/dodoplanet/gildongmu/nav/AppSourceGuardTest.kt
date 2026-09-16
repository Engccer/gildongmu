package space.dodoplanet.gildongmu.nav

import space.dodoplanet.gildongmu.kit.Fixtures
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** 앱 층 구조 가드(spec §8): 위치는 한 곳에서만, 백그라운드 위치·GMS 의존 0. */
class AppSourceGuardTest {
    private val android = Fixtures.repoRoot.resolve("android")
    private val sources = android.resolve("app/src/main").walkTopDown().filter { it.isFile && (it.extension == "kt" || it.extension == "xml") }.toList()

    @Test fun `LocationManager 생성은 AndroidLocationSource 한 곳뿐이다`() {
        val creators = sources.filter { f -> f.readText().let { it.contains("LocationManager::class.java") || it.contains("LOCATION_SERVICE") } }
        assertEquals(listOf("AndroidLocationSource.kt"), creators.map { it.name })
    }

    @Test fun `백그라운드 위치 권한 문자열은 0이다`() {
        assertTrue(sources.none { it.readText().contains("ACCESS_BACKGROUND_LOCATION") })
    }

    /**
     * 체인을 여러 줄로 쪼개도 잡는다(주석 줄은 뺀 뒤 한 줄로 합쳐 스캔). 축 둘: `mergedRow(...)` 경유와 `focusable()` 직접 경로 —
     * 그 호출 뒤에 이어지는 `.x(...)` 체인 안에 `focusRequester(`가 오면 위반(괄호 균형을 세므로 중첩 인자도 다룬다).
     */
    @Test fun `착지 requester는 focusable 앞에 준다 — mergedRow·focusable 뒤 focusRequester 순서 금지`() {
        val offenders = sources.filter { it.extension == "kt" }.filter { f ->
            val code = f.readLines().filter { l -> val t = l.trimStart(); !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/**") }.joinToString(" ")
            hasRequesterAfterFocusTarget(code)
        }.map { it.name }
        assertEquals(emptyList(), offenders)
        // 가드 자체가 살아 있다
        assertTrue(hasRequesterAfterFocusTarget("""Modifier.mergedRow("k", spoken, focus = requesterFor(key)) .headingText() .focusRequester(r)"""))
        assertTrue(hasRequesterAfterFocusTarget("""Modifier.focusable().padding(8.dp).focusRequester(r)"""))
        assertTrue(!hasRequesterAfterFocusTarget("""Modifier.focusRequester(r).mergedRow("k", focus = requesterFor(key)).headingText()"""))
        assertTrue(!hasRequesterAfterFocusTarget("""Modifier.mergedRow("k").padding(4.dp) ; val x = other.focusRequester(r)"""))
    }

    /** `mergedRow(`·`focusable(`의 닫는 괄호 뒤로 이어지는 `.name(...)` 체인만 따라가며 `focusRequester`를 찾는다. */
    private fun hasRequesterAfterFocusTarget(code: String): Boolean {
        val starts = Regex("""\b(mergedRow|focusable)\(""")
        for (m in starts.findAll(code)) {
            var i = skipBalanced(code, m.range.last) ?: continue
            while (true) {
                val chain = Regex("""^\s*\.([A-Za-z_][A-Za-z0-9_]*)\(""").find(code.substring(i)) ?: break
                if (chain.groupValues[1] == "focusRequester") return true
                i = skipBalanced(code, i + chain.range.last) ?: break
            }
        }
        return false
    }

    /** `openIndex`가 `(`일 때 짝 `)`의 다음 인덱스. 없으면 null. */
    private fun skipBalanced(code: String, openIndex: Int): Int? {
        var depth = 0
        for (j in openIndex until code.length) {
            when (code[j]) { '(' -> depth++; ')' -> { depth--; if (depth == 0) return j + 1 } }
        }
        return null
    }

    @Test fun `내 주변·검색의 pop 복귀 슬롯은 화면이 실제로 부른다`() {
        val nearby = android.resolve("app/src/main/kotlin/space/dodoplanet/gildongmu/nearby/NearbyKindScreen.kt").readText()
        assertTrue(nearby.contains("vm.returnFocus.remember(") && nearby.contains("vm.returnFocus.take()"))
        val search = android.resolve("app/src/main/kotlin/space/dodoplanet/gildongmu/search/SearchScreen.kt").readText()
        assertTrue(search.contains("vm.rememberReturnFocus(") && search.contains("vm.takeReturnFocus()"))
    }

    @Test fun `화면은 Scaffold를 직접 열지 않는다(AppScreenScaffold — 이중 인셋 방지)`() {
        val allowed = setOf("AppRoot.kt", "AppTopBar.kt")
        val offenders = sources.filter { it.extension == "kt" && it.name !in allowed && Regex("""\bScaffold\(""").containsMatchIn(it.readText()) }.map { it.name }
        assertEquals(emptyList(), offenders)
    }

    @Test fun `Google Play 서비스 의존은 0이다`() {
        val gradle = listOf(android.resolve("app/build.gradle.kts"), android.resolve("gradle/libs.versions.toml"))
        assertTrue(gradle.none { it.readText().contains("play-services") })
    }
}
