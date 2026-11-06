import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  lanesWithRoutes,
  legFromStop,
  reboardStopPickable,
  rideLineUnconfirmed,
  type TransitGuideLeg,
  type TransitLock,
} from "../transit-guide";
import { trackTargetUrl } from "../../hooks/useTransitGuide";

/**
 * E76 후속(spec `2026-11-07-e76-followup-design.md`) — 서울버스 정류장 재기준(ⓔ)·번호 없는 문장 술어(ⓕ)·지방버스 집합 폴(ⓓ).
 * 정류장은 ODsay fixture `odsay-e70/ahyeon-gwanghwamun.json`의 아현역 → 광화문역 구간을 본뜬다.
 */
const STOPS = [
  { name: "아현역", lat: 37.557, lng: 126.956, arsId: "14068", localId: "113000477" },
  { name: "충정로역", nameEn: "Chungjeongno Station", lat: 37.56, lng: 126.963, arsId: "13045", localId: "112000430" },
  { name: "서대문역사거리", lat: 37.565, lng: 126.966, arsId: "13047", localId: "101000304" },
  { name: "광화문역", lat: 37.571, lng: 126.976, arsId: "01009", localId: "100000384" },
];

function seoulLeg(over: Partial<TransitGuideLeg> = {}): TransitGuideLeg {
  return {
    mode: "bus",
    trackMode: "seoulBus",
    lineName: "271",
    routeId: "100100047",
    boardName: "아현역",
    alightName: "광화문역",
    boardStop: STOPS[0],
    alightStop: STOPS[3],
    viaStops: STOPS,
    stationCount: 3,
    walkBeforeMinutes: 4,
    lanes: [
      { lineName: "271", key: "100100047" },
      { lineName: "273", key: "100100049" },
    ],
    ...over,
  } as TransitGuideLeg;
}

const approx: TransitLock = { mode: "seoulBus", routeId: "100100047", vehicleId: "" } as TransitLock;
const identified: TransitLock = { mode: "seoulBus", routeId: "100100047", vehicleId: "v1" } as TransitLock;

describe("정류장 재기준 leg(ⓔ §2.2)", () => {
  it("고른 정류장부터의 leg — 승차·경유·정거장 수가 그 정류장 기준, 선행 도보·집합은 지우고 미조회 표식", () => {
    const next = legFromStop(seoulLeg(), 1)!;
    expect(next.boardStop).toEqual(STOPS[1]);
    expect(next.boardName).toBe("충정로역");
    expect(next.boardNameEn).toBe("Chungjeongno Station");
    expect(next.viaStops).toEqual(STOPS.slice(1));
    expect(next.stationCount).toBe(2);
    expect(next.walkBeforeMinutes).toBeNull();
    expect(next.lanes).toBeUndefined();
    expect(next.lanesPending).toBe(true);
    // 노선·하차는 그대로.
    expect([next.lineName, next.routeId, next.alightStop]).toEqual(["271", "100100047", STOPS[3]]);
  });

  it("영문 없는 정류장을 고르면 옛 승차 영문이 남지 않는다", () => {
    const next = legFromStop(seoulLeg({ boardNameEn: "Ahyeon Station" } as Partial<TransitGuideLeg>), 2)!;
    expect(next.boardNameEn).toBeUndefined();
  });

  it("정거장 수를 모르면 계속 모른다(null 유지)", () => {
    expect(legFromStop(seoulLeg({ stationCount: null }), 1)!.stationCount).toBeNull();
  });

  it("첫 정류장·하차 정류장·범위 밖은 바꾸지 않는다(null)", () => {
    for (const i of [0, 3, 4, -1, 1.5]) expect(legFromStop(seoulLeg(), i)).toBeNull();
  });

  it("재기준 leg의 폴은 새 정류장 기준(대기 arsId·승차 localId)", () => {
    const next = legFromStop(seoulLeg(), 1)!;
    expect(trackTargetUrl(next, "waiting", null, null, "ko")).toBe(
      "/api/transit/track?mode=seoulBus&phase=wait&arsId=13045&routeId=100100047&lang=ko",
    );
    expect(trackTargetUrl(next, "riding", null, null, "ko")).toBe(
      "/api/transit/track?mode=seoulBus&phase=ride&routeId=100100047&boardId=112000430&alightId=100000384&lang=ko",
    );
  });
});

