import { describe, expect, it } from "vitest";
import scenarios from "./fixtures/route-guide-scenarios.json";
import {
  buildGuideRoute,
  CAR_TUNING,
  entryProjection,
  guideStateAt,
  guideStep,
  initialGuideState,
  unitAt,
  WALK_TUNING,
  type GuideEvent,
  type GuideState,
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
      tuning?: "walk" | "car";
      steps: { len: number; desc: string }[];
      fixes: { t: number; along: number; lateral: number; acc: number }[];
      expect: Expectation[];
    }[];
  }).scenarios) {
    it(sc.name, () => {
      const route = routeFrom(sc.steps);
      const tuning = sc.tuning === "car" ? CAR_TUNING : WALK_TUNING;
      let { state } = initialGuideState(route, 0);
      const results: { event: GuideEvent | null; tone: GuideTone | null }[] = [];
      for (const f of sc.fixes) {
        const out = guideStep(
          state,
          { ...fixCoord(f.along, f.lateral), accuracy: f.acc },
          route,
          f.t,
          tuning,
        );
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

describe("car 재획득 타이브레이크(스펙 §4.3 — 재획득 경로 한정)", () => {
  // U자 경로: 북 300 → 동 40 → 남 300. 평행 왕복 구간이라 전역 후보가 복수다.
  const uRoute = buildGuideRoute([
    { description: "북", pathCoords: [fixCoord(0, 0), fixCoord(300, 0)] },
    { description: "동", pathCoords: [fixCoord(300, 0), fixCoord(300, 40)] },
    { description: "남", pathCoords: [fixCoord(300, 40), fixCoord(0, 40)] },
  ])!;

  function enterReacquiring(dPrev: number) {
    const state = { ...guideStateAt(uRoute, dPrev, 0), lastFixAt: 0 };
    const out = guideStep(
      state,
      { ...fixCoord(dPrev, 0), accuracy: 10 },
      uRoute,
      11, // 공백 11초 > 10 → 재획득 진입
      CAR_TUNING,
    );
    expect(out.event?.kind).toBe("reacquiring");
    return out.state;
  }

  it("전방 창 안 후보가 1개면 채택(reacquired)", () => {
    const st = enterReacquiring(100); // prevD=100, v=0 → 창 [100, 200]
    const out = guideStep(st, { ...fixCoord(150, 10), accuracy: 10 }, uRoute, 12, CAR_TUNING);
    // 후보: 북 d≈150(창 안) vs 남 d≈490(창 밖) → 단일 채택
    expect(out.event?.kind).toBe("reacquired");
    expect(out.state.d).toBeCloseTo(150, 0);
  });

  it("창 안 후보 0개면 거부 유지(침묵)", () => {
    const st = enterReacquiring(100);
    const out = guideStep(st, { ...fixCoord(250, 20), accuracy: 10 }, uRoute, 12, CAR_TUNING);
    // 후보: 북 d≈250·남 d≈390 — 둘 다 창 [100,200] 밖 → 확정 거부
    expect(out.event).toBeNull();
    expect(out.state.phase).toBe("reacquiring");
  });

  it("창 안 후보 복수면 거부 유지(평행도로 이탈 은폐 차단)", () => {
    const st = { ...enterReacquiring(100), reacquireV: 20 }; // 창 상한 100+20×12×1.5+100=560
    const out = guideStep(st, { ...fixCoord(250, 20), accuracy: 10 }, uRoute, 12, CAR_TUNING);
    // 북 d≈250·남 d≈390 둘 다 창 안 → 복수 거부
    expect(out.event).toBeNull();
    expect(out.state.phase).toBe("reacquiring");
  });

  it("창 계수(×1.5)가 채택을 가른다 — 안전 계수 회귀 잠금(독립 리뷰)", () => {
    // 북 900 → 동 40 → 남 900. prevD=100·v=20·elapsed 12초 기준 창 상한:
    // 1.5×면 100+20×12×1.5+100=560, 1.0×이면 440 — d≈500 후보는 1.5×에서만 창 안.
    const longRoute = buildGuideRoute([
      { description: "북", pathCoords: [fixCoord(0, 0), fixCoord(900, 0)] },
      { description: "동", pathCoords: [fixCoord(900, 0), fixCoord(900, 40)] },
      { description: "남", pathCoords: [fixCoord(900, 40), fixCoord(0, 40)] },
    ])!;
    const state: GuideState = { ...guideStateAt(longRoute, 100, 0), lastFixAt: 0 };
    const entered = guideStep(
      state,
      { ...fixCoord(100, 0), accuracy: 10 },
      longRoute,
      11,
      CAR_TUNING,
    );
    expect(entered.event?.kind).toBe("reacquiring");
    const st: GuideState = { ...entered.state, reacquireV: 20 };
    const out = guideStep(st, { ...fixCoord(500, 10), accuracy: 10 }, longRoute, 12, CAR_TUNING);
    expect(out.event?.kind).toBe("reacquired");
    expect(out.state.d).toBeCloseTo(500, -1); // 위도-미터 근사 ±1m
  });

  it("전방 여유 버퍼(+100m)가 채택을 가른다 — 버퍼 회귀 잠금(독립 리뷰)", () => {
    const st = enterReacquiring(100); // v=0 → 창 [100, 200]
    // d≈180은 버퍼 100일 때만 창 안(50이면 상한 150 밖). 남 후보 d≈460은 창 밖.
    const out = guideStep(st, { ...fixCoord(180, 10), accuracy: 10 }, uRoute, 12, CAR_TUNING);
    expect(out.event?.kind).toBe("reacquired");
    expect(out.state.d).toBeCloseTo(180, 0);
  });
});

describe("car 이탈 재통지(스펙 §4.3 — 180초·무톤)", () => {
  it("확정 후 180초 전에는 침묵, 이후 재통지는 무톤·상태 전문", () => {
    const route = routeFrom([{ len: 600, desc: "직진" }]);
    let state: GuideState = { ...guideStateAt(route, 0, 0), lastFixAt: 0 };
    const off = (along: number) => ({ ...fixCoord(along, 60), accuracy: 10 });
    const confirmSeq: [number, number][] = [
      [5, 40],
      [10, 80],
      [15, 120],
    ];
    let confirm: ReturnType<typeof guideStep> | null = null;
    for (const [t, along] of confirmSeq) {
      confirm = guideStep(state, off(along), route, t, CAR_TUNING);
      state = confirm.state;
    }
    expect(confirm!.event?.kind).toBe("offRoute");
    expect(confirm!.tone).toBe("warning"); // 첫 확정은 항상 경고 톤

    let renotifyAt: number | null = null;
    let renotifyTone: GuideTone | null = "warning";
    for (let t = 24; t <= 210; t += 9) {
      const out = guideStep(state, off(200), route, t, CAR_TUNING);
      state = out.state;
      if (out.event?.kind === "offRoute") {
        renotifyAt = t;
        renotifyTone = out.tone;
        break;
      }
    }
    expect(renotifyAt).not.toBeNull();
    expect(renotifyAt!).toBeGreaterThanOrEqual(195); // 확정 15 + 180
    expect(renotifyTone).toBeNull(); // 재통지는 무톤(§4.3)
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
