package space.dodoplanet.gildongmu.guide

import android.content.res.Resources
import androidx.annotation.StringRes
import space.dodoplanet.gildongmu.BuildConfig
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.directions.Strings
import space.dodoplanet.gildongmu.i18n.appLocalized

/**
 * 실시간 안내 문자열 창구(spec 2026-09-16-android-m4 §9) — M3 `DirectionsStrings` 관용구 그대로. 키는 `messages/{lang}.json`·
 * android-extra의 키 그대로라 `GuideText`가 iOS `appLocalized("guide.x")`와 같은 이름으로 조립한다. 리소스는 화면 몫이라 모델·
 * 문장 조립기는 `Strings`를 주입받고, JVM 테스트는 카탈로그 JSON을 직접 푸는 `CatalogStrings`를 쓴다. 인자는 ko 문장의
 * 플레이스홀더 등장 순서(iOS 위치 인자 ABI, `android/i18n/arg-order.json`이 잠근다). 조회는 전부 `appLocalized`를 지난다
 * (무인자도 — `formatLocalized`의 복수 블록 안전망을 우회하지 않는다, `LocalizedCallSiteGuardTest`).
 */
fun guideStrings(res: Resources): Strings = guideStrings { res }

/** 앱 수명 세션·서비스용 — **호출 시점**에 `res()`를 읽는다(M2 spec §14-2: 캡처하면 언어 변경 뒤 옛 언어로 굳는다; 프로덕션은 `{ AppConfig.localizedApp().resources }`). */
fun guideStrings(res: () -> Resources): Strings = Strings { key, args ->
    val id = guideStringId(key)
    if (id == null) {
        check(!BuildConfig.DEBUG) { "안내 문자열 미매핑 키: $key" }
        key
    } else {
        appLocalized(res(), id, *args)
    }
}

