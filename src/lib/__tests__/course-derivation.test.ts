import { describe, expect, it } from "vitest";
import {
  DERIVE_U_FLOOR_DEG,
  deriveCourse,
  INITIAL_DERIVATION_STATE,
  type CourseDerivationState,
  type DerivedCourse,
} from "../course-derivation";

// 위도 1도 ≈ 111,320m. 북쪽 이동은 lat만 늘린다(방위 0°=북).
const M_LAT = 1 / 111320;
const BASE = { lat: 37.5365, lng: 127.1469 };

/** north/east 미터 오프셋 시퀀스를 1초 간격으로 먹인다. */
function feed(
  offsets: Array<{ n: number; e: number; at: number }>,
): { state: CourseDerivationState; obs: DerivedCourse | null }[] {
  const mLng = M_LAT / Math.cos((BASE.lat * Math.PI) / 180);
  let state = INITIAL_DERIVATION_STATE;
  const out: { state: CourseDerivationState; obs: DerivedCourse | null }[] = [];
  for (const o of offsets) {
    const r = deriveCourse(
      state,
      { lat: BASE.lat + o.n * M_LAT, lng: BASE.lng + o.e * mLng },
      o.at,
    );
    state = r.state;
    out.push(r);
  }
  return out;
}

describe("deriveCourse", () => {
  it("누적 변위가 기저선 미달이면 관측이 없다", () => {
    const r = feed([
      { n: 0, e: 0, at: 0 },
      { n: 3, e: 0, at: 3 },
      { n: 6, e: 0, at: 6 },
    ]);
    expect(r.every((x) => x.obs === null)).toBe(true);
  });

  // ⚠ 오프셋 "미터"는 haversine(R=6371km) 기준으로 약 0.11% 작다(1도=111,194.9m).
  // 경계(기저선 10m·전진 2m)에 정확히 걸치는 시퀀스를 쓰지 말 것 — 아래 케이스는
  // 전부 경계에서 0.5m 이상 여유를 두고 설계했다.
  it("북으로 14m 직진이면 방위 0° 부근, U는 하한", () => {
    // 첫 방출은 chord가 기저선을 넘는 n=11 부근, 마지막 fix(n=14)는 그로부터
    // 3m 전진이라 전진 게이트를 확실히 통과한다.
    const r = feed(
      Array.from({ length: 15 }, (_, i) => ({ n: i, e: 0, at: i })),
    );
    const last = r[r.length - 1].obs;
    expect(last).not.toBeNull();
    expect(Math.abs(last!.bearing)).toBeLessThan(1.5);
    expect(last!.uncertaintyDeg).toBeCloseTo(DERIVE_U_FLOOR_DEG, 5);
  });

  it("굽은 사슬은 U가 팽창한다 (사슬 자기일관성)", () => {
    // 동으로 8m 간 뒤 북으로 8m: chord가 모퉁이를 가로지르는 시점에 중간
    // fix들이 chord에서 크게 벗어난다(maxDev ≈ 5m대 → U 30°대).
    const r = feed([
      ...Array.from({ length: 9 }, (_, i) => ({ n: 0, e: i, at: i })),
      ...Array.from({ length: 8 }, (_, i) => ({ n: i + 1, e: 8, at: i + 9 })),
    ]);
    const emitted = r.map((x) => x.obs).filter((o): o is DerivedCourse => o !== null);
    expect(emitted.length).toBeGreaterThan(0);
    expect(Math.max(...emitted.map((o) => o.uncertaintyDeg))).toBeGreaterThan(20);
  });

  it("전진 게이트: 직전 방출 지점에서 2m 미만이면 표를 내지 않는다", () => {
    const r = feed([
      ...Array.from({ length: 13 }, (_, i) => ({ n: i, e: 0, at: i })),
      { n: 12.5, e: 0, at: 13 }, // 직전 방출(n=11)에서 1.5m — 게이트
      { n: 14.5, e: 0, at: 14 }, // 직전 방출(n=11)에서 3.5m — 통과
    ]);
    expect(r[11].obs).not.toBeNull(); // 첫 방출(chord ≈ 11m ≥ 기저선)
    expect(r[12].obs).toBeNull(); // 1m 전진 — 게이트
    expect(r[13].obs).toBeNull();
    expect(r[14].obs).not.toBeNull();
  });

  it("기저선이 age 상한을 넘으면 관측이 사라진다", () => {
    const r = feed([
      ...Array.from({ length: 13 }, (_, i) => ({ n: i, e: 0, at: i })),
      { n: 12, e: 0, at: 50 }, // 38초 정지 — 과거 fix 전부 age>30
    ]);
    expect(r[13].obs).toBeNull();
    expect(r[13].state.fixes.length).toBe(1); // 버퍼도 잘려 있다
  });

  it("같은 timestamp 중복 fix는 교체한다", () => {
    const r = feed([
      { n: 0, e: 0, at: 0 },
      { n: 1, e: 0, at: 1 },
      { n: 1.2, e: 0, at: 1 },
    ]);
    expect(r[2].state.fixes.length).toBe(2);
  });
});
