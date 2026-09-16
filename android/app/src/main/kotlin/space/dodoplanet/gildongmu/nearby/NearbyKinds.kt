package space.dodoplanet.gildongmu.nearby

import space.dodoplanet.gildongmu.kit.BarrierFreeService
import space.dodoplanet.gildongmu.kit.ConditionsService
import space.dodoplanet.gildongmu.kit.models.BarrierFreePlace
import space.dodoplanet.gildongmu.kit.models.BikeStation
import space.dodoplanet.gildongmu.kit.models.CultureEvent
import space.dodoplanet.gildongmu.kit.models.KidsPlace
import space.dodoplanet.gildongmu.kit.models.BusRouteStop
import space.dodoplanet.gildongmu.kit.models.BusStop
import space.dodoplanet.gildongmu.kit.NearbyCoverage
import space.dodoplanet.gildongmu.kit.NearbyService
import space.dodoplanet.gildongmu.kit.WalkInfraService
import space.dodoplanet.gildongmu.kit.models.SubwayNearbyResult
import space.dodoplanet.gildongmu.kit.ManualLocation
import space.dodoplanet.gildongmu.kit.formatDistance

/** kind별 조립기 표(spec §5·§12-1). fetch는 전부 non-null(0건 = 빈 리스트); 둘째 인자는 직전 payload(조각 병합 kind만 쓴다). */
object NearbyKinds {
    fun subway(service: NearbyService, strings: NearbyStrings) = NearbyKindSpec<SubwayNearbyResult>(
        coverage = NearbyCoverage.korea,
        fetch = { c, _ -> service.subwayArrivals(c!!.lat, c.lng, strings.dataLocale()) },
        isEmpty = { it.stations.isEmpty() },
        // 역명이 정체성이자 착지 키다 — 근접역 조회가 `dedupeByName`으로 같은 이름을 하나만 남기므로(`subway-nearby.ts`) 이 목록 안에서는
        // 중복이 생기지 않는다. 버스가 nodeId를 쓰는 것과 조건이 다르다(정류소명 중복 실존).
        firstKey = { it.stations.firstOrNull()?.let { s -> "station-${s.stationName}" } },
        loadedNotice = { r ->
            // 0건이면 최근접 역 거리를 실어 "1km 안에 없다"와 "이 지역엔 도시철도가 없다"를 가른다(웹 emptyNearest 미러).
            if (r.stations.isEmpty()) subwayEmptyCopy(r, strings) else strings.announceStations(r.stations.size)
        },
        emptyCopy = { subwayEmptyCopy(it, strings) },
    )

    /** 0건 문구 — 통지와 본문이 같은 문장(최근접 역이 있으면 거리 포함). */
    fun subwayEmptyCopy(result: SubwayNearbyResult, strings: NearbyStrings): String {
        val nearest = result.nearest ?: return strings.subwayEmpty()
        return strings.subwayEmptyNearest(nearestLabel(nearest, strings.dataLocale() == "en", strings.lang()), formatDistance(nearest.distanceMeters))
    }

    fun bus(service: NearbyService, strings: NearbyStrings) = NearbyKindSpec<List<BusStop>>(
        coverage = NearbyCoverage.korea,
        fetch = { c, _ -> service.busStops(c!!.lat, c.lng) },
        isEmpty = { it.isEmpty() },
        firstKey = { it.firstOrNull()?.let { s -> "stop-${s.nodeId}" } }, // 정류소명 중복 실존 → nodeId
        loadedNotice = { if (it.isEmpty()) strings.busEmpty() else strings.announceStops(it.size) },
        emptyCopy = { strings.busEmpty() },
    )

    fun bike(service: NearbyService, strings: NearbyStrings) = NearbyKindSpec<List<BikeStation>>(
        coverage = NearbyCoverage.korea,
        fetch = { c, _ -> service.bikeStations(c!!.lat, c.lng) },
        isEmpty = { it.isEmpty() },
        firstKey = { it.firstOrNull()?.let { s -> "bike-${s.stationId}" } },
        loadedNotice = { if (it.isEmpty()) strings.bikeEmpty() else strings.announceBikes(it.size) },
        emptyCopy = { strings.bikeEmpty() },
    )

    /** `manual`은 조회 시점 읽기 — 수동 여부를 payload에 굳혀 위치 문장·완료 통지가 같은 값을 읽는다(spec §13-4). 앵커 화면은 `{ null }`. */
    fun around(service: NearbyService, strings: NearbyStrings, manual: () -> ManualLocation?) = NearbyKindSpec<AroundPayload>(
        coverage = NearbyCoverage.korea,
        fetch = { c, _ -> fetchAround(service, c!!, usedManual = usedManualCoordinate(c, manual())) },
        isEmpty = { it.isAllAbsent },
        firstKey = { if (it.isAllAbsent) null else "around-top" }, // 위치 문장(헤딩)이 착지 지점
        loadedNotice = {
            when {
                it.isAllAbsent -> strings.aroundEmpty()
                it.usedManual -> strings.aroundLoadedManual()
                else -> strings.aroundLoaded()
            }
        },
        emptyCopy = { strings.aroundEmpty() },
    )

