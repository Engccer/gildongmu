package space.dodoplanet.gildongmu.directions

import space.dodoplanet.gildongmu.kit.JourneyAboardDirection
import space.dodoplanet.gildongmu.kit.JourneyStationKind
import space.dodoplanet.gildongmu.kit.RecentRoute
import space.dodoplanet.gildongmu.kit.RecentStation
import space.dodoplanet.gildongmu.kit.journeyAboardDirections
import space.dodoplanet.gildongmu.kit.journeyAboardLines
import space.dodoplanet.gildongmu.kit.journeyStationDisplayName
import space.dodoplanet.gildongmu.kit.joinText
import space.dodoplanet.gildongmu.kit.models.JourneyResult
import space.dodoplanet.gildongmu.kit.models.SubwayArrival

// 길찾기 여정 몫(B26 단계 4, iOS `DirectionsModel` 여정 상태·`DirectionsTabView` 문장 함수 미러) — 상태 타입과 순수 함수.
// 뷰모델은 이 타입을 들고 배선만 한다. 문장은 전부 `Strings`를 지나고 키는 `android.journey.*`(iOS `ios.journey.*`의 개명)와 기존 웹 키다.

/** 지금 탄 열차 출발(E71) — 출발지 칸을 대신하는 역·노선·방면. 선 동안 `from`은 그 역 좌표를 든다. */
data class AboardOrigin(val station: RecentStation, val line: String?, val direction: JourneyAboardDirection?)

/**
 * 방면 단계의 3-state(+ 노선 질문). `Unavailable`(미커버 역·null 응답)과 `Failed`(조회 실패)와 `Loaded(빈 목록)`(오는 열차 없음)을 뭉개지 않는다.
 */
sealed class AboardDirectionsState {
    data object Idle : AboardDirectionsState()
    data object Loading : AboardDirectionsState()
    data class Loaded(val directions: List<JourneyAboardDirection>) : AboardDirectionsState()
    data class Lines(val lines: List<String>) : AboardDirectionsState()
    data object Unavailable : AboardDirectionsState()
    data object Failed : AboardDirectionsState()
}

/**
 * 여정 조회 결과 3-state(찾음·경로 없음·조회 실패). `results`와 같은 세대에만 산다.
 * `AboardNoRoute`는 지금 탄 열차 출발에서 변형이 하나도 없을 때이고 `opposite`는 그 역·노선에 반대 방향 열차만 있다는 서버 판정이다.
 */
sealed class JourneyQueryOutcome {
    data class Found(val result: JourneyResult) : JourneyQueryOutcome()
    data object NoRoute : JourneyQueryOutcome()
    data object Failed : JourneyQueryOutcome()
    data class AboardNoRoute(val opposite: Boolean) : JourneyQueryOutcome()
}

/** `settleAboardDirections`의 결과 — 노선이 하나로 정해졌으면 그 노선도 함께 돌려준다(`AboardOrigin.line`에 반영). */
data class AboardSettled(val state: AboardDirectionsState, val line: String?)

/**
 * 도착 목록을 노선·방면 묶음으로 푼다. 노선 힌트가 있으면 그 노선, 없으면 도착 목록의 노선이 하나일 때만 그것으로 정한다
 * (0개 = 오는 열차 없음 `Loaded(빈 목록)`, 2개 이상 = 노선 질문 `Lines`).
 */
fun settleAboardDirections(arrivals: List<SubwayArrival>, line: String?): AboardSettled {
    if (line != null) return AboardSettled(AboardDirectionsState.Loaded(journeyAboardDirections(arrivals, line)), line)
    val lines = journeyAboardLines(arrivals)
    return when (lines.size) {
        0 -> AboardSettled(AboardDirectionsState.Loaded(emptyList()), null)
        1 -> AboardSettled(AboardDirectionsState.Loaded(journeyAboardDirections(arrivals, lines[0])), lines[0])
        else -> AboardSettled(AboardDirectionsState.Lines(lines), null)
    }
}

/** 지금 탄 열차 출발의 경로 없음 문장. 그 역·노선에 반대 방향 열차만 있으면 그 사실을 말한다. */
fun journeyAboardNoRouteText(opposite: Boolean, strings: Strings): String =
    strings.get(if (opposite) "android.journey.aboardOpposite" else "android.journey.aboardMissing")

/** 여정 결과가 상태 줄에 말하는 문장 — 찾음은 합산 문장이 말하므로 null. */
fun journeyOutcomeText(outcome: JourneyQueryOutcome?, strings: Strings): String? = when (outcome) {
    null, is JourneyQueryOutcome.Found -> null
    JourneyQueryOutcome.NoRoute -> strings.get("route.transit.noRoute")
    JourneyQueryOutcome.Failed -> strings.get("route.transit.error")
    is JourneyQueryOutcome.AboardNoRoute -> journeyAboardNoRouteText(outcome.opposite, strings)
}

