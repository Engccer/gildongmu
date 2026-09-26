package space.dodoplanet.gildongmu.guide.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import space.dodoplanet.gildongmu.AppConfig
import space.dodoplanet.gildongmu.a11y.BodyLine
import space.dodoplanet.gildongmu.a11y.HeadingLine
import space.dodoplanet.gildongmu.a11y.LocalModalOpen
import space.dodoplanet.gildongmu.a11y.landingTarget
import space.dodoplanet.gildongmu.a11y.mergedRow
import space.dodoplanet.gildongmu.a11y.tapTarget
import space.dodoplanet.gildongmu.directions.DirectionsFieldTarget
import space.dodoplanet.gildongmu.directions.EndpointPicker
import space.dodoplanet.gildongmu.directions.EndpointSearchContent
import space.dodoplanet.gildongmu.directions.Strings
import space.dodoplanet.gildongmu.directions.resourceStrings
import space.dodoplanet.gildongmu.guide.GuideFormSync
import space.dodoplanet.gildongmu.guide.GuideMode
import space.dodoplanet.gildongmu.guide.GuideSession
import space.dodoplanet.gildongmu.guide.GuideText
import space.dodoplanet.gildongmu.guide.SessionEndKind
import space.dodoplanet.gildongmu.guide.WalkGuideUiState
import space.dodoplanet.gildongmu.i18n.AppLocale
import space.dodoplanet.gildongmu.kit.BeaconDest
import space.dodoplanet.gildongmu.kit.DirectionsEndpoint
import space.dodoplanet.gildongmu.kit.RecentSearchStore
import space.dodoplanet.gildongmu.kit.SearchService
import space.dodoplanet.gildongmu.kit.WalkHealth
import space.dodoplanet.gildongmu.kit.guideDestinationPlace
import space.dodoplanet.gildongmu.kit.joinText
import space.dodoplanet.gildongmu.kit.models.Place
import space.dodoplanet.gildongmu.kit.spokenDistanceUnits
import space.dodoplanet.gildongmu.nearby.SceneButtonSection
import space.dodoplanet.gildongmu.storage.SharedPreferencesStore

/** 안내 시트가 앱 골격에 요청하는 이동 둘 — 설정(E31 체중)·장소 상세 중첩(M4b). `AppRoot`가 NavController로 채운다. */
class GuideNav(
    val onOpenSettings: () -> Unit,
    /** 장소 상세 push(`openGuidePlace`) — 시트 최소화·재개·재개 착지(`returnTo`)는 그쪽 몫. */
    val onOpenPlace: (place: Place, showsDirectionsEntry: Boolean, returnTo: String) -> Unit,
)

/**
 * 안내 시트(spec §7-3~§7-5, iOS `BeaconTrackingSheet` 도보부). 시트를 내리는 제스처(뒤로·바깥 탭·스와이프)는 **최소화**이고 종료는
 * 최하단 고정 버튼뿐(N1). live region이 없다(§5-3 — 문장은 TTS 한 채널). 착지: 진입 = 제목, 띠바 복귀 = 접기 버튼, 재조회 소멸 =
 * 제목, 조망 닫힘 = 진행 상황 버튼, 도착 전이 = 종료 문장. 텍스트 행은 `mergedRow`, 버튼은 `landingTarget`.
 * 안내 중 변경(M4b spec 2026-09-27 §4): 조망·대안 프리뷰·끝점 검색은 **같은 시트 안의 페이지**다(시트는 자기 윈도라 그 위에 시트를 또 올리는 것보다
 * TalkBack 스코프를 한 곳에 가둔다). 장소 상세만 스택 화면(시트를 접고 push → 복귀 시 재개).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GuideSheet(ui: WalkGuideUiState, strings: Strings, nav: GuideNav) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = { GuideSession.isMinimized = true }, sheetState = sheetState, dragHandle = null) {
        if (ui.arrivalDest != null) EndScreen(ui, strings, nav) else TrackingContent(ui, strings, nav)
    }
}

/** 시트 안 페이지(M4b §4). 뒤로는 한 단계 위로. */
private sealed interface GuidePage {
    data object Tracking : GuidePage
    data object Overview : GuidePage
    data object AltPreview : GuidePage
    data class Search(val target: DirectionsFieldTarget) : GuidePage
}

