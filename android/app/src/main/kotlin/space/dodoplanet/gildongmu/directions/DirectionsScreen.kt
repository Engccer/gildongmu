package space.dodoplanet.gildongmu.directions

import android.util.Log
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.ui.platform.LocalFocusManager
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.platform.LocalWindowInfo
import space.dodoplanet.gildongmu.a11y.LocalModalOpen
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import space.dodoplanet.gildongmu.a11y.AppScreenScaffold
import space.dodoplanet.gildongmu.a11y.landingTarget
import space.dodoplanet.gildongmu.a11y.pinnedMoves
import space.dodoplanet.gildongmu.a11y.reorderCustomActions
import space.dodoplanet.gildongmu.a11y.rememberMovedRowLanding
import androidx.compose.foundation.relocation.bringIntoViewRequester
import space.dodoplanet.gildongmu.a11y.reorderLabels
import space.dodoplanet.gildongmu.a11y.StatusLine
import space.dodoplanet.gildongmu.a11y.headingText
import space.dodoplanet.gildongmu.a11y.requesterFor
import space.dodoplanet.gildongmu.a11y.tapTarget
import space.dodoplanet.gildongmu.i18n.AppLocale
import space.dodoplanet.gildongmu.kit.models.TransitLegStop
import space.dodoplanet.gildongmu.kit.DataLocale
import space.dodoplanet.gildongmu.kit.DirectionsMode
import space.dodoplanet.gildongmu.kit.DirectionsModeOutcome
import space.dodoplanet.gildongmu.guide.GuideSession
import space.dodoplanet.gildongmu.guide.ui.ObserveA11yFocus
import space.dodoplanet.gildongmu.guide.ui.GuideHandoffFailureRow
import space.dodoplanet.gildongmu.guide.ui.carGuideStartSlot
import space.dodoplanet.gildongmu.guide.ui.transitGuideStartSlot
import space.dodoplanet.gildongmu.guide.ui.walkGuideStartSlot
import space.dodoplanet.gildongmu.kit.joinText
import space.dodoplanet.gildongmu.kit.WalkCollapse
import space.dodoplanet.gildongmu.location.appDetailsSettingsIntent
import space.dodoplanet.gildongmu.nav.tryStartActivity
import space.dodoplanet.gildongmu.settings.SETTINGS_RETURN_KEY
import space.dodoplanet.gildongmu.settings.SettingsAction
import space.dodoplanet.gildongmu.kit.models.WalkLineKind

/**
 * 길찾기 탭 루트(spec §2·§3-1, iOS `DirectionsTabView` 대응). 폼 위에 끝점 검색을 **덮어씌운다**(폼은 컴포즈 유지) —
 * 형제 교체로 하면 폼의 펼침·스크롤 상태가 피커 왕복(취소 복귀)에 소멸한다(구현 리뷰 MA-1). 보이는 것은 하나뿐이고
 * 라이브 리전도 하나만 컴포즈된다(폼의 `StatusLine`은 피커가 덮은 동안 숨김 트리 밖).
 * ViewModel 팩토리는 이 패키지가 앱 컨텍스트로 스스로 만든다(`MainActivity`는 골격 세션 소유). 도보 안내 시작 버튼은 도보 줄 안,
 * 추적 중 "안내 종료" 이중 방어는 조회 버튼 아래, 도보 안내 공지 시트는 진입 때(확인 전까지). 자동차·대중교통 안내는 M5.
 */
@Composable
fun DirectionsScreen(onOpenSettings: () -> Unit, takeSettingsReturn: () -> String?, onOpenStation: (TransitLegStop, String?, returnKey: String) -> Unit) {
    val context = LocalContext.current
    val factory = remember(context) { directionsViewModelFactory(context) }
    DirectionsScreen(viewModel(factory = factory), onOpenSettings, takeSettingsReturn, onOpenStation)
}

/**
 * `onOpenStation`: 브리핑 지하철역 작업 메뉴의 상세 열기(E45) — null이면 진입점이 없다(push 경로가 없는 기기 테스트 하네스). `returnKey`는 pop 복귀
 * 착지 키(그 줄) — 앱 루트가 복귀 슬롯에 기억하고, 돌아오면 `takeSettingsReturn`(엔트리 복귀 슬롯)으로 받아 그 줄에 착지한다.
 */
