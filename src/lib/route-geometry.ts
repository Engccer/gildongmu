/**
 * 도보 경로 기하: 폴리라인 조립·검증·투영 (순수 — React/navigator 비의존).
 * 실시간 길 안내(스펙 2026-08-03 §5.1·§7.2)의 기하 계층. Kit 미러
 * RouteGeometry.swift와 공유 fixture(route-guide-scenarios.json)가 동조를 강제한다.
 *
 * 투영은 위경도를 대상점 주변 로컬 평면(m)으로 펴서 계산한다. 보행 스케일(수백 m)에서
 * 등장방형 근사 오차는 cm 단위라 충분하다. ⚠ 전역 최근접 매칭 금지 — 경로가 자기
 * 자신과 12m까지 근접해(조사 §2) 엉뚱한 스텝을 고른다. 호출자는 반드시 창을 구속하고,
 * 전역 탐색은 후보 목록(globalCandidates)으로만 받아 모호성을 밖에서 다룬다.
 */
import { haversineMeters } from "./geo";
import type { Coord } from "./types";

/** 40m 미만 스텝은 GPS 자동 판정 대상이 아니다: 25m 미만 구간 21%·도심 오차 7~13m(조사 §2). */
export const LONG_STEP_MIN_M = 40;
/** 스텝 이음매 허용 간격. 실측 0.00m지만 보증이 아니라 응답마다 검증한다(스펙 §7.2). */
export const SEAM_TOLERANCE_M = 5;

export interface Polyline {
  points: Coord[];
  /** cum[i] = 시작점→points[i] 누적 미터. */
  cum: number[];
}

export interface StepSpan {
  index: number;
  description: string;
  startD: number;
  endD: number;
  isLong: boolean;
}

export interface GuideRoute {
  polyline: Polyline;
  steps: StepSpan[];
  totalMeters: number;
}

export interface Projection {
  /** 경로 시작 기준 진행거리(m). */
  d: number;
  /** 폴리라인까지 수직거리(m). */
  perpMeters: number;
}

const finite = (c: Coord) => Number.isFinite(c.lat) && Number.isFinite(c.lng);

/**
 * 스텝 기하를 하나의 연속 폴리라인 + 스텝 스팬으로 조립한다.
 * 검증 실패는 null — 소비자는 상세 부적격으로 간략 폴백한다(fail-closed, 조용한 오작동 금지).
 */
export function buildGuideRoute(
  steps: { description: string; pathCoords?: Coord[] }[],
): GuideRoute | null {
  if (steps.length === 0) return null;
  const points: Coord[] = [];
  const cum: number[] = [];
  const spans: StepSpan[] = [];
  let d = 0;
  for (let i = 0; i < steps.length; i++) {
    const pc = steps[i].pathCoords;
    if (!pc || pc.length === 0 || !pc.every(finite)) return null;
    const startD = d;
    for (let j = 0; j < pc.length; j++) {
      const p = pc[j];
      if (points.length === 0) {
        points.push(p);
        cum.push(0);
        continue;
      }
      const prev = points[points.length - 1];
      const seg = haversineMeters(prev.lat, prev.lng, p.lat, p.lng);
      // 스텝 첫 점은 직전 스텝 끝점과 이어져야 한다(이음매 검증).
      if (j === 0 && seg > SEAM_TOLERANCE_M) return null;
      if (seg === 0) continue; // 중복점 제거
      d += seg;
      points.push(p);
      cum.push(d);
    }
    // 직전 스텝 끝점과 동일한 좌표 1점뿐인 중간 스텝(Tmap 폴백류 0-길이 지시)은
    // 거부한다(fail-closed). 통과시키면 startD==endD 유령 스텝이 spans에 남는다.
    if (d - startD <= 0 && i > 0 && pc.length < 2) return null;
    spans.push({
      index: i,
      description: steps[i].description,
      startD,
      endD: d,
      isLong: d - startD >= LONG_STEP_MIN_M,
    });
  }
  if (points.length < 2 || d <= 0) return null;
  return { polyline: { points, cum }, steps: spans, totalMeters: d };
}