/** 제목 메뉴 항목(iOS `GuideTitleMenu` — 장소 상세 → 목적지 바꾸기). 순서가 읽기 순서다(순수 함수로 잠근다). */
enum class GuideTitleMenuItem(val key: String, val tag: String) {
    detail("android.guide.destMenuDetail", "guide-menu-detail"),
    change("android.guide.destMenuChange", "guide-menu-change"),
}

fun guideTitleMenuItems(): List<GuideTitleMenuItem> = listOf(GuideTitleMenuItem.detail, GuideTitleMenuItem.change)

@Composable
private fun TrackingContent(ui: WalkGuideUiState, strings: Strings, nav: GuideNav) {
    val meters = strings.get("android.unit.spokenMeters")
    val titleFocus = remember { FocusRequester() }
    val minimizeFocus = remember { FocusRequester() }
    val progressFocus = remember { FocusRequester() }
    val viewAltFocus = remember { FocusRequester() }
    val sceneFocus = remember { mutableMapOf<String, FocusRequester>() }
    val requesterFor: (String) -> FocusRequester = { key -> if (key == GUIDE_TITLE_RETURN) titleFocus else sceneFocus.getOrPut(key) { FocusRequester() } }
    var page by remember { mutableStateOf<GuidePage>(GuidePage.Tracking) }
    var reroutePressed by remember { mutableStateOf(false) }
    // 착지 요청 세대(페이지가 바뀐 뒤 그 페이지의 요소가 컴포지션에 올라온 다음 대입한다).
    var landTitleSeq by remember { mutableIntStateOf(0) }
    var landProgressSeq by remember { mutableIntStateOf(0) }
    var landViewAltSeq by remember { mutableIntStateOf(0) }
    val toTracking: () -> Unit = { page = GuidePage.Tracking; landTitleSeq += 1 }

    BackHandler(enabled = page != GuidePage.Tracking) {
        when (page) {
            GuidePage.AltPreview -> { page = GuidePage.Overview; landViewAltSeq++ }
            GuidePage.Overview -> { page = GuidePage.Tracking; landProgressSeq++ }
            is GuidePage.Search -> toTracking()
            GuidePage.Tracking -> Unit
        }
    }

    LaunchedEffect(Unit) {
        val back = GuideSession.pendingSheetReturn
        when {
            GuideSession.returnedFromBand -> { GuideSession.returnedFromBand = false; land(minimizeFocus, "접기 버튼") }
            // 돌아온 자리의 행이 없으면(앵커가 바뀌어 장면이 새로 시작됐다) 제목으로 물러난다 — 없는 키에 착지하면 커서가 어디에도 가지 않는다.
            back != null -> { GuideSession.pendingSheetReturn = null; land(sceneFocus[back] ?: titleFocus, "장소 상세 복귀") }
            else -> land(titleFocus, "시트 제목")
        }
    }
    // 재조회 성공·자동 채택으로 버튼이 사라지면 제목 착지(포커스를 쥔 컨트롤 소멸) — **전이**(true→false)에만. 컴포지션 진입에 걸면
    // 자동 채택을 한 번 겪은 세션은 시트를 펼칠 때마다 착지가 둘로 갈린다.
    var wasOffRoute by remember { mutableStateOf(ui.offRoute) }
    LaunchedEffect(ui.offRoute) {
        val ended = wasOffRoute && !ui.offRoute
        wasOffRoute = ui.offRoute
        if (ended && (reroutePressed || ui.offRouteEndedByReroute) && page == GuidePage.Tracking) { reroutePressed = false; land(titleFocus, "시트 제목(재조회)") }
    }
    // 대안 채택 성공(iOS `variantAdoptedSeq`): 조망·프리뷰가 통째로 사라지는 전이 — 제목으로 선점한다. 컴포지션 진입 값은 착지하지 않는다(전이에만).
    // 프리뷰가 사용자 조작 밖에서 비워지면(자동 채택·경유지 도착·최종 접근 — 원인 쪽이 이미 통지했다) 조망으로 물러나 [대안 경로 보기]에, 조망도 사라졌으면
    // 제목에 착지한다(iOS는 헤더가 "조회 중"에 갇히는 잠재 결함 — 옮기지 않는다, 설계 리뷰 #3). 두 신호는 모델의 한 동기 블록에서 바뀌므로 한 번에 본다.
    var seenAdopted by remember { mutableIntStateOf(ui.variantAdoptedSeq) }
    var wasAltOpen by remember { mutableStateOf(ui.altPreviewOpen) }
    LaunchedEffect(ui.variantAdoptedSeq, ui.altPreviewOpen) {
        val adopted = ui.variantAdoptedSeq != seenAdopted
        val dropped = wasAltOpen && !ui.altPreviewOpen && page == GuidePage.AltPreview
        seenAdopted = ui.variantAdoptedSeq
        wasAltOpen = ui.altPreviewOpen
        when {
            adopted -> if (page == GuidePage.Overview || page == GuidePage.AltPreview) toTracking()
            dropped -> if (ui.routeStepDescriptions != null) { page = GuidePage.Overview; landViewAltSeq++ } else toTracking()
        }
    }
    LaunchedEffect(landTitleSeq) { if (landTitleSeq > 0) land(titleFocus, "시트 제목") }
    LaunchedEffect(landProgressSeq) { if (landProgressSeq > 0) land(progressFocus, "진행 상황 버튼") }
    LaunchedEffect(landViewAltSeq) { if (landViewAltSeq > 0) land(viewAltFocus, "대안 경로 보기 버튼") }

    when (val p = page) {
        GuidePage.Overview -> {
            OverviewPage(ui, strings, viewAltFocus, onViewAlternative = { page = GuidePage.AltPreview }, onClose = { page = GuidePage.Tracking; landProgressSeq++ })
            return
        }
        GuidePage.AltPreview -> {
            AltPreviewPage(ui, strings, onClose = { page = GuidePage.Overview; landViewAltSeq++ })
            return
        }
        is GuidePage.Search -> {
            SearchPage(p.target, onDone = toTracking)
            return
        }
        GuidePage.Tracking -> Unit
    }
    Column(Modifier.fillMaxSize()) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f)) {
                    GuideTitleMenu(
                        title = joinText(strings.get("beacon.walkHeading"), ui.destinationLabel),
                        strings = strings,
                        focus = titleFocus,
                        onSelect = { item ->
                            when (item) {
                                GuideTitleMenuItem.detail -> ui.dest?.let { nav.onOpenPlace(guideDestinationPlace(it, ui.destinationLabel), false, GUIDE_TITLE_RETURN) }
                                GuideTitleMenuItem.change -> page = GuidePage.Search(DirectionsFieldTarget.to)
                            }
                        },
                        onDismissWithoutChoice = { landTitleSeq++ },
                    )
                }
                IconButton(onClick = { GuideSession.isMinimized = true }, modifier = Modifier.size(48.dp).landingTarget(minimizeFocus).testTag("guide-minimize")) {
                    Icon(Icons.Filled.KeyboardArrowDown, contentDescription = strings.get("guide.minimize"))
                }
            }
            // 경유지(N4, iOS 위원장 판정: 목적지 메뉴와 진행 상황 사이) — 라벨이 곧 상태. ko 전용(상세 조회가 없는 로케일엔 두지 않는다).
            if (GuideSession.walk.waypointAvailable()) {
                val waypoint = ui.waypointLabel
                Button(
                    onClick = { page = GuidePage.Search(DirectionsFieldTarget.via) },
                    modifier = Modifier.fillMaxWidth().tapTarget().testTag("guide-waypoint"),
                ) { Text(if (waypoint != null) strings.get("android.guide.waypointChange", waypoint) else strings.get("directions.addVia")) }
                if (waypoint != null) {
                    // 누르면 자신이 사라진다 — 항상 존재하는 제목으로 선점(재조회 버튼 선례, 헌장 §5).
                    Button(
                        onClick = { if (GuideSession.walk.removeWaypoint()) landTitleSeq++ },
                        modifier = Modifier.fillMaxWidth().tapTarget().testTag("guide-waypoint-remove"),
                    ) { Text(strings.get("android.guide.waypointRemove")) }
                }
            }
            Button(
                onClick = {
                    if (ui.mode == GuideMode.detail && ui.routeStepDescriptions != null) page = GuidePage.Overview
                    else GuideSession.walk.announceProgress()
                },
                modifier = Modifier.fillMaxWidth().tapTarget().landingTarget(progressFocus).testTag("guide-progress"),
            ) { Text(strings.get("guide.progressButton")) }
            // 주변 확인 — 앵커는 목적지(도착지 부근이 어떤 모습인가를 묻는다, iOS spec §5). 펼친 결과가 아래 행을 밀지만 펼침은 방금 누른 행동이다.
            ui.dest?.let { dest ->
                SceneButtonSection(GuideSession.sceneLookup(GuideSession.SceneSlot.tracking, dest), requesterFor) { place, key -> nav.onOpenPlace(place, true, key) }
            }
            if (ui.offRoute && ui.mode == GuideMode.detail) {
                Button(
                    onClick = { reroutePressed = true; GuideSession.walk.requestReroute() },
                    modifier = Modifier.fillMaxWidth().tapTarget().testTag("guide-reroute"),
                ) { Text(strings.get(if (ui.isRerouting) "guide.rerouteBusy" else "guide.rerouteButton")) }
            }
            if (ui.mode == GuideMode.brief) BodyLine(strings.get("beacon.straightLineNote"), "guide-brief-note")
            val remaining = ui.remainingText
            if (ui.mode == GuideMode.detail && !ui.offRoute && !remaining.isNullOrEmpty()) BodyLine(remaining, "guide-remaining", spokenDistanceUnits(remaining, meters))
            if (ui.mode == GuideMode.detail) {
                ui.liveTopText?.takeIf { it.isNotEmpty() }?.let { BodyLine(it, "guide-live-top", spokenDistanceUnits(it, meters)) }
                ui.liveNextText?.takeIf { it.isNotEmpty() }?.let { BodyLine(it, "guide-live-next", spokenDistanceUnits(it, meters)) }
            }
            if (ui.statusText.isNotEmpty() && (ui.mode == GuideMode.brief || ui.liveTopText.isNullOrEmpty())) {
                val status = if (ui.statusIsNextPreview) strings.get("guide.progressNext", ui.statusText) else ui.statusText
                BodyLine(status, "guide-status", spokenDistanceUnits(status, meters))
            }
            if (ui.soundDegraded) BodyLine(strings.get("android.guide.mediaVolumeZero"), "guide-sound-volume")
            if (ui.focusDenied) BodyLine(strings.get("android.guide.focusDenied"), "guide-sound-focus")
            if (ui.ttsUnavailable) BodyLine(strings.get("android.guide.ttsUnavailable"), "guide-sound-tts")
            if (ui.isSilenced) BodyLine(strings.get("android.beacon.soundUnavailable"), "guide-sound-silenced")
        }
        Button(
            onClick = { GuideSession.walk.stopByUser() },
            modifier = Modifier.fillMaxWidth().padding(16.dp).tapTarget().testTag("guide-stop"),
        ) { Text(strings.get("beacon.stop")) }
    }
}

