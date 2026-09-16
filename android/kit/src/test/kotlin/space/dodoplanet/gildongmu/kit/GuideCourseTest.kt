package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertEquals

/** 진행 방향 3-state 판정 — Kit `GuideCourseTests`·웹 `guide-course.test.ts`와 같은 케이스 열. */
class GuideCourseTest {
    private fun step(
        course: Double = 90.0,
        courseAccuracy: Double = 10.0,
        speed: Double = 1.2,
        motion: MotionState = MotionState.moving,
        ageSeconds: Double = 1.0,
    ) = courseStep(course, courseAccuracy, speed, motion, ageSeconds)

    private val valid90 = CourseState.Valid(90.0)

    @Test fun `모든 게이트를 통과하면 유효`() {
        assertEquals(valid90, step())
    }

    @Test fun `무효값은 실패다 — 모름이 아니다`() {
        assertEquals(CourseState.Invalid, step(course = -1.0))
        assertEquals(CourseState.Invalid, step(courseAccuracy = -1.0))
    }

    @Test fun `NaN은 부정 비교로 걸러진다`() {
        assertEquals(CourseState.Invalid, step(course = Double.NaN))
        assertEquals(CourseState.Invalid, step(courseAccuracy = Double.NaN))
        assertEquals(CourseState.Unknown, step(speed = Double.NaN))
        assertEquals(CourseState.Unknown, step(ageSeconds = Double.NaN))
    }

    /** ⚠ 존재만 확인하면 120°도 통과해 반대 방향을 말한다. */
    @Test fun `버킷 반폭을 넘는 정확도는 모름`() {
        assertEquals(valid90, step(courseAccuracy = courseAccuracyMaxDegrees))
        assertEquals(CourseState.Unknown, step(courseAccuracy = courseAccuracyMaxDegrees + 0.1))
        assertEquals(CourseState.Unknown, step(courseAccuracy = 120.0))
    }

    @Test fun `정지·속도미상은 모름`() {
        assertEquals(CourseState.Unknown, step(motion = MotionState.stopped))
        assertEquals(CourseState.Unknown, step(motion = MotionState.speedUnknown))
    }

    @Test fun `속도 하한 미달은 모름`() {
        assertEquals(valid90, step(speed = courseMinSpeedMps))
        assertEquals(CourseState.Unknown, step(speed = courseMinSpeedMps - 0.01))
    }

    @Test fun `워치독 만료는 모름`() {
        assertEquals(valid90, step(ageSeconds = courseStaleSeconds))
        assertEquals(CourseState.Unknown, step(ageSeconds = courseStaleSeconds + 0.1))
    }

    @Test fun `실패가 모름보다 앞선다`() {
        assertEquals(CourseState.Invalid, step(course = -1.0, motion = MotionState.stopped))
    }
}
