package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** 채팅 산문 블록 분할 — Kit `ChatModelsTests.parseChatMarkdownBlocks*`(foundation.json 유예분) 미러. */
class ChatMarkdownTest {
    @Test fun parseChatMarkdownBlocksSplitsHeadingListAndParagraph() {
        // prod 실호출 실측 형태: ### 헤딩 + "* **볼드**: 설명" 리스트 + 단락들
        val input = "### 편의점 및 마트\n* **CU 강동풍차점**: 북동쪽 10m\n  - 세부 항목\n1. 순서 목록\n\n첫 단락 첫 줄\n첫 단락 둘째 줄\n\n둘째 단락 **강조** 유지"
        assertEquals(
            listOf(
                ChatMarkdownBlock.Heading("편의점 및 마트"),
                ChatMarkdownBlock.ListItem("• **CU 강동풍차점**: 북동쪽 10m"),
                ChatMarkdownBlock.ListItem("• 세부 항목"),
                ChatMarkdownBlock.ListItem("1. 순서 목록"),
                ChatMarkdownBlock.Paragraph("첫 단락 첫 줄\n첫 단락 둘째 줄"),
                ChatMarkdownBlock.Paragraph("둘째 단락 **강조** 유지"),
            ),
            parseChatMarkdownBlocks(input),
        )
    }

    @Test fun parseChatMarkdownBlocksPlainTextIsSingleParagraph() {
        // 블록 문법이 없으면 단락 하나(내부 줄바꿈·중간 해시 보존), 줄 시작 *기울임*은 리스트 아님
        val input = "안녕하세요. # 중간 해시 유지\n*기울임*은 리스트 아님"
        assertEquals(listOf(ChatMarkdownBlock.Paragraph(input)), parseChatMarkdownBlocks(input))
    }

    /** 공백·숫자는 유니코드 뜻이다(Swift Regex와 같다, JVM 약칭 클래스의 ASCII 뜻이 아니다) — NBSP 뒤 헤딩, 전각 숫자 목록. */
    @Test fun unicodeWhitespaceAndDigitsMatchSwift() {
        assertEquals(listOf(ChatMarkdownBlock.Heading("주변 정보")), parseChatMarkdownBlocks("#\u00A0주변 정보"))
        assertEquals(listOf(ChatMarkdownBlock.ListItem("• 항목")), parseChatMarkdownBlocks("-\u3000항목"))
        assertEquals(listOf(ChatMarkdownBlock.ListItem("１. 항목")), parseChatMarkdownBlocks("１. 항목"))
    }

    /** `isHeading`·`text`는 케이스와 무관하게 표시 텍스트를 준다(장소 언급 대응의 입력). */
    @Test fun blockAccessors() {
        val blocks = parseChatMarkdownBlocks("# 제목\n- 항목\n본문")
        assertTrue(blocks[0].isHeading)
        assertFalse(blocks[1].isHeading)
        assertEquals(listOf("제목", "• 항목", "본문"), blocks.map { it.text })
    }
}
