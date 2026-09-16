package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.AroundNearbyResponse
import space.dodoplanet.gildongmu.kit.models.BikeNearbyResponse
import space.dodoplanet.gildongmu.kit.models.BikeStation
import space.dodoplanet.gildongmu.kit.models.BusNearbyResponse
import space.dodoplanet.gildongmu.kit.models.BusRouteStop
import space.dodoplanet.gildongmu.kit.models.BusRouteStopsResponse
import space.dodoplanet.gildongmu.kit.models.BusStop
import space.dodoplanet.gildongmu.kit.models.ClinicNearbyResponse
import space.dodoplanet.gildongmu.kit.models.CultureEvent
import space.dodoplanet.gildongmu.kit.models.EventsNearbyResponse
import space.dodoplanet.gildongmu.kit.models.KidsNearbyResponse
import space.dodoplanet.gildongmu.kit.models.KidsPlace
import space.dodoplanet.gildongmu.kit.models.NearbyOverview
import space.dodoplanet.gildongmu.kit.models.NearbyOverviewResponse
import space.dodoplanet.gildongmu.kit.models.SubwayNearbyResponse
import space.dodoplanet.gildongmu.kit.models.SubwayNearbyResult
import space.dodoplanet.gildongmu.kit.models.SurroundingPlace
import space.dodoplanet.gildongmu.kit.models.SurroundingsScene
import space.dodoplanet.gildongmu.kit.models.SurroundingsSceneResponse

/**
 * 옵트인 확장 요청 — 라우트 기본 상한(around=12·kids=8)은 limit 미지정 소비자(CLI/MCP)용, "더 보기" 재료는
 * 이 앱이 limit으로 명시 확보한다(웹 FETCH_LIMIT 미러).
 */
private const val fetchLimit = 50

/**
 * 내 주변 조회. Kit `NearbyService.swift` 미러. 전 라우트 `GET ?lat=&lng=` 균일 계약(M2 plan).
 * 실패는 throw(`APIError`) — 3-state(권한 거부/조회 실패/0건) 매핑은 화면 모델 몫.
 */
class NearbyService(val client: APIClient) {
    /** `lang`(E27) — en이면 노선·도착 영문 필드를 additive로 받는다(비-ko만 파라미터, 기본값 없음). */
    suspend fun subwayArrivals(lat: Double, lng: Double, lang: String): SubwayNearbyResult {
        val query = coordQuery(lat, lng).toMutableList()
        if (lang != "ko") query.add("lang" to lang)
        val response = client.get<SubwayNearbyResponse>("/api/station/subway-arrival/nearby", query)
        return SubwayNearbyResult(response.stations, response.nearest)
    }

    suspend fun busStops(lat: Double, lng: Double): List<BusStop> =
        client.get<BusNearbyResponse>("/api/bus/nearby", coordQuery(lat, lng)).stops

    suspend fun bikeStations(lat: Double, lng: Double): List<BikeStation> =
        client.get<BikeNearbyResponse>("/api/bike/nearby", coordQuery(lat, lng)).stations

    /** 응답 전체를 넘긴다 — 절단(total)·소스 구분·보완 실패를 화면이 밝혀야 한다. */
    suspend fun clinics(lat: Double, lng: Double): ClinicNearbyResponse =
        client.get("/api/clinic/nearby", coordQuery(lat, lng))

    suspend fun kidsPlaces(lat: Double, lng: Double): List<KidsPlace> =
        client.get<KidsNearbyResponse>("/api/places/kids", coordQuery(lat, lng) + ("limit" to fetchLimit.toString())).kids

    suspend fun surroundings(lat: Double, lng: Double): List<SurroundingPlace> =
        client.get<AroundNearbyResponse>("/api/places/around", coordQuery(lat, lng) + ("limit" to fetchLimit.toString())).places

    /** 오늘 진행 중인 근처 문화행사(서울). 라우트 기본 상한은 12라 "더 보기" 재료를 limit으로 명시 확보한다(kids·around 동형). */
    suspend fun cultureEvents(lat: Double, lng: Double): List<CultureEvent> =
        client.get<EventsNearbyResponse>("/api/events/nearby", coordQuery(lat, lng) + ("limit" to fetchLimit.toString())).events

    /** M4 한눈에 보기 — 공통 반경 1km 집계. null = data:null(전 키 부재, 구성 결함). */
    suspend fun nearbyOverview(lat: Double, lng: Double): NearbyOverview? =
        client.get<NearbyOverviewResponse>("/api/nearby/overview", coordQuery(lat, lng)).data

    /**
     * M1 부근 상황 재구성(요청형). 앵커 좌표 하나를 받아 입구 기준 좌우 묶음을 준다.
     * null = data:null(서버 키 미보유) — 소비자가 오류로 태운다(웹 parse 미러, 3-state).
     */
    suspend fun surroundingsScene(lat: Double, lng: Double): SurroundingsScene? =
        client.get<SurroundingsSceneResponse>("/api/surroundings/scene", coordQuery(lat, lng)).data

    /** 노선 경유정류소(lazy 펼치기). cityCode는 source=="tago"일 때만 쿼리에 포함(웹 BusRouteStops.tsx 미러). */
    suspend fun busRouteStops(source: String, cityCode: String?, routeId: String): List<BusRouteStop> {
        val query = arrayListOf("source" to source, "routeId" to routeId)
        if (source == "tago" && cityCode != null) query.add("cityCode" to cityCode)
        return client.get<BusRouteStopsResponse>("/api/bus/route", query).stops
    }
}
