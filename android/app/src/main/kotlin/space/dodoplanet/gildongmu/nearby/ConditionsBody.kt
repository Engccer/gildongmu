package space.dodoplanet.gildongmu.nearby

import androidx.compose.runtime.Composable
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.a11y.BodyLine
import space.dodoplanet.gildongmu.a11y.HeadingLine
import space.dodoplanet.gildongmu.i18n.AppLocale
import space.dodoplanet.gildongmu.i18n.appLocalized
import space.dodoplanet.gildongmu.kit.bilingualName
import space.dodoplanet.gildongmu.kit.joinText
import space.dodoplanet.gildongmu.kit.models.CongestionLevelKey

// 미지 값 처리(spec §12 머리 표): 하늘·강수는 `weather.unknown`, 공기질 등급은 `airQuality.unknown`(원문 폴백 금지), 혼잡도 등급은 원문.

internal fun gradeResId(grade: String) = when (grade) {
    "good" -> R.string.airQuality_grade_good
    "moderate" -> R.string.airQuality_grade_moderate
    "bad" -> R.string.airQuality_grade_bad
    "veryBad" -> R.string.airQuality_grade_veryBad
    else -> R.string.airQuality_unknown
}

internal fun skyResId(label: String) = when (label) {
    "clear" -> R.string.weather_sky_clear
    "partlyCloudy" -> R.string.android_nearby_skyPartly
    "cloudy" -> R.string.weather_sky_cloudy
    else -> R.string.weather_unknown
}

internal fun precipResId(label: String) = when (label) {
    "none" -> R.string.weather_precipitation_none
    "rain" -> R.string.weather_precipitation_rain
    "rainSnow" -> R.string.android_nearby_rainSnow
    "snow" -> R.string.weather_precipitation_snow
    "shower" -> R.string.weather_precipitation_shower
    else -> R.string.weather_unknown
}

/** 혼잡도 등급 낱말. 표에 없는 신설 등급은 null → 호출부가 원문을 읽는다(정보를 잃느니 한국어 낭독). */
internal fun levelResId(raw: String) = when (CongestionLevelKey.fromLevelText(raw)) {
    CongestionLevelKey.relaxed -> R.string.congestion_levels_relaxed
    CongestionLevelKey.normal -> R.string.congestion_levels_normal
    CongestionLevelKey.slightlyBusy -> R.string.congestion_levels_slightlyBusy
    CongestionLevelKey.busy -> R.string.congestion_levels_busy
    null -> null
}

/**
 * 날씨·공기질·혼잡도 본문(iOS `ConditionsView` 이식): ① 날씨 헤딩(착지) + 줄들 또는 실패 문장 ② 공기질 헤딩 + 줄들 또는 실패 문장
 * ③ 혼잡도는 **있을 때만**(헤더 없음, 부재는 침묵 — 서울 91%가 핫스팟 밖). 라벨-값은 평문 단일 텍스트.
 */
@Composable
fun ConditionsBody(p: ConditionsPayload, requesterFor: (String) -> FocusRequester) {
    val res = LocalContext.current.resources
    val lang = AppLocale.current(res)

    HeadingLine(stringResource(R.string.android_nearby_weatherHeading), "conditions-weather", focus = requesterFor("conditions-weather"))
    val w = p.weather
    if (w != null) {
        BodyLine(appLocalized(res, R.string.android_nearby_skyLine, stringResource(skyResId(w.sky.label))), "sky")
        BodyLine(appLocalized(res, R.string.android_nearby_precipLine, stringResource(precipResId(w.precipitation.label))), "precip")
        w.tempC?.let { BodyLine(appLocalized(res, R.string.android_nearby_tempNow, numberText(it)), "temp") }
        val range = joinText(
            w.tempMax?.let { appLocalized(res, R.string.android_nearby_tempMax, numberText(it)) },
            w.tempMin?.let { appLocalized(res, R.string.android_nearby_tempMin, numberText(it)) },
        )
        if (range.isNotEmpty()) BodyLine(range, "temp-range")
        w.humidity?.let { BodyLine(appLocalized(res, R.string.weather_humidity, numberText(it)), "humidity") }
        w.precipProbability?.let { BodyLine(appLocalized(res, R.string.weather_precipProbability, numberText(it)), "pop") }
        BodyLine(appLocalized(res, R.string.android_nearby_baseTime, w.baseTime), "base-time")
    } else {
        BodyLine(stringResource(R.string.android_nearby_weatherFailed), "weather-failed")
    }

    HeadingLine(stringResource(R.string.weather_airLabel), "air")
    val a = p.air
    if (a != null) {
        val name = bilingualName(lang, a.stationName, en = null, roman = a.stationNameRoman)
        BodyLine(
            appLocalized(res, R.string.android_nearby_airStationLine, name.display, numberText(a.distanceKm)),
            "air-station",
            appLocalized(res, R.string.android_nearby_airStationLine, name.primary, numberText(a.distanceKm)),
        )
        val grades = listOf("good", "moderate", "bad", "veryBad").associateWith { stringResource(gradeResId(it)) }
        val unknown = stringResource(R.string.airQuality_unknown)
        val grade = { g: String -> grades[g] ?: unknown }
        BodyLine(pollutantText(stringResource(R.string.airQuality_khai), a.khai, grade), "khai")
        BodyLine(pollutantText(stringResource(R.string.airQuality_pm10), a.pm10, grade), "pm10")
        BodyLine(pollutantText(stringResource(R.string.airQuality_pm25), a.pm25, grade), "pm25")
        BodyLine(appLocalized(res, R.string.android_nearby_dataTime, a.dataTime), "data-time")
    } else {
        BodyLine(stringResource(R.string.android_nearby_airFailed), "air-failed")
    }

    p.congestion?.let { c ->
        val name = bilingualName(lang, c.name, en = null, roman = c.nameRoman)
        val level = levelResId(c.level)?.let { stringResource(it) } ?: c.level
        BodyLine(appLocalized(res, R.string.congestion_summary, name.display, level), "congestion", appLocalized(res, R.string.congestion_summary, name.primary, level))
        if (lang == "ko" && c.message.isNotEmpty()) BodyLine(c.message, "congestion-message") // 서버 한국어 서술은 앱 언어 ko에서만
        BodyLine(appLocalized(res, R.string.congestion_asOf, c.asOf), "congestion-asof")
    }
}
