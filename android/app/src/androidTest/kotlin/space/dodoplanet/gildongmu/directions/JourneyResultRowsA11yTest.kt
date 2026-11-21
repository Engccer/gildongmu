package space.dodoplanet.gildongmu.directions

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.junit4.accessibility.enableAccessibilityChecks
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.tryPerformAccessibilityChecks
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import space.dodoplanet.gildongmu.kit.BeaconDest
import space.dodoplanet.gildongmu.kit.DataLocale
import space.dodoplanet.gildongmu.kit.RecentStation
import space.dodoplanet.gildongmu.kit.RoutePoint
import space.dodoplanet.gildongmu.kit.models.CarRouteBriefing
import space.dodoplanet.gildongmu.kit.models.EgressKind
import space.dodoplanet.gildongmu.kit.models.EgressOption
import space.dodoplanet.gildongmu.kit.models.JourneyEgress
import space.dodoplanet.gildongmu.kit.models.JourneyResult
import space.dodoplanet.gildongmu.kit.models.JourneyStationRef
import space.dodoplanet.gildongmu.kit.models.JourneyTotals
import space.dodoplanet.gildongmu.kit.models.JourneyVariant
import space.dodoplanet.gildongmu.kit.models.JourneyVariantKind
import space.dodoplanet.gildongmu.kit.models.TransitRoute
import space.dodoplanet.gildongmu.kit.models.TransitRouteLeg
import space.dodoplanet.gildongmu.kit.models.TransitRouteSummary

/**
 * 여정 결과 줄 검사 레인(B26 단계 5 묶음 C): 줄 하나 = 접근성 객체 하나(글자가 곧 이름), 변형·출구 선택 버튼의 `selected`, 고른 변형 제목만 heading,
 * 버튼 48dp, 줄 순서, ATF. 「안내 시작」은 누르지 않는다(세션을 시작하지 않는다). 머신 게이트 밖 — `adb` 연결 시 `./gradlew :app:connectedDebugAndroidTest`.
 */
@RunWith(AndroidJUnit4::class)
class JourneyResultRowsA11yTest {
    @get:Rule
    val rule = createAndroidComposeRule<ComponentActivity>()

    private val strings get() = resourceStrings(rule.activity.resources)

    private fun taxi(seconds: Int, fare: Int) = CarRouteBriefing(distanceMeters = 1000, durationSeconds = seconds, taxiFare = fare, tollFare = 0, guides = emptyList())
    private fun exit(label: String, seconds: Int, fare: Int) = EgressOption(EgressKind.exit, label, "", null, RoutePoint(37.5, 127.0), taxi(seconds, fare))
    private fun route(from: String, to: String) =
        TransitRoute(TransitRouteSummary(20, 1500, 0, 0), listOf(TransitRouteLeg(mode = "subway", lineName = "수도권 2호선", fromName = from, toName = to, minutes = 10)), "k-$from", null, null)

    private val designated = JourneyVariant(
        JourneyVariantKind.designated, JourneyStationRef("가나역", RoutePoint(37.55, 126.95)), null, taxi(600, 4000), route("가나역", "다라역"),
        JourneyEgress(listOf(exit("1", 600, 4000), exit("3", 900, 7000)), null), JourneyTotals(40, 8000, 1500),
    )
    private val recommended = designated.copy(kind = JourneyVariantKind.recommended, transit = route("자차역", "다라역"))
    private val ga = RecentStation("가나역", 37.55, 126.95, "2호선", null)
    private val dest = JourneyDestination("라마역", BeaconDest(37.5, 127.0))

    private fun set(result: JourneyResult, variantIndex: Int, egressIndex: Int, destination: JourneyDestination?, aboard: AboardOrigin? = null, onVariant: (Int) -> Unit = {}, onEgress: (Int) -> Unit = {}) {
        rule.setContent {
            MaterialTheme {
                Column {
                    JourneyResultRows(
                        result, ga, null, aboard, variantIndex, egressIndex, onVariant, onEgress, destination,
                        destinationName = "라마역", destinationRoman = null, lang = "ko", dataLocale = DataLocale.ko, strings = strings,
                        stationEntry = null, landingFocus = FocusRequester(), onStart = {},
                    )
                }
            }
        }
        rule.enableAccessibilityChecks()
    }

