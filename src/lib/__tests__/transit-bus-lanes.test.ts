import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildTransitGuideRoute,
  laneForItem,
  legWithLane,
  SEOUL_WAIT_ROUTE_SET_MAX,
  type TrackItem,
} from "../transit-guide";
import { transitDisplayLeg } from "../transit-display";
import { candidateDescLine, waitContextLine } from "../transit-guide-text";
import { transitBoardLegNames, transitLegUsesEnglish } from "../transit-leg-english";
import { trackTargetUrl } from "../../hooks/useTransitGuide";
import type { TransitLeg, TransitRoute } from "../types";

/**
 * 버스 노선 집합의 웹 소비자(E76, spec `2026-10-31-e76-bus-lane-set-design.md` §4·§5).
 * ODsay 실응답 fixture(`odsay-e70/ahyeon-gwanghwamun.json`)의 소공동주민센터 → 광화문역2번출구 구간을 본뜬다.
 */
const BOARD = { name: "소공동주민센터", lat: 37.564, lng: 126.979, arsId: "02001", localId: "100000118", cityCode: "1000" };
const ALIGHT = { name: "광화문역2번출구.KT광화문지사", lat: 37.5716, lng: 126.9769, localId: "100000200", cityCode: "1000" };

function busLeg(over: Partial<TransitLeg> = {}): TransitLeg {
  return {
    mode: "bus",
    lineName: "1711",
    fromName: BOARD.name,
    toName: ALIGHT.name,
    stationCount: 3,
    minutes: 8,
    serviceRouteId: "100100185",
    serviceCityCode: 1000,
    stops: [BOARD, { name: "경복궁", lat: 37.576, lng: 126.975 }, ALIGHT],
    lanes: [
      { lineName: "1711", serviceRouteId: "100100185", serviceCityCode: 1000 },
      { lineName: "7016", serviceRouteId: "100100447", serviceCityCode: 1000 },
      { lineName: "708", serviceRouteId: "123000011", serviceCityCode: 1000 },
    ],
    ...over,
  };
}

function route(leg: TransitLeg): TransitRoute {
  return {
    summary: { totalMinutes: 15, fare: 1500, transfers: 0, walkMinutes: 2 },
    legs: [{ mode: "walk", minutes: 2, toName: BOARD.name }, leg],
    routeKey: "p0",
  } as TransitRoute;
}

const item = (over: Partial<TrackItem>): TrackItem => ({
  vehicleId: "v1",
  direction: "",
  message: "3분후[1번째 전]",
  remainingStops: 1,
  destinationName: null,
  express: false,
  arrivalCode: null,
  ...over,
});

describe("안내 leg의 노선 집합", () => {
  it("서울버스 leg는 TOPIS ID를 키로 집합을 싣는다(첫 항목 = 추천 노선)", () => {
    const guide = buildTransitGuideRoute(route(busLeg()))!;
    expect(guide.legs[0].trackMode).toBe("seoulBus");
    expect(guide.legs[0].lanes).toEqual([
      { lineName: "1711", key: "100100185" },
      { lineName: "7016", key: "100100447" },
      { lineName: "708", key: "123000011" },
    ]);
  });

  it("키 없는 노선은 빼고, 하나만 남거나 첫 항목이 leg 자신이 아니면 집합 없음", () => {
    const fewer = busLeg({
      lanes: [
        { lineName: "1711", serviceRouteId: "100100185", serviceCityCode: 1000 },
        { lineName: "7016" },
      ],
    });
    expect(buildTransitGuideRoute(route(fewer))!.legs[0].lanes).toBeUndefined();
    const swapped = busLeg({ lanes: [...busLeg().lanes!].reverse() });
    expect(buildTransitGuideRoute(route(swapped))!.legs[0].lanes).toBeUndefined();
  });

  it("대기 폴 상한을 넘는 집합은 뒤쪽을 잘라 서버 400을 피한다(첫 항목은 남는다)", () => {
    const many = busLeg({
      lanes: Array.from({ length: SEOUL_WAIT_ROUTE_SET_MAX + 3 }, (_, i) => ({
        lineName: i === 0 ? "1711" : `R${i}`,
        serviceRouteId: i === 0 ? "100100185" : `9000${i}`,
        serviceCityCode: 1000,
      })),
    });
    const lanes = buildTransitGuideRoute(route(many))!.legs[0].lanes!;
    expect(lanes).toHaveLength(SEOUL_WAIT_ROUTE_SET_MAX);
    expect(lanes[0].key).toBe("100100185");
  });

  it("지방버스(TAGO)는 이번 판의 대상이 아니다(고른 노선을 잠글 수단이 없다)", () => {
    const tago = busLeg({ serviceCityCode: 2000, stops: [{ ...BOARD, cityCode: "2000" }, { ...ALIGHT, cityCode: "2000" }] });
    const guide = buildTransitGuideRoute(route(tago))!;
    expect(guide.legs[0].trackMode).toBe("tagoBus");
    expect(guide.legs[0].lanes).toBeUndefined();
  });

  it("laneForItem은 집합 폴 항목의 route로 노선을 찾고, route가 없으면 null", () => {
    const leg = buildTransitGuideRoute(route(busLeg()))!.legs[0];
    expect(laneForItem(leg, item({ route: "100100447" }))?.lineName).toBe("7016");
    expect(laneForItem(leg, item({ route: "999" }))).toBeNull();
    expect(laneForItem(leg, item({}))).toBeNull();
  });

  it("legWithLane은 노선 이름·영문·TOPIS ID만 바꾸고 정류소·집합은 그대로 둔다", () => {
    const leg = buildTransitGuideRoute(route(busLeg()))!.legs[0];
    const chosen = legWithLane({ ...leg, lineNameEn: "1711" }, leg.lanes![1]);
    expect(chosen.lineName).toBe("7016");
    expect(chosen.routeId).toBe("100100447");
    expect("lineNameEn" in chosen).toBe(false); // 고른 노선의 영문이 없으면 앞 노선 영문이 남지 않는다
    expect(chosen.boardStop).toBe(leg.boardStop);
    expect(chosen.alightStop).toBe(leg.alightStop);
    expect(chosen.lanes).toBe(leg.lanes);
  });
});

