import { describe, expect, it } from "vitest";
import {
  courseAxisVerdict,
  courseVote,
  recordVote,
  COURSE_AXIS_WINDOW_S,
  type CourseVote,
  type CourseVoteSample,
} from "../guide-course-axis";
import { buildGuideRoute } from "../route-geometry";
import scenarios from "./fixtures/course-axis-scenarios.json";

// 남 → 북 직선 200m (접선은 어디서나 0도)
const route = buildGuideRoute([
  {
    description: "북진",
    pathCoords: [
      { lat: 37.5, lng: 127.1 },
      { lat: 37.5 + 200 / 111320, lng: 127.1 },
    ],
  },
])!;
const obs = (bearing: number, uncertaintyDeg: number) => ({ bearing, uncertaintyDeg });

describe("courseVote", () => {
  it("나란하면 match", () => {
    expect(courseVote(obs(5, 10), route.polyline, 100)).toBe("match");
  });

  it("크게 어긋나고 불확실성이 작으면 mismatch", () => {
    expect(courseVote(obs(120, 10), route.polyline, 100)).toBe("mismatch");
  });

  it("어긋남이 불확실성 안에 들어가면 unknown — 통과권이 아니라 오차범위로 쓴다", () => {
    // 각도차 50°, 사슬 불확실성 40° → 실제로는 10°일 수 있다
    expect(courseVote(obs(50, 40), route.polyline, 100)).toBe("unknown");
  });

  it("관측이 없으면 unknown", () => {
    expect(courseVote(null, route.polyline, 100)).toBe("unknown");
  });

  it("bearing이 유한 [0,360) 밖이면 unknown", () => {
    expect(courseVote(obs(Number.POSITIVE_INFINITY, 5), route.polyline, 100)).toBe(
      "unknown",
    );
    expect(courseVote(obs(360, 5), route.polyline, 100)).toBe("unknown");
    expect(courseVote(obs(Number.NaN, 5), route.polyline, 100)).toBe("unknown");
  });

  it("uncertaintyDeg가 유한 음이 아닌 값이 아니면 unknown", () => {
    expect(courseVote(obs(120, -1), route.polyline, 100)).toBe("unknown");
    expect(courseVote(obs(120, Number.NaN), route.polyline, 100)).toBe("unknown");
  });

  it("유효 접선이 하나도 없으면 unknown", () => {
    const degenerate = { points: [{ lat: 37.5, lng: 127.1 }], cum: [0] };
    expect(courseVote(obs(120, 5), degenerate, 0)).toBe("unknown");
  });
});

describe("recordVote", () => {
  it("창 밖 표본을 버린다", () => {
    let s: CourseVoteSample[] = [];
    s = recordVote(s, 0, "mismatch");
    s = recordVote(s, COURSE_AXIS_WINDOW_S + 1, "match");
    expect(s).toEqual([{ at: COURSE_AXIS_WINDOW_S + 1, vote: "match" }]);
  });

  it("같은 시각의 중복 fix는 하나로 합친다 — 배치 도착이 다수결을 장악하지 못하게", () => {
    let s: CourseVoteSample[] = [];
    s = recordVote(s, 5, "mismatch");
    s = recordVote(s, 5, "mismatch");
    s = recordVote(s, 5, "mismatch");
    expect(s).toHaveLength(1);
  });
});

describe("courseAxisVerdict", () => {
  const fill = (n: number, vote: "mismatch" | "match", startAt = 0): CourseVoteSample[] =>
    Array.from({ length: n }, (_, i) => ({ at: startAt + i * 2, vote }));

  it("표본이 시간을 충분히 덮지 않으면 unknown — 첫 표 하나로 확정하지 않는다", () => {
    expect(courseAxisVerdict([{ at: 0, vote: "mismatch" }])).toBe("unknown");
    // 4초만 덮은 3표는 전부 mismatch여도 확정하지 않는다
    expect(courseAxisVerdict(fill(3, "mismatch"))).toBe("unknown");
  });

  it("충분한 시간·표본에서 mismatch가 다수면 off", () => {
    expect(courseAxisVerdict(fill(10, "mismatch"))).toBe("off");
  });

  it("충분한 시간·표본에서 match가 다수면 on", () => {
    expect(courseAxisVerdict(fill(10, "match"))).toBe("on");
  });

  it("확정과 해제 사이 회색지대는 unknown — 히스테리시스", () => {
    const mixed: CourseVoteSample[] = [...fill(5, "mismatch"), ...fill(5, "match", 10)];
    expect(courseAxisVerdict(mixed)).toBe("unknown");
  });

  it("unknown 표는 mismatch 비율의 분모에서 뺀다", () => {
    const s: CourseVoteSample[] = [
      ...fill(10, "mismatch"),
      { at: 0.5, vote: "unknown" },
      { at: 1.5, vote: "unknown" },
    ];
    expect(courseAxisVerdict(s)).toBe("off");
  });

  it("창의 대부분이 판정 불가면 확정하지 않는다 — 얇은 근거 금지", () => {
    // 비율만 보면 mismatch 100%지만, 20초 창의 2/3이 판정 불가다.
    const s: CourseVoteSample[] = [
      ...fill(10, "mismatch"),
      ...Array.from({ length: 20 }, (_, i) => ({ at: i * 0.5 + 0.25, vote: "unknown" as const })),
    ];
    expect(courseAxisVerdict(s)).toBe("unknown");
  });
});

describe("공유 fixture (Kit 동조 가드)", () => {
  // ⚠ 공회전 방지: 키 이름이 바뀌거나 배열이 비면 it.each가 0개 테스트를 만들고
  //   describe가 조용히 통과한다. 가드가 무는지는 케이스가 실제로 있는지에 달렸다.
  it("fixture에 표결·판정 케이스가 있다", () => {
    expect(scenarios.votes.length).toBeGreaterThanOrEqual(7);
    expect(scenarios.verdicts.length).toBeGreaterThanOrEqual(11);
  });

  it.each(scenarios.votes)("표결: $name", (c) => {
    expect(
      courseVote(
        c.bearing === null ? null : { bearing: c.bearing, uncertaintyDeg: c.uncertainty },
        route.polyline,
        c.d,
      ),
    ).toBe(c.expect);
  });

  it.each(scenarios.verdicts)("판정: $name", (c) => {
    const samples = (c.votes as [string, number][]).map(([vote, at]) => ({
      at,
      vote: vote as CourseVote,
    }));
    expect(courseAxisVerdict(samples)).toBe(c.expect);
  });
});
