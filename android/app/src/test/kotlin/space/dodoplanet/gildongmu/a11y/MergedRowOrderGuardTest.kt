package space.dodoplanet.gildongmu.a11y

import space.dodoplanet.gildongmu.kit.Fixtures
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * A77 소스 가드: 낭독 이름(`spoken`)을 넘기는 `mergedRow`는 자식 글자를 `clearAndSetSemantics`로 지우고, 그 지우기는 같은 노드에서 자기 **뒤에** 붙은
 * 시맨틱(작업 메뉴·헤딩)까지 지운다. 그래서 낭독 이름 있는 호출 바로 뒤에 `.semantics`·`.headingText()`가 오면 메뉴·헤딩이 조용히 사라진다 — 앞으로 옮긴다.
 */
class MergedRowOrderGuardTest {
    private val pkg = Fixtures.repoRoot.resolve("android/app/src/main/kotlin/space/dodoplanet/gildongmu")
    private val sources = pkg.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()

    private data class Call(val file: String, val args: List<String>, val after: String)

    /** `.mergedRow(` 호출마다 최상위 인자와 닫는 괄호 뒤 글자(공백·줄바꿈 제외)를 꺼낸다. */
    private fun calls(): List<Call> = sources.flatMap { f ->
        val text = f.readText()
        Regex("""\.mergedRow\(""").findAll(text).map { m ->
            var depth = 1
            var i = m.range.last + 1
            val args = mutableListOf<String>()
            val cur = StringBuilder()
            var inString = false
            while (depth > 0) {
                val c = text[i]
                if (c == '"' && text[i - 1] != '\\') inString = !inString
                if (!inString) when (c) {
                    '(', '{', '[' -> depth++
                    ')', '}', ']' -> depth--
                }
                if (depth == 1 && c == ',' && !inString) { args += cur.toString().trim(); cur.clear() } else if (depth > 0) cur.append(c)
                i++
            }
            args += cur.toString().trim()
            Call(f.name, args.filter { it.isNotEmpty() }, text.substring(i).trimStart().take(40))
        }.toList()
    }

    /** 낭독 이름을 넘기는가 — 둘째 위치 인자이거나 `spoken =` 이름 인자. */
    private fun Call.passesSpoken(): Boolean =
        args.any { named.find(it)?.groupValues?.get(1) == "spoken" } || (args.size >= 2 && !named.containsMatchIn(args[1]))

    /** 이름 인자 머리(`focus = …`). `takeIf { it != … }`의 `!=`는 이름 인자가 아니다. */
    private val named = Regex("""^(\w+)\s*=(?!=)""")

    @Test fun `낭독 이름을 넘기는 mergedRow 뒤에는 작업 메뉴·헤딩 시맨틱이 오지 않는다`() {
        val all = calls()
        val spoken = all.filter { it.passesSpoken() }
        // 표본이 비면 가드가 아무것도 보지 않는다 — A77 자리(검색 둘·내 주변 넷·Lines·TextRow)가 잡혀야 한다.
        assertTrue(spoken.size >= 10, "낭독 이름 호출 표본: ${spoken.map { it.file }}")
        val bad = spoken.filter { c -> listOf(".semantics", ".headingText", ".clickable", ".clearAndSetSemantics").any { c.after.startsWith(it) } }
        assertEquals(emptyList(), bad.map { "${it.file}: mergedRow(${it.args.joinToString()}) 뒤 ${it.after}" })
    }

    @Test fun `mergedRow는 낭독 이름이 있을 때만 자식 글자를 지운다`() {
        val body = pkg.resolve("a11y/A11y.kt").readText().substringAfter("fun Modifier.mergedRow(").substringBefore("\n\n")
        assertTrue(body.contains("if (spoken != null) Modifier.clearAndSetSemantics { contentDescription = spoken } else Modifier.semantics(mergeDescendants = true) {}"), body)
        // 지우기는 맨 끝(focusable·testTag·착지 요청자보다 안쪽) — 앞에 두면 그것들의 시맨틱이 지워진다.
        assertTrue(body.indexOf(".focusable()") in 0 until body.indexOf("clearAndSetSemantics"))
    }

    /** `mergedRow` 밖의 병기 줄 두 자리(주변 상황 장소 줄, 위치 표시줄)도 낭독 이름이 있으면 글자를 지운다(한소네 2026-11-21 위치 표시줄 두 번 출력 실측). */
    @Test fun `mergedRow 밖 병기 줄도 낭독 이름이 있으면 글자를 지운다`() {
        val scene = pkg.resolve("nearby/SceneSection.kt").readText()
        assertTrue(scene.contains("if (spoken != null) Modifier.clearAndSetSemantics { contentDescription = spoken; customActions = actions }"))
        val bar = pkg.resolve("location/LocationBar.kt").readText()
        assertTrue(bar.contains("Text(line.visual, if (spoken != null) Modifier.clearAndSetSemantics { contentDescription = spoken } else Modifier)"))
        assertFalse(Regex("""\.semantics \{ if \(spoken != null\) contentDescription = spoken \}""").containsMatchIn(bar), "버튼에 낭독 이름을 주면 글자와 함께 두 번 나온다")
    }

    @Test fun `TextRow는 작업 메뉴를 mergedRow 앞에 붙인다`() {
        val row = pkg.resolve("directions/RouteRows.kt").readText().substringAfter("fun TextRow(").substringBefore("\n}\n")
        assertTrue(row.contains("base.semantics { customActions = actions }).mergedRow(tag, spoken, focus)"), row)
    }
}
