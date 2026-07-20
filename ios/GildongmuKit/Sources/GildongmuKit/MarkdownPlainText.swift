import Foundation

/// 마크다운 표시 문법을 제거해 TTS가 문법 기호까지 그대로 읽지 않게 만드는 평문 변환
/// (dodo-planet `TtsPlayer.swift`의 `MarkdownPlainText` 이식 — 웹 `markdownToPlainText`와
/// 동일한 규칙·순서다. 겹치는 패턴이 있어 순서가 결과에 영향을 준다).
///
/// 링크 `[label](url)`은 label만 남기고 URL을 버린다 — 응답 본문에 링크가 섞여도
/// TTS가 URL 문자열을 낭독하지 않는다(출처 목록은 애초에 본문 밖 `sources` 필드라 무관).
public enum MarkdownPlainText {
    public static func strip(from markdown: String) -> String {
        var text = stripCodeBlocks(markdown)
        text = replace(#"`([^`]+)`"#, in: text, with: "$1")
        text = replace(#"^#{1,6}\s+"#, in: text, lineAnchored: true, with: "")
        text = replace(#"\*\*([^*]+)\*\*"#, in: text, with: "$1")
        text = replace(#"__([^_]+)__"#, in: text, with: "$1")
        text = replace(#"\*([^*]+)\*"#, in: text, with: "$1")
        text = replace(#"_([^_]+)_"#, in: text, with: "$1")
        text = replace(#"~~([^~]+)~~"#, in: text, with: "$1")
        text = replace(#"\[([^\]]+)\]\([^)]+\)"#, in: text, with: "$1")
        text = replace(#"!\[([^\]]*)\]\([^)]+\)"#, in: text, with: "$1")
        text = replace(#"^[-*_]{3,}\s*$"#, in: text, lineAnchored: true, with: "")
        text = replace(#"^>\s+"#, in: text, lineAnchored: true, with: "")
        text = replace(#"^\s*[-*+]\s+"#, in: text, lineAnchored: true, with: "• ")
        text = replace(#"^\s*\d+\.\s+"#, in: text, lineAnchored: true, with: "")
        text = replace(#"\n{3,}"#, in: text, with: "\n\n")
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// ```` ```code``` ```` 블록만 언어 태그·펜스를 벗기고 내용을 남긴다(다른 패턴과 달리
    /// 매치별 변형이 필요해 단순 템플릿 치환으로 표현할 수 없다).
    private static func stripCodeBlocks(_ text: String) -> String {
        guard let regex = try? NSRegularExpression(pattern: "```[\\s\\S]*?```") else { return text }
        let nsText = text as NSString
        var result = ""
        var lastEnd = 0
        regex.enumerateMatches(in: text, range: NSRange(location: 0, length: nsText.length)) { match, _, _ in
            guard let match else { return }
            result += nsText.substring(with: NSRange(location: lastEnd, length: match.range.location - lastEnd))
            let block = nsText.substring(with: match.range)
            let code = block
                .replacingOccurrences(of: #"```\w*\n?"#, with: "", options: .regularExpression)
                .replacingOccurrences(of: "```", with: "")
            result += code.trimmingCharacters(in: .whitespacesAndNewlines)
            lastEnd = match.range.location + match.range.length
        }
        result += nsText.substring(from: lastEnd)
        return result
    }

    private static func replace(_ pattern: String, in text: String, lineAnchored: Bool = false, with template: String) -> String {
        let options: NSRegularExpression.Options = lineAnchored ? [.anchorsMatchLines] : []
        guard let regex = try? NSRegularExpression(pattern: pattern, options: options) else { return text }
        let range = NSRange(text.startIndex..., in: text)
        return regex.stringByReplacingMatches(in: text, range: range, withTemplate: template)
    }
}
