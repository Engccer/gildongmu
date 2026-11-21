package space.dodoplanet.gildongmu.directions

import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
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
import androidx.lifecycle.SavedStateHandle
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import space.dodoplanet.gildongmu.kit.APIClient
import space.dodoplanet.gildongmu.kit.DirectionsEndpoint
import space.dodoplanet.gildongmu.kit.HttpResponse
import space.dodoplanet.gildongmu.kit.InMemoryKeyValueStore
import space.dodoplanet.gildongmu.kit.JourneyTransferMode
import space.dodoplanet.gildongmu.kit.NearbyCoord
import space.dodoplanet.gildongmu.kit.PlacePhoneBook
import space.dodoplanet.gildongmu.kit.RecentSearchStore
import space.dodoplanet.gildongmu.kit.RecentStation
import space.dodoplanet.gildongmu.kit.RouteService
import space.dodoplanet.gildongmu.kit.SearchService
import space.dodoplanet.gildongmu.kit.StationService
import space.dodoplanet.gildongmu.kit.StubTransport
import space.dodoplanet.gildongmu.kit.pathOf
import space.dodoplanet.gildongmu.location.StaleFix
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.performSemanticsAction

/**
 * 길찾기 여정 입력 검사 레인(B26 단계 5 묶음 B): 입력 줄 순서·한 줄 한 객체·버튼 48dp(상태 여섯 갈래), 지금 탄 열차 단계 줄의 갈래(노선·방면·새로고침·문장만),
 * 입구 확인 질문 대화상자의 제목·버튼 순서·첫 버튼 착지·답과 닫기. 방면 응답은 스텁 전송으로 세운다. 머신 게이트 밖 — `adb` 연결 시 `./gradlew :app:connectedDebugAndroidTest`.
 */
@RunWith(AndroidJUnit4::class)
class DirectionsJourneyA11yTest {
    @get:Rule
    val rule = createAndroidComposeRule<ComponentActivity>()

    private val ga = RecentStation("가나역", 37.55, 126.95, "2호선", null)
    private val gaNoLine = RecentStation("가나역", 37.55, 126.95, null, null)
    private val da = RecentStation("다라역", 37.57, 126.97, null, null)

    private object SeoulLocator : EndpointLocator {
        override suspend fun currentCoordinate(force: Boolean) = NearbyCoord(37.5385, 127.1355)
        override suspend fun coordinateForRanking(): NearbyCoord? = null
        override suspend fun coordinateForDisplay(): NearbyCoord? = null
        override fun staleFix(): StaleFix? = null
        override fun storedCoordinate(): NearbyCoord? = null
        override suspend fun requestPreciseLocation() = false
    }

    private fun arrival(line: String, direction: String, nm: String, dest: String) =
        """{"line":"$line","direction":"$direction","trainLineNm":"$nm","destination":"$dest","message":"곧 도착","arrivalSeconds":60,"express":false}"""

    private fun arrivals(vararg items: String) = """{"arrivals":{"stationName":"가나","arrivals":[${items.joinToString(",")}]}}"""

    private val strings get() = resourceStrings(rule.activity.resources)

    /** 방면 조회(`/api/station/subway-arrival`)의 응답을 정해 화면을 띄운다. */
    private fun show(arrivalsReply: HttpResponse = HttpResponse(200, arrivals())): DirectionsViewModel {
        val transport = StubTransport { url ->
            when (pathOf(url)) {
                "/api/station/subway-arrival" -> arrivalsReply
                else -> HttpResponse(404, "")
            }
        }
        val client = APIClient("https://example.test", transport)
        val vm = DirectionsViewModel(
            RouteService(client), SearchService(client), StationService(client), RecentSearchStore(InMemoryKeyValueStore()), SeoulLocator,
            { "ko" }, resourceStrings(rule.activity.applicationContext.resources), SavedStateHandle(), PlacePhoneBook(InMemoryKeyValueStore()),
            prefill = MutableStateFlow(null), takePrefill = { false },
        )
        rule.setContent { MaterialTheme { DirectionsScreen(vm) } }
        rule.enableAccessibilityChecks()
        return vm
    }

    private fun checkAllRoots() {
        val count = rule.onAllNodes(isRoot()).fetchSemanticsNodes().size
        for (i in 0 until count) rule.onAllNodes(isRoot())[i].tryPerformAccessibilityChecks()
    }

    private fun exists(tag: String) = rule.onAllNodes(hasTestTag(tag)).fetchSemanticsNodes().isNotEmpty()
    private fun top(tag: String) = rule.onNodeWithTag(tag).getBoundsInRoot().top

    /** 줄들이 이 순서로 서 있고(위에서 아래로) 각 줄은 48dp 이상이다. */
    private fun assertRows(vararg tags: String) {
        for (tag in tags) rule.onNodeWithTag(tag).performScrollTo().assertIsDisplayed().assertHeightIsAtLeast(48.dp)
        tags.toList().zipWithNext().forEach { (a, b) -> assertTrue("$a < $b", top(a) < top(b)) }
    }

