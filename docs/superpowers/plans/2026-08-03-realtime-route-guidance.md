# 실시간 길 안내 (E4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 거리 추적(비콘)을 "실시간 길 안내"로 확장 — 간략(직선거리, 현행 비콘)/상세(경로 추종형) 2모드를 한 시트에서 제공한다.

**Architecture:** 판정은 순수 리듀서(웹 `route-guide.ts` 정본 ↔ Kit `RouteGuide.swift` 미러, 공유 fixture로 동조 강제). 오케스트레이터(iOS `BeaconModel`·웹 훅)는 I/O·생명주기 배선만. 서버는 `/api/route/walk`에 `includeGeometry=1` 옵트인으로 스텝 폴리라인을 보존한다(미지정 byte-호환).

**Tech Stack:** Next.js 16 Route Handler, Vitest, SwiftUI + GildongmuKit(SPM, Swift Testing), next-intl 6로케일, ElevenLabs SFX API.

**정본 스펙:** `docs/superpowers/specs/2026-08-03-realtime-route-guidance-design.md` (이하 "스펙"). 모든 상수·상태 전이·통지 규칙의 근거. 충돌 시 스펙이 이긴다.

## Global Constraints

- 상수 초기값(스펙 §5, 전부 실보행 튜닝 대상 — 한 곳에 모으고 근거 주석): `LONG_STEP_MIN=40m`, `ANNOUNCE_AHEAD=40m`, 전진 여유 `max(15m, accuracy)`, `HANDOFF_DIST=50m`(+재무장 여유 20m), `UNCERTAIN_ACCURACY=50m`, 이탈 `max(30m, 2×accuracy)` 20초 지속·재통지 60초, 재획득 fix 공백 10초, 투영 창 `[d−20m, d+max(50m,3×accuracy)]`, 속도 3m/s 진입·2m/s 해제(10초 창 중앙값), 주기 통지 60/30/15초(잔여 >500 / 150~500 / <150m), 전환 모호 해소 타임아웃 30초, 이음매 허용 `SEAM_TOLERANCE=5m`.
- **상세 안내는 ko 데이터 로케일 전용**(도보 API V1 ko 전용). 비한국어 로케일은 간략만, 전환 버튼 미노출.
- 이벤트 우선순위(스펙 §5.0): 인계 > 이탈/복귀 > 실행 안내 > 예고 > 주기 > 속도 제안. 한 fix에 발화는 최상위 1개.
- 낭독은 선행(잔여 ≤40m에 다음 안내 전문), 상태 전진은 후행(경계+여유). 낭독 병합은 최신 우선.
- iOS 낭독은 반드시 `spokenUnits()` 경유(BeaconModel `announce(_:)` 단일 경로 유지). 거리 문자열은 `formatDistance` 정본만.
- `uncertain`·`reacquiring` 중 자동 낭독·이탈 타이머·속도 판정 정지. 시간은 주입된 단조 시각(`now`)만 사용, 리듀서에서 `Date.now()` 금지.
- 경로 데이터는 메모리에만, 세션 종료 시 폐기(스펙 §7.3). `includeGeometry=1` upstream fetch는 `no-store`.
- 커밋은 의도 파일만(`git add -A` 금지), 기능+테스트 동일 커밋. UI 라벨 이모지 금지. 문서·주석 한국어.
- 기존 계약 불변: 비콘 리듀서(`beacon.ts`/`Beacon.swift`)·시트 1:1(시작=표시·중지=닫힘)·`outputSuppressed`·워치독·전경 전용.

**구현 방식 판정(헌장 §구현 방식):** Task 1~4는 리듀서·API 계약을 공유하는 순차 결합(같은 fixture·타입을 정의·소비), Task 5 이후는 인터페이스가 이 플랜으로 고정된 독립 태스크. 혼합이 정상 — 1~4 순차, 5~11은 병렬 위임 가능(수정 파일 비겹침: i18n/iOS/웹/사운드).

---

### Task 1: `/api/route/walk` includeGeometry 옵트인

**Files:**
- Modify: `src/lib/walk-route.ts` (annotateAudioSignals 기하 보존 분기, getWalkRoute 파라미터)
- Modify: `src/lib/providers/kakao-walk.ts` (no-store 전파)
- Modify: `src/lib/types.ts:287-299` (WalkRouteStep 주석 갱신)
- Modify: `src/app/api/route/walk/route.ts` (쿼리 파라미터)
- Test: `src/lib/__tests__/walk-route.test.ts` (기존 파일에 추가), `src/app/api/__tests__/` 스타일 참조

**Interfaces:**
- Produces: `getWalkRoute({origin, dest, accessible?, includeGeometry?})` — `includeGeometry: true`면 응답 스텝에 `pathCoords?: Coord[]` 보존(카카오), Tmap 폴백 스텝은 `coord` 1점을 `pathCoords: [coord]`로 승격. 미지정이면 기존과 byte-동일.
- Produces: 라우트 쿼리 `includeGeometry` — 누락 또는 정확히 `"1"`만 허용, 그 외 400(스펙 §7.2).

- [ ] **Step 1: 실패 테스트 작성** — `walk-route.test.ts`에 추가:

```ts
describe("includeGeometry", () => {
  const briefing = {
    distanceMeters: 100, durationSeconds: 80,
    steps: [
      { description: "10m 이동", pathCoords: [{ lat: 37.5, lng: 127.1 }, { lat: 37.5001, lng: 127.1 }] },
      { description: "횡단보도 이용", coord: { lat: 37.5001, lng: 127.1 } },
    ],
  };
  it("기본은 coord·pathCoords 전량 제거(기존 byte-호환)", () => {
    const out = annotateAudioSignals(briefing, false);
    for (const s of out.steps) {
      expect(s).not.toHaveProperty("coord");
      expect(s).not.toHaveProperty("pathCoords");
    }
  });
  it("보존 모드는 pathCoords로 통일 노출(coord 1점은 승격)", () => {
    const out = annotateAudioSignals(briefing, true);
    expect(out.steps[0].pathCoords).toHaveLength(2);
    expect(out.steps[1].pathCoords).toEqual([{ lat: 37.5001, lng: 127.1 }]);
    expect(out.steps[1]).not.toHaveProperty("coord");
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm run test:run -- walk-route`. Expected: FAIL(annotateAudioSignals가 인자 1개).

- [ ] **Step 3: 구현** — `walk-route.ts`:

```ts
export function annotateAudioSignals(
  briefing: WalkRouteBriefing,
  keepGeometry = false,
): WalkRouteBriefing {
  const steps = briefing.steps.map((step) => {
    const { coord, pathCoords, ...rest } = step;
    const candidates = pathCoords ?? (coord ? [coord] : []);
    const annotated =
      candidates.length > 0 &&
      rest.description.includes("횡단보도") &&
      !MERGED_CROSSWALK.test(rest.description) &&
      candidates.some((c) => hasAudioSignalNear(c.lat, c.lng, MATCH_RADIUS_METERS))
        ? { ...rest, description: `${rest.description}, ${ANNOTATION}` }
        : rest;
    // 보존 모드: 좌표를 pathCoords 한 형태로 통일해 노출(소비자가 두 모양을 안 다루게).
    return keepGeometry && candidates.length > 0
      ? { ...annotated, pathCoords: candidates }
      : annotated;
  });
  return { ...briefing, steps };
}
```

`getWalkRoute`에 `includeGeometry = false` 파라미터를 추가하고 **모든** `annotateAudioSignals(...)` 호출(4곳)에 전달한다. `fetchPrimaryOrFallback`에 `includeGeometry`를 내려 `getKakaoWalkBriefing({..., noStore: includeGeometry})`로 전파하고, `kakao-walk.ts`의 fetch를 `noStore ? { cache: "no-store" } : { next: { revalidate: 3600 } }`로 분기한다(스펙 §7.2 — 세션 전용 데이터를 서버 캐시에 태우면 약관 판단과 모순). Tmap 폴백은 POST라 revalidate 실효(기존 그대로).

`route.ts` querySchema에 추가:

```ts
  // 누락 또는 정확히 "1"만. 그 외 값은 400 — 옵트인을 조용히 무시하지 않는다(accessible 관례 동형).
  includeGeometry: z
    .union([z.literal("1"), z.null()])
    .transform((v) => v === "1"),
```

`searchParams.get("includeGeometry")`를 파싱 입력에 추가하고 `getWalkRoute(parsed.data)`로 그대로 전달.

- [ ] **Step 4: 통과 확인** — `npm run test:run -- walk-route` PASS, `npm run test:run` 전체 green(기존 스키마 회귀 없음), `npm run lint`.

