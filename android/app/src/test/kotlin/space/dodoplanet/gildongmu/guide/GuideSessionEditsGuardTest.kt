package space.dodoplanet.gildongmu.guide

import space.dodoplanet.gildongmu.guide.ui.GuideTitleMenuItem
import space.dodoplanet.gildongmu.guide.ui.guideTitleMenuItems
import space.dodoplanet.gildongmu.kit.Fixtures
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * 안내 중 변경(M4b spec 2026-09-27)의 화면 배선 가드 — Compose는 JVM 레인이 없어 컴파일러가 못 잡는 계약만 소스로 잠근다(CLAUDE.md "1선은 구조,
 * 2선은 소스 가드").
 */
class GuideSessionEditsGuardTest {
    private val pkg = Fixtures.repoRoot.resolve("android/app/src/main/kotlin/space/dodoplanet/gildongmu")
    private val sheet = pkg.resolve("guide/ui/GuideSheet.kt").readText()

    @Test fun `제목 메뉴 순서 — 장소 상세 → 목적지 바꾸기(iOS GuideTitleMenu)`() {
        assertEquals(listOf(GuideTitleMenuItem.detail, GuideTitleMenuItem.change), guideTitleMenuItems())
        assertEquals(listOf("android.guide.destMenuDetail", "android.guide.destMenuChange"), guideTitleMenuItems().map { it.key })
    }

    @Test fun `검색 페이지 — 억제는 onDispose에서 풀고, 앱 통지를 집지 않는다`() {
        val page = sheet.substringAfter("private fun SearchPage(").substringBefore("\nprivate fun commitGuideEndpoint(")
        assertTrue(page.contains("GuideSession.setOutputSuppressed(true, owner)"), page)
        val dispose = page.substringAfter("onDispose {").substringBefore("}")
        assertTrue(dispose.contains("GuideSession.setOutputSuppressed(false, owner)"), "도착으로 페이지가 사라져도 억제가 풀린다: $dispose")
        assertTrue(page.contains("CompositionLocalProvider(LocalModalOpen provides true)"), "검색 상태 줄은 앱 통지 소유자가 아니다")
        assertTrue(page.contains("imePadding()"))
    }

    @Test fun `검색 확정은 세션에 반영됐을 때만 폼에 보낸다`() {
        val commit = sheet.substringAfter("private fun commitGuideEndpoint(").substringBefore("\n}\n")
        assertTrue(commit.contains("if (GuideSession.walk.changeDestination(dest, place.label)) GuideFormSync.post(place)"), commit)
        assertTrue(commit.contains("if (GuideSession.walk.setWaypoint(dest, place.label)) GuideFormSync.postWaypoint(place)"), commit)
    }

    @Test fun `대안 프리뷰 페이지는 어떤 경로로 사라지든 조회를 폐기한다`() {
        val page = sheet.substringAfter("private fun AltPreviewPage(").substringBefore("\n}\n")
        assertTrue(Regex("""DisposableEffect\(Unit\) \{\s*GuideSession\.walk\.openAlternativePreview\(\)\s*onDispose \{ GuideSession\.walk\.closeAlternativePreview\(\) \}""").containsMatchIn(page), page)
    }

    @Test fun `장소 상세 중첩 — 푸시한 엔트리 id로 복귀를 판정하고 타입 조회를 쓰지 않는다`() {
        val nav = pkg.resolve("guide/ui/GuidePlaceNav.kt").readText()
        val code = nav.lines().filterNot { it.trimStart().startsWith("*") || it.trimStart().startsWith("/**") }.joinToString("\n")
        assertTrue(code.contains("controller.currentBackStack.value.any { it.id == pushedId }"), code)
        assertTrue(!code.contains("getBackStackEntry<PlaceDetailRoute>"), "다른 탭의 상세를 잡아 오판한다")
        assertTrue(code.contains("GuideSession.reopenAfterNestedScreen()"))
        // 목적지 상세는 길찾기 진입을 숨긴다(이미 그곳으로 안내 중), 주변 확인 행의 상세는 iOS처럼 보인다.
        assertTrue(sheet.contains("nav.onOpenPlace(guideDestinationPlace(it, ui.destinationLabel), false, GUIDE_TITLE_RETURN)"))
        assertEquals(2, Regex("""nav\.onOpenPlace\(place, true, key\)""").findAll(sheet).count())
    }

    @Test fun `길찾기 폼 동기화 진입점은 하나이고 무통지 조회다`() {
        val vm = pkg.resolve("directions/DirectionsViewModel.kt").readText()
        assertEquals(1, Regex("""fun applyGuideFormSync\(""").findAll(vm).count())
        val body = vm.substringAfter("fun applyGuideFormSync() {").substringBefore("\n    }\n")
        assertTrue(body.contains("runQuery(silently = true)"), body)
        assertTrue(vm.contains("guideFormPending.collect { if (it != null) applyGuideFormSync() }"))
    }
}
