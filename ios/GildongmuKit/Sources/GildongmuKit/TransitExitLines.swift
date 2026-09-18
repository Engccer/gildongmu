import Foundation

/// 경로 브리핑의 출구 번호 줄(E25 — 위원장 요청 2026-09-07). 웹 `src/lib/transit-exit-lines.ts` 미러.
///
/// **출구는 한 경로 안에서 정확히 한 줄에만 실린다.** 승차 출구는 직전 도보 줄이 싣고, 그 줄이
/// 없으면(버스에서 바로 갈아타거나 역에서 출발) 탑승 줄 끝이 싣는다 — 판정은 서버 문맥이 아니라
/// **렌더되는 구간 배열의 직전 항목**으로 한다. 0m 도보 leg는 서버가 화면 목록에서 지우므로
/// "역 밖 진입"과 "붙일 도보 줄이 있다"가 어긋나는데, 화면 구조로 가르면 그 어긋남과 무관하게
/// 겹침·누락이 둘 다 불가능해진다.

/// 하차 줄 — 빠른하차 문장 뒤에 출구가 결론으로 붙는다. 빠른하차가 없으면 하차역만으로 줄을 세운다
/// (종전엔 그 역에 줄 자체가 없었다). 둘 다 없으면 nil — 부재 문구를 만들지 않는다(3-state).
///
/// ⚠ `exitBound`를 인자로 받는 이유: 출구 문구 정본은 안내 세션과 같은 `transitGuide.exitBound`인데
///   그 네임스페이스가 **Kit 카탈로그에 없다**(`KIT_NAMESPACES`는 category·region·route·whereAmI).
///   문구를 kit-extra에 복제하면 두 벌이 되어 갈리므로, 문자열 해석만 앱 층에 맡기고 **형식 게이트와
///   분기는 여기 남긴다**(호출부가 게이트를 잊을 수 없다).
public func alightLineText(
    _ quickExit: QuickExit?,
    station: String,
    exitAlight: String?,
    lang: String,
    exitBound: (String) -> String
) -> String? {
    guard let station = transitBriefingName(station) else { return nil }
    let quick = quickExitText(quickExit, station: station, lang: lang)
    // 서버가 형식·문맥을 이미 걸렀지만 소비자 게이트를 이중으로 둔다(spec 2026-09-02 §5.1).
    let bound = transitValidExitNo(exitAlight).map(exitBound)
    if let quick {
        return [quick, bound].compactMap { $0 }.joined(separator: ", ")
    }
    guard let bound else { return nil }
    return [kitLocalized("route.transit.alightAt", lang: lang, station), bound].joined(separator: ", ")
}

/// 이 도보 구간 줄이 실을 승차 출구 — 다음 구간이 탑승이고 승차 출구가 있을 때만.
/// `index`는 도보 구간 자신의 자리다.
public func boardExitAfterWalk(_ legs: [TransitRouteLeg], at index: Int) -> String? {
    guard legs.indices.contains(index), legs[index].mode == "walk" else { return nil }
    let nextIndex = index + 1
    guard legs.indices.contains(nextIndex) else { return nil }
    let next = legs[nextIndex]
    guard next.mode != "walk" else { return nil }
    return transitValidExitNo(next.exit?.board)
}

/// 이 탑승 구간 줄 끝이 실을 승차 출구 — 직전이 도보가 **아닐** 때만(도보면 그 줄이 싣는다).
/// `boardExitAfterWalk`와 정확히 배타라, 둘을 함께 쓰면 겹침도 누락도 없다.
public func boardExitOnBoardLine(_ legs: [TransitRouteLeg], at index: Int) -> String? {
    guard legs.indices.contains(index) else { return nil }
    let leg = legs[index]
    guard leg.mode != "walk" else { return nil }
    if index > 0, legs[index - 1].mode == "walk" { return nil }
    return transitValidExitNo(leg.exit?.board)
}

// MARK: 줄 단위 영어 자격 (E27 원자성 — 브리핑 구간 줄·하차 줄이 같은 술어를 쓴다)

/// 브리핑 이름의 빈값·공백값은 정보 부재다. 정규화는 조인의 몫이며, 표시할 원문은 보존한다.
public func transitBriefingName(_ name: String?) -> String? {
    guard let name, !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
    return name
}

/// 이 구간의 브리핑 줄이 **영어 이름**으로 설 자격 — 노선·승차·하차 영문이 **다** 있을 때만(도보는 행선지만).
/// 웹 `TransitRouteBriefing`의 `legEn`과 같은 조건이다. 하나라도 없으면 그 구간의 줄 전부가 한국어 이름이다.
///
/// ⚠ 구간 줄과 하차 줄이 **같은 술어**를 봐야 한다 — 구간 줄이 "여의도"라 했는데 하차 줄이 "Yeouido"라 하면
///   사용자가 둘을 같은 역으로 알아보지 못한다. 종전엔 이 판정이 앱 `transitLegLine` 안에 인라인 `guard`로만
///   있어 하차 줄이 `toName`을 직접 읽었고, en 세션의 하차 줄만 "Get off at 여의도"로 떨어졌다(2026-09-13).
public func transitLegUsesEnglish(_ leg: TransitRouteLeg, lang: DataLocale) -> Bool {
    guard lang == .en else { return false }
    if leg.mode == "walk" {
        // 마지막 도보(행선지 없음)는 목적지 문구라 영문 조각이 필요 없다. 행선지가 있으면 영문 행선지 필수.
        return transitBriefingName(leg.toName) == nil || transitBriefingName(leg.toNameEn) != nil
    }
    return transitBriefingName(leg.lineNameEn) != nil
        && (transitBriefingName(leg.fromName) == nil || transitBriefingName(leg.fromNameEn) != nil)
        && (transitBriefingName(leg.toName) == nil || transitBriefingName(leg.toNameEn) != nil)
}

/// 하차 줄에 쓸 역명 — 구간 줄이 영어면 영문, 아니면 한국어. 이름이 없으면 빈 문자열(호출부가 줄을 세우지 않는다).
public func transitAlightStationName(_ leg: TransitRouteLeg, lang: DataLocale) -> String {
    if transitLegUsesEnglish(leg, lang: lang), let en = transitBriefingName(leg.toNameEn) { return en }
    return transitBriefingName(leg.toName) ?? ""
}
