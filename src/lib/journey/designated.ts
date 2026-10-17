import type { JourneyStationInput, TransitLeg, TransitLegStop, TransitRoute } from "../types";
import { isSameStation } from "./station-identity";

/** 도보가 아닌 첫 leg. */
export function firstVehicle(route: TransitRoute): TransitLeg | undefined {
  return route.legs.find((l) => l.mode !== "walk");
}

/** 도보가 아닌 마지막 leg. */
export function lastVehicle(route: TransitRoute): TransitLeg | undefined {
  for (let i = route.legs.length - 1; i >= 0; i--) {
    if (route.legs[i].mode !== "walk") return route.legs[i];
  }
  return undefined;
}

/** 탈것의 승차(`stops[0]`)·하차(`stops[length-1]`) 정류. ODsay startX/Y·endX/Y와 같은 좌표이고 `includeStops`가 필요하다. */
export function legEndStop(leg: TransitLeg, end: "board" | "alight"): TransitLegStop | undefined {
  const stops = leg.stops;
  if (!stops || stops.length === 0) return undefined;
  return end === "board" ? stops[0] : stops[stops.length - 1];
}

function matches(leg: TransitLeg | undefined, end: "board" | "alight", input: JourneyStationInput): boolean {
  if (!leg || leg.mode !== "subway") return false;
  const stop = legEndStop(leg, end);
  if (!stop) return false;
  return isSameStation({ name: stop.name, lat: stop.lat, lng: stop.lng, lineName: leg.lineName }, input);
}

/** 첫 탈것이 지하철·철도이고 승차 정류가 역 A와 같은 역인가. */
export function matchesBoard(route: TransitRoute, a: JourneyStationInput): boolean {
  return matches(firstVehicle(route), "board", a);
}

/** 마지막 탈것이 지하철·철도이고 하차 정류가 역 B와 같은 역인가. */
export function matchesAlight(route: TransitRoute, b: JourneyStationInput): boolean {
  return matches(lastVehicle(route), "alight", b);
}

type Designation = { board?: JourneyStationInput; alight?: JourneyStationInput };

/**
 * 지정한 쪽을 전부 만족하는 첫 경로(spec §3.2). 아무 쪽도 지정하지 않으면 null — `designated` 자리는
 * 이 술어를 통과한 경로로만 채운다.
 */
export function findDesignated(ranked: TransitRoute[], d: Designation): TransitRoute | null {
  if (!d.board && !d.alight) return null;
  for (const r of ranked) {
    if (d.board && !matchesBoard(r, d.board)) continue;
    if (d.alight && !matchesAlight(r, d.alight)) continue;
    return r;
  }
  return null;
}

/**
 * 지정 역 경로를 못 찾았을 때 어느 쪽이 걸림돌인가(spec §3.2). `pools`는 전체 후보와 지하철만 후보 등
 * 이미 조회한 후보 묶음들이다. 한쪽만 지정했으면 그쪽. 둘 다 지정했으면 승차만 맞는 후보가 있으면 `"alight"`,
 * 하차만 맞는 후보가 있으면 `"board"`, 둘 다 있거나 어느 쪽도 없으면 `"both"`. 지정이 없으면 호출 오류지만
 * 던지지 않고 `"both"`를 준다.
 */
export function missingSide(pools: TransitRoute[][], d: Designation): "board" | "alight" | "both" {
  if (d.board && !d.alight) return "board";
  if (d.alight && !d.board) return "alight";
  if (!d.board || !d.alight) return "both";
  let boardOnly = false;
  let alightOnly = false;
  for (const r of pools.flat()) {
    const b = matchesBoard(r, d.board);
    const a = matchesAlight(r, d.alight);
    if (b && !a) boardOnly = true;
    if (a && !b) alightOnly = true;
  }
  if (boardOnly && !alightOnly) return "alight";
  if (alightOnly && !boardOnly) return "board";
  return "both";
}
