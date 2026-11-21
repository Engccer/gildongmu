package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.JourneyResult
import space.dodoplanet.gildongmu.kit.models.JourneyStationRef
import space.dodoplanet.gildongmu.kit.models.JourneyVariant
import space.dodoplanet.gildongmu.kit.models.JourneyVariantKind
import space.dodoplanet.gildongmu.kit.models.SubwayArrival
import space.dodoplanet.gildongmu.kit.models.TransitRouteLeg
import java.util.UUID

// E70 여정(택시 → 대중교통 → 택시) 전이 표 — Kit `Journey.swift` 미러. spec 2026-10-17-e70-mode-change-journey-design.md §6.1 · plan Task 4.
// 순수 함수라 앱의 세션이 소유하는 상태 위에서 실기기 없이 전수 테스트한다. 웹 대응물은 `src/lib/journey/*`.
// ⚠ 정규식 약칭 클래스(`\d`·`\s`)와 Kotlin 기본 `trim`·`isWhitespace`를 쓰지 않는다 — 공백은 명시 문자와 `SwiftSemantics`로 가른다.

/** 여정 안내 단계. 앞 셋과 뒤 둘 사이의 준비 구간은 `JourneyPhase.Transitioning`이 나타낸다. Swift `rawValue` = 이름. */
enum class JourneyStage {
    taxiIn, access, transit, egress, taxiOut;

    val rawValue: String get() = name

    companion object {
        fun fromRawValue(raw: String): JourneyStage? = entries.firstOrNull { it.name == raw }
    }
}

/** sealed 케이스는 PascalCase(Swift `.running`·`.transitioning(to:)`·`.failed(at:)`). */
sealed class JourneyPhase {
    /** 그 단계의 세션이 도는 중. */
    data class Running(val stage: JourneyStage) : JourneyPhase()

    /** 다음 세션을 준비하는 중(측위·경로 조회·인계 지연). */
    data class Transitioning(val to: JourneyStage) : JourneyPhase()

    /** 그 단계를 시작하지 못했거나 중간에 끊긴 채 사용자의 결정을 기다리는 중. */
    data class Failed(val at: JourneyStage) : JourneyPhase()
}

/** 사건이 자기가 관측한 상태를 들고 오는 표식. 지금 상태와 다르면 낡은 사건이라 무시된다. */
data class JourneyToken(val journeyId: UUID, val seq: Int)

/** 시작 때 정해지는 여정의 모양 — 전이 표의 갈래를 가른다. */
data class JourneyShape(
    /** 승차 역을 지정해 택시 앞 구간이 있다(없으면 대중교통부터 시작). */
    val startsWithTaxi: Boolean,
    /** 하차 역을 지정했다(아니면 대중교통 끝이 여정의 끝). */
    val alightDesignated: Boolean,
    /** 하차 뒤 출구·승강장까지 걷는 구간이 있다(후보 `none`이면 곧장 택시). */
    val hasEgressWalk: Boolean,
)

data class JourneyState(
    val journeyId: UUID,
    val shape: JourneyShape,
    val phase: JourneyPhase,
    /** 전이마다 1씩 오른다. 시작 상태는 1. */
    val seq: Int,
) {
    val token: JourneyToken get() = JourneyToken(journeyId, seq)

    companion object {
        fun start(id: UUID, shape: JourneyShape): JourneyState =
            JourneyState(
                journeyId = id, shape = shape,
                phase = JourneyPhase.Transitioning(if (shape.startsWithTaxi) JourneyStage.taxiIn else JourneyStage.transit), seq = 1,
            )
    }
}

/**
 * 단계 세션이 끝난 사유. 앱 세션의 종료 사유 전부가 여기로 접힌다(위치 상실 `locationLost`는 `ended`) — 빠진 사유가 있으면
 * 세션은 사라지고 여정만 남는다.
 */
enum class JourneyStageEnd { arrived, userStopped, startFailed, ended }

sealed class JourneyEvent {
    data class StageEnded(val end: JourneyStageEnd) : JourneyEvent()

    /** 「자동차에서 내렸어요」 */
    object TaxiDropped : JourneyEvent()

    /** 「자동차에 탔어요」 */
    object TaxiBoarded : JourneyEvent()

