package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable

/**
 * 안내 문장 판정(E27 잔여 ①, spec 2026-09-01 §3.7) — 웹 `transit-guide-text.ts` ↔ Kit `TransitGuideText.swift` 미러.
 * 공유 fixture `transit-guide-text-cases.json`이 두 구현을 한 표로 잠근다.
 *
 * 어떤 키를 쓰는가, 어떤 인자를 어떤 순서로 넣는가, **이 줄이 ko인가 en인가**를 여기서 정하고 앱은 리터럴 분기로 카탈로그
 * 조회만 한다.
 *
 * **입력은 표시 투영뿐이다** — 조인 필드가 타입에 없어 노선명·역명이 조회 쿼리로 새어 나갈 경로가 구조적으로 없다(spec §3.5).
 *
 * ⚠ **인자 순서는 ko 문장의 플레이스홀더 등장 순서가 정본**이다. 어순이 다른 로케일은 변환 스크립트가 인덱스를 재배치하므로
 * 호출부는 이 순서 하나만 지킨다.
 */

/** 한 조각: i18n 키(+위치 인자) 또는 완성 문장 원문(서버가 준 그대로 병치). */
@Serializable
data class TransitTextPart(val key: String? = null, val args: List<String>? = null, val text: String? = null) {
    companion object {
        fun key(k: String, a: List<String> = emptyList()) = TransitTextPart(key = k, args = a)
        fun text(t: String) = TransitTextPart(text = t)
    }
}

/** 한 줄(한 접근성 객체). `parts`가 비면 그 줄은 생략이고 `lang`은 **값의 언어**다("ko" | "en"). */
@Serializable
data class TransitTextLine(val parts: List<TransitTextPart>, val lang: String)

private val omitLine = TransitTextLine(emptyList(), "ko")

/** `transitPickLabels` 결과(Swift 튜플 `(values, lang)` 대응). */
data class PickedLabels(val values: List<String>, val lang: String)

/**
 * 줄 원자성 판정 — 영문 조각이 **전부** 있을 때만 영어 줄이고, 하나라도 없으면 줄 전체가 ko.
 * ⚠ `TransitLabel.en`의 빈 문자열은 투영 단계에서 이미 걸러졌다 — 유일한 예외인 `message` 슬롯의 `""`는 "ko에도 그 조각이
 * 없다"는 자리 표시라 여기서 완비로 친다(spec §3.4).
 */
fun transitPickLabels(isEn: Boolean, labels: List<TransitLabel>): PickedLabels {
    if (!isEn) return PickedLabels(labels.map { it.ko }, "ko")
    val en = labels.mapNotNull { it.en }
    if (en.size != labels.size) return PickedLabels(labels.map { it.ko }, "ko")
    return PickedLabels(en, "en")
}

/** 수단별 키(A33 패턴, E39) — 버스는 `{line}`이 노선 번호라 수단 낱말이 붙어야 한다. ⚠ 라벨에 합성하지 않는다(조인 키 오염). */
private fun modeKey(leg: TransitDisplayLeg, base: String): String = if (leg.mode == "bus") base + "Bus" else base

private fun makeLine(isEn: Boolean, key: String, labels: List<TransitLabel>, build: (List<String>) -> List<String>): TransitTextLine {
    val picked = transitPickLabels(isEn, labels)
    return TransitTextLine(listOf(TransitTextPart.key(key, build(picked.values))), picked.lang)
}

private fun uiLang(isEn: Boolean) = if (isEn) "en" else "ko"

// MARK: - 문맥 문장

/**
 * 대기 문맥(§4.1). ⚠ `isCurrentLeg`에 기본값 없음 — 다음 구간 안내가 이전 구간에서 고른 역을 말하면 안 되는데 생략이
 * 통과하면 그 결함이 조용히 들어온다. ⚠ 재선택한 역이 있으면 선행 도보 문구를 붙이지 않는다(그 도보는 이미 지난 일이다).
 */
