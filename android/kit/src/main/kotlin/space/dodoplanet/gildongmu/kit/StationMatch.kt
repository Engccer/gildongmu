package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.Place

// 장소가 철도/지하철 역인지 판정한다. Kit `StationMatch.swift` 미러(웹 `station-match.ts`의 `isStation`만).
// 역명 매칭은 서버 몫이라 웹의 확장 정규화(`stripStationDecorations`·`lineHint`)는 Kit처럼 미러하지 않는다.

/**
 * "Station"은 카테고리에서 제외한다. "Stationery"(문구) 등을 역으로 오판하기 때문. 영문 역 판정은
 * 이름 접미사(station$, 대소문자 무시)에만 맡긴다. 문자 클래스가 없어 `[` 이스케이프 함정은 없다.
 */
private val STATION_CATEGORY = Regex("지하철|전철|철도|기차|Subway|Metro|Railway|Train", RegexOption.IGNORE_CASE)

/** 장소가 철도/지하철 역인지: 카테고리 키워드 또는 이름 접미사("역"/"station")로 판정. */
fun isStation(place: Place): Boolean {
    if (STATION_CATEGORY.containsMatchIn(place.category)) return true
    val name = place.name.trim()
    return name.endsWith("역") || name.lowercase().endsWith("station")
}