    /** 대중교통 마지막 탈것을 내렸다(말미 도보 유무와 무관). */
    object RideCompleted : JourneyEvent()

    /** 대중교통 세션이 완주 말고 끝났다. */
    object TransitStopped : JourneyEvent()

    data class Prepared(val stage: JourneyStage) : JourneyEvent()
    object PrepFailed : JourneyEvent()
    object Retry : JourneyEvent()
    object UserEnded : JourneyEvent()

    /** `Transitioning`이 `JourneyTuning.staleTransitionSeconds`를 넘겼다. */
    object StaleTimeout : JourneyEvent()
}

sealed class JourneyStepResult {
    object Ignore : JourneyStepResult()
    data class Next(val state: JourneyState) : JourneyStepResult()
    object End : JourneyStepResult()
}

object JourneyTuning {
    /** 접근 도보는 인계 시점 위치에서 승차 지점까지 직선이 이 값 이상일 때만 만든다(30m 미만은 생략). */
    const val accessWalkMinMeters = 30.0

    /** 단계 사이 인계 지연(ms) — 앞 통지가 끝나기를 기다리는 시간. */
    const val handoffDelayMs = 600

    /** 사이 상태(`Transitioning`)에 머무를 수 있는 상한(초). 넘기면 `StaleTimeout`. */
    const val staleTransitionSeconds = 30

    /**
     * 같은 이름 정류를 같은 역으로 볼 좌표 반경(m) — 서버 `JOURNEY_STATION_IDENTITY_M`(src/lib/journey/station-identity.ts)과
     * 같은 값. 제목의 동명 이역 노선 머리말(`journeyNeedsLineQualifier`)이 쓴다.
     */
    const val stationIdentityMeters = 500.0
}

/**
 * 전이 표. `token`이 지금 상태와 다르면 무시한다 — 자동 도착 판정과 버튼이 같은 상태를 보고 둘 다 오면
 * 첫 사건만 전이하고 두 번째는 낡은 token이라 버려진다. `Next`는 언제나 seq + 1.
 * 행 순서는 Swift `switch`와 같다(먼저 맞는 행이 이긴다).
 */
