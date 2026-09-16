package space.dodoplanet.gildongmu.kit

import kotlin.math.floor

/**
 * 실시간 도보 안내 하단 2행 파생 계층(spec 2026-08-11 §4 — 순수, I/O 비의존). 웹 정본 `src/lib/guide-live-rows.ts` ↔ Kit
 * `GuideLiveRows.swift` 1:1 미러 — 공유 fixture(`guide-live-rows-scenarios.json`)가 최종 ko 문자열 수준에서 동조를 강제한다.
 *
 * 구간 선택·국면·잔여는 전부 표시 좌표계(`displayEffectiveD`)를 쓴다. 음성·톤·햅틱 파이프라인(`guideStep`)은 원시 d를
 * 계속 쓴다(불변식 A). 이 계층은 문자열을 만들지 않고 **디스크립터**를 낸다 — 렌더는 앱의 몫이고, 디스크립터→키 매핑
 * 규칙은 fixture 러너와 동일해야 한다.
 *
 * 우선순위 1·2(도착·최종 접근)는 이 계층 밖이다 — 그 국면의 발화·표시 소유자는 오케스트레이터의 최종 접근 층이고, 여기는
 * finalApproach에서 빈 행을 낸다.
 */

/**
 * 도보 회전 접근 전환 잔여(m). 표시 10 = 원시 20 = 임박 큐 시점(lag 10). 자동차는 임박 큐가 속도 함수라
 * `turnApproachMeters(speedSamples, tuning)`(RouteGuide)가 같은 식에서 표시 lag를 뺀 값을 `turnApproachM`으로 넘긴다(K2 §4).
 */
const val walkTurnApproachMeters = 10.0

/** 예고에서 "연속 회전"으로 접는 유닛 길이(m) — 직진 창이 사실상 없는 유닛. */
const val shortUnitPreviewMeters = 10.0

data class LiveStepInput(
    val description: String,
    val startD: Double,
    val endD: Double,
    /** 서버 구조화 조각(spec §5). 추출 실패는 null — 재파싱으로 채우지 않는다. */
    val target: String? = null,
    val anchor: String? = null,
    /** 서버 투영 행동. */
    val action: WalkAction? = null,
    /** 서버 횡단 구간 플래그(A26, `WalkRouteStep.crossing`). false는 "횡단 구간 아님". */
    val crossing: Boolean = false,
)

/** 행동 경계 기준으로 병합한 표시 유닛(spec §4.1) — "직진 구간 + (있다면) 끝 행동". */
data class DisplayUnit(
    val stepIndices: List<Int>,
    val startD: Double,
    val endD: Double,
    val crossing: Boolean,
    /** 횡단 유닛의 표시 문장(주석 포함 스텝 전문). 비횡단은 null. */
    val crossingText: String?,
    /** 횡단 유닛의 행동 종류(crosswalk|underpass). 비횡단은 null. */
    val crossingAction: WalkAction?,
    /** 유닛 끝 경계의 행동(다음 유닛 첫 스텝에서 유도). 최종 유닛은 null(F6). */
    val endAction: WalkAction?,
    /** 끝 행동의 기준 이름(다음 유닛 첫 스텝의 anchor). */
    val endAnchor: String?,
    /** 직진 목표 이름(유닛 마지막 스텝의 target — 병합 후 유닛의 것). */
    val target: String?,
)

/**
 * 횡단 유닛 판정 — 행동 + **서버 횡단 구간 플래그**(`WalkRouteStep.crossing`, A26). 행동만으로는 부족하다: "횡단보도"는
 * 지명으로도 등장하므로 구간 전체가 횡단인지는 서버가 구조로 판정해 실어 준다. ⚠ 종전의 재작성 행동문("…건너세요") 부분
 * 문자열 판정은 ko 전용이라 en 안내에서 횡단 유닛이 한 번도 서지 않았다 — 되돌리지 말 것. 웹 `isCrossingStep` 미러.
 */
fun isCrossingStep(action: WalkAction?, crossing: Boolean): Boolean =
    (action == WalkAction.crosswalk || action == WalkAction.underpass) && crossing

