package space.dodoplanet.gildongmu.location

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.a11y.mergedRow
import space.dodoplanet.gildongmu.i18n.AppLocale
import space.dodoplanet.gildongmu.i18n.appLocalized
import space.dodoplanet.gildongmu.kit.bilingualName
import space.dodoplanet.gildongmu.nearby.LineText

/** 표시줄이 읽는 스냅샷(`CurrentAddressStore.state`). `LocationStore`의 필드는 관찰 불가라 여기서 찍는다. */
data class LocationBarInput(
    val permission: LocationPermission,
    val hasCoordinate: Boolean,
    val lastFixFailed: Boolean,
    val address: String?,
    val english: String?,
)

/**
 * 현재 위치 표시줄 문장(iOS `LocationBarView.state`의 텍스트 부분, spec §12-4 — 수동 위치 갈래는 M2c). 순서 = 권한 → 확정 실패 → 좌표 → 주소.
 *
 * 안드로이드는 "아직 안 물음"과 "거부"를 가를 수 없다(`None` 하나). 그래서 iOS의 `denied → gpsFailed`를 옮기지 않고 둘 다 참인 문장
 * "위치 권한이 필요합니다"를 쓴다(판정 29). `Coarse`는 표시용 좌표가 시도조차 하지 않아 실패 표식이 서지 않으므로 권한 축에서 먼저 가른다
 * — 그러지 않으면 "확인 중"에 영영 갇힌다. 실패 문구는 이 세션에서 확정된 시도(`lastFixFailed`)에만.
 */
fun locationBarLabel(
    input: LocationBarInput,
    lang: String,
    needsPermission: String,
    reducedAccuracy: String,
    gps: String,
    gpsNear: (String) -> String,
    locating: String,
    gpsFailed: String,
): LineText {
    if (input.permission == LocationPermission.None) return LineText(needsPermission, needsPermission)
    if (input.permission == LocationPermission.Coarse) return LineText(reducedAccuracy, reducedAccuracy)
    if (!input.hasCoordinate) return (if (input.lastFixFailed) gpsFailed else locating).let { LineText(it, it) }
    val address = input.address ?: return LineText(gps, gps)
    // GPS 상태에서만 실주소를 병기한다 — 주소가 없으면 시각장애 사용자는 GPS가 틀렸다는 사실 자체를 알 방법이 없다. 모르면 거짓을 말하지 않는다.
    val name = bilingualName(lang, address, en = input.english, roman = null)
    return LineText(gpsNear(name.display), gpsNear(name.primary))
}

/** 허브 첫 행. 진입마다 `ensureLoaded`(좌표당 1회는 스토어가 막는다). 권한을 요청하지 않는다(판정 28). */
@Composable
fun LocationBarRow(store: CurrentAddressStore) {
    val res = LocalContext.current.resources
    val input by store.state.collectAsState()
    LaunchedEffect(Unit) { store.ensureLoaded(AppLocale.dataLocale(res)) }
    val line = locationBarLabel(
        input, AppLocale.current(res),
        needsPermission = stringResource(R.string.android_common_geoDeniedTitle),
        reducedAccuracy = stringResource(R.string.android_common_geoReducedTitle),
        gps = stringResource(R.string.manualLocation_gps),
        gpsNear = { appLocalized(res, R.string.manualLocation_gpsNear, it) },
        locating = stringResource(R.string.manualLocation_locating),
        gpsFailed = stringResource(R.string.manualLocation_gpsFailed),
    )
    Text(line.visual, Modifier.fillMaxWidth().mergedRow("location-bar", line.spoken.takeIf { it != line.visual }).padding(vertical = 8.dp))
}
