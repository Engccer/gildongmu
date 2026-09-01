import { describe, it, expect } from "vitest";
import scenariosFixture from "./fixtures/transit-guide-scenarios.json";
import toneFixture from "./fixtures/transit-guide-tone-scenarios.json";
import {
  initTransitGuide,
  transitGuideStep,
  type TransitGuideRoute,
  type TransitInput,
  type TransitLock,
} from "../transit-guide";
import {
  INITIAL_TRANSIT_TONE_STATE,
  TRANSIT_UNRELIABLE_INTERVAL_S,
  transitToneLayerStep,
  transitToneStep,
  type TransitToneState,
} from "../transit-guide-tone";

/**
 * 공유 fixture 실행기(spec 2026-09-02 §2.7) — Kit `TransitGuideToneTests`와 같은 파일을 돌린다.
 * 리듀서(`transitGuideStep`)와 층(`transitToneStep`)을 **이어서** 돌려 "리듀서 입력 → 톤"을 잠근다
 * (설계 리뷰 #6 — 층 단독 fixture는 phaseGen 리셋·신호 전이·도착 억제를 지나지 않는다).
 */

interface FixtureStep {
  at: number;
  input: Record<string, unknown>;
  expect: {
    tone?: string | null;
    anchor?: number | null;
    event?: string | null;
    phase?: string;
    signal?: string;
  };
}
interface FixtureScenario {
  name: string;
  route: string;
  steps: FixtureStep[];
}
const base = scenariosFixture as unknown as {
  routes: Record<string, TransitGuideRoute>;
  locks: Record<string, TransitLock>;
};
const fixture = toneFixture as unknown as { scenarios: FixtureScenario[] };

function resolveInput(raw: Record<string, unknown>): TransitInput {
  if (raw.kind === "board") {
    return { kind: "board", lock: base.locks[raw.lock as string] };
  }
  return raw as unknown as TransitInput;
}

describe("transitToneStep — 공유 fixture(리듀서 입력 → 톤)", () => {
  for (const scenario of fixture.scenarios) {
    it(scenario.name, () => {
      const route = base.routes[scenario.route];
      expect(route).toBeDefined();
      let state = initTransitGuide(route, 0);
      let tone: TransitToneState = INITIAL_TRANSIT_TONE_STATE;
      for (const [i, step] of scenario.steps.entries()) {
        const ctx = `${scenario.name} step ${i}`;
        const before = state;
        const { state: after, event } = transitGuideStep(before, resolveInput(step.input), route, step.at);
        state = after;
        const out = transitToneStep(tone, before, after, event, step.at / 1000);
        tone = out.state;
        const exp = step.expect;
        if ("tone" in exp) expect(out.tone, ctx).toBe(exp.tone ?? null);
        if ("anchor" in exp) expect(tone.anchorRemaining, ctx).toBe(exp.anchor ?? null);
        if ("event" in exp) expect(event?.kind ?? null, `${ctx} event`).toBe(exp.event ?? null);
        if ("phase" in exp) expect(after.phase, ctx).toBe(exp.phase);
        if ("signal" in exp) expect(after.signal, ctx).toBe(exp.signal);
      }
    });
  }
});

describe("transitToneLayerStep — 층 단독 계약", () => {
  const input = (over: Partial<Parameters<typeof transitToneLayerStep>[1]> = {}) => ({
    unreliable: false,
    eventOwned: false,
    remaining: null,
    arrivedCertain: false,
    ...over,
  });

  it("확정 도착은 앵커·타이머·톤 전부 불변", () => {
    const s: TransitToneState = { anchorRemaining: 3, wasUnreliable: true, lastUnreliableAt: 0 };
    const out = transitToneLayerStep(s, input({ arrivedCertain: true, unreliable: true, remaining: 0 }), 500);
    expect(out.tone).toBeNull();
    expect(out.state).toEqual(s);
  });

  it("이벤트 소유가 신뢰 불가보다 앞 — 신뢰 불가 중 이벤트 폴은 무음이고 타이머를 지금으로", () => {
    const s: TransitToneState = { anchorRemaining: 5, wasUnreliable: true, lastUnreliableAt: 0 };
    const out = transitToneLayerStep(s, input({ unreliable: true, eventOwned: true }), 300);
    expect(out.tone).toBeNull();
    expect(out.state.lastUnreliableAt).toBe(300);
    // 그 뒤 60초가 지나야 반복.
    expect(transitToneLayerStep(out.state, input({ unreliable: true }), 300 + TRANSIT_UNRELIABLE_INTERVAL_S - 1).tone).toBeNull();
    expect(transitToneLayerStep(out.state, input({ unreliable: true }), 300 + TRANSIT_UNRELIABLE_INTERVAL_S).tone).toBe("unreliable");
  });

  it("신뢰 불가 진입 폴은 무음(진입 톤은 이벤트 몫)", () => {
    const out = transitToneLayerStep(INITIAL_TRANSIT_TONE_STATE, input({ unreliable: true }), 100);
    expect(out.tone).toBeNull();
    expect(out.state.wasUnreliable).toBe(true);
    expect(out.state.lastUnreliableAt).toBe(100);
  });

  it("앵커가 없는 첫 잔여는 무음으로 앵커만 잡는다", () => {
    const out = transitToneLayerStep(INITIAL_TRANSIT_TONE_STATE, input({ remaining: 7 }), 0);
    expect(out.tone).toBeNull();
    expect(out.state.anchorRemaining).toBe(7);
  });
});
