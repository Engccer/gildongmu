import Testing
@testable import GildongmuKit

/// E72 줄 안 대상 링크 범위(spec 2026-10-17-e72-visible-row-actions-design.md §3.1).
struct InlineTargetSpansTests {
    private func linked(_ text: String, _ spans: [InlineTargetSpan]) -> [String] {
        let chars = Array(text)
        return spans.map { "\(String(chars[$0.start..<($0.start + $0.length)]))#\($0.target)" }
    }

    @Test func linksEveryOccurrenceInOrder() {
        let text = "천호에서 강동까지, 다시 천호"
        let spans = inlineTargetSpans(in: text, names: ["강동", "천호"], avoiding: [])
        #expect(linked(text, spans) == ["천호#1", "강동#0", "천호#1"])
    }

    @Test func longerNameWinsOverItsPrefix() {
        let text = "강남구청과 강남, 강남 300m"
        let spans = inlineTargetSpans(in: text, names: ["강남", "강남구청"], avoiding: [])
        #expect(linked(text, spans) == ["강남구청#1", "강남#0", "강남#0"])
    }

    @Test func avoidedWordBlocksNameInside() {
        // 브리핑 구간 줄은 노선 이름이 먼저 온다 — 「신림선」 안의 「신림」은 링크가 아니다.
        let text = "신림선, 신림 승차, 관악산 하차"
        let spans = inlineTargetSpans(in: text, names: ["신림", "관악산"], avoiding: ["신림선"])
        #expect(linked(text, spans) == ["신림#0", "관악산#1"])
        #expect(spans.first?.start == 5)
    }

    @Test func missingAndEmptyNamesHaveNoSpan() {
        let text = "Gangnam (강남), Line 2"
        let spans = inlineTargetSpans(in: text, names: ["", "Yeouido", "Gangnam"], avoiding: [])
        #expect(linked(text, spans) == ["Gangnam#2"])
    }

    @Test func offsetsAreCharacterCounts() {
        // 한글 음절·결합 문자는 Character 하나다(AttributedString.characters와 같은 단위).
        let text = "é 카페 ☕︎ 카페"
        let spans = inlineTargetSpans(in: text, names: ["카페"], avoiding: [])
        #expect(spans.map(\.start) == [2, 7])
    }
}
