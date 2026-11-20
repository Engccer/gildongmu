package space.dodoplanet.gildongmu.place

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.CustomAccessibilityAction
import space.dodoplanet.gildongmu.AppConfig
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.a11y.AppNotices
import space.dodoplanet.gildongmu.a11y.HapticKind
import space.dodoplanet.gildongmu.directions.DirectionsPrefill
import space.dodoplanet.gildongmu.directions.DirectionsPrefillRole
import space.dodoplanet.gildongmu.directions.noteDestination
import space.dodoplanet.gildongmu.i18n.AppLocale
import space.dodoplanet.gildongmu.i18n.appLocalized
import space.dodoplanet.gildongmu.kit.bilingualName
import space.dodoplanet.gildongmu.kit.models.JusoAddress
import space.dodoplanet.gildongmu.kit.models.Place

/**
 * 줄 동작이 화면 밖으로 나가는 두 길(B21). `AppRoot`가 한 번 공급한다 — 줄을 그리는 화면마다 내비게이션을 배선하지 않는다.
 * 공급이 없으면(미리보기·테스트) 길찾기·물어보기를 세우지 않는다(죽은 동작 금지).
 */
class PlaceRowNav(val openDirections: (DirectionsPrefill) -> Unit, val openChat: (Place) -> Unit)

val LocalPlaceRowNav = staticCompositionLocalOf<PlaceRowNav?> { null }

/** 장소 줄 동작 한 종류(iOS `PlaceRowActions`, E60·E72). */
enum class PlaceRowAction { call, directions, copyAddress, askAbout }

/**
 * 작업 메뉴 순서와 존재(iOS E72 위원장 판정 2026-10-17): 전화 걸기 → 여기까지 길찾기 → 주소 복사 → 물어보기. 보유한 데이터만 낸다
 * (빈 전화·빈 도로명 = 죽은 동작). 안드로이드는 목록 순서 그대로 노출하므로 iOS 로터의 역순 선언을 옮기지 않는다(README §3 화면 관용구).
 * 카카오맵·네이버 지도 딥링크는 줄에 두지 않는다 — 장소 상세의 보조 출구다.
 */
fun placeRowActionKinds(place: Place, canDirections: Boolean, canAsk: Boolean): List<PlaceRowAction> = buildList {
    if (!place.phone.isNullOrEmpty()) add(PlaceRowAction.call)
    if (canDirections) add(PlaceRowAction.directions)
    if (place.roadAddress.isNotEmpty()) add(PlaceRowAction.copyAddress)
    if (canAsk) add(PlaceRowAction.askAbout)
}

/**
 * 장소 하나를 가리키는 줄의 작업 메뉴(검색 장소 결과·내 주변 목록·주변 상황 항목·채팅 장소 카드 공용, B21 ①③⑧). 병합 줄의
 * `customActions`로 단다. `onAskAbout`은 물어보기를 세울 화면만 넘긴다 — 복귀 착지 키를 찍은 뒤 `PlaceRowNav.openChat`을 부르는 것은
 * 호출부 몫이다(채팅 카드는 null — 채팅 안 재진입 순환 방지, iOS `onAskAbout: nil`).
 */
@Composable
fun placeRowActions(place: Place, onAskAbout: (() -> Unit)?): List<CustomAccessibilityAction> {
    val context = LocalContext.current
    val res = context.resources
    val nav = LocalPlaceRowNav.current
    val lang = AppLocale.current(res)
    return placeRowActionKinds(place, canDirections = nav != null, canAsk = onAskAbout != null).map { kind ->
        when (kind) {
            PlaceRowAction.call -> CustomAccessibilityAction(res.getString(R.string.android_place_call)) {
                if (!context.dial(place.phone.orEmpty())) AppNotices.post(res.getString(R.string.android_common_noAppToOpen), haptic = HapticKind.failure)
                true
            }
            PlaceRowAction.directions -> CustomAccessibilityAction(res.getString(R.string.directions_toHere)) {
                // 「여기까지」는 목적지다 — 번호를 안내 목적지 전화번호부에 적는다(E90, 가드 `GuideDestinationCallGuardTest`).
                AppConfig.placePhoneBook.noteDestination(place)
                nav?.openDirections(DirectionsPrefill(DirectionsPrefillRole.to, place.name, place.lat, place.lng, place.nameRoman))
                true
            }
            PlaceRowAction.copyAddress -> CustomAccessibilityAction(res.getString(R.string.android_place_copyAddress)) {
                context.copyAddress(place.roadAddress)
                true
            }
            PlaceRowAction.askAbout -> CustomAccessibilityAction(
                appLocalized(res, R.string.android_place_askAbout, bilingualName(lang, place.name, en = null, roman = place.nameRoman).primary),
            ) { onAskAbout?.invoke(); true }
        }
    }
}

/** 주소 결과 줄 복사 셋의 순서(iOS `addressCopyActions` 사용자 경험 순서): 도로명 → 지번 → 영문, 보유한 주소만. 값은 (라벨 자원, 주소). */
fun addressCopyItems(address: JusoAddress): List<Pair<Int, String>> = listOf(
    R.string.place_copyRoadAddress to address.roadAddr,
    R.string.place_copyJibunAddress to address.jibunAddr,
    R.string.place_copyEnglishAddress to address.engAddr,
).filter { it.second.isNotEmpty() }

/** 주소 결과 줄의 작업 메뉴(B21 ②, 검색·채팅 주소 카드 공용). */
@Composable
fun addressCopyActions(address: JusoAddress): List<CustomAccessibilityAction> {
    val context = LocalContext.current
    return addressCopyItems(address).map { (label, value) ->
        CustomAccessibilityAction(context.resources.getString(label)) { context.copyAddress(value); true }
    }
}

/**
 * 클립보드 복사 + 완료 통지(iOS `copyAddressToPasteboard`). 화면이 바뀌지 않는 동작이라 문장이 성공의 유일한 증거다 — 줄이 든 화면의
 * 단일 통지 창구가 앱 통지로 집어 읽고 성공 진동을 함께 낸다(문장이 나가는 조건 = 진동 조건).
 */
fun Context.copyAddress(text: String) {
    getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText("address", text))
    AppNotices.post(resources.getString(R.string.place_addressCopied), haptic = HapticKind.success)
}
