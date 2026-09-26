package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * TTS 낭독·복사용 마크다운 평문 변환 — 웹 `markdownToPlainText`·Kit `MarkdownPlainTextTests`와 같은 공유 fixture
 * (`src/lib/__tests__/fixtures/markdown-plain-text-cases.json`)를 읽는다. 줄 머리·꼬리는 ICU 뜻(LF·CR·VT·FF·NEL·LS·PS, CRLF는 한 단위)이라
 * JVM 기본 `MULTILINE`(VT·FF를 모른다)과 기기 ICU가 갈리는 자리를 fixture가 잠근다.
 */
class MarkdownPlainTextTest {
    @Serializable
    private data class CaseFile(val cases: List<Case>)

    @Serializable
    private data class Case(val name: String, val input: String, val expect: String)

    @Test fun matchesSharedFixture() {
        val cases = Fixtures.sharedJson("markdown-plain-text-cases.json", CaseFile.serializer()).cases
        assertTrue(cases.size >= 34)
        for (c in cases) assertEquals(c.expect, MarkdownPlainText.strip(c.input), c.name)
    }

    /** 명시 클래스는 ICU 뜻이다(fixture 밖 — 플랫폼 차이 가드): 줄바꿈 없는 한글 펜스 태그, 로마 숫자 태그, NBSP 헤딩, 전각 숫자 목록. */
    @Test fun `유니코드 공백 숫자 단어 문자는 ICU와 같다`() {
        assertEquals("코드", MarkdownPlainText.strip("```한국어 코드```"))
        assertEquals("코드", MarkdownPlainText.strip("```Ⅻ\n코드```"))
        assertEquals("제목", MarkdownPlainText.strip("## 제목"))
        assertEquals("항목", MarkdownPlainText.strip("１. 항목"))
    }

    /** LS·PS도 ICU 줄 경계다(fixture엔 없다), CR 단독 뒤도 줄 머리. */
    @Test fun `LS PS CR 단독도 줄 경계`() {
        assertEquals("가 • 나", MarkdownPlainText.strip("가 - 나"))
        assertEquals("가 제목", MarkdownPlainText.strip("가 # 제목"))
        assertEquals("가\r• 나", MarkdownPlainText.strip("가\r- 나"))
    }
}
