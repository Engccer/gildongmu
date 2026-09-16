package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.SurroundingsSceneResponse
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class SurroundingsSceneModelsTest {
    /** 장면 항목의 `roadRoman`(E28 후속)은 additive — 없으면 null, 있으면 읽는다. */
    @Test fun surroundingsSceneItemRoadRomanDecodesOptionally() {
        val json = """{"data":{"place":null,"frame":"entrance","total":2,"groups":[{"bucket":"left","items":[
          {"name":"봉래면옥","distanceMeters":62,"road":"명일로","roadRoman":"Myeongil-ro","category":"restaurant","id":"k1","lat":37.54,"lng":127.15,"categoryRaw":"","roadAddress":null},
          {"name":"카페만월경","distanceMeters":58,"road":null,"category":"cafe","id":"k2","lat":37.54,"lng":127.15,"categoryRaw":"","roadAddress":null}]}]}}"""
        val scene = assertNotNull(KitJson.decodeFromString(SurroundingsSceneResponse.serializer(), json).data)
        assertEquals("Myeongil-ro", scene.groups[0].items[0].roadRoman)
        assertNull(scene.groups[0].items[1].road)
        assertNull(scene.groups[0].items[1].roadRoman)
    }
}
