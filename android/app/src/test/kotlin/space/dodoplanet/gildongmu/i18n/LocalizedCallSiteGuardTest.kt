package space.dodoplanet.gildongmu.i18n

import space.dodoplanet.gildongmu.repoRoot
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * 인자 있는 문자열 조회는 `appLocalized`·`appString`만 지난다(spec §6). 네 꼴(`getString(R.string.x, …)`·
 * `resources.getString(…, …)`·`stringResource(R.string.x, …)`·`pluralStringResource(`)을 앱 소스에서 스캔한다 —
 * ICU 복수 블록 원문이 낭독되는 경로를 전부 닫는다. `AppLocale.kt` 자신만 예외(거기서 `getString(id)`는 인자가 없다).
 */
class LocalizedCallSiteGuardTest {
    private val bad = Regex(
        """getString\(\s*R\.string\.[A-Za-z0-9_]+\s*,|resources\.getString\([^)\n]*,|stringResource\(\s*R\.string\.[A-Za-z0-9_]+\s*,|pluralStringResource\(""",
    )

    @Test fun `앱 소스에 인자 있는 직접 조회가 없다`() {
        val root = repoRoot().resolve("android/app/src/main")
        val sources = root.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
        assertTrue(sources.isNotEmpty())
        val offenders = sources.flatMap { f ->
            f.readLines().withIndex().filter { bad.containsMatchIn(it.value) }.map { "${f.relativeTo(root).path}:${it.index + 1}" }
        }
        assertEquals(emptyList(), offenders)
    }

    @Test fun `가드 자체가 살아 있다`() {
        assertTrue(bad.containsMatchIn("""getString(R.string.search_placeCount, count)"""))
        assertTrue(bad.containsMatchIn("""stringResource(R.string.search_placeCount, count)"""))
        assertTrue(bad.containsMatchIn("""pluralStringResource(R.plurals.x, 1)"""))
        assertTrue(!bad.containsMatchIn("""stringResource(R.string.search_label)"""))
        assertTrue(!bad.containsMatchIn("""appString(R.string.search_placeCount, count)"""))
    }
}
