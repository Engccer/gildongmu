import { describe, expect, it } from "vitest";
import { annotateServiceStatus, busLanesOf, normalizeOdsayRoutes } from "../odsay";
import type { ServiceHours } from "../bus-service-hours";
import type { TransitLeg, TransitRoute } from "../../types";
import AHYEON from "../../__tests__/fixtures/odsay-e70/ahyeon-gwanghwamun.json";
import SINCHON from "../../__tests__/fixtures/odsay-e70/sinchon-seoulstn.json";

/**
 * 버스 노선 집합(E76, spec `2026-10-31-e76-bus-lane-set-design.md` §2). fixture는 ODsay 실응답이다
 * (2026-10-27 저장, `odsay-e70`).
 */
function busLegs(data: unknown, includeLanes: boolean): TransitLeg[] {
  const routes = normalizeOdsayRoutes(data as never, { includeStops: true, includeLanes }) ?? [];
  return routes.flatMap((r) => r.legs).filter((l) => l.mode === "bus");
}

function legFrom(legs: TransitLeg[], from: string, to: string): TransitLeg {
  const leg = legs.find((l) => l.fromName === from && l.toName === to);
  if (!leg) throw new Error(`${from} → ${to} leg 없음`);
  return leg;
}

describe("TransitLeg.lanes — ODsay lane[] 투영", () => {
  it("lane이 여럿이면 첫 항목이 leg 자신이고 나머지는 ODsay 순서다", () => {
    const leg = legFrom(busLegs(AHYEON, true), "소공동주민센터", "광화문역2번출구.KT광화문지사");
    expect(leg.lineName).toBe("1711");
    expect(leg.lanes).toEqual([
      { lineName: "1711", serviceRouteId: "100100185", serviceCityCode: 1000 },
      { lineName: "7016", serviceRouteId: "100100447", serviceCityCode: 1000 },
      { lineName: "708", serviceRouteId: "123000011", serviceCityCode: 1000 },
      { lineName: "N51", serviceRouteId: "117000002", serviceCityCode: 1000 },
    ]);
  });

  it("첫 노선 번호가 비면 뒤 노선을 대표 노선으로 승격하지 않는다", () => {
    expect(busLanesOf({ trafficType: 2, lane: [
      { busNo: "" }, { busNo: "7016" }, { busNo: "708" },
    ] } as never, "ko")).toBeNull();
  });

  it("lane이 하나면 키 부재(그 하나는 lineName이 이미 말한다)", () => {
    const leg = legFrom(busLegs(AHYEON, true), "아현초등학교", "광화문역");
    expect(leg.lineName).toBe("160");
    expect("lanes" in leg).toBe(false);
  });

  it("예약 노선은 빠진다(정류소에서 그냥 탈 수 없다)", () => {
    const leg = legFrom(busLegs(SINCHON, true), "신한은행본점", "서울역버스환승센터(6번승강장)");
    const names = leg.lanes?.map((l) => l.lineName);
    expect(names).toEqual(["M5107", "M4108", "M4137", "M4130", "M5121", "M5115"]);
    // 도시 코드가 섞여도(경기 광역버스) 노선마다 자기 값을 싣는다.
    expect(leg.lanes?.[1]).toEqual({ lineName: "M4108", serviceRouteId: "234001245", serviceCityCode: 1230 });
  });

  it("옵트인이 없으면 어느 leg에도 lanes가 없다(미지정 응답 byte-호환)", () => {
    for (const data of [AHYEON, SINCHON]) {
      const plain = normalizeOdsayRoutes(data as never, { includeStops: true }) ?? [];
      expect(JSON.stringify(plain)).not.toContain('"lanes"');
    }
  });

  it("지하철 leg에는 싣지 않는다", () => {
    const routes = normalizeOdsayRoutes(SINCHON as never, { includeStops: true, includeLanes: true }) ?? [];
    for (const leg of routes.flatMap((r) => r.legs).filter((l) => l.mode === "subway")) {
      expect("lanes" in leg).toBe(false);
    }
  });

  it("en 응답은 한국어 번호를 busNoKor에서, 영문 번호를 busNo에서 읽는다", () => {
    const data = {
      result: {
        path: [
          {
            pathType: 2,
            info: { totalTime: 10, payment: 1500, firstStartStationKor: "가", lastEndStationKor: "나" },
            subPath: [
              {
                trafficType: 2,
                sectionTime: 10,
                stationCount: 3,
                startName: "A",
                startNameKor: "가",
                endName: "B",
                endNameKor: "나",
                lane: [
                  { busNo: "Jongno11", busNoKor: "종로11", busLocalBlID: "100900007", busCityCode: 1000 },
                  { busNo: "Jongno09", busNoKor: "종로09", busLocalBlID: "100900003", busCityCode: 1000 },
                  // 한국어 번호가 없는 노선은 빼고 나머지를 지킨다(영문을 한국어 자리에 넣지 않는다)
                  { busNo: "7016", busLocalBlID: "100100447", busCityCode: 1000 },
                ],
              },
            ],
          },
        ],
      },
    };
    const [route] = normalizeOdsayRoutes(data as never, { lang: "en", includeLanes: true }) ?? [];
    expect(route.legs[0].lanes).toEqual([
      { lineName: "종로11", lineNameEn: "Jongno11", serviceRouteId: "100900007", serviceCityCode: 1000 },
      { lineName: "종로09", lineNameEn: "Jongno09", serviceRouteId: "100900003", serviceCityCode: 1000 },
    ]);
  });
});