fun transitWaitContextLine(isEn: Boolean, leg: TransitDisplayLeg, isCurrentLeg: Boolean): TransitTextLine {
    val overridden = isCurrentLeg && leg.boardOverridden
    val walk = leg.walkBeforeMinutes
    if (!overridden && walk != null && walk > 0) {
        return makeLine(isEn, modeKey(leg, "waitContextWalk"), listOf(leg.board, leg.line)) { listOf(walk.toString(), it[0], it[1]) }
    }
    return makeLine(isEn, modeKey(leg, "waitContext"), listOf(leg.board, leg.line)) { it }
}

fun transitBoardingContextLine(isEn: Boolean, leg: TransitDisplayLeg): TransitTextLine =
    makeLine(isEn, modeKey(leg, "boardingContext"), listOf(leg.board, leg.line)) { it }

fun transitContextLine(isEn: Boolean, leg: TransitDisplayLeg): TransitTextLine =
    makeLine(isEn, modeKey(leg, "context"), listOf(leg.line, leg.alight)) { it }

// MARK: - 완성 문장 프레임

fun transitApproachFrameLine(isEn: Boolean, leg: TransitDisplayLeg, message: TransitLabel): TransitTextLine =
    makeLine(isEn, "approachFrame", listOf(leg.board, message)) { it }

/** 상태 문장을 만드는 국면(E39). `waiting`은 관측값이 없어 이 함수들을 지나지 않는다. */
enum class TransitStatusPhase {
    boarding, riding;

    val rawValue: String get() = name

    companion object {
        fun fromRawValue(raw: String): TransitStatusPhase? = entries.firstOrNull { it.name == raw }
    }
}

/** 서울버스 완성 문장(TOPIS `arrmsg`)의 모양 — 웹 `parseBusArrmsg` 미러. */
internal sealed class BusArrmsgKind {
    data class Eta(val minutes: Int?, val seconds: Int?) : BusArrmsgKind()
    data object Soon : BusArrmsgKind()
    data object Waiting : BusArrmsgKind()
    data object Turning : BusArrmsgKind()
    data object Ended : BusArrmsgKind()
    data object Unknown : BusArrmsgKind()
}

// :kit 규칙: 약칭 문자 클래스 대신 명시 클래스(안드로이드 ICU에서 약칭 숫자·공백 클래스가 유니코드까지 통과한다).
private val ARRMSG_TAIL = Regex("""\[([0-9]+)번째 전\]""")
private val BUS_ETA = Regex("""^(?:([0-9]+)분)?[$REGEX_SPACE_MEMBERS]*(?:([0-9]+)초)?[$REGEX_SPACE_MEMBERS]*후$""")

/** 원문 → 모양. 잔여 꼬리는 떼고 본다(잔여 수는 구조 필드가 따로 온다). */
internal fun parseBusArrmsgKind(message: String): BusArrmsgKind {
    val body = ARRMSG_TAIL.replace(message, "").trimSwiftWhitespaces()
    if (body.replace(" ", "") == "곧도착") return BusArrmsgKind.Soon
    if (body == "출발대기") return BusArrmsgKind.Waiting
    if (body == "회차대기") return BusArrmsgKind.Turning
    if (body == "운행종료") return BusArrmsgKind.Ended
    // "6분47초후" / "15분후" / "55초후" — 꼬리를 뗀 몸통 전체가 걸려야 한다.
    val hit = BUS_ETA.find(body) ?: return BusArrmsgKind.Unknown
    val minutes = hit.groups[1]?.value?.toIntOrNull()
    val seconds = hit.groups[2]?.value?.toIntOrNull()
    if (minutes == null && seconds == null) return BusArrmsgKind.Unknown
    return BusArrmsgKind.Eta(minutes, seconds)
}

/**
 * 서울버스 완성 문장 → 우리 문장(E39). 초가 있으면 정확값, 없으면 "약". `ended`·`unknown`은 원문 병치 — `운행종료`는 차량 잠금
 * 국면에 도달하지 않고(vehId 부재), 미지 모양은 잘못 옮기는 것보다 원문이 낫다.
 */
