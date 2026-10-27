import { describe, expect, it, vi } from "vitest";
import ahyeon from "../../__tests__/fixtures/odsay-e70/ahyeon-gwanghwamun.json";
import ahyeonSubway from "../../__tests__/fixtures/odsay-e70/ahyeon-gwanghwamun-subway.json";
import { normalizeOdsayRoutes, type OdsayResponse } from "../../providers/odsay";
import type { KakaoLocalDocument } from "../../providers/kakao-local";
import type { CarRouteBriefing, Coord, TransitLeg, TransitRoute } from "../../types";
import { getJourney, type JourneyDeps } from "../assemble";

const FROM: Coord = { lat: 37.5596, lng: 126.9637 }; // 충정로 부근(공공 지점)
const TO: Coord = { lat: 37.5759, lng: 126.9769 }; // 광화문 북쪽(공공 지점)

const all = normalizeOdsayRoutes(ahyeon as unknown as OdsayResponse, { includeStops: true })!;
const subwayOnly = normalizeOdsayRoutes(ahyeonSubway as unknown as OdsayResponse, { includeStops: true, keyPrefix: "s" })!;

const vehicles = (r: TransitRoute) => r.legs.filter((l) => l.mode !== "walk");
const boardStopOf = (r: TransitRoute) => vehicles(r)[0].stops![0];
/** 아현(2호선) 승차 경로 — 표본 후보 안에 있고 1순위(애오개 5호선 승차)가 아니다. */
const ahyeonRoute = all.find((r) => vehicles(r)[0].fromName === "아현")!;
const AHYEON = { name: "아현역", coord: { lat: boardStopOf(ahyeonRoute).lat, lng: boardStopOf(ahyeonRoute).lng }, line: "수도권2호선" };

function briefing(minutes: number, fare: number): CarRouteBriefing {
  return { distanceMeters: minutes * 500, durationSeconds: minutes * 60, taxiFare: fare, tollFare: 0, guides: [], provider: "tmap" };
}

function deps(over: Partial<JourneyDeps> = {}) {
  const car = vi.fn(async (o: Coord, d: Coord) => briefing(Math.round((Math.abs(o.lat - d.lat) + Math.abs(o.lng - d.lng)) * 10000), 7800));
  const base: JourneyDeps = {
    candidates: vi.fn(async (p) => ({ ranked: p.modeAxis ? subwayOnly : all })),
    car,
    exits: vi.fn(async () => []),
    stands: vi.fn(async () => []),
  };
  return { ...base, ...over };
}
const okReserve = () => vi.fn((_cost: number) => "ok" as const);

function exitDoc(id: string, name: string, lat: number, lng: number): KakaoLocalDocument {
  return {
    id, place_name: name, category_name: "교통,수송 > 지하철,전철 > 지하철출구", category_group_code: "SW8",
    phone: "", address_name: "", road_address_name: "", x: String(lng), y: String(lat), place_url: "", distance: "",
  };
}

/** 합성 경로: 앞 도보 → 탈것 → 뒤 도보. 하차 정류 좌표·노선을 정한다. */
function synthRoute(key: string, opts: { mode: "subway" | "bus"; line: string; from: string; to: string; toCoord: Coord }): TransitRoute {
  const leg: TransitLeg = {
    mode: opts.mode, lineName: opts.line, fromName: opts.from, toName: opts.to, minutes: 10, stationCount: 4,
    stops: [
      { name: opts.from, lat: 37.56, lng: 126.95 },
      { name: opts.to, lat: opts.toCoord.lat, lng: opts.toCoord.lng },
    ],
  };
  return {
    summary: { totalMinutes: 20, fare: 1550, transfers: 0, walkMinutes: 10, departName: opts.from, arriveName: opts.to },
    legs: [{ mode: "walk", minutes: 4, toName: opts.from }, leg, { mode: "walk", minutes: 6 }],
    routeKey: key,
  };
}

const GWANGHWAMUN: Coord = { lat: 37.5716, lng: 126.9764 };

