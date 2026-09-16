package space.dodoplanet.gildongmu.settings

import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.accessibility.enableAccessibilityChecks
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.tryPerformAccessibilityChecks
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import space.dodoplanet.gildongmu.AppConfig
import space.dodoplanet.gildongmu.a11y.AppNotices

/** spec §14-5 ATF: 행 각 한 객체·언어/받아쓰기 행 라벨·다이얼로그 진입 착지 = 현재 선택 행·정보 출처 16행 + 링크 2. */
@RunWith(AndroidJUnit4::class)
class SettingsScreenA11yTest {
    @get:Rule
    val rule = createAndroidComposeRule<ComponentActivity>()

    @Before fun reset() {
        AppNotices.reset()
        AppConfig.settings.setLanguage(null); AppConfig.settings.setDictationStyle(SettingsStore.DICTATION_TAP); AppConfig.settings.setResultHaptics(false)
    }

    @Test
    fun rowsAreSingleObjectsWithLabelAndValue() {
        rule.setContent { MaterialTheme { SettingsScreen(onBack = {}, onOpenDataSources = {}, takeReturnFocus = { null }) } }
        rule.enableAccessibilityChecks()
        rule.waitForIdle()
        rule.onNodeWithTag("settings-language").assertTextEquals("언어, 시스템 설정 따름")
        rule.onNodeWithTag("settings-dictation").assertTextEquals("받아쓰기 방식, 탭으로 시작하고 정지")
        rule.onNodeWithTag("settings-datasources").assertTextEquals("정보 출처")
        rule.onNodeWithTag("title").assertIsFocused() // push 진입 착지 = 제목
        rule.onRoot().tryPerformAccessibilityChecks()
    }

    @Test
    fun choiceDialogLandsOnCurrentlySelectedRow() {
        AppConfig.settings.setLanguage("ja")
        rule.setContent { MaterialTheme { SettingsScreen(onBack = {}, onOpenDataSources = {}, takeReturnFocus = { null }) } }
        rule.waitForIdle()
        rule.onNodeWithTag("settings-language").assertTextEquals("언어, 日本語")
        rule.onNodeWithTag("settings-dictation").performClick() // 커서를 다른 행에 둔 채 연다(대상이 하나로 몰리면 검출력 0)
        rule.waitForIdle()
        rule.onNodeWithTag("choice-tapToggle").assertIsFocused()
        rule.onNodeWithTag("choice-cancel").performClick()
        rule.waitForIdle()
        rule.onNodeWithTag("settings-language").performClick()
        rule.waitForIdle()
        rule.onNodeWithTag("choice-system").assertIsDisplayed()
        rule.onNodeWithTag("choice-ja").assertIsFocused()
    }

    @Test
    fun dataSourcesListsSixteenRowsAndTwoLinks() {
        rule.setContent { MaterialTheme { DataSourcesScreen(onBack = {}) } }
        rule.enableAccessibilityChecks()
        rule.waitForIdle()
        rule.onNodeWithTag("source-0").assertIsDisplayed()
        rule.onNodeWithTag("source-15").assertIsDisplayed()
        rule.onNodeWithTag("osm-link").assertIsDisplayed()
        rule.onNodeWithTag("osm-copy").assertIsDisplayed()
        rule.onRoot().tryPerformAccessibilityChecks()
    }
}