describe("폴 URL — 대기 국면만 집합", () => {
  const leg = buildTransitGuideRoute(route(busLeg()))!.legs[0];

  it("waiting은 routeIds, boarding·riding은 고른 노선 하나", () => {
    expect(trackTargetUrl(leg, "waiting", null, null, "ko")).toBe(
      "/api/transit/track?mode=seoulBus&phase=wait&arsId=02001&routeIds=100100185,100100447,123000011&lang=ko",
    );
    const chosen = legWithLane(leg, leg.lanes![1]);
    expect(trackTargetUrl(chosen, "boarding", null, null, "ko")).toBe(
      "/api/transit/track?mode=seoulBus&phase=wait&arsId=02001&routeId=100100447&lang=ko",
    );
    expect(trackTargetUrl(chosen, "riding", null, null, "ko")).toBe(
      "/api/transit/track?mode=seoulBus&phase=ride&routeId=100100447&boardId=100000118&alightId=100000200&lang=ko",
    );
  });

  it("집합을 고른 뒤 탑승 변경으로 돌아온 대기도 집합 전부다(순서 불변)", () => {
    const chosen = legWithLane(leg, leg.lanes![2]);
    expect(trackTargetUrl(chosen, "waiting", null, null, "en")).toBe(
      "/api/transit/track?mode=seoulBus&phase=wait&arsId=02001&routeIds=100100185,100100447,123000011&lang=en",
    );
  });
});

describe("문장 — 대기 문맥·후보 줄", () => {
  const leg = buildTransitGuideRoute(route(busLeg()))!.legs[0];

  it("대기 문맥은 집합 전부를 쉼표로 잇는다", () => {
    const line = waitContextLine(false, transitDisplayLeg(leg, null), true);
    expect(line.parts).toEqual([
      { key: "waitContextWalkBus", args: ["2", BOARD.name, "1711, 7016, 708"] },
    ]);
  });

  it("고른 노선으로 바뀐 leg도 대기 문맥은 집합 전부다(탑승 변경 뒤)", () => {
    const chosen = legWithLane(leg, leg.lanes![1]);
    const line = waitContextLine(false, transitDisplayLeg(chosen, null), true);
    expect(line.parts).toEqual([{ key: "waitContextWalkBus", args: ["2", BOARD.name, "1711, 7016, 708"] }]);
  });

  it("영문은 모든 노선의 영문이 있을 때만이고, 하나라도 없으면 그 줄은 한국어", () => {
    const enLeg = { ...leg, lanes: leg.lanes!.map((l) => ({ ...l, lineNameEn: l.lineName })) };
    expect(transitDisplayLeg(enLeg, null).laneList).toEqual({ ko: "1711, 7016, 708", en: "1711, 7016, 708" });
    expect(transitDisplayLeg(leg, null).laneList).toEqual({ ko: "1711, 7016, 708" });
  });

  it("후보 줄은 노선 번호가 맨 앞이다(「7016, 3분후[1번째 전]」)", () => {
    const display = transitDisplayLeg(leg, null);
    const line = candidateDescLine(
      false,
      display,
      {
        message: { ko: "3분후[1번째 전]" },
        direction: { ko: "" },
        destination: null,
        currentLocation: null,
        express: false,
        remainingStops: 1,
        selectable: true,
      },
      { express: null, departedMinutes: null, route: { ko: "7016" } },
    );
    expect(line.parts).toEqual([{ text: "7016" }, { text: "3분후[1번째 전]" }]);
  });
});

