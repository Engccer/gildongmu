package space.dodoplanet.gildongmu.guide.ui

import android.os.SystemClock
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.ModalBottomSheetProperties
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
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import space.dodoplanet.gildongmu.AppConfig
import space.dodoplanet.gildongmu.a11y.LocalModalOpen
import space.dodoplanet.gildongmu.a11y.headingText
import space.dodoplanet.gildongmu.a11y.landingTarget
import space.dodoplanet.gildongmu.a11y.mergedRow
import space.dodoplanet.gildongmu.a11y.requesterFor
import space.dodoplanet.gildongmu.a11y.tapTarget
import space.dodoplanet.gildongmu.directions.DirectionsFieldTarget
import space.dodoplanet.gildongmu.directions.EndpointPicker
import space.dodoplanet.gildongmu.directions.EndpointSearchContent
import space.dodoplanet.gildongmu.directions.Strings
import space.dodoplanet.gildongmu.directions.guideDestinationPhone
import space.dodoplanet.gildongmu.directions.noteDestination
import space.dodoplanet.gildongmu.directions.resourceStrings
import space.dodoplanet.gildongmu.directions.transitRouteEntries
import space.dodoplanet.gildongmu.directions.transitSummaryText
import space.dodoplanet.gildongmu.guide.DestChangePhase
import space.dodoplanet.gildongmu.guide.GuideDiag
import space.dodoplanet.gildongmu.guide.GuideFormSync
import space.dodoplanet.gildongmu.guide.GuideSession
import space.dodoplanet.gildongmu.guide.PendingRecovery
import space.dodoplanet.gildongmu.guide.TransitAboardStep
import space.dodoplanet.gildongmu.guide.TransitGuideModel
import space.dodoplanet.gildongmu.guide.TransitGuideTextRenderer
import space.dodoplanet.gildongmu.guide.TransitGuideUiState
import space.dodoplanet.gildongmu.guide.transitGuideIsEn
import space.dodoplanet.gildongmu.i18n.AppLocale
import space.dodoplanet.gildongmu.kit.BeaconDest
import space.dodoplanet.gildongmu.kit.DataLocale
import space.dodoplanet.gildongmu.kit.DirectionsEndpoint
import space.dodoplanet.gildongmu.kit.RecentSearchStore
import space.dodoplanet.gildongmu.kit.SearchService
import space.dodoplanet.gildongmu.kit.guideDestinationPlace
import space.dodoplanet.gildongmu.kit.StationLayoutKind
import space.dodoplanet.gildongmu.kit.joinText
import space.dodoplanet.gildongmu.kit.stationLayoutKind
import space.dodoplanet.gildongmu.kit.transitSurroundingsAnchor
import space.dodoplanet.gildongmu.kit.models.Place
import space.dodoplanet.gildongmu.kit.models.TransitLegStop
import space.dodoplanet.gildongmu.kit.transitOpenStationLine
import space.dodoplanet.gildongmu.kit.transitStationMentions
import space.dodoplanet.gildongmu.kit.transitStopPlace
import space.dodoplanet.gildongmu.nearby.SceneButtonSection
import space.dodoplanet.gildongmu.place.StationPhoneStore
import space.dodoplanet.gildongmu.place.dial
import space.dodoplanet.gildongmu.storage.SharedPreferencesStore

/**
 * 대중교통 실시간 안내 시트(iOS `TransitTrackingSheet.swift` 1:1, M5 §6-7). 도보 `GuideSheet`와 같은 계약 — 시작이 곧 표시, 중지가 곧 닫힘, 시트를 내리는
 * 제스처(뒤로·스와이프)는 **최소화**이고 종료는 최하단 「안내 종료」 버튼뿐(N1). live region이 없다(문장은 모델의 TTS 한 채널).
 *
 * **착지 대상의 기본은 상태 문장 행이다**(E38 위원장 판정 2026-09-12): 시트 진입·국면 전이·띠바 복귀·전경 복귀 전부 [TransitSheetControl.status]. 예외는
 * **자기 질문을 여는 화면**(역 선택·급행 확인·차량 선택 라벨)과 목적지 전환·잘못 내림 복구 상태 행뿐이다. 기구는 [TransitSheetLanding], 대상 부착은
 * [transitLandingTarget]·[transitLandingRow]만, 렌더 조건 정본은 [transitControlExists].
 * ⚠ 상태 문장과 국면 컨트롤 사이에는 경유역 목록이 있다(행 순서: 상태 → 경유역 → 컨트롤 — iOS a11y 감사 H2).
 *
 * 다단 화면(조망·목적지 검색·복구 역 검색)은 같은 시트의 **페이지**다(M4b — 시트는 자기 윈도라 그 위에 시트를 또 올리지 않는다). 장소 상세만 스택 화면이다
 * (시트를 접고 push → 그 엔트리가 빠지면 재개, `GuidePlaceNav`).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TransitGuideSheet(ui: TransitGuideUiState, strings: Strings, nav: GuideNav) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    // 바깥 탭 접기를 끈다(2026-11-21 위원장 판정: 시트 줄이 「안내 종료」에서 끝난다). 머티리얼 스크림은 바깥 탭 처리와 「시트 닫기」 시맨틱을 한
    // 수식어로 달아(1.5.0) 이 설정이 둘을 함께 없앤다. 남는 접기는 「안내 시트 접기」 버튼, 뒤로 가기, 아래로 끌기(`ReleaseNoticeSheet` 선례).
    ModalBottomSheet(onDismissRequest = { GuideSession.isMinimized = true }, sheetState = sheetState, dragHandle = null, properties = ModalBottomSheetProperties(shouldDismissOnClickOutside = false)) {
        TransitTrackingContent(ui, strings, nav)
    }
}

/**
 * 착지 대상 등록부 — 대상마다 `FocusRequester`·`BringIntoViewRequester` 한 쌍(iOS `landingTarget`의 바인딩·`scrollTo` 키). 시트가 `remember`로 하나 들고,
 * 행은 [transitLandingTarget](버튼)·[transitLandingRow](텍스트 줄)로만 단다 — 대상마다 따로 달면 하나가 빠지고 빠진 대상은 조용히 실패한다.
 */
