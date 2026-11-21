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
import space.dodoplanet.gildongmu.guide.CarStartRequest
import space.dodoplanet.gildongmu.guide.GuideSession
import space.dodoplanet.gildongmu.guide.GuideSessionKind
import space.dodoplanet.gildongmu.guide.GuideWaypoint
import space.dodoplanet.gildongmu.guide.guideStrings
import space.dodoplanet.gildongmu.kit.BeaconDest
import space.dodoplanet.gildongmu.kit.DirectionsEndpoint
import space.dodoplanet.gildongmu.kit.canStartCarGuide

/**
 * 자동차 안내 시작 버튼(M5 spec §2-3, iOS `DirectionsTabView`의 car 갈래). 활성화 = `GuideSession.startCar` — 앱에서 이 호출은 여기 한 곳(소스
 * 가드). 자리는 자동차 수단 heading 바로 다음(경로가 하나라 비교 대상이 없다). 추적 중에도 숨기지 않는다(누르면 거부 통지). 아래는 도보와 같은
 * 시작 실패 행이고, 이 버튼이 낸 시작일 때만 선다.
 */
@Composable
fun CarGuideStartButton(dest: BeaconDest, label: String, waypoint: GuideWaypoint?, onStart: () -> Unit) {
    val res = LocalContext.current.resources
    val strings = remember(res) { guideStrings(res) }
    val ui by GuideSession.walk.ui.collectAsState()
    Column(Modifier.fillMaxWidth()) {
        Button(
            // `onStart`는 시작 요청 직전에 — 화면이 "현재 위치에서 시작한다" 고지를 낸다(iOS `announceGuideStartIfManualOrigin` 자리).
            onClick = {
                onStart()
                GuideSession.startCar(CarStartRequest(dest, label, waypoint))
            },
            modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp).tapTarget().testTag("guide-start-car"),
        ) { Text(strings.get("beacon.guideStartCar")) }
        if (ui.lastStartKind == GuideSessionKind.car) GuideStartFailureRow(ui, strings)
    }
}

/**
 * 자동차 시작 버튼 조립: 시작 조건(`canStartCarGuide` — 한국어 데이터 ∧ Tmap, 카카오 폴백은 누르자마자 강등되는 죽은 버튼)을 지나고 도착 좌표가
 * 있을 때만. 도착 = `promotedDestination ?: (to as Place)`(도보 슬롯과 같은 규칙), `to == Current`면 버튼 없음. `onStart`는 기본값 없음.
 */
fun carGuideStartSlot(s: DirectionsUiState, dataLocale: String, provider: String?, onStart: () -> Unit): (@Composable () -> Unit)? {
    if (!canStartCarGuide(dataLocale, provider)) return null
    val (label, dest) = s.promotedDestination?.let { it.label to BeaconDest(it.lat, it.lng) }
        ?: (s.to as? DirectionsEndpoint.Place)?.let { it.label to BeaconDest(it.lat, it.lng) }
        ?: return null
    val waypoint = s.via?.let { GuideWaypoint(BeaconDest(it.lat, it.lng), it.label) }
    return { CarGuideStartButton(dest, label, waypoint, onStart) }
}
