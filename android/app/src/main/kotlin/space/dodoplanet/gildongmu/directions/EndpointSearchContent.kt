package space.dodoplanet.gildongmu.directions

import android.util.Log
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.clearText
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.a11y.AppScreenScaffold
import space.dodoplanet.gildongmu.a11y.landingTarget
import space.dodoplanet.gildongmu.a11y.StatusLine
import space.dodoplanet.gildongmu.a11y.requesterFor
import space.dodoplanet.gildongmu.a11y.tapTarget
import space.dodoplanet.gildongmu.a11y.pinnedMoves
import space.dodoplanet.gildongmu.a11y.reorderCustomActions
import space.dodoplanet.gildongmu.a11y.rememberMovedRowLanding
import space.dodoplanet.gildongmu.a11y.reorderLabels
import space.dodoplanet.gildongmu.chat.DictationControls
import space.dodoplanet.gildongmu.chat.dictationNoticeText
import space.dodoplanet.gildongmu.chat.rememberDictation
import space.dodoplanet.gildongmu.i18n.AppLocale
import space.dodoplanet.gildongmu.kit.bilingualName
import space.dodoplanet.gildongmu.kit.joinText
import androidx.compose.ui.platform.LocalFocusManager
import kotlinx.coroutines.delay

/**
 * 끝점 검색(spec §3-2, iOS `DirectionsEndpointSearchView` 대응). 폼을 덮는 모달 콘텐츠 — 상단 바의 뒤로 버튼이 닫기(취소)이고
 * 진입 착지는 검색 입력, 후보 도착은 첫 후보. 받아쓰기는 검색 버튼 뒤(B22 ②, iOS 마이크 행 동형 — 탭 토글): 전사를 다듬어 입력에 넣고
 * 원문을 통지한 뒤 바로 후보 검색, 후보 수 통지는 `submitCandidates`가 낸다. 포커스는 옮기지 않는다(선택은 후보 목록 스와이프, iOS 동형).
 * `stationsOnly`(기본값 없음, 잘못 내림 복구의 역 검색): 장소만 고를 수 있으니 현재 위치 버튼·최근 장소·주소 후보 줄을 그리지 않는다(셋 다 종류를 몰라 늘 거절된다, iOS `stationsOnlyView`).
 */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun EndpointSearchContent(picker: EndpointPicker, p: EndpointSearchState, onBack: () -> Unit, titleOverride: String?, stationsOnly: Boolean) {
    val res = LocalContext.current.resources
    val lang = remember(res) { AppLocale.current(res) }
    val strings = remember(res) { resourceStrings(res) }
    val fieldFocus = remember { FocusRequester() }
    val searchButtonFocus = remember { FocusRequester() }
    val firstCandidateFocus = remember { FocusRequester() }
    val firstCandidateBring = remember { BringIntoViewRequester() }
    val recentFocus = remember { mutableMapOf<String, FocusRequester>() }
    var pendingRecentLanding by remember { mutableStateOf<String?>(null) }
    val searchingLabel = strings.get("android.search.searching")
    // 역 칸·지금 탄 열차 역 검색은 최근·주소·현재 위치 줄을 그리지 않는다 — 호출자 지정(`stationsOnly`, 잘못 내림 복구)과 모드(`p.stationsOnlyMode`)가 같은 줄 구성을 쓴다.
    val stationsOnlyView = stationsOnly || p.stationsOnlyMode
    val selectable = p.selectablePlaces
    val others = p.otherPlaces
    val dictation = rememberDictation(
        onTranscript = picker::submitVoice,
        onNotice = { picker.postNotice(dictationNoticeText(res, it)) },
    )

    // 진입 착지 = 검색 입력(커서가 최상단에 머물면 필드까지 스와이프해 내려가야 한다는 실기기 확인).
    LaunchedEffect(Unit) {
        withFrameNanos { }
        runCatching { fieldFocus.requestFocus() }.onFailure { Log.w("EndpointSearch", "입력 착지 실패", it) }
    }
    // 「지하철역 검색」으로 모드가 바뀌면 이 행이 사라지므로 커서를 검색 입력으로 옮긴다(iOS `landAboardSearchField` — 행이 사라지면 커서가 최상단으로 떨어진다).
    // 누른 행이 사라지면 시스템이 커서를 시트 위쪽(「뒤로」)에 놓고, 입력이 이미 포커스를 쥐었으면 다시 요청해도 커서가 오지 않는다(한소네 실측) —
    // 비우고 간격을 둔 뒤 준다(`MovedRowLanding` 관용구).
    val focusManager = LocalFocusManager.current
    LaunchedEffect(p.aboardMode) {
        if (!p.aboardMode) return@LaunchedEffect
        withFrameNanos { }
        focusManager.clearFocus()
        delay(ABOARD_FIELD_GAP_MS)
        runCatching { fieldFocus.requestFocus() }.onFailure { Log.w("EndpointSearch", "지금 탄 열차 입력 착지 실패", it) }
    }
    // 후보 도착 시 첫 후보 착지(M1 첫 결과 관용구). 통지가 착지 라벨에 잘리는 것은 iOS와 같이 수용.
    LaunchedEffect(p.candidateRevision) {
        if (p.candidateRevision > picker.consumedCandidateRevision) {
            picker.consumedCandidateRevision = p.candidateRevision
            if (selectable.isNotEmpty() || p.stops.isNotEmpty() || others.isNotEmpty() || (!stationsOnlyView && p.addresses.isNotEmpty())) {
                withFrameNanos { }
                // 받아쓰기 줄이 서며 작은 화면에서는 첫 후보가 화면 밖이다 — 먼저 스크롤해야 한소네 커서가 포커스를 따른다(검색 화면과 같음).
                runCatching { firstCandidateBring.bringIntoView() }.onFailure { Log.w("EndpointSearch", "첫 후보 스크롤 실패", it) }
                runCatching { firstCandidateFocus.requestFocus() }.onFailure { Log.w("EndpointSearch", "첫 후보 착지 실패", it) }
            }
        }
    }
    LaunchedEffect(pendingRecentLanding) {
        val target = pendingRecentLanding ?: return@LaunchedEffect
        withFrameNanos { }
        recentFocus[target]?.let { r -> runCatching { r.requestFocus() }.onFailure { Log.w("EndpointSearch", "최근 장소 착지 실패", it) } }
        pendingRecentLanding = null
    }

    val title = titleOverride ?: when (p.target) {
        DirectionsFieldTarget.from -> if (p.aboardMode) strings.get("android.journey.aboardStationField") else strings.get("directions.searchFrom")
        DirectionsFieldTarget.to -> strings.get("directions.searchTo")
        DirectionsFieldTarget.via -> strings.get("directions.searchVia")
        DirectionsFieldTarget.manualLocation -> strings.get("manualLocation.pickTitle")
        DirectionsFieldTarget.transfer -> strings.get("android.journey.addMenu")
        DirectionsFieldTarget.boardStation -> strings.get("android.journey.boardField")
        DirectionsFieldTarget.alightStation -> strings.get("android.journey.alightField")
    }

    AppScreenScaffold(title, onBack = onBack) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .semantics { testTagsAsResourceId = true },
        ) {
            TextField(
                state = p.queryState,
                lineLimits = TextFieldLineLimits.SingleLine,
                label = { Text(strings.get("search.label")) },
                placeholder = { Text(if (p.aboardMode) strings.get("android.journey.aboardStationField") else strings.get("android.search.prompt")) },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                // 단일행 필드의 하드웨어 Enter도 이 경로로 온다(M1 판정) — 별도 키 폴백은 이중 제출.
                onKeyboardAction = { if (!p.isSearching) picker.submitCandidates() },
                trailingIcon = if (p.queryState.text.isNotEmpty()) {
                    {
                        IconButton(onClick = { p.queryState.clearText(); fieldFocus.requestFocus() }, modifier = Modifier.testTag("ep-clear")) {
                            Icon(Icons.Filled.Close, contentDescription = strings.get("search.clear"))
                        }
                    }
                } else null,
                modifier = Modifier.fillMaxWidth().testTag("ep-query").landingTarget(fieldFocus),
            )
            Button(
                onClick = { if (!p.isSearching) picker.submitCandidates() },
                modifier = Modifier
                    .tapTarget()
                    .testTag("ep-submit")
                    .landingTarget(searchButtonFocus)
                    .semantics { if (p.isSearching) stateDescription = searchingLabel },
            ) { Text(strings.get("search.button")) }
            if (dictation != null) {
                DictationControls(dictation, onNoApp = { picker.postNotice(res.getString(R.string.android_common_noAppToOpen)) }, tag = "ep-dictation")
            }

            // 출발지에서는 "현재 위치 사용"이 GPS 선택을, 수동 위치 지정에서는 지정 해제를 뜻한다. 도착지는 스왑이 담당하고 경유지는 장소만.
            if (!stationsOnlyView) when (p.target) {
                DirectionsFieldTarget.from -> Button(onClick = picker::selectCurrent, modifier = Modifier.tapTarget().testTag("ep-current")) { Text(strings.get(if (p.revertsManualLocation) "manualLocation.useGps" else "directions.useCurrentLocation")) }
                DirectionsFieldTarget.manualLocation -> Button(onClick = picker::selectCurrent, modifier = Modifier.tapTarget().testTag("ep-current")) { Text(strings.get("manualLocation.useGps")) }
                DirectionsFieldTarget.to, DirectionsFieldTarget.via, DirectionsFieldTarget.transfer,
                DirectionsFieldTarget.boardStation, DirectionsFieldTarget.alightStation -> Unit
            }
            // 지금 탄 열차에서 출발(E71): 「현재 위치 사용」 바로 다음 행. 여정 입력이 설 때만(`aboardOffered`) 있고, 누르면 이 시트가 지하철역만 받는 검색으로 바뀐다.
            if (p.aboardOffered && !p.aboardMode) {
                Button(onClick = picker::startAboardSearch, modifier = Modifier.tapTarget().testTag("ep-aboard-start")) { Text(strings.get("android.journey.aboardStart")) }
            }

            StatusLine(p.notice, Modifier.padding(vertical = 8.dp))

            if (!stationsOnlyView && !p.hasSearched && p.recentEndpoints.isNotEmpty()) {
                SectionHeading(strings.get("recent.title"))
                val pinnedLabel = strings.get("recent.pinned")
                val reorder = reorderLabels()
                // key + 옮긴 행 다시 착지(B23, a11y/ReorderActions.kt `MovedRowLanding`). 이동 셋이 작업 메뉴 맨 앞.
                val movedEndpoint = rememberMovedRowLanding { recentFocus.requesterFor(it as String) }
                for (e in p.recentEndpoints) key(e.id) {
                    val moves = pinnedMoves(p.recentEndpoints, e, { it.pinned }) { a, b -> a.id == b.id }
                    ActionRow(
                        visual = e.label, tag = "ep-recent-${e.id}", spoken = e.label,
                        state = if (e.pinned) pinnedLabel else null, pinned = e.pinned,
                        actions = reorderCustomActions(moves, reorder) { picker.moveRecentEndpoint(e, it); movedEndpoint.pending = e.id } + listOf(
                            CustomAccessibilityAction(strings.get(if (e.pinned) "recent.unpin" else "recent.pin")) { picker.togglePinRecentEndpoint(e); true },
                            CustomAccessibilityAction(strings.get("recent.delete")) {
                                val target = picker.removeRecentEndpoint(e)
                                recentFocus.remove(e.id)
                                if (target == null) searchButtonFocus.requestFocus() else pendingRecentLanding = target
                                true
                            },
                        ),
                        onClick = { picker.selectRecentEndpoint(e) },
                        modifier = Modifier.bringIntoViewRequester(movedEndpoint.bringFor(e.id)).landingTarget(recentFocus.requesterFor(e.id)),
                    )
                }
                Button(
                    onClick = {
                        recentFocus.clear()
                        picker.clearRecentEndpoints()
                        if (picker.state.value?.recentEndpoints.isNullOrEmpty()) searchButtonFocus.requestFocus()
                    },
                    modifier = Modifier.tapTarget().testTag("ep-recent-clear"),
                ) { Text(strings.get("recent.clearAll")) }
            }

            // 후보 줄 순서(iOS 동형): 역 장소 → 장소 실패 한 줄 → 정류장 → 정류장 실패·일부·정보 없음 → 기타 장소(역 칸·지금 탄 열차) → 주소(역 칸·지금 탄 열차는 없음).
            // 첫 후보에만 착지 requester — 렌더 순서와 일치하는 첫 줄이다.
            val firstIsPlace = selectable.isNotEmpty()
            val firstIsStop = !firstIsPlace && p.stops.isNotEmpty()
            val firstIsOther = !firstIsPlace && !firstIsStop && others.isNotEmpty()
            val firstModifier = Modifier.bringIntoViewRequester(firstCandidateBring).landingTarget(firstCandidateFocus)
            @Composable
            fun PlaceRow(place: space.dodoplanet.gildongmu.kit.models.Place, first: Boolean) {
                val name = bilingualName(lang, place.name, en = null, roman = place.nameRoman)
                val address = place.roadAddress.ifEmpty { place.address }
                ActionRow(
                    visual = joinText(name.display, address), spoken = joinText(name.primary, address), tag = "ep-place-${place.id}",
                    onClick = { picker.selectPlace(place) },
                    modifier = if (first) firstModifier else Modifier,
                )
            }
            selectable.forEachIndexed { index, place -> PlaceRow(place, first = index == 0) }
            if (p.showsPlacesFailure) TextRow(strings.get("directions.candidateError"), "ep-places-failed")
            p.stops.forEachIndexed { index, row ->
                // 한 줄 = 한 객체: 이름, 「정류장」, 거리(기준점이 없으면 거리 조각 없음).
                ActionRow(
                    visual = stopRowText(row, strings), tag = "ep-stop-${row.id}",
                    onClick = { picker.selectStop(row) },
                    modifier = if (firstIsStop && index == 0) firstModifier else Modifier,
                )
            }
            if (p.stopsFailed) TextRow(strings.get("android.journey.stopSearchFailed"), "ep-stops-failed")
            if (p.stopsTruncated) TextRow(strings.get("android.journey.stopSearchTruncated"), "ep-stops-truncated")
            if (p.showsNoBusData) TextRow(strings.get("android.common.unavailableHere.noBusData"), "ep-no-bus-data")
            others.forEachIndexed { index, place -> PlaceRow(place, first = firstIsOther && index == 0) }
            if (!stationsOnlyView) p.addresses.forEachIndexed { index, address ->
                val name = bilingualName(lang, address.roadAddr, en = address.engAddr, roman = null)
                ActionRow(
                    visual = name.display, spoken = name.primary, tag = "ep-address-${address.roadAddr}",
                    onClick = { picker.selectAddress(address) },
                    modifier = if (index == 0 && selectable.isEmpty() && p.stops.isEmpty() && others.isEmpty()) firstModifier else Modifier,
                )
            }
        }
    }
}

/** 「지하철역 검색」 뒤 입력 착지: 비운 상태가 접근성 이벤트로 한 번 나갈 만큼. */
private const val ABOARD_FIELD_GAP_MS = 250L
