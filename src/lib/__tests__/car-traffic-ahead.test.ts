import { describe, expect, it } from "vitest";
import { JAM_LENGTH_TOLERANCE_M, JAM_LENGTH_TOLERANCE_RATIO, JAM_ON_ROUTE_M, newJamsAhead, type KnownJam } from "../car-traffic-ahead";
import type { CarJam, Coord } from "../types";
import fixture from "./fixtures/car-jams-ahead-cases.json";

interface Case {
  name: string;
  d: number;
  known: KnownJam[];
  fresh: CarJam[];
  expect: { nearest: number | null; aheadMeters: number | null; knownCount: number };
}

describe("newJamsAhead — 공유 fixture(Kit CarTrafficAheadTests와 같은 판정표, E80 §5)", () => {
  const polyline = fixture.polyline as { points: Coord[]; cum: number[] };
  for (const c of fixture.cases as Case[]) {
    it(c.name, () => {
      const out = newJamsAhead({ polyline, totalMeters: fixture.totalMeters, d: c.d, known: c.known, fresh: c.fresh });
      if (c.expect.nearest === null) {
        expect(out.nearest).toBeNull();
      } else {
        expect(out.nearest?.jam).toEqual(c.fresh[c.expect.nearest]);
        expect(out.nearest?.aheadMeters).toBe(c.expect.aheadMeters);
      }
      expect(out.known).toHaveLength(c.expect.knownCount);
    });
  }

  it("상수 값(Kit carJam* 미러)", () => {
    expect([JAM_ON_ROUTE_M, JAM_LENGTH_TOLERANCE_M, JAM_LENGTH_TOLERANCE_RATIO]).toEqual([40, 150, 0.25]);
  });

  it("같은 응답을 두 번 받으면 두 번째는 알리지 않는다(같은 정체 반복 금지)", () => {
    const polyline = fixture.polyline as { points: Coord[]; cum: number[] };
    const fresh = (fixture.cases as Case[])[0].fresh;
    const first = newJamsAhead({ polyline, totalMeters: fixture.totalMeters, d: 500, known: [], fresh });
    const second = newJamsAhead({ polyline, totalMeters: fixture.totalMeters, d: 900, known: first.known, fresh });
    expect(first.nearest).not.toBeNull();
    expect(second.nearest).toBeNull();
  });
});