/**
 * 제목 메뉴(iOS `GuideTitleMenu`): 제목 행이 **헤딩 + 버튼** 한 객체(라벨 = 종전 제목, 헤딩 점프 보존)이고 누르면 두 항목 메뉴. 고르지 않고 닫으면 호출부가
 * 제목으로 되돌린다(팝업이 닫힌 뒤 커서가 어디로 갈지 시스템에 맡기지 않는다). 착지 requester는 clickable의 focusable 앞.
 */
@Composable
private fun GuideTitleMenu(title: String, strings: Strings, focus: FocusRequester, onSelect: (GuideTitleMenuItem) -> Unit, onDismissWithoutChoice: () -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    val firstItemFocus = remember { FocusRequester() }
    // 메뉴가 열리면 첫 항목에 착지한다 — 팝업 윈도로 커서를 옮기는 것은 TalkBack 관례이지 보장이 아니다(설계 리뷰 #10).
    LaunchedEffect(expanded) { if (expanded) land(firstItemFocus, "제목 메뉴 첫 항목") }
    Text(
        title,
        Modifier
            .fillMaxWidth()
            .landingTarget(focus)
            .clickable(role = Role.Button) { expanded = true }
            .testTag("guide-title")
            .defaultMinSize(minHeight = 48.dp)
            .padding(top = 12.dp, bottom = 4.dp)
            .semantics(mergeDescendants = true) { heading() },
        style = MaterialTheme.typography.titleMedium,
    )
    DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false; onDismissWithoutChoice() }) {
        guideTitleMenuItems().forEachIndexed { i, item ->
            DropdownMenuItem(
                text = { Text(strings.get(item.key)) },
                onClick = { expanded = false; onSelect(item) },
                modifier = (if (i == 0) Modifier.landingTarget(firstItemFocus) else Modifier).testTag(item.tag),
            )
        }
    }
}

