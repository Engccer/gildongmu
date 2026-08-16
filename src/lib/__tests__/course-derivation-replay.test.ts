// @vitest-environment node
import { describe, expect, it } from "vitest";
import walkFixture from "./fixtures/guide-diag-2026-08-09-walk.json";
import {
  DERIVE_BASELINE_M,
  deriveCourse,
  INITIAL_DERIVATION_STATE,
  type CourseDerivationState,
} from "../course-derivation";
import {
  COURSE_AXIS_WINDOW_S,
  courseAxisVerdict,
  courseVote,
  recordVote,
  type CourseVoteSample,
} from "../guide-course-axis";
import { haversineMeters } from "../geo";
import type { Polyline } from "../route-geometry";

/**
 * 실사용 로그 리플레이 게이트(spec §5). 도보 281 fix(2026-08-09, 정상 추종)를
 * 유도기에 재생해 §3.0 실측 수치를 회귀 기준으로 잠근다.
 *
 * 접선 기준: 정상 추종 보행이므로 걸은 궤적 자체가 경로다 — 원 궤적으로 Polyline을
 * 만들어 실제 courseVote(tangentAt)를 태운다. 회전 시나리오의 d는 갈림 지점에서
 * +10m로 캡한다(이탈 후 투영이 갈림 부근에 머무는 근사).
 *
 * 표 기록은 리듀서와 같은 계약이다: 관측이 없으면 표를 내지 않고(spec §2.10 —
 * 표 없음) 창은 시간으로 낡는다. 가용률은 §3.0.3의 정의(기저선 확보 가능)로 잰다 —
 * 전진 게이트는 표 밀도 통제 장치라 가용률의 분자가 아니다.
 */
interface LogFix {
  t: number;
  lat: number;
  lng: number;
}

/**
 * fixture는 원본 `guide-diag-2026-08-09.log.gz`의 첫 세션(도보 281 fix)이다.
 * 원본 로그는 사생활(실제 이동 경로) 때문에 repo 밖에 보관하고, fixture는 경도를
 * 일정량 평행이동해 두었다 — haversine 거리와 방위는 경도 평행이동에 불변이라
 * 리플레이 수치는 원본과 동일하다.
 */
function parseWalkSession(): LogFix[] {
  return walkFixture.fixes;
}

function toPolyline(fixes: LogFix[]): Polyline {
  const points = fixes.map((f) => ({ lat: f.lat, lng: f.lng }));
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(
      cum[i - 1] +
        haversineMeters(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng),
    );
  }
  return { points, cum };
}

/** t0 이후 fix를 t0 시점 위치 중심으로 theta도 회전(합성 이탈, spec §3.0.5). */
function rotateAfter(fixes: LogFix[], t0: number, theta: number): LogFix[] {
  const M_LAT = 111320;
  const th = (theta * Math.PI) / 180;
  let pivot: LogFix | null = null;
  return fixes.map((f) => {
    if (f.t >= t0 && pivot === null) pivot = f;
    if (pivot === null || f.t < t0) return f;
    const mLng = M_LAT * Math.cos((pivot.lat * Math.PI) / 180);
    const dy = (f.lat - pivot.lat) * M_LAT;
    const dx = (f.lng - pivot.lng) * mLng;
    return {
      t: f.t,
      lat: pivot.lat + (dy * Math.cos(th) - dx * Math.sin(th)) / M_LAT,
      lng: pivot.lng + (dy * Math.sin(th) + dx * Math.cos(th)) / mLng,
    };
  });
}

/** 리듀서와 같은 표 기록 계약: 관측 없으면 표 없음 + 시간 절단. */
function stepVotes(
  samples: CourseVoteSample[],
  at: number,
  vote: ReturnType<typeof courseVote> | null,
): CourseVoteSample[] {
  return vote === null
    ? samples.filter((s) => s.at > at - COURSE_AXIS_WINDOW_S)
    : recordVote(samples, at, vote);
}

function pathAfter(fixes: LogFix[], t0: number, span: number): number {
  const i = fixes.findIndex((f) => f.t >= t0);
  const j = fixes.findIndex((f) => f.t >= t0 + span);
  if (i < 0 || j < 0) return 0;
  let d = 0;
  for (let k = i + 1; k <= j; k++) {
    d += haversineMeters(fixes[k - 1].lat, fixes[k - 1].lng, fixes[k].lat, fixes[k].lng);
  }
  return d;
}