describe("annotateServiceStatus — 노선 집합의 운행 시간", () => {
  const hours = (first: number, last: number): ServiceHours => ({ firstMinutes: first, lastMinutes: last });
  function route(lanes: TransitLeg["lanes"]): TransitRoute {
    return {
      summary: { totalMinutes: 10, fare: 1500, transfers: 0, walkMinutes: 0 },
      legs: [
        { mode: "bus", lineName: "1711", minutes: 10, serviceRouteId: "A", serviceCityCode: 1000, lanes },
      ],
      routeKey: "p0",
    } as TransitRoute;
  }
  const lanes = [
    { lineName: "1711", serviceRouteId: "A", serviceCityCode: 1000 },
    { lineName: "N51", serviceRouteId: "N", serviceCityCode: 1000 },
    { lineName: "7016", serviceRouteId: "B", serviceCityCode: 1000 },
    { lineName: "708" },
  ];

  it("운행 시간 밖으로 판정된 노선만 빠지고, 판정 불가(시간표 없음)는 남는다", () => {
    const busHours = new Map([
      ["A", hours(240, 1380)],
      ["N", hours(1410, 1680)], // 23:30~04:00 심야
      ["B", hours(240, 1380)],
    ]);
    const [out] = annotateServiceStatus([route(lanes)], busHours, new Map(), 12 * 60);
    expect(out.legs[0].lanes?.map((l) => l.lineName)).toEqual(["1711", "7016", "708"]);
  });

  it("첫 항목(leg 자신)은 운행 밖이어도 남는다 — 그 상태는 leg의 serviceStatus가 말한다", () => {
    const busHours = new Map([["A", hours(240, 600)]]);
    const [out] = annotateServiceStatus([route(lanes)], busHours, new Map(), 12 * 60);
    expect(out.legs[0].serviceStatus).toBe("outside");
    expect(out.legs[0].lanes?.[0].lineName).toBe("1711");
  });

  it("빼고 나서 하나만 남으면 키 부재", () => {
    const busHours = new Map([["N", hours(1410, 1680)]]);
    const [out] = annotateServiceStatus([route(lanes.slice(0, 2))], busHours, new Map(), 12 * 60);
    expect("lanes" in out.legs[0]).toBe(false);
  });
});
