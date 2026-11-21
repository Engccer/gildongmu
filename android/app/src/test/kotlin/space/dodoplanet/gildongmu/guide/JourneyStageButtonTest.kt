package space.dodoplanet.gildongmu.guide

import space.dodoplanet.gildongmu.guide.ui.JourneyStageButton
import space.dodoplanet.gildongmu.guide.ui.journeyStageButton
import space.dodoplanet.gildongmu.guide.ui.transitOverviewOffersAlternatives
import space.dodoplanet.gildongmu.kit.Fixtures
import space.dodoplanet.gildongmu.kit.JourneyEvent
import space.dodoplanet.gildongmu.kit.JourneyPhase
import space.dodoplanet.gildongmu.kit.JourneyStage
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** 도보·자동차 시트의 여정 단계 버튼과 여정 중 숨김(B26 단계 3 묶음 B) — 판정은 순수 함수, 배선은 소스 가드. */
class JourneyStageButtonTest {
    private val pkg = Fixtures.repoRoot.resolve("android/app/src/main/kotlin/space/dodoplanet/gildongmu")

    @Test fun `택시 단계에서만 선다 - 내렸어요는 taxiIn, 탔어요는 egress`() {
        assertEquals(JourneyStageButton.taxiDropped, journeyStageButton(JourneyPhase.Running(JourneyStage.taxiIn)))
        assertEquals(JourneyStageButton.taxiBoarded, journeyStageButton(JourneyPhase.Running(JourneyStage.egress)))
        for (stage in listOf(JourneyStage.access, JourneyStage.transit, JourneyStage.taxiOut)) {
            assertNull(journeyStageButton(JourneyPhase.Running(stage)), stage.name)
        }
    }

    @Test fun `준비 중과 실패와 여정 없음에는 없다(실패의 단계 버튼은 여정 시트 몫)`() {
        for (stage in JourneyStage.entries) {
            assertNull(journeyStageButton(JourneyPhase.Transitioning(stage)), "Transitioning ${stage.name}")
            assertNull(journeyStageButton(JourneyPhase.Failed(stage)), "Failed ${stage.name}")
        }
        assertNull(journeyStageButton(null))
    }

    @Test fun `버튼은 단계 사건에 묶이고 키가 안내 문자열 표에 있다`() {
        assertEquals(JourneyEvent.TaxiDropped, JourneyStageButton.taxiDropped.event)
        assertEquals(JourneyEvent.TaxiBoarded, JourneyStageButton.taxiBoarded.event)
        assertEquals(listOf("android.journey.taxiDropped", "android.journey.taxiBoarded"), JourneyStageButton.entries.map { it.key })
        assertEquals(2, JourneyStageButton.entries.map { it.tag }.toSet().size)
    }

    @Test fun `대중교통 다른 경로 보기 - 제안되고 여정 밖일 때만`() {
        assertTrue(transitOverviewOffersAlternatives(alternativesOffered = true, inJourney = false))
        assertFalse(transitOverviewOffersAlternatives(alternativesOffered = true, inJourney = true))
        assertFalse(transitOverviewOffersAlternatives(alternativesOffered = false, inJourney = false))
        assertFalse(transitOverviewOffersAlternatives(alternativesOffered = false, inJourney = true))
    }

    @Test fun `시트 배선 - 도보 시트는 종료 버튼 바로 위에 단계 버튼을 두고 여정 상태를 수집한다`() {
        val sheet = pkg.resolve("guide/ui/GuideSheet.kt").readText()
        assertTrue(sheet.contains("val journeyUi by GuideSession.journeyUi.collectAsState()"), sheet)
        val tail = sheet.substringAfter("journeyStageButton(journeyUi?.phase)?.let { stageButton ->")
        assertTrue(tail.indexOf("GuideSession.journeyAction(stageButton.event)") in 0 until tail.indexOf("GuideSession.walk.stopByUser()"), "단계 버튼이 종료 버튼 앞에 서야 한다")
        assertTrue(tail.substringBefore("GuideSession.walk.stopByUser()").contains(".tapTarget()"))
    }

    @Test fun `여정 중 숨김 배선 - 대중교통 시트 메뉴와 장소 상세 버튼이 여정 여부를 넘긴다`() {
        val transit = pkg.resolve("guide/ui/TransitGuideSheet.kt").readText()
        assertTrue(transit.contains("guideTitleMenuItems(destinationPhone, inJourney = model.onJourneyStopped != null)"), transit)
        val here = pkg.resolve("guide/ui/GuideHereButtons.kt").readText()
        assertTrue(here.contains("inJourney = GuideSession.journeyUi.value != null"), here)
        val walk = pkg.resolve("guide/WalkGuideModel.kt").readText()
        assertTrue(walk.contains("fun waypointAvailable(): Boolean = isTracking && dataLocale() == DataLocale.ko && !inJourney()"), walk)
    }
}
