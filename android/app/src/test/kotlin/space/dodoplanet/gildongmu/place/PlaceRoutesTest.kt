package space.dodoplanet.gildongmu.place

import space.dodoplanet.gildongmu.kit.models.CultureEvent
import space.dodoplanet.gildongmu.kit.models.NightClinic
import space.dodoplanet.gildongmu.kit.models.Place
import space.dodoplanet.gildongmu.kit.nightClinicToPlace
import space.dodoplanet.gildongmu.kit.models.TransitLegStop
import space.dodoplanet.gildongmu.kit.transitStopPlace
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class PlaceRoutesTest {
    @Test fun `Place는 JSON 라우트 인자로 왕복된다(옵션 null 포함)`() {
        val place = Place(id = "kakao-1", name = "강남역", nameRoman = "Gangnam", category = "교통", categoryEn = null, address = "서울", roadAddress = "", englishAddress = null, lat = 37.5, lng = 127.0, phone = null, link = "http://x", distanceMeters = 120.0)
        assertEquals(place, PlaceDetailRoute.of(place).place)
        val bare = Place(id = "n-1", name = "이름", category = "", address = "", roadAddress = "", lat = 1.0, lng = 2.0)
        assertEquals(bare, PlaceDetailRoute.of(bare).place)
    }

    @Test fun `도메인 섹션 인자는 JSON으로 왕복한다(재생성 뒤에도 남는다, spec 판정 26)`() {
        val clinic = NightClinic("c1", "달빛의원", null, "서울", "02", "의원", "", "1번 출구", 37.5, 127.1, 100, emptyList(), NightClinic.OpenStatus("open", 900, 2400), designated = true)
        val route = PlaceDetailRoute.of(nightClinicToPlace(clinic), PlaceDomain.Clinic(clinic))
        assertEquals(PlaceDomain.Clinic(clinic), route.domain)
        val event = CultureEvent(id = "e1", title = "t", category = "c", place = "p", district = "d", dateText = "date", timeText = "time", isFree = true, target = "all", lat = 37.5, lng = 127.1, distanceMeters = 100)
        assertEquals(PlaceDomain.Event(event), PlaceDetailRoute.of(nightClinicToPlace(clinic), PlaceDomain.Event(event)).domain)
        assertNull(PlaceDetailRoute.of(nightClinicToPlace(clinic)).domain)
    }

    @Test fun `경유역 노선 힌트는 라우트로 나르고 기본은 없음이다`() {
        val stop = transitStopPlace(TransitLegStop(name = "천호", stationId = "2545", lat = 37.5387, lng = 127.1234))
        assertEquals("수도권 5호선", PlaceDetailRoute.of(stop, stationLineHint = "수도권 5호선").stationLineHint)
        assertNull(PlaceDetailRoute.of(stop).stationLineHint)
    }
}
