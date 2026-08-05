import { describe, it, expect } from "vitest";
import scenariosFixture from "./fixtures/transit-guide-scenarios.json";
import {
  buildTransitGuideRoute,
  classifyBoardingCandidates,
  classifyTrackMode,
  eventProfile,
  initTransitGuide,
  pollIntervalMs,
  SESSION_POLL_CAP,
  subwayIdForOdsayLine,
  terminatesBeforeAlight,
  transitGuideStep,
  type TrackItem,
  type TransitGuideEvent,
  type TransitGuideLeg,
  type TransitGuideRoute,
  type TransitGuideState,
  type TransitInput,
  type TransitLock,
} from "../transit-guide";
import type { TransitRoute } from "../types";

/**
 * 공유 fixture 실행기 — Kit TransitGuideTests와 같은 파일을 돌린다(동조 강제).
 * expect.event는 kind + 명시 필드만 부분 대조, null은 "이벤트 없음" 단언.
 */

interface FixtureStep {
  at: number;
  input: Record<string, unknown>;
  expect: Record<string, unknown>;
}
interface FixtureScenario {
  name: string;
  route: string;
  steps: FixtureStep[];
}
const fixture = scenariosFixture as unknown as {
  routes: Record<string, TransitGuideRoute>;
  locks: Record<string, TransitLock>;
  scenarios: FixtureScenario[];
};

function resolveInput(raw: Record<string, unknown>): TransitInput {
  if (raw.kind === "board") {
    const lockRef = raw.lock as string;
    return { kind: "board", lock: fixture.locks[lockRef] };
  }
  return raw as unknown as TransitInput;
}

describe("transitGuideStep — 공유 fixture 시나리오(B2 §8.1)", () => {
  for (const scenario of fixture.scenarios) {
    it(scenario.name, () => {
      const route = fixture.routes[scenario.route];
      expect(route).toBeDefined();
      let state = initTransitGuide(route, 0);
      for (const [i, step] of scenario.steps.entries()) {
        const { state: nextState, event } = transitGuideStep(
          state,
          resolveInput(step.input),
          route,
          step.at,
        );
        state = nextState;
        const exp = step.expect;
        const ctx = `${scenario.name} step ${i}`;
        if ("phase" in exp) expect(state.phase, ctx).toBe(exp.phase);
        if ("signal" in exp) expect(state.signal, ctx).toBe(exp.signal);
        if ("legIndex" in exp) expect(state.legIndex, ctx).toBe(exp.legIndex);
        if ("remaining" in exp) expect(state.remaining, ctx).toBe(exp.remaining);
        if ("dataAgeSeconds" in exp) expect(state.dataAgeSeconds, ctx).toBe(exp.dataAgeSeconds);
        if ("event" in exp) {
          if (exp.event === null) {
            expect(event, ctx).toBeNull();
          } else {
            const expEvent = exp.event as Record<string, unknown>;
            expect(event, ctx).not.toBeNull();
            for (const [k, v] of Object.entries(expEvent)) {
              expect((event as unknown as Record<string, unknown>)[k], `${ctx} event.${k}`).toBe(v);
            }
          }
        }
      }
    });
  }
});

// === fixture 밖 단위 검증 ===

const SUBWAY_ROUTE = () => fixture.routes.subwaySingle;
const SUBWAY_LOCK = () => fixture.locks.subway5696;

function pollOk(seq: number, phaseGen: number, items: TrackItem[]): TransitInput {
  return { kind: "poll", seq, phaseGen, poll: { kind: "ok", items } };
}
function item(overrides: Partial<TrackItem>): TrackItem {
  return {
    vehicleId: "5696",
    direction: "하행",
    message: "[9]번째 전역",
    remainingStops: 9,
    destinationName: "하남검단산",
    express: false,
    arrivalCode: "99",
    ...overrides,
  };
}

