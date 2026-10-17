import { haversineMeters } from "../geo";
import type { KakaoLocalDocument } from "../providers/kakao-local";
import type { Coord, EgressOption } from "../types";
import { sameLine } from "./station-identity";

/** 택시승강장은 하차역 정류 좌표에서 이 거리 안의 것만 후보로 받는다(spec §4.4). */
export const JOURNEY_STAND_MAX_M = 300;

/**
 * 카카오 출구 문서에서 뽑은 후보. `placeName`은 카카오 `place_name` 원문이다 — 출구 도보 세션의 목적지 라벨이
 * 확정 문안 밖 새 문장 없이 데이터 이름("아현역 3번출구")으로 서게 하는 재료.
 */
export interface ParsedExit {
  label: string;
  lineName?: string;
  placeName: string;
  coord: Coord;
}

/** 승강장 후보. `label`과 `placeName`은 같은 원문 이름이다. */
export interface StandPick {
  label: string;
  placeName: string;
  coord: Coord;
}

function docCoord(doc: KakaoLocalDocument): Coord | null {
  if (doc.x.trim() === "" || doc.y.trim() === "") return null;
  const lat = Number(doc.y);
  const lng = Number(doc.x);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

// 역 이름 뒤 나머지: 공백 + (노선)? + 번호 + 번출구. 노선 토큰은 …선/…철도/GTX-…만 받는다(`서울역사` 같은 이름의 꼬리를 노선으로 읽지 않기 위해 공백도 필수).
const EXIT_TAIL = /^\s+(?:(\S*(?:선|철도)|GTX-\S+)\s+)?(\d+(?:-\d+)?)번\s*출구/;

/**
 * 카카오 키워드 문서 → 출구 후보(순수). 카테고리 끝이 `지하철출구` ∧ 이름이 `${stationDisplay}역`으로 시작해야 하고,
 * 나머지에서 노선(`노량진역 1호선 9번출구`의 `1호선`)과 번호(`9`, `3-1`)를 뽑는다. `stationDisplay`는
 * `displayStationName` 결과다(`서울역` → `서울` → `서울역 1번출구`).
 */
export function parseExitDoc(doc: KakaoLocalDocument, stationDisplay: string): ParsedExit | null {
  if (!doc.category_name.trim().endsWith("지하철출구")) return null;
  const prefix = `${stationDisplay}역`;
  if (!doc.place_name.startsWith(prefix)) return null;
  const m = doc.place_name.slice(prefix.length).match(EXIT_TAIL);
  if (!m) return null;
  const coord = docCoord(doc);
  if (!coord) return null;
  return {
    label: m[2],
    ...(m[1] ? { lineName: m[1] } : {}),
    placeName: doc.place_name,
    coord,
  };
}

/**
 * 하차 노선의 출구만(spec §4.4, 판정 10). 노선 표기 없는 출구는 그 역의 등록 출구가 **모두** 무표기일 때만
 * 받는다 — 섞여 있으면 무표기는 버리고, 맞는 노선이 없으면 빈 배열이다(무표기로 폴백하지 않는다).
 * 하차 노선을 모르면 전부 받는다.
 */
export function exitsForLine<T extends { lineName?: string }>(exits: T[], alightLine: string | undefined): T[] {
  if (alightLine === undefined) return exits;
  if (exits.every((e) => e.lineName === undefined)) return exits;
  return exits.filter((e) => e.lineName !== undefined && sameLine(e.lineName, alightLine));
}

/** 목적지까지 직선거리 오름차순 k개(안정 정렬, 입력 불변). k ≤ 0이면 빈 배열. */
export function prefilterExits<T extends { coord: Coord }>(exits: T[], to: Coord, k: number): T[] {
  if (!(k > 0)) return [];
  return exits
    .map((e, i) => ({ e, i, d: haversineMeters(e.coord.lat, e.coord.lng, to.lat, to.lng) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .slice(0, k)
    .map((x) => x.e);
}

/** 이름에 「택시」가 든 POI 중 하차 좌표 300m 안 최근접 하나. */
export function pickStand(docs: KakaoLocalDocument[], alightCoord: Coord): StandPick | null {
  let best: { pick: StandPick; d: number } | null = null;
  for (const doc of docs) {
    if (!doc.place_name.includes("택시")) continue;
    const coord = docCoord(doc);
    if (!coord) continue;
    const d = haversineMeters(coord.lat, coord.lng, alightCoord.lat, alightCoord.lng);
    if (d > JOURNEY_STAND_MAX_M) continue;
    if (best === null || d < best.d) best = { pick: { label: doc.place_name, placeName: doc.place_name, coord }, d };
  }
  return best?.pick ?? null;
}

/**
 * 택시 뒤 후보 중 가장 빠른 것. 택시 시간을 분(반올림)으로 비교하고(화면은 분만 말한다), 같은 분이면 하차역
 * 정류에서 덜 걷는 쪽(판정 10 "역 안 걷는 거리"의 근사), 그래도 같으면 앞선 쪽.
 */
export function chooseFastest(
  options: Array<{ option: EgressOption; walkFromStopM: number }>,
): EgressOption | null {
  let best: { option: EgressOption; min: number; walk: number } | null = null;
  for (const o of options) {
    const min = Math.round(o.option.taxiOut.durationSeconds / 60);
    if (best === null || min < best.min || (min === best.min && o.walkFromStopM < best.walk)) {
      best = { option: o.option, min, walk: o.walkFromStopM };
    }
  }
  return best?.option ?? null;
}