fun journeyStep(state: JourneyState, event: JourneyEvent, token: JourneyToken): JourneyStepResult {
    if (token != state.token) return JourneyStepResult.Ignore
    if (event == JourneyEvent.UserEnded) return JourneyStepResult.End

    fun go(phase: JourneyPhase): JourneyStepResult =
        JourneyStepResult.Next(JourneyState(state.journeyId, state.shape, phase, state.seq + 1))

    val p = state.phase
    val e = event
    val taxiIn = JourneyStage.taxiIn
    val access = JourneyStage.access
    val transit = JourneyStage.transit
    val egress = JourneyStage.egress
    val taxiOut = JourneyStage.taxiOut
    val arrived = JourneyEvent.StageEnded(JourneyStageEnd.arrived)
    val userStopped = JourneyEvent.StageEnded(JourneyStageEnd.userStopped)
    val startFailed = JourneyEvent.StageEnded(JourneyStageEnd.startFailed)
    val ended = JourneyEvent.StageEnded(JourneyStageEnd.ended)

    return when {
        p == JourneyPhase.Running(taxiIn) && (e == arrived || e == JourneyEvent.TaxiDropped) ->
            go(JourneyPhase.Transitioning(access))
        p == JourneyPhase.Running(taxiIn) && (e == startFailed || e == ended) ->
            go(JourneyPhase.Failed(taxiIn))

        // 접근 도보는 도착·시작 실패·끊김 모두 대중교통으로 이어진다(역 근처라 대중교통 세션이 이어받는다).
        p == JourneyPhase.Running(access) && (e == arrived || e == startFailed || e == ended) ->
            go(JourneyPhase.Transitioning(transit))

        p == JourneyPhase.Running(transit) && e == JourneyEvent.RideCompleted ->
            if (!state.shape.alightDesignated) JourneyStepResult.End
            else go(JourneyPhase.Transitioning(if (state.shape.hasEgressWalk) egress else taxiOut))
        p == JourneyPhase.Running(transit) && e == JourneyEvent.TransitStopped -> JourneyStepResult.End
        // 대중교통 세션이 서지 않았다(경로 변환 실패·불변식 위반) — 세션 없는 running에 남지 않게 실패 시트로(재시도 가능).
        p == JourneyPhase.Running(transit) && e == startFailed -> go(JourneyPhase.Failed(transit))

        p == JourneyPhase.Running(egress) && (e == arrived || e == JourneyEvent.TaxiBoarded) ->
            go(JourneyPhase.Transitioning(taxiOut))
        p == JourneyPhase.Running(egress) && (e == startFailed || e == ended) ->
            go(JourneyPhase.Failed(egress))

        p == JourneyPhase.Running(taxiOut) && e == startFailed -> go(JourneyPhase.Failed(taxiOut))
        p == JourneyPhase.Running(taxiOut) && e is JourneyEvent.StageEnded -> JourneyStepResult.End

        // 그 단계의 「안내 종료」는 여정 전체 종료(taxiIn·access·egress)
        (p == JourneyPhase.Running(taxiIn) || p == JourneyPhase.Running(access) || p == JourneyPhase.Running(egress)) &&
            e == userStopped -> JourneyStepResult.End

        p is JourneyPhase.Transitioning && e is JourneyEvent.Prepared && e.stage == p.to ->
            go(JourneyPhase.Running(p.to))
        p == JourneyPhase.Transitioning(access) && e == JourneyEvent.Prepared(transit) ->
            go(JourneyPhase.Running(transit)) // 30m 미만 접근 도보 생략
        // access 시작 실패는 막힌 화면이 아니라 대중교통 세션을 바로 시작한다(spec §6.4).
        p == JourneyPhase.Transitioning(access) && (e == JourneyEvent.PrepFailed || e == JourneyEvent.StaleTimeout) ->
            go(JourneyPhase.Transitioning(transit))
        p is JourneyPhase.Transitioning && (e == JourneyEvent.PrepFailed || e == JourneyEvent.StaleTimeout) ->
            go(JourneyPhase.Failed(p.to))

        p is JourneyPhase.Failed && e == JourneyEvent.Retry -> go(JourneyPhase.Transitioning(p.at))
        p == JourneyPhase.Failed(taxiIn) && e == JourneyEvent.TaxiDropped -> go(JourneyPhase.Transitioning(access))
        p == JourneyPhase.Failed(egress) && e == JourneyEvent.TaxiBoarded -> go(JourneyPhase.Transitioning(taxiOut))

        else -> JourneyStepResult.Ignore
    }
}

/**
 * 버스 정류장 이름의 비교 키(E70-e spec §4.2, 웹 `busStopKey` 미러): 공백 제거 → 괄호 묶음 전부 제거 →
 * 숫자 사이가 아닌 첫 `.` 앞부분. 정규식을 쓰지 않는 직접 주사라 약칭 클래스·`[` 이스케이프 함정이 없다.
 * 공유 fixture `journey-station-pairs.json`의 `busStops.names` 표로 웹과 같은 값을 잠근다.
 */
fun journeyBusStopKey(name: String): String {
    val chars = name.filter { !it.isSwiftWhitespace() }
    val kept = StringBuilder()
    var i = 0
    while (i < chars.length) {
        if (chars[i] == '(') {
            val close = chars.indexOf(')', i)
            if (close >= 0) {
                i = close + 1
                continue
            }
        }
        kept.append(chars[i])
        i += 1
    }
    fun isDigit(c: Char?): Boolean = c != null && c >= '0' && c <= '9'
    for (k in kept.indices) {
        if (kept[k] != '.') continue
        val prev = if (k > 0) kept[k - 1] else null
        val next = if (k + 1 < kept.length) kept[k + 1] else null
        if (!(isDigit(prev) && isDigit(next))) return kept.substring(0, k)
    }
    return kept.toString()
}

/** 접근 도보가 필요한가 — 인계 시점 위치에서 승차 지점까지 직선이 `accessWalkMinMeters` 이상. */
fun journeyNeedsAccessWalk(fromLat: Double, fromLng: Double, toLat: Double, toLng: Double): Boolean =
    haversineMeters(fromLat, fromLng, toLat, toLng) >= JourneyTuning.accessWalkMinMeters

