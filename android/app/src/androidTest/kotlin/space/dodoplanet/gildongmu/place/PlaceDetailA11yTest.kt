package space.dodoplanet.gildongmu.place

import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertTextContains
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
import space.dodoplanet.gildongmu.directions.DirectionsPrefill
import space.dodoplanet.gildongmu.directions.DirectionsPrefillRole
import space.dodoplanet.gildongmu.kit.HttpResponse
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
        val factory = placeDetailFactory(place, PlaceHoursService(stubbedClient { HttpResponse(404, "") }), placeStrings(rule.activity.applicationContext))
        val prefills = mutableListOf<DirectionsPrefill>()
        rule.setContent { MaterialTheme { PlaceDetailScreen(factory, PlaceNav({}, { _, _ -> }, prefills::add), takeReturnFocus = { null }) } }
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
}
