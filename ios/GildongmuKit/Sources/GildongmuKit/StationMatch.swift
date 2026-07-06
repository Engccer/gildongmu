import Foundation

// 장소가 철도/지하철 역인지 판정하고, 역 이름을 매칭 키로 정규화한다.
// 웹 `src/lib/station-match.ts` 미러(계약 정본은 웹). 순수 함수만(뷰·서비스 비의존).

/// "Station"은 카테고리에서 제외한다. "Stationery"(문구) 등을 역으로 오판하기
/// 때문. 영문 역 판정은 이름 접미사(station$, 대소문자 무시)에만 맡긴다.
private let stationCategoryPattern = "지하철|전철|철도|기차|Subway|Metro|Railway|Train"

/// 장소가 철도/지하철 역인지: 카테고리 키워드 또는 이름 접미사("역"/"station")로 판정.
public func isStation(_ place: Place) -> Bool {
    if place.category.range(of: stationCategoryPattern, options: [.regularExpression, .caseInsensitive]) != nil {
        return true
    }
    let name = place.name.trimmingCharacters(in: .whitespacesAndNewlines)
    return name.hasSuffix("역") || name.lowercased().hasSuffix("station")
}

/// 역 이름 정규화: 접미사(역/station) 제거, trim·소문자(매칭 키).
public func normalizeStationName(_ name: String) -> String {
    var normalized = name.trimmingCharacters(in: .whitespacesAndNewlines)
    if let range = normalized.range(of: "\\s*station$", options: [.regularExpression, .caseInsensitive]) {
        normalized.removeSubrange(range)
    }
    if normalized.hasSuffix("역") {
        normalized.removeLast()
    }
    return normalized.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
}
