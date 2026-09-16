package space.dodoplanet.gildongmu.place

import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import space.dodoplanet.gildongmu.kit.StationService
import space.dodoplanet.gildongmu.kit.TransitDisplay
import space.dodoplanet.gildongmu.kit.bilingualName
import space.dodoplanet.gildongmu.kit.formatDistance
import space.dodoplanet.gildongmu.kit.joinText
import space.dodoplanet.gildongmu.kit.models.SeoulMetroFacilities
import space.dodoplanet.gildongmu.kit.models.SeoulMetroFacility
import space.dodoplanet.gildongmu.kit.models.StationArrivals
import space.dodoplanet.gildongmu.kit.models.StationFacilities
import space.dodoplanet.gildongmu.kit.models.StationMeta
import space.dodoplanet.gildongmu.kit.models.StationTimetable
import space.dodoplanet.gildongmu.kit.models.TimetableDirection
import space.dodoplanet.gildongmu.kit.models.TimetableLine
import space.dodoplanet.gildongmu.kit.models.TimetableTrain
import space.dodoplanet.gildongmu.nearby.LineText
import space.dodoplanet.gildongmu.net.settled

// 역 자동 섹션 5종의 상태·문장(iOS `StationSections.swift` 이식, spec §12-3). 리소스는 람다·낱말 주입(JVM 검증).

/** 시간표만 3-state를 보존한다(spec 판정 27): 미커버(null)=미노출 ≠ 조회 실패=문장 노출 ≠ 성공. */
sealed class TimetableState {
    data object Hidden : TimetableState()
    data object Error : TimetableState()
    data class Done(val timetable: StationTimetable) : TimetableState()
}

/** 5조각 한 커밋. 시간표 외 조각은 실패=null과 같다(그 섹션만 미노출). */
data class StationSections(
    val meta: StationMeta?,
    val arrivals: StationArrivals?,
    val timetable: TimetableState,
    val korail: StationFacilities?,
    val metro: SeoulMetroFacilities?,
)

/** 5개 병렬 로드 — 한 조각의 실패가 다른 조각을 안 죽인다(`settled`, 취소는 통과). */
suspend fun loadStationSections(service: StationService, station: String, dataLocale: String): StationSections = coroutineScope {
    val meta = async { settled { service.meta(station, dataLocale) } }
    val korail = async { settled { service.korailFacilities(station) } }
    val metro = async { settled { service.metroFacilities(station, dataLocale) } }
    val arrivals = async { settled { service.arrivals(station, dataLocale) } }
    val timetable = async { settled { service.timetable(station, dataLocale) } }
    val t = timetable.await()
    StationSections(
        meta = meta.await().getOrNull(),
        arrivals = arrivals.await().getOrNull(),
        timetable = if (t.isFailure) TimetableState.Error else t.getOrNull()?.let { TimetableState.Done(it) } ?: TimetableState.Hidden,
        korail = korail.await().getOrNull(),
        metro = metro.await().getOrNull(),
    )
}

/** 시설 수 3-state 문장: null="정보 없음" ≠ 0="없음" ≠ n="n대". 절대 뭉개지 않는다. */
fun countText(label: String, count: Int?, unknown: (String) -> String, none: (String) -> String, some: (String, Int) -> String): String {
    if (count == null) return unknown(label)
    return if (count == 0) none(label) else some(label, count)
}

/** 서버가 "선"을 떼어 준 노선(`lineCore`)은 접미를 앱 언어로 단다(A26). 노선명 자체는 원문 — 방향 행에 쓴다. */
fun lineKoName(line: TimetableLine, lineSuffixed: (String) -> String): String = line.lineCore?.let(lineSuffixed) ?: line.lineName

/** coverage 사유 줄의 노선명 — en 계열은 서버 영문(`lineNameEn`, E27) 우선, 없으면 접미 조립·원문. */
fun lineDisplayName(line: TimetableLine, isEn: Boolean, lineSuffixed: (String) -> String): String =
    if (isEn && line.lineNameEn != null) line.lineNameEn!! else lineKoName(line, lineSuffixed)

/** 종착이 없으면 영문이 필요 없고, 있으면 영문 종착이 있어야 영어 줄이 된다. */
fun terminusReady(train: TimetableTrain): Boolean = train.terminus.isEmpty() || train.terminusEn != null

