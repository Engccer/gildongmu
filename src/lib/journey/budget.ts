import type { Coord } from "../types";
import { prefilterExits, type ParsedExit, type StandPick } from "./egress";

/** 한 여정 조회가 부를 수 있는 Tmap 호출 상한(spec §4.5 1). */
export const JOURNEY_CALL_CAP = 8;
/** 출구 예선: 그룹당 직선 상위 5개(spec §4.5 5). */
export const JOURNEY_EXITS_PER_GROUP = 5;

export type ExitCand = ParsedExit;
export type Cand = StandPick;

export interface TaxiStart {
  kind: "exit" | "stand" | "none";
  label: string;
  lineName?: string;
  placeName: string;
  coord: Coord;
}

const coordKey = (c: Coord) => `${c.lat.toFixed(4)},${c.lng.toFixed(4)}`;

function uniqueCount(coords: Coord[]): number {
  return new Set(coords.map(coordKey)).size;
}

/**
 * Tmap 택시 호출 계획(순수, spec §4.5). 팬아웃 전에 이번 조회가 부를 호출을 정확히 센다.
 *
 * - 택시 앞 목적지와 택시 뒤 출발 좌표는 각각 좌표 4자리 키로 중복을 제거한다(서로 다른 호출이라 두 집합은 따로 센다).
 * - 그룹 하나 = (하차역, 하차 노선). 그룹의 후보는 예선한 출구(목적지 직선 오름차순) + 승강장(있으면 마지막).
 *   출구도 승강장도 없는 그룹(0건 또는 카카오 실패)은 `fallbackStop`(하차 정류 좌표) 하나 — kind `none`.
 *   승강장이 있으면 출구가 없어도 fallback을 쓰지 않는다.
 * - 합이 `JOURNEY_CALL_CAP`을 넘으면 **출구만** 줄인다: 남은 칸 = 상한 − 택시 앞 수 − (승강장·fallback의 유일 좌표 수).
 *   그룹 [0](기본 변형)이 `ceil(남은/그룹 수)`, 나머지 `floor`, 각 그룹은 `min(그 몫, 5)`개.
 *   몫의 합은 남은 칸을 넘지 않는다. 한 그룹이 몫보다 출구가 적어도 남는 칸을 다른 그룹에 넘기지 않는다(spec 문장 그대로).
 * - 남은 칸이 음수(택시 앞과 고정 후보만으로 상한 초과)면 0으로 자른다 — 변형은 둘이라 실제로는 오지 않는 입력이다.
 *   그 경우 출구가 사라져 후보가 비는 그룹은 `fallbackStop`이 있으면 그것을 쓰고, `cost`는 상한을 넘더라도 정직하게
 *   보고한다(호출부가 예약 거절한다).
 * - `cost` = 유일한 택시 앞 목적지 수 + 유일한 택시 뒤 출발 좌표 수.
 */
export function planTaxiCalls(input: {
  taxiInDests: Coord[];
  groups: Array<{ exits: ExitCand[]; stand: Cand | null; fallbackStop: Coord | null }>;
  to: Coord;
}): { taxiIn: Coord[]; groups: Array<{ starts: TaxiStart[] }>; cost: number } {
  const taxiIn: Coord[] = [];
  const seenIn = new Set<string>();
  for (const c of input.taxiInDests) {
    const k = coordKey(c);
    if (!seenIn.has(k)) {
      seenIn.add(k);
      taxiIn.push(c);
    }
  }

  const fixedCoords: Coord[] = [];
  for (const g of input.groups) {
    if (g.stand) fixedCoords.push(g.stand.coord);
    else if (g.exits.length === 0 && g.fallbackStop) fixedCoords.push(g.fallbackStop);
  }

  const wanted = input.groups.map((g) => Math.min(g.exits.length, JOURNEY_EXITS_PER_GROUP));
  // 예선 상한만 적용한 출구 좌표 수가 예산 안이면 줄이지 않는다.
  const unreduced = taxiIn.length + uniqueCount(fixedCoords) + wanted.reduce((a, b) => a + b, 0);
  const groupCount = input.groups.length;
  const remaining = Math.max(0, JOURNEY_CALL_CAP - taxiIn.length - uniqueCount(fixedCoords));

  const groups = input.groups.map((g, i): { starts: TaxiStart[] } => {
    let take = wanted[i];
    if (unreduced > JOURNEY_CALL_CAP) {
      const share = i === 0 ? Math.ceil(remaining / groupCount) : Math.floor(remaining / groupCount);
      take = Math.min(take, share);
    }
    const starts: TaxiStart[] = prefilterExits(g.exits, input.to, take).map((e) => ({
      kind: "exit",
      label: e.label,
      ...(e.lineName !== undefined ? { lineName: e.lineName } : {}),
      placeName: e.placeName,
      coord: e.coord,
    }));
    if (g.stand) {
      starts.push({ kind: "stand", label: g.stand.label, placeName: g.stand.placeName, coord: g.stand.coord });
    }
    if (starts.length === 0 && g.fallbackStop) {
      starts.push({ kind: "none", label: "", placeName: "", coord: g.fallbackStop });
    }
    return { starts };
  });

  const cost = taxiIn.length + uniqueCount(groups.flatMap((g) => g.starts.map((s) => s.coord)));
  return { taxiIn, groups, cost };
}
