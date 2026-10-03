import { haversineMeters } from "./geo";
import { bearingDegrees } from "./geo/bearing";
import { clockHour, relativeBearing } from "./clock-direction";
import type { Coord } from "./types";

/**
 * 횡단 스텝의 방향 원재료와 병합 횡단 분해(서버 전용 순수 함수, E62 spec
 * `2026-10-03-crosswalk-guidance-design.md` §3.2·§3.3). 입력은 카카오 스텝 폴리라인이다 — Tmap 스텝의
 * 기하는 다음 결정 지점까지의 LineString이라 이 판정에 넣지 않는다(호출자 게이트).
 */

/**
 * 기준 방향 선분 하한(m). 직전 스텝 끝에서 거슬러 처음 만나는 이 길이 이상 선분이 "걷던 방향"이다.
 * ⚠ 끝 10m 보간으로 바꾸지 말 것 — 카카오는 직전 스텝 끝에 연석 쪽으로 꺾는 3~9m 꼬리를 자주 달아
 * (코퍼스 81곳 중 19곳) 보도 본선과 꼬리의 중간 방위가 나오고 12곳(15%)의 분류가 바뀐다.
 */
export const REFERENCE_SEGMENT_MIN_M = 10;
/** 그런 선분이 없을 때 쓰는 직전 스텝 전체 현의 하한(m). 그보다 짧으면 방향 모름. */
export const REFERENCE_CHORD_MIN_M = 5;
/** 이 각 안이면 "진행 방향 그대로"(시계 12). 30° 반올림 시계(±15°)보다 넓다 — 지도 디지타이즈 꺾임을 흡수한다. */
export const STRAIGHT_TOLERANCE_DEG = 30;
/** 병합 횡단 분해: 이 각 미만으로 꺾이며 이어지는 긴 선분은 한 횡단으로 잇는다. */
export const SPLIT_TURN_DEG = 30;
/** 병합 횡단 분해: 이 길이 이상 선분만 횡단으로 본다(섬 위 짧은 선분 6.3·6.5m를 거르고 9.4m 횡단을 살린다). */
export const SPLIT_PIECE_MIN_M = 8;
/** 건너는 길 이름 추론 각 범위(부호 각 절댓값) — 직각 안팎으로 꺾으면 걷던 길을 건넌다. */
export const ROAD_CROSS_MIN_DEG = 60;
export const ROAD_CROSS_MAX_DEG = 120;
/**
 * 길 이름을 싣는 횡단 길이 하한(m). 코퍼스 재생(2026-10-03)에서 12m 미만 횡단에 큰길 이름이 붙은 17건(새문안로 7m·
 * 백제고분로 8m 등)이 모두 모퉁이를 돌아 옆길을 건너는 경우로 보였다 — 7~11m는 그 큰길 본선 폭이 아니다. 하한 미달은
 * "길 이름 모름" 틀로 떨어진다(지어내지 않는다). 실험판 실보행 판정 대상.
 */
export const ROAD_CROSS_MIN_LENGTH_M = 12;

interface Segment {
  /** 시작 꼭짓점 index(입력 배열 기준). */
  from: number;
  /** 끝 꼭짓점 index. */
  to: number;
  bearing: number;
  length: number;
}

function segmentsOf(coords: readonly Coord[]): Segment[] {
  const out: Segment[] = [];
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const length = haversineMeters(a.lat, a.lng, b.lat, b.lng);
    if (length === 0) continue;
    out.push({ from: i - 1, to: i, bearing: bearingDegrees(a.lat, a.lng, b.lat, b.lng), length });
  }
  return out;
}

/** 기준 방향(°): 끝에서 거슬러 처음 만나는 10m 이상 선분의 방위, 없으면 전체 현(5m 이상), 그것도 없으면 null. */
export function referenceBearing(coords: readonly Coord[] | undefined): number | null {
  if (!coords || coords.length < 2) return null;
  const segs = segmentsOf(coords);
  for (let i = segs.length - 1; i >= 0; i--) {
    if (segs[i].length >= REFERENCE_SEGMENT_MIN_M) return segs[i].bearing;
  }
  const a = coords[0];
  const b = coords[coords.length - 1];
  if (haversineMeters(a.lat, a.lng, b.lat, b.lng) < REFERENCE_CHORD_MIN_M) return null;
  return bearingDegrees(a.lat, a.lng, b.lat, b.lng);
}

