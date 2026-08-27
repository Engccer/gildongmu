/**
 * 도구 목록 정본(spec §5.1) — 이름·가용 게이트·연쇄(requires/produces)·잠금 여부 한 벌.
 * 설명·입력 스키마·readOnly는 각 도구 파일이 정본이고 여기서 조립한 도구 객체에서 읽는다(두 곳에 두지 않는다).
 * `describe_app`도 이 표를 읽으므로 등록 이름 집합 = 고지 이름 집합이 구조적으로 같다.
 *
 * 출력 필드 출처(spec §7): 사용자 입력(검색어·길찾기 필드), 화면 문장(장소·역·경로 문장 — place-lines·
 * route-step-items와 같은 함수), 외부 URL(`search_places.web[].url`뿐, origin+path). 좌표는 어느 표에도 없다.
 */
import type { WebMcpTool } from "./types";
import { describeAppTool } from "./tools/describe-app";
import { getPlaceInfoTool } from "./tools/get-place-info";
import { getRouteStepsTool } from "./tools/get-route-steps";
import { getTransitRouteDetailTool } from "./tools/get-transit-route-detail";
import { planDirectionsTool } from "./tools/plan-directions";
import { readCurrentViewTool } from "./tools/read-current-view";
import { searchPlacesTool } from "./tools/search-places";

export interface ToolGates {
  hasWalk: boolean;
  hasTransit: boolean;
  hasCar: boolean;
  canShowSubway: boolean;
  canShowBarrierFree: boolean;
}

export type ToolName =
  | "describe_app"
  | "search_places"
  | "get_place_info"
  | "plan_directions"
  | "get_transit_route_detail"
  | "get_route_steps"
  | "read_current_view";

export interface ToolDef {
  name: ToolName;
  /** 단일 실행 잠금을 지나는가(읽기 도구 둘은 아니다). */
  locks: boolean;
  requires?: string;
  produces?: string;
  available(gates: ToolGates): boolean;
  build(gates: ToolGates): WebMcpTool;
}

const DEFS: readonly ToolDef[] = [
  { name: "describe_app", locks: false, available: () => true, build: (g) => describeAppTool(g, manifest) },
  { name: "search_places", locks: true, produces: "ref", available: () => true, build: () => searchPlacesTool() },
  { name: "get_place_info", locks: true, requires: "ref", available: () => true, build: () => getPlaceInfoTool() },
  {
    name: "plan_directions",
    locks: true,
    requires: "ref (toRef, optional)",
    produces: "planId, routeKey",
    available: (g) => g.hasWalk || g.hasTransit || g.hasCar,
    build: () => planDirectionsTool(),
  },
  {
    name: "get_transit_route_detail",
    locks: false,
    requires: "planId, routeKey",
    available: (g) => g.hasTransit,
    build: () => getTransitRouteDetailTool(),
  },
  {
    name: "get_route_steps",
    locks: false,
    requires: "planId",
    available: (g) => g.hasWalk || g.hasCar,
    build: () => getRouteStepsTool(),
  },
  { name: "read_current_view", locks: false, available: () => true, build: () => readCurrentViewTool() },
];

export const TOOL_NAMES: readonly ToolName[] = DEFS.map((d) => d.name);

export function manifest(): readonly ToolDef[] {
  return DEFS;
}

/** 루트가 마운트 1회 등록하는 7개 — 전부 정적 등록(가용하지 않은 도구도 등록하고 실행 시 notConfigured). */
export function buildAppTools(gates: ToolGates): WebMcpTool[] {
  return DEFS.map((d) => {
    const tool = d.build(gates);
    if (tool.name !== d.name) throw new Error(`manifest name mismatch: ${d.name} != ${tool.name}`);
    if (d.available(gates)) return tool;
    return {
      ...tool,
      execute: async () =>
        JSON.stringify({ ok: false, reason: "notConfigured", retryable: false, userActionRequired: false }),
    };
  });
}