private fun busArrivalPart(isEn: Boolean, message: TransitLabel): TransitTextLine? {
    fun ui(key: String, args: List<String> = emptyList()) = TransitTextLine(listOf(TransitTextPart.key(key, args)), uiLang(isEn))

    // 미지·범위 밖은 원문 병치. ⚠ **ko 원문의 잔여 꼬리는 뗀다** — 잔여 조각이 같은 수를 이미 말하므로 그대로 실으면
    // "2정거장 전, 3분후[2번째 전]"이 된다(a11y 감사 2026-09-12).
    fun raw(): TransitTextLine? =
        rawArrivalPart(isEn, TransitLabel(ARRMSG_TAIL.replace(message.ko, "").trimSwiftWhitespaces(), message.en))

    return when (val kind = parseBusArrmsgKind(message.ko)) {
        BusArrmsgKind.Soon -> ui("busSoon")
        BusArrmsgKind.Waiting -> ui("busNotDeparted")
        BusArrmsgKind.Turning -> ui("busTurning")
        is BusArrmsgKind.Eta -> {
            // 범위 검증은 웹 `busArrivalPart`·en 투영과 **같은 판정**이다(갈리면 한 원문을 셋이 달리 읽는다).
            val minutes = kind.minutes
            val seconds = kind.seconds
            if (minutes != null && minutes < 0) return raw()
            if (seconds != null && (seconds < 0 || seconds > 59)) return raw()
            val min = minutes?.takeIf { it > 0 }
            val sec = seconds?.takeIf { it > 0 }
            when {
                min != null && sec != null -> ui("busEtaMinSec", listOf(min.toString(), sec.toString()))
                min != null -> ui("busEtaMin", listOf(min.toString()))
                sec != null -> ui("busEtaSec", listOf(sec.toString()))
                // 분·초가 둘 다 0 — 담을 값이 없다(en 투영과 같은 판정).
                else -> null
            }
        }
        BusArrmsgKind.Ended, BusArrmsgKind.Unknown -> raw()
    }
}

/**
 * 지하철: 승차 중은 A27 문장, 승차 대기는 종전 프레임("{stop}에 {message}"). 승차 국면 판정은 `subwayRidingMessage`가 정본이고
 * 여기서는 그 결과를 i18n 키로 옮기기만 한다 — 판정을 여기에 다시 쓰면 정본 함수의 호출자가 0이 되어 공유 fixture만 초록인 채
 * 실제 문장이 따라오지 않는 드리프트 경로가 생긴다.
 */
private fun subwayArrivalPart(
    isEn: Boolean,
    leg: TransitDisplayLeg,
    message: TransitLabel,
    arrivalCode: String?,
    phase: TransitStatusPhase,
): TransitTextLine? {
    if (phase == TransitStatusPhase.boarding) return transitApproachFrameLine(isEn, leg, message)
    return when (val riding = subwayRidingMessage(arrivalCode)) {
        SubwayRidingMessage.Omit -> null
        is SubwayRidingMessage.Key -> makeLine(isEn, riding.key, listOf(leg.alight)) { it }
        SubwayRidingMessage.Raw -> rawArrivalPart(isEn, message)
    }
}

/** 원문 병치(틀 없이) — 비어 있으면 조각 없음. */
private fun rawArrivalPart(isEn: Boolean, message: TransitLabel): TransitTextLine? {
    val picked = transitPickLabels(isEn, listOf(message))
    if (picked.values[0].isEmpty()) return null
    return TransitTextLine(listOf(TransitTextPart.text(picked.values[0])), picked.lang)
}

/**
 * 승차 대기·승차 중 상태 문장의 **도착 조각**(E39) — 잔여와 도착 서술을 한 줄 두 조각으로 낸다. 렌더가 조각을 쉼표로 이으므로
 * "남은 정거장 3개, 다음 역 서대문." 한 문장이 된다.
 *
 * ⚠ `phase`에 기본값을 두지 않는다 — 같은 잔여 수가 대기에서는 "버스가 여기 오기까지"이고 승차 중에는 "내릴 곳까지"라 낱말이
 * 갈린다.
 */
