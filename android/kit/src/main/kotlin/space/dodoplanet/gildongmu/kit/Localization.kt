package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.util.Locale
import kotlin.math.abs

// :kit 표시 문자열 조회. Kit `Localization.swift` 미러. lang을 항상 명시 인자로 받으므로
// 안드로이드 리소스(`res/values-*`)를 쓰지 않고 카탈로그 JSON을 데이터로 직접 파싱한다 —
// :kit은 안드로이드 의존이 0이고 JVM 테스트가 결정론이어야 하기 때문이다.
//
// 카탈로그 `gildongmu-kit-strings.json`은 `android/scripts/messages-to-kit-strings.mjs`가
// `messages/*.json` + `ios/i18n/kit-extra/*.json`에서 생성한다(Kit xcstrings와 같은 입력·같은
// 네임스페이스·같은 ko 위치 인자 순서, 지정자만 `%N$@` → `%N$s`). 드리프트 가드는 웹 vitest
// `android-kit-drift.test.ts`. iOS의 lproj 폴백 경로는 안드로이드에 없다.
//
// ⚠ 호출부 결함(수량 인자 누락·복수 블록 키를 인자 없이 조회)은 Swift가 `assertionFailure`/`assert`
// (디버그 전용)로 잡고 릴리스에선 조용히 진행하는데, Kotlin은 모든 빌드에서 던진다(`require`/`check`).
// 의도된 차이다 — 잘못된 호출은 컴파일 시점에 가까울수록 좋고 릴리스 문장 오류를 남기지 않는다.

/** key → (lang → 문구). 앱 수명 1회 로드(실패 시 빈 사전 = 키 그대로 노출). */
private val catalogTable: Map<String, Map<String, String>> by lazy {
    val text = KitStrings::class.java.getResourceAsStream("/gildongmu-kit-strings.json")
        ?.use { it.readBytes().decodeToString() }
        ?: return@lazy emptyMap()
    runCatching {
        Json.parseToJsonElement(text).jsonObject["strings"]!!.jsonObject.mapValues { (_, entry) ->
            entry.jsonObject.mapValues { (_, value) -> value.jsonPrimitive.content }
        }
    }.getOrDefault(emptyMap())
}

private object KitStrings

/**
 * :kit 표시 문자열 조회. 미보유 lang은 ko 폴백, 미보유 키는 키 그대로 반환. 키는 항상 문자열
 * 리터럴로 호출한다(린터 추출 계약). 인자는 `Int`·`Long`·`String`.
 */
fun kitLocalized(key: String, lang: String, vararg args: Any): String {
    val byLang = catalogTable[key]
    val format = byLang?.get(lang) ?: byLang?.get("ko") ?: key
    return formatLocalized(format, lang, args.toList())
}

// MARK: - 복수형 해석 (A29)
//
// 카탈로그는 ICU 복수 블록을 `{N, plural, one {…} other {…}}`(이름 대신 인자 인덱스, 분기 안 `#`은
// 이미 `%N$s`) 형태의 **문자열 그대로** 싣는다. 앱·:kit·테스트 세 경로가 전부 이 함수 하나를 지난다.

/**
 * CLDR 부분집합 — 지원 6로케일의 one/other 분기 선택. en·es·it은 1만 one, **fr은 0과 1이 one**,
 * ko·ja·미지 언어는 other. 공유 fixture `plural-category-cases.json`이 웹·iOS와 한 표.
 * 언어 태그는 기본 언어로 정규화한다(`fr-FR`·`fr_CA`·`EN` → `fr`·`en`). 음수는 절댓값.
 */
fun pluralCategory(count: Int, lang: String): String {
    val base = lang.split('-', '_').firstOrNull()?.lowercase() ?: lang
    val n = abs(count.toLong())
    return when (base) {
        "en", "es", "it" -> if (n == 1L) "one" else "other"
        "fr" -> if (n == 0L || n == 1L) "one" else "other"
        else -> "other"
    }
}

private class PluralBlock(val argIndex: Int, val branches: Map<String, String>, val end: Int)

/** `open`의 `{`와 짝이 되는 `}` 인덱스(깊이 계산). 없으면 null. */
private fun matchingBrace(chars: CharArray, open: Int): Int? {
    var depth = 0
    var i = open
    while (i < chars.size) {
        if (chars[i] == '{') depth += 1
        else if (chars[i] == '}') {
            depth -= 1
            if (depth == 0) return i
        }
        i += 1
    }
    return null
}