describe("getJourney — 승차역 지정(A)", () => {
  it("지정 역이 1순위가 아니면 변형 둘: 지정 역 경로가 먼저, 추천은 그 경로가 타는 곳 앞까지 택시", async () => {
    const d = deps();
    const reserve = okReserve();
    const out = await getJourney({ from: FROM, to: TO, board: AHYEON }, d, reserve);
    if (out.kind !== "ok") throw new Error(out.kind);
    const [designated, recommended] = out.result.variants;
    expect(out.result.variants).toHaveLength(2);
    expect(designated.kind).toBe("designated");
    expect(vehicles(designated.transit)[0].fromName).toBe("아현");
    expect(recommended.kind).toBe("recommended");
    expect(vehicles(recommended.transit)[0].fromName).toBe(vehicles(all[0])[0].fromName);
    // 판정 12: 택시 앞 구간 목적지 = 그 변형의 첫 탈것 승차 정류.
    expect(recommended.boardStation?.name).toBe(vehicles(all[0])[0].fromName);
    expect(designated.taxiIn).toBeDefined();
    expect(designated.egress).toBeUndefined();
    // D3: 승차 쪽만 잘렸다 — 첫 leg가 탈것이고 하차 쪽 도보는 남는다.
    expect(designated.transit.legs[0].mode).not.toBe("walk");
    expect(out.result.designatedMissing).toBeUndefined();
    // 예약 = 실제 호출 수(택시 앞 서로 다른 승차 정류 둘).
    expect(reserve).toHaveBeenCalledWith(2);
    expect(d.car).toHaveBeenCalledTimes(2);
  });

  it("지정 역 경로가 곧 추천이면 변형 하나(판정 13)", async () => {
    const top = boardStopOf(all[0]);
    const out = await getJourney(
      { from: FROM, to: TO, board: { name: `${top.name}역`, coord: { lat: top.lat, lng: top.lng } } },
      deps(),
      okReserve(),
    );
    if (out.kind !== "ok") throw new Error(out.kind);
    expect(out.result.variants.map((v) => v.kind)).toEqual(["designated"]);
  });

  it("못 찾으면 지하철만 후보에서 한 번 더 보고, 그래도 없으면 사실 한 줄 + 추천(판정 14)", async () => {
    const d = deps();
    const out = await getJourney(
      { from: FROM, to: TO, board: { name: "충정로역", coord: { lat: 37.5597, lng: 126.9636 } } },
      d,
      okReserve(),
    );
    if (out.kind !== "ok") throw new Error(out.kind);
    expect(d.candidates).toHaveBeenCalledTimes(2);
    expect(vi.mocked(d.candidates).mock.calls[1][0].modeAxis).toBe("subwayOnly");
    expect(out.result.designatedMissing).toEqual({ side: "board" });
    expect(out.result.variants.map((v) => v.kind)).toEqual(["recommended"]);
  });

  it("지하철만 후보에서 찾은 지정 역 경로가 추천과 같은 탈것이면 변형 하나(routeKey 접두가 달라도)", async () => {
    const synth = (key: string) =>
      synthRoute(key, { mode: "subway", line: "수도권 2호선", from: "아현", to: "시청", toCoord: { lat: 37.5657, lng: 126.9769 } });
    const busFirst = synthRoute("p0", { mode: "bus", line: "601", from: "아현", to: "시청", toCoord: { lat: 37.5657, lng: 126.9769 } });
    // 전체 후보 1순위는 버스(지정 역 불일치), 지하철만 후보의 같은 지하철 경로가 지정 역 경로다 — 추천(p0 버스)과는 다르다.
    const d1 = deps({ candidates: vi.fn(async (p) => ({ ranked: p.modeAxis ? [synth("s0")] : [busFirst] })) });
    const a = { name: "아현역", coord: { lat: 37.56, lng: 126.95 } };
    const two = await getJourney({ from: FROM, to: TO, board: a }, d1, okReserve());
    if (two.kind !== "ok") throw new Error(two.kind);
    expect(two.result.variants.map((v) => [v.kind, v.transit.routeKey])).toEqual([["designated", "s0"], ["recommended", "p0"]]);
    // 전체 후보 1순위가 같은 지하철 경로(p0)인데 지정 역 술어를 통과 못 해(정류 좌표 없음 등) 지하철만 후보에서 찾았다면
    // 탈것 구성이 같아 한 변형으로 접힌다.
    const noStops = { ...synth("p0"), legs: synth("p0").legs.map((l) => ({ ...l, stops: l.mode === "walk" ? undefined : [] })) };
    const d2 = deps({ candidates: vi.fn(async (p) => ({ ranked: p.modeAxis ? [synth("s0")] : [noStops] })) });
    const one = await getJourney({ from: FROM, to: TO, board: a }, d2, okReserve());
    // 접힌 변형은 지정 역 경로 쪽이 남는다(정류 좌표가 있는 쪽).
    if (one.kind !== "ok") throw new Error(one.kind);
    expect(one.result.variants.map((v) => [v.kind, v.transit.routeKey])).toEqual([["designated", "s0"]]);
  });

  it("예약이 거절되면 Tmap을 한 번도 부르지 않는다", async () => {
    const d = deps();
    const out = await getJourney({ from: FROM, to: TO, board: AHYEON }, d, () => "rateLimited");
    expect(out).toEqual({ kind: "rateLimited" });
    expect(d.car).not.toHaveBeenCalled();
    const exhausted = await getJourney({ from: FROM, to: TO, board: AHYEON }, deps(), () => "budgetExhausted");
    expect(exhausted).toEqual({ kind: "budgetExhausted" });
  });

  it("택시 앞 구간이 실패하면 여정 전체가 실패한다(throw → 502)", async () => {
    const d = deps({ car: vi.fn(async () => { throw new Error("Tmap 실패"); }) });
    await expect(getJourney({ from: FROM, to: TO, board: AHYEON }, d, okReserve())).rejects.toThrow();
  });

  it("대중교통 경로 없음은 변형 0(경로 없음)", async () => {
    const out = await getJourney({ from: FROM, to: TO, board: AHYEON }, deps({ candidates: vi.fn(async () => null) }), okReserve());
    expect(out).toEqual({ kind: "ok", result: { variants: [] } });
  });
});

