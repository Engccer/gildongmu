package space.dodoplanet.gildongmu.directions

import android.util.Log
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.focusable
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
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
import space.dodoplanet.gildongmu.a11y.StatusLine
import space.dodoplanet.gildongmu.a11y.headingText
import space.dodoplanet.gildongmu.a11y.tapTarget
import space.dodoplanet.gildongmu.i18n.AppLocale
import space.dodoplanet.gildongmu.kit.models.TransitLegStop
import space.dodoplanet.gildongmu.kit.DataLocale
import space.dodoplanet.gildongmu.kit.DirectionsMode
import space.dodoplanet.gildongmu.kit.DirectionsModeOutcome
import space.dodoplanet.gildongmu.guide.ui.walkGuideStartSlot
import space.dodoplanet.gildongmu.kit.WalkCollapse
import space.dodoplanet.gildongmu.location.appDetailsSettingsIntent
import space.dodoplanet.gildongmu.nav.tryStartActivity
import space.dodoplanet.gildongmu.settings.SETTINGS_RETURN_KEY
import space.dodoplanet.gildongmu.settings.SettingsAction

/**
 * 길찾기 탭 루트(spec §2·§3-1, iOS `DirectionsTabView` 대응). 폼 위에 끝점 검색을 **덮어씌운다**(폼은 컴포즈 유지) —
 * 형제 교체로 하면 폼의 펼침·스크롤 상태가 피커 왕복(취소 복귀)에 소멸한다(구현 리뷰 MA-1). 보이는 것은 하나뿐이고
 * 라이브 리전도 하나만 컴포즈된다(폼의 `StatusLine`은 피커가 덮은 동안 숨김 트리 밖).
 * ViewModel 팩토리는 이 패키지가 앱 컨텍스트로 스스로 만든다(`MainActivity`는 골격 세션 소유). 실시간 안내 시작 버튼·
 * 거리 추적 섹션·공지 시트는 M4·M5 — 자리만(§3-1 표 10·11).
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
    val p = picker
    Box(Modifier.fillMaxSize()) {
        if (p == null) DirectionsForm(vm, formState, onOpenSettings, settingsFocus, onOpenStation) else EndpointSearchContent(vm.picker, p, onBack = vm::closePicker)
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
    shortestExpanded: Boolean = false,
    seenResultsRevision: Int = 0,
) {
    var expandedAlts by mutableStateOf(expandedAlts)
    var walkExpandedOverride by mutableStateOf(walkExpandedOverride)
    var shortestExpanded by mutableStateOf(shortestExpanded)
    var seenResultsRevision by mutableStateOf(seenResultsRevision)
    /** 역 작업 메뉴를 든 브리핑 줄(태그 → 요청자) — 역 상세 pop 복귀 착지. */
    val stationRowFocus = mutableMapOf<String, FocusRequester>()
    val fromFocus = FocusRequester()
    val toFocus = FocusRequester()
    val viaFocus = FocusRequester()
    val submitFocus = FocusRequester()
    val walkHeadingFocus = FocusRequester()
    val recentFocus = mutableMapOf<String, FocusRequester>()

    fun resetExpansion(revision: Int) {
        expandedAlts = emptySet()
        walkExpandedOverride = null
        shortestExpanded = false
        seenResultsRevision = revision
    }

    companion object {
        val Saver: Saver<FormUiState, Any> = listSaver(
            save = { listOf(ArrayList(it.expandedAlts), it.walkExpandedOverride, it.shortestExpanded, it.seenResultsRevision) },
            restore = {
                @Suppress("UNCHECKED_CAST")
                FormUiState((it[0] as List<String>).toSet(), it[1] as Boolean?, it[2] as Boolean, it[3] as Int)
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
    // 새 조회 = 새 경로들이라 펼침을 기본으로 되돌린다(토글 재조회·피커 왕복은 보존).
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
    // 착지 요청(spec §3-5): 한 요청 = 한 착지, 재구성이 끝난 다음 프레임에 대입(M1 관용구).
    LaunchedEffect(s.landing) {
        val landing = s.landing ?: return@LaunchedEffect
        if (landing.seq <= vm.consumedLanding) return@LaunchedEffect
        vm.consumedLanding = landing.seq
        withFrameNanos { }
        val requester = when (val t = landing.target) {
            is LandingTarget.Field -> when (t.field) {
                DirectionsFieldTarget.from -> ui.fromFocus
                DirectionsFieldTarget.to -> ui.toFocus
                DirectionsFieldTarget.via -> ui.viaFocus
                DirectionsFieldTarget.manualLocation -> null.also { Log.w("DirectionsScreen", "길찾기 폼에 없는 필드 착지 $t") } // 착지 하나로 앱을 죽이지 않는다
            }
            LandingTarget.Submit -> ui.submitFocus
            LandingTarget.WalkHeading -> ui.walkHeadingFocus
            is LandingTarget.RecentRoute -> ui.recentFocus[t.id]
        }
        runCatching { requester?.requestFocus() }.onFailure { Log.w("DirectionsScreen", "착지 실패 ${landing.target}", it) }
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
            // 필드 한 줄 = 한 객체("출발지, 현재 위치"). 비-ko 병기는 낭독만 괄호 없이.
            ActionRow(
                visual = vm.fieldText(DirectionsFieldTarget.from, accessible = false, lang = lang, nowEpoch = now),
                spoken = vm.fieldText(DirectionsFieldTarget.from, accessible = true, lang = lang, nowEpoch = now),
                tag = "field-from", onClick = { vm.openPicker(DirectionsFieldTarget.from) }, modifier = Modifier.landingTarget(ui.fromFocus),
            )
            Button(onClick = vm::swap, modifier = Modifier.tapTarget().testTag("swap")) { Text(strings.get("directions.swap")) }
            ActionRow(
                visual = vm.fieldText(DirectionsFieldTarget.to, accessible = false, lang = lang, nowEpoch = now),
                spoken = vm.fieldText(DirectionsFieldTarget.to, accessible = true, lang = lang, nowEpoch = now),
                tag = "field-to", onClick = { vm.openPicker(DirectionsFieldTarget.to) }, modifier = Modifier.landingTarget(ui.toFocus),
            )
            // 경유지(N4, 선택 사항). 삭제는 자기를 누른 버튼을 없애므로 조회 버튼을 먼저 선점한다(헌장 §5).
            if (s.via == null) {
                Button(
                    onClick = { vm.openPicker(DirectionsFieldTarget.via) },
                    modifier = Modifier.tapTarget().testTag("via-add").landingTarget(ui.viaFocus),
                ) { Text(vm.fieldText(DirectionsFieldTarget.via, accessible = true, lang = lang)) }
            } else {
                ActionRow(
                    visual = vm.fieldText(DirectionsFieldTarget.via, accessible = false, lang = lang),
                    spoken = vm.fieldText(DirectionsFieldTarget.via, accessible = true, lang = lang),
                    tag = "field-via", onClick = { vm.openPicker(DirectionsFieldTarget.via) }, modifier = Modifier.landingTarget(ui.viaFocus),
                )
                Button(onClick = { ui.submitFocus.requestFocus(); vm.clearVia() }, modifier = Modifier.tapTarget().testTag("via-remove")) {
                    Text(strings.get("directions.removeVia"))
                }
            }
            val searchingLabel = strings.get("android.directions.searching")
            // 진행 표시는 조회 자신이 도는 동안만 — 계단 회피 재조회는 토글 행이 "조회 중"을 병기한다(구현 리뷰 NIT 7).
            val querying = s.phase == DirectionsPhase.Locating || s.phase == DirectionsPhase.Loading
            Button(
                onClick = { if (!s.isBusy) vm.runQuery() },
                modifier = Modifier
                    .tapTarget()
                    .testTag("submit")
                    .landingTarget(ui.submitFocus)
                    // disabled는 포커스를 떨군다 — 클릭 무시 + 상태 설명(헌장 §5 ⓐ, M1 관용구)
                    .semantics { if (querying) stateDescription = searchingLabel },
            ) { Text(strings.get("directions.submit")) }

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

            // 최근 경로: 결과 없는 화면에서만(실패 phase에서는 보인다 — 우회로).
            if (s.results == null && !s.isBusy && s.recentRoutes.isNotEmpty()) {
                SectionHeading(strings.get("recentRoutes.title"))
                val pinnedLabel = strings.get("recent.pinned")
                for (route in s.recentRoutes) {
                    val label = vm.recentRouteLabel(route, lang)
                    ActionRow(
                        visual = label, tag = "recent-route-${route.id}",
                        state = if (route.pinned) pinnedLabel else null, pinned = route.pinned,
                        actions = listOf(
                            CustomAccessibilityAction(strings.get(if (route.pinned) "recent.unpin" else "recent.pin")) { vm.togglePinRecentRoute(route); true },
                            CustomAccessibilityAction(strings.get("recent.delete")) { ui.recentFocus.remove(route.id); vm.removeRecentRoute(route); true },
                        ),
                        // 결과 도착 시 이 섹션이 통째로 사라지므로 조회 버튼을 먼저 선점한다(헌장 §5).
                        onClick = { ui.submitFocus.requestFocus(); vm.activateRecentRoute(route) },
                        modifier = Modifier.landingTarget(ui.recentFocus.getOrPut(route.id) { FocusRequester() }),
                    )
                }
                Button(onClick = { ui.recentFocus.clear(); vm.clearRecentRoutes() }, modifier = Modifier.tapTarget().testTag("recent-route-clear")) {
                    Text(strings.get("recentRoutes.clearAll"))
                }
            }

            // (예약) 거리 추적 섹션 — M4. 조회 버튼과 수단 섹션 사이.

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
                            // 도보 헤딩만 착지 대상(계단 회피 재조회) — 요청자는 focusable 앞(M2 소스 가드).
                            .then(if (mode == DirectionsMode.walk) Modifier.landingTarget(ui.walkHeadingFocus).focusable() else Modifier)
                            .padding(top = 16.dp, bottom = 4.dp),
                        style = MaterialTheme.typography.titleMedium,
                    )
                    // (예약) 수단별 안내 시작 버튼 — 자동차는 여기, 도보·대중교통은 각 경로 행 펼침 본문 첫 항목(M4·M5).
                    // 계단 회피 토글은 outcome과 무관하게 도보 섹션이 보이면 노출(ko 전용) — 켠 뒤 실패해도 되돌릴 수단이 남는다.
                    if (mode == DirectionsMode.walk && lang == "ko") {
                        StepFreeToggleRow(enabled = s.stepFreeEnabled, busy = s.stepFreeBusy, onToggle = vm::toggleStepFree, strings = strings)
                    }
                    when (val outcome = results.outcomes[mode]) {
                        is DirectionsModeOutcome.Transit -> TransitOutcomeRows(
                            outcome.result, ui.expandedAlts,
                            onToggle = { key -> ui.expandedAlts = if (key in ui.expandedAlts) ui.expandedAlts - key else ui.expandedAlts + key },
                            destinationName = vm.destinationName, lang = lang, dataLocale = dataLocale, strings = strings,
                            stationEntry = stationEntry,
                        )
                        is DirectionsModeOutcome.Walk -> WalkOutcomeRows(
                            outcome.briefing, s.walkShortest,
                            walkExpandedOverride = ui.walkExpandedOverride,
                            onWalkToggle = { ui.walkExpandedOverride = !(ui.walkExpandedOverride ?: !WalkCollapse.shouldCollapse(outcome.briefing.durationSeconds)) },
                            shortestExpanded = ui.shortestExpanded, onShortestToggle = { ui.shortestExpanded = !ui.shortestExpanded },
                            viaLabel = s.via?.label, strings = strings,
                            guideStart = walkGuideStartSlot(s, lang),
                        )
                        is DirectionsModeOutcome.Car -> CarOutcomeRows(outcome.briefing, s.via?.label, lang, strings)
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
