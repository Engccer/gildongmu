package space.dodoplanet.gildongmu.guide

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertContentDescriptionEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.junit4.accessibility.enableAccessibilityChecks
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.tryPerformAccessibilityChecks
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import space.dodoplanet.gildongmu.guide.ui.GuideBottomBar
import space.dodoplanet.gildongmu.guide.ui.GuideNav
import space.dodoplanet.gildongmu.kit.JourneyPhase
import space.dodoplanet.gildongmu.kit.JourneyStage
import space.dodoplanet.gildongmu.kit.joinText

/**
 * 여정 시트·띠바 검사 레인(B26 단계 3 묶음 A): 페이크 여정 상태(`debugSetJourneyUi`)로 `GuideBottomBar`가 고른 여정 시트의 노드 계약·버튼 순서·높이와
 * ATF 검사를 본다. 세션은 시작하지 않는다. 머신 게이트 밖 — `adb` 연결 시 `./gradlew :app:connectedDebugAndroidTest`.
 */
@RunWith(AndroidJUnit4::class)
class JourneySheetA11yTest {
    @get:Rule
    val rule = createAndroidComposeRule<ComponentActivity>()

    private val strings get() = guideStrings(rule.activity.resources)

    @Before
    fun attach() {
        GuideSession.attach(rule.activity.applicationContext)
        GuideSession.isMinimized = false
    }

    @After
    fun reset() {
        rule.runOnUiThread { GuideSession.debugSetJourneyUi(null) }
        GuideSession.isMinimized = false
    }

    private fun setBar() {
        rule.setContent {
            MaterialTheme {
                Column {
                    Box(Modifier.fillMaxWidth().height(200.dp).testTag("content"))
                    GuideBottomBar(GuideNav(onOpenSettings = {}, onOpenPlace = { _, _, _, _ -> })) { Box(Modifier.fillMaxWidth().height(56.dp).testTag("tabs")) }
                }
            }
        }
        rule.enableAccessibilityChecks()
    }

    private fun setJourney(phase: JourneyPhase, failure: JourneyFailure? = null) {
        rule.runOnUiThread { GuideSession.debugSetJourneyUi(JourneyUiState(phase, failure)) }
        rule.waitForIdle()
    }

    private fun checkAllRoots() {
        val count = rule.onAllNodes(isRoot()).fetchSemanticsNodes().size
        for (i in 0 until count) rule.onAllNodes(isRoot())[i].tryPerformAccessibilityChecks()
    }

    private fun exists(tag: String) = rule.onAllNodes(hasTestTag(tag)).fetchSemanticsNodes().isNotEmpty()

    private fun top(tag: String) = rule.onNodeWithTag(tag).getBoundsInRoot().top

    /** 준비 중: 상태 문장 한 줄 + 안내 종료만(버튼 없음). */
    @Test
    fun transitioningShowsStatusAndStopOnly() {
        setBar()
        setJourney(JourneyPhase.Transitioning(JourneyStage.taxiIn))
        rule.onNodeWithTag("journey-status").assertIsDisplayed().assertTextEquals(strings.get("directions.loading"))
        rule.onNodeWithTag("journey-stop").assertIsDisplayed().assertHeightIsAtLeast(48.dp)
        rule.onNodeWithTag("guide-minimize").assertHeightIsAtLeast(48.dp)
        for (tag in listOf("journey-retry", "journey-settings", "journey-precise", "journey-taxi-dropped", "journey-taxi-boarded")) assertEquals(tag, false, exists(tag))
        checkAllRoots()
    }

    /** 택시 앞 구간 실패: 재시도 → 자동차에서 내렸어요 → 종료 순서. */
    @Test
    fun failedTaxiInOrder() {
        setBar()
        setJourney(JourneyPhase.Failed(JourneyStage.taxiIn))
        rule.onNodeWithTag("journey-status").assertIsDisplayed().assertTextEquals(strings.get("android.journey.taxiOutFailed"))
        rule.onNodeWithTag("journey-retry").assertIsDisplayed().assertHeightIsAtLeast(48.dp)
        rule.onNodeWithTag("journey-taxi-dropped").assertIsDisplayed().assertHeightIsAtLeast(48.dp)
        assertTrue(top("journey-status") < top("journey-retry"))
        assertTrue(top("journey-retry") < top("journey-taxi-dropped"))
        assertTrue(top("journey-taxi-dropped") < top("journey-stop"))
        checkAllRoots()
    }

    /** 출구 도보 시작 실패: 재시도 없이 자동차에 탔어요만. */
    @Test
    fun failedEgressHasNoRetry() {
        setBar()
        setJourney(JourneyPhase.Failed(JourneyStage.egress))
        rule.onNodeWithTag("journey-status").assertTextEquals(strings.get("android.journey.egressStartFailed"))
        rule.onNodeWithTag("journey-taxi-boarded").assertIsDisplayed().assertHeightIsAtLeast(48.dp)
        assertEquals(false, exists("journey-retry"))
        assertEquals(false, exists("journey-taxi-dropped"))
        checkAllRoots()
    }

    /** 권한 철회로 끊김: 원인 문장 + 설정 열기가 재시도보다 먼저. */
    @Test
    fun failedWithSettingsResolutionComesFirst() {
        setBar()
        setJourney(JourneyPhase.Failed(JourneyStage.access), JourneyFailure("beacon.denied", FailResolution.settings))
        rule.onNodeWithTag("journey-status").assertTextEquals(strings.get("beacon.denied"))
        rule.onNodeWithTag("journey-settings").assertIsDisplayed().assertHeightIsAtLeast(48.dp)
        assertTrue(top("journey-settings") < top("journey-retry"))
        assertEquals(false, exists("journey-precise"))
        checkAllRoots()
    }

    /** 정밀 위치 꺼짐으로 끊김: 정확한 위치 허용이 재시도보다 먼저. */
    @Test
    fun failedWithPreciseResolution() {
        setBar()
        setJourney(JourneyPhase.Failed(JourneyStage.transit), JourneyFailure("beacon.reduced", FailResolution.precise))
        rule.onNodeWithTag("journey-precise").assertIsDisplayed().assertHeightIsAtLeast(48.dp)
        assertTrue(top("journey-precise") < top("journey-retry"))
        assertEquals(false, exists("journey-settings"))
        checkAllRoots()
    }

    /** 최소화하면 시트 대신 띠바: 요약은 시트 상태 문장과 같은 문장. */
    @Test
    fun minimizedShowsBandWithStatusSummary() {
        GuideSession.isMinimized = true
        setBar()
        setJourney(JourneyPhase.Failed(JourneyStage.egress))
        rule.onNodeWithTag("guide-band").assertIsDisplayed().assertHeightIsAtLeast(48.dp)
        assertEquals(false, exists("journey-status"))
        rule.onNodeWithTag("guide-band").assertContentDescriptionEquals(joinText(strings.get("android.journey.egressStartFailed"), strings.get("guide.band.return")))
        checkAllRoots()
    }
}
