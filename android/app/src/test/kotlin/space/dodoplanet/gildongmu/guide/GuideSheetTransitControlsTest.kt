package space.dodoplanet.gildongmu.guide

import space.dodoplanet.gildongmu.directions.CatalogStrings
import space.dodoplanet.gildongmu.guide.ui.SheetRow
import space.dodoplanet.gildongmu.guide.ui.sheetRowExists
import space.dodoplanet.gildongmu.guide.ui.statusLine
import space.dodoplanet.gildongmu.kit.BeaconDest
import space.dodoplanet.gildongmu.kit.Fixtures
import space.dodoplanet.gildongmu.kit.TransitLabel
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** 도보 시트의 출구 대기·승차 전 도보 컨트롤(E43 M5 단계 6, iOS `BeaconTrackingSheet` E84·A25 §4.3). 렌더 조건은 순수 함수, 배선은 소스 가드. */
class GuideSheetTransitControlsTest {
    private val ko = CatalogStrings("ko")
    private val src = Fixtures.repoRoot.resolve("android/app/src/main/kotlin/space/dodoplanet/gildongmu/guide/ui/GuideSheet.kt").readText()
    private val brief = WalkGuideUiState(status = GuideStatus.tracking, mode = GuideMode.brief)

    @Test fun `출구 대기 중엔 모델 상태 문장이 비어도 상태 행이 서고 문장은 출구 줄이다`() {
        val hold = brief.copy(exitHoldExit = "3")
        assertFalse(sheetRowExists(brief, SheetRow.status))
        assertTrue(sheetRowExists(hold, SheetRow.status))
        assertEquals("3번 출구로 나가기", statusLine(hold, ko))
        // 모델 문장이 있어도 출구 줄이 그 자리를 쓴다.
        assertEquals("3번 출구로 나가기", statusLine(hold.copy(statusText = "목적지까지 약 300m"), ko))
        assertEquals("목적지까지 약 300m", statusLine(brief.copy(statusText = "목적지까지 약 300m"), ko))
    }

    @Test fun `출구로 나왔어요 버튼은 출구 대기 중에만, 종료 화면엔 없다`() {
        assertFalse(sheetRowExists(brief, SheetRow.exitRelease))
        assertTrue(sheetRowExists(brief.copy(exitHoldExit = "3"), SheetRow.exitRelease))
        assertFalse(sheetRowExists(brief.copy(exitHoldExit = "3", arrivalDest = BeaconDest(37.0, 127.0)), SheetRow.exitRelease))
        assertEquals(SheetRow.exitRelease, SheetRow.forTag("guide-exit-release"))
        assertFalse(SheetRow.exitRelease in SheetRow.infoRows)
    }

    @Test fun `시트 배선 — 두 버튼은 모델 함수를 부르고 착지는 조회를 기다리지 않는다`() {
        assertTrue(src.contains("GuideSession.walk.declareExitedStation(); landing.request(\"exitDeclared\", expectsSystemPlacement = false)"))
        assertTrue(src.contains("GuideSession.walk.declarePrewalkArrival()"))
        assertTrue(src.contains("ui.prewalkTarget?.let { station ->"))
        assertTrue(src.contains("it.awaitingRoute && it.exitHoldExit == null"))
        assertTrue(src.contains("ui.mode == GuideMode.brief && ui.exitHoldExit == null"), "출구 대기 중 직선거리 주석 숨김")
        // 하단 고정 버튼은 안내 종료 버튼 앞에 선다.
        assertTrue(src.indexOf("guide-prewalk-arrived") < src.indexOf("guide-stop"))
        assertFalse(src.contains("enabled = false"))
    }

    @Test fun `승차 전 도보 라벨은 렌더러가 역명을 넣는다`() {
        val r = TransitGuideTextRenderer(ko) { false }
        val line = space.dodoplanet.gildongmu.kit.transitPrewalkArrivedButtonLine(isEn = false, station = TransitLabel("강남역"))
        assertTrue(r.render(line).contains("강남역"), r.render(line))
    }
}
