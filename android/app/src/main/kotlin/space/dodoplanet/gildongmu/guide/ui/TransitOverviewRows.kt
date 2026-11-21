package space.dodoplanet.gildongmu.guide.ui

import space.dodoplanet.gildongmu.directions.Strings
import space.dodoplanet.gildongmu.guide.AltOriginEvidence
import space.dodoplanet.gildongmu.guide.TransitGuideModel
import space.dodoplanet.gildongmu.guide.TransitGuideTextRenderer
import space.dodoplanet.gildongmu.guide.TransitGuideUiState
import space.dodoplanet.gildongmu.kit.TransitLabel
import space.dodoplanet.gildongmu.kit.TransitOverviewLegStatus
import space.dodoplanet.gildongmu.kit.TransitOverviewRow
import space.dodoplanet.gildongmu.kit.TransitOverviewSilenceSignal
import space.dodoplanet.gildongmu.kit.TransitOverviewStopRole
import space.dodoplanet.gildongmu.kit.TransitPhase
import space.dodoplanet.gildongmu.kit.TransitSignal
import space.dodoplanet.gildongmu.kit.joinText
import space.dodoplanet.gildongmu.kit.transitLockIsUnobserved
import space.dodoplanet.gildongmu.kit.transitOverviewLegLine
import space.dodoplanet.gildongmu.kit.transitViaStopLine

// 대중교통 조망의 행 조립(iOS `TransitOverviewAdapter`, E15-1 spec §4.2). 판정(어느 행을·어느 순서로)은 :kit `transitProgressOverview`가 하고 여기는 문장 배선이다.
// 순수 함수라 JVM 테스트가 fixture 상태로 iOS가 내는 문장과 같은지 단언한다. Compose 의존 없음.

/** 조망 본문 한 행(iOS `GuideOverviewRow`의 대중교통 쪽 — 헤딩 행은 이 어댑터가 내지 않는다). 한 행 = 한 접근성 객체. */
sealed interface TransitOverviewItem {
    val id: String

    data class Text(override val id: String, val text: String) : TransitOverviewItem

    /** 버튼 행(침묵 탈출구 「탑승 변경」). */
    data class Action(override val id: String, val label: String) : TransitOverviewItem
}

const val TRANSIT_OVERVIEW_REBOARD_ID = "reboard"

/**
 * 조망 수명 동안 래치된 침묵 신호(iOS `latchedSilence`·`latchedReboard`, spec §4.1): 한 번 렌더된 silence·탈출구 행은 추적이 회복돼도 사라지지 않는다 —
 * 포커스가 얹힌 행이 폴 한 번에 사라지는 경로를 구조로 막는다. 회복되면 문구만 바뀐다. 조망 페이지가 열릴 때마다 새로 만든다(`remember`).
 */
class TransitOverviewLatch {
    var silence: TransitOverviewSilenceSignal? = null
    var reboard: Boolean = false
}

/** 표시 라벨 한 개의 세션 언어 텍스트(en 표가 없으면 원문, iOS `displayLabelText`). */
fun transitDisplayLabelText(label: TransitLabel, isEn: Boolean): String = if (isEn) (label.en ?: label.ko) else label.ko

/**
 * 헤더 한 문장(iOS `overviewHeaderText`) — 진입 착지가 이 문장을 낭독한다. 상시 표시·진행 상황 통지·조망 헤더가 한 조립기를 지난다. 조망 머리 문장은 현재역을 말하지
 * 않는다(위원장 판정 2026-09-23) — 안내 행과 정차역 행이 말한다. 세션이 없으면 빈 문자열.
 */
fun transitOverviewHeaderText(model: TransitGuideModel, ui: TransitGuideUiState, strings: Strings): String {
    val state = ui.state ?: return ""
    val leg = transitUiLeg(ui) ?: return ""
    val overview = model.overview ?: return ""
    return listOf(
        strings.get("transitGuide.overviewOrdinal", overview.legOrdinal.count.toString(), overview.legOrdinal.n.toString()),
        model.statusLineText(state, leg, now = ui.positionClock, speaksLocated = false),
    ).joinToString(" ")
}

