/**
 * A6 탐사 하네스 — 실제 리듀서(guideStep)를 재생해 이탈 판정 축을 실측한다.
 * 재설계(2026-08-10) 반영: 방위 관측은 주입하지 않는다 — 리듀서 내부 유도기가
 * 궤적에서 만든다. 잡음은 궤적 좌표에만 넣는다.
 *
 * ⚠ 위치 잡음은 **상관 구조**(저주파 편향 + 소폭 독립 지터)로 넣는다. 실사용 로그가
 * 위치 오차의 대부분이 인접 fix에 공통 성분임을 실측했다(상대 잡음 중위 0.42m,
 * spec §3.0.2) — 독립 Gaussian 5m는 그 실측과 어긋나는 최악 가정이라 유도 방위를
 * 전부 unknown으로 만들고, 그 모델로 재면 "축이 안전하다"는 결론이 공회전한다
 * (codex 리뷰 15의 교훈이 위치 축으로 자리만 바꾼 것).
 *
 * ⚠ 상한 수치는 이 잡음 모델 아래의 회귀 기준이지 실기기 예측이 아니다(spec §6).
 * 실기기 리플레이 게이트는 `course-derivation-replay.test.ts`가 담당한다.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildGuideRoute,
  guideStep,
  initialGuideState,
  WALK_TUNING,
  type GuideRoute,
  type GuideTuning,
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
  fix: { lat: number; lng: number; accuracy: number };
}

interface Noise {
  /** fix별 독립 지터 σ(m) — 실측 인접 상대 잡음 중위 0.42m가 기준점(§3.0.2). */
  jitter: number;
  /** 저주파 공통 편향 진폭(m) — 캐년 반사·필터 드리프트 등 상관 성분. */
  biasAmp: number;
  /** 편향 주기(초). 짧을수록 chord에 남는 잔차가 커진다. */
  biasPeriod: number;
  accuracy: number;
}

const CLEAN: Noise = { jitter: 0.3, biasAmp: 3, biasPeriod: 60, accuracy: 10 };
const BIASED: Noise = { jitter: 0.6, biasAmp: 6, biasPeriod: 45, accuracy: 10 };
// ⚠ HARSH의 편향 드리프트 속도(2π·amp/period)는 보행 속도(1.2m/s) 미만이어야 한다.
// 그보다 빠른 매끄러운 드리프트는 "옆으로 끌려가는 보행"과 기하학적으로 동일해
// 어떤 위치 유도로도 구분 불가능하다(실측 상대 잡음 0.42m/s의 수 배가 스트레스 상한).
const HARSH: Noise = { jitter: 1.2, biasAmp: 6, biasPeriod: 40, accuracy: 12 };

function makeTrajectory(
  route: GuideRoute,
  seed: number,
  n: Noise,
  deviate: { atD: number; deg: number } | null,
): Sample[] {
  const { toLL, pointAt } = frame(route);
  const r = rng(seed);
  const phaseX = r() * Math.PI * 2;
  const phaseY = r() * Math.PI * 2;
  const out: Sample[] = [];
  let t = 0;
  let d = 0;
  const limit = deviate ? deviate.atD : route.totalMeters;
  const push = (p: XY) => {
    const bx = n.biasAmp * Math.sin((2 * Math.PI * t) / n.biasPeriod + phaseX);
    const by = n.biasAmp * Math.sin((2 * Math.PI * t) / n.biasPeriod + phaseY);
    out.push({
      t,
      fix: {
        ...toLL({ x: p.x + bx + gauss(r, n.jitter), y: p.y + by + gauss(r, n.jitter) }),
        accuracy: n.accuracy,
      },
    });
  };
  while (d < limit) {
    push(pointAt(d));
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
      push({ x: start.x + Math.sin(br) * SPEED * k, y: start.y + Math.cos(br) * SPEED * k });
      t += 1;
    }
  }
  return out;
}

const AXIS_OFF: GuideTuning = { ...WALK_TUNING, courseAxisEnabled: false };

/**
 * 궤적을 리듀서에 그대로 흘려 **첫 이탈 확정 시각**을 돌려준다.
 *
 * ⚠ **판정은 전부 실제 모듈이 한다** — 유도·표결·창·임계 전부. `axisActive`는
 * 프로파일 게이트(`courseAxisEnabled`)로만 가른다(관측 주입 경로는 시그니처에서
 * 소멸했다).
 */
function replay(route: GuideRoute, samples: Sample[], axisActive: boolean): number | null {
  let { state } = initialGuideState(route, 0);
  const tuning = axisActive ? WALK_TUNING : AXIS_OFF;
  for (const s of samples) {
    const out = guideStep(state, s.fix, route, s.t, tuning);
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
 * 계약 테스트. 실제 `guideStep`을 재생하므로 유도기·`guide-course-axis.ts`의
 * 상수·판정이 바뀌면 여기가 먼저 깨진다.
 *
 * ⚠ **상한과 잡음 모델은 잠정값이다**(spec §6). 실기기 로그로 파라미터가 확정되면
 * 이 수치를 함께 고친다. 지금 재는 것은 "실제 값이 얼마인가"가 아니라 "설계가
 * 상관 잡음에서 무너지지 않는가"다.
 */
describe("A6 방위 축 경로 재생 (유도 관측)", () => {
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

  it("가혹 조건에서도 무너지지 않는다 — 사슬 U가 지키는 것", { timeout: 300000 }, () => {
    const r = evaluate(HARSH, 40);
    expect(r.fp / r.walks).toBeLessThan(0.1);
  });
});
