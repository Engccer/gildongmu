package space.dodoplanet.gildongmu.nearby

/**
 * 내 주변 통지·문구 공급(호출 시점 람다 — M1 `SearchStrings` 관용구, 앱별 언어 변경을 따라간다). 리소스는 화면 몫이라
 * ViewModel·조립기는 문장을 주입받는다(JVM 테스트 가능).
 */
class NearbyStrings(
    val lang: () -> String,
    val dataLocale: () -> String,
    val spokenMeters: () -> String,
    val refreshFailed: () -> String,
    val refreshDenied: () -> String,
    val refreshReduced: () -> String,
    val outOfCoverage: () -> String,
    val announceStations: (Int) -> String,
    val announceStops: (Int) -> String,
    val announceBikes: (Int) -> String,
    val announceRouteStops: (Int) -> String,
    val aroundLoaded: () -> String,
    val subwayEmptyNearest: (String, String) -> String,
    val subwayEmpty: () -> String,
    val busEmpty: () -> String,
    val bikeEmpty: () -> String,
    val aroundEmpty: () -> String,
    val routeStopsEmpty: () -> String,
    val noAppToOpen: () -> String,
)
