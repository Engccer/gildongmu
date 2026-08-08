import { describe, it, expect } from "vitest";
import {
  courseStep,
  COURSE_ACC_MAX,
  COURSE_MIN_SPEED_MPS,
  COURSE_STALE_S,
} from "../guide-course";

const base = {
  course: 90,
  courseAccuracy: 10,
  speed: 1.2,
  motion: "moving" as const,
  ageSeconds: 1,
};

describe("courseStep", () => {
  it("모든 게이트를 통과하면 유효", () => {
    expect(courseStep(base)).toEqual({ kind: "valid", course: 90 });
  });

  it("course 음수는 실패(모름이 아니다)", () => {
    expect(courseStep({ ...base, course: -1 }).kind).toBe("invalid");
  });

  it("courseAccuracy 음수는 실패", () => {
    expect(courseStep({ ...base, courseAccuracy: -1 }).kind).toBe("invalid");
  });

  it("NaN은 실패로 떨어진다(부정 비교 계약)", () => {
    expect(courseStep({ ...base, course: NaN }).kind).toBe("invalid");
    expect(courseStep({ ...base, courseAccuracy: NaN }).kind).toBe("invalid");
    expect(courseStep({ ...base, speed: NaN }).kind).toBe("unknown");
    expect(courseStep({ ...base, ageSeconds: NaN }).kind).toBe("unknown");
  });

  it("courseAccuracy가 버킷 반폭을 넘으면 모름 — 존재만 확인하면 120도도 통과한다", () => {
    expect(courseStep({ ...base, courseAccuracy: COURSE_ACC_MAX + 0.1 }).kind).toBe(
      "unknown",
    );
    expect(courseStep({ ...base, courseAccuracy: COURSE_ACC_MAX }).kind).toBe("valid");
    expect(courseStep({ ...base, courseAccuracy: 120 }).kind).toBe("unknown");
  });

  it("정지 상태는 모름", () => {
    expect(courseStep({ ...base, motion: "stopped" }).kind).toBe("unknown");
    expect(courseStep({ ...base, motion: "speedUnknown" }).kind).toBe("unknown");
  });

  it("속도 하한 미달은 모름", () => {
    expect(courseStep({ ...base, speed: COURSE_MIN_SPEED_MPS - 0.01 }).kind).toBe(
      "unknown",
    );
    expect(courseStep({ ...base, speed: COURSE_MIN_SPEED_MPS }).kind).toBe("valid");
  });

  it("워치독 만료는 모름", () => {
    expect(courseStep({ ...base, ageSeconds: COURSE_STALE_S + 0.1 }).kind).toBe(
      "unknown",
    );
    expect(courseStep({ ...base, ageSeconds: COURSE_STALE_S }).kind).toBe("valid");
  });

  it("실패가 모름보다 앞선다 — 무효값은 정지 상태에서도 실패로 남는다", () => {
    expect(courseStep({ ...base, course: -1, motion: "stopped" }).kind).toBe("invalid");
  });
});
