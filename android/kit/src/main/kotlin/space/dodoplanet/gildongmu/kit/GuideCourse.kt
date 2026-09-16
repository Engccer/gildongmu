package space.dodoplanet.gildongmu.kit

import kotlin.math.abs

/**
 * 진행 방향(course) 3-state 판정 — 웹 `src/lib/guide-course.ts` ↔ Kit `GuideCourse.swift` 1:1 미러
 * (spec 2026-08-08 §3.5).
 *
 * 최종 접근의 **실시간** 상대 방향("지금 왼쪽")은 사용자가 향한 방위를 알아야 성립한다. 그 출처가 fix의
 * `course`인데, 이 값은 조용히 거짓이 되는 경로가 여럿이라 게이트가 필요하다.
 *
 * ⚠ **`courseAccuracy >= 0`은 값의 존재만 확인한다** — 120°도 양수라 통과하고, 그러면 "왼쪽"이라고 말하는데
 * 실제 목적지는 오른쪽일 수 있다. 4분할 버킷 반폭(45°)이 품질 게이트다(`relativeDirection`의 ahead 폭과 같은 수).
 *
 * ⚠ **모름과 실패는 사용자 출력에서 같다** — 둘 다 방향 어절을 뺀다. 취해야 할 행동이 같기 때문이며, 톤
 * `unreliable`이 "원인이 아니라 상태를 뜻한다"는 계약과 같은 판단이다.
 */

/** 4분할 버킷 반폭. 이보다 부정확한 course는 버킷을 통째로 틀릴 수 있다. */
const val courseAccuracyMaxDegrees = 45.0

/** 워치독(초). Soundscape `FilteredCourseProvider`와 같은 값. */
const val courseStaleSeconds = 3.0

/** 이 미만 속도에서는 course가 표류한다(m/s). Soundscape 동일. */
const val courseMinSpeedMps = 0.4

sealed class CourseState {
    data class Valid(val course: Double) : CourseState()
    data object Unknown : CourseState()
    data object Invalid : CourseState()
}

/**
 * ⚠ 안드로이드 `Location`은 방위가 없을 때 음수가 아니라 **0.0**을 준다. `hasBearing()`·`hasBearingAccuracy()`가
 * 거짓이면 `course`·`courseAccuracy`에 음수(-1)를 넘긴다 — 0.0을 넘기면 북쪽을 향한 것으로 `Valid`가 되어 거짓
 * 좌우 방향이 발화된다.
 */
fun courseStep(
    course: Double,
    courseAccuracy: Double,
    speed: Double,
    motion: MotionState,
    ageSeconds: Double,
): CourseState {
    // NaN을 통과시키지 않으려고 부정 비교로 쓴다(`course < 0`은 NaN에 false다).
    if (!(course >= 0) || !(courseAccuracy >= 0)) return CourseState.Invalid
    if (motion != MotionState.moving) return CourseState.Unknown
    if (!(speed >= courseMinSpeedMps)) return CourseState.Unknown
    if (!(abs(ageSeconds) <= courseStaleSeconds)) return CourseState.Unknown
    if (!(courseAccuracy <= courseAccuracyMaxDegrees)) return CourseState.Unknown
    return CourseState.Valid(course)
}
