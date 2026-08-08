import { describe, expect, it } from "vitest";
import scenarios from "./fixtures/route-guide-scenarios.json";
import courseAxisScenarios from "./fixtures/course-axis-scenarios.json";
import { INACTIVE_COURSE, type CourseObservation } from "../guide-course-axis";
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
          tuning,
        INACTIVE_COURSE,
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
    INACTIVE_COURSE,
    );
    expect(out.event?.kind).toBe("reacquiring");
    return out.state;
  }

  it("전방 창 안 후보가 1개면 채택(reacquired)", () => {
    const st = enterReacquiring(100); // prevD=100, v=0 → 창 [100, 200]
    const out = guideStep(st, { ...fixCoord(150, 10), accuracy: 10 }, uRoute, 12, CAR_TUNING, INACTIVE_COURSE);
    // 후보: 북 d≈150(창 안) vs 남 d≈490(창 밖) → 단일 채택
    expect(out.event?.kind).toBe("reacquired");
    expect(out.state.d).toBeCloseTo(150, 0);
  });

  it("창 안 후보 0개면 거부 유지(침묵)", () => {
    const st = enterReacquiring(100);
    const out = guideStep(st, { ...fixCoord(250, 20), accuracy: 10 }, uRoute, 12, CAR_TUNING, INACTIVE_COURSE);
    // 후보: 북 d≈250·남 d≈390 — 둘 다 창 [100,200] 밖 → 확정 거부
    expect(out.event).toBeNull();
    expect(out.state.phase).toBe("reacquiring");
  });

  it("창 안 후보 복수면 거부 유지(평행도로 이탈 은폐 차단)", () => {
    const st = { ...enterReacquiring(100), reacquireV: 20 }; // 창 상한 100+20×12×1.5+100=560
    const out = guideStep(st, { ...fixCoord(250, 20), accuracy: 10 }, uRoute, 12, CAR_TUNING, INACTIVE_COURSE);
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
    INACTIVE_COURSE,
    );
    expect(entered.event?.kind).toBe("reacquiring");
    const st: GuideState = { ...entered.state, reacquireV: 20 };
    const out = guideStep(st, { ...fixCoord(500, 10), accuracy: 10 }, longRoute, 12, CAR_TUNING, INACTIVE_COURSE);
    expect(out.event?.kind).toBe("reacquired");
    expect(out.state.d).toBeCloseTo(500, -1); // 위도-미터 근사 ±1m
  });

  it("전방 여유 버퍼(+100m)가 채택을 가른다 — 버퍼 회귀 잠금(독립 리뷰)", () => {
    const st = enterReacquiring(100); // v=0 → 창 [100, 200]
    // d≈180은 버퍼 100일 때만 창 안(50이면 상한 150 밖). 남 후보 d≈460은 창 밖.
    const out = guideStep(st, { ...fixCoord(180, 10), accuracy: 10 }, uRoute, 12, CAR_TUNING, INACTIVE_COURSE);
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
      confirm = guideStep(state, off(along), route, t, CAR_TUNING, INACTIVE_COURSE);
      state = confirm.state;
    }
    expect(confirm!.event?.kind).toBe("offRoute");
    expect(confirm!.tone).toBe("warning"); // 첫 확정은 항상 경고 톤

    let renotifyAt: number | null = null;
    let renotifyTone: GuideTone | null = "warning";
    for (let t = 24; t <= 210; t += 9) {
      const out = guideStep(state, off(200), route, t, CAR_TUNING, INACTIVE_COURSE);
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
      out = guideStep(state, { ...fixCoord(along, 0), accuracy: 10 }, route, t, WALK_TUNING, INACTIVE_COURSE);
      state = out.state;
    }
    expect(out!.event?.kind).toBe("speedSuggest");
    expect(state.speedGuardActive).toBe(true);
    // 정지 + acc 30 지속(uncertain 50m 미만이라 표본 배제만 발동). 시간창(10초)이
    // 옛 표본을 배수해 t=25에 표본 전무 → 가드 해제. 미해제면 이탈 재통지가
    // 무기한 억제된다(독립 리뷰 MAJOR).
    for (const t of [15, 20]) {
      state = guideStep(state, { ...fixCoord(90, 0), accuracy: 30 }, route, t, WALK_TUNING, INACTIVE_COURSE).state;
      expect(state.speedGuardActive).toBe(true); // 잔여 표본이 남은 동안은 동결 유지
    }
    state = guideStep(state, { ...fixCoord(90, 0), accuracy: 30 }, route, 25, WALK_TUNING, INACTIVE_COURSE).state;
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
      WALK_TUNING,
    INACTIVE_COURSE,
    );
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
      WALK_TUNING,
    INACTIVE_COURSE,
    );
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
      WALK_TUNING,
    INACTIVE_COURSE,
    );
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
      WALK_TUNING,
    INACTIVE_COURSE,
    );
    expect(entered.event).toEqual({ kind: "finalApproachEnter" });
    expect(entered.state.phase).toBe("finalApproach");

    const bad = guideStep(
      entered.state,
      { ...fixCoord(97, 0), accuracy: 200 },
      route,
      20,
      WALK_TUNING,
    INACTIVE_COURSE,
    );
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
      WALK_TUNING,
    INACTIVE_COURSE,
    ).state;
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