fun transitArrivalStatusLine(
    isEn: Boolean,
    leg: TransitDisplayLeg,
    message: TransitLabel?,
    arrivalCode: String?,
    remaining: Int?,
    phase: TransitStatusPhase,
): TransitTextLine {
    val arrival: TransitTextLine? = message?.let {
        if (leg.mode == "bus") busArrivalPart(isEn, it) else subwayArrivalPart(isEn, leg, it, arrivalCode, phase)
    }
    // 지하철 승차 대기는 잔여를 말하지 않는다(종전 계약 — 원문 프레임이 승차 정류소를 말한다).
    // ⚠ 승차 대기의 잔여 0은 조각을 만들지 않는다 — "0정거장 전"은 한국어가 아니고, 그 상태는 도착 조각("곧 도착")이 이미
    // 말한다. 승차 중의 0은 종전대로(하차 구간 진입).
    if (remaining == null || !(phase == TransitStatusPhase.riding || (leg.mode == "bus" && remaining > 0))) {
        return arrival ?: omitLine
    }
    val count = remaining.toString()
    if (arrival == null) {
        val only = if (phase == TransitStatusPhase.boarding) "stopsAwayOnly" else "remainingCount"
        return TransitTextLine(listOf(TransitTextPart.key(only, listOf(count))), uiLang(isEn))
    }
    val joinKey = if (phase == TransitStatusPhase.boarding) "stopsAway" else "remainingCountJoin"
    return TransitTextLine(listOf(TransitTextPart.key(joinKey, listOf(count))) + arrival.parts, arrival.lang)
}

// MARK: - 이벤트 통지

fun transitVehicleSelectedLine(isEn: Boolean, leg: TransitDisplayLeg, desc: TransitLabel?): TransitTextLine =
    makeLine(isEn, "vehicleSelected", listOf(desc ?: leg.line, leg.board)) { it }

fun transitSelectedVehicleLine(isEn: Boolean, desc: TransitLabel): TransitTextLine =
    makeLine(isEn, "selectedVehicle", listOf(desc)) { it }

fun transitVehiclePassedLine(isEn: Boolean, leg: TransitDisplayLeg): TransitTextLine =
    makeLine(isEn, "vehiclePassed", listOf(leg.board)) { it }

fun transitArrivedAtBoardStopLine(isEn: Boolean, leg: TransitDisplayLeg): TransitTextLine =
    makeLine(isEn, modeKey(leg, "arrivedAtBoardStop"), listOf(leg.line)) { it }

/** A41: 서울버스 "곧 도착"(잔여 0) 승차 임박 — 승격 없이 "{line} 곧 도착합니다." */
fun transitArrivingAtBoardStopLine(isEn: Boolean, leg: TransitDisplayLeg): TransitTextLine =
    makeLine(isEn, modeKey(leg, "arrivingAtBoardStop"), listOf(leg.line)) { it }

/**
 * 탑승 통지(E41) — 노선·하차역·정거장 수는 착지가 앉는 상태 문장이 그대로 말하므로 한 문장이다.
 * ⚠ A41 인계 기각: `departed`에 관측 서술("{노선} 출발")을 넣지 않는다 — 사용자에게 일어난 일은 탑승이지 버스의 출발이 아니다.
 */
fun transitBoardedLine(isEn: Boolean): TransitTextLine = TransitTextLine(listOf(TransitTextPart.key("boarded")), uiLang(isEn))

/**
 * 하차역 조각(E41 a11y 감사 반영) — **자동 승격에만 붙는다.** `boarding → riding`은 착지 대상이 아니라 스크린 리더가 상태
 * 문장을 다시 읽지 않으므로 통지가 하차역의 유일한 채널이다. 사용자가 버튼으로 선언한 승차는 상태 문장에 착지하므로 붙이지 않는다.
 */
fun transitBoardedAlightLine(isEn: Boolean, leg: TransitDisplayLeg): TransitTextLine =
    makeLine(isEn, "boardedAlight", listOf(leg.alight)) { it }

fun transitCurrentStationLine(isEn: Boolean, location: TransitLabel): TransitTextLine =
    makeLine(isEn, "currentStation", listOf(location)) { it }

// MARK: - 대기 후보 목록