/** 첫 선분 방위(°). 선분이 없으면 null. */
export function firstSegmentBearing(coords: readonly Coord[] | undefined): number | null {
  if (!coords) return null;
  const segs = segmentsOf(coords);
  return segs.length > 0 ? segs[0].bearing : null;
}

/** 부호 있는 꺾임(°, -180 초과 180 이하). 양수 = 시계 방향(오른쪽). */
export function signedTurn(reference: number, target: number): number {
  const rel = relativeBearing(reference, target);
  return rel > 180 ? rel - 360 : rel;
}

/** 횡단 방향 시(1~12). ±30° 안은 12(진행 방향 그대로), 그 밖은 `clockHour`(6 = 뒤). */
export function crossingClockOf(reference: number, crossing: number): number {
  if (Math.abs(signedTurn(reference, crossing)) <= STRAIGHT_TOLERANCE_DEG) return 12;
  return clockHour(relativeBearing(reference, crossing));
}

/** 직각 안팎으로 꺾는가(길 이름 추론 조건). */
export function crossesWalkedRoad(reference: number, crossing: number): boolean {
  const turn = Math.abs(signedTurn(reference, crossing));
  return turn >= ROAD_CROSS_MIN_DEG && turn <= ROAD_CROSS_MAX_DEG;
}

/** 분해된 횡단보도 하나: 그 조각의 폴리라인과 주 덩어리(방위·길이). */
export interface CrossingPiece {
  coords: Coord[];
  /** 주 덩어리(8m 이상 선분) 첫 선분 방위(°) — 이 횡단보도를 건너는 방향. */
  bearing: number;
  /** 주 덩어리 마지막 선분 방위(°) — 다 건넌 뒤의 진행 방향이라 다음 조각의 기준 방향이다. */
  exitBearing: number;
  /** 주 덩어리 길이(m, 섬 선분 제외) — "횡단보도 길이"로 낭독한다. */
  length: number;
  /** 조각 폴리라인 전체 길이(m, 섬 선분 포함) — 거리 비례 배분의 가중치. */
  pathLength: number;
}

/**
 * 병합 횡단("N개의 횡단보도") 폴리라인을 횡단보도마다 나눈다. **확실할 때만** — 8m 이상 선분만 보고(섬 위 짧은
 * 선분은 무시) 30° 미만으로 이어지는 것을 한 횡단으로 이은 덩어리가 정확히 `count`개일 때. 아니면 null(병합 문장
 * 유지). ⚠ 짧은 선분까지 덩어리에 넣으면 섬 위 두 선분(6.3·3.7m) 사이 꺾임이 30° 경계에 걸려 10m 가짜 덩어리가
 * 생긴다(강동성심병원교차로 형태). 경계는 각 덩어리 마지막 선분의 끝이라 섬 선분은 다음 조각 앞에 붙는다.
 * 조각은 경계 꼭짓점을 공유한다(이음매 0m).
 */
export function splitMergedCrossing(coords: readonly Coord[] | undefined, count: number): CrossingPiece[] | null {
  if (!coords || count < 2) return null;
  const runs: { segs: Segment[]; last: number; length: number }[] = [];
  for (const s of segmentsOf(coords)) {
    if (s.length < SPLIT_PIECE_MIN_M) continue;
    const run = runs[runs.length - 1];
    if (run && Math.abs(signedTurn(run.last, s.bearing)) < SPLIT_TURN_DEG) {
      run.segs.push(s);
      run.last = s.bearing;
      run.length += s.length;
    } else {
      runs.push({ segs: [s], last: s.bearing, length: s.length });
    }
  }
  if (runs.length !== count) return null;
  const pieces: CrossingPiece[] = [];
  let start = 0;
  runs.forEach((run, k) => {
    const end = k === runs.length - 1 ? coords.length - 1 : run.segs[run.segs.length - 1].to;
    const slice = coords.slice(start, end + 1);
    const pathLength = segmentsOf(slice).reduce((sum, seg) => sum + seg.length, 0);
    pieces.push({ coords: slice, bearing: run.segs[0].bearing, exitBearing: run.last, length: run.length, pathLength });
    start = end;
  });
  return pieces;
}
