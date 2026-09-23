package space.dodoplanet.gildongmu.place

import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.toMutableStateList
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.a11y.BodyLine
import space.dodoplanet.gildongmu.a11y.HeadingLine
import space.dodoplanet.gildongmu.directions.DisclosureRow
import space.dodoplanet.gildongmu.directions.resourceStrings
import space.dodoplanet.gildongmu.i18n.AppLocale
import space.dodoplanet.gildongmu.i18n.appLocalized
import space.dodoplanet.gildongmu.kit.joinText
import space.dodoplanet.gildongmu.kit.models.StationMeta
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
 * 역 정보 섹션(개편 전 모양, 제목 + 메타 한 줄 — iOS `StationMetaSection`) — 역 레이아웃이 아닌 장소 전용(E44 spec §3.1). 자동 등장 보조
 * 정보라 로딩 표시·통지 없음, 제목이 유일한 발견 경로. 역 레이아웃은 제목이 늘 서고 메타 줄만 [StationMetaText]로 싣는다.
 */
@Composable
fun StationMetaSection(s: StationSections) {
    s.meta?.let { m ->
        HeadingLine(stringResource(R.string.stationMeta_heading), "station-meta")
        StationMetaText(m)
    }
}

/** 역 메타 한 줄 — 한 줄=한 객체: 역명·영문명·노선·환승·운영기관. en 계열은 역명 병기(낭독은 영문만, a11y 감사 #3). */
@Composable
fun StationMetaText(m: StationMeta) {
    val res = LocalContext.current.resources
    val line = stationMetaLine(m, AppLocale.current(res), AppLocale.dataLocale(res) == "en", { appLocalized(res, R.string.android_station_nameSuffixed, it) }, stringResource(R.string.stationMeta_transfer))
    BodyLine(line.visual, "station-meta-line", line.spoken.takeIf { it != line.visual })
}

/**
 * 역 자동 섹션 — 실시간 도착 → 첫차 막차 → 교통약자 시설(철도) → 교통약자 시설(서울 지하철)(iOS `StationDetailSections`, spec §12-3). 자동 등장
 * 보조 정보라 로딩 표시·통지 없음(조용히 나타남), 각 섹션 헤딩이 유일한 발견 경로. 실패·null은 그 섹션만 없음(시간표 실패만 문장).
 * 서울 지하철 시설은 종류마다 접는다(E44 spec §4 — 천호역 72행이 접힘 행 7개가 된다).
 */
@Composable
fun StationDetailSections(s: StationSections) {
    val res = LocalContext.current.resources
    val isEn = AppLocale.dataLocale(res) == "en"

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
        // 보강 소스 실패는 은폐하지 않고 문장으로 — 어느 종류를 펼칠지 고르기 전에 알아야 한다(spec §4).
        if (f.supplementFailed == true) BodyLine(stringResource(R.string.subway_supplementFailed), "metro-supplement")
        // 펼친 종류(백스택 항목 수명 — 다른 화면에 다녀와도 유지, 영속 안 함). 기본 접힘.
        val expanded = rememberSaveable(saver = listSaver(save = { it.toList() }, restore = { it.toMutableStateList() })) { mutableStateListOf<String>() }
        val wheelchairAccessible = stringResource(R.string.subway_wheelchairAccessible)
        val strings = resourceStrings(res)
        for ((gi, g) in f.groups.withIndex()) {
            val kindLabel = metroKindResId(g.kind)?.let { stringResource(it) } ?: g.kind
            val stopped = stoppedCount(g)
            // 접힘 행이 곧 개수 줄이다. 운행 중지가 있으면 그 수를 같은 줄에(리뷰 M8 — 접으면 줄마다 보이던 "운행 중지"가 가려진다).
            val label = if (stopped > 0) appLocalized(res, R.string.android_station_kindCountStopped, kindLabel, g.facilities.size, stopped)
            else appLocalized(res, R.string.android_station_kindCount, kindLabel, g.facilities.size)
            val open = g.kind in expanded
            // 펼침 행 문법은 한 벌(`DisclosureRow` — 라벨 버튼 + stateDescription, 본문은 펼친 동안만). 펼친 뒤 커서는 이 행에 남고
            // 다음 이동이 첫 시설이다(포커스 코드 없음).
            DisclosureRow(label = label, tag = "metro-$gi", expanded = open, onToggle = { if (open) expanded.remove(g.kind) else expanded.add(g.kind) }, strings = strings) {
                g.facilities.forEachIndexed { i, fac ->
                    val name = facilityName(fac, { compassResId(it)?.let { id -> res.getString(id) } }, { d, dist -> appLocalized(res, R.string.subway_elevatorAt, d, dist) }) { appLocalized(res, R.string.subway_lineNumber, it) }
                    BodyLine(joinText(name, fac.location, fac.floors, operatingResId(fac.operatingStatus)?.let { res.getString(it) }, facilityDetail(fac, wheelchairAccessible)), "metro-$gi-$i")
                }
                // 음성유도기 데이터 기준일 고지(정적 seed) — 그 묶음을 펼친 사람에게만 의미가 있다.
                if (g.kind == "voiceGuide") BodyLine(stringResource(R.string.subway_voiceGuideSource), "metro-voice")
            }
        }
    }
}
