import { describe, expect, it } from "vitest";
import { PROBE_AHEAD_METERS, extractProbe, probeTarget } from "../walk-probe";
import { haversineMeters } from "../geo";
import { bearingDegrees } from "../geo/bearing";
import type { WalkRouteBriefing } from "../types";

describe("probeTarget", () => {
  it("진행 방위로 180m 간 점", () => {
    for (const b of [0, 45, 200]) {
      const t = probeTarget(37.5, 127.0, b);
      expect(Math.abs(haversineMeters(37.5, 127.0, t.lat, t.lng) - PROBE_AHEAD_METERS)).toBeLessThan(1);
      expect(Math.abs(bearingDegrees(37.5, 127.0, t.lat, t.lng) - b)).toBeLessThan(1);
    }
  });
});

describe("extractProbe (스텝 action → 횡단보도·회전 지점)", () => {
  const path = (pts: Array<[number, number]>) => pts.map(([lat, lng]) => ({ lat, lng }));
  const briefing: WalkRouteBriefing = {
    distanceMeters: 180,
    durationSeconds: 150,
    steps: [
      { description: "출발", pathCoords: path([[37.5, 127.0], [37.5005, 127.0]]) },
      { description: "횡단보도", action: "crosswalk", pathCoords: path([[37.5005, 127.0], [37.5006, 127.0]]) },
      { description: "왼쪽", action: "left", pathCoords: path([[37.5006, 127.0], [37.5006, 126.9995]]) },
      { description: "좌표 없는 오른쪽", action: "right" },
      { description: "제자리 회전", action: "right", pathCoords: path([[37.5007, 127.0]]) },
      { description: "지하도", action: "underpass", pathCoords: path([[37.5008, 127.0]]) },
    ],
  };

  it("횡단보도 스텝은 첫 좌표, 회전 스텝은 첫 좌표 + 25m 간 갈래 점", () => {
    const p = extractProbe(briefing);
    expect(p.crosswalks).toEqual([{ lat: 37.5005, lng: 127.0 }]);
    expect(p.turns).toHaveLength(1);
    const t = p.turns[0];
    expect(t).toMatchObject({ lat: 37.5006, lng: 127.0 });
    expect(Math.abs(haversineMeters(t.lat, t.lng, t.branch.lat, t.branch.lng) - 25)).toBeLessThan(0.5);
    expect(Math.round(bearingDegrees(t.lat, t.lng, t.branch.lat, t.branch.lng))).toBe(270);
  });

  it("경로 없음(null)은 빈 목록", () => {
    expect(extractProbe(null)).toEqual({ crosswalks: [], turns: [] });
  });
});
