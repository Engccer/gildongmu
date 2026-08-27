/**
 * 도구 목록 정본(spec §2 표) — 길찾기 뷰 9개 + 홈 1개 = 10개. 조건부 등록은 없다.
 * 이 두 함수 밖에서 `registerTool`에 넘길 도구를 만들지 않는다.
 */
import type { WebMcpTool } from "../types";
import type { DirectionsBridge, HomeBridge } from "./context";
import { focusItemTool } from "./focus-item";
import { getRouteStepsTool } from "./get-route-steps";
import { getTransitRouteDetailTool } from "./get-transit-route-detail";
import { getWalkInfrastructureNearbyTool } from "./get-walk-infrastructure-nearby";
import { guidanceStatusTool } from "./guidance-status";
import { openDirectionsTool } from "./open-directions";
import { planDirectionsTool } from "./plan-directions";
import { readCurrentViewTool } from "./read-current-view";
import { startGuidanceTool } from "./start-guidance";
import { stopGuidanceTool } from "./stop-guidance";

/** 길찾기 뷰가 마운트 동안 고정 등록하는 9개(#2~#10). */
export function buildDirectionsTools(bridge: DirectionsBridge): WebMcpTool[] {
  return [
    readCurrentViewTool(bridge),
    focusItemTool(bridge),
    planDirectionsTool(bridge),
    getTransitRouteDetailTool(bridge),
    getRouteStepsTool(bridge),
    startGuidanceTool(bridge),
    guidanceStatusTool(),
    stopGuidanceTool(),
    getWalkInfrastructureNearbyTool(),
  ];
}

/** 홈(검색 뷰)이 보일 때 등록하는 진입 도구(#1). */
export function buildHomeTools(bridge: HomeBridge): WebMcpTool[] {
  return [openDirectionsTool(bridge)];
}

export const DIRECTIONS_TOOL_NAMES = [
  "read_current_view",
  "focus_item",
  "plan_directions",
  "get_transit_route_detail",
  "get_route_steps",
  "start_guidance",
  "guidance_status",
  "stop_guidance",
  "get_walk_infrastructure_nearby",
] as const;
export const HOME_TOOL_NAMES = ["open_directions"] as const;
