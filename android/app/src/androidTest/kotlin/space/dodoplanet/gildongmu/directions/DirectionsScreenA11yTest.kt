package space.dodoplanet.gildongmu.directions

import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.accessibility.enableAccessibilityChecks
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.tryPerformAccessibilityChecks
import androidx.lifecycle.SavedStateHandle
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import space.dodoplanet.gildongmu.kit.APIClient
import space.dodoplanet.gildongmu.kit.Fixtures
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

    private object SeoulLocator : EndpointLocator {
        override suspend fun currentCoordinate(force: Boolean) = NearbyCoord(37.5385, 127.1355)
        override suspend fun coordinateForRanking(): NearbyCoord? = null
        override suspend fun requestPreciseLocation() = false
    }

    @Test
    fun formToBriefingRowsAreSingleNodesAndPassAccessibilityChecks() {
        val transport = StubTransport { url ->
            when (pathOf(url)) {
                "/api/places" -> HttpResponse(200, places)
                "/api/address/search" -> HttpResponse(200, emptyAddr)
                "/api/places/entrance" -> HttpResponse(200, "{}")
                "/api/route/transit" -> HttpResponse(200, Fixtures.kit("route-transit.json"))
                "/api/route/walk" -> HttpResponse(200, Fixtures.kit("route-walk.json"))
                "/api/route/car" -> HttpResponse(200, Fixtures.kit("route-car.json"))
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
        rule.waitForIdle()
        rule.onNodeWithTag("submit").performClick()
        rule.waitUntil(10_000) { vm.state.value.resultsRevision == 1 }
        rule.waitForIdle()

        rule.onNodeWithTag("heading-walk").assertIsDisplayed()
        rule.onNodeWithTag("transit-p0-leg-0").assertIsDisplayed()
        rule.onNodeWithTag("walk-step-0").assertIsDisplayed()
        rule.onRoot().tryPerformAccessibilityChecks()
    }
}