- [ ] **Step 5: Commit** — `git commit -m "feat(api): 도보 경로 includeGeometry 옵트인(폴리라인 보존, no-store)" -- src/lib/walk-route.ts src/lib/providers/kakao-walk.ts src/lib/types.ts src/app/api/route/walk/route.ts src/lib/__tests__/walk-route.test.ts`

### Task 2: 웹 기하 모듈 `route-geometry.ts`

**Files:**
- Create: `src/lib/route-geometry.ts`
- Test: `src/lib/__tests__/route-geometry.test.ts`

**Interfaces:**
- Consumes: `Coord`(`src/lib/types.ts`), `haversineMeters`(`src/lib/geo.ts`).
- Produces(Task 3·4·9가 사용, 시그니처 고정):

```ts
export interface Polyline { points: Coord[]; cum: number[] }          // cum[i] = 시작점→points[i] 누적 m
export interface StepSpan { index: number; description: string; startD: number; endD: number; isLong: boolean }
export interface GuideRoute { polyline: Polyline; steps: StepSpan[]; totalMeters: number }
export function buildGuideRoute(steps: { description: string; pathCoords?: Coord[] }[]): GuideRoute | null
export interface Projection { d: number; perpMeters: number }
export function projectOnPolyline(poly: Polyline, p: Coord, fromD: number, toD: number): Projection | null
export function globalCandidates(poly: Polyline, p: Coord, maxPerp: number): Projection[]
```

- [ ] **Step 1: 실패 테스트** — 직선·꺾은선 소형 기하로:

```ts
import { buildGuideRoute, projectOnPolyline, globalCandidates } from "@/lib/route-geometry";

// 위도 1도 ≈ 111,320m. dLat(m) 헬퍼로 미터를 위도로 환산해 남북 직선 경로를 만든다.
const M = 1 / 111320;
const pt = (m: number, lngOff = 0) => ({ lat: 37.5 + m * M, lng: 127.1 + lngOff * M });

describe("buildGuideRoute", () => {
  it("이음매 연속 경로를 스텝 스팬으로 조립한다", () => {
    const r = buildGuideRoute([
      { description: "100m 이동", pathCoords: [pt(0), pt(100)] },
      { description: "횡단보도 이용", pathCoords: [pt(100), pt(120)] },
    ]);
    expect(r).not.toBeNull();
    expect(r!.totalMeters).toBeCloseTo(120, 0);
    expect(r!.steps[0]).toMatchObject({ startD: 0, isLong: true });
    expect(r!.steps[1].isLong).toBe(false); // 20m < LONG_STEP_MIN
  });
  it("검증 실패는 null: 기하 없는 스텝", () =>
    expect(buildGuideRoute([{ description: "이동" }])).toBeNull());
  it("검증 실패는 null: 이음매 불연속 > 5m", () =>
    expect(buildGuideRoute([
      { description: "a", pathCoords: [pt(0), pt(100)] },
      { description: "b", pathCoords: [pt(110), pt(200)] },
    ])).toBeNull());
  it("검증 실패는 null: 비유한 좌표", () =>
    expect(buildGuideRoute([{ description: "a", pathCoords: [pt(0), { lat: NaN, lng: 127.1 }] }])).toBeNull());
});

describe("projectOnPolyline", () => {
  const poly = buildGuideRoute([{ description: "a", pathCoords: [pt(0), pt(300)] }])!.polyline;
  it("창 안 투영: 진행거리·수직거리", () => {
    const pr = projectOnPolyline(poly, pt(150, 10), 100, 200)!;
    expect(pr.d).toBeCloseTo(150, 0);
    expect(pr.perpMeters).toBeCloseTo(10, 0);
  });
  it("창 밖이면 창 경계로 클램프된 투영을 준다", () => {
    const pr = projectOnPolyline(poly, pt(250), 0, 200)!;
    expect(pr.d).toBeCloseTo(200, 0);
  });
});

describe("globalCandidates", () => {
  it("자기근접(왕복) 경로는 후보 2개", () => {
    // 북으로 300m 갔다가 동 20m 옆 평행선으로 남으로 300m 복귀하는 U자
    const r = buildGuideRoute([
      { description: "북", pathCoords: [pt(0), pt(300)] },
      { description: "동", pathCoords: [pt(300), pt(300, 20)] },
      { description: "남", pathCoords: [pt(300, 20), pt(0, 20)] },
    ])!;
    const c = globalCandidates(r.polyline, pt(150, 10), 30);
    expect(c.length).toBe(2); // 북행·남행 두 가지에 모두 근접
  });
});
```

- [ ] **Step 2: 실패 확인** — `npm run test:run -- route-geometry`. Expected: FAIL(모듈 없음).

- [ ] **Step 3: 구현** — `src/lib/route-geometry.ts`:

```ts
/**
 * 도보 경로 기하: 폴리라인 조립·검증·투영 (순수 — React/navigator 비의존).
 * Kit 미러 RouteGeometry.swift와 공유 fixture로 동조(스펙 §7.1).
 *
 * 투영은 위경도를 기준점 주변 로컬 평면(m)으로 펴서 계산한다. 보행 스케일(수백 m)에서
 * 등장방형 근사 오차는 cm 단위라 충분하다. 전역 최근접 매칭 금지 — 경로 자기근접
 * 12m 구간에서 엉뚱한 스텝을 고른다(조사 §2). 호출자는 반드시 창을 구속한다.
 */
import { haversineMeters } from "./geo";
import type { Coord } from "./types";

export const LONG_STEP_MIN_M = 40; // 25m 미만 구간 21%·GPS σ10m 4σ 여유(스펙 §5.2)
export const SEAM_TOLERANCE_M = 5;

export interface Polyline { points: Coord[]; cum: number[] }
export interface StepSpan { index: number; description: string; startD: number; endD: number; isLong: boolean }
export interface GuideRoute { polyline: Polyline; steps: StepSpan[]; totalMeters: number }
export interface Projection { d: number; perpMeters: number }

const finite = (c: Coord) => Number.isFinite(c.lat) && Number.isFinite(c.lng);

/** 스텝 기하를 하나의 연속 폴리라인+스텝 스팬으로 조립. 검증 실패는 null(간략 폴백, fail-closed). */
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
    for (const p of pc) {
      if (points.length === 0) {
        points.push(p); cum.push(0);
        continue;
      }
      const prev = points[points.length - 1];
      const seg = haversineMeters(prev.lat, prev.lng, p.lat, p.lng);
      if (points.length > 0 && cum.length === points.length && seg === 0) continue; // 중복점 제거
      // 스텝 첫 점은 직전 스텝 끝점과 이어져야 한다(이음매 검증).
      if (p === pc[0] && seg > SEAM_TOLERANCE_M) return null;
      d += seg;
      points.push(p); cum.push(d);
    }
    if (d - startD <= 0 && i > 0 && pc.length < 2) return null; // 길이 0 스텝(점 하나)은 앞 스텝에 흡수 불가
    spans.push({
      index: i, description: steps[i].description,
      startD, endD: d, isLong: d - startD >= LONG_STEP_MIN_M,
    });
  }
  if (points.length < 2 || d <= 0) return null;
  return { polyline: { points, cum }, steps: spans, totalMeters: d };
}

/** 로컬 평면(m) 좌표로 변환(기준점 ref). */
function toLocal(ref: Coord, p: Coord): { x: number; y: number } {
  const y = (p.lat - ref.lat) * 111320;
  const x = (p.lng - ref.lng) * 111320 * Math.cos((ref.lat * Math.PI) / 180);
  return { x, y };
}

/** [fromD, toD] 창 안에서 p의 최근접 투영. 창과 겹치는 세그먼트가 없으면 null. */
export function projectOnPolyline(
  poly: Polyline, p: Coord, fromD: number, toD: number,
): Projection | null {
  let best: Projection | null = null;
  for (let i = 0; i < poly.points.length - 1; i++) {
    const d0 = poly.cum[i], d1 = poly.cum[i + 1];
    if (d1 < fromD || d0 > toD || d1 === d0) continue;
    const a = toLocal(p, poly.points[i]);
    const b = toLocal(p, poly.points[i + 1]);
    const abx = b.x - a.x, aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    let t = len2 === 0 ? 0 : (-a.x * abx - a.y * aby) / len2; // p는 로컬 원점
    t = Math.max(0, Math.min(1, t));
    let d = d0 + (d1 - d0) * t;
    d = Math.max(fromD, Math.min(toD, d)); // 창 클램프
    const px = a.x + abx * t, py = a.y + aby * t;
    const perp = Math.hypot(px, py);
    if (!best || perp < best.perpMeters) best = { d, perpMeters: perp };
  }
  return best;
}

/** 전역 후보(국소 최소점들). 수직거리 ≤ maxPerp인 후보를 진행거리 30m 간격으로 병합해 반환. */
export function globalCandidates(poly: Polyline, p: Coord, maxPerp: number): Projection[] {
  const raw: Projection[] = [];
  for (let i = 0; i < poly.points.length - 1; i++) {
    const pr = projectOnPolyline(poly, p, poly.cum[i], poly.cum[i + 1]);
    if (pr && pr.perpMeters <= maxPerp) raw.push(pr);
  }
  raw.sort((x, y) => x.d - y.d);
  const merged: Projection[] = [];
  for (const c of raw) {
    const last = merged[merged.length - 1];
    if (last && c.d - last.d < 30) {
      if (c.perpMeters < last.perpMeters) merged[merged.length - 1] = c;
    } else merged.push(c);
  }
  return merged;
}
```

