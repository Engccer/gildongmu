import Foundation

/// 줄 안 대상 이름 하나의 링크 범위(E72 위원장 판정 3·4). 위치는 `Character` 단위 오프셋이다 — 앱이
/// `AttributedString.characters`에 같은 오프셋으로 링크를 입힌다(마크다운 해석 뒤 문자열 기준).
public struct InlineTargetSpan: Equatable, Sendable {
    public let start: Int
    public let length: Int
    /// `names`의 순번(= 소비자의 대상 순번, 링크 탭이 이 값으로 대상을 고른다).
    public let target: Int

    public init(start: Int, length: Int, target: Int) {
        self.start = start
        self.length = length
        self.target = target
    }
}

/// 각 이름의 모든 등장에 링크 범위를 낸다(시작 위치 순).
///
/// - **`avoiding`의 등장은 먼저 막는다**: 노선 이름 안의 역 이름(「신림선」 안의 「신림」)처럼 대상이 아닌 낱말
///   속에 이름이 들어 있으면 그 자리는 링크가 아니다.
/// - **긴 이름부터** 걸고 이미 잡힌 범위와 겹치는 등장은 건너뛴다(「강남」과 「강남구청」이 함께 대상이면
///   「강남구청」 안의 「강남」을 걸지 않는다).
/// - 못 찾은 이름·빈 이름은 범위가 없다(소비자의 로터는 그대로 남는다).
public func inlineTargetSpans(in text: String, names: [String], avoiding: [String]) -> [InlineTargetSpan] {
    let chars = Array(text)
    var occupied = [Bool](repeating: false, count: chars.count)
    var spans: [InlineTargetSpan] = []

    /// `needle`이 나오는 시작 위치 전부(겹치지 않게 앞에서부터).
    func occurrences(of needle: [Character]) -> [Int] {
        guard !needle.isEmpty, needle.count <= chars.count else { return [] }
        var found: [Int] = []
        var i = 0
        while i + needle.count <= chars.count {
            if Array(chars[i..<(i + needle.count)]) == needle {
                found.append(i)
                i += needle.count
            } else {
                i += 1
            }
        }
        return found
    }

    for word in avoiding.map(Array.init).sorted(by: { $0.count > $1.count }) {
        for start in occurrences(of: word) {
            for k in start..<(start + word.count) { occupied[k] = true }
        }
    }
    let order = names.indices.sorted { names[$0].count > names[$1].count }
    for target in order {
        let needle = Array(names[target])
        for start in occurrences(of: needle) where !occupied[start..<(start + needle.count)].contains(true) {
            for k in start..<(start + needle.count) { occupied[k] = true }
            spans.append(InlineTargetSpan(start: start, length: needle.count, target: target))
        }
    }
    return spans.sorted { $0.start < $1.start }
}
