package space.dodoplanet.gildongmu.kit

// E37 완성 문장 → 우리 문장 (웹 `src/lib/place-lines/station-arrivals.ts` ↔ Kit `SubwayArrivalLine.swift` 미러)

/** 도착 사건의 동사 — 키 접미와 같은 철자다(:app `when`이 키를 고른다). */
enum class SubwayArrivalVerb {
    approaching, arrived, departed;

    val rawValue: String get() = name

    companion object {
        fun fromRawValue(raw: String): SubwayArrivalVerb? = entries.firstOrNull { it.name == raw }
    }
}

/**
 * 완성 문장(`arvlMsg2`)의 뜻. `station`은 문장 안에 들어가는 역(그 역이 열차 위치임이 실측으로 확인된 문법만),
 * `nowAt`은 관계를 단정하지 않는 `현재 {역}.` 꼬리. 둘이 함께 있는 계획은 없고, 위치를 신뢰할 수 없는 문법은
 * 둘 다 갖지 않는다.
 */
sealed class SubwayArrivalPlan {
    data class StationEvent(val verb: SubwayArrivalVerb, val station: String) : SubwayArrivalPlan()
    data class PrevStationEvent(val verb: SubwayArrivalVerb, val station: String) : SubwayArrivalPlan()
    data class DepartedStopsBack(val count: Int) : SubwayArrivalPlan()
    data class StopsAway(val count: Int, val station: String) : SubwayArrivalPlan()
    data class Eta(val minutes: Int?, val seconds: Int?, val stops: Int?, val nowAt: String?) : SubwayArrivalPlan()
}

/**
 * 정규식 약칭 클래스(공백·숫자)는 쓰지 않는다 — JVM은 ASCII, 안드로이드 ICU·Swift는 유니코드라 테스트와 기기가 갈린다.
 * 공백은 유니코드 공백(White_Space 속성, Swift·JS와 같은 뜻), 숫자는 `[0-9]`(웹 JS와 같다). 모든 자리가 전각 숫자면 Swift도
 * `Int`로 읽지 못해 결과가 같고, ASCII·전각 혼합(`3분 ４초 후`)만 Swift가 부분 인식한다(웹·Kotlin은 원문 경로). Kotlin
 * `toIntOrNull`은 전각 숫자를 읽으므로 클래스를 넓히면 오히려 갈린다.
 */
private const val WS = """[\t\n\u000B\f\r\u0085\p{Z}]"""

private val PREV_EVENT = Regex("""^전역 (진입|도착|출발)$""")
private val PREV_DEPARTED_WITH_STATION = Regex("""^(.+?)$WS*전역출발$""")
private val STATION_EVENT = Regex("""^(.+?) (진입|도착|출발)$""")

/**
 * ⚠ 괄호는 **필수**다. 코퍼스 254행이 전부 괄호를 다는데, 괄호 없는 변형이 오면 그 역이 열차 위치라는 보장이
 * 없다(`{X} 전역출발`의 X가 조회 역 자신인 것과 같은 계열일 수 있다) — 원문에 맡긴다.
 */
private val STOPS_AWAY = Regex("""^\[([0-9]+)\]번째 전역$WS*\((.+)\)$""")

/**
 * 괄호는 소·대괄호 둘 다 온다(`4분 후 (삼각지)` · `3분48초후[3번째 전]`).
 * ⚠ 문자 클래스 안의 `[`는 반드시 이스케이프한다(`[(\[]`) — Java·ICU는 `[([]`를 중첩 집합의 시작으로 읽어
 * 패턴이 통째로 어긋나고(시간형 전량 미인식), JS는 같은 표기를 문자로 읽어 **웹만 통과한다**.
 */
private val ETA = Regex("""^(?:([0-9]+)분)?(?:$WS*([0-9]+)초)?$WS*후(?:$WS*[(\[](.+)[)\]])?$""")

/** 구 문법 `3분 후(2번째 전)`의 괄호 — 역명이 아니라 잔여 정거장이다. */
private val ETA_STOPS_PAREN = Regex("""^\[?([0-9]+)\]?번째 전$""")

