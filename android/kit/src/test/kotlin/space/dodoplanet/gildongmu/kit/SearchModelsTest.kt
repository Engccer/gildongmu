package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.AddressSearchResponse
import space.dodoplanet.gildongmu.kit.models.Place
import space.dodoplanet.gildongmu.kit.models.PlaceSearchResult
import space.dodoplanet.gildongmu.kit.models.WebSearchResponse
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SearchModelsTest {
    @Test fun placeDecodesMinimalJSON() {
        val place = KitJson.decodeFromString(Place.serializer(), """{"id":"k1","name":"강남역","category":"교통","address":"a","roadAddress":"r","lat":37.49,"lng":127.02}""")
        assertEquals("강남역", place.name)
        assertNull(place.englishAddress)
    }

    @Test fun placesFixtureDecodes() {
        val result = Fixtures.kitJson("places.json", PlaceSearchResult.serializer())
        assertTrue(result.places.isNotEmpty())
        assertEquals("강남역", result.query)
    }

    @Test fun addressFixtureDecodes() {
        val result = Fixtures.kitJson("address.json", AddressSearchResponse.serializer())
        assertTrue(result.addresses.isNotEmpty())
        assertEquals(5, result.addresses[0].zipNo.length)
    }

    @Test fun webFixtureDecodes() {
        val result = Fixtures.kitJson("web.json", WebSearchResponse.serializer())
        assertTrue(result.web.all { it.url.isNotEmpty() })
    }
}
