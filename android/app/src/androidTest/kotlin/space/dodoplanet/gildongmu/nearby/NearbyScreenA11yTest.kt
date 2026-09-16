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
import space.dodoplanet.gildongmu.kit.Fixtures
import space.dodoplanet.gildongmu.kit.HttpResponse
import space.dodoplanet.gildongmu.kit.NearbyCoord
import space.dodoplanet.gildongmu.kit.NearbyCoordinateSource
import space.dodoplanet.gildongmu.kit.NearbyLoadPhase
import space.dodoplanet.gildongmu.kit.NearbyService
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
        val body = Fixtures.kit("subway-nearby.json")
        val service = NearbyService(stubbedClient { url -> if (pathOf(url) == "/api/station/subway-arrival/nearby") HttpResponse(200, body) else HttpResponse(404, "") })
        val strings = nearbyStrings(rule.activity.applicationContext)
        val anchor = PlaceAnchor(37.538, 127.137, "길동역")
        val factory = viewModelFactory {
            initializer { NearbyScreenViewModel(NearbyKinds.subway(service, strings), NearbyCoordinateSource.Fixed(NearbyCoord(anchor.lat, anchor.lng)), strings, SavedStateHandle()) }
        }
        rule.setContent {
            MaterialTheme {
                NearbyKindScreen(NearbyKindRoute.of(NearbyKind.subway, anchor), factory, NearbyNav({}, {}, {}), requestPrecise = { false }, isLocationEnabled = { true })
            }
        }
        rule.enableAccessibilityChecks()
        rule.waitUntil(5_000) { rule.onAllNodesWithTagPrefix("station-").fetchSemanticsNodes().isNotEmpty() }
        rule.waitForIdle()
        rule.onNodeWithTag("title").assertTextContains("길동역", substring = true)
        rule.onNodeWithTag("station-길동").assertTextContains("길동", substring = true).assertIsFocused()
        rule.onRoot().tryPerformAccessibilityChecks()
    }
}

private fun androidx.compose.ui.test.junit4.ComposeTestRule.onAllNodesWithTagPrefix(prefix: String) =
    onAllNodes(androidx.compose.ui.test.SemanticsMatcher("tag starts with $prefix") { node ->
        node.config.getOrNull(androidx.compose.ui.semantics.SemanticsProperties.TestTag)?.startsWith(prefix) == true
    })
