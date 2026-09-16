package space.dodoplanet.gildongmu.directions

import android.content.res.Resources
import androidx.annotation.StringRes
import space.dodoplanet.gildongmu.BuildConfig
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.i18n.appLocalized

/**
 * 길찾기 문자열 조회 창구(spec §2 "판정은 :kit, 화면은 조립만"). 키는 `messages/{lang}.json`·android-extra의 키 그대로라
 * :kit `TransitWalkLegText`·`TransitAlternativeName`가 돌려준 키를 **그대로** 넣을 수 있다. 리소스는 화면 몫이라
 * ViewModel·문장 조립기는 이 인터페이스를 주입받고, JVM 테스트는 카탈로그 JSON을 직접 푸는 페이크를 쓴다.
 * 인자는 **ko 문장의 플레이스홀더 등장 순서**(iOS 위치 인자 ABI, `android/i18n/arg-order.json`이 잠근다).
 */
fun interface Strings {
    fun get(key: String, vararg args: Any): String
}

/**
 * 프로덕션 구현 — 키 → `R.string` **리터럴 매핑**(iOS 관례: 변수 키를 그대로 카탈로그에 넘기면 키 린터가 대조하지 못한다).
 * 미매핑 키는 디버그에서 즉시 드러내고 릴리스는 키 문자열을 노출한다(빈 문자열 금지 — 침묵보다 낫다).
 * 인자 있는 조회는 `appLocalized`만 지난다(ICU 복수 블록, `LocalizedCallSiteGuardTest`).
 */
fun resourceStrings(res: Resources): Strings = Strings { key, args ->
    val id = stringId(key)
    when {
        id == null -> {
            check(!BuildConfig.DEBUG) { "길찾기 문자열 미매핑 키: $key" }
            key
        }
        args.isEmpty() -> res.getString(id)
        else -> appLocalized(res, id, *args)
    }
}

