package space.dodoplanet.gildongmu.guide.ui

import android.os.SystemClock
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
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
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
import space.dodoplanet.gildongmu.guide.GuideDiag
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
 * 최하단 고정 버튼뿐(N1). live region이 없다(§5-3 — 문장은 TTS 한 채널). 착지: 새로 열림·띠바 복귀·사용자 전이(재조회 성공·대안 채택·경유지
 * 삭제·목적지/경유지 검색에서 고름)·전경 복귀 = **첫 정보 행**(E57 `GuideSheetLanding`, 경로 조회와 안내 발화가 끝난 뒤), 장소 상세 복귀 = 그 자리,
 * 조망 닫힘 = 진행 상황 버튼, 고르지 않고 닫은 메뉴·검색 = 제목, 도착 전이 = 종료 문장. 텍스트 행은 `mergedRow`, 버튼은 `landingTarget`.
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

/**
 * 행이 지금 렌더되는가 — 렌더 조건의 **정본**이다(행 렌더와 착지 판정이 같은 함수를 읽는다, iOS `rowExists`의 사본 문제를 구조로 막는다). 종료
 * 화면이면 전부 거짓.
 */
fun sheetRowExists(ui: WalkGuideUiState, row: SheetRow): Boolean {
    if (!ui.isTracking || ui.arrivalDest != null) return false
    val detail = ui.mode == GuideMode.detail
    return when (row) {
        SheetRow.remaining -> detail && !ui.offRoute && !ui.remainingText.isNullOrEmpty()
        SheetRow.liveTop -> detail && !ui.liveTopText.isNullOrEmpty()
        SheetRow.status -> ui.statusText.isNotEmpty() && (!detail || ui.liveTopText.isNullOrEmpty())
        SheetRow.reroute -> detail && ui.offRoute
    }
}