class TransitLandingTargets {
    private val focus = TransitSheetControl.entries.associateWith { FocusRequester() }
    private val bring = TransitSheetControl.entries.associateWith { BringIntoViewRequester() }
    fun focus(control: TransitSheetControl): FocusRequester = focus.getValue(control)
    fun bring(control: TransitSheetControl): BringIntoViewRequester = bring.getValue(control)
}

/** 버튼(Material3 `Button`·`clickable`) 착지 부착 — 화면 안으로 들이기 + `landingTarget`(터치 모드에서도 초점) + 고정 표식. */
fun Modifier.transitLandingTarget(targets: TransitLandingTargets, control: TransitSheetControl): Modifier =
    bringIntoViewRequester(targets.bring(control)).landingTarget(targets.focus(control)).testTag(control.tag)

/** 텍스트 줄(한 줄 = 한 객체) 착지 부착 — 화면 안으로 들이기 + `mergedRow(control.tag, focus)`. 헤딩 자리면 뒤에 `.headingText()`. */
fun Modifier.transitLandingRow(targets: TransitLandingTargets, control: TransitSheetControl): Modifier =
    bringIntoViewRequester(targets.bring(control)).mergedRow(control.tag, focus = targets.focus(control))

/** 시트 안 페이지(M4b). 뒤로는 Tracking으로. */
private enum class TransitPage { tracking, overview, destSearch, recoverySearch }

/** 조망이 닫힌 뒤 행동(iOS `OverviewFollowUp`) — 단일 슬롯 latest-wins. */
private sealed interface OverviewFollowUp {
    data class Land(val target: TransitSheetControl) : OverviewFollowUp
    data object BeginReboard : OverviewFollowUp
}

/**
 * 장소 상세 push 시점의 국면 키 — 시트 컴포지션은 상세가 떠 있는 동안 사라지므로(iOS는 상세가 중첩 시트라 시트가 산다) 돌아온 시트가 그 사이 전이를 이것과
 * 비교해 iOS `detailPlace` onDismiss의 이월 착지를 한 번 낸다. 띠바 복귀(진입 착지 = 상태 문장)는 이 값을 읽지 않는다.
 */
private object TransitSheetReturnMemo {
    var keyAtPush: TransitPhaseKey? = null
    /** push 시점에 경유역 목록이 펼쳐져 있던 구간(`legIndex`) — 돌아온 시트가 같은 구간일 때만 목록을 펼친 채 세운다(경유역 행 복귀 착지가 설 자리). */
    var viaExpandedLegAtPush: Int? = null
}

/** iOS `onChange(of:)` — 컴포지션 진입 값은 건너뛰고 값이 바뀔 때만 (이전, 새 값)으로 부른다. */
@Composable
internal fun <T> OnChange(value: T, action: (old: T, new: T) -> Unit) {
    val last = remember { arrayListOf(value) }
    LaunchedEffect(value) {
        val old = last[0]
        last[0] = value
        if (old != value) action(old, value)
    }
}

