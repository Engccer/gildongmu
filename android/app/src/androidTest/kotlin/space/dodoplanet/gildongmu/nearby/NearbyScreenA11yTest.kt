package space.dodoplanet.gildongmu.nearby

import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.accessibility.enableAccessibilityChecks
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.tryPerformAccessibilityChecks
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import space.dodoplanet.gildongmu.DeviceFixtures
import space.dodoplanet.gildongmu.kit.HttpResponse
import space.dodoplanet.gildongmu.kit.NearbyCoord
import space.dodoplanet.gildongmu.kit.NearbyCoordinateSource
import space.dodoplanet.gildongmu.kit.NearbyLoadPhase
import space.dodoplanet.gildongmu.kit.ConditionsService
import space.dodoplanet.gildongmu.kit.NearbyService
import space.dodoplanet.gildongmu.kit.WalkInfraService
import space.dodoplanet.gildongmu.kit.pathOf
import space.dodoplanet.gildongmu.kit.stubbedClient

/**
 * 실기기 검사 레인(spec §8): 앵커 고정(측위 없음) + 스텁 전송으로 지하철 화면을 띄워 ATF 검사·역 헤딩 병합 노드·첫 로드 착지를 본다.
 * 머신 게이트 밖 — `adb` 연결 시 `./gradlew :app:connectedDebugAndroidTest`.
 */
@RunWith(AndroidJUnit4::class)
class NearbyScreenA11yTest {
    @get:Rule
    val rule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun subwayRowsMergeAndFirstStationLands() {
        val body = DeviceFixtures.kit("subway-nearby.json")
        val service = NearbyService(stubbedClient { url -> if (pathOf(url) == "/api/station/subway-arrival/nearby") HttpResponse(200, body) else HttpResponse(404, "") })
        val strings = nearbyStrings { rule.activity.resources }
        val anchor = PlaceAnchor(37.538, 127.137, "길동역")
        val factory = viewModelFactory {
            initializer { NearbyScreenViewModel(NearbyKinds.subway(service, strings), NearbyCoordinateSource.Fixed(NearbyCoord(anchor.lat, anchor.lng)), strings, SavedStateHandle()) }
        }
        rule.setContent {
            MaterialTheme {
                NearbyKindScreen(NearbyKindRoute.of(NearbyKind.subway, anchor), anchor, factory, NearbyNav({}, { _, _ -> }, {}), requestPrecise = { false }, isLocationEnabled = { true })
            }
        }
        rule.enableAccessibilityChecks()
        rule.waitUntil(5_000) { rule.onAllNodesWithTagPrefix("station-").fetchSemanticsNodes().isNotEmpty() }
        rule.waitForIdle()
        rule.onNodeWithTag("title").assertTextContains("길동역", substring = true)
        rule.onNodeWithTag("station-길동").assertTextContains("길동", substring = true).assertIsFocused()
        rule.onRoot().tryPerformAccessibilityChecks()
    }

    /** spec §12-5: 날씨 화면은 섹션 구조라 착지가 첫 섹션 헤딩(날씨)이고, 공기질 헤딩·혼잡도 줄이 각각 한 객체다. */
    @Test
    fun conditionsLandsOnWeatherHeading() {
        val service = ConditionsService(stubbedClient { url ->
            when (pathOf(url)) {
                "/api/weather/nearby" -> HttpResponse(200, DeviceFixtures.kit("weather-nearby.json"))
                "/api/air-quality/nearby" -> HttpResponse(200, DeviceFixtures.kit("air-nearby.json"))
                "/api/congestion/nearby" -> HttpResponse(200, DeviceFixtures.kit("congestion-nearby.json"))
                else -> HttpResponse(404, "")
            }
        })
        val strings = nearbyStrings { rule.activity.resources }
        val anchor = PlaceAnchor(37.538, 127.137, "길동역")
        val factory = viewModelFactory {
            initializer { NearbyScreenViewModel(NearbyKinds.conditions(service, strings), NearbyCoordinateSource.Fixed(NearbyCoord(anchor.lat, anchor.lng)), strings, SavedStateHandle()) }
        }
        rule.setContent { MaterialTheme { NearbyKindScreen(NearbyKindRoute.of(NearbyKind.conditions, anchor), anchor, factory, NearbyNav({}, { _, _ -> }, {}), requestPrecise = { false }, isLocationEnabled = { true }) } }
        rule.enableAccessibilityChecks()
        rule.waitUntil(5_000) { rule.onAllNodesWithTagPrefix("conditions-weather").fetchSemanticsNodes().isNotEmpty() }
        rule.waitForIdle()
        rule.onNodeWithTag("conditions-weather").assertIsFocused()
        rule.onNodeWithTag("air").assertExists()
        rule.onNodeWithTag("khai").assertTextContains(",", substring = true)
        rule.onRoot().tryPerformAccessibilityChecks()
    }

    /** spec §12-5: 보행 인프라는 그룹 헤딩 3개가 상태와 무관하게 있고 착지는 조회 시각 헤딩. */
    @Test
    fun walkInfraHasThreeGroupHeadings() {
        val service = WalkInfraService(stubbedClient { HttpResponse(200, DeviceFixtures.kit("walk-nearby-unsupported.json")) })
        val strings = nearbyStrings { rule.activity.resources }
        val anchor = PlaceAnchor(35.1, 129.0, "부산")
        val factory = viewModelFactory {
            initializer { NearbyScreenViewModel(NearbyKinds.walkInfra(service, strings) { "오후 3:04" }, NearbyCoordinateSource.Fixed(NearbyCoord(anchor.lat, anchor.lng)), strings, SavedStateHandle()) }
        }
        rule.setContent { MaterialTheme { NearbyKindScreen(NearbyKindRoute.of(NearbyKind.walkInfra, anchor), anchor, factory, NearbyNav({}, { _, _ -> }, {}), requestPrecise = { false }, isLocationEnabled = { true }) } }
        rule.enableAccessibilityChecks()
        rule.waitUntil(5_000) { rule.onAllNodesWithTagPrefix("walkinfra-top").fetchSemanticsNodes().isNotEmpty() }
        rule.waitForIdle()
        rule.onNodeWithTag("walkinfra-top").assertTextContains("오후 3:04", substring = true).assertIsFocused()
        for (tag in listOf("audio", "crossing", "tactile")) rule.onNodeWithTag(tag).assertExists()
        rule.onNodeWithTag("audio-status").assertExists() // unsupported 문장 — 헤딩 아래 침묵 없음
        rule.onRoot().tryPerformAccessibilityChecks()
    }
}

private fun androidx.compose.ui.test.junit4.ComposeTestRule.onAllNodesWithTagPrefix(prefix: String) =
    onAllNodes(androidx.compose.ui.test.SemanticsMatcher("tag starts with $prefix") { node ->
        node.config.getOrNull(androidx.compose.ui.semantics.SemanticsProperties.TestTag)?.startsWith(prefix) == true
    })
