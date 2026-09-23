package space.dodoplanet.gildongmu.place

import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.junit4.accessibility.enableAccessibilityChecks
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.tryPerformAccessibilityChecks
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import kotlinx.coroutines.MainScope
import space.dodoplanet.gildongmu.kit.StationPhoneService
import space.dodoplanet.gildongmu.kit.models.TransitLegStop
import space.dodoplanet.gildongmu.kit.transitStopPlace
import space.dodoplanet.gildongmu.directions.DirectionsPrefill
import space.dodoplanet.gildongmu.directions.DirectionsPrefillRole
import space.dodoplanet.gildongmu.kit.BarrierFreeService
import space.dodoplanet.gildongmu.DeviceFixtures
import space.dodoplanet.gildongmu.kit.HttpResponse
import space.dodoplanet.gildongmu.kit.StationService
import space.dodoplanet.gildongmu.kit.pathOf
import space.dodoplanet.gildongmu.kit.PlaceHoursService
import space.dodoplanet.gildongmu.kit.models.Place
import space.dodoplanet.gildongmu.kit.stubbedClient

/** 실기기 검사 레인(spec §8): 상세 화면 ATF + 제목 착지 + 주소 줄 병합 + 복사 통지. */
@RunWith(AndroidJUnit4::class)
class PlaceDetailA11yTest {
    @get:Rule
    val rule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun detailLinesAreSingleNodesAndTitleLands() {
        val place = Place(id = "kakao-1", name = "강동역", category = "교통,수송 > 지하철", address = "서울 강동구 천호동 1", roadAddress = "서울 강동구 천호대로 1", lat = 37.535, lng = 127.132, phone = "02-000-0000")
        val down = stubbedClient { HttpResponse(404, "") }
        val factory = placeDetailFactory(place, PlaceHoursService(down), placeStrings { rule.activity.resources }, StationService(down), BarrierFreeService(down)) { "ko" }
        val prefills = mutableListOf<DirectionsPrefill>()
        rule.setContent { MaterialTheme { PlaceDetailScreen(factory, PlaceNav({}, { _, _ -> }, prefills::add, {}), takeReturnFocus = { null }, stationLineHint = null) } }
        rule.enableAccessibilityChecks()
        rule.waitForIdle()
        rule.onNodeWithTag("title").assertTextContains("강동역").assertIsFocused()
        rule.onNodeWithTag("address-road").assertTextContains("천호대로", substring = true)
        rule.onNodeWithTag("copy-road").performClick()
        rule.onNodeWithTag("status").assertTextContains("복사", substring = true)
        // 길찾기 프리필 2버튼(M3 계약): 별개 객체, 역할만 다르고 끝점은 같은 장소.
        rule.onNodeWithTag("directionsTo").assertTextContains("여기까지", substring = true).performClick()
        rule.onNodeWithTag("directionsFrom").assertTextContains("여기부터", substring = true).performClick()
        assertEquals(listOf(DirectionsPrefillRole.to, DirectionsPrefillRole.from), prefills.map { it.role })
        assertEquals(DirectionsPrefill(DirectionsPrefillRole.to, "강동역", 37.535, 127.132, null), prefills[0])
        rule.onRoot().tryPerformAccessibilityChecks()
    }

    /** spec §12-5: 역이면 자동 섹션이 조용히 나타난다 — 헤딩이 발견 경로, 통지 텍스트 없음. */
    @Test
    fun stationSectionsAppearQuietly() {
        val place = Place(id = "kakao-2", name = "강남역", category = "교통,수송 > 지하철", address = "서울 강남구", roadAddress = "서울 강남구 강남대로 396", lat = 37.498, lng = 127.028)
        val station = StationService(stubbedClient { url ->
            when (pathOf(url)) {
                "/api/station/meta" -> HttpResponse(200, DeviceFixtures.kit("station-meta.json"))
                "/api/station/subway-arrival" -> HttpResponse(200, DeviceFixtures.kit("station-arrival.json"))
                "/api/station/timetable" -> HttpResponse(500, "")
                else -> HttpResponse(500, "")
            }
        })
        val factory = placeDetailFactory(place, PlaceHoursService(stubbedClient { HttpResponse(404, "") }), placeStrings { rule.activity.resources }, station, BarrierFreeService(stubbedClient { HttpResponse(500, "") })) { "ko" }
        rule.setContent { MaterialTheme { PlaceDetailScreen(factory, PlaceNav({}, { _, _ -> }, {}, {}), takeReturnFocus = { null }, stationLineHint = null) } }
        rule.enableAccessibilityChecks()
        rule.waitUntil(5_000) { rule.onAllNodesWithTag("station-meta").fetchSemanticsNodes().isNotEmpty() }
        rule.waitForIdle()
        rule.onNodeWithTag("station-meta").assertExists()
        rule.onNodeWithTag("station-arrivals").assertExists()
        rule.onNodeWithTag("timetable-error").assertExists() // 시간표만 실패를 문장으로(3-state)
        rule.onNodeWithTag("status").assertTextEquals("")
        rule.onNodeWithTag("title").assertIsFocused() // 착지는 제목 그대로 — 자동 섹션은 포커스를 옮기지 않는다
        rule.onRoot().tryPerformAccessibilityChecks()
    }

