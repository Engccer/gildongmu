package space.dodoplanet.gildongmu.kit

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan
import kotlin.math.sin

/**
 * 방위 축 관측 유도기(spec §2.0, 재설계 2026-08-10). 웹 `src/lib/course-derivation.ts` ↔ Kit `CourseDerivation.swift` 미러.
 *
 * 기기 course는 GPS 도플러 기반이라 보행 속도에서 방위를 제공하지 않는다(실사용 로그: courseAcc 중위 83°, 축
 * 통과 0/281 — spec §3.0.1). 유도 방위는 fix 이력의 chord라 조건이 속도가 아니라 누적 변위다. 위치 오차는
 * 절대값(보고 acc 14.2m)이 아니라 상관이 문제였고, 인접 fix 상대 잡음은 중위 0.42m라 변위에서 공통 성분이
 * 소거된다(§3.0.2).
 *
 * ⚠ 사슬 U가 기기 courseAccuracy의 대체물이자 회전 보호다: 모퉁이에서 사슬이 굽어 U가 커지고 표가 자동으로
 * unknown이 된다. 잡음도 같은 경로로 스스로 unknown이 된다.
 *
 * ⚠ 전진 게이트가 없으면 정지 중 같은 chord가 반복 관측된다 — §2.1이 금지한 "같은 오차의 반복 집계"가 정지
 * 상태에서 재발한다.
 *
 * ⚠ **유도기 버퍼·전진 게이트는 이 한 곳뿐이다** — 리듀서나 [3] 플랫폼에서 재구현 금지.
 */

/** ⚠ 잠정값(spec §6·§7). 기저선 — 실사용 로그 스윕에서 10m 최적(§3.0.3). */
const val deriveBaselineMeters = 10.0

/** ⚠ 잠정값(spec §6·§7). 기저선 fix의 최대 나이. */
const val deriveMaxAgeSeconds = 30.0

/** ⚠ 잠정값(spec §6·§7). 사슬 U 하한 — 완전 직선 사슬도 이만큼은 불확실하다. */
const val deriveUncertaintyFloorDegrees = 8.0

/** ⚠ 잠정값(spec §6·§7). 사슬 편차 여유 — 편차 0이어도 U에 반영되는 잡음 마진. */
const val deriveSlackMeters = 1.5

/** ⚠ 잠정값(spec §6·§7). 전진 게이트 — 이만큼 전진해야 새 표를 낸다. */
const val deriveAdvanceMeters = 2.0

data class DerivedCourse(
    /** [0,360) 진행 방위. */
    val bearing: Double,
    /** 사슬 자기일관성 불확실성(도). */
    val uncertaintyDeg: Double,
)

data class DerivationFix(val lat: Double, val lng: Double, val at: Double)

data class CourseDerivationState(
    val fixes: List<DerivationFix> = emptyList(),
    /** 마지막으로 표를 방출한 위치(전진 게이트 기준점). */
    val lastEmit: DerivationFix? = null,
)

val initialDerivationState = CourseDerivationState()

/** `deriveCourse` 결과(Swift 튜플 `(state, obs)` 대응). */
data class DeriveCourseResult(val state: CourseDerivationState, val obs: DerivedCourse?)

/**
 * fix 하나를 버퍼에 반영하고, 가능하면 유도 관측을 낸다.
 *
 * 버퍼는 age 상한으로 자체 소멸하므로 경로 교체와 무관하다(궤적은 경로의 함수가 아니다 — spec §2.9).
 * 새 세션은 `initialDerivationState`에서 시작한다.
 */
fun deriveCourse(state: CourseDerivationState, lat: Double, lng: Double, at: Double): DeriveCourseResult {
    // 같은 timestamp는 교체, age 상한 밖은 절단(배치 도착·중복 fix 방어).
    val fixes = state.fixes.filter { it.at != at && it.at > at - deriveMaxAgeSeconds } + DerivationFix(lat, lng, at)
    val next = CourseDerivationState(fixes, state.lastEmit)

    // 기저선: chord 거리 ≥ B인 가장 가까운(최근) 과거 fix.
    var baseIdx = -1
    var i = fixes.size - 2
    while (i >= 0) {
        if (haversineMeters(fixes[i].lat, fixes[i].lng, lat, lng) >= deriveBaselineMeters) {
            baseIdx = i
            break
        }
        i -= 1
    }
    if (baseIdx < 0) return DeriveCourseResult(next, null)

    // 전진 게이트(spec §2.0 규칙 4).
    val emit = next.lastEmit
    if (emit != null && haversineMeters(emit.lat, emit.lng, lat, lng) < deriveAdvanceMeters) {
        return DeriveCourseResult(next, null)
    }

    val base = fixes[baseIdx]
    val chord = haversineMeters(base.lat, base.lng, lat, lng)
    val bearing = bearingDegrees(base.lat, base.lng, lat, lng)

    // 사슬 자기일관성: 중간 fix들의 chord 수직 편차 최대(spec §2.0 규칙 3).
    var maxDev = 0.0
    for (k in (baseIdx + 1) until (fixes.size - 1)) {
        val d = haversineMeters(base.lat, base.lng, fixes[k].lat, fixes[k].lng)
        if (d == 0.0) continue
        val b = bearingDegrees(base.lat, base.lng, fixes[k].lat, fixes[k].lng)
        val dev = abs(d * sin((b - bearing) * PI / 180))
        if (dev > maxDev) maxDev = dev
    }
    val uncertaintyDeg = maxOf(deriveUncertaintyFloorDegrees, atan((maxDev + deriveSlackMeters) / chord) * 180 / PI)

    return DeriveCourseResult(
        next.copy(lastEmit = DerivationFix(lat, lng, at)),
        DerivedCourse(bearing, uncertaintyDeg),
    )
}
