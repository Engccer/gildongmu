package space.dodoplanet.gildongmu.place

import android.content.ClipData
import android.util.Log
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import space.dodoplanet.gildongmu.AppConfig
import space.dodoplanet.gildongmu.a11y.landingTarget
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.a11y.AppScreenScaffold
import space.dodoplanet.gildongmu.a11y.StatusLine
import space.dodoplanet.gildongmu.a11y.BodyLine
import space.dodoplanet.gildongmu.a11y.HeadingLine
import space.dodoplanet.gildongmu.a11y.headingText
import space.dodoplanet.gildongmu.a11y.mergedRow
import space.dodoplanet.gildongmu.a11y.tapTarget
import space.dodoplanet.gildongmu.directions.DirectionsPrefill
import space.dodoplanet.gildongmu.directions.DirectionsPrefillRole
import space.dodoplanet.gildongmu.i18n.AppLocale
import space.dodoplanet.gildongmu.i18n.appLocalized
import space.dodoplanet.gildongmu.kit.models.Place
import space.dodoplanet.gildongmu.kit.RouteDestination
import space.dodoplanet.gildongmu.kit.bilingualName
import space.dodoplanet.gildongmu.kit.pickCategory
import space.dodoplanet.gildongmu.kit.StationLayoutKind
import space.dodoplanet.gildongmu.kit.stationLayoutKind
import space.dodoplanet.gildongmu.nearby.NearbyKind
import space.dodoplanet.gildongmu.nearby.PlaceAnchor
import space.dodoplanet.gildongmu.nearby.kindTitle

/** 화면이 요청하는 이동. `returnFocus`는 pop 복귀 착지 키(앵커 버튼). */
class PlaceNav(val onBack: () -> Unit, val onOpenNearby: (NearbyKind, PlaceAnchor) -> Unit, val onOpenDirections: (DirectionsPrefill) -> Unit, /** "이 장소에 관해 물어보기"(M6 spec §7) — `AppRoot`가 복귀 키 `chat`을 찍고 `openChat`. */ val onOpenChat: (Place) -> Unit)

/**
 * 장소 상세(spec §3-2, iOS `PlaceDetailView` 대응). 정보 정본은 텍스트 리스트(지도 없음). 실주행은 딥링크 위임. 읽기 순서 = 표 순서.
 * **레이아웃은 둘이다**(E44 spec §3, 순서 정본 `placeDetailBlocks`): `stationLayoutKind`가 역이면 역 정보(전화 맨 위) → 도착·시간표·시설
 * (종류별 접기) → 무장애 → 길찾기 → 이 장소 주변(지하철 없음), 그 밖이면 개편 전 순서 그대로.
 * 안내 중 목적지 변경(M4)은 아래 주석 자리에 그 마일스톤이 넣는다. `showsChatEntry = false`(채팅에서 연 상세)면 "물어보기" 버튼을 숨긴다(순환 방지).
 */
