/**
 * 길찾기 브릿지로 조립하는 W1 승계 도구(W2 spec 2026-08-29 §2 표 — `plan_directions`·
 * `get_transit_route_detail`·`get_route_steps`). 조건부 등록은 없다.
 */
import type { WebMcpTool } from "../types";
import type { DirectionsBridge } from "./context";
import { getRouteStepsTool } from "./get-route-steps";
import { getTransitRouteDetailTool } from "./get-transit-route-detail";
import { planDirectionsTool } from "./plan-directions";
import { readCurrentViewTool } from "./read-current-view";

export function buildDirectionsTools(bridge: DirectionsBridge): WebMcpTool[] {
  return [
    readCurrentViewTool(bridge),
    planDirectionsTool(bridge),
    getTransitRouteDetailTool(bridge),
    getRouteStepsTool(bridge),
  ];
}

export const DIRECTIONS_TOOL_NAMES = [
  "read_current_view",
  "plan_directions",
  "get_transit_route_detail",
  "get_route_steps",
] as const;
