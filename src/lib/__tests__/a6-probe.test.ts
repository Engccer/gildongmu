/**
 * A6 탐사 하네스 — 실제 리듀서(guideStep)를 재생해 이탈 판정 축 후보를 실측한다.
 * codex 적대적 리뷰(2026-08-09) 반영: 다수결 2-state 대신 courseAccuracy를 불확실성으로
 * 쓰는 3-state 판정, 그리고 독립 Gaussian이 아닌 지속 편향 잡음 모델을 함께 잰다.
 *
 * spec 확정 시 이 파일은 정식 계약 테스트로 승격한다(지금은 파라미터 탐사용).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INACTIVE_COURSE, type CourseObservation } from "../guide-course-axis";
import {
  buildGuideRoute,
  guideStep,
  initialGuideState,
  WALK_TUNING,
  type GuideFix,
  type GuideRoute,
} from "../route-guide";

const R = 6371000;
const FIX_DIR = new URL("./fixtures/a6-routes/", import.meta.url).pathname;
type XY = { x: number; y: number };

function loadRoute(file: string): GuideRoute {
  const raw = JSON.parse(readFileSync(`${FIX_DIR}${file}`, "utf8"));
  return buildGuideRoute(raw.steps)!;
}

function frame(route: GuideRoute) {
  const o = route.polyline.points[0];
  const mPerLat = (Math.PI / 180) * R;
  const mPerLng = mPerLat * Math.cos((o.lat * Math.PI) / 180);
  const toLL = (q: XY) => ({ lat: o.lat + q.y / mPerLat, lng: o.lng + q.x / mPerLng });
  const toXY = (p: { lat: number; lng: number }): XY => ({
    x: (p.lng - o.lng) * mPerLng,
    y: (p.lat - o.lat) * mPerLat,
  });
  const pointAt = (d: number): XY => {
    const { points, cum } = route.polyline;
    const dd = Math.max(0, Math.min(d, cum[cum.length - 1]));
    for (let i = 0; i < points.length - 1; i++) {
      if (cum[i] <= dd && dd <= cum[i + 1]) {
        const seg = cum[i + 1] - cum[i];
        const t = seg === 0 ? 0 : (dd - cum[i]) / seg;
        const a = toXY(points[i]);
        const b = toXY(points[i + 1]);
        return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
      }
    }
    return toXY(points[points.length - 1]);
  };
  return { toLL, pointAt };
}

const bearing = (a: XY, b: XY) => ((Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI + 360) % 360;
const angDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}
function gauss(r: () => number, sigma: number) {
  const u = Math.max(1e-9, r());
  return sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

const SPEED = 1.2;

interface Sample {
  t: number;
  fix: GuideFix;
  course: number;
  /** 기기가 스스로 보고하는 방위 불확실성(도) */
  courseAccuracy: number;
}

interface Noise {
  pos: number;
  /** 독립 Gaussian 성분 */
  course: number;
  /** 지속 편향 진폭(도) — codex 리뷰 15: 도심 course 오차는 독립이 아니다 */
  biasAmp: number;
  /** 지속 편향 주기(초) */
  biasPeriod: number;
  /** 턴 직후 방위 지연(초) — 기기가 옛 방위를 얼마간 유지 */
  turnLagS: number;
  accuracy: number;
  /** 기기가 보고하는 courseAccuracy. 지속 편향은 여기에 드러나지 않는 것이 핵심 */
  reportedCourseAcc: number;
}

const CLEAN: Noise = {
  pos: 5, course: 15, biasAmp: 0, biasPeriod: 40, turnLagS: 0, accuracy: 10, reportedCourseAcc: 15,
};
const BIASED: Noise = {
  pos: 5, course: 10, biasAmp: 20, biasPeriod: 40, turnLagS: 3, accuracy: 10, reportedCourseAcc: 15,
};
const HARSH: Noise = {
  pos: 8, course: 15, biasAmp: 30, biasPeriod: 30, turnLagS: 4, accuracy: 12, reportedCourseAcc: 20,
};

function makeTrajectory(
  route: GuideRoute,
  seed: number,
  n: Noise,
  deviate: { atD: number; deg: number } | null,
): Sample[] {
  const { toLL, pointAt } = frame(route);
  const r = rng(seed);
  const phase = r() * Math.PI * 2;
  const out: Sample[] = [];
  const trueBearings: number[] = [];
  let t = 0;
  let d = 0;
  const limit = deviate ? deviate.atD : route.totalMeters;
  const push = (p: XY, trueB: number) => {
    trueBearings.push(trueB);
    // 턴 지연: 기기가 turnLagS 초 전의 진행 방위를 보고한다
    const lagIdx = Math.max(0, trueBearings.length - 1 - Math.round(n.turnLagS));
    const lagged = trueBearings[lagIdx];
    const bias = n.biasAmp * Math.sin((2 * Math.PI * t) / n.biasPeriod + phase);
    out.push({
      t,
      fix: { ...toLL({ x: p.x + gauss(r, n.pos), y: p.y + gauss(r, n.pos) }), accuracy: n.accuracy },
      course: (lagged + bias + gauss(r, n.course) + 360) % 360,
      courseAccuracy: n.reportedCourseAcc,
    });
  };
  while (d < limit) {
    const p = pointAt(d);
    push(p, bearing(p, pointAt(Math.min(d + SPEED, route.totalMeters))));
    t += 1;
    d += SPEED;
  }
  if (deviate) {
    const start = pointAt(deviate.atD);
    const inB = bearing(pointAt(Math.max(0, deviate.atD - 8)), start);
    const brd = (inB + deviate.deg + 360) % 360;
    const br = (brd * Math.PI) / 180;
    const until = t + 200;
    let k = 0;
    while (t < until) {
      k += 1;
      push({ x: start.x + Math.sin(br) * SPEED * k, y: start.y + Math.cos(br) * SPEED * k }, brd);
      t += 1;
    }
  }
  return out;
}

