package space.dodoplanet.gildongmu.guide.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
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
import space.dodoplanet.gildongmu.guide.GuideSessionKind
import space.dodoplanet.gildongmu.guide.GuideWaypoint
import space.dodoplanet.gildongmu.guide.TransitStartMark
import space.dodoplanet.gildongmu.guide.WalkStartRequest
import space.dodoplanet.gildongmu.guide.WalkGuideUiState
import space.dodoplanet.gildongmu.directions.Strings
import space.dodoplanet.gildongmu.guide.guideStrings
import space.dodoplanet.gildongmu.kit.BeaconDest
import space.dodoplanet.gildongmu.kit.DirectionsEndpoint
import space.dodoplanet.gildongmu.kit.models.WalkLineKind
import space.dodoplanet.gildongmu.location.LocationPermission
import space.dodoplanet.gildongmu.location.appDetailsSettingsIntent
import space.dodoplanet.gildongmu.nav.tryStartActivity

/**
 * 도보 안내 시작 버튼(spec §7-1, directions 슬롯). 활성화 = `GuideSession.startWalk` — 앱에서 이 호출은 여기 한 곳(소스 가드 ①).
 * 추적 중에도 숨기지 않는다(누르면 거부 통지). 아래 **시작 실패 행**: 실패 전이에 문장 착지 + 해결 버튼(정확한 위치 허용 / 설정 열기).
 * 시트·띠바는 `hasScreen` 조건이라 실패 상태를 그리지 않는다 — 이 행이 유일한 자리다.
 */
@Composable
fun WalkGuideStartButton(dest: BeaconDest, label: String, line: WalkLineKind, alternate: WalkLineKind?, waypoint: GuideWaypoint?, onStart: () -> Unit) {
    val res = LocalContext.current.resources
    val strings = remember(res) { guideStrings(res) }
    val ui by GuideSession.walk.ui.collectAsState()
    val tag = "guide-start-walk-${line.rawValue}"
    Column(Modifier.fillMaxWidth()) {
        Button(
            // 요청 축은 줄 종류의 투영(E42 — 계단 회피는 이제 줄의 성질이다). 셋을 함께 적는다(A13).
            // `onStart`는 시작 요청 직전에 — 화면이 "현재 위치에서 시작한다" 고지를 낸다(iOS `announceGuideStartIfManualOrigin` 자리).
            onClick = {
                onStart()
                GuideSession.startWalk(WalkStartRequest(dest, label, line.isAccessible, line.variant, line, alternate, waypoint, exitLead = null))
            },
            modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp).tapTarget().testTag(tag),
        ) { Text(strings.get(walkLineStartKey(line))) }
        if (ui.lastStartLine == line) GuideStartFailureRow(ui, strings)
    }
}

/**
 * 시작 실패 행(§7-1) — 실패 전이에 문장 착지 + 해결 버튼(정확한 위치 허용 / 설정 열기). 시작 버튼 바로 아래, 그 버튼이 낸 시작일 때만
 * 부른다(도보는 줄, 자동차는 수단으로 가른다). 시트·띠바는 `hasScreen` 조건이라 실패 상태를 그리지 않는다 — 이 행이 유일한 자리다.
 */
