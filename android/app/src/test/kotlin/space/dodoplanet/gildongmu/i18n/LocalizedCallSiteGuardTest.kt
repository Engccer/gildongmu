package space.dodoplanet.gildongmu.i18n

import space.dodoplanet.gildongmu.kit.Fixtures
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * 인자 있는 문자열 조회는 `appLocalized`만 지난다(spec §6). 인자가 붙은 조회 꼴 전부(`getString(x, …)`·
 * `getQuantityString(`·`stringResource(x, …)`·`pluralStringResource(`)을 앱 소스에서 스캔한다 — ICU 복수 블록
 * 원문이 낭독되는 경로를 전부 닫는다. 인자 없는 `getString(id)`는 잡히지 않는다. 예외 파일은
 * `SharedPreferencesStore.kt` 하나(`prefs.getString(key, null)`은 리소스 조회가 아니다).
 */
class LocalizedCallSiteGuardTest {
    private val bad = Regex("""\bgetString\([^)\n]*,|getQuantityString\(|stringResource\([^)\n]*,|pluralStringResource\(""")
    private val allowlist = setOf("storage/SharedPreferencesStore.kt")

    @Test fun `앱 소스에 인자 있는 직접 조회가 없다`() {
        val root = Fixtures.repoRoot.resolve("android/app/src/main/kotlin/space/dodoplanet/gildongmu")
        val sources = root.walkTopDown().filter { it.isFile && it.extension == "kt" && it.relativeTo(root).path !in allowlist }.toList()
        assertTrue(sources.isNotEmpty())
        val offenders = sources.flatMap { f ->
            f.readLines().withIndex().filter { bad.containsMatchIn(it.value) }.map { "${f.relativeTo(root).path}:${it.index + 1}" }
        }
        assertEquals(emptyList(), offenders)
    }

    @Test fun `가드 자체가 살아 있다`() {
        assertTrue(bad.containsMatchIn("""getString(R.string.search_placeCount, count)"""))
        assertTrue(bad.containsMatchIn("""context.getString(id, count)"""))
        assertTrue(bad.containsMatchIn("""resources.getQuantityString(R.plurals.x, 1)"""))
        assertTrue(bad.containsMatchIn("""stringResource(R.string.search_placeCount, count)"""))
        assertTrue(bad.containsMatchIn("""pluralStringResource(R.plurals.x, 1)"""))
        assertTrue(!bad.containsMatchIn("""stringResource(R.string.search_label)"""))
        assertTrue(!bad.containsMatchIn("""res.getString(id)"""))
    }
}
