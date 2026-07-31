import { describe, expect, it } from "vitest";
import { annotateServiceStatus } from "../odsay";
import { subwayHoursKey } from "../subway-service-hours";
import type { TransitRouteResult } from "../../types";

function leg(lineName: string, routeId?: string) {
  return { mode: "bus" as const, lineName, minutes: 10, serviceRouteId: routeId };
}
function subwayLeg(lineName: string, fromName?: string, wayCode?: number) {
  return {
    mode: "subway" as const,
    lineName,
    fromName,
    minutes: 10,
    ...(wayCode == null ? {} : { serviceWayCode: wayCode }),
  };
}
function route(legs: Array<ReturnType<typeof leg> | ReturnType<typeof subwayLeg>>) {
  return {
    summary: { totalMinutes: 20, fare: 1500, transfers: 0, walkMinutes: 5 },
    legs,
  };
}

const HOURS = new Map([
  ["A", { firstMinutes: 240, lastMinutes: 1350 }], // 04:00~22:30 주간
  ["B", { firstMinutes: 1390, lastMinutes: 230 }], // 23:10~03:50 심야
]);
// 지하철은 심야 운행이 없다 — 05:30~00:40이 전형이다.
const SUBWAY_HOURS = new Map([
  [
    subwayHoursKey({ stationName: "길동", lineName: "수도권 5호선", wayCode: 1 }),
    { firstMinutes: 330, lastMinutes: 40 }, // 05:30~00:40
  ],
]);
const NO_SUBWAY = new Map<string, { firstMinutes: number | null; lastMinutes: number | null }>();

// 01:00. 주간 버스(04:00~22:30)는 첫차 전, 심야 버스(23:10~03:50)는 운행 중,
// 지하철(05:30~00:40)은 막차 직후인 시각. 세 상태를 한 시각으로 대조할 수 있다.
// ⚠ 실측 시각이던 03:58은 N30 막차(03:50)도 지난 뒤라 버스끼리 대조가 안 된다.
const NIGHT = 60;

describe("annotateServiceStatus — 버스", () => {
  it("심야에 주간 노선을 outside로, 심야 노선을 running으로 판정한다", () => {
    const input = {
      recommended: route([leg("342", "A")]),
      alternatives: [route([leg("N30", "B")])],
    } as unknown as TransitRouteResult;
    const out = annotateServiceStatus(input, HOURS, NO_SUBWAY, NIGHT);
    // 심야 노선이 앞으로 올라온다
    expect(out.recommended.legs[0].lineName).toBe("N30");
    expect(out.recommended.legs[0].serviceStatus).toBe("running");
    expect(out.alternatives[0].legs[0].serviceStatus).toBe("outside");
  });

  it("첫차·막차 시각을 HH:MM 문자열로 싣는다", () => {
    const input = {
      recommended: route([leg("342", "A")]),
      alternatives: [],
    } as unknown as TransitRouteResult;
    const out = annotateServiceStatus(input, HOURS, NO_SUBWAY, NIGHT);
    expect(out.recommended.legs[0].firstServiceTime).toBe("04:00");
    expect(out.recommended.legs[0].lastServiceTime).toBe("22:30");
  });

  it("조회 실패(Map에 없음)는 unknown이고 순위를 바꾸지 않는다", () => {
    const input = {
      recommended: route([leg("999", "MISSING")]),
      alternatives: [route([leg("342", "A")])],
    } as unknown as TransitRouteResult;
    const out = annotateServiceStatus(input, HOURS, NO_SUBWAY, NIGHT);
    // unknown(1) < outside(2)이므로 원래 1순위가 유지된다
    expect(out.recommended.legs[0].lineName).toBe("999");
    expect(out.recommended.legs[0].serviceStatus).toBe("unknown");
  });

  it("환승 경로는 가장 나쁜 구간 상태를 경로 상태로 쓴다", () => {
    const input = {
      recommended: route([leg("N30", "B"), leg("342", "A")]), // running + outside
      alternatives: [route([leg("N30", "B")])], // running
    } as unknown as TransitRouteResult;
    const out = annotateServiceStatus(input, HOURS, NO_SUBWAY, NIGHT);
    // 한 구간이 outside면 경로 전체가 outside라 뒤로 밀린다
    expect(out.recommended.legs).toHaveLength(1);
    expect(out.recommended.legs[0].lineName).toBe("N30");
  });

  it("같은 상태 안에서는 ODsay 추천순이 보존된다(안정 정렬)", () => {
    const input = {
      recommended: route([leg("342", "A")]),
      alternatives: [route([leg("370", "A")]), route([leg("30-3", "A")])],
    } as unknown as TransitRouteResult;
    const out = annotateServiceStatus(input, HOURS, NO_SUBWAY, NIGHT);
    expect(out.recommended.legs[0].lineName).toBe("342");
    expect(out.alternatives.map((a) => a.legs[0].lineName)).toEqual(["370", "30-3"]);
  });
});

