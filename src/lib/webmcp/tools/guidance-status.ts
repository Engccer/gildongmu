import { readGuideSnapshot } from "@/lib/guide-session-store";
import { finish, withFailure } from "../output";
import type { WebMcpTool } from "../types";

const EMPTY_SCHEMA = { type: "object", properties: {}, additionalProperties: false } as const;

/** spec §3.8 필드 — 리듀서 내부(`phase`·`stepIndex`)는 표에 없다. */
export const SHAPE = withFailure({
  ok: true,
  status: true,
  sessionId: true,
  mode: true,
  routeKey: true,
  now: true,
  next: true,
  remainingMeters: true,
  etaSeconds: true,
  remainingStops: true,
  offRoute: true,
  signal: true,
  degraded: true,
  lastMessage: true,
  dataAgeSeconds: true,
});

/** #8 `guidance_status`(spec §3.8, readOnly) — 세션 소유자(`guide-session-store`)의 스냅샷. */
export function guidanceStatusTool(): WebMcpTool {
  return {
    name: "guidance_status",
    description:
      "Read the live guidance session: status, what to do now, what comes next, distance or stops remaining, off-route or signal-lost flags. Always available; returns status idle when no session is running. Read-only; it never speaks.",
    inputSchema: EMPTY_SCHEMA,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async () => {
      const g = readGuideSnapshot();
      return finish({ ok: true, ...g }, SHAPE);
    },
  };
}
