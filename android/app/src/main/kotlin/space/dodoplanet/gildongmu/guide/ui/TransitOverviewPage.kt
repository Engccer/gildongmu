package space.dodoplanet.gildongmu.guide.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import space.dodoplanet.gildongmu.a11y.BodyLine
import space.dodoplanet.gildongmu.a11y.HeadingLine
import space.dodoplanet.gildongmu.a11y.landingTarget
import space.dodoplanet.gildongmu.a11y.requesterFor
import space.dodoplanet.gildongmu.a11y.tapTarget
import space.dodoplanet.gildongmu.directions.DisclosureRow
import space.dodoplanet.gildongmu.directions.Strings
import space.dodoplanet.gildongmu.directions.TextRow
import space.dodoplanet.gildongmu.directions.alightLine
import space.dodoplanet.gildongmu.directions.resourceStrings
import space.dodoplanet.gildongmu.directions.transitLegLine
import space.dodoplanet.gildongmu.directions.transitRouteEntries
import space.dodoplanet.gildongmu.directions.transitSummaryText
import space.dodoplanet.gildongmu.guide.AltFailReason
import space.dodoplanet.gildongmu.guide.AltRouteCommit
import space.dodoplanet.gildongmu.guide.AltRoutesPhase
import space.dodoplanet.gildongmu.guide.GuideSession
import space.dodoplanet.gildongmu.guide.TransitGuideUiState
import space.dodoplanet.gildongmu.guide.transitGuideIsEn
import space.dodoplanet.gildongmu.i18n.AppLocale
import space.dodoplanet.gildongmu.kit.DataLocale
import space.dodoplanet.gildongmu.kit.joinText

/**
 * 조망이 닫힌 뒤 시트가 할 일(iOS `GuideOverviewSheet`의 `followUp` 콜백 → 시트 `OverviewFollowUp`, E15-1 spec §4.3 「닫힌 뒤 행동」 계약).
 * 조망 안에서 시트 컨트롤에 착지하거나 `beginReboard()`를 직접 부르지 않는다 — 페이지가 닫힌 뒤 시트 한 곳(`runPendingFollowUp`)이 실행한다.
 */
enum class TransitOverviewExit {
    /** 「탑승 변경」 — 닫힌 뒤 모델 `beginReboard()`(역을 물을 수 있는 구간은 질문 헤딩, 그 밖은 대기 목록 라벨 착지가 맡는다). */
    beginReboard,
    /** 다른 경로로 전환 확정 — 닫힌 뒤 상태 문장 착지(E38, 새 경로의 첫 상태를 읽는 자리). */
    routeSwitched,
}

/**
 * 대중교통 진행 상황 조망 페이지(iOS `GuideOverviewSheet` + `TransitOverviewAdapter`, E15-1). 시트 안의 페이지라(M4b — 시트 위에 시트를 올리지 않는다)
 * 시트가 고른다: 진행 상황 버튼이 열고, 뒤로·닫기·국면 전이가 닫는다. 진입 착지(헤더)는 이 페이지가 맡는다.
 *
 * `onClose(exit)`: 닫기 — `exit`이 null이면 그냥 닫기(시트가 이월된 착지 또는 진행 상황 버튼으로 되돌린다), 아니면 닫힌 뒤 할 일. 조망이 열린 채 국면이
 * 바뀌면 시트가 스스로 닫는다(그 행·행동은 낡았다). 「다른 경로」 조회는 페이지가 어떤 경로로 닫혀도 시트가 `cancelAltRoutes`로 거둔다.
 */
