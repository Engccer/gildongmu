import Foundation

// 장소가 철도/지하철 역인지 판정한다.
// 역명 매칭은 서버 몫(`StationSections.swift` 참조) — 웹 `station-match.ts`의 확장
// 정규화(`stripStationDecorations`·`lineHint`)는 iOS에 미러하지 않는다.
// `isStation` 판정만 웹 미러. 순수 함수만(뷰·서비스 비의존).

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