describe("재기준 집합 조립(ⓔ §2.4)", () => {
  it("첫 항목은 언제나 지금 노선, 서버 노선이 뒤 — 중복·빈 값은 뺀다", () => {
    const leg = legFromStop(seoulLeg(), 1)!;
    expect(
      lanesWithRoutes(leg, [
        { routeId: "100100033", lineName: "160", lineNameEn: "160" },
        { routeId: "100100047", lineName: "271" },
        { routeId: "", lineName: "x" },
        { routeId: "100100033", lineName: "160" },
      ]),
    ).toEqual([
      { lineName: "271", key: "100100047" },
      { lineName: "160", lineNameEn: "160", key: "100100033" },
    ]);
  });

  it("서버 노선이 없으면 집합 없음(null — 단일 노선 확정)", () => {
    expect(lanesWithRoutes(seoulLeg(), [])).toBeNull();
  });

  it("상한 12", () => {
    const routes = Array.from({ length: 20 }, (_, i) => ({ routeId: `R${i}`, lineName: `${i}` }));
    expect(lanesWithRoutes(seoulLeg(), routes)).toHaveLength(12);
  });
});

describe("정류장을 묻는가(ⓔ §2.1)", () => {
  it("서울버스는 경유 정류장 전부에 arsId·localId가 있어야 묻는다", () => {
    expect(reboardStopPickable(seoulLeg())).toBe(true);
    const missing = seoulLeg({ viaStops: [STOPS[0], { ...STOPS[1], arsId: undefined }, STOPS[3]] } as Partial<TransitGuideLeg>);
    expect(reboardStopPickable(missing)).toBe(false);
    expect(reboardStopPickable(seoulLeg({ viaStops: [] }))).toBe(false);
  });

  it("지하철은 종전대로 묻고 지방버스는 묻지 않는다", () => {
    expect(reboardStopPickable(seoulLeg({ mode: "subway", trackMode: "subway" } as Partial<TransitGuideLeg>))).toBe(true);
    expect(reboardStopPickable(seoulLeg({ trackMode: "tagoBus" }))).toBe(false);
  });
});

describe("승차 중 노선 모름(ⓕ·ⓓ §3)", () => {
  it("근사 잠금 ∧ 노선 둘 이상이면 모른다", () => {
    expect(rideLineUnconfirmed(seoulLeg(), approx)).toBe(true);
  });

  it("차량을 골라 잠갔으면 안다(번호 유지)", () => {
    expect(rideLineUnconfirmed(seoulLeg(), identified)).toBe(false);
  });

  it("노선이 하나뿐이면 안다(번호 유지)", () => {
    expect(rideLineUnconfirmed(seoulLeg({ lanes: undefined }), approx)).toBe(false);
  });

  it("재기준 집합 미조회·실패도 모른다(리뷰 M1 — 단일 노선 확정으로 읽지 않는다)", () => {
    expect(rideLineUnconfirmed(legFromStop(seoulLeg(), 1)!, approx)).toBe(true);
  });

  it("잠금이 없거나 지하철이면 해당 없음", () => {
    expect(rideLineUnconfirmed(seoulLeg(), null)).toBe(false);
    expect(rideLineUnconfirmed(seoulLeg({ mode: "subway" }), approx)).toBe(false);
  });
});

describe("지방버스 집합 폴(ⓓ §4)", () => {
  const tago = seoulLeg({
    trackMode: "tagoBus",
    lineName: "102",
    routeId: undefined,
    lanes: [
      { lineName: "102", key: "102" },
      { lineName: "105", key: "105" },
    ],
  } as Partial<TransitGuideLeg>);
  const resolved = { nodeId: "DJB1", cityCode: "25" };

  it("대기는 routeNos, 승차 중은 추천 노선 하나(리뷰 H3)", () => {
    expect(trackTargetUrl(tago, "waiting", resolved, null, "ko")).toBe(
      "/api/transit/track?mode=tagoBus&phase=track&cityCode=25&nodeId=DJB1&routeNos=102,105&lang=ko",
    );
    expect(trackTargetUrl(tago, "riding", resolved, null, "ko")).toBe(
      "/api/transit/track?mode=tagoBus&phase=track&cityCode=25&nodeId=DJB1&routeNo=102&lang=ko",
    );
  });
});