@Composable
fun TransitOverviewPage(ui: TransitGuideUiState, strings: Strings, nav: GuideNav, onClose: (exit: TransitOverviewExit?) -> Unit) {
    val model = GuideSession.transit
    val res = LocalContext.current.resources
    val dataLocale = remember(res) { DataLocale.fromRawValue(AppLocale.dataLocale(res)) ?: DataLocale.ko }
    val isEn = transitGuideIsEn(dataLocale)
    // 길찾기 문장(구간 줄·경로 이름·요약)은 길찾기 문자열 창구의 키다 — 안내 문자열 창구와 키 표가 다르다.
    val routeStrings = remember(res) { resourceStrings(res) }
    val lang = remember(res) { AppLocale.current(res) }
    // 다른 경로는 같은 시트 안의 하위 페이지다(M4b — 시트 위에 시트를 올리지 않는다). 뒤로·닫기는 그 하위 페이지만 닫고 조망으로 돌아온다.
    var alt by remember { mutableStateOf(false) }
    var returnsFromAlt by remember { mutableStateOf(false) }
    val latch = remember { TransitOverviewLatch() }
    BackHandler(enabled = alt) { alt = false; returnsFromAlt = true }
    if (alt) {
        TransitAltRoutesPage(ui, strings, routeStrings, lang, dataLocale, isEn, onBack = { alt = false; returnsFromAlt = true }, onClose = onClose)
    } else {
        TransitOverviewMain(ui, strings, isEn, latch, returnsFromAlt, onViewAlternatives = { alt = true }, onClose = onClose)
    }
}

/**
 * 조망 본문(iOS `GuideOverviewSheet` 대중교통 갈래): 상단 닫기(행이 있을 때) → 헤더(진입 착지 — 낭독이 곧 조망 문장) → 행 → 「다른 경로 보기」(행 목록 뒤·말미 닫기 앞 —
 * 조망의 주 목적을 밀지 않는다) → 말미 닫기. 상단 닫기는 헤더 착지 다음 한 스와이프에 출구를 둔다. 헤더는 조용히 최신화된다(live region 아님 — 조회형 정보).
 * 하위 페이지에서 돌아오면 「다른 경로 보기」에 앉는다(iOS는 시스템이 표시 직전 요소로 되돌린다).
 */
@Composable
private fun TransitOverviewMain(
    ui: TransitGuideUiState,
    strings: Strings,
    isEn: Boolean,
    latch: TransitOverviewLatch,
    returnsFromAlt: Boolean,
    onViewAlternatives: () -> Unit,
    onClose: (TransitOverviewExit?) -> Unit,
) {
    val model = GuideSession.transit
    val headerFocus = remember { FocusRequester() }
    val altFocus = remember { FocusRequester() }
    val altBring = remember { BringIntoViewRequester() }
    val header = transitOverviewHeaderText(model, ui, strings)
    val rows = transitOverviewRows(model, ui, strings, isEn, latch)
    val offersAlt = transitOverviewOffersAlternatives(model)
    // 진입 착지는 여기 한 곳. 하위 페이지에서 돌아왔는데 버튼이 없으면(노출이 꺼졌다) 헤더로 물러난다 — 없는 버튼에 착지하면 커서가 어디에도 가지 않는다.
    LaunchedEffect(Unit) {
        if (returnsFromAlt && offersAlt) landRevealed(altBring, altFocus, "다른 경로 보기 버튼") else land(headerFocus, "조망 헤더")
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        if (rows.isNotEmpty()) {
            Button(onClick = { onClose(null) }, modifier = Modifier.fillMaxWidth().tapTarget().testTag("transit-overview-close-top")) { Text(strings.get("actions.close")) }
        }
        HeadingLine(header, "transit-overview-header", focus = headerFocus)
        for (row in rows) key(row.id) {
            when (row) {
                is TransitOverviewItem.Text -> BodyLine(row.text, "transit-overview-${row.id}")
                is TransitOverviewItem.Action -> Button(
                    // 누른 시점에 재검증 — 국면이 바뀌었으면 아무것도 하지 않는다(그 전이가 이미 통지·착지를 했다).
                    onClick = { transitOverviewPerformReboard(GuideSession.transit.ui.value)?.let { onClose(it) } },
                    modifier = Modifier.fillMaxWidth().tapTarget().testTag("transit-overview-${row.id}"),
                ) { Text(row.label) }
            }
        }
        if (offersAlt) {
            Button(onClick = onViewAlternatives, modifier = Modifier.fillMaxWidth().tapTarget().bringIntoViewRequester(altBring).landingTarget(altFocus).testTag("transit-view-alternatives")) {
                Text(strings.get("transitGuide.viewAlternatives"))
            }
        }
        Button(onClick = { onClose(null) }, modifier = Modifier.fillMaxWidth().tapTarget().testTag("transit-overview-close")) { Text(strings.get("actions.close")) }
    }
}