describe("경로 브리핑 탑승 줄", () => {
  it("집합이 있으면 노선 번호 전부를 쉼표로 이은 한 조각", () => {
    expect(transitBoardLegNames(busLeg(), false).line).toBe("1711, 7016, 708");
  });

  it("집합이 없으면 그 노선 하나(종전)", () => {
    expect(transitBoardLegNames(busLeg({ lanes: undefined }), false).line).toBe("1711");
  });

  it("영어 줄은 모든 노선의 영문이 있어야 한다", () => {
    const en = busLeg({
      lineNameEn: "1711",
      fromNameEn: "Sogong-dong Community Center",
      toNameEn: "Gwanghwamun Stn. Exit 2",
      lanes: busLeg().lanes!.map((l) => ({ ...l, lineNameEn: l.lineName })),
    });
    expect(transitLegUsesEnglish(en, true)).toBe(true);
    expect(transitBoardLegNames(en, true).line).toBe("1711, 7016, 708");
    const partial = { ...en, lanes: [en.lanes![0], { lineName: "7016" }] };
    expect(transitLegUsesEnglish(partial, true)).toBe(false);
    expect(transitBoardLegNames(partial, true).line).toBe("1711, 7016");
  });
});


describe("iOS 노선 교체는 리듀서가 입력을 받는 상태에서만 실행한다", () => {
  const model = readFileSync("ios/Gildongmu/Directions/TransitGuideModel.swift", "utf8");

  it("선택은 waiting이면서 추적 가능할 때만 경로를 바꾼다", () => {
    const body = model.slice(model.indexOf("    func board(item:"), model.indexOf("    /// 선택 차량 설명"));
    const gate = "guard let state, state.phase == .waiting, state.signal != .untrackable else { return }";
    expect(body).toContain(gate);
    expect(body.indexOf(gate)).toBeLessThan(body.indexOf("transitLegWithLane("));
    expect(body.indexOf("replaceCurrentLeg(leg)")).toBeLessThan(body.indexOf("dispatch(.board(lock))"));
  });

  it("변경 취소도 waiting일 때만 원래 노선으로 복귀한다", () => {
    const body = model.slice(model.indexOf("    func cancelChangeBoarding()"), model.indexOf('    /// "이미 탔어요"'));
    const gate = "guard let state, state.phase == .waiting, let previous = state.previousLock else { return }";
    expect(body).toContain(gate);
    expect(body.indexOf(gate)).toBeLessThan(body.indexOf("replaceCurrentLeg("));
    expect(body.indexOf("replaceCurrentLeg(")).toBeLessThan(body.indexOf("dispatch(.restoreBoarding)"));
  });
});

describe("웹 노선 교체의 상태 경계", () => {
  const hook = readFileSync("src/hooks/useTransitGuide.ts", "utf8");
  it("오래된 후보 선택은 노선을 바꾸기 전에 거절한다", () => {
    const body = hook.slice(hook.indexOf("  const boardCandidate ="), hook.indexOf("  const confirmBoarded ="));
    const guard = 'if (state?.phase !== "waiting" || state.signal === "untrackable") return;';
    expect(body).toContain(guard);
    expect(body.indexOf(guard)).toBeLessThan(body.indexOf("selectLane(lane.key)"));
  });
  it("대기가 끝난 뒤 취소 콜백은 원래 노선을 덮어쓰지 않는다", () => {
    const body = hook.slice(hook.indexOf("  const cancelChangeBoarding ="), hook.indexOf("  const boardAlready ="));
    const guard = 'if (stateRef.current?.phase !== "waiting") return;';
    expect(body).toContain(guard);
    expect(body.indexOf(guard)).toBeLessThan(body.indexOf("selectLane(previous.routeId)"));
  });
});