@Composable
fun PlaceDetailScreen(
    factory: ViewModelProvider.Factory,
    nav: PlaceNav,
    takeReturnFocus: () -> String?,
    /** 경유역 전화번호 조회의 노선 힌트(E44 spec §5.2) — 라우트가 나른다. 기본값이 없다: 빠뜨리면 경유역 전화 줄이 조용히 사라진다. */
    stationLineHint: String?,
    domain: PlaceDomain? = null,
    showsChatEntry: Boolean = true,
    phoneStore: StationPhoneStore = StationPhoneStore.shared,
) {
    val vm: PlaceDetailViewModel = viewModel(factory = factory)
    val place = vm.place
    val context = LocalContext.current
    val res = context.resources
    val lang = AppLocale.current(res)
    val hoursLine by vm.hoursLine.collectAsState()
    val station by vm.station.collectAsState()
    val barrierFree by vm.barrierFree.collectAsState()
    val notice by vm.notice.collectAsState()
    val titleFocus = remember { FocusRequester() }
    val chatFocus = remember { FocusRequester() }
    val anchorFocus = remember { mutableMapOf<NearbyKind, FocusRequester>() }
    val title = bilingualName(lang, place.name, en = null, roman = place.nameRoman)
    val displayCategory = pickCategory(lang, place.category, place.categoryEn)
    val layoutKind = remember(place) { stationLayoutKind(place) }
    val dest = RouteDestination(place.lat, place.lng, place.name)
    val anchor = PlaceAnchor(place.lat, place.lng, place.name, place.nameRoman)

    // 진입 착지 = 제목 헤딩("뒤로, 버튼"부터 들리는 것을 막는다, §9-6 판정 뒤 제거 가능). pop 복귀면 눌렀던 앵커 버튼으로.
    // 복귀 키 소비는 효과 안에서 한 번(컴포지션 본문에서 부르면 재구성마다 유실돼 제목으로 덮인다).
    LaunchedEffect(Unit) {
        val key = takeReturnFocus()
        withFrameNanos { }
        val kind = key?.removePrefix("anchor-")?.let { k -> NearbyKind.entries.firstOrNull { it.name == k } }
        val target = if (key == CHAT_RETURN_KEY) chatFocus else kind?.let { anchorFocus[it] } ?: titleFocus
        runCatching { target.requestFocus() }.onFailure { Log.w("Place", "진입/복귀 착지 실패 $key", it) }
    }

    fun copy(text: String) {
        context.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText("address", text))
        vm.onCopied()
    }

    AppScreenScaffold(title.primary, nav.onBack, titleFocus) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)
                .semantics { testTagsAsResourceId = true },
        ) {
            StatusLine(notice, Modifier.padding(vertical = 8.dp))
            // 1. 한글 원문 보조 줄 — 시각 전용(제목이 낭독의 정본, E28 판정 ③)
            title.secondary?.let { Text(it, Modifier.clearAndSetSemantics { }.padding(vertical = 4.dp), style = MaterialTheme.typography.bodyMedium) }
            // 1-2. 도메인 섹션(그 화면에 온 이유 — 소아 진료 상태·문화행사 개요, spec §12-1). 보조 줄 다음, 분류 앞.
            when (domain) {
                is PlaceDomain.Clinic -> ClinicDomainSection(domain.clinic)
                is PlaceDomain.Event -> CultureEventSection(domain.event)
                null -> Unit
            }
            // 한 블록에 쓰이는 공용 행(두 레이아웃이 같은 행을 다른 자리에 둔다).
            val categoryRow: @Composable () -> Unit = {
                if (displayCategory.isNotEmpty()) Text(displayCategory, Modifier.fillMaxWidth().mergedRow("category").padding(vertical = 8.dp))
            }
            // 주소 줄 + 그 줄 전용 복사 버튼(보유한 주소만 — 빈 주소 = 죽은 버튼)
            val addressRows: @Composable () -> Unit = {
                AddressLine(place.roadAddress, R.string.android_place_roadAddressLine, "road", R.string.place_copyRoadAddress, ::copy)
                AddressLine(place.address, R.string.android_place_jibunAddressLine, "jibun", R.string.place_copyJibunAddress, ::copy)
                AddressLine(place.englishAddress ?: "", R.string.android_place_englishAddressLine, "english", R.string.place_copyEnglishAddress, ::copy)
            }
            // 영업시간(E24) — 조용히 나타난다.
            val hoursRow: @Composable () -> Unit = { hoursLine?.let { Text(it, Modifier.fillMaxWidth().mergedRow("hours").padding(vertical = 8.dp)) } }
            // 홈페이지 — 카카오 장소의 link는 카카오맵 상세라 아래 장소 정보와 중복(숨김). http/https만.
            val homepageRow: @Composable () -> Unit = {
                place.link?.takeIf { vm.kakaoPlaceId == null && (it.startsWith("http://") || it.startsWith("https://")) }?.let { url ->
                    Button(onClick = { context.openWithFallback(OpenPlan(url, null)) { vm.onOpenFailed() } }, Modifier.tapTarget().testTag("homepage")) { Text(stringResource(R.string.place_homepage)) }
                }
            }
            // 이 장소에 관해 물어보기(M6 spec §7): 장소 채팅 push, pop 복귀 착지는 이 버튼(`landingTarget` — 터치 모드 착지). 채팅에서 연 상세는 숨긴다.
            val chatRow: @Composable () -> Unit = {
                if (showsChatEntry) {
                    Button(onClick = { nav.onOpenChat(place) }, Modifier.tapTarget().testTag(CHAT_RETURN_KEY).landingTarget(chatFocus)) { Text(stringResource(R.string.placeChat_launch)) }
                }
            }
            for (block in placeDetailBlocks(layoutKind)) when (block) {
                PlaceBlock.generalInfo -> {
                    categoryRow()
                    addressRows()
                    hoursRow() // 전화 앞 — 시각이 틀릴 수 있어 확인 경로와 짝짓는다.
                    // 전화 걸기(다이얼러, 통화 권한 불필요)
                    place.phone?.takeIf { it.isNotEmpty() }?.let { phone ->
                        Button(onClick = { if (!context.dial(phone)) vm.onOpenFailed() }, Modifier.tapTarget().testTag("call")) { Text(appLocalized(res, R.string.android_place_callLine, phone)) }
                    }
                    homepageRow()
                    chatRow()
                }
                PlaceBlock.stationInfo -> {
                    // 제목은 역 상세면 항상 선다. 전화 줄이 맨 위("가장 많이 쓸 메뉴", 위원장). 메타 줄은 조용히 나타난다.
                    HeadingLine(stringResource(R.string.stationMeta_heading), "station-info")
                    StationPhoneLine(place, stationLineHint, phoneStore, onDialFailed = vm::onOpenFailed)
                    station?.meta?.let { StationMetaText(it) }
                    // 분류 줄은 기차역만 — `KTX정차역` 같은 정보가 여기뿐이다. 지하철은 합성값이거나 메타 줄 노선과 중복.
                    if (layoutKind == StationLayoutKind.rail) categoryRow()
                    addressRows()
                    hoursRow()
                    homepageRow()
                    chatRow()
                }
                // 역 섹션은 역 장소만 로드된다(ViewModel `isStation`). 역 레이아웃이 아닌데 뜨는 것은 출구 POI 등 드문 경우 — 개편 전 자리.
                PlaceBlock.stationMetaSection -> station?.let { StationMetaSection(it) }
                PlaceBlock.stationDetail -> station?.let { StationDetailSections(it) }
                // 무장애 편의시설도 자동 등장(조용히 나타남, 역 여부 무관).
                PlaceBlock.barrierFree -> barrierFree?.let { BarrierFreeSection(it) }
                PlaceBlock.route -> {
                    Text(stringResource(R.string.android_route_section), Modifier.fillMaxWidth().mergedRow("route-heading").headingText().padding(top = 12.dp, bottom = 4.dp), style = MaterialTheme.typography.titleMedium)
                    // 길찾기 탭 프리필(M3 계약 `directions/DirectionsPrefill`). 두 버튼은 별개 객체 — 라벨이 각각 동작의 범위를 말한다.
                    // "여기부터"는 도착지가 비므로 길찾기 탭이 조회 대신 도착지 입력에 착지한다(E32, iOS 동형).
                    for ((role, label, tag) in listOf(
                        Triple(DirectionsPrefillRole.to, R.string.directions_toHere, "directionsTo"),
                        Triple(DirectionsPrefillRole.from, R.string.directions_fromHere, "directionsFrom"),
                    )) {
                        Button(
                            onClick = { nav.onOpenDirections(DirectionsPrefill(role, place.name, place.lat, place.lng, place.nameRoman)) },
                            Modifier.tapTarget().testTag(tag),
                        ) { Text(stringResource(label)) }
                    }
                    // [M4] 안내 중 목적지 변경
                    // 외부 지도(빌더 null = 권역 밖 → 숨김)
                    naverRoutePlan(dest, AppConfig.APP_IDENTIFIER)?.let { plan ->
                        Button(onClick = { context.openWithFallback(plan) { vm.onOpenFailed() } }, Modifier.tapTarget().testTag("naver")) { Text(stringResource(R.string.android_route_naver)) }
                    }
                    kakaoRoutePlan(dest)?.let { plan ->
                        Button(onClick = { context.openWithFallback(plan) { vm.onOpenFailed() } }, Modifier.tapTarget().testTag("kakao")) { Text(stringResource(R.string.android_route_kakao)) }
                    }
                    vm.kakaoPlaceId?.let { id ->
                        Button(onClick = { context.openWithFallback(kakaoPlacePlan(id)) { vm.onOpenFailed() } }, Modifier.tapTarget().testTag("kakaoPlace")) { Text(stringResource(R.string.android_route_kakaoPlace)) }
                    }
                }
                PlaceBlock.nearby -> {
                    // 이 장소 주변(앵커 행, iOS 순서 — 이용 빈도순). 역 상세는 지하철 도착 행이 없다(판정 ④).
                    Text(stringResource(R.string.android_place_nearbyHeading), Modifier.fillMaxWidth().mergedRow("nearby-heading").headingText().padding(top = 12.dp, bottom = 4.dp), style = MaterialTheme.typography.titleMedium)
                    for (kind in nearbyAnchorKinds(layoutKind)) {
                        Button(
                            onClick = { nav.onOpenNearby(kind, anchor) },
                            Modifier.fillMaxWidth().tapTarget().testTag("anchor-${kind.name}").landingTarget(anchorFocus.getOrPut(kind) { FocusRequester() }),
                        ) { Text(stringResource(kindTitle(kind))) }
                    }
                }
            }
        }
    }
}

