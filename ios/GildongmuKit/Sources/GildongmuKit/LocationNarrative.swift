import Foundation

// "현재 위치 정위" 산문 빌더 — 웹 `src/lib/where-am-i.ts`의 buildLocationNarrative +
// `messages/*.json`의 whereAmI.narrative.*·direction.*·category.* 문구를 평문으로 미러.
// 웹은 t.rich 태그(<name></name> 등)로 렌더하지만 강조 태그는 스크린 리더 낭독에 영향이
// 없어 iOS는 태그 없는 평문 템플릿(kit-extra 오버라이드)을 조립한다. 문장 템플릿은
// 카탈로그 `whereAmI.narrative.*`(플레이스홀더는 positional %N$@), 방위·분류 단어는
// `whereAmI.direction.*`·`whereAmI.category.*` 조회.

private let landmarkCap = 6

/// 8방위 단어. 미지정 키는 원문 반환(웹 폴백 동형).
func directionWord(_ bearing: String, lang: String) -> String {
    switch bearing {
    case "n": return kitLocalized("whereAmI.direction.n", lang: lang)
    case "ne": return kitLocalized("whereAmI.direction.ne", lang: lang)
    case "e": return kitLocalized("whereAmI.direction.e", lang: lang)
    case "se": return kitLocalized("whereAmI.direction.se", lang: lang)
    case "s": return kitLocalized("whereAmI.direction.s", lang: lang)
    case "sw": return kitLocalized("whereAmI.direction.sw", lang: lang)
    case "w": return kitLocalized("whereAmI.direction.w", lang: lang)
    case "nw": return kitLocalized("whereAmI.direction.nw", lang: lang)
    default: return bearing
    }
}

/// 기준점 분류 단어. 미지정 키는 원문 반환.
private func categoryWord(_ category: String, lang: String) -> String {
    switch category {
    case "convenience": return kitLocalized("whereAmI.category.convenience", lang: lang)
    case "subway": return kitLocalized("whereAmI.category.subway", lang: lang)
    case "restaurant": return kitLocalized("whereAmI.category.restaurant", lang: lang)
    case "cafe": return kitLocalized("whereAmI.category.cafe", lang: lang)
    case "bank": return kitLocalized("whereAmI.category.bank", lang: lang)
    case "pharmacy": return kitLocalized("whereAmI.category.pharmacy", lang: lang)
    case "hospital": return kitLocalized("whereAmI.category.hospital", lang: lang)
    case "mart": return kitLocalized("whereAmI.category.mart", lang: lang)
    case "public": return kitLocalized("whereAmI.category.public", lang: lang)
    case "attraction": return kitLocalized("whereAmI.category.attraction", lang: lang)
    default: return category
    }
}

/// 도로명에서 행정동과 겹치는 행정구역 접두(시·도 + 시·군·구)를 제거한다. 웹
/// stripRegionPrefix 미러 — "서울특별시 강동구"가 행정동·도로명에서 두 번 낭독되는
/// 것을 막는다. region이 없거나 토큰이 2개 미만이거나 접두가 안 맞으면 원문 유지.
private func stripRegionPrefix(_ region: String?, _ road: String) -> String {
    guard let region else { return road }
    let tokens = region.split(whereSeparator: \.isWhitespace).map(String.init)
    guard tokens.count >= 2 else { return road }
    let prefix = tokens.dropLast().joined(separator: " ")
    let withTrailingSpace = prefix + " "
    return road.hasPrefix(withTrailingSpace) ? String(road.dropFirst(withTrailingSpace.count)) : road
}

