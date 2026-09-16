package space.dodoplanet.gildongmu.nearby

import android.content.res.Resources
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.a11y.BodyLine
import space.dodoplanet.gildongmu.a11y.tapTarget
import space.dodoplanet.gildongmu.i18n.AppLocale
import space.dodoplanet.gildongmu.i18n.appLocalized
import space.dodoplanet.gildongmu.kit.barrierFreePlaceToPlace
import space.dodoplanet.gildongmu.kit.cultureEventToPlace
import space.dodoplanet.gildongmu.kit.formatDistance
import space.dodoplanet.gildongmu.kit.joinText
import space.dodoplanet.gildongmu.kit.kidsPlaceToPlace
import space.dodoplanet.gildongmu.kit.models.BarrierFreePlace
import space.dodoplanet.gildongmu.kit.models.CultureEvent
import space.dodoplanet.gildongmu.kit.models.KidsPlace
import space.dodoplanet.gildongmu.kit.models.NightClinic
import space.dodoplanet.gildongmu.kit.models.Place
import space.dodoplanet.gildongmu.kit.nightClinicToPlace
import space.dodoplanet.gildongmu.search.PlaceRow

/**
 * 장소 목록형 본문 공용(clinic·barrierFree·kids·events — iOS 4뷰의 List 골격, spec §12-1). 행 = `PlaceRow` 버튼(→ 상세),
 * 착지·복귀 키 `place-{id}`, "더 보기"는 `vm.revealMore`, 머리·꼬리는 kind가 준다. 헤딩 없음(평면 1행=1객체, iOS 판정 동형).
 * 0건은 `NearbyShell`이 빈 문구로 먼저 가르므로 여기 오는 `items`는 비지 않는다.
 */
@Composable
fun <T : Any, P : Any> PlaceListBody(
    items: List<T>,
    vm: NearbyScreenViewModel<P>,
    requesterFor: (String) -> FocusRequester,
    place: (T) -> Place,
    secondary: (T) -> String,
    onOpen: (T) -> Unit,
    header: @Composable () -> Unit = {},
    footer: @Composable () -> Unit = {},
) {
    val res = LocalContext.current.resources
    val lang = AppLocale.current(res)
    val meters = stringResource(R.string.android_unit_spokenMeters)
    val visibleCount by vm.visibleCount.collectAsState()
    header()
    for (item in items.take(visibleCount)) {
        val p = place(item)
        PlaceRow(p, lang, spokenMeters = meters, secondaryOverride = secondary(item), onClick = { onOpen(item) }, modifier = Modifier.focusRequester(requesterFor("place-${p.id}")))
    }
    if (items.size > visibleCount) {
        Button(onClick = { vm.revealMore(items.size) { i -> "place-${place(items[i]).id}" } }, Modifier.tapTarget().testTag("showMore")) { Text(stringResource(R.string.actions_showMore)) }
    }
    footer()
}

private fun distanceLabel(res: Resources, meters: Int) = appLocalized(res, R.string.place_distance, formatDistance(meters))

/** 리소스 → 소아 진료 낱말 묶음(화면 몫). 장소 상세 도메인 섹션도 같은 함수를 쓴다. */
fun clinicWords(res: Resources) = ClinicWords(
    kindClinic = res.getString(R.string.clinicNearby_kind_clinic),
    kindHospital = res.getString(R.string.clinicNearby_kind_hospital),
    open = res.getString(R.string.clinicNearby_open),
    closed = res.getString(R.string.android_nearby_clinicClosed),
    unknown = res.getString(R.string.android_nearby_clinicUnknown),
    untilMidnight = res.getString(R.string.android_nearby_untilMidnight),
    untilTime = { h, m -> appLocalized(res, R.string.android_nearby_untilTime, h, m) },
)

@Composable
fun ClinicBody(payload: ClinicPayload, vm: NearbyScreenViewModel<ClinicPayload>, requesterFor: (String) -> FocusRequester, onOpen: (NightClinic) -> Unit) {
    val res = LocalContext.current.resources
    val words = clinicWords(res)
    PlaceListBody(
        payload.clinics, vm, requesterFor, ::nightClinicToPlace,
        secondary = { c -> joinText(clinicKindText(c.kind, words), clinicStatusText(c.openStatus, words), distanceLabel(res, c.distanceMeters)) },
        onOpen = onOpen,
        header = {
            // 공휴일 기준으로 읽은 날·보완 실패만 밝힌다(조건부라 잡음 아님, 목록이 1건 이상일 때만 — 0건은 본문이 빈 문구다).
            if (payload.basis == "holiday") BodyLine(stringResource(R.string.clinicNearby_basisHoliday), "clinic-basis")
            if (payload.supplementFailed) BodyLine(stringResource(R.string.clinicNearby_supplementFailedNotice), "clinic-supplement")
        },
    )
}

@Composable
fun BarrierFreeBody(places: List<BarrierFreePlace>, vm: NearbyScreenViewModel<List<BarrierFreePlace>>, requesterFor: (String) -> FocusRequester, onOpen: (BarrierFreePlace) -> Unit) {
    val res = LocalContext.current.resources
    PlaceListBody(
        places, vm, requesterFor, ::barrierFreePlaceToPlace,
        secondary = { b -> joinText(b.address, distanceLabel(res, b.distanceMeters)) },
        onOpen = onOpen,
        // 출처는 항상 마지막 행 — "더 보기" 버튼은 그 앞.
        footer = { BodyLine(stringResource(R.string.barrierFreeInfo_source), "bf-source") },
    )
}

@Composable
fun KidsBody(places: List<KidsPlace>, vm: NearbyScreenViewModel<List<KidsPlace>>, requesterFor: (String) -> FocusRequester, onOpen: (KidsPlace) -> Unit) {
    val res = LocalContext.current.resources
    val kidscafe = stringResource(R.string.kidsNearby_kind_kidscafe)
    val playground = stringResource(R.string.kidsNearby_kind_playground)
    val playcenter = stringResource(R.string.kidsNearby_kind_playcenter)
    val park = stringResource(R.string.android_nearby_kidsPark)
    val indoor = stringResource(R.string.kidsNearby_indoor_indoor)
    val outdoor = stringResource(R.string.kidsNearby_indoor_outdoor)
    val unknown = stringResource(R.string.kidsNearby_indoor_unknown)
    PlaceListBody(
        places, vm, requesterFor, ::kidsPlaceToPlace,
        secondary = { k ->
            joinText(
                kidsKindLabel(k.kind, kidscafe, playground, playcenter, park),
                kidsInOutLabel(k.indoorOutdoor, indoor, outdoor, unknown),
                distanceLabel(res, k.distanceMeters),
                k.roadAddress ?: k.address,
            )
        },
        onOpen = onOpen,
    )
}

@Composable
fun EventsBody(events: List<CultureEvent>, vm: NearbyScreenViewModel<List<CultureEvent>>, requesterFor: (String) -> FocusRequester, onOpen: (CultureEvent) -> Unit) {
    val res = LocalContext.current.resources
    val free = stringResource(R.string.eventsNearby_free)
    PlaceListBody(
        events, vm, requesterFor, ::cultureEventToPlace,
        // 목록 행은 "탭할지 말지"를 가르는 것만: 분류·요금·거리. 기간·시간·대상은 상세 도메인 섹션이 맡는다(행 과밀 방지).
        secondary = { e -> joinText(e.category, eventFeeText(e, free) { appLocalized(res, R.string.eventsNearby_paid, it) }, distanceLabel(res, e.distanceMeters)) },
        onOpen = onOpen,
    )
}