@Composable
private fun AddressLine(value: String, lineRes: Int, tag: String, copyRes: Int, copy: (String) -> Unit) {
    if (value.isEmpty()) return
    val res = LocalContext.current.resources
    Text(appLocalized(res, lineRes, value), Modifier.fillMaxWidth().mergedRow("address-$tag").padding(vertical = 8.dp))
    Button(onClick = { copy(value) }, Modifier.tapTarget().testTag("copy-$tag")) { Text(stringResource(copyRes)) }
}

/**
 * 역 상세 전화 줄(E44 spec §5.5). 경유역이면 화면에 떠 있는 동안 저장소를 신선하게 유지한다(`keepFresh` — 컴포지션을 떠나거나 멈추면 취소,
 * 공유 조회 자체는 저장소 스코프라 끝까지 돈다). 줄은 조용히 나타난다(자동 등장 보조 정보, 통지 없음).
 */
@Composable
private fun StationPhoneLine(place: Place, lineHint: String?, store: StationPhoneStore, onDialFailed: () -> Unit) {
    val context = LocalContext.current
    val hint = lineHint?.takeIf { needsStationPhoneLookup(place.id, place.phone, it) }
    val results by store.results.collectAsState()
    // 화면이 보이는 동안만(STARTED) — 앱을 이 상세에 둔 채 백그라운드로 보내면 멈추고, 복귀하면 `resolve`가 신선도를 다시 본다.
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    if (hint != null) LaunchedEffect(place.id, hint, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) { store.keepFresh(place.name, place.lat, place.lng, hint) }
    }
    val looked = hint?.let { StationPhoneStore.key(place.name, place.lat, place.lng, it) }?.let { results[it] }
    when (val row = stationPhoneRow(place.phone, looked)) {
        is StationPhoneRow.Call -> Button(onClick = { if (!context.dial(row.phone)) onDialFailed() }, Modifier.tapTarget().testTag("call")) {
            Text(appLocalized(context.resources, if (row.representative) R.string.android_place_callRepresentativeLine else R.string.android_place_callLine, row.phone))
        }
        StationPhoneRow.Error -> BodyLine(stringResource(R.string.android_station_phoneError), "call-error")
        StationPhoneRow.None -> Unit
    }
}

/** 다이얼러로 번호를 연다(통화 권한 불필요). 받는 앱이 없으면 false — 호출부가 통지한다(경유역 로터도 같은 창구, E45). */
fun Context.dial(phone: String): Boolean = try {
    startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + phone.replace("-", ""))))
    true
} catch (_: android.content.ActivityNotFoundException) {
    false
}

/** "물어보기" 버튼의 testTag이자 pop 복귀 키(M6 spec §7). */
const val CHAT_RETURN_KEY = "chat"
