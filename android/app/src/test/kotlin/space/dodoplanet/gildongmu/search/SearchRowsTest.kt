package space.dodoplanet.gildongmu.search

import space.dodoplanet.gildongmu.kit.models.Place
import kotlin.test.Test
import kotlin.test.assertEquals

class SearchRowsTest {
    @Test fun `보조 줄은 분류·주소·거리 순이고 거리는 좌표 가중 검색에서만`() {
        val place = Place(id = "k1", name = "강동역", category = "교통,수송 > 지하철", address = "서울 강동구 천호동", roadAddress = "서울 강동구 천호대로", lat = 0.0, lng = 0.0, distanceMeters = 120.0)
        assertEquals("교통,수송 > 지하철, 서울 강동구 천호대로, 약 120m", placeSecondaryLine(place, "ko") { "약 $it" })
        assertEquals("교통,수송 > 지하철, 서울 강동구 천호동", placeSecondaryLine(place.copy(roadAddress = "", distanceMeters = null), "ko") { "약 $it" })
    }
}
