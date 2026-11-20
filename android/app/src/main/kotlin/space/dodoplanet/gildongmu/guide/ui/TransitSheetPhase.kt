package space.dodoplanet.gildongmu.guide.ui

import space.dodoplanet.gildongmu.directions.Strings
import space.dodoplanet.gildongmu.guide.TransitAboardStep
import space.dodoplanet.gildongmu.guide.TransitDepartedItem
import space.dodoplanet.gildongmu.guide.TransitGuideTextRenderer
import space.dodoplanet.gildongmu.guide.TransitGuideUiState
import space.dodoplanet.gildongmu.kit.TransitBoardingCandidate
import space.dodoplanet.gildongmu.kit.TransitDisplayItem
import space.dodoplanet.gildongmu.kit.TransitDisplayLeg
import space.dodoplanet.gildongmu.kit.TransitGuideLeg
import space.dodoplanet.gildongmu.kit.TransitLabel
import space.dodoplanet.gildongmu.kit.TransitPhase
import space.dodoplanet.gildongmu.kit.TransitSignal
import space.dodoplanet.gildongmu.kit.TransitTrackItem
import space.dodoplanet.gildongmu.kit.TransitTrackMode
import space.dodoplanet.gildongmu.kit.TransitUnreachableReason
import space.dodoplanet.gildongmu.kit.alightLineText
import space.dodoplanet.gildongmu.kit.classifyTransitBoardingCandidates
import space.dodoplanet.gildongmu.kit.isApproxTransitLock
import space.dodoplanet.gildongmu.kit.joinText
import space.dodoplanet.gildongmu.kit.quickExitText
import space.dodoplanet.gildongmu.kit.transitCandidateDescLine
import space.dodoplanet.gildongmu.kit.transitDisplayItem
import space.dodoplanet.gildongmu.kit.transitExpressSkipsAlightLine
import space.dodoplanet.gildongmu.kit.transitLaneForItem
import space.dodoplanet.gildongmu.kit.transitLaneLabel
import space.dodoplanet.gildongmu.kit.transitTerminatesEarlyLine
import space.dodoplanet.gildongmu.kit.transitVehicleDescLine
import space.dodoplanet.gildongmu.kit.transitViaStopLine

/*
 * 대중교통 시트 5-B 행들의 **순수 판정**(iOS `TransitTrackingSheet`의 `phaseControls`·`waitingList`·`handoffNow`·`advanceLabel`·`reboardPromptKey` 등).
 * 뷰(`TransitSheetRows.kt`)와 JVM 테스트가 같은 함수를 읽는다 — 두 벌이 되면 어긋난다(도보 `sheetRowExists` 선례).
 */

/**
 * E34 조건(iOS `handoffNow`): 마지막 leg ∧ 말미 도보 ∧ 인계 가능. 참이면 `advance` 자리 버튼이 「남은 도보 안내 시작」.
 * 여정(E70 §6.3)이면 다음 단계가 곧 인계라 말미 도보 분이 없어도 마지막 leg면 선다. `walkHandoffAvailable`은 iOS `onWalkHandoff != nil`(기본값 없음).
 */
fun transitHandoffNow(journeyNextIsWalk: Boolean?, isOnFinalLeg: Boolean, finalLegWalkMinutes: Int?, walkHandoffAvailable: Boolean): Boolean {
    if (journeyNextIsWalk != null) return isOnFinalLeg
    return finalLegWalkMinutes != null && walkHandoffAvailable
}

/** 하차 역을 정한 여정의 마지막 leg인가(iOS `journeyHandoff`) — 그 자리 버튼은 다음이 출구 도보든 택시든 「다음 구간」이다(판정 6). */
fun transitJourneyHandoff(handoffNow: Boolean, journeyNextIsWalk: Boolean?): Boolean = handoffNow && journeyNextIsWalk != null

/** `advance` 자리 버튼의 라벨 키(iOS `advanceLabel`) — 뷰와 착지 폴백이 같은 식을 읽는다. */
fun transitAdvanceLabelKey(journeyHandoff: Boolean, handoffNow: Boolean): String =
    if (journeyHandoff || !handoffNow) "transitGuide.advance" else "transitGuide.walkHandoffStart"

