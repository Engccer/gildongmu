import { describe, expect, it } from "vitest";
import { annotateServiceStatus } from "../odsay";
import type { TransitRouteResult } from "../../types";

function leg(lineName: string, routeId?: string) {
  return { mode: "bus" as const, lineName, minutes: 10, serviceRouteId: routeId };
}
function route(legs: ReturnType<typeof leg>[]) {
  return {
    summary: { totalMinutes: 20, fare: 1500, transfers: 0, walkMinutes: 5 },
    legs,
  };
}

const HOURS = new Map([
  ["A", { firstMinutes: 240, lastMinutes: 1350 }], // 04:00~22:30 주간
  ["B", { firstMinutes: 1390, lastMinutes: 230 }], // 23:10~03:50 심야
]);
// 01:00. 주간 노선(04:00~22:30)은 첫차 전이고 심야 노선(23:10~03:50)은 운행 중인 시각.
// ⚠ 실측 시각이던 03:58은 N30 막차(03:50)도 지난 뒤라 둘 다 outside가 되어 대조가 안 된다.
const NIGHT = 60;

describe("annotateServiceStatus", () => {
  it("심야에 주간 노선을 outside로, 심야 노선을 running으로 판정한다", () => {
    const input = {
      recommended: route([leg("342", "A")]),
      alternatives: [route([leg("N30", "B")])],
    } as unknown as TransitRouteResult;
    const out = annotateServiceStatus(input, HOURS, NIGHT);
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
    const out = annotateServiceStatus(input, HOURS, NIGHT);
    expect(out.recommended.legs[0].firstServiceTime).toBe("04:00");
    expect(out.recommended.legs[0].lastServiceTime).toBe("22:30");
  });

  it("조회 실패(Map에 없음)는 unknown이고 순위를 바꾸지 않는다", () => {
    const input = {
      recommended: route([leg("999", "MISSING")]),
      alternatives: [route([leg("342", "A")])],
    } as unknown as TransitRouteResult;
    const out = annotateServiceStatus(input, HOURS, NIGHT);
    // unknown(1) < outside(2)이므로 원래 1순위가 유지된다
    expect(out.recommended.legs[0].lineName).toBe("999");
    expect(out.recommended.legs[0].serviceStatus).toBe("unknown");
  });

  it("환승 경로는 가장 나쁜 구간 상태를 경로 상태로 쓴다", () => {
    const input = {
      recommended: route([leg("N30", "B"), leg("342", "A")]), // running + outside
      alternatives: [route([leg("N30", "B")])], // running
    } as unknown as TransitRouteResult;
    const out = annotateServiceStatus(input, HOURS, NIGHT);
    // 한 구간이 outside면 경로 전체가 outside라 뒤로 밀린다
    expect(out.recommended.legs).toHaveLength(1);
    expect(out.recommended.legs[0].lineName).toBe("N30");
  });

  it("버스 leg가 없는 경로(지하철·도보 전용)는 원순서를 보존한다", () => {
    const subwayOnly = {
      summary: { totalMinutes: 20, fare: 1500, transfers: 0, walkMinutes: 5 },
      legs: [{ mode: "subway" as const, lineName: "수도권 5호선", minutes: 10 }],
    };
    const input = {
      recommended: subwayOnly,
      alternatives: [route([leg("N30", "B")])], // running
    } as unknown as TransitRouteResult;
    const out = annotateServiceStatus(input, HOURS, NIGHT);
    // 지하철 전용은 판정 대상이 아니라 rank 0 → running과 동률 → 원순서 유지
    expect(out.recommended.legs[0].lineName).toBe("수도권 5호선");
    expect(out.recommended.legs[0].serviceStatus).toBeUndefined();
  });

  it("같은 상태 안에서는 ODsay 추천순이 보존된다(안정 정렬)", () => {
    const input = {
      recommended: route([leg("342", "A")]),
      alternatives: [route([leg("370", "A")]), route([leg("30-3", "A")])],
    } as unknown as TransitRouteResult;
    const out = annotateServiceStatus(input, HOURS, NIGHT);
    expect(out.recommended.legs[0].lineName).toBe("342");
    expect(out.alternatives.map((a) => a.legs[0].lineName)).toEqual(["370", "30-3"]);
  });
});
