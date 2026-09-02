import { describe, it, expect } from "vitest";
import scenariosFixture from "./fixtures/transit-guide-scenarios.json";
import { transitPrewalkTarget, withoutPrewalk } from "../transit-guide";
import {
  buildTransitGuideRoute,
  classifyBoardingCandidates,
  classifyTrackMode,
  eventProfile,
  expressVerdict,
  unreachableReason,
  validExitNo,
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
import type { TransitLeg, TransitRoute } from "../types";

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
              const actual = (event as unknown as Record<string, unknown>)[k];
              // fixture의 명시 `null`은 "그 필드 부재" 기대다. 웹은 부재를 `undefined`로,
              // Swift는 `nil`로 표현하는데 JSON에는 그 구분이 없으므로 여기서 합친다
              // (같은 파일이 두 플랫폼을 돌리는 대가 — 부재의 뜻은 양쪽이 같다).
              expect(v === null ? (actual ?? null) : actual, `${ctx} event.${k}`).toBe(v);
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
    // boarding(차량 선택 뒤 승차 정류소 대기)은 waiting과 같은 엔드포인트라 같은 주기.
    expect(pollIntervalMs(state)).toBe(20_000);
    state = transitGuideStep(state, { kind: "confirmBoarded" }, route, 0).state;
    expect(pollIntervalMs(state)).toBe(60_000);
    state = transitGuideStep(state, pollOk(1, 2, [item({ remainingStops: 9 })]), route, 1).state;
    expect(pollIntervalMs(state)).toBe(15_000);
    state = transitGuideStep(state, pollOk(2, 2, [item({ remainingStops: 3, message: "x" })]), route, 2).state;
    expect(pollIntervalMs(state)).toBe(15_000);
    // advance는 arrived에서만 유효(리듀서 가드) — 도착 관측 후 전환.
    state = transitGuideStep(
      state,
      pollOk(3, 2, [item({ remainingStops: 0, message: "여의도 도착", arrivalCode: "1" })]),
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
        { kind: "poll", seq: i, phaseGen: 2, poll: { kind: "empty" } },
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
    const boarding = transitGuideStep(s, { kind: "board", lock: SUBWAY_LOCK() }, route, 0).state;
    return transitGuideStep(boarding, { kind: "confirmBoarded" }, route, 0).state;
  }
});

