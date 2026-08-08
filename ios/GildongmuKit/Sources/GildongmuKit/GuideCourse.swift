import Foundation

/// 진행 방향(course) 3-state 판정 — 웹 `src/lib/guide-course.ts`의 1:1 미러
/// (spec 2026-08-08 §3.5).
///
/// 최종 접근의 **실시간** 상대 방향("지금 왼쪽")은 사용자가 향한 방위를 알아야 성립한다.
/// 그 출처가 fix의 `course`인데, 이 값은 조용히 거짓이 되는 경로가 여럿이라 게이트가 필요하다.
///
/// ⚠ **`courseAccuracy >= 0`은 값의 존재만 확인한다** — 120°도 양수라 통과하고,
/// 그러면 "왼쪽"이라고 말하는데 실제 목적지는 오른쪽일 수 있다. 4분할 버킷 반폭(45°)이
/// 품질 게이트다(`relativeDirection`의 ahead 폭과 같은 수).
///
/// ⚠ **모름과 실패는 사용자 출력에서 같다** — 둘 다 방향 어절을 뺀다. 취해야 할 행동이
/// 같기 때문이며, 톤 `unreliable`이 "원인이 아니라 상태를 뜻한다"는 계약과 같은 판단이다.

/// 4분할 버킷 반폭. 이보다 부정확한 course는 버킷을 통째로 틀릴 수 있다.
public let courseAccuracyMaxDegrees = 45.0
/// 워치독(초). Soundscape `FilteredCourseProvider`와 같은 값.
public let courseStaleSeconds = 3.0
/// 이 미만 속도에서는 course가 표류한다(m/s). Soundscape 동일.
public let courseMinSpeedMps = 0.4

public enum CourseState: Sendable, Equatable {
    case valid(course: Double)
    case unknown
    case invalid
}

public func courseStep(
    course: Double, courseAccuracy: Double, speed: Double,
    motion: MotionState, ageSeconds: Double
) -> CourseState {
    // NaN을 통과시키지 않으려고 부정 비교로 쓴다(`course < 0`은 NaN에 false다).
    guard course >= 0, courseAccuracy >= 0 else { return .invalid }
    guard motion == .moving else { return .unknown }
    guard speed >= courseMinSpeedMps else { return .unknown }
    guard abs(ageSeconds) <= courseStaleSeconds else { return .unknown }
    guard courseAccuracy <= courseAccuracyMaxDegrees else { return .unknown }
    return .valid(course: course)
}
