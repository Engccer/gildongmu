package space.dodoplanet.gildongmu.guide.ui

import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.a11y.tapTarget
import space.dodoplanet.gildongmu.guide.GuideFormSync
import space.dodoplanet.gildongmu.guide.GuideSession
import space.dodoplanet.gildongmu.kit.BeaconDest
import space.dodoplanet.gildongmu.kit.DirectionsEndpoint
import space.dodoplanet.gildongmu.kit.models.Place

/** 장소 상세의 안내 중 버튼(iOS `PlaceDetailView` N1 spec §2.5·N4 §4.5). 순서가 읽기 순서다. */
enum class GuideHereAction(val tag: String) {
    changeDest("guide-here-dest"),
    addWaypoint("guide-here-waypoint"),
    changeWaypoint("guide-here-waypoint"),
}

/**
 * 어떤 버튼을 보이는가 — 도보 안내 추적 중에만. 경유지는 상세 조회가 있는 로케일(ko)만이고(`waypointAvailable`, 안내 시트 경유지 버튼과 같은 조건),
 * 동작이 교체라 미도착 경유지가 있으면 라벨이 "변경"이다(라벨이 곧 상태).
 */
fun guideHereActions(tracking: Boolean, waypointAvailable: Boolean, hasWaypoint: Boolean): List<GuideHereAction> = buildList {
    if (!tracking) return@buildList
    add(GuideHereAction.changeDest)
    if (waypointAvailable) add(if (hasWaypoint) GuideHereAction.changeWaypoint else GuideHereAction.addWaypoint)
}

/**
 * 장소 상세 길찾기 블록의 "여기로 목적지 변경"·"여기를 경유지로 추가/여기로 경유지 변경"(M4b 후속 ①). 진행 중인 도보 세션의 목적지·경유지를 이
 * 장소로 바꾼다 — 입구는 안내 시트 검색 페이지와 같은 모델 함수이고, 세션에 반영됐을 때만 길찾기 폼에 보낸다(`GuideFormSync`). 안드로이드엔 대중교통
 * 세션이 없어 iOS의 "준비 후 통지" 갈래는 없다. 결과 통지는 모델의 즉시 창구(안내 TTS)가 말하고, 버튼은 남는다(경유지는 라벨이 바뀐다).
 * 시트를 자동으로 다시 올리지 않는다(iOS 설계 리뷰 M3 — 상세를 읽던 사람을 옮기지 않는다).
 */
@Composable
fun GuideHereButtons(place: Place) {
    if (!GuideSession.isAttached) return
    val ui by GuideSession.walk.ui.collectAsState()
    val actions = guideHereActions(ui.isTracking, GuideSession.walk.waypointAvailable(), ui.waypointLabel != null)
    val dest = BeaconDest(place.lat, place.lng)
    val endpoint = DirectionsEndpoint.Place(place.name, place.lat, place.lng, place.nameRoman)
    for (action in actions) {
        val label = when (action) {
            GuideHereAction.changeDest -> R.string.guide_changeDestHere
            GuideHereAction.addWaypoint -> R.string.guide_addWaypointHere
            GuideHereAction.changeWaypoint -> R.string.guide_changeWaypointHere
        }
        Button(
            onClick = {
                when (action) {
                    GuideHereAction.changeDest -> if (GuideSession.walk.changeDestination(dest, place.name)) GuideFormSync.post(endpoint)
                    GuideHereAction.addWaypoint, GuideHereAction.changeWaypoint ->
                        if (GuideSession.walk.setWaypoint(dest, place.name)) GuideFormSync.postWaypoint(endpoint)
                }
            },
            modifier = Modifier.tapTarget().testTag(action.tag),
        ) { Text(stringResource(label)) }
    }
}