/**
 * 조망 페이지(§7-4, iOS `GuideOverviewSheet` 도보부): 헤더 = `progressText()`(진입 착지 — 낭독이 곧 조망 문장), 행, [대안 경로 보기](다른 줄이 있는
 * 상세 세션만, 행 목록 뒤·말미 닫기 앞 — 조망의 주 목적을 밀지 않는다), 닫기 두 곳.
 */
@Composable
private fun OverviewPage(ui: WalkGuideUiState, strings: Strings, viewAltFocus: FocusRequester, onViewAlternative: () -> Unit, onClose: () -> Unit) {
    val meters = strings.get("android.unit.spokenMeters")
    val headerFocus = remember { FocusRequester() }
    val header = remember(ui) { GuideSession.walk.progressText() }
    LaunchedEffect(Unit) { land(headerFocus, "조망 헤더") }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        Button(onClick = onClose, modifier = Modifier.fillMaxWidth().tapTarget().testTag("guide-overview-close-top")) { Text(strings.get("actions.close")) }
        HeadingLine(header, "guide-overview-header", focus = headerFocus, spoken = spokenDistanceUnits(header, meters))
        val steps = ui.routeStepDescriptions.orEmpty()
        val waypointRow = ui.routeWaypointRow
        steps.forEachIndexed { i, desc ->
            if (waypointRow != null && waypointRow.first == i) BodyLine(waypointRow.second, "guide-overview-waypoint")
            val line = if (ui.currentStepIndex == i) strings.get("android.guide.routeListCurrent", (i + 1).toString(), desc)
            else strings.get("android.guide.routeListRow", (i + 1).toString(), desc)
            BodyLine(line, "guide-overview-step-$i", spokenDistanceUnits(line, meters))
        }
        if (ui.alternativePreviewAvailable) {
            Button(onClick = onViewAlternative, modifier = Modifier.fillMaxWidth().tapTarget().landingTarget(viewAltFocus).testTag("guide-view-alternative")) {
                Text(strings.get("android.guide.viewAlternative"))
            }
        }
        Button(onClick = onClose, modifier = Modifier.fillMaxWidth().tapTarget().testTag("guide-overview-close")) { Text(strings.get("actions.close")) }
    }
}