@Composable
fun DirectionsScreen(
    vm: DirectionsViewModel,
    onOpenSettings: () -> Unit = {},
    takeSettingsReturn: () -> String? = { null },
    onOpenStation: ((TransitLegStop, String?, returnKey: String) -> Unit)? = null,
) {
    val settingsFocus = remember { FocusRequester() }
    // 폼은 항상 컴포즈된다(상태 보존). 피커가 덮은 동안은 접근성 트리·터치에서 빠져야 하므로 컴포지션에서 뺀다 — 그 대신 상태를 폼 밖(이 계층)에
    // 든다(`FormUiState`). 펼침은 saveable — 역 상세 push로 이 목적지가 컴포지션에서 내려갔다 돌아와도 보던 경로가 펼친 그대로다.
    val formState = rememberFormUiState()
    // pop 복귀 착지: 설정 → 상단 바 설정 버튼(spec §14-1), 역 상세(E45) → 작업 메뉴를 실행한 그 브리핑 줄.
    LaunchedEffect(Unit) {
        val key = takeSettingsReturn() ?: return@LaunchedEffect
        withFrameNanos { }
        val target = if (key == SETTINGS_RETURN_KEY) settingsFocus else formState.stationRowFocus[key.removePrefix(STATION_RETURN_PREFIX)]
        runCatching { target?.requestFocus() }.onFailure { Log.w("DirectionsScreen", "복귀 착지 실패 $key", it) }
    }
    val picker by vm.endpointSearch.collectAsState()
    BackHandler(enabled = picker != null) { vm.closePicker() }
    // 화면 이탈(탭 전환·역 상세 push·재생성)은 진행 중 수단 재조회를 끊는다 — 돌아왔을 때 늦은 결과의 착지가 커서를 빼앗지 않게(E50 §4.3).
    DisposableEffect(vm) { onDispose { vm.onScreenExit() } }
    val p = picker
    Box(Modifier.fillMaxSize()) {
        if (p == null) DirectionsForm(vm, formState, onOpenSettings, settingsFocus, onOpenStation) else EndpointSearchContent(vm.picker, p, onBack = vm::closePicker, titleOverride = null, stationsOnly = false)
    }
}

/** 역 상세 복귀 착지 키 접두(E45) — 뒤는 그 브리핑 줄의 태그. */
const val STATION_RETURN_PREFIX = "station-row:"

/**
 * 폼의 화면 상태(펼침·착지 요청자) — 피커 왕복에 살아남도록 `DirectionsScreen` 수준에 든다. 새 조회에서만 초기화(§3-4).
 * 펼침 넷은 [Saver]로 백스택 항목 수명을 산다(push 왕복 — E45). 착지 요청자는 컴포지션마다 새로 달린다.
 */
class FormUiState(
    expandedAlts: Set<String> = emptySet(),
    walkExpandedOverride: Boolean? = null,
    laterExpanded: Set<WalkLineKind> = emptySet(),
    seenResultsRevision: Int = 0,
) {
    var expandedAlts by mutableStateOf(expandedAlts)
    var walkExpandedOverride by mutableStateOf(walkExpandedOverride)
    /** 도보 첫 줄 뒤 줄들의 펼침 — 줄 종류마다 따로(E52: 한 칸을 공유하면 세 줄에서 둘이 함께 열린다). */
    var laterExpanded by mutableStateOf(laterExpanded)
    var seenResultsRevision by mutableStateOf(seenResultsRevision)
    /** 역 작업 메뉴를 든 브리핑 줄(태그 → 요청자) — 역 상세 pop 복귀 착지. */
    val stationRowFocus = mutableMapOf<String, FocusRequester>()
    val fromFocus = FocusRequester()
    val toFocus = FocusRequester()
    val viaFocus = FocusRequester()
    val submitFocus = FocusRequester()
    // 여정 입력(B26 단계 5): 역 칸 둘·남은 쪽 추가 버튼 둘·지금 탄 열차 단계 줄·여정 결과 착지 줄. 입구 버튼은 `viaFocus`를 쓴다(iOS 접근성 포커스 대상 `.via`).
    val boardFocus = FocusRequester()
    val alightFocus = FocusRequester()
    val addBoardFocus = FocusRequester()
    val addAlightFocus = FocusRequester()
    val aboardStepFocus = FocusRequester()
    val journeyFocus = FocusRequester()
    /** 스크린 리더 커서가 앉은 줄의 표식(`ObserveA11yFocus`, 관찰이 안 되면 null) — 방면 조회가 끝났을 때 단계 줄을 다시 읽힐지 가른다. */
    var a11yCursorTag: String? = null
    /** 직전 방면 상태 — 조회 중에서 끝으로 넘어온 전이를 잡는다. null = 아직 본 적 없음(첫 관찰은 전이가 아니다). */
    var previousAboardState: AboardDirectionsState? = null
    /** 다시 앉히기 요청 세대와 소비 세대(재진입 때 지난 요청을 다시 하지 않는다). 대상이 null이면 단계 줄이다. */
    var rereadAboardSeq by mutableIntStateOf(0)
    var rereadAboardDone = 0
    var relandRequester: FocusRequester? = null

    /**
     * 누른 버튼이 사라지는 전이 뒤 커서를 [target]으로 옮긴다: 비우고 간격을 둔 뒤 준다(누르기 전에 준 포커스는 한소네 커서를 옮기지 못해 화면 제목으로
     * 떨어졌다, 실측 — 여정 시트 `relandStatus`와 같은 관용구).
     */
    fun reland(target: FocusRequester) {
        relandRequester = target
        rereadAboardSeq += 1
    }
    /** 다음 착지가 확인 질문 대화상자를 닫은 뒤인가 — 창이 돌아온 뒤 비우고 다시 앉힌다(대화상자가 떠 있을 때 준 포커스엔 커서가 오지 않는다). */
    var landAfterDialog = false

    fun requester(row: InputRow): FocusRequester = when (row) {
        InputRow.From -> fromFocus
        InputRow.To -> toFocus
        InputRow.Via, InputRow.ViaAdd, InputRow.ViaRemove -> viaFocus
        InputRow.BoardStation -> boardFocus
        InputRow.AlightStation -> alightFocus
        InputRow.AddBoardStation -> addBoardFocus
        InputRow.AddAlightStation -> addAlightFocus
        InputRow.AboardStep -> aboardStepFocus
        InputRow.Swap, InputRow.ClearStations, InputRow.Submit -> submitFocus
    }
    val recentFocus = mutableMapOf<String, FocusRequester>()
    /** 수단 재조회 착지 대상(E50) — 키는 `requeryRouteFocusKey`·`requeryNoneFocusKey`. */
    val requeryFocus = mutableMapOf<String, FocusRequester>()

    fun resetExpansion(revision: Int) {
        expandedAlts = emptySet()
        requeryFocus.clear()
        walkExpandedOverride = null
        laterExpanded = emptySet()
        seenResultsRevision = revision
    }

    companion object {
        val Saver: Saver<FormUiState, Any> = listSaver(
            save = {
                listOf(ArrayList(it.expandedAlts), it.walkExpandedOverride, ArrayList(it.laterExpanded.map { k -> k.rawValue }), it.seenResultsRevision)
            },
            restore = {
                @Suppress("UNCHECKED_CAST")
                FormUiState(
                    (it[0] as List<String>).toSet(), it[1] as Boolean?,
                    (it[2] as List<String>).mapNotNull(WalkLineKind::fromRawValue).toSet(),
                    it[3] as Int,
                )
            },
        )
    }
}

