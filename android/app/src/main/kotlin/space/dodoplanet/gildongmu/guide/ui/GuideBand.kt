package space.dodoplanet.gildongmu.guide.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import space.dodoplanet.gildongmu.a11y.landingTarget
import space.dodoplanet.gildongmu.directions.Strings
import space.dodoplanet.gildongmu.guide.GuideSession
import space.dodoplanet.gildongmu.guide.JourneyUiState
import space.dodoplanet.gildongmu.guide.journeyStatusText
import space.dodoplanet.gildongmu.guide.TransitGuideUiState
import space.dodoplanet.gildongmu.guide.WalkGuideUiState
import space.dodoplanet.gildongmu.guide.bandSummaryText
import space.dodoplanet.gildongmu.guide.transitBandSummaryText
import space.dodoplanet.gildongmu.kit.joinText

/**
 * 띠바(spec §7-2, iOS `GuideBand` 미러): 시트를 내린 세션을 대표하는 버튼 하나 = 객체 하나. 시각 두 줄(요약·"안내 시트 펼치기"),
 * 낭독은 한 문장. 활성화 → 시트 복귀(첫 착지 = 첫 정보 행, 새로 열릴 때와 같다 — E57 위원장 판정 Q1). 착지 부착은 `landingTarget`을 `clickable` 앞에.
 */
@Composable
fun GuideBand(ui: WalkGuideUiState, strings: Strings, focus: FocusRequester) {
    GuideBandRow(bandSummaryText(ui, strings), strings, focus)
}

/** 대중교통 띠바(M5 §6-7, iOS `GuideBandView` 대중교통 갈래) — 요약은 알림 본문과 같은 문장(`transitBandSummaryText`), 모양·착지·복귀는 도보 띠바 그대로. */
@Composable
fun TransitGuideBand(ui: TransitGuideUiState, strings: Strings, focus: FocusRequester) {
    GuideBandRow(transitBandSummaryText(ui, strings), strings, focus)
}

/** 여정 띠바(B26 §7-5, iOS `GuideBandView` 여정 갈래) — 요약은 시트 상태 문장·알림 본문과 같은 문장(`journeyStatusText`), 모양·착지·복귀는 도보 띠바 그대로. */
@Composable
fun JourneyGuideBand(ui: JourneyUiState?, strings: Strings, focus: FocusRequester) {
    GuideBandRow(journeyStatusText(ui, strings), strings, focus)
}

/** 띠바 한 줄(세 수단 공용) — 낭독은 요약 + 「안내 시트 펼치기」 한 문장. */
@Composable
private fun GuideBandRow(summary: String, strings: Strings, focus: FocusRequester) {
    val returnLabel = strings.get("guide.band.return")
    val spoken = joinText(summary, returnLabel)
    Row(
        Modifier
            .fillMaxWidth()
            .landingTarget(focus)
            .clickable(role = Role.Button) {
                // 띠바 복귀는 새로 열림과 같은 착지다 — 장소 상세를 연 채(중첩 표식이 남은 채) 눌러도 그 복귀 자리가 아니라 첫 정보 행이다(E57 Q1).
                GuideSession.pendingSheetReturn = null
                GuideSession.isMinimized = false
            }
            .testTag("guide-band")
            .defaultMinSize(minHeight = 48.dp)
            .padding(12.dp)
            .clearAndSetSemantics { contentDescription = spoken },
    ) {
        Column {
            Text(summary, style = MaterialTheme.typography.bodyLarge)
            Text(returnLabel, style = MaterialTheme.typography.bodySmall)
        }
    }
}