/**
 * 문장의 `{station}` 자리에 넣을 역 이름(웹 `displayStationName` 미러). 괄호 부기는 남기고, 공백 뒤 후행 노선 토큰
 * (…선·…철도·GTX-…)과 끝 「역」 한 글자를 뗀다(「서울역역」 방지). 이름이 「역」 하나뿐이면 그대로 둔다.
 * 이름 키 정규화(`stationNameKey`)를 표시용으로 재사용하지 않는다 — 그쪽은 괄호 부기까지 지운다.
 * ⚠ 정규식 약칭 클래스를 쓰지 않는다 — 공백은 명시 문자로 가른다.
 */
fun journeyStationDisplayName(name: String): String {
    val tokens = name.split(' ', '\t', '\n').filter { it.isNotEmpty() }.toMutableList()
    while (tokens.size > 1 && isTrailingLineToken(tokens.last())) {
        tokens.removeAt(tokens.size - 1)
    }
    // 이름이 「서울 역」처럼 갈라진 경우 떨어져 나온 「역」 토큰은 통째로 뗀다(뒤 공백이 남지 않게).
    if (tokens.size > 1 && tokens.last() == "역") {
        tokens.removeAt(tokens.size - 1)
        return tokens.joinToString(" ")
    }
    var out = tokens.joinToString(" ")
    if (out.length > 1 && out.endsWith("역")) out = out.dropLast(1)
    return out
}

private fun isTrailingLineToken(token: String): Boolean =
    token.endsWith("선") || token.endsWith("철도") || token.startsWith("GTX-")

// MARK: 탈것 종류와 동명 이역 노선 머리말

/** 대중교통 구간이 버스 정류장에서 시작한다 — 택시 앞 구간 줄·도착 문장이 「역」을 붙이지 않는다(판정 5). */
val JourneyVariant.boardsAtBusStop: Boolean get() = transit.legs.firstOrNull { it.mode != "walk" }?.mode == "bus"

/** 대중교통 구간이 버스 정류장에서 끝난다. */
val JourneyVariant.alightsAtBusStop: Boolean get() = transit.legs.lastOrNull { it.mode != "walk" }?.mode == "bus"

/**
 * 제목 머리에 붙일 노선 이름(「2호선」·「경의중앙선」). 카카오 힌트(`수도권2호선`)와 ODsay `lineName`(`수도권 2호선`·
 * `수도권 수인.분당선`·`…(급행)`)을 같은 꼴로 만든다: 공백·마침표 제거, `수도권` 접두·`(급행)` 꼬리 제거(`subwayLineIdentity`와
 * 같은 정규화). 빈 값은 null.
 */
fun journeyLineLabel(raw: String?): String? {
    if (raw == null) return null
    var s = raw.filter { it != ' ' && it != '.' && it != '\t' }
    if (s.startsWith("수도권")) s = s.drop(3)
    if (s.endsWith("(급행)")) s = s.dropLast(4)
    return if (s.isEmpty()) null else s
}

private val journeyRegionPrefixes = listOf("수도권", "부산", "대구", "광주", "대전")

private fun isJourneySeparator(c: Char): Boolean =
    c == ' ' || c == '\t' || c == '\n' || c == '.' || c == '·'

/**
 * 웹 `lineHintMatches`(src/lib/station-match.ts) 이식: 「철도·호선·선」 꼬리 하나를 뗀 코어의 상호 접두 일치, 코어가 숫자뿐이면
 * 완전 일치(「1호선」 ≠ 「11호선」). ⚠ 정규식 약칭·공백 집합 약칭을 쓰지 않는다.
 */
internal fun journeyLineHintMatches(lineName: String, lineHint: String): Boolean {
    fun core(s: String): String {
        var t = s.lowercase()
        while (t.isNotEmpty() && isJourneySeparator(t.first())) t = t.drop(1)
        while (t.isNotEmpty() && isJourneySeparator(t.last())) t = t.dropLast(1)
        for (suffix in listOf("철도", "호선", "선")) {
            if (t.endsWith(suffix)) {
                t = t.dropLast(suffix.length)
                break
            }
        }
        return t.filter { !isJourneySeparator(it) }
    }
    val a = core(lineName)
    val b = core(lineHint)
    if (a.isEmpty() || b.isEmpty()) return false
    val digits: (String) -> Boolean = { str -> str.all { it in "0123456789" } }
    if (digits(a) || digits(b)) return a == b
    return a == b || a.startsWith(b) || b.startsWith(a)
}

