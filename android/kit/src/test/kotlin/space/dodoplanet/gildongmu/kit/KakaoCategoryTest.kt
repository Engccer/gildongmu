package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable
import space.dodoplanet.gildongmu.kit.models.KidsPlace
import space.dodoplanet.gildongmu.kit.models.Place
import space.dodoplanet.gildongmu.kit.models.SurroundingPlace
import space.dodoplanet.gildongmu.kit.models.SurroundingsSceneItem
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * 웹 `kakao-category.test.ts`·Kit `KakaoCategoryTests`와 같은 fixture — `pickCategory` 규칙이 한 벌임을 강제(A28).
 * 투영 3종(`kidsPlaceToPlace` 등)의 `categoryEn` 전달 검사는 `PlaceProjectionTest`.
 */
class KakaoCategoryTest {
    @Serializable
    private data class PickCaseFile(val cases: List<PickCase>) {
        @Serializable
        data class PickCase(val id: String, val locale: String, val category: String, val categoryEn: String? = null, val expected: String)
    }

    @Test fun matchesSharedFixture() {
        val cases = Fixtures.sharedJson("kakao-category-pick-cases.json", PickCaseFile.serializer()).cases
        assertTrue(cases.size >= 6)
        for (c in cases) assertEquals(c.expected, pickCategory(c.locale, c.category, c.categoryEn), c.id)
    }

    /** 구버전 서버 응답(필드 부재)과 신버전(필드 있음) 둘 다 디코딩된다 — 4모델 전부. */
    @Test fun modelsDecodeWithAndWithoutCategoryEn() {
        val placeNew = """{"id":"kakao-1","name":"신명중학교","category":"교육,학문 > 학교 > 중학교","categoryEn":"Education & Academia > School > Middle School","address":"","roadAddress":"","englishAddress":null,"lat":37.5,"lng":127.1,"phone":null,"link":null,"distanceMeters":null}"""
        val placeOld = """{"id":"kakao-1","name":"신명중학교","category":"교육,학문 > 학교 > 중학교","address":"","roadAddress":"","englishAddress":null,"lat":37.5,"lng":127.1,"phone":null,"link":null,"distanceMeters":null}"""
        assertEquals("Education & Academia > School > Middle School", KitJson.decodeFromString(Place.serializer(), placeNew).categoryEn)
        assertNull(KitJson.decodeFromString(Place.serializer(), placeOld).categoryEn)

        val kidsNew = """{"id":"kakao-2","name":"키즈카페","category":"가정,생활 > 유아 > 놀이시설 > 키즈카페","categoryEn":"Home & Living > Kids > Play Facility > Kids Cafe","kind":"kidscafe","indoorOutdoor":"indoor","distanceMeters":120,"address":"지번","roadAddress":null,"lat":37.5,"lng":127.1,"phone":null,"link":null}"""
        val kidsOld = """{"id":"kakao-2","name":"키즈카페","category":"가정,생활 > 유아 > 놀이시설 > 키즈카페","kind":"kidscafe","indoorOutdoor":"indoor","distanceMeters":120,"address":"지번","roadAddress":null,"lat":37.5,"lng":127.1,"phone":null,"link":null}"""
        assertTrue(KitJson.decodeFromString(KidsPlace.serializer(), kidsNew).categoryEn!!.startsWith("Home & Living"))
        assertNull(KitJson.decodeFromString(KidsPlace.serializer(), kidsOld).categoryEn)

        val aroundNew = """{"id":"kakao-3","name":"강동역 3번출구","category":"subway","categoryRaw":"교통,수송 > 지하철,전철 > 수도권5호선","categoryEn":"Transportation > Subway > Line 5","distanceMeters":30,"bearing":"n","lat":37.5,"lng":127.1,"phone":null,"link":null}"""
        val aroundOld = """{"id":"kakao-3","name":"강동역 3번출구","category":"subway","categoryRaw":"교통,수송 > 지하철,전철 > 수도권5호선","distanceMeters":30,"bearing":"n","lat":37.5,"lng":127.1,"phone":null,"link":null}"""
        assertEquals("Transportation > Subway > Line 5", KitJson.decodeFromString(SurroundingPlace.serializer(), aroundNew).categoryEn)
        assertNull(KitJson.decodeFromString(SurroundingPlace.serializer(), aroundOld).categoryEn)

        val sceneNew = """{"name":"CU","nameRoman":null,"distanceMeters":40,"road":null,"category":"convenience","id":"kakao-4","lat":37.5,"lng":127.1,"categoryRaw":"가정,생활 > 편의점 > CU","categoryEn":"Home & Living > Convenience Store > CU","roadAddress":null,"phone":null,"link":null}"""
        val sceneOld = """{"name":"CU","nameRoman":null,"distanceMeters":40,"road":null,"category":"convenience","id":"kakao-4","lat":37.5,"lng":127.1,"categoryRaw":"가정,생활 > 편의점 > CU","roadAddress":null,"phone":null,"link":null}"""
        assertEquals("Home & Living > Convenience Store > CU", KitJson.decodeFromString(SurroundingsSceneItem.serializer(), sceneNew).categoryEn)
        assertNull(KitJson.decodeFromString(SurroundingsSceneItem.serializer(), sceneOld).categoryEn)
    }
}
