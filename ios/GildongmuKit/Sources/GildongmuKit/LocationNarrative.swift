import Foundation

// "한눈에 보기" 문장 빌더 — 웹 `src/lib/overview-lines.ts` ↔ CLI `formatNearbyOverview` 미러.
// 템플릿은 `messages/*.json` whereAmI.overview.*(positional %N$@), 방위 단어는 whereAmI.direction.*.
// 종전의 "현재 위치 정위" 산문(buildLocationNarrative)은 웹·iOS 소비자가 모두 둘러보기로
// 통합되어 2026-08-22 삭제됐다(`/api/where-am-i`·WhereAmIService는 CLI·채팅 계약이라 유지).

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

// MARK: - 한눈에 보기 문장 (M4)

private func overviewLabel(_ kind: OverviewPlaceKind, lang: String) -> String {
    switch kind {
    case .food: return kitLocalized("whereAmI.overview.labelFood", lang: lang)
    case .cafe: return kitLocalized("whereAmI.overview.labelCafe", lang: lang)
    case .kids: return kitLocalized("whereAmI.overview.labelKids", lang: lang)
    case .events: return kitLocalized("whereAmI.overview.labelEvents", lang: lang)
    case .barrierFree: return kitLocalized("whereAmI.overview.labelBarrierFree", lang: lang)
    }
}

/// ko 라벨에 주격·보조사를 붙인다(라벨은 전부 한글이라 판정 불가가 없다). 다른 언어는 그대로.
private func withSubject(_ label: String, lang: String) -> String {
    lang == "ko" ? label + (KoreanParticle.subject(label) ?? "") : label
}

private func withTopic(_ label: String, lang: String) -> String {
    lang == "ko" ? label + (KoreanParticle.topic(label) ?? "") : label
}

/// 불릿 한 줄의 문장 + 한글 병기 꼬리(E28, 웹 `OverviewLine` 미러). `secondary`는 병기한 이름들의
/// 한글 원문을 순서대로 쉼표로 이었고, 없으면 nil. 뷰는 `text`를 낭독하고 시각은 `text (secondary)`.
public struct OverviewLine: Equatable, Sendable {
    public let text: String
    public let secondary: String?

    public var display: String {
        guard let secondary else { return text }
        return "\(text) (\(secondary))"
    }
}

/// 병기한 한글 이름을 불릿 단위로 모은다.
private final class KoSink {
    var names: [String] = []
    var secondary: String? { names.isEmpty ? nil : names.joined(separator: ", ") }
}

/// 불릿에 넣을 이름 — 비-ko는 원천 영문(역 `nameEn`) → 로마자 → 한글 순(`bilingualName` 규칙).
private func pickName(_ name: String, en: String?, roman: String?, lang: String, sink: KoSink) -> String {
    let b = bilingualName(lang: lang, ko: name, en: en, roman: roman)
    if let secondary = b.secondary { sink.names.append(secondary) }
    return b.primary
}

/// "가장 가까운 곳은 {첫 곳}이고, {나머지}가 있습니다." — 거리·방위를 이름 앞에 두는 어순
/// (위원장 판정 2026-09-13, 웹 `nearestSentence` 미러). 첫 곳만 `nearestFirst`("…지점에 있는
/// {name}")로 서술격 조사를 받고, 나머지는 `nearestItem`으로 나열하며 ko는 마지막 이름에만
/// 주격 조사가 붙는다(판정 불가면 조사 자리를 비운다 — `KoreanParticle` 계약). 한 곳뿐이면
/// 나열이 없으므로 `nearestOne`. ⚠ 인자 순서는 ko 플레이스홀더 등장 순서(direction, distance, name).
private func overviewNearest(_ items: [OverviewPlace], lang: String, sink: KoSink) -> String {
    guard let head = items.first else { return "" }
    let first = kitLocalized("whereAmI.overview.nearestFirst", lang: lang,
                             directionWord(head.bearing, lang: lang),
                             formatDistance(head.distanceMeters),
                             pickName(head.name, en: nil, roman: head.nameRoman, lang: lang, sink: sink))
    let rest = items.dropFirst()
    if rest.isEmpty { return kitLocalized("whereAmI.overview.nearestOne", lang: lang, first) }
    let parts = rest.enumerated().map { offset, place -> String in
        let name = pickName(place.name, en: nil, roman: place.nameRoman, lang: lang, sink: sink)
        return kitLocalized("whereAmI.overview.nearestItem", lang: lang,
                            directionWord(place.bearing, lang: lang),
                            formatDistance(place.distanceMeters),
                            offset == rest.count - 1 ? withSubject(name, lang: lang) : name)
    }
    return kitLocalized("whereAmI.overview.nearestLead", lang: lang, first, parts.joined(separator: ", "))
}

