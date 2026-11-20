package space.dodoplanet.gildongmu.guide

import space.dodoplanet.gildongmu.guide.ui.InfoBand
import space.dodoplanet.gildongmu.guide.ui.infoBandWeight
import space.dodoplanet.gildongmu.kit.Fixtures
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** 정보 띠(E81, iOS `BeaconTrackingSheet.bandWeight`·웹 가드 `guide-sheet-bands-guard.test.ts` 대응). */
class GuideInfoBandTest {
    @Test fun `몫은 남은 거리 1 지금 할 행동 2 다음 예고 1이고 없는 띠의 몫은 지금 할 행동이 받는다`() {
        val all = setOf(InfoBand.remaining, InfoBand.action, InfoBand.next)
        assertEquals(listOf(1, 2, 1), listOf(InfoBand.remaining, InfoBand.action, InfoBand.next).map { infoBandWeight(it, all) })
        assertEquals(3, infoBandWeight(InfoBand.action, setOf(InfoBand.remaining, InfoBand.action)))
        assertEquals(3, infoBandWeight(InfoBand.action, setOf(InfoBand.action, InfoBand.next)))
        assertEquals(4, infoBandWeight(InfoBand.action, setOf(InfoBand.action))) // 간략 안내의 상태 문장
    }

    private val sheet = Fixtures.repoRoot.resolve("android/app/src/main/kotlin/space/dodoplanet/gildongmu/guide/ui/GuideSheet.kt").readText()
    private val tracking = sheet.substringAfter("private fun TrackingContent(").substringBefore("\n}\n")

    @Test fun `띠 셋은 띠 배치 안에 있고 다음 예고도 띠이며 종료 버튼은 두 배 높이다`() {
        assertTrue(tracking.contains("InfoBandColumn(viewportHeight = constraints.maxHeight"), "띠 배치")
        assertTrue(tracking.contains("BandText(it, \"guide-live-next\", InfoBand.next"), "다음 예고 띠(착지 대상 아님)")
        assertTrue(tracking.contains("defaultMinSize(minHeight = GuideStopTallHeight).testTag(\"guide-stop\")"), "종료 두 배")
        // 띠는 줄을 더하지 않는다 — 병합 노드 하나(Box)에 글자 하나.
        assertTrue(sheet.contains("Box(Modifier.layoutId(band).fillMaxWidth().mergedRow(tag, focus = focus)"))
    }

    /** 띠에 넘기는 최소 높이는 몫이 작아도 줄 하한 48dp를 지킨다(`da12b53d`) — 최소 제약이 0보다 크면 `mergedRow`의 하한이 꺼진다. */
    @Test fun `띠의 최소 높이는 남은 높이의 몫이되 48dp 아래로 내려가지 않는다`() {
        val column = sheet.substringAfter("private fun InfoBandColumn(").substringBefore("\n}\n")
        assertTrue(column.contains("val total = (viewport - fixed.sumOf { it?.height ?: 0 }).coerceAtLeast(0)"), "남은 높이 = 보이는 높이 - 고정 줄")
        assertTrue(column.contains("m.measure(loose.copy(minHeight = maxOf(total * infoBandWeight(bands[i]!!, present) / 4, 48.dp.roundToPx())))"), "몫과 48dp 하한")
    }
}
