import { describe, expect, it } from "vitest";
import ko from "../../../messages/ko.json";
import scenarios from "./fixtures/guide-live-rows-scenarios.json";
import {
  buildDisplayUnits,
  guideLiveRows,
  type LiveNextRow,
  type LiveRowsState,
  type LiveStepInput,
  type LiveTopRow,
} from "../guide-live-rows";
import type { GuidePhase } from "../route-guide";

/**
 * 공유 시나리오 러너(spec §8-1). 디스크립터를 messages/ko.json 템플릿으로 렌더한
 * **최종 문자열**을 대조한다 — 키 존재·인자 어순 드리프트까지 이 파일이 잠근다.
 * Kit GuideLiveRowsTests와 렌더 규칙이 같아야 한다(둘 다 ko.json을 직접 읽는다).
 */

const g = ko.guide;

function fmt(tpl: string, args: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(args[k]));
}

function actionPhrase(action: keyof typeof g.liveAction): string {
  return g.liveAction[action];
}

function renderTop(top: LiveTopRow | null): string {
  if (top === null) return "";
  switch (top.kind) {
    case "offRoute":
      return g.offRoute;
    case "uncertain":
      return g.uncertain;
    case "reacquiring":
      return g.reacquiring;
    case "crossing":
      return top.text;
    case "turnSoon":
      return g.imminent[top.action];
    case "turnIn":
      return fmt(g.liveTurnIn, { n: top.meters, action: actionPhrase(top.action) });
    case "straight":
      return top.target
        ? fmt(g.liveStraight, { target: top.target, n: top.meters })
        : fmt(g.liveStraightNoName, { n: top.meters });
  }
}

function renderNext(next: LiveNextRow | null): string {
  if (next === null) return "";
  let step: string;
  switch (next.kind) {
    case "action":
      step = next.anchor
        ? fmt(g.nextAction, { anchor: next.anchor, action: actionPhrase(next.action) })
        : actionPhrase(next.action);
      break;
    case "straight":
      step = next.target
        ? fmt(g.nextStraight, { target: next.target, n: next.meters })
        : fmt(g.nextStraightNoName, { n: next.meters });
      break;
    case "crossing":
    case "turn":
      step = actionPhrase(next.action);
      break;
  }
  return fmt(g.progressNext, { step });
}

interface ScenarioInput {
  d: number;
  phase: string;
  reset?: boolean;
  baselineD?: number;
}

describe("guide-live-rows 공유 시나리오(기대 문자열)", () => {
  for (const sc of (
    scenarios as {
      scenarios: {
        name: string;
        steps: { len: number; desc: string; target?: string; anchor?: string }[];
        baselineD: number;
        inputs: ScenarioInput[];
        expect: { afterInput: number; top: string; next: string }[];
      }[];
    }
  ).scenarios) {
    it(sc.name, () => {
      let acc = 0;
      const steps: LiveStepInput[] = sc.steps.map((s) => {
        const live =
          s.target || s.anchor
            ? { ...(s.target && { target: s.target }), ...(s.anchor && { anchor: s.anchor }) }
            : undefined;
        const input = { description: s.desc, startD: acc, endD: acc + s.len, ...(live ? { live } : {}) };
        acc += s.len;
        return input;
      });
      const units = buildDisplayUnits(steps);
      let state: LiveRowsState | null = null;
      let baselineD = sc.baselineD;
      const results: { top: string; next: string }[] = [];
      for (const input of sc.inputs) {
        if (input.reset) {
          state = null;
          if (input.baselineD !== undefined) baselineD = input.baselineD;
        }
        const out = guideLiveRows(state, units, input.d, baselineD, input.phase as GuidePhase);
        state = out.state;
        results.push({ top: renderTop(out.top), next: renderNext(out.next) });
      }
      for (const ex of sc.expect) {
        expect(results[ex.afterInput].top, `#${ex.afterInput} top`).toBe(ex.top);
        expect(results[ex.afterInput].next, `#${ex.afterInput} next`).toBe(ex.next);
      }
    });
  }
});
