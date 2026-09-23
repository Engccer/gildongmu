import { describe, it, expect } from "vitest";
import fixture from "./fixtures/transit-riding-position-cases.json";
import type { TransitGuideLeg, TransitGuideState } from "../transit-guide";
import type { TransitOverview } from "../transit-progress-overview";
import {
  neverSeenPendingStep,
  neverSeenWarningDeferred,
  overviewApplyingPosition,
  positionLookupDue,
  positionOutcomeFromBody,
  positionOutcomeFromHttpStatus,
  positionShownIndex,
  positionStatusIndex,
  ridingPositionStep,
  viaStopHereIndex,
  type TransitPositionBinding,
  type TransitPositionOutcome,
  type TransitRidingPosition,
} from "../transit-riding-position";

type Case = {
  name: string;
  fn: string;
  state: Partial<TransitGuideState>;
  leg?: { trackMode?: string; viaStops?: string[]; minutes?: number | null };
  position?: TransitRidingPosition | null;
  requested?: TransitPositionBinding;
  pending?: TransitPositionBinding;
  outcome?: TransitPositionOutcome;
  now?: number;
  overview?: TransitOverview;
  expected: unknown;
};

function legOf(c: Case): TransitGuideLeg {
  const base = { ...fixture.leg, ...(c.leg ?? {}) };
  return {
    mode: base.trackMode === "subway" ? "subway" : "bus",
    lineName: "수도권 5호선",
    trackMode: base.trackMode,
    boardName: base.viaStops[0],
    alightName: base.viaStops[base.viaStops.length - 1],
    viaStops: base.viaStops.map((name) => ({ name, lat: 37.5, lng: 127 })),
    minutes: base.minutes ?? undefined,
  } as unknown as TransitGuideLeg;
}

describe("transit-riding-position (shared fixture, E35 §4)", () => {
  for (const raw of fixture.cases as unknown as Case[]) {
    it(`${raw.fn}: ${raw.name}`, () => {
      const state = raw.state as TransitGuideState;
      const leg = legOf(raw);
      const position = raw.position ?? null;
      const now = raw.now ?? 0;
      const actual = (() => {
        switch (raw.fn) {
          case "lookupDue": return positionLookupDue(state, leg, position);
          case "step": return ridingPositionStep(position, state, leg, raw.requested!, raw.outcome!, now);
          case "shown": return positionShownIndex(state, position, now);
          case "viaHere": return viaStopHereIndex(state, leg, position, now);
          case "statusIndex": return positionStatusIndex(state, position, now);
          case "overview": return overviewApplyingPosition(raw.overview!, state, position, now);
          case "neverSeenDeferred": return neverSeenWarningDeferred(state, position, now);
          case "neverSeenPending": return neverSeenPendingStep(raw.pending!, state, position, now);
          default: throw new Error(`unknown fn ${raw.fn}`);
        }
      })();
      expect(actual).toEqual(raw.expected);
    });
  }
});

describe("positionOutcomeFromBody — Kit TransitPositionService.outcome 미러", () => {
  it("found·notFound·unsupported·판정 불가", () => {
    expect(positionOutcomeFromBody({ status: "found", station: "길동", dataAgeSeconds: 40 }))
      .toEqual({ kind: "found", station: "길동", dataAgeSeconds: 40 });
    expect(positionOutcomeFromBody({ status: "found", station: "길동", dataAgeSeconds: null }))
      .toEqual({ kind: "found", station: "길동", dataAgeSeconds: null });
    expect(positionOutcomeFromBody({ status: "found", station: "" })).toEqual({ kind: "failed" });
    expect(positionOutcomeFromBody({ status: "notFound", total: 33 })).toEqual({ kind: "notFound", lineEmpty: false });
    expect(positionOutcomeFromBody({ status: "notFound", total: 0 })).toEqual({ kind: "notFound", lineEmpty: true });
    expect(positionOutcomeFromBody({ status: "unsupported" })).toEqual({ kind: "unsupported" });
    expect(positionOutcomeFromBody({ status: "weird" })).toEqual({ kind: "failed" });
    expect(positionOutcomeFromBody(null)).toEqual({ kind: "failed" });
  });
});

describe("positionOutcomeFromHttpStatus — 비-200 분류(설계 리뷰 m4)", () => {
  it("429·5xx는 일시 실패, 그 밖의 4xx는 이 결박에서 그만 묻는다", () => {
    expect(positionOutcomeFromHttpStatus(429)).toEqual({ kind: "failed" });
    expect(positionOutcomeFromHttpStatus(502)).toEqual({ kind: "failed" });
    expect(positionOutcomeFromHttpStatus(400)).toEqual({ kind: "unsupported" });
    expect(positionOutcomeFromHttpStatus(404)).toEqual({ kind: "unsupported" });
  });
});
