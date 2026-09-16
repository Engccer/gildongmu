package space.dodoplanet.gildongmu.kit

import kotlin.math.abs
import kotlin.math.sign
import kotlin.math.truncate

// Swift 표준 라이브러리 의미를 옮긴 이식 보조 — 미러 파일이 아니라 등록부 밖이다. 같은 의미가 여러 파일에 필요할 때
// 파일마다 술어를 복제하면 한쪽만 고쳐져 갈린다.

/**
 * Swift `Double.rounded()`(`.toNearestOrAwayFromZero`) 미러.
 *
 * ⚠ Kotlin `round`는 짝수 반올림(2.5 → 2)이고 `Math.round`는 음수 .5를 +방향으로 올려(-2.5 → -2) 둘 다 Swift와 갈린다.
 * `x - truncate(x)`는 부동소수 오차 없이 정확하므로 .5 경계가 흔들리지 않는다.
 */
internal fun Double.roundedAwayFromZero(): Double {
    if (!isFinite()) return this
    val whole = truncate(this)
    return if (abs(this - whole) >= 0.5) whole + sign(this) else whole
}

/**
 * Swift 정규식 약칭 공백(ICU `\s`)의 뜻인 유니코드 White_Space 속성을 명시로 적은 문자 집합 — 문자 클래스 안에 끼워 쓴다
 * (`[$REGEX_SPACE_MEMBERS]`). 제어 문자 U+0009~U+000D·U+0085 + `\p{Z}`(Zs·Zl·Zp)가 곧 White_Space다(전 코드포인트 실측 일치).
 * :kit은 약칭 클래스를 쓰지 않는다 — JVM은 ASCII, 안드로이드 ICU는 유니코드로 읽어 갈린다. 웹 JS 약칭 공백과는 두 문자가 다르다
 * (U+FEFF는 JS만, U+0085는 이 집합만). `\u000B`·`\u0085`는 raw string이라 Kotlin이 아니라 정규식 엔진이 푼다.
 */
internal const val REGEX_SPACE_MEMBERS = """\t\n\u000B\f\r\u0085\p{Z}"""

/** Swift `Character.isWhitespace` 미러 — 유니코드 White_Space(`REGEX_SPACE_MEMBERS`와 같은 집합, 전 코드포인트 실측 일치). */
internal fun Char.isSwiftWhitespace(): Boolean = this in '\t'..'\r' || code == 0x85 || isUnicodeSeparator()

/** Swift `CharacterSet.whitespaces` 소속 — 탭 + 공백 구분자(Zs), **줄바꿈은 아니다**. */
internal fun Char.inSwiftWhitespaces(): Boolean = this == '\t' || category == CharCategory.SPACE_SEPARATOR

/** Swift `CharacterSet.whitespacesAndNewlines` 소속 — 탭·U+000A~U+000D·U+0085 + 유니코드 Z*(Zs·Zl·Zp). */
internal fun Char.inSwiftWhitespacesAndNewlines(): Boolean = isSwiftWhitespace()

private fun Char.isUnicodeSeparator(): Boolean = when (category) {
    CharCategory.SPACE_SEPARATOR, CharCategory.LINE_SEPARATOR, CharCategory.PARAGRAPH_SEPARATOR -> true
    else -> false
}

/**
 * Swift `trimmingCharacters(in: .whitespaces)` 미러 — 줄바꿈은 자르지 않는다.
 *
 * ⚠ Kotlin 기본 공백 판정(`trim()`·`isBlank()`·`Char.isWhitespace()`)은 Swift의 어느 집합과도 같지 않다(U+001C~U+001F를 자르고
 * U+0085는 남긴다) — :kit main은 그것을 쓰지 않고 Swift 원본의 집합에 맞는 이 파일의 함수를 지난다(`SwiftSemanticsTest`가 잠근다).
 */
internal fun String.trimSwiftWhitespaces(): String = trim { it.inSwiftWhitespaces() }

/** Swift `trimmingCharacters(in: .whitespacesAndNewlines)` 미러. */
internal fun String.trimSwiftWhitespacesAndNewlines(): String = trim { it.inSwiftWhitespacesAndNewlines() }
