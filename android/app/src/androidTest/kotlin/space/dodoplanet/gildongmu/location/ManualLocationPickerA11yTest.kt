package space.dodoplanet.gildongmu.location

import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.accessibility.enableAccessibilityChecks
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.tryPerformAccessibilityChecks
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** spec §13-3·§13-6: 지정 화면 = 끝점 검색 콘텐츠 그대로, 제목 "위치 지정하기", 되돌리기 버튼 "현재 위치로 되돌리기"(이분 삼항 금지 — 도착지 제목으로 떨어지지 않는다). */
@RunWith(AndroidJUnit4::class)
class ManualLocationPickerA11yTest {
    @get:Rule
    val rule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun titleAndRevertButtonAreManualLocationWords() {
        rule.setContent { MaterialTheme { ManualLocationPickerScreen(onBack = {}) } }
        rule.enableAccessibilityChecks()
        rule.waitForIdle()
        rule.onNodeWithTag("title").assertTextEquals("위치 지정하기")
        rule.onNodeWithTag("ep-current").assertTextContains("현재 위치로 되돌리기")
        rule.onRoot().tryPerformAccessibilityChecks()
    }
}