/** 추적 불가 국면의 버튼 라벨 키 — 마지막 leg면 라벨이 인계 자체(E34), 여정이면 「다음 구간」. */
fun transitUntrackableButtonKey(journeyHandoff: Boolean, handoffNow: Boolean): String = when {
    journeyHandoff -> "transitGuide.advance"
    handoffNow -> "transitGuide.walkHandoffStart"
    else -> "transitGuide.advanceUntrackable"
}

/** 서울버스는 역이 아니라 정류장을 묻는다(E76 후속 ⓔ). 「이미 탑승」 pickStation은 지하철 흐름이라 해당하지 않는다. */
fun transitReboardAsksStop(ui: TransitGuideUiState): Boolean =
    ui.aboardStep != TransitAboardStep.pickStation && transitUiLeg(ui)?.trackMode == TransitTrackMode.seoulBus

/** 역 선택 화면의 취소 버튼 키(iOS `reboardCancelKey`). */
fun transitReboardCancelKey(ui: TransitGuideUiState): String =
    if (transitReboardAsksStop(ui)) "transitGuide.reboardStopCancel" else "transitGuide.reboardCancel"

/** 승차 선택 버튼 키 — 호출마다 리터럴 키여야 하는 iOS 린터 사정은 여기서 키 문자열 반환으로 대신한다(소스 가드가 키 전수를 표에 대조한다). */
fun transitBoardSelectedKey(leg: TransitGuideLeg): String =
    if (leg.mode == "subway") "transitGuide.boardSelected" else "transitGuide.boardSelectedBus"

/** 국면 컨트롤 묶음(iOS `phaseControls`의 분기) — 5-B가 그리는 국면별 버튼 집합의 정본. */
sealed interface TransitPhaseControls {
    /** 추적 불가: 설명 한 줄 + 수동 진행 버튼 하나. */
    data object Untrackable : TransitPhaseControls

    /** 대기 국면: 목록·새로고침·이미 탔어요 등(`WaitingList`). */
    data object Waiting : TransitPhaseControls

    /** 차량을 골랐고 승차 정류소 도착을 기다린다(N3). 선언 버튼은 `boardingManualAvailable` 래치일 때만, 「다른 차량 선택」은 늘 선다. */
    data class Boarding(val boardSelectedOffered: Boolean) : TransitPhaseControls

    /** 승차·도착: `advance`는 도착이거나 근사 잠금일 때, 탑승 변경 자리는 승차 중이고 지방버스가 아닐 때. */
    data class Active(val advance: Boolean, val changeBoarding: Boolean) : TransitPhaseControls
}

fun transitPhaseControls(ui: TransitGuideUiState): TransitPhaseControls? {
    val state = ui.state ?: return null
    val leg = transitUiLeg(ui) ?: return null
    return when {
        state.signal == TransitSignal.untrackable -> TransitPhaseControls.Untrackable
        state.phase == TransitPhase.waiting -> TransitPhaseControls.Waiting
        state.phase == TransitPhase.boarding -> TransitPhaseControls.Boarding(ui.boardingManualAvailable)
        else -> TransitPhaseControls.Active(
            advance = state.phase == TransitPhase.arrived || (state.lock?.let(::isApproxTransitLock) ?: false),
            changeBoarding = state.phase == TransitPhase.riding && leg.trackMode != TransitTrackMode.tagoBus,
        )
    }
}

/** 후보 행 정체성(iOS `rows`) — 차량·열차 식별자. 없으면 슬롯 위치(폴마다 문장이 바뀌어도 포커스가 튕기지 않게, 감사 L2). */
fun transitCandidateRowId(candidate: TransitBoardingCandidate, index: Int): String =
    candidate.item.vehicleId?.takeIf { it.isNotEmpty() } ?: "slot-$index"

/** 후보 행의 고정 표식 접두 — 커서가 후보 행에 앉았는지(목록 포커스 소실 복귀 판정)를 리소스 id로 가린다. */
const val TRANSIT_CANDIDATE_TAG_PREFIX = "transit-candidate-"

fun transitCandidateTag(id: String): String = TRANSIT_CANDIDATE_TAG_PREFIX + id

