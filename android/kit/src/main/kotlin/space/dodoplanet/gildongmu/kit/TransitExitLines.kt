package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.QuickExit
import space.dodoplanet.gildongmu.kit.models.TransitRouteLeg

// 경로 브리핑의 출구 번호 줄(E25). 웹 `src/lib/transit-exit-lines.ts` ↔ Kit
// `TransitExitLines.swift` 미러.
//
// **출구는 한 경로 안에서 정확히 한 줄에만 실린다.** 승차 출구는 직전 도보 줄이 싣고, 그 줄이 없으면(버스에서
// 바로 갈아타거나 역에서 출발) 탑승 줄 끝이 싣는다 — 판정은 서버 문맥이 아니라 **렌더되는 구간 배열의 직전
// 항목**으로 한다. 0m 도보 leg는 서버가 화면 목록에서 지우므로 "역 밖 진입"과 "붙일 도보 줄이 있다"가
// 어긋나는데, 화면 구조로 가르면 그 어긋남과 무관하게 겹침·누락이 둘 다 불가능해진다.
// 출구 번호 형식 게이트 `transitValidExitNo`는 GUIDE `TransitGuide.kt`가 소유한다.

/**
 * 하차 줄 — 빠른하차 문장 뒤에 출구가 결론으로 붙는다. 빠른하차가 없으면 하차역만으로 줄을 세운다.
 * 둘 다 없으면 null — 부재 문구를 만들지 않는다(3-state).
 *
 * ⚠ `exitBound`를 인자로 받는 이유: 출구 문구 정본은 안내 세션과 같은 `transitGuide.exitBound`인데 그
 *   네임스페이스가 **:kit 카탈로그에 없다**(category·region·route·whereAmI만). 문구를 복제하면 두 벌이 되어
 *   갈리므로, 문자열 해석만 :app에 맡기고 **형식 게이트와 분기는 여기 남긴다**(호출부가 게이트를 잊을 수 없다).
 */
fun alightLineText(
    quickExit: QuickExit?,
    station: String,
    exitAlight: String?,
    lang: String,
    exitBound: (String) -> String,
): String? {
    val name = transitBriefingName(station) ?: return null
    val quick = quickExitText(quickExit, name, lang)
    // 서버가 형식·문맥을 이미 걸렀지만 소비자 게이트를 이중으로 둔다(spec 2026-09-02 §5.1).
    val bound = transitValidExitNo(exitAlight)?.let(exitBound)
    if (quick != null) return listOfNotNull(quick, bound).joinToString(", ")
    if (bound == null) return null
    return listOf(kitLocalized("route.transit.alightAt", lang, name), bound).joinToString(", ")
}

/** 이 도보 구간 줄이 실을 승차 출구 — 다음 구간이 탑승이고 승차 출구가 있을 때만. `index`는 도보 구간 자신의 자리다. */
fun boardExitAfterWalk(legs: List<TransitRouteLeg>, index: Int): String? {
    if (index !in legs.indices || legs[index].mode != "walk") return null
    val next = legs.getOrNull(index + 1) ?: return null
    if (next.mode == "walk") return null
    return transitValidExitNo(next.exit?.board)
}

/**
 * 이 탑승 구간 줄 끝이 실을 승차 출구 — 직전이 도보가 **아닐** 때만(도보면 그 줄이 싣는다).
 * `boardExitAfterWalk`와 정확히 배타라, 둘을 함께 쓰면 겹침도 누락도 없다.
 */
fun boardExitOnBoardLine(legs: List<TransitRouteLeg>, index: Int): String? {
    if (index !in legs.indices) return null
    val leg = legs[index]
    if (leg.mode == "walk") return null
    if (index > 0 && legs[index - 1].mode == "walk") return null
    return transitValidExitNo(leg.exit?.board)
}

// 줄 단위 영어 자격 (E27 원자성 — 브리핑 구간 줄·하차 줄이 같은 술어를 쓴다)

/**
 * 브리핑 이름의 빈값·공백값은 정보 부재다. 정규화는 조인의 몫이며, 표시할 원문은 보존한다.
 * 공백 뜻은 Swift `.whitespacesAndNewlines`(U+200B 포함) — Kotlin `isBlank`는 집합이 달라 쓰지 않는다.
 */
fun transitBriefingName(name: String?): String? =
    name?.takeIf { it.trimSwiftWhitespacesAndNewlines().isNotEmpty() }

/**
 * 이 구간의 브리핑 줄이 **영어 이름**으로 설 자격 — 노선·승차·하차 영문이 **다** 있을 때만(도보는 행선지만).
 * 웹 `TransitRouteBriefing`의 `legEn`과 같은 조건이다. 하나라도 없으면 그 구간의 줄 전부가 한국어 이름이다.
 *
 * ⚠ 구간 줄과 하차 줄이 **같은 술어**를 봐야 한다 — 구간 줄이 "여의도"라 했는데 하차 줄이 "Yeouido"라 하면
 *   사용자가 둘을 같은 역으로 알아보지 못한다.
 */
fun transitLegUsesEnglish(leg: TransitRouteLeg, lang: DataLocale): Boolean {
    if (lang != DataLocale.en) return false
    if (leg.mode == "walk") {
        // 마지막 도보(행선지 없음)는 목적지 문구라 영문 조각이 필요 없다. 행선지가 있으면 영문 행선지 필수.
        return transitBriefingName(leg.toName) == null || transitBriefingName(leg.toNameEn) != null
    }
    return transitBriefingName(leg.lineNameEn) != null &&
        (transitBriefingName(leg.fromName) == null || transitBriefingName(leg.fromNameEn) != null) &&
        (transitBriefingName(leg.toName) == null || transitBriefingName(leg.toNameEn) != null)
}

/** 하차 줄에 쓸 역명 — 구간 줄이 영어면 영문, 아니면 한국어. 이름이 없으면 빈 문자열(호출부가 줄을 세우지 않는다). */
fun transitAlightStationName(leg: TransitRouteLeg, lang: DataLocale): String {
    val en = transitBriefingName(leg.toNameEn)
    if (transitLegUsesEnglish(leg, lang) && en != null) return en
    return transitBriefingName(leg.toName) ?: ""
}
