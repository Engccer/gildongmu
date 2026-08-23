import { describe, expect, it } from "vitest";
import { assertDistanceMatchesKorean, assertTurnTypeMatchesKorean } from "../pedestrian-guard";

describe("assertTurnTypeMatchesKorean", () => {
  it("일치하면 통과", () => {
    expect(() => assertTurnTypeMatchesKorean(12, "좌회전 후 천호대로를 따라 1m 이동")).not.toThrow();
    expect(() => assertTurnTypeMatchesKorean(213, "우측 횡단보도 후 44m 이동")).not.toThrow();
    expect(() => assertTurnTypeMatchesKorean(126, "지하보도 진입 후 72m 이동")).not.toThrow();
    expect(() => assertTurnTypeMatchesKorean(201, "도착")).not.toThrow();
  });

  it("표지 우선순위: 회전이 건널목보다 먼저다", () => {
    // "횡단보도"는 지명의 일부로 등장한다 — 건널목을 먼저 보면 좌회전 스텝이 모순으로 잡혀
    // 정상 경로가 죽는다(walk-action.ts MARKERS와 같은 함정).
    expect(() =>
      assertTurnTypeMatchesKorean(12, "천호역 횡단보도에서 좌회전 후 40m 이동"),
    ).not.toThrow();
  });

  it("모순이면 throw", () => {
    expect(() => assertTurnTypeMatchesKorean(13, "좌회전 후 30m 이동")).toThrow(/표지/);
    expect(() => assertTurnTypeMatchesKorean(12, "횡단보도 후 30m 이동")).toThrow(/표지/);
  });

  it("표지가 없으면 판정하지 않는다", () => {
    expect(() => assertTurnTypeMatchesKorean(11, "보행자도로를 따라 30m 이동")).not.toThrow();
  });
});

describe("assertDistanceMatchesKorean", () => {
  it("일치하면 통과(±1m)", () => {
    expect(() => assertDistanceMatchesKorean("좌회전 후 286m 이동", 286)).not.toThrow();
    expect(() => assertDistanceMatchesKorean("좌회전 후 286m 이동", 287)).not.toThrow();
    expect(() => assertDistanceMatchesKorean("1.2km 이동", 1200)).not.toThrow();
  });

  it("어긋나면 throw — 귀속 가정이 깨진 것이다", () => {
    expect(() => assertDistanceMatchesKorean("좌회전 후 306m 이동", 314)).toThrow(/거리/);
  });

  it("원문에 거리가 없거나 구간이 없으면 판정하지 않는다", () => {
    expect(() => assertDistanceMatchesKorean("도착", 0)).not.toThrow();
    expect(() => assertDistanceMatchesKorean("좌회전 후 286m 이동", undefined)).not.toThrow();
  });
});