@Composable
private fun TransitTrackingContent(ui: TransitGuideUiState, strings: Strings, nav: GuideNav) {
    val model = GuideSession.transit
    val context = LocalContext.current
    val isEn = transitGuideIsEn(DataLocale.fromRawValue(AppLocale.dataLocale(context.resources)) ?: DataLocale.ko)
    val renderer = remember(strings, isEn) { TransitGuideTextRenderer(strings) { isEn } }
    // 목적지 전화번호(E90) — 전화번호부가 제목의 이름·좌표로 안다. 세션 통로를 타지 않는다.
    val destinationPhone = remember(ui.dest, ui.destinationLabel) { AppConfig.placePhoneBook.guideDestinationPhone(ui.dest, ui.destinationLabel) }
    val titleFocus = remember { FocusRequester() }
    val progressFocus = remember { FocusRequester() }
    val targets = remember { TransitLandingTargets() }
    /** 장소 상세에서 돌아올 줄의 요청자(5-B 경유역 행 등) — 키는 그 줄의 `mergedRow` 표식. */
    val returnFocus = remember { mutableMapOf<String, FocusRequester>() }
    /** `returnFocus`와 같은 키의 들이기 요청자 — 화면 밖일 수 있는 복귀 줄(경유역·주변 확인·복구 역 찾기)이 단다. */
    val returnBring = remember { mutableMapOf<String, BringIntoViewRequester>() }
    var page by remember { mutableStateOf(TransitPage.tracking) }
    // 경유역 목록 펼침(§14.1) — 구간이 바뀌면 접는다(다음 구간의 목록은 다른 목록).
    // 장소 상세 push는 시트 컴포지션을 지우므로, 경유역 행에서 연 상세에서 돌아오면 그 구간의 펼침을 복원한다(첫 컴포지션에 행이 서야 진입 착지가 요청자를 찾는다).
    var viaExpanded by remember { mutableStateOf(TransitSheetReturnMemo.viaExpandedLegAtPush.let { it != null && it == ui.state?.legIndex }) }
    // 급행 확인 질문 표시(spec 2026-09-02 §6) — 「이미 탔어요」 뒤, 급행 집합이 있는 노선만. 연 국면 세대에 묶인다.
    var expressPromptActive by remember { mutableStateOf(false) }
    var pendingFollowUp by remember { mutableStateOf<OverviewFollowUp?>(null) }
    var landTitleSeq by remember { mutableIntStateOf(0) }
    var landProgressSeq by remember { mutableIntStateOf(0) }
    val routeStrings = remember(context.resources) { resourceStrings(context.resources) }
    /** 목적지 전환 첫 후보 행을 화면 안으로 들이는 요청자(iOS `proxy.scrollTo(first)`). */
    val firstRouteBring = remember { BringIntoViewRequester() }

    val exists: (TransitSheetControl) -> Boolean = { c ->
        page == TransitPage.tracking && transitControlExists(model.ui.value, c, expressPromptActive, model.recoveryOffered)
    }
    val scope = rememberCoroutineScope()
    val landing = remember {
        TransitSheetLanding(
            scope = scope,
            clock = { SystemClock.elapsedRealtime() / 1000.0 },
            announcementsSettled = { model.announcementsSettled() },
            isForeground = { GuideSession.inForeground },
            isTracking = { model.ui.value.isTracking },
            pageOpen = { page != TransitPage.tracking },
            exists = exists,
            reveal = { c ->
                try { targets.bring(c).bringIntoView() } catch (e: CancellationException) { throw e } catch (e: Exception) { GuideDiag.log("controlFocus target=$c reveal failed ${e::class.simpleName}") }
            },
            // 성패는 `requestFocus(FocusDirection.Enter)`의 Boolean(`ChatLanding` 관용구).
            focus = { c -> runCatching { targets.focus(c).requestFocus(FocusDirection.Enter) }.getOrDefault(false) },
            fallbackText = { c ->
                val u = model.ui.value
                transitLandingFallbackText(c, u, strings) {
                    val s = u.state
                    val leg = transitUiLeg(u)
                    // 착지했다면 읽었을 라벨 = 화면의 그 줄이라 화면 시계로.
                    if (s != null && leg != null) model.statusLineText(s, leg, now = u.positionClock, speaksLocated = true) else ""
                }
            },
            announceFallback = { model.announceLandingFallback(it) },
        )
    }
    DisposableEffect(Unit) { onDispose { landing.dispose() } }

    // 장소 상세(스택 화면) — 시트를 접고 push, 돌아오면 `returnTo` 줄에 착지(iOS 표준 중첩 시트 + 시스템 커서 복원). 길찾기 진입 버튼은 숨긴다.
    val openPlace: (Place, String, String?) -> Unit = { place, returnTo, stationLineHint ->
        TransitSheetReturnMemo.keyAtPush = model.ui.value.let { TransitPhaseKey(it.state?.phase, it.userTransitionSeq) }
        TransitSheetReturnMemo.viaExpandedLegAtPush = if (viaExpanded) model.ui.value.state?.legIndex else null
        nav.onOpenPlace(place, false, returnTo, stationLineHint)
    }
    // iOS `showDestinationDetail` — 목적지 상세(사용자 조작이라 유휴 시계를 되돌린다).
    val showDestinationDetail: () -> Unit = {
        ui.dest?.let { dest ->
            model.touchUserAction()
            openPlace(guideDestinationPlace(dest, ui.destinationLabel, destinationPhone), GUIDE_TITLE_RETURN, null)
        }
    }
    // iOS `openStationDetail` — 지하철 경유역의 장소 상세(E33): 좌표·ID·한국어 이름으로 곧장 연다. `returnTo`는 돌아올 줄의 표식(상태 문장 언급이면
    // `TransitSheetControl.status.tag`, 경유역 행이면 그 행 키). 노선 힌트(E44 `stationLineHint`)는 여기서 확정한다(iOS `detailLineHint = lineName`, E44 §5.2) —
    // 역 상세의 전화 줄이 그 노선 축으로 조회한다.
    val openStationDetail: (stop: TransitLegStop, lineName: String, source: String, returnTo: String) -> Unit = { stop, lineName, source, returnTo ->
        model.touchUserAction()
        GuideDiag.log("transit stationDetail open station=${stop.name} line=$lineName source=$source")
        openPlace(transitStopPlace(stop), returnTo, lineName)
    }
    // iOS `prefetchViaPhones` — 펼친 경유역 목록의 전화번호 일괄 조회(E44 §6). 지하철 구간만.
    val prefetchViaPhones: () -> Unit = {
        model.currentLeg?.takeIf { it.mode == "subway" }?.let { leg -> StationPhoneStore.shared.prefetch(stops = leg.viaStops, lineName = leg.lineName) }
    }

    // ── 페이지 닫힘(iOS 자식 시트 onDismiss) ──
    // 조망 — 닫힌 뒤 행동 계약의 실행 지점(한 곳). 하위 조회(다른 경로)는 페이지가 어떤 경로로 닫혀도 폐기한다(늦은 응답이 모델에 남지 않게).
    val runPendingFollowUp: () -> Unit = {
        model.ui.value.pendingAltRoutes?.token?.let { model.cancelAltRoutes(it) }
        when (val followUp = pendingFollowUp) {
            // 조망이 떠 있던 동안 이월된 착지(복구 결과 행 등). 없으면 진행 상황 버튼으로(iOS는 시스템이 표시 직전 요소로 되돌린다).
            null -> if (!landing.landDeferred("deferred")) landProgressSeq++
            is OverviewFollowUp.Land -> { pendingFollowUp = null; landing.land(followUp.target, "overviewFollowUp", expectsSystemPlacement = true) }
            // 역을 물을 수 있는 구간은 `reboardPickerActive` 전이의 질문 헤딩 착지가, 그 밖은 waiting 전이의 목록 라벨 착지가 맡는다.
            OverviewFollowUp.BeginReboard -> { pendingFollowUp = null; model.beginReboard() }
        }
    }
    val closeOverview: () -> Unit = { page = TransitPage.tracking; runPendingFollowUp() }
    // 목적지 검색 — 고른 장소로 전환이 준비 중이면 상태 행(스펙 §4.4), 아니면 떠 있던 동안 이월된 착지, 그도 없으면 제목(메뉴를 연 자리).
    val closeDestSearch: () -> Unit = {
        page = TransitPage.tracking
        if (model.ui.value.pendingDestChange != null) landing.land(TransitSheetControl.destChangeStatus, "destChange", expectsSystemPlacement = true)
        else if (!landing.landDeferred("deferred")) landTitleSeq++
    }
    // 복구 역 검색(5-D 페이지) — 떠 있던 동안 이월된 착지(대개 조회 중 행). 이월이 없으면 false — 5-D가 「목록에 없는 역 찾기」 버튼으로 되돌린다.
    val closeRecoverySearch: () -> Boolean = {
        page = TransitPage.tracking
        landing.landDeferred("deferred")
    }
    // 취소로 닫혔고 이월된 착지도 없으면 「목록에 없는 역 찾기」 버튼으로 되돌린다(iOS는 시스템이 표시 직전 요소로 되돌린다).
    val cancelRecoverySearch: () -> Unit = {
        if (!closeRecoverySearch()) scope.launch { landRevealed(returnBring.bringFor(RECOVERY_FIND_TAG), returnFocus.requesterFor(RECOVERY_FIND_TAG), "복구 역 검색 취소") }
    }

    BackHandler(enabled = page != TransitPage.tracking) {
        when (page) {
            TransitPage.overview -> closeOverview()
            TransitPage.destSearch -> closeDestSearch()
            TransitPage.recoverySearch -> cancelRecoverySearch()
            TransitPage.tracking -> Unit
        }
    }

    // 스크린 리더 커서가 어느 노드에 앉았는가 — 착지 대기 중 사용자 이동·국면 버튼 소실 판정(표식은 아래 `testTagsAsResourceId`가 리소스 id로 낸다).
    ObserveA11yFocus { tag -> landing.onA11yFocus(tag) }

    // 시트 열림 착지 — 띠바에서 돌아온 시트도 같다(E57 위원장 판정 Q1, 상태 문장). 지금 탄 열차에서 시작한 안내(E71 R9)의 첫 열림만 그 질문 라벨에 앉는다
    // (일회성 표식 — 라벨이 서지 않는 갈래는 상태 문장으로). 장소 상세에서 돌아왔으면 그 사이 전이의 착지가 먼저, 없으면 누른 그 줄.
    LaunchedEffect(Unit) {
        val back = GuideSession.pendingSheetReturn
        val keyAtPush = TransitSheetReturnMemo.keyAtPush
        TransitSheetReturnMemo.keyAtPush = null
        TransitSheetReturnMemo.viaExpandedLegAtPush = null
        if (back != null) {
            GuideSession.pendingSheetReturn = null
            val now = model.ui.value.let { TransitPhaseKey(it.state?.phase, it.userTransitionSeq) }
            val target = if (keyAtPush != null && keyAtPush != now) {
                transitPhaseTransitionLanding(keyAtPush.phase, now.phase, byUser = keyAtPush.userSeq != now.userSeq, lostFocus = false, waitingLabelExists = exists(TransitSheetControl.waitingLabel))
            } else null
            val control = target ?: TransitSheetControl.forTag(back)
            if (control != null) landing.land(control, "placeReturn", expectsSystemPlacement = true)
            else if (back == GUIDE_TITLE_RETURN) land(titleFocus, "장소 상세 복귀")
            else returnFocus[back]?.let { landRevealed(returnBring.bringFor(back), it, "장소 상세 복귀") } ?: land(titleFocus, "장소 상세 복귀")
        } else {
            val aboard = model.consumeAboardStartLanding() && exists(TransitSheetControl.waitingLabel)
            landing.land(if (aboard) TransitSheetControl.waitingLabel else TransitSheetControl.status, "open", expectsSystemPlacement = true)
        }
    }
    // 전경 복귀(백그라운드 경유) — 모델이 복귀 상환을 낸 뒤의 신호에서 이월된 착지를 한 번(iOS scenePhase `.active`).
    var seenReturn by remember { mutableIntStateOf(GuideSession.sheetReturnSeq) }
    LaunchedEffect(GuideSession.sheetReturnSeq) {
        if (GuideSession.sheetReturnSeq == seenReturn) return@LaunchedEffect
        seenReturn = GuideSession.sheetReturnSeq
        landing.onForegroundReturn()
    }
    OnChange(ui.state?.legIndex) { _, _ -> viaExpanded = false }
    // 경유역 목록을 펼치는 순간 그 구간 역의 전화번호를 일괄 조회한다(E44 spec §6).
    OnChange(viaExpanded) { _, expanded -> if (expanded) prefetchViaPhones() }
    // 역 선택 화면 착지 — 트리거는 화면이 열리는 상태 변화다(두 흐름 공용: 승차 중 탑승 변경·이미 탑승 pickStation).
    OnChange(ui.reboardPickerActive) { _, active -> if (active) landing.land(TransitSheetControl.reboardPrompt, "reboardPicker", expectsSystemPlacement = false) }
    OnChange(ui.aboardStep) { _, step -> if (step == TransitAboardStep.pickStation) landing.land(TransitSheetControl.reboardPrompt, "aboardPickStation", expectsSystemPlacement = false) }
    // 잘못 내림 복구(E78): 역 질문이 버튼 자리를 대신하면 질문 헤딩으로, 역을 골라 목록이 사라지면 조회 중 행으로. 버스의 첫 누름은 버튼이 그대로라 착지하지
    // 않는다(모델 통지가 응답이다). 검색 페이지 위의 선택은 닫힘 이월이 맡는다.
    OnChange(ui.pendingRecovery?.phase) { old, new ->
        if (new == PendingRecovery.Phase.pickStation) landing.land(TransitSheetControl.reboardPrompt, "recoveryPick", expectsSystemPlacement = false)
        else if (new == PendingRecovery.Phase.loading && old == PendingRecovery.Phase.pickStation) landing.land(TransitSheetControl.recoveryStatus, "recoveryLoading", expectsSystemPlacement = false)
    }
    // 시한이 역 질문을 거뒀다 — 열린 역 검색 페이지를 닫고(거기서 고른 역은 버려진다) 상태 문장으로. 페이지가 떠 있으면 착지는 이월돼 닫힘이 소비한다.
    OnChange(ui.recoveryWithdrawnSeq) { _, _ ->
        if (page == TransitPage.recoverySearch) {
            landing.defer(TransitSheetControl.status, "recoveryWithdrawn")
            closeRecoverySearch()
        } else {
            landing.land(TransitSheetControl.status, "recoveryWithdrawn", expectsSystemPlacement = false)
        }
    }
    // 결과 행(실패·경로 없음) — 조회 중 행이 바뀐 같은 자리에 착지. 채택은 국면 전이 착지가 맡는다(결과 null).
    OnChange(ui.recoveryOutcome) { _, outcome -> if (outcome != null) landing.land(TransitSheetControl.recoveryStatus, "recoveryOutcome", expectsSystemPlacement = false) }
    // 급행 확인 질문은 연 국면 세대에 묶인다 — 경로 교체(waiting → waiting)도 세대가 바뀐다.
    OnChange(ui.state?.phaseGen) { _, _ -> expressPromptActive = false }
    // 키는 국면 + 사용자 전이 순번(A47) — 순번만 바뀐 커밋도 여기로 온다. 순번이 그대로인 국면 변화가 관측 전이다. 세션 종료(국면 null)도 온다.
    OnChange(TransitPhaseKey(ui.state?.phase, ui.userTransitionSeq)) { old, new ->
        // 조망 닫힘 착지가 시스템 배치를 기다리는 중이면(경로 전환 확정이 페이지를 먼저 닫았다) 새 착지가 그 기대를 물려받는다 — 페이지 교체의 커서 이동을 사용자 이동으로 세지 않게.
        val inheritsPlacement = landing.awaitingSystemPlacement
        // 국면이 바뀌면 진행 중 착지는 낡은 대상을 좇는다 — 먼저 끊는다.
        landing.cancel()
        expressPromptActive = false
        val byUser = new.userSeq != old.userSeq
        // 커서를 쥔 국면 버튼이 그 국면과 함께 사라졌는가(A47 소실 복구) — 초점 관찰이 아는 마지막 노드로 가린다.
        val lostFocus = old.phase != null && TransitPhaseButton.forTag(landing.cursorTag)?.phase == old.phase
        val target = transitPhaseTransitionLanding(old.phase, new.phase, byUser, lostFocus, waitingLabelExists = exists(TransitSheetControl.waitingLabel))
        // 조망이 열려 있으면 그 행·행동은 낡았다 — 닫고, 착지는 닫힘 한 곳이 낸다(경로 전환이 만든 전이도 새 세션의 전이 착지가 정본).
        if (page == TransitPage.overview) {
            if (target != null) pendingFollowUp = OverviewFollowUp.Land(target)
            closeOverview()
            return@OnChange
        }
        if (target != null) landing.land(target, if (!byUser && lostFocus) "lost=phaseButton" else "transition", expectsSystemPlacement = transitTransitionExpectsPlacement(byUser, lostFocus, inheritsPlacement))
    }
    // 목적지 전환 후보 조회 결과 — 0건·오류는 조회 중 행이 바뀐 같은 자리 문구 행에 착지(헌장 §5). 조회 중은 검색 닫힘이 이미 착지를 맡았다.
    OnChange(ui.pendingDestChange?.phase) { _, phase ->
        when (phase) {
            is DestChangePhase.Loaded -> {
                // 첫 후보 착지(스펙 §4.4) — 도착 통지는 내지 않는다(착지 낭독이 첫 후보를 읽는다). 조회 중 행에 걸려 있던 착지는 끊는다.
                landing.cancel()
                val first = transitRouteEntries(phase.result, emptyList(), routeStrings).firstOrNull()?.route?.routeKey
                if (first != null) scope.launch { landFirstDestChangeRouteFocus(firstRouteBring, returnFocus.requesterFor(transitDestRouteTag(first))) }
            }
            DestChangePhase.Empty, DestChangePhase.Failed -> landing.land(TransitSheetControl.destChangeStatus, "destChangeResult", expectsSystemPlacement = false)
            DestChangePhase.Loading, null -> Unit
        }
    }
    LaunchedEffect(landTitleSeq) { if (landTitleSeq > 0) land(titleFocus, "시트 제목") }
    LaunchedEffect(landProgressSeq) { if (landProgressSeq > 0) land(progressFocus, "진행 상황 버튼") }

    when (page) {
        TransitPage.overview -> {
            TransitOverviewPage(ui, strings, nav) { exit ->
                when (exit) {
                    TransitOverviewExit.beginReboard -> pendingFollowUp = OverviewFollowUp.BeginReboard
                    // 경로 전환 확정도 착지는 상태 문장이다(E38).
                    TransitOverviewExit.routeSwitched -> pendingFollowUp = OverviewFollowUp.Land(TransitSheetControl.status)
                    null -> Unit
                }
                closeOverview()
            }
            return
        }
        TransitPage.destSearch -> {
            TransitDestSearchPage(onDone = closeDestSearch)
            return
        }
        TransitPage.recoverySearch -> {
            TransitRecoverySearchPage(
                strings = strings,
                onPicked = { closeRecoverySearch() },
                onCancel = cancelRecoverySearch,
            )
            return
        }
        TransitPage.tracking -> Unit
    }

    val state = ui.state
    // 행 표식을 리소스 id로 낸다 — 초점 관찰이 커서가 앉은 노드를 이것으로 가린다(`ObserveA11yFocus`).
    Column(Modifier.fillMaxSize().semantics { testTagsAsResourceId = true }) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
            if (state != null) {
                // 제목 행(E74·E75): 제목 + 접기, 제목 메뉴는 전화 걸기(E90) → 장소 상세 → 목적지 바꾸기(도보 시트와 같은 번호부·같은 순서). 경유지·경로
                // 새로고침은 대중교통에 없다(ODsay가 경유역을 받지 않는다, N4·E75 판정 7). 여정 단계(E70)면 목적지 바꾸기를 숨긴다(iOS 동형) — 여정 중인가는 모델의
                // 여정 훅이 걸려 있는가로 본다(`recoveryOffered` 선례).
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.weight(1f)) {
                        GuideTitleMenu(
                            title = joinText(strings.get("beacon.transitHeading"), ui.destinationLabel),
                            strings = strings,
                            items = guideTitleMenuItems(destinationPhone, inJourney = model.onJourneyStopped != null),
                            focus = titleFocus,
                            onSelect = { item ->
                                when (item) {
                                    GuideTitleMenuItem.call -> destinationPhone?.let { phone ->
                                        model.touchUserAction()
                                        // 장소 상세 전화 줄과 같은 창구(다이얼러). 메뉴가 닫혔으니 커서를 제목으로 되돌린다.
                                        context.dial(phone)
                                        landTitleSeq++
                                    }
                                    GuideTitleMenuItem.detail -> showDestinationDetail()
                                    GuideTitleMenuItem.change -> page = TransitPage.destSearch
                                }
                            },
                            onDismissWithoutChoice = { landTitleSeq++ },
                        )
                    }
                    IconButton(onClick = { GuideSession.isMinimized = true }, modifier = Modifier.size(48.dp).testTag("guide-minimize")) {
                        Icon(Icons.Filled.KeyboardArrowDown, contentDescription = strings.get("guide.minimize"))
                    }
                }
                // 조망 페이지가 응답이다(도보 동형). `announceProgress()`를 부르지 않는다 — 헤더 착지가 같은 문장을 낭독한다.
                Button(
                    onClick = { GuideDiag.log("transit overview open"); page = TransitPage.overview },
                    modifier = Modifier.fillMaxWidth().tapTarget().landingTarget(progressFocus).testTag("guide-progress"),
                ) { Text(strings.get("guide.progressButton")) }
                StatusRows(ui, model, renderer, isEn, targets, onOpenStation = { stop, lineName -> openStationDetail(stop, lineName, "status", TransitSheetControl.status.tag) })
                val rows = TransitRowsCtx(
                    ui = ui, model = model, strings = strings, renderer = renderer, isEn = isEn, targets = targets, landing = landing, returnFocus = returnFocus, returnBring = returnBring, exists = exists,
                    viaExpanded = viaExpanded, setViaExpanded = { viaExpanded = it },
                    expressPromptActive = expressPromptActive, setExpressPromptActive = { expressPromptActive = it },
                    openStation = openStationDetail,
                    openRecoverySearch = { page = TransitPage.recoverySearch },
                )
                ViaStopsRows(rows)
                PhaseControls(rows)
                AlightPrepRow(rows)
                SurroundingsSection(rows, openPlace = { place, key ->
                    TransitSheetReturnMemo.keyAtPush = model.ui.value.let { TransitPhaseKey(it.state?.phase, it.userTransitionSeq) }
                    TransitSheetReturnMemo.viaExpandedLegAtPush = if (viaExpanded) model.ui.value.state?.legIndex else null
                    nav.onOpenPlace(place, true, key, null)
                })
                DestChangeSection(rows, routeStrings, firstRouteBring)
            }
        }
        // 안내 종료는 목록 밖 최하단 고정(iOS `GuideStopButton(tall: false)` — 도보 시트의 두 배 높이는 E81 정보 띠 판정이라 여기 없다).
        if (state != null) {
            Button(
                onClick = { model.stop(playStopTone = true) },
                modifier = Modifier.fillMaxWidth().padding(16.dp).tapTarget().testTag("guide-stop"),
            ) { Text(strings.get("beacon.stop")) }
        }
    }
}

