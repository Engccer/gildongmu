package space.dodoplanet.gildongmu.directions

import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.accessibility.enableAccessibilityChecks
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.tryPerformAccessibilityChecks
import androidx.lifecycle.SavedStateHandle
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import space.dodoplanet.gildongmu.kit.APIClient
import space.dodoplanet.gildongmu.location.StaleFix
import space.dodoplanet.gildongmu.DeviceFixtures
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.i18n.appLocalized
import space.dodoplanet.gildongmu.kit.HttpResponse
import space.dodoplanet.gildongmu.kit.InMemoryKeyValueStore
import space.dodoplanet.gildongmu.kit.NearbyCoord
import space.dodoplanet.gildongmu.kit.RecentSearchStore
import space.dodoplanet.gildongmu.kit.RouteService
import space.dodoplanet.gildongmu.kit.SearchService
import space.dodoplanet.gildongmu.kit.StubTransport
import space.dodoplanet.gildongmu.kit.pathOf

/**
 * 실기기 검사 레인(spec §9): 폼 → 도착지 끝점 검색 → 후보 선택 → 조회 → 수단 헤딩·구간 행이 단일 노드이고
 * ATF 검사를 통과하는지. 머신 게이트 밖 — `adb` 연결 시 `./gradlew :app:connectedDebugAndroidTest`.
 */
@RunWith(AndroidJUnit4::class)
class DirectionsScreenA11yTest {
    @get:Rule
    val rule = createAndroidComposeRule<ComponentActivity>()

    private val places = """{"places":[{"id":"k1","name":"강남역","category":"교통,수송 > 지하철","address":"서울 강남구","roadAddress":"서울 강남구 강남대로","lat":37.4979,"lng":127.0276}],"provider":"kakao-local","query":"강남"}"""
    private val emptyAddr = """{"addresses":[],"query":"q"}"""
    /** E42 줄 목록 봉투 — Kit 옛 봉투 fixture의 경로를 줄마다 싣는다(fixture 디렉터리는 읽기 전용). */
    private fun walkLines(vararg kinds: String, failed: List<String> = emptyList()): String {
        val route = DeviceFixtures.kit("route-walk.json").substringAfter("\"result\":").trimEnd().removeSuffix("}")
        val failedJson = if (failed.isEmpty()) "" else ""","failedLines":[""" + failed.joinToString(",") { "\"$it\"" } + "]"
        return """{"lines":[""" + kinds.joinToString(",") { """{"kind":"$it","route":$route}""" } + "]" + failedJson + "}"
    }

    /** 도착지가 정해진 폼에서 조회까지 — 도보 응답만 갈아 끼운다(E52 줄 구성 케이스 공용). */
    private fun submitWithWalk(walkBody: String): DirectionsViewModel {
        val transport = StubTransport { url ->
            when (pathOf(url)) {
                "/api/places/entrance" -> HttpResponse(200, "{}")
                "/api/route/transit" -> HttpResponse(200, DeviceFixtures.kit("route-transit.json"))
                "/api/route/walk" -> HttpResponse(200, walkBody)
                "/api/route/car" -> HttpResponse(200, DeviceFixtures.kit("route-car.json"))
                else -> HttpResponse(404, "")
            }
        }
        val client = APIClient("https://example.test", transport)
        val res = rule.activity.applicationContext.resources
        val vm = DirectionsViewModel(
            RouteService(client), SearchService(client), RecentSearchStore(InMemoryKeyValueStore()), SeoulLocator,
            { "ko" }, resourceStrings(res), SavedStateHandle(), prefill = MutableStateFlow(null), takePrefill = { false },
        )
        vm.setEndpoint(space.dodoplanet.gildongmu.kit.DirectionsEndpoint.Place("강남역", 37.4979, 127.0276), DirectionsFieldTarget.to)
        rule.setContent { MaterialTheme { DirectionsScreen(vm) } }
        rule.enableAccessibilityChecks()
        rule.onNodeWithTag("submit").performClick()
        rule.waitUntil(10_000) { vm.state.value.resultsRevision == 1 }
        rule.waitForIdle()
        return vm
    }

    private object SeoulLocator : EndpointLocator {
        override suspend fun currentCoordinate(force: Boolean) = NearbyCoord(37.5385, 127.1355)
        override suspend fun coordinateForRanking(): NearbyCoord? = null
        override suspend fun coordinateForDisplay(): NearbyCoord? = null
        override fun staleFix(): StaleFix? = null
        override fun storedCoordinate(): NearbyCoord? = null
        override suspend fun requestPreciseLocation() = false
    }

