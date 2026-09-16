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
import space.dodoplanet.gildongmu.guide.WalkGuideUiState
import space.dodoplanet.gildongmu.guide.bandSummaryText
import space.dodoplanet.gildongmu.kit.joinText
import space.dodoplanet.gildongmu.kit.spokenDistanceUnits

/**
 * 띠바(spec §7-2, iOS `GuideBand` 미러): 시트를 내린 세션을 대표하는 버튼 하나 = 객체 하나. 시각 두 줄(요약·"안내 시트 펼치기"),
 * 낭독은 한 문장. 활성화 → 시트 복귀(첫 착지 = 접기 버튼). 착지 부착은 `landingTarget`을 `clickable` 앞에.
 */
@Composable
fun GuideBand(ui: WalkGuideUiState, strings: Strings, focus: FocusRequester) {
    val summary = bandSummaryText(ui, strings)
    val returnLabel = strings.get("guide.band.return")
    val spoken = joinText(spokenDistanceUnits(summary, strings.get("android.unit.spokenMeters")), returnLabel)
    Row(
        Modifier
            .fillMaxWidth()
            .landingTarget(focus)
            .clickable(role = Role.Button) { GuideSession.returnedFromBand = true; GuideSession.isMinimized = false }
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
