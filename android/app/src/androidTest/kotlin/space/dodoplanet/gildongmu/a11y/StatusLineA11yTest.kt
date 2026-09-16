package space.dodoplanet.gildongmu.a11y

import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** spec §13-5·§13-6: 첫 컴포지션에 대기 중인 앱 통지는 발화 뒤 소비되고, 화면 통지와 한 문장으로 합쳐지며, 소비 뒤 화면 문장이 되돌아가지 않는다. */
@RunWith(AndroidJUnit4::class)
class StatusLineA11yTest {
    @get:Rule
    val rule = createAndroidComposeRule<ComponentActivity>()

    @Before fun reset() = AppNotices.reset()

    @Test
    fun pendingAppNoticeAtFirstCompositionIsSpokenThenConsumed() {
        AppNotices.post("이동이 감지되어 지정한 위치를 해제했습니다")
        rule.setContent { MaterialTheme { StatusLine(Notice(0, "")) } }
        rule.waitForIdle()
        rule.onNodeWithTag("status").assertTextEquals("이동이 감지되어 지정한 위치를 해제했습니다")
        assertNull("발화 뒤 소비", AppNotices.pending.value)
    }

    @Test
    fun appNoticeMergesWithScreenNoticeAndDoesNotReplayScreenTextAfterConsume() {
        var notice by mutableStateOf(Notice(1, "주변 역 3곳"))
        rule.setContent { MaterialTheme { StatusLine(notice) } }
        rule.waitForIdle()
        rule.onNodeWithTag("status").assertTextEquals("주변 역 3곳") // 초기 seq — 표시만
        rule.runOnUiThread { notice = Notice(2, "주변 역 4곳") }
        rule.waitForIdle()
        rule.onNodeWithTag("status").assertTextEquals("주변 역 4곳")
        AppNotices.post("해제됨") // 화면이 이미 seq 2를 낸 뒤 — 병합 세대가 화면 seq와 충돌하면 안 된다(구현 리뷰 BLOCKER)
        rule.waitForIdle()
        rule.onNodeWithTag("status").assertTextEquals("해제됨, 주변 역 4곳")
        assertNull(AppNotices.pending.value)
        rule.waitForIdle()
        rule.onNodeWithTag("status").assertTextEquals("해제됨, 주변 역 4곳") // 소비 뒤에도 화면 문장이 다시 나가지 않는다
        AppNotices.post("첫째"); AppNotices.post("둘째")
        rule.waitForIdle()
        rule.onNodeWithTag("status").assertTextEquals("둘째, 주변 역 4곳") // 연속 두 건은 차례로(첫째 → 둘째), 둘 다 소비
        assertNull(AppNotices.pending.value)
        assertEquals(2, notice.seq)
    }
}
