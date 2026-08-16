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
  viaStopCurrentIndex,
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
        if ("previousLock" in exp) {
          // 값은 락 참조 이름 또는 null(§13.1 보존·소거 단언).
          expect(state.previousLock, ctx).toEqual(
            exp.previousLock === null ? null : fixture.locks[exp.previousLock as string],
          );
        }
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
      routeKey: "p0",
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
      routeKey: "p1",
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

    const unknown = item({ direction: "알수없음", vehicleId: "3" });
    const uncertain = classifyBoardingCandidates([unknown], leg);
    expect(uncertain.directionUncertain).toBe(true);
    expect(uncertain.candidates).toHaveLength(1); // 오필터로 숨기지 않는다
  });

  // A17(2026-08-17): 버스 후보는 upstream이 방향 필드를 주지 않아 direction이 전부
  // 빈 문자열이다. 그건 "방향 축이 없다"이지 "매칭이 전멸했다"가 아니다 — uncertain으로
  // 분류하면 모든 버스 세션에 "방면을 확인해 주세요"가 붙는데 확인할 대상이 목록에 없다.
  it("후보 전원의 direction이 비어 있으면(버스) directionUncertain이 아니다", () => {
    const busA = item({ direction: "", vehicleId: "b1" });
    const busB = item({ direction: "", vehicleId: "b2" });
    const result = classifyBoardingCandidates([busA, busB], leg);
    expect(result.directionUncertain).toBe(false);
    expect(result.candidates.map((c) => c.item.vehicleId)).toEqual(["b1", "b2"]);
    // 후보 0건도 축 부재 — 통지할 목록 자체가 없다.
    expect(classifyBoardingCandidates([], leg).directionUncertain).toBe(false);
  });

  it("방향 값이 하나라도 있는데 전멸이면 여전히 uncertain(지하철 미지 표기)", () => {
    const blank = item({ direction: "", vehicleId: "1" });
    const unknown = item({ direction: "알수없음", vehicleId: "2" });
    const result = classifyBoardingCandidates([blank, unknown], leg);
    expect(result.directionUncertain).toBe(true);
    expect(result.candidates).toHaveLength(2);
  });

  // 순환선(2호선) 실호출 확정 2026-08-16 — 내선=wayCode 2·외선=1, 종착 검사 제외.
  describe("순환선 2호선(내선·외선)", () => {
    // 실측 표본: 을지로입구 도착 4건이 전부 종착 "성수"였고, 그 leg의 경유
    // 목록에서 성수(9)는 하차역 잠실(14)보다 앞이라 종전 코드는 전부 차단했다.
    const loopLeg: TransitGuideLeg = {
      ...leg,
      lineName: "수도권 2호선",
      boardName: "을지로입구",
      alightName: "잠실",
      viaStops: [
        "을지로입구", "을지로3가", "을지로4가", "동대문역사문화공원", "신당",
        "상왕십리", "왕십리", "한양대", "뚝섬", "성수",
        "건대입구", "구의", "강변", "잠실나루", "잠실",
      ].map((name) => ({ name, lat: 37.5, lng: 127 })),
      stationCount: 14,
      wayCode: 2, // ODsay 을지로입구 → 잠실 실측
    };

    it("내선=2·외선=1로 방향이 갈린다", () => {
      const inner = item({ direction: "내선", vehicleId: "3", destinationName: "성수" });
      const outer = item({ direction: "외선", vehicleId: "4", destinationName: "성수" });
      const { candidates, directionUncertain } = classifyBoardingCandidates(
        [inner, outer],
        loopLeg,
      );
      expect(directionUncertain).toBe(false);
      expect(candidates.map((c) => c.item.vehicleId)).toEqual(["3"]);
    });

    // 지선(성수·신정)도 내선/외선 표기를 쓴다(실호출 2026-08-16, 8개 역 확인).
    // 방향 대응은 본선과 같고(ODsay 지선 leg 4건 일치), 종착은 지선 라벨이거나
    // 그 지선의 종점이라 어느 쪽도 하차역보다 앞설 수 없다.
    it("지선도 같은 표기를 쓰고 방향 대응이 같다", () => {
      const branchLeg: TransitGuideLeg = {
        ...leg,
        lineName: "수도권 2호선",
        boardName: "용답",
        alightName: "신설동",
        viaStops: ["용답", "신답", "용두", "신설동"].map((name) => ({
          name,
          lat: 37.56,
          lng: 127.04,
        })),
        stationCount: 3,
        wayCode: 2, // ODsay 용답 → 신설동 실측
      };
      const toward = item({ direction: "내선", vehicleId: "7", destinationName: "신설동" });
      const away = item({ direction: "외선", vehicleId: "8", destinationName: "성수지선" });
      const { candidates, directionUncertain } = classifyBoardingCandidates(
        [toward, away],
        branchLeg,
      );
      expect(directionUncertain).toBe(false);
      expect(candidates.map((c) => c.item.vehicleId)).toEqual(["7"]);
      // 종점 종착·지선 라벨 둘 다 순수 판정에서도 차단 근거가 아니다.
      expect(terminatesBeforeAlight("신설동", branchLeg)).toBe(false);
      expect(terminatesBeforeAlight("성수지선", branchLeg)).toBe(false);
    });

    it("종착 상수 '성수'가 순환선 구간을 오차단하지 않는다", () => {
      // 순수 판정 자체는 여전히 "앞선 종착"이라 답한다 — 순환선 제외는 분류기 몫.
      expect(terminatesBeforeAlight("성수", loopLeg)).toBe(true);
      const inner = item({ direction: "내선", vehicleId: "3", destinationName: "성수" });
      const { candidates } = classifyBoardingCandidates([inner], loopLeg);
      expect(candidates[0].terminatesEarly).toBe(false);
    });
  });

  it("급행·조기 종착 데코레이션", () => {
    const express = item({ express: true, vehicleId: "5", direction: "하행" });
    const short = item({ destinationName: "왕십리", vehicleId: "6", direction: "하행" });
    const { candidates } = classifyBoardingCandidates([express, short], leg);
    expect(candidates[0].express).toBe(true);
    expect(candidates[1].terminatesEarly).toBe(true);
  });

  // Kit TransitGuideTests.viaStopCurrentIndexMatching과 동일 케이스(미러 동조).
  it("경유 목록 현재 위치 매칭(§14.1): 표기 차이 흡수, 미매칭·무값은 null", () => {
    expect(viaStopCurrentIndex(leg, "강동")).toBe(1);
    expect(viaStopCurrentIndex(leg, "강동역")).toBe(1); // "역" 접미 흡수
    expect(viaStopCurrentIndex(leg, "왕십리")).toBe(2); // 부역명 괄호 흡수
    expect(viaStopCurrentIndex(leg, "미지의역")).toBeNull(); // 목록 밖 = 무표기
    expect(viaStopCurrentIndex(leg, null)).toBeNull();
    expect(viaStopCurrentIndex(leg, "")).toBeNull();
    expect(viaStopCurrentIndex({ ...leg, viaStops: [] }, "강동")).toBeNull();
  });
});
