package space.dodoplanet.gildongmu.settings

import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
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
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.tryPerformAccessibilityChecks
import android.view.KeyEvent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import space.dodoplanet.gildongmu.a11y.AppNotices
import space.dodoplanet.gildongmu.kit.InMemoryKeyValueStore

/** spec §14-5 ATF: 행 각 한 객체·라벨·묶음 헤딩 다섯(E59)·다이얼로그 진입 착지(현재 행 / 저장값 null이면 첫 행)·라디오 집합 맥락·모달 뒤 앱 통지 보류·정보 출처. 저장소는 메모리(기기 설정을 건드리지 않는다). */
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
        rule.onNodeWithTag("settings-dictation").assertDoesNotExist() // B22 판정: 탭 방식만 — 행을 숨긴다
        rule.onNodeWithTag("settings-datasources").assertTextEquals("정보 출처")
        rule.onNodeWithTag("settings-theme").assertTextEquals("테마, 시스템 설정 따름")
        rule.onNodeWithTag("settings-listenspeed").assertTextEquals("듣기 속도, 1배")
        rule.onNodeWithTag("title").assertIsFocused() // push 진입 착지 = 제목
        rule.onRoot().tryPerformAccessibilityChecks()
    }

    @Test
    fun groupHeadingsAreHeadingsInJudgedOrder() {
        show()
        rule.waitForIdle()
        // E59: 헤딩은 묶음 다섯에만, 설정 행은 헤딩이 아니다(헤딩 점프로 묶음을 차례로 건너뛴다).
        val headings = listOf(
            "settings-heading-general" to "일반",
            "settings-heading-voice" to "음성",
            "settings-heading-guidance" to "길 안내",
            "settings-heading-aichat" to "AI 채팅",
            "settings-heading-about" to "앱 정보",
        )
        val tops = headings.map { (tag, text) ->
            rule.onNodeWithTag(tag).assertTextEquals(text).assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading))
            rule.onNodeWithTag(tag).fetchSemanticsNode().positionInRoot.y
        }
        assertEquals(tops.sorted(), tops)
        rule.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading)).assertCountEquals(1 + headings.size) // 화면 제목 + 묶음 다섯
        rule.onNodeWithTag("settings-theme").assert(SemanticsMatcher.keyNotDefined(SemanticsProperties.Heading))
        // 묶음 안: 일반 헤딩 → 테마 → 언어 → 음성 헤딩.
        val theme = rule.onNodeWithTag("settings-theme").fetchSemanticsNode().positionInRoot.y
        val language = rule.onNodeWithTag("settings-language").fetchSemanticsNode().positionInRoot.y
        assertTrue(tops[0] < theme && theme < language && language < tops[1])
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
        rule.onNodeWithTag("choice-ja").assertIsSelected().assertIsFocused() // 현재 값이 일곱째 행 — 첫 행 폴백과 갈린다
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
        rule.onNodeWithTag("settings-theme").performClick()
        rule.waitForIdle()
        AppNotices.post("이동이 감지되어 지정한 위치를 해제했습니다")
        rule.waitForIdle()
        rule.onNodeWithTag("status").assertTextEquals("") // 모달 뒤에서는 집지 않는다
        assertNotNull(AppNotices.pending.value)
        // 뒤로 = dismiss. 대화상자는 별도 창이라 액티비티 디스패처로 보내면 대화상자가 아니라 액티비티가 닫힌다 — 키를 창에 보낸다.
        InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
        rule.waitForIdle()
        rule.onNodeWithTag("status").assertTextEquals("이동이 감지되어 지정한 위치를 해제했습니다")
        assertNull(AppNotices.pending.value)
        rule.onNodeWithTag("settings-theme").assertIsFocused() // 닫힌 뒤 복귀 착지 = 연 행
    }

    @Test
    fun dataSourcesListsSixteenRowsTwoLinksAndLandsOnTitle() {
        rule.setContent { MaterialTheme { DataSourcesScreen(onBack = {}) } }
        rule.enableAccessibilityChecks()
        rule.waitForIdle()
        rule.onNodeWithTag("title").assertIsFocused()
        rule.onNodeWithTag("source-0").assertIsDisplayed()
        rule.onNodeWithTag("walk-health").assertExists() // B27 ④ 걸음·칼로리 방법 고지(화면 밖일 수 있어 존재만)
        // 아래쪽 줄은 작은 화면(한소네 576dp)에서 화면 밖이다 — 스크롤해 닿는지 본다.
        rule.onNodeWithTag("source-15").performScrollTo().assertIsDisplayed()
        rule.onNodeWithTag("osm-link").performScrollTo().assertIsDisplayed()
        rule.onNodeWithTag("osm-copy").performScrollTo().assertIsDisplayed()
        rule.onRoot().tryPerformAccessibilityChecks()
    }
}
