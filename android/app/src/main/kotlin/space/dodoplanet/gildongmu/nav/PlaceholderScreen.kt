package space.dodoplanet.gildongmu.nav

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.a11y.headingText

/** 아직 화면이 없는 탭의 자리표시. 제목 헤딩 + 한 줄 — 그 마일스톤이 `AppRoot`의 등록 한 줄을 자기 화면으로 바꾼다. */
@Composable
fun PlaceholderScreen(tab: AppTab) {
    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text(stringResource(tab.label), style = MaterialTheme.typography.headlineSmall, modifier = Modifier.headingText())
        Text(stringResource(R.string.android_common_comingSoon), modifier = Modifier.padding(top = 8.dp))
    }
}