/**
 * 두 노선 표기가 같은 노선인가 — 서버 `sameLine`(src/lib/journey/station-identity.ts)과 같은 판정 순서다(공유 fixture
 * `journey-line-names.json`이 잠근다). 한쪽만 비수도권 지역 접두(`부산 2호선`)이고 다른 쪽이 지역 없는 맨 번호(`2호선` —
 * 카카오 출구 힌트는 지역을 싣지 않는다)면 코어끼리, 노선명 표(`subwayLineIdentity`)에 둘 다 있으면 표 값끼리, 지역 접두가
 * 둘 다 있고 다르면 다른 노선, 아니면 코어끼리 `journeyLineHintMatches`. `수도권`도 지역 접두로 읽는다(떼고 읽으면
 * `부산1호선` ↔ `수도권 1호선`이 같은 노선이 된다).
 */
internal fun journeySameLine(a: String, b: String): Boolean {
    fun split(raw: String): Pair<String?, String> {
        var s = raw
        while (s.isNotEmpty() && isJourneySeparator(s.last())) s = s.dropLast(1)
        if (s.endsWith("(급행)")) s = s.dropLast(4)
        while (s.isNotEmpty() && isJourneySeparator(s.first())) s = s.drop(1)
        var region: String? = null
        for (r in journeyRegionPrefixes) {
            if (s.startsWith(r)) {
                region = r
                s = s.drop(r.length)
                break
            }
        }
        return region to s.filter { !isJourneySeparator(it) }
    }
    val fa = split(a)
    val fb = split(b)
    val regional: (String?) -> Boolean = { it != null && it != "수도권" }
    if ((regional(fa.first) && fb.first == null) || (regional(fb.first) && fa.first == null)) {
        return journeyLineHintMatches(fa.second, fb.second)
    }
    val ia = subwayLineIdentity(a)
    val ib = subwayLineIdentity(b)
    if (ia != null && ib != null) return ia == ib
    val ra = fa.first
    val rb = fb.first
    if (ra != null && rb != null && ra != rb) return false
    return journeyLineHintMatches(fa.second, fb.second)
}

/** 동명 이역 판정에 쓰는 정류 하나 — 이름·노선(모르면 null)·좌표. */
data class JourneyStopIdentity(val name: String, val line: String?, val lat: Double, val lng: Double)

/**
 * 지정 역과 실제로 타는(내리는) 역의 제목에 노선을 붙이는가(판정 26): 표시 이름이 같고 다른 역일 때만. 다른 역의 근거는
 * 서버 같은 역 판정(spec §4.3)과 같다 — 노선을 둘 다 알면 노선이 다를 때, 하나라도 모르면 좌표가
 * `JourneyTuning.stationIdentityMeters`보다 멀 때(동명 이역 신촌 680m대). 두 역을 다 지정한 여정에서 추천 경로가
 * 고른 바로 그 역에서 탈 수 있으므로(다른 쪽이 안 맞아 지정 역 경로가 아니었을 뿐) "이름이 같으면 다른 역"으로 보지 않는다.
 */
fun journeyNeedsLineQualifier(designated: JourneyStopIdentity, actual: JourneyStopIdentity): Boolean {
    if (journeyStationDisplayName(designated.name) != journeyStationDisplayName(actual.name)) return false
    val a = designated.line
    val b = actual.line
    if (a != null && b != null && journeyLineLabel(a) != null && journeyLineLabel(b) != null) {
        return !journeySameLine(a, b)
    }
    return haversineMeters(designated.lat, designated.lng, actual.lat, actual.lng) > JourneyTuning.stationIdentityMeters
}

/** 문장의 `{station}` 자리 이름에 노선 머리말을 붙인다(「2호선 신촌」). 노선을 모르면 표시 이름만. */
fun journeyQualifiedStationName(name: String, line: String?): String {
    val display = journeyStationDisplayName(name)
    val label = journeyLineLabel(line) ?: return display
    return "$label $display"
}

/** 동명 이역 노선 머리말을 붙일 쪽(판정 26). 그 쪽의 지정 역 제목(또는 못 찾음 줄)과 추천 제목에 함께 붙는다. */
data class JourneyLineQualifiers(var board: Boolean = false, var alight: Boolean = false)

