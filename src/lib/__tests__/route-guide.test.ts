import { describe, expect, it } from "vitest";
import scenarios from "./fixtures/route-guide-scenarios.json";
import courseAxisScenarios from "./fixtures/course-axis-scenarios.json";
import type { CourseVoteSample } from "../guide-course-axis";
import {
  buildGuideRoute,
  CAR_TUNING,
  entryProjection,
  finalApproachEntryM,
  guideStateAt,
  guideStep,
  HANDOFF_DIST_M,
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
  /**
   * 톤이 **없어야** 하는 지점(`tone`의 부정형). 40m 전문 낭독에서 `ahead` 톤이 10m
   * 임박 큐로 옮겨 간 계약이 이 축으로만 잠긴다 — `tone` 단언만으로는 "울리지
   * 않아야 한다"를 표현할 수 없다.
   */
  toneNull?: boolean;
}

describe("route-guide 공유 시나리오(경계표)", () => {
  for (const sc of (scenarios as {
    scenarios: {
      name: string;
      tuning?: "walk" | "car";
      /** 종점 오프셋 기하를 아는 세션인가(미지정=모름 → 옛 50m 인계). */
      geometry?: boolean;
      steps: { len: number; desc: string }[];
      fixes: { t: number; along: number; lateral: number; acc: number }[];
      expect: Expectation[];
    }[];
  }).scenarios) {
    it(sc.name, () => {
      const route = routeFrom(sc.steps);
      const tuning = sc.tuning === "car" ? CAR_TUNING : WALK_TUNING;
      let { state } = initialGuideState(route, 0, {
        hasFinalApproachGeometry: sc.geometry === true,
      });
      const results: { event: GuideEvent | null; tone: GuideTone | null }[] = [];
      for (const f of sc.fixes) {
        const out = guideStep(
          state,
          { ...fixCoord(f.along, f.lateral), accuracy: f.acc },
          route,
          f.t,
          tuning);
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
        if (ex.toneNull) rs.forEach((r) => expect(r.tone).toBeNull());
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
      CAR_TUNING);
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
      CAR_TUNING);
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

describe("속도 가드 표본 소멸 시 해제(정확도 배제의 2차 회귀 차단 — Kit 미러)", () => {
  it("가드 활성 후 나쁜 정확도(21~50m) 지속으로 표본이 마르면 가드 해제", () => {
    const route = routeFrom([{ len: 2000, desc: "직진" }]);
    let state: GuideState = initialGuideState(route, 0).state;
    // 진짜 빠른 이동(acc 10)으로 가드 진입.
    const fast: [number, number][] = [
      [0, 0],
      [5, 40],
      [10, 90],
    ];
    let out: ReturnType<typeof guideStep> | null = null;
    for (const [t, along] of fast) {
      out = guideStep(state, { ...fixCoord(along, 0), accuracy: 10 }, route, t, WALK_TUNING);
      state = out.state;
    }
    expect(out!.event?.kind).toBe("speedSuggest");
    expect(state.speedGuardActive).toBe(true);
    // 정지 + acc 30 지속(uncertain 50m 미만이라 표본 배제만 발동). 시간창(10초)이
    // 옛 표본을 배수해 t=25에 표본 전무 → 가드 해제. 미해제면 이탈 재통지가
    // 무기한 억제된다(독립 리뷰 MAJOR).
    for (const t of [15, 20]) {
      state = guideStep(state, { ...fixCoord(90, 0), accuracy: 30 }, route, t, WALK_TUNING).state;
      expect(state.speedGuardActive).toBe(true); // 잔여 표본이 남은 동안은 동결 유지
    }
    state = guideStep(state, { ...fixCoord(90, 0), accuracy: 30 }, route, 25, WALK_TUNING).state;
    expect(state.speedSamples).toHaveLength(0);
    expect(state.speedGuardActive).toBe(false);
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

/**
 * 최종 접근 진입(spec 2026-08-08 §3.2·§4). 공유 fixture가 거리 경계와 래치를 덮고,
 * 여기서는 fixture 스키마로 표현할 수 없는 전이(낭독 미완·이탈 중·가드 순서)를 고정한다.
 */
describe("최종 접근 진입 조건", () => {
  const straight = () => routeFrom([{ len: 100, desc: "직진 100m 이동" }]);
  /** 종점 근처·전 스텝 낭독 완료·기하 있음인 상태. */
  const atEnd = (route: ReturnType<typeof routeFrom>, d = 96): GuideState => ({
    ...guideStateAt(route, d, 0, { hasFinalApproachGeometry: true }),
    announcedUpTo: route.steps.length - 1,
  });

  it("낭독이 남아 있으면 종점에 닿아도 진입하지 않는다", () => {
    const route = routeFrom([
      { len: 60, desc: "직진A" },
      { len: 60, desc: "우회전B" },
    ]);
    const state = { ...atEnd(route, 112), announcedUpTo: 0 };
    const out = guideStep(
      state,
      { ...fixCoord(115, 0), accuracy: 8 },
      route,
      10,
      WALK_TUNING);
    expect(out.event?.kind).not.toBe("finalApproachEnter");
    expect(out.state.phase).not.toBe("finalApproach");
  });

  it("이탈 중이면 진입하지 않는다 — 이탈 판정이 먼저 반환한다", () => {
    const route = straight();
    const state: GuideState = { ...atEnd(route), phase: "offRoute" };
    const out = guideStep(
      state,
      { ...fixCoord(97, 60), accuracy: 8 },
      route,
      10,
      WALK_TUNING);
    expect(out.state.phase).toBe("offRoute");
  });

  it("재무장 전이면 진입하지 않는다(수동 상세 복귀 세션)", () => {
    const route = straight();
    const state: GuideState = { ...atEnd(route), autoHandoffArmed: false };
    const out = guideStep(
      state,
      { ...fixCoord(97, 0), accuracy: 8 },
      route,
      10,
      WALK_TUNING);
    expect(out.event?.kind).not.toBe("finalApproachEnter");
  });

  /**
   * ⚠ 가드는 uncertain 게이트보다 **앞**에 있어야 한다. 뒤에 두면 정확도가 나빠질 때
   * uncertain을 경유했다가 resumePhase("following")로 복귀하면서 래치가 조용히 풀린다.
   */
  it("진입 후에는 정확도가 무효여도 uncertain으로 가지 않는다", () => {
    const route = straight();
    const entered = guideStep(
      atEnd(route),
      { ...fixCoord(97, 0), accuracy: 8 },
      route,
      10,
      WALK_TUNING);
    expect(entered.event).toEqual({ kind: "finalApproachEnter" });
    expect(entered.state.phase).toBe("finalApproach");

    const bad = guideStep(
      entered.state,
      { ...fixCoord(97, 0), accuracy: 200 },
      route,
      20,
      WALK_TUNING);
    expect(bad.state.phase).toBe("finalApproach");
    expect(bad.event).toBeNull();
    expect(bad.state.lastFixAt).toBe(20);
  });

  it("재획득으로 상태를 다시 만들어도 기하 보유가 승계된다", () => {
    const route = routeFrom([{ len: 400, desc: "직진" }]);
    let state: GuideState = {
      ...guideStateAt(route, 0, 0, { hasFinalApproachGeometry: true }),
      phase: "reacquiring",
      lastFixAt: 0,
    };
    state = guideStep(
      state,
      { ...fixCoord(200, 0), accuracy: 10 },
      route,
      10,
      WALK_TUNING).state;
    expect(state.phase).not.toBe("reacquiring");
    expect(state.hasFinalApproachGeometry).toBe(true);
  });
});

describe("finalApproachEntryM", () => {
  it("기하를 모르면 옛 50m 인계선", () => {
    expect(
      finalApproachEntryM({ hasFinalApproachGeometry: false }, 5, WALK_TUNING),
    ).toBe(HANDOFF_DIST_M);
  });

  it("기하를 알면 정확도와 하한 중 큰 값", () => {
    expect(finalApproachEntryM({ hasFinalApproachGeometry: true }, 5, WALK_TUNING)).toBe(
      10,
    );
    expect(finalApproachEntryM({ hasFinalApproachGeometry: true }, 30, WALK_TUNING)).toBe(
      30,
    );
  });
});

describe("방위 축 통합 (유도 관측 — 궤적 주도)", () => {
  // 남→북 직선 400m. 접선은 어디서나 0도.
  const route = buildGuideRoute([
    {
      description: "북진",
      pathCoords: [
        { lat: 37.5, lng: 127.1 },
        { lat: 37.5 + 400 / 111320, lng: 127.1 },
      ],
    },
  ])!;
  const at = (along: number, lateral = 0) => ({
    lat: 37.5 + along / 111320,
    lng: 127.1 + lateral / 111320 / Math.cos((37.5 * Math.PI) / 180),
    accuracy: 8,
  });

  /** start 지점에서 bearingDeg 방향으로 1.2m/s·1Hz 보행 fix 시퀀스(관측은 유도기가 만든다). */
  function walkFixes(
    start: { along: number; lateral: number },
    bearingDeg: number,
    seconds: number,
    startAt: number,
  ): Array<{ fix: ReturnType<typeof at>; at: number }> {
    const rad = (bearingDeg * Math.PI) / 180;
    return Array.from({ length: seconds + 1 }, (_, i) => ({
      fix: at(
        start.along + Math.cos(rad) * i * 1.2,
        start.lateral + Math.sin(rad) * i * 1.2,
      ),
      at: startAt + i,
    }));
  }

  /** fix 시퀀스를 리듀서에 재생하고 마지막 상태·이벤트 로그를 돌려준다. */
  function play(
    state: GuideState,
    fixes: Array<{ fix: ReturnType<typeof at>; at: number }>,
    tuning = WALK_TUNING,
  ): { state: GuideState; events: { kind: string; at: number }[] } {
    const events: { kind: string; at: number }[] = [];
    for (const f of fixes) {
      const out = guideStep(state, f.fix, route, f.at, tuning);
      state = out.state;
      if (out.event) events.push({ kind: out.event.kind, at: f.at });
    }
    return { state, events };
  }

  /**
   * 경로 위 역주행(남행)으로 방위 축을 확정시킨 상태. 수직거리는 내내 0이다.
   * 확정 이벤트가 나온 fix에서 **멈춰** 반환한다 — 이후 케이스가 그 시각·위치에서
   * 이어 걸을 수 있도록(시각 역행 금지).
   */
  function confirmedByReversal(): {
    state: GuideState;
    confirmedAt: number;
    alongNow: number;
  } {
    let { state } = initialGuideState(route, 0);
    // 경로 위 d≈100 지점까지 정상 북행(유도기 워밍업 겸 투영 안착).
    state = play(state, walkFixes({ along: 60, lateral: 0 }, 0, 33, 0)).state;
    // t=34부터 남행 — 유도 방위 180 vs 접선 0 → mismatch.
    for (const f of walkFixes({ along: 100, lateral: 0 }, 180, 55, 34)) {
      const out = guideStep(state, f.fix, route, f.at, WALK_TUNING);
      state = out.state;
      if (out.event?.kind === "offRoute") {
        expect(state.phase).toBe("offRoute");
        expect(state.offRouteAxes.course).toBe(true);
        expect(state.offRouteAxes.distance).toBe(false);
        return { state, confirmedAt: f.at, alongNow: 100 - (f.at - 34) * 1.2 };
      }
    }
    throw new Error("역주행 55초 안에 방위 축이 확정해야 한다");
  }

  it("경로에서 동쪽으로 걸어 나가면 거리 축보다 먼저 방위 축이 확정한다", () => {
    let { state } = initialGuideState(route, 0);
    // d=50 안착 후 동쪽(90도)으로 보행. 수직거리 30m 도달(25초)+20초 hold보다
    // 방위 창 확정(관측 시작 후 약 16~20초)이 앞선다.
    state = play(state, walkFixes({ along: 10, lateral: 0 }, 0, 33, 0)).state;
    const east = play(state, walkFixes({ along: 50, lateral: 0 }, 90, 30, 34));
    const off = east.events.find((e) => e.kind === "offRoute");
    expect(off).toBeTruthy();
    expect(east.state.phase).toBe("offRoute");
    expect(east.state.offRouteAxes.course).toBe(true);
    // 확정 시점의 수직거리는 임계(30m) 미만 — 거리 축은 잠기지 않았다.
    expect(east.state.offRouteAxes.distance).toBe(false);
  });

  it("경로 위 역주행은 방위 축이 확정한다 — 수직거리 축이 영영 못 보는 이탈", () => {
    confirmedByReversal();
  });

  it("방위 축으로 확정한 이탈은 경로 방향으로 걸어야 복귀한다(§2.5)", () => {
    const { state, confirmedAt, alongNow } = confirmedByReversal();
    // 확정 지점에서 북행 재개 — 창이 match로 채워진 뒤에만 backOnRoute.
    const fwd = play(state, walkFixes({ along: alongNow, lateral: 0 }, 0, 60, confirmedAt + 1));
    const back = fwd.events.find((e) => e.kind === "backOnRoute");
    expect(back).toBeTruthy();
    expect(fwd.state.phase).not.toBe("offRoute");
    expect(fwd.state.offRouteAxes).toEqual({ distance: false, course: false });
  });

  it("복귀 지연을 상한으로 잠근다 — 해제 게이트의 비용이 보이게", () => {
    // ⚠ 확정 지연만 재면 판정 가능 비율 게이트가 만든 비용의 절반이 안 보인다.
    //   방향을 바로잡은 사용자가 이탈 상태에 머무는 시간이다. 유도 관측은 chord라
    //   반전 직후 약 기저선(10m)만큼은 여전히 남행으로 읽힌다(관측의 자기 낡음,
    //   spec §2.0) — 그 몫까지 포함한 구조적 상한이다.
    const { state, confirmedAt, alongNow } = confirmedByReversal();
    const turnAt = confirmedAt + 1;
    const fwd = play(state, walkFixes({ along: alongNow, lateral: 0 }, 0, 70, turnAt));
    const back = fwd.events.find((e) => e.kind === "backOnRoute");
    expect(back).toBeTruthy();
    expect(back!.at - turnAt).toBeLessThanOrEqual(35);
  });

  it("멈춰 서면 관측이 말라 복귀를 선언하지 않는다 — unknown은 정합이 아니다", () => {
    const { state, confirmedAt, alongNow } = confirmedByReversal();
    // 제자리 정지: 전진 게이트(2m)에 걸려 새 표가 없고, 창은 시간으로 낡는다.
    const still = Array.from({ length: 40 }, (_, i) => ({
      fix: at(alongNow, 0),
      at: confirmedAt + 1 + i,
    }));
    const r = play(state, still);
    expect(r.events.every((e) => e.kind !== "backOnRoute")).toBe(true);
    expect(r.state.phase).toBe("offRoute");
    expect(r.state.offRouteAxes.course).toBe(true);
  });

  it("상태 재구성은 표결 창을 비우고, 유도기 버퍼는 승계 opts로만 잇는다(§2.9)", () => {
    let { state } = initialGuideState(route, 0);
    state = play(state, walkFixes({ along: 10, lateral: 0 }, 0, 20, 0)).state;
    expect(state.courseVotes.length).toBeGreaterThan(0);
    expect(state.courseDerivation.fixes.length).toBeGreaterThan(0);
    // 새 세션(opts 생략)은 창·latch·버퍼 전부 초기화.
    const fresh = guideStateAt(route, 0, 100, {});
    expect(fresh.courseVotes).toEqual([]);
    expect(fresh.offRouteAxes).toEqual({ distance: false, course: false });
    expect(fresh.courseDerivation.fixes).toEqual([]);
    // 같은 세션의 재구성(재조회·모드 전환)은 버퍼를 넘겨 잇는다 — 창은 여전히 비운다.
    const carried = guideStateAt(route, 0, 100, { courseDerivation: state.courseDerivation });
    expect(carried.courseVotes).toEqual([]);
    expect(carried.courseDerivation).toEqual(state.courseDerivation);
    const reroute = initialGuideState(route, 100, { courseDerivation: state.courseDerivation });
    expect(reroute.state.courseDerivation).toEqual(state.courseDerivation);
  });

  it("방위 축 확정이 최종 접근 진입보다 앞이다 — 같은 fix에서는 이탈이 이긴다", () => {
    // 유도 관측으로는 "종점 접근 중 + 방위 어긋남"을 한 궤적으로 만들 수 없어
    // (관측이 곧 이동이다) 창을 직접 구성한다: mismatch 다수 창 + 종점 잔여 ≤ 진입선.
    const mismatchWindow: CourseVoteSample[] = Array.from({ length: 9 }, (_, i) => ({
      at: i * 2,
      vote: "mismatch" as const,
    }));
    const nearEnd: GuideState = {
      ...guideStateAt(route, 392, 0, { hasFinalApproachGeometry: true }),
      announcedUpTo: route.steps.length - 1,
      courseVotes: mismatchWindow,
    };
    // 관측 없는 fix(버퍼 비어 있음) — 창은 이미 확정 다수이고 잔여 7m ≤ 진입선 10m.
    const out = guideStep(nearEnd, at(393), route, 18, WALK_TUNING);
    expect(out.event?.kind).toBe("offRoute");
    expect(out.state.phase).toBe("offRoute");
    expect(out.state.offRouteAxes.course).toBe(true);

    // 대조: 창이 비어 있으면 같은 fix가 최종 접근에 진입한다(순서 외 조건 동일).
    const clean = { ...nearEnd, courseVotes: [] };
    const enter = guideStep(clean, at(393), route, 18, WALK_TUNING);
    expect(enter.event?.kind).toBe("finalApproachEnter");
  });

  it("차량 프로파일에서는 축이 통째로 꺼진다 — 보행으로만 측정된 상수다", () => {
    // 완전히 같은 역주행 궤적인데 프로파일만 차량이면 표도 확정도 없다.
    let walk = initialGuideState(route, 0).state;
    let car = initialGuideState(route, 0).state;
    const warm = walkFixes({ along: 60, lateral: 0 }, 0, 33, 0);
    const rev = walkFixes({ along: 100, lateral: 0 }, 180, 40, 34);
    walk = play(walk, warm).state;
    walk = play(walk, rev).state;
    car = play(car, warm, CAR_TUNING).state;
    car = play(car, rev, CAR_TUNING).state;
    expect(walk.offRouteAxes.course).toBe(true);
    expect(car.offRouteAxes.course).toBe(false);
    expect(car.phase).not.toBe("offRoute");
    // 게이트는 관측을 중화하므로 표 자체가 창에 쌓이지 않는다(spec §2.10 — 표 없음).
    expect(car.courseVotes).toEqual([]);
  });

  it("국면 전이는 표결 창을 비우고 latch·유도기 버퍼는 남긴다", () => {
    const primed = () => {
      let { state } = initialGuideState(route, 0);
      state = play(state, walkFixes({ along: 60, lateral: 0 }, 0, 20, 0)).state;
      expect(state.courseVotes.length).toBeGreaterThan(0);
      return state;
    };

    // uncertain 진입(정확도 악화)
    const toUncertain = guideStep(
      primed(),
      { ...at(85), accuracy: 80 },
      route,
      21,
      WALK_TUNING,
    ).state;
    expect(toUncertain.phase).toBe("uncertain");
    expect(toUncertain.courseVotes).toEqual([]);
    expect(toUncertain.courseDerivation.fixes.length).toBeGreaterThan(0);

    // reacquiring 진입(fix 공백 11초)
    const toReacquiring = guideStep(primed(), at(85), route, 32, WALK_TUNING).state;
    expect(toReacquiring.phase).toBe("reacquiring");
    expect(toReacquiring.courseVotes).toEqual([]);
    expect(toReacquiring.courseDerivation.fixes.length).toBeGreaterThan(0);
  });

  it("uncertain을 경유해도 축 latch가 보존된다", () => {
    const { state, confirmedAt, alongNow } = confirmedByReversal();
    let s = state;
    for (let i = 1; i <= 5; i++) {
      s = guideStep(s, { ...at(alongNow), accuracy: 80 }, route, confirmedAt + i, WALK_TUNING).state;
    }
    expect(s.phase).toBe("uncertain");
    expect(s.resumePhase).toBe("offRoute");
    expect(s.offRouteAxes.course).toBe(true);
  });
});

describe("방위 축 리듀서 trace (Kit 동조 가드)", () => {
  interface ReducerFix {
    t: number;
    along: number;
    lateral: number;
    acc: number;
  }

  /** fixture는 경계만 적는다 — 보간 규칙은 `reducerComment`가 정본이다. */
  function interpolate(fixes: ReducerFix[]): ReducerFix[] {
    const out: ReducerFix[] = [fixes[0]];
    for (let i = 1; i < fixes.length; i++) {
      const a = fixes[i - 1];
      const b = fixes[i];
      for (let t = a.t + 1; t <= b.t; t++) {
        const r = (t - a.t) / (b.t - a.t);
        out.push({
          t,
          along: a.along + r * (b.along - a.along),
          lateral: a.lateral + r * (b.lateral - a.lateral),
          acc: b.acc,
        });
      }
    }
    return out;
  }

  // ⚠ 공회전 방지: 키 이름이 바뀌거나 배열이 비면 아래 루프가 0개 테스트를 만들고
  //   describe가 조용히 통과한다. 가드가 무는지는 케이스가 실제로 있는지에 달렸다.
  it("fixture에 리듀서 케이스가 있다", () => {
    expect(courseAxisScenarios.reducer.length).toBeGreaterThanOrEqual(2);
  });

  for (const sc of courseAxisScenarios.reducer) {
    it(sc.name, () => {
      const route = routeFrom(sc.steps);
      let { state } = initialGuideState(route, 0);
      for (const f of interpolate(sc.fixes as ReducerFix[])) {
        state = guideStep(
          state,
          { ...fixCoord(f.along, f.lateral), accuracy: f.acc },
          route,
          f.t,
          WALK_TUNING,
        ).state;
      }
      expect(state.phase).toBe(sc.expectPhaseAtEnd);
      expect(state.offRouteAxes).toEqual(sc.expectAxes);
    });
  }
});