- [ ] **Step 4: 통과 확인** — `npm run test:run -- route-geometry` PASS. 이음매 검증 로직에서 첫 스텝(`i===0`) 처리와 중복점 스킵이 테스트 4종을 모두 통과하는지 확인(구현 미세 조정 허용, 시그니처·검증 정책은 불변).

- [ ] **Step 5: Commit** — `git commit -m "feat(lib): 도보 경로 기하 모듈(조립·검증·구속 투영·전역 후보)" -- src/lib/route-geometry.ts src/lib/__tests__/route-geometry.test.ts`

### Task 3: 웹 리듀서 `route-guide.ts` + 공유 시나리오 fixture

**Files:**
- Create: `src/lib/route-guide.ts`
- Create: `src/lib/__tests__/fixtures/route-guide-scenarios.json`
- Test: `src/lib/__tests__/route-guide.test.ts`

**Interfaces:**
- Consumes: Task 2 전부.
- Produces(Task 4 미러·Task 7 iOS·Task 9 웹이 사용):

```ts
export type GuidePhase = "following" | "bundle" | "uncertain" | "reacquiring" | "offRoute";
export interface GuideFix { lat: number; lng: number; accuracy: number }
export interface GuideState { /* 아래 구현 코드가 정본 */ }
export type GuideEvent =
  | { kind: "announceSteps"; indices: number[] }        // 선행 낭독(1개=긴 스텝, 여러 개=묶음 통독)
  | { kind: "periodic"; stepIndex: number; remainingMeters: number; accuracy: number }
  | { kind: "bundleReread"; indices: number[] }
  | { kind: "handoff" }
  | { kind: "offRoute" } | { kind: "backOnRoute" }
  | { kind: "uncertainEnter" } | { kind: "uncertainExit" }
  | { kind: "reacquiring" } | { kind: "reacquired" }
  | { kind: "speedSuggest" };
export type GuideTone = "ahead" | "warning";
export function initialGuideState(route: GuideRoute, now: number): { state: GuideState; firstIndices: number[] }
export function guideStep(state: GuideState, fix: GuideFix, route: GuideRoute, now: number):
  { state: GuideState; event: GuideEvent | null; tone: GuideTone | null }
export function entryProjection(route: GuideRoute, fix: GuideFix):
  { status: "ok"; d: number } | { status: "ambiguous" } | { status: "none" }
export function guideStateAt(route: GuideRoute, d: number, now: number, opts?: { autoHandoffArmed?: boolean }): GuideState
```

- 확신도 3단·문장 조립은 리듀서 밖(플랫폼 i18n 계층, Task 5 키). 리듀서는 수치·이벤트만.

- [ ] **Step 1: 시나리오 fixture 작성** — `route-guide-scenarios.json`. 남북 직선 좌표계(위도 환산, Task 2 테스트와 동일 규약)로 웹·Swift가 같은 표를 돌린다. 형식:

```json
{
  "comment": "웹 route-guide.test.ts와 Kit RouteGuideTests가 함께 소비하는 경계표. lat=37.5+m/111320, lng=127.1(+lateral/111320·cos lat). 스텝은 lengthMeters 순서대로 남→북 직선 배치.",
  "scenarios": [
    { "name": "긴 구간 선행 낭독과 전진 분리",
      "steps": [{ "len": 200, "desc": "직진A" }, { "len": 100, "desc": "우회전B" }],
      "fixes": [
        { "t": 0, "along": 0, "lateral": 0, "acc": 10 },
        { "t": 10, "along": 100, "lateral": 0, "acc": 10 },
        { "t": 20, "along": 165, "lateral": 0, "acc": 10 },
        { "t": 30, "along": 220, "lateral": 0, "acc": 10 }
      ],
      "expect": [
        { "afterFix": 2, "event": "announceSteps", "indices": [1], "tone": "ahead" },
        { "afterFix": 3, "eventNot": "announceSteps" }
      ] },
    { "name": "묶음 통독은 선행·재통독은 주기 (묶음 잔여 85m라 다음 선행 낭독 미발동 구간)",
      "steps": [{ "len": 100, "desc": "직진" }, { "len": 30, "desc": "횡단보도" }, { "len": 30, "desc": "이동" }, { "len": 30, "desc": "좌회전" }, { "len": 100, "desc": "직진2" }],
      "fixes": [
        { "t": 0, "along": 0, "lateral": 0, "acc": 10 },
        { "t": 10, "along": 70, "lateral": 0, "acc": 10 },
        { "t": 18, "along": 105, "lateral": 0, "acc": 10 },
        { "t": 26, "along": 115, "lateral": 0, "acc": 10 }
      ],
      "expect": [
        { "afterFix": 1, "event": "announceSteps", "indices": [1, 2, 3] },
        { "afterFix": 2, "eventNull": true },
        { "afterFix": 3, "event": "bundleReread", "indices": [1, 2, 3] }
      ] },
    { "name": "인계는 전 스텝 낭독 완료 AND 잔여 50m (구속 창을 넘지 않는 점진 접근)",
      "steps": [{ "len": 300, "desc": "직진" }],
      "fixes": [
        { "t": 0, "along": 0, "lateral": 0, "acc": 10 },
        { "t": 10, "along": 40, "lateral": 0, "acc": 10 },
        { "t": 20, "along": 85, "lateral": 0, "acc": 10 },
        { "t": 30, "along": 130, "lateral": 0, "acc": 10 },
        { "t": 40, "along": 175, "lateral": 0, "acc": 10 },
        { "t": 50, "along": 220, "lateral": 0, "acc": 10 },
        { "t": 60, "along": 255, "lateral": 0, "acc": 10 }
      ],
      "expect": [
        { "afterFix": 5, "eventNot": "handoff" },
        { "afterFix": 6, "event": "handoff" }
      ] },
    { "name": "uncertain 진입·회복과 낭독 정지",
      "steps": [{ "len": 500, "desc": "직진" }],
      "fixes": [
        { "t": 0, "along": 0, "lateral": 0, "acc": 10 },
        { "t": 10, "along": 100, "lateral": 0, "acc": 80 },
        { "t": 20, "along": 150, "lateral": 0, "acc": 80 },
        { "t": 30, "along": 200, "lateral": 0, "acc": 15 }
      ],
      "expect": [
        { "afterFix": 1, "event": "uncertainEnter" },
        { "afterFix": 2, "eventNull": true },
        { "afterFix": 3, "event": "uncertainExit" }
      ] },
    { "name": "이탈 20초 지속 후 통지·전역 복귀 감지",
      "steps": [{ "len": 500, "desc": "직진" }],
      "fixes": [
        { "t": 0, "along": 0, "lateral": 0, "acc": 10 },
        { "t": 5, "along": 100, "lateral": 80, "acc": 10 },
        { "t": 13, "along": 100, "lateral": 80, "acc": 10 },
        { "t": 21, "along": 100, "lateral": 80, "acc": 10 },
        { "t": 29, "along": 100, "lateral": 80, "acc": 10 },
        { "t": 37, "along": 150, "lateral": 0, "acc": 10 }
      ],
      "expect": [
        { "afterFix": 2, "eventNot": "offRoute" },
        { "afterFixAny": [3, 4], "event": "offRoute", "tone": "warning" },
        { "afterFix": 5, "event": "backOnRoute" }
      ] },
    { "name": "차량 속도: speedSuggest 1회, 이탈 재통지 억제",
      "steps": [{ "len": 2000, "desc": "직진" }],
      "fixes": [
        { "t": 0, "along": 0, "lateral": 0, "acc": 10 },
        { "t": 5, "along": 40, "lateral": 0, "acc": 10 },
        { "t": 10, "along": 90, "lateral": 0, "acc": 10 },
        { "t": 15, "along": 140, "lateral": 0, "acc": 10 },
        { "t": 20, "along": 190, "lateral": 0, "acc": 10 }
      ],
      "expect": [{ "afterFixAny": [3, 4], "event": "speedSuggest" }] },
    { "name": "fix 공백 10초 후 reacquiring",
      "steps": [{ "len": 500, "desc": "직진" }],
      "fixes": [
        { "t": 0, "along": 0, "lateral": 0, "acc": 10 },
        { "t": 30, "along": 200, "lateral": 0, "acc": 10 }
      ],
      "expect": [{ "afterFix": 1, "event": "reacquiring" }] },
    { "name": "다중 구간 통과는 최신만(낭독 병합)",
      "steps": [{ "len": 100, "desc": "A" }, { "len": 100, "desc": "B" }, { "len": 100, "desc": "C" }],
      "fixes": [
        { "t": 0, "along": 0, "lateral": 0, "acc": 10 },
        { "t": 5, "along": 40, "lateral": 0, "acc": 5 },
        { "t": 6, "along": 230, "lateral": 0, "acc": 5 }
      ],
      "expect": [{ "afterFix": 2, "eventOneOf": ["announceSteps", "reacquiring"] }] }
  ]
}
```

