# 최종 접근 안내 (마지막 몇 미터) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 도보 경로가 끝나는 지점에서 목적지까지 남는 오프셋 구간(실측 16~89m)을 안내한다. 경로 추종을 종점까지 유지하고, 종점 도달 시 목적지의 배치를 1회 서술한 뒤 도착까지 짧은 주기 통지를 낸다.

**Architecture:** 오프셋의 거리·방향은 **경로 수신 시점에 결정론적으로 계산**되므로 GPS·나침반이 필요 없다(순수 함수 + 서버 응답 필드). 리듀서의 `handoff` 상태를 `finalApproach`로 대체하고 진입 조건을 "경로 잔여 ≤ 50m"에서 "경로 종점 도달"로 옮겨, 발화되는 모든 거리의 기준을 **현재 위치 → 목적지**로 통일한다. 실시간 상대 방향은 `course` 3-state 게이트를 통과할 때만 말한다.

**Tech Stack:** Next.js 16 / TypeScript / Vitest 4 / Swift 6 · Swift Testing(GildongmuKit) / SwiftUI

**설계 정본:** `docs/superpowers/specs/2026-08-08-final-approach-guidance-design.md`(커밋 `879f315`). 이 계획의 절 참조(§3.1 등)는 전부 그 문서를 가리킨다. 조사 원자료는 `docs/research/RESEARCH-2026-08-08-last-few-meters.md`.

**구현 방식 판정(헌장 §구현 방식 판정): inline 순차.** 근거 셋: ①**T1이 `FinalApproachGeometry`의 필드 이름·의미·3-state 표현을 정하고 T2~T10이 전부 그것에 의존**한다(선행 결정이 후속 인터페이스를 바꾼다) ②단일 도메인(도보 안내 한 계층)이고 수정 파일이 겹친다(T5·T7이 `route-guide.ts`를, T8·T10이 `BeaconModel.swift`를 함께 만진다) ③종점 도달 판정이 투영 불안정과 만나는 지점은 **실측으로 뒤집힐 수 있는 탐색적 배선**이다(spec §3.2가 그 대가를 명시했다). **리뷰는 이 판정과 무관하게 항상 분리한다**(T11).

---

## Global Constraints

