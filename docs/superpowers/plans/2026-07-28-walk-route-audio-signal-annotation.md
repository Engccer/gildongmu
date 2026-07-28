# 도보 경로 브리핑 음향신호기 주석 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tmap 도보 브리핑의 횡단보도 단계 중 음향신호기 seed 40m 내 단계에만 ", 음향신호기 있음"을 문장 끝에 흡수해, 웹·iOS·CLI/MCP·채팅 전 소비자가 클라이언트 변경 없이 자동 적용받게 한다.

**Architecture:** provider(`tmap-pedestrian.ts`)는 순수 Tmap 정규화를 유지하되 단계 좌표를 내부 전달용으로 보존하고, 신설 서비스 `src/lib/walk-route.ts`가 주석 후 좌표를 제거해 API 응답 스키마를 불변으로 유지한다. 라우트·채팅은 provider 직접 호출을 서비스 호출로 전환한다. 정본 spec: `docs/superpowers/specs/2026-07-28-walk-route-audio-signal-annotation-design.md`.

**Tech Stack:** TypeScript(Next.js 16 서버 계층, React 비의존 `src/lib/`), Vitest(node env), 음향신호기 seed `src/lib/data/audio-signals.json`(OA-15543).

## Global Constraints

- 매칭 규칙(spec 확정): `description.includes("횡단보도")` **AND** 단계 좌표 반경 **40m** 내 seed 존재. 둘 다 충족 시에만 주석.
- 표기: `` `${description}, 음향신호기 있음` `` — 쉼표 구분(가운뎃점 금지, 헌장 §4). positive-only(무주석=침묵, "없음" 표기 금지).
- API 응답 스키마 불변: 서비스가 반환 전 모든 step에서 `coord` 제거. `/api/route/walk`·채팅 도구 data에 `coord`가 새어 나가면 결함.
- `src/lib/`는 React/Next 비의존 유지(dodo 이식성). seed import는 `audio-signals.ts` provider에만(서비스·다른 파일에서 seed 직접 import 금지).
- 주석 리터럴·반경은 `walk-route.ts`의 상수(i18n 키 불필요 — 도보 경로 V1 ko 전용).
- 커밋은 pathspec만(`git add <의도 파일>` → `git commit -- <경로들>`), `git add -A` 금지. 커밋 이메일 engccer@gmail.com, 메시지 한국어.
- 주석·문서 한국어, 변수/함수명 영어. em dash 금지.

---

### Task 1: provider 단계 좌표 보존 + `hasAudioSignalNear` 경량 조회

**Files:**
- Modify: `src/lib/types.ts:268-282` (WalkRouteStep에 `coord?` 추가)
- Modify: `src/lib/providers/tmap-pedestrian.ts:99-110` (normalize에서 좌표 보존)
- Modify: `src/lib/providers/audio-signals.ts` (`hasAudioSignalNear` 추가, bbox 판정 헬퍼 추출)
- Test: `src/lib/__tests__/tmap-pedestrian.test.ts` (기존 — coord 기대값 보강)
- Test: `src/lib/providers/__tests__/audio-signals.test.ts` (기존 파일 있으면 추가, 없으면 생성)

**Interfaces:**
- Produces: `WalkRouteStep.coord?: Coord` (내부 전달용), `hasAudioSignalNear(lat: number, lng: number, radiusMeters: number): boolean` (서울 bbox 밖은 false)
- 기존 `findAudioSignalsNear`·`normalizeTmapWalkRoute` 시그니처 불변.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/__tests__/tmap-pedestrian.test.ts`에 추가(기존 fixture 스타일을 따라, describe 안에):

```ts
it("Point 단계의 좌표를 coord로 보존한다(내부 전달용)", () => {
  // 기존 정상 fixture를 재사용해 steps[i].coord가 {lat, lng}로 채워지는지 확인.
  // Tmap geometry.coordinates는 [lng, lat] 순서 — 반전 확인이 이 테스트의 핵심.
  const result = normalizeTmapWalkRoute(validFixture); // 기존 테스트의 정상 fixture 변수명 사용
  const first = result.steps[0];
  expect(first.coord).toBeDefined();
  expect(first.coord!.lat).toBeCloseTo(validFixture.features.filter(isPointWithDescription)[0].geometry.coordinates[1], 6);
  expect(first.coord!.lng).toBeCloseTo(validFixture.features.filter(isPointWithDescription)[0].geometry.coordinates[0], 6);
});
```

(기존 테스트 파일의 fixture 변수명·헬퍼에 맞춰 조정하되, "coordinates [lng,lat] → coord {lat,lng} 반전"과 "description 있는 Point만 step" 검증 의도는 유지.)

`src/lib/providers/__tests__/audio-signals.test.ts`에 추가:

```ts
import { describe, expect, it } from "vitest";
import { hasAudioSignalNear } from "../audio-signals";
import seed from "../../data/audio-signals.json";

