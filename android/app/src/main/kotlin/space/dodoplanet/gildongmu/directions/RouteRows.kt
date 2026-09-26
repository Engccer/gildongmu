package space.dodoplanet.gildongmu.directions

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import space.dodoplanet.gildongmu.a11y.headingText
import space.dodoplanet.gildongmu.a11y.landingTarget
import space.dodoplanet.gildongmu.a11y.tapTarget
import space.dodoplanet.gildongmu.a11y.mergedRow
import space.dodoplanet.gildongmu.kit.DataLocale
import space.dodoplanet.gildongmu.kit.TransitBriefingRow
import space.dodoplanet.gildongmu.kit.WalkCollapse
import space.dodoplanet.gildongmu.kit.joinText
import space.dodoplanet.gildongmu.kit.models.CarRouteBriefing
import space.dodoplanet.gildongmu.kit.models.TransitModeAxis
import space.dodoplanet.gildongmu.kit.models.TransitRoute
import space.dodoplanet.gildongmu.kit.models.TransitRouteLeg
import space.dodoplanet.gildongmu.kit.models.TransitRouteResult
import space.dodoplanet.gildongmu.kit.models.WalkLineKind
import space.dodoplanet.gildongmu.kit.models.WalkRouteLine
import space.dodoplanet.gildongmu.kit.spokenDistanceUnits

// 길찾기 행 렌더(spec §3 머리·§3-4, iOS `RouteBriefing.swift`·`outcomeRows` 대응). 문장은 `RouteText`·`TransitLegText`가 만들고
// 여기는 시각·시맨틱 조립만. 행 관용구 둘: 비상호작용 행은 `mergedRow`, 상호작용 행은 `clickable + clearAndSetSemantics`(M1 `RecentRow`).

/**
 * 비상호작용 한 줄 = 한 객체. 거리 표기가 든 줄은 낭독에서 단위를 풀어 쓴다(`spoken`). `actions`는 접근성 작업 메뉴(사용자 지정 액션) —
 * 줄은 여전히 텍스트 한 객체로 남고 뷰 종류가 바뀌지 않는다(E45, 채팅 산문 블록 동형).
 */
@Composable
fun TextRow(
    text: String,
    tag: String,
    spoken: String? = null,
    modifier: Modifier = Modifier,
    actions: List<CustomAccessibilityAction> = emptyList(),
    /** 착지 대상이면(역 상세 복귀) — `mergedRow` 안 `focusable()` 앞에 붙는다. */
    focus: FocusRequester? = null,
) {
    val row = modifier.fillMaxWidth().mergedRow(tag, spoken, focus)
    Text(
        text,
        (if (actions.isEmpty()) row else row.semantics { customActions = actions }).padding(vertical = 8.dp),
        style = MaterialTheme.typography.bodyLarge,
    )
}

@Composable
fun SectionHeading(text: String, modifier: Modifier = Modifier) {
    Text(text, modifier.headingText().padding(top = 16.dp, bottom = 4.dp), style = MaterialTheme.typography.titleMedium)
}

/**
 * 상호작용 한 줄(필드 버튼·후보·최근 행·펼침 라벨). 낭독은 `spoken` 하나(비-ko 병기 축소), 상태는 `stateDescription`,
 * 고정/삭제는 커스텀 액션(⚠ M1 §3-5 판정 조건 — 한소네 점자 탐색이 커스텀 액션에 못 닿으면 보이는 버튼으로).
 * `clickable`이 `clearAndSetSemantics`보다 바깥이라 onClick 액션은 살아남고 안쪽 텍스트 노드만 지워진다.
 */