@Composable
private fun rememberFormUiState(): FormUiState = rememberSaveable(saver = FormUiState.Saver) { FormUiState() }

@OptIn(ExperimentalComposeUiApi::class)
@Composable
private fun DirectionsForm(
    vm: DirectionsViewModel,
    ui: FormUiState,
    onOpenSettings: () -> Unit,
    settingsFocus: FocusRequester,
    onOpenStation: ((TransitLegStop, String?, returnKey: String) -> Unit)?,
) {
    val s by vm.state.collectAsState()
    val context = LocalContext.current
    val res = context.resources
    val lang = remember(res) { AppLocale.current(res) }
    val dataLocale = remember(lang) { if (lang == "ko") DataLocale.ko else DataLocale.en }
    // 여정 입력(역 칸·입구 검색·지금 탄 열차)은 데이터 로케일이 ko일 때만 선다(iOS `journeyInputEnabled`).
    val journeyEnabled = dataLocale == DataLocale.ko
    val strings = remember(res) { resourceStrings(res) }
    val stationEntry = remember(onOpenStation, vm, ui) {
        onOpenStation?.let { open ->
            BriefingStationEntry(
                onOpen = { stop, lineName, rowTag -> open(stop, lineName, STATION_RETURN_PREFIX + rowTag) },
                announce = vm::announceResult,
                rowFocus = { tag -> ui.stationRowFocus.getOrPut(tag) { FocusRequester() } },
            )
        }
    }
    // 새 조회 = 새 경로들이라 펼침을 기본으로 되돌린다(피커 왕복은 보존).
    if (s.resultsRevision != ui.seenResultsRevision) ui.resetExpansion(s.resultsRevision)
    // 이미 허가된 세션이면 진입 시 조용히 현재 위치 주소를 병기(권한 팝업 없음).
    LaunchedEffect(lang) { vm.loadCurrentAddressIfAuthorized() }
    // 옛 위치 문장의 "N분 전"이 멈추지 않게 옛 위치인 동안 30초마다 다시 그린다(stale-origin §3). 다시 그리기는 통지를 만들지 않는다.
    val now by produceState(System.currentTimeMillis() / 1000.0, s.currentStaleAt) {
        value = System.currentTimeMillis() / 1000.0
        while (s.currentStaleAt != null) {
            kotlinx.coroutines.delay(30_000)
            value = System.currentTimeMillis() / 1000.0
        }
    }
    // ko 밖으로 바뀌면 지금 탄 열차를 푼다(조회가 일반 세 수단으로 떨어져 aboard 역이 최근 경로에 저장되는 것 방지). 화면을 다시 띄울 때 끊긴 방면 조회를 잇는다.
    LaunchedEffect(journeyEnabled) { vm.onJourneyInputEnabledChanged(journeyEnabled) }
    LaunchedEffect(Unit) { vm.resumeAboardDirections() }
    // 방면 조회가 끝나 미커버·열차 없음·실패가 되면(iOS `settleAboardArrival`) 진동 한 번 + 커서가 단계 줄이면 그 줄을 다시 읽히고, 아니면 polite 통지 한 번.
    // 질문(노선·방면)은 통지하지 않는다. 라벨만 바뀐 포커스 노드는 TalkBack이 다시 읽지 않아 비우고 다시 앉힌다(`rereadAboardSeq` 효과).
    LaunchedEffect(s.aboardDirectionsState) {
        val current = s.aboardDirectionsState
        val previous = ui.previousAboardState
        ui.previousAboardState = current
        val haptic = aboardArrivalHaptic(previous, current)
        // 커서 판정은 입력 포커스가 아니라 접근성 커서다(스와이프·키 이동은 입력 포커스를 옮기지 않는다). 모르면 끌지 않고 통지 쪽.
        if (ui.a11yCursorTag == InputRow.AboardStep.tag) {
            if (!aboardArrivalSettled(previous, current)) return@LaunchedEffect
            if (haptic != null) vm.announceResult("", haptic)
            ui.rereadAboardSeq += 1
        } else if (haptic != null) {
            vm.announceResult(aboardStepText(current, strings).orEmpty(), haptic)
        }
    }
    // 커서 자리 관찰(폼이 컴포지션을 떠나면 낡은 값을 버린다 — 돌아와 첫 효과가 엉뚱한 줄을 끌지 않게).
    ObserveA11yFocus { tag -> ui.a11yCursorTag = tag }
    DisposableEffect(Unit) { onDispose { ui.a11yCursorTag = null } }
    val focusManager = LocalFocusManager.current
    val windowInfo = LocalWindowInfo.current
    LaunchedEffect(ui.rereadAboardSeq) {
        if (ui.rereadAboardSeq <= ui.rereadAboardDone) return@LaunchedEffect
        ui.rereadAboardDone = ui.rereadAboardSeq
        withFrameNanos { }
        focusManager.clearFocus()
        delay(REREAD_GAP_MS) // 비운 상태가 접근성 이벤트로 한 번 나갈 만큼(`MovedRowLanding`)
        val target = ui.relandRequester ?: ui.aboardStepFocus
        ui.relandRequester = null
        runCatching { target.requestFocus() }.onFailure { Log.w("DirectionsScreen", "다시 앉히기 실패", it) }
    }
    // 입구 검색에서 고른 역·정류장의 확인 질문(E77): 시트가 닫힌 뒤(이 폼이 다시 컴포즈된 뒤) 450ms 지나 띄운다. 그 사이 다른 시트가 열리면 이 폼이 컴포지션을 떠나 대기는 버려진다.
    val ask = s.pendingTransfer
    var askShown by remember { mutableStateOf(false) }
    LaunchedEffect(ask) {
        askShown = false
        if (ask != null) {
            delay(ASK_DELAY_MS)
            askShown = true
        }
    }

    // 착지 요청(spec §3-5): 한 요청 = 한 착지, 재구성이 끝난 다음 프레임에 대입(M1 관용구).
    LaunchedEffect(s.landing) {
        val landing = s.landing ?: return@LaunchedEffect
        if (landing.seq <= vm.consumedLanding) return@LaunchedEffect
        vm.consumedLanding = landing.seq
        withFrameNanos { }
        if (ui.landAfterDialog) {
            ui.landAfterDialog = false
            // 창이 돌아오면 TalkBack이 먼저 커서를 화면 위쪽에 놓는다 — 그 뒤에 비우고 다시 앉힌다(이미 입력 포커스를 쥔 노드에 다시 요청하면 커서가 오지 않는다).
            val returned = withTimeoutOrNull(DIALOG_RETURN_TIMEOUT_MS) { snapshotFlow { windowInfo.isWindowFocused }.first { it } } != null
            Log.i("DirectionsScreen", "대화상자 뒤 착지 대기 returned=$returned target=${landing.target}")
            delay(DIALOG_SETTLE_MS)
            focusManager.clearFocus()
            delay(REREAD_GAP_MS)
        }
        val requester = when (val t = landing.target) {
            is LandingTarget.Field -> when (t.field) {
                DirectionsFieldTarget.from -> ui.fromFocus
                DirectionsFieldTarget.to -> ui.toFocus
                DirectionsFieldTarget.manualLocation -> null.also { Log.w("DirectionsScreen", "길찾기 폼에 없는 필드 착지 $t") }
                // 입구·경유지·역 칸: 그 칸이 있으면 칸, 없으면 그 자리의 추가 버튼, 그것도 없으면 조회 버튼(현재 줄 목록 기준).
                DirectionsFieldTarget.via, DirectionsFieldTarget.transfer, DirectionsFieldTarget.boardStation, DirectionsFieldTarget.alightStation ->
                    ui.requester(inputLandingRow(t.field, directionsInputRows(vm.state.value, journeyEnabled)))
            }
            LandingTarget.AboardStep -> ui.aboardStepFocus
            LandingTarget.Submit -> ui.submitFocus
            is LandingTarget.RecentRoute -> ui.recentFocus[t.id]
            is LandingTarget.RequeriedRoute -> ui.requeryFocus[requeryRouteFocusKey(t.routeKey)]
            is LandingTarget.RequeryNone -> ui.requeryFocus[requeryNoneFocusKey(t.axis)]
        }
        runCatching { requester?.requestFocus() }.onFailure { Log.w("DirectionsScreen", "착지 실패 ${landing.target}", it) }
    }

    // 확인 질문이 떠 있는 동안 앱 통지를 집지 않는다(바깥 값과 OR — 안내 시트 등).
    val askOpen = askShown && ask != null
    CompositionLocalProvider(LocalModalOpen provides (askOpen || LocalModalOpen.current)) {
    if (askOpen) {
        TransferQuestionDialog(
            title = vm.transferQuestionText(),
            choices = vm.transferQuestionButtons(),
            // 답: 새 칸(또는 경유지 줄)에 착지는 뷰모델이 싣는 `landing`이 한다. 닫기·뒤로·바깥: 아무것도 바꾸지 않고 입구 버튼으로.
            onChoose = { c -> ui.landAfterDialog = true; if (c.cancel) vm.cancelTransfer() else vm.answerTransfer(c.board) },
            onDismiss = { ui.landAfterDialog = true; vm.cancelTransfer() },
        )
    }
    AppScreenScaffold(strings.get("android.tab.directions"), onBack = null, actions = { SettingsAction(onOpenSettings, settingsFocus) }) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .semantics { testTagsAsResourceId = true },
        ) {
            val searchingLabel = strings.get("android.directions.searching")
            // 진행 표시는 조회 자신이 도는 동안만.
            val querying = s.phase == DirectionsPhase.Locating || s.phase == DirectionsPhase.Loading
            // 입력 줄 — 순서와 조건은 `directionsInputRows`가 정본이고 여기는 그 목록을 그대로 그린다(iOS 같은 순서, 줄마다 한 접근성 객체).
            // 줄마다 key — 줄 수가 바뀌어도 남는 줄(조회 버튼·남은 칸)의 노드를 보존해, 사라지는 버튼이 먼저 옮겨 둔 커서가 살아남는다.
            for (row in directionsInputRows(s, journeyEnabled)) key(row) { when (row) {
                // 필드 한 줄 = 한 객체("출발지, 현재 위치"). 비-ko 병기는 낭독만 괄호 없이.
                InputRow.From -> ActionRow(
                    visual = vm.fieldText(DirectionsFieldTarget.from, accessible = false, lang = lang, nowEpoch = now),
                    spoken = vm.fieldText(DirectionsFieldTarget.from, accessible = true, lang = lang, nowEpoch = now),
                    tag = row.tag, onClick = { vm.openPicker(DirectionsFieldTarget.from) }, modifier = Modifier.landingTarget(ui.fromFocus),
                )
                InputRow.AboardStep -> aboardStepSpec(s.aboardDirectionsState, strings)?.let { spec ->
                    AboardStepRows(
                        spec, ui.aboardStepFocus, ui.submitFocus,
                        onReland = { target -> ui.reland(target) },
                        onAction = { action ->
                            when (action) {
                                is AboardAction.Line -> vm.chooseAboardLine(action.line)
                                is AboardAction.Direction -> vm.chooseAboardDirection(action.direction)
                                AboardAction.Refresh -> vm.retryAboardDirections()
                            }
                        },
                    )
                }
                InputRow.Swap -> Button(onClick = vm::swap, modifier = Modifier.tapTarget().testTag(row.tag)) { Text(strings.get("directions.swap")) }
                InputRow.To -> ActionRow(
                    visual = vm.fieldText(DirectionsFieldTarget.to, accessible = false, lang = lang, nowEpoch = now),
                    spoken = vm.fieldText(DirectionsFieldTarget.to, accessible = true, lang = lang, nowEpoch = now),
                    tag = row.tag, onClick = { vm.openPicker(DirectionsFieldTarget.to) }, modifier = Modifier.landingTarget(ui.toFocus),
                )
                // 경유지(N4, 선택 사항). 삭제는 자기를 누른 버튼을 없애므로 조회 버튼을 먼저 선점한다(헌장 §5).
                InputRow.ViaAdd -> Button(
                    // 여정 입력이 켜져 있으면 입구 검색(경유지 또는 자동차 환승), 아니면 종전 경유지 추가.
                    onClick = { vm.openPicker(if (journeyEnabled) DirectionsFieldTarget.transfer else DirectionsFieldTarget.via) },
                    modifier = Modifier.tapTarget().testTag(row.tag).landingTarget(ui.viaFocus),
                ) { Text(if (journeyEnabled) strings.get("android.journey.addMenu") else vm.fieldText(DirectionsFieldTarget.via, accessible = true, lang = lang)) }
                InputRow.Via -> ActionRow(
                    visual = vm.fieldText(DirectionsFieldTarget.via, accessible = false, lang = lang),
                    spoken = vm.fieldText(DirectionsFieldTarget.via, accessible = true, lang = lang),
                    tag = row.tag, onClick = { vm.openPicker(DirectionsFieldTarget.via) }, modifier = Modifier.landingTarget(ui.viaFocus),
                )
                InputRow.ViaRemove -> Button(onClick = { ui.submitFocus.requestFocus(); vm.clearVia(); ui.reland(ui.submitFocus) }, modifier = Modifier.tapTarget().testTag(row.tag)) {
                    Text(strings.get("directions.removeVia"))
                }
                // 역 칸: 채운 칸만 그리고(문장 `stationFieldText`) 누르면 그 칸 검색, 작업 메뉴 「삭제」 = 칸 비우기(iOS 밀기 삭제).
                InputRow.BoardStation, InputRow.AlightStation -> {
                    val board = row == InputRow.BoardStation
                    ActionRow(
                        visual = vm.stationFieldText(board), tag = row.tag,
                        onClick = { vm.openPicker(if (board) DirectionsFieldTarget.boardStation else DirectionsFieldTarget.alightStation) },
                        actions = listOf(CustomAccessibilityAction(strings.get("recent.delete")) { clearStationField(vm, ui, board); true }),
                        modifier = Modifier.landingTarget(ui.requester(row)),
                    )
                }
                InputRow.AddBoardStation, InputRow.AddAlightStation -> {
                    val board = row == InputRow.AddBoardStation
                    Button(
                        onClick = { vm.openPicker(if (board) DirectionsFieldTarget.boardStation else DirectionsFieldTarget.alightStation) },
                        modifier = Modifier.tapTarget().testTag(row.tag).landingTarget(ui.requester(row)),
                    ) { Text(strings.get(if (board) "android.journey.addBoardStation" else "android.journey.addAlightStation")) }
                }
                // 지우기는 자기를 누른 버튼을 없애므로 조회 버튼을 먼저 선점한다.
                InputRow.ClearStations -> Button(
                    onClick = { ui.submitFocus.requestFocus(); vm.clearJourneyStations(); ui.reland(ui.submitFocus) },
                    modifier = Modifier.tapTarget().testTag(row.tag),
                ) { Text(strings.get("android.journey.clearStations")) }
                InputRow.Submit -> Button(
                    onClick = {
                        if (s.isBusy) return@Button
                        // 지금 탄 열차인데 방면이 아직 없으면 조회하지 않고 단계 줄로 커서를 보낸다(그 줄의 문장이 곧 통지).
                        // 단계 줄이 이미 입력 포커스를 쥐었으면 요청만으로는 커서가 오지 않아 다시 앉힌다. 단계 줄이 없으면(조회 전 짧은 창) 출발지 칸으로.
                        if (vm.aboardNeedsDirection) {
                            if (aboardStepSpec(s.aboardDirectionsState, strings) != null) {
                                runCatching { ui.aboardStepFocus.requestFocus() }.onFailure { Log.w("DirectionsScreen", "단계 줄 착지 실패", it) }
                                ui.rereadAboardSeq += 1
                            } else {
                                runCatching { ui.fromFocus.requestFocus() }.onFailure { Log.w("DirectionsScreen", "출발지 착지 실패", it) }
                            }
                        } else vm.runQuery()
                    },
                    modifier = Modifier
                        .tapTarget()
                        .testTag(row.tag)
                        .landingTarget(ui.submitFocus)
                        // disabled는 포커스를 떨군다 — 클릭 무시 + 상태 설명(헌장 §5 ⓐ, M1 관용구)
                        .semantics { if (querying) stateDescription = searchingLabel },
                ) { Text(strings.get("directions.submit")) }
            } }

            StatusLine(s.notice, Modifier.padding(vertical = 8.dp))

            // 해결 버튼(spec §3-1 표 8): reduced는 재요청이 1순위, 설정 열기는 재요청이 거부된 뒤의 폴백(iOS는 denied에만).
            if (s.phase == DirectionsPhase.GeoReduced) {
                Button(
                    onClick = vm::requestPreciseLocation,
                    modifier = Modifier.tapTarget().testTag("allow-precise").semantics { if (s.isRequestingPrecise) stateDescription = searchingLabel },
                ) { Text(strings.get("android.common.allowPrecise")) }
            }
            if (s.phase == DirectionsPhase.GeoDenied || (s.phase == DirectionsPhase.GeoReduced && s.preciseRetryFailed)) {
                // 처리 앱이 없는 기기에서는 false — 상태 문장이 이미 무엇을 해야 하는지 말한다(크래시 경로 차단).
                Button(onClick = { context.tryStartActivity(appDetailsSettingsIntent(context)) }, modifier = Modifier.tapTarget().testTag("open-settings")) {
                    Text(strings.get("android.common.openSettings"))
                }
            }

            // 최근 경로: 결과 없는 화면에서만(실패 phase에서는 보인다 — 우회로). 여정 결과가 있으면 숨긴다(iOS `!journeyFound`).
            if (s.results == null && !s.journeyFound && !s.isBusy && s.recentRoutes.isNotEmpty()) {
                SectionHeading(strings.get("recentRoutes.title"))
                val pinnedLabel = strings.get("recent.pinned")
                val reorder = reorderLabels()
                // key + 옮긴 행 다시 착지(B23, a11y/ReorderActions.kt `MovedRowLanding`). 이동 셋이 작업 메뉴 맨 앞.
                val movedRoute = rememberMovedRowLanding { ui.recentFocus.requesterFor(it as String) }
                for (route in s.recentRoutes) key(route.id) {
                    val label = vm.recentRouteLabel(route, lang)
                    val moves = pinnedMoves(s.recentRoutes, route, { it.pinned }) { a, b -> a.id == b.id }
                    ActionRow(
                        visual = label, tag = "recent-route-${route.id}",
                        state = if (route.pinned) pinnedLabel else null, pinned = route.pinned,
                        actions = reorderCustomActions(moves, reorder) { vm.moveRecentRoute(route, it); movedRoute.pending = route.id } + listOf(
                            CustomAccessibilityAction(strings.get(if (route.pinned) "recent.unpin" else "recent.pin")) { vm.togglePinRecentRoute(route); true },
                            CustomAccessibilityAction(strings.get("recent.delete")) { ui.recentFocus.remove(route.id); vm.removeRecentRoute(route); true },
                        ),
                        // 결과 도착 시 이 섹션이 통째로 사라지므로 조회 버튼을 먼저 선점한다(헌장 §5).
                        onClick = { ui.submitFocus.requestFocus(); vm.activateRecentRoute(route) },
                        modifier = Modifier.bringIntoViewRequester(movedRoute.bringFor(route.id)).landingTarget(ui.recentFocus.requesterFor(route.id)),
                    )
                }
                Button(onClick = { ui.recentFocus.clear(); vm.clearRecentRoutes() }, modifier = Modifier.tapTarget().testTag("recent-route-clear")) {
                    Text(strings.get("recentRoutes.clearAll"))
                }
            }

            // 추적 중 "안내 종료" 이중 방어(iOS `DirectionsTabView` 선두 섹션): 시트가 어떤 이유로 뜨지 않아도 중지 수단이 화면에 남는다.
            // 제목은 세션이 든 목적지(폼 도착지는 안내 중 바뀔 수 있다). 누르면 섹션이 사라지므로 조회 버튼을 먼저 선점한다(헌장 §5).
            val guideUi = if (GuideSession.isAttached) GuideSession.walk.ui.collectAsState().value else null
            if (guideUi?.isTracking == true) {
                SectionHeading(joinText(strings.get("beacon.heading"), guideUi.destinationLabel))
                Button(
                    onClick = { ui.submitFocus.requestFocus(); GuideSession.walk.stopByUser() },
                    modifier = Modifier.tapTarget().testTag("directions-guide-stop"),
                ) { Text(strings.get("beacon.stop")) }
            }
            // 인계 도보의 시작 실패(B28, iOS 같은 선두 섹션) — 시작 버튼 없는 도보 시작이라 실패 문장과 해결 버튼이 설 자리가 여기뿐이다.
            if (guideUi != null && !guideUi.isTracking) GuideHandoffFailureRow { dest -> SectionHeading(joinText(strings.get("beacon.heading"), dest)) }

            // 여정 결과(찾음만 줄을 그린다 — 경로 없음·조회 실패는 위 상태 줄이 말한다). 섹션 머리 없음.
            (s.journeyOutcome as? JourneyQueryOutcome.Found)?.let { found ->
                JourneyResultRows(
                    result = found.result, board = s.boardStation, alight = s.alightStation, aboardOrigin = s.aboardOrigin,
                    variantIndex = s.journeyVariantIndex, egressIndex = s.journeyEgressIndex,
                    onSelectVariant = vm::selectJourneyVariant, onSelectEgress = vm::selectJourneyEgress,
                    destination = journeyDestinationOf(s), destinationName = vm.destinationName, destinationRoman = vm.destinationRoman,
                    lang = lang, dataLocale = dataLocale, strings = strings, stationEntry = stationEntry, landingFocus = ui.journeyFocus,
                    onStart = { vm.announceGuideStartIfManualOrigin(GuideSession.isActive) },
                )
            }

            val results = s.results
            if (results != null) {
                for (mode in results.displayedModes) {
                    val headingKey = when (mode) {
                        DirectionsMode.transit -> "route.public"
                        DirectionsMode.walk -> "route.pedestrian.heading"
                        DirectionsMode.car -> "route.car"
                    }
                    Text(
                        strings.get(headingKey),
                        Modifier
                            .headingText()
                            .testTag("heading-${mode.rawValue}")
                            .padding(top = 16.dp, bottom = 4.dp),
                        style = MaterialTheme.typography.titleMedium,
                    )
                    // (예약) 수단별 안내 시작 버튼 — 자동차는 여기, 도보·대중교통은 각 경로 행 펼침 본문 첫 항목(M4·M5).
                    when (val outcome = results.outcomes[mode]) {
                        is DirectionsModeOutcome.Transit -> TransitOutcomeRows(
                            outcome.result, ui.expandedAlts,
                            onToggle = { key -> ui.expandedAlts = if (key in ui.expandedAlts) ui.expandedAlts - key else ui.expandedAlts + key },
                            destinationName = vm.destinationName, destinationRoman = vm.destinationRoman, lang = lang, dataLocale = dataLocale, strings = strings,
                            stationEntry = stationEntry,
                            requery = TransitRequeryRowsState(
                                axes = outcome.result.knownRequeryAxes, states = s.transitRequery, found = s.requeriedRoutes,
                                onRequery = vm::requery, focus = { key -> ui.requeryFocus.getOrPut(key) { FocusRequester() } },
                            ),
                            // 대중교통 안내 시작(M5) — 경로 펼침 본문 첫 항목(iOS 동형). 수동 위치 고지는 iOS처럼 대중교통 시작에 내지 않는다.
                            guideStart = transitGuideStartSlot(s),
                        )
                        // outcome의 브리핑은 첫 줄과 같은 응답이다(분류가 첫 줄로 한다) — 줄 목록을 그린다(E42).
                        is DirectionsModeOutcome.Walk -> WalkOutcomeRows(
                            s.walkLines,
                            walkExpandedOverride = ui.walkExpandedOverride,
                            onWalkToggle = { ui.walkExpandedOverride = !(ui.walkExpandedOverride ?: !WalkCollapse.shouldCollapse(outcome.briefing.durationSeconds)) },
                            laterExpanded = ui.laterExpanded,
                            onLaterToggle = { kind -> ui.laterExpanded = if (kind in ui.laterExpanded) ui.laterExpanded - kind else ui.laterExpanded + kind },
                            viaLabel = s.via?.label, strings = strings, failedLines = s.walkLinesFailed,
                            guideStart = walkGuideStartSlot(s, onStart = { vm.announceGuideStartIfManualOrigin(GuideSession.isActive) }),
                        )
                        is DirectionsModeOutcome.Car -> {
                            // 자동차 안내 시작(M5) — 수단 heading 착지 뒤 첫 스와이프 거리, 경로 행보다 앞(iOS 동형).
                            carGuideStartSlot(s, dataLocale.rawValue, outcome.briefing.provider, onStart = { vm.announceGuideStartIfManualOrigin(GuideSession.isActive) })?.invoke()
                            CarOutcomeRows(outcome.briefing, s.via?.label, lang, strings)
                        }
                        DirectionsModeOutcome.Empty -> TextRow(strings.get(if (mode == DirectionsMode.transit) "route.transit.noRoute" else "route.pedestrian.noRoute"), "empty-${mode.rawValue}")
                        DirectionsModeOutcome.Error -> TextRow(
                            strings.get(
                                when (mode) {
                                    DirectionsMode.transit -> "route.transit.error"
                                    DirectionsMode.walk -> "route.pedestrian.error"
                                    DirectionsMode.car -> "route.briefing.error"
                                },
                            ),
                            "error-${mode.rawValue}",
                        )
                        DirectionsModeOutcome.UnsupportedWaypoint -> TextRow(strings.get("directions.unsupportedWaypoint"), "unsupported-${mode.rawValue}")
                        DirectionsModeOutcome.Gated, DirectionsModeOutcome.OutOfCoverage, null -> Unit // displayedModes가 걸러 도달하지 않는다
                    }
                }
            }
        }
    }
    }
}

