package space.dodoplanet.gildongmu.directions

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import space.dodoplanet.gildongmu.a11y.headingText
import space.dodoplanet.gildongmu.a11y.mergedRow
import space.dodoplanet.gildongmu.a11y.tapTarget
import space.dodoplanet.gildongmu.guide.GuideSession
import space.dodoplanet.gildongmu.guide.JourneyPlan
import space.dodoplanet.gildongmu.guide.TransitAboardStart
import space.dodoplanet.gildongmu.kit.BeaconDest
import space.dodoplanet.gildongmu.kit.DataLocale
import space.dodoplanet.gildongmu.kit.DirectionsEndpoint
import space.dodoplanet.gildongmu.kit.JourneyLineQualifiers
import space.dodoplanet.gildongmu.kit.JourneyStationKind
import space.dodoplanet.gildongmu.kit.RecentStation
import space.dodoplanet.gildongmu.kit.alightsAtBusStop
import space.dodoplanet.gildongmu.kit.boardsAtBusStop
import space.dodoplanet.gildongmu.kit.journeyLineQualifiers
import space.dodoplanet.gildongmu.kit.journeyQualifiedStationName
import space.dodoplanet.gildongmu.kit.journeyRecommendedTitleIsBoardSide
import space.dodoplanet.gildongmu.kit.journeyStationDisplayName
import space.dodoplanet.gildongmu.kit.models.CarRouteBriefing
import space.dodoplanet.gildongmu.kit.models.EgressKind
import space.dodoplanet.gildongmu.kit.models.EgressOption
import space.dodoplanet.gildongmu.kit.models.JourneyMissingSide
import space.dodoplanet.gildongmu.kit.models.JourneyResult
import space.dodoplanet.gildongmu.kit.models.JourneyVariant
import space.dodoplanet.gildongmu.kit.models.JourneyVariantKind
import kotlin.math.roundToInt

// 길찾기 여정 결과(B26 단계 5 묶음 C, iOS `JourneyResultRows.swift` 미러). 문장 함수는 iOS와 같은 이름·같은 키·같은 순서이고 순수하다.
// 읽기 순서(E70 §5.2): 못 찾음 줄 → (변형 둘이면) 변형 선택 버튼 + 고른 변형의 제목(heading) → 합계 → 택시 앞 → 대중교통 구간 → 출구 선택 → 안내 시작.
// 줄마다 한 접근성 객체(쉼표 결합)이고 섹션 머리는 없다. heading은 고른 변형 제목 한 줄에만 둔다 — 선택 버튼에 heading을 달면 고르지 않은 변형의
// 제목 아래에 고른 변형의 합계가 이어져 "heading = 뒤따르는 내용의 제목" 약속이 깨진다(접근성 감사 M2).

/** 안내 시작의 도착지(iOS `trackedDestination`) — 도착지가 좌표를 가진 장소일 때만 있다. */
data class JourneyDestination(val label: String, val dest: BeaconDest)

/**
 * 도착지 판정(iOS `trackedDestination`): 승격본(A11)이 있으면 그쪽, 아니면 도착 칸의 장소. 「현재 위치」가 도착이면 null — 버튼이 없다.
 * (`transitGuideStartSlot`·도보·자동차 슬롯과 같은 규칙이다.)
 */
fun journeyDestinationOf(s: DirectionsUiState): JourneyDestination? =
    s.promotedDestination?.let { JourneyDestination(it.label, BeaconDest(it.lat, it.lng)) }
        ?: (s.to as? DirectionsEndpoint.Place)?.let { JourneyDestination(it.label, BeaconDest(it.lat, it.lng)) }

private fun minutesOf(briefing: CarRouteBriefing): Int = (briefing.durationSeconds / 60.0).roundToInt()

private fun minutesText(briefing: CarRouteBriefing): String = minutesOf(briefing).toString()

/**
 * 변형 제목(§8.4 표 + 그 아래 조합 규칙). 지정 역 경로는 지정한 쪽의 역 이름, 추천은 다른 쪽(둘 다 다르면 승차 쪽)을 말하고, 그 쪽 탈것이 버스면
 * 정류장 문장이다. 안내 시작 버튼 라벨도 이 이름을 쓴다(로터에서 어느 경로인지 들린다). 동명 이역이면 그 쪽 역 이름 앞에 노선을 붙인다(판정 26).
 */
