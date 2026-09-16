package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.WhereAmIResponse
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class WhereAmIModelsTest {
    @Test fun whereAmIFixtureDecodes() {
        val data = assertNotNull(Fixtures.kitJson("where-am-i.json", WhereAmIResponse.serializer()).data)
        assertEquals("서울특별시 강동구 길동", data.region)
        assertEquals("서울 강동구 길동 247", data.address?.jibun)
        assertNull(data.address?.road)
        assertEquals("길동", data.nearestStation?.name)
        assertEquals("5호선", data.nearestStation?.line)
        assertEquals("n", data.nearestStation?.bearing)
        assertEquals(336, data.nearestStation?.distanceMeters)
        assertEquals(12, data.landmarks.size)
    }
}