/**
 * 후보 한 줄의 조각들. 줄 원자성은 **줄 단위**라 조각 하나라도 영문이 없으면 줄 전체가 ko다.
 * ⚠ 조각 순서가 곧 낭독 순서다. 빈 조각은 제거되어 구분자가 겹치지 않는다.
 */
fun transitCandidateDescLine(
    isEn: Boolean,
    leg: TransitDisplayLeg,
    item: TransitDisplayItem,
    express: TransitExpressVerdict?,
    departedMinutes: Int?,
): TransitTextLine {
    val labels = ArrayList<TransitLabel>()
    item.destination?.let { labels.add(it) }
    labels.add(item.direction)
    labels.add(item.message)
    // 급행 조각(A16 L1): unknown → "정차 여부 확인 필요", stops → "정차". skips는 조각 없음(차단 행의 사유 줄이 말한다).
    val expressKey = when (express) {
        TransitExpressVerdict.unknown -> "expressCheck"
        TransitExpressVerdict.stops -> "expressStopsAt"
        TransitExpressVerdict.skips, null -> null
    }
    if (expressKey != null) labels.add(leg.alight)
    val picked = transitPickLabels(isEn, labels)
    var i = 0
    val parts = ArrayList<TransitTextPart>()
    if (item.destination != null) parts.add(TransitTextPart.key("bound", listOf(picked.values[i++])))
    val direction = picked.values[i++]
    if (direction.isNotEmpty()) parts.add(TransitTextPart.text(direction))
    val message = picked.values[i++]
    if (message.isNotEmpty()) parts.add(TransitTextPart.text(message))
    if (expressKey != null) parts.add(TransitTextPart.key(expressKey, listOf(picked.values[i])))
    if (departedMinutes != null) parts.add(TransitTextPart.key("departed", listOf(departedMinutes.toString())))
    return TransitTextLine(parts, picked.lang)
}

/** 선택한 차량의 **안정 조각만**으로 만든 설명(행선·방향) — 완성 문장은 폴마다 바뀌므로 넣지 않는다. */
fun transitVehicleDescLine(isEn: Boolean, item: TransitDisplayItem): TransitTextLine {
    val labels = listOfNotNull(item.destination) + item.direction
    val picked = transitPickLabels(isEn, labels)
    val parts = ArrayList<TransitTextPart>()
    var i = 0
    if (item.destination != null) parts.add(TransitTextPart.key("bound", listOf(picked.values[i++])))
    val direction = picked.values[i]
    if (direction.isNotEmpty()) parts.add(TransitTextPart.text(direction))
    return TransitTextLine(parts, picked.lang)
}

/** 급행이 하차역에 서지 않는 후보의 사유 줄(A16 L1 결정적 미도달, 차단 행). */
fun transitExpressSkipsAlightLine(isEn: Boolean, leg: TransitDisplayLeg): TransitTextLine =
    makeLine(isEn, "expressSkipsAlight", listOf(leg.alight)) { it }

/**
 * 급행 선언 근사 잠금의 승차 상시 표시(§6, 웹 `expressStatusLine` 미러) — 답한 직후의 침묵이 "확인됨"으로 읽히지 않게 판정을
 * 말한다. 기존 키 재사용(`stops` → expressStopsAt, 그 밖 → expressCheck).
 */
fun transitExpressStatusLine(isEn: Boolean, leg: TransitDisplayLeg, verdict: TransitExpressVerdict?): TransitTextLine =
    makeLine(isEn, if (verdict == TransitExpressVerdict.stops) "expressStopsAt" else "expressCheck", listOf(leg.alight)) { it }

/**
 * 하차 출구 방면(E25) — 확정 도착 통지(`sentence`: 마침표 있는 문장 키, 공백 연결 채널)·하차역 행(쉼표 연결, 마침표 없음)에 병기.
 * 통지 채널의 다른 조각은 마침표를 가지므로 마침표 없는 키를 쓰면 "3번 출구 방면 다음: …"으로 이어져 읽힌다(a11y 감사 2026-09-02).
 */
