import { projectOnPolyline, type Polyline } from "./route-geometry";
import type { CarJam, Coord } from "./types";

/**
 * 주행 중 "앞으로 지날 구간에 새로 생긴 정체" 판정(E80 spec §5). 순수 함수, Kit `CarTrafficAhead.swift` 미러,
 * 공유 fixture `src/lib/__tests__/fixtures/car-jams-ahead-cases.json`.
 *
 * 재조회 응답은 지금 위치에서 다시 찾은 경로라 지금 안내 중인 경로와 다를 수 있다. 그래서 정체를 응답의 진행거리가
 * 아니라 **좌표**로 받아 지금 경로에 투영한다 — 둘 다 경로 위(`JAM_ON_ROUTE_M` 안)이고 시작이 지금 진행거리보다
 * 앞일 때만 "내가 지날 구간"이다. 이미 아는 정체(시작 조회·직전 재조회에서 본 것)와 겹치면 새것이 아니다.
 * 아는 정체도 좌표로 보관해 판정 때마다 다시 투영한다(재경로 뒤에도 유효).
 */

/** 정체 좌표가 안내 경로 위로 인정되는 수직거리(m). 실호출 게이트에서 같은 응답 기준 0m였다. */
export const JAM_ON_ROUTE_M = 40;
/**
 * 투영한 구간 길이와 정체 길이의 허용 차(m, 정체 길이의 `JAM_LENGTH_TOLERANCE_RATIO`와 큰 쪽). 양 끝만 경로 위인 우회로 정체
 * (분기점·합류점만 내 경로에 걸린다)를 내 앞 정체로 말하지 않으려는 검사다 — 그 도로 이름까지 틀리게 들린다.
 */
export const JAM_LENGTH_TOLERANCE_M = 150;
export const JAM_LENGTH_TOLERANCE_RATIO = 0.25;

export interface KnownJam {
  start: Coord;
  end: Coord;
}

export interface NewJamsAheadResult {
  /** 알릴 정체(가장 가까운 하나)와 지금 위치에서 정체 시작까지(m). 없으면 null. */
  nearest: { jam: CarJam; aheadMeters: number } | null;
  /**
   * 알린 뒤의 아는 정체 = 입력 + `nearest` 하나. 알리지 않은 먼 새 정체는 더하지 않는다 — 다음 재조회가 말한다.
   * 호출부는 실제로 말했을 때만 이것을 채택한다(통지가 버려지면 입력 그대로 두어 다음 재조회가 다시 판정한다).
   */
  known: KnownJam[];
}

/** 정체의 [시작, 끝] 진행거리 구간. 둘 중 하나라도 경로 밖이거나 뒤집히면 null. */
function intervalOn(poly: Polyline, jam: KnownJam, fromD: number, toD: number): [number, number] | null {
  const s = projectOnPolyline(poly, jam.start, fromD, toD);
  const e = projectOnPolyline(poly, jam.end, fromD, toD);
  if (!s || !e || s.perpMeters > JAM_ON_ROUTE_M || e.perpMeters > JAM_ON_ROUTE_M) return null;
  if (e.d <= s.d) return null;
  return [s.d, e.d];
}

export function newJamsAhead(input: {
  polyline: Polyline;
  totalMeters: number;
  /** 지금 진행거리(m). */
  d: number;
  known: KnownJam[];
  fresh: CarJam[];
}): NewJamsAheadResult {
  const { polyline, totalMeters, d } = input;
  const knownIntervals = input.known
    .map((k) => intervalOn(polyline, k, 0, totalMeters))
    .filter((x): x is [number, number] => x !== null);
  const added: { jam: CarJam; s: number }[] = [];
  for (const jam of input.fresh) {
    const iv = intervalOn(polyline, jam, d, totalMeters);
    // 시작이 지금 진행거리보다 앞이 아니면 지나갔거나 이미 그 안이다(창 클램프로 s === d가 된다).
    if (!iv || iv[0] <= d) continue;
    const tolerance = Math.max(JAM_LENGTH_TOLERANCE_M, jam.lengthMeters * JAM_LENGTH_TOLERANCE_RATIO);
    if (Math.abs(iv[1] - iv[0] - jam.lengthMeters) > tolerance) continue;
    if (knownIntervals.some(([ks, ke]) => iv[0] < ke && ks < iv[1])) continue;
    added.push({ jam, s: iv[0] });
  }
  if (added.length === 0) return { nearest: null, known: input.known };
  added.sort((a, b) => a.s - b.s);
  return {
    nearest: { jam: added[0].jam, aheadMeters: Math.round(added[0].s - d) },
    known: [...input.known, { start: added[0].jam.start, end: added[0].jam.end }],
  };
}
