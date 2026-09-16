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
 * Swift `trimmingCharacters(in: .whitespaces)` 미러 — 공백 구분자(Zs) + 탭, **줄바꿈은 자르지 않는다**.
 *
 * ⚠ Kotlin `trim()`(`isWhitespace`)은 Swift의 두 집합 어느 것과도 같지 않다(줄바꿈·U+001C~U+001F를 자르고 U+0085는 남긴다) —
 * Swift가 trim하는 자리는 그 집합에 맞는 이 파일의 함수로 옮긴다.
 */
internal fun String.trimSwiftWhitespaces(): String =
    trim { it == '\t' || Character.getType(it) == Character.SPACE_SEPARATOR.toInt() }

/** Swift `trimmingCharacters(in: .whitespacesAndNewlines)` 미러 — 탭·U+000A~U+000D·U+0085 + 유니코드 Z*(Zs·Zl·Zp). */
internal fun String.trimSwiftWhitespacesAndNewlines(): String = trim {
    it == '\t' || it in '\n'..'\r' || it == '\u0085' || when (Character.getType(it).toByte()) {
        Character.SPACE_SEPARATOR, Character.LINE_SEPARATOR, Character.PARAGRAPH_SEPARATOR -> true
        else -> false
    }
}
