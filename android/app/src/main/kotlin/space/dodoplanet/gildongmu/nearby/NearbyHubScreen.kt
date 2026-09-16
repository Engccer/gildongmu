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
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.unit.dp
import android.util.Log
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.a11y.AppScreenScaffold
import space.dodoplanet.gildongmu.a11y.tapTarget

/** 내 주변 허브(spec §3-4·§12-4): 버튼 10개, iOS 순서. 권한은 여기서 요청하지 않는다(각 화면 진입 시). */
@Composable
fun NearbyHubScreen(onOpen: (NearbyKind) -> Unit, takeReturnFocus: () -> String?) {
    val requesters = remember { mutableMapOf<NearbyKind, FocusRequester>() }
    // pop 복귀 착지: 눌렀던 버튼으로(spec §3-1). 소비는 효과 안에서 한 번(컴포지션 본문에서 부르면 재구성마다 유실).
    LaunchedEffect(Unit) {
        val key = takeReturnFocus() ?: return@LaunchedEffect
        withFrameNanos { }
        val kind = NearbyKind.entries.firstOrNull { hubKey(it) == key } ?: return@LaunchedEffect
        runCatching { requesters[kind]?.requestFocus() }.onFailure { Log.w("Nearby", "허브 복귀 착지 실패 $key", it) }
    }
    AppScreenScaffold(stringResource(R.string.android_tab_nearby), onBack = null) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).semantics { testTagsAsResourceId = true }) {
            for (kind in NearbyKind.entries) {
                Button(
                    onClick = { onOpen(kind) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 4.dp)
                        .tapTarget() // 패딩 뒤에 — 앞에 두면 48dp에 패딩이 포함돼 표면이 40dp가 된다
                        .testTag(hubKey(kind))
                        .focusRequester(requesters.getOrPut(kind) { FocusRequester() }),
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