/**
 * 상태 문장 행(iOS `statusRows`) — 상시 표시(통지 채널 밖), 통지와 같은 조립기(`statusLineText`, 화면 시계 `positionClock`). 한 줄 = 한 객체이고 착지 대상
 * [TransitSheetControl.status]. 낭독은 보이는 글자 그대로(A75 — 거리 풀어쓰기를 줄 이름에 얹지 않는다).
 * 문장 안 역명(E33 → E72): 지하철 구간에서만 언급을 판정해 「{역} 상세 보기」 작업 메뉴를 단다 — 목록 순서 그대로 노출되므로 iOS의 역순 선언은 옮기지 않는다.
 * 안드로이드는 줄 안 이름 링크(시각 탭)를 두지 않는다(브리핑 역 진입점 E45 선례 — 줄은 같은 텍스트 한 객체, 진입은 작업 메뉴). 링크는 역 정체성(`viaStops`
 * 순번)에 결박하고 같은 라벨은 하나만 둔다(Compose는 라벨로 골라 실행한다).
 */
@Composable
private fun StatusRows(
    ui: TransitGuideUiState,
    model: TransitGuideModel,
    renderer: TransitGuideTextRenderer,
    isEn: Boolean,
    targets: TransitLandingTargets,
    onOpenStation: (stop: TransitLegStop, lineName: String) -> Unit,
) {
    val state = ui.state ?: return
    val leg = transitUiLeg(ui) ?: return
    val text = model.statusLineText(state, leg, now = ui.positionClock, speaksLocated = true)
    val mentions = if (leg.mode == "subway") transitStationMentions(text, leg.viaStops) else emptyList()
    val display = model.displayLeg(leg, useOverride = false)
    val actions = mentions.mapNotNull { i ->
        val station = display.stops.getOrNull(i) ?: return@mapNotNull null
        val stop = leg.viaStops[i]
        CustomAccessibilityAction(renderer.render(transitOpenStationLine(isEn = isEn, station = station))) { onOpenStation(stop, leg.lineName); true }
    }.distinctBy { it.label }
    val row = Modifier.fillMaxWidth().transitLandingRow(targets, TransitSheetControl.status)
    Text(
        text,
        (if (actions.isEmpty()) row else row.semantics { customActions = actions }).padding(vertical = 8.dp),
        style = MaterialTheme.typography.bodyLarge,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

/**
 * 목적지 검색 페이지(iOS `DirectionsEndpointSearchView(target: .to)`, 스펙 2026-08-12 §4.1 1단): 고른 장소는 아직 아무것도 확정하지 않는다 — 모델이 후보
 * 조회만 시작한다(`prepareDestinationChange`, 확정은 후보 선택 = 5-D). 열린 동안 안내 출력을 억제하고(받아쓰기 마이크, iOS §5.4) 해제는 `onDispose`, 앱 통지를
 * 집지 않는다(`LocalModalOpen`) — 도보 시트 끝점 검색 페이지와 같은 계약.
 */
@Composable
private fun TransitDestSearchPage(onDone: () -> Unit) {
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
            ranking = { null },   // 근접 가중치일 뿐 — 세션 위치는 모델 밖으로 내지 않는다
            closesOnSelect = true,
            noteDestinationPhone = AppConfig.placePhoneBook::noteDestination,
        ) { endpoint, _ ->
            (endpoint as? DirectionsEndpoint.Place)?.let { GuideSession.transit.prepareDestinationChange(BeaconDest(it.lat, it.lng), it.label, it.labelRoman) }
            onDone()
        }
    }
    val state by picker.state.collectAsState()
    DisposableEffect(Unit) {
        val owner = Any()
        picker.open(DirectionsFieldTarget.to)
        GuideSession.setOutputSuppressed(true, owner)
        onDispose {
            picker.close()
            GuideSession.setOutputSuppressed(false, owner)
        }
    }
    CompositionLocalProvider(LocalModalOpen provides true) {
        Box(Modifier.fillMaxSize().imePadding()) { state?.let { EndpointSearchContent(picker, it, onBack = onDone, titleOverride = null, stationsOnly = false) } }
    }
}

