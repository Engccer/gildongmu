package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.AirNearbyResponse
import space.dodoplanet.gildongmu.kit.models.AirQuality
import space.dodoplanet.gildongmu.kit.models.Congestion
import space.dodoplanet.gildongmu.kit.models.CongestionNearbyResponse
import space.dodoplanet.gildongmu.kit.models.SeoulMetroFacilities
import space.dodoplanet.gildongmu.kit.models.SeoulMetroFacilitiesResponse
import space.dodoplanet.gildongmu.kit.models.StationArrivalResponse
import space.dodoplanet.gildongmu.kit.models.StationArrivals
import space.dodoplanet.gildongmu.kit.models.StationFacilities
import space.dodoplanet.gildongmu.kit.models.StationFacilitiesResponse
import space.dodoplanet.gildongmu.kit.models.StationMeta
import space.dodoplanet.gildongmu.kit.models.StationMetaResponse
import space.dodoplanet.gildongmu.kit.models.StationTimetable
import space.dodoplanet.gildongmu.kit.models.StationTimetableResponse
import space.dodoplanet.gildongmu.kit.models.Weather
import space.dodoplanet.gildongmu.kit.models.WeatherNearbyResponse

/**
 * 역 상세 조회. Kit `StationService.swift` 미러. 전 라우트 `GET ?station=<place.name>` 균일 계약(매칭은 서버 몫).
 * 미커버 역은 본문 null(성공 응답), 실패는 throw(`APIError`). 화면은 둘 다 "섹션 미노출"로 동일 처리하되(자동
 * 등장 보조 정보의 graceful degrade) 도착 0건만 문장으로 노출.
 */
class StationService(val client: APIClient) {
    private fun stationQuery(station: String): List<QueryItem> = listOf("station" to station)

    /**
     * `lang`(E27) — en이면 영문 필드(`linesEn`·도착 `*En`·`lineNameEn`)를 additive로 받는다. 비-ko만 파라미터를
     * 실어 ko 요청은 종전과 같다. ⚠ 기본값 없음(`RouteService.walk` 규율).
     */
    private fun stationQuery(station: String, lang: String): List<QueryItem> =
        if (lang != "ko") stationQuery(station) + ("lang" to lang) else stationQuery(station)

    suspend fun meta(station: String, lang: String): StationMeta? =
        client.get<StationMetaResponse>("/api/station/meta", stationQuery(station, lang)).meta

    suspend fun korailFacilities(station: String): StationFacilities? =
        client.get<StationFacilitiesResponse>("/api/station/facilities", stationQuery(station)).facilities

    /** `lang=en`이면 음성유도기 `parts.lineEn`(영문 노선명)이 additive로 온다(E27 잔여). ⚠ 기본값 없음. */
    suspend fun metroFacilities(station: String, lang: String): SeoulMetroFacilities? =
        client.get<SeoulMetroFacilitiesResponse>("/api/station/metro-facilities", stationQuery(station, lang)).facilities

    suspend fun arrivals(station: String, lang: String): StationArrivals? =
        client.get<StationArrivalResponse>("/api/station/subway-arrival", stationQuery(station, lang)).arrivals

    /**
     * 첫차·막차 시간표. 미커버 역은 null(graceful), 조회 실패는 throw(시간표는 의사결정 정보라 실패를 미커버로
     * 위장하지 않는다, 스펙 §2-A).
     */
    suspend fun timetable(station: String, lang: String): StationTimetable? =
        client.get<StationTimetableResponse>("/api/station/timetable", stationQuery(station, lang)).timetable
}

/**
 * 날씨·공기질·혼잡도 조회 `GET ?lat=&lng=`. Kit `StationService.swift`의 `ConditionsService` 미러. 세 fetch는
 * 화면(모델)에서 독립 실행(한쪽 실패가 다른 쪽을 안 죽임, 웹 allSettled 미러).
 */
class ConditionsService(val client: APIClient) {
    suspend fun air(lat: Double, lng: Double): AirQuality? =
        client.get<AirNearbyResponse>("/api/air-quality/nearby", coordQuery(lat, lng)).air

    suspend fun weather(lat: Double, lng: Double): Weather? =
        client.get<WeatherNearbyResponse>("/api/weather/nearby", coordQuery(lat, lng)).weather

    /**
     * 실시간 인구 혼잡도. 본문 `area: null`은 조회 실패가 아니라 "여기는 서울 핫스팟이 아니다"라는 답이므로
     * null을 그대로 돌려준다(화면은 침묵). 실패만 throw(`APIError`).
     */
    suspend fun congestion(lat: Double, lng: Double): Congestion? =
        client.get<CongestionNearbyResponse>("/api/congestion/nearby", coordQuery(lat, lng)).area
}