describe("방위 축 통합", () => {
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
  const at = (along: number) => ({
    lat: 37.5 + along / 111320,
    lng: 127.1,
    accuracy: 8,
  });
  const facing = (deg: number): CourseObservation => ({
    state: { kind: "valid", course: deg },
    accuracyDeg: 5,
  });

  it("경로 위에 있어도 방향이 지속적으로 어긋나면 이탈을 확정한다", () => {
    let { state } = initialGuideState(route, 0);
    let sawOffRoute = false;
    // 25초 동안 경로 위를 따라가되 방위만 남쪽(180도)으로 보고한다.
    for (let t = 1; t <= 25; t++) {
      const out = guideStep(state, at(t * 1.2), route, t, WALK_TUNING, facing(180));
      state = out.state;
      if (out.event?.kind === "offRoute") sawOffRoute = true;
    }
    expect(sawOffRoute).toBe(true);
    expect(state.phase).toBe("offRoute");
    expect(state.offRouteAxes.course).toBe(true);
    // 수직거리는 0이므로 거리 축은 잠기지 않았다.
    expect(state.offRouteAxes.distance).toBe(false);
  });

  it("방위 축으로 확정한 이탈은 방향이 맞아야 복귀한다", () => {
    let { state } = initialGuideState(route, 0);
    for (let t = 1; t <= 25; t++) {
      state = guideStep(state, at(t * 1.2), route, t, WALK_TUNING, facing(180)).state;
    }
    expect(state.phase).toBe("offRoute");
    // 위치는 계속 경로 위다. 방위만 어긋난 채로 두면 복귀하지 않는다.
    for (let t = 26; t <= 40; t++) {
      const out = guideStep(state, at(t * 1.2), route, t, WALK_TUNING, facing(180));
      state = out.state;
      expect(out.event?.kind).not.toBe("backOnRoute");
    }
    // 방향이 맞기 시작하면 복귀한다.
    let recovered = false;
    for (let t = 41; t <= 70; t++) {
      const out = guideStep(state, at(t * 1.2), route, t, WALK_TUNING, facing(0));
      state = out.state;
      if (out.event?.kind === "backOnRoute") recovered = true;
    }
    expect(recovered).toBe(true);
  });

  it("방위를 못 읽으면 복귀를 선언하지 않는다 — unknown은 정합이 아니다", () => {
    let { state } = initialGuideState(route, 0);
    for (let t = 1; t <= 25; t++) {
      state = guideStep(state, at(t * 1.2), route, t, WALK_TUNING, facing(180)).state;
    }
    expect(state.phase).toBe("offRoute");
    for (let t = 26; t <= 60; t++) {
      const out = guideStep(state, at(t * 1.2), route, t, WALK_TUNING, INACTIVE_COURSE);
      state = out.state;
      expect(out.event?.kind).not.toBe("backOnRoute");
    }
    expect(state.phase).toBe("offRoute");
  });

  it("비활성 관측만 주면 동작이 종전과 같다(웹 회귀 0)", () => {
    let a = initialGuideState(route, 0).state;
    let b = initialGuideState(route, 0).state;
    for (let t = 1; t <= 30; t++) {
      a = guideStep(a, at(t * 1.2), route, t, WALK_TUNING, INACTIVE_COURSE).state;
      b = guideStep(b, at(t * 1.2), route, t, WALK_TUNING, INACTIVE_COURSE).state;
    }
    expect(a.phase).toBe(b.phase);
    expect(a.offRouteAxes).toEqual({ distance: false, course: false });
  });

  it("상태 재구성은 표결 창을 비운다 — 옛 경로의 표가 새 경로에 적용되면 안 된다", () => {
    let { state } = initialGuideState(route, 0);
    for (let t = 1; t <= 10; t++) {
      state = guideStep(state, at(t * 1.2), route, t, WALK_TUNING, facing(180)).state;
    }
    expect(state.courseVotes.length).toBeGreaterThan(0);
    const fresh = guideStateAt(route, 0, 100, {});
    expect(fresh.courseVotes).toEqual([]);
    expect(fresh.offRouteAxes).toEqual({ distance: false, course: false });
  });

  it("방위 축이 확정 이탈이면 최종 접근에 진입하지 않는다", () => {
    // 종점 부근까지 이동하되 방위를 계속 반대로 보고한다. 방위 확정이 6a보다 앞에서
    // 반환되지 않으면 단방향 래치가 걸리고 다음 fix부터 0a 가드가 모든 판정을 멈춘다.
    let { state } = initialGuideState(route, 0, { hasFinalApproachGeometry: true });
    let enteredFinal = false;
    for (let t = 1; t <= 330; t++) {
      const out = guideStep(
        state,
        at(Math.min(399, t * 1.2)),
        route,
        t,
        WALK_TUNING,
        facing(180),
      );
      state = out.state;
      if (out.event?.kind === "finalApproachEnter") enteredFinal = true;
    }
    expect(enteredFinal).toBe(false);
    expect(state.offRouteAxes.course).toBe(true);
  });

  it("같은 fix에서 둘 다 성립하면 이탈이 이긴다 — 순서가 곧 불변식", () => {
    // 방위 확정과 최종 접근 진입이 **다른** fix에 일어나면 순서를 바꿔도 결과가 같다.
    // 그래서 진입 시각을 리듀서에서 먼저 역산하고, 확정이 정확히 그 fix에 일어나도록
    // 방위를 뒤집는 시점을 맞춘다. 확정은 뒤집은 뒤 13번째 fix다(20초 창에서
    // mismatch 14/20 = 0.7).
    const walk = (flipAt: number) => {
      let { state } = initialGuideState(route, 0);
      let enterT: number | null = null;
      for (let t = 1; t <= 340; t++) {
        const out = guideStep(
          state,
          at(Math.min(399, t * 1.2)),
          route,
          t,
          WALK_TUNING,
          facing(t >= flipAt ? 180 : 0),
        );
        state = out.state;
        if (out.event?.kind === "finalApproachEnter" && enterT === null) enterT = t;
      }
      return { state, enterT };
    };

    const base = walk(Number.POSITIVE_INFINITY);
    expect(base.enterT).not.toBeNull();

    const coincide = walk(base.enterT! - 13);
    expect(coincide.enterT).toBeNull();
    expect(coincide.state.offRouteAxes.course).toBe(true);
  });

  it("국면 전이는 표결 창을 비우고 latch는 남긴다", () => {
    // 투영을 못 믿는 기간(정확도 악화·위치 상실)의 표는 근거가 아니다. 반대로 이탈
    // 사실(latch)이 그 기간에 소실되면 방향이 어긋난 채 복귀가 선언된다.
    const primed = () => {
      let { state } = initialGuideState(route, 0);
      for (let t = 1; t <= 10; t++) {
        state = guideStep(state, at(t * 1.2), route, t, WALK_TUNING, facing(180)).state;
      }
      expect(state.courseVotes.length).toBeGreaterThan(0);
      return state;
    };

    // uncertain 진입(정확도 악화)
    const toUncertain = guideStep(
      primed(),
      { ...at(13), accuracy: 80 },
      route,
      11,
      WALK_TUNING,
      INACTIVE_COURSE,
    ).state;
    expect(toUncertain.phase).toBe("uncertain");
    expect(toUncertain.courseVotes).toEqual([]);

    // reacquiring 진입(fix 공백 11초)
    const toReacquiring = guideStep(
      primed(),
      at(13),
      route,
      22,
      WALK_TUNING,
      facing(180),
    ).state;
    expect(toReacquiring.phase).toBe("reacquiring");
    expect(toReacquiring.courseVotes).toEqual([]);
  });

  it("uncertain을 경유해도 축 latch가 보존된다", () => {
    let { state } = initialGuideState(route, 0);
    for (let t = 1; t <= 25; t++) {
      state = guideStep(state, at(t * 1.2), route, t, WALK_TUNING, facing(180)).state;
    }
    expect(state.offRouteAxes.course).toBe(true);
    // 정확도 악화로 uncertain 진입
    for (let t = 26; t <= 30; t++) {
      state = guideStep(
        state,
        { ...at(t * 1.2), accuracy: 80 },
        route,
        t,
        WALK_TUNING,
        INACTIVE_COURSE,
      ).state;
    }
    expect(state.phase).toBe("uncertain");
    expect(state.resumePhase).toBe("offRoute");
    expect(state.offRouteAxes.course).toBe(true);
  });
});

describe("방위 축 리듀서 trace (Kit 동조 가드)", () => {
  interface ReducerFix {
    t: number;
    along: number;
    lateral: number;
    acc: number;
    course: number;
    courseAcc: number;
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
          course: b.course,
          courseAcc: b.courseAcc,
        });
      }
    }
    return out;
  }

  const observe = (f: ReducerFix): CourseObservation =>
    f.course < 0 || f.courseAcc < 0
      ? INACTIVE_COURSE
      : { state: { kind: "valid", course: f.course }, accuracyDeg: f.courseAcc };

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
          observe(f),
        ).state;
      }
      expect(state.phase).toBe(sc.expectPhaseAtEnd);
      expect(state.offRouteAxes).toEqual(sc.expectAxes);
    });
  }
});