/// 불릿당 문장 묶음(한 접근성 객체). 상태별 문장이 전부 다르다(3-state 불변식) — 반경 문구는
/// 헤딩 부제(`whereAmI.overview.radius`)가 한 번만 말하고, none 문장만 반경을 품는다.
/// 템플릿은 `messages/*.json` whereAmI.overview.*(6 로케일, LLM 아님). 문장형은 위원장
/// 판정 2026-08-22("아이 놀 곳이 9곳 있습니다. 가장 가까운 곳은 …입니다.").
public func buildOverviewLines(_ overview: NearbyOverview, lang: String) -> [OverviewLine] {
    let radius = formatDistance(overview.radiusMeters)
    return overview.bullets.map { bullet in
        let sink = KoSink()
        let text = overviewBulletText(bullet, lang: lang, radius: radius, sink: sink)
        return OverviewLine(text: text, secondary: sink.secondary)
    }
}

private func overviewBulletText(_ bullet: OverviewBullet, lang: String, radius: String, sink: KoSink) -> String {
    {
        switch bullet {
        case .transit(let station, let bus):
            var parts: [String] = []
            if let station {
                let line = station.line.map { kitLocalized("whereAmI.overview.transitLine", lang: lang, $0) } ?? ""
                // ⚠ 인자 순서는 ko 플레이스홀더 등장 순서(direction, distance, line, name).
                parts.append(kitLocalized("whereAmI.overview.transitStation", lang: lang,
                                          directionWord(station.bearing, lang: lang),
                                          formatDistance(station.distanceMeters),
                                          line,
                                          pickName(station.name, en: station.nameEn, roman: nil, lang: lang, sink: sink)))
            } else {
                parts.append(kitLocalized("whereAmI.overview.transitNoStation", lang: lang, radius))
            }
            switch bus {
            case .ok(let count, let nearest):
                parts.append(kitLocalized("whereAmI.overview.transitBus", lang: lang,
                                          count, overviewNearest(nearest, lang: lang, sink: sink)))
            case .empty: parts.append(kitLocalized("whereAmI.overview.transitBusNone", lang: lang))
            case .uncovered: parts.append(kitLocalized("whereAmI.overview.transitBusUncovered", lang: lang))
            case .failed: parts.append(kitLocalized("whereAmI.overview.transitBusFailed", lang: lang))
            case nil: break
            }
            return kitLocalized("whereAmI.overview.transitLead", lang: lang, parts.joined(separator: " "))
        case .place(let kind, let state):
            let label = overviewLabel(kind, lang: lang)
            switch state {
            case .ok(let count, let capped, let nearest):
                return kitLocalized(capped ? "whereAmI.overview.okCapped" : "whereAmI.overview.ok", lang: lang,
                                    withSubject(label, lang: lang), String(count),
                                    overviewNearest(nearest, lang: lang, sink: sink))
            case .empty:
                return kitLocalized("whereAmI.overview.none", lang: lang, withTopic(label, lang: lang), radius)
            case .unavailableSeoulOnly:
                return kitLocalized("whereAmI.overview.unavailableSeoulOnly", lang: lang, withTopic(label, lang: lang))
            case .failed: return kitLocalized("whereAmI.overview.failedItem", lang: lang, label)
            }
        }
    }()
}
