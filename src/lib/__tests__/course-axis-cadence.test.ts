/**
 * 방위 축 판정이 fix 도착 빈도에 좌우되지 않는지 못 박는다.
 *
 * ⚠ 최소 증거량을 **개수**로만 표현하면 이 불변이 깨진다 — 10Hz는 무조건 통과하고
 * 0.5Hz는 영영 미달이라 같은 상황을 두 기기가 다르게 판정한다. 그래서 개수 하한과
 * 함께 **판정 가능 비율**·**시간 span**을 요구한다(`guide-course-axis.ts`).
 */
import { describe, expect, it } from "vitest";
import { courseAxisVerdict, recordVote, type CourseVoteSample } from "../guide-course-axis";

/** 같은 20초 구간을 서로 다른 cadence로 채운다. */
const fill = (hz: number, vote: "mismatch" | "match"): CourseVoteSample[] => {
  let s: CourseVoteSample[] = [];
  for (let i = 0; i <= 20 * hz; i++) s = recordVote(s, i / hz, vote);
  return s;
};

describe("cadence 불변", () => {
  it("1Hz와 10Hz가 같은 판정을 낸다", () => {
    expect(courseAxisVerdict(fill(1, "mismatch"))).toBe(courseAxisVerdict(fill(10, "mismatch")));
    expect(courseAxisVerdict(fill(1, "match"))).toBe(courseAxisVerdict(fill(10, "match")));
  });

  it("0.5Hz도 같은 판정을 낸다 — 느린 기기가 영영 미달이면 안 된다", () => {
    expect(courseAxisVerdict(fill(0.5, "mismatch"))).toBe("off");
    expect(courseAxisVerdict(fill(0.5, "match"))).toBe("on");
  });

  it("같은 시각에 배치 도착한 fix 묶음이 창을 장악하지 못한다", () => {
    // 2초 구간에 30개가 몰려도 시간 span이 모자라 확정하지 못한다.
    let s: CourseVoteSample[] = [];
    for (let i = 0; i < 30; i++) s = recordVote(s, i % 2, "mismatch");
    expect(courseAxisVerdict(s)).toBe("unknown");
  });
});
