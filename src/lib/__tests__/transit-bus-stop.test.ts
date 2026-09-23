import { describe, it, expect } from "vitest";
import fixture from "./fixtures/transit-bus-stop-cases.json";
import type { TransitGuideLeg, TransitGuideState } from "../transit-guide";
import type { TransitOverview } from "../transit-progress-overview";
import type { TransitRidingPosition } from "../transit-riding-position";
import {
  busStopMarkOf,
  busStopStep,
  overviewApplyingBusStop,
  sameBusStopMark,
  viaStopHereIndexWithBusStop,
  type TransitBusStopMark,
  type TransitBusStopTracker,
  type TransitDeviceFix,
} from "../transit-bus-stop";

type FixtureStop = { name: string; lat: number; lng: number };
type Case = {
  name: string;
  fn: string;
  state: Partial<TransitGuideState>;
  leg?: { mode?: string; trackMode?: string | null; viaStops?: FixtureStop[] };
  tracker?: TransitBusStopTracker | null;
  mark?: TransitBusStopMark | null;
  fix?: TransitDeviceFix;
  position?: TransitRidingPosition | null;
  now?: number;
  overview?: TransitOverview;
  expected: unknown;
};

function legOf(c: Case): TransitGuideLeg {
  const base = { ...fixture.leg, ...(c.leg ?? {}) } as { mode: string; trackMode: string; viaStops: FixtureStop[] };
  const stops = base.viaStops;
  return {
    mode: base.mode,
    lineName: base.mode === "subway" ? "수도권 5호선" : "340",
    trackMode: base.trackMode,
    boardName: stops[0]?.name ?? "",
    alightName: stops[stops.length - 1]?.name ?? "",
    viaStops: stops,
  } as unknown as TransitGuideLeg;
}

describe("transit-bus-stop (shared fixture, E48 §2)", () => {
  for (const raw of fixture.cases as unknown as Case[]) {
    it(`${raw.fn}: ${raw.name}`, () => {
      const state = raw.state as TransitGuideState;
      const leg = legOf(raw);
      const tracker = raw.tracker ?? null;
      const mark = raw.mark ?? null;
      const now = raw.now ?? 0;
      const actual = (() => {
        switch (raw.fn) {
          case "step": return busStopStep(tracker, state, leg, raw.fix!, now);
          case "mark": return busStopMarkOf(state, leg, tracker, now);
          case "viaHere": return viaStopHereIndexWithBusStop(state, leg, raw.position ?? null, mark, now);
          case "overview": return overviewApplyingBusStop(raw.overview!, state, leg, mark);
          default: throw new Error(`unknown fn ${raw.fn}`);
        }
      })();
      expect(actual).toEqual(raw.expected);
    });
  }
});

describe("transit-bus-stop — fixture 밖 경계", () => {
  it("비유한 좌표 정류장은 후보가 아니다(JSON은 NaN을 싣지 못해 여기서 본다 — Kit 같은 이름 테스트와 짝)", () => {
    const leg = {
      mode: "bus",
      viaStops: [
        { name: "a", lat: 37.5, lng: 127 },
        { name: "b", lat: Number.NaN, lng: 127 },
        { name: "c", lat: 37.508, lng: 127 },
      ],
    } as unknown as TransitGuideLeg;
    const state = { legIndex: 0, phase: "riding", phaseGen: 1 } as TransitGuideState;
    const fix = { lat: 37.508, lng: 127, accuracy: 10, ageSeconds: 0 };
    expect(busStopStep(null, state, leg, fix, 1000).tracker?.pendingIndex).toBe(2);
  });

  it("표식 비교 — 결박·정류장이 같을 때만 같다", () => {
    const m = { legIndex: 0, phaseGen: 1, stopIndex: 2 };
    expect(sameBusStopMark(m, { ...m })).toBe(true);
    expect(sameBusStopMark(m, { ...m, phaseGen: 2 })).toBe(false);
    expect(sameBusStopMark(null, null)).toBe(true);
    expect(sameBusStopMark(m, null)).toBe(false);
  });
});