(마지막 시나리오는 GPS 점프가 창 경계 클램프 → `reacquiring` 경로로 갈 수도 있어 두 허용값을 둔다 — 어느 쪽이든 "중간 안내 B의 개별 낭독 없음"이 계약이다.)

- [ ] **Step 2: 테스트 하니스 작성** — `route-guide.test.ts`:

```ts
import scenarios from "./fixtures/route-guide-scenarios.json";
import { buildGuideRoute } from "@/lib/route-guide"; // re-export 사용
import { initialGuideState, guideStep } from "@/lib/route-guide";

const M = 1 / 111320;
function routeFrom(steps: { len: number; desc: string }[]) {
  let acc = 0;
  return buildGuideRoute(steps.map((s) => {
    const pathCoords = [
      { lat: 37.5 + acc * M, lng: 127.1 },
      { lat: 37.5 + (acc + s.len) * M, lng: 127.1 },
    ];
    acc += s.len;
    return { description: s.desc, pathCoords };
  }))!;
}
const fixCoord = (along: number, lateral: number) => ({
  lat: 37.5 + along * M,
  lng: 127.1 + (lateral * M) / Math.cos((37.5 * Math.PI) / 180),
});

for (const sc of (scenarios as any).scenarios) {
  it(sc.name, () => {
    const route = routeFrom(sc.steps);
    let { state } = initialGuideState(route, 0);
    const results: { event: any; tone: any }[] = [];
    for (const f of sc.fixes) {
      const out = guideStep(state, { ...fixCoord(f.along, f.lateral), accuracy: f.acc }, route, f.t);
      state = out.state;
      results.push({ event: out.event, tone: out.tone });
    }
    for (const ex of sc.expect) {
      const idx = ex.afterFix ?? ex.afterFixAny;
      const rs = Array.isArray(idx) ? idx.map((i: number) => results[i]) : [results[idx]];
      if (ex.event) expect(rs.some((r) => r.event?.kind === ex.event)).toBe(true);
      if (ex.eventNot) rs.forEach((r) => expect(r.event?.kind).not.toBe(ex.eventNot));
      if (ex.eventNull) rs.forEach((r) => expect(r.event).toBeNull());
      if (ex.eventOneOf) expect(rs.some((r) => ex.eventOneOf.includes(r.event?.kind))).toBe(true);
      if (ex.indices) expect(rs.find((r) => r.event?.indices)?.event.indices).toEqual(ex.indices);
      if (ex.tone) expect(rs.some((r) => r.tone === ex.tone)).toBe(true);
    }
  });
}
```

추가 직접 단언(시나리오 표 밖): `entryProjection` — U자 경로(Task 2의 globalCandidates 기하)에서 `ambiguous`, 단일 후보에서 `ok`, 경로에서 200m 밖이면 `none`. `initialGuideState` — 첫 유닛이 묶음이면 `firstIndices`가 묶음 전체.

- [ ] **Step 3: 실패 확인** — `npm run test:run -- route-guide`. Expected: FAIL(모듈 없음).

- [ ] **Step 4: 리듀서 구현** — `src/lib/route-guide.ts` (아래가 정본 — 시그니처·상수·전이 변경 금지, 미세 버그 수정만 허용):

