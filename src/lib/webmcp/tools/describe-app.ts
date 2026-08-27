/**
 * #1 `describe_app`(spec §3.1, readOnly, 잠금 미경유) — 이 배포가 에이전트에게 무엇을 해 줄 수 있는지.
 * `tools`는 manifest에서 **생성**한다(별도 상수 없음).
 */
import { finish, withFailure } from "../output";
import type { WebMcpTool } from "../types";
import { currentView } from "../view-registry";
import type { ToolDef, ToolGates } from "../manifest";

const EMPTY_SCHEMA = { type: "object", properties: {}, additionalProperties: false } as const;

export const SHAPE = withFailure({
  ok: true,
  currentView: true,
  tools: [{ name: true, available: true, reason: true, requires: true, produces: true }],
  axes: [{ axis: true, available: true }],
  notes: [true],
});

/** spec §3.1 고정 영문 다섯 문장. */
export const NOTES = [
  "Tools switch screens by themselves; the output's view field says where the app is now",
  "To only open a screen, use the app; tools always answer",
  "AI chat and the Nearby hub have no tools — they are on-screen only",
  "The app never returns coordinates",
  "One tool runs at a time; a second call returns busy",
];

export function describeAppTool(gates: ToolGates, manifest: () => readonly ToolDef[]): WebMcpTool {
  return {
    name: "describe_app",
    description:
      "Describe what the Gildongmu app can do for an agent: the tools, which are available in this deployment, how they chain (search_places → get_place_info / plan_directions → route detail), and the station info axes. Call once at the start.",
    inputSchema: EMPTY_SCHEMA,
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute: async () =>
      finish(
        {
          ok: true,
          currentView: currentView() ?? "home",
          tools: manifest().map((d) => {
            const available = d.available(gates);
            return {
              name: d.name,
              available,
              reason: available ? undefined : "notConfigured",
              requires: d.requires,
              produces: d.produces,
            };
          }),
          axes: [
            { axis: "basic", available: true },
            { axis: "timetable", available: true },
            { axis: "facilities", available: true },
            { axis: "arrivals", available: gates.canShowSubway },
            { axis: "barrierFree", available: gates.canShowBarrierFree },
          ],
          notes: NOTES,
        },
        SHAPE,
        { arrays: [{ path: "notes", mode: "count" }, { path: "axes", mode: "count" }, { path: "tools", mode: "count" }] },
      ),
  };
}
