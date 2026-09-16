package space.dodoplanet.gildongmu.guide

import android.view.KeyEvent
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.junit4.accessibility.enableAccessibilityChecks
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.tryPerformAccessibilityChecks
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import space.dodoplanet.gildongmu.AppConfig
import space.dodoplanet.gildongmu.guide.ui.GuideBottomBar
import space.dodoplanet.gildongmu.guide.ui.WalkGuideStartButton
import space.dodoplanet.gildongmu.kit.BeaconDest
import space.dodoplanet.gildongmu.kit.WalkHealthSummary

/**
 * 실기기 검사 레인(spec §10-2 ①~⑥): 페이크 상태로 시트·띠바·종료 화면·시작 실패 행을 띄워 노드 계약과 ATF 검사를 본다.
 * 세션은 시작하지 않는다(`debugSetUi`). 머신 게이트 밖 — `adb` 연결 시 `./gradlew :app:connectedDebugAndroidTest`. JUnit 단언만.
 */
@RunWith(AndroidJUnit4::class)
class GuideSheetA11yTest {
    @get:Rule
    val rule = createAndroidComposeRule<ComponentActivity>()

    private val dest = BeaconDest(37.5385, 127.1355)
    private val tracking = WalkGuideUiState(status = GuideStatus.tracking, destinationLabel = "길동역", statusText = "목적지까지 약 300m", bandDistanceMeters = 300)

    @Before
    fun attach() {
        GuideSession.experimentalEnabled = { true }
        GuideSession.attach(rule.activity.applicationContext)
        GuideSession.isMinimized = false
        GuideSession.returnedFromBand = false
    }

    @After
    fun reset() {
        rule.runOnUiThread { GuideSession.walk.debugSetUi(WalkGuideUiState()) }
        GuideSession.isMinimized = false
        GuideSession.experimentalEnabled = { AppConfig.experimentalGuidanceEnabled }
    }

    private fun setBar() {
        rule.setContent {
            MaterialTheme {
                Column {
                    Box(Modifier.fillMaxWidth().height(200.dp).testTag("content"))
                    GuideBottomBar { Box(Modifier.fillMaxWidth().height(56.dp).testTag("tabs")) }
                }
            }
        }
        rule.enableAccessibilityChecks()
    }

    private fun setUi(state: WalkGuideUiState) {
        rule.runOnUiThread { GuideSession.walk.debugSetUi(state) }
        rule.waitForIdle()
    }

    private fun checkAllRoots() {
        val count = rule.onAllNodes(isRoot()).fetchSemanticsNodes().size
        for (i in 0 until count) rule.onAllNodes(isRoot())[i].tryPerformAccessibilityChecks()
    }

    /** ① 제목 헤딩·행 단일 노드·종료 버튼 48dp·ATF 통과, ④ bottomBar 슬롯에서 연 시트가 탭 바를 밀지 않는다. */
    @Test
    fun trackingSheetRowsAreSingleNodesAndTabsStay() {
        setBar()
        val tabsBefore = rule.onNodeWithTag("tabs").getBoundsInRoot()
        setUi(tracking)
        rule.onNodeWithTag("guide-title").assertIsDisplayed()
        rule.onNodeWithTag("guide-status").assertIsDisplayed()
        rule.onNodeWithTag("guide-brief-note").assertIsDisplayed()
        rule.onNodeWithTag("guide-stop").assertIsDisplayed().assertHeightIsAtLeast(48.dp)
        rule.onNodeWithTag("guide-minimize").assertHeightIsAtLeast(48.dp)
        assertEquals(tabsBefore, rule.onNodeWithTag("tabs").getBoundsInRoot())
        checkAllRoots()
    }

    /** ② 종료 화면: 착지 문장·걸음 문장 단일 노드, 종료 버튼 없음. */
    @Test
    fun endScreenShowsSentenceAndHealth() {
        setBar()
        setUi(WalkGuideUiState(destinationLabel = "길동역", arrivalDest = dest, endKind = SessionEndKind.arrived, arrivalHealth = WalkHealthSummary(1200, 27, usedDefaultWeight = true)))
        rule.onNodeWithTag("guide-end").assertIsDisplayed()
        rule.onNodeWithTag("guide-end-health").assertIsDisplayed()
        rule.onNodeWithTag("guide-end-close").assertHeightIsAtLeast(48.dp)
        assertEquals(0, rule.onAllNodes(androidx.compose.ui.test.hasTestTag("guide-stop")).fetchSemanticsNodes().size)
        checkAllRoots()
    }

    /** ③ 조망 열림 → 뒤로 키 → 조망만 닫히고 시트 유지. */
    @Test
    fun backKeyClosesOverviewOnly() {
        setBar()
        setUi(tracking.copy(mode = GuideMode.detail, routeStepDescriptions = listOf("천호대로를 따라 300m 이동", "길동역"), currentStepIndex = 0, remainingText = "남은 거리 300m, 약 4분"))
        rule.onNodeWithTag("guide-progress").performClick()
        rule.waitForIdle()
        rule.onNodeWithTag("guide-overview-header").assertIsDisplayed()
        rule.onNodeWithTag("guide-overview-step-0").assertIsDisplayed()
        InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
        rule.waitForIdle()
        assertEquals(0, rule.onAllNodes(androidx.compose.ui.test.hasTestTag("guide-overview-header")).fetchSemanticsNodes().size)
        rule.onNodeWithTag("guide-title").assertIsDisplayed()
        assertTrue(!GuideSession.isMinimized)
    }

    /** ⑤ 최소화 → 띠바 노드 → 활성화 → 시트 복귀. */
    @Test
    fun minimizeShowsBandAndBandReturns() {
        setBar()
        setUi(tracking)
        rule.onNodeWithTag("guide-minimize").performClick()
        rule.waitForIdle()
        assertTrue(GuideSession.isMinimized)
        rule.onNodeWithTag("guide-band").assertIsDisplayed().assertHeightIsAtLeast(48.dp)
        assertEquals(0, rule.onAllNodes(androidx.compose.ui.test.hasTestTag("guide-title")).fetchSemanticsNodes().size)
        rule.onNodeWithTag("guide-band").performClick()
        rule.waitForIdle()
        assertTrue(!GuideSession.isMinimized)
        rule.onNodeWithTag("guide-title").assertIsDisplayed()
        checkAllRoots()
    }

    /** ⑥ 시작 실패 상태 → 시작 버튼 아래 실패 문장 행 + 해결 버튼. */
    @Test
    fun startFailureRowAndResolutionButton() {
        rule.setContent { MaterialTheme { WalkGuideStartButton(dest, "길동역", accessible = false, variant = null, shortestAvailable = false, waypoint = null) } }
        rule.enableAccessibilityChecks()
        rule.onNodeWithTag("guide-start-walk").assertIsDisplayed().assertHeightIsAtLeast(48.dp)
        setUi(WalkGuideUiState(status = GuideStatus.denied, statusText = "위치 권한이 필요합니다", failResolution = FailResolution.settings, lastStartVariant = null))
        rule.onNodeWithTag("guide-fail").assertIsDisplayed()
        rule.onNodeWithTag("guide-fail-settings").assertIsDisplayed().assertHeightIsAtLeast(48.dp)
        setUi(WalkGuideUiState(status = GuideStatus.unavailable, statusText = "정확한 위치가 꺼져 있어 거리를 추적할 수 없습니다", failResolution = FailResolution.precise, lastStartVariant = null))
        rule.onNodeWithTag("guide-fail-precise").assertIsDisplayed()
        checkAllRoots()
    }
}