/** 방향 행의 영어 노선명 — 노선 영문이 있고 첫차·막차 종착 자격이 다 갖춰질 때만(줄 단위 원자성, E27). 아니면 null(한국어 줄). */
fun timetableLineEnName(line: TimetableLine, direction: TimetableDirection, isEn: Boolean): String? =
    line.lineNameEn?.takeIf { isEn && terminusReady(direction.first) && terminusReady(direction.last) }

/**
 * 방향 행 대신 낼 coverage 문구. null이면 방향 행을 그린다(coverage "ok"). 구서버(coverage 없음)·필드 누락은 방향이 비면 가장 덜
 * 단정적인 "확인 불가"로(운행 없음으로 읽히지 않게), 미지의 값도 같다.
 */
fun coverageText(line: TimetableLine, lineDisplayName: (TimetableLine) -> String, noTrains: (String) -> String, unavailable: (String) -> String, unknown: (String) -> String): String? =
    when (line.coverage ?: (if (line.directions.isEmpty()) "unknown" else "ok")) {
        "ok" -> null
        "noTrains" -> noTrains(lineDisplayName(line))
        "unavailable" -> unavailable(lineDisplayName(line))
        else -> unknown(lineDisplayName(line))
    }

/** 첫차·막차 한 편성("00:42 왕십리행"·익일 접두·en 종착 폴백). 종착이 비면 시각만. */
fun trainText(train: TimetableTrain, en: Boolean, nextDay: String, toTerminus: (String) -> String): String {
    val time = if (train.nextDay == true) "$nextDay ${train.time}" else train.time
    val terminus = if (en) (train.terminusEn ?: train.terminus) else train.terminus
    return if (terminus.isEmpty()) time else "$time ${toTerminus(terminus)}"
}

/**
 * 서버 합성 한국어(`name`) 대신 구조화 조각(`parts`, A26)이 있으면 앱 언어로 조립한다. 방위가 표에 없으면(`compass` → null) 서버 문장 폴백.
 * 노선명은 서버 표(`lineEn`, E27)가 정본이고 앱 언어 접미 조립은 표 미스·ko 폴백이다.
 */
fun facilityName(f: SeoulMetroFacility, compass: (String) -> String?, elevatorAt: (direction: String, distance: String) -> String, lineNumber: (String) -> String): String {
    val p = f.parts ?: return f.name
    val c = p.compass
    val m = p.meters
    if (c != null && m != null) {
        val direction = compass(c)
        if (direction != null) return joinText(elevatorAt(direction, formatDistance(m)), p.dong)
    }
    val location = p.location ?: return f.name
    return joinText(location, p.lineEn ?: p.line?.let(lineNumber))
}

/** 상세 조각도 parts 우선(화장실 종류·휠체어 접근), 없을 때만 서버 `detail`. */
fun facilityDetail(f: SeoulMetroFacility, wheelchairAccessible: String): String? {
    val p = f.parts
    if (p != null && (p.restroomType != null || p.wheelchairAccessible == true)) {
        return joinText(p.restroomType, if (p.wheelchairAccessible == true) wheelchairAccessible else null)
    }
    return f.detail
}

/**
 * 역 메타 한 줄 — ko: `joinText(nameSuffixed(name), nameEn, tail)`, en: `joinText(bilingualName(name, en = nameEn).display, tail)`(낭독은 영문만).
 * `tail = joinText(노선(en이면 linesEn — 줄 단위 원자성), 환승?, 운영기관)`.
 */
fun stationMetaLine(meta: StationMeta, lang: String, isEn: Boolean, nameSuffixed: (String) -> String, transfer: String): LineText {
    val lines = TransitDisplay.pickLine(isEn = isEn, ko = meta.lines.joinToString(", "), enParts = listOf(meta.linesEn?.joinToString(", "))) { it[0] }
    val tail = joinText(lines, if (meta.isTransfer) transfer else null, meta.operatorName)
    if (!isEn) {
        val ko = joinText(nameSuffixed(meta.name), meta.nameEn, tail)
        return LineText(ko, ko)
    }
    val b = bilingualName(lang, meta.name, en = meta.nameEn, roman = null)
    return LineText(joinText(b.display, tail), joinText(b.primary, tail))
}