/**
 * 추천 변형의 그 쪽 지하철 정류가 칸에 고른 역과 이름은 같고 다른 역인가. 비교 대상은 서버 같은 역 판정과 같이 칸의 값(이름·
 * 노선 힌트·좌표)이다 — 지정 역 경로의 탈것 노선으로 비교하면 서버가 같은 역으로 인정한 추천 승차역(힌트 없는 칸)에도 노선이
 * 붙는다. 버스는 제목이 이미 「버스」를 말해 가를 필요가 없다. 정류 좌표를 모르면 붙이지 않는다(평소 문장이 기본).
 */
fun journeyLineQualifiers(result: JourneyResult, board: RecentStation?, alight: RecentStation?): JourneyLineQualifiers {
    val recommended = result.variants.firstOrNull { it.kind == JourneyVariantKind.recommended } ?: return JourneyLineQualifiers()
    fun vehicles(v: JourneyVariant?): List<TransitRouteLeg> = v?.transit?.legs?.filter { it.mode != "walk" } ?: emptyList()
    fun stop(leg: TransitRouteLeg?, from: Boolean, ref: JourneyStationRef?): JourneyStopIdentity? {
        if (leg == null || leg.mode == "bus") return null
        val name = (if (from) leg.fromName else leg.toName) ?: return null
        val stop = if (from) leg.stops?.firstOrNull() else leg.stops?.lastOrNull()
        val lat = stop?.lat ?: ref?.coord?.lat ?: return null
        val lng = stop?.lng ?: ref?.coord?.lng ?: return null
        return JourneyStopIdentity(name, leg.lineName, lat, lng)
    }
    fun chosen(station: RecentStation): JourneyStopIdentity = JourneyStopIdentity(station.label, station.line, station.lat, station.lng)
    val out = JourneyLineQualifiers()
    // 정류장 지정 쪽은 노선 머리말 대상이 아니다(동명 이역 판정은 역 전용, 버스 leg는 위 stop()이 이미 제외).
    if (board != null && board.kind != JourneyStationKind.busStop) {
        val actual = stop(vehicles(recommended).firstOrNull(), from = true, ref = recommended.boardStation)
        if (actual != null) out.board = journeyNeedsLineQualifier(chosen(board), actual)
    }
    if (alight != null && alight.kind != JourneyStationKind.busStop) {
        val actual = stop(vehicles(recommended).lastOrNull(), from = false, ref = recommended.alightStation)
        if (actual != null) out.alight = journeyNeedsLineQualifier(chosen(alight), actual)
    }
    return out
}

/**
 * 추천 변형 제목이 승차 쪽을 말하는가(spec §8.4 조합 규칙): 승차 쪽이 지정 역과 다르거나(이름, 또는 동명 이역) 하차 쪽도
 * 같을 때. 아니면(하차 쪽만 다르면) 하차 쪽 제목이다.
 */
fun journeyRecommendedTitleIsBoardSide(v: JourneyVariant, board: RecentStation?, alight: RecentStation?, lines: JourneyLineQualifiers): Boolean {
    val vehicles = v.transit.legs.filter { it.mode != "walk" }
    // 지정과 다른가: 역은 표시 이름, 정류장은 정류장 키(역 표시 이름 함수로 정류장 이름을 깎지 않는다).
    fun differs(station: RecentStation, actual: String?): Boolean {
        val a = actual ?: ""
        return if (station.kind == JourneyStationKind.busStop) journeyBusStopKey(station.label) != journeyBusStopKey(a)
        else journeyStationDisplayName(station.label) != journeyStationDisplayName(a)
    }
    val boardDiffers = board?.let { differs(it, vehicles.firstOrNull()?.fromName) } ?: false
    val alightDiffers = alight?.let { differs(it, vehicles.lastOrNull()?.toName) } ?: false
    return boardDiffers || lines.board || !(alightDiffers || lines.alight)
}

// MARK: E71 지금 탄 열차에서 여정 시작 — 방면 묶음·방향 잠금

