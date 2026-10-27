import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeOdsayRoutes } from "../../providers/odsay";
import type { JourneyStationInput, TransitLeg, TransitRoute } from "../../types";
import {
  findDesignated,
  firstVehicle,
  lastVehicle,
  legEndStop,
  matchesAlight,
  matchesBoard,
  missingSide,
  sideMatch,
} from "../designated";

function loadRoutes(name: string): TransitRoute[] {
  const json = JSON.parse(readFileSync(`src/lib/__tests__/fixtures/odsay-e70/${name}.json`, "utf8"));
  return normalizeOdsayRoutes(json, { includeStops: true }) ?? [];
}

const ahyeon: JourneyStationInput = { name: "아현역", coord: { lat: 37.557388, lng: 126.956132 } };
const gwanghwamun: JourneyStationInput = { name: "광화문역", coord: { lat: 37.571665, lng: 126.976502 } };
const aeogae: JourneyStationInput = { name: "애오개역", coord: { lat: 37.5536, lng: 126.956759 } };
// 광화문 5호선과 무관한 역(어느 경로에도 없다)
const nowhere: JourneyStationInput = { name: "수원역", coord: { lat: 37.2656, lng: 127.0001 } };

function walk(minutes: number): TransitLeg {
  return { mode: "walk", minutes };
}
function bus(): TransitLeg {
  return { mode: "bus", lineName: "271", fromName: "아현역", toName: "광화문역", minutes: 12, stops: [
    { name: "아현역", lat: 37.557294, lng: 126.954922 },
    { name: "광화문역", lat: 37.570224, lng: 126.976521 },
  ] };
}

describe("firstVehicle · lastVehicle · legEndStop", () => {
  it("도보가 아닌 첫·마지막 leg를 준다", () => {
    const r = loadRoutes("ahyeon-gwanghwamun").find((x) => x.routeKey === "p3")!;
    expect(firstVehicle(r)?.fromName).toBe("아현");
    expect(lastVehicle(r)?.toName).toBe("광화문");
    expect(legEndStop(firstVehicle(r)!, "board")?.name).toBe("아현");
    expect(legEndStop(lastVehicle(r)!, "alight")?.name).toBe("광화문");
  });
  it("탈것이 없으면 undefined, stops가 없으면 undefined", () => {
    const onlyWalk = { summary: { totalMinutes: 3, fare: 0, transfers: 0, walkMinutes: 3 }, legs: [walk(3)], routeKey: "w" } as TransitRoute;
    expect(firstVehicle(onlyWalk)).toBeUndefined();
    expect(lastVehicle(onlyWalk)).toBeUndefined();
    expect(legEndStop({ mode: "subway", minutes: 1 }, "board")).toBeUndefined();
  });
});

describe("지정 역 판정 (아현 → 광화문 표본)", () => {
  const ranked = loadRoutes("ahyeon-gwanghwamun");

  it("1순위(애오개 5호선 승차)는 아현 지정을 통과하지 못하고 아현 2호선 승차 경로가 찾아진다", () => {
    expect(firstVehicle(ranked[0])?.fromName).toBe("애오개");
    expect(matchesBoard(ranked[0], ahyeon)).toBe(false);
    const found = findDesignated(ranked, { board: ahyeon })!;
    expect(found).not.toBeNull();
    expect(found.routeKey).not.toBe(ranked[0].routeKey);
    expect(firstVehicle(found)?.fromName).toBe("아현");
    expect(firstVehicle(found)?.mode).toBe("subway");
  });

  it("승하차 둘 다 지정하면 둘 다 맞는 경로만(아현 2호선 → 광화문 5호선)", () => {
    const found = findDesignated(ranked, { board: ahyeon, alight: gwanghwamun })!;
    expect(found.routeKey).toBe("p3");
    expect(matchesAlight(found, gwanghwamun)).toBe(true);
  });

  it("애오개 승차 + 광화문 하차는 1순위 경로", () => {
    expect(findDesignated(ranked, { board: aeogae, alight: gwanghwamun })?.routeKey).toBe("p0");
  });

  it("버스로 시작하는 경로는 승차 지정에서 탈락한다(이름·좌표가 같아도)", () => {
    const busFirst = ranked.find((r) => r.routeKey === "p1")!; // 아현역에서 271 버스
    expect(firstVehicle(busFirst)?.mode).toBe("bus");
    expect(matchesBoard(busFirst, ahyeon)).toBe(false);
  });

  it("버스로 끝나는 경로는 하차 지정에서 탈락한다", () => {
    const busLast = ranked.find((r) => r.routeKey === "p7")!; // 아현 2호선 → 충정로 → 버스 370
    expect(lastVehicle(busLast)?.mode).toBe("bus");
    expect(matchesAlight(busLast, gwanghwamun)).toBe(false);
    expect(matchesBoard(busLast, ahyeon)).toBe(true);
  });

  it("지정이 없으면 null, 맞는 경로가 없어도 null", () => {
    expect(findDesignated(ranked, {})).toBeNull();
    expect(findDesignated(ranked, { board: nowhere })).toBeNull();
  });

  it("stops가 없는 경로(includeStops 없음)는 통과하지 못한다", () => {
    const json = JSON.parse(readFileSync("src/lib/__tests__/fixtures/odsay-e70/ahyeon-gwanghwamun.json", "utf8"));
    const noStops = normalizeOdsayRoutes(json)!;
    expect(findDesignated(noStops, { board: ahyeon })).toBeNull();
  });

  it("지하철만 후보에서도 같은 판정이 통한다", () => {
    const subwayOnly = loadRoutes("ahyeon-gwanghwamun-subway");
    expect(findDesignated(subwayOnly, { board: ahyeon })?.routeKey).toBe("p1");
  });
});

