package space.dodoplanet.gildongmu.guide

import space.dodoplanet.gildongmu.directions.Strings
import space.dodoplanet.gildongmu.kit.GuidePhase
import space.dodoplanet.gildongmu.kit.GuideRoute
import space.dodoplanet.gildongmu.kit.GuideState
import space.dodoplanet.gildongmu.kit.LiveNextRow
import space.dodoplanet.gildongmu.kit.LiveTopRow
import space.dodoplanet.gildongmu.kit.RelativeDirection
import space.dodoplanet.gildongmu.kit.WalkAction
import space.dodoplanet.gildongmu.kit.finalApproachArriveMeters
import space.dodoplanet.gildongmu.kit.formatDistance
import space.dodoplanet.gildongmu.kit.joinText
import space.dodoplanet.gildongmu.kit.models.FinalApproachPayload
import space.dodoplanet.gildongmu.kit.relativeDirection
import space.dodoplanet.gildongmu.kit.unitAt
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * 상세 안내 이벤트 → 낭독 문장 조립(iOS `GuideText.swift`의 **walk 함수만** 1:1, spec §6). 원칙 둘: ① 스텝 문장
 * (description)은 낭독 정본이라 재조합하지 않는다 — 그대로 싣거나 통독 틀(`guide.bundle`)에 담기만 한다 ② 거리 문자열은
 * `formatDistance` 정본 + 확신도 3단 래핑만 거친다. 낭독 채널(`spokenDistanceUnits`)은 `WalkGuideModel.post`가 담당.
 *
 * 키는 전부 리터럴이다 — `GuideStrings` 표(소스 가드가 대조)와 iOS 키 린터가 같은 계약을 든다.
 */
class GuideText(private val s: Strings) {
    /** 확신도 3단(Soundscape 패턴): ≤10m 원문 / ≤20m "약 N" / >20m "N쯤". 잔여 200m 이상은 원문. */
    fun confidenceDistance(meters: Double, accuracy: Double): String {
        val base = formatDistance(meters.roundToInt())
        if (meters >= 200 || accuracy <= 10) return base
        if (accuracy <= 20) return s.get("guide.approx", base)
        return s.get("guide.rough", base)
    }

    /**
     * 최종 접근 거리 사다리. 비교는 반올림 전 원거리로 한다. ⚠ 정확도가 좋아도 헤지를 빼지 않는다 — "보고 정확도 5.4m,
     * 실오차 36.5m"(RouteNav 실측)라 최종 접근 구간에서는 최소 "약"을 붙인다.
     */
    fun approachDistance(meters: Double, accuracy: Double): String {
        val base = formatDistance(meters.roundToInt())
        if (accuracy <= 20) return s.get("guide.approx", base)
        return s.get("guide.rough", base)
    }

    fun directionWord(d: RelativeDirection): String = when (d) {
        RelativeDirection.ahead -> s.get("guide.dirAhead")
        RelativeDirection.left -> s.get("guide.dirLeft")
        RelativeDirection.right -> s.get("guide.dirRight")
        RelativeDirection.behind -> s.get("guide.dirBehind")
    }

    /** 이동 방향 어휘("왼쪽으로"). 한국어 `으로`/`로`가 받침으로 갈리지만 이 넷은 고정 어휘라 로케일 문구에 박는다. */
    fun directionTowardWord(d: RelativeDirection): String = when (d) {
        RelativeDirection.ahead -> s.get("guide.dirAheadTo")
        RelativeDirection.left -> s.get("guide.dirLeftTo")
        RelativeDirection.right -> s.get("guide.dirRightTo")
        RelativeDirection.behind -> s.get("guide.dirBehindTo")
    }

    /** 주기 통지 한 문장. 방향을 모르면 거리만(빈 문자열 보간 금지 — 구분자가 겹친다). */
    fun approachDetail(distance: String, direction: String?): String =
        if (direction == null) s.get("guide.finalApproachTickNoDir", distance)
        else s.get("guide.finalApproachTick", direction, distance)

    /**
     * 최종 접근 진입 1회 배치 서술. 사용자가 경로 종점에 서 있을 때 나가므로 거리·방향이 곧 현재 위치 기준이다. 진입 서술은
     * "≤15m는 수치 없이" 행을 타지 않는다 — 오프셋은 폴리라인에서 정적으로 계산된 값이라 fix 잡음 전제가 성립하지 않는다.
     */
    fun finalApproachEnter(destination: String, geometry: FinalApproachPayload, accuracy: Double): String {
        val distance = approachDistance(geometry.offsetMeters, accuracy)
        val bearing = geometry.relativeBearing
        val approach = if (bearing != null) {
            s.get("guide.finalApproachToDest", directionTowardWord(relativeDirection(bearing)), distance, destination)
        } else {
            s.get("guide.finalApproachToDestNoDir", destination, distance)
        }
        return "${s.get("guide.finalApproachRouteEnd")} $approach"
    }