/** 본문 행(iOS `overviewRows`). 순서가 읽기 순서이고 `id`는 조망이 열려 있는 동안 안정적이다(원본 행 인덱스 — 래치로 늦게 끼는 행이 다른 행을 움직이지 않는다). */
fun transitOverviewRows(
    model: TransitGuideModel,
    ui: TransitGuideUiState,
    strings: Strings,
    isEn: Boolean,
    latch: TransitOverviewLatch,
): List<TransitOverviewItem> {
    val overview = model.overview ?: return emptyList()
    val renderer = TransitGuideTextRenderer(strings) { isEn }
    val rows = mutableListOf<TransitOverviewItem>()
    val silenceNow = overview.rows.filterIsInstance<TransitOverviewRow.Silence>().firstOrNull()?.signal
    overview.rows.forEachIndexed { sourceIndex, row ->
        when (row) {
            is TransitOverviewRow.Walk ->
                rows += TransitOverviewItem.Text("walk-$sourceIndex", strings.get("transitGuide.overviewWalk", row.minutes.toString()))
            is TransitOverviewRow.Leg -> {
                val statusText = when (row.status) {
                    TransitOverviewLegStatus.done -> strings.get("transitGuide.overviewLegDone")
                    TransitOverviewLegStatus.current -> strings.get("transitGuide.overviewLegCurrent")
                    TransitOverviewLegStatus.upcoming -> strings.get("transitGuide.overviewLegUpcoming")
                }
                // ⚠ 영문 라벨은 행이 아니라 leg에서 가져온다(E27 잔여 ①) — 순수 판정 계층과 그 공유 fixture를 건드리지 않는 배치다.
                val legDisplay = ui.route?.legs?.getOrNull(row.legIndex)?.let { model.displayLeg(it, useOverride = false) }
                val legText = legDisplay?.let {
                    renderer.render(transitOverviewLegLine(isEn = isEn, n = row.legIndex + 1, line = it.line, board = it.board, alight = it.alight))
                    // 경로를 못 찾았을 때의 의도된 한국어 폴백(행이 나르는 조인 문자열 그대로). 표시 라벨 경로는 바로 위 `legDisplay` 분기다.
                } ?: strings.get("transitGuide.overviewLeg", (row.legIndex + 1).toString(), row.lineName, row.boardName, row.alightName)
                rows += TransitOverviewItem.Text(
                    "leg-${row.legIndex}",
                    joinText(
                        legText,
                        statusText,
                        if (row.status == TransitOverviewLegStatus.current) row.stationCount?.let { strings.get("transitGuide.stationCountAbout", it.toString()) } ?: "" else "",
                    ),
                )
                if (row.status == TransitOverviewLegStatus.current) {
                    // silence·탈출구는 현재 leg 행 바로 뒤(순수 계층이 같은 자리에 낸다).
                    val signal = silenceNow ?: latch.silence
                    if (signal != null) {
                        latch.silence = signal
                        rows += TransitOverviewItem.Text("silence", transitOverviewSilenceText(model, ui, strings, signal, recovered = silenceNow == null))
                    }
                    if (overview.reboardOffered || latch.reboard) {
                        latch.reboard = true
                        rows += TransitOverviewItem.Action(TRANSIT_OVERVIEW_REBOARD_ID, strings.get("transitGuide.changeBoarding"))
                    }
                }
            }
            is TransitOverviewRow.Stop -> {
                // 정차역 행도 같은 배치 — 현재 leg의 표시 투영에서 이름을 고른다.
                val stopLabel = transitUiLeg(ui)?.let { model.displayLeg(it, useOverride = false) }?.stops?.getOrNull(row.stopIndex) ?: TransitLabel(ko = row.name)
                val role = when (row.role) {
                    TransitOverviewStopRole.board -> "board"
                    TransitOverviewStopRole.alight -> "alight"
                    TransitOverviewStopRole.via -> "via"
                }
                rows += TransitOverviewItem.Text("stop-${row.stopIndex}", renderer.render(transitViaStopLine(isEn = isEn, stop = stopLabel, role = role, here = row.here)))
            }
            TransitOverviewRow.StopsUnavailable ->
                rows += TransitOverviewItem.Text("stopsUnavailable", strings.get("transitGuide.overviewStopsUnavailable"))
            is TransitOverviewRow.Silence -> Unit // 현재 leg 행에서 처리(래치 포함)
        }
    }
    return rows
}

