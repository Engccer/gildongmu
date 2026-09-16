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
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import space.dodoplanet.gildongmu.AppConfig
import space.dodoplanet.gildongmu.a11y.landingTarget
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.a11y.AppScreenScaffold
import space.dodoplanet.gildongmu.a11y.StatusLine
import space.dodoplanet.gildongmu.a11y.headingText
import space.dodoplanet.gildongmu.a11y.mergedRow
import space.dodoplanet.gildongmu.a11y.tapTarget
import space.dodoplanet.gildongmu.directions.DirectionsPrefill
import space.dodoplanet.gildongmu.directions.DirectionsPrefillRole
import space.dodoplanet.gildongmu.i18n.AppLocale
import space.dodoplanet.gildongmu.i18n.appLocalized
import space.dodoplanet.gildongmu.kit.RouteDestination
import space.dodoplanet.gildongmu.kit.bilingualName
import space.dodoplanet.gildongmu.kit.pickCategory
import space.dodoplanet.gildongmu.nearby.NearbyKind
import space.dodoplanet.gildongmu.nearby.PlaceAnchor
import space.dodoplanet.gildongmu.nearby.kindTitle

/** 화면이 요청하는 이동. `returnFocus`는 pop 복귀 착지 키(앵커 버튼). */
class PlaceNav(val onBack: () -> Unit, val onOpenNearby: (NearbyKind, PlaceAnchor) -> Unit, val onOpenDirections: (DirectionsPrefill) -> Unit)

/**
 * 장소 상세(spec §3-2, iOS `PlaceDetailView` 대응). 정보 정본은 텍스트 리스트(지도 없음). 실주행은 딥링크 위임. 읽기 순서 = 표 순서.
 * "이 장소에 관해 물어보기"(M6)·안내 중 목적지 변경(M4)은 아래 주석 자리에 그 마일스톤이 넣는다.
 */
