package space.dodoplanet.gildongmu.directions

import space.dodoplanet.gildongmu.kit.DataLocale
import space.dodoplanet.gildongmu.kit.TransitAlternativeName
import space.dodoplanet.gildongmu.kit.TransitWalkLegText
import space.dodoplanet.gildongmu.kit.alightLineText
import space.dodoplanet.gildongmu.kit.bilingualName
import space.dodoplanet.gildongmu.kit.boardExitAfterWalk
import space.dodoplanet.gildongmu.kit.boardExitOnBoardLine
import space.dodoplanet.gildongmu.kit.formatDistance
import space.dodoplanet.gildongmu.kit.joinText
import space.dodoplanet.gildongmu.kit.models.TransitRoute
import space.dodoplanet.gildongmu.kit.models.TransitRouteLeg
import space.dodoplanet.gildongmu.kit.transitAlightStationName
import space.dodoplanet.gildongmu.kit.transitBriefingName
import space.dodoplanet.gildongmu.kit.transitLegUsesEnglish

// 대중교통 구간 문장(spec §3-4-a·b, iOS `RouteBriefing.swift` `transitLegLine`·`transitLegText`·`transitAlternativeName` 대응).
// 판정(출구를 어느 줄이 싣나·영어 자격·도보 문구 키·대안 이름 키)은 전부 :kit, 여기는 키 → 문장 조립만.

/** 한 구간 줄의 시각·낭독 문자열. 병기(`English (한글)`)가 있을 때만 둘이 갈린다. */
data class LegLine(val visual: String, val spoken: String)

/**
 * 구간 행 문장. `lang`은 앱 UI 언어(문장 틀), `dataLocale`은 데이터 언어(영어 이름 자격 — E27 원자성). 승차 출구(E25)는
 * 도보 줄·탑승 줄 중 :kit 배타 술어가 고른 **한 줄**만 싣는다.
 */
fun transitLegLine(
    legs: List<TransitRouteLeg>,
    index: Int,
    destinationName: String?,
    lang: String,
    dataLocale: DataLocale,
    strings: Strings,
): LegLine {
    val leg = legs[index]
    val boardExit = if (leg.mode == "walk") boardExitAfterWalk(legs, index) else boardExitOnBoardLine(legs, index)
    if (!transitLegUsesEnglish(leg, dataLocale)) {
        val ko = transitLegText(leg, destinationName, LegNames.Korean, boardExit, lang, strings)
        return LegLine(ko, ko)
    }
    if (leg.mode == "walk") {
        val en = transitLegText(leg, destinationName, LegNames.English(bilingual = false), boardExit, lang, strings)
        return LegLine(en, en)
    }
    return LegLine(
        visual = transitLegText(leg, destinationName, LegNames.English(bilingual = true), boardExit, lang, strings),
        spoken = transitLegText(leg, destinationName, LegNames.English(bilingual = false), boardExit, lang, strings),
    )
}

/** 이름 선택 — `Korean`은 종전 문장 그대로, `English`는 `*En`(병기 여부는 시각/낭독). 병기는 **승차·하차 역명에만**. */
sealed class LegNames {
    data object Korean : LegNames()
    data class English(val bilingual: Boolean) : LegNames()
}

/**
 * 구간 한 줄 = 한 접근성 객체. 도보 구간은 행선지·거리 유무로 문구가 갈리고(:kit `TransitWalkLegText`), 탑승 구간은
 * 노선·승차·하차·정거장 수·소요·승차 출구·운행 밖 경고를 쉼표로 합친다.
 */
