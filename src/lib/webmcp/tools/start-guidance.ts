import { readGuideSnapshot } from "@/lib/guide-session-store";
import { accessibleName } from "../accessible-name";
import { sleep, waitForElement } from "../dom";
import { finish, withFailure } from "../output";
import { focusTargetSelector, guideTriggerSelector, targetId } from "../targets";
import { failure, type WebMcpTool } from "../types";
import type { DirectionsBridge } from "./context";

export const SHAPE = withFailure({
  ok: true,
  status: true,
  mode: true,
  routeKey: true,
  targets: [{ id: true, label: true }],
});

/** 트리거 등장 대기(접힌 대안 펼침 뒤) — `focus_item`과 같은 상한. */
const APPEAR_TIMEOUT_MS = 500;
/** `tracking` 전이 대기 상한(spec §3.7). 그 뒤엔 `starting` 그대로 돌려준다. */
const TRACKING_WAIT_MS = 20_000;
const POLL_MS = 100;

/** 트리거 값 — `walk`·`car`는 그대로, 대중교통은 계획 안 순번 토큰(외부 문자열 금지). */
export function guideTriggerValue(mode: "walk" | "car" | "transit", routeRef?: string): string {
  return mode === "transit" ? `transit:${routeRef ?? ""}` : mode;
}

/**
 * #7 `start_guidance`(spec §3.7) — 화면의 같은 버튼을 누른다(`DistanceBeacon` 트리거·해당
 * 경로의 `TransitGuidePanel` 트리거). 세션 점유는 그 핸들러 안 `claimGuideSession`이 한다.
 * 페이지 단계 확인은 두지 않는다(위원장 판정 2026-08-27).
 */
