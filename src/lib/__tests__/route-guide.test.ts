import { describe, expect, it } from "vitest";
import scenarios from "./fixtures/route-guide-scenarios.json";
import {
  buildGuideRoute,
  entryProjection,
  guideStep,
  initialGuideState,
  unitAt,
  type GuideEvent,
  type GuideTone,
} from "../route-guide";

// fixture 좌표 규약(파일 상단 comment 참조). Kit RouteGuideTests와 동일 하니스.
const M = 1 / 111320;
const LAT0 = 37.5;
const LNG0 = 127.1;

function routeFrom(steps: { len: number; desc: string }[]) {
  let acc = 0;
  const route = buildGuideRoute(
    steps.map((s) => {
      const pathCoords = [
        { lat: LAT0 + acc * M, lng: LNG0 },
        { lat: LAT0 + (acc + s.len) * M, lng: LNG0 },
      ];
      acc += s.len;
      return { description: s.desc, pathCoords };
    }),
  );
  if (!route) throw new Error("fixture 경로 조립 실패");
  return route;
}

const fixCoord = (along: number, lateral: number) => ({
  lat: LAT0 + along * M,
  lng: LNG0 + (lateral * M) / Math.cos((LAT0 * Math.PI) / 180),
});

interface Expectation {
  afterFix?: number;
  afterFixAny?: number[];
  event?: string;
  eventNot?: string;
  eventNull?: boolean;
  eventOneOf?: string[];
  indices?: number[];
  tone?: string;
}

describe("route-guide 공유 시나리오(경계표)", () => {
  for (const sc of (scenarios as {
    scenarios: {
      name: string;
      steps: { len: number; desc: string }[];
      fixes: { t: number; along: number; lateral: number; acc: number }[];
      expect: Expectation[];
    }[];
  }).scenarios) {
    it(sc.name, () => {
      const route = routeFrom(sc.steps);
      let { state } = initialGuideState(route, 0);
      const results: { event: GuideEvent | null; tone: GuideTone | null }[] = [];
      for (const f of sc.fixes) {
        const out = guideStep(state, { ...fixCoord(f.along, f.lateral), accuracy: f.acc }, route, f.t);
        state = out.state;
        results.push({ event: out.event, tone: out.tone });
      }
      for (const ex of sc.expect) {
        const idx = ex.afterFix ?? ex.afterFixAny!;
        const rs = Array.isArray(idx) ? idx.map((i) => results[i]) : [results[idx]];
        if (ex.event) {
          expect(rs.some((r) => r.event?.kind === ex.event), `event ${ex.event}`).toBe(true);
        }
        if (ex.eventNot) {
          rs.forEach((r) => expect(r.event?.kind).not.toBe(ex.eventNot));
        }
        if (ex.eventNull) rs.forEach((r) => expect(r.event).toBeNull());
        if (ex.eventOneOf) {
          expect(rs.some((r) => r.event && ex.eventOneOf!.includes(r.event.kind))).toBe(true);
        }
        if (ex.indices) {
          const found = rs.find((r) => r.event && "indices" in r.event);
          expect(found && (found.event as { indices: number[] }).indices).toEqual(ex.indices);
        }
        if (ex.tone) expect(rs.some((r) => r.tone === ex.tone)).toBe(true);
      }
    });
  }
});

describe("entryProjection (전환·재조회 초기 투영, 스펙 §6)", () => {
  const uRoute = buildGuideRoute([
    {
      description: "북",
      pathCoords: [fixCoord(0, 0), fixCoord(300, 0)],
    },
    {
      description: "동",
      pathCoords: [fixCoord(300, 0), fixCoord(300, 20)],
    },
    {
      description: "남",
      pathCoords: [fixCoord(300, 20), fixCoord(0, 20)],
    },
  ])!;

  it("자기근접 구간은 ambiguous — 임의 확정 금지", () => {
    expect(entryProjection(uRoute, { ...fixCoord(150, 10), accuracy: 10 }).status).toBe("ambiguous");
  });

  it("단일 후보는 ok + 진행거리", () => {
    const single = buildGuideRoute([
      { description: "직진", pathCoords: [fixCoord(0, 0), fixCoord(300, 0)] },
    ])!;
    const r = entryProjection(single, { ...fixCoord(150, 5), accuracy: 10 });
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.d).toBeCloseTo(150, 0);
  });

  it("경로에서 멀면 none", () => {
    const single = buildGuideRoute([
      { description: "직진", pathCoords: [fixCoord(0, 0), fixCoord(300, 0)] },
    ])!;
    expect(entryProjection(single, { ...fixCoord(150, 200), accuracy: 10 }).status).toBe("none");
  });
});

describe("initialGuideState·unitAt", () => {
  it("첫 유닛이 묶음이면 firstIndices가 묶음 전체", () => {
    const route = routeFrom([
      { len: 20, desc: "횡단보도" },
      { len: 16, desc: "이동" },
      { len: 100, desc: "직진" },
    ]);
    const { firstIndices } = initialGuideState(route, 0);
    expect(firstIndices).toEqual([0, 1]);
  });

  it("unitAt: 긴 스텝은 자기 하나, 짧은 스텝은 연속 묶음", () => {
    const route = routeFrom([
      { len: 100, desc: "a" },
      { len: 20, desc: "b" },
      { len: 30, desc: "c" },
      { len: 100, desc: "d" },
    ]);
    expect(unitAt(route, 0)).toEqual([0]);
    expect(unitAt(route, 1)).toEqual([1, 2]);
    expect(unitAt(route, 2)).toEqual([1, 2]);
    expect(unitAt(route, 3)).toEqual([3]);
  });
});
