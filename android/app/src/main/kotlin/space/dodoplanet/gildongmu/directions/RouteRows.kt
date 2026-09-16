package space.dodoplanet.gildongmu.directions

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import space.dodoplanet.gildongmu.a11y.headingText
import space.dodoplanet.gildongmu.a11y.mergedRow
import space.dodoplanet.gildongmu.kit.DataLocale
import space.dodoplanet.gildongmu.kit.WalkCollapse
import space.dodoplanet.gildongmu.kit.joinText
import space.dodoplanet.gildongmu.kit.models.CarRouteBriefing
import space.dodoplanet.gildongmu.kit.models.TransitRoute
import space.dodoplanet.gildongmu.kit.models.TransitRouteResult
import space.dodoplanet.gildongmu.kit.models.WalkRouteBriefing
import space.dodoplanet.gildongmu.kit.spokenDistanceUnits

// 길찾기 행 렌더(spec §3 머리·§3-4, iOS `RouteBriefing.swift`·`outcomeRows` 대응). 문장은 `RouteText`·`TransitLegText`가 만들고
// 여기는 시각·시맨틱 조립만. 행 관용구 둘: 비상호작용 행은 `mergedRow`, 상호작용 행은 `clickable + clearAndSetSemantics`(M1 `RecentRow`).

/** 비상호작용 한 줄 = 한 객체. 거리 표기가 든 줄은 낭독에서 단위를 풀어 쓴다(`spoken`). */
@Composable
fun TextRow(text: String, tag: String, spoken: String? = null, modifier: Modifier = Modifier) {
    Text(text, modifier.fillMaxWidth().mergedRow(tag, spoken).padding(vertical = 8.dp), style = MaterialTheme.typography.bodyLarge)
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
    content: @Composable () -> Unit,
) {
    ActionRow(
        visual = label, tag = tag, onClick = onToggle, spoken = spoken,
        state = strings.get(if (expanded) "android.common.expanded" else "android.common.collapsed"),
    )
    if (expanded) Column(Modifier.padding(start = 12.dp)) { content() }
}

/**
 * 계단 회피 토글(ko 전용, 도보 섹션 상단 — outcome과 무관하게 섹션이 보이면 노출). 재조회 중엔 라벨에 "조회 중"을
 * 병기한다(이 창의 재탭은 가드로 무시되므로 라벨이 유일한 진행 신호). `toggleable`이 자식을 병합하고 스위치 상태를 낸다.
 */
@Composable
fun StepFreeToggleRow(enabled: Boolean, busy: Boolean, onToggle: () -> Unit, strings: Strings) {
    val label = joinText(strings.get("route.pedestrian.stepFreeToggle"), if (busy) strings.get("android.directions.searching") else null)
    Row(
        Modifier
            .fillMaxWidth()
            .toggleable(value = enabled, role = Role.Switch, onValueChange = { onToggle() })
            .testTag("stepfree")
            .defaultMinSize(minHeight = 48.dp)
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        Switch(checked = enabled, onCheckedChange = null)
    }
}

/** 대중교통 경로 목록의 한 항목(추천·대안 공통 — 컨트롤이 같고 초기 펼침만 다르다). */
data class TransitRouteEntry(val route: TransitRoute, val name: String, val defaultExpanded: Boolean)

fun transitRouteEntries(result: TransitRouteResult, strings: Strings): List<TransitRouteEntry> =
    listOf(TransitRouteEntry(result.recommended, strings.get("route.transit.recommended"), defaultExpanded = true)) +
        result.alternatives.map { TransitRouteEntry(it, transitAlternativeName(it, strings), defaultExpanded = false) }

/**
 * 대중교통 본문: 추천+대안을 한 목록의 펼침 행으로. 펼침 상태 키는 `routeKey`(배열 인덱스·표시 번호 금지) —
 * `expandedAlts`는 "기본값과 다른 것"의 집합. 라벨이 요약이라 본문에 요약 재낭독 없음.
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
) {
    val meters = strings.get("android.unit.spokenMeters")
    for (entry in transitRouteEntries(result, strings)) {
        val key = entry.route.routeKey
        val expanded = if (key in expandedAlts) !entry.defaultExpanded else entry.defaultExpanded
        val label = joinText(entry.name, transitSummaryText(entry.route.summary, lang, strings))
        DisclosureRow(label = label, tag = "transit-$key", expanded = expanded, onToggle = { onToggle(key) }, strings = strings) {
            val legs = entry.route.legs
            for (index in legs.indices) {
                val line = transitLegLine(legs, index, destinationName, lang, dataLocale, strings)
                TextRow(line.visual, "transit-$key-leg-$index", spoken = spokenDistanceUnits(line.spoken, meters))
                // 하차 줄은 별개 객체 — "무슨 열차"와 "어디로 내려 나가나"가 스와이프 한 번에 갈린다. 없으면 행 자체가 없다.
                alightLine(legs[index], lang, dataLocale, strings)?.let { TextRow(it, "transit-$key-alight-$index") }
            }
        }
    }
}

/**
 * 도보 본문: 추천·최단 2행 펼침(대중교통 대안 동형). 추천 초기 펼침은 :kit `WalkCollapse`(표시 분과 같은 반올림),
 * 최단은 같은 응답 쌍만·기본 접힘. 라벨이 각 행 **자기 브리핑의** `stepFreeNotice`를 병기한다.
 */
@Composable
fun WalkOutcomeRows(
    briefing: WalkRouteBriefing,
    shortest: WalkRouteBriefing?,
    walkExpandedOverride: Boolean?,
    onWalkToggle: () -> Unit,
    shortestExpanded: Boolean,
    onShortestToggle: () -> Unit,
    viaLabel: String?,
    strings: Strings,
) {
    val meters = strings.get("android.unit.spokenMeters")
    val walkExpanded = walkExpandedOverride ?: !WalkCollapse.shouldCollapse(briefing.durationSeconds)
    val walkLabel = joinText(strings.get("directions.walkRecommended"), walkSummaryText(briefing, strings), briefing.stepFreeNotice)
    DisclosureRow(label = walkLabel, tag = "walk-recommended", expanded = walkExpanded, onToggle = onWalkToggle, strings = strings, spoken = spokenDistanceUnits(walkLabel, meters)) {
        walkStepItems(briefing, viaLabel, strings).forEachIndexed { i, item -> TextRow(item, "walk-step-$i", spoken = spokenDistanceUnits(item, meters)) }
    }
    if (shortest != null) {
        val shortLabel = joinText(strings.get("directions.walkShortest"), walkSummaryText(shortest, strings), shortest.stepFreeNotice)
        DisclosureRow(label = shortLabel, tag = "walk-shortest", expanded = shortestExpanded, onToggle = onShortestToggle, strings = strings, spoken = spokenDistanceUnits(shortLabel, meters)) {
            walkStepItems(shortest, viaLabel, strings).forEachIndexed { i, item -> TextRow(item, "walk-shortest-step-$i", spoken = spokenDistanceUnits(item, meters)) }
        }
    }
}

/** 자동차 본문: 요약 1행 + 안내 행(펼침 없음 — 경로 하나). */
@Composable
fun CarOutcomeRows(briefing: CarRouteBriefing, viaLabel: String?, lang: String, strings: Strings) {
    val meters = strings.get("android.unit.spokenMeters")
    val summary = carSummaryText(briefing, lang, strings)
    TextRow(summary, "car-summary", spoken = spokenDistanceUnits(summary, meters))
    carStepItems(briefing, viaLabel, strings).forEachIndexed { i, item -> TextRow(item, "car-step-$i", spoken = spokenDistanceUnits(item, meters)) }
}