/** 복구 「목록에 없는 역 찾기」 버튼 표식 — 역 검색 취소 복귀의 착지 키(`StationPicker`가 같은 값으로 `landingTarget`을 단다). */
internal const val RECOVERY_FIND_TAG = "transit-picker-find"

internal fun transitDestRouteTag(routeKey: String): String = "transit-dest-route-$routeKey"

/** 목적지 전환 첫 후보 착지(iOS `landFirstDestChangeRouteFocus`) — 가시화 → 지연 → 대입 → 600ms 뒤 1회 재시도(`land`). */
private suspend fun landFirstDestChangeRouteFocus(bring: BringIntoViewRequester, requester: FocusRequester) {
    withFrameNanos { }
    try { bring.bringIntoView() } catch (e: CancellationException) { throw e } catch (e: Exception) { GuideDiag.log("destChange first route reveal failed ${e::class.simpleName}") }
    land(requester, "목적지 전환 첫 후보")
}

/**
 * 주변 확인(iOS `surroundingsSection`) — 앵커는 도착 유래 판정 그대로다(E35 접근성 감사 M1): 실시간 위치를 따르면 승차 내내 역마다 앵커가 바뀌어 사용자가 연
 * 장면을 읽는 도중에 버리게 된다. 헤더는 헤딩, 본문은 도보 시트와 같은 `SceneButtonSection`(세션이 좌표 단위로 조회를 들고, 앵커가 바뀌면 지난 역 장면을
 * 버린다). 대중교통과 도보 세션은 동시에 없으므로 자리(`SceneSlot.tracking`)는 하나를 쓴다.
 */