describe("getJourney — 하차역 지정(B)", () => {
  const ALIGHT = { name: "광화문역", coord: GWANGHWAMUN };
  const route = synthRoute("p0", { mode: "subway", line: "수도권 5호선", from: "충정로", to: "광화문", toCoord: GWANGHWAMUN });
  const exitDocs = [
    exitDoc("1", "광화문역 1번출구", 37.5718, 126.9772),
    exitDoc("2", "광화문역 2번출구", 37.5722, 126.9768),
    exitDoc("3", "광화문역 3번출구", 37.5703, 126.9768),
  ];

  it("승차 쪽은 자르지 않고 하차 쪽만 자르며, 출구 중 택시 시간 최단이 [0]", async () => {
    const d = deps({ candidates: vi.fn(async () => ({ ranked: [route] })), exits: vi.fn(async () => exitDocs) });
    const reserve = okReserve();
    const out = await getJourney({ from: FROM, to: TO, alight: ALIGHT }, d, reserve);
    if (out.kind !== "ok") throw new Error(out.kind);
    const [v] = out.result.variants;
    expect(v.taxiIn).toBeUndefined();
    expect(v.transit.legs[0].mode).toBe("walk");
    expect(v.transit.legs.at(-1)!.mode).toBe("subway");
    expect(v.egress?.options).toHaveLength(1);
    expect(v.egress?.options[0].kind).toBe("exit");
    // 가짜 car는 좌표 차이에 비례 — TO(북쪽)에 가장 가까운 2번 출구가 가장 빠르다.
    expect(v.egress?.options[0].label).toBe("2");
    expect(v.egress?.options[0].placeName).toBe("광화문역 2번출구");
    expect(reserve).toHaveBeenCalledWith(3);
    expect(d.car).toHaveBeenCalledTimes(3);
    expect(vi.mocked(d.exits).mock.calls[0][0]).toBe("광화문");
    expect(v.totals.minutes).toBe(route.summary.totalMinutes - 6 + Math.round(v.egress!.options[0].taxiOut.durationSeconds / 60));
  });

  it("택시 승강장이 있으면 마지막 선택지", async () => {
    const stand = { ...exitDoc("s", "광화문역택시승강장", 37.5712, 126.9765), category_name: "교통,수송 > 교통시설 > 택시" };
    const d = deps({ candidates: vi.fn(async () => ({ ranked: [route] })), exits: vi.fn(async () => exitDocs), stands: vi.fn(async () => [stand]) });
    const out = await getJourney({ from: FROM, to: TO, alight: ALIGHT }, d, okReserve());
    if (out.kind !== "ok") throw new Error(out.kind);
    expect(out.result.variants[0].egress?.options.map((o) => o.kind)).toEqual(["exit", "stand"]);
  });

  it("출구 후보 일부 실패는 그 후보만 빼고, 전부 실패하면 throw(복구 호출 없음)", async () => {
    const failing = (bad: (c: Coord) => boolean) =>
      vi.fn(async (o: Coord) => {
        if (bad(o)) throw new Error("Tmap 실패");
        return briefing(10, 9000);
      });
    const partial = deps({ candidates: vi.fn(async () => ({ ranked: [route] })), exits: vi.fn(async () => exitDocs), car: failing((o) => o.lat === 37.5718) });
    const out = await getJourney({ from: FROM, to: TO, alight: ALIGHT }, partial, okReserve());
    if (out.kind !== "ok") throw new Error(out.kind);
    expect(out.result.variants[0].egress?.options[0].label).not.toBe("1");
    const allFail = deps({ candidates: vi.fn(async () => ({ ranked: [route] })), exits: vi.fn(async () => exitDocs), car: failing(() => true) });
    await expect(getJourney({ from: FROM, to: TO, alight: ALIGHT }, allFail, okReserve())).rejects.toThrow(/전부 실패/);
    expect(allFail.car).toHaveBeenCalledTimes(3);
  });

  it("카카오 출구 조회 실패는 lookupFailed + 내린 역 후보(3-state: 없음 ≠ 실패)", async () => {
    const d = deps({ candidates: vi.fn(async () => ({ ranked: [route] })), exits: vi.fn(async () => { throw new Error("카카오"); }) });
    const out = await getJourney({ from: FROM, to: TO, alight: ALIGHT }, d, okReserve());
    if (out.kind !== "ok") throw new Error(out.kind);
    const egress = out.result.variants[0].egress!;
    expect(egress.lookupFailed).toBe(true);
    expect(egress.options.map((o) => o.kind)).toEqual(["none"]);
    expect(egress.options[0].coord).toEqual(GWANGHWAMUN);
  });

  it("출구 조회가 실패하면 승강장이 있어도 후보는 내린 역 하나다(§4.5-7 — 문장과 출발 자리가 어긋나지 않게)", async () => {
    const stand = { ...exitDoc("s", "광화문역택시승강장", 37.5712, 126.9765), category_name: "교통,수송 > 교통시설 > 택시" };
    const d = deps({
      candidates: vi.fn(async () => ({ ranked: [route] })),
      exits: vi.fn(async () => { throw new Error("카카오"); }),
      stands: vi.fn(async () => [stand]),
    });
    const reserve = okReserve();
    const out = await getJourney({ from: FROM, to: TO, alight: ALIGHT }, d, reserve);
    if (out.kind !== "ok") throw new Error(out.kind);
    expect(out.result.variants[0].egress).toEqual({ lookupFailed: true, options: [expect.objectContaining({ kind: "none", coord: GWANGHWAMUN })] });
    expect(reserve).toHaveBeenCalledWith(1);
  });

  it("괄호 부기가 있는 하차역은 괄호를 뗀 이름으로 출구를 찾는다(「출구 없음」 위장 방지)", async () => {
    const bracket = synthRoute("p0", { mode: "subway", line: "수도권 4호선", from: "사당", to: "총신대입구(이수)", toCoord: { lat: 37.4865, lng: 126.9817 } });
    const docs = [exitDoc("1", "총신대입구역 1번출구", 37.4868, 126.9819)];
    const d = deps({ candidates: vi.fn(async () => ({ ranked: [bracket] })), exits: vi.fn(async () => docs) });
    const out = await getJourney(
      { from: FROM, to: TO, alight: { name: "총신대입구역", coord: { lat: 37.4865, lng: 126.9817 } } }, d, okReserve());
    if (out.kind !== "ok") throw new Error(out.kind);
    expect(vi.mocked(d.exits).mock.calls[0][0]).toBe("총신대입구");
    expect(out.result.variants[0].egress?.options[0]).toMatchObject({ kind: "exit", label: "1" });
  });

  it("출구 0건(조회 성공)은 lookupFailed 없이 내린 역 후보", async () => {
    const d = deps({ candidates: vi.fn(async () => ({ ranked: [route] })) });
    const out = await getJourney({ from: FROM, to: TO, alight: ALIGHT }, d, okReserve());
    if (out.kind !== "ok") throw new Error(out.kind);
    expect(out.result.variants[0].egress).toEqual({ options: [expect.objectContaining({ kind: "none" })] });
  });

  it("버스로 끝나는 변형은 출구를 찾지 않고 내린 정류장에서 택시", async () => {
    const bus = synthRoute("p0", { mode: "bus", line: "470", from: "충정로", to: "광화문", toCoord: GWANGHWAMUN });
    const d = deps({ candidates: vi.fn(async () => ({ ranked: [bus] })), exits: vi.fn(async () => exitDocs) });
    const out = await getJourney({ from: FROM, to: TO, alight: ALIGHT }, d, okReserve());
    if (out.kind !== "ok") throw new Error(out.kind);
    expect(d.exits).not.toHaveBeenCalled();
    expect(out.result.designatedMissing).toEqual({ side: "alight" });
    expect(out.result.variants[0].egress?.options.map((o) => o.kind)).toEqual(["none"]);
  });

  it("같은 역·다른 하차 노선 두 변형은 출구가 섞이지 않는다(그룹 = 하차역 × 노선)", async () => {
    const SEOUL: Coord = { lat: 37.5547, lng: 126.9707 };
    const line1 = synthRoute("p0", { mode: "subway", line: "수도권 1호선", from: "시청", to: "서울역", toCoord: SEOUL });
    const line4 = synthRoute("p1", { mode: "subway", line: "수도권 4호선", from: "회현", to: "서울역", toCoord: { lat: 37.5531, lng: 126.9726 } });
    const docs = [
      exitDoc("a", "서울역 1호선 1번출구", 37.5551, 126.9714),
      exitDoc("b", "서울역 4호선 9번출구", 37.5528, 126.9731),
    ];
    // 지정 역(1호선 힌트)은 ranked[1]로 맞고, 추천(ranked[0])은 4호선 경로다.
    const d = deps({ candidates: vi.fn(async () => ({ ranked: [line4, line1] })), exits: vi.fn(async () => docs) });
    const reserve = okReserve();
    const out = await getJourney({ from: FROM, to: TO, alight: { name: "서울역", coord: SEOUL, line: "수도권1호선" } }, d, reserve);
    if (out.kind !== "ok") throw new Error(out.kind);
    const labels = out.result.variants.map((v) => v.egress!.options.map((o) => o.lineName));
    expect(labels).toEqual([["1호선"], ["4호선"]]);
    expect(d.exits).toHaveBeenCalledTimes(1); // 원시 검색은 하차역 이름 키 단위로 한 번
    expect(reserve).toHaveBeenCalledWith(2);
    expect(d.car).toHaveBeenCalledTimes(2);
  });
});