/**
 * 역 칸 한 줄 = 한 객체: 「칸 이름, 역 이름」. 칸 이름은 종류별(역/정류장)이고 칸은 값이 정해졌을 때만 그려진다.
 * 키는 호출마다 리터럴로 쓴다(키 가드가 리터럴 전수를 표와 대조한다).
 */
fun stationFieldText(station: RecentStation?, board: Boolean, strings: Strings): String {
    val stop = station?.kind == JourneyStationKind.busStop
    val name = if (board) {
        if (stop) strings.get("android.journey.boardFieldStop") else strings.get("android.journey.boardFieldStation")
    } else {
        if (stop) strings.get("android.journey.alightFieldStop") else strings.get("android.journey.alightFieldStation")
    }
    return joinText(name, station?.label)
}

/** 출발지 칸의 지금 탄 열차 값: 「지금 탄 열차, {역}」, 방면이 정해지면 「…, {방면}」(방면 이름은 `direction.name`). */
fun aboardFieldValue(aboard: AboardOrigin, strings: Strings): String {
    val direction = aboard.direction
    return if (direction != null) strings.get("android.journey.aboardFieldDirection", aboard.station.label, direction.name)
    else strings.get("android.journey.aboardField", aboard.station.label)
}

/** 단계 줄의 문장. 오는 열차 없음·미커버·실패는 질문 자리에 서는 문장이다. `Idle`은 줄이 없다. */
fun aboardStepText(state: AboardDirectionsState, strings: Strings): String? = when (state) {
    AboardDirectionsState.Idle -> null
    AboardDirectionsState.Loading -> strings.get("android.journey.aboardDirectionsLoading")
    is AboardDirectionsState.Lines -> strings.get("android.journey.aboardLinePrompt")
    is AboardDirectionsState.Loaded ->
        if (state.directions.isEmpty()) strings.get("android.journey.aboardDirectionsEmpty") else strings.get("android.journey.aboardDirectionPrompt")
    AboardDirectionsState.Unavailable -> strings.get("android.journey.aboardDirectionsUnavailable")
    AboardDirectionsState.Failed -> strings.get("android.journey.aboardDirectionsFailed")
}

/** 방면 버튼 한 줄 = 한 객체: 「{방면}, {종착1}행, {종착2}행」. 종착이 없으면 방면 이름만이다. */
fun aboardDirectionRowText(direction: JourneyAboardDirection, strings: Strings): String {
    if (direction.terminals.isEmpty()) return direction.name
    val terminals = direction.terminals.joinToString(", ") { strings.get("android.journey.aboardTerminal", it) }
    return strings.get("android.journey.aboardDirectionRow", direction.name, terminals)
}

/**
 * 여정 경로의 줄(E70 판정 20) — 「{출발}에서 {도착}까지, {역}역에서 갈아타기」로 같은 출발·도착의 보통 경로와 가른다. 조건은 활성화가 역을 쓰는
 * 조건(데이터 로케일 ko)과 같다. 역이 없으면 null. 정류장은 원문 그대로 말하고(역 표시 이름 함수로 깎지 않는다) 역은 `journeyStationDisplayName`을 지난다.
 */
fun recentJourneyLabel(route: RecentRoute, from: String, to: String, enabled: Boolean, strings: Strings): String? {
    if (!enabled) return null
    val sides = listOfNotNull(route.boardStation, route.alightStation)
    fun name(side: RecentStation) = if (side.kind == JourneyStationKind.busStop) side.label else journeyStationDisplayName(side.label)
    if (sides.any { it.kind == JourneyStationKind.busStop }) {
        val only = sides.singleOrNull()
        if (only != null) return strings.get("android.journey.recentRouteStop", from, to, only.label)
        fun place(side: RecentStation) =
            if (side.kind == JourneyStationKind.busStop) side.label else strings.get("android.journey.stationPlace", name(side))
        val board = route.boardStation
        val alight = route.alightStation
        if (board != null && alight != null) return strings.get("android.journey.recentRouteBothPlaces", from, to, place(board), place(alight))
    }
    val board = route.boardStation?.let(::name)
    val alight = route.alightStation?.let(::name)
    if (board != null && alight != null) return strings.get("android.journey.recentRouteBoth", from, to, board, alight)
    val one = board ?: alight ?: return null
    return strings.get("android.journey.recentRoute", from, to, one)
}