@Composable
private fun SurroundingsSection(c: TransitRowsCtx, openPlace: (Place, String) -> Unit) {
    val state = c.ui.state ?: return
    val leg = transitUiLeg(c.ui) ?: return
    val anchor = transitSurroundingsAnchor(state, leg) ?: return
    val (key, name) = transitSurroundingsHeading(anchor)
    Text(
        c.strings.get(key, name),
        Modifier.fillMaxWidth().mergedRow("transit-surroundings-heading").headingText().padding(vertical = 8.dp),
        style = MaterialTheme.typography.titleMedium,
    )
    SceneButtonSection(
        GuideSession.sceneLookup(GuideSession.SceneSlot.tracking, BeaconDest(anchor.stop.lat, anchor.stop.lng)),
        requesterFor = { k -> c.returnFocus.requesterFor(k) },
        bringFor = { k -> c.returnBring.bringFor(k) },
        onOpenPlace = openPlace,
    )
}

/**
 * 새 경로 후보 섹션(iOS `destChangeSection`, 스펙 §4) — 확정 전이라 메인 컨트롤(옛 목적지 안내)은 그대로 남는다. 중간 상태를 만들지 않는 것이 계약이고 두 섹션
 * 공존이 그 표현이다. 후보 선택 = 확정(2단): 라벨은 결과 목록과 같은 조립(이름+요약). 3-state: 경로 없음 ≠ 조회 실패, 출구는 취소뿐.
 */
