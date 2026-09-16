package space.dodoplanet.gildongmu.chat

import space.dodoplanet.gildongmu.kit.models.AddressMatch
import space.dodoplanet.gildongmu.kit.models.JusoAddress
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** 웹 `src/lib/__tests__/address-to-place.test.ts` 미러(주소 카드 → 장소 상세, spec §4-4). */
class AddressToPlaceTest {
    private val addr = JusoAddress(
        roadAddr = "서울특별시 중구 세종대로 110 (태평로1가)",
        roadAddrPart1 = "서울특별시 중구 세종대로 110",
        jibunAddr = "서울특별시 중구 태평로1가 31",
        engAddr = "110 Sejong-daero, Jung-gu, Seoul",
        zipNo = "04524",
        bdNm = "서울특별시청",
    )

    private fun match(lat: Double, lng: Double) = AddressMatch(addressName = "", lat = lat, lng = lng)

    @Test fun `도로명·지번·좌표를 Place로 합성한다`() {
        val p = jusoAddressToPlace(addr, match(37.5663, 126.9779), "ko")
        assertEquals("서울특별시 중구 세종대로 110", p.roadAddress)
        assertEquals("서울특별시 중구 태평로1가 31", p.address)
        assertEquals(37.5663, p.lat, 1e-4)
        assertEquals(126.9779, p.lng, 1e-4)
        assertEquals("juso-${addr.roadAddr}", p.id)
        assertEquals("", p.category)
    }

    @Test fun `건물명이 있으면 이름으로 쓴다`() {
        assertEquals("서울특별시청", jusoAddressToPlace(addr, match(37.5, 127.0), "ko").name)
    }

    @Test fun `건물명이 없으면 도로명을 이름으로 쓴다`() {
        assertEquals("서울특별시 중구 세종대로 110", jusoAddressToPlace(addr.copy(bdNm = ""), match(37.5, 127.0), "ko").name)
    }

    @Test fun `ko에서는 영문 주소를 채우지 않는다`() {
        assertNull(jusoAddressToPlace(addr, match(37.5, 127.0), "ko").englishAddress)
    }

    @Test fun `en에서는 공식 영문 주소를 채운다`() {
        assertEquals("110 Sejong-daero, Jung-gu, Seoul", jusoAddressToPlace(addr, match(37.5, 127.0), "en").englishAddress)
    }

    @Test fun `roadAddrPart1이 비면 roadAddr로 폴백한다`() {
        assertEquals("서울특별시 중구 세종대로 110 (태평로1가)", jusoAddressToPlace(addr.copy(roadAddrPart1 = ""), match(37.5, 127.0), "ko").roadAddress)
    }
}