/**
 * 「다른 경로」 하위 페이지(iOS `TransitAltRoutesSheet`, E15-1 spec §5.5): 헤더(기준 위치) → 상태 행 또는 후보 펼침(라벨 = 이름+요약, 본문 = 구간 행 + 「이 경로로 전환」) → 닫기.
 * **미리 보고 전환**(A안)이 이 펼침이다. 무엇을 기준으로 한 목록인지가 SR 사용자의 유일한 정보원이라 헤더가 근거를 말한다. 착지: 진입 = 헤더, 후보 도착 = 첫 후보, 없음·실패 =
 * 상태 행, 실패 행의 「{승차역} 기준으로 조회」가 자기를 지운 전이 = 조회 중 행(헌장 §5), 전환 불발 = 그 자리 문구 행. 페이지가 어떤 경로로 사라져도 진행 중 조회를 폐기한다.
 */
@Composable
private fun TransitAltRoutesPage(
    ui: TransitGuideUiState,
    strings: Strings,
    routeStrings: Strings,
    lang: String,
    dataLocale: DataLocale,
    isEn: Boolean,
    onBack: () -> Unit,
    onClose: (TransitOverviewExit?) -> Unit,
) {
    val model = GuideSession.transit
    val scope = rememberCoroutineScope()
    val headerFocus = remember { FocusRequester() }
    val statusFocus = remember { FocusRequester() }
    val routeFocus = remember { mutableMapOf<String, FocusRequester>() }
    val invalidFocus = remember { mutableMapOf<String, FocusRequester>() }
    // 이 페이지가 연 요청의 토큰 — 취소·커밋에 되돌려 자기 요청만 건드린다.
    var token by remember { mutableStateOf<Int?>(null) }
    var invalidRouteKeys by remember { mutableStateOf(emptySet<String>()) }
    var expanded by remember { mutableStateOf(emptySet<String>()) }
    val previousPhase = remember { arrayOfNulls<AltRoutesPhase>(1) }

    DisposableEffect(Unit) {
        token = model.prepareAltRoutes(declaredBoardStop = false)
        onDispose { GuideSession.transit.ui.value.pendingAltRoutes?.token?.let { GuideSession.transit.cancelAltRoutes(it) } }
    }
    LaunchedEffect(Unit) { land(headerFocus, "다른 경로 헤더") }
    val pending = ui.pendingAltRoutes?.takeIf { it.token == token }
    LaunchedEffect(token, pending?.phase) {
        val phase = pending?.phase ?: return@LaunchedEffect
        val previous = previousPhase[0]
        previousPhase[0] = phase
        when (phase) {
            // 첫 후보 착지 — 도착 통지는 내지 않는다(착지 낭독이 첫 후보를 읽는다).
            is AltRoutesPhase.Loaded -> transitRouteEntries(phase.result, emptyList(), routeStrings).firstOrNull()?.let { land(routeFocus.requesterFor(it.route.routeKey), "첫 후보") }
            AltRoutesPhase.Empty, is AltRoutesPhase.Failed -> land(statusFocus, "상태 행")
            // 실패 행의 「{승차역} 기준으로 조회」가 자기를 지운 전이 — 조회 중 행에 선점(헌장 §5). 첫 조회(페이지 열림)는 헤더 착지가 정본이라 제외.
            AltRoutesPhase.Loading -> if (previous is AltRoutesPhase.Failed) land(statusFocus, "조회 중 행")
        }
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        HeadingLine(transitAltHeaderText(model, ui, strings, isEn), "transit-alt-header", focus = headerFocus)
        when (val phase = pending?.phase) {
            AltRoutesPhase.Loading -> TextRow(strings.get("android.transitGuide.destChangeLoading"), "transit-alt-status", focus = statusFocus)
            AltRoutesPhase.Empty -> TextRow(strings.get("android.transitGuide.altNone"), "transit-alt-status", focus = statusFocus)
            is AltRoutesPhase.Failed -> {
                TextRow(
                    strings.get(if (phase.reason == AltFailReason.noLocation) "android.transitGuide.altNoLocation" else "android.transitGuide.destChangeError"),
                    "transit-alt-status", focus = statusFocus,
                )
                // 승차 전 GPS 실패: 승차역을 앱이 추정하지 않고 사용자가 선언한다(§5.3).
                if (phase.reason == AltFailReason.noLocation) {
                    transitAltFromBoardStopLabel(model, ui, strings, isEn)?.let { label ->
                        Button(
                            onClick = { token = model.prepareAltRoutes(declaredBoardStop = true) },
                            modifier = Modifier.fillMaxWidth().tapTarget().testTag("transit-alt-from-board"),
                        ) { Text(label) }
                    }
                }
            }
            is AltRoutesPhase.Loaded -> for (entry in transitRouteEntries(phase.result, emptyList(), routeStrings)) {
                val key = entry.route.routeKey
                DisclosureRow(
                    label = joinText(entry.name, transitSummaryText(entry.route.summary, lang, routeStrings)),
                    tag = "transit-alt-$key",
                    expanded = key in expanded,
                    onToggle = { expanded = if (key in expanded) expanded - key else expanded + key },
                    strings = routeStrings,
                    modifier = Modifier.landingTarget(routeFocus.requesterFor(key)),
                ) {
                    // 라벨이 이미 요약이라 본문은 구간만(인접 중복 금지). 영어 줄의 마지막 도보는 목적지 라틴 표기, 없으면 「목적지까지」(A52·A53).
                    val legs = entry.route.legs
                    for (index in legs.indices) {
                        val line = transitLegLine(legs, index, ui.destinationLabel, null, lang, dataLocale, routeStrings)
                        TextRow(line.visual, "transit-alt-$key-leg-$index", spoken = line.spoken.takeIf { it != line.visual })
                        alightLine(legs[index], lang, dataLocale, routeStrings)?.let { TextRow(it, "transit-alt-$key-alight-$index") }
                    }
                    if (key in invalidRouteKeys) {
                        TextRow(strings.get("android.transitGuide.altInvalid"), "transit-alt-$key-invalid", focus = invalidFocus.requesterFor(key))
                    } else {
                        Button(
                            onClick = {
                                val mine = token ?: return@Button
                                when (model.commitAltRoute(entry.route, mine)) {
                                    AltRouteCommit.committed -> onClose(TransitOverviewExit.routeSwitched)
                                    // 근거 변화·stale 재조회 — 선택 행들이 사라지고 조회 중 행으로 돌아간다(헌장 §5 선점). 토큰은 새 요청의 것으로 갈아탄다.
                                    AltRouteCommit.refetching -> {
                                        token = model.ui.value.pendingAltRoutes?.token
                                        scope.launch { land(statusFocus, "재조회 상태 행") }
                                    }
                                    // 사라진 버튼 대신 그 문구 행에 선점.
                                    AltRouteCommit.invalidCandidate -> {
                                        invalidRouteKeys = invalidRouteKeys + key
                                        scope.launch { land(invalidFocus.requesterFor(key), "전환 불발 행") }
                                    }
                                    AltRouteCommit.sessionEnded -> onClose(null)
                                }
                            },
                            modifier = Modifier.fillMaxWidth().tapTarget().testTag("transit-alt-adopt-$key"),
                        ) { Text(strings.get("android.transitGuide.adoptRoute")) }
                    }
                }
            }
            null -> Unit
        }
        Button(onClick = onBack, modifier = Modifier.fillMaxWidth().tapTarget().testTag("transit-alt-close")) { Text(strings.get("actions.close")) }
    }
}
