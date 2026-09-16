package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Swift 표준 라이브러리 의미 미러 계약. 소비자가 음수·줄바꿈을 넘겨도 경계가 흔들리지 않게 잠근다. */
class SwiftSemanticsTest {
    /** Apple ICU 정규식 `\s`가 받는 코드포인트 전수(2026-09-16 실측, NSRegularExpression `^\s$` × 0~U+10FFFF) = 유니코드 White_Space. */
    private val swiftRegexSpace: Set<Int> =
        ((0x09..0x0D) + 0x20 + 0x85 + 0xA0 + 0x1680 + (0x2000..0x200A) + 0x2028 + 0x2029 + 0x202F + 0x205F + 0x3000).toSet()

    private fun codePointsWhere(predicate: (String) -> Boolean): Set<Int> =
        (0..0x10FFFF).filter { it !in 0xD800..0xDFFF && predicate(String(Character.toChars(it))) }.toSet()

    @Test fun `정규식 공백 집합은 Swift 약칭 공백과 전 코드포인트에서 같다`() {
        val space = Regex("[$REGEX_SPACE_MEMBERS]")
        assertEquals(swiftRegexSpace, codePointsWhere { space.matches(it) })
    }

    /** Swift `Character.isWhitespace`도 같은 날 전수 실측에서 정규식 약칭 공백과 같은 집합이었다. */
    @Test fun `문자 공백 판정은 Swift Character isWhitespace와 전 코드포인트에서 같다`() {
        assertEquals(swiftRegexSpace, codePointsWhere { it.length == 1 && it[0].isSwiftWhitespace() })
    }

    @Test fun `kit main 소스는 Kotlin 기본 공백 판정을 쓰지 않는다 — Swift 원본의 집합 미러를 지난다`() {
        val kotlinDefault = Regex("""\.(trim|trimStart|trimEnd)\(\)|\.is(Not|NullOr)?Blank\(\)|\.isWhitespace\(\)""")
        assertTrue(kotlinDefault.containsMatchIn("val s = raw.trim()") && kotlinDefault.containsMatchIn("if (line.isBlank())"))
        val root = Fixtures.repoRoot.resolve("android/kit/src/main")
        val sources = root.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
        assertTrue(sources.isNotEmpty())
        val offenders = sources.flatMap { f ->
            f.readLines().withIndex()
                .filter { (_, line) -> kotlinDefault.containsMatchIn(line) && !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*") }
                .map { "${f.relativeTo(root).path}:${it.index + 1}" }
        }
        assertEquals(emptyList(), offenders)
    }

    @Test fun `점5는 0에서 먼 쪽이다 — 짝수 반올림도 양의 방향 반올림도 아니다`() {
        assertEquals(3.0, 2.5.roundedAwayFromZero())
        assertEquals(-3.0, (-2.5).roundedAwayFromZero())
        assertEquals(1.0, 0.5.roundedAwayFromZero())
        assertEquals(-1.0, (-0.5).roundedAwayFromZero())
    }

    @Test fun `부동소수 경계 — 0점5 바로 아래와 큰 정수`() {
        assertEquals(0.0, 0.49999999999999994.roundedAwayFromZero())
        assertEquals(1e16, 1e16.roundedAwayFromZero())
        assertEquals(302.0, 302.4.roundedAwayFromZero())
    }

    @Test fun `공백 trim은 탭과 공백 구분자만 자르고 줄바꿈은 남긴다`() {
        assertEquals("65", " \t65\t ".trimSwiftWhitespaces())
        assertEquals("65\n", "65\n".trimSwiftWhitespaces())
        assertEquals("65", "\u300065\u00A0".trimSwiftWhitespaces())
    }

    @Test fun `공백·줄바꿈 trim은 U+0085를 자르고 정보 분리 문자 U+001C~U+001F는 남긴다`() {
        assertEquals("3", "\n\u0085\u2028 3\r\u2029\u000B".trimSwiftWhitespacesAndNewlines())
        assertEquals("\u001F3\u001C", "\u001F3\u001C".trimSwiftWhitespacesAndNewlines())
        assertEquals("", "\u0085".trimSwiftWhitespacesAndNewlines())
    }
}
