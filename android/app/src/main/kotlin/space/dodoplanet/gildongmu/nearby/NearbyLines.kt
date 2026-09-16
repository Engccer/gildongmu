package space.dodoplanet.gildongmu.nearby

import androidx.annotation.StringRes
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.kit.ManualLocation
import space.dodoplanet.gildongmu.kit.models.BikeStation
import space.dodoplanet.gildongmu.kit.models.BusArrival
import space.dodoplanet.gildongmu.kit.models.BusStop
import space.dodoplanet.gildongmu.kit.models.NearestSubwayStation
import space.dodoplanet.gildongmu.kit.models.SubwayArrival
import space.dodoplanet.gildongmu.kit.SubwayArrivalPlan
import space.dodoplanet.gildongmu.kit.SubwayArrivalSegment
import space.dodoplanet.gildongmu.kit.models.SurroundingPlace
import space.dodoplanet.gildongmu.kit.TransitDisplay
import space.dodoplanet.gildongmu.kit.bilingualName
import space.dodoplanet.gildongmu.kit.formatDistance
import space.dodoplanet.gildongmu.kit.joinText
import space.dodoplanet.gildongmu.kit.pickCategory
import space.dodoplanet.gildongmu.kit.subwayArrivalPlanStation
import space.dodoplanet.gildongmu.kit.subwayArrivalProse
import space.dodoplanet.gildongmu.kit.subwayArrivalProseSegments
import space.dodoplanet.gildongmu.kit.subwayShowsCurrentLocationTail

// 내 주변 문장 조립(iOS Nearby/*View.swift의 파일 함수 이식). 한 줄 = 한 접근성 객체: 시각 `visual`, 낭독 `spoken`(비-ko 병기는
// 시각 `Roman (한글)`, 낭독은 로마자만 — E28 판정 ③). 리소스 문장은 람다로 받는다(JVM 테스트 가능, `appLocalized` 호출부는 화면).

/**
 * 둘러보기가 수동 좌표로 조회됐는가(spec §13-4) — 위치 문장과 완료 통지가 **같은 술어**를 쓴다(iOS `AroundNearbyView` 동형: 수동 위치일 때
 * "현재 위치"라고 알리지 않는다). 정확 비교: 수동이면 `EffectiveLocation.coordinate()`가 그 좌표를 그대로 돌려준다.
 */
fun usedManualCoordinate(payload: AroundPayload, manual: ManualLocation?): Boolean =
    manual != null && payload.lat == manual.lat && payload.lng == manual.lng

/** 둘러보기 위치 문장 리소스(수동 × 장소 유무 4분기). 리터럴 ID만 — 동적 키 조립 없음(가드). */
@StringRes
fun aroundHereResId(payload: AroundPayload, manual: ManualLocation?, hasPlace: Boolean): Int =
    if (usedManualCoordinate(payload, manual)) {
        if (hasPlace) R.string.android_nearby_aroundHereManual else R.string.android_nearby_aroundHereManualNoPlace
    } else {
        if (hasPlace) R.string.android_nearby_aroundHere else R.string.android_nearby_aroundHereNoPlace
    }

data class LineText(val visual: String, val spoken: String)

/** 앵커 화면 제목: 기본 제목에 기준 장소명을 쉼표로 흡수. 현재 위치 화면(anchor null)은 기본 제목 그대로. */
fun nearbyTitle(base: String, anchor: PlaceAnchor?, lang: String): String =
    joinText(base, anchor?.let { bilingualName(lang, it.name, en = null, roman = it.nameRoman).primary })

/** 역 헤딩 조각 — 역명·노선이 **둘 다** 영문일 때만 영어(한 줄 안 언어 혼합 금지, E27). 영문이 모자라면 둘 다 한국어. */
fun subwayStationLine(isEn: Boolean, lang: String, stationName: String, nameEn: String?, lines: List<String>, linesEn: List<String>?): LineText {
    val ko = joinText(stationName, if (lines.isEmpty()) null else lines.joinToString(", "))
    val linesReady: List<String>? = if (lines.isEmpty()) emptyList() else linesEn
    if (!isEn || nameEn.isNullOrEmpty() || linesReady == null) return LineText(ko, ko)
    val b = bilingualName(lang, ko = stationName, en = nameEn, roman = null)
    val linesText = if (linesReady.isEmpty()) null else linesReady.joinToString(", ")
    return LineText(joinText(b.display, linesText), joinText(b.primary, linesText))
}