```ts
/**
 * 경로 추종형 안내 순수 리듀서(스펙 §5 정본 구현 — deterministic, I/O·시계 비의존).
 * 상태 모델·이벤트 우선순위는 스펙 §5.0, 낭독 선행·전진 후행은 §5.3.
 * Kit 미러: RouteGuide.swift (공유 fixture route-guide-scenarios.json이 동조 강제).
 */
import {
  buildGuideRoute, projectOnPolyline, globalCandidates,
  type GuideRoute, type StepSpan,
} from "./route-geometry";
export { buildGuideRoute, type GuideRoute } from "./route-geometry";

export const ANNOUNCE_AHEAD_M = 40;
export const ADVANCE_MARGIN_BASE_M = 15;
export const HANDOFF_DIST_M = 50;
export const HANDOFF_REARM_M = HANDOFF_DIST_M + 20;
export const UNCERTAIN_ACCURACY_M = 50;
export const OFF_ROUTE_BASE_M = 30;
export const OFF_ROUTE_HOLD_S = 20;
export const OFF_ROUTE_RENOTIFY_S = 60;
export const REACQUIRE_GAP_S = 10;
export const WINDOW_BACK_M = 20;
export const WINDOW_AHEAD_MIN_M = 50;
export const EDGE_HITS_MAX = 3;
export const SPEED_ENTER_MPS = 3;
export const SPEED_CLEAR_MPS = 2;
export const SPEED_WINDOW_S = 10;
export const RESOLVE_TIMEOUT_S = 30;

export type GuidePhase = "following" | "bundle" | "uncertain" | "reacquiring" | "offRoute";
export interface GuideFix { lat: number; lng: number; accuracy: number }

export interface GuideState {
  phase: GuidePhase;
  resumePhase: "following" | "bundle";
  d: number;
  stepIndex: number;
  announcedUpTo: number;
  lastAnnouncedAt: number;
  lastFixAt: number | null;
  windowEdgeHits: number;
  offRouteSince: number | null;
  lastOffRouteNoticeAt: number | null;
  offRouteNotified: boolean;
  speedSamples: { at: number; d: number }[];
  speedGuardActive: boolean;
  speedWarned: boolean;
  autoHandoffArmed: boolean;
}

export type GuideEvent =
  | { kind: "announceSteps"; indices: number[] }
  | { kind: "periodic"; stepIndex: number; remainingMeters: number; accuracy: number }
  | { kind: "bundleReread"; indices: number[] }
  | { kind: "handoff" }
  | { kind: "offRoute" } | { kind: "backOnRoute" }
  | { kind: "uncertainEnter" } | { kind: "uncertainExit" }
  | { kind: "reacquiring" } | { kind: "reacquired" }
  | { kind: "speedSuggest" };
export type GuideTone = "ahead" | "warning";
export interface GuideOutput { state: GuideState; event: GuideEvent | null; tone: GuideTone | null }

/** 스텝 index가 속한 유닛(긴 스텝=자기 하나, 짧은 스텝=연속 묶음 전체)의 index 목록. */
export function unitAt(route: GuideRoute, index: number): number[] {
  const s = route.steps[index];
  if (!s) return [];
  if (s.isLong) return [index];
  let a = index, b = index;
  while (a > 0 && !route.steps[a - 1].isLong) a--;
  while (b < route.steps.length - 1 && !route.steps[b + 1].isLong) b++;
  return route.steps.slice(a, b + 1).map((x) => x.index);
}

function stepAt(route: GuideRoute, d: number): StepSpan {
  for (const s of route.steps) if (d < s.endD) return s;
  return route.steps[route.steps.length - 1];
}

export function guideStateAt(
  route: GuideRoute, d: number, now: number,
  opts?: { autoHandoffArmed?: boolean },
): GuideState {
  const step = stepAt(route, d);
  const unit = unitAt(route, step.index);
  return {
    phase: step.isLong ? "following" : "bundle",
    resumePhase: step.isLong ? "following" : "bundle",
    d, stepIndex: step.index,
    announcedUpTo: unit[unit.length - 1],
    lastAnnouncedAt: now, lastFixAt: null,
    windowEdgeHits: 0, offRouteSince: null, lastOffRouteNoticeAt: null, offRouteNotified: false,
    speedSamples: [], speedGuardActive: false, speedWarned: false,
    autoHandoffArmed: opts?.autoHandoffArmed ?? true,
  };
}

/** 시작 상태 + 원자 시작 발화에 넣을 첫 유닛(스펙 §5.3 시작 문장은 오케스트레이터가 조립). */
export function initialGuideState(route: GuideRoute, now: number): { state: GuideState; firstIndices: number[] } {
  const state = guideStateAt(route, 0, now);
  return { state, firstIndices: unitAt(route, 0) };
}

/** 간략→상세 전환·재조회 후 초기 투영(스펙 §6): 모호하면 확정하지 않는다. */
export function entryProjection(route: GuideRoute, fix: GuideFix):
  { status: "ok"; d: number } | { status: "ambiguous" } | { status: "none" } {
  const maxPerp = Math.max(OFF_ROUTE_BASE_M, 2 * fix.accuracy);
  const cands = globalCandidates(route.polyline, fix, maxPerp);
  if (cands.length === 0) return { status: "none" };
  if (cands.length > 1) return { status: "ambiguous" };
  return { status: "ok", d: cands[0].d };
}

function periodicIntervalS(remaining: number): number {
  if (remaining > 500) return 60;
  if (remaining >= 150) return 30;
  return 15;
}

export function guideStep(
  state: GuideState, fix: GuideFix, route: GuideRoute, now: number,
): GuideOutput {
  // 0) 역순·정지 시각 방어: now가 과거로 가면 fix 폐기(상태 불변).
  if (state.lastFixAt !== null && now < state.lastFixAt) return { state, event: null, tone: null };

  // 1) uncertain 게이트(정확도 무효 포함): 자동 낭독·타이머 전부 정지.
  const accBad = !(fix.accuracy > 0) || fix.accuracy > UNCERTAIN_ACCURACY_M;
  if (state.phase === "uncertain") {
    if (accBad) return { state: { ...state, lastFixAt: now }, event: null, tone: null };
    const s = { ...state, phase: state.resumePhase, lastFixAt: now, lastAnnouncedAt: now };
    return { state: s, event: { kind: "uncertainExit" }, tone: null };
  }
  if (accBad) {
    return {
      state: { ...state, phase: "uncertain", lastFixAt: now, speedSamples: [] },
      event: { kind: "uncertainEnter" }, tone: null,
    };
  }

  // 2) reacquiring: 전역 재탐색(모호하면 유지).
  if (state.phase === "reacquiring") {
    const entry = entryProjection(route, fix);
    if (entry.status !== "ok") return { state: { ...state, lastFixAt: now }, event: null, tone: null };
    const s = { ...guideStateAt(route, entry.d, now, { autoHandoffArmed: state.autoHandoffArmed }),
      speedWarned: state.speedWarned, lastFixAt: now };
    return { state: s, event: { kind: "reacquired" }, tone: null };
  }
  const gap = state.lastFixAt !== null && now - state.lastFixAt > REACQUIRE_GAP_S;
  if (gap || state.windowEdgeHits >= EDGE_HITS_MAX) {
    return {
      state: { ...state, phase: "reacquiring", windowEdgeHits: 0, speedSamples: [], lastFixAt: now },
      event: { kind: "reacquiring" }, tone: null,
    };
  }

  // 3) 구속 창 투영 + 단조 전진.
  const ahead = Math.max(WINDOW_AHEAD_MIN_M, 3 * fix.accuracy);
  const proj = projectOnPolyline(route.polyline, fix, state.d - WINDOW_BACK_M, state.d + ahead);
  if (!proj) return { state: { ...state, lastFixAt: now }, event: null, tone: null };
  const d = Math.max(state.d, proj.d);
  // 창 경계 적중은 "경로 위인데 창이 못 따라간" 신호일 때만 센다. 수직거리가 크면
  // 그것은 이탈 증거이지 창 기아가 아니다(두 판정이 경합하면 이탈이 영영 확정되지 않는다).
  const offThresholdEarly = Math.max(OFF_ROUTE_BASE_M, 2 * fix.accuracy);
  const edgeHit = proj.d >= state.d + ahead - 1 && proj.perpMeters <= offThresholdEarly;
  const windowEdgeHits = edgeHit ? state.windowEdgeHits + 1 : 0;

  // 4) 속도 창(중앙값) — uncertain·reacquiring 밖에서만 표본 수집.
  const samples = [...state.speedSamples, { at: now, d }].filter((s) => now - s.at <= SPEED_WINDOW_S);
  const speeds: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i].at - samples[i - 1].at;
    if (dt > 0) speeds.push((samples[i].d - samples[i - 1].d) / dt);
  }
  speeds.sort((a, b) => a - b);
  const median = speeds.length ? speeds[Math.floor(speeds.length / 2)] : 0;
  const windowSpan = samples.length >= 2 ? samples[samples.length - 1].at - samples[0].at : 0;
  let speedGuardActive = state.speedGuardActive;
  if (windowSpan >= SPEED_WINDOW_S * 0.8) {
    if (!speedGuardActive && median > SPEED_ENTER_MPS) speedGuardActive = true;
    else if (speedGuardActive && median < SPEED_CLEAR_MPS) speedGuardActive = false;
  }

  // 5) 이탈 판정(수직거리 기준, 단조 시각 지속).
  const offThreshold = Math.max(OFF_ROUTE_BASE_M, 2 * fix.accuracy);
  const isOff = proj.perpMeters > offThreshold;
  let next: GuideState = {
    ...state, d, stepIndex: stepAt(route, d).index, lastFixAt: now,
    windowEdgeHits, speedSamples: samples, speedGuardActive,
  };
  // 재무장: 수동 복귀 세션은 잔여가 재무장선 밖으로 나가야 자동 인계 허용.
  const remainingTotal = route.totalMeters - d;
  if (!next.autoHandoffArmed && remainingTotal > HANDOFF_REARM_M) next.autoHandoffArmed = true;

  if (state.phase === "offRoute") {
    // 이탈 중 복귀 감지는 구속 창이 아니라 전역 후보로 한다. 이탈 동안 창이 뒤에
    // 머물러 있어, 사용자가 경로 앞쪽으로 복귀해도 창 안 투영으로는 영영 못 잡는다.
    const entry = entryProjection(route, fix);
    if (entry.status === "ok") {
      const back = { ...guideStateAt(route, entry.d, now, { autoHandoffArmed: state.autoHandoffArmed }),
        speedSamples: samples, speedGuardActive, speedWarned: state.speedWarned, lastFixAt: now };
      return { state: back, event: { kind: "backOnRoute" }, tone: null };
    }
    const canRenotify = !speedGuardActive &&
      (state.lastOffRouteNoticeAt === null || now - state.lastOffRouteNoticeAt >= OFF_ROUTE_RENOTIFY_S);
    if (canRenotify) {
      next = { ...next, lastOffRouteNoticeAt: now };
      return { state: next, event: { kind: "offRoute" }, tone: "warning" };
    }
    return { state: next, event: null, tone: null };
  }
  if (isOff) {
    const since = state.offRouteSince ?? now;
    next = { ...next, offRouteSince: since };
    if (now - since >= OFF_ROUTE_HOLD_S) {
      next = { ...next, phase: "offRoute", resumePhase: stepAt(route, d).isLong ? "following" : "bundle",
        offRouteNotified: true, lastOffRouteNoticeAt: now };
      return { state: next, event: { kind: "offRoute" }, tone: "warning" };
    }
  } else if (state.offRouteSince !== null) {
    next = { ...next, offRouteSince: null };
  }

  // 6) 국면·낭독. 현재 스텝과 유닛.
  const cur = stepAt(route, d);
  next = { ...next, phase: cur.isLong ? "following" : "bundle",
    resumePhase: cur.isLong ? "following" : "bundle" };

  // 6a) 인계: 전 스텝 낭독 완료 AND 잔여 ≤ 50m AND 재무장(스펙 §5.3). 최우선.
  if (next.autoHandoffArmed &&
      next.announcedUpTo >= route.steps.length - 1 && remainingTotal <= HANDOFF_DIST_M) {
    return { state: next, event: { kind: "handoff" }, tone: null };
  }

  // 6b) 선행 낭독: 현재 낭독 완료 유닛의 끝까지 잔여 ≤ 40m면 다음 유닛 전문.
  if (next.announcedUpTo < route.steps.length - 1) {
    const announcedEnd = route.steps[next.announcedUpTo].endD;
    if (announcedEnd - d <= ANNOUNCE_AHEAD_M) {
      const indices = unitAt(route, next.announcedUpTo + 1);
      next = { ...next, announcedUpTo: indices[indices.length - 1], lastAnnouncedAt: now };
      return { state: next, event: { kind: "announceSteps", indices }, tone: "ahead" };
    }
  }

  // 6c) 주기: following=구간 잔여, bundle=재통독. 기준은 lastAnnouncedAt(스펙 §5.3).
  const sinceAnnounce = now - next.lastAnnouncedAt;
  if (cur.isLong) {
    const remainingStep = cur.endD - d;
    if (sinceAnnounce >= periodicIntervalS(remainingStep)) {
      next = { ...next, lastAnnouncedAt: now };
      return {
        state: next,
        event: { kind: "periodic", stepIndex: cur.index, remainingMeters: Math.round(remainingStep), accuracy: fix.accuracy },
        tone: null,
      };
    }
  } else if (sinceAnnounce >= 15) {
    const indices = unitAt(route, cur.index);
    next = { ...next, lastAnnouncedAt: now };
    return { state: next, event: { kind: "bundleReread", indices }, tone: null };
  }

  // 6d) 속도 제안(최하위, 세션당 1회).
  if (speedGuardActive && !next.speedWarned) {
    next = { ...next, speedWarned: true };
    return { state: next, event: { kind: "speedSuggest" }, tone: null };
  }
  return { state: next, event: null, tone: null };
}
```

