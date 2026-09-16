package space.dodoplanet.gildongmu.nearby

import android.content.Context
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.i18n.AppLocale
import space.dodoplanet.gildongmu.i18n.appLocalized

private fun walkSummaryWords(context: Context): WalkSummaryWords {
    val res = context.resources
    return WalkSummaryWords(
        audioSummary = { appLocalized(res, R.string.walkInfra_audioSummary, it) },
        audioNone = context.getString(R.string.walkInfra_audioNone),
        audioUnsupported = context.getString(R.string.walkInfra_audioUnsupported),
        audioError = context.getString(R.string.walkInfra_audioError),
        osmSummary = { appLocalized(res, R.string.walkInfra_osmSummary, it) },
        osmEmpty = context.getString(R.string.walkInfra_osmEmpty),
        osmUnsupported = context.getString(R.string.walkInfra_osmUnsupported),
        osmError = context.getString(R.string.walkInfra_osmError),
    )
}

/** 리소스에서 읽는 문장 공급(호출 시점) — `MainActivity`가 앱 컨텍스트로 만든다. */
fun nearbyStrings(context: Context): NearbyStrings {
    val res = context.resources
    return NearbyStrings(
        lang = { AppLocale.current(res) },
        dataLocale = { AppLocale.dataLocale(res) },
        spokenMeters = { context.getString(R.string.android_unit_spokenMeters) },
        refreshFailed = { context.getString(R.string.android_nearby_refreshFailed) },
        refreshDenied = { context.getString(R.string.android_nearby_refreshDenied) },
        refreshReduced = { context.getString(R.string.android_nearby_refreshReduced) },
        outOfCoverage = { context.getString(R.string.android_common_outOfCoverage) },
        announceStations = { appLocalized(res, R.string.android_nearby_announceStations, it) },
        announceStops = { appLocalized(res, R.string.android_nearby_announceStops, it) },
        announceBikes = { appLocalized(res, R.string.android_nearby_announceBikes, it) },
        announceRouteStops = { appLocalized(res, R.string.android_nearby_announceRouteStops, it) },
        aroundLoaded = { context.getString(R.string.android_nearby_aroundLoaded) },
        aroundLoadedManual = { context.getString(R.string.android_nearby_aroundLoadedManual) },
        subwayEmptyNearest = { station, distance -> appLocalized(res, R.string.android_nearby_subwayEmptyNearest, station, distance) },
        subwayEmpty = { context.getString(R.string.android_nearby_subwayEmpty) },
        busEmpty = { context.getString(R.string.android_nearby_busEmpty) },
        bikeEmpty = { context.getString(R.string.android_nearby_bikeEmpty) },
        aroundEmpty = { context.getString(R.string.android_nearby_aroundEmpty) },
        routeStopsEmpty = { context.getString(R.string.android_nearby_routeStopsEmpty) },
        noAppToOpen = { context.getString(R.string.android_common_noAppToOpen) },
        announcePlaces = { appLocalized(res, R.string.android_nearby_announcePlaces, it) },
        announceEvents = { appLocalized(res, R.string.android_nearby_announceEvents, it) },
        clinicEmpty = { context.getString(R.string.android_nearby_clinicEmpty) },
        barrierFreeEmpty = { context.getString(R.string.android_nearby_barrierFreeEmpty) },
        kidsEmpty = { context.getString(R.string.android_nearby_kidsEmpty) },
        eventsEmpty = { context.getString(R.string.android_nearby_eventsEmpty) },
        conditionsReady = { context.getString(R.string.android_nearby_conditionsReady) },
        conditionsPartial = { context.getString(R.string.android_nearby_conditionsPartial) },
        failedTitle = { context.getString(R.string.android_common_failedTitle) },
        walkInfraSummary = { walkInfraLiveSummary(it, walkSummaryWords(context)) },
    )
}
