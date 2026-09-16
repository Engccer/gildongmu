package space.dodoplanet.gildongmu.a11y

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.unit.dp

// 본문 한 줄·섹션 헤딩의 공용 모양(M2b — 여섯 화면·자동 섹션이 같은 행을 반복한다). 한 줄 = 한 접근성 객체.

/** 평문 한 줄(`mergedRow`). 낭독이 시각과 다를 때만 `spoken`. */
@Composable
fun BodyLine(text: String, key: String, spoken: String? = null) {
    Text(text, Modifier.fillMaxWidth().mergedRow(key, spoken).padding(vertical = 8.dp))
}

/** 섹션 헤딩 — 자동 등장 섹션의 유일한 발견 경로. 착지 대상이면 `focus`(mergedRow 안, focusable 앞). */
@Composable
fun HeadingLine(text: String, key: String, focus: FocusRequester? = null, spoken: String? = null) {
    Text(
        text,
        Modifier.fillMaxWidth().mergedRow(key, spoken, focus = focus).headingText().padding(top = 12.dp, bottom = 4.dp),
        style = MaterialTheme.typography.titleMedium,
    )
}