    /**
     * E44 역 레이아웃(spec §3.2·§4·§5.5): 역 정보 제목이 서고 전화 줄(대표번호 표기)이 그 바로 아래, 서울 지하철 시설은 종류 행만 접힌 채
     * 나오며 펼치면 시설 줄이 나온다, "이 장소 주변"은 최하단이고 지하철 도착 행이 없다.
     */
    @Test
    fun stationLayoutPutsPhoneFirstFoldsFacilitiesAndDropsSubwayAnchor() {
        val place = Place(id = "kakao-4", name = "강동역 5호선", category = "교통,수송 > 지하철,전철 > 수도권5호선", address = "서울 강동구", roadAddress = "서울 강동구 천호대로 1", lat = 37.535, lng = 127.132, phone = "1544-7788")
        val station = StationService(stubbedClient { url ->
            when (pathOf(url)) {
                "/api/station/metro-facilities" -> HttpResponse(200, DeviceFixtures.kit("station-metro-facilities.json"))
                else -> HttpResponse(500, "")
            }
        })
        val factory = placeDetailFactory(place, PlaceHoursService(stubbedClient { HttpResponse(404, "") }), placeStrings { rule.activity.resources }, station, BarrierFreeService(stubbedClient { HttpResponse(500, "") })) { "ko" }
        rule.setContent { MaterialTheme { PlaceDetailScreen(factory, PlaceNav({}, { _, _ -> }, {}, {}), takeReturnFocus = { null }, stationLineHint = null) } }
        rule.enableAccessibilityChecks()
        rule.waitUntil(5_000) { rule.onAllNodesWithTag("metro-0").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("station-info").assertExists()
        rule.onNodeWithTag("call").assertTextContains("대표번호", substring = true)
        rule.onNodeWithTag("category").assertDoesNotExist() // 지하철은 분류 줄 없음(메타 줄과 중복)
        rule.onNodeWithTag("anchor-subway").assertDoesNotExist()
        val top = { tag: String -> rule.onNodeWithTag(tag).fetchSemanticsNode().boundsInRoot.top }
        assertTrue(top("call") < top("metro-0"))
        assertTrue(top("metro-0") < top("route-heading"))
        assertTrue(top("route-heading") < top("nearby-heading"))
        rule.onNodeWithTag("metro-0-0").assertDoesNotExist() // 기본 접힘
        rule.onNodeWithTag("metro-0").performClick()
        rule.onNodeWithTag("metro-0-0").assertExists()
        rule.onRoot().tryPerformAccessibilityChecks()
    }

    /** 경유역(transit-stop)은 노선 힌트로 번호를 조회하고, 조회 실패는 없음과 가른 문장 한 줄이다(3-state, spec §5.5). */
    @Test
    fun transitStopPhoneFailureIsALine() {
        val place = transitStopPlace(TransitLegStop(name = "천호", stationId = "2545", lat = 37.5387, lng = 127.1234))
        val down = stubbedClient { HttpResponse(502, "") }
        val store = StationPhoneStore(StationPhoneService(down), MainScope()) { System.currentTimeMillis() / 1_000.0 }
        val factory = placeDetailFactory(place, PlaceHoursService(down), placeStrings { rule.activity.resources }, StationService(down), BarrierFreeService(down)) { "ko" }
        rule.setContent { MaterialTheme { PlaceDetailScreen(factory, PlaceNav({}, { _, _ -> }, {}, {}), takeReturnFocus = { null }, stationLineHint = "수도권 5호선", phoneStore = store) } }
        rule.waitUntil(5_000) { rule.onAllNodesWithTag("call-error").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("call").assertDoesNotExist()
        rule.onNodeWithTag("title").assertIsFocused() // 조용히 나타난다 — 포커스를 옮기지 않는다
    }
}
