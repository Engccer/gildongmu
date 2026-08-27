import { finish, withFailure } from "../output";
import { targetId } from "../targets";
import { failure, type WebMcpTool } from "../types";
import type { DirectionsBridge } from "./context";

export const SHAPE = withFailure({
  ok: true,
  planId: true,
  mode: true,
  outcome: true,
  total: true,
  offset: true,
  returnedCount: true,
  nextOffset: true,
  steps: [{ n: true, text: true, targetId: true }],
});

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;

/** #6 `get_route_steps`(spec §3.6, readOnly) — 도보·자동차 스텝 페이지. 문장은 화면과 동일. */
export function getRouteStepsTool(bridge: DirectionsBridge): WebMcpTool {
  return {
    name: "get_route_steps",
    description:
      "Return walking or driving directions from the current plan as a numbered page of step sentences, exactly as shown on screen, with a focus target id per step. Page with offset and limit. Requires planId.",
    inputSchema: {
      type: "object",
      properties: {
        planId: { type: "string", description: "planId from plan_directions." },
        mode: { type: "string", enum: ["walk", "car"], description: "Which directions to page." },
        offset: { type: "integer", minimum: 0, description: "0-based start index. Default 0." },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_LIMIT,
          description: `Steps per page, 1 to ${MAX_LIMIT}. Default ${DEFAULT_LIMIT}.`,
        },
      },
      required: ["planId", "mode"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input) => {
      const mode = input.mode === "walk" || input.mode === "car" ? input.mode : null;
      if (!mode) return finish(failure("unsupported", { detail: "mode" }), SHAPE);
      const s = bridge.read();
      if (!s.plan) return finish(failure("noResult"), SHAPE);
      if (input.planId !== s.plan.planId) return finish(failure("stalePlan"), SHAPE);
      const m = s.plan[mode];
      if (!m) return finish(failure("unsupported", { detail: "modeUnavailable" }), SHAPE);
      // 수단 결과의 3-state를 최상위에 둔다(리뷰 #2) — steps 없음이 "0단계"가 아니다.
      if (m.outcome !== "done") {
        return finish({ ok: true, planId: s.plan.planId, mode, outcome: m.outcome }, SHAPE);
      }
      const offset = clampInt(input.offset, 0, Number.MAX_SAFE_INTEGER, 0);
      const limit = clampInt(input.limit, 1, MAX_LIMIT, DEFAULT_LIMIT);
      const total = m.steps.length;
      const page = m.steps.slice(offset, offset + limit).map((text, i) => ({
        n: offset + i + 1,
        text,
        targetId: targetId.step(mode, offset + i + 1),
      }));
      const end = offset + page.length;
      return finish(
        {
          ok: true,
          planId: s.plan.planId,
          mode,
          outcome: "done",
          total,
          offset,
          returnedCount: page.length,
          nextOffset: end < total ? end : null,
          steps: page,
        },
        SHAPE,
        { arrays: [{ path: "steps", mode: "page" }] },
      );
    },
  };
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
