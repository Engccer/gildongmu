package space.dodoplanet.gildongmu.search

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.accessibility.enableAccessibilityChecks
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.tryPerformAccessibilityChecks
import androidx.lifecycle.SavedStateHandle
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import space.dodoplanet.gildongmu.kit.HttpResponse
import space.dodoplanet.gildongmu.kit.InMemoryKeyValueStore
import space.dodoplanet.gildongmu.kit.RecentSearchStore
import space.dodoplanet.gildongmu.kit.SearchService
import space.dodoplanet.gildongmu.kit.pathOf
import space.dodoplanet.gildongmu.kit.stubbedClient
import space.dodoplanet.gildongmu.searchStrings

/**
 * 실기기 검사 레인(spec §7): Accessibility Test Framework(라벨 누락·터치 타깃·대비·순회)가 검색 화면을 검사하고,
 * 결과 행이 한 노드로 병합되며 첫 결과에 포커스가 착지하는지를 본다. 머신 게이트 밖 — `adb` 연결 시
 * `./gradlew :app:connectedDebugAndroidTest`.
 */
@RunWith(AndroidJUnit4::class)
class SearchScreenA11yTest {
    @get:Rule
    val rule = createAndroidComposeRule<ComponentActivity>()

    private val places = """{"places":[{"id":"k1","name":"강동역","category":"교통,수송 > 지하철","address":"서울 강동구","roadAddress":"서울 강동구 천호대로","lat":37.5,"lng":127.1}],"provider":"kakao-local","query":"강동"}"""
    private val emptyAddr = """{"addresses":[],"query":"q"}"""

    @Test
    fun rowsAreSingleNodesAndPassAccessibilityChecks() {
        val vm = SearchViewModel(
            SearchService(stubbedClient { url -> if (pathOf(url) == "/api/places") HttpResponse(200, places) else HttpResponse(200, emptyAddr) }),
            RecentSearchStore(InMemoryKeyValueStore()),
            { "ko" },
            searchStrings { rule.activity.resources },
            SavedStateHandle(),
        )
        rule.setContent { MaterialTheme { SearchScreen(vm) } } // 실제 앱과 같은 테마여야 대비 검사가 의미 있다
        rule.enableAccessibilityChecks()

        rule.onNodeWithTag("query").performTextInput("강동")
        rule.onNodeWithTag("submit").performClick()
        rule.waitUntil(5_000) { vm.state.value.resultsRevision == 1 }
        rule.waitForIdle()

        rule.onNodeWithTag("place-k1").assertTextContains("강동역", substring = true).assertIsFocused()
        rule.onRoot().tryPerformAccessibilityChecks()
    }

    /**
     * A82: 결과가 많아 첫 결과 착지가 스크롤을 일으켜도 결과 수 통지를 낸 상태 줄은 스크롤 밖에 있어 화면에 남는다. 한소네는 화면 밖으로
     * 나간 실시간 알림 영역을 읽지 않는다(576dp 화면에서 547px 스크롤 뒤 「검색 결과 30건」이 통째로 빠졌다). 스크롤 조상 단언은 화면 크기와 무관하다.
     */
    @Test
    fun statusLineStaysOutsideScrollSoCountSurvivesLandingScroll() {
        val many = (1..30).joinToString(",") { i ->
            """{"id":"k$i","name":"장소$i","category":"여행 > 관광,명소","address":"서울 종로구","roadAddress":"서울 종로구 가나로 $i","lat":37.5,"lng":127.1}"""
        }
        val manyPlaces = """{"places":[$many],"provider":"kakao-local","query":"장소"}"""
        val vm = SearchViewModel(
            SearchService(stubbedClient { url -> if (pathOf(url) == "/api/places") HttpResponse(200, manyPlaces) else HttpResponse(200, emptyAddr) }),
            RecentSearchStore(InMemoryKeyValueStore()),
            { "ko" },
            searchStrings { rule.activity.resources },
            SavedStateHandle(),
        )
        rule.setContent { MaterialTheme { SearchScreen(vm) } }

        rule.onNodeWithTag("query").performTextInput("장소")
        rule.onNodeWithTag("submit").performClick()
        rule.waitUntil(5_000) { vm.state.value.resultsRevision == 1 }
        rule.waitForIdle()

        rule.onNodeWithTag("place-k1").assertIsFocused()
        rule.onNodeWithTag("status")
            .assertTextEquals(searchStrings { rule.activity.resources }.count(30))
            .assert(!hasAnyAncestor(hasScrollAction()))
            .assertIsDisplayed()
    }
}
