package space.dodoplanet.gildongmu.nearby

import space.dodoplanet.gildongmu.kit.models.BikeStation
import space.dodoplanet.gildongmu.kit.models.BusRouteStop
import space.dodoplanet.gildongmu.kit.models.BusStop
import space.dodoplanet.gildongmu.kit.NearbyCoverage
import space.dodoplanet.gildongmu.kit.NearbyService
import space.dodoplanet.gildongmu.kit.models.SubwayNearbyResult
import space.dodoplanet.gildongmu.kit.formatDistance

/** kind별 조립기 표(spec §5). M2b는 여기에 행을 더한다. fetch는 전부 non-null(0건 = 빈 리스트). */
object NearbyKinds {
    fun subway(service: NearbyService, strings: NearbyStrings) = NearbyKindSpec<SubwayNearbyResult>(
        coverage = NearbyCoverage.korea,
        fetch = { c -> service.subwayArrivals(c!!.lat, c.lng, strings.dataLocale()) },
        isEmpty = { it.stations.isEmpty() },
        firstKey = { it.stations.firstOrNull()?.let { s -> "station-${s.stationName}" } },
        loadedNotice = { r ->
            // 0건이면 최근접 역 거리를 실어 "1km 안에 없다"와 "이 지역엔 도시철도가 없다"를 가른다(웹 emptyNearest 미러).
            if (r.stations.isEmpty()) subwayEmptyCopy(r, strings) else strings.announceStations(r.stations.size)
        },
        emptyCopy = strings.subwayEmpty,
    )

    /** 0건 문구 — 통지와 본문이 같은 문장(최근접 역이 있으면 거리 포함). */
    fun subwayEmptyCopy(result: SubwayNearbyResult, strings: NearbyStrings): String {
        val nearest = result.nearest ?: return strings.subwayEmpty()
        return strings.subwayEmptyNearest(nearestLabel(nearest, strings.dataLocale() == "en", strings.lang()), formatDistance(nearest.distanceMeters))
    }

    fun bus(service: NearbyService, strings: NearbyStrings) = NearbyKindSpec<List<BusStop>>(
        coverage = NearbyCoverage.korea,
        fetch = { c -> service.busStops(c!!.lat, c.lng) },
        isEmpty = { it.isEmpty() },
        firstKey = { it.firstOrNull()?.let { s -> "stop-${s.nodeId}" } }, // 정류소명 중복 실존 → nodeId
        loadedNotice = { if (it.isEmpty()) strings.busEmpty() else strings.announceStops(it.size) },
        emptyCopy = strings.busEmpty,
    )

    fun bike(service: NearbyService, strings: NearbyStrings) = NearbyKindSpec<List<BikeStation>>(
        coverage = NearbyCoverage.korea,
        fetch = { c -> service.bikeStations(c!!.lat, c.lng) },
        isEmpty = { it.isEmpty() },
        firstKey = { it.firstOrNull()?.let { s -> "bike-${s.stationId}" } },
        loadedNotice = { if (it.isEmpty()) strings.bikeEmpty() else strings.announceBikes(it.size) },
        emptyCopy = strings.bikeEmpty,
    )

    fun around(service: NearbyService, strings: NearbyStrings) = NearbyKindSpec<AroundPayload>(
        coverage = NearbyCoverage.korea,
        fetch = { c -> fetchAround(service, c!!) },
        isEmpty = { it.isAllAbsent },
        firstKey = { if (it.isAllAbsent) null else "around-top" }, // 위치 문장(헤딩)이 착지 지점
        loadedNotice = { if (it.isAllAbsent) strings.aroundEmpty() else strings.aroundLoaded() },
        emptyCopy = strings.aroundEmpty,
    )

    /** 파라미터형(좌표 없음): 경유 정류소. 첫 로드 착지 없음(iOS 동형) — firstKey null. */
    fun busRouteStops(service: NearbyService, strings: NearbyStrings, source: String, cityCode: String?, routeId: String) =
        NearbyKindSpec<List<BusRouteStop>>(
            coverage = NearbyCoverage.none,
            fetch = { service.busRouteStops(source, cityCode, routeId) },
            isEmpty = { it.isEmpty() },
            firstKey = { null },
            loadedNotice = { if (it.isEmpty()) strings.routeStopsEmpty() else strings.announceRouteStops(it.size) },
            emptyCopy = strings.routeStopsEmpty,
        )
}