/** 침묵 행 문장(iOS `silenceText`). */
fun transitOverviewSilenceText(model: TransitGuideModel, ui: TransitGuideUiState, strings: Strings, signal: TransitOverviewSilenceSignal, recovered: Boolean): String {
    if (recovered) return strings.get("transitGuide.signalRecovered")
    // 승차 중 현재역(E35 §6 판정 1): 상시 표시와 같은 선택 — 위치가 잡혀 있으면 신호 문장 대신 현재역 문장. 행은 그대로 둔다(래치·탈출구 불변 — 행이 사라지면 그 위의 포커스가 튄다).
    val state = ui.state
    val leg = transitUiLeg(ui)
    if (state != null && leg != null) model.positionStatusText(state, leg, now = ui.positionClock)?.let { return it }
    // 상시 표시와 같은 선택기(A33 수단 축·A34 비관측 축) — 이 행이 따로 키를 부르면 비관측 riding에서 「하차역에 가까워지면 표시됩니다」가 거짓으로 남는다. neverSeen만 통지 문장(탈출구 안내)을 쓴다.
    val isTrain = leg?.mode == "subway"
    val unobserved = state?.lock?.let(::transitLockIsUnobserved) ?: false
    val mapped = when (signal) {
        TransitOverviewSilenceSignal.neverSeen -> TransitSignal.neverSeen
        TransitOverviewSilenceSignal.notYetVisible -> TransitSignal.notYetVisible
        TransitOverviewSilenceSignal.signalLost -> TransitSignal.signalLost
        TransitOverviewSilenceSignal.upstreamFailed -> TransitSignal.upstreamFailed
    }
    if (signal == TransitOverviewSilenceSignal.neverSeen && !unobserved) return strings.get("transitGuide.neverSeen")
    return model.signalStatusText(mapped, TransitPhase.riding, isTrain = isTrain, unobserved = unobserved)
}

/**
 * 「다른 경로 보기」 행동을 세우는가(iOS `overviewActions` 비어 있지 않음). 여정(E70)의 대중교통 단계는 하차역·출구가 계획의 일부라 다른 경로로 바꾸지 않는다 —
 * 여정 중인가는 모델의 여정 훅이 걸려 있는가로 본다(`recoveryOffered` 선례).
 */
fun transitOverviewOffersAlternatives(model: TransitGuideModel): Boolean =
    transitOverviewOffersAlternatives(model.overview?.alternativesOffered == true, inJourney = model.onJourneyStopped != null)

/** 순수 판정 — 모델이 제안하고 ∧ 여정 밖. ⚠ `inJourney`는 기본값 없음. */
fun transitOverviewOffersAlternatives(alternativesOffered: Boolean, inJourney: Boolean): Boolean = alternativesOffered && !inJourney

/**
 * 「탑승 변경」 실행(iOS `perform(reboardActionId)`) — **누른 시점에 최신 상태로 재검증**한다. riding에서만 유효(탑승 변경은 riding 컨트롤). 국면이 바뀌었으면 null(그
 * 전이가 이미 통지·착지를 했다 — 아무것도 덧붙이지 않는다).
 */
fun transitOverviewPerformReboard(ui: TransitGuideUiState): TransitOverviewExit? =
    if (ui.state?.phase == TransitPhase.riding) TransitOverviewExit.beginReboard else null

/**
 * 「다른 경로」 하위 페이지 헤더(iOS `TransitAltRoutesSheet.headerText`) — 무엇을 기준으로 한 목록인지가 SR 사용자의 유일한 정보원이라 근거(현재 위치·현재역·승차역 선언)를
 * 말한다. 이름이 비면 「… 기준」 틀이 끊기므로 기준 없는 헤더로 떨어진다.
 */
fun transitAltHeaderText(model: TransitGuideModel, ui: TransitGuideUiState, strings: Strings, isEn: Boolean): String {
    val plain = strings.get("android.transitGuide.altHeading")
    val leg = transitUiLeg(ui)
    return when (val origin = ui.pendingAltRoutes?.origin) {
        is AltOriginEvidence.Station -> {
            // 경유역 이름은 조인 원문(한국어)이다 — 표시 투영의 같은 index를 쓴다(E48 잔여 ⑤).
            val name = leg?.let { model.displayLeg(it, useOverride = false).stops.getOrNull(origin.stopIndex) }?.let { transitDisplayLabelText(it, isEn) }
            if (!name.isNullOrEmpty()) strings.get("android.transitGuide.altHeadingFrom", name) else plain
        }
        AltOriginEvidence.BoardStopDeclared -> {
            val name = leg?.let { transitDisplayLabelText(model.displayLeg(it, useOverride = false).board, isEn) }
            if (!name.isNullOrEmpty()) strings.get("android.transitGuide.altHeadingFrom", name) else plain
        }
        AltOriginEvidence.Gps, null -> plain
    }
}

/** 승차 전 GPS 실패 행의 「{승차역} 기준으로 조회」를 세우는가(iOS 조건: 승차 전 국면 ∧ 승차 정류장 있음). 이름은 표시 라벨이다(E27 잔여 ①). */
fun transitAltFromBoardStopLabel(model: TransitGuideModel, ui: TransitGuideUiState, strings: Strings, isEn: Boolean): String? {
    val leg = transitUiLeg(ui) ?: return null
    val phase = ui.state?.phase ?: return null
    if ((phase != TransitPhase.waiting && phase != TransitPhase.boarding) || leg.boardStop == null) return null
    return strings.get("android.transitGuide.altFromBoardStop", transitDisplayLabelText(model.displayLeg(leg, useOverride = false).board, isEn))
}