/** 최근접 역 낭독 라벨(통지·빈 문구가 **같은 문구**를 쓴다). */
fun nearestLabel(station: NearestSubwayStation, isEn: Boolean, lang: String): String =
    subwayStationLine(isEn, lang, station.stationName, station.nameEn, station.lines, station.linesEn).spoken

/**
 * 도착 문장 조각 키 → 리소스. 키 선택은 :kit(`subwayArrivalProseSegments`, 공유 fixture가 웹과 잠근다)이고 여기서는 **리터럴 `when`으로
 * 조회만** 한다 — 보간 조립은 누락 린터가 못 본다. 미매핑은 null(호출부가 디버그에서 즉시 드러내고 릴리스는 키를 노출해 침묵을 피한다).
 */
fun subwayArrivalSegmentResId(key: String): Int? = when (key) {
    "approaching" -> R.string.subwayArrival_approaching
    "arrived" -> R.string.subwayArrival_arrived
    "departed" -> R.string.subwayArrival_departed
    "prevApproaching" -> R.string.subwayArrival_prevApproaching
    "prevArrived" -> R.string.subwayArrival_prevArrived
    "prevDeparted" -> R.string.subwayArrival_prevDeparted
    "departedStopsBack" -> R.string.subwayArrival_departedStopsBack
    "stopsAway" -> R.string.subwayArrival_stopsAway
    "stopsJoin" -> R.string.subwayArrival_stopsJoin
    "etaMin" -> R.string.subwayArrival_etaMin
    "etaMinSec" -> R.string.subwayArrival_etaMinSec
    "etaSec" -> R.string.subwayArrival_etaSec
    "nowAt" -> R.string.subwayArrival_nowAt
    else -> null
}

/** 계획 → 문장(한 객체 안의 한 조각). `joined`는 쉼표로, `tail`은 공백으로 잇는다. */
private fun subwayArrivalProseText(plan: SubwayArrivalPlan, station: String?, segmentText: (SubwayArrivalSegment) -> String): String {
    val segs = subwayArrivalProseSegments(plan, station)
    val body = segs.joined.joinToString(", ") { segmentText(it) }
    val tail = segs.tail ?: return body
    return "$body ${segmentText(tail)}"
}

/**
 * 도착 한 건 = 한 접근성 객체(iOS `subwayArrivalLine` 이식). 서버 영문(E27) 조각이 **전부** 있을 때만 영어이고, 하나라도 없으면
 * 한 건 전체가 한국어. 메시지 자리는 완성 문장을 읽어 쓴 우리 문장(E37)이고, 알아보지 못한 문장만 원문 + A32 꼬리.
 */