describe("missingSide", () => {
  const ranked = loadRoutes("ahyeon-gwanghwamun");
  const subwayOnly = loadRoutes("ahyeon-gwanghwamun-subway");

  it("한쪽만 지정하면 그쪽", () => {
    expect(missingSide([ranked], { board: nowhere }, false)).toBe("board");
    expect(missingSide([ranked], { alight: nowhere }, false)).toBe("alight");
  });

  it("승차만 맞는 후보가 있으면 alight", () => {
    expect(missingSide([ranked, subwayOnly], { board: ahyeon, alight: nowhere }, false)).toBe("alight");
  });

  it("하차만 맞는 후보가 있으면 board", () => {
    expect(missingSide([ranked, subwayOnly], { board: nowhere, alight: gwanghwamun }, false)).toBe("board");
  });

  it("어느 쪽도 없으면 both", () => {
    expect(missingSide([ranked], { board: nowhere, alight: nowhere }, false)).toBe("both");
  });

  it("승차만 맞는 후보와 하차만 맞는 후보가 따로 있으면 both", () => {
    // 아현 승차 + 시청 하차를 요구: 아현 승차 경로(p3 등)는 마지막 탈것이 시청 하차가 아니고,
    // 시청 하차 경로(p17, 서울역 1호선 → 시청)는 첫 탈것이 버스라 아현 지하철 승차가 아니다.
    const seoul: JourneyStationInput = { name: "시청역", coord: { lat: 37.565366, lng: 126.97714 } };
    const p17 = ranked.find((r) => r.routeKey === "p17")!;
    expect(matchesAlight(p17, seoul)).toBe(true);
    expect(missingSide([ranked], { board: ahyeon, alight: seoul }, false)).toBe("both");
  });

  it("합성 버스 경로로도 동작한다", () => {
    const r = { summary: { totalMinutes: 15, fare: 0, transfers: 0, walkMinutes: 3 }, legs: [walk(1), bus(), walk(2)], routeKey: "b" } as TransitRoute;
    expect(matchesBoard(r, ahyeon)).toBe(false);
  });
});

describe("정류장 입력·약한 맞음(E70-e)", () => {
  const here = { lat: 37.56, lng: 126.95 };
  const busRoute = (key: string, from: string, to: string): TransitRoute => ({
    summary: { totalMinutes: 20, fare: 1500, transfers: 0, walkMinutes: 4 },
    legs: [{ mode: "bus", lineName: "601", fromName: from, toName: to, minutes: 12, stops: [
      { name: from, lat: here.lat, lng: here.lng },
      { name: to, lat: 37.57, lng: 126.97 },
    ] }],
    routeKey: key,
  });
  const stopIn = (name: string, c = here): JourneyStationInput => ({ name, coord: c, kind: "stop" });

  it("정류장 입력은 버스 leg만 강으로 맞고 지하철 leg는 맞지 않는다", () => {
    const r = busRoute("b0", "시청.교육청", "광화문");
    expect(sideMatch(r, "board", stopIn("시청.덕수궁"), false)).toBe("strong");
    expect(sideMatch(r, "board", stopIn("시청앞", { lat: here.lat + 0.001, lng: here.lng }), false)).toBeNull();
    const subway = loadRoutes("ahyeon-gwanghwamun").find((x) => x.routeKey === "p3")!;
    const s0 = legEndStop(firstVehicle(subway)!, "board")!;
    expect(sideMatch(subway, "board", stopIn(s0.name, { lat: s0.lat, lng: s0.lng }), false)).toBeNull();
  });

  it("역 입력은 버스 leg를 stops일 때만, 약으로 맞춘다", () => {
    const r = busRoute("b0", "강남역12번출구", "광화문");
    const station: JourneyStationInput = { name: "강남역", coord: here };
    expect(sideMatch(r, "board", station, false)).toBeNull();
    expect(sideMatch(r, "board", station, true)).toBe("weak");
    expect(matchesBoard(r, station)).toBe(false);
  });

  it("findDesignated: allowWeak 없이는 약한 맞음을 받지 않는다", () => {
    const r = busRoute("b0", "강남역12번출구", "광화문");
    const d = { board: { name: "강남역", coord: here } };
    expect(findDesignated([r], d)).toBeNull();
    expect(findDesignated([r], d, { allowWeak: true })).toBe(r);
  });

  it("missingSide: stops일 때 약한 맞음도 맞는 쪽으로 센다", () => {
    const r = busRoute("b0", "강남역12번출구", "광화문");
    const d = { board: { name: "강남역", coord: here }, alight: { name: "수원역", coord: { lat: 37.2656, lng: 127.0001 } } };
    expect(missingSide([[r]], d, false)).toBe("both");
    expect(missingSide([[r]], d, true)).toBe("alight");
  });
});