/**
 * 목록 포커스 소실 복귀(iOS `.onChange(of: rows.map(\.id))`, §13.4): 커서가 얹힌 후보가 폴링 갱신으로 사라졌는가. 목록 밖 커서는 강탈하지 않는다.
 * 반환 = 사라진 후보 id(없으면 null).
 */
fun transitLostCandidateId(cursorTag: String?, ids: List<String>): String? {
    if (cursorTag == null || !cursorTag.startsWith(TRANSIT_CANDIDATE_TAG_PREFIX)) return null
    val id = cursorTag.removePrefix(TRANSIT_CANDIDATE_TAG_PREFIX)
    return id.takeIf { it !in ids }
}

/** 후보 행의 종류와 문장(iOS `candidateRow`). 차단 행은 사유 줄까지 합친 결정 문장이고, 선택 가능 행은 설명만 싣고 버튼 라벨은 호출자가 키로 만든다. */
sealed interface TransitCandidateRow {
    /** 결정적 미도달(§5.1·A16 L1) — 활성화 차단의 단일 술어, 사유별 문장 병기. */
    data class Blocked(val text: String) : TransitCandidateRow

    /** vehId 없는 슬롯은 잠금 불가(§5.1) — 빈 잠금은 어떤 항목과도 매칭되지 않는 조용한 고장이다. */
    data class Unselectable(val text: String) : TransitCandidateRow

    /** 선택 버튼(라벨은 「{설명} 선택」 틀 — N3 「선택」, 탑승 여부는 앱이 승차 정류소 도착으로 판정). */
    data class Selectable(val desc: String) : TransitCandidateRow
}

fun transitCandidateRow(
    renderer: TransitGuideTextRenderer,
    isEn: Boolean,
    candidate: TransitBoardingCandidate,
    leg: TransitGuideLeg,
    displayLeg: TransitDisplayLeg,
    departedMinutes: Int?,
): TransitCandidateRow {
    val item = candidate.item
    val displayItem = transitDisplayItem(item)
    // 차단 행은 급행 조각을 빼고 사유 줄만 결정 문장으로 둔다(a11y 감사 2026-09-02 — 종착 앞 + 급행 정차/미결 조각이 함께 붙으면 모순 낭독).
    val desc = renderer.render(
        transitCandidateDescLine(
            isEn = isEn, leg = displayLeg, item = displayItem,
            express = if (candidate.unreachable == null) candidate.express else null,
            departedMinutes = departedMinutes, route = transitLaneLabel(transitLaneForItem(leg, item)),
        ),
    )
    // 결정적 미도달 사유는 vehId 유무보다 앞이다(웹과 같은 순서) — 「왜 못 고르는가」가 먼저다.
    candidate.unreachable?.let { reason ->
        val note = when (reason) {
            TransitUnreachableReason.terminatesEarly -> transitTerminatesEarlyLine(isEn, displayLeg, displayItem)
            TransitUnreachableReason.expressSkipsAlight -> transitExpressSkipsAlightLine(isEn, displayLeg)
        }
        return TransitCandidateRow.Blocked(joinText(desc, renderer.render(note)))
    }
    if (item.vehicleId.isNullOrEmpty()) return TransitCandidateRow.Unselectable(desc)
    return TransitCandidateRow.Selectable(desc)
}

/** 선택 후보의 사라진(떠난 것으로 본) 항목에서 경과 분 — 식별자 비교는 iOS와 같게 옵셔널끼리(둘 다 null이면 같다). */
fun transitDepartedMinutes(departed: List<TransitDepartedItem>, item: TransitTrackItem): Int? =
    departed.firstOrNull { it.item.vehicleId == item.vehicleId }?.minutes

/**
 * 선택 차량 설명을 ko·en 쌍으로 얼린다(iOS `vehicleDescLabel`). **비면 null** — 서울버스는 행선·방향이 둘 다 없어 설명이 빈 문자열인데, 빈 라벨은 non-null이라
 * 상시 표시에 「선택한 차량: .」 빈 슬롯이 뜬다. 렌더 문자열을 저장하지 않고 쌍으로 두는 까닭: 세션 도중 언어를 바꿨을 때 그 조각만 옛 언어로 남는다.
 */