    @Test
    fun formToBriefingRowsAreSingleNodesAndPassAccessibilityChecks() {
        val transport = StubTransport { url ->
            when (pathOf(url)) {
                "/api/places" -> HttpResponse(200, places)
                "/api/address/search" -> HttpResponse(200, emptyAddr)
                "/api/places/entrance" -> HttpResponse(200, "{}")
                "/api/route/transit" -> HttpResponse(200, DeviceFixtures.kit("route-transit.json"))
                "/api/route/walk" -> HttpResponse(200, walkLines("shortest", "accessible"))
                "/api/route/car" -> HttpResponse(200, DeviceFixtures.kit("route-car.json"))
                else -> HttpResponse(404, "")
            }
        }
        val client = APIClient("https://example.test", transport)
        val res = rule.activity.applicationContext.resources
        val vm = DirectionsViewModel(
            RouteService(client), SearchService(client), RecentSearchStore(InMemoryKeyValueStore()), SeoulLocator,
            { "ko" }, resourceStrings(res), SavedStateHandle(), prefill = MutableStateFlow(null), takePrefill = { false },
        )
        rule.setContent { MaterialTheme { DirectionsScreen(vm) } }
        rule.enableAccessibilityChecks()

        rule.onNodeWithTag("field-to").performClick()
        rule.onNodeWithTag("ep-query").performTextInput("강남")
        rule.onNodeWithTag("ep-submit").performClick()
        rule.waitUntil(5_000) { vm.endpointSearch.value?.candidateRevision == 1 }
        rule.waitForIdle()
        rule.onNodeWithTag("ep-place-k1").performClick()
        rule.waitUntil(5_000) { vm.endpointSearch.value == null && vm.state.value.to != null }
        rule.waitForIdle()
        rule.onNodeWithTag("submit").performClick()
        rule.waitUntil(10_000) { vm.state.value.resultsRevision == 1 }
        rule.waitForIdle()

        rule.onNodeWithTag("heading-walk").performScrollTo().assertIsDisplayed()
        rule.onNodeWithTag("transit-p0-leg-0").performScrollTo().assertIsDisplayed()
        rule.onNodeWithTag("walk-shortest-step-0").performScrollTo().assertIsDisplayed()
        rule.onRoot().tryPerformAccessibilityChecks()

        // 대안 행은 기본 접힘 — 펼치면 본문 구간 노드가 생긴다(spec §9).
        val alt = vm.state.value.results!!.let { (it.outcomes[space.dodoplanet.gildongmu.kit.DirectionsMode.transit] as space.dodoplanet.gildongmu.kit.DirectionsModeOutcome.Transit).result.alternatives.first().routeKey }
        rule.onNodeWithTag("transit-$alt-leg-0").assertDoesNotExist()
        rule.onNodeWithTag("transit-$alt").performScrollTo().performClick()
        rule.waitForIdle()
        rule.onNodeWithTag("transit-$alt-leg-0").assertExists()
    }

    /**
     * E42 두 줄: 첫 줄(최단)은 펼쳐져 줄 안 맨 위에 "최단 경로로 안내 시작"이 있고, 둘째 줄(큰길)은 접혀 본문이 없다.
     * 계단 회피 토글은 없다(위원장 판정).
     */
    @Test
    fun walkTwoLinesFirstExpandedSecondCollapsedNoToggle() {
        submitWithWalk(walkLines("shortest", "broad"))
        rule.onNodeWithTag("guide-start-walk-shortest").performScrollTo().assertIsDisplayed()
        rule.onNodeWithTag("walk-line-broad").performScrollTo().assertIsDisplayed()
        rule.onNodeWithTag("walk-broad-step-0").assertDoesNotExist()
        rule.onNodeWithTag("stepfree").assertDoesNotExist()
        rule.onRoot().tryPerformAccessibilityChecks()
    }

    /**
     * E52 세 줄(최단·큰길·계단 회피, iOS 정식판 등가 — E43 이식 후보 ③): 첫 줄만 펼쳐지고, 뒤 두 줄은 종류마다 따로 펼친다(한 칸을
     * 공유하면 큰길을 열 때 계단 회피 줄도 함께 열린다). 각 줄 머리는 단일 노드이고 ATF를 통과한다.
     */
    @Test
    fun walkThreeLinesLaterLinesExpandIndependently() {
        submitWithWalk(walkLines("shortest", "broad", "accessible"))
        rule.onNodeWithTag("guide-start-walk-shortest").performScrollTo().assertIsDisplayed()
        rule.onNodeWithTag("walk-line-broad").performScrollTo().assertIsDisplayed()
        rule.onNodeWithTag("walk-line-accessible").performScrollTo().assertIsDisplayed()
        rule.onNodeWithTag("walk-broad-step-0").assertDoesNotExist()
        rule.onNodeWithTag("walk-accessible-step-0").assertDoesNotExist()
        rule.onRoot().tryPerformAccessibilityChecks()
        rule.onNodeWithTag("walk-line-broad").performScrollTo().performClick()
        rule.waitForIdle()
        rule.onNodeWithTag("walk-broad-step-0").assertExists()
        rule.onNodeWithTag("walk-accessible-step-0").assertDoesNotExist()
        rule.onRoot().tryPerformAccessibilityChecks()
    }

    /**
     * E52 판정 (나): 조회가 실패해 빠진 줄은 줄 목록 끝의 평문 한 줄로 알린다(통지 없음). 첫 줄만 남은 응답에서 그 줄이 단일 노드로
     * 보이고 문장은 두 줄 실패 키다.
     */
    @Test
    fun walkFailedLinesSentenceIsSinglePlainRow() {
        submitWithWalk(walkLines("shortest", failed = listOf("broad", "accessible")))
        val expected = appLocalized(rule.activity.applicationContext.resources, R.string.directions_walkLinesFailedBoth)
        rule.onNodeWithTag("walk-lines-failed").performScrollTo().assertIsDisplayed().assertTextEquals(expected)
        rule.onNodeWithTag("walk-line-broad").assertDoesNotExist()
        rule.onRoot().tryPerformAccessibilityChecks()
    }
}