- [ ] **Step 5: 통과 확인** — `npm run test:run -- route-guide` PASS. 시나리오 실패 시 리듀서를 고치되 스펙 계약(우선순위·선행 낭독·정지 규칙)을 시나리오에 맞춰 약화하지 말 것 — 시나리오 표가 어긋나면 스펙 §5와 대조해 표 쪽 수치를 고친다(스펙이 정본).

- [ ] **Step 6: Commit** — `git commit -m "feat(lib): 경로 추종 리듀서 route-guide(상태 모델·이벤트 우선순위·공유 시나리오)" -- src/lib/route-guide.ts src/lib/__tests__/route-guide.test.ts src/lib/__tests__/fixtures/route-guide-scenarios.json`

### Task 4: Kit 미러 `RouteGeometry.swift`·`RouteGuide.swift`

**Files:**
- Create: `ios/GildongmuKit/Sources/GildongmuKit/RouteGeometry.swift`
- Create: `ios/GildongmuKit/Sources/GildongmuKit/RouteGuide.swift`
- Test: `ios/GildongmuKit/Tests/GildongmuKitTests/RouteGuideTests.swift`

**Interfaces:**
- Consumes: 웹 정본(Task 2·3) — **1:1 포팅**이 계약이다. 타입 대응: `Coord`→`RoutePoint(lat:lng:)`(Task 6에서 Codable로도 사용), `GuideState`→`struct GuideState: Equatable, Sendable`, 이벤트는 `enum GuideEvent: Equatable, Sendable { case announceSteps([Int]), periodic(stepIndex: Int, remainingMeters: Int, accuracy: Double), bundleReread([Int]), handoff, offRoute, backOnRoute, uncertainEnter, uncertainExit, reacquiring, reacquired, speedSuggest }`, `enum GuideTone { case ahead, warning }`.
- Produces(Task 7이 사용): `buildGuideRoute(steps:)`, `initialGuideState(route:now:)`, `guideStateAt(route:d:now:autoHandoffArmed:)`, `guideStep(state:fix:route:now:)`, `entryProjection(route:fix:)`, `unitAt(route:index:)` — 웹과 동명·동의미. 상수도 동값(`public let`).

- [ ] **Step 1: fixture 하니스 테스트 작성** — `RouteGuideTests.swift`가 `#filePath` 기준 상대 경로로 `src/lib/__tests__/fixtures/route-guide-scenarios.json`을 읽어(레포 상대 `../../../../../src/lib/__tests__/fixtures/`, `format-drift.test.ts`의 파일 직접 읽기 관례 동형) 웹 하니스와 동일한 좌표 환산·단언을 수행한다. Swift Testing(`@Test`) 사용, 시나리오마다 `#expect`.

- [ ] **Step 2: 실패 확인** — `cd ios/GildongmuKit && swift test 2>&1 | tail -5`. Expected: 컴파일 실패(타입 없음).

- [ ] **Step 3: 포팅** — 웹 `route-geometry.ts`·`route-guide.ts`를 함수 단위 1:1로 옮긴다. 로컬 평면 환산·창 클램프·중앙값·전이 순서를 바꾸지 말 것(순서가 바뀌면 fixture가 갈린다). `haversineMeters`는 Kit `Geo.swift` 기존 함수 사용.

- [ ] **Step 4: 통과 확인** — `swift test` PASS (기존 스위트 포함 전부).

- [ ] **Step 5: Commit** — `git commit -m "feat(kit): RouteGuide 미러(공유 시나리오 fixture 동조)" -- ios/GildongmuKit/Sources/GildongmuKit/RouteGeometry.swift ios/GildongmuKit/Sources/GildongmuKit/RouteGuide.swift ios/GildongmuKit/Tests/GildongmuKitTests/RouteGuideTests.swift`

### Task 5: i18n — guide.* 신설 + beacon 문구 개칭

**Files:**
- Modify: `messages/ko.json`, `messages/en.json`, `messages/es.json`, `messages/fr.json`, `messages/it.json`, `messages/ja.json`
- Modify: `ios/Gildongmu/Resources/Localizable.xcstrings`(재생성), Kit 카탈로그(재생성)
- Test: 기존 `i18n-messages.test.ts` 레인(키 일관성 자동 검증)

**Interfaces:**
- Produces: 아래 키 전부(Task 7·8·9가 사용). 포맷 인자는 `{...}` 그대로.

- [ ] **Step 1: ko 키 작성** — `messages/ko.json`의 `beacon` 섹션 문구 개칭 + `guide` 섹션 신설:

```json
"beacon": { "heading": "실시간 길 안내", "start": "실시간 길 안내 시작", "stop": "안내 중지", "...": "(기타 기존 키 유지)" },
"guide": {
  "briefStarted": "간략 안내 시작",
  "detailStart": "상세 안내 시작. 안내 {count}개, 총 {distance}. {first}",
  "upcoming": "{distance} 앞, {step}",
  "next": "{step}까지 {distance}",
  "bundle": "다음 안내 {count}개. {steps}",
  "handoff": "목적지까지 직선 안내로 전환합니다",
  "offRoute": "경로에서 벗어난 것 같습니다",
  "backOnRoute": "경로로 복귀했습니다",
  "uncertain": "위치 확신이 낮습니다",
  "uncertainRecovered": "위치 확신을 회복했습니다",
  "reacquiring": "경로상 위치를 다시 찾는 중입니다",
  "speedSuggest": "이동 속도가 빨라 간략 안내가 적합합니다",
  "toDetailDone": "상세 안내로 전환했습니다",
  "toBriefDone": "간략 안내로 전환했습니다",
  "resolvePending": "경로상 위치를 확정하는 중입니다",
  "resolveFailed": "경로상 위치를 확정할 수 없어 간략 안내를 유지합니다",
  "detailUnavailable": "경로 정보를 가져오지 못해 간략 안내로 시작합니다",
  "repeatButton": "현재 안내 반복",
  "progressButton": "진행 상황",
  "toDetailButton": "상세 안내로 전환",
  "toBriefButton": "간략 안내로 전환",
  "rerouteButton": "경로 다시 조회",
  "rerouteFailed": "경로 조회에 실패했습니다. 기존 경로를 유지합니다",
  "progressFollowing": "남은 거리 {total}. {step}까지 {distance}",
  "progressBundle": "남은 거리 {total}. 다음 안내 {count}개",
  "progressUncertain": "위치 확신이 낮습니다. 마지막 안내, {last}",
  "progressOffRoute": "경로 이탈 상태. 목적지까지 직선거리 {distance}",
  "approx": "약 {distance}",
  "rough": "{distance}쯤",
  "noGuidanceYet": "아직 안내가 없습니다"
}
```

확신도 조립 규칙(모든 소비자 공통): fix 정확도 ≤10m → `{distance}` 원문 / ≤20m → `guide.approx` / >20m → `guide.rough`. 잔여 ≥200m면 원문(스펙 §5.4).

