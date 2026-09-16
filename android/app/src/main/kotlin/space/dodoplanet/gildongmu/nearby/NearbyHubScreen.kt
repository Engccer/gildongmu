package space.dodoplanet.gildongmu.nearby

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.unit.dp
import android.util.Log
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.a11y.landingTarget
import space.dodoplanet.gildongmu.a11y.AppScreenScaffold
import space.dodoplanet.gildongmu.a11y.Notice
import space.dodoplanet.gildongmu.a11y.StatusLine
import space.dodoplanet.gildongmu.a11y.tapTarget
import space.dodoplanet.gildongmu.location.CurrentAddressStore
import space.dodoplanet.gildongmu.location.LOCATION_BAR_KEY
import space.dodoplanet.gildongmu.location.LocationBarRow
import space.dodoplanet.gildongmu.location.ManualLocationStore

/** 내 주변 허브(spec §3-4·§12-4·§13-3): 표시줄 버튼 + 버튼 10개(iOS 순서). 권한은 여기서 요청하지 않는다(각 화면 진입 시). */
@Composable
fun NearbyHubScreen(
    onOpen: (NearbyKind) -> Unit,
    onPick: () -> Unit,
    takeReturnFocus: () -> String?,
    currentAddress: CurrentAddressStore,
    manualLocation: ManualLocationStore,
) {
    val requesters = remember { mutableMapOf<NearbyKind, FocusRequester>() }
    val barFocus = remember { FocusRequester() }
    // pop 복귀 착지: 눌렀던 버튼으로(spec §3-1) — 종류 버튼 또는 표시줄 버튼(위치 지정 복귀, 라벨은 이미 확정돼 있다). 소비는 효과 안에서 한 번.
    LaunchedEffect(Unit) {
        val key = takeReturnFocus() ?: return@LaunchedEffect
        withFrameNanos { }
        val requester = if (key == LOCATION_BAR_KEY) barFocus else NearbyKind.entries.firstOrNull { hubKey(it) == key }?.let { requesters[it] }
        runCatching { requester?.requestFocus() }.onFailure { Log.w("Nearby", "허브 복귀 착지 실패 $key", it) }
    }
    AppScreenScaffold(stringResource(R.string.android_tab_nearby), onBack = null) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).semantics { testTagsAsResourceId = true }) {
            // 첫 행: 현재 위치 표시줄(이 화면의 조회 기준 선언, spec §12-4) = 위치 지정 버튼(§13-3).
            LocationBarRow(currentAddress, manualLocation, onPick, barFocus)
            StatusLine(Notice(0, ""), Modifier.padding(vertical = 8.dp)) // 화면 통지는 없다 — 앱 통지(자동 해제) 창구(spec §13-5), 다른 화면처럼 컨트롤 뒤
            for (kind in NearbyKind.entries) {
                Button(
                    onClick = { onOpen(kind) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 4.dp)
                        .tapTarget() // 패딩 뒤에 — 앞에 두면 48dp에 패딩이 포함돼 표면이 40dp가 된다
                        .testTag(hubKey(kind))
                        .landingTarget(requesters.getOrPut(kind) { FocusRequester() }),
                ) { Text(stringResource(kindTitle(kind))) }
            }
        }
    }
}

fun hubKey(kind: NearbyKind) = "hub-${kind.name}"


fun kindTitle(kind: NearbyKind): Int = when (kind) {
    NearbyKind.around -> R.string.android_nearby_around
    NearbyKind.subway -> R.string.android_nearby_subway
    NearbyKind.bus -> R.string.android_nearby_bus
    NearbyKind.bike -> R.string.android_nearby_bike
    NearbyKind.clinic -> R.string.android_nearby_clinic
    NearbyKind.barrierFree -> R.string.android_nearby_barrierFree
    NearbyKind.kids -> R.string.android_nearby_kids
    NearbyKind.events -> R.string.android_nearby_events
    NearbyKind.walkInfra -> R.string.walkInfra_button
    NearbyKind.conditions -> R.string.android_nearby_conditions
}