    // ── M2b 목록형 4종(spec §12-1): 착지·복귀 키 `place-{id}`, 0건 통지 = 도메인 빈 문구(M2 관례).

    fun clinic(service: NearbyService, strings: NearbyStrings) = NearbyKindSpec<ClinicPayload>(
        coverage = NearbyCoverage.korea,
        fetch = { c, _ -> service.clinics(c!!.lat, c.lng).let { ClinicPayload(it.clinics, it.basis ?: "weekday", it.supplementFailed ?: false) } },
        isEmpty = { it.clinics.isEmpty() },
        firstKey = { it.clinics.firstOrNull()?.let { x -> "place-${x.id}" } },
        loadedNotice = { if (it.clinics.isEmpty()) strings.clinicEmpty() else strings.announcePlaces(it.clinics.size) },
        emptyCopy = { strings.clinicEmpty() },
    )

    fun barrierFree(service: BarrierFreeService, strings: NearbyStrings) = NearbyKindSpec<List<BarrierFreePlace>>(
        coverage = NearbyCoverage.korea,
        fetch = { c, _ -> service.nearby(c!!.lat, c.lng) },
        isEmpty = { it.isEmpty() },
        firstKey = { it.firstOrNull()?.let { x -> "place-${x.contentId}" } },
        loadedNotice = { if (it.isEmpty()) strings.barrierFreeEmpty() else strings.announcePlaces(it.size) },
        emptyCopy = { strings.barrierFreeEmpty() },
    )

    fun kids(service: NearbyService, strings: NearbyStrings) = NearbyKindSpec<List<KidsPlace>>(
        coverage = NearbyCoverage.korea,
        fetch = { c, _ -> service.kidsPlaces(c!!.lat, c.lng) },
        isEmpty = { it.isEmpty() },
        firstKey = { it.firstOrNull()?.let { x -> "place-${x.id}" } },
        loadedNotice = { if (it.isEmpty()) strings.kidsEmpty() else strings.announcePlaces(it.size) },
        emptyCopy = { strings.kidsEmpty() },
    )

    fun events(service: NearbyService, strings: NearbyStrings) = NearbyKindSpec<List<CultureEvent>>(
        coverage = NearbyCoverage.korea,
        fetch = { c, _ -> service.cultureEvents(c!!.lat, c.lng) },
        isEmpty = { it.isEmpty() },
        firstKey = { it.firstOrNull()?.let { x -> "place-${x.id}" } },
        loadedNotice = { if (it.isEmpty()) strings.eventsEmpty() else strings.announceEvents(it.size) },
        emptyCopy = { strings.eventsEmpty() },
    )

    /**
     * 보행 인프라(spec §12-1·판정 24): `coverage = none` — 라우트에 커버리지 마커가 없고 두 소스가 각자 `Unsupported`로 말한다(`korea`로
     * 접으면 소스별 구분이 사라진다). 본문이 3-state를 말하므로 빈 문구가 없다(`isEmpty` 항상 거짓). `now`는 앱 언어 short time.
     */
    fun walkInfra(service: WalkInfraService, strings: NearbyStrings, now: () -> String) = NearbyKindSpec<WalkInfraPayload>(
        coverage = NearbyCoverage.none,
        fetch = { c, _ -> fetchWalkInfra(service, c!!, now) },
        isEmpty = { false },
        firstKey = { "walkinfra-top" },
        loadedNotice = { strings.walkInfraSummary(it.walk) },
    )

    /** 날씨·공기질·혼잡도(spec §12-1): 조각 병합이라 `previous`를 쓰는 유일한 kind(판정 25). 본문이 조각별 3-state를 말해 빈 문구 없음. */
    fun conditions(service: ConditionsService, strings: NearbyStrings) = NearbyKindSpec<ConditionsPayload>(
        coverage = NearbyCoverage.korea,
        fetch = { c, previous -> fetchConditions(service, c!!, previous) },
        isEmpty = { false },
        firstKey = { "conditions-weather" },
        loadedNotice = { conditionsNotice(it, strings.conditionsReady(), strings.conditionsPartial(), strings.failedTitle()) },
    )

    /** 파라미터형(좌표 없음): 경유 정류소. 첫 로드 착지 없음(iOS 동형) — firstKey null. */
    fun busRouteStops(service: NearbyService, strings: NearbyStrings, source: String, cityCode: String?, routeId: String) =
        NearbyKindSpec<List<BusRouteStop>>(
            coverage = NearbyCoverage.none,
            fetch = { _, _ -> service.busRouteStops(source, cityCode, routeId) },
            isEmpty = { it.isEmpty() },
            firstKey = { null },
            loadedNotice = { if (it.isEmpty()) strings.routeStopsEmpty() else strings.announceRouteStops(it.size) },
            emptyCopy = { strings.routeStopsEmpty() },
        )
}