/** 위경도를 기준점(ref) 주변 로컬 평면(m)으로 변환. */
function toLocal(ref: Coord, p: Coord): { x: number; y: number } {
  const y = (p.lat - ref.lat) * 111320;
  const x = (p.lng - ref.lng) * 111320 * Math.cos((ref.lat * Math.PI) / 180);
  return { x, y };
}

/**
 * [fromD, toD] 창 안에서 p의 최근접 투영. 창과 겹치는 세그먼트가 없으면 null.
 * 창 밖 최근접이면 창 경계로 클램프한 d를 반환한다(창 기아 판정은 호출자 몫).
 */
export function projectOnPolyline(
  poly: Polyline,
  p: Coord,
  fromD: number,
  toD: number,
): Projection | null {
  let best: Projection | null = null;
  for (let i = 0; i < poly.points.length - 1; i++) {
    const d0 = poly.cum[i];
    const d1 = poly.cum[i + 1];
    if (d1 < fromD || d0 > toD || d1 === d0) continue;
    const a = toLocal(p, poly.points[i]);
    const b = toLocal(p, poly.points[i + 1]);
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    // p가 로컬 원점이므로 투영 파라미터는 -a·(b-a)/|b-a|².
    let t = len2 === 0 ? 0 : (-a.x * abx - a.y * aby) / len2;
    t = Math.max(0, Math.min(1, t));
    // ⚠ perp는 세그먼트 기하 최근접(창 클램프 전) 기준이다. 클램프 후 지점까지의
    // 거리로 재면 창보다 앞서 걷는 정상 진행이 "수직 이탈"과 구분되지 않아,
    // 이탈 오판과 창 기아(edge hit) 판정 붕괴를 동시에 일으킨다(리듀서 계약).
    const px = a.x + abx * t;
    const py = a.y + aby * t;
    const perp = Math.hypot(px, py);
    const dd = Math.max(fromD, Math.min(toD, d0 + (d1 - d0) * t));
    if (!best || perp < best.perpMeters) best = { d: dd, perpMeters: perp };
  }
  return best;
}

/** 세그먼트 i 단독 투영(t는 [0,1]만 클램프 — 창 없음). */
function projectOnSegment(poly: Polyline, i: number, p: Coord): Projection {
  const a = toLocal(p, poly.points[i]);
  const b = toLocal(p, poly.points[i + 1]);
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  let t = len2 === 0 ? 0 : (-a.x * abx - a.y * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = a.x + abx * t;
  const py = a.y + aby * t;
  return {
    d: poly.cum[i] + (poly.cum[i + 1] - poly.cum[i]) * t,
    perpMeters: Math.hypot(px, py),
  };
}

/**
 * 전역 후보(국소 최소점들): 수직거리 ≤ maxPerp인 후보를 진행거리 30m 간격으로 병합해
 * 반환한다. 후보가 복수면 호출자는 위치를 확정하지 말아야 한다(스펙 §6 모호 규칙).
 * ⚠ 창 기반 projectOnPolyline을 재사용하지 않는다 — 창 호출은 인접 세그먼트의
 * 기하 최근접을 경계 클램프 d로 끌어들여 유령 후보를 만든다(실측: U자 왕복에서 3후보).
 */
export function globalCandidates(poly: Polyline, p: Coord, maxPerp: number): Projection[] {
  const raw: Projection[] = [];
  for (let i = 0; i < poly.points.length - 1; i++) {
    const pr = projectOnSegment(poly, i, p);
    if (pr.perpMeters <= maxPerp) raw.push(pr);
  }
  raw.sort((x, y) => x.d - y.d);
  const merged: Projection[] = [];
  for (const c of raw) {
    const last = merged[merged.length - 1];
    if (last && c.d - last.d < 30) {
      if (c.perpMeters < last.perpMeters) merged[merged.length - 1] = c;
    } else {
      merged.push(c);
    }
  }
  return merged;
}