describe("getJourney — 승차·하차 둘 다 지정", () => {
  it("택시 앞 + 잘린 대중교통 + 택시 뒤(기본 출구) 합계, 예약 = 실제 Tmap 호출 수", async () => {
    const route = synthRoute("p0", { mode: "subway", line: "수도권 5호선", from: "충정로", to: "광화문", toCoord: GWANGHWAMUN });
    const board = { name: "충정로역", coord: { lat: 37.56, lng: 126.95 } };
    const exits = [exitDoc("1", "광화문역 1번출구", 37.5718, 126.9772), exitDoc("2", "광화문역 2번출구", 37.5722, 126.9768)];
    const d = deps({ candidates: vi.fn(async () => ({ ranked: [route] })), exits: vi.fn(async () => exits) });
    const reserve = okReserve();
    const out = await getJourney({ from: FROM, to: TO, board, alight: { name: "광화문역", coord: GWANGHWAMUN } }, d, reserve);
    if (out.kind !== "ok") throw new Error(out.kind);
    const [v] = out.result.variants;
    expect(v.transit.legs.map((l) => l.mode)).toEqual(["subway"]);
    const min = (s: number) => Math.round(s / 60);
    expect(v.totals.minutes).toBe(min(v.taxiIn!.durationSeconds) + 10 + min(v.egress!.options[0].taxiOut.durationSeconds));
    expect(v.totals.taxiFare).toBe(v.taxiIn!.taxiFare + v.egress!.options[0].taxiOut.taxiFare);
    expect(reserve).toHaveBeenCalledWith(3);
    expect(d.car).toHaveBeenCalledTimes(3);
  });

  it("둘 다 맞는 경로가 없으면 사실 줄의 쪽(both·alight)을 정하고 세 번째 변형은 없다", async () => {
    const route = synthRoute("p0", { mode: "subway", line: "수도권 5호선", from: "충정로", to: "광화문", toCoord: GWANGHWAMUN });
    const board = { name: "충정로역", coord: { lat: 37.56, lng: 126.95 } };
    const elsewhere = { name: "종각역", coord: { lat: 37.5702, lng: 126.983 } };
    const out = await getJourney(
      { from: FROM, to: TO, board, alight: elsewhere },
      deps({ candidates: vi.fn(async () => ({ ranked: [route] })) }), okReserve());
    if (out.kind !== "ok") throw new Error(out.kind);
    // 승차만 맞는 후보가 있다 → 하차 쪽을 못 찾았다.
    expect(out.result.designatedMissing).toEqual({ side: "alight" });
    expect(out.result.variants.map((v) => v.kind)).toEqual(["recommended"]);
  });
});

