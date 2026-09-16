package space.dodoplanet.gildongmu.nearby

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Scaffold
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
import androidx.compose.ui.unit.dp
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.a11y.AppTopBar

/** 내 주변 허브(spec §3-4): 버튼 4개, iOS 순서. 위치는 여기서 요청하지 않는다(각 화면 진입 시). */
@Composable
fun NearbyHubScreen(onOpen: (NearbyKind) -> Unit, returnFocus: String?) {
    val requesters = remember { mutableMapOf<NearbyKind, FocusRequester>() }
    // pop 복귀 착지: 눌렀던 버튼으로(spec §3-1). 키는 호출자가 한 번만 준다.
    LaunchedEffect(returnFocus) {
        val key = returnFocus ?: return@LaunchedEffect
        withFrameNanos { }
        NearbyKind.entries.firstOrNull { hubKey(it) == key }?.let { requesters[it]?.requestFocus() }
    }
    Scaffold(topBar = { AppTopBar(stringResource(R.string.android_tab_nearby), onBack = null) }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
            for (kind in NearbyKind.entries) {
                Button(
                    onClick = { onOpen(kind) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag(hubKey(kind))
                        .focusRequester(requesters.getOrPut(kind) { FocusRequester() })
                        .padding(vertical = 4.dp),
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
}