fun journeyVariantHeading(v: JourneyVariant, board: RecentStation?, alight: RecentStation?, lines: JourneyLineQualifiers, strings: Strings): String {
    val vehicles = v.transit.legs.filter { it.mode != "walk" }
    val first = vehicles.firstOrNull()
    val last = vehicles.lastOrNull()
    fun named(name: String, line: String?, qualified: Boolean) = if (qualified) journeyQualifiedStationName(name, line) else journeyStationDisplayName(name)
    when (v.kind) {
        JourneyVariantKind.designated -> {
            // 지정 경로가 버스로 시작·끝나면 정류장 문장이다(역을 골랐어도 그 이름의 정류장 경로가 잡히면 무엇이 잡혔는지 들린다).
            if (board != null && first?.mode == "bus") return strings.get("android.journey.designatedHeadingBus", first.fromName ?: board.label)
            if (board == null && last?.mode == "bus") return strings.get("android.journey.designatedHeadingBusAlight", last.toName ?: alight?.label ?: "")
            if (board != null) {
                return strings.get("android.journey.designatedHeading", named(first?.fromName ?: board.label, first?.lineName ?: board.line, lines.board))
            }
            return strings.get("android.journey.designatedHeadingAlight", named(last?.toName ?: alight?.label ?: "", last?.lineName ?: alight?.line, lines.alight))
        }
        JourneyVariantKind.recommended -> {
            if (journeyRecommendedTitleIsBoardSide(v, board, alight, lines)) {
                val name = first?.fromName ?: ""
                return if (first?.mode == "bus") strings.get("android.journey.recommendedHeadingBus", name)
                else strings.get("android.journey.recommendedHeading", named(name, first?.lineName, lines.board))
            }
            val name = last?.toName ?: ""
            return if (last?.mode == "bus") strings.get("android.journey.recommendedHeadingBusAlight", name)
            else strings.get("android.journey.recommendedHeadingAlight", named(name, last?.lineName, lines.alight))
        }
    }
}

/**
 * 판정 14: 지정 역 경로를 못 찾았다는 사실 한 줄(양쪽이면 두 줄, 새 문장 없음 — spec §3.2). 동명 이역이면 고른 역의 노선을 붙인다(판정 26).
 * 길찾기 결과 화면과 채팅 여정 카드(E70-b)가 같은 함수를 쓴다.
 */
fun journeyMissingLines(result: JourneyResult, board: RecentStation?, alight: RecentStation?, strings: Strings): List<String> {
    val side = result.designatedMissing?.side ?: return emptyList()
    val lines = journeyLineQualifiers(result, board, alight)
    // 정류장 입력은 원문 그대로 말한다(역 표시 이름 함수로 깎지 않는다).
    val boardLine = board?.let {
        if (it.kind == JourneyStationKind.busStop) strings.get("android.journey.designatedMissingStop", it.label)
        else strings.get("android.journey.designatedMissing", if (lines.board) journeyQualifiedStationName(it.label, it.line) else journeyStationDisplayName(it.label))
    }
    val alightLine = alight?.let {
        if (it.kind == JourneyStationKind.busStop) strings.get("android.journey.designatedMissingStopAlight", it.label)
        else strings.get("android.journey.designatedMissingAlight", if (lines.alight) journeyQualifiedStationName(it.label, it.line) else journeyStationDisplayName(it.label))
    }
    return when (side) {
        JourneyMissingSide.board -> listOfNotNull(boardLine)
        JourneyMissingSide.alight -> listOfNotNull(alightLine)
        JourneyMissingSide.both -> listOfNotNull(boardLine, alightLine)
    }
}

/**
 * 합계는 서버가 기본 출구로 낸 값이다 — 다른 출구·승강장을 고르면 그 택시 구간만큼 바꿔 말한다. 카드는 첫 출구(= 기본)라 그대로다.
 * `aboard`면 대중교통 요금을 말하지 않는다(이미 낸 요금 — R13).
 */
