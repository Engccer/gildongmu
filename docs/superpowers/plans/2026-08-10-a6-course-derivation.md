# A6 방위 축 관측 유도기 교체 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이탈 판정 방위 축의 관측 소스를 기기 보고 course에서 위치 이력 유도(chord + 사슬 자기일관성 U)로 교체한다.

**Architecture:** spec `docs/superpowers/specs/2026-08-09-off-route-course-axis-design.md`(재설계 2026-08-10 개정) §2.0·§2.9·§2.10·§4가 정본. 표결·창·latch(§2.2~2.8)는 무수정 유지하고 관측을 만드는 층만 교체한다. 유도기는 공유 순수 계층 한 곳(`course-derivation.ts` ↔ `CourseDerivation.swift`)에 두고 리듀서 상태가 fix 이력 버퍼를 소유하며, `guideStep`의 `course` 인자는 제거된다(플랫폼이 관측을 만들 수 없는 구조가 1선 방어).

**Tech Stack:** TypeScript(웹 `src/lib/`) + Swift(GildongmuKit) 미러, Vitest / Swift Testing, 공유 fixture `course-axis-scenarios.json`.

**구현 방식 판정(자율성 헌장 §구현 방식):** inline(executing-plans). 근거: 태스크 1→2→3→4가 시그니처 변경으로 강하게 순차 결합되고(같은 파일 연쇄 수정: `guide-course-axis.ts`·`route-guide.ts`), Kit 미러(태스크 7~8)는 웹 최종 형태 확정이 선행 조건이다. 리뷰는 판정과 무관하게 묶음별 서브에이전트로 분리한다.

## Global Constraints

- 커밋 이메일 `engccer@gmail.com`, 커밋 메시지·코드 주석 한국어, 함수·변수명 영어.
- `git add -A` 금지 — 의도 파일만 명시 pathspec으로 stage+commit.
- 웹 태스크 종료마다 `npm run test:run` green, Kit 태스크 종료마다 `cd ios/GildongmuKit && swift test` green.
- 마지막 태스크에서 `npm run build`도 통과해야 한다(Vitest green ≠ 타입 검사 통과 — 타입 오류는 build에서만 드러난다).
- 상수는 전부 **잠정값**이다(spec §6): `DERIVE_BASELINE_M=10`, `DERIVE_MAX_AGE_S=30`, `DERIVE_U_FLOOR_DEG=8`, `DERIVE_SLACK_M=1.5`, `DERIVE_ADVANCE_M=2`, `COURSE_AXIS_THRESHOLD_DEG=45`(60에서 변경 — §3.0.5 근거). 주석에 "⚠ 잠정값(spec §6·§7)"을 유지한다.
- `GuideTuning.courseAxisEnabled`(walk 전용)와 확정/해제·창 상수(`COURSE_AXIS_WINDOW_S=20` 등)는 건드리지 않는다.
- 실사용 로그 원본 `docs/superpowers/specs/logs/guide-diag-2026-08-09.log.gz`는 읽기 전용이다(수정·재압축 금지).

---

### Task 1: 유도기 순수 함수 `course-derivation.ts`

**Files:**
- Create: `src/lib/course-derivation.ts`
- Test: `src/lib/__tests__/course-derivation.test.ts`

