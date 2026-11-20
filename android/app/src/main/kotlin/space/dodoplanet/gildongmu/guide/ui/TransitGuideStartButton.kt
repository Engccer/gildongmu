package space.dodoplanet.gildongmu.guide.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import space.dodoplanet.gildongmu.a11y.tapTarget
import space.dodoplanet.gildongmu.directions.DirectionsUiState
import space.dodoplanet.gildongmu.guide.GuideSession
import space.dodoplanet.gildongmu.guide.GuideSessionKind
import space.dodoplanet.gildongmu.guide.TransitStartRequest
import space.dodoplanet.gildongmu.guide.WalkGuideUiState
import space.dodoplanet.gildongmu.guide.guideStrings
import space.dodoplanet.gildongmu.kit.BeaconDest
import space.dodoplanet.gildongmu.kit.DirectionsEndpoint
import space.dodoplanet.gildongmu.kit.buildTransitGuideRoute
import space.dodoplanet.gildongmu.kit.models.TransitRoute

/**
 * 대중교통 안내 시작 버튼(M5 spec §6-9 단계 7, iOS `DirectionsTabView` 대중교통 경로 disclosure 본문 첫 항목). 활성화 = `GuideSession.startTransit` —
 * 앱에서 이 호출은 여기 한 곳(소스 가드). 라벨은 그 경로 항목의 이름을 싣는다(`beacon.guideStartTransitAlt` — 로터 버튼 목록에서 어느 경로의 안내인지
 * 구분된다). 추적 중에도 숨기지 않는다(누르면 거부 통지). 아래는 도보와 같은 시작 실패 행이고, 이 경로의 시작이 연 승차 전 도보가 실패했을 때만 선다
 * (그 행의 [정확한 위치 허용]은 `restartBeacon`이 연결을 다시 건다 — A68).
 */
@Composable
fun TransitGuideStartButton(route: TransitRoute, name: String, dest: BeaconDest, label: String) {
    val res = LocalContext.current.resources
    val strings = remember(res) { guideStrings(res) }
    val ui by GuideSession.walk.ui.collectAsState()
    val startedKey by GuideSession.transitStartRouteKey.collectAsState()
    Column(Modifier.fillMaxWidth()) {
        Button(
            // 승차 전 도보의 계단 회피 출처였던 토글이 E42로 사라졌다(iOS 같은 자리, `accessible: false`).
            onClick = { GuideSession.startTransit(TransitStartRequest(route, label, dest, accessible = false)) },
            modifier = Modifier.fillMaxWidth().tapTarget().testTag("guide-start-transit-${route.routeKey}").padding(vertical = 4.dp),
        ) { Text(strings.get("beacon.guideStartTransitAlt", name)) }
        if (transitStartFailureShown(ui, startedKey, route.routeKey)) GuideStartFailureRow(ui, strings)
    }
}

/** 이 경로의 시작 버튼 아래 시작 실패 행을 세우는가 — 승차 전 도보(줄 없는 도보 시작)가 이 경로의 대중교통 시작에서 나왔을 때만. */
fun transitStartFailureShown(ui: WalkGuideUiState, startedRouteKey: String?, routeKey: String): Boolean =
    startedRouteKey == routeKey && ui.lastStartKind == GuideSessionKind.walk && ui.lastStartLine == null

/**
 * 대중교통 시작 버튼 조립: 도착 좌표가 있을 때만(도착 = `promotedDestination ?: (to as Place)`, 도보·자동차 슬롯과 같은 규칙, `to == Current`면 없음).
 * 경로마다 시작 게이트(iOS `transitGuideStartable` = 탑승 구간 ≥ 1, `buildTransitGuideRoute != null`)를 지나야 버튼이 선다 — 도보 전용 경로는 죽은 버튼.
 */
fun transitGuideStartSlot(s: DirectionsUiState): (@Composable (route: TransitRoute, name: String) -> Unit)? {
    val (label, dest) = s.promotedDestination?.let { it.label to BeaconDest(it.lat, it.lng) }
        ?: (s.to as? DirectionsEndpoint.Place)?.let { it.label to BeaconDest(it.lat, it.lng) }
        ?: return null
    return { route, name -> if (buildTransitGuideRoute(route) != null) TransitGuideStartButton(route, name, dest, label) }
}