@Composable
fun PlaceDetailScreen(factory: ViewModelProvider.Factory, nav: PlaceNav, takeReturnFocus: () -> String?, domain: PlaceDomain? = null) {
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
    val anchorFocus = remember { mutableMapOf<NearbyKind, FocusRequester>() }
    val title = bilingualName(lang, place.name, en = null, roman = place.nameRoman)
    val displayCategory = pickCategory(lang, place.category, place.categoryEn)
    val dest = RouteDestination(place.lat, place.lng, place.name)
    val anchor = PlaceAnchor(place.lat, place.lng, place.name, place.nameRoman)

    // 진입 착지 = 제목 헤딩("뒤로, 버튼"부터 들리는 것을 막는다, §9-6 판정 뒤 제거 가능). pop 복귀면 눌렀던 앵커 버튼으로.
    // 복귀 키 소비는 효과 안에서 한 번(컴포지션 본문에서 부르면 재구성마다 유실돼 제목으로 덮인다).
    LaunchedEffect(Unit) {
        val key = takeReturnFocus()
        withFrameNanos { }
        val kind = key?.removePrefix("anchor-")?.let { k -> NearbyKind.entries.firstOrNull { it.name == k } }
        val target = kind?.let { anchorFocus[it] } ?: titleFocus
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
            // 2. 분류
            if (displayCategory.isNotEmpty()) Text(displayCategory, Modifier.fillMaxWidth().mergedRow("category").padding(vertical = 8.dp))
            // 3~8. 주소 줄 + 그 줄 전용 복사 버튼(보유한 주소만 — 빈 주소 = 죽은 버튼)
            AddressLine(place.roadAddress, R.string.android_place_roadAddressLine, "road", R.string.place_copyRoadAddress, ::copy)
            AddressLine(place.address, R.string.android_place_jibunAddressLine, "jibun", R.string.place_copyJibunAddress, ::copy)
            AddressLine(place.englishAddress ?: "", R.string.android_place_englishAddressLine, "english", R.string.place_copyEnglishAddress, ::copy)
            // 9. 영업시간(E24) — 전화 앞. 조용히 나타난다.
            hoursLine?.let { Text(it, Modifier.fillMaxWidth().mergedRow("hours").padding(vertical = 8.dp)) }
            // 10. 전화 걸기(다이얼러, 통화 권한 불필요)
            place.phone?.takeIf { it.isNotEmpty() }?.let { phone ->
                Button(
                    onClick = { if (!context.dial(phone)) vm.onOpenFailed() },
                    Modifier.tapTarget().testTag("call"),
                ) { Text(appLocalized(res, R.string.android_place_callLine, phone)) }
            }
            // 11. 홈페이지 — 카카오 장소의 link는 카카오맵 상세라 아래 장소 정보와 중복(숨김). http/https만.
            val homepage = place.link?.takeIf { vm.kakaoPlaceId == null && (it.startsWith("http://") || it.startsWith("https://")) }
            homepage?.let { url ->
                Button(onClick = { context.openWithFallback(OpenPlan(url, null)) { vm.onOpenFailed() } }, Modifier.tapTarget().testTag("homepage")) { Text(stringResource(R.string.place_homepage)) }
            }
            // [M6] 이 장소에 관해 물어보기
            // 12. 길찾기 헤딩
            Text(stringResource(R.string.android_route_section), Modifier.fillMaxWidth().mergedRow("route-heading").headingText().padding(top = 12.dp, bottom = 4.dp), style = MaterialTheme.typography.titleMedium)
            // 13~14. 길찾기 탭 프리필(M3 계약 `directions/DirectionsPrefill`). 두 버튼은 별개 객체 — 라벨이 각각 동작의 범위를 말한다.
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
            // 13~15. 외부 지도(빌더 null = 권역 밖 → 숨김)
            naverRoutePlan(dest, AppConfig.APP_IDENTIFIER)?.let { plan ->
                Button(onClick = { context.openWithFallback(plan) { vm.onOpenFailed() } }, Modifier.tapTarget().testTag("naver")) { Text(stringResource(R.string.android_route_naver)) }
            }
            kakaoRoutePlan(dest)?.let { plan ->
                Button(onClick = { context.openWithFallback(plan) { vm.onOpenFailed() } }, Modifier.tapTarget().testTag("kakao")) { Text(stringResource(R.string.android_route_kakao)) }
            }
            vm.kakaoPlaceId?.let { id ->
                Button(onClick = { context.openWithFallback(kakaoPlacePlan(id)) { vm.onOpenFailed() } }, Modifier.tapTarget().testTag("kakaoPlace")) { Text(stringResource(R.string.android_route_kakaoPlace)) }
            }
            // 16~19. 이 장소 주변(앵커 4행, iOS 순서 — 이용 빈도순)
            Text(stringResource(R.string.android_place_nearbyHeading), Modifier.fillMaxWidth().mergedRow("nearby-heading").headingText().padding(top = 12.dp, bottom = 4.dp), style = MaterialTheme.typography.titleMedium)
            for (kind in listOf(NearbyKind.subway, NearbyKind.bus, NearbyKind.bike, NearbyKind.conditions)) {
                Button(
                    onClick = { nav.onOpenNearby(kind, anchor) },
                    Modifier.fillMaxWidth().tapTarget().testTag("anchor-${kind.name}").landingTarget(anchorFocus.getOrPut(kind) { FocusRequester() }),
                ) { Text(stringResource(kindTitle(kind))) }
            }
            // 20~. 역이면 역 정보·실시간 도착·첫차 막차·교통약자 시설이 자동 등장(조용히 나타남, spec §12-3). "이 장소 주변" 다음인 이유는 iOS 주석 —
            // 역 섹션은 전부 인라인 전개라 앞에 두면 선형 주파로 앵커 4행에 닿는 비용이 수백 행으로 뒤집힌다.
            station?.let { StationSectionsView(it) }
            // 무장애 편의시설도 자동 등장(조용히 나타남, 역 여부 무관) — 마지막.
            barrierFree?.let { BarrierFreeSection(it) }
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

private fun Context.dial(phone: String): Boolean = try {
    startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + phone.replace("-", ""))))
    true
} catch (_: android.content.ActivityNotFoundException) {
    false
}
