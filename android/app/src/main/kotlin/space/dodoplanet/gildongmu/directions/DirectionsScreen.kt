package space.dodoplanet.gildongmu.directions

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.util.Log
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import space.dodoplanet.gildongmu.a11y.StatusLine
import space.dodoplanet.gildongmu.a11y.headingText
import space.dodoplanet.gildongmu.i18n.AppLocale
import space.dodoplanet.gildongmu.kit.DataLocale
import space.dodoplanet.gildongmu.kit.DirectionsMode
import space.dodoplanet.gildongmu.kit.DirectionsModeOutcome
import space.dodoplanet.gildongmu.kit.WalkCollapse

/**
 * 길찾기 탭 루트(spec §2·§3-1, iOS `DirectionsTabView` 대응). 폼 | 끝점 검색(폼을 통째로 교체) 둘 중 하나를 그린다.
 * ViewModel 팩토리는 이 패키지가 앱 컨텍스트로 스스로 만든다(`MainActivity`는 골격 세션 소유). 실시간 안내 시작 버튼·
 * 거리 추적 섹션·공지 시트는 M4·M5 — 자리만(§3-1 표 10·11).
 */
@Composable
fun DirectionsScreen() {
    val app = LocalContext.current.applicationContext
    val factory = remember(app) { directionsViewModelFactory(app) }
    DirectionsScreen(viewModel(factory = factory))
}

@Composable
fun DirectionsScreen(vm: DirectionsViewModel) {
    val picker by vm.endpointSearch.collectAsState()
    BackHandler(enabled = picker != null) { vm.closePicker() }
    val p = picker
    if (p != null) EndpointSearchContent(vm, p) else DirectionsForm(vm)
}