fun journeyTotalsLine(variant: JourneyVariant, egress: EgressOption?, aboard: Boolean, strings: Strings, lang: String): String {
    var minutes = variant.totals.minutes
    var taxiFare = variant.totals.taxiFare
    val base = variant.egress?.options?.firstOrNull()
    if (base != null && egress != null) {
        minutes += minutesOf(egress.taxiOut) - minutesOf(base.taxiOut)
        taxiFare += egress.taxiOut.taxiFare - base.taxiOut.taxiFare
    }
    if (aboard) {
        return if (taxiFare == 0) strings.get("android.journey.totalsAboard", minutes.toString())
        else strings.get("android.journey.totalsAboardTaxi", minutes.toString(), wonText(taxiFare, lang))
    }
    return strings.get("android.journey.totals", minutes.toString(), wonText(taxiFare, lang), wonText(variant.totals.transitFare, lang))
}

/** 출구·승강장 줄. 버스로 끝나는 변형은 출구 조회를 하지 않아 실패 갈래가 없다 — 내린 곳이 정류장이라는 문장만 갈린다(판정 23 대칭). */
fun egressLine(option: EgressOption, variant: JourneyVariant, lookupFailed: Boolean, strings: Strings, lang: String): String {
    val minutes = minutesText(option.taxiOut)
    val fare = wonText(option.taxiOut.taxiFare, lang)
    return when (option.kind) {
        EgressKind.exit -> strings.get("android.journey.egressExit", option.label, minutes, fare)
        EgressKind.stand -> strings.get("android.journey.egressStand", minutes, fare)
        EgressKind.none -> when {
            variant.alightsAtBusStop -> strings.get("android.journey.egressNoneStop", minutes, fare)
            lookupFailed -> strings.get("android.journey.egressLookupFailed", minutes, fare)
            else -> strings.get("android.journey.egressNone", minutes, fare)
        }
    }
}

/** 택시 앞 줄. 추천 경로가 버스로 시작하면 택시는 정류장 앞까지 간다 — 정류장 이름에 「역」을 붙이지 않는다(판정 5). 승차 역이 없으면 줄이 없다. */
fun journeyTaxiInLine(variant: JourneyVariant, strings: Strings, lang: String): String? {
    val taxiIn = variant.taxiIn ?: return null
    val station = variant.boardStation ?: return null
    val minutes = minutesText(taxiIn)
    val fare = wonText(taxiIn.taxiFare, lang)
    return if (variant.boardsAtBusStop) strings.get("android.journey.taxiInStop", station.name, minutes, fare)
    else strings.get("android.journey.taxiIn", journeyStationDisplayName(station.name), minutes, fare)
}

/** 결과 줄 하나의 명세 — 화면이 그리는 순서 그대로다(JVM 테스트가 순서·라벨·선택 상태를 잠근다). `landing` = 채팅 카드 「길찾기에서 열기」 착지 대상. */
sealed class JourneyRowSpec {
    data class Missing(val text: String, val index: Int, val landing: Boolean) : JourneyRowSpec()
    data class VariantChoice(val index: Int, val text: String, val selected: Boolean) : JourneyRowSpec()
    data class VariantHeading(val text: String) : JourneyRowSpec()
    data class Totals(val text: String, val landing: Boolean) : JourneyRowSpec()
    data class TaxiIn(val text: String) : JourneyRowSpec()
    /** 대중교통 구간 줄(`TransitRouteLegRows`)이 서는 자리 — 줄 문장은 구간 줄 함수가 만든다. */
    data object TransitLegs : JourneyRowSpec()
    data class EgressChoice(val index: Int, val text: String, val selected: Boolean) : JourneyRowSpec()
    data class EgressPlain(val text: String) : JourneyRowSpec()
    /** 「안내 시작」. 지금 탄 열차(E71)는 변형이 하나이고 제목의 「{역}에서 타는 경로」가 이미 탄 사람에게 거짓이라 이름 없는 「안내 시작」이다. */
    data class Start(val label: String) : JourneyRowSpec()
}

