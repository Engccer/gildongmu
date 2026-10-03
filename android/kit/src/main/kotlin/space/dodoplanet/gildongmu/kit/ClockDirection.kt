package space.dodoplanet.gildongmu.kit

import kotlin.math.floor

// 시계 방향 체계(E62·E63 공유 경계 인터페이스, spec `2026-10-03-crosswalk-guidance-design.md` §2).
// Kit `ClockDirection.swift` 미러(웹 `clock-direction.ts`), 공유 fixture `clock-direction-cases.json`.

/** 기준 방향에서 대상 방향까지 시계 방향으로 잰 각(0° 이상 360° 미만). 입력은 북 기준 방위(°). */
fun relativeBearing(reference: Double, target: Double): Double {
    val r = ((target - reference) % 360 + 360) % 360
    return if (r >= 360) 0.0 else r
}

/** 상대 방위를 30°로 반올림한 시(1~12, 0°는 12시). 0.5 올림 — Kotlin `round`는 짝수 반올림이라 쓰지 않는다. */
fun clockHour(relativeDegrees: Double): Int {
    val h = floor(relativeDegrees / 30 + 0.5).toInt() % 12
    return if (h == 0) 12 else h
}