/** `{N, plural, one {…} other {…}}`를 `open` 위치에서 읽는다. 형식이 아니면 null — 그 `{`는 리터럴이다. */
private fun parsePluralBlock(chars: CharArray, open: Int): PluralBlock? {
    val close = matchingBrace(chars, open) ?: return null
    val inner = String(chars, open + 1, close - open - 1)
    val comma = inner.indexOf(',')
    if (comma < 0) return null
    val argIndex = inner.substring(0, comma).trimSwiftWhitespaces().toIntOrNull() ?: return null
    if (argIndex < 1) return null
    var rest = inner.substring(comma + 1)
    if (!rest.trimSwiftWhitespaces().startsWith("plural")) return null
    rest = rest.substring(rest.indexOf("plural") + "plural".length)
    val secondComma = rest.indexOf(',')
    if (secondComma < 0 || rest.substring(0, secondComma).trimSwiftWhitespaces().isNotEmpty()) return null
    val tail = rest.substring(secondComma + 1).toCharArray()
    val branches = LinkedHashMap<String, String>()
    var i = 0
    while (i < tail.size) {
        if (tail[i].isSwiftWhitespace()) { i += 1; continue }
        val name = StringBuilder()
        while (i < tail.size && tail[i].isLetter()) { name.append(tail[i]); i += 1 }
        while (i < tail.size && tail[i].isSwiftWhitespace()) i += 1
        if (name.isEmpty() || i >= tail.size || tail[i] != '{') return null
        val bodyClose = matchingBrace(tail, i) ?: return null
        branches[name.toString()] = String(tail, i + 1, bodyClose - i - 1)
        i = bodyClose + 1
    }
    if (branches["other"] == null) return null
    return PluralBlock(argIndex, branches, close)
}

/** 정수형 인자를 Int로. `Int`·`Long`(범위 안)만 수량이다. */
private fun integerValue(arg: Any): Int? = when (arg) {
    is Int -> arg
    is Long -> if (arg in Int.MIN_VALUE..Int.MAX_VALUE) arg.toInt() else null
    is Short -> arg.toInt()
    is Byte -> arg.toInt()
    else -> null
}

/**
 * 인자에서 수량을 읽는다. `Int`면 그대로, `String`이면 `toIntOrNull()`(천 단위 구분자가 있으면
 * null → other), 그 외는 null(→ other). 수량 인자 누락은 호출부 결함이라 즉시 던진다
 * (Swift `assertionFailure` 대응) — 조용히 other로 떨어뜨리면 `%2$s`가 인자 없이 포맷에 닿는다.
 */
private fun pluralCount(args: List<Any>, argIndex: Int): Int? {
    require(argIndex - 1 < args.size) { "복수 블록 인자 %$argIndex\$s가 없다 — 호출부가 수량 인자를 빠뜨렸다" }
    val arg = args[argIndex - 1]
    integerValue(arg)?.let { return it }
    if (arg is String) return arg.toIntOrNull()
    return null
}

/**
 * 포맷 문자열 안의 복수 블록을 인자 값으로 고른 분기로 치환한다(순수 함수). `one`이 없으면
 * `other`, `other`가 없으면 그 블록은 리터럴로 남긴다.
 */
fun resolvePluralBlocks(format: String, lang: String, args: List<Any>): String {
    if (!format.contains("plural")) return format
    val chars = format.toCharArray()
    val out = StringBuilder()
    var i = 0
    while (i < chars.size) {
        val block = if (chars[i] == '{') parsePluralBlock(chars, i) else null
        if (block != null) {
            val category = pluralCount(args, block.argIndex)?.let { pluralCategory(it, lang) } ?: "other"
            out.append(block.branches[category] ?: block.branches.getValue("other"))
            i = block.end + 1
        } else {
            out.append(chars[i])
            i += 1
        }
    }
    return out.toString()
}

/**
 * 카탈로그 포맷 + 인자 → 표시 문자열. ①복수 블록 치환 ②정수 인자는 문자열화 ③`%N$s`·`%%`
 * 위치 지정자 치환(`String.format`, `Locale.ROOT`). 인자가 없으면 포맷 그대로 — 단 복수
 * 블록이 있는 키를 인자 없이 부르면 호출부 결함이라 던진다.
 */
fun formatLocalized(format: String, lang: String, args: List<Any>): String {
    if (args.isEmpty()) {
        check(!format.contains(", plural, ")) { "복수 블록이 있는 키를 인자 없이 조회했다: $format" }
        return format
    }
    val resolved = resolvePluralBlocks(format, lang, args)
    val stringArgs = args.map { arg -> integerValue(arg)?.toString() ?: arg.toString() }.toTypedArray()
    return String.format(Locale.ROOT, resolved, *stringArgs)
}
