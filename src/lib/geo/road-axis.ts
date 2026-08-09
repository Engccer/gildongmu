import type { Coord } from "../types";

const EARTH_R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** 원점 기준 국소 평면(m). x=동, y=북. 수백 m 범위에서 충분히 정확하다. */
export function toLocalXY(origin: Coord, p: Coord): { x: number; y: number } {
  return {
    x: rad(p.lng - origin.lng) * EARTH_R * Math.cos(rad(origin.lat)),
    y: rad(p.lat - origin.lat) * EARTH_R,
  };
}

export interface AxisSample {
  main: number;
  lat: number;
  lng: number;
}

export interface RoadAxis {
  /** 번호가 커지는 방향 단위벡터 */
  ux: number;
  uy: number;
  /** 번호 1당 도로 진행거리(m). 법정 기초간격 20m에 홀짝 한 쌍이라 8~10m가 정상. */
  metersPerNumber: number;
  sampleCount: number;
}

/** 축을 세우는 데 필요한 최소 표본. 2개면 직선이 유일해 검증이 안 된다. */
const MIN_SAMPLES = 3;
/** 번호 1당 진행거리가 이보다 작으면 번호와 좌표가 무상관이다(거짓 축 방지). */
const MIN_METERS_PER_NUMBER = 1;

/**
 * (본번, 좌표)에 최소제곱 직선을 맞춰 도로 진행축을 복원한다.
 *
 * 번호를 독립변수로 두는 이유: 측면 오프셋(건물이 도로에서 물러난 거리)은
 * 번호와 무상관이라 회귀에서 상쇄된다. 좌표만으로 주성분을 잡으면 그 오프셋이
 * 축을 회전시킨다.
 */
export function fitRoadAxis(
  origin: Coord,
  samples: AxisSample[],
): RoadAxis | null {
  if (samples.length < MIN_SAMPLES) return null;
  const pts = samples.map((s) => ({ n: s.main, ...toLocalXY(origin, s) }));
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const mn = mean(pts.map((p) => p.n));
  const mx = mean(pts.map((p) => p.x));
  const my = mean(pts.map((p) => p.y));
  let sxn = 0;
  let syn = 0;
  let snn = 0;
  for (const p of pts) {
    sxn += (p.n - mn) * (p.x - mx);
    syn += (p.n - mn) * (p.y - my);
    snn += (p.n - mn) ** 2;
  }
  if (snn === 0) return null;
  const dx = sxn / snn;
  const dy = syn / snn;
  const len = Math.hypot(dx, dy);
  if (len < MIN_METERS_PER_NUMBER) return null;
  return { ux: dx / len, uy: dy / len, metersPerNumber: len, sampleCount: pts.length };
}

/** 입구를 마주 본 사용자의 좌표계. v=시선(도로→건물), r=오른손 방향. */
export interface EntranceFrame {
  vx: number;
  vy: number;
  rx: number;
  ry: number;
}

/**
 * 홀수 앵커면 건물이 축의 왼쪽에 있으므로 도로는 건물의 오른쪽(축 -90°)이고,
 * 도로에서 건물을 보는 시선은 그 반대인 축 +90°다. 짝수는 부호가 뒤집힌다.
 *
 * ⚠ 이 부호를 뒤집으면 좌우가 정반대가 된다. 위원장 판정은 "입구를 마주 본" 기준이다.
 */
export function entranceFrame(axis: RoadAxis, anchorIsOdd: boolean): EntranceFrame {
  const sign = anchorIsOdd ? 1 : -1;
  const vx = -axis.uy * sign;
  const vy = axis.ux * sign;
  // 오른손 = 시선을 -90° 회전
  return { vx, vy, rx: vy, ry: -vx };
}

export type SurroundingBucket = "left" | "right" | "across" | "beyond";

/** 시선 방향으로 이만큼 넘어가면 건물 너머(돌아가야 한다). spec §3.3 동결값. */
export const BEYOND_THRESHOLD_M = 25;

export function classifyBucket(
  frame: EntranceFrame,
  origin: Coord,
  target: Coord,
  opts: { acrossByParity?: boolean },
): SurroundingBucket {
  // 맞은편은 법이 정한 판정이라 기하보다 강하다(spec §3.3).
  if (opts.acrossByParity) return "across";
  const q = toLocalXY(origin, target);
  const forward = q.x * frame.vx + q.y * frame.vy;
  if (forward > BEYOND_THRESHOLD_M) return "beyond";
  const right = q.x * frame.rx + q.y * frame.ry;
  return right >= 0 ? "right" : "left";
}
