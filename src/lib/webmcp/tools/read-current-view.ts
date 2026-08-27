import { readGuideSnapshot } from "@/lib/guide-session-store";
import { activeElementLabel } from "../accessible-name";
import { activeTargetId, listHighLevelTargets } from "../dom";
import { finish, withFailure } from "../output";
import type { WebMcpTool } from "../types";
import type { DirectionsBridge, ToolPlan } from "./context";
import type { ModeKey } from "../targets";

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
  guidance: { status: true, mode: true, routeKey: true },
  keyboardFocus: { label: true, targetId: true },
  targets: [{ id: true, label: true }],
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

/** #2 `read_current_view`(spec §3.2, readOnly). */
export function readCurrentViewTool(bridge: DirectionsBridge): WebMcpTool {
  return {
    name: "read_current_view",
    description:
      "Read the state of the Gildongmu directions view: from/to/via fields, whether a plan is loaded (and its planId), a short summary per travel mode with route keys, the guidance session state, which element has keyboard focus, and the high-level focus targets for focus_item. Call this before planning, focusing, or when a tool returned stalePlan.",
    inputSchema: EMPTY_SCHEMA,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async () => {
      const s = bridge.read();
      const g = readGuideSnapshot();
      const plan = s.plan
        ? {
            planId: s.plan.planId,
            destination: s.plan.destination,
            modes: s.plan.modes.map((m) => modeSummary(s.plan as ToolPlan, m)),
          }
        : null;
      return finish(
        {
          ok: true,
          fields: s.fields,
          phase: s.phase,
          plan,
          guidance: { status: g.status, mode: g.mode, routeKey: g.routeKey },
          // ⚠ 키보드 포커스다 — VoiceOver 탐색 커서가 아니다(spec §6.7).
          keyboardFocus: { label: activeElementLabel(), targetId: activeTargetId() },
          targets: listHighLevelTargets(),
        },
        SHAPE,
        { arrays: [{ path: "targets", mode: "count" }, { path: "plan.modes", mode: "count" }] },
      );
    },
  };
}
