import Foundation

// "현재 위치 정위" ko 산문 빌더 — 웹 `src/lib/where-am-i.ts`의 buildLocationNarrative +
// `messages/ko.json`의 whereAmI.narrative.*·direction.*·category.* 문구를 평문으로 미러.
// 웹은 t.rich 태그(<name></name> 등)로 5개 언어를 렌더하지만, 강조 태그는 스크린 리더
// 낭독에 영향이 없어 iOS는 태그 없이 같은 ko 문장을 문자열로 조립한다(ko 전용, 다국어는
// iOS 범위 밖).

private let landmarkCap = 6

private let directionKo: [String: String] = [
    "n": "북", "ne": "북동", "e": "동", "se": "남동",
    "s": "남", "sw": "남서", "w": "서", "nw": "북서",
]

private let categoryKo: [String: String] = [
    "convenience": "편의점", "subway": "지하철역", "restaurant": "음식점",
    "cafe": "카페", "bank": "은행", "pharmacy": "약국", "hospital": "병원",
    "mart": "마트", "public": "공공기관", "attraction": "관광명소",
]

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

/// 웹 formatDistance 미러: 1000m 미만은 "{m}m", 이상은 소수 첫째자리 "{km}km".
private func formatDistanceKo(_ meters: Int) -> String {
    if meters < 1000 { return "\(meters)m" }
    return String(format: "%.1fkm", Double(meters) / 1000)
}

/// 첫 non-nil·non-empty 값 반환(웹 `||` 폴백 동형, `PlaceProjection.swift`의
/// firstNonEmpty와 동일 접근). 빈 문자열 조각이 트레일링 쉼표로 낭독되는 것을 막는다.
private func firstNonEmpty(_ values: String?...) -> String? {
    for value in values {
        if let value, !value.isEmpty { return value }
    }
    return nil
}

/// WhereAmIData → ko 산문 단락 배열. 단락1(위치+근접역)·단락2(주변 기준점 상위
/// landmarkCap) 순. 빈 조각(주소·행정동 둘 다 없음, 근접역 없음, 기준점 없음)은
/// 해당 문장·단락을 통째로 생략한다.
public func buildLocationNarrativeKo(_ data: WhereAmIData) -> [String] {
    var paragraphs: [String] = []

    var sentences: [String] = []
    let rawRoad = firstNonEmpty(data.address?.road, data.address?.jibun)
    let road = rawRoad.map { stripRegionPrefix(data.region, $0) }
    let placeParts = [firstNonEmpty(data.region), road].compactMap { $0 }
    if !placeParts.isEmpty {
        sentences.append("현재 위치는 \(placeParts.joined(separator: ", "))입니다.")
    }
    if let station = data.nearestStation {
        let lineSuffix = station.line.map { " (\($0))" } ?? ""
        let direction = directionKo[station.bearing] ?? station.bearing
        let distance = formatDistanceKo(station.distanceMeters)
        sentences.append("가장 가까운 지하철역은 \(station.name)\(lineSuffix), \(direction)쪽 약 \(distance)입니다.")
    }
    if !sentences.isEmpty {
        paragraphs.append(sentences.joined(separator: " "))
    }

    let landmarks = data.landmarks.prefix(landmarkCap)
    if !landmarks.isEmpty {
        let items = landmarks.map { landmark -> String in
            let direction = directionKo[landmark.bearing] ?? landmark.bearing
            let distance = formatDistanceKo(landmark.distanceMeters)
            let category = categoryKo[landmark.category] ?? landmark.category
            return "\(direction)쪽 약 \(distance)에 \(landmark.name) \(category)"
        }
        paragraphs.append("주변에는 " + items.joined(separator: ", ") + " 등이 있습니다.")
    }

    return paragraphs
}