- [ ] **Step 2: 나머지 5로케일 작성** — en 정본:

```json
"beacon": { "heading": "Live guidance", "start": "Start live guidance", "stop": "Stop guidance" },
"guide": {
  "briefStarted": "Simple guidance started",
  "detailStart": "Detailed guidance started. {count} instructions, {distance} total. {first}",
  "upcoming": "In {distance}, {step}", "next": "{distance} to {step}",
  "bundle": "Next {count} instructions. {steps}",
  "handoff": "Switching to straight-line guidance to your destination",
  "offRoute": "You may be off the route", "backOnRoute": "Back on the route",
  "uncertain": "Location confidence is low", "uncertainRecovered": "Location confidence recovered",
  "reacquiring": "Re-locating you on the route",
  "speedSuggest": "You are moving fast; simple guidance fits better",
  "toDetailDone": "Switched to detailed guidance", "toBriefDone": "Switched to simple guidance",
  "resolvePending": "Finding your position on the route",
  "resolveFailed": "Could not fix your position on the route; keeping simple guidance",
  "detailUnavailable": "Route details unavailable; starting simple guidance",
  "repeatButton": "Repeat current instruction", "progressButton": "Progress",
  "toDetailButton": "Switch to detailed guidance", "toBriefButton": "Switch to simple guidance",
  "rerouteButton": "Re-query route", "rerouteFailed": "Route query failed. Keeping the current route",
  "progressFollowing": "{total} remaining. {distance} to {step}",
  "progressBundle": "{total} remaining. Next {count} instructions",
  "progressUncertain": "Location confidence is low. Last instruction, {last}",
  "progressOffRoute": "Off route. {distance} straight-line to destination",
  "approx": "about {distance}", "rough": "around {distance}", "noGuidanceYet": "No instruction yet"
}
```

es/fr/it/ja는 en 의미를 기준으로 같은 키 전부 번역해 넣는다(예: es `"approx": "unos {distance}"`, fr `"approx": "environ {distance}"`, it `"approx": "circa {distance}"`, ja `"approx": "約{distance}"` / es `"upcoming": "En {distance}, {step}"`, fr `"upcoming": "Dans {distance}, {step}"`, it `"upcoming": "Tra {distance}, {step}"`, ja `"upcoming": "{distance}先、{step}"` — 나머지 키도 이 톤으로 전부 채운다. **키 누락은 `i18n-messages.test.ts`가 잡는다**).

- [ ] **Step 3: 검증·재생성** — `npm run test:run -- i18n-messages` PASS → `node ios/scripts/messages-to-xcstrings.mjs` → `node ios/scripts/check-xcstrings-keys.mjs` PASS.

- [ ] **Step 4: Commit** — `git commit -m "feat(i18n): 실시간 길 안내 guide.* 6로케일 + 비콘 명칭 개칭" -- messages ios/Gildongmu/Resources/Localizable.xcstrings ios/GildongmuKit/Sources/GildongmuKit/Resources/Localizable.xcstrings`

### Task 6: iOS 모델·서비스 — 기하 수용

**Files:**
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/Models/RouteModels.swift:99-118`
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/RouteService.swift:53-65`
- Test: Kit 기존 테스트 스위트(디코딩 케이스 추가 — `RouteModelsTests` 관례 위치)

**Interfaces:**
- Produces: `WalkRouteStep.pathCoords: [RoutePoint]?`(옵셔널 — 기존 응답 호환), `RouteService.walk(..., includeGeometry: Bool = false)`.

- [ ] **Step 1: 실패 테스트** — pathCoords 포함/미포함 JSON 디코딩 단언(Swift Testing):

```swift
@Test func walkStepDecodesOptionalPathCoords() throws {
    let json = #"{"result":{"distanceMeters":100,"durationSeconds":80,"steps":[{"description":"이동","pathCoords":[{"lat":37.5,"lng":127.1}]},{"description":"우회전"}]}}"#
    let env = try JSONDecoder().decode(WalkRouteEnvelope.self, from: Data(json.utf8))
    #expect(env.result?.steps[0].pathCoords?.count == 1)
    #expect(env.result?.steps[1].pathCoords == nil)
}
```

- [ ] **Step 2: 실패 확인** — `swift test` 컴파일 실패 확인.
- [ ] **Step 3: 구현** — `RouteModels.swift`에 `RoutePoint`(Task 4에서 만든 타입 재사용, `Codable` 준수 확인)와 `pathCoords` 필드 추가. `RouteService.walk`에 `includeGeometry: Bool = false` 추가, true면 `URLQueryItem(name: "includeGeometry", value: "1")` (false면 파라미터 생략 — 기존 요청 byte-identical, accessible 관례 동형).
- [ ] **Step 4: 통과 확인** — `swift test` PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(ios): 도보 스텝 pathCoords 디코딩 + includeGeometry 요청" -- ios/GildongmuKit/Sources/GildongmuKit/Models/RouteModels.swift ios/GildongmuKit/Sources/GildongmuKit/RouteService.swift ios/GildongmuKit/Tests/GildongmuKitTests`

### Task 7: iOS 오케스트레이션 — BeaconModel 확장

**Files:**
- Modify: `ios/Gildongmu/Directions/BeaconModel.swift`
- Create: `ios/Gildongmu/Directions/GuideText.swift` (이벤트→i18n 문장 조립, `appLocalized` 사용)

**Interfaces:**
- Consumes: Task 4 리듀서 전부, Task 5 키, Task 6 `RouteService.walk(includeGeometry:)`.
- Produces(Task 8 UI가 사용): `BeaconModel`에 추가 — `enum GuideMode { case brief, detail }`, `private(set) var mode: GuideMode`, `var canOfferDetail: Bool`(ko 데이터 로케일 ∧ 도보 컨텍스트), `func toggleMode()`, `func repeatLastGuidance()`, `func announceProgress()`, `func requestReroute()`, `private(set) var offRoute: Bool`(재조회 버튼 노출용), `private(set) var lastGuidance: String?`.

- [ ] **Step 1: 배선 구현** (로직 금지 — 판정은 전부 Kit, 여기는 I/O·수명. 앱 타깃 테스트 번들이 없으므로 게이트는 빌드+리뷰+실기기):
  - `start(dest:label:)` 확장: 기존 게이트 통과 후, `canOfferDetail`이면 `RouteService.walk(origin: 현재좌표, dest:, includeGeometry: true)`를 시도(현재좌표는 기존 `LocationService.shared` 단발 경로) → `buildGuideRoute` 성공 시 `mode = .detail` + `initialGuideState` + 시작 원자 발화(`guide.detailStart`, first는 `GuideText.steps(...)`), 실패·null·기하 무효면 `mode = .brief` + `guide.detailUnavailable` 통지 후 기존 비콘 경로(스펙 §4.1 정직 폴백).
  - `handle(fix:)` 분기: `.brief`면 기존 `beaconStep` 경로 그대로. `.detail`이면 `guideStep(state:fix:route:now:)`(now는 `ProcessInfo.processInfo.systemUptime`) → 이벤트를 `GuideText`로 문장화 → 기존 `announce(_:)`(spokenUnits 경유)·`statusText` 갱신·`lastGuidance` 저장(announceSteps·bundleReread·periodic만). tone `ahead`→`tones.play(.nearby)` 임시(사운드 교체 Task 10에서 전용음), `warning`→`tones.play(.farther)` 임시.
  - `handoff` 이벤트: `mode = .brief` 전환 + `guide.handoff` 통지 + 비콘 상태 리셋(`beaconState = .initial`) — 이후 fix는 비콘 경로. 자동 인계 래치는 리듀서 상태가 소유.
  - `toggleMode()`: `.detail→.brief` 즉시(비콘 앵커 리셋, `guide.toBriefDone`). `.brief→.detail`은 `entryProjection`으로 — `ok`면 `guideStateAt(d:)`+`guide.toDetailDone`, `ambiguous`면 `guide.resolvePending` 통지 후 이후 fix마다 재시도(30초 타임아웃 시 `guide.resolveFailed`, 간략 유지), `none`이면 `guide.resolveFailed`.
  - `outputSuppressed` 복구(스펙 §4.3): 억제 중 발생한 `announceSteps`/`bundleReread` 문장을 `pendingRecovery`에 최신 1개만 저장, `outputSuppressed=false` 전이 시 1회 발화.
  - `requestReroute()`: 세대 토큰 + in-flight ref 가드(repo 관례). 성공 시 새 route로 `entryProjection`→리셋, 실패 시 `guide.rerouteFailed`(기존 상태 유지). 응답 도착 시 토큰·추적 여부 검사(불일치 폐기).
  - `stop()`·`teardown()`: guide 상태·route 전부 nil(스펙 §7.3 세션 폐기).