@Composable
private fun DestChangeSection(c: TransitRowsCtx, routeStrings: Strings, firstRouteBring: BringIntoViewRequester) {
    val pending = c.ui.pendingDestChange ?: return
    val lang = AppLocale.current(LocalContext.current.resources)
    Text(
        c.strings.get("android.transitGuide.destChangeHeading", pending.label),
        Modifier.fillMaxWidth().mergedRow("transit-dest-change-heading").headingText().padding(vertical = 8.dp),
        style = MaterialTheme.typography.titleMedium,
    )
    if (c.exists(TransitSheetControl.destChangeStatus)) {
        transitDestChangeStatusKey(c.ui)?.let { key ->
            Text(
                c.strings.get(key),
                Modifier.fillMaxWidth().transitLandingRow(c.targets, TransitSheetControl.destChangeStatus).padding(vertical = 8.dp),
                style = MaterialTheme.typography.bodyLarge,
            )
        }
    }
    (pending.phase as? DestChangePhase.Loaded)?.let { loaded ->
        transitRouteEntries(loaded.result, emptyList(), routeStrings).forEachIndexed { index, entry ->
            val tag = transitDestRouteTag(entry.route.routeKey)
            Button(
                onClick = {
                    if (c.model.commitDestinationChange(entry.route)) {
                        GuideFormSync.post(DirectionsEndpoint.Place(pending.label, pending.dest.lat, pending.dest.lng, pending.labelRoman))
                        c.landing.land(TransitSheetControl.status, "destChangeCommitted", expectsSystemPlacement = false)
                    } else {
                        // stale 재조회(§4.2) — 선택 행들이 사라지고 조회 중 상태 행으로 돌아간다(헌장 §5 선점).
                        c.landing.land(TransitSheetControl.destChangeStatus, "destChangeStale", expectsSystemPlacement = false)
                    }
                },
                modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp).tapTarget()
                    .then(if (index == 0) Modifier.bringIntoViewRequester(firstRouteBring) else Modifier)
                    .landingTarget(c.returnFocus.requesterFor(tag)).testTag(tag),
            ) { Text(joinText(entry.name, transitSummaryText(entry.route.summary, lang, routeStrings))) }
        }
    }
    Button(
        onClick = {
            c.model.cancelDestinationChange()
            c.landing.land(TransitSheetControl.status, "destChangeCancel", expectsSystemPlacement = false)
        },
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp).tapTarget().testTag("transit-dest-change-cancel"),
    ) { Text(c.strings.get("android.transitGuide.destChangeCancel")) }
}