/** 키 → 리소스 ID 표. `GuideSourceGuardTest`가 `guide/`·`audio/` 소스의 키 모양 리터럴 전수를 이 표에 대조한다. */
@StringRes
internal fun guideStringId(key: String): Int? = when (key) {
    "beacon.walkHeading" -> R.string.beacon_walkHeading
    "beacon.stop" -> R.string.beacon_stop
    "beacon.first" -> R.string.beacon_first
    "beacon.closer" -> R.string.beacon_closer
    "beacon.farther" -> R.string.beacon_farther
    "beacon.nearby" -> R.string.beacon_nearby
    "beacon.weak" -> R.string.beacon_weak
    "beacon.denied" -> R.string.beacon_denied
    "beacon.reduced" -> R.string.beacon_reduced
    "beacon.straightLineNote" -> R.string.beacon_straightLineNote
    "beacon.guideStartWalk" -> R.string.beacon_guideStartWalk
    "android.beacon.guideStartWalkShortest" -> R.string.android_beacon_guideStartWalkShortest
    "guide.detailStart" -> R.string.guide_detailStart
    "guide.bundle" -> R.string.guide_bundle
    "guide.handoff" -> R.string.guide_handoff
    "guide.finalApproachRouteEnd" -> R.string.guide_finalApproachRouteEnd
    "guide.finalApproachToDest" -> R.string.guide_finalApproachToDest
    "guide.finalApproachToDestNoDir" -> R.string.guide_finalApproachToDestNoDir
    "guide.finalApproachTick" -> R.string.guide_finalApproachTick
    "guide.finalApproachTickNoDir" -> R.string.guide_finalApproachTickNoDir
    "guide.finalApproachNear" -> R.string.guide_finalApproachNear
    "guide.finalApproachNearDir" -> R.string.guide_finalApproachNearDir
    "guide.arrived" -> R.string.guide_arrived
    "guide.arrivedPresumed" -> R.string.guide_arrivedPresumed
    "guide.endedIdle" -> R.string.guide_endedIdle
    "guide.dirAhead" -> R.string.guide_dirAhead
    "guide.dirLeft" -> R.string.guide_dirLeft
    "guide.dirRight" -> R.string.guide_dirRight
    "guide.dirBehind" -> R.string.guide_dirBehind
    "guide.dirAheadTo" -> R.string.guide_dirAheadTo
    "guide.dirLeftTo" -> R.string.guide_dirLeftTo
    "guide.dirRightTo" -> R.string.guide_dirRightTo
    "guide.dirBehindTo" -> R.string.guide_dirBehindTo
    "guide.offRoute" -> R.string.guide_offRoute
    "guide.backOnRoute" -> R.string.guide_backOnRoute
    "guide.imminent.left" -> R.string.guide_imminent_left
    "guide.imminent.right" -> R.string.guide_imminent_right
    "guide.imminent.back" -> R.string.guide_imminent_back
    "guide.imminent.crosswalk" -> R.string.guide_imminent_crosswalk
    "guide.imminent.underpass" -> R.string.guide_imminent_underpass
    "guide.liveStraight" -> R.string.guide_liveStraight
    "guide.liveStraightNoName" -> R.string.guide_liveStraightNoName
    "guide.liveTurnIn" -> R.string.guide_liveTurnIn
    "guide.liveAction.left" -> R.string.guide_liveAction_left
    "guide.liveAction.right" -> R.string.guide_liveAction_right
    "guide.liveAction.back" -> R.string.guide_liveAction_back
    "guide.liveAction.crosswalk" -> R.string.guide_liveAction_crosswalk
    "guide.liveAction.underpass" -> R.string.guide_liveAction_underpass
    "guide.nextAction" -> R.string.guide_nextAction
    "guide.nextStraight" -> R.string.guide_nextStraight
    "guide.nextStraightNoName" -> R.string.guide_nextStraightNoName
    "guide.uncertain" -> R.string.guide_uncertain
    "guide.uncertainRecovered" -> R.string.guide_uncertainRecovered
    "guide.reacquiring" -> R.string.guide_reacquiring
    "guide.detailUnavailable" -> R.string.guide_detailUnavailable
    "guide.detailNoLocation" -> R.string.guide_detailNoLocation
    "guide.progressButton" -> R.string.guide_progressButton
    "guide.progressOrdinal" -> R.string.guide_progressOrdinal
    "guide.progressCurrent" -> R.string.guide_progressCurrent
    "guide.progressNext" -> R.string.guide_progressNext
    "guide.remainingDistance" -> R.string.guide_remainingDistance
    "guide.remainingTime" -> R.string.guide_remainingTime
    "guide.rerouteButton" -> R.string.guide_rerouteButton
    "guide.rerouteBusy" -> R.string.guide_rerouteBusy
    "guide.rerouteFailed" -> R.string.guide_rerouteFailed
    "guide.rerouteDone" -> R.string.guide_rerouteDone
    "android.guide.autoReroute" -> R.string.android_guide_autoReroute
    "guide.progressUncertain" -> R.string.guide_progressUncertain
    "guide.progressOffRoute" -> R.string.guide_progressOffRoute
    "guide.progressFinalApproach" -> R.string.guide_progressFinalApproach
    "guide.approx" -> R.string.guide_approx
    "guide.rough" -> R.string.guide_rough
    "guide.noGuidanceYet" -> R.string.guide_noGuidanceYet
    "guide.alreadyActive" -> R.string.guide_alreadyActive
    "guide.minimize" -> R.string.guide_minimize
    "guide.band.return" -> R.string.guide_band_return
    "guide.band.remaining" -> R.string.guide_band_remaining
    "guide.band.starting" -> R.string.guide_band_starting
    "guide.band.arrived" -> R.string.guide_band_arrived
    "guide.band.ended" -> R.string.guide_band_ended
    "guide.periodicStraight" -> R.string.guide_periodicStraight
    "guide.periodicStraightNoName" -> R.string.guide_periodicStraightNoName
    "guide.nextDestination" -> R.string.guide_nextDestination
    "android.beacon.soundUnavailable" -> R.string.android_beacon_soundUnavailable
    "android.beacon.stopped" -> R.string.android_beacon_stopped
    "android.beacon.arrivedHeading" -> R.string.android_beacon_arrivedHeading
    "android.beacon.arrivedPresumedHeading" -> R.string.android_beacon_arrivedPresumedHeading
    "android.beacon.endedHeading" -> R.string.android_beacon_endedHeading
    "android.beacon.healthSummary" -> R.string.android_beacon_healthSummary
    "android.beacon.healthSummaryWithWeight" -> R.string.android_beacon_healthSummaryWithWeight
    "android.beacon.food.cherryTomato" -> R.string.android_beacon_food_cherryTomato
    "android.beacon.food.cucumberHalf" -> R.string.android_beacon_food_cucumberHalf
    "android.beacon.food.kimchi" -> R.string.android_beacon_food_kimchi
    "android.beacon.food.tangerine" -> R.string.android_beacon_food_tangerine
    "android.beacon.food.boiledEgg" -> R.string.android_beacon_food_boiledEgg
    "android.beacon.food.apple" -> R.string.android_beacon_food_apple
    "android.beacon.food.banana" -> R.string.android_beacon_food_banana
    "android.beacon.food.riceHalfBowl" -> R.string.android_beacon_food_riceHalfBowl
    "android.beacon.food.hotteok" -> R.string.android_beacon_food_hotteok
    "android.beacon.food.riceBowl" -> R.string.android_beacon_food_riceBowl
    "android.beacon.food.ramyeon" -> R.string.android_beacon_food_ramyeon
    "android.beacon.food.ramyeonMany" -> R.string.android_beacon_food_ramyeonMany
    "android.guide.routeListCurrent" -> R.string.android_guide_routeListCurrent
    "android.guide.routeListRow" -> R.string.android_guide_routeListRow
    "android.guide.mediaVolumeZero" -> R.string.android_guide_mediaVolumeZero
    "android.guide.focusDenied" -> R.string.android_guide_focusDenied
    "android.guide.ttsUnavailable" -> R.string.android_guide_ttsUnavailable
    "android.guide.serviceStartFailed" -> R.string.android_guide_serviceStartFailed
    "android.guide.notificationChannel" -> R.string.android_guide_notificationChannel
    "android.common.allowPrecise" -> R.string.android_common_allowPrecise
    "android.common.openSettings" -> R.string.android_common_openSettings
    "android.common.geoReducedDesc" -> R.string.android_common_geoReducedDesc
    "directions.viaArrived" -> R.string.directions_viaArrived
    "android.guide.waypointDropped" -> R.string.android_guide_waypointDropped
    "actions.close" -> R.string.actions_close
    "android.unit.spokenMeters" -> R.string.android_unit_spokenMeters
    else -> null
}