const signals = (seed as { signals: [number, number][] }).signals;

describe("hasAudioSignalNear", () => {
  it("seed 지점 자체는 true(반경 40m)", () => {
    const [lat, lng] = signals[0];
    expect(hasAudioSignalNear(lat, lng, 40)).toBe(true);
  });

  it("서울 안이지만 신호기 원거리(한강 중앙, 최근접 143m 실측)는 false", () => {
    // 2026-07-28 seed 기준 실측: 37.5300,126.9950 최근접 143m. seed 연1회 갱신 시 재확인.
    expect(hasAudioSignalNear(37.53, 126.995, 40)).toBe(false);
  });

  it("서울 bbox 밖(부산)은 false", () => {
    expect(hasAudioSignalNear(35.1796, 129.0756, 40)).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `npx vitest run src/lib/__tests__/tmap-pedestrian.test.ts src/lib/providers/__tests__/audio-signals.test.ts`
Expected: FAIL — `hasAudioSignalNear` export 없음, `coord` undefined.

- [ ] **Step 3: 최소 구현**

`src/lib/types.ts` — `WalkRouteStep` 확장(주석 포함):

```ts
export interface WalkRouteStep {
  description: string;
  distanceMeters?: number;
  /**
   * 안내 지점 좌표(내부 전달용). provider가 채우고 walk-route 서비스가
   * 음향신호기 주석 판정에 쓴 뒤 **응답 전 제거**한다 — API 응답에 노출 금지.
   */
  coord?: Coord;
}
```

(`Coord`는 types.ts에 이미 존재 — import 불필요, 선언 순서만 확인.)

`src/lib/providers/tmap-pedestrian.ts` — normalize의 step 수집부 교체:

```ts
  const steps: WalkRouteStep[] = [];
  for (const point of points) {
    const description = point.properties.description;
    if (!description) continue;
    const [lng, lat] = point.geometry.coordinates;
    // 좌표가 깨진 Point는 주석 판정만 포기하고 안내문은 살린다(coord 생략).
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      steps.push({ description, coord: { lat, lng } });
    } else {
      steps.push({ description });
    }
  }
```

`src/lib/providers/audio-signals.ts` — bbox 판정 추출 + 경량 조회 추가:

```ts
function inSeoulBbox(lat: number, lng: number): boolean {
  return (
    lat >= SEOUL_BBOX.latMin && lat <= SEOUL_BBOX.latMax &&
    lng >= SEOUL_BBOX.lngMin && lng <= SEOUL_BBOX.lngMax
  );
}

/**
 * 반경 내 음향신호기 존재 여부(경량, 도보 경로 주석용). 서울 bbox 밖은 false —
 * 소비자(walk-route)가 positive-only 표기라 "미제공"과 "없음" 구분이 필요 없다
 * (findAudioSignalsNear의 null/unsupported 구분과 다른 계약임을 주석으로 명시).
 * 성능: 도(°) 박스 프리필터로 haversine 호출을 근접 후보로 줄인다(seed 16,822 × step 수십).
 */
export function hasAudioSignalNear(lat: number, lng: number, radiusMeters: number): boolean {
  if (!inSeoulBbox(lat, lng)) return false;
  const latDelta = radiusMeters / 111_320;
  const lngDelta = radiusMeters / (111_320 * Math.cos((lat * Math.PI) / 180));
  return SEED.signals.some(
    ([slat, slng]) =>
      Math.abs(slat - lat) <= latDelta &&
      Math.abs(slng - lng) <= lngDelta &&
      haversineMeters(lat, lng, slat, slng) <= radiusMeters,
  );
}
```

기존 `findAudioSignalsNear`의 bbox 인라인 조건을 `inSeoulBbox` 호출로 교체(동작 불변 리팩터).

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/__tests__/tmap-pedestrian.test.ts src/lib/providers/__tests__/audio-signals.test.ts`
Expected: PASS (기존 케이스 포함 전부).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/types.ts src/lib/providers/tmap-pedestrian.ts src/lib/providers/audio-signals.ts src/lib/__tests__/tmap-pedestrian.test.ts src/lib/providers/__tests__/audio-signals.test.ts
git commit -m "feat(walk): 도보 단계 좌표 보존 + 음향신호기 경량 근접 조회" -- src/lib/types.ts src/lib/providers/tmap-pedestrian.ts src/lib/providers/audio-signals.ts src/lib/__tests__/tmap-pedestrian.test.ts src/lib/providers/__tests__/audio-signals.test.ts
```

---

### Task 2: `walk-route.ts` 서비스 신설(주석 + coord 제거)

**Files:**
- Create: `src/lib/walk-route.ts`
- Test: `src/lib/__tests__/walk-route.test.ts` (생성)

**Interfaces:**
- Consumes: Task 1의 `hasAudioSignalNear(lat, lng, radiusMeters)`, `WalkRouteStep.coord?`, 기존 `getWalkRouteBriefing({origin, dest})`.
- Produces: `annotateAudioSignals(briefing: WalkRouteBriefing): WalkRouteBriefing` (순수 함수, export — 테스트용), `getWalkRoute(params: { origin: Coord; dest: Coord }): Promise<WalkRouteBriefing | null>` — Task 3의 라우트·채팅이 이것만 호출.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/__tests__/walk-route.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { annotateAudioSignals } from "../walk-route";
import seed from "../data/audio-signals.json";
import type { WalkRouteBriefing } from "../types";

const signals = (seed as { signals: [number, number][] }).signals;
const [sigLat, sigLng] = signals[0];
// 서울 안·신호기 원거리 점(2026-07-28 seed 실측 최근접 143m — seed 갱신 시 재확인)
const FAR = { lat: 37.53, lng: 126.995 };

function briefing(steps: WalkRouteBriefing["steps"]): WalkRouteBriefing {
  return { distanceMeters: 800, durationSeconds: 700, steps };
}

describe("annotateAudioSignals", () => {
  it("횡단보도 단계 + 40m 내 seed → 문장 끝 쉼표 주석", () => {
    const out = annotateAudioSignals(
      briefing([{ description: "우측 횡단보도 후 11m 이동", coord: { lat: sigLat, lng: sigLng } }]),
    );
    expect(out.steps[0].description).toBe("우측 횡단보도 후 11m 이동, 음향신호기 있음");
  });

  it("횡단보도 단계지만 40m 밖 → 무주석(positive-only)", () => {
    const out = annotateAudioSignals(
      briefing([{ description: "횡단보도 후 20m 이동", coord: FAR }]),
    );
    expect(out.steps[0].description).toBe("횡단보도 후 20m 이동");
  });

  it("비횡단보도 단계는 seed 인접이어도 무주석(실측 오탐 클래스)", () => {
    const out = annotateAudioSignals(
      briefing([{ description: "직진 후 양재대로를 따라 2m 이동", coord: { lat: sigLat, lng: sigLng } }]),
    );
    expect(out.steps[0].description).toBe("직진 후 양재대로를 따라 2m 이동");
  });

  it("coord 없는 단계는 무주석", () => {
    const out = annotateAudioSignals(briefing([{ description: "횡단보도 후 이동" }]));
    expect(out.steps[0].description).toBe("횡단보도 후 이동");
  });

  it("모든 단계에서 coord를 제거한다(주석 여부 무관 — API 응답 노출 금지)", () => {
    const out = annotateAudioSignals(
      briefing([
        { description: "횡단보도 후 이동", coord: { lat: sigLat, lng: sigLng } },
        { description: "직진", coord: FAR },
      ]),
    );
    for (const s of out.steps) expect("coord" in s).toBe(false);
  });

  it("총 거리·시간은 그대로 통과한다", () => {
    const out = annotateAudioSignals(briefing([{ description: "직진" }]));
    expect(out.distanceMeters).toBe(800);
    expect(out.durationSeconds).toBe(700);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `npx vitest run src/lib/__tests__/walk-route.test.ts`
Expected: FAIL — `../walk-route` 모듈 없음.

- [ ] **Step 3: 최소 구현**

`src/lib/walk-route.ts`:

```ts
import { getWalkRouteBriefing } from "./providers/tmap-pedestrian";
import { hasAudioSignalNear } from "./providers/audio-signals";
import type { Coord, WalkRouteBriefing } from "./types";

/**
 * 도보 경로 서비스 진입점(라우트·채팅 공용 — provider 직접 호출 금지, walk-infra.ts 동형).
 *
 * Tmap 브리핑의 횡단보도 단계에 음향신호기 주석을 붙인다. 매칭 규칙(spec
 * 2026-07-28 실측 확정): description "횡단보도" 포함 AND 단계 좌표 40m 내
 * seed 존재 — 실측 분포가 4~15m(신호기 있는 횡단보도) vs 127m+(무관 단계)로
 * 완전 분리라 두 게이트 결합이 오탐·미탐을 모두 차단한다. positive-only:
 * 미등록 신호기를 반증할 수 없으므로 "없음"은 표기하지 않는다(침묵).
 * 주석 후 모든 단계에서 coord를 제거해 API 응답 스키마를 기존과 동일하게 유지한다.
 */

const ANNOTATION = "음향신호기 있음"; // 도보 경로는 V1 ko 전용 — i18n 키 불필요
const MATCH_RADIUS_METERS = 40;

export function annotateAudioSignals(briefing: WalkRouteBriefing): WalkRouteBriefing {
  const steps = briefing.steps.map((step) => {
    const { coord, ...rest } = step;
    if (
      coord &&
      rest.description.includes("횡단보도") &&
      hasAudioSignalNear(coord.lat, coord.lng, MATCH_RADIUS_METERS)
    ) {
      return { ...rest, description: `${rest.description}, ${ANNOTATION}` };
    }
    return rest;
  });
  return { ...briefing, steps };
}

/** 도보 경로 조회(주석 포함). 경로 없으면 null(provider graceful 계약 그대로). */
export async function getWalkRoute(params: {
  origin: Coord;
  dest: Coord;
}): Promise<WalkRouteBriefing | null> {
  const briefing = await getWalkRouteBriefing(params);
  return briefing ? annotateAudioSignals(briefing) : null;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/__tests__/walk-route.test.ts`
Expected: PASS 6건.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/walk-route.ts src/lib/__tests__/walk-route.test.ts
git commit -m "feat(walk): walk-route 서비스 신설 — 횡단보도 단계 음향신호기 주석(positive-only)" -- src/lib/walk-route.ts src/lib/__tests__/walk-route.test.ts
```

---

### Task 3: 라우트·채팅 배선 전환 + 전체 게이트

**Files:**
- Modify: `src/app/api/route/walk/route.ts:6,45` (import·호출 교체)
- Modify: `src/lib/chat/router.ts:24` 및 `get_walk_route` case의 호출부 (import·호출 교체)
- Test: 기존 `src/app/api/route/walk/__tests__/route.test.ts`, `src/lib/chat/__tests__/router.test.ts` (무회귀 확인 — 두 테스트의 provider mock은 서비스가 내부에서 같은 provider를 부르므로 그대로 유효, coord 없는 mock step은 주석 no-op)

**Interfaces:**
- Consumes: Task 2의 `getWalkRoute({origin, dest})`.
- Produces: 없음(말단 배선).

- [ ] **Step 1: 배선 교체**

`src/app/api/route/walk/route.ts`:

```ts
// 교체 전: import { getWalkRouteBriefing } from "@/lib/providers/tmap-pedestrian";
import { getWalkRoute } from "@/lib/walk-route";
// ...
    const result = await getWalkRoute(parsed.data);
```

`src/lib/chat/router.ts`:

```ts
// 교체 전: import { getWalkRouteBriefing } from "@/lib/providers/tmap-pedestrian";
import { getWalkRoute } from "@/lib/walk-route";
```

`get_walk_route` case 안의 `getWalkRouteBriefing(` 호출을 `getWalkRoute(`로 교체(인자 불변). 파일 전체에서 `getWalkRouteBriefing` 잔존 참조 0 확인: `grep -rn "getWalkRouteBriefing" src --include="*.ts" --include="*.tsx"` 결과가 provider 정의부·provider 테스트·walk-route.ts만 남아야 한다.

- [ ] **Step 2: 전체 테스트·린트·빌드**

Run: `npm run test:run && npm run lint && npm run build`
Expected: 전부 PASS(기존 route.test·router.test 무회귀 포함).

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/route/walk/route.ts src/lib/chat/router.ts
git commit -m "feat(walk): 라우트·채팅 도보 경로를 walk-route 서비스 경유로 전환" -- src/app/api/route/walk/route.ts src/lib/chat/router.ts
```

---

### Task 4: 문서 갱신 + push + 실호출 머지 게이트

**Files:**
- Modify: `CLAUDE.md` (통합 카탈로그 "도보 경로" 행에 주석 계약 한 줄)
- Modify: `PROGRESS.md` (운영 표 또는 해당 항목에 완료 기록)

- [ ] **Step 1: CLAUDE.md 도보 경로 행 보강**

"도보 경로" 행의 함정·정본 셀에 추가(기존 문장 유지, 끝에 이어붙임):

```
**횡단보도 단계 음향신호기 주석**: 라우트·채팅은 `getWalkRoute`(`src/lib/walk-route.ts`)만 호출(provider 직접 금지) — description "횡단보도" 포함+단계 좌표 40m 내 OA-15543 seed 존재 시에만 문장 끝 ", 음향신호기 있음" 흡수(positive-only, 서울 밖 무주석). coord는 응답 전 제거(스키마 불변 — 웹·iOS·CLI 클라 변경 0)
```

- [ ] **Step 2: PROGRESS.md 기록**

보행 인프라 관련 항목 인근에 한 단락 추가(실호출 게이트 결과는 Step 5 후 기입).

- [ ] **Step 3: 문서 커밋 + push**

```bash
git add CLAUDE.md PROGRESS.md
git commit -m "docs: 도보 브리핑 음향신호기 주석 계약 기록" -- CLAUDE.md PROGRESS.md
git push origin main
```

(push가 Vercel 자동 배포 트리거.)

- [ ] **Step 4: 배포 완료 대기**

Vercel 배포 완료 확인(`vercel ls` 또는 2~3분 대기 후 실호출).

- [ ] **Step 5: 실호출 머지 게이트(spec §테스트 3)**

```bash
curl -s "https://gildongmu.dodoplanet.space/api/route/walk?origin=37.5385,127.1368&dest=37.5354,127.1428"
```

판정(2026-07-28 실측 기준):
- "우마주 길동점…횡단보도…" 단계와 "LG유플러스 길동 길동역점…횡단보도…" 단계에 ", 음향신호기 있음" 존재
- "고향국시 길동점…횡단보도…" 단계는 무주석(최근접 193m)
- 응답 JSON에 `coord` 키 부재
- ⚠ revalidate 3600 캐시로 구버전 응답이 올 수 있음 — 그 경우 좌표를 소수 5자리로 미세 변경(4자리 반올림 경계 유지 주의)해 캐시 미스 유도, 또는 다른 인접 구간으로 검증.

게이트 결과(주석 붙은 단계 수·문구)를 PROGRESS.md 해당 단락에 추기하고 pathspec 커밋·push.
