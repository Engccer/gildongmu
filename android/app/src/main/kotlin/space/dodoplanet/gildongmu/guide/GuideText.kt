package space.dodoplanet.gildongmu.guide

import space.dodoplanet.gildongmu.directions.Strings
import space.dodoplanet.gildongmu.kit.CrossingRemaining
import space.dodoplanet.gildongmu.kit.GuidePhase
import space.dodoplanet.gildongmu.kit.GuideRoute
import space.dodoplanet.gildongmu.kit.GuideState
import space.dodoplanet.gildongmu.kit.LiveNextRow
import space.dodoplanet.gildongmu.kit.LiveStepInput
import space.dodoplanet.gildongmu.kit.LiveTopRow
import space.dodoplanet.gildongmu.kit.OffRouteGuidance
import space.dodoplanet.gildongmu.kit.OffRouteSide
import space.dodoplanet.gildongmu.kit.RelativeDirection
import space.dodoplanet.gildongmu.kit.WalkAction
import space.dodoplanet.gildongmu.kit.WalkHealth
import space.dodoplanet.gildongmu.kit.WalkHealthSummary
import space.dodoplanet.gildongmu.kit.clockHour
import space.dodoplanet.gildongmu.kit.finalApproachArriveMeters
import space.dodoplanet.gildongmu.kit.formatDistance
import space.dodoplanet.gildongmu.kit.joinText
import space.dodoplanet.gildongmu.kit.models.FinalApproachPayload
import space.dodoplanet.gildongmu.kit.models.WalkLineKind
import space.dodoplanet.gildongmu.kit.relativeDirection
import space.dodoplanet.gildongmu.kit.stepTextSaysDirection
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

    /**
     * 구간 안에서 다시 읽는 유닛 문장(E62 — 되읽기·억제 복구, iOS `rereadUnit`). 첫 index는 이미 들어선 스텝이라 방향 구절을 뗀
     * 문장(`body`)이 있으면 그것을 읽는다 — 이미 돈 회전을 다시 지시하지 않는다(문안 확정본). 뒤 스텝들은 아직 앞이라 원문.
     */
    fun rereadUnit(route: GuideRoute, indices: List<Int>, liveSteps: List<LiveStepInput>): String {
        val descs = indices.mapIndexedNotNull { pos, i ->
            val step = route.steps.getOrNull(i) ?: return@mapIndexedNotNull null
            if (pos == 0) liveSteps.getOrNull(i)?.body ?: step.description else step.description
        }
        if (descs.size <= 1) return descs.firstOrNull() ?: ""
        return s.get("guide.bundle", descs.joinToString(". "))
    }

    /**
     * walk 선행 전문에 결정 지점까지의 실위치 거리를 단다(위원장 판정 2026-10-03, iOS 동형). 1m 미만이면 원문만. 묶음이면 머리말은
     * 첫 문장에 붙고 "다음 안내." 서두는 그 앞이다 — 서두 뒤에 머리말을 두면 "앞으로 약 25m 가다가 다음 안내."가 된다(E62 a11y M3).
     */
    fun announceAhead(route: GuideRoute, indices: List<Int>, meters: Double): String {
        val rounded = meters.roundToInt()
        if (rounded < 1) return unit(route, indices)
        val descs = indices.mapNotNull { route.steps.getOrNull(it)?.description }
        val first = descs.firstOrNull() ?: return ""
        val headed = s.get("guide.announceAhead", formatDistance(rounded), first)
        if (descs.size <= 1) return headed
        return s.get("guide.bundle", (listOf(headed) + descs.drop(1)).joinToString(". "))
    }

    /** 시작 원자 발화(요약과 첫 안내를 한 문장으로). `destination`에 기본값을 두지 않는다(E40). */
    fun start(route: GuideRoute, firstIndices: List<Int>, destination: String): String =
        // 인자 순서는 ko 플레이스홀더 순서(`android/i18n/arg-order.json`) — 할 일 먼저, 요약은 뒤(E62 문안 라).
        s.get("guide.detailStart", destination, unit(route, firstIndices), route.steps.size, formatDistance(route.totalMeters.roundToInt()))

    /** 재조회 성공 원자 발화 — "출발지가 현재 위치로 바뀌었다"를 전할 채널은 이 문장뿐이다. */
    fun reroute(route: GuideRoute, firstIndices: List<Int>): String =
        // 인자 순서는 ko 플레이스홀더 순서 — 할 일 먼저, 요약은 뒤(E63 문안 라).
        s.get("guide.rerouteDone", unit(route, firstIndices), route.steps.size, formatDistance(route.totalMeters.roundToInt()))

    /**
     * 수동 전환 성공(M4b, iOS `GuideText.variantSwitch`) — 재조회와 같은 구조(새 경로 규모 + 첫 안내)에 첫 문장만 전환한 줄을 밝힌다("다시 찾았습니다"는
     * 전환에선 거짓 서술). `line`은 받은 경로의 성질(서버가 이름을 못 주면 요청한 줄).
     */
    fun variantSwitch(route: GuideRoute, firstIndices: List<Int>, line: WalkLineKind): String {
        val key = when (line) {
            WalkLineKind.shortest -> "android.guide.switchedToShortest"
            WalkLineKind.accessible -> "android.guide.switchedToAccessible"
            WalkLineKind.broad -> "android.guide.switchedToBroad"
            WalkLineKind.recommended -> "android.guide.switchedToRecommended"
        }
        return s.get(key, route.steps.size, formatDistance(route.totalMeters.roundToInt()), unit(route, firstIndices))
    }

    /** 자동 재조회 채택 문장 두 벌(A57) — 그 순간의 음성과 상태 행에 남길 문장. */
    data class RerouteLines(val spoken: String, val statusLine: String)

    /**
     * 자동 재조회 채택 문장(E63 문안 라 — "새 경로로 다시 안내합니다. 2시 방향으로 도세요. 그 후 {첫 유닛}. 안내 {count}개, 총 {distance}.",
     * iOS `autoReroute`). `headClock`은 교체 **전** 진행 방위 기준 새 경로 첫 방향(:kit `rerouteHeadClock`), null이면 머리말이 없다. 조각 없는
     * 첫 스텝 문장이 스스로 방향을 말해도 머리말이 없다(A58, `english` = 안내 데이터 언어가 ko가 아닌가). `statusLine`은 머리말을 뺀 꼴(A57 —
     * 시계 방향은 몸을 돌리면 곧 거짓이 되는데 상태 행은 착지·화면 복귀 상환이 나중에 다시 읽는다): 머리말이 있으면 첫 스텝은 이미 `body`라
     * 되읽기 유닛(`rereadUnit`)이다. 인자 순서는 ko 문장 순서(arg-order).
     */
    fun autoReroute(route: GuideRoute, firstIndices: List<Int>, liveSteps: List<LiveStepInput>, headClock: Int?, english: Boolean): RerouteLines {
        val lead = firstIndices.firstOrNull()?.let { route.steps.getOrNull(it) }
        val clock = headClock?.takeIf {
            lead != null && !stepTextSaysDirection(lead.action, liveSteps.getOrNull(lead.index)?.body != null, english)
        }
        fun line(first: String) = s.get("guide.autoReroute", first, route.steps.size, formatDistance(route.totalMeters.roundToInt()))
        val spoken = line(headedUnit(route, firstIndices, liveSteps, clock))
        return RerouteLines(spoken, if (clock == null) spoken else line(rereadUnit(route, firstIndices, liveSteps)))
    }

    /**
     * 새 경로 첫 유닛에 진행 방위 기준 방향 머리말을 단다(E63 spec §3.7, iOS `headedUnit`). 12 = "진행 방향 그대로"(J1), 6 = "뒤로 도세요.
     * 그 후", 그 밖 = "N시 방향으로 도세요. 그 후". 머리말이 있으면 첫 스텝의 경로 기준 방향 조각은 뺀다(`body` — 방향을 두 번 말하지 않는다).
     * 머리말을 붙일지(A58)는 호출부 `autoReroute`가 이미 가른 값이다.
     */
    private fun headedUnit(route: GuideRoute, indices: List<Int>, liveSteps: List<LiveStepInput>, headClock: Int?): String {
        val clock = headClock ?: return unit(route, indices)
        val descs = indices.mapIndexedNotNull { pos, i ->
            val step = route.steps.getOrNull(i) ?: return@mapIndexedNotNull null
            if (pos == 0) liveSteps.getOrNull(i)?.body ?: step.description else step.description
        }
        val first = descs.firstOrNull() ?: return ""
        val headed = when (clock) {
            12 -> s.get("guide.rerouteHeadStraight", first)
            6 -> s.get("guide.rerouteHeadBack", first)
            else -> s.get("guide.rerouteHeadClock", clockDirection(clock), first)
        }
        if (descs.size <= 1) return headed
        return s.get("guide.bundle", (listOf(headed) + descs.drop(1)).joinToString(". "))
    }

    /**
     * 이탈 문장(E63 문안 다·마 + 위원장 판정 J2·J3, iOS `offRoute`의 walk 갈래 — 안드로이드에 자동차 안내는 없다). 벗어난 쪽(낱말) + 돌아갈
     * 쪽(시계). 보류(`hold`)는 null — 이미 경로 쪽으로 걷는 사람에게 말하지 않는다. 6시는 "뒤로 도세요".
     */
    fun offRoute(guidance: OffRouteGuidance, side: OffRouteSide?, returnRelDeg: Double?): String? = when (guidance) {
        OffRouteGuidance.hold -> null
        OffRouteGuidance.sideOnly -> offRouteSide(side)
        OffRouteGuidance.opposite -> s.get("guide.offRouteWith", s.get("guide.offRouteOpposite"), s.get("guide.offRouteTurnBack"))
        OffRouteGuidance.turn -> if (side == null || returnRelDeg == null) offRouteSide(side) else {
            val clock = clockHour(returnRelDeg)
            val action = if (clock == 6) s.get("guide.offRouteTurnBack") else s.get("guide.offRouteReturnClock", clockDirection(clock))
            s.get("guide.offRouteWith", offRouteSide(side), action)
        }
    }

    /** 벗어난 쪽만(J3·상태 행 — 위원장 판정 2026-10-04). 쪽을 모르면(수직 3m 미만) 종전 문장. */
    fun offRouteSide(side: OffRouteSide?): String = when (side) {
        OffRouteSide.right -> s.get("guide.offRouteRight")
        OffRouteSide.left -> s.get("guide.offRouteLeft")
        null -> s.get("guide.offRoute")
    }

    /** "N시 방향"(E62·E63 공유 키). */
    fun clockDirection(hour: Int): String = s.get("guide.clockDirection", hour.toString())

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

    /**
     * 도보 임박 명령에 횡단 방향을 싣는다(E62 문안 나, iOS `imminentText(_:crossingClock:)`). 12 = 진행 방향 그대로, 6 = 뒤로, 그 밖은
     * 시계 방향, null(방향 모름)은 종전 문장.
     */
    fun imminentText(action: WalkAction, crossingClock: Int?): String {
        if (action != WalkAction.crosswalk || crossingClock == null) return imminentText(action)
        return when (crossingClock) {
            12 -> s.get("guide.imminent.crosswalkAhead")
            6 -> s.get("guide.imminent.crosswalkBack")
            else -> s.get("guide.imminent.crosswalkClock", clockDirection(crossingClock))
        }
    }

    /** 횡단 중 남은 거리 행(E62 판정 4 — 말 없이 화면에만, 10m 단위). */
    fun crossingRemaining(remaining: CrossingRemaining): String = s.get(
        if (remaining.action == WalkAction.underpass) "guide.crossingRemainingUnderpass" else "guide.crossingRemaining",
        formatDistance(remaining.meters),
    )

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
     * 직선거리). uncertain 계열엔 서수를 붙이지 않는다. `currentBody`: 현재 스텝의 방향 구절을 뗀 문장(E62 `parts.body`) — 이미
     * 들어선 스텝이라 돈 회전을 다시 지시하지 않는다. null이면 문장 전체(iOS 동형).
     */
    fun progress(route: GuideRoute, state: GuideState, destinationLabel: String, lastGuidance: String?, straightLineMeters: Double?, etaMinutes: Int?, currentBody: String?): String =
        when (state.phase) {
            GuidePhase.following -> {
                val cur = route.steps[state.stepIndex]
                val frame = progressFrame(route, state, etaMinutes)
                val current = s.get("guide.progressCurrent", currentBody ?: cur.description)
                val next = route.steps.getOrNull(state.stepIndex + 1)
                if (next == null) {
                    val segment = formatDistance(max(0.0, cur.endD - state.d).roundToInt())
                    "$frame. $current. " + s.get("guide.nextDestination", destinationLabel, segment)
                } else {
                    "$frame. $current. " + s.get("guide.progressNext", next.description)
                }
            }
            GuidePhase.bundle -> {
                // 되읽기와 같은 규칙 — 지금 스텝부터, 지금 스텝은 회전 문장을 뗀다(`currentBody`, 없으면 원문, iOS walk 갈래 동형).
                val descs = unitAt(route, state.stepIndex).filter { it >= state.stepIndex }
                    .map { if (it == state.stepIndex) currentBody ?: route.steps[it].description else route.steps[it].description }
                val body = if (descs.size > 1) s.get("guide.bundle", descs.joinToString(". ")) else descs.firstOrNull() ?: ""
                "${progressFrame(route, state, etaMinutes)}. $body"
            }
            GuidePhase.uncertain, GuidePhase.reacquiring -> s.get("guide.progressUncertain", lastGuidance ?: s.get("guide.noGuidanceYet"))
            GuidePhase.offRoute -> if (straightLineMeters == null) s.get("guide.offRoute")
            else s.get("guide.progressOffRoute", formatDistance(straightLineMeters.roundToInt()))
            GuidePhase.finalApproach -> if (straightLineMeters == null) s.get("guide.progressUncertain", lastGuidance ?: s.get("guide.noGuidanceYet"))
            else s.get("guide.progressFinalApproach", formatDistance(straightLineMeters.roundToInt()))
        }

    /**
     * 종료 화면 걸음·칼로리 문장(iOS `healthSummaryLine` + `foodLine`, spec §7-5): 기본 체중으로 계산했고 체중 입력 권유가 **숨겨졌으면**
     * (E31 — 무시 2회) 기준 체중을 문장 안에 밝힌다. 권유가 떠 있으면 그 고지 줄이 기준 체중을 말하므로 종전 문장이다(두 벌 키).
     * 음식 비유가 성립하면 완결 문장으로 뒤에 붙인다(공백 결합 — 마침표 뒤에 쉼표를 붙이지 않는다). 한 문단 = 한 접근성 객체.
     */
    fun healthLine(health: WalkHealthSummary, showsWeightPrompt: Boolean): String {
        val summary = if (health.usedDefaultWeight && !showsWeightPrompt) {
            s.get("android.beacon.healthSummaryWithWeight", health.steps, WalkHealth.defaultWeightKg.toInt(), health.kcal)
        } else {
            s.get("android.beacon.healthSummary", health.steps, health.kcal)
        }
        return listOfNotNull(summary, foodLine(health.kcal)).joinToString(" ")
    }

    /** 칼로리 → 음식 비유 문장. 판정은 :kit `WalkHealth.foodComparison`, 키는 리터럴 `when`(문자열 키 린터·소스 가드 계약). */
    fun foodLine(kcal: Int): String? {
        val food = WalkHealth.foodComparison(kcal) ?: return null
        if (food.count > 1) return if (food.key == "ramyeon") s.get("android.beacon.food.ramyeonMany", food.count) else null
        return when (food.key) {
            "cherryTomato" -> s.get("android.beacon.food.cherryTomato")
            "cucumberHalf" -> s.get("android.beacon.food.cucumberHalf")
            "kimchi" -> s.get("android.beacon.food.kimchi")
            "tangerine" -> s.get("android.beacon.food.tangerine")
            "boiledEgg" -> s.get("android.beacon.food.boiledEgg")
            "apple" -> s.get("android.beacon.food.apple")
            "banana" -> s.get("android.beacon.food.banana")
            "riceHalfBowl" -> s.get("android.beacon.food.riceHalfBowl")
            "hotteok" -> s.get("android.beacon.food.hotteok")
            "riceBowl" -> s.get("android.beacon.food.riceBowl")
            "ramyeon" -> s.get("android.beacon.food.ramyeon")
            else -> null
        }
    }
}
