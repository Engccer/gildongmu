package space.dodoplanet.gildongmu.directions

import space.dodoplanet.gildongmu.kit.DirectionsEndpoint
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull

/** spec §7 필드 저장 미러 — 왕복과 깨진 값의 null. */
class EndpointJsonTest {
    @Test fun `현재 위치 왕복`() {
        assertEquals(DirectionsEndpoint.Current, endpointFromJson(DirectionsEndpoint.Current.toJson()))
    }

    @Test fun `장소 왕복 - 로마자 없으면 키가 빠진다`() {
        val place = DirectionsEndpoint.Place("강남역", 37.49, 127.02)
        val json = place.toJson()
        assertFalse(json.contains("labelRoman"))
        assertEquals(place, endpointFromJson(json))
        val roman = DirectionsEndpoint.Place("강남역", 37.49, 127.02, "Gangnam Station")
        assertEquals(roman, endpointFromJson(roman.toJson()))
    }

    @Test fun `부재·깨진 값은 null`() {
        assertNull(endpointFromJson(null))
        assertNull(endpointFromJson(""))
        assertNull(endpointFromJson("{not json"))
        assertNull(endpointFromJson("""{"type":"unknown"}"""))
    }
}
