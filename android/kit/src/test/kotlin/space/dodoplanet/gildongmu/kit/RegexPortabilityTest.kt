package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** 주석 줄을 뺀 :kit main 소스 줄(위치, 내용) — :kit 소스 가드들이 같은 판정으로 스캔한다. */
internal fun kitMainCodeLines(): List<Pair<String, String>> {
    val root = Fixtures.repoRoot.resolve("android/kit/src/main")
    val sources = root.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
    assertTrue(sources.isNotEmpty())
    return sources.flatMap { f ->
        f.readLines().withIndex()
            .filter { (_, line) -> line.trimStart().let { !it.startsWith("//") && !it.startsWith("*") && !it.startsWith("/*") } }
            .map { "${f.relativeTo(root).path}:${it.index + 1}" to it.value }
    }
}

/**
 * 정규식 이식성 가드(코디네이터 판정 2026-09-16): JVM의 java.util.regex는 `\d`·`\s`·`\w`가 ASCII이고 안드로이드
 * 기기의 java.util.regex는 ICU 기반이라 유니코드(전각 숫자 등)까지 받는다 — JVM 테스트가 기기 동작을 대표하지
 * 못한다. `:kit` main 소스는 명시 클래스(`[0-9]`·`REGEX_SPACE_MEMBERS`·`[A-Za-z0-9_]`)와 허용된 유니코드 카테고리만 쓴다.
 */
class RegexPortabilityTest {
    private val shorthand = Regex("""\\[dswhDSWH]""")
    private val property = Regex("""\\[pP]\{([^}]*)\}""")

    /** 두 엔진이 다르게 읽는 문법: 중괄호 없는 `\pL`(JVM은 컴파일, Apple ICU는 컴파일 오류)·POSIX 괄호식(JVM은 `[[:alpha:]]`를 문자 집합으로 읽는다). */
    private val unportableSyntax = Regex("""\\[pP][A-Za-z]|\[\[:""")

    /**
     * 두 엔진 동치를 전수 실측한 일반 카테고리(2026-09-16, Apple ICU ↔ JVM 25, 0~U+10FFFF): 차이는 JVM에 아직 없는 신규 배정 문자와
     * Apple 사설 영역(U+F870~U+F8D6)뿐이다. POSIX 계열은 갈린다 — `Alpha`·`Punct`·`Digit`이 JVM 52·32·10자, ICU 147,456·865·770자.
     */
    private val allowedProperties = setOf("Z", "N", "Nd", "L", "Nl", "M", "Pc")

    @Test fun `kit main 소스에 정규식 단축 클래스가 없다`() {
        assertEquals(emptyList(), kitMainCodeLines().filter { shorthand.containsMatchIn(it.second) }.map { it.first })
    }

    @Test fun `kit main 소스의 유니코드 프로퍼티 클래스는 허용 목록뿐이다`() {
        val offenders = kitMainCodeLines().flatMap { (at, line) ->
            property.findAll(line).map { it.groupValues[1] }.filter { it !in allowedProperties }.map { "$at $it" }
        }
        assertEquals(emptyList(), offenders)
    }

    @Test fun `kit main 소스에 두 엔진이 다르게 읽는 문법이 없다`() {
        assertEquals(emptyList(), kitMainCodeLines().filter { unportableSyntax.containsMatchIn(it.second) }.map { it.first })
    }

    @Test fun `가드 자체가 살아 있다`() {
        assertTrue(shorthand.containsMatchIn("""Regex("(\d)m")"""))
        assertTrue(shorthand.containsMatchIn("""Regex("\\s+")"""))
        assertTrue(shorthand.containsMatchIn("""Regex("\h+")"""))
        assertTrue(!shorthand.containsMatchIn("""Regex("([0-9])m")"""))
        assertEquals(listOf("Alpha", "Z"), property.findAll("""Regex("[\p{Alpha}\P{Z}]")""").map { it.groupValues[1] }.toList())
        assertTrue(unportableSyntax.containsMatchIn("""Regex("\pL+")""") && unportableSyntax.containsMatchIn("""Regex("[[:alpha:]]")"""))
        assertTrue(!unportableSyntax.containsMatchIn("""Regex("[\p{L}\[]")"""))
    }
}