@Composable
fun ActionRow(
    visual: String,
    tag: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    spoken: String = visual,
    state: String? = null,
    actions: List<CustomAccessibilityAction> = emptyList(),
    /** 고정 표시 — 시각은 별 아이콘(M1 `RecentRow` 동형), 낭독은 `state`가 맡는다(아이콘은 `clearAndSetSemantics` 안이라 별도 노드가 아니다). */
    pinned: Boolean = false,
) {
    Row(
        modifier
            .fillMaxWidth()
            .clickable(role = Role.Button, onClick = onClick)
            .testTag(tag)
            .defaultMinSize(minHeight = 48.dp)
            .padding(vertical = 12.dp)
            .clearAndSetSemantics {
                contentDescription = spoken
                if (state != null) stateDescription = state
                if (actions.isNotEmpty()) customActions = actions
            },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(visual, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        if (pinned) Icon(Icons.Filled.Star, contentDescription = null)
    }
}

/**
 * 펼침 행(iOS DisclosureGroup 대응): 라벨 행은 버튼 + `stateDescription`("펼침"/"접힘"), 본문은 펼쳐진 동안만 컴포즈
 * (접힌 본문은 트리에 없다). Compose expand/collapse 시맨틱 액션은 쓰지 않는다(spec §3-4 머리·§10-6 실기기 판정).
 */
@Composable
fun DisclosureRow(
    label: String,
    tag: String,
    expanded: Boolean,
    onToggle: () -> Unit,
    strings: Strings,
    spoken: String = label,
    /** 착지 대상이면 `landingTarget`(E50 재조회로 찾은 경로 행). */
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    ActionRow(
        visual = label, tag = tag, onClick = onToggle, spoken = spoken, modifier = modifier,
        state = strings.get(if (expanded) "android.common.expanded" else "android.common.collapsed"),
    )
    if (expanded) Column(Modifier.padding(start = 12.dp)) { content() }
}

/** 대중교통 경로 목록의 한 항목(추천·대안 공통 — 컨트롤이 같고 초기 펼침만 다르다). */
data class TransitRouteEntry(val route: TransitRoute, val name: String, val defaultExpanded: Boolean)

/** `requeried`: 수단 재조회로 찾은 경로(E50) — 목록 끝에 접힌 대안으로 붙고 이름은 실린 축(`highlight`)이 정한다. */
fun transitRouteEntries(result: TransitRouteResult, requeried: List<TransitRoute>, strings: Strings): List<TransitRouteEntry> =
    listOf(TransitRouteEntry(result.recommended, strings.get("route.transit.recommended"), defaultExpanded = true)) +
        (result.alternatives + requeried).map { TransitRouteEntry(it, transitAlternativeName(it, strings), defaultExpanded = false) }

/**
 * 대중교통 본문: 추천+대안을 한 목록의 펼침 행으로. 펼침 상태 키는 `routeKey`(배열 인덱스·표시 번호 금지) —
 * `expandedAlts`는 "기본값과 다른 것"의 집합. 라벨이 요약이라 본문에 요약 재낭독 없음.
 * `stationEntry`는 지하철역 작업 메뉴 옵트인(E45) — **기본값이 없다**: push 경로가 없는 소비자가 조용히 켜지 않게 소비자마다 정한다.
 */
@Composable
fun TransitOutcomeRows(
    result: TransitRouteResult,
    expandedAlts: Set<String>,
    onToggle: (routeKey: String) -> Unit,
    destinationName: String?,
    lang: String,
    dataLocale: DataLocale,
    strings: Strings,
    stationEntry: BriefingStationEntry?,
    /** 수단 재조회(E50): 찾은 경로·축별 상태·버튼 동작·착지 요청자(키 = [requeryFocusKey]). */
    requery: TransitRequeryRowsState,
) {
    val meters = strings.get("android.unit.spokenMeters")
    val requeriedKeys = requery.found.map { it.routeKey }.toSet()
    for (entry in transitRouteEntries(result, requery.found, strings)) {
        val key = entry.route.routeKey
        val expanded = if (key in expandedAlts) !entry.defaultExpanded else entry.defaultExpanded
        val label = joinText(entry.name, transitSummaryText(entry.route.summary, lang, strings))
        val landing = if (key in requeriedKeys) Modifier.landingTarget(requery.focus(requeryRouteFocusKey(key))) else Modifier
        DisclosureRow(label = label, tag = "transit-$key", expanded = expanded, onToggle = { onToggle(key) }, strings = strings, modifier = landing) {
            val legs = entry.route.legs
            for (index in legs.indices) {
                val line = transitLegLine(legs, index, destinationName, lang, dataLocale, strings)
                val legRow = if (legs[index].mode == "walk") TransitBriefingRow.Walk(index) else TransitBriefingRow.Transit(index)
                StationRow(line.visual, "transit-$key-leg-$index", spokenDistanceUnits(line.spoken, meters), legs, legRow, dataLocale, stationEntry, strings)
                // 하차 줄은 별개 객체 — "무슨 열차"와 "어디로 내려 나가나"가 스와이프 한 번에 갈린다. 없으면 행 자체가 없다.
                alightLine(legs[index], lang, dataLocale, strings)?.let {
                    StationRow(it, "transit-$key-alight-$index", null, legs, TransitBriefingRow.Alight(index), dataLocale, stationEntry, strings)
                }
            }
        }
    }
    TransitRequeryRows(requery, strings)
}

/** 수단 재조회 행의 입력(E50) — 화면 상태를 한 묶음으로 넘긴다. */
class TransitRequeryRowsState(
    /** 서버 `requeryAxes` 중 아는 축(순서 유지). */
    val axes: List<TransitModeAxis>,
    val states: Map<TransitModeAxis, TransitRequeryState>,
    /** 찾은 경로(목록 끝 대안). */
    val found: List<TransitRoute>,
    val onRequery: (TransitModeAxis) -> Unit,
    val focus: (key: String) -> FocusRequester,
)

fun requeryRouteFocusKey(routeKey: String): String = "route:$routeKey"
fun requeryNoneFocusKey(axis: TransitModeAxis): String = "none:${axis.rawValue}"

/**
 * 재조회 한 축의 행들(E50 §4.2·§4.3, iOS `requeryRows`). 경로 목록 **뒤**, 대안이 0개여도 추천 뒤에 선다. 찾음 = 행 없음(경로가 위 목록 끝에),
 * 없음 = 버튼 자리의 문장(착지 대상), 실패 = 버튼 앞 문장 + 버튼 유지(포커스는 버튼에 머물고 통지는 모델이 냈다). 조회 중 라벨은 불변이고
 * 재탭은 모델이 무시한다(`enabled=false` 금지 — 포커스를 떨군다).
 */
@Composable
fun TransitRequeryRows(requery: TransitRequeryRowsState, strings: Strings) {
    for (axis in requery.axes) key(axis) {
        val bus = axis == TransitModeAxis.busOnly
        val state = requery.states[axis]
        if (state == TransitRequeryState.NotFound) {
            TextRow(
                strings.get(if (bus) "route.transit.requeryBusOnlyNone" else "route.transit.requerySubwayOnlyNone"),
                "requery-none-${axis.rawValue}", focus = requery.focus(requeryNoneFocusKey(axis)),
            )
        }
        if (state == TransitRequeryState.Failed) {
            TextRow(strings.get(if (bus) "route.transit.requeryBusOnlyFailed" else "route.transit.requerySubwayOnlyFailed"), "requery-failed-${axis.rawValue}")
        }
        // ⚠ 버튼 호출 자리는 하나다 — 조회 중·실패·미조회가 `when` 갈래마다 따로 부르면 Compose가 갈래 전이(조회 중 → 실패, 실패 → 재시도)에서
        // 버튼 노드를 새로 만들어 쥐고 있던 포커스가 떨어진다(헌장 §5 ⓐ "실패는 포커스가 버튼에 머문다").
        if (state == null || state == TransitRequeryState.Loading || state == TransitRequeryState.Failed) {
            RequeryButton(axis, loading = state == TransitRequeryState.Loading, requery, strings)
        }
    }
}

/** 조회 중엔 라벨을 두고 상태만 알린다(조회 버튼과 같은 관용구) — 재탭이 무시될 때 무반응으로 들리지 않게. */
@Composable
private fun RequeryButton(axis: TransitModeAxis, loading: Boolean, requery: TransitRequeryRowsState, strings: Strings) {
    val searching = strings.get("android.directions.searching")
    Button(
        onClick = { requery.onRequery(axis) },
        modifier = Modifier.tapTarget().testTag("requery-${axis.rawValue}").semantics { if (loading) stateDescription = searching },
    ) {
        Text(strings.get(if (axis == TransitModeAxis.busOnly) "route.transit.requeryBusOnly" else "route.transit.requerySubwayOnly"))
    }
}

/** 브리핑 줄 하나 — 옵트인이 꺼져 있거나 대상 역이 없으면 종전 텍스트 줄 그대로다(저장소도 관찰하지 않는다). */
@Composable
private fun StationRow(
    text: String,
    tag: String,
    spoken: String?,
    legs: List<TransitRouteLeg>,
    row: TransitBriefingRow,
    dataLocale: DataLocale,
    entry: BriefingStationEntry?,
    strings: Strings,
) {
    val actions = if (entry == null) emptyList() else briefingStationActions(legs, row, dataLocale)
    if (entry == null || actions.isEmpty()) TextRow(text, tag, spoken = spoken)
    else BriefingStationRow(text, tag, spoken, actions, entry, strings)
}

/**
 * 도보 본문: 줄 목록 펼침(E42, 대중교통 대안 동형). 라벨은 `이름, 총 …, 약 …분` 한 객체이고 사유 문장이 없다(이름이 곧 정보다).
 * 첫 줄 초기 펼침은 :kit `WalkCollapse`(표시 분과 같은 반올림), 나머지는 기본 접힘. 안내 시작 버튼은 줄 **안** 맨 위 —
 * 라벨이 그 줄 이름이라 버튼 목록에서 어느 경로의 안내인지 구분된다. 줄이 하나여도 같은 모양이다.
 */
@Composable
fun WalkOutcomeRows(
    lines: List<WalkRouteLine>,
    walkExpandedOverride: Boolean?,
    onWalkToggle: () -> Unit,
    secondExpanded: Boolean,
    onSecondToggle: () -> Unit,
    viaLabel: String?,
    strings: Strings,
    /** 도보 안내 시작 버튼 슬롯(줄 종류) — 도착 좌표가 있을 때만 화면이 넘긴다. */
    guideStart: (@Composable (line: WalkLineKind) -> Unit)? = null,
) {
    val meters = strings.get("android.unit.spokenMeters")
    // 모르는 종류를 먼저 거르고 인덱싱한다 — "첫 줄"이 하나여야 펼침 규칙이 맞다. 줄 정체성은 종류(`key`, iOS `id: \.kind`):
    // 새 조회에서 둘째 줄이 계단 회피 → 큰길로 바뀌면 자리 기준 상태를 이어받지 않는다.
    lines.mapNotNull { line -> line.lineKind?.let { it to line.route } }.forEachIndexed { index, (kind, route) -> key(kind) {
        val expanded = if (index == 0) walkExpandedOverride ?: !WalkCollapse.shouldCollapse(route.durationSeconds) else secondExpanded
        val label = walkLineLabel(kind, route, strings)
        DisclosureRow(
            label = label, tag = "walk-line-${kind.rawValue}", expanded = expanded,
            onToggle = if (index == 0) onWalkToggle else onSecondToggle, strings = strings, spoken = spokenDistanceUnits(label, meters),
        ) {
            guideStart?.invoke(kind)
            walkStepItems(route, viaLabel, strings).forEachIndexed { i, item -> TextRow(item, "walk-${kind.rawValue}-step-$i", spoken = spokenDistanceUnits(item, meters)) }
        }
    } }
}

/** 자동차 본문: 요약 1행 + 안내 행(펼침 없음 — 경로 하나). */
@Composable
fun CarOutcomeRows(briefing: CarRouteBriefing, viaLabel: String?, lang: String, strings: Strings) {
    val meters = strings.get("android.unit.spokenMeters")
    val summary = carSummaryText(briefing, lang, strings)
    TextRow(summary, "car-summary", spoken = spokenDistanceUnits(summary, meters))
    carStepItems(briefing, viaLabel, strings).forEachIndexed { i, item -> TextRow(item, "car-step-$i", spoken = spokenDistanceUnits(item, meters)) }
}