@Composable
internal fun GuideStartFailureRow(ui: WalkGuideUiState, strings: Strings) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val failFocus = remember { FocusRequester() }
    val failBring = remember { BringIntoViewRequester() }
    if (!(ui.status.isFailure && ui.statusText.isNotEmpty())) return
    Column(Modifier.fillMaxWidth()) {
        // `BodyLine`은 `focus`를 받지 않고 `a11y/`는 m1 소유라 `mergedRow` 직접(리뷰 N3-6).
        Text(ui.statusText, Modifier.fillMaxWidth().bringIntoViewRequester(failBring).mergedRow("guide-fail", focus = failFocus).padding(vertical = 8.dp))
        // 실패 **전이**에만 착지(모델이 발급한 1회 표식) — 탭 복귀 재컴포지션이 커서를 빼앗지 않는다. 길찾기 선두 행(B28)은 스크롤 위쪽이라 먼저 들인다.
        LaunchedEffect(ui.failSeq) { if (GuideSession.walk.takeFailLanding()) landRevealed(failBring, failFocus, "시작 실패 문장") }
        when (ui.failResolution) {
            FailResolution.precise -> Button(
                onClick = {
                    scope.launch {
                        if (AppConfig.permissionGate.request() == LocationPermission.Fine) GuideSession.restartBeacon()
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

/**
 * 인계 도보의 시작 실패 행(B28, iOS `DirectionsTabView` 선두 섹션의 실패 문장 + 해결 버튼) — 길찾기 화면 선두(추적 중 「안내 종료」 자리)에 선다.
 * 자동차 도착 뒤 「여기서 도보 안내 시작」·대중교통 하차 인계 「남은 도보 안내 시작」·잘못 내림 복구의 걷기는 시작 버튼이 없는 줄 없는 도보 시작이라
 * 위 세 버튼 아래 실패 행 어디에도 걸리지 않는다. [정확한 위치 허용]의 `restartBeacon`은 모델이 든 같은 요청으로 다시 시작해 실패도 다시 여기 선다.
 */
@Composable
fun GuideHandoffFailureRow(heading: @Composable (destination: String) -> Unit) {
    val res = LocalContext.current.resources
    val strings = remember(res) { guideStrings(res) }
    val ui by GuideSession.walk.ui.collectAsState()
    val started by GuideSession.transitStartRoute.collectAsState()
    if (!handoffStartFailureShown(ui, started) || !(ui.status.isFailure && ui.statusText.isNotEmpty())) return
    heading(ui.destinationLabel) // iOS 선두 섹션 머리말 「실시간 길 안내, {도착지}」 — 무엇이 실패했는지와 헤딩 이동 자리
    GuideStartFailureRow(ui, strings)
}

/**
 * 인계 도보의 실패인가 — 마지막 시작이 줄 없는 도보이고 대중교통 시작 표식이 없을 때. 표식이 있으면 승차 전 도보(그 경로 버튼 아래, `transitStartFailureShown`)이고,
 * 인계 셋은 공개 `startWalk`가 표식을 지운다. 줄이 있으면 도보 줄 버튼, 자동차면 자동차 버튼 아래다.
 */
fun handoffStartFailureShown(ui: WalkGuideUiState, started: TransitStartMark?): Boolean =
    started == null && ui.lastStartKind == GuideSessionKind.walk && ui.lastStartLine == null

/** 줄 안 안내 시작 버튼 문구(E42, iOS `WalkLineText.startKey` 미러 — 라벨이 그 줄 이름이라 어느 경로의 안내인지 구분된다). */
fun walkLineStartKey(line: WalkLineKind): String = when (line) {
    WalkLineKind.shortest -> "beacon.guideStartWalkShortest"
    WalkLineKind.accessible -> "beacon.guideStartWalkAccessible"
    WalkLineKind.broad -> "beacon.guideStartWalkBroad"
    WalkLineKind.recommended -> "beacon.guideStartWalkRecommended"
}

/**
 * directions 슬롯 조립(spec §7-1): 도착 좌표가 있을 때만. 도착 = `promotedDestination ?: (to as Place)`(iOS `trackedDestination`
 * 동형), `to == Current`면 버튼 없음. 계단 회피·경로 축은 줄 종류가 정한다(E42). `onStart`는 기본값 없음 — 시작 고지를 빠뜨린 호출이 조용히
 * 컴파일되지 않게.
 */
fun walkGuideStartSlot(s: DirectionsUiState, onStart: () -> Unit): (@Composable (line: WalkLineKind) -> Unit)? {
    val target = s.promotedDestination?.let { it.label to BeaconDest(it.lat, it.lng) }
        ?: (s.to as? DirectionsEndpoint.Place)?.let { it.label to BeaconDest(it.lat, it.lng) }
        ?: return null
    val (label, dest) = target
    val waypoint = s.via?.let { GuideWaypoint(BeaconDest(it.lat, it.lng), it.label) }
    // 다른 줄(M4b 안내 중 대안 프리뷰 대상) — 계단 회피 우선, 없으면 첫 다른 줄(E52 :kit `switchAlternate`, iOS 같은 함수).
    val kinds = s.walkLines.mapNotNull { it.lineKind }
    return { line -> WalkGuideStartButton(dest, label, line, WalkLineKind.switchAlternate(line, kinds), waypoint, onStart) }
}
