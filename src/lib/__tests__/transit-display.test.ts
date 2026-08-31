import { describe, expect, it } from "vitest";
import cases from "./fixtures/transit-display-cases.json";
import { transitDisplayItem, transitDisplayLeg } from "../transit-display";
import type { TrackItem, TransitGuideLeg } from "../transit-guide";

/**
 * 표시 투영(E27 잔여 ①, spec 2026-09-01 §3.5). Kit `TransitDisplayProjectionTests`가 같은
 * fixture를 실행한다(동조 강제).
 */
const fixture = cases as unknown as {
  legs: { name: string; leg: TransitGuideLeg; boardOverrideIndex: number | null; expect: unknown }[];
  items: { name: string; item: TrackItem; expect: unknown }[];
};

describe("transitDisplayLeg / transitDisplayItem — 공유 fixture", () => {
  for (const c of fixture.legs) {
    it(`leg: ${c.name}`, () => {
      expect(transitDisplayLeg(c.leg, c.boardOverrideIndex)).toEqual(c.expect);
    });
  }
  for (const c of fixture.items) {
    it(`item: ${c.name}`, () => {
      expect(transitDisplayItem(c.item)).toEqual(c.expect);
    });
  }
});

describe("조인 필드가 투영에 없다 (1선 = 구조)", () => {
  const leg = fixture.legs[0].leg;
  it("leg 투영에 lineName·boardStop·routeId·좌표가 없다", () => {
    const keys = Object.keys(transitDisplayLeg(leg, null));
    for (const forbidden of ["lineName", "boardName", "alightName", "viaStops", "boardStop", "alightStop", "routeId", "wayCode", "trackMode", "quickExit"]) {
      expect(keys, forbidden).not.toContain(forbidden);
    }
  });
  it("item 투영에 vehicleId·arrivalCode·dataStamp가 없다", () => {
    const keys = Object.keys(transitDisplayItem(fixture.items[0].item));
    for (const forbidden of ["vehicleId", "arrivalCode", "dataStamp", "dataAgeSeconds"]) {
      expect(keys, forbidden).not.toContain(forbidden);
    }
  });
});
