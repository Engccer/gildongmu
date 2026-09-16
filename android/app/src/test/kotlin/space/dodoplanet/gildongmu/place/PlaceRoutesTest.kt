package space.dodoplanet.gildongmu.place

import space.dodoplanet.gildongmu.kit.models.Place
import kotlin.test.Test
import kotlin.test.assertEquals

class PlaceRoutesTest {
    @Test fun `Place는 JSON 라우트 인자로 왕복된다(옵션 null 포함)`() {
        val place = Place(id = "kakao-1", name = "강남역", nameRoman = "Gangnam", category = "교통", categoryEn = null, address = "서울", roadAddress = "", englishAddress = null, lat = 37.5, lng = 127.0, phone = null, link = "http://x", distanceMeters = 120.0)
        assertEquals(place, PlaceDetailRoute.of(place).place)
        val bare = Place(id = "n-1", name = "이름", category = "", address = "", roadAddress = "", lat = 1.0, lng = 2.0)
        assertEquals(bare, PlaceDetailRoute.of(bare).place)
    }
}
