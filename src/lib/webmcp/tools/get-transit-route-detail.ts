import { finish, withFailure } from "../output";
import { failure, type WebMcpTool } from "../types";
import type { DirectionsBridge } from "./context";

export const SHAPE = withFailure({
  ok: true,
  planId: true,
  routeKey: true,
  summary: true,
  legs: [
    {
      n: true,
      mode: true,
      lineName: true,
      fromName: true,
      toName: true,
      stationCount: true,
      distanceMeters: true,
      quickExit: true,
    },
  ],
});

/**
 * `get_transit_route_detail`(W2 spec §3.5, readOnly). 정거장 전체 목록은 싣지 않는다 —
 * 3,706자의 대부분이 그것이고, 정거장을 하나하나 듣는 것은 화면을 읽는 길이다.
 */
export function getTransitRouteDetailTool(bridge: DirectionsBridge): WebMcpTool {
  return {
    name: "get_transit_route_detail",
    description:
      "Return one transit route from the current plan in full: every leg with line, boarding and alighting stops, station count, walking distance, and the quick-exit door (which car and door to board so you alight next to the elevator or the transfer passage). Requires planId and routeKey from plan_directions.",
    inputSchema: {
      type: "object",
      properties: {
        planId: { type: "string", description: "planId from plan_directions." },
        routeKey: { type: "string", description: "routeKey from plan_directions." },
      },
      required: ["planId", "routeKey"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input) => {
      const s = bridge.read();
      if (!s.plan) return finish(failure("noResult"), SHAPE);
      if (input.planId !== s.plan.planId) return finish(failure("stalePlan"), SHAPE);
      const route = s.plan.transit?.routes.find((r) => r.routeKey === input.routeKey);
      if (!route) return finish(failure("unknownRouteKey"), SHAPE);
      return finish(
        {
          ok: true,
          planId: s.plan.planId,
          routeKey: route.routeKey,
          summary: route.oneLine,
          legs: route.legs,
        },
        SHAPE,
        { arrays: [{ path: "legs", mode: "count" }] },
      );
    },
  };
}