/** 첫 매치의 그룹들(참여하지 않은 그룹은 null). Swift `match(_:_:)`가 `NSRegularExpression.firstMatch`로 읽는 것과 같다. */
private fun match(regex: Regex, text: String): List<String?>? =
    regex.find(text)?.let { hit -> List(hit.groups.size) { hit.groups[it]?.value } }

private val VERBS = mapOf("진입" to SubwayArrivalVerb.approaching, "도착" to SubwayArrivalVerb.arrived, "출발" to SubwayArrivalVerb.departed)

private class ResolvedStation(val ok: Boolean, val station: String?)

/**
 * 문장에서 읽은 역과 `arvlMsg3`를 하나로 — **둘 다 있고 다르면 모순**이라 실패다. 서버 `enrichArrivalEn`의
 * "둘이 다르면 부재"와 같은 축(그래야 `currentLocationEn`이 이 역의 영문이다).
 */
private fun resolveStation(fromText: String?, fromMsg3: String): ResolvedStation {
    val trimmed = fromText?.trim()?.ifEmpty { null }
    if (trimmed != null && fromMsg3.isNotEmpty() && trimmed != fromMsg3) return ResolvedStation(false, null)
    return ResolvedStation(true, trimmed ?: fromMsg3.ifEmpty { null })
}

/**
 * 서울시 완성 문장 → 우리 문장 계획(E37). 순수. 웹 `subwayArrivalProse` 미러 — 공유 fixture
 * `src/lib/__tests__/fixtures/subway-arrival-prose-cases.json`이 세 구현을 한 표로 잠근다.
 *
 * ⚠ 불변식 I1: 게이트는 **문장의 모양**이고 초 수도 문장에서 읽는다. `barvlDt`(`arrivalSeconds`)·`arvlCd`는 판정에도
 * 값에도 쓰지 않는다 — 비시간형 행에도 `barvlDt`가 비0으로 오고(코퍼스 65행, 심야 `전역 출발`에 1200초),
 * `[N]번째 전역`이 코드 1로도 온다(8호선 심야 24행).
 * ⚠ 불변식 I2: 역명을 싣는 것은 그 역이 열차 위치임이 실측으로 확인된 문법뿐이다. `{X} 전역출발`의 X는 조회 역
 * 자신이고 `전전역 출발`은 관측이 얇아 `arvlMsg3`의 뜻을 모른다 — 이 둘은 역명을 싣지 않는다.
 * 못 알아보면 `null`(원문 경로) — 역을 지어내지 않는다(3-state).
 */
