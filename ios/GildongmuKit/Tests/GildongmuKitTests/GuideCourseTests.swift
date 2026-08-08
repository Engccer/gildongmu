import Foundation
import Testing
@testable import GildongmuKit

/// 웹 `guide-course.test.ts`와 같은 케이스 열. 순수 판정이라 fixture 없이 표로 고정한다.
private func step(
    course: Double = 90,
    courseAccuracy: Double = 10,
    speed: Double = 1.2,
    motion: MotionState = .moving,
    ageSeconds: Double = 1
) -> CourseState {
    courseStep(
        course: course, courseAccuracy: courseAccuracy, speed: speed,
        motion: motion, ageSeconds: ageSeconds
    )
}

@Suite("진행 방향 3-state 판정")
struct GuideCourseTests {
    @Test("모든 게이트를 통과하면 유효")
    func valid() {
        #expect(step() == .valid(course: 90))
    }

    @Test("무효값은 실패다(모름이 아니다)")
    func invalidValues() {
        #expect(step(course: -1) == .invalid)
        #expect(step(courseAccuracy: -1) == .invalid)
    }

    @Test("NaN은 부정 비교로 걸러진다")
    func nanValues() {
        #expect(step(course: .nan) == .invalid)
        #expect(step(courseAccuracy: .nan) == .invalid)
        #expect(step(speed: .nan) == .unknown)
        #expect(step(ageSeconds: .nan) == .unknown)
    }

    /// ⚠ 존재만 확인하면 120°도 통과해 반대 방향을 말한다.
    @Test("버킷 반폭을 넘는 정확도는 모름")
    func accuracyGate() {
        #expect(step(courseAccuracy: courseAccuracyMaxDegrees) == .valid(course: 90))
        #expect(step(courseAccuracy: courseAccuracyMaxDegrees + 0.1) == .unknown)
        #expect(step(courseAccuracy: 120) == .unknown)
    }

    @Test("정지·속도미상은 모름")
    func motionGate() {
        #expect(step(motion: .stopped) == .unknown)
        #expect(step(motion: .speedUnknown) == .unknown)
    }

    @Test("속도 하한 미달은 모름")
    func speedGate() {
        #expect(step(speed: courseMinSpeedMps) == .valid(course: 90))
        #expect(step(speed: courseMinSpeedMps - 0.01) == .unknown)
    }

    @Test("워치독 만료는 모름")
    func staleGate() {
        #expect(step(ageSeconds: courseStaleSeconds) == .valid(course: 90))
        #expect(step(ageSeconds: courseStaleSeconds + 0.1) == .unknown)
    }

    @Test("실패가 모름보다 앞선다")
    func invalidPrecedesUnknown() {
        #expect(step(course: -1, motion: .stopped) == .invalid)
    }
}
