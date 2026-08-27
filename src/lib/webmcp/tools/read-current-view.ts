import { finish, withFailure } from "../output";
import type { WebMcpTool } from "../types";
import type { DirectionsBridge, ToolPlan } from "./context";
import type { ModeKey } from "../route-refs";

const EMPTY_SCHEMA = { type: "object", properties: {}, additionalProperties: false } as const;

export const SHAPE = withFailure({
  ok: true,
  fields: { from: true, to: true, via: true, avoidStairs: true },
  phase: true,
  plan: {
    planId: true,
    destination: true,
    modes: [{ mode: true, outcome: true, summary: true, routeKey: true }],
  },
});

function modeSummary(plan: ToolPlan, mode: ModeKey) {
  if (mode === "transit") {
    const first = plan.transit?.routes[0];
    return {
      mode,
      outcome: plan.transit?.outcome ?? "error",
      summary: first?.oneLine,
      routeKey: first?.routeKey,
    };
  }
  const m = plan[mode];
  return { mode, outcome: m?.outcome ?? "error", summary: m?.summary };
}

/** `read_current_view`의 길찾기 뷰 부분(readOnly). W2 Task 12가 뷰 공통 도구로 재작성한다. */
export function readCurrentViewTool(bridge: DirectionsBridge): WebMcpTool {
  return {
    name: "read_current_view",
    description:
      "Read the state of the Gildongmu directions view: from/to/via fields, whether a plan is loaded (and its planId), and a short summary per travel mode with route keys. Call this before planning or when a tool returned stalePlan.",
    inputSchema: EMPTY_SCHEMA,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async () => {
      const s = bridge.read();
      const plan = s.plan
        ? {
            planId: s.plan.planId,
            destination: s.plan.destination,
            modes: s.plan.modes.map((m) => modeSummary(s.plan as ToolPlan, m)),
          }
        : null;
      return finish(
        { ok: true, fields: s.fields, phase: s.phase, plan },
        SHAPE,
        { arrays: [{ path: "plan.modes", mode: "count" }] },
      );
    },
  };
}
