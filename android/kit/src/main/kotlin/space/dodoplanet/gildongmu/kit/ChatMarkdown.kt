package space.dodoplanet.gildongmu.kit

/**
 * 채팅 산문의 블록 하나. Kit `ChatMarkdown.swift` 미러. 화면이 블록마다 별도 텍스트(=별도 접근성 객체)로
 * 렌더한다. 산문 전체를 한 텍스트로 렌더하면 스크린 리더에 통짜 객체 하나로 노출돼 단락·헤딩 구조 탐색이
 * 불가능하다(iOS 실기기 실측). 웹 react-markdown이 블록마다 DOM 노드를 만드는 것의 대응.
 */
sealed class ChatMarkdownBlock {
    /** 블록의 표시 텍스트(인라인 강조 마커 포함). 장소 언급 대응(`chatPlaceMentions`)의 입력. */
    abstract val text: String

    val isHeading: Boolean get() = this is Heading

    /** 헤딩(마커 제거된 내용). 화면이 헤딩 semantics를 부여해 헤딩 탐색을 지원한다. */
    data class Heading(override val text: String) : ChatMarkdownBlock()

    /** 리스트 항목(표시용 텍스트 완성형: 비순서는 "• 내용", 순서는 "1. 내용" 그대로). */
    data class ListItem(override val text: String) : ChatMarkdownBlock()

    /** 단락(빈 줄로 구분, 내부 줄바꿈 보존). */
    data class Paragraph(override val text: String) : ChatMarkdownBlock()
}

/** 유니코드 공백(White_Space 속성) — Swift Regex 공백 약칭 클래스와 같은 뜻. 약칭 클래스는 JVM(ASCII)과 기기(ICU)에서 갈려 쓰지 않는다. 숫자는 `\p{N}`(Swift `Character.isNumber` — 로마 숫자 `Ⅰ`·원문자 `①` 포함, Numeric_Type만 가진 한자 숫자는 JVM 대응 속성이 없어 제외). */
private const val WS = """[\t\n\u000B\f\r\u0085\p{Z}]"""

private val HEADING_LINE = Regex("""^$WS{0,3}#{1,6}$WS+(.*)$""")
private val BULLET_LINE = Regex("""^$WS*[-*+]$WS+(.*)$""")
private val ORDERED_LINE = Regex("""^$WS*(\p{N}+[.)]$WS+.*)$""")

/**
 * 블록 마크다운을 파싱한다. 인라인 강조(`**`)는 건드리지 않고 각 블록 텍스트에 남긴다(화면이 인라인만
 * 마저 해석). 리스트 마커 뒤 공백이 필수라 "**강조**"·"*기울임*" 같은 줄 시작 인라인 문법은 리스트로
 * 오인하지 않는다.
 */
fun parseChatMarkdownBlocks(text: String): List<ChatMarkdownBlock> {
    val blocks = ArrayList<ChatMarkdownBlock>()
    val paragraph = ArrayList<String>()

    fun flushParagraph() {
        if (paragraph.isEmpty()) return
        blocks.add(ChatMarkdownBlock.Paragraph(paragraph.joinToString("\n")))
        paragraph.clear()
    }

    for (line in text.split("\n")) {
        if (line.isBlank()) {
            flushParagraph()
            continue
        }
        val heading = HEADING_LINE.matchEntire(line)
        if (heading != null) {
            flushParagraph()
            blocks.add(ChatMarkdownBlock.Heading(heading.groupValues[1]))
            continue
        }
        val bullet = BULLET_LINE.matchEntire(line)
        if (bullet != null) {
            flushParagraph()
            blocks.add(ChatMarkdownBlock.ListItem("• ${bullet.groupValues[1]}"))
            continue
        }
        val ordered = ORDERED_LINE.matchEntire(line)
        if (ordered != null) {
            flushParagraph()
            blocks.add(ChatMarkdownBlock.ListItem(ordered.groupValues[1]))
            continue
        }
        paragraph.add(line)
    }
    flushParagraph()
    return blocks
}
