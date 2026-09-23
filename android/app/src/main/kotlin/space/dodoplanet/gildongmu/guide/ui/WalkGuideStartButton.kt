package space.dodoplanet.gildongmu.guide.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import space.dodoplanet.gildongmu.AppConfig
import space.dodoplanet.gildongmu.directions.DirectionsUiState
import space.dodoplanet.gildongmu.a11y.mergedRow
import space.dodoplanet.gildongmu.a11y.tapTarget
import space.dodoplanet.gildongmu.guide.FailResolution
import space.dodoplanet.gildongmu.guide.GuideSession
import space.dodoplanet.gildongmu.guide.GuideWaypoint
import space.dodoplanet.gildongmu.guide.WalkStartRequest
import space.dodoplanet.gildongmu.guide.guideStrings
import space.dodoplanet.gildongmu.kit.BeaconDest
import space.dodoplanet.gildongmu.kit.DirectionsEndpoint
import space.dodoplanet.gildongmu.kit.WalkRouteVariant
import space.dodoplanet.gildongmu.location.LocationPermission
import space.dodoplanet.gildongmu.location.appDetailsSettingsIntent
import space.dodoplanet.gildongmu.nav.tryStartActivity

/**
 * 도보 안내 시작 버튼(spec §7-1, directions 슬롯). 활성화 = `GuideSession.startWalk` — 앱에서 이 호출은 여기 한 곳(소스 가드 ①).
 * 추적 중에도 숨기지 않는다(누르면 거부 통지). 아래 **시작 실패 행**: 실패 전이에 문장 착지 + 해결 버튼(정확한 위치 허용 / 설정 열기).
 * 시트·띠바는 `hasScreen` 조건이라 실패 상태를 그리지 않는다 — 이 행이 유일한 자리다.
 */
@Composable
fun WalkGuideStartButton(dest: BeaconDest, label: String, accessible: Boolean, variant: WalkRouteVariant?, shortestAvailable: Boolean, waypoint: GuideWaypoint?) {
    val context = LocalContext.current
    val res = context.resources
    val strings = remember(res) { guideStrings(res) }
    val ui by GuideSession.walk.ui.collectAsState()
    val scope = rememberCoroutineScope()
    val failFocus = remember { FocusRequester() }
    val tag = if (variant == WalkRouteVariant.shortest) "guide-start-walk-shortest" else "guide-start-walk"
    Column(Modifier.fillMaxWidth()) {
        Button(
            onClick = { GuideSession.startWalk(WalkStartRequest(dest, label, accessible, variant, shortestAvailable, waypoint)) },
            modifier = Modifier.fillMaxWidth().tapTarget().testTag(tag).padding(vertical = 4.dp),
        ) { Text(strings.get(if (variant == WalkRouteVariant.shortest) "android.beacon.guideStartWalkShortest" else "beacon.guideStartWalk")) }
        val showsFailure = ui.status.isFailure && ui.statusText.isNotEmpty() && ui.lastStartVariant == variant
        if (showsFailure) {
            // `BodyLine`은 `focus`를 받지 않고 `a11y/`는 m1 소유라 `mergedRow` 직접(리뷰 N3-6).
            Text(ui.statusText, Modifier.fillMaxWidth().mergedRow("guide-fail", focus = failFocus).padding(vertical = 8.dp))
            // 실패 **전이**에만 착지(모델이 발급한 1회 표식) — 탭 복귀 재컴포지션이 커서를 빼앗지 않는다.
            LaunchedEffect(ui.failSeq) { if (GuideSession.walk.takeFailLanding()) land(failFocus, "시작 실패 문장") }
            when (ui.failResolution) {
                FailResolution.precise -> Button(
                    onClick = {
                        scope.launch {
                            if (AppConfig.permissionGate.request() == LocationPermission.Fine) GuideSession.walk.restart()
                            else GuideSession.walk.announceNow(strings.get("android.common.geoReducedDesc"), highPriority = true)
                        }
                    },
                    modifier = Modifier.fillMaxWidth().tapTarget().testTag("guide-fail-precise"),
                ) { Text(strings.get("android.common.allowPrecise")) }
                FailResolution.settings -> Button(
                    onClick = { context.tryStartActivity(appDetailsSettingsIntent(context)) },
                    modifier = Modifier.fillMaxWidth().tapTarget().testTag("guide-fail-settings"),
                ) { Text(strings.get("android.common.openSettings")) }
                FailResolution.none -> Unit
            }
        }
    }
}

/**
 * directions 슬롯 조립(spec §7-1): 도착 좌표가 있을 때만. 도착 = `promotedDestination ?: (to as Place)`(iOS `trackedDestination`
 * 동형), `to == Current`면 버튼 없음. 계단 회피는 ko에서만 서버 축이라 `stepFreeEnabled ∧ lang == ko`.
 */
fun walkGuideStartSlot(s: DirectionsUiState, lang: String): (@Composable (variant: WalkRouteVariant?) -> Unit)? {
    val target = s.promotedDestination?.let { it.label to BeaconDest(it.lat, it.lng) }
        ?: (s.to as? DirectionsEndpoint.Place)?.let { it.label to BeaconDest(it.lat, it.lng) }
        ?: return null
    val (label, dest) = target
    val accessible = s.stepFreeEnabled && lang == "ko"
    val shortestAvailable = s.walkShortest != null
    val waypoint = s.via?.let { GuideWaypoint(BeaconDest(it.lat, it.lng), it.label) }
    return { variant -> WalkGuideStartButton(dest, label, accessible, variant, shortestAvailable, waypoint) }
}
