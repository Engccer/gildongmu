package space.dodoplanet.gildongmu.kit

import kotlin.math.floor
import kotlin.math.max

// 옛 위치(stale-origin)의 시간 표현(Kit `StaleOrigin.swift` 미러, 공유 fixture `stale-fix-age-cases.json`).

/** 표시용 경과 표현. 수량 문구는 ICU plural 키(`manualLocation.staleAge*`)가 고른다. */
sealed class StaleFixAge {
    data object JustNow : StaleFixAge()
    data class Minutes(val count: Int) : StaleFixAge()
    data class Hours(val count: Int) : StaleFixAge()
}

/** 경과 초 → 표현. 1분 미만 `JustNow`, 1~59분 `Minutes`, 그 이상 `Hours`(내림). 음수는 0으로, 비유한 값은 null. */
fun staleFixAge(ageSeconds: Double): StaleFixAge? {
    if (!ageSeconds.isFinite()) return null
    val minutes = floor(max(0.0, ageSeconds) / 60).toInt()
    if (minutes < 1) return StaleFixAge.JustNow
    if (minutes < 60) return StaleFixAge.Minutes(minutes)
    return StaleFixAge.Hours(minutes / 60)
}