- 커밋 이메일 `engccer@gmail.com`. 주석·커밋 메시지·문서 한국어, 변수·함수명 영어.
- **`git add -A`/`git add .` 금지.** 신규 파일이 있으면 `git add <files> && git commit -m "..." -- <paths>`를 **한 명령**으로 원자화한다(pathspec 모드는 미추적 파일을 못 잡는다). 커밋 직후 `git show HEAD --stat`로 의도 파일만 들었는지 검증.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- 기능·버그픽스는 **같은 커밋에 테스트 동반**. "나중에 추가" 금지.
- 게이트: `npm run test:run` · `npm run lint` · `npm run build` · Kit `swift test` · iOS `Experimental` 빌드. 매 태스크 끝에 관련 게이트를 돌린다. ⚠ **Vitest green ≠ 타입 검사 통과** — 타입 오류는 `npm run build`에서만 난다.
- **최종 접근은 ko 전용**이다(도보 경로 API가 V1 ko 전용). 새 i18n 키는 6개 로케일 파일 전부에 넣되(키 일관성 테스트가 머지 게이트), ko 외 값은 영문 번역을 둔다.
- **웹·Kit 순수 함수는 1:1 미러**이고 공유 JSON fixture가 동조를 강제한다. 한쪽만 고치면 드리프트 테스트가 깨져야 한다.
- **거리 포맷은 `formatDistance` 정본을 통과**시킨다(웹 `src/lib/format.ts` ↔ Kit `Format.swift` ↔ CLI 3벌 미러, `format-drift.test.ts`가 강제). 사다리(§3.6)는 **문구 선택 계층에만** 둔다.
- **임계 비교는 반올림 전 원거리**로 한다(§3.6, 검토 #28).
- 실시간 안내 iOS 코드는 `Experimental` 구성에서만 도달 가능하다. 실기기 배포는 `CONFIGURATION=Experimental ./ios/deploy-device.sh`.
- **spec §6의 상수 7종은 실보행 판정 전까지 동결**이다. 값을 바꾸지 말고 한 곳에 모아 근거 주석을 단다.

### 상수 (한 곳에 모으고 근거 주석)

| 상수 | 값 | 근거 |
|---|---|---|
| `OFFSET_MIN_M` | 10 | `roundCoord(…,4)` ±5.5m에서 방위가 뒤집힌다 |
| `BEARING_WINDOW_M` | 15 | §1.2 실측(마지막 세그먼트 단독은 판정이 뒤집혔다). 문헌 근거 없음 |
| `ARRIVAL_TOLERANCE_M` | `max(10, accuracy)` | 정확도보다 정밀한 종점 판정은 거짓 |
| `COURSE_ACC_MAX` | 45 | 4분할 버킷 반폭 |
| `COURSE_STALE_S` | 3 | Soundscape `FilteredCourseProvider` 워치독 |
| `COURSE_MIN_SPEED_MPS` | 0.4 | Soundscape 동일 |
| `FINAL_INTERVAL_S` | 15 | Sendero Getting Warmer |
| `ARRIVE_M` / `LEAVE_M` | 15 / 30 | Soundscape `enter`/`leaveImmediateVicinityDistance` |
| `LANDMARK_RADIUS_M` | 30 | §3.7 |

---

## File Structure

| 파일 | 책임 | 태스크 |
|---|---|---|
| `src/lib/final-approach.ts` **(신규)** | 종점 오프셋 기하 순수 함수 + 4분할 + 상수 | T1 |
| `src/lib/__tests__/final-approach.test.ts` **(신규)** | T1 단위 테스트 + fixture 소비 | T1·T2 |
| `src/lib/__tests__/fixtures/final-approach-scenarios.json` **(신규)** | 웹↔Kit 공유 경계표 | T2 |
| `ios/GildongmuKit/Sources/GildongmuKit/FinalApproach.swift` **(신규)** | T1 미러 | T2 |
| `ios/GildongmuKit/Tests/GildongmuKitTests/FinalApproachTests.swift` **(신규)** | fixture 소비 | T2 |
| `src/lib/types.ts` | `FinalApproachGeometry` + `WalkRouteBriefing.finalApproach?` | T3 |
| `src/app/api/route/walk/route.ts` | 원좌표로 매 요청 계산(캐시 밖) | T3 |
| `ios/GildongmuKit/Sources/GildongmuKit/Models/RouteModels.swift` | Swift 미러(선택 디코딩) | T3 |
| `src/lib/guide-course.ts` **(신규)** | 방향 3-state 판정 순수 함수 | T4 |
| `ios/GildongmuKit/Sources/GildongmuKit/GuideCourse.swift` **(신규)** | T4 미러 | T4 |
| `ios/Gildongmu/LocationService.swift` | `course`·`courseAccuracy` payload 추가 | T4 |
| `src/lib/route-guide.ts` | `handoff` → `finalApproach` 상태·진입 조건 | T5 |
| `ios/GildongmuKit/Sources/GildongmuKit/RouteGuide.swift` | T5 미러 | T6 |
| `src/lib/__tests__/fixtures/route-guide-scenarios.json` | 진입 조건 시나리오 추가 | T5·T6 |
| `messages/*.json`(6) · `ios/Gildongmu/Resources/Localizable.xcstrings` | 신규 문구 키 | T7 |
| `ios/Gildongmu/Directions/GuideText.swift` | 최종 접근 문장 조립 | T7 |
| `src/hooks/useRouteGuide.ts` | 웹 배선(진입 서술·주기·도착) | T9 |
| `ios/Gildongmu/Directions/BeaconModel.swift` | iOS 배선 | T8 |
| `src/lib/walk-infra.ts` 소비부 | 랜드마크 선택 | T10 |

---

## Task 1: 종점 오프셋 기하 (웹 순수 함수)

**Files:**
- Create: `src/lib/final-approach.ts`
- Create: `src/lib/__tests__/final-approach.test.ts`

**Interfaces:**
- Consumes: `GuideRoute`·`Polyline`·`Coord`(`src/lib/route-geometry.ts`), `haversineMeters`·`bearingDegrees`(`src/lib/geo/*`)
- Produces:
  - `export interface FinalApproachGeometry { offsetMeters: number; relativeBearing?: number; bearingUnavailable?: "tooClose" | "degenerateGeometry"; roadName?: string }`
  - `export function computeFinalApproach(route: GuideRoute, dest: Coord, roadName?: string): FinalApproachGeometry | null`
  - `export function relativeDirection(theta: number): "ahead" | "left" | "right" | "behind"`
  - `export const OFFSET_MIN_M = 10; export const BEARING_WINDOW_M = 15;`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// src/lib/__tests__/final-approach.test.ts
import { describe, it, expect } from "vitest";
import { buildGuideRoute } from "../route-geometry";
import { computeFinalApproach, relativeDirection } from "../final-approach";

/** 남→북 직선 100m 경로. lat 1도 ≈ 111320m. */
const northRoute = () =>
  buildGuideRoute([
    {
      description: "직진",
      pathCoords: [
        { lat: 37.5, lng: 127.1 },
        { lat: 37.5 + 100 / 111320, lng: 127.1 },
      ],
    },
  ])!;

const eastOf = (lat: number, lng: number, meters: number) => ({
  lat,
  lng: lng + meters / (111320 * Math.cos((lat * Math.PI) / 180)),
});

describe("computeFinalApproach", () => {
  it("북쪽으로 걸어와 동쪽 30m에 있는 목적지는 오른쪽", () => {
    const route = northRoute();
    const end = route.polyline.points[route.polyline.points.length - 1];
    const out = computeFinalApproach(route, eastOf(end.lat, end.lng, 30), "테스트로");
    expect(out).not.toBeNull();
    expect(out!.offsetMeters).toBeCloseTo(30, 0);
    expect(out!.relativeBearing).toBeCloseTo(90, 0);
    expect(relativeDirection(out!.relativeBearing!)).toBe("right");
    expect(out!.roadName).toBe("테스트로");
  });

  it("오프셋이 하한 미만이면 방향을 주장하지 않는다", () => {
    const route = northRoute();
    const end = route.polyline.points[route.polyline.points.length - 1];
    const out = computeFinalApproach(route, eastOf(end.lat, end.lng, 4));
    expect(out!.relativeBearing).toBeUndefined();
    expect(out!.bearingUnavailable).toBe("tooClose");
  });

  it("왕복 경로에서 각도를 산술 평균하지 않는다(+179/-179가 0°로 뒤집히지 않는다)", () => {
    // 북쪽 10m 간 뒤 남쪽 10m로 되돌아오는 경로: 벡터 합이 0에 수렴한다.
    const route = buildGuideRoute([
      {
        description: "왕복",
        pathCoords: [
          { lat: 37.5, lng: 127.1 },
          { lat: 37.5 + 10 / 111320, lng: 127.1 },
          { lat: 37.5, lng: 127.1 },
        ],
      },
    ])!;
    const out = computeFinalApproach(route, eastOf(37.5, 127.1, 30));
    expect(out!.relativeBearing).toBeUndefined();
    expect(out!.bearingUnavailable).toBe("degenerateGeometry");
  });

  it("창(15m)보다 짧은 경로는 전체를 쓴다", () => {
    const route = buildGuideRoute([
      {
        description: "짧은 직진",
        pathCoords: [
          { lat: 37.5, lng: 127.1 },
          { lat: 37.5 + 6 / 111320, lng: 127.1 },
        ],
      },
    ])!;
    const end = route.polyline.points[1];
    const out = computeFinalApproach(route, eastOf(end.lat, end.lng, 30));
    expect(out!.relativeBearing).toBeCloseTo(90, 0);
  });
});

describe("relativeDirection 경계 소유권", () => {
  it.each([
    [0, "ahead"],
    [45, "ahead"],
    [45.1, "right"],
    [-45, "ahead"],
    [-45.1, "left"],
    [135, "right"],
    [135.1, "behind"],
    [-135, "left"],
    [-135.1, "behind"],
    [180, "behind"],
    [-180, "behind"],
  ] as const)("%s도 → %s", (theta, expected) => {
    expect(relativeDirection(theta)).toBe(expected);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/lib/__tests__/final-approach.test.ts`
Expected: FAIL — `Failed to resolve import "../final-approach"`

- [ ] **Step 3: 구현한다**

```ts
// src/lib/final-approach.ts
/**
 * 경로 종점 → 목적지 오프셋 기하(spec 2026-08-08 §3.1). **정적 계산이라 GPS와 무관하다.**
 *
 * 이 값이 필요한 이유: 도보 경로는 목적지 좌표가 아니라 가장 가까운 보행로 지점에서
 * 끝난다(실측 16~89m). 그 구간이 곧 "마지막 몇 미터"이고, 거리·방향을 경로 수신
 * 시점에 확정할 수 있어 나침반·course 없이도 정직하게 말할 수 있다.
 */
import type { Coord } from "./types";
import type { GuideRoute } from "./route-geometry";
import { haversineMeters } from "./geo/haversine";
import { bearingDegrees } from "./geo/bearing";

/** 이 미만이면 방향을 주장하지 않는다 — roundCoord(…,4) ±5.5m에서 방위가 뒤집힌다. */
export const OFFSET_MIN_M = 10;
/** 종점 진행 방위를 평균할 역방향 창(m). 마지막 세그먼트 단독은 실측에서 판정이 뒤집혔다. */
export const BEARING_WINDOW_M = 15;

export interface FinalApproachGeometry {
  /** 경로 종점 → 목적지 직선거리(m), 반올림 전 원값. */
  offsetMeters: number;
  /** 종점 진행 방위 대비 목적지 상대각(-180~180, +우 -좌). */
  relativeBearing?: number;
  /** relativeBearing 부재 사유 — "모름"과 "실패"를 소비자가 가른다. */
  bearingUnavailable?: "tooClose" | "degenerateGeometry";
  /** 기준 도로명. 없으면 문장에서 기준절을 뺀다(지어내지 않는다). */
  roadName?: string;
}

/**
 * 4분할 경계 소유권. **부등호까지 계약이다** — 웹과 Swift가 각각 `>`와 `>=`를
 * 고르면 경계 좌표에서 서로 다른 방향을 말한다.
 */
export function relativeDirection(
  theta: number,
): "ahead" | "left" | "right" | "behind" {
  const a = Math.abs(theta);
  if (a <= 45) return "ahead";
  if (a <= 135) return theta > 0 ? "right" : "left";
  return "behind";
}

export function computeFinalApproach(
  route: GuideRoute,
  dest: Coord,
  roadName?: string,
): FinalApproachGeometry | null {
  const { points, cum } = route.polyline;
  if (points.length < 2) return null;
  const end = points[points.length - 1];
  const offsetMeters = haversineMeters(end.lat, end.lng, dest.lat, dest.lng);
  if (!Number.isFinite(offsetMeters)) return null;

  const base: FinalApproachGeometry = { offsetMeters, ...(roadName ? { roadName } : {}) };
  if (offsetMeters < OFFSET_MIN_M) {
    return { ...base, bearingUnavailable: "tooClose" };
  }

  // 종점에서 역방향으로 BEARING_WINDOW_M까지, 길이 가중 단위벡터 합.
  // ⚠ 각도를 산술 평균하지 않는다 — +179°와 -179°의 평균은 0°가 되어
  //   뒤쪽이 정면으로 뒤집힌다.
  const total = cum[cum.length - 1];
  const from = Math.max(0, total - BEARING_WINDOW_M);
  let sx = 0;
  let sy = 0;
  for (let i = points.length - 1; i > 0; i--) {
    const segLen = cum[i] - cum[i - 1];
    if (segLen <= 0) continue;
    const theta = (bearingDegrees(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng) * Math.PI) / 180;
    sx += segLen * Math.cos(theta);
    sy += segLen * Math.sin(theta);
    if (cum[i - 1] <= from) break;
  }
  if (Math.hypot(sx, sy) < 1e-9) {
    return { ...base, bearingUnavailable: "degenerateGeometry" };
  }
  const heading = ((Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360;
  const toDest = bearingDegrees(end.lat, end.lng, dest.lat, dest.lng);
  const relativeBearing = ((toDest - heading + 540) % 360) - 180;
  return { ...base, relativeBearing };
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run src/lib/__tests__/final-approach.test.ts`
Expected: PASS (모든 케이스)

`haversineMeters`의 실제 import 경로가 다르면(현재 `src/lib/geo/`에 있는지 확인) 그 경로로 맞춘다. `npm run build`로 타입까지 확인한다.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/final-approach.ts src/lib/__tests__/final-approach.test.ts && \
git commit -m "feat(guide): 종점 오프셋 기하 순수 함수

경로 종점→목적지 거리·상대각을 정적으로 계산한다(GPS 무관).
방위는 길이 가중 벡터 합이다 — 각도 산술 평균은 +179/-179를 0°로
만들어 뒤쪽을 정면으로 뒤집는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" \
-- src/lib/final-approach.ts src/lib/__tests__/final-approach.test.ts
git show HEAD --stat
```

---

## Task 2: Kit 미러 + 공유 fixture

**Files:**
- Create: `src/lib/__tests__/fixtures/final-approach-scenarios.json`
- Create: `ios/GildongmuKit/Sources/GildongmuKit/FinalApproach.swift`
- Create: `ios/GildongmuKit/Tests/GildongmuKitTests/FinalApproachTests.swift`
- Modify: `src/lib/__tests__/final-approach.test.ts`(fixture 소비 블록 추가)

**Interfaces:**
- Consumes: T1의 `computeFinalApproach`·`relativeDirection`·상수
- Produces: Swift `public func computeFinalApproach(route: GuideRoute, dest: RoutePoint, roadName: String?) -> FinalApproachGeometry?`, `public func relativeDirection(_ theta: Double) -> RelativeDirection`

- [ ] **Step 1: 공유 fixture를 쓴다**

```json
{
  "comment": "최종 접근 기하 경계표. 웹 final-approach.test.ts와 Kit FinalApproachTests가 함께 소비한다(드리프트 가드). 좌표 규약: lat = 37.5 + along/111320, lng = 127.1 + lateral/(111320·cos 37.5°). segments는 종점까지의 폴리라인 점을 (along, lateral) 미터로 준다. dest도 같은 좌표계.",
  "scenarios": [
    {
      "name": "북진 직선, 동쪽 30m 목적지 → 오른쪽",
      "segments": [[0, 0], [100, 0]],
      "dest": [100, 30],
      "expect": { "offsetMeters": 30, "relativeBearing": 90, "direction": "right" }
    },
    {
      "name": "북진 직선, 서쪽 30m 목적지 → 왼쪽",
      "segments": [[0, 0], [100, 0]],
      "dest": [100, -30],
      "expect": { "offsetMeters": 30, "relativeBearing": -90, "direction": "left" }
    },
    {
      "name": "북진 직선, 정북 30m 목적지 → 정면",
      "segments": [[0, 0], [100, 0]],
      "dest": [130, 0],
      "expect": { "offsetMeters": 30, "relativeBearing": 0, "direction": "ahead" }
    },
    {
      "name": "북진 직선, 남쪽 30m 목적지 → 뒤",
      "segments": [[0, 0], [100, 0]],
      "dest": [70, 0],
      "expect": { "offsetMeters": 30, "relativeBearing": 180, "direction": "behind" }
    },
    {
      "name": "오프셋 하한 미만 → tooClose",
      "segments": [[0, 0], [100, 0]],
      "dest": [100, 4],
      "expect": { "offsetMeters": 4, "bearingUnavailable": "tooClose" }
    },
    {
      "name": "왕복 경로 → degenerateGeometry (각도 산술 평균 금지 가드)",
      "segments": [[0, 0], [10, 0], [0, 0]],
      "dest": [0, 30],
      "expect": { "offsetMeters": 30, "bearingUnavailable": "degenerateGeometry" }
    },
    {
      "name": "창(15m)보다 짧은 경로는 전체를 쓴다",
      "segments": [[0, 0], [6, 0]],
      "dest": [6, 30],
      "expect": { "offsetMeters": 30, "relativeBearing": 90, "direction": "right" }
    },
    {
      "name": "마지막 세그먼트만 보면 뒤집히는 곡선 (창 평균이 정본)",
      "segments": [[0, 0], [40, 0], [42, 6]],
      "dest": [42, 36],
      "expect": { "direction": "right" }
    }
  ]
}
```

- [ ] **Step 2: 웹 테스트에 fixture 소비를 추가하고 실패를 확인한다**

```ts
// src/lib/__tests__/final-approach.test.ts 에 추가
import fixtures from "./fixtures/final-approach-scenarios.json";

const M_PER_DEG_LAT = 111320;
const mPerDegLng = 111320 * Math.cos((37.5 * Math.PI) / 180);
const toCoord = ([along, lateral]: number[]) => ({
  lat: 37.5 + along / M_PER_DEG_LAT,
  lng: 127.1 + lateral / mPerDegLng,
});

describe("공유 fixture (웹↔Kit 동조)", () => {
  for (const s of fixtures.scenarios) {
    it(s.name, () => {
      const route = buildGuideRoute([
        { description: "고정", pathCoords: s.segments.map(toCoord) },
      ])!;
      const out = computeFinalApproach(route, toCoord(s.dest));
      expect(out).not.toBeNull();
      if (s.expect.offsetMeters !== undefined) {
        expect(out!.offsetMeters).toBeCloseTo(s.expect.offsetMeters, 0);
      }
      if (s.expect.relativeBearing !== undefined) {
        expect(out!.relativeBearing).toBeCloseTo(s.expect.relativeBearing, 0);
      }
      if (s.expect.bearingUnavailable !== undefined) {
        expect(out!.bearingUnavailable).toBe(s.expect.bearingUnavailable);
        expect(out!.relativeBearing).toBeUndefined();
      }
      if (s.expect.direction !== undefined) {
        expect(relativeDirection(out!.relativeBearing!)).toBe(s.expect.direction);
      }
    });
  }
});
```

Run: `npx vitest run src/lib/__tests__/final-approach.test.ts`
Expected: 8개 fixture 케이스 PASS(T1 구현이 이미 맞다). 실패하면 T1을 고친다 — fixture가 정본이다.

- [ ] **Step 3: Kit 미러를 구현한다**

```swift
// ios/GildongmuKit/Sources/GildongmuKit/FinalApproach.swift
import Foundation

/// 경로 종점 → 목적지 오프셋 기하 — 웹 `src/lib/final-approach.ts`의 1:1 미러
/// (spec 2026-08-08 §3.1). 공유 fixture `final-approach-scenarios.json`이 동조를 강제한다.
///
/// **정적 계산이라 GPS와 무관하다.** 도보 경로는 목적지가 아니라 가장 가까운 보행로
/// 지점에서 끝나므로(실측 16~89m), 그 구간의 거리·방향을 경로 수신 시점에 확정한다.

/// 이 미만이면 방향을 주장하지 않는다 — 좌표 반올림 ±5.5m에서 방위가 뒤집힌다.
public let offsetMinMeters = 10.0
/// 종점 진행 방위를 평균할 역방향 창(m).
public let bearingWindowMeters = 15.0

public enum BearingUnavailable: String, Sendable, Equatable {
    case tooClose, degenerateGeometry
}

public enum RelativeDirection: String, Sendable, Equatable {
    case ahead, left, right, behind
}

public struct FinalApproachGeometry: Sendable, Equatable {
    public let offsetMeters: Double
    public let relativeBearing: Double?
    public let bearingUnavailable: BearingUnavailable?
    public let roadName: String?
}

/// 4분할 경계 소유권. **부등호까지 계약이다**(웹 `relativeDirection` 미러).
public func relativeDirection(_ theta: Double) -> RelativeDirection {
    let a = abs(theta)
    if a <= 45 { return .ahead }
    if a <= 135 { return theta > 0 ? .right : .left }
    return .behind
}

public func computeFinalApproach(
    route: GuideRoute, dest: RoutePoint, roadName: String? = nil
) -> FinalApproachGeometry? {
    let points = route.polyline.points
    let cum = route.polyline.cum
    guard points.count >= 2 else { return nil }
    let end = points[points.count - 1]
    let offset = haversineMeters(lat1: end.lat, lng1: end.lng, lat2: dest.lat, lng2: dest.lng)
    guard offset.isFinite else { return nil }

    if offset < offsetMinMeters {
        return FinalApproachGeometry(
            offsetMeters: offset, relativeBearing: nil,
            bearingUnavailable: .tooClose, roadName: roadName
        )
    }

    // 길이 가중 단위벡터 합. ⚠ 각도 산술 평균 금지(+179/-179 → 0°로 뒤집힘).
    let total = cum[cum.count - 1]
    let from = max(0, total - bearingWindowMeters)
    var sx = 0.0
    var sy = 0.0
    var i = points.count - 1
    while i > 0 {
        let segLen = cum[i] - cum[i - 1]
        if segLen > 0 {
            let theta = bearingDegrees(
                fromLat: points[i - 1].lat, fromLng: points[i - 1].lng,
                toLat: points[i].lat, toLng: points[i].lng
            ) * .pi / 180
            sx += segLen * cos(theta)
            sy += segLen * sin(theta)
        }
        if cum[i - 1] <= from { break }
        i -= 1
    }
    guard (sx * sx + sy * sy).squareRoot() >= 1e-9 else {
        return FinalApproachGeometry(
            offsetMeters: offset, relativeBearing: nil,
            bearingUnavailable: .degenerateGeometry, roadName: roadName
        )
    }
    let heading = (atan2(sy, sx) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360)
    let toDest = bearingDegrees(
        fromLat: end.lat, fromLng: end.lng, toLat: dest.lat, toLng: dest.lng
    )
    let rel = (toDest - heading + 540).truncatingRemainder(dividingBy: 360) - 180
    return FinalApproachGeometry(
        offsetMeters: offset, relativeBearing: rel,
        bearingUnavailable: nil, roadName: roadName
    )
}
```

⚠ Kit에 `bearingDegrees`가 없으면 웹 `src/lib/geo/bearing.ts`를 미러해 같은 파일에 추가한다(시그니처는 위 호출부 그대로). `haversineMeters`는 Kit에 이미 있다(`BeaconModel`이 쓴다).

- [ ] **Step 4: Kit 테스트를 쓰고 돌린다**

```swift
// ios/GildongmuKit/Tests/GildongmuKitTests/FinalApproachTests.swift
import Foundation
import Testing
@testable import GildongmuKit

private struct Scenario: Decodable {
    struct Expect: Decodable {
        let offsetMeters: Double?
        let relativeBearing: Double?
        let bearingUnavailable: String?
        let direction: String?
    }
    let name: String
    let segments: [[Double]]
    let dest: [Double]
    let expect: Expect
}
private struct Fixture: Decodable { let scenarios: [Scenario] }

private let mPerDegLat = 111320.0
private let mPerDegLng = 111320.0 * cos(37.5 * .pi / 180)
private func toPoint(_ v: [Double]) -> RoutePoint {
    RoutePoint(lat: 37.5 + v[0] / mPerDegLat, lng: 127.1 + v[1] / mPerDegLng)
}

@Test("공유 fixture 동조")
func finalApproachMatchesSharedFixture() throws {
    // fixture 경로는 Kit 테스트가 웹 fixture를 읽는 기존 관례를 그대로 따른다
    // (RouteGuideTests가 route-guide-scenarios.json을 읽는 방식과 동일).
    let url = sharedFixtureURL("final-approach-scenarios.json")
    let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    for s in fixture.scenarios {
        let route = try #require(buildGuideRoute([
            GuideStepGeometry(description: "고정", pathCoords: s.segments.map(toPoint))
        ]))
        let out = try #require(computeFinalApproach(route: route, dest: toPoint(s.dest)))
        if let want = s.expect.offsetMeters {
            #expect(abs(out.offsetMeters - want) < 1.0, "\(s.name) 오프셋")
        }
        if let want = s.expect.relativeBearing {
            #expect(abs(out.relativeBearing! - want) < 1.0, "\(s.name) 상대각")
        }
        if let want = s.expect.bearingUnavailable {
            #expect(out.bearingUnavailable?.rawValue == want, "\(s.name) 부재 사유")
            #expect(out.relativeBearing == nil, "\(s.name) 상대각은 비어야 한다")
        }
        if let want = s.expect.direction {
            #expect(relativeDirection(out.relativeBearing!).rawValue == want, "\(s.name) 방향")
        }
    }
}
```

Run: `cd ios/GildongmuKit && swift test --filter FinalApproach`
Expected: PASS. `sharedFixtureURL` 헬퍼가 없으면 `RouteGuideTests`가 fixture를 읽는 방식을 그대로 복사해 쓴다.

- [ ] **Step 5: 변이 주입으로 검출력을 확인한다**

Kit `FinalApproach.swift`의 벡터 합을 **각도 산술 평균**으로 임시 교체한 뒤 `swift test --filter FinalApproach`를 돌린다.
Expected: "왕복 경로 → degenerateGeometry" 케이스가 FAIL. 확인 후 되돌린다.

- [ ] **Step 6: 커밋**

```bash
git add src/lib/__tests__/fixtures/final-approach-scenarios.json ios/GildongmuKit/Sources/GildongmuKit/FinalApproach.swift ios/GildongmuKit/Tests/GildongmuKitTests/FinalApproachTests.swift && \
git commit -m "feat(guide): 최종 접근 기하 Kit 미러 + 공유 fixture

웹↔Kit 동조를 8개 경계 시나리오로 강제한다. 변이 주입으로 검출력 확인:
각도 산술 평균으로 되돌리면 왕복 경로 케이스가 깨진다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" \
-- src/lib/__tests__/fixtures/final-approach-scenarios.json src/lib/__tests__/final-approach.test.ts ios/GildongmuKit/Sources/GildongmuKit/FinalApproach.swift ios/GildongmuKit/Tests/GildongmuKitTests/FinalApproachTests.swift
git show HEAD --stat
```

---

## Task 3: 서버 배선 (타입 + 라우트 계산 + 실호출 게이트)

**Files:**
- Modify: `src/lib/types.ts`(`WalkRouteBriefing`)
- Modify: `src/app/api/route/walk/route.ts`
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/Models/RouteModels.swift`
- Test: `src/app/api/__tests__/walk-final-approach.test.ts` **(신규)**

**Interfaces:**
- Consumes: T1 `computeFinalApproach`·`FinalApproachGeometry`
- Produces: `WalkRouteBriefing.finalApproach?: FinalApproachGeometry`(웹), Swift `WalkRouteBriefing.finalApproach: FinalApproachPayload?`

⚠ **캐시 계약**(spec §3.1, 검토 #14): `finalApproach`를 **provider 응답에 넣지 않는다.** provider URL이 `roundCoord(…,4)`로 반올림된 목적지를 쓰므로 같은 셀의 다른 목적지가 캐시 엔트리를 공유한다. **라우트 핸들러가 요청받은 원좌표로 매 요청 계산**한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// src/app/api/__tests__/walk-final-approach.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/walk-route", () => ({ getWalkRoute: vi.fn() }));
vi.mock("@/lib/env", () => ({ hasWalkRouteKey: () => true }));
vi.mock("@/lib/rate-limit", () => ({
  checkWalkRateLimit: () => true,
  clientIpFromHeaders: () => "test",
}));

import { getWalkRoute } from "@/lib/walk-route";
import { GET } from "../route/walk/route";
import { NextRequest } from "next/server";

/** 종점이 (37.5,127.1), 목적지가 그 동쪽 30m인 응답을 흉내낸다. */
const briefingWithGeometry = () => ({
  distanceMeters: 100,
  durationSeconds: 90,
  steps: [
    {
      description: "성내로를 따라 100m 이동",
      distanceMeters: 100,
      pathCoords: [
        { lat: 37.5 - 100 / 111320, lng: 127.1 },
        { lat: 37.5, lng: 127.1 },
      ],
    },
  ],
});

const destEast30 = {
  lat: 37.5,
  lng: 127.1 + 30 / (111320 * Math.cos((37.5 * Math.PI) / 180)),
};

const call = (dest: { lat: number; lng: number }) =>
  GET(
    new NextRequest(
      `https://x/api/route/walk?origin=37.499,127.1&dest=${dest.lat},${dest.lng}&includeGeometry=1`,
    ),
  );

describe("GET /api/route/walk finalApproach", () => {
  beforeEach(() => vi.mocked(getWalkRoute).mockResolvedValue(briefingWithGeometry() as never));

  it("요청받은 원좌표로 계산해 응답에 싣는다", async () => {
    const body = await (await call(destEast30)).json();
    expect(body.result.finalApproach.offsetMeters).toBeCloseTo(30, 0);
    expect(body.result.finalApproach.relativeBearing).toBeCloseTo(90, 0);
  });

  it("같은 반올림 셀의 다른 목적지가 다른 값을 받는다(캐시 공유 금지)", async () => {
    const a = await (await call(destEast30)).json();
    const nearby = { lat: destEast30.lat, lng: destEast30.lng + 0.00003 };
    const b = await (await call(nearby)).json();
    expect(a.result.finalApproach.offsetMeters).not.toBeCloseTo(
      b.result.finalApproach.offsetMeters,
      3,
    );
  });

  it("기하가 없으면 필드를 싣지 않는다", async () => {
    vi.mocked(getWalkRoute).mockResolvedValue({
      distanceMeters: 100,
      durationSeconds: 90,
      steps: [{ description: "x", distanceMeters: 100 }],
    } as never);
    const body = await (await call(destEast30)).json();
    expect(body.result.finalApproach).toBeUndefined();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/app/api/__tests__/walk-final-approach.test.ts`
Expected: FAIL — `finalApproach`가 undefined

- [ ] **Step 3: 타입과 라우트를 구현한다**

```ts
// src/lib/types.ts — WalkRouteBriefing에 추가
  /**
   * 경로 종점 → 목적지 오프셋 기하(실시간 안내 최종 접근용, spec 2026-08-08 §3.1).
   * `includeGeometry=1` ∧ 기하 조립 성공일 때만 존재한다.
   * ⚠ **라우트 핸들러가 요청 원좌표로 계산해 싣는다** — provider 캐시에 넣으면
   * roundCoord(…,4)로 뭉친 셀이 값을 공유해 다른 목적지의 방향을 말한다.
   */
  finalApproach?: FinalApproachGeometry;
```

```ts
// src/app/api/route/walk/route.ts — 응답 직전에 부착
import { buildGuideRoute } from "@/lib/route-geometry";
import { computeFinalApproach } from "@/lib/final-approach";

// … getWalkRoute 호출 후, NextResponse.json(...) 직전:
const withFinalApproach = (() => {
  if (!briefing || !parsed.data.includeGeometry) return briefing;
  const guide = buildGuideRoute(
    briefing.steps.map((s) => ({ description: s.description, pathCoords: s.pathCoords })),
  );
  if (!guide) return briefing;
  // 마지막 스텝 설명에서 도로명을 뽑지 않는다(파싱 규칙이 provider 문장에 종속된다).
  // roadName은 T7에서 별도로 정한다 — 지금은 생략이 정직하다.
  const fa = computeFinalApproach(guide, parsed.data.dest);
  return fa ? { ...briefing, finalApproach: fa } : briefing;
})();
```

```swift
// ios/GildongmuKit/Sources/GildongmuKit/Models/RouteModels.swift — WalkRouteBriefing에 추가
    /// 경로 종점 → 목적지 오프셋 기하(spec 2026-08-08 §3.1).
    /// ⚠ **선택 필드로 디코딩한다** — 필수로 두면 구버전 응답에서 브리핑 전체가 실패한다.
    public let finalApproach: FinalApproachPayload?

/// 서버 `FinalApproachGeometry`의 디코딩 표면. Kit 계산 타입과 분리한 이유는
/// 서버가 사유 문자열에 넷째 값을 추가해도 디코딩이 죽지 않게 하기 위해서다
/// (`stepFree` 원시 문자열 디코딩과 같은 규율).
public struct FinalApproachPayload: Codable, Sendable, Hashable {
    public let offsetMeters: Double
    public let relativeBearing: Double?
    public let bearingUnavailable: String?
    public let roadName: String?

    public var unavailableReason: BearingUnavailable? {
        bearingUnavailable.flatMap(BearingUnavailable.init(rawValue:))
    }
}
```

- [ ] **Step 4: 통과와 게이트를 확인한다**

Run: `npx vitest run src/app/api/__tests__/walk-final-approach.test.ts && npm run build`
Expected: PASS + 타입 통과

- [ ] **Step 5: 실호출 게이트**

```bash
for d in "37.5301933,127.1237925" "37.5360335,127.1353994" "37.5546047,127.1559873" "37.5385091,127.1448155"; do
  curl -s "https://gildongmu.dodoplanet.space/api/route/walk?origin=37.5380,127.1430&dest=$d&includeGeometry=1" \
    | python3 -c "import json,sys; r=json.load(sys.stdin)['result']; fa=r.get('finalApproach'); print(fa)"
  sleep 7
done
```

⚠ **프로덕션은 아직 이 코드가 없다.** 로컬 `npm run dev`에 대고 돌린다(`http://localhost:3000`). Expected: 4건 모두 `offsetMeters`가 spec §1.2 표(16.1 / 31.0 / 48.6 / 89.4)와 ±2m 이내, `relativeBearing` 부호가 표와 일치.

- [ ] **Step 6: 커밋**

```bash
git add src/app/api/__tests__/walk-final-approach.test.ts && \
git commit -m "feat(api): 도보 응답에 finalApproach 부착 (원좌표·캐시 밖)

provider URL은 roundCoord(…,4)로 목적지를 뭉치므로 같은 셀의 다른 목적지가
캐시를 공유한다. 라우트 핸들러가 요청 원좌표로 매 요청 계산한다.
Swift는 선택 필드로 디코딩한다(구버전 응답에서 브리핑 전체 실패 방지).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" \
-- src/lib/types.ts src/app/api/route/walk/route.ts src/app/api/__tests__/walk-final-approach.test.ts ios/GildongmuKit/Sources/GildongmuKit/Models/RouteModels.swift
git show HEAD --stat
```

---

## Task 4: 방향 3-state 판정 + iOS course payload

**Files:**
- Create: `src/lib/guide-course.ts`
- Create: `src/lib/__tests__/guide-course.test.ts`
- Create: `ios/GildongmuKit/Sources/GildongmuKit/GuideCourse.swift`
- Create: `ios/GildongmuKit/Tests/GildongmuKitTests/GuideCourseTests.swift`
- Modify: `ios/Gildongmu/LocationService.swift`

**Interfaces:**
- Produces:
  - `export type CourseState = { kind: "valid"; course: number } | { kind: "unknown" } | { kind: "invalid" }`
  - `export function courseStep(input: { course: number; courseAccuracy: number; speed: number; motion: "moving" | "stopped" | "speedUnknown"; ageSeconds: number }): CourseState`
  - Swift `public func courseStep(...) -> CourseState`(동형)
  - `LocationService.BeaconFixPayload`에 `course: Double`·`courseAccuracy: Double`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// src/lib/__tests__/guide-course.test.ts
import { describe, it, expect } from "vitest";
import { courseStep, COURSE_ACC_MAX } from "../guide-course";

const base = {
  course: 90,
  courseAccuracy: 10,
  speed: 1.2,
  motion: "moving" as const,
  ageSeconds: 1,
};

describe("courseStep", () => {
  it("모든 게이트를 통과하면 유효", () => {
    expect(courseStep(base)).toEqual({ kind: "valid", course: 90 });
  });

  it("course 음수는 실패(모름이 아니다)", () => {
    expect(courseStep({ ...base, course: -1 }).kind).toBe("invalid");
  });

  it("courseAccuracy 음수는 실패", () => {
    expect(courseStep({ ...base, courseAccuracy: -1 }).kind).toBe("invalid");
  });

  it("courseAccuracy가 버킷 반폭을 넘으면 모름 — 존재만 확인하면 120도도 통과한다", () => {
    expect(courseStep({ ...base, courseAccuracy: COURSE_ACC_MAX + 0.1 }).kind).toBe("unknown");
    expect(courseStep({ ...base, courseAccuracy: COURSE_ACC_MAX }).kind).toBe("valid");
  });

  it("정지 상태는 모름", () => {
    expect(courseStep({ ...base, motion: "stopped" }).kind).toBe("unknown");
    expect(courseStep({ ...base, motion: "speedUnknown" }).kind).toBe("unknown");
  });

  it("속도 하한 미달은 모름", () => {
    expect(courseStep({ ...base, speed: 0.39 }).kind).toBe("unknown");
  });

  it("3초 워치독 만료는 모름", () => {
    expect(courseStep({ ...base, ageSeconds: 3.1 }).kind).toBe("unknown");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/__tests__/guide-course.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

```ts
// src/lib/guide-course.ts
/**
 * 진행 방향(course) 3-state 판정(spec 2026-08-08 §3.5). 웹 ↔ Kit `GuideCourse.swift` 미러.
 *
 * ⚠ **`courseAccuracy >= 0`은 값의 존재만 확인한다** — 120°도 통과해 "왼쪽"을 말하는데
 * 실제 목적지는 오른쪽일 수 있다. 4분할 버킷 반폭(45°)이 품질 게이트다.
 *
 * ⚠ **모름과 실패는 사용자 출력에서 같다**(둘 다 방향 어절 제거). 취해야 할 행동이
 * 같기 때문이며, 톤 `unreliable`의 "원인이 아니라 상태를 뜻한다" 계약과 같은 판단이다.
 * 구분은 로그·진단에만 남긴다.
 */
export const COURSE_ACC_MAX = 45;
export const COURSE_STALE_S = 3;
export const COURSE_MIN_SPEED_MPS = 0.4;

export type CourseState =
  | { kind: "valid"; course: number }
  | { kind: "unknown" }
  | { kind: "invalid" };

export function courseStep(input: {
  course: number;
  courseAccuracy: number;
  speed: number;
  motion: "moving" | "stopped" | "speedUnknown";
  ageSeconds: number;
}): CourseState {
  const { course, courseAccuracy, speed, motion, ageSeconds } = input;
  if (!(course >= 0) || !(courseAccuracy >= 0)) return { kind: "invalid" };
  if (motion !== "moving") return { kind: "unknown" };
  if (!(speed >= COURSE_MIN_SPEED_MPS)) return { kind: "unknown" };
  if (!(Math.abs(ageSeconds) <= COURSE_STALE_S)) return { kind: "unknown" };
  if (courseAccuracy > COURSE_ACC_MAX) return { kind: "unknown" };
  return { kind: "valid", course };
}
```

Kit 미러는 같은 판정 순서로 `GuideCourse.swift`에 쓰고, 위 웹 테스트와 같은 7개 케이스를 `GuideCourseTests.swift`에 옮긴다(Swift Testing `#expect`).

```swift
// ios/GildongmuKit/Sources/GildongmuKit/GuideCourse.swift (핵심부)
public enum CourseState: Sendable, Equatable {
    case valid(course: Double)
    case unknown
    case invalid
}

public let courseAccuracyMaxDegrees = 45.0
public let courseStaleSeconds = 3.0
public let courseMinSpeedMps = 0.4

public func courseStep(
    course: Double, courseAccuracy: Double, speed: Double,
    motion: MotionState, ageSeconds: Double
) -> CourseState {
    guard course >= 0, courseAccuracy >= 0 else { return .invalid }
    guard motion == .moving else { return .unknown }
    guard speed >= courseMinSpeedMps else { return .unknown }
    guard abs(ageSeconds) <= courseStaleSeconds else { return .unknown }
    guard courseAccuracy <= courseAccuracyMaxDegrees else { return .unknown }
    return .valid(course: course)
}
```

- [ ] **Step 4: iOS payload에 두 필드를 추가한다**

```swift
// ios/Gildongmu/LocationService.swift — BeaconFixPayload에 추가
        /// 도(진북 기준). **음수는 무효 신호**(CLLocation 계약). 최종 접근 방향이 소비한다.
        let course: Double
        /// 도. 음수는 무효. ⚠ **음수 여부만으로 판정하면 안 된다** — 120°도 양수다.
        /// 품질 게이트는 Kit `courseStep`이 소유한다.
        let courseAccuracy: Double
```

`didUpdateLocations`에서 `location.course`·`location.courseAccuracy`를 읽어 payload에 싣는다(기존 `speed`·`speedAccuracy` 바로 아래에 나란히).

⚠ **두 필드를 함께 추가한다.** 하나만 넣으면 방향이 영영 "모름"이 되거나 한 구현이 임의 기본값을 채워 웹과 iOS가 다른 방향을 말한다(spec §3.5, 검토 #9).

- [ ] **Step 5: 통과 확인 + 커밋**

Run: `npx vitest run src/lib/__tests__/guide-course.test.ts && cd ios/GildongmuKit && swift test --filter GuideCourse`

```bash
git add src/lib/guide-course.ts src/lib/__tests__/guide-course.test.ts ios/GildongmuKit/Sources/GildongmuKit/GuideCourse.swift ios/GildongmuKit/Tests/GildongmuKitTests/GuideCourseTests.swift && \
git commit -m "feat(guide): 진행 방향 3-state 판정 + course payload

courseAccuracy >= 0은 값의 존재만 확인해 120도도 통과시킨다.
4분할 버킷 반폭 45도가 품질 게이트다. course와 courseAccuracy를
함께 싣는다(하나만 넣으면 두 구현이 다른 방향을 말한다).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" \
-- src/lib/guide-course.ts src/lib/__tests__/guide-course.test.ts ios/GildongmuKit/Sources/GildongmuKit/GuideCourse.swift ios/GildongmuKit/Tests/GildongmuKitTests/GuideCourseTests.swift ios/Gildongmu/LocationService.swift
git show HEAD --stat
```

---

## Task 5: 리듀서 상태 전환 (웹) — `handoff` → `finalApproach`

**Files:**
- Modify: `src/lib/route-guide.ts`
- Modify: `src/lib/__tests__/fixtures/route-guide-scenarios.json`
- Test: `src/lib/__tests__/route-guide.test.ts`

**Interfaces:**
- Consumes: T1 `OFFSET_MIN_M`
- Produces:
  - `GuidePhase`에 `"finalApproach"` 추가, `"handoff"` 제거
  - `GuideEvent`에 `{ kind: "finalApproachEnter" }` 추가, `{ kind: "handoff" }` 제거
  - `guideStep`의 새 인자: `arrivalToleranceM: number`(호출부가 `max(10, fix.accuracy)`를 준다)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// src/lib/__tests__/route-guide.test.ts 에 추가
describe("최종 접근 진입 조건 (spec §3.2)", () => {
  it("전 스텝 낭독 완료 + 경로 종점 도달이면 진입한다", () => {
    // 100m 직선, 전 스텝 낭독 완료 상태에서 종점 3m 전 fix
    const route = buildGuideRoute([
      { description: "직진", pathCoords: [p(0, 0), p(100, 0)] },
    ])!;
    let state = guideStateAt(route, 96, 0);
    state = { ...state, announcedUpTo: route.steps.length - 1 };
    const out = guideStep(state, { ...p(97, 0), accuracy: 8 }, route, 10, WALK_TUNING, {
      arrivalToleranceM: 10,
    });
    expect(out.event).toEqual({ kind: "finalApproachEnter" });
    expect(out.state.phase).toBe("finalApproach");
  });

  it("경로 잔여 50m에서는 진입하지 않는다 (종전 handoff 임계 폐기)", () => {
    const route = buildGuideRoute([
      { description: "직진", pathCoords: [p(0, 0), p(100, 0)] },
    ])!;
    let state = guideStateAt(route, 45, 0);
    state = { ...state, announcedUpTo: route.steps.length - 1 };
    const out = guideStep(state, { ...p(50, 0), accuracy: 8 }, route, 10, WALK_TUNING, {
      arrivalToleranceM: 10,
    });
    expect(out.event?.kind).not.toBe("finalApproachEnter");
    expect(out.state.phase).not.toBe("finalApproach");
  });

  it("정확도가 나쁘면 임계가 커져 더 일찍 진입한다", () => {
    const route = buildGuideRoute([
      { description: "직진", pathCoords: [p(0, 0), p(100, 0)] },
    ])!;
    let state = guideStateAt(route, 68, 0);
    state = { ...state, announcedUpTo: route.steps.length - 1 };
    const out = guideStep(state, { ...p(70, 0), accuracy: 30 }, route, 10, WALK_TUNING, {
      arrivalToleranceM: 30,
    });
    expect(out.event).toEqual({ kind: "finalApproachEnter" });
  });

  it("낭독이 남아 있으면 진입하지 않는다", () => {
    const route = buildGuideRoute([
      { description: "직진A", pathCoords: [p(0, 0), p(60, 0)] },
      { description: "우회전B", pathCoords: [p(60, 0), p(100, 0)] },
    ])!;
    const state = { ...guideStateAt(route, 96, 0), announcedUpTo: 0 };
    const out = guideStep(state, { ...p(97, 0), accuracy: 8 }, route, 10, WALK_TUNING, {
      arrivalToleranceM: 10,
    });
    expect(out.event?.kind).not.toBe("finalApproachEnter");
  });

  it("이탈 중이면 진입하지 않는다", () => {
    const route = buildGuideRoute([
      { description: "직진", pathCoords: [p(0, 0), p(100, 0)] },
    ])!;
    const state = {
      ...guideStateAt(route, 96, 0),
      announcedUpTo: route.steps.length - 1,
      phase: "offRoute" as const,
    };
    const out = guideStep(state, { ...p(97, 40), accuracy: 8 }, route, 10, WALK_TUNING, {
      arrivalToleranceM: 10,
    });
    expect(out.state.phase).not.toBe("finalApproach");
  });

  it("진입은 단방향 래치 — 정확도가 좋아져도 되돌아가지 않는다", () => {
    const route = buildGuideRoute([
      { description: "직진", pathCoords: [p(0, 0), p(100, 0)] },
    ])!;
    let state = { ...guideStateAt(route, 68, 0), announcedUpTo: route.steps.length - 1 };
    state = guideStep(state, { ...p(70, 0), accuracy: 30 }, route, 10, WALK_TUNING, {
      arrivalToleranceM: 30,
    }).state;
    const out = guideStep(state, { ...p(72, 0), accuracy: 5 }, route, 20, WALK_TUNING, {
      arrivalToleranceM: 10,
    });
    expect(out.state.phase).toBe("finalApproach");
  });
});
```

`p(along, lateral)` 헬퍼는 기존 테스트 파일에 이미 있다(fixture 좌표 규약과 동일). 없으면 T2의 `toCoord`를 복사한다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/__tests__/route-guide.test.ts -t "최종 접근 진입"`
Expected: FAIL — `finalApproachEnter` 이벤트 없음

- [ ] **Step 3: 리듀서를 고친다**

`route-guide.ts`의 6a) 인계 블록을 대체한다:

```ts
  // 6a) 최종 접근 진입(최우선, spec 2026-08-08 §3.2): 전 스텝 낭독 완료 ∧ 경로 종점
  //     도달. 종전 "경로 잔여 ≤ 50m"는 **경로 종점 = 목적지**를 전제한 판단이었고,
  //     실측에서 종점→목적지 오프셋이 16~89m로 확인돼 무효화됐다.
  //     ⚠ 단방향 래치다 — 정확도가 좋아져 임계가 줄어도 되돌아가지 않는다.
  if (
    next.phase !== "finalApproach" &&
    next.announcedUpTo >= route.steps.length - 1 &&
    remainingTotal <= opts.arrivalToleranceM
  ) {
    next = { ...next, phase: "finalApproach", resumePhase: "finalApproach" };
    return { state: next, event: { kind: "finalApproachEnter" }, tone: null };
  }
```

⚠ 이 블록은 **이탈 판정(5절) 뒤, 국면·낭독(6절) 앞**에 온다. `offRoute` 상태는 5절에서 이미 early-return하므로 "이탈 중이면 진입하지 않는다"가 구조적으로 성립한다.

`GuidePhase`·`GuideEvent`에서 `handoff`를 지우고 `finalApproach`·`finalApproachEnter`를 넣는다. `guideStep` 시그니처에 여섯 번째 인자 `opts: { arrivalToleranceM: number }`를 추가한다.

⚠ **`finalApproach` 상태에서는 이탈 판정을 정지한다**(spec §4). 리듀서 진입부에 가드를 둔다:

```ts
  // finalApproach는 경로를 이미 벗어난 구간을 다룬다. 낡은 폴리라인으로 이탈을
  // 주장하면 거짓이므로 판정 자체를 하지 않는다(spec §4 상태 전이표).
  if (state.phase === "finalApproach") {
    return { state: { ...state, lastFixAt: now }, event: null, tone: null };
  }
```

- [ ] **Step 4: 통과 확인 + 기존 테스트 회귀 확인**

Run: `npm run test:run`
Expected: 신규 6건 PASS. 기존 `handoff` 테스트는 실패한다 — **fixture와 테스트를 새 이름·조건으로 갱신**한다(폐기가 의도다). `route-guide-scenarios.json`의 인계 시나리오도 종점 도달 조건으로 바꾼다.

- [ ] **Step 5: 커밋**

```bash
git commit -m "feat(guide): 인계 조건을 경로 종점 도달로 (handoff → finalApproach)

종전 50m는 '경로 종점 = 목적지'를 전제한 판단이었다. 실측에서 종점→목적지
오프셋 16~89m가 확인돼 그 전제가 무효화됐다. 오프셋 89m 목적지는 실제
목적지까지 139m 지점에서 경로 추종이 꺼지고 있었다.
위원장 판정: 기술적으로 가능한 한 최대한 목적지와 가까운 곳까지.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" \
-- src/lib/route-guide.ts src/lib/__tests__/route-guide.test.ts src/lib/__tests__/fixtures/route-guide-scenarios.json
git show HEAD --stat
```

---

## Task 6: Kit 리듀서 미러

**Files:**
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/RouteGuide.swift`
- Test: `ios/GildongmuKit/Tests/GildongmuKitTests/RouteGuideTests.swift`

**Interfaces:**
- Consumes: T5의 상태·이벤트·시그니처
- Produces: Swift `GuidePhase.finalApproach`, `GuideEvent.finalApproachEnter`, `guideStep(..., arrivalToleranceM: Double)`

- [ ] **Step 1: T5의 6개 테스트를 Swift로 옮겨 쓰고 실패를 확인한다**

Run: `cd ios/GildongmuKit && swift test --filter RouteGuide`
Expected: FAIL — `finalApproachEnter` 없음

- [ ] **Step 2: T5와 같은 위치·같은 조건으로 구현한다**

```swift
    // 6a) 최종 접근 진입(최우선, spec 2026-08-08 §3.2) — 웹 route-guide.ts 미러.
    if next.phase != .finalApproach,
       next.announcedUpTo >= route.steps.count - 1,
       remainingTotal <= arrivalToleranceM {
        next.phase = .finalApproach
        next.resumePhase = .finalApproach
        return GuideOutput(state: next, event: .finalApproachEnter, tone: nil)
    }
```

진입부 가드도 동일하게 둔다.

- [ ] **Step 3: 통과 확인 + 공유 fixture 드리프트 확인**

Run: `cd ios/GildongmuKit && swift test`
Expected: 전량 PASS. `route-guide-scenarios.json`을 웹과 Kit이 함께 소비하므로 한쪽만 고쳤으면 여기서 깨진다.

- [ ] **Step 4: 커밋**

```bash
git commit -m "feat(guide): 최종 접근 진입 조건 Kit 미러

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" \
-- ios/GildongmuKit/Sources/GildongmuKit/RouteGuide.swift ios/GildongmuKit/Tests/GildongmuKitTests/RouteGuideTests.swift
git show HEAD --stat
```

---

## Task 7: 문구와 문장 조립

**Files:**
- Modify: `messages/ko.json` · `en.json` · `es.json` · `fr.json` · `it.json` · `ja.json`
- Modify: `ios/Gildongmu/Resources/Localizable.xcstrings`(`node ios/scripts/messages-to-xcstrings.mjs` 경유)
- Modify: `ios/Gildongmu/Directions/GuideText.swift`
- Modify: `docs/superpowers/specs/2026-08-08-final-approach-guidance-design.md`(§3.3 예시 문장)
- Test: `src/lib/__tests__/i18n-messages.test.ts`(기존 게이트가 자동 검증)

**Interfaces:**
- Produces: i18n 키 `guide.finalApproachEnter`·`guide.finalApproachEnterNoRoad`·`guide.finalApproachTick`·`guide.finalApproachTickNoDir`·`guide.finalApproachNear`·`guide.finalApproachNearDir`·`guide.arrived`·`guide.dirAhead`·`guide.dirLeft`·`guide.dirRight`·`guide.dirBehind`
- Produces: Swift `GuideText.finalApproachEnter(...)`·`GuideText.finalApproachTick(...)`

**⚠ 조사 헬퍼를 만들지 않는다.** 한국어 주격·목적격 조사는 받침 유무로 갈리는데(`강동구청은`/`이마트는`, `성내로를`/`양재대로116길을`), 헬퍼를 만드는 대신 **조사 없는 문형**으로 짓는다(검토 #39). 접근성 헌장 §4의 "구분자는 쉼표"와도 정합하고, 미니멀 원칙상 헬퍼 하나를 덜 만드는 쪽이 맞다. **spec §3.3의 예시 문장도 이 형태로 갱신한다.**

- [ ] **Step 1: 문구를 정하고 6개 로케일에 넣는다**

```json
// messages/ko.json guide 절
"finalApproachEnter": "{road} 끝입니다. {dest}, {direction} {distance}.",
"finalApproachEnterNoRoad": "경로 끝입니다. {dest}, {direction} {distance}.",
"finalApproachTick": "{direction} {distance}",
"finalApproachTickNoDir": "{distance}",
"finalApproachNear": "목적지 근처",
"finalApproachNearDir": "목적지 근처, {direction}",
"arrived": "목적지에 도착했습니다",
"dirAhead": "정면",
"dirLeft": "왼쪽",
"dirRight": "오른쪽",
"dirBehind": "뒤"
```

⚠ `{direction}`이 비는 경우를 위해 **키를 나눠 뒀다**(빈 문자열 보간은 "…, , 16미터"처럼 쉼표가 겹친다). 영문 로케일은 `"{road} ends here. {dest}, {direction}, {distance}."` 등으로 자연스럽게 옮기되, **최종 접근은 ko 전용 경로라 실사용에서 도달하지 않는다**(도보 API가 ko 전용). 키 일관성 게이트를 통과시키는 것이 목적이다.

- [ ] **Step 2: xcstrings로 변환하고 키 린터를 돌린다**

Run: `node ios/scripts/messages-to-xcstrings.mjs && node ios/scripts/check-xcstrings-keys.mjs`
Expected: 신규 키 11개 반영, 린터 PASS

⚠ 수기 편집분이 있으면 변환이 덮어쓸 수 있다. 변환 전후 `git diff --stat`으로 의도 밖 변경이 없는지 본다.

- [ ] **Step 3: 문장 조립을 쓰고 테스트한다**

```swift
// ios/Gildongmu/Directions/GuideText.swift 에 추가
    /// 최종 접근 진입 서술(spec §3.3). **이 문장은 사용자가 경로 종점에 서 있을 때
    /// 나가므로 거리·방향이 곧 현재 위치 기준이다.** 초판이 이것을 handoff 시점
    /// (경로 잔여 50m)에 냈다가 기준이 어긋났다(codex 검토 #1).
    ///
    /// 조사를 쓰지 않는다 — 받침 유무로 갈리는데 목적지·도로명이 임의 고유명사다.
    static func finalApproachEnter(
        destination: String, geometry: FinalApproachPayload, accuracy: Double
    ) -> String {
        let distance = approachDistance(geometry.offsetMeters, accuracy: accuracy)
        let dir = geometry.relativeBearing.map { directionWord(relativeDirection($0)) }
        let parts = joinText(destination, dir, distance)  // 쉼표 결합, nil 자동 제거
        if let road = geometry.roadName {
            return appLocalized("guide.finalApproachEnter", road, destination, dir ?? "", distance)
        }
        return appLocalized("guide.finalApproachEnterNoRoad", destination, dir ?? "", distance)
    }

    static func directionWord(_ d: RelativeDirection) -> String {
        switch d {
        case .ahead: appLocalized("guide.dirAhead")
        case .left: appLocalized("guide.dirLeft")
        case .right: appLocalized("guide.dirRight")
        case .behind: appLocalized("guide.dirBehind")
        }
    }

    /// 거리 정직 사다리(spec §3.6). ⚠ **비교는 반올림 전 원거리로 한다** —
    /// formatDistance 통과 후 값으로 비교하면 15.4m가 런타임 반올림에 따라 갈린다.
    /// ⚠ accuracy가 좋아도 헤지를 빼지 않는다 — 보고 정확도 5.4m에 실오차 36.5m인
    /// 실측이 있다(RouteNav ASSETS'23).
    static func approachDistance(_ meters: Double, accuracy: Double) -> String {
        let base = formatDistance(Int(meters.rounded()))
        if accuracy <= 20 { return appLocalized("guide.approx", base) }
        return appLocalized("guide.rough", base)
    }
```

⚠ `direction`이 nil일 때 `guide.finalApproachEnter`에 빈 문자열을 넣으면 쉼표가 겹친다. **방향 없는 전용 키를 하나 더 두거나** 조립부에서 분기한다. 구현자는 둘 중 하나를 고르고 주석에 이유를 적는다.

- [ ] **Step 4: i18n 게이트**

Run: `npm run test:run -- i18n-messages`
Expected: PASS(6개 로케일 키 일치)

- [ ] **Step 5: 커밋**

```bash
git commit -m "feat(i18n): 최종 접근 문구 11종 + 조사 없는 문형

한국어 조사는 받침 유무로 갈리는데 목적지·도로명이 임의 고유명사다.
헬퍼를 만드는 대신 쉼표 결합 문형으로 짓는다(접근성 헌장 §4 정합).
거리 사다리는 accuracy가 좋아도 헤지를 빼지 않는다 — 보고 정확도 5.4m에
실오차 36.5m인 실측이 있다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" \
-- messages/ko.json messages/en.json messages/es.json messages/fr.json messages/it.json messages/ja.json ios/Gildongmu/Resources/Localizable.xcstrings ios/Gildongmu/Directions/GuideText.swift docs/superpowers/specs/2026-08-08-final-approach-guidance-design.md
git show HEAD --stat
```

---

## Task 8: iOS 앱 배선

**Files:**
- Modify: `ios/Gildongmu/Directions/BeaconModel.swift`

**Interfaces:**
- Consumes: T3 `WalkRouteBriefing.finalApproach`, T4 `courseStep`, T5·T6 `finalApproachEnter`, T7 `GuideText.finalApproachEnter`
- Produces: (앱 계층 — 후속 태스크가 의존하지 않는다)

**⚠ 앱 타깃에 테스트 번들이 없다.** 판정은 전부 Kit 순수 함수가 하고 이 계층은 배선만 한다(기존 규율). 검증은 시뮬레이터 빌드 + 실기기다.

- [ ] **Step 1: 상태와 진입을 배선한다**

`BeaconModel`에 추가:

```swift
    /// 최종 접근 활성 여부. **이 동안 beaconStep의 발화 소유권을 가져간다**
    /// (spec §3.0) — "근처"와 "18미터"가 같은 fix에서 연달아 나가는 경로를 없앤다.
    private(set) var inFinalApproach = false
    /// 세션이 쥔 종점 오프셋 기하. 재조회 시 통째로 교체한다.
    private var finalApproachGeometry: FinalApproachPayload?
    /// 진입 서술을 아직 못 냈으면 보관한다(백그라운드 억제 — spec §3.4).
    /// 1회뿐인 발화라 다음 주기가 대신 말해 주지 않는다(pendingStepFreeNotice 선례).
    private var pendingFinalApproachIntro: String?
    /// 마지막 주기 통지 시각(단조). uncertain 중에는 갱신하지 않고 정지·유지한다.
    private var lastFinalTickAt: Double?
```

`fetchGuideRoute`·`performReroute`에서 `fetched.finalApproach`를 `finalApproachGeometry`에 저장한다. **재조회 성공 시 `inFinalApproach = false`, `pendingFinalApproachIntro = nil`, `lastFinalTickAt = nil`로 전부 초기화**한다(spec §4 — 새 경로는 새 종점이다).

`consume(event:route:)`에 케이스를 더한다:

```swift
        case .finalApproachEnter:
            inFinalApproach = true
            lastFinalTickAt = uptimeNow
            guard let geo = finalApproachGeometry else {
                // 기하가 없으면(구버전·조립 실패) 종전 문구로 정직하게 폴백한다.
                let text = appLocalized("guide.handoffFallback")
                statusText = text
                announce(text)
                return
            }
            let text = GuideText.finalApproachEnter(
                destination: destinationLabel, geometry: geo, accuracy: lastAccuracy
            )
            statusText = text
            lastGuidance = text
            // 발화가 버려졌으면(백그라운드·억제) 보관했다가 전경 복귀 때 갚는다.
            if !announce(text) { pendingFinalApproachIntro = text }
```

- [ ] **Step 2: 주기 루프와 도착을 배선한다**

`handle(fix:)`의 최종 접근 분기(상세 처리보다 앞):

```swift
        if inFinalApproach {
            handleFinalApproach(fix: fix, motion: motion, age: age, now: now)
            return
        }
```

```swift
    /// 최종 접근 주기 통지(spec §3.4). **거리는 항상 현재 fix → 목적지 직선거리**다 —
    /// offsetMeters는 진입 서술에서만 쓰고 이후 재사용하지 않는다(두 거리 혼동 차단).
    private func handleFinalApproach(
        fix: LocationService.BeaconFixPayload, motion: MotionState, age: Double, now: Double
    ) {
        guard let dest else { return }
        // 신뢰 불가 fix에서는 거리·방향을 말하지 않는다(unreliable 최우선 불변식 유지).
        guard isUsableFix(accuracy: fix.accuracy, ageSeconds: age) else {
            routeTone(ToneLayerInput(unreliable: true), now: now)
            return
        }
        lastFixAt = now
        lastFixCoord = (fix.lat, fix.lng)
        lastFixCoordAt = now

        let distance = haversineMeters(
            lat1: fix.lat, lng1: fix.lng, lat2: dest.lat, lng2: dest.lng
        )
        // 도착: 통지 1회 후 세션 종료.
        if distance <= arriveMeters {
            statusText = appLocalized("guide.arrived")
            announce(statusText)
            playTone(.nearby)
            stop()
            return
        }
        // 주기. ⚠ 시간 상한을 두지 않는다 — 2분 상한은 오프셋 89m·저속 보행에서
        // 정작 마지막 15m 직전에 루프를 껐다(codex 검토 #10).
        guard let last = lastFinalTickAt, now - last >= finalIntervalSeconds else {
            if lastFinalTickAt == nil { lastFinalTickAt = now }
            return
        }
        lastFinalTickAt = now

        let course = courseStep(
            course: fix.course, courseAccuracy: fix.courseAccuracy,
            speed: fix.speed, motion: motion, ageSeconds: age
        )
        var dir: String?
        if case let .valid(c) = course {
            let toDest = bearingDegrees(
                fromLat: fix.lat, fromLng: fix.lng, toLat: dest.lat, toLng: dest.lng
            )
            let rel = (toDest - c + 540).truncatingRemainder(dividingBy: 360) - 180
            dir = GuideText.directionWord(relativeDirection(rel))
        }
        let text = GuideText.finalApproachTick(
            distance: distance, direction: dir, accuracy: fix.accuracy
        )
        statusText = text
        lastGuidance = text
        announce(text)
    }
```

- [ ] **Step 3: 상태 전이표(spec §4)를 배선한다**

- `toggleMode()`의 `detail → brief`: `inFinalApproach`를 켜지 않는다(사용자가 직선 안내를 명시 선택).
- `toggleMode()`의 `brief → detail` 복귀와 `resolveDetailIfPending` 성공: `inFinalApproach = false`, `lastFinalTickAt = nil`.
- `handleScenePhaseChange(.active)`: `pendingFinalApproachIntro`가 있으면 갚는다(기존 `pendingStepFreeNotice` 처리 블록에 나란히 둔다).
- `stop()`: 세 필드 전부 초기화.

- [ ] **Step 4: 빌드와 시뮬레이터 확인**

```bash
CONFIGURATION=Experimental xcodebuild -project ios/Gildongmu.xcodeproj -scheme Gildongmu \
  -destination 'generic/platform=iOS Simulator' build 2>&1 | tail -5
```
Expected: BUILD SUCCEEDED

- [ ] **Step 5: 커밋**

```bash
git commit -m "feat(ios): 최종 접근 모드 배선 (진입 서술·주기·도착)

거리는 항상 현재 fix → 목적지 직선거리다. offsetMeters는 진입 서술에서만
쓰고 재사용하지 않는다. 시간 상한을 두지 않고 거리로 종료한다.
진입 서술은 1회뿐이라 백그라운드에서 억제되면 보관했다 갚는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" \
-- ios/Gildongmu/Directions/BeaconModel.swift
git show HEAD --stat
```

---

## Task 9: 웹 훅 배선

**Files:**
- Modify: `src/hooks/useRouteGuide.ts`
- Test: `src/hooks/__tests__/useRouteGuide.test.ts`(있으면) 또는 신규

**Interfaces:**
- Consumes: T3·T5·T7

**⚠ 웹은 방향을 말하지 않는다**(spec §3.5). `GeolocationCoordinates`에 `heading`은 있으나 **정확도 필드가 없어** `courseStep`을 통과할 수 없다. 웹은 항상 "모름" 경로를 탄다. 이것은 결함이 아니라 플랫폼 사실이며, 실시간 안내의 주 창구가 iOS라는 사실과 정합한다.

- [ ] **Step 1: 테스트를 쓴다**

```ts
it("최종 접근 진입 시 배치 서술을 1회 낸다", async () => {
  // eventText가 finalApproachEnter를 받으면 finalApproach 기하로 문장을 만든다
  // (방향 어절 없음 — 웹은 courseAccuracy가 없다)
});

it("주기 통지 거리는 현재 위치 기준이다", async () => {
  // offsetMeters(16m)가 아니라 fix→dest haversine을 쓴다
});
```

구체 단언은 기존 훅 테스트의 fake timer·`announce` 스파이 패턴을 따른다. ⚠ 패시브 `useEffect` 포커스·통지는 `waitFor`로 감싼다(jsdom 동기 단언 flake).

- [ ] **Step 2~4: 구현·통과·커밋**

`eventText`에 `finalApproachEnter` 케이스를 더하고, 주기 통지는 iOS와 같은 규칙(현재 위치 기준 거리, 방향은 항상 생략)으로 낸다. 도착은 `ARRIVE_M`에서 1회.

Run: `npm run test:run && npm run build`

```bash
git commit -m "feat(web): 최종 접근 배선 (방향은 플랫폼상 항상 모름)

GeolocationCoordinates에 heading은 있으나 정확도 필드가 없어 품질 게이트를
통과할 수 없다. 웹은 거리만 말한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" \
-- src/hooks/useRouteGuide.ts src/hooks/__tests__/useRouteGuide.test.ts
```

---

## Task 10: 랜드마크 1개

**Files:**
- Modify: `ios/Gildongmu/Directions/BeaconModel.swift`
- Modify: `messages/*.json`(6) · xcstrings — 키 `guide.finalApproachLandmark`
- Create: `src/lib/final-approach-landmark.ts` + 테스트(선택 규칙 순수 함수)

**Interfaces:**
- Consumes: `getWalkInfrastructure()`(`src/lib/walk-infra.ts`), T1 `relativeDirection`
- Produces: `export function pickLandmark(items, destBearing): Landmark | null`

- [ ] **Step 1: 선택 규칙 테스트를 쓴다**

```ts
it("거리 오름차순 → 종류 우선순위 → id 사전순으로 결정론적으로 고른다", () => {
  // 같은 거리에 횡단보도·음향신호기가 있으면 음향신호기
});
it("조회 실패(error)는 0건과 다르게 다룬다 — 문장 생략 + 로그", () => {});
```

- [ ] **Step 2~3: 구현**

```ts
/** 종류 우선순위 — 지팡이 감지 가능성 순(Padmanaban & Krukar 10/10 항목 우선). */
const KIND_RANK = { audioSignal: 0, crosswalk: 1, tactilePaving: 2 } as const;

export function pickLandmark(items: WalkInfraItem[]): WalkInfraItem | null {
  if (items.length === 0) return null;
  return [...items].sort(
    (a, b) =>
      a.distanceMeters - b.distanceMeters ||
      KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
      a.id.localeCompare(b.id),
  )[0];
}
```

문구: `"guide.finalApproachLandmark": "{direction} {distance}에 {name}이 있습니다."` → **조사 회피**: `"{direction} {distance}, {name}"`.

⚠ **방향이 "모름"이면 랜드마크 문장 자체를 생략한다**(spec §3.7). 방향 없는 랜드마크는 정위에 쓸모가 없고, 목적지 반대편 29m의 횡단보도를 표지로 오인해 **사용자를 차도로 보낼 수 있다**(검토 #37).

⚠ **POI 폴백을 두지 않는다.** 보행 인프라가 없으면 생략한다(검토 #38 — 인프라 부재가 간판 POI의 감지 가능성을 만들지 않는다).

- [ ] **Step 4: 커밋**

```bash
git commit -m "feat(guide): 최종 접근 랜드마크 1개 (보행 인프라만)

선택은 거리·종류·id 3단 결정론이다(반환 순서 의존 금지).
방향을 모르면 문장을 생략한다 — 방향 없는 랜드마크는 목적지 반대편
횡단보도를 표지로 오인시켜 사용자를 차도로 보낼 수 있다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" \
-- src/lib/final-approach-landmark.ts src/lib/__tests__/final-approach-landmark.test.ts ios/Gildongmu/Directions/BeaconModel.swift messages/ko.json messages/en.json messages/es.json messages/fr.json messages/it.json messages/ja.json ios/Gildongmu/Resources/Localizable.xcstrings
```

---

## Task 11: 리뷰 + 실기기 배포

**⚠ 리뷰는 구현 방식과 무관하게 항상 별도 컨텍스트에 맡긴다**(헌장 §리뷰 계층). 리뷰어에게 **세션 히스토리·생성 의도를 넘기지 않는다** — 요구사항(spec·이 plan)과 산출물(diff)만 준다.

- [ ] **Step 1: 전체 게이트**

```bash
npm run test:run && npm run lint && npm run build && (cd ios/GildongmuKit && swift test)
```

- [ ] **Step 2: 실호출 게이트 (로컬 dev)**

spec §7의 4건 + 오프셋 10m 미만 목적지 1건. `finalApproach` 필드와 `tooClose` 생략 분기를 확인한다.

- [ ] **Step 3: 서브에이전트 리뷰 디스패치**

리뷰 포커스를 명시한다: **①상태 전이표(spec §4) 전 항목이 코드에 있는가 ②거리 기준이 어디서도 오프셋과 섞이지 않는가 ③웹↔Kit 미러 드리프트 ④3-state 뭉갬**. 리뷰어에게 커밋 SHA를 넘긴다(산출물을 얼린다).

- [ ] **Step 4: 실기기 배포**

```bash
CONFIGURATION=Experimental ./ios/deploy-device.sh
```

- [ ] **Step 5: 문서 분배 (마일스톤 종료)**

- 서사 → `CHANGELOG.md`
- 남은 판정(spec §6 일곱 항목) → `docs/BACKLOG.md` §F-a
- 새 함정 → `CLAUDE.md`(도보 경로 행에 "경로는 목적지까지 가지 않는다" 한 줄)
- 상태 한 줄 → `PROGRESS.md`
- 이식 가치 → 워크스페이스 `PORTS.md`(dodo-planet에 같은 계층이 있다)

---

## Self-Review

**1. spec 커버리지**: §3.0 소유권 → T5·T8 / §3.1 기하 → T1·T2 / §3.2 진입 → T5·T6 / §3.3 배치 서술 → T7·T8 / §3.4 주기·도착 → T8·T9 / §3.5 방향 → T4 / §3.6 거리 사다리 → T7 / §3.7 랜드마크 → T10 / §3.8 출입구 → **미구현(키 발급 대기, 백로그 §F-b)** / §4 전이표 → T5·T8 / §7 검증 → T2 Step 5·T11.

⚠ **§3.8은 의도적으로 이 계획 밖이다.** 위원장의 키 발급이 선행 조건이고, 없어도 나머지가 동작한다(건물 중심 좌표 폴백). 키가 오면 별도 태스크로 붙인다.

**2. 미해결 placeholder**: T7 Step 3의 "방향 없는 전용 키 vs 조립부 분기"는 구현자 선택으로 남겼다 — 둘 다 정당하고 문장 결과가 같다. 그 외 TBD 없음.

**3. 타입 일관성**: `FinalApproachGeometry`(웹 계산) ↔ `FinalApproachPayload`(Swift 디코딩) ↔ `FinalApproachGeometry`(Swift 계산)가 이름이 갈린다. **의도적이다** — Swift는 디코딩 표면과 계산 타입을 분리해 서버가 사유 문자열에 넷째 값을 추가해도 디코딩이 죽지 않게 한다(`stepFree` 원시 문자열 규율과 동일). T3에 그 근거를 주석으로 박았다.
