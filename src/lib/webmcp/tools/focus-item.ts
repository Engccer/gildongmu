import { accessibleName } from "../accessible-name";
import { waitForElement } from "../dom";
import { finish, withFailure } from "../output";
import {
  FOCUS_TARGET_ATTR,
  focusTargetSelector,
  isPlanScoped,
  parseTargetId,
} from "../targets";
import { failure, type WebMcpTool } from "../types";
import type { DirectionsBridge } from "./context";

export const SHAPE = withFailure({ ok: true, label: true });

/** 접힌 disclosure를 펼친 뒤 대상이 DOM에 나타나기까지 기다리는 상한(spec §3.3 ③). */
const APPEAR_TIMEOUT_MS = 500;

/**
 * #3 `focus_item`(spec §3.3) — 축 A. 도구층에서 포커스를 **능동적으로** 옮기는 유일한 코드다
 * (§6.1). 통지하지 않는다 — 착지 낭독이 곧 통지다(§6.4).
 */
export function focusItemTool(bridge: DirectionsBridge): WebMcpTool {
  return {
    name: "focus_item",
    description:
      "Move keyboard focus (and with it the screen reader's reading position) to one element of the directions view, so the user hears it in place instead of you reading it back. Use only when the user asked to be taken to something. Target ids come from read_current_view, plan_directions, get_route_steps, or get_transit_route_detail. Returns the label now under focus.",
    inputSchema: {
      type: "object",
      properties: {
        targetId: { type: "string", description: "Focus target id." },
        planId: {
          type: "string",
          description:
            "Required for plan-scoped targets (mode, route, step, leg). Omit for fields and controls.",
        },
      },
      required: ["targetId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: async (input, context) => {
      const id = typeof input.targetId === "string" ? input.targetId : "";
      const parsed = parseTargetId(id);
      if (!parsed) return finish(failure("notFound"), SHAPE);
      const planId = typeof input.planId === "string" ? input.planId : null;
      const planScoped = isPlanScoped(parsed);
      const stale = () => planScoped && bridge.read().plan?.planId !== planId;
      // ① 계획 범위 대상은 현재 세대여야 한다.
      if (stale()) return finish(failure("stalePlan"), SHAPE);
      // ② 타이핑 중인 필드에서 커서를 빼앗지 않는다(대상이 그 필드 자신이 아닐 때).
      const active = document.activeElement;
      if (
        (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) &&
        active.getAttribute(FOCUS_TARGET_ATTR) !== id
      ) {
        return finish(failure("editingInProgress"), SHAPE);
      }
      // ③ 접힌 대안·상세 안이면 화면 핸들러로 펼치고 등장을 기다린다.
      bridge.ensureVisible(parsed);
      const selector = focusTargetSelector(id);
      if (!selector) return finish(failure("notFound"), SHAPE);
      const el = await waitForElement(selector, {
        timeoutMs: APPEAR_TIMEOUT_MS,
        signal: context?.signal,
        stale,
      });
      if (el === "aborted") return finish(failure("aborted"), SHAPE);
      if (el === "superseded") return finish(failure("superseded"), SHAPE);
      if (!el) return finish(failure("notFound"), SHAPE);
      // ④ 착지. 비인터랙티브 대상은 `tabIndex={-1}`(프로그래밍 포커스만)이어야 한다.
      el.focus();
      if (document.activeElement !== el) return finish(failure("focusRejected"), SHAPE);
      return finish({ ok: true, label: accessibleName(el) ?? "" }, SHAPE);
    },
  };
}
