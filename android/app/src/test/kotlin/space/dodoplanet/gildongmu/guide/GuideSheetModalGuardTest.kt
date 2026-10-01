package space.dodoplanet.gildongmu.guide

import space.dodoplanet.gildongmu.kit.Fixtures
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * 안내 시트가 펼쳐진 동안 밑 탭 화면의 상태 줄은 앱 통지를 집지 않는다(M4b 후속 ②, 설계 리뷰 #1). 시트는 자기 윈도라 밑 탭 화면도 RESUMED로 남고,
 * 그 `StatusLine`이 통지를 집으면 시트 뒤에서 읽힌다. 차단은 `LocalModalOpen` 한 축이고, 탭 화면 안의 공급이 자기 값으로 **덮으면** 차단이 풀리므로
 * (길찾기 공지 시트·설정 다이얼로그) 공급은 전부 상수 참이거나 바깥 값과 OR해야 한다. `StatusLine`이 그 값을 보고 claim을 미루는 동작은
 * 기기 레인 `StatusLineA11yTest`가 잠근다.
 */
class GuideSheetModalGuardTest {
    private val pkg = Fixtures.repoRoot.resolve("android/app/src/main/kotlin/space/dodoplanet/gildongmu")

    @Test fun `AppRoot가 탭 화면 전체를 시트 표시 신호로 감싼다`() {
        val root = pkg.resolve("nav/AppRoot.kt").readText()
        assertTrue(Regex("""CompositionLocalProvider\(LocalModalOpen provides guideSheetShowing\(\)\) \{\s*NavHost\(""").containsMatchIn(root), "NavHost 바로 바깥이어야 한다")
        val signal = pkg.resolve("guide/ui/GuideBottomBar.kt").readText().substringAfter("fun guideSheetShowing(): Boolean {").substringBefore("\n}\n")
        assertTrue(signal.contains("ui.hasScreen && !GuideSession.isMinimized"), signal)
        // 시트 표시 판정이 GuideBottomBar의 시트 렌더 조건과 같은 식이다.
        assertTrue(pkg.resolve("guide/ui/GuideBottomBar.kt").readText().contains("val showsSheet = hasScreen && !minimized"))
    }

    @Test fun `탭 화면 안의 LocalModalOpen 공급은 상수 참이거나 바깥 값과 OR한다`() {
        val offenders = mutableListOf<String>()
        var seen = 0
        pkg.walkTopDown().filter { it.isFile && it.extension == "kt" }.forEach { file ->
            Regex("""LocalModalOpen provides (.+?)\) \{""").findAll(file.readText()).forEach { m ->
                seen++
                val value = m.groupValues[1].trim()
                val ok = value == "true" || value == "guideSheetShowing()" || value.contains("|| LocalModalOpen.current")
                if (!ok) offenders += "${file.name}: $value"
            }
        }
        assertTrue(seen >= 4, "공급 자리를 못 찾았다(정규식 낡음): $seen")
        assertEquals(emptyList(), offenders)
    }
}
