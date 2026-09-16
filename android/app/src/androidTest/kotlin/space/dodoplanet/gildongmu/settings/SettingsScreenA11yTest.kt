package space.dodoplanet.gildongmu.settings

import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.accessibility.enableAccessibilityChecks
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.tryPerformAccessibilityChecks
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import space.dodoplanet.gildongmu.a11y.AppNotices
import space.dodoplanet.gildongmu.kit.InMemoryKeyValueStore

/** spec §14-5 ATF: 행 각 한 객체·라벨·다이얼로그 진입 착지(현재 행 / 저장값 null이면 첫 행)·라디오 집합 맥락·모달 뒤 앱 통지 보류·정보 출처. 저장소는 메모리(기기 설정을 건드리지 않는다). */
@RunWith(AndroidJUnit4::class)
class SettingsScreenA11yTest {
    @get:Rule
    val rule = createAndroidComposeRule<ComponentActivity>()

    private lateinit var store: SettingsStore

    @Before fun reset() {
        AppNotices.reset()
        store = SettingsStore(InMemoryKeyValueStore()).also { it.load() }
    }

    private fun show() = rule.setContent { MaterialTheme { SettingsScreen(onBack = {}, onOpenDataSources = {}, takeReturnFocus = { null }, store = store) } }

    @Test
    fun rowsAreSingleObjectsWithLabelAndValue() {
        show()
        rule.enableAccessibilityChecks()
        rule.waitForIdle()
        rule.onNodeWithTag("settings-language").assertTextEquals("언어, 시스템 설정 따름")
        rule.onNodeWithTag("settings-dictation").assertTextEquals("받아쓰기 방식, 탭으로 시작하고 정지")
        rule.onNodeWithTag("settings-datasources").assertTextEquals("정보 출처")
        rule.onNodeWithTag("title").assertIsFocused() // push 진입 착지 = 제목
        rule.onRoot().tryPerformAccessibilityChecks()
    }

    @Test
    fun languageDialogLandsOnSelectedRowAndKeepsRadioGroupContext() {
        store.setLanguage("ja")
        show()
        rule.waitForIdle()
        rule.onNodeWithTag("settings-language").assertTextEquals("언어, 日本語")
        rule.onNodeWithTag("settings-language").performClick()
        rule.waitForIdle()
        rule.onNodeWithTag("choice-system").assertIsDisplayed().assertIsNotSelected()
        rule.onNodeWithTag("choice-ko").assertIsNotSelected()
        rule.onNodeWithTag("choice-ja").assertIsSelected().assertIsFocused() // 현재 값이 다섯째 행 — 첫 행 폴백과 갈린다
    }

    @Test
    fun languageDialogLandsOnFirstRowWhenNothingStored() {
        show()
        rule.waitForIdle()
        rule.onNodeWithTag("settings-language").performClick()
        rule.waitForIdle()
        rule.onNodeWithTag("choice-system").assertIsSelected().assertIsFocused()
    }

    @Test
    fun appNoticeWaitsWhileDialogIsOpenAndSpeaksAfterDismiss() {
        show()
        rule.waitForIdle()
        rule.onNodeWithTag("settings-dictation").performClick()
        rule.waitForIdle()
        AppNotices.post("이동이 감지되어 지정한 위치를 해제했습니다")
        rule.waitForIdle()
        rule.onNodeWithTag("status").assertTextEquals("") // 모달 뒤에서는 집지 않는다
        assertNotNull(AppNotices.pending.value)
        rule.runOnUiThread { rule.activity.onBackPressedDispatcher.onBackPressed() } // 뒤로 = dismiss
        rule.waitForIdle()
        rule.onNodeWithTag("status").assertTextEquals("이동이 감지되어 지정한 위치를 해제했습니다")
        assertNull(AppNotices.pending.value)
        rule.onNodeWithTag("settings-dictation").assertIsFocused() // 닫힌 뒤 복귀 착지 = 연 행
    }

    @Test
    fun dataSourcesListsSixteenRowsTwoLinksAndLandsOnTitle() {
        rule.setContent { MaterialTheme { DataSourcesScreen(onBack = {}) } }
        rule.enableAccessibilityChecks()
        rule.waitForIdle()
        rule.onNodeWithTag("title").assertIsFocused()
        rule.onNodeWithTag("source-0").assertIsDisplayed()
        rule.onNodeWithTag("source-15").assertIsDisplayed()
        rule.onNodeWithTag("osm-link").assertIsDisplayed()
        rule.onNodeWithTag("osm-copy").assertIsDisplayed()
        rule.onRoot().tryPerformAccessibilityChecks()
    }
}