fun subwayArrivalProse(message: String?, currentLocation: String?): SubwayArrivalPlan? {
    // trim은 웹 `String.trim()`(개행 포함)에 맞춘다.
    val msg = (message ?: "").trim()
    val msg3 = (currentLocation ?: "").trim()
    if (msg.isEmpty()) return null

    match(PREV_EVENT, msg)?.let { m ->
        val verb = m[1]?.let { VERBS[it] }
        if (verb != null) {
            if (msg3.isEmpty()) return null
            return SubwayArrivalPlan.PrevStationEvent(verb, msg3)
        }
    }
    // ⚠ 이 두 문법은 **위치를 말하지 않는다**(I2) — 그 역이 열차 위치라는 증거가 없는데 실으면 unknown을
    // "있음"으로 바꾸는 것이다.
    if (msg == "전전역 출발") return SubwayArrivalPlan.DepartedStopsBack(2)
    match(PREV_DEPARTED_WITH_STATION, msg)?.let { m ->
        // 모순(문장의 역 ≠ `arvlMsg3`)은 우리가 모르는 모양이라 원문에 맡긴다 — 값은 쓰지 않지만 판정에는 쓴다.
        if (!resolveStation(m[1], msg3).ok) return null
        return SubwayArrivalPlan.DepartedStopsBack(1)
    }
    match(STOPS_AWAY, msg)?.let { m ->
        val count = m[1]?.toIntOrNull()
        if (count != null) {
            if (count < 1) return null
            val r = resolveStation(m[2], msg3)
            val station = r.station
            if (!r.ok || station == null) return null
            return SubwayArrivalPlan.StopsAway(count, station)
        }
    }
    match(ETA, msg)?.let { m ->
        if (m[1] != null || m[2] != null) {
            val minutes = m[1]?.toIntOrNull()
            val seconds = m[2]?.toIntOrNull()
            if (seconds != null && seconds > 59) return null
            val min = minutes ?: 0
            val sec = seconds ?: 0
            if (!(min >= 1 || sec >= 1)) return null
            // 구 문법의 괄호는 역명이 아니라 잔여 정거장이다 — 정거장 조각으로 풀고 현재역은 `arvlMsg3`가 맡는다.
            val legacy = m[3]?.let { match(ETA_STOPS_PAREN, it.trim()) }
            val stops = legacy?.get(1)?.toIntOrNull()
            if (stops != null && stops < 1) return null
            val r = if (legacy != null) ResolvedStation(true, msg3.ifEmpty { null }) else resolveStation(m[3], msg3)
            if (!r.ok) return null
            return SubwayArrivalPlan.Eta(
                minutes = if (min >= 1) min else null,
                seconds = if (sec >= 1) sec else null,
                stops = stops,
                nowAt = r.station,
            )
        }
    }
    // ⚠ 당역 문법은 **`arvlMsg3`와 값이 같을 때만** 인정한다 — `{무엇} 도착` 모양은 역명이 아닌 말도 통과시킨다
    // (`곧 도착`의 "곧"을 역으로 읽는다). 코퍼스의 이 문법 228행은 전부 `arvlMsg3`와 같다.
    match(STATION_EVENT, msg)?.let { m ->
        val verb = m[2]?.let { VERBS[it] }
        if (verb != null && msg3.isNotEmpty() && m[1]?.trim() == msg3) {
            return SubwayArrivalPlan.StationEvent(verb, msg3)
        }
    }
    return null
}

/** 계획이 요구하는 역(문장의 역 또는 꼬리) — 없으면 그 줄은 역명 없이 선다. */
fun subwayArrivalPlanStation(plan: SubwayArrivalPlan): String? = when (plan) {
    is SubwayArrivalPlan.StationEvent -> plan.station
    is SubwayArrivalPlan.PrevStationEvent -> plan.station
    is SubwayArrivalPlan.StopsAway -> plan.station
    is SubwayArrivalPlan.DepartedStopsBack -> null
    is SubwayArrivalPlan.Eta -> plan.nowAt
}

/** 문장 한 조각 — 키와 인자(순서는 ko 문장의 플레이스홀더 순서 = 위치 인자 ABI). */
data class SubwayArrivalSegment(val key: String, val args: List<String>)

/** 쉼표로 잇는 조각들과, 앞 문장에 공백으로 잇는 꼬리. */
data class SubwayArrivalSegments(val joined: List<SubwayArrivalSegment>, val tail: SubwayArrivalSegment?)

/**
 * 계획 + 그 줄에 실릴 역명 → 문장 조각. **키 선택이 여기 한 곳**이라 웹과 갈리지 않는다(공유 fixture의 `keys` 열이
 * 구현들을 잠근다). :app은 리터럴 `when`으로 카탈로그 조회만 한다(키를 보간으로 조립하면 누락 린터가 못 본다).
 */