describe("pollIntervalMs — 적응 주기(§7)", () => {
  it("waiting 20s, 미등장 60s, 추적 중 15s(§12 원거리 30s 폐지), done·untrackable 0", () => {
    const route = SUBWAY_ROUTE();
    let state = initTransitGuide(route, 0);
    expect(pollIntervalMs(state)).toBe(20_000);
    state = transitGuideStep(state, { kind: "board", lock: SUBWAY_LOCK() }, route, 0).state;
    expect(pollIntervalMs(state)).toBe(60_000);
    state = transitGuideStep(state, pollOk(1, 1, [item({ remainingStops: 9 })]), route, 1).state;
    expect(pollIntervalMs(state)).toBe(15_000);
    state = transitGuideStep(state, pollOk(2, 1, [item({ remainingStops: 3, message: "x" })]), route, 2).state;
    expect(pollIntervalMs(state)).toBe(15_000);
    // advance는 arrived에서만 유효(리듀서 가드) — 도착 관측 후 전환.
    state = transitGuideStep(
      state,
      pollOk(3, 1, [item({ remainingStops: 0, message: "여의도 도착", arrivalCode: "1" })]),
      route,
      3,
    ).state;
    state = transitGuideStep(state, { kind: "advance" }, route, 4).state;
    expect(state.phase).toBe("done");
    expect(pollIntervalMs(state)).toBe(0);
    expect(pollIntervalMs(initTransitGuide(fixture.routes.untrackableSubway, 0))).toBe(0);
  });
});

describe("세션 폴링 캡(§7) — 도달 시 1회 통지 + 60초 강등", () => {
  it("SESSION_POLL_CAP 도달 폴에서 capSlowed, 이후 재통지 없음", () => {
    const route = SUBWAY_ROUTE();
    let state = initTransitGuideAtRiding(route);
    const events: TransitGuideEvent[] = [];
    for (let i = 1; i <= SESSION_POLL_CAP + 5; i++) {
      const r = transitGuideStep(
        state,
        { kind: "poll", seq: i, phaseGen: 1, poll: { kind: "empty" } },
        route,
        i * 1000,
      );
      state = r.state;
      if (r.event) events.push(r.event);
    }
    expect(events.filter((e) => e.kind === "capSlowed")).toHaveLength(1);
    expect(pollIntervalMs(state)).toBe(60_000);
  });

  function initTransitGuideAtRiding(route: TransitGuideRoute): TransitGuideState {
    const s = initTransitGuide(route, 0);
    return transitGuideStep(s, { kind: "board", lock: SUBWAY_LOCK() }, route, 0).state;
  }
});

describe("eventProfile — 통지 채널·톤(§6.1)", () => {
  it("잔여 1·도착만 interrupting, 나머지는 polite", () => {
    expect(
      eventProfile({ kind: "countdown", remaining: 1, message: "", currentLocation: null }).interrupt,
    ).toBe(true);
    expect(
      eventProfile({ kind: "countdown", remaining: 2, message: "", currentLocation: null }).interrupt,
    ).toBe(false);
    expect(eventProfile({ kind: "arrived", certain: true }).interrupt).toBe(true);
    expect(eventProfile({ kind: "arrived", certain: false }).interrupt).toBe(true);
    expect(eventProfile({ kind: "signalLost" }).interrupt).toBe(false);
    expect(eventProfile({ kind: "boarded", legIndex: 0 }).interrupt).toBe(false);
  });
});

describe("subwayIdForOdsayLine — 노선 매핑표(§5.1)", () => {
  it("수도권 접두·구분자를 흡수하고 미수록(비수도권)은 null", () => {
    expect(subwayIdForOdsayLine("수도권 5호선")).toBe("1005");
    expect(subwayIdForOdsayLine("수도권 수인.분당선")).toBe("1075");
    expect(subwayIdForOdsayLine("신분당선")).toBe("1077");
    expect(subwayIdForOdsayLine("대전 1호선")).toBeNull();
    expect(subwayIdForOdsayLine("부산 도시철도 2호선")).toBeNull();
  });
});

