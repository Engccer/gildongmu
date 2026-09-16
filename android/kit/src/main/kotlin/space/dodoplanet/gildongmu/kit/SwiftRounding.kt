package space.dodoplanet.gildongmu.kit

import kotlin.math.abs
import kotlin.math.sign
import kotlin.math.truncate

/**
 * Swift `Double.rounded()`(`.toNearestOrAwayFromZero`) 미러 — 미러 파일이 아니라 이식 보조라 등록부 밖이다.
 *
 * ⚠ Kotlin `round`는 짝수 반올림(2.5 → 2)이고 `Math.round`는 음수 .5를 +방향으로 올려(-2.5 → -2) 둘 다
 * Swift와 갈린다. `x - truncate(x)`는 부동소수 오차 없이 정확하므로 .5 경계가 흔들리지 않는다.
 */
internal fun Double.roundedAwayFromZero(): Double {
    if (!isFinite()) return this
    val whole = truncate(this)
    return if (abs(this - whole) >= 0.5) whole + sign(this) else whole
}
