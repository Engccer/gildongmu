package space.dodoplanet.gildongmu.place

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.a11y.BodyLine
import space.dodoplanet.gildongmu.a11y.HeadingLine
import space.dodoplanet.gildongmu.i18n.AppLocale
import space.dodoplanet.gildongmu.i18n.appLocalized
import space.dodoplanet.gildongmu.kit.joinText
import space.dodoplanet.gildongmu.nearby.subwayArrivalText

// 코드→문구 표(리터럴 `when`, 동적 키 조립 금지). 미지 값: kind·dailyType·direction은 원문, operating은 조각 생략, compass는 서버 문장 폴백(spec §12 머리 표).

internal fun metroKindResId(kind: String) = when (kind) {
    "elevator" -> R.string.subway_kind_elevator
    "escalator" -> R.string.subway_kind_escalator
    "wheelchairLift" -> R.string.subway_kind_wheelchairLift
    "movingWalk" -> R.string.subway_kind_movingWalk
    "wheelchairCharger" -> R.string.subway_kind_wheelchairCharger
    "safetyPlatform" -> R.string.subway_kind_safetyPlatform
    "signLangPhone" -> R.string.subway_kind_signLangPhone
    "helper" -> R.string.subway_kind_helper
    "restroom" -> R.string.subway_kind_restroom
    "voiceGuide" -> R.string.subway_kind_voiceGuide
    "elevatorLocation" -> R.string.subway_kind_elevatorLocation
    else -> null
}

internal fun dailyTypeResId(t: String) = when (t) {
    "weekday" -> R.string.timetable_dailyType_weekday
    "saturday" -> R.string.timetable_dailyType_saturday
    "sunday" -> R.string.timetable_dailyType_sunday
    else -> null
}

internal fun directionResId(d: String) = when (d) {
    "up" -> R.string.timetable_direction_up
    "down" -> R.string.timetable_direction_down
    else -> null
}

internal fun operatingResId(s: String?) = when (s) {
    "normal" -> R.string.android_station_operatingNormal
    "stopped" -> R.string.android_station_operatingStopped
    else -> null
}

internal fun compassResId(code: String) = when (code) {
    "n" -> R.string.subway_direction_n
    "ne" -> R.string.subway_direction_ne
    "e" -> R.string.subway_direction_e
    "se" -> R.string.subway_direction_se
    "s" -> R.string.subway_direction_s
    "sw" -> R.string.subway_direction_sw
    "w" -> R.string.subway_direction_w
    "nw" -> R.string.subway_direction_nw
    else -> null
}

/**
 * 역 자동 섹션 5종(iOS `StationSectionsView`, spec §12-3): meta → arrivals → timetable → korail → metro. 자동 등장 보조 정보라 로딩 표시·통지
 * 없음(조용히 나타남), 각 섹션 헤딩이 유일한 발견 경로. 실패·null은 그 섹션만 없음(시간표 실패만 문장).
 */
