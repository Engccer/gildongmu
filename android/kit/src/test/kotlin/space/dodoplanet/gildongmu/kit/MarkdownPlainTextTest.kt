package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertEquals

/** TTS 낭독용 마크다운 평문 변환 검증(Kit `MarkdownPlainTextTests` 미러 — dodo 이식 규칙, 웹 `markdownToPlainText` 동형). */
class MarkdownPlainTextTest {
    @Test fun `헤딩 기호 제거`() {
        assertEquals("경복궁 안내\n본문", MarkdownPlainText.strip("## 경복궁 안내\n본문"))
    }

    @Test fun `강조 취소선 언랩`() {
        assertEquals("맑음과 바람, 비", MarkdownPlainText.strip("**맑음**과 *바람*, ~~비~~"))
    }

    @Test fun `링크는 라벨만 남기고 URL 폐기`() {
        assertEquals("자세한 정보는 카카오맵을 확인하세요.", MarkdownPlainText.strip("자세한 정보는 [카카오맵](https://map.kakao.com/place/123)을 확인하세요."))
    }

    @Test fun `리스트 마커는 불릿으로`() {
        assertEquals("• 첫째\n• 둘째", MarkdownPlainText.strip("- 첫째\n- 둘째"))
    }

    @Test fun `번호 목록 마커 제거`() {
        assertEquals("첫째\n둘째", MarkdownPlainText.strip("1. 첫째\n2. 둘째"))
    }

    @Test fun `코드블록은 펜스만 벗기고 내용 유지`() {
        assertEquals("let a = 1", MarkdownPlainText.strip("```swift\nlet a = 1\n```"))
    }

    @Test fun `인라인 코드 백틱 제거`() {
        assertEquals("nmap:// 스킴", MarkdownPlainText.strip("`nmap://` 스킴"))
    }

    @Test fun `과잉 개행 축소와 트림`() {
        assertEquals("첫 단락\n\n둘째 단락", MarkdownPlainText.strip("\n\n첫 단락\n\n\n\n둘째 단락\n"))
    }

    @Test fun `인용부호 수평선 제거`() {
        assertEquals("인용문\n\n본문", MarkdownPlainText.strip("> 인용문\n---\n본문"))
    }

    @Test fun `평문은 그대로`() {
        assertEquals("그냥 평범한 문장입니다.", MarkdownPlainText.strip("그냥 평범한 문장입니다."))
    }
}