fun transitVehicleDescLabel(strings: Strings, item: TransitDisplayItem): TransitLabel? {
    val ko = TransitGuideTextRenderer(strings) { false }.render(transitVehicleDescLine(isEn = false, item = item))
    if (ko.isEmpty()) return null
    val en = transitVehicleDescLine(isEn = true, item = item)
    return TransitLabel(ko, if (en.lang == "en") TransitGuideTextRenderer(strings) { true }.render(en) else null)
}

/** 0건 사유 문구가 「그 역에 있는 열차가 없다」(`noCandidatesAboard`)인가 — 원 목록엔 후보가 있는데 pickVehicle 필터가 비웠을 때(코드 리뷰 M3). */
fun transitRawHasCandidates(ui: TransitGuideUiState, leg: TransitGuideLeg, aboardPicking: Boolean): Boolean =
    aboardPicking && classifyTransitBoardingCandidates(ui.waitingLive + ui.waitingDeparted.map { it.item }, leg).candidates.isNotEmpty()

/** 하차역 표시 라벨(iOS `alightStationLabel`) — 빠른 하차 줄과 하차 준비 줄이 같은 이름을 쓴다(조인 필드를 문장에 넣지 않는다, E27). */
fun transitAlightStationLabel(display: TransitDisplayLeg, isEn: Boolean): String =
    if (isEn) (display.alight.en ?: display.alight.ko) else display.alight.ko

/** 대기 국면 빠른 하차 줄(iOS `quickExitLine`). 값이 없으면 null — 부재 문구를 만들지 않는다(3-state). */
fun transitQuickExitLine(leg: TransitGuideLeg, display: TransitDisplayLeg, isEn: Boolean, lang: String): String? =
    quickExitText(leg.quickExit, transitAlightStationLabel(display, isEn), lang)

/**
 * 하차 준비 줄(E84, iOS `alightPrepRow`): 승차 대기·승차 중에만, 내릴 문과 나갈 출구를 한 줄로. 길찾기 결과의 하차 줄과 같은 함수·같은 문장이다.
 * 문 위치도 출구도 없으면 null(줄 없음). 대기 국면은 열차 목록 앞 빠른 하차 줄이 있고 도착 국면은 통지가 출구를 말한다.
 * `lang`은 앱 UI 언어(:kit 카탈로그 조회 축), 역명은 데이터 언어 — 다른 축이다.
 */
fun transitAlightPrepText(ui: TransitGuideUiState, display: TransitDisplayLeg, isEn: Boolean, lang: String, strings: Strings): String? {
    val phase = ui.state?.phase
    if (phase != TransitPhase.boarding && phase != TransitPhase.riding) return null
    val leg = transitUiLeg(ui) ?: return null
    return alightLineText(
        quickExit = leg.quickExit,
        station = transitAlightStationLabel(display, isEn),
        exitAlight = display.exitAlight,
        lang = lang,
        exitBound = { strings.get("transitGuide.exitBound", it) },
    )
}

/** 경유역 행 문장(iOS `viaStopsRows` 안 `transitViaStopLine` 렌더) — 승차·하차 역할, 현재역 표식, 하차역 출구 번호(E25, 정적 표시). */
fun transitViaRowText(renderer: TransitGuideTextRenderer, isEn: Boolean, display: TransitDisplayLeg, index: Int, hereIndex: Int?): String {
    val isAlight = index == display.stops.size - 1
    return renderer.render(
        transitViaStopLine(
            isEn = isEn, stop = display.stops[index],
            role = if (index == 0) "board" else if (isAlight) "alight" else "via",
            here = index == hereIndex,
            exit = if (isAlight) display.exitAlight else null,
        ),
    )
}

/** 경유역 목록 라벨의 개수 — 이동 역 수(승차역 제외 = viaStops − 1). 웹 `TransitGuidePanel`·경로 브리핑 `stationCount`와 같은 수. */
fun transitViaCount(leg: TransitGuideLeg): Int = maxOf(0, leg.viaStops.size - 1)

/** 경유역 행의 「전화 걸기」 액션 라벨 키 — **라벨만** 저장소 상태로 갈린다(액션은 늘 하나, E45 판정 ⑤). 행 이름이 곧 역명이라 라벨에 역 이름을 넣지 않는다. */
fun transitViaCallLabelKey(representative: Boolean): String =
    if (representative) "android.place.callRepresentative" else "android.place.call"
