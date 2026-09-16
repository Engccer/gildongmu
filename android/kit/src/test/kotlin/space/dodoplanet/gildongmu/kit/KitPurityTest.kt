package space.dodoplanet.gildongmu.kit

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * D5 경계 소스 가드: :kit은 안드로이드 의존이 0이어야 한다. `import android.`·`import androidx.`가
 * 한 줄이라도 들어오면 여기서 빨개진다. 빌드 파일에 안드로이드 플러그인·의존성이 붙는 것도 막는다.
 */
class KitPurityTest {
    private val kitDir = Fixtures.repoRoot.resolve("android/kit")

    @Test
    fun `kit 소스에 android 또는 androidx import가 없다`() {
        val sources = kitDir.resolve("src/main").walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
        assertTrue(sources.isNotEmpty(), "kit 소스가 비었다: $kitDir")
        val offenders = sources.filter { file ->
            file.readLines().any { line ->
                val t = line.trim()
                t.startsWith("import android.") || t.startsWith("import androidx.")
            }
        }
        assertEquals(emptyList(), offenders.map { it.relativeTo(kitDir).path })
    }

    @Test
    fun `kit 빌드 파일에 안드로이드 플러그인과 의존성이 없다`() {
        val build = kitDir.resolve("build.gradle.kts").readText()
        assertTrue(!build.contains("com.android."), "com.android.* 플러그인 금지")
        assertTrue(!build.contains("androidx"), "androidx 의존성 금지")
        assertTrue(!build.contains("libs.plugins.android"), "android 플러그인 alias 금지")
    }

    @Test
    fun `가드 자체가 살아 있다`() {
        // 검사 술어가 실제 위반 꼴에 매칭되는지(빈 스캔·엉뚱한 디렉터리로 조용히 통과하지 않게).
        val bad = "package x\nimport android.os.Bundle\n"
        assertTrue(bad.lines().any { it.trim().startsWith("import android.") })
    }
}
