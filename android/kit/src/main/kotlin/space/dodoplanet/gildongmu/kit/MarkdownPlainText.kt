package space.dodoplanet.gildongmu.kit

/**
 * 마크다운 표시 문법을 제거해 TTS가 문법 기호까지 그대로 읽지 않게 만드는 평문 변환. Kit
 * `MarkdownPlainText.swift` 미러(dodo-planet 이식 규칙 — 웹 `markdownToPlainText`와 같은 규칙·순서다.
 * 겹치는 패턴이 있어 순서가 결과에 영향을 준다).
 *
 * 링크 `[label](url)`은 label만 남기고 URL을 버린다 — 응답 본문에 링크가 섞여도 TTS가 URL 문자열을
 * 낭독하지 않는다(출처 목록은 애초에 본문 밖 `sources` 필드라 무관).
 *
 * 정규식 약칭 클래스(공백·숫자·단어 문자)는 쓰지 않는다 — JVM은 ASCII, 안드로이드 ICU·Swift ICU는 유니코드라 테스트와 기기가
 * 갈린다. 명시 클래스는 ICU 뜻을 옮긴 것이다: 공백은 White_Space 속성, 숫자는 `\p{Nd}`, 단어 문자는 문자·결합 부호·숫자·연결 부호.
 */
object MarkdownPlainText {
    private const val WS = """[\t\n\u000B\f\r\u0085\p{Z}]"""
    private const val WORD = """[\p{L}\p{M}\p{Nd}\p{Pc}]"""

    private val inlineCode = Regex("`([^`]+)`")
    private val heading = Regex("""^#{1,6}$WS+""", RegexOption.MULTILINE)
    private val bold = Regex("""\*\*([^*]+)\*\*""")
    private val boldUnderscore = Regex("__([^_]+)__")
    private val italic = Regex("""\*([^*]+)\*""")
    private val italicUnderscore = Regex("_([^_]+)_")
    private val strike = Regex("~~([^~]+)~~")
    private val link = Regex("""\[([^\]]+)\]\([^)]+\)""")
    private val image = Regex("""!\[([^\]]*)\]\([^)]+\)""")
    private val rule = Regex("""^[-*_]{3,}$WS*$""", RegexOption.MULTILINE)
    private val quote = Regex("""^>$WS+""", RegexOption.MULTILINE)
    private val bullet = Regex("""^$WS*[-*+]$WS+""", RegexOption.MULTILINE)
    private val ordered = Regex("""^$WS*\p{Nd}+\.$WS+""", RegexOption.MULTILINE)
    private val excessNewlines = Regex("""\n{3,}""")
    private val codeBlock = Regex("""```(?s:.)*?```""")
    private val fenceOpen = Regex("""```$WORD*\n?""")

    fun strip(markdown: String): String {
        var text = stripCodeBlocks(markdown)
        text = inlineCode.replace(text, "$1")
        text = heading.replace(text, "")
        text = bold.replace(text, "$1")
        text = boldUnderscore.replace(text, "$1")
        text = italic.replace(text, "$1")
        text = italicUnderscore.replace(text, "$1")
        text = strike.replace(text, "$1")
        text = link.replace(text, "$1")
        text = image.replace(text, "$1")
        text = rule.replace(text, "")
        text = quote.replace(text, "")
        text = bullet.replace(text, "• ")
        text = ordered.replace(text, "")
        text = excessNewlines.replace(text, "\n\n")
        return text.trim()
    }

    /** 코드 펜스 블록만 언어 태그·펜스를 벗기고 내용을 남긴다(매치별 변형이 필요해 템플릿 치환과 따로 둔다). */
    private fun stripCodeBlocks(text: String): String =
        codeBlock.replace(text) { match -> fenceOpen.replace(match.value, "").replace("```", "").trim() }
}