/** 행동은 `LiveStepInput.action`(서버 투영)만 본다 — 문장 분류 폴백 없음(E16 축3, 웹 미러). */
fun buildDisplayUnits(steps: List<LiveStepInput>): List<DisplayUnit> {
    class Group(val indices: MutableList<Int>, val crossing: Boolean, val action: WalkAction?)

    val groups = ArrayList<Group>()
    for (i in steps.indices) {
        val action = steps[i].action
        val crossing = isCrossingStep(action, steps[i].crossing)
        // 행동 없는 경계(지도 분할 직진)는 흡수한다(F5). 횡단 유닛은 흡수하지 않는다 — 국면이 유닛 단위라 꼬리를 붙이면 다
        // 건넌 뒤에도 "건너세요"가 남는다.
        val last = groups.lastOrNull()
        if (i > 0 && action == null && last != null && !last.crossing) {
            last.indices.add(i)
        } else {
            groups.add(Group(mutableListOf(i), crossing, action))
        }
    }
    return groups.mapIndexed { gi, g ->
        val first = steps[g.indices.first()]
        val last = steps[g.indices.last()]
        val nextFirst = groups.getOrNull(gi + 1)?.let { steps[it.indices.first()] }
        DisplayUnit(
            stepIndices = g.indices.toList(),
            startD = first.startD,
            endD = last.endD,
            crossing = g.crossing,
            crossingText = if (g.crossing) first.description else null,
            crossingAction = if (g.crossing) g.action else null,
            // 끝 행동 = 다음 유닛 첫 스텝이 알리는 행동(횡단 유닛 진입 포함). 최종 유닛 null.
            endAction = nextFirst?.action,
            endAnchor = nextFirst?.anchor,
            target = last.target,
        )
    }
}

/** 응답 스텝 하나의 표시 조각(Swift 튜플 `(target, anchor, crossing)` 대응). */
data class LiveStepFields(val target: String?, val anchor: String?, val crossing: Boolean)

/**
 * 리듀서 스팬(StepSpan)과 응답 스텝(live 조각·횡단 플래그)을 index로 짝지어 표시 입력을 만든다.
 * `steps`는 응답 스텝 순서 그대로(빈 목록 = 조각 없음, 자동차).
 */
fun liveStepsFrom(route: GuideRoute, steps: List<LiveStepFields>): List<LiveStepInput> = route.steps.map { span ->
    val fields = steps.getOrNull(span.index)
    LiveStepInput(
        description = span.description,
        startD = span.startD,
        endD = span.endD,
        target = fields?.target,
        anchor = fields?.anchor,
        action = span.action, // 자동차 서버 투영(K2 §4) — 웹 liveStepsFrom 미러
        crossing = fields?.crossing ?: false,
    )
}

/** 표시 전용 소상태(spec §4) — 판정 계층 상태 신설 금지. */
data class LiveRowsState(
    /** 직전 표시 유닛 index(단조 클램프 스코프). */
    val unitIndex: Int,
    /** 직전 표시 잔여(클램프 기준). */
    val clamped: Int,
)

sealed class LiveTopRow {
    data object OffRoute : LiveTopRow()
    data object Reacquiring : LiveTopRow()
    data object Uncertain : LiveTopRow()
    data class Crossing(val text: String) : LiveTopRow()

    /** meters ≥ 1 */
    data class TurnIn(val meters: Int, val action: WalkAction) : LiveTopRow()

    /** 표시 잔여 0 = "잠시 후"(음수 표시 금지) */
    data class TurnSoon(val action: WalkAction) : LiveTopRow()
    data class Straight(val meters: Int, val target: String?) : LiveTopRow()
}

sealed class LiveNextRow {
    /** 직진 국면: 현재 유닛 끝 행동 */
    data class Action(val action: WalkAction, val anchor: String?) : LiveNextRow()

    /** 다음 유닛 직진 예고(지도 값) */
    data class Straight(val meters: Int, val target: String?) : LiveNextRow()
    data class Crossing(val action: WalkAction) : LiveNextRow()

    /** 연속 회전 */
    data class Turn(val action: WalkAction) : LiveNextRow()
}

data class LiveRowsOutput(val state: LiveRowsState?, val top: LiveTopRow?, val next: LiveNextRow?)