    private fun spoken(tag: String): String? = rule.onNodeWithTag(tag).fetchSemanticsNode().config.getOrNull(SemanticsProperties.ContentDescription)?.firstOrNull()

    private fun waitUntilAboardSettled(vm: DirectionsViewModel) {
        rule.waitUntil(10_000) { vm.state.value.aboardDirectionsState != AboardDirectionsState.Loading && vm.state.value.aboardDirectionsState != AboardDirectionsState.Idle }
        rule.waitForIdle()
    }

    // ── 입력 줄 순서: 상태 갈래 ──
    @Test
    fun emptyStateRowsAndEntryButton() {
        show()
        assertRows("field-from", "swap", "field-to", "via-add", "submit")
        rule.onNodeWithTag("via-add").assertTextEquals(strings.get("android.journey.addMenu"))
        assertTrue(!exists("station-clear") && !exists("aboard-step"))
        checkAllRoots()
    }

    @Test
    fun viaStateRows() {
        val vm = show()
        rule.runOnUiThread { vm.setVia(DirectionsEndpoint.Place("마바", 37.5, 127.0)) }
        rule.waitForIdle()
        assertRows("field-from", "swap", "field-to", "field-via", "via-remove", "submit")
        assertTrue(!exists("via-add"))
        checkAllRoots()
    }

    @Test
    fun oneStationFieldRowsAndClearButtonEmptiesBoth() {
        val vm = show()
        rule.runOnUiThread { vm.setJourneyStation(ga, board = true) }
        rule.waitForIdle()
        assertRows("field-from", "swap", "field-to", "field-board-station", "station-add-alight", "station-clear", "submit")
        // 한 줄 = 한 객체: 칸 이름과 역 이름이 한 문장이다. 경유지 칸·입구 버튼은 없다.
        assertEquals(vm.stationFieldText(true), spoken("field-board-station"))
        assertTrue(!exists("via-add") && !exists("field-via"))
        rule.onNodeWithTag("station-clear").performClick()
        rule.waitForIdle()
        assertNull(vm.state.value.boardStation)
        assertRows("field-from", "swap", "field-to", "via-add", "submit")
        checkAllRoots()
    }

    @Test
    fun twoStationFieldRowsHaveNoAddButton() {
        val vm = show()
        rule.runOnUiThread { vm.setJourneyStations(ga, da) }
        rule.waitForIdle()
        assertRows("field-from", "swap", "field-to", "field-board-station", "field-alight-station", "station-clear", "submit")
        assertEquals(vm.stationFieldText(false), spoken("field-alight-station"))
        assertTrue(!exists("station-add-board") && !exists("station-add-alight"))
        checkAllRoots()
    }

    // ── 지금 탄 열차: 단계 줄 갈래 ──
    @Test
    fun aboardLinesQuestionShowsLineButtons() {
        val vm = show(HttpResponse(200, arrivals(arrival("2호선", "내선", "성수행 - 성수방면", "성수"), arrival("4호선", "상행", "당고개행 - 당고개방면", "당고개"))))
        rule.runOnUiThread { vm.startAboard(gaNoLine) }
        waitUntilAboardSettled(vm)
        assertRows("field-from", "aboard-step", "aboard-line-0", "aboard-line-1", "field-to", "station-add-alight", "submit")
        rule.onNodeWithTag("aboard-step").assertTextEquals(strings.get("android.journey.aboardLinePrompt"))
        rule.onNodeWithTag("aboard-line-0").assertTextEquals("2호선")
        assertTrue(!exists("swap") && !exists("via-add"))
        checkAllRoots()
        // 노선을 고르면 방면 질문으로 바뀐다.
        rule.onNodeWithTag("aboard-line-0").performClick()
        rule.waitForIdle()
        rule.onNodeWithTag("aboard-step").assertTextEquals(strings.get("android.journey.aboardDirectionPrompt"))
        assertTrue(exists("aboard-direction-0") && !exists("aboard-line-0"))
    }

    @Test
    fun aboardDirectionQuestionThenChoiceRemovesStepRows() {
        val vm = show(HttpResponse(200, arrivals(arrival("2호선", "내선", "성수행 - 성수방면", "성수"), arrival("2호선", "외선", "시청행 - 시청방면", "시청"))))
        rule.runOnUiThread { vm.startAboard(ga) }
        waitUntilAboardSettled(vm)
        assertRows("field-from", "aboard-step", "aboard-direction-0", "aboard-direction-1", "field-to", "station-add-alight", "submit")
        rule.onNodeWithTag("aboard-step").assertTextEquals(strings.get("android.journey.aboardDirectionPrompt"))
        rule.onNodeWithTag("aboard-direction-0").assertTextEquals(vm.aboardDirectionRowText((vm.state.value.aboardDirectionsState as AboardDirectionsState.Loaded).directions[0]))
        checkAllRoots()
        rule.onNodeWithTag("aboard-direction-0").performClick()
        rule.waitForIdle()
        assertNotNull(vm.state.value.aboardOrigin?.direction)
        assertTrue(!exists("aboard-step") && !exists("aboard-direction-0"))
        assertRows("field-from", "field-to", "station-add-alight", "submit")
    }