fun transitExitBoundLine(isEn: Boolean, exit: String, sentence: Boolean = false): TransitTextLine =
    TransitTextLine(listOf(TransitTextPart.key(if (sentence) "exitBoundSentence" else "exitBound", listOf(exit))), uiLang(isEn))

fun transitTerminatesEarlyLine(isEn: Boolean, leg: TransitDisplayLeg, item: TransitDisplayItem): TransitTextLine =
    makeLine(isEn, "terminatesEarly", listOf(item.destination ?: TransitLabel(""), leg.alight)) { it }

// MARK: - 경유 목록·조망

/** 경유 정류소 한 줄 — 이름 + 승차·하차·현재 위치 표식(표식은 UI 라벨이라 인자가 없다). */
fun transitViaStopLine(isEn: Boolean, stop: TransitLabel, role: String, here: Boolean, exit: String? = null): TransitTextLine {
    val picked = transitPickLabels(isEn, listOf(stop))
    val parts = mutableListOf(TransitTextPart.text(picked.values[0]))
    if (role == "board") {
        parts.add(TransitTextPart.key("viaBoard"))
    } else if (role == "alight") {
        parts.add(TransitTextPart.key("viaAlight"))
    }
    if (here) parts.add(TransitTextPart.key("viaCurrent"))
    // 하차역 행에 출구 번호 병기(E25) — 하차 역할에만.
    if (role == "alight" && !exit.isNullOrEmpty()) parts.add(TransitTextPart.key("exitBound", listOf(exit)))
    return TransitTextLine(parts, picked.lang)
}

fun transitOverviewLegLine(isEn: Boolean, n: Int, line: TransitLabel, board: TransitLabel, alight: TransitLabel): TransitTextLine =
    makeLine(isEn, "overviewLeg", listOf(line, board, alight)) { listOf(n.toString(), it[0], it[1], it[2]) }

// MARK: - 승차 전 도보(A25)

fun transitPrewalkStartLine(isEn: Boolean, station: TransitLabel, minutes: Int): TransitTextLine =
    makeLine(isEn, "prewalkStart", listOf(station)) { listOf(it[0], minutes.toString()) }

fun transitPrewalkArrivedLine(isEn: Boolean, station: TransitLabel): TransitTextLine =
    makeLine(isEn, "prewalkArrived", listOf(station)) { it }

fun transitPrewalkArrivedButtonLine(isEn: Boolean, station: TransitLabel): TransitTextLine =
    makeLine(isEn, "prewalkArrivedButton", listOf(station)) { it }

// MARK: - 역 상세 열기(E33)

/** 상태 문장 로터 액션 "{역} 상세 보기". 판정은 다른 descriptor와 같다 — 영문이 없으면 `lang: "ko"`. */
fun transitOpenStationLine(isEn: Boolean, station: TransitLabel): TransitTextLine =
    makeLine(isEn, "openStation", listOf(station)) { it }

/** descriptor가 낼 수 있는 전체 키 — 앱 리터럴 분기 망라성 대조 축(spec §5.2). */
val transitTextKeys: List<String> = listOf(
    "waitContext", "waitContextBus", "waitContextWalk", "waitContextWalkBus",
    "boardingContext", "boardingContextBus", "context", "contextBus",
    "subwayNextStop", "subwayArriving", "subwayAtStop", "subwayDeparted",
    "remainingCount", "remainingCountJoin", "stopsAway", "stopsAwayOnly",
    "busEtaMinSec", "busEtaMin", "busEtaSec", "busSoon", "busNotDeparted", "busTurning",
    "approachFrame", "vehicleSelected", "selectedVehicle", "vehiclePassed",
    "arrivedAtBoardStop", "arrivedAtBoardStopBus", "arrivingAtBoardStop", "arrivingAtBoardStopBus",
    "boarded", "boardedAlight", "currentStation",
    "bound", "expressCheck", "expressStopsAt", "expressSkipsAlight", "exitBound", "exitBoundSentence", "departed", "terminatesEarly",
    "viaBoard", "viaAlight", "viaCurrent", "overviewLeg",
    "prewalkStart", "prewalkArrived", "prewalkArrivedButton",
    "openStation",
)
