package space.dodoplanet.gildongmu.guide

import space.dodoplanet.gildongmu.guide.ui.JourneySheetButton
import space.dodoplanet.gildongmu.guide.ui.journeySheetButtons
import space.dodoplanet.gildongmu.guide.ui.journeySheetLandsOnStatus
import space.dodoplanet.gildongmu.kit.Fixtures
import space.dodoplanet.gildongmu.kit.JourneyPhase
import space.dodoplanet.gildongmu.kit.JourneyStage
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** 여정 시트(B26 단계 3 묶음 A) — 시트 선택 갈래, 버튼 순서, 착지 판정, 문자열 표. Compose UI 레인이 없어 순수 함수로 잠근다. */
class JourneySheetTest {
    private val walk = WalkGuideUiState(status = GuideStatus.tracking, destinationLabel = "길동역")
    private val transit = TransitGuideUiState(pendingWalkHandoff = TransitWalkHandoff("여의도", 5, null, null, null))
    private fun journey(phase: JourneyPhase, failure: JourneyFailure? = null) = JourneyUiState(phase, failure)

    @Test fun `시트 선택 - 도보가 대중교통과 여정보다 먼저`() {
        val j = journey(JourneyPhase.Failed(JourneyStage.taxiIn))
        assertEquals(GuideScreenKind.beacon, guideScreenKind(walk, transit, j))
        assertEquals(GuideScreenKind.transit, guideScreenKind(WalkGuideUiState(), transit, j), "대중교통이 여정보다 먼저")
    }

    @Test fun `시트 선택 - 여정은 준비 중과 실패에서만 서고 Running이면 null`() {
        val idle = WalkGuideUiState()
        val empty = TransitGuideUiState()
        assertEquals(GuideScreenKind.journey, guideScreenKind(idle, empty, journey(JourneyPhase.Transitioning(JourneyStage.access))))
        assertEquals(GuideScreenKind.journey, guideScreenKind(null, null, journey(JourneyPhase.Failed(JourneyStage.egress))))
        assertNull(guideScreenKind(idle, empty, journey(JourneyPhase.Running(JourneyStage.transit))), "정지 직후 한 턴 끼어 깜빡이지 않는다")
        assertNull(guideScreenKind(idle, empty, null), "여정 없음")
        assertNull(guideScreenKind(null, null, null))
    }

    private val settings = JourneyFailure("android.common.geoDeniedDesc", FailResolution.settings)
    private val precise = JourneyFailure("android.common.geoReducedDesc", FailResolution.precise)
    private val none = JourneyFailure("route.transit.error", FailResolution.none)

    private fun buttons(stage: JourneyStage, failure: JourneyFailure?) = journeySheetButtons(JourneyPhase.Failed(stage), failure)

    @Test fun `버튼 순서 - 해결 수단 다시 조회 단계 버튼`() {
        val retry = JourneySheetButton.retry
        assertEquals(listOf(retry, JourneySheetButton.taxiDropped), buttons(JourneyStage.taxiIn, null))
        assertEquals(listOf(JourneySheetButton.settings, retry, JourneySheetButton.taxiDropped), buttons(JourneyStage.taxiIn, settings))
        assertEquals(listOf(JourneySheetButton.precise, retry, JourneySheetButton.taxiDropped), buttons(JourneyStage.taxiIn, precise))
        assertEquals(listOf(retry, JourneySheetButton.taxiDropped), buttons(JourneyStage.taxiIn, none))
        for (stage in listOf(JourneyStage.access, JourneyStage.transit, JourneyStage.taxiOut)) {
            assertEquals(listOf(retry), buttons(stage, null), stage.name)
            assertEquals(listOf(JourneySheetButton.settings, retry), buttons(stage, settings), stage.name)
            assertEquals(listOf(JourneySheetButton.precise, retry), buttons(stage, precise), stage.name)
            assertEquals(listOf(retry), buttons(stage, none), stage.name)
        }
    }

    @Test fun `출구 도보 시작 실패는 재시도 없이 자동차에 탔어요만, 끊긴 경우는 재시도도 둔다`() {
        assertEquals(listOf(JourneySheetButton.taxiBoarded), buttons(JourneyStage.egress, null))
        assertEquals(listOf(JourneySheetButton.retry, JourneySheetButton.taxiBoarded), buttons(JourneyStage.egress, none))
        assertEquals(listOf(JourneySheetButton.settings, JourneySheetButton.retry, JourneySheetButton.taxiBoarded), buttons(JourneyStage.egress, settings))
        assertEquals(listOf(JourneySheetButton.precise, JourneySheetButton.retry, JourneySheetButton.taxiBoarded), buttons(JourneyStage.egress, precise))
    }

    @Test fun `실패가 아니면 버튼이 없다`() {
        assertEquals(emptyList(), journeySheetButtons(JourneyPhase.Transitioning(JourneyStage.transit), null))
        assertEquals(emptyList(), journeySheetButtons(JourneyPhase.Running(JourneyStage.taxiIn), precise))
    }

    @Test fun `착지는 실패일 때만 상태 문장에`() {
        assertTrue(journeySheetLandsOnStatus(JourneyPhase.Failed(JourneyStage.access)))
        assertEquals(false, journeySheetLandsOnStatus(JourneyPhase.Transitioning(JourneyStage.access)))
        assertEquals(false, journeySheetLandsOnStatus(JourneyPhase.Running(JourneyStage.access)))
    }

    @Test fun `여정 시트가 쓰는 키 전부가 매핑돼 있고 카탈로그에 실재한다`() {
        val keys = JourneySheetButton.entries.map { it.key } + listOf(
            "guide.minimize", "beacon.stop", "directions.loading", "route.transit.error",
            "android.journey.egressStartFailed", "android.journey.taxiOutFailed", "guide.band.return",
        )
        assertEquals(emptyList(), keys.filter { guideStringId(it) == null })
        val xml = Fixtures.repoRoot.resolve("android/app/src/main/res/values/strings.xml").readText()
        assertEquals(emptyList(), keys.filter { !xml.contains("name=\"${it.replace('.', '_')}\"") })
    }
}