/** 인덱스 보정(iOS `min(index, count - 1)`) — 새 조회 직후 한 프레임 낡은 인덱스가 와도 범위 안에서 읽는다. */
fun journeyVariantAt(result: JourneyResult, variantIndex: Int): JourneyVariant? = result.variants.getOrNull(minOf(variantIndex, result.variants.size - 1))

fun journeyEgressAt(variant: JourneyVariant, egressIndex: Int): EgressOption? {
    val options = variant.egress?.options?.takeIf { it.isNotEmpty() } ?: return null
    return options[minOf(egressIndex, options.size - 1)]
}

/**
 * iOS `JourneyResultRows.body`의 순서. `showStart` = 도착지가 현재 위치가 아님(iOS는 버튼은 늘 그리고 `onStart`가 `trackedDestination`이 nil이면 말없이
 * 돌아온다 — 안드로이드는 죽은 버튼을 그리지 않고 줄 자체를 뺀다).
 */
fun journeyRowSpecs(
    result: JourneyResult,
    board: RecentStation?,
    alight: RecentStation?,
    aboard: Boolean,
    variantIndex: Int,
    egressIndex: Int,
    showStart: Boolean,
    strings: Strings,
    lang: String,
): List<JourneyRowSpec> {
    val variant = journeyVariantAt(result, variantIndex) ?: return emptyList()
    val egress = journeyEgressAt(variant, egressIndex)
    val single = result.variants.size == 1
    val lines = journeyLineQualifiers(result, board, alight)
    fun heading(v: JourneyVariant) = journeyVariantHeading(v, board, alight, lines, strings)
    val rows = mutableListOf<JourneyRowSpec>()
    val missing = journeyMissingLines(result, board, alight, strings)
    missing.forEachIndexed { i, line -> rows += JourneyRowSpec.Missing(line, i, landing = single && i == 0) }
    // 변형이 둘이면 선택 버튼 둘(선택 상태 + 시각 체크) 뒤에 고른 변형의 제목 heading. 하나면 제목 없이 바로 합계(판정 13).
    if (result.variants.size > 1) {
        val selectedIndex = minOf(variantIndex, result.variants.size - 1)
        result.variants.forEachIndexed { i, v -> rows += JourneyRowSpec.VariantChoice(i, heading(v), selected = i == selectedIndex) }
        rows += JourneyRowSpec.VariantHeading(heading(variant))
    }
    rows += JourneyRowSpec.Totals(journeyTotalsLine(variant, egress, aboard, strings, lang), landing = single && missing.isEmpty())
    journeyTaxiInLine(variant, strings, lang)?.let { rows += JourneyRowSpec.TaxiIn(it) }
    rows += JourneyRowSpec.TransitLegs
    val options = variant.egress?.options
    val lookupFailed = variant.egress?.lookupFailed == true
    if (options != null) {
        if (options.size > 1) {
            val selectedIndex = minOf(egressIndex, options.size - 1)
            options.forEachIndexed { i, o -> rows += JourneyRowSpec.EgressChoice(i, egressLine(o, variant, lookupFailed, strings, lang), selected = i == selectedIndex) }
        } else options.firstOrNull()?.let { rows += JourneyRowSpec.EgressPlain(egressLine(it, variant, lookupFailed, strings, lang)) }
    }
    if (showStart) {
        rows += JourneyRowSpec.Start(
            if (aboard) strings.get("beacon.start") else strings.get("beacon.guideStartTransitAlt", heading(variant)),
        )
    }
    return rows
}

/** 「안내 시작」이 세션에 넘기는 계획(iOS `onStart`). 방향이 정해진 지금 탄 열차 출발이면 그 방향을 싣는다(E71). */
fun journeyPlanFor(variant: JourneyVariant, egress: EgressOption?, destination: JourneyDestination, aboardOrigin: AboardOrigin?): JourneyPlan =
    JourneyPlan(
        variant = variant, egress = egress, destLabel = destination.label, dest = destination.dest,
        aboard = aboardOrigin?.direction?.let { TransitAboardStart(it.direction) },
    )