/**
 * 궤적을 리듀서에 그대로 흘려 **첫 이탈 확정 시각**을 돌려준다.
 *
 * ⚠ **판정은 전부 실제 모듈이 한다.** 종전 하네스는 표결·창·임계를 자기 사본으로
 * 구현했는데, 그러면 `guide-course-axis.ts`가 바뀌어도 이 테스트가 통과한다.
 * `axisActive=false`가 현행 동작(수직거리 축 단독), `true`가 신규 동작이다.
 */
function replay(route: GuideRoute, samples: Sample[], axisActive: boolean): number | null {
  let { state } = initialGuideState(route, 0);
  for (const s of samples) {
    const obs: CourseObservation = axisActive
      ? { state: { kind: "valid", course: s.course }, accuracyDeg: s.courseAccuracy }
      : INACTIVE_COURSE;
    const out = guideStep(state, s.fix, route, s.t, WALK_TUNING, obs);
    state = out.state;
    if (out.event?.kind === "offRoute") return s.t;
  }
  return null;
}

function turnPoints(route: GuideRoute): number[] {
  const { pointAt } = frame(route);
  const out: number[] = [];
  for (let d = 30; d < route.totalMeters - 60; d += 10) {
    if (angDiff(bearing(pointAt(d - 15), pointAt(d)), bearing(pointAt(d), pointAt(d + 15))) > 50) {
      out.push(d);
    }
  }
  return out.filter((d, i) => i === 0 || d - out[i - 1] > 40);
}

const ROUTES = [
  { name: "실보행(자택→고우헤어)", route: loadRoute("home-gowoo.json") },
  { name: "길동역→강동구청", route: loadRoute("gildong-gangdong-office.json") },
  { name: "강남역→삼성역", route: loadRoute("gangnam-samsung-arterial.json") },
  { name: "경복궁→광화문", route: loadRoute("gyeongbokgung-gwanghwamun-short.json") },
  { name: "시청→광화문", route: loadRoute("cityhall-gwanghwamun-straight.json") },
];

const med = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);

function evaluate(n: Noise, seeds: number) {
  let fp = 0;
  let walks = 0;
  const now: number[] = [];
  const next: number[] = [];
  let win = 0;
  for (const { route } of ROUTES) {
    // 헛경고: 경로를 벗어나지 않는 보행에서 이탈이 확정되면 안 된다.
    for (let s = 0; s < seeds; s++) {
      walks++;
      if (replay(route, makeTrajectory(route, s + 5000, n, null), true) !== null) fp++;
    }
    // 검출 지연: 같은 궤적을 현행(축 없음)과 신규(축 있음)로 각각 재생해 비교한다.
    for (const atD of turnPoints(route).slice(0, 4)) {
      for (const deg of [-30, -45, -60, -90, 0, 120, 180]) {
        for (let s = 0; s < 3; s++) {
          const splitT = Math.round(atD / SPEED);
          const samples = makeTrajectory(route, s + 1, n, { atD, deg });
          const a = replay(route, samples, false);
          if (a === null || a < splitT) continue;
          const b = replay(route, samples, true);
          now.push(a - splitT);
          // 축이 못 잡으면 현행과 같다(신규는 현행을 포함하는 OR이라 더 늦을 수 없다).
          next.push(b !== null && b >= splitT ? Math.min(a, b) - splitT : a - splitT);
          if (b !== null && b < a) win++;
        }
      }
    }
  }
  return { fp, walks, nowMed: med(now), nextMed: med(next), win, tot: now.length };
}

/**
 * 계약 테스트. 실제 `guideStep`을 재생하므로 `guide-course-axis.ts`의 상수·판정이
 * 바뀌면 여기가 먼저 깨진다.
 *
 * ⚠ **상한과 잡음 모델은 잠정값이다**(spec §6). 실기기 로그로 파라미터가 확정되면
 * 이 수치를 함께 고친다. 지금 재는 것은 "실제 값이 얼마인가"가 아니라 "설계가
 * 지속 편향에서 무너지지 않는가"다.
 */
describe("A6 방위 축 경로 재생", () => {
  it("지속 편향 잡음에서 헛경고가 상한 아래", { timeout: 300000 }, () => {
    const r = evaluate(BIASED, 60);
    expect(r.walks).toBe(ROUTES.length * 60);
    expect(r.fp / r.walks).toBeLessThan(0.03);
  });

  it("이탈 검출이 현행보다 빠르다", { timeout: 300000 }, () => {
    const r = evaluate(BIASED, 0);
    expect(r.tot).toBeGreaterThan(20);
    expect(r.nextMed!).toBeLessThan(r.nowMed!);
    expect(r.win).toBeGreaterThan(0);
  });

  it("독립 잡음에서도 헛경고가 상한 아래", { timeout: 300000 }, () => {
    const r = evaluate(CLEAN, 60);
    expect(r.fp / r.walks).toBeLessThan(0.03);
  });

  it("가혹 조건에서도 무너지지 않는다 — 3-state가 지키는 것", { timeout: 300000 }, () => {
    const r = evaluate(HARSH, 40);
    expect(r.fp / r.walks).toBeLessThan(0.1);
  });
});