@Composable
private fun TrackingContent(ui: WalkGuideUiState, strings: Strings, nav: GuideNav) {
    val meters = strings.get("android.unit.spokenMeters")
    val titleFocus = remember { FocusRequester() }
    val progressFocus = remember { FocusRequester() }
    val rowFocus = remember { SheetRow.infoRows.associateWith { FocusRequester() } }
    val sceneFocus = remember { mutableMapOf<String, FocusRequester>() }
    val requesterFor: (String) -> FocusRequester = { key -> if (key == GUIDE_TITLE_RETURN) titleFocus else sceneFocus.getOrPut(key) { FocusRequester() } }
    var page by remember { mutableStateOf<GuidePage>(GuidePage.Tracking) }
    var reroutePressed by remember { mutableStateOf(false) }
    // 착지 요청 세대(페이지가 바뀐 뒤 그 페이지의 요소가 컴포지션에 올라온 다음 대입한다).
    var landTitleSeq by remember { mutableIntStateOf(0) }
    var landProgressSeq by remember { mutableIntStateOf(0) }
    // 조망 진입 착지 = 헤더(Tracking에서 들어옴) 또는 [대안 경로 보기](프리뷰에서 돌아옴). 조망은 돌아올 때 새로 컴포즈되므로 착지를 그 진입 효과 한 곳이
    // 고른다 — 부모에 따로 착지 효과를 두면 두 착지가 갈려 헤더가 이긴다(리뷰 MAJOR, iOS는 중첩 시트라 트리거로 복원된다).
    var overviewReturnsFromPreview by remember { mutableStateOf(false) }
    // 첫 정보 행 착지(E57) — 시트 열림·띠바 복귀·사용자 전이·소실 복구·전경 복귀의 한 입구. 판정 입력은 모델의 최신 상태를 읽는다.
    val scope = rememberCoroutineScope()
    val landing = remember {
        GuideSheetLanding(
            scope = scope,
            clock = { SystemClock.elapsedRealtime() / 1000.0 },
            awaitingRoute = { GuideSession.walk.ui.value.awaitingRoute },
            announcementsSettled = { GuideSession.walk.announcementsSettled() },
            isForeground = { GuideSession.inForeground },
            isTracking = { GuideSession.walk.ui.value.let { it.isTracking && it.arrivalDest == null } },
            rowExists = { row -> page == GuidePage.Tracking && sheetRowExists(GuideSession.walk.ui.value, row) },
            // 성패는 `requestFocus(FocusDirection.Enter)`의 Boolean(`ChatLanding` 관용구) — 초점을 못 받으면 600ms 뒤 한 번 더.
            focus = { row -> runCatching { rowFocus.getValue(row).requestFocus(FocusDirection.Enter) }.getOrDefault(false) },
        )
    }
    DisposableEffect(Unit) { onDispose { landing.dispose() } }
    // 사용자 전이 뒤 시트 안 페이지가 닫히면 그 결과의 첫 정보 행으로(조망 채택·검색에서 고름 — iOS 자식 시트 onDismiss 동형). 고르지 않고 닫으면 제목.
    // 페이지가 닫히면 시스템이 커서를 새 페이지에 둔다 — 그 첫 이동 한 번은 사용자 이동으로 세지 않는다.
    val toTracking: (String?) -> Unit = { note -> page = GuidePage.Tracking; if (note != null) landing.request(note, expectsSystemPlacement = true) else landTitleSeq += 1 }

    BackHandler(enabled = page != GuidePage.Tracking) {
        when (page) {
            GuidePage.AltPreview -> { overviewReturnsFromPreview = true; page = GuidePage.Overview }
            GuidePage.Overview -> { page = GuidePage.Tracking; landProgressSeq++ }
            is GuidePage.Search -> toTracking(null)
            GuidePage.Tracking -> Unit
        }
    }

    // 스크린 리더 커서가 어느 행에 앉았는가 — 대기 중 사용자 이동·소실 복구·자동 채택 판정(시트 윈도의 초점 노드를 고정 표식으로 가린다. 표식은
    // 아래 `testTagsAsResourceId`가 리소스 id로 낸다).
    ObserveA11yFocus { tag -> landing.onA11yFocus(SheetRow.forTag(tag)?.takeIf { sheetRowExists(GuideSession.walk.ui.value, it) }) }

    // 진입 착지: 장소 상세(M4b 중첩)에서 돌아왔으면 그 자리(제목·주변 확인 행), 아니면 첫 정보 행(새로 열림·띠바 복귀 — E57 위원장 판정 Q1). 새로 열림은
    // 경로 조회 중이라 조회와 시작 요약을 기다리고, 띠바 복귀는 경로가 있어 곧장 앉는다(말하는 안내 문장이 있으면 그 끝까지).
    LaunchedEffect(Unit) {
        val back = GuideSession.pendingSheetReturn
        if (back != null) {
            GuideSession.pendingSheetReturn = null
            // 돌아온 자리의 행이 없으면(앵커가 바뀌어 장면이 새로 시작됐다) 제목으로 물러난다 — 없는 키에 착지하면 커서가 어디에도 가지 않는다.
            land(sceneFocus[back] ?: titleFocus, "장소 상세 복귀")
        } else {
            landing.request("open", expectsSystemPlacement = true)
        }
    }
    // 이탈이 끝나 재조회 버튼이 사라지면 첫 정보 행(새 경로의 남은 거리, E57) — **전이**(true→false)에만. 버튼을 눌렀거나 커서가 그 버튼 위였을 때만
    // 옮긴다(포커스를 쥔 컨트롤 소멸, 헌장 §5): 끝난 원인(재조회 성공·자동 채택·걸어서 복귀)과 무관하다 — 안드로이드는 사라진 노드 대신 커서를 둘 곳을
    // 시스템이 정하지 않는다. 다른 행을 읽던 사람은 끌어가지 않는다.
    var wasOffRoute by remember { mutableStateOf(ui.offRoute) }
    LaunchedEffect(ui.offRoute) {
        val ended = wasOffRoute && !ui.offRoute
        wasOffRoute = ui.offRoute
        if (!ended) return@LaunchedEffect
        val pressed = reroutePressed
        reroutePressed = false
        if ((pressed || landing.cursorRow == SheetRow.reroute) && page == GuidePage.Tracking) landing.request("rerouted", expectsSystemPlacement = false)
    }
    // 대안 채택 성공(iOS `variantAdoptedSeq`): 조망·프리뷰가 통째로 사라지는 전이 — 닫고 첫 정보 행으로. 조망이 이미 닫힌 뒤 채택이 끝났으면(낡음 폴백) 곧장
    // 요청한다. 컴포지션 진입 값은 착지하지 않는다(전이에만).
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
            adopted -> if (page == GuidePage.Overview || page == GuidePage.AltPreview) toTracking("variantAdopted") else if (page == GuidePage.Tracking) landing.request("variantAdopted", expectsSystemPlacement = false)
            dropped -> if (ui.routeStepDescriptions != null) { overviewReturnsFromPreview = true; page = GuidePage.Overview } else toTracking(null)
        }
    }
    // 소실 복구(E57 §3.4): 커서가 앉아 있던 정보 행이 사라지면 그 시점의 첫 정보 행으로 — 판정은 행 집합이 바뀌는 순간의 커서 행이다.
    val presentRows = SheetRow.infoRows.filter { sheetRowExists(ui, it) }.toSet()
    var lastRows by remember { mutableStateOf(presentRows) }
    LaunchedEffect(presentRows) {
        val old = lastRows
        lastRows = presentRows
        if (page == GuidePage.Tracking) landing.onRowsChanged(old, presentRows)
    }
    // 배경 경계: 착지가 대입 시점의 앱 상태로 이월하고(배경에선 프레임 시계가 멈춰 효과가 전환을 보지 못한다), 전경 복귀는 모델이 복귀 상환을 낸 뒤의
    // 신호에서 다시 요청한다(그 발화가 끝난 뒤 앉는다).
    var seenReturn by remember { mutableIntStateOf(GuideSession.sheetReturnSeq) }
    LaunchedEffect(GuideSession.sheetReturnSeq) {
        if (GuideSession.sheetReturnSeq == seenReturn) return@LaunchedEffect
        seenReturn = GuideSession.sheetReturnSeq
        landing.onForegroundReturn()
    }
    LaunchedEffect(landTitleSeq) { if (landTitleSeq > 0) land(titleFocus, "시트 제목") }
    LaunchedEffect(landProgressSeq) { if (landProgressSeq > 0) land(progressFocus, "진행 상황 버튼") }

    when (val p = page) {
        GuidePage.Overview -> {
            OverviewPage(ui, strings, overviewReturnsFromPreview, onViewAlternative = { page = GuidePage.AltPreview }, onClose = { page = GuidePage.Tracking; landProgressSeq++ })
            return
        }
        GuidePage.AltPreview -> {
            AltPreviewPage(ui, strings, onClose = { overviewReturnsFromPreview = true; page = GuidePage.Overview })
            return
        }
        is GuidePage.Search -> {
            SearchPage(p.target, onDone = toTracking)
            return
        }
        GuidePage.Tracking -> Unit
    }
    // 행 표식을 리소스 id로 낸다 — 초점 관찰이 커서가 앉은 행을 이것으로 가린다(`ObserveA11yFocus`).
    Column(Modifier.fillMaxSize().semantics { testTagsAsResourceId = true }) {
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
                // 접기 버튼은 착지 대상이 아니다(E57 — 띠바 복귀도 첫 정보 행).
                IconButton(onClick = { GuideSession.isMinimized = true }, modifier = Modifier.size(48.dp).testTag("guide-minimize")) {
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
                    // 누르면 자신이 사라진다 — 새 경로의 첫 정보 행으로(E57, 재조회와 삭제 통지가 끝난 뒤).
                    Button(
                        onClick = { if (GuideSession.walk.removeWaypoint()) landing.request("waypointRemoved", expectsSystemPlacement = false) },
                        modifier = Modifier.fillMaxWidth().tapTarget().testTag("guide-waypoint-remove"),
                    ) { Text(strings.get("android.guide.waypointRemove")) }
                }
            }
            Button(
                onClick = {
                    if (ui.mode == GuideMode.detail && ui.routeStepDescriptions != null) { overviewReturnsFromPreview = false; page = GuidePage.Overview }
                    else GuideSession.walk.announceProgress()
                },
                modifier = Modifier.fillMaxWidth().tapTarget().landingTarget(progressFocus).testTag("guide-progress"),
            ) { Text(strings.get("guide.progressButton")) }
            // 주변 확인 — 앵커는 목적지(도착지 부근이 어떤 모습인가를 묻는다, iOS spec §5). 펼친 결과가 아래 행을 밀지만 펼침은 방금 누른 행동이다.
            ui.dest?.let { dest ->
                SceneButtonSection(GuideSession.sceneLookup(GuideSession.SceneSlot.tracking, dest), requesterFor) { place, key -> nav.onOpenPlace(place, true, key) }
            }
            if (sheetRowExists(ui, SheetRow.reroute)) {
                Button(
                    onClick = { reroutePressed = true; GuideSession.walk.requestReroute() },
                    modifier = Modifier.fillMaxWidth().tapTarget().testTag(SheetRow.reroute.tag),
                ) { Text(strings.get(if (ui.isRerouting) "guide.rerouteBusy" else "guide.rerouteButton")) }
            }
            if (ui.mode == GuideMode.brief) BodyLine(strings.get("beacon.straightLineNote"), "guide-brief-note")
            // 정보 행 셋(첫 정보 행 후보, 이 순서가 곧 착지 우선순위) — 렌더 조건은 `sheetRowExists` 한 곳.
            if (sheetRowExists(ui, SheetRow.remaining)) InfoRow(ui.remainingText.orEmpty(), SheetRow.remaining, meters, rowFocus)
            if (sheetRowExists(ui, SheetRow.liveTop)) InfoRow(ui.liveTopText.orEmpty(), SheetRow.liveTop, meters, rowFocus)
            if (ui.mode == GuideMode.detail) {
                ui.liveNextText?.takeIf { it.isNotEmpty() }?.let { BodyLine(it, "guide-live-next", spokenDistanceUnits(it, meters)) }
            }
            if (sheetRowExists(ui, SheetRow.status)) InfoRow(statusLine(ui, strings), SheetRow.status, meters, rowFocus)
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

