/**
 * 진행 방향(course) 3-state 판정(spec 2026-08-08 §3.5). 웹 ↔ Kit `GuideCourse.swift` 미러.
 *
 * 최종 접근의 **실시간** 상대 방향("지금 왼쪽")은 사용자가 향한 방위를 알아야 성립한다.
 * 그 출처가 fix의 `course`인데, 이 값은 조용히 거짓이 되는 경로가 여럿이라 게이트가 필요하다.
 *
 * ⚠ **`courseAccuracy >= 0`은 값의 존재만 확인한다** — 120°도 양수라 통과하고,
 * 그러면 "왼쪽"이라고 말하는데 실제 목적지는 오른쪽일 수 있다. 4분할 버킷 반폭(45°)이
 * 품질 게이트다(`relativeDirection`의 ahead 폭과 같은 수).
 *
 * ⚠ **모름(unknown)과 실패(invalid)는 사용자 출력에서 같다** — 둘 다 방향 어절을 뺀다.
 * 취해야 할 행동이 같기 때문이며, 톤 `unreliable`이 "원인이 아니라 상태를 뜻한다"는
 * 계약과 같은 판단이다. 구분은 로그·진단에만 남긴다.
 */
import type { MotionState } from "./guide-motion";

/** 4분할 버킷 반폭. 이보다 부정확한 course는 버킷을 통째로 틀릴 수 있다. */
export const COURSE_ACC_MAX = 45;
/** 워치독(초). Soundscape `FilteredCourseProvider`와 같은 값. */
export const COURSE_STALE_S = 3;
/** 이 미만 속도에서는 course가 표류한다(m/s). Soundscape 동일. */
export const COURSE_MIN_SPEED_MPS = 0.4;

export type CourseState =
  | { kind: "valid"; course: number }
  | { kind: "unknown" }
  | { kind: "invalid" };

export function courseStep(input: {
  course: number;
  courseAccuracy: number;
  speed: number;
  motion: MotionState;
  ageSeconds: number;
}): CourseState {
  const { course, courseAccuracy, speed, motion, ageSeconds } = input;
  // NaN을 통과시키지 않으려고 부정 비교로 쓴다(`course < 0`은 NaN에 false다).
  if (!(course >= 0) || !(courseAccuracy >= 0)) return { kind: "invalid" };
  if (motion !== "moving") return { kind: "unknown" };
  if (!(speed >= COURSE_MIN_SPEED_MPS)) return { kind: "unknown" };
  if (!(Math.abs(ageSeconds) <= COURSE_STALE_S)) return { kind: "unknown" };
  if (courseAccuracy > COURSE_ACC_MAX) return { kind: "unknown" };
  return { kind: "valid", course };
}
