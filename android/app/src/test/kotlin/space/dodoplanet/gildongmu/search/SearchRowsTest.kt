package space.dodoplanet.gildongmu.search

import space.dodoplanet.gildongmu.kit.SearchOutcome
import space.dodoplanet.gildongmu.kit.SectionState
import space.dodoplanet.gildongmu.kit.models.JusoAddress
import space.dodoplanet.gildongmu.kit.models.Place
import kotlin.test.assertNull
import kotlin.test.Test
import kotlin.test.assertEquals

class SearchRowsTest {
    @Test fun `첫 결과 착지 키는 첫 섹션의 첫 항목`() {
        val place = Place(id = "k1", name = "강동역", category = "교통", address = "", roadAddress = "", lat = 0.0, lng = 0.0)
        val address = JusoAddress(roadAddr = "서울 강동구 천호대로 1", roadAddrPart1 = "서울 강동구 천호대로 1", jibunAddr = "", engAddr = "", zipNo = "05300", bdNm = "")
        assertEquals("place-k1", firstRowKey(SearchOutcome(SectionState.Loaded(listOf(place)), SectionState.Loaded(emptyList()), SectionState.Loaded(emptyList()))))
        assertEquals("address-서울 강동구 천호대로 1", firstRowKey(SearchOutcome(SectionState.Loaded(emptyList()), SectionState.Loaded(listOf(address)), SectionState.Loaded(emptyList()))))
        assertNull(firstRowKey(SearchOutcome(SectionState.Failed, SectionState.Failed, SectionState.Loaded(emptyList()))))
    }

    @Test fun `보조 줄은 분류·주소·거리 순이고 거리는 좌표 가중 검색에서만`() {
        val place = Place(id = "k1", name = "강동역", category = "교통,수송 > 지하철", address = "서울 강동구 천호동", roadAddress = "서울 강동구 천호대로", lat = 0.0, lng = 0.0, distanceMeters = 120.0)
        assertEquals("교통,수송 > 지하철, 서울 강동구 천호대로, 약 120m", placeSecondaryLine(place, "ko") { "약 $it" })
        assertEquals("교통,수송 > 지하철, 서울 강동구 천호동", placeSecondaryLine(place.copy(roadAddress = "", distanceMeters = null), "ko") { "약 $it" })
    }
}