describe("eventProfile — 통지 채널·톤(§6.1)", () => {
  it("잔여 1·도착만 interrupting, 나머지는 polite", () => {
    expect(
      eventProfile({ kind: "countdown", remaining: 1, message: "", currentLocation: null, arrivalCode: null }).interrupt,
    ).toBe(true);
    expect(
      eventProfile({ kind: "countdown", remaining: 2, message: "", currentLocation: null, arrivalCode: null }).interrupt,
    ).toBe(false);
    expect(eventProfile({ kind: "arrived", certain: true }).interrupt).toBe(true);
    expect(eventProfile({ kind: "arrived", certain: false }).interrupt).toBe(true);
    expect(eventProfile({ kind: "signalLost" }).interrupt).toBe(false);
    expect(eventProfile({ kind: "boarded", legIndex: 0, cause: "declared" }).interrupt).toBe(false);
    expect(eventProfile({ kind: "boarded", legIndex: 0, cause: "observed" }).interrupt).toBe(true);
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

  // ODsay는 급행 운행 구간을 별도 lane으로 주고 이름에 "(급행)"을 붙인다(실호출
  // 2026-08-23: `수도권 9호선(급행)`, 완행은 `수도권 9호선`). 그 접미를 안 벗기면
  // 매핑표가 미스라 급행 leg 전체가 추적 불가로 떨어진다 — 급행을 탄 사용자에게만
  // 안내가 통째로 없어지는데 증상은 "이 경로는 추적할 수 없습니다" 한 줄뿐이다.
  it('"(급행)" 접미를 벗겨 같은 노선으로 매핑한다', () => {
    expect(subwayIdForOdsayLine("수도권 9호선(급행)")).toBe("1009");
    // ⚠ 9호선 표기만 실호출로 관측했다. 1호선 형태는 **우리 함수의 동작 단언**이지
    // ODsay가 그렇게 쓴다는 관측이 아니다(조사 §8의 미확인 축).
    expect(subwayIdForOdsayLine("수도권 1호선(급행)")).toBe("1001");
  });

  // ⚠ 괄호 일반이 아니라 **"(급행)" 한 토큰만** 벗긴다. 공항철도 직통열차는 별도
  // 열차 등급이라 실시간 도착 피드에 그 축이 없다 — 매핑해 버리면 영원한 미등장이
  // 되고, 그 침묵은 A16이 고치려는 바로 그 증상이다. 못 여는 것이 정직하다.
  it("그 밖의 괄호 표기는 벗기지 않는다(직통 등 다른 등급을 삼키지 않는다)", () => {
    expect(subwayIdForOdsayLine("수도권 공항철도(직통)")).toBeNull();
    // 앵커 계약: **끝에 붙은** 한 토큰만 벗긴다. 실제 ODsay 표기는 아니지만,
    // `$`를 빼는 변이(관대하게 만들려는 손질)를 잡는 유일한 입력이다 —
    // 앵커가 없으면 이것이 "9호선"으로 매핑돼 버린다.
    expect(subwayIdForOdsayLine("수도권 (급행)9호선")).toBeNull();
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

  // A16 L1의 앞 단계: 급행 경로를 고르면 안내 자체가 열려야 한다. 종전에는
  // trackMode가 null이라 급행 leg의 실시간 안내가 통째로 없었다(실호출 확인 —
  // 프로덕션 `/api/route/transit` 대안 경로의 lineName이 `수도권 9호선(급행)`이고
  // 그 leg의 경유역은 급행 정차역 13개다).
  it("급행 leg도 추적 대상이고 경유역은 급행 정차역 그대로다", () => {
    const route: TransitRoute = {
      summary: { totalMinutes: 40, fare: 1950, transfers: 0, walkMinutes: 4 },
      routeKey: "p-exp",
      legs: [
        {
          mode: "subway",
          lineName: "수도권 9호선(급행)",
          fromName: "김포공항",
          toName: "고속터미널",
          stationCount: 8,
          minutes: 27,
          serviceWayCode: 1,
          stops: ["김포공항", "마곡나루", "가양", "염창", "당산", "여의도", "노량진", "동작", "고속터미널"].map(
            (name, i) => ({ name, stationId: String(900 + i), lat: 37.5, lng: 126.9 }),
          ),
        },
      ],
    };
    const guide = buildTransitGuideRoute(route)!;
    expect(guide.legs[0].trackMode).toBe("subway");
    // 표시명은 급행 표기를 유지한다(정규화는 매핑 축에만 걸린다).
    expect(guide.legs[0].lineName).toBe("수도권 9호선(급행)");
    expect(guide.legs[0].viaStops.map((s) => s.name)).not.toContain("샛강");
    expect(guide.legs[0].viaStops).toHaveLength(9);
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
      expect(candidates[0].unreachable).toBeNull();
    });
  });

  it("급행·조기 종착 데코레이션", () => {
    const express = item({ express: true, vehicleId: "5", direction: "하행" });
    const short = item({ destinationName: "왕십리", vehicleId: "6", direction: "하행" });
    const { candidates } = classifyBoardingCandidates([express, short], leg);
    // 집합 부재 → 판정 불가(unknown): 차단하지 않고 종전 expressCheck.
    expect(candidates[0].express).toBe("unknown");
    expect(candidates[0].unreachable).toBeNull();
    expect(candidates[1].express).toBeNull();
    expect(candidates[1].unreachable).toBe("terminatesEarly");
  });

  // Kit TransitGuideTests.expressVerdictGate와 동일 케이스(미러 동조). spec 2026-09-02 §4.2.
  describe("급행 결정적 미도달 게이트(A16 L1)", () => {
    const stopsOf = (names: string[], ids?: string[]) =>
      names.map((name, i) => ({ name, lat: 37.5, lng: 127, ...(ids ? { stationId: ids[i] } : {}) }));
    const ids = ["901", "902", "903", "904", "905"];
    const names = ["김포공항", "당산", "노량진", "노들", "동작"];
    const base: TransitGuideLeg = {
      ...leg,
      lineName: "수도권 9호선",
      boardName: "김포공항",
      alightName: "노들",
      viaStops: stopsOf(names, ids),
      alightStop: { name: "노들", stationId: "904", lat: 37.5, lng: 127 },
    };
    const express = item({ express: true, vehicleId: "9", direction: "하행", destinationName: "중앙보훈병원" });

    it("ID 판정: 하차역 ID가 집합에 없으면 skips(차단), 있으면 stops", () => {
      const skip: TransitGuideLeg = { ...base, expressStops: ["김포공항", "당산", "동작"], expressStopIds: ["901", "902", "905"] };
      expect(expressVerdict(express, skip)).toBe("skips");
      expect(unreachableReason(express, skip)).toBe("expressSkipsAlight");
      expect(classifyBoardingCandidates([express], skip).candidates[0].unreachable).toBe("expressSkipsAlight");
      const stop: TransitGuideLeg = { ...skip, expressStopIds: ["901", "902", "904"], expressStops: ["김포공항", "당산", "노들"] };
      expect(expressVerdict(express, stop)).toBe("stops");
      expect(unreachableReason(express, stop)).toBeNull();
    });

    it("ID는 이름 별칭을 무시한다 — 이름이 어긋나도 ID가 판정한다", () => {
      const aliased: TransitGuideLeg = { ...base, expressStops: ["김포공항역", "당산역", "노들역"], expressStopIds: ["901", "902", "904"] };
      expect(expressVerdict(express, aliased)).toBe("stops");
    });

    it("이름 판정(ID 부재): 자격 ⓐ(하차역이 viaStops와 조인) ⓑ(집합이 viaStops와 이름 공유)", () => {
      const noIds: TransitGuideLeg = { ...base, viaStops: stopsOf(names), alightStop: { name: "노들", lat: 37.5, lng: 127 } };
      expect(expressVerdict(express, { ...noIds, expressStops: ["김포공항", "당산", "동작"] })).toBe("skips");
      expect(expressVerdict(express, { ...noIds, expressStops: ["김포공항역", "노들역"] })).toBe("stops"); // "역" 접미 흡수
      // ⓑ 미달: 집합이 이 구간과 이름을 하나도 공유하지 않으면 별칭 체계일 수 있어 unknown.
      expect(expressVerdict(express, { ...noIds, expressStops: ["여의도", "신논현"] })).toBe("unknown");
      // ⓐ 미달: 하차역 이름이 viaStops에 없으면 unknown.
      expect(expressVerdict(express, { ...noIds, alightName: "미지역", expressStops: ["김포공항", "당산"] })).toBe("unknown");
    });

    it("집합 부재·빈 집합은 unknown, 완행은 null, 종착 앞이면 종착이 먼저", () => {
      expect(expressVerdict(express, base)).toBe("unknown");
      expect(expressVerdict(express, { ...base, expressStops: [], expressStopIds: [] })).toBe("unknown");
      expect(expressVerdict(item({ express: false, vehicleId: "1" }), base)).toBeNull();
      const skip: TransitGuideLeg = { ...base, expressStops: ["김포공항"], expressStopIds: ["901"] };
      const early = item({ express: true, vehicleId: "8", direction: "하행", destinationName: "당산" });
      expect(unreachableReason(early, skip)).toBe("terminatesEarly");
    });

    it("buildTransitGuideRoute가 계약 필드를 싣고 출구 번호를 형식 게이트로 거른다", () => {
      const built = buildTransitGuideRoute({
        legs: [
          { mode: "subway", lineName: "수도권 9호선", minutes: 20, fromName: "김포공항", toName: "노들",
            stops: stopsOf(names, ids), expressStops: ["김포공항"], expressStopIds: ["901"],
            exit: { alight: " 2-1 " } },
        ],
      } as unknown as TransitRoute)!;
      expect(built.legs[0].expressStops).toEqual(["김포공항"]);
      expect(built.legs[0].expressStopIds).toEqual(["901"]);
      expect(built.legs[0].exitAlight).toBe("2-1");
      const bad = buildTransitGuideRoute({
        legs: [{ mode: "subway", lineName: "수도권 9호선", minutes: 20, fromName: "a", toName: "b",
          stops: stopsOf(names), expressStops: [], exit: { alight: "1 2" } }],
      } as unknown as TransitRoute)!;
      expect(bad.legs[0].expressStops).toBeUndefined();
      expect(bad.legs[0].exitAlight).toBeUndefined();
      expect(validExitNo("3번 출구")).toBeNull();
      expect(validExitNo("10")).toBe("10");
    });
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

describe("승차 전 도보 판정 transitPrewalkTarget (A25)", () => {
  const routes = fixture.routes as unknown as Record<string, TransitGuideRoute>;
  const expected = (scenariosFixture as unknown as { prewalk: Record<string, unknown> }).prewalk;

  it("공유 fixture prewalk 기대값과 일치한다(전 route)", () => {
    expect(Object.keys(expected).sort()).toEqual(Object.keys(routes).sort());
    for (const [name, route] of Object.entries(routes)) {
      expect(transitPrewalkTarget(route), name).toEqual(expected[name]);
    }
  });

  const base = routes.subwaySingle;
  const withFirst = (patch: Partial<TransitGuideLeg>): TransitGuideRoute => ({
    ...base,
    legs: [{ ...base.legs[0], ...patch }, ...base.legs.slice(1)],
  });

  it("0분·null·boardStop 없음·(0,0)·NaN은 null", () => {
    expect(transitPrewalkTarget(withFirst({ walkBeforeMinutes: 0 }))).toBeNull();
    expect(transitPrewalkTarget(withFirst({ walkBeforeMinutes: null }))).toBeNull();
    expect(transitPrewalkTarget(withFirst({ boardStop: null }))).toBeNull();
    expect(
      transitPrewalkTarget(withFirst({ boardStop: { name: "x", lat: 0, lng: 0 } })),
    ).toBeNull();
    expect(
      transitPrewalkTarget(withFirst({ boardStop: { name: "x", lat: Number.NaN, lng: 127 } })),
    ).toBeNull();
    expect(transitPrewalkTarget({ legs: [], walkAfterMinutes: null })).toBeNull();
  });

  it("두 번째 leg의 도보는 대상이 아니다", () => {
    const route: TransitGuideRoute = {
      ...base,
      legs: [{ ...base.legs[0], walkBeforeMinutes: null }, { ...base.legs[0], walkBeforeMinutes: 4 }],
    };
    expect(transitPrewalkTarget(route)).toBeNull();
  });

  it("withoutPrewalk는 legs[0].walkBeforeMinutes만 지우고 원본은 불변", () => {
    const route: TransitGuideRoute = {
      ...base,
      legs: [{ ...base.legs[0] }, { ...base.legs[0], walkBeforeMinutes: 4 }],
    };
    const snapshot = JSON.parse(JSON.stringify(route));
    const out = withoutPrewalk(route);
    expect(out.legs[0].walkBeforeMinutes).toBeNull();
    expect(out.legs[1].walkBeforeMinutes).toBe(4);
    expect(out.walkAfterMinutes).toBe(route.walkAfterMinutes);
    expect(route).toEqual(snapshot);
    expect(withoutPrewalk({ legs: [], walkAfterMinutes: 2 })).toEqual({ legs: [], walkAfterMinutes: 2 });
    // 새 필드(급행 집합·출구·en 이름)도 보존 — Kit withoutPrewalk 단언과 미러.
    const rich: TransitGuideLeg = {
      ...base.legs[0], walkBeforeMinutes: 3, lineNameEn: "Line 9",
      expressStops: ["김포공항"], expressStopIds: ["901"], exitAlight: "2-1",
    };
    const kept = withoutPrewalk({ legs: [rich], walkAfterMinutes: null }).legs[0];
    expect(kept).toEqual({ ...rich, walkBeforeMinutes: null });
  });
});

// === A27 승차 국면 지하철 상태줄 — 공유 fixture(Kit TransitGuideTests 동조) ===
import ridingCases from "./fixtures/subway-riding-message-cases.json";
import { subwayRidingMessage } from "../transit-guide";

describe("subwayRidingMessage — arvlCd → 탑승자 시점 문장 종류(A27)", () => {
  for (const c of ridingCases.cases) {
    it(`code ${JSON.stringify(c.arrivalCode)} → ${JSON.stringify(c.expect)}`, () => {
      expect(subwayRidingMessage(c.arrivalCode)).toEqual(c.expect);
    });
  }
  it("riding 폴링은 이벤트와 상태에 arrivalCode를 싣는다(상태줄·통지가 코드를 읽는 축)", () => {
    const route = SUBWAY_ROUTE();
    let state = initTransitGuide(route, 0);
    state = transitGuideStep(state, { kind: "board", lock: SUBWAY_LOCK() }, route, 0).state;
    state = transitGuideStep(state, { kind: "confirmBoarded" }, route, 0).state;
    const r = transitGuideStep(state, pollOk(1, state.phaseGen, [item({ arrivalCode: "5", message: "전역 도착", remainingStops: 1 })]), route, 1000);
    expect(r.state.lastArrivalCode).toBe("5");
    expect(r.event).toMatchObject({ kind: "trackingStarted", arrivalCode: "5" });
  });
});

describe("영문 조각 승계 (E27 잔여 ①, spec 2026-09-01 §3.4)", () => {
  function routeWith(over: Partial<TransitLeg>): TransitRoute {
    return {
      routeKey: "k",
      summary: { totalMinutes: 20, transfers: 0, fare: 1400, walkMinutes: 3 },
      legs: [
        {
          mode: "subway",
          lineName: "수도권 5호선",
          minutes: 15,
          stationCount: 8,
          fromName: "천호",
          toName: "광화문",
          stops: [
            { name: "천호", lat: 37.5, lng: 127.1, nameEn: "Cheonho" },
            { name: "광화문", lat: 37.57, lng: 126.97, nameEn: "Gwanghwamun" },
          ],
          ...over,
        } as TransitLeg,
      ],
    } as TransitRoute;
  }

  it("경로 영문을 leg로 승계한다 — 한국어 필드는 불변", () => {
    const r = buildTransitGuideRoute(
      routeWith({
        lineNameEn: "Line 5",
        fromNameEn: "Cheonho",
        toNameEn: "Gwanghwamun",
      } as Partial<TransitLeg>),
    );
    expect(r?.legs[0].lineNameEn).toBe("Line 5");
    expect(r?.legs[0].boardNameEn).toBe("Cheonho");
    expect(r?.legs[0].alightNameEn).toBe("Gwanghwamun");
    expect(r?.legs[0].lineName).toBe("수도권 5호선");
    expect(r?.legs[0].boardName).toBe("천호");
  });

  it("ko/en 폴백 순서가 짝을 이룬다 — fromName이 있는데 fromNameEn이 없으면 부재", () => {
    // ⚠ 여기서 boardStop.nameEn("Cheonho")으로 흘러가면 같은 자리가 서로 다른 정류소를
    // 가리킬 수 있다(fromName은 provider가 준 승차 지점, boardStop은 정차 목록의 첫 항목).
    const r = buildTransitGuideRoute(routeWith({ fromName: "천호역 3번 출구" } as Partial<TransitLeg>));
    expect(r?.legs[0].boardName).toBe("천호역 3번 출구");
    expect(r?.legs[0].boardNameEn).toBeUndefined();
  });

  it("fromName이 없으면 boardStop 쪽 짝을 쓴다", () => {
    const r = buildTransitGuideRoute(routeWith({ fromName: undefined } as Partial<TransitLeg>));
    expect(r?.legs[0].boardName).toBe("천호");
    expect(r?.legs[0].boardNameEn).toBe("Cheonho");
  });

  it("ko 조회(영문 없음)면 leg에도 영문 키가 없다 — 종전 동작 무변화", () => {
    const r = buildTransitGuideRoute(routeWith({}));
    expect(r?.legs[0]).not.toHaveProperty("lineNameEn");
    expect(r?.legs[0]).not.toHaveProperty("boardNameEn");
    expect(r?.legs[0]).not.toHaveProperty("alightNameEn");
  });

  it("승차 전 도보 대상이 영문 역명을 나른다", () => {
    const r = buildTransitGuideRoute(
      routeWith({ fromNameEn: "Cheonho", stops: [
        { name: "천호", lat: 37.5, lng: 127.1, nameEn: "Cheonho" },
        { name: "광화문", lat: 37.57, lng: 126.97, nameEn: "Gwanghwamun" },
      ] } as Partial<TransitLeg>),
    );
    const withWalk: TransitGuideRoute = {
      ...r!,
      legs: [{ ...r!.legs[0], walkBeforeMinutes: 4 }],
    };
    expect(transitPrewalkTarget(withWalk)).toMatchObject({ name: "천호", nameEn: "Cheonho", minutes: 4 });
  });
});
