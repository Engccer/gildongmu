/**
 * #7 `read_current_view`(spec §3.6, readOnly, 잠금 미경유) — 지금 어느 화면인지와 그 화면의 요약.
 * 도구 이동 중이면 화면 데이터를 섞지 않고 `viewChanging`(+`toolRunning`)만 낸다. DOM 포커스도
 * VO 커서도 주장하지 않는다(W1 §6.7).
 */
import { hasActiveGuideSession } from "@/lib/guide-session-store";
import { finish, withFailure } from "../output";
import { runningToolName } from "../tool-lock";
import { failure, type WebMcpTool } from "../types";
import { bridgeOf, currentView } from "../view-registry";
import type { DirectionsBridge, HomeBridge, PlaceBridge, ToolPlan } from "./context";
import type { ModeKey } from "../route-refs";

const EMPTY_SCHEMA = { type: "object", properties: {}, additionalProperties: false } as const;

export const SHAPE = withFailure({
  ok: true,
  view: true,
  toolRunning: true,
  // 홈
  query: true,
  sort: true,
  searchRef: true,
  branches: { places: true, addresses: true, web: true },
  counts: { places: true, addresses: true, web: true },
  chatOpen: true,
  // 길찾기
  fields: { from: true, to: true, via: true, avoidStairs: true },
  phase: true,
  plan: {
    planId: true,
    destination: true,
    modes: [{ mode: true, outcome: true, summary: true, routeKey: true }],
  },
  guidanceActive: true,
  // 상세
  name: true,
  isStation: true,
  axes: [{ axis: true, status: true }],
  // 내 주변
  note: true,
});

export const DESCRIPTION =
  "Call this when a tool returned stalePlan, or to learn which screen the app is on (home, directions, place, nearby) and what it shows: the search query and counts, the directions fields and plan summary, or the place and its info axes.";

function modeSummary(plan: ToolPlan, mode: ModeKey) {
  if (mode === "transit") {
    const first = plan.transit?.routes[0];
    return { mode, outcome: plan.transit?.outcome ?? "error", summary: first?.oneLine, routeKey: first?.routeKey };
  }
  const m = plan[mode];
  return { mode, outcome: m?.outcome ?? "error", summary: m?.summary };
}

export function readCurrentViewTool(): WebMcpTool {
  return {
    name: "read_current_view",
    description: DESCRIPTION,
    inputSchema: EMPTY_SCHEMA,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async () => {
      const view = currentView();
      const toolRunning = runningToolName() ?? undefined;
      if (view === "changing") return finish(failure("viewChanging", { toolRunning }), SHAPE);
      if (view === "directions") {
        const s = bridgeOf<DirectionsBridge>("directions")!.bridge.read();
        const plan = s.plan
          ? { planId: s.plan.planId, destination: s.plan.destination, modes: s.plan.modes.map((m) => modeSummary(s.plan as ToolPlan, m)) }
          : null;
        return finish(
          { ok: true, view, toolRunning, fields: s.fields, phase: s.phase, plan, guidanceActive: hasActiveGuideSession() },
          SHAPE,
          { arrays: [{ path: "plan.modes", mode: "count" }] },
        );
      }
      if (view === "place") {
        const b = bridgeOf<PlaceBridge>("place")!.bridge;
        const info = b.read();
        const keys = ["basic", "timetable", "facilities", "facilitiesMetro", "arrivals", "barrierFree"] as const;
        return finish(
          {
            ok: true,
            view,
            toolRunning,
            name: info.name,
            isStation: info.isStation,
            chatOpen: info.chatOpen,
            axes: keys.map((k) => ({ axis: k, status: b.axes[k].present ? b.axes[k].read().status : "notConfigured" })),
          },
          SHAPE,
          { arrays: [{ path: "axes", mode: "count" }] },
        );
      }
      if (view === "nearby") return finish({ ok: true, view, toolRunning, note: "no tools on this screen" }, SHAPE);
      const home = bridgeOf<HomeBridge>("home")?.bridge;
      if (!home) return finish(failure("unsupported", { detail: "noHomeView" }), SHAPE);
      const h = home.read();
      return finish(
        {
          ok: true,
          view: "home",
          toolRunning,
          query: h.query,
          sort: h.sort,
          searchRef: h.attempt === null ? undefined : h.attempt.toString(36),
          branches: h.branches ?? undefined,
          counts: h.counts,
          chatOpen: h.chatOpen,
        },
        SHAPE,
      );
    },
  };
}
