import Foundation

/// 채팅 산문 마크다운을 인라인 전용 렌더러(AttributedString
/// `inlineOnlyPreservingWhitespace`)가 감당할 수 있는 형태로 평탄화한다.
/// 블록 문법(헤딩 `#`·리스트 마커 `*`/`-`/`+`)은 인라인 파서가 해석하지 못해
/// 리터럴로 노출되고 VoiceOver가 기호를 그대로 낭독하므로(prod 실호출로 확정),
/// 헤딩 마커는 제거하고 리스트 마커는 글머리표(•)로 치환한다.
/// 인라인 강조(`**`)·본문·줄바꿈·들여쓰기는 그대로 보존(웹 헤딩 다운그레이드의 iOS 문법).
public func flattenBlockMarkdown(_ text: String) -> String {
    text.split(separator: "\n", omittingEmptySubsequences: false).map { line -> String in
        // 헤딩: 선행 공백 0~3 + #{1,6} + 공백 → 마커 제거(내용만)
        if let match = line.wholeMatch(of: /^\s{0,3}#{1,6}\s+(.*)$/) {
            return String(match.output.1)
        }
        // 리스트: 마커 뒤 공백 필수라 "**강조**"·"*기울임*" 같은 인라인 문법은 안 건드림
        if let match = line.wholeMatch(of: /^(\s*)[-*+]\s+(.*)$/) {
            return "\(match.output.1)• \(match.output.2)"
        }
        return String(line)
    }.joined(separator: "\n")
}