**Interfaces:**
- Consumes: `haversineMeters(aLat, aLng, bLat, bLng)` (`src/lib/geo.ts`), `bearingDegrees(aLat, aLng, bLat, bLng)` (`src/lib/geo/bearing.ts`)
- Produces (후속 태스크 전부가 의존):
  ```ts
  export interface DerivedCourse { bearing: number; uncertaintyDeg: number; }
  export interface DerivationFix { lat: number; lng: number; at: number; }
  export interface CourseDerivationState {
    fixes: readonly DerivationFix[];
    lastEmit: { lat: number; lng: number } | null;
  }
  export const INITIAL_DERIVATION_STATE: CourseDerivationState;
  export function deriveCourse(
    state: CourseDerivationState,
    fix: { lat: number; lng: number },
    at: number,
  ): { state: CourseDerivationState; obs: DerivedCourse | null };
  export const DERIVE_BASELINE_M: number;   // 10
  export const DERIVE_MAX_AGE_S: number;    // 30
  export const DERIVE_U_FLOOR_DEG: number;  // 8
  export const DERIVE_SLACK_M: number;      // 1.5
  export const DERIVE_ADVANCE_M: number;    // 2
  ```

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/__tests__/course-derivation.test.ts`:

```ts
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

  it("북으로 12m 직진이면 방위 0° 부근, U는 하한", () => {
    const r = feed(
      Array.from({ length: 13 }, (_, i) => ({ n: i, e: 0, at: i })),
    );
    const last = r[r.length - 1].obs;
    expect(last).not.toBeNull();
    expect(Math.abs(last!.bearing)).toBeLessThan(1.5);
    expect(last!.uncertaintyDeg).toBeCloseTo(DERIVE_U_FLOOR_DEG, 5);
  });

  it("굽은 사슬은 U가 팽창한다 (사슬 자기일관성)", () => {
    // 동으로 8m 간 뒤 북으로 8m: chord는 북동, 중간 fix들이 chord에서 벗어난다.
    const r = feed([
      ...Array.from({ length: 9 }, (_, i) => ({ n: 0, e: i, at: i })),
      ...Array.from({ length: 8 }, (_, i) => ({ n: i + 1, e: 8, at: i + 9 })),
    ]);
    const last = r[r.length - 1].obs;
    expect(last).not.toBeNull();
    // maxDev ≈ 4m, chord ≈ 11.3m → atan((4+1.5)/11.3) ≈ 26°
    expect(last!.uncertaintyDeg).toBeGreaterThan(20);
  });

  it("전진 게이트: 직전 방출 지점에서 2m 미만이면 표를 내지 않는다", () => {
    const r = feed([
      ...Array.from({ length: 13 }, (_, i) => ({ n: i, e: 0, at: i })),
      { n: 12.5, e: 0, at: 13 }, // 0.5m 전진 — 게이트
      { n: 14.5, e: 0, at: 14 }, // 직전 방출(n=12)에서 2.5m — 통과
    ]);
    expect(r[12].obs).not.toBeNull();
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
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/__tests__/course-derivation.test.ts`
Expected: FAIL — `course-derivation` 모듈 없음.

- [ ] **Step 3: 구현**

`src/lib/course-derivation.ts`:

```ts
/**
 * 방위 축 관측 유도기(spec §2.0, 재설계 2026-08-10). 웹 ↔ Kit `CourseDerivation.swift` 미러.
 *
 * 기기 course는 GPS 도플러 기반이라 보행 속도에서 방위를 제공하지 않는다(실사용 로그:
 * courseAcc 중위 83°, 축 통과 0/281 — spec §3.0.1). 유도 방위는 fix 이력의 chord라
 * 조건이 속도가 아니라 누적 변위다. 위치 오차는 절대값(보고 acc 14.2m)이 아니라 상관이
 * 문제였고, 인접 fix 상대 잡음은 중위 0.42m라 변위에서 공통 성분이 소거된다(§3.0.2).
 *
 * ⚠ 사슬 U가 기기 courseAccuracy의 대체물이자 회전 보호다: 모퉁이에서 사슬이 굽어
 * U가 커지고 표가 자동으로 unknown이 된다. 잡음도 같은 경로로 스스로 unknown이 된다.
 *
 * ⚠ 전진 게이트가 없으면 정지 중 같은 chord가 반복 관측된다 — §2.1이 금지한
 * "같은 오차의 반복 집계"가 정지 상태에서 재발한다.
 */
import { haversineMeters } from "./geo";
import { bearingDegrees } from "./geo/bearing";

/** ⚠ 잠정값(spec §6·§7). 기저선 — 실사용 로그 스윕에서 10m 최적(§3.0.3). */
export const DERIVE_BASELINE_M = 10;
/** ⚠ 잠정값(spec §6·§7). 기저선 fix의 최대 나이. */
export const DERIVE_MAX_AGE_S = 30;
/** ⚠ 잠정값(spec §6·§7). 사슬 U 하한 — 완전 직선 사슬도 이만큼은 불확실하다. */
export const DERIVE_U_FLOOR_DEG = 8;
/** ⚠ 잠정값(spec §6·§7). 사슬 편차 여유 — 편차 0이어도 U에 반영되는 잡음 마진. */
export const DERIVE_SLACK_M = 1.5;
/** ⚠ 잠정값(spec §6·§7). 전진 게이트 — 이만큼 전진해야 새 표를 낸다. */
export const DERIVE_ADVANCE_M = 2;

export interface DerivedCourse {
  /** [0,360) 진행 방위. */
  bearing: number;
  /** 사슬 자기일관성 불확실성(도). */
  uncertaintyDeg: number;
}

export interface DerivationFix {
  lat: number;
  lng: number;
  at: number;
}

export interface CourseDerivationState {
  fixes: readonly DerivationFix[];
  /** 마지막으로 표를 방출한 위치(전진 게이트 기준점). */
  lastEmit: { lat: number; lng: number } | null;
}

export const INITIAL_DERIVATION_STATE: CourseDerivationState = {
  fixes: [],
  lastEmit: null,
};

/**
 * fix 하나를 버퍼에 반영하고, 가능하면 유도 관측을 낸다.
 *
 * 버퍼는 age 상한으로 자체 소멸하므로 경로 교체와 무관하다(궤적은 경로의 함수가
 * 아니다 — spec §2.9). 새 세션은 `INITIAL_DERIVATION_STATE`에서 시작한다.
 */
export function deriveCourse(
  state: CourseDerivationState,
  fix: { lat: number; lng: number },
  at: number,
): { state: CourseDerivationState; obs: DerivedCourse | null } {
  // 같은 timestamp는 교체, age 상한 밖은 절단(배치 도착·중복 fix 방어).
  const kept = state.fixes.filter((f) => f.at !== at && f.at > at - DERIVE_MAX_AGE_S);
  const fixes = [...kept, { lat: fix.lat, lng: fix.lng, at }];
  const next: CourseDerivationState = { fixes, lastEmit: state.lastEmit };

  // 기저선: chord 거리 ≥ B인 가장 가까운(최근) 과거 fix.
  let baseIdx = -1;
  for (let i = fixes.length - 2; i >= 0; i--) {
    if (haversineMeters(fixes[i].lat, fixes[i].lng, fix.lat, fix.lng) >= DERIVE_BASELINE_M) {
      baseIdx = i;
      break;
    }
  }
  if (baseIdx < 0) return { state: next, obs: null };

  // 전진 게이트(spec §2.0 규칙 4).
  if (
    next.lastEmit !== null &&
    haversineMeters(next.lastEmit.lat, next.lastEmit.lng, fix.lat, fix.lng) < DERIVE_ADVANCE_M
  ) {
    return { state: next, obs: null };
  }

  const base = fixes[baseIdx];
  const chord = haversineMeters(base.lat, base.lng, fix.lat, fix.lng);
  const bearing = bearingDegrees(base.lat, base.lng, fix.lat, fix.lng);

  // 사슬 자기일관성: 중간 fix들의 chord 수직 편차 최대(spec §2.0 규칙 3).
  let maxDev = 0;
  for (let i = baseIdx + 1; i < fixes.length - 1; i++) {
    const d = haversineMeters(base.lat, base.lng, fixes[i].lat, fixes[i].lng);
    if (d === 0) continue;
    const b = bearingDegrees(base.lat, base.lng, fixes[i].lat, fixes[i].lng);
    const dev = Math.abs(d * Math.sin(((b - bearing) * Math.PI) / 180));
    if (dev > maxDev) maxDev = dev;
  }
  const uncertaintyDeg = Math.max(
    DERIVE_U_FLOOR_DEG,
    (Math.atan((maxDev + DERIVE_SLACK_M) / chord) * 180) / Math.PI,
  );

  return {
    state: { fixes, lastEmit: { lat: fix.lat, lng: fix.lng } },
    obs: { bearing, uncertaintyDeg },
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/lib/__tests__/course-derivation.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/course-derivation.ts src/lib/__tests__/course-derivation.test.ts
git commit -m "feat(guide): 방위 축 관측 유도기 — chord+사슬 자기일관성 U (spec §2.0)" -- src/lib/course-derivation.ts src/lib/__tests__/course-derivation.test.ts
```

---

### Task 2: 표결 계층을 유도 관측으로 교체 (`guide-course-axis.ts`)

**Files:**
- Modify: `src/lib/guide-course-axis.ts`
- Modify: `src/lib/__tests__/fixtures/course-axis-scenarios.json`
- Modify: `src/lib/__tests__/guide-course-axis.test.ts`

**Interfaces:**
- Consumes: `DerivedCourse` (Task 1), `tangentAt`·`Polyline` (`route-geometry.ts`, 기존)
- Produces (Task 3·7이 의존):
  ```ts
  export const COURSE_AXIS_THRESHOLD_DEG = 45;  // 60에서 변경
  export function courseVote(
    obs: DerivedCourse | null,
    poly: Polyline,
    d: number,
  ): CourseVote;
  // recordVote·courseAxisVerdict·CourseVoteSample·CourseAxisVerdict는 무변경.
  // CourseObservation·INACTIVE_COURSE·COURSE_AXIS_MAX_ACCURACY_M은 삭제된다.
  ```

- [ ] **Step 1: fixture 개정**

`course-axis-scenarios.json`의 `votes` 배열을 유도 관측 모양으로 교체한다(임계 45° 기준으로 기대값 재계산). `comment`도 갱신:

```json
{
  "comment": "방위 축 표결·판정 경계표(유도 관측, 임계 45°). 웹 guide-course-axis.test.ts와 Kit GuideCourseAxisTests가 함께 소비한다(드리프트 가드). 경로는 남→북 직선 200m이므로 접선은 어디서나 0도다. d는 진행거리(m). bearing이 null이면 관측 없음.",
  "votes": [
    { "name": "나란함", "bearing": 5, "uncertainty": 10, "d": 100, "expect": "match" },
    { "name": "크게 어긋남", "bearing": 120, "uncertainty": 10, "d": 100, "expect": "mismatch" },
    { "name": "불확실성이 임계를 걸침", "bearing": 50, "uncertainty": 40, "d": 100, "expect": "unknown" },
    { "name": "경계 바로 안: Δ+U<45", "bearing": 20, "uncertainty": 20, "d": 100, "expect": "match" },
    { "name": "경계 바로 밖: Δ-U>45", "bearing": 100, "uncertainty": 50, "d": 100, "expect": "mismatch" },
    { "name": "bearing 범위 밖", "bearing": 360, "uncertainty": 5, "d": 100, "expect": "unknown" },
    { "name": "관측 없음", "bearing": null, "uncertainty": 0, "d": 100, "expect": "unknown" }
  ],
  "verdicts": <기존 verdicts 배열 그대로 유지>
}
```

⚠ 기존 `votes`의 "위치 부정확"(fixAcc 40) 행은 **삭제**한다 — 보고 acc 게이트 폐기(spec §2.10). `verdicts` 배열(창 판정 경계표)은 표결 이후 계층이라 무수정.

- [ ] **Step 2: 테스트를 새 시그니처로 수정하고 실패 확인**

`guide-course-axis.test.ts`에서 fixture 소비부를 새 필드로 바꾼다:

```ts
const vote = courseVote(
  row.bearing === null ? null : { bearing: row.bearing, uncertaintyDeg: row.uncertainty },
  straightPoly,
  row.d,
);
expect(vote).toBe(row.expect);
```

접선 무정의 케이스(중복 점 폴리라인 → unknown)는 기존 단위 테스트를 새 시그니처로 유지한다. `CourseObservation`·`INACTIVE_COURSE`·`fixAcc` 참조를 전부 제거한다.

Run: `npx vitest run src/lib/__tests__/guide-course-axis.test.ts`
Expected: FAIL — courseVote 시그니처 불일치.

- [ ] **Step 3: `guide-course-axis.ts` 구현 교체**

- `COURSE_AXIS_THRESHOLD_DEG = 45`로 변경, 주석: "⚠ 잠정값. 60은 기기 course의 두꺼운 꼬리(p90 51°)에 맞춘 값이었고 유도 방위(p90 30.8°)에서는 45°가 오표 0.4% 그대로 45° 갈림까지 검출한다(spec §3.0.5). 확정은 검증 보행."
- `COURSE_AXIS_MAX_ACCURACY_M` 삭제, 주석에 폐기 근거: "보고 acc는 실사용 로그에서 14.2m 동결(249/281)이라 판정 근거로 무의미 — 품질 증거는 사슬 U가 담는다(spec §2.10)."
- `CourseObservation`·`INACTIVE_COURSE` 삭제.
- 파일 헤더 주석의 "상수의 근거는 a6-probe" 문단을 "상수의 근거는 실사용 로그(spec §3.0, `docs/superpowers/specs/logs/`)와 리플레이 게이트 `course-derivation-replay.test.ts`" 로 교체.

```ts
import type { DerivedCourse } from "./course-derivation";

export function courseVote(
  obs: DerivedCourse | null,
  poly: Polyline,
  d: number,
): CourseVote {
  if (obs === null) return "unknown";
  const course = obs.bearing;
  // 유도기 계산값이라 범위가 보장되지만 방어로 유지한다(비용 0).
  if (!Number.isFinite(course) || course < 0 || course >= 360) return "unknown";
  if (!Number.isFinite(obs.uncertaintyDeg) || obs.uncertaintyDeg < 0) return "unknown";

  let best: number | null = null;
  for (let offset = -COURSE_AXIS_BACK_M; offset <= COURSE_AXIS_AHEAD_M; offset += SAMPLE_STEP_M) {
    const t = tangentAt(poly, d + offset, COURSE_AXIS_TANGENT_HALF_M);
    if (t === null) continue;
    const diff = angDiff(course, t);
    if (best === null || diff < best) best = diff;
  }
  if (best === null) return "unknown";

  if (best - obs.uncertaintyDeg > COURSE_AXIS_THRESHOLD_DEG) return "mismatch";
  if (best + obs.uncertaintyDeg < COURSE_AXIS_THRESHOLD_DEG) return "match";
  return "unknown";
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/lib/__tests__/guide-course-axis.test.ts`
Expected: PASS. ⚠ 이 시점에 `route-guide.ts`가 컴파일 오류로 다른 스위트를 깨는 것이 정상이다(Task 3에서 해소) — 전체 `test:run`은 Task 3 이후에 돌린다.

- [ ] **Step 5: 커밋**

```bash
git commit -m "feat(guide): courseVote를 유도 관측으로 교체 — 임계 45°, acc 게이트 폐기" -- src/lib/guide-course-axis.ts src/lib/__tests__/guide-course-axis.test.ts src/lib/__tests__/fixtures/course-axis-scenarios.json
```

⚠ 이 커밋은 빌드가 일시적으로 깨진 중간 상태다. Task 3 커밋과 묶어 push 전 green을 회복한다(push는 마일스톤 리뷰 뒤이므로 원격에 깨진 상태가 노출되지 않는다).

---

### Task 3: 리듀서 배선 (`route-guide.ts`)

**Files:**
- Modify: `src/lib/route-guide.ts` (import 블록 10~14행, `GuideState` ~277행, 초기 상태 ~376행, `guideStep` 시그니처 457~464행, 유도 삽입 465행 이후, 표결 지점 3곳 ~556·~626·~703행, 출력 diag ~635행)
- Modify: `src/lib/__tests__/route-guide.test.ts`, `src/lib/__tests__/course-axis-cadence.test.ts`, `src/lib/__tests__/a6-probe.test.ts`

**Interfaces:**
- Consumes: `deriveCourse`·`INITIAL_DERIVATION_STATE`·`CourseDerivationState`·`DerivedCourse` (Task 1), `courseVote` 새 시그니처 (Task 2)
- Produces (Task 4·7·8이 의존):
  ```ts
  // guideStep에서 course 인자가 제거된다:
  export function guideStep(state, fix, route, now, tuning): GuideOutput;
  // GuideState에 필드 추가:
  interface GuideState { /* 기존 */ courseDerivation: CourseDerivationState; }
  // GuideOutput diag 필드 추가(iOS GuideDiag가 소비):
  interface GuideOutput { /* 기존 courseVote?: CourseVote */ derivedCourse?: DerivedCourse | null; }
  ```

- [ ] **Step 1: 리듀서 테스트를 궤적 주도형으로 수정하고 실패 확인**

`route-guide.test.ts`의 방위 축 케이스는 지금 `CourseObservation`을 합성해 넘긴다. 유도 관측은 **궤적**에서만 나오므로, fix 시퀀스 생성 헬퍼를 테스트 파일에 추가하고 축 케이스를 그 위에서 재작성한다:

```ts
/** startD 지점에서 bearingDeg 방향으로 1m/s·1Hz 보행 fix를 만든다(경로는 남→북 직선). */
function walkFixes(
  start: { lat: number; lng: number },
  bearingDeg: number,
  seconds: number,
  startAt: number,
): Array<{ fix: GuideFix; at: number }> {
  const M_LAT = 1 / 111320;
  const mLng = M_LAT / Math.cos((start.lat * Math.PI) / 180);
  const rad = (bearingDeg * Math.PI) / 180;
  return Array.from({ length: seconds + 1 }, (_, i) => ({
    fix: {
      lat: start.lat + Math.cos(rad) * i * M_LAT,
      lng: start.lng + Math.sin(rad) * i * mLng,
      accuracy: 10,
    },
    at: startAt + i,
  }));
}
```

재작성 대상 케이스(이름은 기존 것 유지):
- **방위 축 확정**: 남→북 직선 경로 위에서 동쪽(90°)으로 60초 보행 → `offRouteAxes.course === true`인 `offRoute` 이벤트. 종전에는 mismatch 관측을 직접 주입했지만 이제 궤적이 90° 어긋나면 유도기가 mismatch를 만든다.
- **복귀 계약**(§2.5): 이탈 확정 후 북쪽(경로 방향)으로 40초 보행 → 창이 match로 채워진 뒤에만 `backOnRoute`.
- **복귀 지연 상한**: 기존 테스트 유지하되 궤적 주도로. `guide-course-axis.ts`의 `COURSE_AXIS_MIN_DECISIVE_RATIO` 주석이 이 테스트를 가리키므로 이름을 바꾸지 않는다.
- **latch 보존**(`uncertain` 경유): accuracy 급증 fix로 uncertain 진입 → 회복 → `offRouteAxes` 보존 확인(기존 로직 그대로, guideStep 인자만 수정).
- 나머지 케이스(거리 축·재획득·최종 접근 등)는 `INACTIVE_COURSE` 인자 삭제만 반영.

`course-axis-cadence.test.ts`(1Hz/10Hz/배치 동등 판정)도 관측 주입 대신 같은 궤적을 cadence만 바꿔 먹이는 형태로 수정한다 — 유도기는 timestamp 중복 교체·age 절단이 있어 cadence 불변이 **유도 층까지** 검증된다.

`a6-probe.test.ts`(합성 경로 5종 재생 하네스)는 course 잡음 주입부를 제거하고 **궤적 좌표에 위치 잡음만** 남긴다(유도기가 그 궤적에서 관측을 만든다). 헛경고 상한·검출 시각 상한 단언의 기준치는 첫 실행 실측으로 재고정하되, 상한의 자릿수가 종전(헛경고 수 %대·검출 초대)과 크게 다르면 멈추고 원인을 본다.

Run: `npx vitest run src/lib/__tests__/route-guide.test.ts`
Expected: FAIL — guideStep 시그니처·GuideState 필드 불일치.

- [ ] **Step 2: 리듀서 구현**

`route-guide.ts`:

1. import에서 `CourseObservation`·`INACTIVE_COURSE`·`courseVote` 정리, `deriveCourse`·`INITIAL_DERIVATION_STATE` 추가.
2. `GuideState`에 `courseDerivation: CourseDerivationState` 추가, 초기 상태(~376행 `courseVotes: []` 옆)와 상태 재구성 헬퍼(`guideStateAt`류가 있으면 거기도)에 `courseDerivation: INITIAL_DERIVATION_STATE` 추가.
3. `guideStep` 시그니처에서 `course: CourseObservation` 제거. 역순 시각 방어 **직후**에 유도를 넣는다:

```ts
  // 유도기 갱신은 국면과 무관하게 매 fix 1회 — 버퍼는 궤적의 사실이다(spec §2.9).
  // finalApproach·uncertain 조기 반환보다 앞이라 어느 국면에서도 버퍼가 이어진다.
  const dv = deriveCourse(state.courseDerivation, fix, now);
  state = { ...state, courseDerivation: dv.state };
  // 프로파일 게이트는 여기 한 곳뿐이다 — 조건을 하위 분기마다 흩으면 하나를
  // 빠뜨리고, 그 하나가 조용히 축을 살린다(기존 계약 유지).
  const derived = dv.obs !== null && tuning.courseAxisEnabled ? dv.obs : null;
```

기존 `const obs = tuning.courseAxisEnabled ? course : INACTIVE_COURSE;` 는 삭제.
4. 표결 3곳을 교체: `courseVote(obs, route.polyline, X, fix.accuracy)` → `courseVote(derived, route.polyline, X)` (X는 각각 기존의 `entryD`·`d`·`entry.d`).
5. 출력 diag(~635행 `courseVote: loggedVote` 옆)에 `derivedCourse: derived` 추가.

⚠ 3번에서 `state` 재대입 이후의 모든 반환 경로는 기존처럼 `...state` 스프레드를 쓰므로 버퍼가 자동 보존된다 — 조기 반환 경로에 별도 수정이 필요 없는지 각 return을 눈으로 확인한다(특히 uncertain 진입·finalApproach 가드의 `courseVotes: []`는 **창만** 비우는 것이 맞다).

- [ ] **Step 3: 통과 확인**

Run: `npm run test:run`
Expected: 전체 green (Task 2에서 깨졌던 스위트 포함).

- [ ] **Step 4: 커밋**

```bash
git commit -m "feat(guide): 리듀서가 유도 관측을 소유 — guideStep course 인자 제거" -- src/lib/route-guide.ts src/lib/__tests__/route-guide.test.ts src/lib/__tests__/course-axis-cadence.test.ts src/lib/__tests__/a6-probe.test.ts
```

---

### Task 4: 웹 어댑터 정리 (`useRouteGuide.ts`)

**Files:**
- Modify: `src/hooks/useRouteGuide.ts` (49행 import, ~996행 호출부, ~148·~836행 주석)

**Interfaces:**
- Consumes: `guideStep` 새 시그니처 (Task 3)
- Produces: 없음(말단 소비자)

- [ ] **Step 1: 수정**

- 49행 `import { INACTIVE_COURSE } ...` 삭제.
- ~996행 `guideStep(state, fix, route, now, tuning, INACTIVE_COURSE)` → `guideStep(state, fix, route, now, tuning)`.
- ~836행 주석("웹은 courseAccuracy 필드가 없어 §3.5 검토 #32…")을 교체: "방위 축은 위치 이력 유도라 웹에서도 켜진다(spec §4 재설계). 단 iOS 로그로만 검증됐으므로 웹 실보행 검증은 spec §7 3단계 관측 항목이다."
- ~148행 주석의 "실시간 방향이 나오지 않아(courseAccuracy…" 문구가 여전히 참인지 읽고, 방위 축과 무관한 소비자(맨몸 매핑) 이야기면 그대로 둔다.
- 다른 `guideStep` 호출자가 없는지 확인: `grep -rn "guideStep(" src ios --include="*.ts" --include="*.tsx" --include="*.swift"` — 웹은 이 훅뿐이어야 한다(iOS는 Task 8).

- [ ] **Step 2: 검증·커밋**

Run: `npm run test:run` → green.

```bash
git commit -m "feat(guide): 웹 방위 축 활성 — INACTIVE_COURSE 제거(플랫폼 갭 소멸)" -- src/hooks/useRouteGuide.ts
```

---

### Task 5: 실사용 로그 리플레이 게이트 테스트

**Files:**
- Create: `src/lib/__tests__/course-derivation-replay.test.ts`
- Read only: `docs/superpowers/specs/logs/guide-diag-2026-08-09.log.gz`

**Interfaces:**
- Consumes: `deriveCourse`·`INITIAL_DERIVATION_STATE` (Task 1), `courseVote`·`recordVote`·`courseAxisVerdict`·`COURSE_AXIS_THRESHOLD_DEG` (Task 2), `Polyline`(`route-geometry.ts`)
- Produces: 없음(게이트). spec §3.0 수치가 회귀 기준이다.

- [ ] **Step 1: 테스트 작성**

```ts
// @vitest-environment node
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  deriveCourse,
  INITIAL_DERIVATION_STATE,
  type CourseDerivationState,
} from "../course-derivation";
import { courseAxisVerdict, courseVote, recordVote } from "../guide-course-axis";
import { haversineMeters } from "../geo";
import type { Polyline } from "../route-geometry";

/**
 * 실사용 로그 리플레이 게이트(spec §5). 도보 281 fix(2026-08-09, 정상 추종)를
 * 유도기에 재생해 §3.0 실측 수치를 회귀 기준으로 잠근다.
 *
 * 접선 기준: 정상 추종 보행이므로 걸은 궤적 자체가 경로다 — 원 궤적으로 Polyline을
 * 만들어 실제 courseVote(tangentAt)를 태운다. 회전 시나리오의 d는 갈림 지점에서
 * +10m로 캡한다(이탈 후 투영이 갈림 부근에 머무는 근사).
 */
const LOG = path.join(
  process.cwd(),
  "docs/superpowers/specs/logs/guide-diag-2026-08-09.log.gz",
);

interface LogFix { t: number; lat: number; lng: number; }

function parseWalkSession(): LogFix[] {
  const text = gunzipSync(readFileSync(LOG)).toString("utf8");
  const re = /t=([\d.]+) lat=([\d.-]+) lng=([\d.-]+)/;
  const all: LogFix[] = [];
  for (const line of text.split("\n")) {
    const m = re.exec(line);
    if (m) all.push({ t: +m[1], lat: +m[2], lng: +m[3] });
  }
  // 세션 경계: t 역행 또는 120s 공백. 첫 세션이 도보다.
  const walk: LogFix[] = [all[0]];
  for (const f of all.slice(1)) {
    const prev = walk[walk.length - 1];
    if (f.t < prev.t || f.t > prev.t + 120) break;
    walk.push(f);
  }
  return walk;
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

describe("실사용 로그 리플레이 (spec §3.0 회귀 기준)", () => {
  const walk = parseWalkSession();
  const poly = toPolyline(walk);

  it("도보 세션을 식별한다", () => {
    expect(walk.length).toBe(281);
  });

  it("정상 추종: 가용률 ≥85%, 오표 ≤1%, U 중위 ≤20°, verdict off 없음", () => {
    let state: CourseDerivationState = INITIAL_DERIVATION_STATE;
    let samples: ReturnType<typeof recordVote> = [];
    let decisive = 0, mismatch = 0, withObs = 0;
    const us: number[] = [];
    walk.forEach((f, i) => {
      const r = deriveCourse(state, f, f.t);
      state = r.state;
      if (i < 15) return; // 워밍업(기저선 형성 전)은 분모에서 제외
      if (r.obs) {
        withObs++;
        us.push(r.obs.uncertaintyDeg);
      }
      const vote = courseVote(r.obs, poly, poly.cum[i]);
      samples = recordVote(samples, f.t, vote);
      if (vote !== "unknown") decisive++;
      if (vote === "mismatch") mismatch++;
      expect(courseAxisVerdict(samples)).not.toBe("off");
    });
    expect(withObs / (walk.length - 15)).toBeGreaterThanOrEqual(0.85);
    expect(mismatch / Math.max(1, decisive)).toBeLessThanOrEqual(0.01);
    us.sort((a, b) => a - b);
    expect(us[Math.floor(us.length / 2)]).toBeLessThanOrEqual(20);
  });

  it("합성 이탈 90°: 갈림 후 40초 안에 verdict off", () => {
    const t0 = walk[0].t + 120;
    const forkIdx = walk.findIndex((f) => f.t >= t0);
    const rotated = rotateAfter(walk, t0, 90);
    let state: CourseDerivationState = INITIAL_DERIVATION_STATE;
    let samples: ReturnType<typeof recordVote> = [];
    let confirmAt: number | null = null;
    rotated.forEach((f, i) => {
      const r = deriveCourse(state, f, f.t);
      state = r.state;
      // 이탈 후 투영은 갈림 부근에 머문다(근사) — d를 갈림+10m로 캡.
      const d = Math.min(poly.cum[i], poly.cum[forkIdx] + 10);
      const vote = courseVote(r.obs, poly, d);
      samples = recordVote(samples, f.t, vote);
      if (f.t >= t0 && confirmAt === null && courseAxisVerdict(samples) === "off") {
        confirmAt = f.t - t0;
      }
    });
    expect(confirmAt).not.toBeNull();
    expect(confirmAt!).toBeLessThanOrEqual(40);
  });
});
```

- [ ] **Step 2: 실행·기준치 확정**

Run: `npx vitest run src/lib/__tests__/course-derivation-replay.test.ts`
Expected: PASS. ⚠ 만약 수치가 상한을 넘으면 **상한을 늘리지 말고** 유도기 구현과 §3.0의 분석 스크립트(`docs/superpowers/specs/logs/a6-chain-u-replay.py`)를 대조해 구현 결함을 찾는다 — 상한은 spec 실측에서 왔다.

- [ ] **Step 3: 커밋**

```bash
git commit -m "test(guide): 실사용 로그 리플레이 게이트 — spec §3.0 수치를 회귀 기준으로" -- src/lib/__tests__/course-derivation-replay.test.ts
```

---

### Task 6: 변이 주입 검증 (spec §5 변이 7·8)

**Files:**
- 일시 수정 후 원복: `src/lib/course-derivation.ts`
- Modify(결과 기록): `docs/superpowers/plans/2026-08-10-a6-course-derivation.md` (이 파일의 아래 체크박스)

- [ ] **Step 1: 변이 7 — 전진 게이트 제거**

`deriveCourse`의 전진 게이트 블록(`if (next.lastEmit !== null && ...)`)을 주석 처리.
Run: `npx vitest run src/lib/__tests__/course-derivation.test.ts`
Expected: **FAIL** — "전진 게이트: 직전 방출 지점에서 2m 미만이면 표를 내지 않는다" 케이스.
원복 후 재실행 → PASS. 결과: [ ] 검출됨 / 실패한 테스트 이름: ______

- [ ] **Step 2: 변이 8 — 사슬 U 제거(고정 0°)**

`uncertaintyDeg` 계산을 `const uncertaintyDeg = 0;`로 교체.
Run: `npx vitest run src/lib/__tests__/course-derivation.test.ts src/lib/__tests__/course-derivation-replay.test.ts`
Expected: **FAIL** — U 하한·굽은 사슬 단위 케이스 + 리플레이 오표율(회전 구간 표가 mismatch로 넘어간다).
원복 후 재실행 → PASS. 결과: [ ] 검출됨 / 실패한 테스트 이름: ______

- [ ] **Step 3: 기존 변이 1~6 재확인(스폿 체크)**

시그니처 교체로 기존 검출력이 죽지 않았는지 2건만 재확인: 변이 5(최소 증거량 — `COURSE_AXIS_MIN_VOTES = 0`)와 변이 6(`finalApproach` 순서)은 각각 `guide-course-axis.test.ts` verdicts 경계표와 `route-guide.test.ts`가 깨야 한다. 깨지 않으면 해당 테스트를 보강하고 이 플랜에 기록한다.

- [ ] **Step 4: 변이 결과를 이 플랜 파일에 기입하고 커밋**

```bash
git commit -m "docs(plan): A6 유도기 변이 주입 검증 결과 기록" -- docs/superpowers/plans/2026-08-10-a6-course-derivation.md
```

---

### Task 7: Kit 미러 (`CourseDerivation.swift` + 축·리듀서)

**Files:**
- Create: `ios/GildongmuKit/Sources/GildongmuKit/CourseDerivation.swift`
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/GuideCourseAxis.swift`, `ios/GildongmuKit/Sources/GildongmuKit/RouteGuide.swift`
- Create: `ios/GildongmuKit/Tests/GildongmuKitTests/CourseDerivationTests.swift`
- Modify: `ios/GildongmuKit/Tests/GildongmuKitTests/GuideCourseAxisTests.swift`, `ios/GildongmuKit/Tests/GildongmuKitTests/RouteGuideTests.swift`
- Modify: `src/lib/__tests__/fixtures/course-axis-scenarios.json` (derivation 동조 케이스 추가 — 웹 테스트도 함께 소비)

**Interfaces:**
- Consumes: Task 1~3의 최종 형태(웹이 정본). Kit의 기존 기하 헬퍼를 재사용한다 — 먼저 `grep -rn "func bearingDegrees\|func haversineMeters" ios/GildongmuKit/Sources`로 이름·시그니처를 확인하고 없으면 `FinalApproach.swift`가 쓰는 것을 찾는다(자체 재구현 금지).
- Produces (Task 8이 의존):
  ```swift
  public struct DerivedCourse: Sendable, Equatable { public let bearing: Double; public let uncertaintyDeg: Double }
  public struct CourseDerivationState: Sendable, Equatable { /* fixes, lastEmit */ }
  public let initialDerivationState: CourseDerivationState
  public func deriveCourse(_ state: CourseDerivationState, lat: Double, lng: Double, at: Double)
      -> (state: CourseDerivationState, obs: DerivedCourse?)
  // guideStep(Swift)에서 course 인자 제거, GuideState에 courseDerivation 추가,
  // GuideOutput에 derivedCourse: DerivedCourse? 추가.
  ```

- [ ] **Step 1: 공유 fixture에 derivation 동조 케이스 추가**

`course-axis-scenarios.json`에 `derivation` 배열을 추가한다. 각 케이스는 fix 시퀀스를 먹인 뒤 **마지막 관측**을 두 플랫폼이 같은 허용오차로 단언한다(산술 드리프트 가드):

```json
"derivation": [
  {
    "name": "북 12m 직진 — 방위 0 부근, U 하한",
    "fixes": [ /* {lat, lng, at} 13개: Task 1 테스트의 직진 시퀀스를 실좌표로 */ ],
    "expect": { "bearingMin": -1.5, "bearingMax": 1.5, "uMin": 7.99, "uMax": 8.01 }
  },
  {
    "name": "굽은 사슬 — U 팽창",
    "fixes": [ /* 동 8m 후 북 8m 시퀀스 */ ],
    "expect": { "bearingMin": 30, "bearingMax": 60, "uMin": 20, "uMax": 45 }
  },
  { "name": "기저선 미달", "fixes": [ /* 6m 직진 */ ], "expect": null }
]
```

(bearingMin/Max가 음수인 케이스는 `((b+540)%360)-180` 정규화로 비교한다. fixes 좌표는 Task 1 테스트의 `feed` 산식으로 계산해 박는다 — 두 플랫폼이 같은 리터럴을 읽어야 하므로 코드 생성이 아니라 값을 적는다.)

웹 `course-derivation.test.ts`에 fixture 소비 블록을 추가하고 green 확인.

- [ ] **Step 2: Swift 유도기 + 실패하는 테스트**

`CourseDerivationTests.swift`: fixture의 `derivation` 배열을 로드해 재생(기존 `GuideCourseAxisTests`의 fixture 로드 방식을 그대로 따른다). 추가로 전진 게이트·age 절단·중복 timestamp 3건은 Task 1 단위 케이스를 Swift로 미러.

Run: `cd ios/GildongmuKit && swift test --filter CourseDerivationTests`
Expected: FAIL — 모듈 없음.

`CourseDerivation.swift` 구현: Task 1의 TypeScript를 1:1 이식(상수명 `deriveBaselineMeters = 10.0` 등 camelCase, 파일 헤더 주석에 "웹 `course-derivation.ts` 미러" 명시). 기하는 Step 1에서 확인한 Kit 헬퍼 재사용.

Run: `swift test --filter CourseDerivationTests` → PASS.

- [ ] **Step 3: GuideCourseAxis.swift 교체**

Task 2와 동형: `courseAxisThresholdDegrees = 45.0`, `CourseObservation`·`inactiveCourse`·`courseAxisMaxAccuracyMeters` 삭제, `courseVote(_ obs: DerivedCourse?, poly:, d:)` 시그니처, 헤더 주석 교체. `GuideCourseAxisTests.swift`를 개정된 fixture `votes`(bearing/uncertainty) 소비로 수정.

- [ ] **Step 4: RouteGuide.swift 리듀서 배선**

Task 3과 동형: `GuideState`에 `courseDerivation` 추가(초기값 `initialDerivationState`), `guideStep` course 인자 제거, 역순 시각 방어 직후 유도 삽입 + `tuning.courseAxisEnabled` 게이트 한 곳, 표결 3곳 교체, `GuideOutput.derivedCourse` 추가. `RouteGuideTests.swift`의 방위 축 케이스를 웹 Task 3 Step 1과 같은 궤적 주도형으로 수정(공유 trace fixture `route-guide-scenarios.json`에 course 관측 입력이 박혀 있으면 그 시나리오의 입력을 fix 궤적으로 바꾸고 웹 테스트와 기대 trace를 재동조한다 — 먼저 `grep -n "course" src/lib/__tests__/fixtures/route-guide-scenarios.json`으로 유무 확인).

- [ ] **Step 5: 전체 검증·커밋**

Run: `cd ios/GildongmuKit && swift test` → 전체 green. `npm run test:run` → green(fixture 공유 수정 반영).

```bash
git commit -m "feat(guide-ios): Kit 유도기 미러 + 방위 축 유도 관측 전환" -- ios/GildongmuKit/Sources/GildongmuKit/CourseDerivation.swift ios/GildongmuKit/Sources/GildongmuKit/GuideCourseAxis.swift ios/GildongmuKit/Sources/GildongmuKit/RouteGuide.swift ios/GildongmuKit/Tests/GildongmuKitTests/CourseDerivationTests.swift ios/GildongmuKit/Tests/GildongmuKitTests/GuideCourseAxisTests.swift ios/GildongmuKit/Tests/GildongmuKitTests/RouteGuideTests.swift src/lib/__tests__/fixtures/course-axis-scenarios.json src/lib/__tests__/course-derivation.test.ts
```

---

### Task 8: iOS 앱 배선 정리 (`BeaconModel.swift` + GuideDiag)

**Files:**
- Modify: `ios/Gildongmu/Directions/BeaconModel.swift` (~893~900행 courseObs 구성, ~900행·~1138행 guideStep 호출, ~922~931행 diag 로그 라인)

**Interfaces:**
- Consumes: Kit `guideStep` 새 시그니처, `GuideOutput.derivedCourse` (Task 7)
- Produces: 없음(말단). GuideDiag 로그 포맷이 바뀐다 — 다음 실보행 로그가 §7 3단계 판정 근거가 되므로 유도 관측 필드가 필수다.

- [ ] **Step 1: 수정**

- `CourseObservation` 구성 블록 삭제, `guideStep` 호출 2곳에서 course 인자 제거.
- diag 로그 라인 교체: 기존 `courseState=\(courseObs.state)` 자리를 `derived=\(bearing)/\(U)` 형태로. **기기 course·courseAcc 원시 필드는 남긴다** — 유도 방위와 기기 방위를 같은 로그에서 대조하는 것이 다음 검증 보행의 분석 축이다:

```swift
+ "course=\(String(format: "%.1f", fix.course)) "
+ "courseAcc=\(String(format: "%.1f", fix.courseAccuracy)) "
+ (out.derivedCourse.map {
    "derived=\(String(format: "%.1f", $0.bearing))±\(String(format: "%.1f", $0.uncertaintyDeg)) "
  } ?? "derived=- ")
```

- [ ] **Step 2: 컴파일·시뮬레이터 검증**

Kit 테스트는 Task 7에서 green. 앱 타깃 컴파일은 xcodebuildmcp-cli 스킬의 `simulator build-and-run` 절차로 확인한다(안내 세션은 실기기 검증 대상이므로 시뮬레이터는 빌드·기동 확인까지만).

- [ ] **Step 3: 커밋**

```bash
git commit -m "feat(guide-ios): BeaconModel 유도 관측 전환 + GuideDiag에 derived 필드" -- ios/Gildongmu/Directions/BeaconModel.swift
```

---

### Task 9: 문서 동조 + 최종 검증

**Files:**
- Modify: `docs/INTEGRATIONS.md` (183행 §이탈 판정 방위 축), `CLAUDE.md` (§UI·상태 패턴의 "이탈 판정은 축이 둘이고…" 불릿), `docs/BACKLOG.md` (A6 항목), `PROGRESS.md` (상태 줄)

- [ ] **Step 1: INTEGRATIONS.md §이탈 판정 방위 축 개정**

현행 절을 재설계 계약으로 교체한다. 반드시 담을 것: 관측=위치 이력 유도(`course-derivation.ts` ↔ `CourseDerivation.swift`), 사슬 U가 courseAccuracy 대체, 전진 게이트 2m의 존재 이유(정지 중 반복 집계 금지), 보고 acc 게이트 폐기 근거(14.2m 동결), 버퍼는 경로 교체와 무관·새 세션에서만 초기화, 웹 활성(단 웹 실보행 미검증), 임계 45° 잠정 근거, 리플레이 게이트 테스트 위치.

- [ ] **Step 2: CLAUDE.md 불릿 갱신**

"이탈 판정은 축이 둘이고 확정은 OR…" 불릿에서 `courseAccuracy` 관련 문구를 유도 관측으로 갱신하고, "`GuideTuning.courseAxisEnabled`로 walk만 켠다"는 유지하되 "웹은 입력이 없어 꺼진다"류 문구가 있으면 삭제한다. 새 함정 한 줄 추가: "유도기 버퍼·전진 게이트는 `course-derivation.ts` 한 곳 — 리듀서나 플랫폼에서 재구현 금지."

- [ ] **Step 3: BACKLOG A6 갱신 + PROGRESS 상태 줄**

A6에 "2026-08-10 유도기 구현 완료(웹·Kit·리플레이 게이트), 검증 보행 대기(spec §7 3단계)" 한 단락. PROGRESS의 실시간 안내 상태 줄이 있으면 방위 축 상태를 갱신(판별 질문: "지금도 참인가" — 서사는 쓰지 않는다).

- [ ] **Step 4: 최종 검증·커밋**

Run: `npm run test:run && npm run build && cd ios/GildongmuKit && swift test`
Expected: 전부 green.

```bash
git commit -m "docs(guide): A6 유도기 전환 문서 동조 — INTEGRATIONS·CLAUDE·BACKLOG·PROGRESS" -- docs/INTEGRATIONS.md CLAUDE.md docs/BACKLOG.md PROGRESS.md
```

---

## 구현 후 (플랜 밖, 순서만 명시)

1. **묶음 리뷰**: Task 1~6(웹) / Task 7~8(iOS) 두 묶음으로 서브에이전트 코드 리뷰(요구사항=spec §2.0·§2.9·§2.10·§4 + 이 플랜, 산출물=커밋 범위. 세션 히스토리 전달 금지, 커밋 SHA로 산출물 동결).
2. 리뷰 통과 → push(자동 배포) + 기기 연결 시 `CONFIGURATION=Experimental ./ios/deploy-device.sh`.
3. spec §7 3단계 검증 보행(위원장) → 상수 확정 → A6 종결 판정.
