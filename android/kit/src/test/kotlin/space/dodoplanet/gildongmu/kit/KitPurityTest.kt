package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * D5 경계 소스 가드: :kit은 안드로이드 의존이 0이어야 한다. 소스의 `import android.`·`androidx.`,
 * 빌드 파일의 안드로이드 플러그인·의존성(버전 카탈로그 alias를 module로 풀어 본다), 루트 빌드의
 * 주입 경로(`subprojects`·`allprojects`)를 잠근다. 소스 술어는 우회 가능하지만(완전 수식 이름) 클래스패스에
 * 안드로이드가 없어 그런 코드는 컴파일이 먼저 죽는다 — 실질 보장은 빌드 파일 술어다.
 */
class KitPurityTest {
    private val androidDir = Fixtures.repoRoot.resolve("android")
    private val kitDir = androidDir.resolve("kit")
    private val spaces = Regex("\\s+")

    @Test
    fun `kit 소스에 android 또는 androidx import가 없다`() {
        val sources = kitDir.resolve("src/main").walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
        assertTrue(sources.isNotEmpty(), "kit 소스가 비었다: $kitDir")
        val offenders = sources.filter { file ->
            file.readLines().any { line ->
                val t = line.trim().replace(spaces, " ")
                t.startsWith("import android.") || t.startsWith("import androidx.")
            }
        }
        assertEquals(emptyList(), offenders.map { it.relativeTo(kitDir).path })
    }

    /** `libs.<alias>` 참조를 `gradle/libs.versions.toml`로 풀어 module·plugin id에 안드로이드 접두가 없음을 본다. */
    @Test
    fun `kit 빌드 파일의 의존성과 플러그인에 안드로이드가 없다`() {
        val build = kitDir.resolve("build.gradle.kts").readText()
        val toml = androidDir.resolve("gradle/libs.versions.toml").readText()
        val modules = Regex("^([a-z0-9-]+)\\s*=\\s*\\{\\s*module\\s*=\\s*\"([^\"]+)\"", RegexOption.MULTILINE)
            .findAll(toml).associate { it.groupValues[1].replace('-', '.') to it.groupValues[2] }
        val plugins = Regex("^([a-z0-9-]+)\\s*=\\s*\\{\\s*id\\s*=\\s*\"([^\"]+)\"", RegexOption.MULTILINE)
            .findAll(toml).associate { "plugins." + it.groupValues[1].replace('-', '.') to it.groupValues[2] }
        val refs = Regex("libs\\.([a-zA-Z0-9.]+)").findAll(build).map { it.groupValues[1] }.toSet()
        assertTrue(refs.isNotEmpty(), "libs.* 참조를 못 찾았다 — 술어가 죽었다")
        val forbidden = listOf("androidx.", "com.android", "com.google.android")
        val bad = refs.mapNotNull { ref ->
            val resolved = plugins[ref] ?: modules[ref] ?: return@mapNotNull "$ref → 카탈로그에 없음"
            if (forbidden.any { resolved.startsWith(it) }) "$ref → $resolved" else null
        }
        assertEquals(emptyList(), bad)
        // 문자열 직접 선언 경로도 막는다.
        assertTrue(forbidden.none { build.contains("\"$it") }, "안드로이드 좌표 직접 선언 금지")
    }

    @Test
    fun `루트 빌드 파일은 서브프로젝트에 무엇도 주입하지 않는다`() {
        val root = androidDir.resolve("build.gradle.kts").readText()
        assertTrue(!root.contains("subprojects") && !root.contains("allprojects"), "루트 주입 경로 금지")
    }

    @Test
    fun `가드 자체가 살아 있다`() {
        val bad = "package x\nimport  android.os.Bundle\n"
        assertTrue(bad.lines().any { it.trim().replace(spaces, " ").startsWith("import android.") })
    }
}