/**
 * 잘못 내림 복구의 역 검색 페이지(iOS `DirectionsEndpointSearchView(recoveryStation:)`, E78 §5-2) — **지하철역만 받는다**(`stationLayoutKind == subway`). 끝점 검색
 * 모델(`EndpointPicker`)은 지하철역만 거르는 인자가 없어 시트 쪽에서 거른다: 장소 후보를 고를 때 부르는 `noteDestinationPhone` 자리에서 고른 장소의 종류를
 * 적어 두고, 확정 콜백이 그 종류로 판정한다(최근 기록·주소·현재 위치는 종류를 몰라 받지 않는다). 아니면 페이지를 연 채 검색 화면 통지로 알린다. 고른 역 좌표가
 * 출발점이다(`recoverFrom`). 열린 동안 안내 출력을 억제하고(받아쓰기 마이크) 해제는 `onDispose`, 앱 통지를 집지 않는다(`LocalModalOpen`).
 */
@Composable
private fun TransitRecoverySearchPage(strings: Strings, onPicked: () -> Unit, onCancel: () -> Unit) {
    val context = LocalContext.current
    val res = context.resources
    val scope = rememberCoroutineScope()
    val pickedKind = remember { arrayOfNulls<StationLayoutKind>(1) }
    val pickerRef = remember { arrayOfNulls<EndpointPicker>(1) }
    val picker = remember {
        EndpointPicker(
            search = SearchService(AppConfig.apiClient),
            store = RecentSearchStore(SharedPreferencesStore(context.applicationContext)),
            strings = resourceStrings(res),
            io = Dispatchers.IO,
            scope = scope,
            dataLocale = { AppLocale.dataLocale(res) },
            ranking = { null },
            // 거절하면 페이지를 연 채 두어야 하므로 닫기는 호스트가 맡는다.
            closesOnSelect = false,
            // 목적지 전화번호부가 아니라 "고른 장소의 종류를 적는 자리"로 쓴다(번호부에는 아무것도 적지 않는다).
            noteDestinationPhone = { place -> pickedKind[0] = stationLayoutKind(place) },
        ) { endpoint, _ ->
            val kind = pickedKind[0]
            pickedKind[0] = null
            val place = endpoint as? DirectionsEndpoint.Place
            if (place == null || !transitRecoverySearchAccepts(kind)) {
                pickerRef[0]?.postNotice(strings.get("android.transitGuide.recoveryNotSubway"))
            } else {
                GuideSession.transit.recoverFrom(place.lat, place.lng)
                onPicked()
            }
        }.also { it.placesOnly = true; pickerRef[0] = it }
    }
    val state by picker.state.collectAsState()
    DisposableEffect(Unit) {
        val owner = Any()
        picker.open(DirectionsFieldTarget.from)
        GuideSession.setOutputSuppressed(true, owner)
        onDispose {
            picker.close()
            GuideSession.setOutputSuppressed(false, owner)
        }
    }
    CompositionLocalProvider(LocalModalOpen provides true) {
        Box(Modifier.fillMaxSize().imePadding()) { state?.let { EndpointSearchContent(picker, it, onBack = onCancel, titleOverride = strings.get("android.transitGuide.recoveryStationSearch"), stationsOnly = true) } }
    }
}