/** 지금 탄 열차의 방면 한 묶음. `direction`은 서버 `updnLine` 원문(상행·하행·내선·외선)이고 질의 `boardDir`에 그대로 실린다. */
data class JourneyAboardDirection(
    val direction: String,
    /** 「구로방면」 — 도착 문구의 「 - 」 뒤 조각. 없으면 `direction`. */
    val name: String,
    /** 그 방면 열차의 종착 이름(「행」 없음). 중복 없이 처음 본 순서. */
    val terminals: List<String>,
)

/** 공백·탭·개행만 뗀다. ⚠ 기본 `trim`을 쓰지 않는다(Swift 미러는 이 셋만). */
private fun journeyAboardTrim(s: String): String =
    s.trim { it == ' ' || it == '\t' || it == '\n' }

/** 도착 목록에 나온 노선 이름들 — 비어 있지 않은 서로 다른 값, 처음 본 순서. */
fun journeyAboardLines(arrivals: List<SubwayArrival>): List<String> {
    val seen = mutableListOf<String>()
    for (a in arrivals) {
        val line = a.line
        if (line == null || journeyAboardTrim(line).isEmpty() || seen.contains(line)) continue
        seen.add(line)
    }
    return seen
}

/** 고른 노선의 방면 묶음 — 노선은 `journeySameLine`으로 가른다(카카오 힌트 `수도권1호선` ↔ 도착 목록 `1호선`). `direction`(trim 뒤 빈 값 버림)으로 묶고 처음 본 순서를 지킨다. */
fun journeyAboardDirections(arrivals: List<SubwayArrival>, line: String): List<JourneyAboardDirection> {
    val order = mutableListOf<String>()
    val names = HashMap<String, String>()
    val terminals = HashMap<String, MutableList<String>>()
    for (a in arrivals) {
        val l = a.line
        if (l == null || !journeySameLine(l, line)) continue
        val dir = journeyAboardTrim(a.direction)
        if (dir.isEmpty()) continue
        if (terminals[dir] == null) {
            order.add(dir)
            terminals[dir] = mutableListOf()
        }
        val sep = a.trainLineNm.indexOf(" - ")
        if (names[dir] == null && sep >= 0) {
            val tail = journeyAboardTrim(a.trainLineNm.substring(sep + 3))
            if (tail.isNotEmpty()) names[dir] = tail
        }
        val dest = journeyAboardTrim(a.destination)
        val list = terminals[dir]
        if (dest.isNotEmpty() && list != null && !list.contains(dest)) list.add(dest)
    }
    return order.map { JourneyAboardDirection(it, names[it] ?: it, terminals[it] ?: emptyList()) }
}

/** 방향이 잠긴 열차만 — 순서를 지킨다. 승차 뒤 열차 선택 목록이 반대 방향을 섞어 보이지 않게 한다. */
fun journeyAboardTrainItems(items: List<TransitTrackItem>, direction: String): List<TransitTrackItem> =
    items.filter { it.direction == direction }

// MARK: 입구 검색 짐작(E77 판정 3 — 웹 `journeyTransferGuess` 미러, 공유 fixture `journey-transfer-guess.json`)

/**
 * 입구 검색에서 고른 역·정류장이 어느 쪽 갈아탈 곳인가: `board`(자동차로 이동하다가 그 장소에서 대중교통으로, 승차 쪽 칸) /
 * `alight`(대중교통을 이용하다가 그 장소에서 내려 자동차로, 하차 쪽 칸).
 */
enum class JourneyTransferSide { board, alight }

/** 질문·버튼 문장의 수단 낱말: 지하철역 `subway`, 기차역 `rail`, 버스 정류장 `bus`. */
enum class JourneyTransferMode { subway, rail, bus }

/** 출발지·도착지 좌표가 둘 다 있고 도착지까지 직선거리가 엄격히 더 짧을 때만 `alight`, 그 밖은 `board`. Swift 튜플 `(lat:, lng:)?` → `RoutePoint?`. */
fun journeyTransferGuess(placeLat: Double, placeLng: Double, origin: RoutePoint?, dest: RoutePoint?): JourneyTransferSide {
    if (origin == null || dest == null) return JourneyTransferSide.board
    val toOrigin = haversineMeters(placeLat, placeLng, origin.lat, origin.lng)
    val toDest = haversineMeters(placeLat, placeLng, dest.lat, dest.lng)
    return if (toDest < toOrigin) JourneyTransferSide.alight else JourneyTransferSide.board
}