/**
 * 대안 경로 미리 보기(iOS `WalkAlternativePreviewSheet`, spec 2026-08-14 §3·§4): 헤더(요약·비교 — 진입 착지가 낭독) → 전환(준비됨에서만, 이 화면의 결정
 * 행동이라 헤더 다음 한 스와이프) → 단계 → 닫기. 결과 도착은 모델의 polite 통지 1회, 헤더는 조용히 갱신된다. 페이지가 어떤 경로로든 사라지면
 * (닫기·뒤로·채택·도착·최소화) 진행 중 조회를 폐기한다(latest-wins).
 */
@Composable
private fun AltPreviewPage(ui: WalkGuideUiState, strings: Strings, onClose: () -> Unit) {
    val meters = strings.get("android.unit.spokenMeters")
    val headerFocus = remember { FocusRequester() }
    val header = remember(ui) { GuideSession.walk.altPreviewHeaderText() }
    DisposableEffect(Unit) {
        GuideSession.walk.openAlternativePreview()
        onDispose { GuideSession.walk.closeAlternativePreview() }
    }
    LaunchedEffect(Unit) { land(headerFocus, "대안 프리뷰 헤더") }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        HeadingLine(header, "guide-alt-header", focus = headerFocus, spoken = spokenDistanceUnits(header, meters))
        if (ui.altPreviewReady) {
            // 낡음 폴백 재조회 중엔 라벨 병기(한 줄 = 한 객체, 쉼표).
            val adopt = strings.get("android.guide.adoptAlternative")
            Button(onClick = { GuideSession.walk.adoptAlternativePreview() }, modifier = Modifier.fillMaxWidth().tapTarget().testTag("guide-alt-adopt")) {
                Text(if (ui.isSwitchingVariant) joinText(adopt, strings.get("android.directions.searching")) else adopt)
            }
        }
        // "지금 이 구간" 표식 없음 — 대안 경로 위에 현재 위치가 없다.
        ui.altPreviewSteps?.forEachIndexed { i, desc ->
            val line = strings.get("android.guide.routeListRow", (i + 1).toString(), desc)
            BodyLine(line, "guide-alt-step-$i", spokenDistanceUnits(line, meters))
        }
        Button(onClick = onClose, modifier = Modifier.fillMaxWidth().tapTarget().testTag("guide-alt-close")) { Text(strings.get("actions.close")) }
    }
}