    @Test
    fun aboardNoTrainsShowsSentenceAndRefreshButton() {
        val vm = show(HttpResponse(200, arrivals()))
        rule.runOnUiThread { vm.startAboard(ga) }
        waitUntilAboardSettled(vm)
        assertRows("field-from", "aboard-step", "aboard-refresh", "field-to", "station-add-alight", "submit")
        rule.onNodeWithTag("aboard-step").assertTextEquals(strings.get("android.journey.aboardDirectionsEmpty"))
        rule.onNodeWithTag("aboard-refresh").assertTextEquals(strings.get("android.common.refresh"))
        checkAllRoots()
    }

    @Test
    fun aboardFailedShowsRefreshButton() {
        val vm = show(HttpResponse(500, ""))
        rule.runOnUiThread { vm.startAboard(ga) }
        waitUntilAboardSettled(vm)
        assertRows("field-from", "aboard-step", "aboard-refresh", "field-to", "station-add-alight", "submit")
        rule.onNodeWithTag("aboard-step").assertTextEquals(strings.get("android.journey.aboardDirectionsFailed"))
        checkAllRoots()
    }

    @Test
    fun aboardUnavailableShowsSentenceOnly() {
        val vm = show(HttpResponse(200, """{"arrivals":null}"""))
        rule.runOnUiThread { vm.startAboard(ga) }
        waitUntilAboardSettled(vm)
        assertRows("field-from", "aboard-step", "field-to", "station-add-alight", "submit")
        rule.onNodeWithTag("aboard-step").assertTextEquals(strings.get("android.journey.aboardDirectionsUnavailable"))
        assertTrue(!exists("aboard-refresh"))
        checkAllRoots()
    }

    @Test
    fun submitWhileDirectionIsMissingDoesNotQuery() {
        val vm = show(HttpResponse(200, arrivals(arrival("2호선", "내선", "성수행 - 성수방면", "성수"), arrival("2호선", "외선", "시청행 - 시청방면", "시청"))))
        rule.runOnUiThread { vm.startAboard(ga) }
        waitUntilAboardSettled(vm)
        rule.onNodeWithTag("submit").performScrollTo().performClick()
        rule.waitForIdle()
        assertEquals(0, vm.state.value.resultsRevision)
        assertEquals(DirectionsPhase.Idle, vm.state.value.phase)
    }

    // ── 입구 확인 질문 ──
    private fun askTransfer(vm: DirectionsViewModel, station: RecentStation = da, mode: JourneyTransferMode = JourneyTransferMode.subway) {
        rule.runOnUiThread {
            vm.openPicker(DirectionsFieldTarget.transfer)
            vm.picker.journey!!.invoke().onSelectTransfer(station, mode)
            vm.closePicker()
        }
    }

    @Test
    fun transferQuestionDialogTitleButtonOrderFocusAndAnswer() {
        val vm = show()
        askTransfer(vm)
        rule.waitUntil(5_000) { exists("transfer-question") }
        rule.waitForIdle()
        val buttons = vm.transferQuestionButtons()
        assertEquals(4, buttons.size)
        rule.onNodeWithTag("transfer-question").assertTextEquals(vm.transferQuestionText())
        for ((i, b) in buttons.withIndex()) rule.onNodeWithTag("transfer-answer-$i").assertTextEquals(b.label).assertHeightIsAtLeast(48.dp)
        (0 until 3).forEach { assertTrue(top("transfer-answer-$it") < top("transfer-answer-${it + 1}")) }
        assertTrue(buttons.last().cancel)
        // 첫 버튼(짐작)에 착지한다.
        rule.waitUntil(3_000) { rule.onNodeWithTag("transfer-answer-0").fetchSemanticsNode().config.getOrNull(SemanticsProperties.Focused) == true }
        checkAllRoots()
        // 답: 대기가 비고 대화상자가 사라지며 그 쪽 역 칸이 선다.
        // TalkBack 두 번 탭과 같은 클릭 동작으로 누른다(주입 터치는 대화상자 창 밖으로 떨어져 바깥 누름으로 닫힐 수 있다).
        rule.onNodeWithTag("transfer-answer-0").performSemanticsAction(SemanticsActions.OnClick)
        rule.waitForIdle()
        assertNull(vm.state.value.pendingTransfer)
        assertTrue(!exists("transfer-question"))
        assertNotNull(vm.state.value.boardStation ?: vm.state.value.alightStation)
    }

    @Test
    fun transferQuestionCloseChangesNothingAndLandsOnEntryButton() {
        val vm = show()
        askTransfer(vm)
        rule.waitUntil(5_000) { exists("transfer-question") }
        rule.onNodeWithTag("transfer-answer-3").performSemanticsAction(SemanticsActions.OnClick)
        rule.waitForIdle()
        assertNull(vm.state.value.pendingTransfer)
        assertNull(vm.state.value.boardStation)
        assertNull(vm.state.value.alightStation)
        assertNull(vm.state.value.via)
        assertTrue(!exists("transfer-question"))
        rule.onNodeWithTag("via-add").assertIsDisplayed()
    }
}