@OptIn(ExperimentalComposeUiApi::class)
@Composable
private fun DirectionsForm(vm: DirectionsViewModel) {
    val s by vm.state.collectAsState()
    val context = LocalContext.current
    val res = context.resources
    val lang = remember(res) { AppLocale.current(res) }
    val dataLocale = remember(lang) { if (lang == "ko") DataLocale.ko else DataLocale.en }
    val strings = remember(res) { resourceStrings(res) }
    val fromFocus = remember { FocusRequester() }
    val toFocus = remember { FocusRequester() }
    val viaFocus = remember { FocusRequester() }
    val submitFocus = remember { FocusRequester() }
    val walkHeadingFocus = remember { FocusRequester() }
    val recentFocus = remember { mutableMapOf<String, FocusRequester>() }
    // 펼침 상태(spec §3-4): 새 조회에서만 초기화. 최단 행 펼침·도보 override는 토글 재조회에서 보존.
    var expandedAlts by remember { mutableStateOf(setOf<String>()) }
    var walkExpandedOverride by remember { mutableStateOf<Boolean?>(null) }
    var shortestExpanded by remember { mutableStateOf(false) }
    LaunchedEffect(s.resultsRevision) {
        expandedAlts = emptySet()
        walkExpandedOverride = null
        shortestExpanded = false
    }
    // 이미 허가된 세션이면 진입 시 조용히 현재 위치 주소를 병기(권한 팝업 없음).
    LaunchedEffect(Unit) { vm.loadCurrentAddressIfAuthorized() }
    // 착지 요청(spec §3-5): 한 요청 = 한 착지, 재구성이 끝난 다음 프레임에 대입(M1 관용구).
    LaunchedEffect(s.landing) {
        val landing = s.landing ?: return@LaunchedEffect
        if (landing.seq <= vm.consumedLanding) return@LaunchedEffect
        vm.consumedLanding = landing.seq
        withFrameNanos { }
        val requester = when (val t = landing.target) {
            is LandingTarget.Field -> when (t.field) {
                DirectionsFieldTarget.from -> fromFocus
                DirectionsFieldTarget.to -> toFocus
                DirectionsFieldTarget.via -> viaFocus
            }
            LandingTarget.Submit -> submitFocus
            LandingTarget.WalkHeading -> walkHeadingFocus
            is LandingTarget.RecentRoute -> recentFocus[t.id]
        }
        runCatching { requester?.requestFocus() }.onFailure { Log.w("DirectionsScreen", "착지 실패 ${landing.target}", it) }
    }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp)
            .semantics { testTagsAsResourceId = true },
    ) {
        Text(strings.get("android.tab.directions"), Modifier.headingText().padding(vertical = 12.dp), style = MaterialTheme.typography.titleLarge)

        // 필드 한 줄 = 한 객체("출발지, 현재 위치"). 비-ko 병기는 낭독만 괄호 없이.
        ActionRow(
            visual = vm.fieldText(DirectionsFieldTarget.from, accessible = false, lang = lang),
            spoken = vm.fieldText(DirectionsFieldTarget.from, accessible = true, lang = lang),
            tag = "field-from", onClick = { vm.openPicker(DirectionsFieldTarget.from) }, modifier = Modifier.focusRequester(fromFocus),
        )
        Button(onClick = vm::swap, modifier = Modifier.testTag("swap")) { Text(strings.get("directions.swap")) }
        ActionRow(
            visual = vm.fieldText(DirectionsFieldTarget.to, accessible = false, lang = lang),
            spoken = vm.fieldText(DirectionsFieldTarget.to, accessible = true, lang = lang),
            tag = "field-to", onClick = { vm.openPicker(DirectionsFieldTarget.to) }, modifier = Modifier.focusRequester(toFocus),
        )
        // 경유지(N4, 선택 사항). 삭제는 자기를 누른 버튼을 없애므로 조회 버튼을 먼저 선점한다(헌장 §5).
        if (s.via == null) {
            Button(onClick = { vm.openPicker(DirectionsFieldTarget.via) }, modifier = Modifier.testTag("via-add").focusRequester(viaFocus)) {
                Text(strings.get("directions.addVia"))
            }
        } else {
            ActionRow(
                visual = vm.fieldText(DirectionsFieldTarget.via, accessible = false, lang = lang),
                spoken = vm.fieldText(DirectionsFieldTarget.via, accessible = true, lang = lang),
                tag = "field-via", onClick = { vm.openPicker(DirectionsFieldTarget.via) }, modifier = Modifier.focusRequester(viaFocus),
            )
            Button(onClick = { submitFocus.requestFocus(); vm.clearVia() }, modifier = Modifier.testTag("via-remove")) {
                Text(strings.get("directions.removeVia"))
            }
        }
        val searchingLabel = strings.get("android.directions.searching")
        Button(
            onClick = { if (!s.isBusy) vm.runQuery() },
            modifier = Modifier
                .testTag("submit")
                .focusRequester(submitFocus)
                // disabled는 포커스를 떨군다 — 클릭 무시 + 상태 설명(헌장 §5 ⓐ, M1 관용구)
                .semantics { if (s.isBusy) stateDescription = searchingLabel },
        ) { Text(strings.get("directions.submit")) }

        StatusLine(s.notice, Modifier.padding(vertical = 8.dp))

        // 해결 버튼(spec §3-1 표 8). reduced는 재요청이 1순위, 설정 열기는 폴백으로 함께.
        if (s.phase == DirectionsPhase.GeoReduced) {
            Button(onClick = vm::requestPreciseLocation, modifier = Modifier.testTag("allow-precise")) { Text(strings.get("android.common.allowPrecise")) }
        }
        if (s.phase == DirectionsPhase.GeoDenied || s.phase == DirectionsPhase.GeoReduced) {
            Button(onClick = { openAppSettings(context) }, modifier = Modifier.testTag("open-settings")) { Text(strings.get("android.common.openSettings")) }
        }

        // 최근 경로: 결과 없는 화면에서만(실패 phase에서는 보인다 — 우회로).
        if (s.results == null && !s.isBusy && s.recentRoutes.isNotEmpty()) {
            SectionHeading(strings.get("recentRoutes.title"))
            val pinnedLabel = strings.get("recent.pinned")
            for (route in s.recentRoutes) {
                val label = vm.recentRouteLabel(route, lang)
                ActionRow(
                    visual = label, tag = "recent-route-${route.id}",
                    state = if (route.pinned) pinnedLabel else null,
                    actions = listOf(
                        CustomAccessibilityAction(strings.get(if (route.pinned) "recent.unpin" else "recent.pin")) { vm.togglePinRecentRoute(route); true },
                        CustomAccessibilityAction(strings.get("recent.delete")) { recentFocus.remove(route.id); vm.removeRecentRoute(route); true },
                    ),
                    // 결과 도착 시 이 섹션이 통째로 사라지므로 조회 버튼을 먼저 선점한다(헌장 §5).
                    onClick = { submitFocus.requestFocus(); vm.activateRecentRoute(route) },
                    modifier = Modifier.focusRequester(recentFocus.getOrPut(route.id) { FocusRequester() }),
                )
            }
            Button(onClick = vm::clearRecentRoutes, modifier = Modifier.testTag("recent-route-clear")) { Text(strings.get("recentRoutes.clearAll")) }
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
                        .then(if (mode == DirectionsMode.walk) Modifier.focusRequester(walkHeadingFocus) else Modifier)
                        .focusable()
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
                        outcome.result, expandedAlts,
                        onToggle = { key -> expandedAlts = if (key in expandedAlts) expandedAlts - key else expandedAlts + key },
                        destinationName = vm.destinationName, lang = lang, dataLocale = dataLocale, strings = strings,
                    )
                    is DirectionsModeOutcome.Walk -> WalkOutcomeRows(
                        outcome.briefing, s.walkShortest,
                        walkExpandedOverride = walkExpandedOverride,
                        onWalkToggle = { walkExpandedOverride = !(walkExpandedOverride ?: !WalkCollapse.shouldCollapse(outcome.briefing.durationSeconds)) },
                        shortestExpanded = shortestExpanded, onShortestToggle = { shortestExpanded = !shortestExpanded },
                        viaLabel = s.via?.label, strings = strings,
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

/** 앱 상세 설정(권한 해결 경로). M2 `nearby/`에도 같은 줄이 생긴다 — 통합 뒤 한 곳으로 합친다(spec §6). */
private fun openAppSettings(context: Context) {
    context.startActivity(
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + context.packageName)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
}
