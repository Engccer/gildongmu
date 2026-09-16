package space.dodoplanet.gildongmu.nearby

import android.content.res.Resources
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.i18n.AppLocale
import space.dodoplanet.gildongmu.i18n.appLocalized

private fun walkSummaryWords(res: () -> Resources): WalkSummaryWords {
    return WalkSummaryWords(
        audioSummary = { appLocalized(res(), R.string.walkInfra_audioSummary, it) },
        audioNone = res().getString(R.string.walkInfra_audioNone),
        audioUnsupported = res().getString(R.string.walkInfra_audioUnsupported),
        audioError = res().getString(R.string.walkInfra_audioError),
        osmSummary = { appLocalized(res(), R.string.walkInfra_osmSummary, it) },
        osmEmpty = res().getString(R.string.walkInfra_osmEmpty),
        osmUnsupported = res().getString(R.string.walkInfra_osmUnsupported),
        osmError = res().getString(R.string.walkInfra_osmError),
    )
}

/** 리소스에서 읽는 문장 공급 — **호출 시점**에 `res()`를 읽는다(spec §14-2: 캡처하면 언어 변경 뒤 옛 언어로 굳는다). 프로덕션은 `{ AppConfig.localizedApp().resources }`. */
fun nearbyStrings(res: () -> Resources): NearbyStrings {
    return NearbyStrings(
        lang = { AppLocale.current(res()) },
        dataLocale = { AppLocale.dataLocale(res()) },
        spokenMeters = { res().getString(R.string.android_unit_spokenMeters) },
        refreshFailed = { res().getString(R.string.android_nearby_refreshFailed) },
        refreshDenied = { res().getString(R.string.android_nearby_refreshDenied) },
        refreshReduced = { res().getString(R.string.android_nearby_refreshReduced) },
        outOfCoverage = { res().getString(R.string.android_common_outOfCoverage) },
        announceStations = { appLocalized(res(), R.string.android_nearby_announceStations, it) },
        announceStops = { appLocalized(res(), R.string.android_nearby_announceStops, it) },
        announceBikes = { appLocalized(res(), R.string.android_nearby_announceBikes, it) },
        announceRouteStops = { appLocalized(res(), R.string.android_nearby_announceRouteStops, it) },
        aroundLoaded = { res().getString(R.string.android_nearby_aroundLoaded) },
        aroundLoadedManual = { res().getString(R.string.android_nearby_aroundLoadedManual) },
        subwayEmptyNearest = { station, distance -> appLocalized(res(), R.string.android_nearby_subwayEmptyNearest, station, distance) },
        subwayEmpty = { res().getString(R.string.android_nearby_subwayEmpty) },
        busEmpty = { res().getString(R.string.android_nearby_busEmpty) },
        bikeEmpty = { res().getString(R.string.android_nearby_bikeEmpty) },
        aroundEmpty = { res().getString(R.string.android_nearby_aroundEmpty) },
        routeStopsEmpty = { res().getString(R.string.android_nearby_routeStopsEmpty) },
        noAppToOpen = { res().getString(R.string.android_common_noAppToOpen) },
        announcePlaces = { appLocalized(res(), R.string.android_nearby_announcePlaces, it) },
        announceEvents = { appLocalized(res(), R.string.android_nearby_announceEvents, it) },
        clinicEmpty = { res().getString(R.string.android_nearby_clinicEmpty) },
        barrierFreeEmpty = { res().getString(R.string.android_nearby_barrierFreeEmpty) },
        kidsEmpty = { res().getString(R.string.android_nearby_kidsEmpty) },
        eventsEmpty = { res().getString(R.string.android_nearby_eventsEmpty) },
        conditionsReady = { res().getString(R.string.android_nearby_conditionsReady) },
        conditionsPartial = { res().getString(R.string.android_nearby_conditionsPartial) },
        failedTitle = { res().getString(R.string.android_common_failedTitle) },
        walkInfraSummary = { walkInfraLiveSummary(it, walkSummaryWords(res)) },
    )
}
