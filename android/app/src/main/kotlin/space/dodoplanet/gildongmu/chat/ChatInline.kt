package space.dodoplanet.gildongmu.chat

/**
 * 블록 하나의 인라인 마크다운을 걷은 결과(spec §3-5). [plain]이 화면·낭독 텍스트이고 [bold]·[code]는 [plain] 인덱스 구간(양끝 포함)이다.
 * 화면은 이것을 `AnnotatedString` 스팬으로 옮긴다 — 스팬은 접근성 노드를 쪼개지 않는다(링크는 쪼개므로 만들지 않는다).
 */
data class ChatInlineText(val plain: String, val bold: List<IntRange>, val code: List<IntRange>)

private const val ESCAPABLE = "\\`*_~[]()#"

/**
 * iOS `AttributedString(markdown:, .inlineOnlyPreservingWhitespace)`가 기호를 걷는 것의 최소 대응. 블록 문법(헤딩·목록 표지)은
 * `:kit` `parseChatMarkdownBlocks`가 이미 처리했으므로 인라인만 본다. 짝을 못 찾은 기호는 원문 문자로 남긴다(글자를 잃지 않는다).
 * - `**x**`·`__x__` → 굵게, `` `x` `` → 고정폭, `~~x~~` → 기호만 걷음, `[label](url)` → label(URL 버림)
 * - `*x*`는 여는 기호 뒤와 닫는 기호 앞이 공백이 아닐 때만(곱셈 `2 * 3`을 지키려고), `_x_`는 걷지 않는다(snake_case)
 * - `\*` 같은 이스케이프는 역슬래시만 걷는다
 */
fun chatInlineText(text: String): ChatInlineText {
    val out = StringBuilder()
    val bold = ArrayList<IntRange>()
    val code = ArrayList<IntRange>()

    fun appendNested(inner: String): IntRange {
        val parsed = chatInlineText(inner)
        val start = out.length
        out.append(parsed.plain)
        parsed.bold.forEach { bold += (it.first + start)..(it.last + start) }
        parsed.code.forEach { code += (it.first + start)..(it.last + start) }
        return start until out.length
    }

    var i = 0
    while (i < text.length) {
        val c = text[i]
        if (c == '\\' && i + 1 < text.length && text[i + 1] in ESCAPABLE) {
            out.append(text[i + 1])
            i += 2
            continue
        }
        if (c == '`') {
            val end = text.indexOf('`', i + 1)
            if (end > i + 1) {
                val start = out.length
                out.append(text, i + 1, end)
                code += start until out.length
                i = end + 1
                continue
            }
        }
        if (text.startsWith("**", i) || text.startsWith("__", i) || text.startsWith("~~", i)) {
            val marker = text.substring(i, i + 2)
            val end = text.indexOf(marker, i + 2)
            if (end > i + 2) {
                val range = appendNested(text.substring(i + 2, end))
                if (marker != "~~") bold += range
                i = end + 2
                continue
            }
        }
        if (c == '[') {
            val close = text.indexOf("](", i + 1)
            val paren = if (close > i + 1) text.indexOf(')', close + 2) else -1
            if (paren > close + 2) {
                appendNested(text.substring(i + 1, close))
                i = paren + 1
                continue
            }
        }
        if (c == '*' && i + 1 < text.length && text[i + 1] != '*' && !text[i + 1].isWhitespace()) {
            val end = text.indexOf('*', i + 2)
            if (end > i + 1 && !text[end - 1].isWhitespace()) {
                appendNested(text.substring(i + 1, end))
                i = end + 1
                continue
            }
        }
        out.append(c)
        i += 1
    }
    return ChatInlineText(out.toString(), bold, code)
}
