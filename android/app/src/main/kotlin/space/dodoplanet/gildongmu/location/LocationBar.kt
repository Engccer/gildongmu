package space.dodoplanet.gildongmu.location

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.a11y.landingTarget
import space.dodoplanet.gildongmu.a11y.tapTarget
import space.dodoplanet.gildongmu.i18n.AppLocale
import space.dodoplanet.gildongmu.i18n.appLocalized
import space.dodoplanet.gildongmu.kit.ManualLocation
import space.dodoplanet.gildongmu.kit.ManualVerdict
import space.dodoplanet.gildongmu.kit.bilingualName
import space.dodoplanet.gildongmu.kit.isManualLocationVerified
import space.dodoplanet.gildongmu.kit.joinText
import space.dodoplanet.gildongmu.kit.manualLocationBilingualName
import space.dodoplanet.gildongmu.nearby.LineText

/** 표시줄이 읽는 GPS 스냅샷(`CurrentAddressStore.state`). `LocationStore`의 필드는 관찰 불가라 여기서 찍는다. */
data class LocationBarInput(
    val permission: LocationPermission,
    val hasCoordinate: Boolean,
    val lastFixFailed: Boolean,
    val address: String?,
    val english: String?,
)

/** 표시줄 어휘 — 리소스는 화면 몫(spec §4), 인자 있는 문장은 람다. */
class LocationBarWords(
    val needsPermission: String,
    val reducedAccuracy: String,
    val gps: String,
    val gpsNear: (String) -> String,
    val locating: String,
    val gpsFailed: String,
    val manual: (String) -> String,
    val manualUnverifiable: (String) -> String,
    val pickTitle: String,
)

/**
 * 수동 위치 라벨(spec §13-4) — 표시줄과 길찾기 출발지 필드가 **이 한 함수**를 쓴다. 검증 가능형(`지정한 위치, X`)과 검증 불가형
 * (`…(위치 확인 불가)`)은 `isManualLocationVerified`(origin 유무 + 지금 판정 가능성)가 가른다. 이름은 `manualLocationBilingualName`
 * (비-ko `labelRoman` 1순위): `accessible`이면 낭독형(로마자만), 아니면 시각형(로마자 (한글)).
 */
fun manualLocationLabel(
    manual: ManualLocation,
    verdict: ManualVerdict?,
    lang: String,
    accessible: Boolean,
    verified: (String) -> String,
    unverifiable: (String) -> String,
): String {
    val name = manualLocationBilingualName(manual, lang)
    val label = if (accessible) name.primary else name.display
    return if (isManualLocationVerified(manual, verdict)) verified(label) else unverifiable(label)
}

/**
 * 표시줄 최종 문장(순수, spec §13-4): 수동이면 `manualLocationLabel`, 아니면 GPS 갈래(§12-4), 끝에 `, 위치 지정하기` 꼬리 —
 * 행이 버튼이라 상태만 이름으로 쓰면 "현재 위치, 버튼"으로 읽혀 누르면 무엇이 되는지 단서가 0이다.
 */
fun locationBarLabel(input: LocationBarInput, manual: ManualLocation?, verdict: ManualVerdict?, lang: String, w: LocationBarWords): LineText {
    val status = if (manual == null) {
        gpsLabel(input, lang, w)
    } else {
        LineText(
            manualLocationLabel(manual, verdict, lang, accessible = false, w.manual, w.manualUnverifiable),
            manualLocationLabel(manual, verdict, lang, accessible = true, w.manual, w.manualUnverifiable),
        )
    }
    return LineText(joinText(status.visual, w.pickTitle), joinText(status.spoken, w.pickTitle))
}

/**
 * GPS 갈래(iOS `LocationBarView.state`의 텍스트 부분, spec §12-4). 순서 = 권한 → 확정 실패 → 좌표 → 주소.
 *
 * 안드로이드는 "아직 안 물음"과 "거부"를 가를 수 없다(`None` 하나). 그래서 iOS의 `denied → gpsFailed`를 옮기지 않고 둘 다 참인 문장
 * "위치 권한이 필요합니다"를 쓴다(판정 29). `Coarse`는 표시용 좌표가 시도조차 하지 않아 실패 표식이 서지 않으므로 권한 축에서 먼저 가른다
 * — 그러지 않으면 "확인 중"에 영영 갇힌다. 실패 문구는 이 세션에서 확정된 시도(`lastFixFailed`)에만.
 */
private fun gpsLabel(input: LocationBarInput, lang: String, w: LocationBarWords): LineText {
    if (input.permission == LocationPermission.None) return LineText(w.needsPermission, w.needsPermission)
    if (input.permission == LocationPermission.Coarse) return LineText(w.reducedAccuracy, w.reducedAccuracy)
    if (!input.hasCoordinate) return (if (input.lastFixFailed) w.gpsFailed else w.locating).let { LineText(it, it) }
    val address = input.address ?: return LineText(w.gps, w.gps)
    // GPS 상태에서만 실주소를 병기한다 — 주소가 없으면 시각장애 사용자는 GPS가 틀렸다는 사실 자체를 알 방법이 없다. 모르면 거짓을 말하지 않는다.
    val name = bilingualName(lang, address, en = input.english, roman = null)
    return LineText(w.gpsNear(name.display), w.gpsNear(name.primary))
}

/**
 * 허브 첫 행 — **버튼**(활성화 = 위치 지정 화면, spec §13-3). 주소 조회는 수동이 없을 때만이고 키가 `manual == null`이라 자동 해제 직후
 * 다시 돈다(iOS `.task(id:)` 동형 — "그럼 지금 어디냐"에 주소가 따라온다). 권한을 요청하지 않는다(판정 28).
 */
@Composable
fun LocationBarRow(store: CurrentAddressStore, manual: ManualLocationStore, onPick: () -> Unit, focus: FocusRequester) {
    val res = LocalContext.current.resources
    val input by store.state.collectAsState()
    val current by manual.current.collectAsState()
    val verdict by manual.verdict.collectAsState()
    LaunchedEffect(current == null) { if (current == null) store.ensureLoaded(AppLocale.dataLocale(res)) }
    val words = LocationBarWords(
        needsPermission = stringResource(R.string.android_common_geoDeniedTitle),
        reducedAccuracy = stringResource(R.string.android_common_geoReducedTitle),
        gps = stringResource(R.string.manualLocation_gps),
        gpsNear = { appLocalized(res, R.string.manualLocation_gpsNear, it) },
        locating = stringResource(R.string.manualLocation_locating),
        gpsFailed = stringResource(R.string.manualLocation_gpsFailed),
        manual = { appLocalized(res, R.string.manualLocation_manual, it) },
        manualUnverifiable = { appLocalized(res, R.string.manualLocation_manualUnverifiable, it) },
        pickTitle = stringResource(R.string.manualLocation_pickTitle),
    )
    val line = locationBarLabel(input, current, verdict, AppLocale.current(res), words)
    val spoken = line.spoken.takeIf { it != line.visual } // 낭독형이 시각과 같으면 덮지 않는다(M2b 규율)
    Button(
        onClick = onPick,
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp)
            .tapTarget()
            .testTag("location-bar")
            .landingTarget(focus)
            .semantics { if (spoken != null) contentDescription = spoken },
    ) { Text(line.visual) }
}
