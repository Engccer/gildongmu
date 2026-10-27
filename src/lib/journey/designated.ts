import type { JourneyStationInput, TransitLeg, TransitLegStop, TransitRoute } from "../types";
import { busStopNamesStation, isSameBusStop, isSameStation } from "./station-identity";

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

/** 한쪽 맞음의 등급: 강(역↔지하철 leg · 정류장↔버스 leg), 약(역↔버스 leg, `stops`일 때만). */
export type SideGrade = "strong" | "weak" | null;

/** 지정 입력 하나가 경로의 끝 탈것과 맞는 등급. 정류장 입력은 버스 leg만, 역 입력은 지하철 leg(강)·버스 leg(약). */
export function sideMatch(route: TransitRoute, end: "board" | "alight", input: JourneyStationInput, stops: boolean): SideGrade {
  const leg = end === "board" ? firstVehicle(route) : lastVehicle(route);
  if (!leg) return null;
  const stop = legEndStop(leg, end);
  if (!stop) return null;
  if (input.kind === "stop") {
    return leg.mode === "bus" && isSameBusStop(stop, input) ? "strong" : null;
  }
  if (leg.mode === "subway") {
    return isSameStation({ name: stop.name, lat: stop.lat, lng: stop.lng, lineName: leg.lineName }, input) ? "strong" : null;
  }
  if (stops && leg.mode === "bus") return busStopNamesStation(stop, input) ? "weak" : null;
  return null;
}

/** 승차 쪽이 강 맞음인가(역 입력 ↔ 지하철·철도 leg, 정류장 입력 ↔ 버스 leg). */
export function matchesBoard(route: TransitRoute, a: JourneyStationInput): boolean {
  return sideMatch(route, "board", a, false) === "strong";
}

/** 하차 쪽이 강 맞음인가(역 입력 ↔ 지하철·철도 leg, 정류장 입력 ↔ 버스 leg). */
export function matchesAlight(route: TransitRoute, b: JourneyStationInput): boolean {
  return sideMatch(route, "alight", b, false) === "strong";
}

type Designation = { board?: JourneyStationInput; alight?: JourneyStationInput };

/**
 * 지정한 쪽을 전부 만족하는 첫 경로(spec §3.2). 아무 쪽도 지정하지 않으면 null — `designated` 자리는
 * 이 술어를 통과한 경로로만 채운다. `allowWeak`이면 약한 맞음(역 입력 ↔ 버스 leg)도 받는다(E70-e `stops`).
 * 강이 약보다 앞서는 순서는 풀을 고르는 `assemble.ts`가 정한다.
 */
export function findDesignated(ranked: TransitRoute[], d: Designation, opts: { allowWeak?: boolean } = {}): TransitRoute | null {
  if (!d.board && !d.alight) return null;
  const allowWeak = opts.allowWeak ?? false;
  const ok = (r: TransitRoute, end: "board" | "alight", input: JourneyStationInput) => {
    const g = sideMatch(r, end, input, allowWeak);
    return g === "strong" || (allowWeak && g === "weak");
  };
  for (const r of ranked) {
    if (d.board && !ok(r, "board", d.board)) continue;
    if (d.alight && !ok(r, "alight", d.alight)) continue;
    return r;
  }
  return null;
}

/**
 * 지정 역 경로를 못 찾았을 때 어느 쪽이 걸림돌인가(spec §3.2). `pools`는 전체 후보와 지하철만 후보 등
 * 이미 조회한 후보 묶음들이다. 맞음은 강·약 구분 없이 본다(약은 `stops`일 때만). 한쪽만 지정했으면 그쪽. 둘 다 지정했으면 승차만 맞는 후보가 있으면 `"alight"`,
 * 하차만 맞는 후보가 있으면 `"board"`, 둘 다 있거나 어느 쪽도 없으면 `"both"`. 지정이 없으면 호출 오류지만
 * 던지지 않고 `"both"`를 준다.
 */
export function missingSide(pools: TransitRoute[][], d: Designation, stops: boolean): "board" | "alight" | "both" {
  if (d.board && !d.alight) return "board";
  if (d.alight && !d.board) return "alight";
  if (!d.board || !d.alight) return "both";
  let boardOnly = false;
  let alightOnly = false;
  for (const r of pools.flat()) {
    const b = sideMatch(r, "board", d.board, stops) !== null;
    const a = sideMatch(r, "alight", d.alight, stops) !== null;
    if (b && !a) boardOnly = true;
    if (a && !b) alightOnly = true;
  }
  if (boardOnly && !alightOnly) return "alight";
  if (alightOnly && !boardOnly) return "board";
  return "both";
}
