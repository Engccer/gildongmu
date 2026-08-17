import Foundation

/// 채팅 산문의 블록 하나. 뷰가 블록마다 별도 Text(=별도 접근성 객체)로 렌더한다.
/// 산문 전체를 단일 Text로 렌더하면 VoiceOver에 통짜 객체 하나로 노출돼
/// 단락·헤딩 구조 탐색이 불가능하다(위원장 실기기 실측 2026-07-18).
/// 웹 react-markdown이 블록마다 DOM 노드를 만드는 것의 iOS 문법.
public enum ChatMarkdownBlock: Equatable, Sendable {
    /// 헤딩(마커 제거된 내용). 뷰가 .isHeader trait을 부여해 로터 헤딩 탐색 지원.
    case heading(String)
    /// 리스트 항목(표시용 텍스트 완성형: 비순서는 "• 내용", 순서는 "1. 내용" 그대로).
    case listItem(String)
    /// 단락(빈 줄로 구분, 내부 줄바꿈 보존).
    case paragraph(String)

    /// 블록의 표시 텍스트(인라인 강조 마커 포함). 장소 언급 대응(`chatPlaceMentions`)의 입력.
    public var text: String {
        switch self {
        case .heading(let t), .listItem(let t), .paragraph(let t): return t
        }
    }
}

/// 블록 마크다운을 파싱한다. 인라인 강조(`**`)는 건드리지 않고 각 블록 텍스트에 남긴다
/// (뷰가 인라인 전용 AttributedString으로 마저 해석). 리스트 마커 뒤 공백이 필수라
/// "**강조**"·"*기울임*" 같은 줄 시작 인라인 문법은 리스트로 오인하지 않는다.
public func parseChatMarkdownBlocks(_ text: String) -> [ChatMarkdownBlock] {
    var blocks: [ChatMarkdownBlock] = []
    var paragraph: [String] = []

    func flushParagraph() {
        guard !paragraph.isEmpty else { return }
        blocks.append(.paragraph(paragraph.joined(separator: "\n")))
        paragraph = []
    }

    for lineSub in text.split(separator: "\n", omittingEmptySubsequences: false) {
        let line = String(lineSub)
        if line.trimmingCharacters(in: .whitespaces).isEmpty {
            flushParagraph()
        } else if let match = line.wholeMatch(of: /^\s{0,3}#{1,6}\s+(.*)$/) {
            flushParagraph()
            blocks.append(.heading(String(match.output.1)))
        } else if let match = line.wholeMatch(of: /^\s*[-*+]\s+(.*)$/) {
            flushParagraph()
            blocks.append(.listItem("• \(match.output.1)"))
        } else if let match = line.wholeMatch(of: /^\s*(\d+[.)]\s+.*)$/) {
            flushParagraph()
            blocks.append(.listItem(String(match.output.1)))
        } else {
            paragraph.append(line)
        }
    }
    flushParagraph()
    return blocks
}