/** 다음 유닛 예고(종류별 — 직진 가정 금지, F11). */
private fun previewOf(unit: DisplayUnit): LiveNextRow {
    if (unit.crossing) return LiveNextRow.Crossing(unit.crossingAction ?: WalkAction.crosswalk)
    val len = floor(unit.endD - unit.startD).toInt()
    // 직진 창이 사실상 없는 짧은 유닛은 길이 예고가 무의미하다 — 행동만 예고(연속 회전).
    val action = unit.endAction
    if (len.toDouble() <= shortUnitPreviewMeters && action != null) return LiveNextRow.Turn(action)
    return LiveNextRow.Straight(len, unit.target)
}

/**
 * 리듀서형 파생(F3): `(prevRowState, 입력) → (nextRowState, rows)`. 입력은 리듀서가 이미 계산하는 값만 받는다(원시 d·
 * 국면·세션/재조회 기준점). 호출자는 표시 유닛 전이 외의 리셋 지점(재조회·이탈 복귀·모드 전환)에서 prev=null + 새 baselineD를
 * 넘긴다 — 클램프·램프인이 함께 새 기준으로 시작한다.
 *
 * `turnApproachM`: 회전 접근 전환 표시 잔여(m). walk `walkTurnApproachMeters`, car는 임박 임계 − lag. 기본값 없음.
 */
fun guideLiveRows(
    prev: LiveRowsState?,
    units: List<DisplayUnit>,
    d: Double,
    baselineD: Double,
    phase: GuidePhase,
    turnApproachM: Double,
): LiveRowsOutput {
    if (units.isEmpty()) return LiveRowsOutput(null, null, null)
    // 이탈: 두 행을 비운다(F2 — 낡은 예고는 따라가게 된다). 문장은 렌더 계층의 기존 키.
    if (phase == GuidePhase.offRoute) return LiveRowsOutput(null, LiveTopRow.OffRoute, null)
    // 최종 접근·도착(우선순위 1·2)은 이 계층 밖 — 오케스트레이터가 행을 소유한다.
    if (phase == GuidePhase.finalApproach) return LiveRowsOutput(null, null, null)

    val effD = displayEffectiveD(d, baselineD)
    val unitIndex = units.indexOfFirst { effD < it.endD }.takeIf { it >= 0 } ?: (units.size - 1)
    val unit = units[unitIndex]
    val raw = floor(maxOf(0.0, unit.endD - effD)).toInt() // F8: 버림
    // 단조 클램프(같은 표시 유닛 스코프). 국면 판정도 이 값으로 한다(F4) — "숫자는 8인데 국면은 직진" 같은 자기모순이
    // 구조적으로 불가능하다.
    val clamped = prev?.takeIf { it.unitIndex == unitIndex }?.let { minOf(it.clamped, raw) } ?: raw
    val state = LiveRowsState(unitIndex, clamped)

    // 밑국면(상태 대체와 무관한 유닛 기준 국면) — 아랫줄이 이것을 따른다(상태 중 유지).
    val isLast = unitIndex == units.size - 1
    val endAction = unit.endAction
    val turnApproach = !unit.crossing && clamped.toDouble() <= turnApproachM && endAction != null
    val next: LiveNextRow? = when {
        isLast -> null // 최종 유닛은 비운다(§4.3)
        unit.crossing || turnApproach -> previewOf(units[unitIndex + 1]) // 행동 실행 중 → 그 행동 뒤 유닛 예고
        // 직진 중 → 끝 행동 예고. 최종 유닛이 아니면 다음 유닛이 있으므로 끝 행동이 있다(Swift 강제 언래핑 동형).
        else -> LiveNextRow.Action(checkNotNull(endAction) { "비최종 유닛의 끝 행동 부재" }, unit.endAnchor)
    }

    // 상태 대체(우선순위 4·5): 윗줄만 바꾸고 아랫줄·클램프는 유지(해소 시 그 자리 복귀).
    if (phase == GuidePhase.reacquiring) return LiveRowsOutput(state, LiveTopRow.Reacquiring, next)
    if (phase == GuidePhase.uncertain) return LiveRowsOutput(state, LiveTopRow.Uncertain, next)

    val top: LiveTopRow = when {
        unit.crossing -> LiveTopRow.Crossing(unit.crossingText ?: "")
        turnApproach ->
            if (clamped <= 0) LiveTopRow.TurnSoon(endAction) else LiveTopRow.TurnIn(clamped, endAction)
        else -> LiveTopRow.Straight(clamped, unit.target)
    }
    return LiveRowsOutput(state, top, next)
}