fun transitLegText(
    leg: TransitRouteLeg,
    destinationName: String?,
    names: LegNames,
    boardExit: String?,
    lang: String,
    strings: Strings,
): String {
    // 빈값·공백값은 정보 부재 — 한국어와 영문을 고르기 전에 같은 판정을 지난다(:kit `transitBriefingName`, iOS 동형).
    fun pick(koRaw: String?, enRaw: String?): String? {
        val ko = transitBriefingName(koRaw)
        val en = transitBriefingName(enRaw)
        return when (names) {
            LegNames.Korean -> ko
            is LegNames.English -> when {
                en == null -> ko
                // 병기 정본은 E28 `bilingualName`(한 줄 괄호, 낭독은 primary만) — roman은 ODsay 영문이 있어 null.
                names.bilingual -> bilingualName(lang, ko ?: en, en, roman = null).display
                else -> en
            }
        }
    }
    val fromName = pick(leg.fromName, leg.fromNameEn)
    val toName = pick(leg.toName, leg.toNameEn)
    if (leg.mode == "walk") {
        // 마지막 도보에는 행선지가 없다(provider가 목적지 이름을 모른다). 공백뿐인 목적지 이름도 폴백으로 쓰지 않는다.
        val name = toName ?: transitBriefingName(destinationName)
        val resolved = TransitWalkLegText.resolve(
            name = name, distance = leg.distanceMeters?.let(::formatDistance), minutes = leg.minutes, boardExit = boardExit,
        )
        return strings.get(resolved.key, *resolved.args.toTypedArray())
    }
    val countKey = if (leg.mode == "bus") "android.route.stopCount" else "android.route.stationCount"
    // 운행 밖만 표기(정상·정보없음은 침묵). 같은 한 줄에 합친다.
    val first = leg.firstServiceTime
    val last = leg.lastServiceTime
    val serviceOutside = if (leg.serviceStatus == "outside" && first != null && last != null) {
        strings.get("route.transit.legServiceOutside", first, last)
    } else {
        null
    }
    // 노선 이름은 영어 모드에서도 `lineNameEn` 그대로(병기 없음). ⚠ 공백뿐인 값은 없음 — ODsay `busNo` 결측 `" "`가
    // "번 버스"로 낭독된 iOS 실사고. 승하차역과 같은 부재 판정(원문 보존).
    val lineName = transitBriefingName(if (names is LegNames.English) leg.lineNameEn ?: leg.lineName else leg.lineName)
    val lineText = lineName?.let { if (leg.mode == "bus") strings.get("route.transit.busNo", it) else it }
    return joinText(
        lineText,
        fromName?.let { strings.get("android.route.board", it) },
        toName?.let { strings.get("android.route.alight", it) },
        leg.stationCount?.let { strings.get(countKey, it) },
        strings.get("android.route.legMinutes", leg.minutes),
        // 승차 출구 폴백(E25) — 앞 도보 줄이 없을 때만 값이 온다. 운행 밖 경고보다 앞.
        boardExit?.let { strings.get("route.transit.legBoardExit", it) },
        serviceOutside,
    )
}

/**
 * 하차 줄(빠른하차 E5 + 하차 출구 E25). 둘 다 없으면 null — 행을 만들지 않는다(3-state).
 * ⚠ `lang`은 **앱 UI 언어**(:kit 카탈로그 `route.transit.alightAt`·`quickExit*` 조회), 역명은 데이터 언어(`dataLocale`) —
 *   다른 축이다(ja 사용자에게 하차 줄만 영어가 되지 않게, iOS `lang: AppLanguage.current` 동형).
 */
fun alightLine(leg: TransitRouteLeg, lang: String, dataLocale: DataLocale, strings: Strings): String? =
    alightLineText(
        quickExit = leg.quickExit,
        station = transitAlightStationName(leg, dataLocale),
        exitAlight = leg.exit?.alight,
        lang = lang,
        exitBound = { strings.get("transitGuide.exitBound", it) },
    )

/** 대안 경로 표시 이름(spec §4.1). 축 판정은 서버, 키 선택은 :kit, 문구 조회만 여기. */
fun transitAlternativeName(route: TransitRoute, strings: Strings): String {
    val resolved = TransitAlternativeName.key(highlight = route.highlight, displayIndex = route.displayIndex)
    val index = resolved.index
    return if (index == null) strings.get(resolved.key) else strings.get(resolved.key, index)
}
