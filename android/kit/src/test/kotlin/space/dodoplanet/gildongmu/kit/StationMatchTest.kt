package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.Place
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** `isStation` 판정 — Kit `StationModelsTests.isStationJudgesCategoryAndNameSuffix`(foundation.json 유예분) 미러. */
class StationMatchTest {
    private fun place(name: String, category: String) = Place(
        id = "t", name = name, category = category, address = "", roadAddress = "",
        englishAddress = null, lat = 37.5, lng = 127.1, phone = null, link = null, distanceMeters = null,
    )

    @Test fun isStationJudgesCategoryAndNameSuffix() {
        // 카테고리 "지하철" → 역
        assertTrue(isStation(place("강동역 5호선", "교통,수송 > 지하철,전철 > 수도권5호선")))
        // "Stationery"(문구)를 역으로 오판하지 않음("Station"은 카테고리 판정에서 제외)
        assertFalse(isStation(place("문구점 Stationery", "가정,생활 > 문구,사무용품 Stationery")))
        // 이름이 "역"으로 끝나면 카테고리 없이도 역
        assertTrue(isStation(place("서울역", "")))
    }

    /** 대소문자 무시는 카테고리 키워드와 이름 접미사 둘 다(웹 `/station$/i`·`STATION_CATEGORY` 동형). */
    @Test fun caseInsensitiveOnBothAxes() {
        assertTrue(isStation(place("Gangnam", "Transportation > SUBWAY")))
        assertTrue(isStation(place(" Seoul STATION ", "")))
        assertFalse(isStation(place("Stationery", "")))
    }
}
