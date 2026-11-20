package space.dodoplanet.gildongmu.place

import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.kit.Fixtures
import space.dodoplanet.gildongmu.kit.models.JusoAddress
import space.dodoplanet.gildongmu.kit.models.Place
import space.dodoplanet.gildongmu.nearby.subwayStationSpokenName
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * B21 장소 줄 작업 메뉴(iOS E60·E72): 순서는 전화 → 여기까지 길찾기 → 주소 복사 → 물어보기, 보유한 데이터만. 주소 결과 줄은 복사 셋
 * (도로명 → 지번 → 영문). Compose는 JVM 레인이 없어 순서·존재는 순수 함수로, 배선은 소스로 잠근다.
 */
class PlaceRowActionsTest {
    private fun place(phone: String? = "02-000-0000", road: String = "서울 중구 세종대로 110") =
        Place(id = "1", name = "서울시청", category = "공공기관", address = "서울 중구 태평로1가 31", roadAddress = road, lat = 37.5, lng = 127.0, phone = phone)

    @Test fun `전부 있으면 전화 → 길찾기 → 주소 복사 → 물어보기`() {
        assertEquals(
            listOf(PlaceRowAction.call, PlaceRowAction.directions, PlaceRowAction.copyAddress, PlaceRowAction.askAbout),
            placeRowActionKinds(place(), canDirections = true, canAsk = true),
        )
    }

    @Test fun `빈 전화·빈 도로명·물어보기 없음·길찾기 없음은 그 동작만 빠진다`() {
        assertEquals(listOf(PlaceRowAction.directions, PlaceRowAction.copyAddress), placeRowActionKinds(place(phone = ""), canDirections = true, canAsk = false))
        assertEquals(listOf(PlaceRowAction.call, PlaceRowAction.directions), placeRowActionKinds(place(road = ""), canDirections = true, canAsk = false))
        assertEquals(listOf(PlaceRowAction.call, PlaceRowAction.copyAddress, PlaceRowAction.askAbout), placeRowActionKinds(place(), canDirections = false, canAsk = true))
    }

    @Test fun `주소 결과 줄 복사는 도로명 → 지번 → 영문, 빈 값은 뺀다`() {
        val full = JusoAddress("서울 중구 세종대로 110", "서울 중구 세종대로 110", "서울 중구 태평로1가 31", "110 Sejong-daero", "04524", "")
        assertEquals(
            listOf(R.string.place_copyRoadAddress, R.string.place_copyJibunAddress, R.string.place_copyEnglishAddress),
            addressCopyItems(full).map { it.first },
        )
        assertEquals(listOf("서울 중구 세종대로 110", "110 Sejong-daero"), addressCopyItems(full.copy(jibunAddr = "")).map { it.second })
    }

    @Test fun `역 이름 라벨은 헤딩과 같은 언어 — 노선 영문이 모자라면 한국어`() {
        assertEquals("City Hall", subwayStationSpokenName(true, "en", "시청", "City Hall", listOf("1호선"), listOf("Line 1")))
        assertEquals("시청", subwayStationSpokenName(true, "en", "시청", "City Hall", listOf("1호선"), null))
        assertEquals("시청", subwayStationSpokenName(false, "ko", "시청", "City Hall", listOf("1호선"), listOf("Line 1")))
    }

    @Test fun `배선 — 장소 줄 자리마다 묶음을 달고 채팅 카드는 물어보기가 없다`() {
        val pkg = Fixtures.repoRoot.resolve("android/app/src/main/kotlin/space/dodoplanet/gildongmu")
        fun read(rel: String) = pkg.resolve(rel).readText()
        assertTrue(read("search/SearchScreen.kt").contains("actions = placeRowActions(place, onAskPlace?.let"))
        assertTrue(read("chat/ChatRenders.kt").contains("actions = placeRowActions(place, onAskAbout = null)"))
        assertTrue(read("nearby/PlaceListBodies.kt").contains("placeRowActions(p, rowNav?.let"))
        assertTrue(read("nearby/NearbyKindScreen.kt").contains("if (askAbout != null) placeRowActions(place)"))
        assertTrue(read("nearby/SceneSection.kt").contains("if (onAskAbout != null) placeRowActions(place)"))
        // 안내 시트 「주변 확인」은 줄 동작이 없다(시트 위 길찾기 진입은 안내를 덮는다).
        assertTrue(read("nearby/SceneSection.kt").contains("showPlace = true, requesterFor, bringFor, onAskAbout = null"))
        // 주소 결과 줄(검색·채팅 공용)은 행이 스스로 복사 셋을 단다.
        assertTrue(read("search/SearchRows.kt").contains("val actions = addressCopyActions(address)"))
    }
}
