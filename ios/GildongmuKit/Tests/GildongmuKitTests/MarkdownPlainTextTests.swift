import Testing
@testable import GildongmuKit

/// TTS 낭독용 마크다운 평문 변환 검증(dodo 이식 규칙 — 웹 `markdownToPlainText` 동형).
struct MarkdownPlainTextTests {
    @Test func 헤딩_기호_제거() {
        #expect(MarkdownPlainText.strip(from: "## 경복궁 안내\n본문") == "경복궁 안내\n본문")
    }

    @Test func 강조_취소선_언랩() {
        #expect(MarkdownPlainText.strip(from: "**맑음**과 *바람*, ~~비~~") == "맑음과 바람, 비")
    }

    @Test func 링크는_라벨만_남기고_URL_폐기() {
        let input = "자세한 정보는 [카카오맵](https://map.kakao.com/place/123)을 확인하세요."
        #expect(MarkdownPlainText.strip(from: input) == "자세한 정보는 카카오맵을 확인하세요.")
    }

    @Test func 리스트_마커는_불릿으로() {
        #expect(MarkdownPlainText.strip(from: "- 첫째\n- 둘째") == "• 첫째\n• 둘째")
    }

    @Test func 번호_목록_마커_제거() {
        #expect(MarkdownPlainText.strip(from: "1. 첫째\n2. 둘째") == "첫째\n둘째")
    }

    @Test func 코드블록은_펜스만_벗기고_내용_유지() {
        #expect(MarkdownPlainText.strip(from: "```swift\nlet a = 1\n```") == "let a = 1")
    }

    @Test func 인라인_코드_백틱_제거() {
        #expect(MarkdownPlainText.strip(from: "`nmap://` 스킴") == "nmap:// 스킴")
    }

    @Test func 과잉_개행_축소와_트림() {
        #expect(MarkdownPlainText.strip(from: "\n\n첫 단락\n\n\n\n둘째 단락\n") == "첫 단락\n\n둘째 단락")
    }

    @Test func 인용부호_수평선_제거() {
        #expect(MarkdownPlainText.strip(from: "> 인용문\n---\n본문") == "인용문\n\n본문")
    }

    @Test func 평문은_그대로() {
        #expect(MarkdownPlainText.strip(from: "그냥 평범한 문장입니다.") == "그냥 평범한 문장입니다.")
    }
}
