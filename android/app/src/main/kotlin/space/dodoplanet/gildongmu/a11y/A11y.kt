package space.dodoplanet.gildongmu.a11y

import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import space.dodoplanet.gildongmu.search.Notice

// 접근성 기본형(spec §3, 헌장 정본 ~/.claude/ACCESSIBILITY.md). 다음 화면(M2~)도 이 셋을 반복한다.

/**
 * 한 줄 = 한 접근성 객체. 자식 `Text`들을 병합해 TalkBack·점자가 한 번에 읽는다. 낭독이 시각과 달라야 할 때만
 * (비-ko 병기 `Roman (한글)` → 괄호 없이) `spoken`을 준다 — **병합 컨테이너 한 곳에만**. 자식에 `contentDescription`을
 * 주면 나머지 자식 텍스트가 낭독에서 사라진다. 키보드(점자 단말기) 순회를 위해 `focusable`, 타깃 48dp.
 */
fun Modifier.mergedRow(tag: String, spoken: String? = null): Modifier = this
    .testTag(tag)
    .defaultMinSize(minHeight = 48.dp)
    .focusable()
    .semantics(mergeDescendants = true) { if (spoken != null) contentDescription = spoken }

/** 헤딩 시맨틱 — 스크린 리더의 헤딩 점프가 유일한 빠른 이동 수단인 자리(제목·섹션·최근 검색). */
fun Modifier.headingText(): Modifier = semantics { heading() }

/**
 * 단일 polite 통지 창구(화면에 하나). 항상 존재하는 `Text`이고 `seq`가 바뀌면 한 프레임 빈 문자열을 거쳐
 * 다시 쓴다 — Compose 라이브 리전은 텍스트가 **바뀔 때만** 발화하므로 같은 문장의 연속 통지(삭제 두 번)가
 * 침묵하지 않게 한다. 빈 문자열은 TalkBack·점자가 건너뛴다.
 */
@Composable
fun StatusLine(notice: Notice, modifier: Modifier = Modifier) {
    var shown by remember { mutableStateOf("") }
    LaunchedEffect(notice.seq) {
        shown = ""
        withFrameNanos { }
        shown = notice.text
    }
    Text(
        text = shown,
        modifier = modifier
            .testTag("status")
            .semantics { liveRegion = LiveRegionMode.Polite },
    )
}
