package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * 정규식 이식성 가드(코디네이터 판정 2026-09-16): JVM의 java.util.regex는 `\d`·`\s`·`\w`가 ASCII이고 안드로이드
 * 기기의 java.util.regex는 ICU 기반이라 유니코드(전각 숫자 등)까지 받는다 — JVM 테스트가 기기 동작을 대표하지
 * 못한다. `:kit` main 소스는 명시 클래스(`[0-9]`·`[ \t\n\r]`·`[A-Za-z0-9_]`)만 쓴다.
 */
class RegexPortabilityTest {
    private val shorthand = Regex("""\\[dswDSW]""")

    @Test fun `kit main 소스에 정규식 단축 클래스가 없다`() {
        val root = Fixtures.repoRoot.resolve("android/kit/src/main")
        val sources = root.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
        assertTrue(sources.isNotEmpty())
        val offenders = sources.flatMap { f ->
            f.readLines().withIndex()
                .filter { (_, line) -> shorthand.containsMatchIn(line) && !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*") }
                .map { "${f.relativeTo(root).path}:${it.index + 1}" }
        }
        assertEquals(emptyList(), offenders)
    }

    @Test fun `가드 자체가 살아 있다`() {
        assertTrue(shorthand.containsMatchIn("""Regex("(\d)m")"""))
        assertTrue(shorthand.containsMatchIn("""Regex("\\s+")"""))
        assertTrue(!shorthand.containsMatchIn("""Regex("([0-9])m")"""))
    }
}
