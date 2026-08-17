import Foundation

/// 산문 블록 안에서 그 답변의 카드 장소가 언급된 것을 찾는다(채팅 산문 커스텀 액션
/// "○○ 상세 보기"의 근거). 산문은 LLM 자유 텍스트라 장소를 아는 층이 없고, 유일한
/// 근거가 같은 답변의 렌더 카드 장소다. 결정론 부분 문자열 매칭:
/// - 긴 이름부터 대응하고 대응 구간을 같은 길이로 가려 짧은 이름이 긴 이름 안에서
///   재매칭되지 않게 한다("이마트" ⊂ "이마트24 길동점").
/// - 반환은 산문 첫 등장 순. 같은 이름은 한 번만(액션 라벨이 같아 구분 불가).
/// - LLM이 이름을 줄여 쓰면 그 장소는 잡히지 않는다 — 카드가 안전망이라 의도된 한계.
public func chatPlaceMentions(in text: String, places: [Place]) -> [Place] {
    guard !text.isEmpty else { return [] }
    var masked = Array(text)
    var found: [(offset: Int, place: Place)] = []
    var seenNames = Set<String>()
    let ordered = places
        .filter { !$0.name.isEmpty }
        .sorted { $0.name.count > $1.name.count }
    for place in ordered {
        guard !seenNames.contains(place.name) else { continue }
        let name = Array(place.name)
        var offset = 0
        var first: Int?
        while offset + name.count <= masked.count {
            if Array(masked[offset..<(offset + name.count)]) == name {
                if first == nil { first = offset }
                for i in offset..<(offset + name.count) { masked[i] = "\u{0}" }
                offset += name.count
            } else {
                offset += 1
            }
        }
        if let first {
            seenNames.insert(place.name)
            found.append((first, place))
        }
    }
    return found.sorted { $0.offset < $1.offset }.map(\.place)
}
