package space.dodoplanet.gildongmu.nearby

import space.dodoplanet.gildongmu.kit.models.WalkInfrastructure

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
    /** 수동 좌표로 조회한 둘러보기 완료 통지(spec §13-4). */
    val aroundLoadedManual: () -> String,
    val subwayEmptyNearest: (String, String) -> String,
    val subwayEmpty: () -> String,
    val busEmpty: () -> String,
    val bikeEmpty: () -> String,
    val aroundEmpty: () -> String,
    val routeStopsEmpty: () -> String,
    val noAppToOpen: () -> String,
    // M2b(spec §12-1)
    val announcePlaces: (Int) -> String,
    val announceEvents: (Int) -> String,
    val clinicEmpty: () -> String,
    val barrierFreeEmpty: () -> String,
    val kidsEmpty: () -> String,
    val eventsEmpty: () -> String,
    val conditionsReady: () -> String,
    val conditionsPartial: () -> String,
    val failedTitle: () -> String,
    /** 보행 인프라 완료 통지 — 소스별 요약 결합(`walkInfraLiveSummary`). */
    val walkInfraSummary: (WalkInfrastructure) -> String,
)
