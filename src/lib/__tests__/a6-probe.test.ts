/**
 * A6 탐사 하네스 — 실제 리듀서(guideStep)를 재생해 이탈 판정 축 후보를 실측한다.
 * codex 적대적 리뷰(2026-08-09) 반영: 다수결 2-state 대신 courseAccuracy를 불확실성으로
 * 쓰는 3-state 판정, 그리고 독립 Gaussian이 아닌 지속 편향 잡음 모델을 함께 잰다.
 *
 * spec 확정 시 이 파일은 정식 계약 테스트로 승격한다(지금은 파라미터 탐사용).
 */
import { readFileSync } from "node:fs";
import { describe, it } from "vitest";
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

interface Params {
  half: number;
  thr: number;
  window: number;
  need: number;
  back: number;
  ahead: number;
  /** 창을 채워야 하는 최소 표본 비율 (codex 리뷰 2: 최소 증거량) */
  minFill: number;
  /** true면 courseAccuracy를 불확실성으로 써 3-state 판정 (codex 리뷰 9) */
  threeState: boolean;
}

type Vote = "mismatch" | "match" | "unknown";

function replay(route: GuideRoute, samples: Sample[], p: Params) {
  const { pointAt } = frame(route);
  const tangent = (d: number) =>
    bearing(pointAt(Math.max(0, d - p.half)), pointAt(Math.min(route.totalMeters, d + p.half)));
  const vote = (s: Sample, d: number): Vote => {
    let best = 180;
    for (let o = -p.back; o <= p.ahead; o += 5) {
      const dd = d + o;
      if (dd < 0 || dd > route.totalMeters) continue;
      best = Math.min(best, angDiff(s.course, tangent(dd)));
    }
    if (!p.threeState) return best > p.thr ? "mismatch" : "match";
    // 관측 각도차의 불확실 구간이 임계를 걸치면 판정하지 않는다.
    if (best - s.courseAccuracy > p.thr) return "mismatch";
    if (best + s.courseAccuracy < p.thr) return "match";
    return "unknown";
  };
  let { state } = initialGuideState(route, 0);
  const buf: { t: number; v: Vote }[] = [];
  let perpAt: number | null = null;
  let courseAt: number | null = null;
  for (const s of samples) {
    const out = guideStep(state, s.fix, route, s.t, WALK_TUNING);
    state = out.state;
    if (out.event?.kind === "offRoute" && perpAt === null) perpAt = s.t;
    if (state.phase !== "following" && state.phase !== "bundle") {
      buf.length = 0;
      continue;
    }
    buf.push({ t: s.t, v: vote(s, state.d) });
    while (buf.length && buf[0].t <= s.t - p.window) buf.shift();
    const decisive = buf.filter((b) => b.v !== "unknown");
    if (
      courseAt === null &&
      decisive.length >= p.window * p.minFill &&
      decisive.filter((b) => b.v === "mismatch").length / decisive.length >= p.need
    ) {
      courseAt = s.t;
    }
  }
  return { perpAt, courseAt };
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

function evaluate(p: Params, n: Noise, seeds: number) {
  let fp = 0;
  let walks = 0;
  const now: number[] = [];
  const next: number[] = [];
  let win = 0;
  let tot = 0;
  let missed = 0;
  for (const { route } of ROUTES) {
    for (let s = 0; s < seeds; s++) {
      walks++;
      if (replay(route, makeTrajectory(route, s + 5000, n, null), p).courseAt !== null) fp++;
    }
    for (const atD of turnPoints(route).slice(0, 4)) {
      for (const deg of [-30, -45, -60, -90, 0, 120, 180]) {
        for (let s = 0; s < 3; s++) {
          const splitT = Math.round(atD / SPEED);
          const r = replay(route, makeTrajectory(route, s + 1, n, { atD, deg }), p);
          if (r.perpAt === null || r.perpAt < splitT) continue;
          tot++;
          const a = r.perpAt - splitT;
          const b = r.courseAt !== null && r.courseAt >= splitT ? Math.min(a, r.courseAt - splitT) : a;
          now.push(a);
          next.push(b);
          if (b < a) win++;
          else missed++;
        }
      }
    }
  }
  return { fp, walks, nowMed: med(now), nextMed: med(next), win, tot, missed };
}

/**
 * ⚠ **탐사 도구이지 계약 테스트가 아니다.** 단언 없이 표만 찍으므로 `.skip`으로 둔다
 * (게이트 시간을 쓰지 않는다). spec §3.1의 근거를 재현하려면 `.skip`을 떼고
 * `npx vitest run src/lib/__tests__/a6-probe.test.ts --reporter=verbose --silent=false`.
 *
 * 파라미터가 실기기 로그로 확정되면(spec §7 3단계) 이 파일은 단언을 가진 계약
 * 테스트로 승격하거나 삭제한다.
 */
describe.skip("A6 판정 축 탐사", () => {
  it("2-state 다수결 vs 3-state, 잡음 모델별", { timeout: 300000 }, () => {
    const base = { half: 15, window: 20, need: 0.7, back: 10, ahead: 10, minFill: 0.8 };
    const rows: string[] = [];
    rows.push("판정 | 잡음 | 헛경고(보행당) | 현행중앙 | 신규중앙 | 이긴비율");
    for (const [nName, n] of [["독립", CLEAN], ["지속편향", BIASED], ["가혹", HARSH]] as [string, Noise][]) {
      for (const [pName, p] of [
        ["2-state 다수결", { ...base, thr: 45, threeState: false }],
        ["3-state(불확실성)", { ...base, thr: 45, threeState: true }],
        ["3-state thr35", { ...base, thr: 35, threeState: true }],
      ] as [string, Params][]) {
        const r = evaluate(p, n, 60);
        rows.push(
          `${pName} | ${nName} | ${r.fp}/${r.walks} (${((r.fp / r.walks) * 100).toFixed(1)}%) | ` +
            `${r.nowMed}s | ${r.nextMed}s | ${r.win}/${r.tot}`,
        );
      }
    }
    console.log(rows.join("\n"));
  });
});
