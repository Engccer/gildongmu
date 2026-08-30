import { describe, expect, it } from "vitest";
import ko from "../../../messages/ko.json";
import scenarios from "./fixtures/guide-live-rows-scenarios.json";
import {
  buildDisplayUnits,
  guideLiveRows,
  isCrossingStep,
  liveStepsFrom,
  TURN_APPROACH_M,
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

type Kind = "walk" | "car";
const phrases = (kind: Kind) =>
  (kind === "car" ? g.carLiveAction : g.liveAction) as Record<string, string>;
const imminents = (kind: Kind) =>
  (kind === "car" ? g.carImminent : g.imminent) as Record<string, string>;

/** 행동 구는 수단별이다(K2 §4) — 디스크립터는 같고 렌더 키만 갈린다(iOS GuideText 동형). */
function actionPhrase(kind: Kind, action: string): string {
  const phrase = phrases(kind)[action];
  if (!phrase) throw new Error(`문구 없음: ${kind} ${action}`);
  return phrase;
}

function renderTop(kind: Kind, top: LiveTopRow | null): string {
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
    case "turnSoon": {
      const phrase = imminents(kind)[top.action];
      if (!phrase) throw new Error(`문구 없음: ${kind} ${top.action}`);
      return phrase;
    }
    case "turnIn":
      return fmt(g.liveTurnIn, { n: top.meters, action: actionPhrase(kind, top.action) });
    case "straight":
      return top.target
        ? fmt(g.liveStraight, { target: top.target, n: top.meters })
        : fmt(g.liveStraightNoName, { n: top.meters });
  }
}

function renderNext(kind: Kind, next: LiveNextRow | null): string {
  if (next === null) return "";
  let step: string;
  switch (next.kind) {
    case "action":
      step = next.anchor
        ? fmt(g.nextAction, { anchor: next.anchor, action: actionPhrase(kind, next.action) })
        : actionPhrase(kind, next.action);
      break;
    case "straight":
      step = next.target
        ? fmt(g.nextStraight, { target: next.target, n: next.meters })
        : fmt(g.nextStraightNoName, { n: next.meters });
      break;
    case "crossing":
    case "turn":
      step = actionPhrase(kind, next.action);
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

describe("isCrossingStep — 횡단 유닛은 서버 플래그로 판정한다(A26, 언어 무관)", () => {
  it("행동이 crosswalk/underpass이고 서버가 crossing을 표시했을 때만 참", () => {
    expect(isCrossingStep("crosswalk", true)).toBe(true);
    expect(isCrossingStep("underpass", true)).toBe(true);
    expect(isCrossingStep("left", true)).toBe(false);
    expect(isCrossingStep("crosswalk", undefined)).toBe(false);
    expect(isCrossingStep(null, true)).toBe(false);
  });

  it("en 문장(Tmap)도 플래그만 있으면 횡단 유닛이 된다 — 문자열 '건너'에 의존하지 않는다", () => {
    const steps: LiveStepInput[] = [
      { description: "Walk 50m", startD: 0, endD: 50 },
      {
        description: "Cross the crosswalk, then walk 30m",
        startD: 50,
        endD: 80,
        action: "crosswalk",
        crossing: true,
      },
      { description: "Turn left, then walk 40m", startD: 80, endD: 120, action: "left" },
    ];
    const units = buildDisplayUnits(steps, "step");
    expect(units.map((u) => u.crossing)).toEqual([false, true, false]);
    expect(units[1].crossingText).toBe("Cross the crosswalk, then walk 30m");
    expect(units[0].endAction).toBe("crosswalk");
  });

  it("플래그 없는 crosswalk 행동(지명 '횡단보도' 이동 스텝)은 횡단 유닛이 아니다 — ko 동작 불변", () => {
    const steps: LiveStepInput[] = [
      { description: "천호역 횡단보도까지 100m 이동", startD: 0, endD: 100, action: "crosswalk" },
    ];
    expect(buildDisplayUnits(steps, "step")[0].crossing).toBe(false);
  });

  it("liveStepsFrom은 응답 스텝의 crossing을 표시 입력으로 옮긴다", () => {
    const route = {
      steps: [
        { index: 0, description: "a", startD: 0, endD: 10, isLong: true },
        { index: 1, description: "b", startD: 10, endD: 20, isLong: true, action: "crosswalk" },
      ],
    } as unknown as Parameters<typeof liveStepsFrom>[0];
    const out = liveStepsFrom(route, [{}, { crossing: true }]);
    expect("crossing" in out[0]).toBe(false);
    expect(out[1]).toMatchObject({ action: "crosswalk", crossing: true });
  });
});

describe("guide-live-rows 공유 시나리오(기대 문자열)", () => {
  for (const sc of (
    scenarios as {
      scenarios: {
        name: string;
        /** 수단(문구 키 선택). 미지정 walk. */
        kind?: Kind;
        /** 회전 접근 전환 잔여(m). 미지정 `TURN_APPROACH_M`(walk). car 시나리오는 명시. */
        turnApproachM?: number;
        steps: {
          len: number;
          desc: string;
          target?: string;
          anchor?: string;
          action?: string;
          crossing?: boolean;
        }[];
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
        const input: LiveStepInput = {
          description: s.desc, startD: acc, endD: acc + s.len,
          ...(live ? { live } : {}),
          ...(s.action ? { action: s.action as LiveStepInput["action"] } : {}),
          ...(s.crossing ? { crossing: true } : {}),
        };
        acc += s.len;
        return input;
      });
      const units = buildDisplayUnits(steps, sc.kind === "car" ? "step" : "text");
      let state: LiveRowsState | null = null;
      let baselineD = sc.baselineD;
      const results: { top: string; next: string }[] = [];
      for (const input of sc.inputs) {
        if (input.reset) {
          state = null;
          if (input.baselineD !== undefined) baselineD = input.baselineD;
        }
        const out = guideLiveRows(
          state, units, input.d, baselineD, input.phase as GuidePhase,
          sc.turnApproachM ?? TURN_APPROACH_M,
        );
        state = out.state;
        results.push({ top: renderTop(sc.kind ?? "walk", out.top), next: renderNext(sc.kind ?? "walk", out.next) });
      }
      for (const ex of sc.expect) {
        expect(results[ex.afterInput].top, `#${ex.afterInput} top`).toBe(ex.top);
        expect(results[ex.afterInput].next, `#${ex.afterInput} next`).toBe(ex.next);
      }
    });
  }
});