    /**
     * 최종 접근 주기 통지. 거리는 **현재 fix → 목적지 직선거리**다. "근처" 분기는 도착 반경과 사다리 하한이 둘 다 15m라 지금
     * 도달하지 않지만 남겨 둔다. ⚠ 방향을 어절이 아니라 열거형으로 받는다 — 두 분기의 어휘(맨몸/이동형)가 다르다.
     */
    fun finalApproachTick(meters: Double, direction: RelativeDirection?, accuracy: Double): String {
        if (meters <= finalApproachArriveMeters) return nearText(direction)
        return approachDetail(approachDistance(meters, accuracy), direction?.let(::directionTowardWord))
    }

    private fun nearText(direction: RelativeDirection?): String =
        if (direction == null) s.get("guide.finalApproachNear")
        else s.get("guide.finalApproachNearDir", directionWord(direction))

    /** 유닛(단일 스텝 또는 통독 묶음) 전문. 단일이면 문장 그대로, 묶음이면 통독 틀. */
    fun unit(route: GuideRoute, indices: List<Int>): String {
        val descs = indices.mapNotNull { route.steps.getOrNull(it)?.description }
        if (descs.size <= 1) return descs.firstOrNull() ?: ""
        return s.get("guide.bundle", descs.joinToString(". "))
    }

    /** 시작 원자 발화(요약과 첫 안내를 한 문장으로). `destination`에 기본값을 두지 않는다(E40). */
    fun start(route: GuideRoute, firstIndices: List<Int>, destination: String): String =
        s.get("guide.detailStart", destination, route.steps.size, formatDistance(route.totalMeters.roundToInt()), unit(route, firstIndices))

    /** 재조회 성공 원자 발화 — "출발지가 현재 위치로 바뀌었다"를 전할 채널은 이 문장뿐이다. */
    fun reroute(route: GuideRoute, firstIndices: List<Int>): String =
        s.get("guide.rerouteDone", route.steps.size, formatDistance(route.totalMeters.roundToInt()), unit(route, firstIndices))

    /** 이탈 시 자동 재조회 채택 통지(E10ⓑ). 형제와 같은 "규모 → 첫 안내" 구조. */
    fun autoReroute(route: GuideRoute, firstIndices: List<Int>): String =
        s.get("android.guide.autoReroute", route.steps.size, formatDistance(route.totalMeters.roundToInt()), unit(route, firstIndices))

    /**
     * walk 주기 통지 단문(웹 eventText periodic 미러). 횡단 스텝은 정본 문장을 재낭독한다 — 판정은 **서버 투영 행동**만
     * 본다(E16 축3, 오탐이 미탐보다 싸다). 마지막 스텝은 목적지 틀, target 없으면 이름 생략.
     */
    fun periodicWalk(route: GuideRoute, stepIndex: Int, remainingMeters: Int, accuracy: Double, destinationLabel: String, target: String?): String {
        val step = route.steps.getOrNull(stepIndex)
        if (step != null && (step.action == WalkAction.crosswalk || step.action == WalkAction.underpass)) return step.description
        val distance = confidenceDistance(remainingMeters.toDouble(), accuracy)
        if (route.steps.getOrNull(stepIndex + 1) == null) return s.get("guide.nextDestination", destinationLabel, distance)
        if (target == null) return s.get("guide.periodicStraightNoName", distance)
        return s.get("guide.periodicStraight", target, distance)
    }

    /** 진행 상황 서두(서수 + 잔여). 잔여 시간은 근거가 있을 때만(3-state). */
    fun progressFrame(route: GuideRoute, state: GuideState, etaMinutes: Int?): String {
        val total = formatDistance(max(0.0, route.totalMeters - state.d).roundToInt())
        val ordinal = s.get("guide.progressOrdinal", route.steps.size.toString(), (state.stepIndex + 1).toString())
        val remaining = joinText(s.get("guide.remainingDistance", total), etaMinutes?.let { s.get("guide.remainingTime", it.toString()) })
        return "$ordinal. $remaining"
    }

