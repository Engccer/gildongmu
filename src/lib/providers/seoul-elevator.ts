import type { SeoulMetroFacility, SubwayStation } from "../types";
import { env } from "../env";
import { normalizeStationName } from "../station-match";
import { readSeoulOpenJson } from "./seoul-open-json";
import { bearingDegrees, bearingToCompass8 } from "../geo/bearing";
import { haversineMeters } from "../geo";

/**
 * 서울 지하철 엘리베이터 위치(OA-21212 tbTraficElvtr) — wksn 미커버 노선(9호선·
 * 우이신설 등) 폴백 전용. 위치 설명이 없어 방위·거리 텍스트를 합성한다(스펙 §1-B).
 */
const BASE = "http://openapi.seoul.go.kr:8088";
const PAGE = 1000;
const MAX_PAGES = 5;

const COMPASS_KO: Record<string, string> = {
  n: "북",
  ne: "북동",
  e: "동",
  se: "남동",
  s: "남",
  sw: "남서",
  w: "서",
  nw: "북서",
};

export interface ElevatorPoint {
  stationKey: string;
  lat: number;
  lng: number;
  dong: string;
}

/** tbTraficElvtr row 배열에서 좌표 파싱 가능한 행만 추출한다(비정상 행은 버린다). */
export function parseElevatorRows(raw: unknown): ElevatorPoint[] {
  const row = (raw as { tbTraficElvtr?: { row?: unknown } })?.tbTraficElvtr?.row;
  if (!Array.isArray(row)) return [];
  return row.flatMap((it) => {
    const o = it as Record<string, unknown>;
    const m = String(o.NODE_WKT ?? "").match(/^POINT\(([\d.]+) ([\d.]+)\)$/);
    const name = String(o.SBWY_STN_NM ?? "").trim();
    if (!m || !name) return [];
    const lng = Number(m[1]);
    const lat = Number(m[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    return [{ stationKey: normalizeStationName(name), lat, lng, dong: String(o.EMD_NM ?? "").trim() }];
  });
}

/**
 * 전체 목록(페이지 루프 — list_total_count는 신뢰하지 않고 받은 row 수로 종료
 * 판정한다, 따릉이 provider와 동형). 키 없으면 빈 배열. 실패는 throw(호출부
 * allSettled로 supplementFailed 표기).
 */
export async function fetchSeoulElevators(): Promise<ElevatorPoint[]> {
  if (!env.SEOUL_OPEN_DATA_KEY) return [];
  const key = env.SEOUL_OPEN_DATA_KEY;
  let all: ElevatorPoint[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const start = page * PAGE + 1;
    const end = start + PAGE - 1;
    const res = await fetch(`${BASE}/${key}/json/tbTraficElvtr/${start}/${end}/`, {
      next: { revalidate: 86_400 },
    });
    if (!res.ok) throw new Error(`tbTraficElvtr HTTP ${res.status}`);
    // res.json() 직접 호출 금지 — 무효 키는 200 + XML로 와서 원인 없는 SyntaxError가 된다.
    const raw: unknown = await readSeoulOpenJson(res, "tbTraficElvtr");
    const svc = (raw as { tbTraficElvtr?: { RESULT?: { CODE?: string }; row?: unknown[] } })
      ?.tbTraficElvtr;
    if (svc?.RESULT?.CODE !== "INFO-000") {
      throw new Error(`tbTraficElvtr ${svc?.RESULT?.CODE ?? "비정상"}`);
    }
    const rowCount = Array.isArray(svc.row) ? svc.row.length : 0;
    all = all.concat(parseElevatorRows(raw));
    if (rowCount < PAGE) break;
  }
  return all;
}

/**
 * 방위·거리 항목 합성 — 기준점은 매칭 seed 행 중 그 엘리베이터와 최근접 좌표
 * (환승역 복수 좌표에서 임의 첫 행 금지, 스펙 §2-C). "역 중심 기준"을 명시해
 * 출입구 방향으로 오인하지 않게 한다. seed 좌표 없으면 [](그룹 생략).
 */
export function composeElevatorItems(
  elevators: ElevatorPoint[],
  seedRows: Pick<SubwayStation, "lat" | "lng">[],
): SeoulMetroFacility[] {
  if (seedRows.length === 0) return [];
  return elevators.map((e) => {
    const anchor = seedRows.reduce((best, s) =>
      haversineMeters(s.lat, s.lng, e.lat, e.lng) < haversineMeters(best.lat, best.lng, e.lat, e.lng)
        ? s
        : best,
    );
    const meters = Math.round(haversineMeters(anchor.lat, anchor.lng, e.lat, e.lng) / 10) * 10;
    const compass = COMPASS_KO[bearingToCompass8(bearingDegrees(anchor.lat, anchor.lng, e.lat, e.lng))];
    const name = e.dong
      ? `역 중심 기준 ${compass}쪽 약 ${meters}m, ${e.dong}`
      : `역 중심 기준 ${compass}쪽 약 ${meters}m`;
    return {
      name,
      location: undefined,
      floors: undefined,
      operatingStatus: undefined,
      detail: undefined,
    };
  });
}