@Composable
fun StationSectionsView(s: StationSections) {
    val res = LocalContext.current.resources
    val lang = AppLocale.current(res)
    val isEn = AppLocale.dataLocale(res) == "en"

    s.meta?.let { m ->
        HeadingLine(stringResource(R.string.stationMeta_heading), "station-meta")
        val line = stationMetaLine(m, lang, isEn, { appLocalized(res, R.string.android_station_nameSuffixed, it) }, stringResource(R.string.stationMeta_transfer))
        BodyLine(line.visual, "station-meta-line", line.spoken.takeIf { it != line.visual })
    }

    s.arrivals?.let { a ->
        HeadingLine(stringResource(R.string.android_station_arrivalHeading), "station-arrivals")
        if (a.arrivals.isEmpty()) BodyLine(stringResource(R.string.android_station_noArrivals), "station-arrivals-none") // 성공의 0건은 문장으로(3-state)
        else a.arrivals.forEachIndexed { i, arrival -> BodyLine(subwayArrivalText(res, isEn, arrival), "station-arrival-$i") }
    }

    when (val t = s.timetable) {
        TimetableState.Hidden -> Unit
        TimetableState.Error -> {
            HeadingLine(stringResource(R.string.timetable_heading), "timetable")
            BodyLine(stringResource(R.string.timetable_error), "timetable-error")
        }
        is TimetableState.Done -> {
            HeadingLine(stringResource(R.string.timetable_heading), "timetable")
            val tt = t.timetable
            BodyLine(joinText(dailyTypeResId(tt.dailyType)?.let { stringResource(it) } ?: tt.dailyType, if (tt.partial == true) stringResource(R.string.timetable_partial) else null), "timetable-daily")
            val suffixed = { core: String -> appLocalized(res, R.string.timetable_lineSuffixed, core) }
            val first = stringResource(R.string.timetable_first)
            val last = stringResource(R.string.timetable_last)
            val nextDay = stringResource(R.string.timetable_nextDay)
            val toTerminus = { t2: String -> appLocalized(res, R.string.timetable_toTerminus, t2) }
            for ((li, line) in tt.lines.withIndex()) {
                // 매칭된 노선은 전부 온다(A19). ok만 방향 행이고 나머지는 왜 없는지를 노선명과 함께 한 줄로.
                val cov = coverageText(line, { lineDisplayName(it, isEn, suffixed) }, { appLocalized(res, R.string.timetable_coverage_noTrains, it) }, { appLocalized(res, R.string.timetable_coverage_unavailable, it) }) { appLocalized(res, R.string.timetable_coverage_unknown, it) }
                if (cov != null) {
                    BodyLine(cov, "timetable-$li")
                    continue
                }
                for ((di, d) in line.directions.withIndex()) {
                    val enName = timetableLineEnName(line, d, isEn)
                    val en = enName != null
                    val name = enName ?: lineKoName(line, suffixed)
                    val direction = directionResId(d.direction)?.let { stringResource(it) } ?: d.direction
                    BodyLine(joinText("$name $direction", "$first ${trainText(d.first, en, nextDay, toTerminus)}", "$last ${trainText(d.last, en, nextDay, toTerminus)}"), "timetable-$li-$di")
                }
            }
        }
    }

    s.korail?.let { f ->
        HeadingLine(stringResource(R.string.android_station_railFacilities), "korail")
        val count = { label: String, n: Int? -> countText(label, n, { appLocalized(res, R.string.android_station_countUnknown, it) }, { appLocalized(res, R.string.android_station_countNone, it) }) { l, c -> appLocalized(res, R.string.android_station_countSome, l, c) } }
        BodyLine(stringResource(if (f.accessibleToilet) R.string.android_station_accessibleToiletYes else R.string.android_station_accessibleToiletNo), "korail-toilet")
        BodyLine(count(stringResource(R.string.station_wheelchairLifts), f.wheelchairLifts), "korail-lifts")
        BodyLine(stringResource(if (f.accessibleSlope) R.string.android_station_accessibleSlopeYes else R.string.android_station_accessibleSlopeNo), "korail-slope")
        BodyLine(count(stringResource(R.string.station_elevators), f.elevators), "korail-elevators")
    }

    s.metro?.let { f ->
        HeadingLine(stringResource(R.string.android_station_seoulFacilities), "metro")
        val wheelchairAccessible = stringResource(R.string.subway_wheelchairAccessible)
        for ((gi, g) in f.groups.withIndex()) {
            val kindLabel = metroKindResId(g.kind)?.let { stringResource(it) } ?: g.kind
            BodyLine(appLocalized(res, R.string.android_station_kindCount, kindLabel, g.facilities.size), "metro-$gi")
            g.facilities.forEachIndexed { i, fac ->
                val name = facilityName(fac, { compassResId(it)?.let { id -> res.getString(id) } }, { d, dist -> appLocalized(res, R.string.subway_elevatorAt, d, dist) }) { appLocalized(res, R.string.subway_lineNumber, it) }
                BodyLine(joinText(name, fac.location, fac.floors, operatingResId(fac.operatingStatus)?.let { res.getString(it) }, facilityDetail(fac, wheelchairAccessible)), "metro-$gi-$i")
            }
        }
        // 보강 소스 실패는 은폐하지 않고 문장으로 병기; 음성유도기 데이터 기준일 고지(정적 seed).
        if (f.supplementFailed == true) BodyLine(stringResource(R.string.subway_supplementFailed), "metro-supplement")
        if (f.groups.any { it.kind == "voiceGuide" }) BodyLine(stringResource(R.string.subway_voiceGuideSource), "metro-voice")
    }
}