/** i 지점의 양측 평활 기준 방위(±10m chord) — spec §3.0.3의 대조 기준과 동형. */
function refBearingAt(fixes: LogFix[], i: number): number | null {
  let back = -1;
  let fwd = -1;
  for (let j = i - 1; j >= 0; j--) {
    if (haversineMeters(fixes[j].lat, fixes[j].lng, fixes[i].lat, fixes[i].lng) >= 10) {
      back = j;
      break;
    }
  }
  for (let j = i + 1; j < fixes.length; j++) {
    if (haversineMeters(fixes[j].lat, fixes[j].lng, fixes[i].lat, fixes[i].lng) >= 10) {
      fwd = j;
      break;
    }
  }
  if (back < 0 || fwd < 0) return null;
  const rad = (x: number) => (x * Math.PI) / 180;
  const a = fixes[back];
  const b = fixes[fwd];
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * 합성 이탈의 갈림 시점: **이후 40초간 실제로 이동(≥40m)하고 원경로가 직선
 * (접선 변동 ≤30°)인 첫 지점**. 플랜 초안의 고정 +120s는 실보행의 정지 구간
 * (0.5m/s)에 걸렸다 — 정지 중엔 전진 게이트가 관측을 막으므로(설계 의도: 움직이지
 * 않는 사람은 잘못된 길을 걷고 있는 것이 아니다) 확정할 증거 자체가 없고, 회전
 * 직전 갈림은 90° 회전 궤적이 회전 후 도로와 나란해져 방위로 구분 불가하다
 * (진짜 평행 이탈과 동형 — spec §3.3). 두 배제 모두 결함이 아니라 axis의 정의역이다.
 */
function pickForkT0(fixes: LogFix[]): number {
  const angd = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
  for (let i = 0; i < fixes.length; i++) {
    const el = fixes[i].t - fixes[0].t;
    if (el < 60) continue;
    if (pathAfter(fixes, fixes[i].t, 40) < 40) continue;
    const j = fixes.findIndex((f) => f.t >= fixes[i].t + 40);
    if (j < 0) break;
    const bs: number[] = [];
    for (let k = i; k <= j; k++) {
      const r = refBearingAt(fixes, k);
      if (r !== null) bs.push(r);
    }
    let spread = 0;
    for (const a of bs) for (const b of bs) spread = Math.max(spread, angd(a, b));
    if (spread <= 30) return fixes[i].t;
  }
  throw new Error("이동+직선 구간 없음 — 로그가 바뀌었는가?");
}

describe("실사용 로그 리플레이 (spec §3.0 회귀 기준)", () => {
  const walk = parseWalkSession();
  const poly = toPolyline(walk);

  it("도보 세션을 식별한다", () => {
    expect(walk.length).toBe(281);
  });

  it("정상 추종: 가용률 ≥85%, 오표 ≤1%, U 중위 ≤20°, verdict off 없음", () => {
    let state: CourseDerivationState = INITIAL_DERIVATION_STATE;
    let samples: CourseVoteSample[] = [];
    let available = 0;
    let decisive = 0;
    let mismatch = 0;
    const us: number[] = [];
    walk.forEach((f, i) => {
      const r = deriveCourse(state, f, f.t);
      state = r.state;
      if (i < 15) return; // 워밍업(기저선 형성 전)은 분모에서 제외
      // 가용률(§3.0.3): 버퍼에 기저선 fix가 존재하는가(age 절단은 유도기가 이미 적용).
      const hasBaseline = r.state.fixes
        .slice(0, -1)
        .some((p) => haversineMeters(p.lat, p.lng, f.lat, f.lng) >= DERIVE_BASELINE_M);
      if (hasBaseline) available++;
      if (r.obs) us.push(r.obs.uncertaintyDeg);
      const vote = r.obs === null ? null : courseVote(r.obs, poly, poly.cum[i]);
      samples = stepVotes(samples, f.t, vote);
      if (vote !== null && vote !== "unknown") decisive++;
      if (vote === "mismatch") mismatch++;
      expect(courseAxisVerdict(samples)).not.toBe("off");
    });
    expect(available / (walk.length - 15)).toBeGreaterThanOrEqual(0.85);
    // spec §3.0.4의 실측은 "mismatch 오표 1표"다. 전진 게이트가 분모(표 수)를
    // 250→90여 개로 줄이므로 비율 대신 **절대 표 수**로 잠근다(같은 1표가 게이트
    // 유무에 따라 0.4%도 1.1%도 되는 분모 의존을 제거).
    expect(mismatch).toBeLessThanOrEqual(1);
    expect(decisive).toBeGreaterThanOrEqual(50); // 표가 말라 있으면 위 상한이 공회전한다
    us.sort((a, b) => a - b);
    expect(us[Math.floor(us.length / 2)]).toBeLessThanOrEqual(20);
  });

  it("합성 이탈 90°: 갈림 후 40초 안에 verdict off", () => {
    const t0 = pickForkT0(walk);
    const forkIdx = walk.findIndex((f) => f.t >= t0);
    const rotated = rotateAfter(walk, t0, 90);
    let state: CourseDerivationState = INITIAL_DERIVATION_STATE;
    let samples: CourseVoteSample[] = [];
    let confirmAt: number | null = null;
    rotated.forEach((f, i) => {
      const r = deriveCourse(state, f, f.t);
      state = r.state;
      // 이탈 후 투영은 갈림 부근에 머문다(근사) — d를 갈림+10m로 캡.
      const d = Math.min(poly.cum[i], poly.cum[forkIdx] + 10);
      const vote = r.obs === null ? null : courseVote(r.obs, poly, d);
      samples = stepVotes(samples, f.t, vote);
      if (f.t >= t0 && confirmAt === null && courseAxisVerdict(samples) === "off") {
        confirmAt = f.t - t0;
      }
    });
    expect(confirmAt).not.toBeNull();
    expect(confirmAt!).toBeLessThanOrEqual(40);
  });
});