@StringRes
private fun stringId(key: String): Int? = when (key) {
    "android.tab.directions" -> R.string.android_tab_directions
    "directions.from" -> R.string.directions_from
    "directions.to" -> R.string.directions_to
    "directions.via" -> R.string.directions_via
    "directions.searchFrom" -> R.string.directions_searchFrom
    "directions.searchTo" -> R.string.directions_searchTo
    "directions.searchVia" -> R.string.directions_searchVia
    "directions.currentLocation" -> R.string.directions_currentLocation
    "directions.currentLocationNear" -> R.string.directions_currentLocationNear
    "directions.useCurrentLocation" -> R.string.directions_useCurrentLocation
    "directions.refreshingCurrent" -> R.string.directions_refreshingCurrent
    "directions.swap" -> R.string.directions_swap
    "directions.submit" -> R.string.directions_submit
    "directions.addVia" -> R.string.directions_addVia
    "directions.removeVia" -> R.string.directions_removeVia
    "directions.viaArrived" -> R.string.directions_viaArrived
    "directions.unsupportedWaypoint" -> R.string.directions_unsupportedWaypoint
    "directions.needEndpoints" -> R.string.directions_needEndpoints
    "directions.locating" -> R.string.directions_locating
    "directions.loading" -> R.string.directions_loading
    "directions.geoError" -> R.string.directions_geoError
    "directions.readySummary" -> R.string.directions_readySummary
    "directions.allFailed" -> R.string.directions_allFailed
    "directions.candidateCount" -> R.string.directions_candidateCount
    "directions.candidateNone" -> R.string.directions_candidateNone
    "directions.candidateError" -> R.string.directions_candidateError
    "directions.coordError" -> R.string.directions_coordError
    "directions.walkRecommended" -> R.string.directions_walkRecommended
    "directions.walkShortest" -> R.string.directions_walkShortest
    "route.public" -> R.string.route_public
    "route.car" -> R.string.route_car
    "route.pedestrian.heading" -> R.string.route_pedestrian_heading
    "route.pedestrian.summary" -> R.string.route_pedestrian_summary
    "route.pedestrian.noRoute" -> R.string.route_pedestrian_noRoute
    "route.pedestrian.error" -> R.string.route_pedestrian_error
    "route.pedestrian.stepFreeToggle" -> R.string.route_pedestrian_stepFreeToggle
    "route.briefing.error" -> R.string.route_briefing_error
    "route.transit.noRoute" -> R.string.route_transit_noRoute
    "route.transit.error" -> R.string.route_transit_error
    "route.transit.recommended" -> R.string.route_transit_recommended
    "route.transit.alternativeHeading" -> R.string.route_transit_alternativeHeading
    "route.transit.alternativeFastest" -> R.string.route_transit_alternativeFastest
    "route.transit.alternativeFewestTransfers" -> R.string.route_transit_alternativeFewestTransfers
    "route.transit.alternativeFastestFewestTransfers" -> R.string.route_transit_alternativeFastestFewestTransfers
    "route.transit.busNo" -> R.string.route_transit_busNo
    "route.transit.legBoardExit" -> R.string.route_transit_legBoardExit
    "route.transit.legServiceOutside" -> R.string.route_transit_legServiceOutside
    "route.transit.legWalkTo" -> R.string.route_transit_legWalkTo
    "route.transit.legWalkToNoDistance" -> R.string.route_transit_legWalkToNoDistance
    "route.transit.legWalkToExit" -> R.string.route_transit_legWalkToExit
    "route.transit.legWalkToExitNoDistance" -> R.string.route_transit_legWalkToExitNoDistance
    "route.transit.legWalkToDest" -> R.string.route_transit_legWalkToDest
    "route.transit.legWalkToDestNoDistance" -> R.string.route_transit_legWalkToDestNoDistance
    "android.route.totalDistance" -> R.string.android_route_totalDistance
    "android.route.durationMinutes" -> R.string.android_route_durationMinutes
    "android.route.taxiFare" -> R.string.android_route_taxiFare
    "android.route.tollFare" -> R.string.android_route_tollFare
    "android.route.fare" -> R.string.android_route_fare
    "android.route.transfers" -> R.string.android_route_transfers
    "android.route.walkMinutes" -> R.string.android_route_walkMinutes
    "android.route.board" -> R.string.android_route_board
    "android.route.alight" -> R.string.android_route_alight
    "android.route.stopCount" -> R.string.android_route_stopCount
    "android.route.stationCount" -> R.string.android_route_stationCount
    "android.route.legMinutes" -> R.string.android_route_legMinutes
    "android.directions.searching" -> R.string.android_directions_searching
    "android.common.outOfCoverage" -> R.string.android_common_outOfCoverage
    "android.common.openSettings" -> R.string.android_common_openSettings
    "android.common.allowPrecise" -> R.string.android_common_allowPrecise
    "android.common.geoDeniedDesc" -> R.string.android_common_geoDeniedDesc
    "android.common.geoReducedDesc" -> R.string.android_common_geoReducedDesc
    "android.common.expanded" -> R.string.android_common_expanded
    "android.common.collapsed" -> R.string.android_common_collapsed
    "android.unit.spokenMeters" -> R.string.android_unit_spokenMeters
    "android.search.prompt" -> R.string.android_search_prompt
    "android.search.searching" -> R.string.android_search_searching
    "search.label" -> R.string.search_label
    "search.clear" -> R.string.search_clear
    "search.button" -> R.string.search_button
    "actions.close" -> R.string.actions_close
    "recent.title" -> R.string.recent_title
    "recent.clearAll" -> R.string.recent_clearAll
    "recent.delete" -> R.string.recent_delete
    "recent.deleted" -> R.string.recent_deleted
    "recent.cleared" -> R.string.recent_cleared
    "recent.pin" -> R.string.recent_pin
    "recent.unpin" -> R.string.recent_unpin
    "recent.pinned" -> R.string.recent_pinned
    "recent.clearedExceptPinned" -> R.string.recent_clearedExceptPinned
    "recentRoutes.title" -> R.string.recentRoutes_title
    "recentRoutes.item" -> R.string.recentRoutes_item
    "recentRoutes.itemVia" -> R.string.recentRoutes_itemVia
    "recentRoutes.clearAll" -> R.string.recentRoutes_clearAll
    "recentRoutes.cleared" -> R.string.recentRoutes_cleared
    "transitGuide.exitBound" -> R.string.transitGuide_exitBound
    else -> null
}