/**
 * 끝점 검색 페이지(M4b §4.3): `EndpointSearchContent`를 그대로 쓴다. 확정은 대상별 모델 함수 → 세션에 반영됐을 때만 폼 동기화 게시(`GuideFormSync`) →
 * 제목으로. 열린 동안 안내 출력을 억제한다(iOS 검색 시트 동형 — TalkBack 입력 반향과 안내 TTS가 겹친다; 보류된 실행 안내는 해제 때 복구 발화). 해제는
 * `onDispose` — 도착으로 페이지가 통째로 사라져도 풀린다.
 */
@Composable
private fun SearchPage(target: DirectionsFieldTarget, onDone: () -> Unit) {
    val context = LocalContext.current
    val res = context.resources
    val scope = rememberCoroutineScope()
    val picker = remember {
        EndpointPicker(
            search = SearchService(AppConfig.apiClient),
            store = RecentSearchStore(SharedPreferencesStore(context.applicationContext)),
            strings = resourceStrings(res),
            io = Dispatchers.IO,
            scope = scope,
            dataLocale = { AppLocale.dataLocale(res) },
            ranking = { null },   // 근접 가중치일 뿐 — 세션 fix는 모델 밖으로 내지 않는다
            closesOnSelect = true,
        ) { endpoint, field -> onDone(); commitGuideEndpoint(endpoint, field) }
    }
    val state by picker.state.collectAsState()
    // 이 페이지의 상태 줄은 검색 화면 통지(후보 수·좌표 실패) 전용이다 — 앱 통지(`AppNotices`)를 집지 않는다(설계 리뷰 #1: 시트 윈도와 밑 탭이 둘 다
    // RESUMED라 소유자가 둘이 되고, 집으면 "위치 해제"가 후보 수와 한 문장으로 붙는다). 앱 통지는 시트가 닫힌 뒤 밑 화면이 집는다.
    DisposableEffect(Unit) {
        val owner = Any()
        picker.open(target)
        GuideSession.setOutputSuppressed(true, owner)
        onDispose {
            picker.close()
            GuideSession.setOutputSuppressed(false, owner)
        }
    }
    // 시트는 IME를 밀어 올리지 않는다 — 입력 착지와 함께 뜨는 키보드가 후보·상태 줄을 가리지 않게(비-TalkBack 사용자).
    CompositionLocalProvider(LocalModalOpen provides true) {
        Box(Modifier.fillMaxSize().imePadding()) { state?.let { EndpointSearchContent(picker, it, onBack = onDone) } }
    }
}

/** 검색 확정 — 세션에 반영됐을 때만 폼에 보낸다(세션이 이미 죽었으면 선택을 폐기, iOS §3.2). 도착지·경유지는 장소만 온다(현재 위치 선택지가 없다). */
private fun commitGuideEndpoint(endpoint: DirectionsEndpoint, field: DirectionsFieldTarget) {
    val place = endpoint as? DirectionsEndpoint.Place ?: return
    val dest = BeaconDest(place.lat, place.lng)
    when (field) {
        DirectionsFieldTarget.to -> if (GuideSession.walk.changeDestination(dest, place.label)) GuideFormSync.post(place)
        DirectionsFieldTarget.via -> if (GuideSession.walk.setWaypoint(dest, place.label)) GuideFormSync.postWaypoint(place)
        DirectionsFieldTarget.from, DirectionsFieldTarget.manualLocation -> Unit
    }
}