- [ ] **Step 2: `GuideText.swift`** — 이벤트→문장. 확신도 3단 래핑(`guide.approx`/`guide.rough`), 거리 문자열은 `formatDistance`, 묶음은 `. ` 연결. `progress` 문장은 phase별(스펙 §4.2 표).
- [ ] **Step 3: 빌드 확인** — `xcodebuildmcp simulator build --workspace ios/Gildongmu.xcodeproj --scheme Gildongmu` (또는 기존 빌드 관례 명령) 성공.
- [ ] **Step 4: Commit** — `git commit -m "feat(ios): 실시간 길 안내 오케스트레이션(상세 모드 배선·전환·재조회·억제 복구)" -- ios/Gildongmu/Directions/BeaconModel.swift ios/Gildongmu/Directions/GuideText.swift`

### Task 8: iOS UI — 시트 컨트롤·인라인 개칭

**Files:**
- Modify: `ios/Gildongmu/Directions/BeaconTrackingSheet.swift`
- Modify: `ios/Gildongmu/Directions/DirectionsTabView.swift:443-560` (비콘 섹션)

- [ ] **Step 1: 시트 확장** — 스펙 §4.2 순서대로: 중지(기존) → `guide.repeatButton`(`model.repeatLastGuidance()`, `lastGuidance` nil이면 `guide.noGuidanceYet` 통지) → `guide.progressButton`(`model.announceProgress()`) → 전환 버튼(`model.canOfferDetail`일 때만, 라벨은 mode에 따라 `guide.toBriefButton`/`guide.toDetailButton`) → `guide.rerouteButton`(`model.offRoute`일 때만) → 상태 1줄·힌트(기존). 포커스 계약·landStopFocus 불변. 모든 버튼 `min-h` 터치 타깃은 List 기본 행 높이로 충족.
- [ ] **Step 2: 인라인 개칭** — `beacon.heading`·`beacon.start` 키 문구는 Task 5가 이미 바꿨으므로 코드 변경은 불필요함을 확인만 한다(키 이름 유지 전략). `stopBecauseDestinationChanged` 등 기존 배선 불변.
- [ ] **Step 3: 빌드 + 시뮬 스냅샷** — 빌드 성공 + `xcodebuildmcp ui-automation snapshot-ui`로 시트 버튼 라벨·순서 확인(라벨 회귀 신호용 — 포커스 판정은 실기기 몫).
- [ ] **Step 4: Commit** — `git commit -m "feat(ios): 안내 시트 컨트롤 4종+재조회 버튼" -- ios/Gildongmu/Directions/BeaconTrackingSheet.swift ios/Gildongmu/Directions/DirectionsTabView.swift`

### Task 9: 웹 — useRouteGuide 훅 + DistanceBeacon 패널 확장

**Files:**
- Create: `src/hooks/useRouteGuide.ts`
- Modify: `src/components/DistanceBeacon.tsx`, `src/hooks/useDistanceBeacon.ts`(필요 시 export 추가만)
- Test: `src/components/__tests__/DistanceBeacon.test.tsx` (jsdom 프라그마, nearby 계약 스위트 관례)

**Interfaces:**
- Consumes: Task 2·3 리듀서, Task 5 키(`useTranslations("guide")`), `/api/route/walk?includeGeometry=1`.
- Produces: `useRouteGuide(dest: Coord)` — `{ mode, status, liveText, lastGuidance, offRoute, canOfferDetail, start, stop, toggleMode, repeat, progress, reroute }`.

- [ ] **Step 1: 실패 테스트** — 패널 렌더 계약(jsdom): ko 로케일에서 전환 버튼 노출, en에서 미노출(`canOfferDetail`), `offRoute` 시 재조회 버튼 노출, 통지는 기존 단일 live region 재사용(새 live region 추가 금지 단언 — `role="status"` 개수 1).
- [ ] **Step 2: 구현** — 훅: 시작 시 `awaitGeolocation()` 좌표로 `/api/route/walk?origin=...&dest=...&includeGeometry=1` fetch(ko 데이터 로케일에서만; `prefersEnglish`면 즉시 간략) → `buildGuideRoute` 성공 시 detail, 실패 시 brief 폴백+`guide.detailUnavailable`. watch 경로는 기존 `useDistanceBeacon`의 watchPosition 관례 재사용(같은 옵션), fix마다 mode에 따라 `beaconStep`/`guideStep(…, now: performance.now()/1000)` 분기. 이벤트→문장은 `useTranslations` 조립(확신도 3단 규칙 동일). handoff→brief 전환. **생명주기(스펙 §9)**: `visibilitychange` hidden·패널 닫힘·unmount 시 `stop()`+경로 폐기(재개 없음). 톤은 기존 `useBeaconSound` 재사용(ahead→nearby음, warning→farther음 임시 — Task 10에서 교체).
- [ ] **Step 3: 통과 확인** — `npm run test:run -- DistanceBeacon` PASS(기존 비콘 테스트 포함), `npm run lint`, `npm run build`.
- [ ] **Step 4: Commit** — `git commit -m "feat(web): 실시간 길 안내 패널(상세 모드·전환·재조회·생명주기)" -- src/hooks/useRouteGuide.ts src/components/DistanceBeacon.tsx src/components/__tests__/DistanceBeacon.test.tsx`

### Task 10: 사운드 후보 생성 (ElevenLabs — 교체 커밋은 위원장 선정 후)

**Files:**
- Create: 스크래치패드에 후보 파일(레포 밖) → 선정 후 `public/sounds/guide/*.mp3` + iOS 리소스 (별도 커밋)

- [ ] **Step 1: 후보 생성** — ElevenLabs SFX API(`POST https://api.elevenlabs.io/v1/sound-generation`, `xi-api-key: $ELEVENLABS_API_KEY`)로 8종 × 2~3후보. 프롬프트에 의미 계약 명시(스펙 §8): closer=짧은 상승 2음(≤300ms), farther=하강 2음(≤300ms), nearby=밝은 더블(≤400ms), tick=낮은 단음(≤150ms), start=상승 3음(≤500ms), stop=하강 3음(≤500ms), ahead(예고)=부드러운 트릴(≤400ms), warning(이탈)=낮은 이중 경고(≤500ms). 생성 건수·비용을 완료 보고에 포함.
- [ ] **Step 2: 위원장 청취 게이트** — 후보 파일 경로 목록과 함께 보고, 실기기 청취 선정 대기. **선정 전 교체 커밋 금지**(스펙 §8 원자 교체). 선정 후 후속 태스크(별도): 파일 배치, `BeaconTonePlayer` 파일 재생 전환(오디오 세션·`isSuppressed`·`isSilenced` 계약 유지), 웹 `useBeaconSound` 파일 재생 전환, `beacon-tones-drift.test.ts`를 파일 해시 대조로 대체.

### Task 11: 통합 검증·문서

- [ ] **Step 1: 실호출 게이트** — dev 서버에서 `curl "localhost:3000/api/route/walk?origin=37.5384,127.1420&dest=37.5301,127.1237&includeGeometry=1"` → `steps[].pathCoords` 존재·`buildGuideRoute` 통과(이음매 ≤5m)를 스크립트로 단언. 미지정 요청 응답이 종전과 동일 키 집합인지 대조(byte-호환).
- [ ] **Step 2: 전체 게이트** — `npm run test:run` · `npm run lint` · `npm run build` · `swift test` · iOS 빌드 전부 green.
- [ ] **Step 3: a11y-auditor 서브에이전트 점검** — 시트·패널 diff 대상(헌장 기준: 과잉 ARIA 제거 포함).
- [ ] **Step 4: 문서** — `PROGRESS.md`(구현·검증 로그), `docs/BACKLOG.md` E4 상태 갱신(잔여: 사운드 선정·차량 실측·실보행 판정), CLAUDE.md 항구 규칙 추가는 실보행 통과 후로 미룸.
- [ ] **Step 5: Commit + push** — 리뷰 게이트 통과 후 자동(gildongmu 관례). 실기기 배포 `ios/deploy-device.sh`(기기 연결 시).
- [ ] **Step 6: 실측·실보행(위원장)** — 차량 이동 실측(이탈 억제·속도 가드)과 실보행 완주는 위원장 일정에 맞춰 별도 세션. 상수 튜닝·전체 잔여 병기 판정은 그 결과로.