    private fun checkAllRoots() {
        val count = rule.onAllNodes(isRoot()).fetchSemanticsNodes().size
        for (i in 0 until count) rule.onAllNodes(isRoot())[i].tryPerformAccessibilityChecks()
    }

    private fun exists(tag: String) = rule.onAllNodes(hasTestTag(tag)).fetchSemanticsNodes().isNotEmpty()
    private fun top(tag: String) = rule.onNodeWithTag(tag).getBoundsInRoot().top
    private val heading = SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading)

    @Test
    fun twoVariantsReadInOrderWithSelectionAndSingleHeading() {
        var picked = -1
        set(JourneyResult(listOf(designated, recommended), null), variantIndex = 0, egressIndex = 0, destination = dest, onVariant = { picked = it })
        val order = listOf("journey-variant-0", "journey-variant-1", "journey-variant-heading", "journey-totals", "journey-taxi-in", "journey-transit-leg-0", "journey-egress-0", "journey-egress-1", "guide-start-journey")
        for (tag in order) rule.onNodeWithTag(tag).performScrollTo().assertIsDisplayed()
        order.zipWithNext().forEach { (a, b) -> assertTrue("$a < $b", top(a) < top(b)) }
        rule.onNodeWithTag("journey-variant-0").assertIsSelected().assertTextEquals("가나역에서 타는 경로")
        rule.onNodeWithTag("journey-variant-1").assertIsNotSelected().assertTextEquals("자차역에서 타는 추천 경로")
        rule.onNodeWithTag("journey-egress-0").assertIsSelected()
        rule.onNodeWithTag("journey-egress-1").assertIsNotSelected()
        // 줄 하나 = 객체 하나: 글자가 곧 이름. heading은 고른 변형 제목 한 줄뿐이다.
        rule.onNodeWithTag("journey-variant-heading").assert(heading).assertTextEquals("가나역에서 타는 경로")
        for (tag in listOf("journey-variant-0", "journey-variant-1", "journey-totals", "journey-egress-0", "guide-start-journey")) {
            rule.onNodeWithTag(tag).assert(SemanticsMatcher.keyNotDefined(SemanticsProperties.Heading))
        }
        rule.onNodeWithTag("journey-totals").assertTextEquals("총 40분, 택시 요금 약 8,000원, 대중교통 요금 1,500원")
        for (tag in listOf("journey-variant-0", "journey-variant-1", "journey-egress-0", "journey-egress-1", "guide-start-journey")) {
            rule.onNodeWithTag(tag).assertHeightIsAtLeast(48.dp)
        }
        rule.onNodeWithTag("guide-start-journey").assertTextEquals("가나역에서 타는 경로 안내 시작")
        rule.onNodeWithTag("journey-variant-1").performClick()
        assertEquals(1, picked)
        checkAllRoots()
    }

    @Test
    fun selectedEgressFollowsStateAndAboardStartLabelIsPlain() {
        var egress = -1
        val aboard = AboardOrigin(ga, "2호선", direction = null)
        set(JourneyResult(listOf(designated), null), variantIndex = 0, egressIndex = 1, destination = dest, aboard = aboard, onEgress = { egress = it })
        // 변형이 하나면 변형 선택·제목 없이 합계부터. 지금 탄 열차는 대중교통 요금을 말하지 않고 시작 라벨에 제목이 없다.
        assertEquals(false, exists("journey-variant-0"))
        assertEquals(false, exists("journey-variant-heading"))
        rule.onNodeWithTag("journey-totals").assertTextEquals("총 45분, 택시 요금 약 11,000원")
        rule.onNodeWithTag("journey-egress-0").assertIsNotSelected()
        rule.onNodeWithTag("journey-egress-1").assertIsSelected()
        rule.onNodeWithTag("guide-start-journey").performScrollTo().assertTextEquals("안내 시작")
        rule.onNodeWithTag("journey-egress-0").performClick()
        assertEquals(0, egress)
        checkAllRoots()
    }

    @Test
    fun noStartButtonWhenDestinationIsCurrentLocation() {
        set(JourneyResult(listOf(designated), null), variantIndex = 0, egressIndex = 0, destination = null)
        rule.onNodeWithTag("journey-totals").assertIsDisplayed()
        assertEquals(false, exists("guide-start-journey"))
        checkAllRoots()
    }
}