export function startGuidanceTool(bridge: DirectionsBridge): WebMcpTool {
  return {
    name: "start_guidance",
    description:
      "Start live turn-by-turn guidance for the current plan: walking, driving, or one transit route. Same as the user pressing the guidance start button; uses the browser's location and speaks through the screen reader. Requires planId, and routeKey for transit. Returns immediately; if the browser needs a user gesture, focus is placed on the start button and confirmationRequired is returned.",
    inputSchema: {
      type: "object",
      properties: {
        planId: { type: "string", description: "planId from plan_directions." },
        mode: { type: "string", enum: ["walk", "car", "transit"], description: "Which guidance to start." },
        routeKey: {
          type: "string",
          description: "Required when mode is transit: the routeKey to guide along.",
        },
      },
      required: ["planId", "mode"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: async (input, context) => {
      const mode =
        input.mode === "walk" || input.mode === "car" || input.mode === "transit" ? input.mode : null;
      if (!mode) return finish(failure("unsupported", { detail: "mode" }), SHAPE);
      const s = bridge.read();
      if (!s.plan) return finish(failure("noResult"), SHAPE);
      const planId = s.plan.planId;
      if (input.planId !== planId) return finish(failure("stalePlan"), SHAPE);

      let triggerValue: string;
      let routeKey: string | undefined;
      if (mode === "transit") {
        // 추천 자동 선택 금지(리뷰 #12) — routeKey는 필수다.
        const key = typeof input.routeKey === "string" ? input.routeKey : "";
        if (!key) return finish(failure("notStartable", { detail: "routeKeyRequired" }), SHAPE);
        const route = s.plan.transit?.routes.find((r) => r.routeKey === key);
        if (!route) return finish(failure("unknownRouteKey"), SHAPE);
        if (!route.startable) return finish(failure("notStartable"), SHAPE);
        routeKey = route.routeKey;
        triggerValue = guideTriggerValue("transit", route.routeRef);
        bridge.expandRoute(route.routeRef);
      } else {
        const m = s.plan[mode];
        if (!m || !m.startable) return finish(failure("notStartable"), SHAPE);
        triggerValue = guideTriggerValue(mode);
      }
      const selector = guideTriggerSelector(triggerValue);
      if (!selector) return finish(failure("notStartable"), SHAPE);
      const stale = () => bridge.read().plan?.planId !== planId;
      let trigger = await waitForElement(selector, {
        timeoutMs: APPEAR_TIMEOUT_MS,
        signal: context?.signal,
        stale,
      });
      if (trigger === "aborted") return finish(failure("aborted"), SHAPE);
      if (trigger === "superseded") return finish(failure("superseded"), SHAPE);
      if (!trigger) return finish(failure("notStartable"), SHAPE);
      const active = () => {
        const g = readGuideSnapshot();
        return g.status === "starting" || g.status === "tracking";
      };
      // 활성 세션이면 트리거를 건드리지 않는다(토글이라 누르면 그 세션이 끝난다).
      if (active()) return finish(failure("sessionActive"), SHAPE);
      // 도보·자동차 트리거는 열림/닫힘 토글이다 — 실패로 열린 채 남은 패널은 한 번 닫고 다시 연다.
      if (trigger.getAttribute("aria-expanded") === "true") {
        trigger.click();
        trigger = await waitForElement(selector, { timeoutMs: APPEAR_TIMEOUT_MS, signal: context?.signal, stale });
        if (trigger === "aborted") return finish(failure("aborted"), SHAPE);
        if (trigger === "superseded") return finish(failure("superseded"), SHAPE);
        if (!trigger) return finish(failure("notStartable"), SHAPE);
      }
      // 기존 세션을 대신 끊지 않는다(§3.7 `sessionActive`). 검사와 클릭 사이에 await가 없어 한
      // JS 턴 안에서 원자적이다 — 동시에 온 두 호출 중 둘째는 첫째가 만든 `starting`을 본다.
      // 사용자 버튼은 종전대로 선점형(다른 패널 세션을 끝내고 시작)이라 그 계약은 건드리지 않는다.
      if (active()) return finish(failure("sessionActive"), SHAPE);
      trigger.click();

      const deadline = Date.now() + TRACKING_WAIT_MS;
      while (Date.now() < deadline) {
        const g = readGuideSnapshot();
        if (g.status === "tracking") {
          // 패널은 세션 커밋 뒤 렌더된다 — 착지 라벨은 그 등장을 짧게 기다려 읽는다.
          const target = await panelTarget(context?.signal);
          return finish({ ok: true, status: "tracking", mode, routeKey, targets: [target] }, SHAPE);
        }
        if (g.status === "failed") {
          // 실패로 열린 채 남은 패널은 닫아 둔다 — 열린 채 두면 트리거 라벨은 "시작"인데 누르면
          // 닫히는 라벨 거짓말이 된다(a11y 리뷰). 닫힘을 확인한 뒤 포커스를 둔다.
          await sleep(0, context?.signal); // 클릭의 열림 커밋을 기다린 뒤 판정
          if (trigger.getAttribute("aria-expanded") === "true") {
            trigger.click();
            await sleep(0, context?.signal);
          }
          trigger.focus();
          // 권한 프롬프트(사용자 제스처)로 풀릴 수 있는 실패만 폴백이다(리뷰 #10). 그 외는 시작 불가.
          if (g.failure === "geoDenied") {
            return finish(failure("confirmationRequired", { detail: "geoDenied" }), SHAPE);
          }
          return finish(failure("notStartable", { detail: g.failure ?? "failed" }), SHAPE);
        }
        if (g.status === "idle" || g.status === "done") {
          // 눌렀는데 세션이 서지 않았다(게이트·키 부재) — 시작 조건 미충족.
          return finish(failure("notStartable", { detail: "notClaimed" }), SHAPE);
        }
        if (!(await sleep(POLL_MS, context?.signal))) return finish(failure("aborted"), SHAPE);
        if (stale()) return finish(failure("superseded"), SHAPE);
      }
      return finish(
        { ok: true, status: "starting", mode, routeKey, targets: [await panelTarget(context?.signal)] },
        SHAPE,
      );
    },
  };
}

async function panelTarget(signal: AbortSignal | undefined): Promise<{ id: string; label: string }> {
  const id = targetId.guidancePanel();
  const selector = focusTargetSelector(id);
  const el = selector ? await waitForElement(selector, { timeoutMs: APPEAR_TIMEOUT_MS, signal }) : null;
  return { id, label: typeof el === "object" ? (accessibleName(el) ?? "") : "" };
}