describe("웹 재기준 배선(소스 가드)", () => {
  const hook = readFileSync("src/hooks/useTransitGuide.ts", "utf8");

  it("재기준은 보관 후보를 비우고 그 뒤에 대기로 돌린다(리뷰 H1)", () => {
    const body = hook.slice(hook.indexOf("  const reseatSeoulBus ="), hook.indexOf("  /**\n   * 사용자가 고른 현재 역으로"));
    expect(body.indexOf("replaceCurrentLeg(next)")).toBeLessThan(body.indexOf("retainedRef.current.clear()"));
    expect(body.indexOf("retainedRef.current.clear()")).toBeLessThan(body.indexOf("changeBoarding()", body.indexOf("retainedRef")));
  });

  it("집합 응답은 세션·세대·대기·같은 leg일 때만 반영한다", () => {
    const body = hook.slice(hook.indexOf("  const fetchReanchorLanes ="), hook.indexOf("  const reseatSeoulBus ="));
    for (const guard of [
      "sessionRef.current !== session",
      "reanchorRef.current?.gen !== gen",
      'stateRef.current?.phase !== "waiting"',
      "currentLeg() !== leg",
    ]) {
      expect(body.indexOf(guard)).toBeGreaterThan(-1);
      expect(body.indexOf(guard)).toBeLessThan(body.indexOf("replaceCurrentLeg(filled)"));
    }
  });

  it("취소는 재기준 원본을 되돌린 뒤 노선을 맞춘다", () => {
    const body = hook.slice(hook.indexOf("  const cancelChangeBoarding ="), hook.indexOf("  const boardAlready ="));
    expect(body.indexOf("replaceCurrentLeg(reanchor.snapshot)")).toBeLessThan(body.indexOf("selectLane(previous.routeId)"));
  });

  it("대기를 벗어나면 재기준 원본을 버린다(코드 리뷰 MAJOR — 국면 기반, dispatch 한 자리)", () => {
    const body = hook.slice(hook.indexOf("  const dispatch = useCallback("), hook.indexOf("  const dispatch = useCallback(") + 4000);
    expect(body).toContain('if (next.phase !== "waiting") reanchorRef.current = null;');
  });

  it("확인 0 ∧ 미확인 있음은 노선 모름을 남긴다", () => {
    const body = hook.slice(hook.indexOf("  const fetchReanchorLanes ="), hook.indexOf("  const reseatSeoulBus ="));
    const guard = "if (!lanes && (body.unverified ?? 0) > 0) return;";
    expect(body).toContain(guard);
    expect(body.indexOf(guard)).toBeLessThan(body.indexOf("delete filled.lanesPending"));
  });

  it("지방버스 집합 폴은 대기 국면에만(리뷰 H3)", () => {
    const fn = hook.slice(hook.indexOf("export function trackTargetUrl("), hook.indexOf("export function useTransitGuide("));
    expect(fn).toContain('if (phase === "waiting" && leg.lanes && leg.lanes.length >= 2) {\n      const nos');
  });

  it("문맥 문장은 잠금을 받는다(기본값 없는 인자)", () => {
    expect(hook).not.toMatch(/contextPiece\(leg\)/);
  });
});

describe("iOS 재기준 배선(소스 가드 — 앱 타깃엔 테스트 레인이 없다)", () => {
  const model = readFileSync("ios/Gildongmu/Directions/TransitGuideModel.swift", "utf8");

  it("dispatch가 대기를 벗어나면 재기준 원본을 버린다(코드 리뷰 MAJOR)", () => {
    expect(model).toContain("if result.state.phase != .waiting { reanchor = nil }");
  });

  it("재기준은 보관 후보를 비운 뒤 대기로 돌린다(리뷰 H1)", () => {
    const body = model.slice(model.indexOf("func reseatSeoulBus"), model.indexOf("func reseatSeoulBus") + 2500);
    const clear = body.indexOf("retained = [:]");
    expect(body.indexOf("replaceCurrentLeg(next)")).toBeLessThan(clear);
    expect(clear).toBeLessThan(body.indexOf("changeBoarding()", clear));
  });

  it("지방버스 집합 폴은 대기 국면에만(리뷰 H3)", () => {
    expect(model).toContain("routeNos: phase == .waiting && (leg.lanes?.count ?? 0) >= 2 ? leg.lanes?.map(\\.key) : nil,");
  });

  it("집합 응답은 세션·세대·대기·같은 구간·같은 정류장일 때만, 확인 0 ∧ 미확인은 노선 모름 유지", () => {
    const body = model.slice(model.indexOf("func fetchReanchorLanes"), model.indexOf("func fetchReanchorLanes") + 3000);
    for (const s of [
      "guard sessionToken == session, let reanchor, reanchor.gen == gen,",
      "let state, state.phase == .waiting, state.legIndex == reanchor.legIndex,",
      "let current = currentLeg, current.lanesPending, current.boardStop == leg.boardStop,",
      "if lanes == nil && (env.unverified ?? 0) > 0 { return }",
    ]) {
      expect(body).toContain(s);
    }
  });
});