    /** 행동구("왼쪽으로 도세요"). keep*는 자동차 갈래라 walk 키가 없다 — 도달하지 않지만 exhaustive `when`이 키를 강제한다. */
    fun liveActionPhrase(action: WalkAction): String = when (action) {
        WalkAction.left -> s.get("guide.liveAction.left")
        WalkAction.right -> s.get("guide.liveAction.right")
        WalkAction.back -> s.get("guide.liveAction.back")
        WalkAction.crosswalk -> s.get("guide.liveAction.crosswalk")
        WalkAction.underpass -> s.get("guide.liveAction.underpass")
        WalkAction.keepLeft -> s.get("guide.liveAction.left")
        WalkAction.keepRight -> s.get("guide.liveAction.right")
    }

    /** 도보 임박 명령(20m). */
    fun imminentText(action: WalkAction): String = when (action) {
        WalkAction.left -> s.get("guide.imminent.left")
        WalkAction.right -> s.get("guide.imminent.right")
        WalkAction.back -> s.get("guide.imminent.back")
        WalkAction.crosswalk -> s.get("guide.imminent.crosswalk")
        WalkAction.underpass -> s.get("guide.imminent.underpass")
        WalkAction.keepLeft -> s.get("guide.imminent.left")
        WalkAction.keepRight -> s.get("guide.imminent.right")
    }

    /** 하단 2행 윗줄 렌더 — 매핑 규칙은 공유 fixture 러너(`GuideLiveRowsTest`)와 동일해야 한다. */
    fun liveTop(row: LiveTopRow): String = when (row) {
        LiveTopRow.OffRoute -> s.get("guide.offRoute")
        LiveTopRow.Uncertain -> s.get("guide.uncertain")
        LiveTopRow.Reacquiring -> s.get("guide.reacquiring")
        is LiveTopRow.Crossing -> row.text
        is LiveTopRow.TurnSoon -> imminentText(row.action)
        is LiveTopRow.TurnIn -> s.get("guide.liveTurnIn", row.meters.toString(), liveActionPhrase(row.action))
        is LiveTopRow.Straight -> row.target?.let { s.get("guide.liveStraight", it, row.meters.toString()) }
            ?: s.get("guide.liveStraightNoName", row.meters.toString())
    }

    /** 하단 2행 아랫줄 렌더 — "다음 안내," 라벨까지 포함한 완성 문자열. */
    fun liveNext(row: LiveNextRow): String {
        val step = when (row) {
            is LiveNextRow.Action -> row.anchor?.let { s.get("guide.nextAction", it, liveActionPhrase(row.action)) } ?: liveActionPhrase(row.action)
            is LiveNextRow.Straight -> row.target?.let { s.get("guide.nextStraight", it, row.meters.toString()) }
                ?: s.get("guide.nextStraightNoName", row.meters.toString())
            is LiveNextRow.Crossing -> liveActionPhrase(row.action)
            is LiveNextRow.Turn -> liveActionPhrase(row.action)
        }
        return s.get("guide.progressNext", step)
    }

    /**
     * 진행 상황 버튼 응답 — 상태별로 거짓 정밀을 만들지 않는다. `straightLineMeters`는 이탈·최종 접근 전용(마지막 fix→목적지
     * 직선거리). uncertain 계열엔 서수를 붙이지 않는다.
     */
    fun progress(route: GuideRoute, state: GuideState, destinationLabel: String, lastGuidance: String?, straightLineMeters: Double?, etaMinutes: Int?): String =
        when (state.phase) {
            GuidePhase.following -> {
                val cur = route.steps[state.stepIndex]
                val frame = progressFrame(route, state, etaMinutes)
                val current = s.get("guide.progressCurrent", cur.description)
                val next = route.steps.getOrNull(state.stepIndex + 1)
                if (next == null) {
                    val segment = formatDistance(max(0.0, cur.endD - state.d).roundToInt())
                    "$frame. $current. " + s.get("guide.nextDestination", destinationLabel, segment)
                } else {
                    "$frame. $current. " + s.get("guide.progressNext", next.description)
                }
            }
            GuidePhase.bundle -> "${progressFrame(route, state, etaMinutes)}. " + unit(route, unitAt(route, state.stepIndex))
            GuidePhase.uncertain, GuidePhase.reacquiring -> s.get("guide.progressUncertain", lastGuidance ?: s.get("guide.noGuidanceYet"))
            GuidePhase.offRoute -> if (straightLineMeters == null) s.get("guide.offRoute")
            else s.get("guide.progressOffRoute", formatDistance(straightLineMeters.roundToInt()))
            GuidePhase.finalApproach -> if (straightLineMeters == null) s.get("guide.progressUncertain", lastGuidance ?: s.get("guide.noGuidanceYet"))
            else s.get("guide.progressFinalApproach", formatDistance(straightLineMeters.roundToInt()))
        }
}
