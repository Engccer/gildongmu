import type { CarCongestion, CarJam, Coord } from "./types";

/**
 * 자동차 경로 정체 구간 요약(E80, spec `2026-11-07-e80-car-traffic-design.md` §3). 순수 함수.
 *
 * provider 파일이 자기 코드표로 경로를 따라 연속 조각(`CongestionPiece`)을 만들고, 이 모듈이 정체 조각만 이어 붙여
 * 문턱을 넘는 것을 남긴다. ⚠ 코드표는 provider 안에서만 읽는다 — Tmap은 4가 정체, 카카오는 1이 정체로 **숫자 방향이
 * 반대**라 밖으로는 `jam` 불리언만 나온다. 서행은 정체가 아니다(이른 아침에도 경로 절반을 덮어 행동을 가르지 않는다).
 */

/** 경로를 따라 이어지는 교통 조각 하나. */
export interface CongestionPiece {
  /** 경로 출발점에서 조각 시작까지(m). */
  fromM: number;
  toM: number;
  /** 정체 등급인가. 정보 없음(코드 0) 조각은 provider가 `known: false`로 표시한다. */
  jam: boolean;
  /** provider가 이 조각의 교통 정보를 주었는가(코드 0이면 false). */
  known: boolean;
  road: string | null;
  from: Coord;
  to: Coord;
}

/** 이 간격 이하로 떨어진 정체 조각은 하나로 본다(가다 서다). */
export const JAM_MERGE_GAP_M = 200;
/** 이보다 짧은 정체는 싣지 않는다(위원장 판정 2026-11-07 ③). */
export const JAM_MIN_M = 500;
/**
 * 교통 정보가 있는 길이가 경로 총거리의 이 비율보다 적으면 정보 없음(null)이다 — 짧은 한 조각만 「원활」이어도
 * 「막히는 구간이 없습니다」라고 단정하면 정보 없음과 정체 없음이 섞인다(3-state). 실호출 표본은 98.9~100%였다.
 */
export const CONGESTION_MIN_COVERAGE = 0.8;

/**
 * 조각 → 정체 요약. 교통 정보가 있는 길이가 `totalMeters`의 `CONGESTION_MIN_COVERAGE` 미만이면 null(정보 없음).
 * 분모는 조각 합이 아니라 경로 총거리다 — Tmap은 정보 없는 LineString에 조각을 만들지 않는다.
 * 조각은 경로 순서여야 한다(provider가 보장).
 */
export function summarizeCongestion(pieces: CongestionPiece[], totalMeters: number): CarCongestion | null {
  const knownM = pieces.reduce((sum, p) => sum + (p.known ? Math.max(0, p.toM - p.fromM) : 0), 0);
  if (!(totalMeters > 0) || knownM < totalMeters * CONGESTION_MIN_COVERAGE) return null;
  const runs: { fromM: number; toM: number; from: Coord; to: Coord; roads: Map<string, number> }[] = [];
  for (const p of pieces) {
    if (!p.jam || p.toM <= p.fromM) continue;
    const last = runs.at(-1);
    if (last && p.fromM - last.toM <= JAM_MERGE_GAP_M) {
      last.toM = p.toM;
      last.to = p.to;
    } else {
      runs.push({ fromM: p.fromM, toM: p.toM, from: p.from, to: p.to, roads: new Map() });
    }
    if (p.road) {
      const r = runs.at(-1)!;
      r.roads.set(p.road, (r.roads.get(p.road) ?? 0) + (p.toM - p.fromM));
    }
  }
  const jams: CarJam[] = runs
    .filter((r) => r.toM - r.fromM >= JAM_MIN_M)
    .map((r) => {
      let road: string | null = null;
      let best = 0;
      for (const [name, m] of r.roads) {
        if (m > best) {
          best = m;
          road = name;
        }
      }
      return {
        road,
        startMeters: Math.round(r.fromM),
        lengthMeters: Math.round(r.toM - r.fromM),
        start: r.from,
        end: r.to,
      };
    });
  return { jams };
}