/** 입구 질문을 띄우기 전 시트가 닫히길 기다리는 시간(iOS 450ms). */
private const val ASK_DELAY_MS = 450L

/** 라벨만 바뀐 포커스 노드를 다시 읽히려 비운 상태가 접근성 이벤트로 한 번 나가길 기다리는 시간(`MovedRowLanding`과 같다). */
private const val REREAD_GAP_MS = 250L
/** 대화상자를 닫은 뒤 창이 돌아오기를 기다리는 상한과, 돌아온 뒤 시스템 커서 배치(창 제목 낭독)가 끝나기를 기다리는 시간(한소네 실측: 400ms로는 제목에 남았다). */
private const val DIALOG_RETURN_TIMEOUT_MS = 1_500L
private const val DIALOG_SETTLE_MS = 1_000L

/**
 * 역 칸 비우기(iOS `clearStationField`): 칸이 사라지는 전이이므로 모델을 비우기 전에 커서를 계속 존재할 줄(다른 칸, 둘 다 비면 조회 버튼)로 옮긴다.
 */
private fun clearStationField(vm: DirectionsViewModel, ui: FormUiState, board: Boolean) {
    val target = ui.requester(clearStationCursorRow(vm.state.value, board))
    runCatching { target.requestFocus() }.onFailure { Log.w("DirectionsScreen", "칸 비우기 전 착지 실패", it) }
    vm.clearJourneyStation(board)
    ui.reland(target)
}
