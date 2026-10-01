package space.dodoplanet.gildongmu.guide

import space.dodoplanet.gildongmu.guide.ui.GuideHereAction
import space.dodoplanet.gildongmu.guide.ui.guideHereActions
import space.dodoplanet.gildongmu.kit.Fixtures
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** 장소 상세의 안내 중 버튼(M4b 후속 ①, iOS `PlaceDetailView` N1 §2.5) — 노출 조건은 순수 함수, 배선은 소스 가드. */
class GuideHereButtonsTest {
    private val pkg = Fixtures.repoRoot.resolve("android/app/src/main/kotlin/space/dodoplanet/gildongmu")

    @Test fun `추적 중에만 — 목적지 변경 다음에 경유지, 경유지는 ko 상세 조회 로케일만`() {
        assertEquals(emptyList(), guideHereActions(tracking = false, waypointAvailable = true, hasWaypoint = false))
        assertEquals(listOf(GuideHereAction.changeDest, GuideHereAction.addWaypoint), guideHereActions(tracking = true, waypointAvailable = true, hasWaypoint = false))
        assertEquals(listOf(GuideHereAction.changeDest, GuideHereAction.changeWaypoint), guideHereActions(tracking = true, waypointAvailable = true, hasWaypoint = true))
        assertEquals(listOf(GuideHereAction.changeDest), guideHereActions(tracking = true, waypointAvailable = false, hasWaypoint = true))
    }

    @Test fun `입구는 안내 시트와 같은 모델 함수이고 반영됐을 때만 폼에 보낸다`() {
        val src = pkg.resolve("guide/ui/GuideHereButtons.kt").readText()
        assertTrue(src.contains("if (GuideSession.walk.changeDestination(dest, place.name)) GuideFormSync.post(endpoint)"), src)
        assertTrue(src.contains("if (GuideSession.walk.setWaypoint(dest, place.name)) GuideFormSync.postWaypoint(endpoint)"), src)
        // 시트를 자동으로 올리지 않는다(iOS 설계 리뷰 M3).
        assertTrue(!src.contains("isMinimized"), "버튼이 시트를 다시 연다")
    }

    @Test fun `장소 상세는 길찾기 진입을 보이는 상세에서만 버튼을 둔다`() {
        val screen = pkg.resolve("place/PlaceDetailScreen.kt").readText()
        assertTrue(screen.contains("if (showsDirectionsEntry) GuideHereButtons(place)"), "안내 목적지 자신·경유역 상세엔 없어야 한다")
        assertTrue(!screen.contains("[M4]"), "자리 표시 주석이 남았다")
    }
}
