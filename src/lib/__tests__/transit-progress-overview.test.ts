import { describe, expect, it } from "vitest";
import scenarios from "./fixtures/transit-progress-overview-scenarios.json";
import { initTransitGuide, type TransitGuideLeg, type TransitGuideRoute } from "../transit-guide";
import { transitProgressOverview } from "../transit-progress-overview";

/**
 * 공유 시나리오 러너(spec 2026-08-23 §3·§10). Kit TransitProgressOverviewTests와 같은
 * 파일을 읽어 디스크립터 JSON 동일을 대조한다.
 */

interface FixtureLeg {
  mode: "bus" | "subway";
  lineName: string;
  trackMode: TransitGuideLeg["trackMode"];
  boardName: string;
  alightName: string;
  viaStops: string[];
  stationCount: number | null;
  walkBeforeMinutes: number | null;
}

function toRoute(r: { legs: FixtureLeg[]; walkAfterMinutes: number | null }): TransitGuideRoute {
  return {
    walkAfterMinutes: r.walkAfterMinutes,
    legs: r.legs.map((l) => ({
      mode: l.mode,
      lineName: l.lineName,
      trackMode: l.trackMode,
      boardName: l.boardName,
      alightName: l.alightName,
      boardStop: null,
      alightStop: null,
      viaStops: l.viaStops.map((name) => ({
        name,
        stationId: null,
        localId: null,
        arsId: null,
        cityCode: null,
        lat: 0,
        lng: 0,
      })),
      stationCount: l.stationCount,
      routeId: null,
      wayCode: null,
      walkBeforeMinutes: l.walkBeforeMinutes,
    })),
  };
}

describe("transitProgressOverview (shared fixture)", () => {
  for (const sc of scenarios.scenarios) {
    it(sc.name, () => {
      const route = toRoute(sc.route as never);
      const state = {
        ...initTransitGuide(route, 0),
        ...(sc.state as object),
      };
      const out = transitProgressOverview(state as never, route);
      expect(JSON.parse(JSON.stringify(out))).toEqual(sc.expected);
    });
  }
});