/**
 * 종료 화면(§7-5): 헤딩·종료 문장(착지)·걸음·칼로리 문장(있을 때만)·체중 입력 권유 두 줄(E31 — 기본 체중 ∧ 무시 2회 미만)·주변 확인(도착·추정만 —
 * 중지 종료엔 없다, iOS 동형)·닫기. [체중 입력하기]는 시트를 접고 설정으로 간다(시트는 자기 윈도라 그 위에 설정을 띄울 수 없다). 돌아와 이 화면에
 * 다시 들어오면 요약을 다시 계산하고, 체중을 입력했으면 사라진 버튼 대신 요약 문장에, 아니면 그 버튼에 착지한다(iOS `landHealthSummaryFocus` 동형).
 * 주변 확인 행에서 장소 상세에 다녀오면 그 행에 착지한다.
 */
@Composable
private fun EndScreen(ui: WalkGuideUiState, strings: Strings, nav: GuideNav) {
    val text = remember(strings) { GuideText(strings) }
    val arrivedFocus = remember { FocusRequester() }
    val healthFocus = remember { FocusRequester() }
    val enterWeightFocus = remember { FocusRequester() }
    val sceneFocus = remember { mutableMapOf<String, FocusRequester>() }
    val requesterFor: (String) -> FocusRequester = { key -> sceneFocus.getOrPut(key) { FocusRequester() } }
    val headingKey = when (ui.endKind) {
        SessionEndKind.arrived -> "android.beacon.arrivedHeading"
        SessionEndKind.presumed -> "android.beacon.arrivedPresumedHeading"
        SessionEndKind.stopped -> "android.beacon.endedHeading"
    }
    val sentence = when (ui.endKind) {
        SessionEndKind.arrived -> strings.get("guide.arrived")
        SessionEndKind.presumed -> strings.get("guide.arrivedPresumed")
        SessionEndKind.stopped -> ui.endText
    }
    LaunchedEffect(Unit) {
        GuideSession.returnedFromBand = false   // 띠바 복귀 표식은 여기서도 소비
        val model = GuideSession.walk
        val back = GuideSession.pendingSheetReturn
        GuideSession.pendingSheetReturn = null
        if (model.takeWeightSettingsReturn()) {
            model.recomputeArrivalHealth()
            if (model.ui.value.weightPromptShown) land(enterWeightFocus, "체중 입력 버튼") else land(healthFocus, "걸음 요약")
        } else if (back != null && back != GUIDE_TITLE_RETURN) {
            land(sceneFocus[back] ?: arrivedFocus, "장소 상세 복귀")
        } else {
            land(arrivedFocus, "종료 문장")
        }
    }
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp)) {
        HeadingLine(joinText(strings.get(headingKey), ui.destinationLabel), "guide-end-title")
        Text(sentence, Modifier.fillMaxWidth().mergedRow("guide-end", focus = arrivedFocus).padding(vertical = 8.dp))
        ui.arrivalHealth?.let { health ->
            Text(text.healthLine(health, ui.weightPromptShown), Modifier.fillMaxWidth().mergedRow("guide-end-health", focus = healthFocus).padding(vertical = 8.dp))
            if (ui.weightPromptShown) {
                BodyLine(strings.get("android.beacon.healthWeightNotice", WalkHealth.defaultWeightKg.toInt()), "guide-end-weight-notice")
                Button(
                    onClick = {
                        GuideSession.walk.engageWeightPrompt()
                        GuideSession.suppressNextBandLanding = true
                        GuideSession.isMinimized = true
                        nav.onOpenSettings()
                    },
                    modifier = Modifier.fillMaxWidth().tapTarget().landingTarget(enterWeightFocus).testTag("guide-end-enter-weight"),
                ) { Text(strings.get("android.beacon.healthEnterWeight")) }
            }
        }
        val arrival = ui.arrivalDest
        if (ui.endKind != SessionEndKind.stopped && arrival != null) {
            SceneButtonSection(GuideSession.sceneLookup(GuideSession.SceneSlot.end, arrival), requesterFor) { place, key -> nav.onOpenPlace(place, true, key) }
        }
        Button(onClick = { GuideSession.walk.closeEndScreen() }, modifier = Modifier.fillMaxWidth().tapTarget().testTag("guide-end-close")) { Text(strings.get("actions.close")) }
    }
}