describe("getJourney — 버스 정류장 지정(E70-e)", () => {
  const BOARD_STOP = { lat: 37.56, lng: 126.95 }; // synthRoute의 승차 정류 좌표
  const stopIn = (name: string, coord: Coord = BOARD_STOP) => ({ name, coord, kind: "stop" as const });
  const busFrom = (key: string, from: string) =>
    synthRoute(key, { mode: "bus", line: "601", from, to: "광화문", toCoord: GWANGHWAMUN });
  const subwayFrom = (key: string, from: string) =>
    synthRoute(key, { mode: "subway", line: "수도권 2호선", from, to: "시청", toCoord: { lat: 37.5657, lng: 126.9769 } });
  const axes = (d: ReturnType<typeof deps>) => vi.mocked(d.candidates).mock.calls.map((c) => c[0].modeAxis);

  it("stops 없으면 버스만을 부르지 않는다(종전: 전체 + 지하철만)", async () => {
    const d = deps({ candidates: vi.fn(async () => ({ ranked: [busFrom("p0", "강남역12번출구")] })) });
    const out = await getJourney({ from: FROM, to: TO, board: { name: "강남역", coord: BOARD_STOP } }, d, okReserve());
    expect(axes(d)).toEqual([undefined, "subwayOnly"]);
    // 약한 맞음은 옵트인이 있어야만 지정 경로가 된다 — 없으면 종전처럼 못 찾은 것으로 남는다.
    if (out.kind !== "ok") throw new Error(out.kind);
    expect(out.result.variants[0].kind).toBe("recommended");
    expect(out.result.designatedMissing).toEqual({ side: "board" });
  });

  it("정류장 쪽이 하나라도 있으면 지하철만을 부르지 않는다(하차 정류장만 · 승차 역 + 하차 정류장)", async () => {
    const sub = subwayFrom("p0", "아현");
    const alightStop = stopIn("광화문", GWANGHWAMUN);
    const d1 = deps({ candidates: vi.fn(async () => ({ ranked: [sub] })) });
    await getJourney({ from: FROM, to: TO, alight: alightStop, stops: true }, d1, okReserve());
    expect(axes(d1)).toEqual([undefined, "busOnly"]);
    const d2 = deps({ candidates: vi.fn(async () => ({ ranked: [sub] })) });
    await getJourney({ from: FROM, to: TO, board: { name: "아현역", coord: BOARD_STOP }, alight: alightStop, stops: true }, d2, okReserve());
    expect(axes(d2)).toEqual([undefined, "busOnly"]);
  });

  it("정류장만 지정하면 호출 2회(전체 + 버스만), 지하철만은 부르지 않는다", async () => {
    const d = deps({
      candidates: vi.fn(async (p) => ({ ranked: p.modeAxis === "busOnly" ? [busFrom("b0", "시청.교육청")] : [subwayFrom("p0", "아현")] })),
    });
    const out = await getJourney({ from: FROM, to: TO, board: stopIn("시청.덕수궁"), stops: true }, d, okReserve());
    if (out.kind !== "ok") throw new Error(out.kind);
    expect(axes(d)).toEqual([undefined, "busOnly"]);
    expect(out.result.variants[0].kind).toBe("designated");
    expect(out.result.variants[0].transit.routeKey).toBe("b0");
  });

  it("전체 후보에서 정류장이 강으로 맞으면 추가 조회 없이 멈춘다", async () => {
    const d = deps({ candidates: vi.fn(async () => ({ ranked: [busFrom("p0", "시청.교육청")] })) });
    await getJourney({ from: FROM, to: TO, board: stopIn("시청.덕수궁"), stops: true }, d, okReserve());
    expect(d.candidates).toHaveBeenCalledTimes(1);
  });

  it("역만 지정하고 못 찾으면 호출 3회(전체 → 지하철만 → 버스만), 상한 3", async () => {
    const d = deps({ candidates: vi.fn(async () => ({ ranked: [subwayFrom("p0", "아현")] })) });
    const out = await getJourney({ from: FROM, to: TO, board: { name: "강남역", coord: BOARD_STOP }, stops: true }, d, okReserve());
    if (out.kind !== "ok") throw new Error(out.kind);
    expect(axes(d)).toEqual([undefined, "subwayOnly", "busOnly"]);
    expect(out.result.designatedMissing).toEqual({ side: "board" });
  });

  it("강이 약보다 앞선다 — 전체 후보의 약한 버스 맞음보다 지하철만 후보의 강한 맞음이 이긴다", async () => {
    const weak = busFrom("p0", "강남역12번출구");
    const strong = subwayFrom("s0", "강남");
    const d = deps({ candidates: vi.fn(async (p) => ({ ranked: p.modeAxis === "subwayOnly" ? [strong] : [weak] })) });
    const out = await getJourney({ from: FROM, to: TO, board: { name: "강남역", coord: BOARD_STOP }, stops: true }, d, okReserve());
    if (out.kind !== "ok") throw new Error(out.kind);
    expect(out.result.variants[0]).toMatchObject({ kind: "designated" });
    expect(out.result.variants[0].transit.routeKey).toBe("s0");
    expect(axes(d)).toEqual([undefined, "subwayOnly"]);
  });

  it("지하철 경로가 어느 풀에도 없으면 이미 받은 풀의 약한 맞음을 받는다(버스만 호출 없음)", async () => {
    const weak = busFrom("p0", "강남역12번출구");
    const d = deps({ candidates: vi.fn(async () => ({ ranked: [weak] })) });
    const out = await getJourney({ from: FROM, to: TO, board: { name: "강남역", coord: BOARD_STOP }, stops: true }, d, okReserve());
    if (out.kind !== "ok") throw new Error(out.kind);
    expect(axes(d)).toEqual([undefined, "subwayOnly"]);
    expect(out.result.variants[0]).toMatchObject({ kind: "designated" });
    expect(out.result.variants[0].transit.routeKey).toBe("p0");
  });

  it("버스만 후보에서 약한 맞음을 찾는다", async () => {
    const d = deps({
      candidates: vi.fn(async (p) => ({ ranked: p.modeAxis === "busOnly" ? [busFrom("b0", "강남역.삼성전자")] : [subwayFrom("p0", "아현")] })),
    });
    const out = await getJourney({ from: FROM, to: TO, board: { name: "강남역", coord: BOARD_STOP }, stops: true }, d, okReserve());
    if (out.kind !== "ok") throw new Error(out.kind);
    expect(out.result.variants[0].transit.routeKey).toBe("b0");
  });

  it("정류장에서 끝나는 지정 변형은 카카오 출구·승강장을 부르지 않고 egress none이다", async () => {
    const route = busFrom("p0", "충정로");
    const alightStop = { name: "광화문", coord: GWANGHWAMUN, kind: "stop" as const };
    const exits = vi.fn(async () => [exitDoc("1", "광화문역 1번출구", 37.5718, 126.9772)]);
    const stands = vi.fn(async () => []);
    const d = deps({ candidates: vi.fn(async () => ({ ranked: [route] })), exits, stands });
    const reserve = okReserve();
    const out = await getJourney({ from: FROM, to: TO, alight: alightStop, stops: true }, d, reserve);
    if (out.kind !== "ok") throw new Error(out.kind);
    expect(out.result.variants[0].kind).toBe("designated");
    expect(exits).not.toHaveBeenCalled();
    expect(stands).not.toHaveBeenCalled();
    expect(out.result.variants[0].egress?.options.map((o) => o.kind)).toEqual(["none"]);
    // Tmap 비용 = 택시 뒤 1(택시 앞 없음)
    expect(reserve).toHaveBeenCalledWith(1);
  });
});
