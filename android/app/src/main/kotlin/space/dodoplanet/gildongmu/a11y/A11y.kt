package space.dodoplanet.gildongmu.a11y

import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

// 접근성 기본형(spec §3, 헌장 정본 ~/.claude/ACCESSIBILITY.md). 다음 화면(M2~)도 이 셋을 반복한다.

/**
 * 한 줄 = 한 접근성 객체. 자식 `Text`들을 병합해 TalkBack·점자가 한 번에 읽는다. 낭독이 시각과 달라야 할 때만
 * (비-ko 병기 `Roman (한글)` → 괄호 없이) `spoken`을 준다 — **병합 컨테이너 한 곳에만**. 자식에 `contentDescription`을
 * 주면 나머지 자식 텍스트가 낭독에서 사라진다. 키보드(점자 단말기) 순회를 위해 `focusable`, 타깃 48dp.
 *
 * ⚠ 착지 대상이면 `focus`를 **여기에** 준다. `FocusRequester`는 자기 뒤(자식 방향)의 포커스 타깃만 찾으므로
 * `.mergedRow(...).focusRequester(r)` 순서로 붙이면 안에 든 `focusable()`을 못 찾아 `requestFocus()`가 조용히 실패한다
 * (M2 리뷰 BLOCKER — 소스 가드 `AppSourceGuardTest`가 그 순서를 막는다).
 */
fun Modifier.mergedRow(tag: String, spoken: String? = null, focus: FocusRequester? = null): Modifier = this
    .let { m -> if (focus != null) m.focusRequester(focus) else m } // 반드시 focusable() 앞
    .testTag(tag)
    .defaultMinSize(minHeight = 48.dp)
    .focusable()
    .semantics(mergeDescendants = true) { if (spoken != null) contentDescription = spoken }

/** 터치 타깃 48dp(헌장). Material3 `Button` 기본 높이는 40dp라 버튼마다 건다. */
fun Modifier.tapTarget(): Modifier = defaultMinSize(minHeight = 48.dp)

/** 헤딩 시맨틱 — 스크린 리더의 헤딩 점프가 유일한 빠른 이동 수단인 자리(제목·섹션·최근 검색). */
fun Modifier.headingText(): Modifier = semantics { heading() }

/**
 * 단일 polite 통지 창구(화면에 하나). 항상 존재하는 `Text`이고 `seq`가 바뀌면 한 프레임 빈 문자열을 거쳐
 * 다시 쓴다 — Compose 라이브 리전은 텍스트가 **바뀔 때만** 발화하므로 같은 문장의 연속 통지(삭제 두 번)가
 * 침묵하지 않게 한다. 빈 문자열은 TalkBack·점자가 건너뛴다.
 *
 * 앱 통지(`AppNotices`, spec §13-5)는 **스스로** 읽어 화면 통지와 한 문장으로 병합한다(화면마다 배선하지 않아 총체적 — 소스 가드가
 * `AppScreenScaffold` 화면마다 `StatusLine` 하나를 강제한다). 초기 seq 억제(재마운트 재발화 방지)는 화면 통지만으로 계산하고, 앱 통지가
 * 붙은 병합 결과는 항상 새 seq를 받아 발화 경로를 지나며 그 끝에서만 `consume`한다(발화 성공 시점 latch).
 */
@Composable
fun StatusLine(notice: Notice, modifier: Modifier = Modifier) {
    val app by AppNotices.pending.collectAsState()
    // 재마운트(회전·언어 변경·탭 복귀)에서 마지막 문장을 다시 발화하지 않는다 — 첫 seq는 재게시 없이 그대로 둔다(화면 통지에만).
    val initialSeq = remember { notice.seq }
    val counter = remember { mutableIntStateOf(notice.seq) }
    val merged = remember(notice, app) { if (app == null) notice else mergeNotices(notice, app, ++counter.intValue) }
    var shown by remember { mutableStateOf(if (app == null) notice else Notice(notice.seq, "", null)) }
    LaunchedEffect(merged.seq) {
        if (app == null && merged.seq == initialSeq) return@LaunchedEffect
        shown = Notice(merged.seq, "", null)
        withFrameNanos { }
        shown = merged
        app?.let { AppNotices.consume(it.seq) }
    }
    // 시각은 원문, 낭독형이 따로 있으면 contentDescription(라이브 리전도 그것을 읽는다) — 화면과 낭독이 제 역할을 나눈다.
    val spoken = shown.spoken?.takeIf { it != shown.text }
    Text(
        text = shown.text,
        modifier = modifier
            .testTag("status")
            .semantics {
                liveRegion = LiveRegionMode.Polite
                if (spoken != null) contentDescription = spoken
            },
    )
}