fun subwayArrivalProseSegments(plan: SubwayArrivalPlan, station: String?): SubwayArrivalSegments {
    val at = station ?: ""
    return when (plan) {
        is SubwayArrivalPlan.StationEvent ->
            SubwayArrivalSegments(listOf(SubwayArrivalSegment(plan.verb.rawValue, listOf(at))), null)
        is SubwayArrivalPlan.PrevStationEvent -> {
            val key = when (plan.verb) {
                SubwayArrivalVerb.approaching -> "prevApproaching"
                SubwayArrivalVerb.arrived -> "prevArrived"
                SubwayArrivalVerb.departed -> "prevDeparted"
            }
            SubwayArrivalSegments(listOf(SubwayArrivalSegment(key, listOf(at))), null)
        }
        is SubwayArrivalPlan.DepartedStopsBack ->
            SubwayArrivalSegments(listOf(SubwayArrivalSegment("departedStopsBack", listOf(plan.count.toString()))), null)
        is SubwayArrivalPlan.StopsAway ->
            SubwayArrivalSegments(listOf(SubwayArrivalSegment("stopsAway", listOf(plan.count.toString(), at))), null)
        is SubwayArrivalPlan.Eta -> {
            val minutes = plan.minutes
            val seconds = plan.seconds
            val eta = when {
                minutes != null && seconds != null -> SubwayArrivalSegment("etaMinSec", listOf(minutes.toString(), seconds.toString()))
                minutes != null -> SubwayArrivalSegment("etaMin", listOf(minutes.toString()))
                else -> SubwayArrivalSegment("etaSec", listOf((seconds ?: 0).toString()))
            }
            // 정거장이 함께 오면 버스 안내 상태 문장과 같은 순서·구분(정거장 먼저, 쉼표)으로 잇는다(E39).
            val joined = plan.stops?.let { listOf(SubwayArrivalSegment("stopsJoin", listOf(it.toString())), eta) } ?: listOf(eta)
            // 꼬리의 유무는 **계획**이 정하고 역명은 표기일 뿐이다.
            val tail = plan.nowAt?.let { SubwayArrivalSegment("nowAt", listOf(station ?: it)) }
            SubwayArrivalSegments(joined, tail)
        }
    }
}

// A32 현재역 꼬리 (원문 경로 전용)

/**
 * 지하철 도착 한 줄의 현재역 꼬리 판정(A32) — 웹 `src/lib/place-lines/station-arrivals.ts` 미러. 공유 fixture
 * `src/lib/__tests__/fixtures/subway-arrival-tail-cases.json`이 구현들을 한 표로 잠근다.
 * ⚠ E37(문장형) 뒤로 이 판정은 **원문 경로**(문장을 못 알아본 줄)에서만 쓰인다.
 *
 * 낭독 정본인 완성 문장(`arvlMsg2`)이 **이미 현재역을 담는 문법이 있다**(`6분 후 (강일)`·`강일 도착`). 그 위에
 * `현재 {역}`을 또 이으면 한 접근성 객체 안에서 같은 역 이름이 두 번 낭독된다.
 *
 * ⚠ **판정 축은 값 포함이지 글자 패턴이 아니다.** 역 이름 자체에 괄호가 있어서(`천호(풍납토성) 전역출발`)
 * "괄호가 있으면 현재역이 들어 있다"는 규칙은 바로 어긋난다. 알아보지 못하면 **붙이는 쪽**으로 실패한다.
 * ⚠ **언어마다 자기 값으로 판정한다.** 영문 문장(`messageEn`)은 괄호 현재역을 담지 않는다. 한국어 값으로 en을
 * 판정하면 중복이 없는 줄에서 꼬리를 떼어 **en 사용자만 현재역을 잃는다**.
 * ⚠ **판정에는 그 줄에 실제로 렌더될 값을 먹인다.**
 *
 * @param message 그 줄에 실제로 쓸 완성 문장(ko `arvlMsg2` 또는 en `messageEn`).
 * @param currentLocation 같은 줄에 **실제로 실릴** 현재역(ko `arvlMsg3` 또는 en `currentLocationEn`).
 * @return 꼬리(`현재 {역}`)를 붙일 것인가.
 */
fun subwayShowsCurrentLocationTail(message: String?, currentLocation: String?): Boolean {
    val location = (currentLocation ?: "").trim()
    // 현재역이 애초에 없으면 붙일 것도 없다("정보 없음"이지 중복이 아니다).
    if (location.isEmpty()) return false
    // 문장은 trim하지 않는다 — 찾는 값의 양끝 공백이 이미 없어 문장 양끝을 다듬어도 포함 여부가 바뀌지 않는다.
    return !(message ?: "").contains(location)
}