fun subwayArrivalLine(
    arrival: SubwayArrival,
    isEn: Boolean,
    segmentText: (SubwayArrivalSegment) -> String,
    expressLabel: String,
    currentLocationTail: (String) -> String,
): String {
    val express = if (arrival.express) expressLabel else null
    // 노선 미매핑(`line` null)은 ko도 그 조각이 없으므로 영문 요구 대상이 아니다("" 자리 표시).
    val headEnParts: List<String?> = listOf(if (arrival.line == null) "" else arrival.lineEn, arrival.directionEn, arrival.trainLineNmEn)

    val plan = subwayArrivalProse(arrival.message, arrival.currentLocation)
    if (plan != null) {
        val koStation = subwayArrivalPlanStation(plan)
        val station = if (isEn) arrival.currentLocationEn else koStation
        val headReady = !isEn || headEnParts.all { it != null }
        if (headReady && (koStation == null || station != null)) {
            val prose = subwayArrivalProseText(plan, station, segmentText)
            return TransitDisplay.pickLine(
                isEn = isEn,
                ko = joinText(arrival.line, express, arrival.trainLineNm, prose),
                enParts = headEnParts,
            ) { p -> joinText((if (p[0].isEmpty()) "" else "${p[0]} ") + p[1], express, p[2], prose) }
        }
    }

    // 원문 경로. A38: 영문 자리의 결측은 영문 값 자신으로 가른다 — 있으면 그 값, 없고 ko도 없으면 자리 표시 "", 없는데 ko는 있으면 결측.
    val enLoc: String? = arrival.currentLocationEn ?: if (arrival.currentLocation == null) "" else null
    val koTail = subwayShowsCurrentLocationTail(arrival.message, arrival.currentLocation)
    val enTail = subwayShowsCurrentLocationTail(arrival.messageEn, enLoc)
    val ko = joinText(
        arrival.line, express, arrival.trainLineNm, arrival.message,
        if (koTail) arrival.currentLocation?.let(currentLocationTail) else null,
    )
    return TransitDisplay.pickLine(
        isEn = isEn,
        ko = ko,
        enParts = headEnParts + listOf(arrival.messageEn, enLoc),
    ) { p -> joinText((if (p[0].isEmpty()) "" else "${p[0]} ") + p[1], express, p[2], p[3], if (enTail) currentLocationTail(p[4]) else null) }
}

/** 정류소 헤딩: 이름(병기) + 표지판 번호 + 거리. */
fun busStopHeading(stop: BusStop, lang: String): LineText {
    val name = bilingualName(lang, stop.name, en = null, roman = stop.nameRoman)
    val rest = joinText(stop.stopNo, formatDistance(stop.distanceMeters))
    return LineText(joinText(name.display, rest), joinText(name.primary, rest))
}

/** 버스 도착 한 줄. 저상은 교통약자 정본이라 텍스트로 흡수. 서울 완성 문장이 있으면 그대로, 없으면(TAGO) 슬롯 조합. */
fun busArrivalLine(
    arrival: BusArrival,
    routeNo: (String) -> String,
    lowFloorLabel: String,
    stopsBefore: (Int) -> String,
    minutesAway: (String) -> String,
): String {
    val lowFloor = if (arrival.lowFloor) lowFloorLabel else null
    val message = arrival.arrivalMessage
    if (!message.isNullOrEmpty()) return joinText(routeNo(arrival.routeNo), arrival.routeType, lowFloor, message)
    return joinText(
        routeNo(arrival.routeNo), arrival.routeType, lowFloor,
        stopsBefore(arrival.prevStationCount), minutesAway(maxOf(1, arrival.arrivalSeconds / 60).toString()),
    )
}

/** 대여소 한 줄(헤딩 없음 — 한 줄에 전부 흡수). */
fun bikeLine(station: BikeStation, lang: String, bikesAvailable: (Int) -> String, racksTotal: (Int) -> String): LineText {
    val name = bilingualName(lang, station.name, en = null, roman = station.nameRoman)
    val rest = joinText(formatDistance(station.distanceMeters), bikesAvailable(station.bikesAvailable), racksTotal(station.racksTotal))
    return LineText(joinText(name.display, rest), joinText(name.primary, rest))
}

/** 소문자 8방위 → "{방위}쪽". 미지 값은 생략(null). ⚠ 북 기준 절대 방위만(heading 없음). */
fun bearingLabel(bearing: String, direction: (String) -> String?, suffixed: (String) -> String): String? {
    if (bearing !in setOf("n", "ne", "e", "se", "s", "sw", "w", "nw")) return null
    return direction(bearing)?.let(suffixed)
}

/** 둘러보기 장소 행 보조 줄: 분류 마지막 조각 · 방위 · 거리. */
fun aroundSecondary(
    place: SurroundingPlace,
    lang: String,
    direction: (String) -> String?,
    suffixed: (String) -> String,
    distance: (String) -> String,
): String {
    val category = pickCategory(lang, place.categoryRaw, place.categoryEn).split(" > ").last()
    return joinText(category, bearingLabel(place.bearing, direction, suffixed), distance(formatDistance(place.distanceMeters)))
}