/// WhereAmIData → 산문 단락 배열. 단락1(위치+근접역)·단락2(주변 기준점 상위
/// landmarkCap) 순. 빈 조각(주소·행정동 둘 다 없음, 근접역 없음, 기준점 없음)은
/// 해당 문장·단락을 통째로 생략한다.
public func buildLocationNarrative(_ data: WhereAmIData, lang: String) -> [String] {
    var paragraphs: [String] = []

    var sentences: [String] = []
    let rawRoad = firstNonEmpty(data.address?.road, data.address?.jibun)
    let road = rawRoad.map { stripRegionPrefix(data.region, $0) }
    let placeParts = [firstNonEmpty(data.region), road].compactMap { $0 }
    if !placeParts.isEmpty {
        sentences.append(
            kitLocalized("whereAmI.narrative.here", lang: lang, placeParts.joined(separator: ", "))
        )
    }
    if let station = data.nearestStation {
        let lineSuffix = station.line.map { " (\($0))" } ?? ""
        sentences.append(
            kitLocalized(
                "whereAmI.narrative.station", lang: lang,
                station.name, lineSuffix,
                directionWord(station.bearing, lang: lang),
                formatDistance(station.distanceMeters)
            )
        )
    }
    if !sentences.isEmpty {
        paragraphs.append(sentences.joined(separator: " "))
    }

    let landmarks = data.landmarks.prefix(landmarkCap)
    if !landmarks.isEmpty {
        let items = landmarks.map { landmark in
            kitLocalized(
                "whereAmI.narrative.landmarkItem", lang: lang,
                directionWord(landmark.bearing, lang: lang),
                formatDistance(landmark.distanceMeters),
                landmark.name,
                categoryWord(landmark.category, lang: lang)
            )
        }
        paragraphs.append(
            kitLocalized("whereAmI.narrative.landmarksLead", lang: lang)
                + items.joined(separator: ", ")
                + kitLocalized("whereAmI.narrative.landmarksTail", lang: lang)
        )
    }

    return paragraphs
}

// MARK: - 한눈에 보기 문장 (M4)

private func overviewLabel(_ kind: OverviewPlaceKind, lang: String) -> String {
    switch kind {
    case .food: return kitLocalized("whereAmI.overview.labelFood", lang: lang)
    case .kids: return kitLocalized("whereAmI.overview.labelKids", lang: lang)
    case .events: return kitLocalized("whereAmI.overview.labelEvents", lang: lang)
    case .barrierFree: return kitLocalized("whereAmI.overview.labelBarrierFree", lang: lang)
    }
}

private func overviewNearest(_ items: [OverviewPlace], lang: String) -> String {
    let parts = items.map {
        kitLocalized("whereAmI.overview.nearestItem", lang: lang,
                     directionWord($0.bearing, lang: lang), formatDistance($0.distanceMeters), $0.name)
    }
    return kitLocalized("whereAmI.overview.nearestLead", lang: lang, parts.joined(separator: ", "))
}

/// 불릿당 한 문장. 상태별 문장이 전부 다르다(3-state 불변식) — 반경 문구는 불릿이 아니라
/// 헤딩 부제(`whereAmI.overview.radius`)가 한 번만 말하고, none 문장만 반경을 품는다.
/// 템플릿은 `messages/*.json` whereAmI.overview.*(6 로케일, LLM 아님).
public func buildOverviewLines(_ overview: NearbyOverview, lang: String) -> [String] {
    let radius = formatDistance(overview.radiusMeters)
    return overview.bullets.map { bullet in
        switch bullet {
        case .transit(let station, let bus):
            var parts: [String] = []
            if let station {
                let line = station.line.map { kitLocalized("whereAmI.overview.transitLine", lang: lang, $0) } ?? ""
                parts.append(kitLocalized("whereAmI.overview.transitStation", lang: lang,
                                          station.name, line, directionWord(station.bearing, lang: lang),
                                          formatDistance(station.distanceMeters)))
            } else {
                parts.append(kitLocalized("whereAmI.overview.transitNoStation", lang: lang, radius))
            }
            switch bus {
            case .ok(let count, let nearest):
                parts.append(kitLocalized("whereAmI.overview.transitBus", lang: lang,
                                          String(count), overviewNearest(nearest, lang: lang)))
            case .empty: parts.append(kitLocalized("whereAmI.overview.transitBusNone", lang: lang))
            case .uncovered: parts.append(kitLocalized("whereAmI.overview.transitBusUncovered", lang: lang))
            case .failed: parts.append(kitLocalized("whereAmI.overview.transitBusFailed", lang: lang))
            case nil: break
            }
            return kitLocalized("whereAmI.overview.transitLead", lang: lang, parts.joined(separator: ", "))
        case .place(let kind, let state):
            let label = overviewLabel(kind, lang: lang)
            switch state {
            case .ok(let count, let capped, let nearest):
                return kitLocalized(capped ? "whereAmI.overview.okCapped" : "whereAmI.overview.ok", lang: lang,
                                    label, String(count), overviewNearest(nearest, lang: lang))
            case .empty: return kitLocalized("whereAmI.overview.none", lang: lang, label, radius)
            case .unavailableSeoulOnly: return kitLocalized("whereAmI.overview.unavailableSeoulOnly", lang: lang, label)
            case .failed: return kitLocalized("whereAmI.overview.failedItem", lang: lang, label)
            }
        }
    }
}