describe("annotateServiceStatus — 지하철", () => {
  it("막차 지난 지하철 전용 경로를 운행 중 버스 뒤로 강등한다", () => {
    // 이 마일스톤의 목적. 종전에는 지하철이 판정 대상이 아니라 rank 0을 받아
    // 01시에도 최상단에 남았다.
    const input = {
      recommended: route([subwayLeg("수도권 5호선", "길동", 1)]),
      alternatives: [route([leg("N30", "B")])], // running
    } as unknown as TransitRouteResult;
    const out = annotateServiceStatus(input, HOURS, SUBWAY_HOURS, NIGHT);
    expect(out.recommended.legs[0].lineName).toBe("N30");
    expect(out.alternatives[0].legs[0].serviceStatus).toBe("outside");
    expect(out.alternatives[0].legs[0].firstServiceTime).toBe("05:30");
    expect(out.alternatives[0].legs[0].lastServiceTime).toBe("00:40");
  });

  it("운행 중인 지하철은 강등되지 않는다", () => {
    const DAY = 600; // 10:00
    const input = {
      recommended: route([subwayLeg("수도권 5호선", "길동", 1)]),
      alternatives: [route([leg("342", "A")])],
    } as unknown as TransitRouteResult;
    const out = annotateServiceStatus(input, HOURS, SUBWAY_HOURS, DAY);
    expect(out.recommended.legs[0].serviceStatus).toBe("running");
    expect(out.recommended.legs[0].lineName).toBe("수도권 5호선");
  });

  it("방향이 다르면 다른 시간표를 본다 — 조인 실패는 unknown", () => {
    // 하행(2) 시간표는 Map에 없다. 상행 것을 대신 쓰면 안 된다.
    const input = {
      recommended: route([subwayLeg("수도권 5호선", "길동", 2)]),
      alternatives: [],
    } as unknown as TransitRouteResult;
    const out = annotateServiceStatus(input, HOURS, SUBWAY_HOURS, NIGHT);
    expect(out.recommended.legs[0].serviceStatus).toBe("unknown");
    expect(out.recommended.legs[0].firstServiceTime).toBeUndefined();
  });

  it("조인 축이 결측이어도 상태를 반드시 갖는다 (선재 결함 회귀 가드)", () => {
    // 방향이 없으면 조회할 수 없지만, 상태를 안 붙이면 rank 산출이 이 경로를
    // "판정 대상 없음"으로 보고 rank 0을 줘 running 경로와 나란히 최상단에 남는다.
    const input = {
      recommended: route([subwayLeg("수도권 5호선", "길동", undefined)]),
      alternatives: [route([leg("N30", "B")])], // running
    } as unknown as TransitRouteResult;
    const out = annotateServiceStatus(input, HOURS, SUBWAY_HOURS, NIGHT);
    expect(out.recommended.legs[0].lineName).toBe("N30"); // running이 앞
    expect(out.alternatives[0].legs[0].serviceStatus).toBe("unknown");
  });

  it("조인 키 없는 버스도 상태를 갖는다 (같은 선재 결함의 버스 판)", () => {
    const input = {
      recommended: route([leg("342", undefined)]),
      alternatives: [route([leg("N30", "B")])], // running
    } as unknown as TransitRouteResult;
    const out = annotateServiceStatus(input, HOURS, NO_SUBWAY, NIGHT);
    expect(out.recommended.legs[0].lineName).toBe("N30");
    expect(out.alternatives[0].legs[0].serviceStatus).toBe("unknown");
  });

  it("버스·지하철 혼합 경로는 가장 나쁜 구간을 따른다", () => {
    const input = {
      recommended: route([leg("N30", "B"), subwayLeg("수도권 5호선", "길동", 1)]), // running + outside
      alternatives: [route([leg("N30", "B")])], // running
    } as unknown as TransitRouteResult;
    const out = annotateServiceStatus(input, HOURS, SUBWAY_HOURS, NIGHT);
    expect(out.recommended.legs).toHaveLength(1); // 순수 running 경로가 올라온다
    expect(out.recommended.legs[0].lineName).toBe("N30");
  });

  it("도보 전용 경로는 판정 대상이 없어 원순서를 보존한다", () => {
    const walkOnly = {
      summary: { totalMinutes: 20, fare: 0, transfers: 0, walkMinutes: 20 },
      legs: [{ mode: "walk" as const, minutes: 20 }],
    };
    const input = {
      recommended: walkOnly,
      alternatives: [route([leg("N30", "B")])], // running
    } as unknown as TransitRouteResult;
    const out = annotateServiceStatus(input, HOURS, SUBWAY_HOURS, NIGHT);
    expect(out.recommended.legs[0].mode).toBe("walk");
    expect(out.recommended.legs[0].serviceStatus).toBeUndefined();
  });
});
