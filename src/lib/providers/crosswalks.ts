import { haversineMeters } from "../geo";
import type { Coord } from "../types";
import seed from "../data/crosswalks.json";

/**
 * 전국횡단보도표준데이터(15028201) 정적 seed 조회 provider(서버 전용, 동기).
 * 도보 경로의 단일 횡단보도 스텝에 차로 수·도로 폭(연장)을 덧붙이기 위한 판정만 한다.
 * spec docs/superpowers/specs/2026-08-23-crosswalk-lanes-length-design.md §3.
 *
 * ⚠ 이 데이터는 **교차로의 횡단보도 여럿이 한 점에 겹쳐 등록**돼 있다(좌표 4,833곳
 * 중복, 3,425곳 값 불일치 — 2026-08-23 실측). 최근접 1건만 고르면 어느 횡단보도인지
 * 알 수 없고 틀린 차로 수는 침묵보다 나쁘다. 그래서 3중 게이트(위치 → 길이 타당성 →
 * 합의)를 전부 통과할 때만 값을 내고, 하나라도 어긋나면 null(침묵)이다.
 */

/** [lat, lng, 차로 수, 연장 m] */
export type CrosswalkTuple = [number, number, number, number];

export interface CrosswalkInfo {
  lanes: number;
  /** 연장(차도를 건너는 길이) — 보도 간 스텝 거리와 다른 값이라 "도로 폭"으로 낸다. */
  lengthM: number;
}

const SEED = seed as unknown as { crosswalks: CrosswalkTuple[] };

/** ① 위치: 스텝 양 끝점 중점에서 이 반경 안만 후보(실측 매칭 8.8~29m, 타 횡단보도 40m+). */
export const CROSSWALK_MATCH_RADIUS_M = 30;
/** ② 길이 타당성: |연장 − 구간 길이| ≤ max(바닥, 비율·구간 길이). 실측 정답 비 0.6~1.1. */
const LENGTH_TOLERANCE_FLOOR_M = 5;
const LENGTH_TOLERANCE_RATIO = 0.4;
/** ③ 합의: 남은 후보의 차로 수가 같고 연장 차가 이 안이면 최근접 채택. */
const LENGTH_AGREEMENT_M = 2;

/** 순수 판정(테스트 주입용). `path`는 스텝 폴리라인, 2점 미만이면 구간 길이를 잴 수 없어 null. */
export function matchCrosswalkIn(path: Coord[], seedTuples: CrosswalkTuple[]): CrosswalkInfo | null {
  if (path.length < 2) return null;
  const a = path[0];
  const b = path[path.length - 1];
  const segment = haversineMeters(a.lat, a.lng, b.lat, b.lng);
  const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
  const latDelta = CROSSWALK_MATCH_RADIUS_M / 111_320;
  const lngDelta = CROSSWALK_MATCH_RADIUS_M / (111_320 * Math.cos((mid.lat * Math.PI) / 180));
  const tolerance = Math.max(LENGTH_TOLERANCE_FLOOR_M, LENGTH_TOLERANCE_RATIO * segment);

  const plausible: Array<{ d: number; lanes: number; lengthM: number }> = [];
  for (const [lat, lng, lanes, lengthM] of seedTuples) {
    if (Math.abs(lat - mid.lat) > latDelta || Math.abs(lng - mid.lng) > lngDelta) continue;
    const d = haversineMeters(mid.lat, mid.lng, lat, lng);
    if (d > CROSSWALK_MATCH_RADIUS_M) continue;
    if (Math.abs(lengthM - segment) > tolerance) continue;
    plausible.push({ d, lanes, lengthM });
  }
  if (plausible.length === 0) return null;
  plausible.sort((x, y) => x.d - y.d);
  const best = plausible[0];
  const agreed = plausible.every(
    (c) => c.lanes === best.lanes && Math.abs(c.lengthM - best.lengthM) <= LENGTH_AGREEMENT_M,
  );
  return agreed ? { lanes: best.lanes, lengthM: best.lengthM } : null;
}

/** 번들 seed로 판정. */
export function matchCrosswalk(path: Coord[]): CrosswalkInfo | null {
  return matchCrosswalkIn(path, SEED.crosswalks);
}