/** 상태 행 문장 — 주기 예고면 "다음 안내," 라벨을 붙인다. */
private fun statusLine(ui: WalkGuideUiState, strings: Strings): String =
    if (ui.statusIsNextPreview) strings.get("guide.progressNext", ui.statusText) else ui.statusText

/** 착지 대상 정보 행(`BodyLine`과 같은 모양 + 착지 requester, 표식은 행의 고정 tag). */
@Composable
private fun InfoRow(text: String, row: SheetRow, meters: String, focus: Map<SheetRow, FocusRequester>) {
    Text(text, Modifier.fillMaxWidth().mergedRow(row.tag, spokenDistanceUnits(text, meters), focus = focus.getValue(row)).padding(vertical = 8.dp))
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
private fun OverviewPage(ui: WalkGuideUiState, strings: Strings, returnsFromPreview: Boolean, onViewAlternative: () -> Unit, onClose: () -> Unit) {
    val meters = strings.get("android.unit.spokenMeters")
    val headerFocus = remember { FocusRequester() }
    val viewAltFocus = remember { FocusRequester() }
    val header = remember(ui) { GuideSession.walk.progressText() }
    // 진입 착지는 여기 한 곳. 프리뷰에서 돌아왔는데 버튼이 없으면(최종 접근 등으로 노출이 꺼졌다) 헤더로 물러난다 — 없는 버튼에 착지하면 커서가 어디에도 가지 않는다.
    LaunchedEffect(Unit) {
        if (returnsFromPreview && ui.alternativePreviewAvailable) land(viewAltFocus, "대안 경로 보기 버튼") else land(headerFocus, "조망 헤더")
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        Button(onClick = onClose, modifier = Modifier.fillMaxWidth().tapTarget().testTag("guide-overview-close-top")) { Text(strings.get("actions.close")) }
        HeadingLine(header, "guide-overview-header", focus = headerFocus, spoken = spokenDistanceUnits(header, meters))
        val steps = ui.routeStepDescriptions.orEmpty()
        val waypointRow = ui.routeWaypointRow
        steps.forEachIndexed { i, desc ->
            if (waypointRow != null && waypointRow.first == i) BodyLine(waypointRow.second, "guide-overview-waypoint")
            val line = if (ui.currentStepIndex == i) strings.get("android.guide.routeListCurrent", desc) else desc
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
            // 낡음 폴백 재조회 중엔 상태 설명(라벨 불변 — 포커스를 쥔 노드의 텍스트 교체는 TalkBack이 다시 읽는다는 보장이 없다, E50·주변 확인 관례).
            val searching = strings.get("android.directions.searching")
            Button(
                onClick = { GuideSession.walk.adoptAlternativePreview() },
                modifier = Modifier.fillMaxWidth().tapTarget().testTag("guide-alt-adopt").semantics { if (ui.isSwitchingVariant) stateDescription = searching },
            ) { Text(strings.get("android.guide.adoptAlternative")) }
        }
        // "지금 이 구간" 표식 없음 — 대안 경로 위에 현재 위치가 없다.
        ui.altPreviewSteps?.forEachIndexed { i, desc ->
            BodyLine(desc, "guide-alt-step-$i", spokenDistanceUnits(desc, meters))
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
private fun SearchPage(target: DirectionsFieldTarget, onDone: (committed: String?) -> Unit) {
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
        ) { endpoint, field -> onDone(commitGuideEndpoint(endpoint, field)) }
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
        Box(Modifier.fillMaxSize().imePadding()) { state?.let { EndpointSearchContent(picker, it, onBack = { onDone(null) }) } }
    }
}

/**
 * 검색 확정 — 세션에 반영됐을 때만 폼에 보낸다(세션이 이미 죽었으면 선택을 폐기, iOS §3.2). 도착지·경유지는 장소만 온다(현재 위치 선택지가 없다).
 * 반영됐으면 착지 표식(시트가 페이지를 닫은 뒤 첫 정보 행으로, E57), 아니면 null(제목).
 */
private fun commitGuideEndpoint(endpoint: DirectionsEndpoint, field: DirectionsFieldTarget): String? {
    val place = endpoint as? DirectionsEndpoint.Place ?: return null
    val dest = BeaconDest(place.lat, place.lng)
    when (field) {
        DirectionsFieldTarget.to -> if (GuideSession.walk.changeDestination(dest, place.label)) GuideFormSync.post(place) else return null
        DirectionsFieldTarget.via -> if (GuideSession.walk.setWaypoint(dest, place.label)) GuideFormSync.postWaypoint(place) else return null
        DirectionsFieldTarget.from, DirectionsFieldTarget.manualLocation -> return null
    }
    return if (field == DirectionsFieldTarget.to) "destinationChanged" else "waypointChanged"
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
    // 도착 문장 착지 대기 중 사용자가 커서를 옮겼는가(종료 화면이 뜬 직후 첫 이동 한 번은 시스템 배치).
    var cursorMoves by remember { mutableIntStateOf(0) }
    ObserveA11yFocus { cursorMoves += 1 }
    LaunchedEffect(Unit) {
        val model = GuideSession.walk
        val back = GuideSession.pendingSheetReturn
        GuideSession.pendingSheetReturn = null
        if (model.takeWeightSettingsReturn()) {
            model.recomputeArrivalHealth()
            if (model.ui.value.weightPromptShown) land(enterWeightFocus, "체중 입력 버튼") else land(healthFocus, "걸음 요약")
        } else if (back != null && back != GUIDE_TITLE_RETURN) {
            land(sceneFocus[back] ?: arrivedFocus, "장소 상세 복귀")
        } else {
            // 안내 TTS(도착 문장·배경에서 끝났으면 복귀 상환)가 끝난 뒤 앉는다(최대 12초) — 안드로이드는 TalkBack 착지 낭독과 앱 TTS가 다른 소리라
            // 겹치면 둘 다 알아듣기 어렵다(E57 §3.2 이월 도착 착지의 안드로이드판). 배경에선 컴포지션이 멈춰 이 효과가 전경 복귀 뒤에 돈다.
            // 기다리는 동안 커서를 옮겼거나 잠겼으면 앉지 않는다(첫 정보 행 착지와 같은 계약).
            val start = SystemClock.elapsedRealtime()
            while (!model.announcementsSettled() && SystemClock.elapsedRealtime() - start < GuideSheetLanding.SPEECH_WAIT_MS) delay(GuideSheetLanding.POLL_MS)
            if (cursorMoves > 1) { GuideDiag.log("sheetFocus sheet=beacon target=arrived reason=userMoved"); return@LaunchedEffect }
            if (!GuideSession.inForeground) { GuideDiag.log("sheetFocus sheet=beacon target=arrived reason=background"); return@LaunchedEffect }
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
