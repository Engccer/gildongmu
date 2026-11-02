import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  journeyStart,
  journeyStep,
  journeyToken,
  type JourneyEvent,
  type JourneyPhase,
  type JourneyShape,
  type JourneyState,
} from "../journey-step";

/**
 * 공유 fixture(Kit `JourneyStepSharedTests`와 같은 파일)로 전이 표를 잠근다. fixture를 고치면 Kit 테스트도 같은 값을
 * 받아야 한다 — 표가 갈리면 같은 여정이 iOS와 웹에서 다른 단계로 간다.
 */
type Fixture = {
  starts: { shape: JourneyShape; expect: JourneyPhase }[];
  cases: { shape: JourneyShape; phase: JourneyPhase; event: JourneyEvent; expect: "ignore" | "end" | JourneyPhase }[];
};
const fixture = JSON.parse(
  readFileSync(join(__dirname, "../../__tests__/fixtures/journey-step-cases.json"), "utf8"),
) as Fixture;

const SHAPE: JourneyShape = { startsWithTaxi: true, alightDesignated: true, hasEgressWalk: true };

describe("journeyStep 공유 fixture", () => {
  it("시작 단계", () => {
    for (const s of fixture.starts) expect(journeyStart("j", s.shape).phase).toEqual(s.expect);
  });

  it("전이 표 전수", () => {
    expect(fixture.cases.length).toBeGreaterThan(250);
    for (const c of fixture.cases) {
      const state: JourneyState = { journeyId: "j", shape: c.shape, phase: c.phase, seq: 3 };
      const r = journeyStep(state, c.event, { journeyId: "j", seq: 3 });
      const got = r.kind === "next" ? r.state.phase : r.kind;
      expect(got, JSON.stringify(c)).toEqual(c.expect);
      if (r.kind === "next") expect(r.state.seq).toBe(4);
    }
  });
});

describe("journeyStep token", () => {
  it("낡은 seq·다른 여정의 사건은 무시한다", () => {
    const s: JourneyState = { journeyId: "j", shape: SHAPE, phase: { kind: "running", stage: "taxiIn" }, seq: 2 };
    expect(journeyStep(s, { kind: "taxiDropped" }, { journeyId: "j", seq: 1 })).toEqual({ kind: "ignore" });
    expect(journeyStep(s, { kind: "taxiDropped" }, { journeyId: "k", seq: 2 })).toEqual({ kind: "ignore" });
    // 「안내 종료」도 token이 맞아야 한다(늦은 버튼이 다음 여정을 끝내지 않게).
    expect(journeyStep(s, { kind: "userEnded" }, { journeyId: "k", seq: 2 })).toEqual({ kind: "ignore" });
  });

  it("자동 도착과 버튼이 같은 token으로 둘 다 오면 첫 사건만 전이한다", () => {
    const s: JourneyState = { journeyId: "j", shape: SHAPE, phase: { kind: "running", stage: "taxiIn" }, seq: 2 };
    const token = journeyToken(s);
    const first = journeyStep(s, { kind: "stageEnded", reason: "arrived" }, token);
    expect(first.kind).toBe("next");
    if (first.kind !== "next") return;
    expect(first.state.phase).toEqual({ kind: "transitioning", stage: "access" });
    expect(journeyStep(first.state, { kind: "taxiDropped" }, token)).toEqual({ kind: "ignore" });
  });

  it("한 여정을 끝까지 걷는다(택시 → 접근 생략 → 대중교통 → 출구 → 택시)", () => {
    let s = journeyStart("j", SHAPE);
    const step = (e: JourneyEvent) => {
      const r = journeyStep(s, e, journeyToken(s));
      if (r.kind !== "next") throw new Error(`${JSON.stringify(e)} → ${r.kind}`);
      s = r.state;
    };
    step({ kind: "prepared", stage: "taxiIn" });
    step({ kind: "stageEnded", reason: "arrived" });
    step({ kind: "prepared", stage: "transit" });
    expect(s.phase).toEqual({ kind: "running", stage: "transit" });
    step({ kind: "rideCompleted" });
    expect(s.phase).toEqual({ kind: "transitioning", stage: "egress" });
    step({ kind: "prepared", stage: "egress" });
    step({ kind: "taxiBoarded" });
    step({ kind: "prepared", stage: "taxiOut" });
    expect(journeyStep(s, { kind: "stageEnded", reason: "arrived" }, journeyToken(s))).toEqual({ kind: "end" });
  });
});