describe("classifyTrackMode·buildTransitGuideRoute(§4.1·§5.2)", () => {
  const seoulStop = (name: string) => ({
    name,
    localId: "123000017",
    arsId: "24101",
    cityCode: "1000",
    lat: 37.5,
    lng: 127.1,
  });

  it("서울버스: 양 끝 서울(1000) ∧ arsID·stId ∧ TOPIS 노선 ID일 때만", () => {
    const leg = {
      mode: "bus",
      lineName: "341",
      minutes: 20,
      serviceRouteId: "100100240",
      serviceCityCode: 1000,
    } as TransitRoute["legs"][number];
    expect(classifyTrackMode(leg, seoulStop("a"), seoulStop("b"))).toBe("seoulBus");
    // 지방 정류소(cityCode 상이)는 arsId가 있어도 tagoBus 근사로
    expect(
      classifyTrackMode(leg, { ...seoulStop("a"), cityCode: "3000" }, seoulStop("b")),
    ).toBe("tagoBus");
    // 하차 좌표조차 없으면 추적 불가
    expect(classifyTrackMode(leg, null, null)).toBeNull();
  });

  it("경로 조립: 도보는 대기 문맥으로 흡수, 말미 도보는 walkAfter, 탑승 0개는 null", () => {
    const route: TransitRoute = {
      summary: { totalMinutes: 30, fare: 1500, transfers: 0, walkMinutes: 8 },
      legs: [
        { mode: "walk", minutes: 3 },
        {
          mode: "subway",
          lineName: "수도권 5호선",
          fromName: "천호",
          toName: "여의도",
          stationCount: 8,
          minutes: 20,
          serviceWayCode: 2,
        },
        { mode: "walk", minutes: 5 },
      ],
    };
    const guide = buildTransitGuideRoute(route)!;
    expect(guide.legs).toHaveLength(1);
    expect(guide.legs[0].walkBeforeMinutes).toBe(3);
    expect(guide.legs[0].trackMode).toBe("subway");
    expect(guide.walkAfterMinutes).toBe(5);

    const walkOnly: TransitRoute = {
      summary: { totalMinutes: 10, fare: 0, transfers: 0, walkMinutes: 10 },
      legs: [{ mode: "walk", minutes: 10 }],
    };
    expect(buildTransitGuideRoute(walkOnly)).toBeNull();
  });
});

describe("classifyBoardingCandidates·terminatesBeforeAlight(§5.1)", () => {
  const leg: TransitGuideLeg = {
    mode: "subway",
    lineName: "수도권 5호선",
    trackMode: "subway",
    boardName: "천호",
    alightName: "여의도",
    boardStop: { name: "천호", lat: 37.5385, lng: 127.1235 },
    alightStop: { name: "여의도", lat: 37.5216, lng: 126.924 },
    viaStops: [
      { name: "천호", lat: 37.5385, lng: 127.1235 },
      { name: "강동", lat: 37.5359, lng: 127.1323 },
      { name: "왕십리(성동구청)", lat: 37.5613, lng: 127.0374 },
      { name: "여의도", lat: 37.5216, lng: 126.924 },
      { name: "화곡", lat: 37.5416, lng: 126.8406 },
    ],
    stationCount: 4,
    routeId: null,
    wayCode: 2,
    walkBeforeMinutes: null,
  };

  it("종착이 하차역 이전이면 결정적 미도달(활성화 차단 축)", () => {
    expect(terminatesBeforeAlight("왕십리", leg)).toBe(true); // 부역명 표기 차이 흡수
    expect(terminatesBeforeAlight("화곡", leg)).toBe(false); // 하차역 너머 종착
    expect(terminatesBeforeAlight("여의도", leg)).toBe(false); // 하차역 종착 = 도달
    expect(terminatesBeforeAlight("미지의역", leg)).toBe(false); // 목록 밖 = 판정 불가
  });

  it("방향 판정: 상·하행 매칭 성공분만, 전멸이면 전체 유지 + directionUncertain", () => {
    const up = item({ direction: "상행", vehicleId: "1" });
    const down = item({ direction: "하행", vehicleId: "2" });
    const matched = classifyBoardingCandidates([up, down], leg); // wayCode 2 = 하행
    expect(matched.directionUncertain).toBe(false);
    expect(matched.candidates.map((c) => c.item.vehicleId)).toEqual(["2"]);

    const inner = item({ direction: "내선", vehicleId: "3" });
    const outer = item({ direction: "외선", vehicleId: "4" });
    const uncertain = classifyBoardingCandidates([inner, outer], leg);
    expect(uncertain.directionUncertain).toBe(true);
    expect(uncertain.candidates).toHaveLength(2); // 오필터로 숨기지 않는다
  });

  it("급행·조기 종착 데코레이션", () => {
    const express = item({ express: true, vehicleId: "5", direction: "하행" });
    const short = item({ destinationName: "왕십리", vehicleId: "6", direction: "하행" });
    const { candidates } = classifyBoardingCandidates([express, short], leg);
    expect(candidates[0].express).toBe(true);
    expect(candidates[1].terminatesEarly).toBe(true);
  });
});
