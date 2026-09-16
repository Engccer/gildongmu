package space.dodoplanet.gildongmu.nearby

/** 테스트용 문장 공급(한국어 고정, 리소스 없이). */
fun testNearbyStrings(lang: String = "ko", dataLocale: String = "ko") = NearbyStrings(
    lang = { lang }, dataLocale = { dataLocale }, spokenMeters = { "미터" },
    announceEmpty = { "주변 결과가 없습니다" }, refreshFailed = { "새로고침 실패, 유지" }, refreshDenied = { "권한 꺼짐" },
    refreshReduced = { "정확한 위치 꺼짐" }, outOfCoverage = { "대한민국 안에서 제공" },
    announceStations = { "주변 역 ${it}곳" }, announceStops = { "주변 정류소 ${it}곳" }, announceBikes = { "주변 대여소 ${it}곳" },
    announceRouteStops = { "경유 정류소 ${it}곳" }, aroundLoaded = { "둘러보기를 확인했습니다" },
    subwayEmptyNearest = { s, d -> "주변에 지하철역이 없습니다. 가장 가까운 역은 $s, $d 거리입니다" },
    subwayEmpty = { "주변에 지하철역이 없습니다" }, busEmpty = { "주변에 버스 정류소가 없습니다" }, bikeEmpty = { "주변에 따릉이 대여소가 없습니다" },
    aroundEmpty = { "주변에 표시할 장소가 없습니다" }, routeStopsEmpty = { "경유 정류소 정보가 없습니다" },
)