/**
 * 여정 결과 줄들 — 화면이 한 줄로 부른다. 상태는 화면(뷰모델)이 쥐고 인자·콜백으로 받는다. 변형을 고르면 출구 선택이 처음으로 돌아가는 것은
 * 뷰모델 `selectJourneyVariant`의 몫이다.
 * - `landingFocus`: 채팅 카드 「길찾기에서 열기」 착지(E70-b2 ④) — 고른 변형 제목에, 변형이 하나라 제목이 없으면 결과의 첫 줄(못 찾음 줄, 없으면 합계)에 붙인다.
 * - `onStart`: 수동 위치 출발 고지 자리(iOS `announceGuideStartIfManualOrigin`) — 세션 시작 직전에 부른다.
 * - `stationEntry`: 대중교통 구간 줄의 지하철역 작업 메뉴 옵트인(E45) — 기본값 없음.
 * 안내 시작은 `GuideSession`의 거부 판정을 지나므로 안내 중에 눌러도 숨기지 않는다(거부 통지).
 */
@Composable
fun JourneyResultRows(
    result: JourneyResult,
    board: RecentStation?,
    alight: RecentStation?,
    aboardOrigin: AboardOrigin?,
    variantIndex: Int,
    egressIndex: Int,
    onSelectVariant: (Int) -> Unit,
    onSelectEgress: (Int) -> Unit,
    destination: JourneyDestination?,
    destinationName: String?,
    destinationRoman: String?,
    lang: String,
    dataLocale: DataLocale,
    strings: Strings,
    stationEntry: BriefingStationEntry?,
    landingFocus: FocusRequester,
    onStart: () -> Unit,
) {
    val variant = journeyVariantAt(result, variantIndex) ?: return
    val egress = journeyEgressAt(variant, egressIndex)
    val specs = journeyRowSpecs(result, board, alight, aboardOrigin != null, variantIndex, egressIndex, showStart = destination != null, strings, lang)
    for (spec in specs) {
        when (spec) {
            is JourneyRowSpec.Missing -> key("missing-${spec.index}") {
                TextRow(spec.text, "journey-missing-${spec.index}", focus = if (spec.landing) landingFocus else null)
            }
            is JourneyRowSpec.VariantChoice -> key("variant-${spec.index}") {
                SelectableRow(spec.text, spec.selected, "journey-variant-${spec.index}") { onSelectVariant(spec.index) }
            }
            is JourneyRowSpec.VariantHeading -> Text(
                spec.text,
                Modifier.fillMaxWidth().mergedRow("journey-variant-heading", focus = landingFocus).headingText().padding(vertical = 8.dp),
                style = MaterialTheme.typography.titleMedium,
            )
            is JourneyRowSpec.Totals -> TextRow(spec.text, "journey-totals", focus = if (spec.landing) landingFocus else null)
            is JourneyRowSpec.TaxiIn -> TextRow(spec.text, "journey-taxi-in")
            JourneyRowSpec.TransitLegs ->
                TransitRouteLegRows(variant.transit, "journey-transit", destinationName, destinationRoman, lang, dataLocale, strings, stationEntry)
            is JourneyRowSpec.EgressChoice -> key("egress-${spec.index}") {
                SelectableRow(spec.text, spec.selected, "journey-egress-${spec.index}") { onSelectEgress(spec.index) }
            }
            is JourneyRowSpec.EgressPlain -> TextRow(spec.text, "journey-egress")
            is JourneyRowSpec.Start -> Button(
                onClick = {
                    if (destination != null) {
                        onStart()
                        GuideSession.startJourney(journeyPlanFor(variant, egress, destination, aboardOrigin))
                    }
                },
                modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp).tapTarget().testTag("guide-start-journey"),
            ) { Text(spec.label) }
        }
    }
}

/** 선택지 줄 — 고른 것은 시각 체크 표식(WCAG 1.4.1: 색·상태만으로 전하지 않는다). 표식은 낭독에서 숨기고(이름 없는 아이콘) 선택 상태가 정본이다. */
@Composable
private fun SelectableRow(text: String, isSelected: Boolean, tag: String, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(role = Role.Button, onClick = onClick)
            .testTag(tag)
            .defaultMinSize(minHeight = 48.dp)
            .padding(vertical = 12.dp)
            .semantics { selected = isSelected },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        if (isSelected) Icon(Icons.Filled.Check, contentDescription = null)
    }
}
