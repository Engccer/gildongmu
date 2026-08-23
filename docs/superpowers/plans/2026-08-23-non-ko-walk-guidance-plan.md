# 비-ko 도보 상세 안내 (E16 축 3) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 비-ko 로케일에서도 도보 **상세** 안내(실시간 길 안내 포함)를 받게 한다 — Tmap 보행자 `turnType` 구조화 축과 juso 로마자 도로명으로 provider 계약을 언어에서 푼다.

**Architecture:** 서버가 en 문장을 만든다(소비자 무변경). `turnType → {action, phrase}` **표 하나**가 임박 큐 행동과 영어 문구를 함께 낸다. 응답에 여전히 실려 오는 **한국어 원문을 대조 가드**로 써서(표지·거리) 귀속 가정과 미관측 코드가 조용히 틀리는 대신 즉시 실패하게 한다. 도보 스텝의 `action`은 이제 **서버가 전량 투영**하고 리듀서는 `actionSource: step`만 본다(클라이언트 문자열 폴백 제거).

**Tech Stack:** TypeScript · Next.js 16 App Router · Vitest · Swift(GildongmuKit / iOS 앱) · next-intl

**Spec:** `docs/superpowers/specs/2026-08-23-non-ko-walk-guidance-design.md`

## Global Constraints

- 판정 근거(코퍼스): **30경로 435스텝** — 표지 오탐 0 · 거리 오탐 0 · 도로명 등가 불일치 0(212스텝) · juso 로마자 39/40.
- **귀속은 첫 LineString**이다: 문장의 거리·도로명은 Point 뒤 **첫** LineString의 `distance`·`name`. `pathCoords`는 종전대로 **전부** 귀속.
- 거리 표기는 `formatDistance` 하나만 지난다(웹 ↔ Kit ↔ CLI 3벌 미러 규칙). 문장에서 직접 조립 금지.
- `action`은 **`includeGeometry` 응답에만** 싣는다 — 비기하 브리핑 응답은 byte-identical 유지.
- `lang`은 `getWalkRoute`·`walkRouteUrl` 둘 다 **기본값 없는 필수 인자**.
- 비-ko에 **계단 회피 컨트롤을 노출하지 않는다**(Tmap에 검증된 축이 없다).
- 커밋은 pathspec(`git commit -- <경로>`), `git add -A` 금지. 커밋 메시지 한국어.
- ⚠ **파일을 새로 만들기 전에 `git cat-file -e main:<path>`로 부재를 확인한다.** 기존 테스트 파일을
  새 파일이라 믿고 덮어쓰면 단언이 사라지고 **전체 스위트 green이 그것을 가린다**(e19 실사고 2026-08-23).
  Task 1~6·8·10의 신규 파일은 착수 시점에 전부 부재를 확인했다. `src/lib/__tests__/route-guide.test.ts`
  (Task 7)와 `RouteGuideTests.swift`·`RouteServiceTests.swift`(Task 7·9)는 **기존 파일이라 Edit로 케이스만 더한다**.
- 소유권 밖 파일(`src/lib/route-guide.ts`, Kit `RouteGuide.swift`, `src/lib/chat/router.ts`, `src/lib/env.ts`, `src/app/api/route/walk/route.ts`, `src/app/[locale]/page.tsx`, `src/lib/types.ts`)을 만지면 **통합 보고에 자진 신고**한다.

---

### Task 1: `turnType` 단일 분류표

**Files:**
- Create: `src/lib/pedestrian-action.ts`
- Create: `src/lib/__tests__/pedestrian-action.test.ts`

**Interfaces:**
- Consumes: `GuideAction` (`src/lib/walk-action.ts`, 기존)
- Produces:
  ```ts
  export interface PedestrianStep { action: GuideAction | null; phrase: string | null; }
  export function pedestrianStepFor(turnType: number): PedestrianStep | null;
  export const PEDESTRIAN_TURN_TYPES: readonly number[];   // 표에 있는 전 코드(가드 테스트용)
  ```
  `null` 반환 = **미지 코드**(호출부가 throw). `phrase: null` = 행동절 없는 스텝(직진·출발·경유지).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// src/lib/__tests__/pedestrian-action.test.ts
import { describe, expect, it } from "vitest";
import { pedestrianStepFor, PEDESTRIAN_TURN_TYPES } from "../pedestrian-action";

describe("pedestrianStepFor", () => {
  it("관측 코드의 행동과 문구를 함께 낸다", () => {
    expect(pedestrianStepFor(12)).toEqual({ action: "left", phrase: "Turn left" });
    expect(pedestrianStepFor(13)).toEqual({ action: "right", phrase: "Turn right" });
    expect(pedestrianStepFor(211)).toEqual({ action: "crosswalk", phrase: "Cross the crosswalk" });
    expect(pedestrianStepFor(212)).toEqual({
      action: "crosswalk", phrase: "Cross the crosswalk on your left",
    });
    expect(pedestrianStepFor(126)).toEqual({ action: "underpass", phrase: "Take the underpass" });
    expect(pedestrianStepFor(201)).toEqual({ action: null, phrase: "Arrive at your destination" });
  });

  it("시계 방위를 좌우로 접지 않는다(갈림길 가지 지목 정보)", () => {
    expect(pedestrianStepFor(17)).toEqual({ action: "left", phrase: "Turn to your 10 o'clock" });
    expect(pedestrianStepFor(18)).toEqual({ action: "right", phrase: "Turn to your 2 o'clock" });
    expect(pedestrianStepFor(216)).toEqual({
      action: "crosswalk", phrase: "Cross the crosswalk at 2 o'clock",
    });
  });

  it("행동절 없는 코드는 phrase가 null이고 행동도 없다", () => {
    for (const tt of [0, 1, 7, 11, 184, 189, 200, 233]) {
      expect(pedestrianStepFor(tt)).toEqual({ action: null, phrase: null });
    }
  });

  it("육교·계단·경사로·엘리베이터는 문구만 있고 행동은 null이다", () => {
    // 육교를 underpass로 접으면 "지하보도로 건너세요"가 나가 거짓이고,
    // 계단·엘리베이터에 crosswalk 톤을 붙이면 음향신호기 비프의 거짓 인용이 된다.
    for (const tt of [125, 127, 128, 129, 218]) {
      const s = pedestrianStepFor(tt);
      expect(s?.action).toBeNull();
      expect(s?.phrase).toBeTruthy();
    }
  });

  it("미지 코드는 null(호출부가 throw)", () => {
    expect(pedestrianStepFor(9999)).toBeNull();
    expect(pedestrianStepFor(-1)).toBeNull();
  });

  it("좌우 문구와 행동이 어긋나지 않는다(표 오타 가드)", () => {
    for (const tt of PEDESTRIAN_TURN_TYPES) {
      const s = pedestrianStepFor(tt);
      if (!s?.phrase) continue;
      const p = s.phrase.toLowerCase();
      if (s.action === "left") expect(p).toMatch(/left|8 o'clock|10 o'clock/);
      if (s.action === "right") expect(p).toMatch(/right|2 o'clock|4 o'clock/);
    }
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/lib/__tests__/pedestrian-action.test.ts`
Expected: FAIL — `Failed to resolve import "../pedestrian-action"`

- [ ] **Step 3: 최소 구현**

```ts
// src/lib/pedestrian-action.ts
import type { GuideAction } from "./walk-action";

/**
 * Tmap **보행자** `turnType` → 결정 지점 행동 + 영어 안내 문구(순수, ko 무관).
 * 자동차판은 `car-action.ts` — 그쪽은 행동만 내지만 이쪽은 **문구까지 같은 항목에서** 낸다.
 *
 * ⚠ **표를 둘로 나누지 않는 것이 이 모듈의 존재 이유다**(설계 리뷰 #2). 행동표와 문장표를
 * 따로 두면 같은 코드가 두 번 분류되어 "문장은 좌회전인데 임박 톤은 우회전"이 가능해지고,
 * 각 표의 코드 커버리지 테스트를 둘 다 통과해도 그 불일치는 잡히지 않는다.
 *
 * ⚠ **시계 방위를 좌우로 접지 않는다**(설계 리뷰 #8). 8·10·2·4시는 갈림길에서 어느 가지인지
 * 지목하는 정보라 `Bear left`로 옮기면 다른 길로 진입시킬 수 있다.
 *
 * ⚠ **공식 표는 관측으로 반증됐다**: 경유지를 184~189로 적었지만 실호출 PP1 지점은 `turnType 0`이다.
 * 그래서 이 표는 공식 표(readme.io "경로안내 샘플예제", 2026-08-23)와 30경로 435스텝 코퍼스의
 * **합집합**이다. 표에 없는 코드는 `null`이고 호출부가 throw한다 — 낭독 채널에서 행동절을
 * 빠뜨린 문장은 *회전을 말하지 않은 직진 지시*가 되어 조용히 틀린다.
 */
export interface PedestrianStep {
  /** 임박 큐 행동. `null`은 판정 결과(행동 없음)이지 미분류가 아니다. */
  action: GuideAction | null;
  /** 영어 행동절. `null`이면 문장에 행동절이 없다(직진·출발·경유지). */
  phrase: string | null;
}

const NO_ACTION: PedestrianStep = { action: null, phrase: null };

const TABLE: Readonly<Record<number, PedestrianStep>> = {
  // 안내 없음(1~7)·직진(11)·출발(200)·직진 임시(233)·경유지(0, 184~189).
  // ⚠ 0은 공식 표에 없지만 PP1 실관측이다. 경유지 구획 문장은 서버가 만들지 않는다(N4 계약)
  // — 그래서 경유지도 "행동절 없음"이다.
  0: NO_ACTION, 1: NO_ACTION, 2: NO_ACTION, 3: NO_ACTION, 4: NO_ACTION,
  5: NO_ACTION, 6: NO_ACTION, 7: NO_ACTION, 11: NO_ACTION, 200: NO_ACTION, 233: NO_ACTION,
  184: NO_ACTION, 185: NO_ACTION, 186: NO_ACTION, 187: NO_ACTION, 188: NO_ACTION, 189: NO_ACTION,

  12: { action: "left", phrase: "Turn left" },
  13: { action: "right", phrase: "Turn right" },
  14: { action: "back", phrase: "Make a U-turn" },
  16: { action: "left", phrase: "Turn to your 8 o'clock" },
  17: { action: "left", phrase: "Turn to your 10 o'clock" },
  18: { action: "right", phrase: "Turn to your 2 o'clock" },
  19: { action: "right", phrase: "Turn to your 4 o'clock" },

  // 시설: 문구는 있고 행동(톤)은 없다 — 위 주석 참조.
  125: { action: null, phrase: "Take the pedestrian overpass" },
  126: { action: "underpass", phrase: "Take the underpass" },
  127: { action: null, phrase: "Take the stairs" },
  128: { action: null, phrase: "Take the ramp" },
  129: { action: null, phrase: "Take the stairs or the ramp" },
  218: { action: null, phrase: "Take the elevator" },

  211: { action: "crosswalk", phrase: "Cross the crosswalk" },
  212: { action: "crosswalk", phrase: "Cross the crosswalk on your left" },
  213: { action: "crosswalk", phrase: "Cross the crosswalk on your right" },
  214: { action: "crosswalk", phrase: "Cross the crosswalk at 8 o'clock" },
  215: { action: "crosswalk", phrase: "Cross the crosswalk at 10 o'clock" },
  216: { action: "crosswalk", phrase: "Cross the crosswalk at 2 o'clock" },
  217: { action: "crosswalk", phrase: "Cross the crosswalk at 4 o'clock" },

  201: { action: null, phrase: "Arrive at your destination" },
};

export const PEDESTRIAN_TURN_TYPES: readonly number[] = Object.keys(TABLE).map(Number);

/** 표에 없으면 `null` — 호출부가 throw한다(추측 금지). */
export function pedestrianStepFor(turnType: number): PedestrianStep | null {
  return TABLE[turnType] ?? null;
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run src/lib/__tests__/pedestrian-action.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git commit -m "feat(walk): Tmap 보행자 turnType 단일 분류표 (E16 축3)" -- src/lib/pedestrian-action.ts src/lib/__tests__/pedestrian-action.test.ts
```

---

### Task 2: 한국어 원문 대조 가드

**Files:**
- Create: `src/lib/pedestrian-guard.ts`
- Create: `src/lib/__tests__/pedestrian-guard.test.ts`

**Interfaces:**
- Consumes: (없음 — 순수 함수)
- Produces:
  ```ts
  export function assertTurnTypeMatchesKorean(turnType: number, description: string): void; // 모순이면 throw
  export function assertDistanceMatchesKorean(description: string, segmentMeters: number | undefined): void; // 모순이면 throw
  ```

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// src/lib/__tests__/pedestrian-guard.test.ts
import { describe, expect, it } from "vitest";
import { assertDistanceMatchesKorean, assertTurnTypeMatchesKorean } from "../pedestrian-guard";

describe("assertTurnTypeMatchesKorean", () => {
  it("일치하면 통과", () => {
    expect(() => assertTurnTypeMatchesKorean(12, "좌회전 후 천호대로를 따라 1m 이동")).not.toThrow();
    expect(() => assertTurnTypeMatchesKorean(213, "우측 횡단보도 후 44m 이동")).not.toThrow();
    expect(() => assertTurnTypeMatchesKorean(126, "지하보도 진입 후 72m 이동")).not.toThrow();
    expect(() => assertTurnTypeMatchesKorean(201, "도착")).not.toThrow();
  });

  it("표지 우선순위: 회전이 건널목보다 먼저다", () => {
    // "횡단보도"는 지명의 일부로 등장한다 — 건널목을 먼저 보면 좌회전 스텝이 모순으로 잡힌다.
    expect(() =>
      assertTurnTypeMatchesKorean(12, "천호역 횡단보도에서 좌회전 후 40m 이동"),
    ).not.toThrow();
  });

  it("모순이면 throw", () => {
    expect(() => assertTurnTypeMatchesKorean(13, "좌회전 후 30m 이동")).toThrow(/표지/);
    expect(() => assertTurnTypeMatchesKorean(12, "횡단보도 후 30m 이동")).toThrow(/표지/);
  });

  it("표지가 없으면 판정하지 않는다", () => {
    expect(() => assertTurnTypeMatchesKorean(11, "보행자도로를 따라 30m 이동")).not.toThrow();
  });
});

describe("assertDistanceMatchesKorean", () => {
  it("일치하면 통과(±1m)", () => {
    expect(() => assertDistanceMatchesKorean("좌회전 후 286m 이동", 286)).not.toThrow();
    expect(() => assertDistanceMatchesKorean("좌회전 후 286m 이동", 287)).not.toThrow();
    expect(() => assertDistanceMatchesKorean("1.2km 이동", 1200)).not.toThrow();
  });

  it("어긋나면 throw — 귀속 가정이 깨진 것이다", () => {
    expect(() => assertDistanceMatchesKorean("좌회전 후 306m 이동", 314)).toThrow(/거리/);
  });

  it("원문에 거리가 없거나 구간이 없으면 판정하지 않는다", () => {
    expect(() => assertDistanceMatchesKorean("도착", 0)).not.toThrow();
    expect(() => assertDistanceMatchesKorean("좌회전 후 286m 이동", undefined)).not.toThrow();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/lib/__tests__/pedestrian-guard.test.ts`
Expected: FAIL — `Failed to resolve import "../pedestrian-guard"`

- [ ] **Step 3: 최소 구현**

```ts
// src/lib/pedestrian-guard.ts
/**
 * en 문장의 출처는 구조화 필드지만, Tmap 응답에는 **한국어 원문이 여전히 실려 온다**.
 * 그것을 대조 가드로 쓰면 미관측 코드(설계 리뷰 #4)와 Point→LineString 귀속 가정
 * (#5)이 조용히 틀리는 대신 즉시 실패한다. 비용 0 — 이미 받은 데이터다.
 *
 * ⚠ **원문은 출처가 아니라 증인이다.** 여기서 문장을 만들지 않는다.
 *
 * ⚠ 30경로 435스텝 코퍼스에서 **두 축 모두 오탐 0**(spec §2.4). 가드 자체가 새 실패
 * 모드이므로 그 수치가 이 파일을 켜는 조건이었고, 실호출 게이트가 회귀로 지킨다.
 */

/**
 * 표지 → 허용 turnType 집합. **순서가 곧 불변식이다**(회전 → 시설 → 건널목):
 * "횡단보도"는 지명의 일부로 등장하므로("천호역 횡단보도에서 좌회전 후 …") 건널목을
 * 먼저 보면 좌회전 스텝이 모순으로 잡혀 **정상 경로가 죽는다**. `walk-action.ts`의
 * MARKERS가 같은 이유로 같은 순서를 쓴다.
 */
const MARKERS: readonly (readonly [string, readonly number[]])[] = [
  ["유턴", [14]],
  ["좌회전", [12, 16, 17]],
  ["우회전", [13, 18, 19]],
  ["엘리베이터", [218]],
  ["육교", [125]],
  ["지하보도", [126]],
  ["계단", [127, 129]],
  ["경사로", [128, 129]],
  ["횡단보도", [211, 212, 213, 214, 215, 216, 217]],
  ["도착", [201]],
  ["직진", [0, 11, 200, 233]],
];

export function assertTurnTypeMatchesKorean(turnType: number, description: string): void {
  const hit = MARKERS.find(([marker]) => description.includes(marker));
  if (!hit) return; // 표지 없음 — 판정하지 않는다(침묵은 모순이 아니다)
  if (hit[1].includes(turnType)) return;
  throw new Error(
    `[pedestrian] turnType ${turnType}이 원문 표지 "${hit[0]}"와 모순: ${description}`,
  );
}

/** 원문 "NNNm 이동"·"N.Nkm 이동"에서 거리를 뽑는다. */
const DISTANCE = /(\d+(?:\.\d+)?)\s*(km|m)\s*이동/;

export function assertDistanceMatchesKorean(
  description: string,
  segmentMeters: number | undefined,
): void {
  if (segmentMeters === undefined) return;
  const m = DISTANCE.exec(description);
  if (!m) return;
  const spoken = m[2] === "km" ? Number(m[1]) * 1000 : Number(m[1]);
  if (Math.abs(spoken - segmentMeters) <= 1) return;
  throw new Error(
    `[pedestrian] 원문 거리 ${spoken}m와 구간 ${segmentMeters}m 불일치(귀속 가정 파손): ${description}`,
  );
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run src/lib/__tests__/pedestrian-guard.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: 커밋**

```bash
git commit -m "feat(walk): 한국어 원문 대조 가드(표지·거리) (E16 축3)" -- src/lib/pedestrian-guard.ts src/lib/__tests__/pedestrian-guard.test.ts
```

---

### Task 3: Tmap provider가 구조화 필드를 싣는다

**Files:**
- Modify: `src/lib/providers/tmap-pedestrian.ts` (`TmapPointFeature`·`normalizeTmapWalkRoute`)
- Modify: `src/lib/types.ts` (`WalkRouteStep`에 `action`·`roadNameKo`·`turnType` 추가)
- Test: `src/lib/providers/__tests__/tmap-pedestrian-structured.test.ts` (Create)

**Interfaces:**
- Consumes: `pedestrianStepFor` (Task 1), `assertTurnTypeMatchesKorean`·`assertDistanceMatchesKorean` (Task 2)
- Produces: `WalkRouteStep`에 다음 3필드(전부 옵셔널, Tmap 경로에서만 채워짐)
  ```ts
  action?: GuideAction;      // 임박 큐 행동(서버 투영). 기존 CarAction과 같은 필드명·같은 뜻.
  turnType?: number;         // en 문장 조립용 내부 전달(응답 전 제거)
  roadNameKo?: string;       // 첫 LineString name. en 로마자 조회 키(응답 전 제거)
  ```
  `normalizeTmapWalkRoute(data, opts)`의 `opts`에 `guard?: boolean` 추가(기본 false — ko 폴백 경로는 종전 동작 유지, en만 가드를 켠다).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// src/lib/providers/__tests__/tmap-pedestrian-structured.test.ts
import { describe, expect, it } from "vitest";
import { normalizeTmapWalkRoute } from "../tmap-pedestrian";

const point = (turnType: number, description: string, lng = 127.1, lat = 37.5) => ({
  type: "Feature" as const,
  geometry: { type: "Point" as const, coordinates: [lng, lat] as [number, number] },
  properties: { turnType, description, ...(turnType === 200 ? { totalDistance: 500, totalTime: 400 } : {}) },
});
const line = (distance: number, name: string, coords: [number, number][]) => ({
  type: "Feature" as const,
  geometry: { type: "LineString" as const, coordinates: coords },
  properties: { distance, name },
});

describe("normalizeTmapWalkRoute 구조화 투영", () => {
  it("turnType·첫 LineString의 도로명·거리를 스텝에 싣는다", () => {
    const b = normalizeTmapWalkRoute({
      type: "FeatureCollection",
      features: [
        point(200, "보행자도로를 따라 30m 이동"),
        line(30, "", [[127.1, 37.5], [127.101, 37.5]]),
        point(13, "우회전 후 진황도로를 따라 294m 이동"),
        line(294, "진황도로", [[127.101, 37.5], [127.104, 37.5]]),
        line(8, "논현로", [[127.104, 37.5], [127.105, 37.5]]),
      ],
    });
    expect(b.steps[0]).toMatchObject({ turnType: 200, distanceMeters: 30 });
    expect(b.steps[0].roadNameKo).toBeUndefined(); // 이름 빈 구간은 필드 부재
    expect(b.steps[1]).toMatchObject({
      turnType: 13, action: "right", roadNameKo: "진황도로", distanceMeters: 294,
    });
  });

  it("귀속은 합이 아니라 첫 구간이다", () => {
    // 306 + 8 = 314가 아니라 306. 합으로 읽으면 다중 구간 스텝이 전부 어긋난다.
    const b = normalizeTmapWalkRoute({
      type: "FeatureCollection",
      features: [
        point(200, "306m 이동"),
        line(306, "봉은사로", [[127.1, 37.5], [127.103, 37.5]]),
        line(8, "논현로", [[127.103, 37.5], [127.1031, 37.5]]),
      ],
    });
    expect(b.steps[0].distanceMeters).toBe(306);
    expect(b.steps[0].roadNameKo).toBe("봉은사로");
  });

  it("guard=true면 원문과 모순되는 turnType에 throw", () => {
    expect(() =>
      normalizeTmapWalkRoute(
        {
          type: "FeatureCollection",
          features: [point(200, "30m 이동"), line(30, "", [[127.1, 37.5], [127.101, 37.5]]),
                     point(13, "좌회전 후 30m 이동"), line(30, "", [[127.101, 37.5], [127.102, 37.5]])],
        },
        { guard: true },
      ),
    ).toThrow(/표지/);
  });

  it("guard=false(기본)면 종전대로 통과 — ko 폴백 동작 불변", () => {
    expect(() =>
      normalizeTmapWalkRoute({
        type: "FeatureCollection",
        features: [point(200, "30m 이동"), line(30, "", [[127.1, 37.5], [127.101, 37.5]]),
                   point(13, "좌회전 후 30m 이동"), line(30, "", [[127.101, 37.5], [127.102, 37.5]])],
      }),
    ).not.toThrow();
  });

  it("guard=true면 미지 turnType에 throw", () => {
    expect(() =>
      normalizeTmapWalkRoute(
        {
          type: "FeatureCollection",
          features: [point(200, "30m 이동"), line(30, "", [[127.1, 37.5], [127.101, 37.5]]),
                     point(9999, "무언가 30m 이동"), line(30, "", [[127.101, 37.5], [127.102, 37.5]])],
        },
        { guard: true },
      ),
    ).toThrow(/미지/);
  });

  it("pathCoords는 종전대로 전부 귀속한다(기하는 실경로를 따라야 한다)", () => {
    const b = normalizeTmapWalkRoute(
      {
        type: "FeatureCollection",
        features: [
          point(200, "306m 이동"),
          line(306, "봉은사로", [[127.1, 37.5], [127.103, 37.5]]),
          line(8, "논현로", [[127.103, 37.5], [127.1031, 37.5]]),
        ],
      },
      { includeLineGeometry: true },
    );
    expect(b.steps[0].pathCoords).toHaveLength(3);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/lib/providers/__tests__/tmap-pedestrian-structured.test.ts`
Expected: FAIL — `expected undefined to be 13` 류

- [ ] **Step 3: 구현**

`src/lib/types.ts`의 `WalkRouteStep`에 필드를 더한다(`live` 바로 앞):

```ts
  /**
   * 결정 지점 행동(서버 투영). 도보는 `attachStepActions`가 전량 채우고
   * (Tmap=turnType 표, 카카오=최종 문장 분류) **`includeGeometry` 응답에만** 실린다.
   * 리듀서는 이 필드만 본다(`actionSource: "step"`) — 클라이언트 문자열 폴백 없음.
   */
  action?: GuideAction;
  /** Tmap 회전 유형 코드. en 문장 조립용 내부 전달 — 응답 전 제거된다. */
  turnType?: number;
  /** 첫 LineString의 도로명(ko). en 로마자 조회 키 — 응답 전 제거된다. */
  roadNameKo?: string;
```

`src/lib/providers/tmap-pedestrian.ts`:

```ts
// 상단 import에 추가
import { pedestrianStepFor } from "../pedestrian-action";
import { assertDistanceMatchesKorean, assertTurnTypeMatchesKorean } from "../pedestrian-guard";
```

`TmapPointFeature.properties`에 `turnType?: number;`를 더하고,
`TmapLineStringFeature.properties`에 `distance?: number; name?: string;`를 더한다.

`normalizeTmapWalkRoute`의 시그니처에 `guard?: boolean`을 더하고, Point 처리부를 다음으로 바꾼다
(`step`을 만든 직후, `steps.push(step)` 앞):

```ts
      // 구조화 투영: 행동 코드는 여기서 한 번만 분류한다(pedestrian-action 표 하나).
      const turnType = feature.properties.turnType;
      if (typeof turnType === "number") {
        if (opts?.guard) {
          if (!pedestrianStepFor(turnType)) {
            throw new Error(`[tmap-pedestrian] 미지 turnType ${turnType}: ${description}`);
          }
          assertTurnTypeMatchesKorean(turnType, description);
        }
        step.turnType = turnType;
        const action = pedestrianStepFor(turnType)?.action;
        if (action) step.action = action;
      }
```

LineString 처리부에서 **첫 구간만** 문장 축에 귀속한다(`includeLineGeometry` 여부와 무관):

```ts
    } else {
      // ⚠ 문장의 거리·도로명은 **첫 LineString**이다(30경로 435스텝 실측). 합으로 읽으면
      // 다중 구간 스텝(짧은 연결 구간이 뒤따르는 경우)에서 48/435가 어긋난다.
      // pathCoords는 아래에서 종전대로 **전부** 귀속한다 — 기하는 실경로를 따라야 한다.
      if (attachTarget && attachTarget.distanceMeters === undefined) {
        const d = feature.properties.distance;
        if (typeof d === "number" && Number.isFinite(d)) attachTarget.distanceMeters = d;
        const name = feature.properties.name;
        if (name) attachTarget.roadNameKo = name;
        if (opts?.guard) assertDistanceMatchesKorean(attachTarget.description, attachTarget.distanceMeters);
      }
      if (includeLineGeometry && attachTarget) {
        for (const [lng, lat] of feature.geometry.coordinates) { /* 기존 코드 그대로 */ }
      }
    }
```

⚠ 기존 `else if (includeLineGeometry && attachTarget)` 분기를 위 `else` 블록으로 감싸는 형태다 —
`includeLineGeometry`가 꺼져 있어도 거리·도로명은 읽어야 한다.

`getWalkRouteBriefing` params에 `guard?: boolean`를 더해 `normalizeTmapWalkRoute`로 넘긴다.

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run src/lib/providers/__tests__/tmap-pedestrian-structured.test.ts src/lib/providers/__tests__ src/lib/__tests__`
Expected: PASS — 신규 6개 + 기존 회귀 전부

- [ ] **Step 5: 커밋**

```bash
git commit -m "feat(walk): Tmap 보행자 스텝에 turnType·도로명·거리·행동 투영 (E16 축3)" -- src/lib/providers/tmap-pedestrian.ts src/lib/types.ts src/lib/providers/__tests__/tmap-pedestrian-structured.test.ts
```

---

### Task 4: juso 로마자 도로명 provider

**Files:**
- Create: `src/lib/providers/juso-road-name.ts`
- Create: `src/lib/providers/__tests__/juso-road-name.test.ts`

**Interfaces:**
- Consumes: `env.JUSO_CONFM_KEY` (`src/lib/env.ts`, 기존)
- Produces:
  ```ts
  export function parseRoadNameEn(engAddr: string): string | null;  // 순수 — 테스트 대상
  export function roadNameEn(ko: string): Promise<string | null>;   // null=도로명 아님, throw=조회 실패
  export function roadNamesEn(kos: string[]): Promise<Map<string, string>>; // 병렬+타임아웃, 실패는 누락
  ```

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// src/lib/providers/__tests__/juso-road-name.test.ts
import { describe, expect, it } from "vitest";
import { parseRoadNameEn } from "../juso-road-name";

describe("parseRoadNameEn", () => {
  it("선행 건물번호 토큰 하나만 벗긴다", () => {
    expect(parseRoadNameEn("975 Cheonho-daero, Gangdong-gu, Seoul")).toBe("Cheonho-daero");
    expect(parseRoadNameEn("2-1 Jinhwangdo-ro, Gangdong-gu, Seoul")).toBe("Jinhwangdo-ro");
  });

  it("번호 토큰은 순수 숫자가 아닐 수 있다(실측 B102)", () => {
    expect(parseRoadNameEn("B102 Bongeunsa-ro, Gangnam-gu, Seoul")).toBe("Bongeunsa-ro");
  });

  it("이름 안의 번호(6-gil)는 남긴다 — 첫 토큰만 벗기기 때문", () => {
    expect(parseRoadNameEn("11 Seongnae-ro 6-gil, Gangdong-gu, Seoul")).toBe("Seongnae-ro 6-gil");
  });

  it("번호가 없으면 그대로", () => {
    expect(parseRoadNameEn("Cheonho-daero, Gangdong-gu, Seoul")).toBe("Cheonho-daero");
  });

  it("빈 값·쉼표 없음은 null", () => {
    expect(parseRoadNameEn("")).toBeNull();
    expect(parseRoadNameEn("975 ")).toBeNull();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/lib/providers/__tests__/juso-road-name.test.ts`
Expected: FAIL — `Failed to resolve import "../juso-road-name"`

- [ ] **Step 3: 구현**

```ts
// src/lib/providers/juso-road-name.ts
import { unstable_cache } from "next/cache";
import { env } from "../env";

/**
 * 도로명(ko) → 로마자 표기. 행안부 juso `addrLinkApi`의 `engAddr`에서 뽑는다.
 *
 * ⚠ **번역이 아니라 로마자 표기다.** 한국 도로 표지판이 같은 표기를 달고 있으므로
 * 외국인 사용자가 실제로 대조할 수 있는 유일한 형태다.
 *
 * ⚠ **지역 제약을 걸지 않는다**(설계 리뷰 #6 기각). 로마자 표기는 한글 문자열의 함수라
 * 동명 도로는 지역이 달라도 같은 표기다("천호대로" → Cheonho-daero, 어디서든).
 * 지역 키를 넣으면 역지오코딩 의존과 캐시 폭증만 얻고 정확도는 얻지 못한다.
 *
 * ⚠ **조회 실패는 throw, "도로명 아님"만 null**(설계 리뷰 #7). 둘을 합치면 일시 장애가
 * `unstable_cache`에 "도로명 없음"으로 30일 눌러앉는다. Tmap의 일반명(`보행자도로`)은
 * juso가 0건으로 걸러 주므로 차단 목록을 코드에 박을 필요가 없다(실측).
 */
const ENDPOINT = "https://business.juso.go.kr/addrlink/addrLinkApi.do";

/** 조회 상한(ms). 안내 시작 경로에 직렬로 끼므로 상한이 필수다. */
const LOOKUP_TIMEOUT_MS = 1500;

interface JusoRow { rn?: string; engAddr?: string }

/** `engAddr` 첫 쉼표 앞 조각에서 **선행 번호 토큰 하나만** 벗긴다. */
export function parseRoadNameEn(engAddr: string): string | null {
  const head = engAddr.split(",")[0]?.trim();
  if (!head) return null;
  const parts = head.split(/\s+/);
  // 첫 토큰에 숫자가 있으면 건물번호다(로마자 도로명은 숫자로 시작하지 않는다).
  // ⚠ 첫 토큰만 — "6-gil"은 이름의 일부다.
  const rest = /\d/.test(parts[0]) ? parts.slice(1) : parts;
  const name = rest.join(" ").trim();
  return name || null;
}

async function fetchRoadNameEn(ko: string): Promise<string | null> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("confmKey", env.JUSO_CONFM_KEY ?? "");
  url.searchParams.set("currentPage", "1");
  url.searchParams.set("countPerPage", "5");
  url.searchParams.set("keyword", ko);
  url.searchParams.set("resultType", "json");
  const res = await fetch(url, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`juso 도로명 조회 실패: HTTP ${res.status}`);
  const json = (await res.json()) as { results?: { juso?: JusoRow[] | null } };
  const rows = json.results?.juso ?? [];
  // 부분 일치가 다른 도로를 물어오는 것을 막는다 — 정확 일치만.
  for (const row of rows) {
    if (row.rn !== ko) continue;
    const name = parseRoadNameEn(row.engAddr ?? "");
    if (name) return name;
  }
  return null;
}

const cached = unstable_cache(fetchRoadNameEn, ["juso-road-name"], { revalidate: 2592000 });

export function roadNameEn(ko: string): Promise<string | null> {
  return cached(ko);
}

/** 여러 도로명을 병렬 조회. 실패·미발견은 Map에서 **누락**된다(비블로킹). */
export async function roadNamesEn(kos: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(kos.filter(Boolean))];
  const settled = await Promise.allSettled(unique.map((ko) => roadNameEn(ko)));
  const out = new Map<string, string>();
  settled.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value) out.set(unique[i], r.value);
  });
  return out;
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run src/lib/providers/__tests__/juso-road-name.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: 커밋**

```bash
git commit -m "feat(walk): juso engAddr에서 로마자 도로명 (E16 축3)" -- src/lib/providers/juso-road-name.ts src/lib/providers/__tests__/juso-road-name.test.ts
```

---

### Task 5: en 산문 생성기

**Files:**
- Create: `src/lib/walk-guidance-en.ts`
- Create: `src/lib/__tests__/walk-guidance-en.test.ts`

**Interfaces:**
- Consumes: `pedestrianStepFor` (Task 1), `formatDistance` (`src/lib/format.ts`), `WalkRouteBriefing`/`WalkRouteStep`
- Produces:
  ```ts
  export function buildEnBriefing(
    briefing: WalkRouteBriefing,
    roadNames: Map<string, string>,
  ): WalkRouteBriefing;   // description을 영어로 교체. 미지 turnType은 throw.
  export function roadNameKeysOf(briefing: WalkRouteBriefing): string[];
  ```

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// src/lib/__tests__/walk-guidance-en.test.ts
import { describe, expect, it } from "vitest";
import { buildEnBriefing, roadNameKeysOf } from "../walk-guidance-en";
import type { WalkRouteBriefing } from "../types";

const brief = (steps: WalkRouteBriefing["steps"]): WalkRouteBriefing => ({
  distanceMeters: 500, durationSeconds: 400, steps,
});

describe("buildEnBriefing", () => {
  it("행동절 + 거리 + 로마자 도로명", () => {
    const out = buildEnBriefing(
      brief([{ description: "우회전 후 진황도로를 따라 294m 이동", turnType: 13, roadNameKo: "진황도로", distanceMeters: 294 }]),
      new Map([["진황도로", "Jinhwangdo-ro"]]),
    );
    expect(out.steps[0].description).toBe("Turn right, then walk 294m along Jinhwangdo-ro.");
  });

  it("행동절이 없으면 Walk로 시작한다", () => {
    const out = buildEnBriefing(
      brief([{ description: "직진 후 169m 이동", turnType: 11, distanceMeters: 169 }]),
      new Map(),
    );
    expect(out.steps[0].description).toBe("Walk 169m.");
  });

  it("도로명 로마자가 없으면 도로 절을 뺀다(비블로킹 열화)", () => {
    const out = buildEnBriefing(
      brief([{ description: "좌측 횡단보도 후 14m 이동", turnType: 212, roadNameKo: "보행자도로", distanceMeters: 14 }]),
      new Map(),
    );
    expect(out.steps[0].description).toBe("Cross the crosswalk on your left, then walk 14m.");
  });

  it("시설 문장도 원문 구조를 그대로 옮긴다", () => {
    const out = buildEnBriefing(
      brief([{ description: "서울역 2번출구에서 지하보도 진입 후 72m 이동", turnType: 126, distanceMeters: 72 }]),
      new Map(),
    );
    expect(out.steps[0].description).toBe("Take the underpass, then walk 72m.");
  });

  it("도착 스텝은 거리·도로명을 달지 않는다", () => {
    const out = buildEnBriefing(brief([{ description: "도착", turnType: 201 }]), new Map());
    expect(out.steps[0].description).toBe("Arrive at your destination.");
  });

  it("거리가 없으면 거리 절을 뺀다", () => {
    const out = buildEnBriefing(
      brief([{ description: "좌회전", turnType: 12 }]),
      new Map(),
    );
    expect(out.steps[0].description).toBe("Turn left.");
  });

  it("1km 이상은 formatDistance 표기를 쓴다", () => {
    const out = buildEnBriefing(
      brief([{ description: "직진 후 1.1km 이동", turnType: 11, distanceMeters: 1100 }]),
      new Map(),
    );
    expect(out.steps[0].description).toBe("Walk 1.1km.");
  });

  it("미지 turnType은 throw — 행동절 없는 문장은 조용히 틀린 직진 지시다", () => {
    expect(() =>
      buildEnBriefing(brief([{ description: "무언가", turnType: 9999 }]), new Map()),
    ).toThrow(/미지/);
  });

  it("turnType이 아예 없는 스텝도 throw(카카오 스텝이 en 파이프라인에 새는 것 차단)", () => {
    expect(() => buildEnBriefing(brief([{ description: "무언가" }]), new Map())).toThrow(/turnType/);
  });

  it("live 조각은 en에 싣지 않는다(고유명사 없음)", () => {
    const out = buildEnBriefing(
      brief([{ description: "우회전 후 10m 이동", turnType: 13, distanceMeters: 10, live: { target: "파리바게뜨" } }]),
      new Map(),
    );
    expect(out.steps[0].live).toBeUndefined();
  });
});

describe("roadNameKeysOf", () => {
  it("중복 없이 도로명만 모은다", () => {
    expect(
      roadNameKeysOf(brief([
        { description: "a", turnType: 13, roadNameKo: "천호대로" },
        { description: "b", turnType: 13, roadNameKo: "천호대로" },
        { description: "c", turnType: 11 },
      ])),
    ).toEqual(["천호대로"]);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/lib/__tests__/walk-guidance-en.test.ts`
Expected: FAIL — `Failed to resolve import "../walk-guidance-en"`

- [ ] **Step 3: 구현**

```ts
// src/lib/walk-guidance-en.ts
import { formatDistance } from "./format";
import { pedestrianStepFor } from "./pedestrian-action";
import type { WalkRouteBriefing, WalkRouteStep } from "./types";

/**
 * Tmap 보행자 구조화 필드 → 영어 안내 문장(순수 함수).
 *
 * ⚠ **문장 틀은 Tmap 한국어 원문의 구조를 그대로 옮긴다.** 거리의 의미(시설을 지난 뒤인지
 * 통과 거리인지)는 우리가 정하는 것이 아니라 공급자가 정한 것이고 ko 사용자는 오늘 그
 * 문장을 듣고 있다 — 구조를 **바꿀 때** 새 위험이 생긴다(설계 리뷰 #9).
 *
 * ⚠ **POI 상호·교차로명은 뺀다.** juso가 로마자화하지 못하는 고유명사이고, 한글을 en 문장에
 * 남기면 영어 음성이 읽지 못한다. 그 결과 `live` 조각도 없고 주기 통지는 이름 없는 틀
 * (`guide.periodicStraightNoName`)로 떨어진다.
 *
 * ⚠ **거리 표기는 `formatDistance`만 지난다** — 문장 안에서 조립하면 같은 화면의 다른 거리와
 * 갈린다(1km 미만을 "0.8km"로 낸 사본 4곳의 전례).
 */

/** 영어 문장이 만들어지지 않는 스텝은 경로 전체를 거부한다(§4.3). */
function phraseOf(step: WalkRouteStep): string | null {
  if (step.turnType === undefined) {
    throw new Error(`[walk-en] turnType 없는 스텝: ${step.description}`);
  }
  const entry = pedestrianStepFor(step.turnType);
  if (!entry) throw new Error(`[walk-en] 미지 turnType ${step.turnType}: ${step.description}`);
  return entry.phrase;
}

/** 도착 스텝(201)은 거리·도로명을 달지 않는다 — 문장 자체가 종결이다. */
const ARRIVAL_TURN_TYPE = 201;

function sentenceOf(step: WalkRouteStep, roadNames: Map<string, string>): string {
  const phrase = phraseOf(step);
  if (step.turnType === ARRIVAL_TURN_TYPE) return `${phrase}.`;

  const meters = step.distanceMeters;
  const distance = meters !== undefined && meters > 0 ? formatDistance(meters) : null;
  const roadKo = step.roadNameKo;
  const road = roadKo ? (roadNames.get(roadKo) ?? null) : null;
  const along = road ? ` along ${road}` : "";

  if (!distance) return phrase ? `${phrase}.` : "Continue.";
  const walk = `walk ${distance}${along}`;
  return phrase ? `${phrase}, then ${walk}.` : `Walk ${distance}${along}.`;
}

/** 로마자 조회가 필요한 도로명 키(중복 제거). */
export function roadNameKeysOf(briefing: WalkRouteBriefing): string[] {
  return [...new Set(briefing.steps.map((s) => s.roadNameKo).filter((n): n is string => Boolean(n)))];
}

/** 스텝 문장을 영어로 교체한다. 다른 필드(좌표·거리·행동)는 보존. */
export function buildEnBriefing(
  briefing: WalkRouteBriefing,
  roadNames: Map<string, string>,
): WalkRouteBriefing {
  const steps = briefing.steps.map((step) => {
    const { live: _live, ...rest } = step;
    return { ...rest, description: sentenceOf(step, roadNames) };
  });
  return { ...briefing, steps };
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run src/lib/__tests__/walk-guidance-en.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: 커밋**

```bash
git commit -m "feat(walk): Tmap 구조화 필드에서 영어 안내 문장 생성 (E16 축3)" -- src/lib/walk-guidance-en.ts src/lib/__tests__/walk-guidance-en.test.ts
```

---

### Task 6: 파이프라인 — `getWalkRoute({ lang })`와 `attachStepActions`

**Files:**
- Modify: `src/lib/walk-route.ts`
- Modify: `src/lib/env.ts` (`hasWalkRouteKeyFor` 추가) — **소유권 밖, 자진 신고**
- Modify: `src/app/api/route/walk/route.ts` (`lang` 파싱·전달) — **소유권 밖, 자진 신고**
- Modify: `src/lib/chat/router.ts` (도보 도구 호출에 `lang: "ko"` 명시) — **소유권 밖, 자진 신고**
- Test: `src/lib/__tests__/walk-route-lang.test.ts` (Create)

**Interfaces:**
- Consumes: Task 3의 `getWalkRouteBriefing({ guard })`, Task 4의 `roadNamesEn`, Task 5의 `buildEnBriefing`·`roadNameKeysOf`
- Produces:
  ```ts
  // src/lib/env.ts
  export function hasWalkRouteKeyFor(lang: "ko" | "en"): boolean;
  // src/lib/walk-route.ts — lang은 기본값 없는 필수 인자
  getWalkRoute(params: { origin; dest; lang: "ko" | "en"; accessible?; includeGeometry?; variant?; via? })
  getWalkRouteAlternatives(params: { origin; dest; lang: "ko" | "en"; accessible?; via? })
  export function attachStepActions(b: WalkRouteBriefing, includeGeometry: boolean): WalkRouteBriefing;
  ```

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// src/lib/__tests__/walk-route-lang.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const tmap = vi.hoisted(() => vi.fn());
const kakao = vi.hoisted(() => vi.fn());
const roads = vi.hoisted(() => vi.fn());
vi.mock("../providers/tmap-pedestrian", () => ({ getWalkRouteBriefing: tmap }));
vi.mock("../providers/kakao-walk", () => ({ getKakaoWalkBriefing: kakao }));
vi.mock("../providers/juso-road-name", () => ({ roadNamesEn: roads }));
vi.mock("../env", async (orig) => ({
  ...(await orig<typeof import("../env")>()),
  hasKakaoKey: () => true,
  hasTmapKey: () => true,
}));
vi.mock("../providers/audio-signals", () => ({ hasAudioSignalNear: () => false }));
vi.mock("../providers/crosswalks", () => ({ matchCrosswalk: () => null }));

import { attachStepActions, getWalkRoute } from "../walk-route";

const origin = { lat: 37.5, lng: 127.1 };
const dest = { lat: 37.51, lng: 127.11 };

beforeEach(() => {
  tmap.mockReset(); kakao.mockReset(); roads.mockReset();
  roads.mockResolvedValue(new Map([["진황도로", "Jinhwangdo-ro"]]));
});

describe("getWalkRoute lang=en", () => {
  it("Tmap만 부르고 카카오는 부르지 않는다", async () => {
    tmap.mockResolvedValue({
      distanceMeters: 300, durationSeconds: 250,
      steps: [{ description: "우회전 후 진황도로를 따라 294m 이동", turnType: 13, roadNameKo: "진황도로", distanceMeters: 294, action: "right" }],
    });
    const r = await getWalkRoute({ origin, dest, lang: "en" });
    expect(kakao).not.toHaveBeenCalled();
    expect(tmap).toHaveBeenCalledWith(expect.objectContaining({ guard: true }));
    expect(r?.steps[0].description).toBe("Turn right, then walk 294m along Jinhwangdo-ro.");
  });

  it("음향신호기 주석 문구가 영어다", async () => {
    const { hasAudioSignalNear } = await import("../providers/audio-signals");
    vi.mocked(hasAudioSignalNear).mockReturnValue(true);
    tmap.mockResolvedValue({
      distanceMeters: 30, durationSeconds: 30,
      steps: [{ description: "횡단보도 후 14m 이동", turnType: 211, distanceMeters: 14, action: "crosswalk", coord: origin }],
    });
    const r = await getWalkRoute({ origin, dest, lang: "en" });
    expect(r?.steps[0].description).toContain("audible pedestrian signal");
  });
});

describe("getWalkRoute lang=ko", () => {
  it("종전대로 카카오를 먼저 부른다", async () => {
    kakao.mockResolvedValue({
      distanceMeters: 300, durationSeconds: 250,
      steps: [{ description: "성내로에서 100m 이동" }],
    });
    await getWalkRoute({ origin, dest, lang: "ko" });
    expect(kakao).toHaveBeenCalled();
    expect(tmap).not.toHaveBeenCalled();
  });
});

describe("attachStepActions", () => {
  it("기하 응답에는 카카오 스텝에도 행동을 채운다", () => {
    const out = attachStepActions(
      { distanceMeters: 1, durationSeconds: 1, steps: [{ description: "메가커피 앞에서 왼쪽으로 돌아 40m 이동" }] },
      true,
    );
    expect(out.steps[0].action).toBe("left");
  });

  it("비기하 응답에서는 행동·turnType·도로명을 전부 뗀다(byte-identical 유지)", () => {
    const out = attachStepActions(
      { distanceMeters: 1, durationSeconds: 1, steps: [{ description: "x", action: "left", turnType: 12, roadNameKo: "천호대로" }] },
      false,
    );
    expect(out.steps[0]).toEqual({ description: "x" });
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/lib/__tests__/walk-route-lang.test.ts`
Expected: FAIL — `attachStepActions is not a function` / `lang` 미지원

- [ ] **Step 3: 구현**

`src/lib/env.ts`에 추가:

```ts
/**
 * 도보 경로 게이트 — **로케일이 provider 집합을 정한다**. 비-ko 문장은 Tmap의 구조화
 * `turnType`에서만 만들 수 있으므로(카카오는 완성 한국어 문장만 준다) en은 Tmap 단독이다.
 * ⚠ 페이지·라우트가 같은 함수를 써야 한다 — split-brain이면 목록에는 있는데 조회는 502다.
 */
export function hasWalkRouteKeyFor(lang: "ko" | "en"): boolean {
  return lang === "ko" ? hasWalkRouteKey() : hasTmapKey();
}
```

`src/lib/walk-route.ts`:

```ts
// import 추가
import { roadNamesEn } from "./providers/juso-road-name";
import { buildEnBriefing, roadNameKeysOf } from "./walk-guidance-en";
import { walkStepAction } from "./walk-action";

/** 음향신호기 주석 문구 — ko/en. 도보 경로가 ko 전용이던 시절의 상수를 로케일로 갈랐다. */
const ANNOTATION: Record<"ko" | "en", string> = {
  ko: "음향신호기 있음",
  en: "audible pedestrian signal",
};

const STEP_FREE_NOTICE_EN: Record<Exclude<StepFreeStatus, "applied">, string> = {
  no_stepfree_route:
    "A step-free route could not be confirmed. The route may include stairs.",
  unavailable:
    "Step-free routing is unavailable. A standard route is provided and it may include stairs.",
};
const SHORTEST_STEPFREE_NOTICE_EN =
  "Step-free routing does not apply to the shortest route. It may include stairs.";
```

`annotateAudioSignals(briefing, keepGeometry, lang)`로 시그니처를 넓히고 판정을 다음으로 바꾼다:

```ts
    // 건널목 판정: 구조화 행동이 있으면 그것을, 없으면 종전 한국어 문자열을 본다.
    // Tmap 스텝은 normalize 시점에 이미 action을 달고 온다(ko 폴백 포함 — 211·212·213은
    // 종전 문자열 판정과 같은 결론이라 회귀가 없다).
    const isCrosswalk =
      rest.action !== undefined
        ? rest.action === "crosswalk"
        : rest.description.includes("횡단보도") && !MERGED_CROSSWALK.test(rest.description);
    const annotated =
      candidates.length > 0 && isCrosswalk &&
      candidates.some((c) => hasAudioSignalNear(c.lat, c.lng, MATCH_RADIUS_METERS))
        ? { ...rest, description: `${rest.description}, ${ANNOTATION[lang]}` }
        : rest;
```

⚠ `rest`에서 `action`을 구조분해로 빼지 말 것 — 스텝에 남겨 `attachStepActions`가 받는다.

파이프라인 마지막 단계를 더한다:

```ts
/**
 * 도보 스텝의 결정 지점 행동을 **서버가 전량 투영**한다(설계 리뷰 #3).
 * Tmap 스텝은 provider가 이미 `action`을 달았고, 카카오 스텝은 **주석까지 끝난 최종 문장**을
 * 종전 클라이언트와 같은 함수(`walkStepAction`)에 태운다 — 같은 입력·같은 함수라 결론이 같다.
 *
 * ⚠ `includeGeometry`가 아니면 내부 전달 필드를 전부 뗀다 — 브리핑 응답은 byte-identical이어야
 * CLI·채팅·MCP가 무변경이다(`live` 조각과 같은 게이트).
 */
export function attachStepActions(
  briefing: WalkRouteBriefing,
  includeGeometry: boolean,
): WalkRouteBriefing {
  const steps = briefing.steps.map((step) => {
    const { turnType: _t, roadNameKo: _r, ...rest } = step;
    if (!includeGeometry) {
      const { action: _a, ...plain } = rest;
      return plain;
    }
    const action = rest.action ?? walkStepAction(rest.description) ?? undefined;
    return action ? { ...rest, action } : rest;
  });
  return { ...briefing, steps };
}
```

`getWalkRoute`에 `lang: "ko" | "en"`을 필수 인자로 더하고 `annotate`를 다음으로 바꾼다:

```ts
  const annotate = async (b: WalkRouteBriefing, provider: "kakao" | "tmap") => {
    // en은 구조화 필드에서 문장을 새로 만든다(ko 재작성 파이프라인을 타지 않는다).
    const base =
      lang === "en"
        ? buildEnBriefing(b, await roadNamesEn(roadNameKeysOf(b)))
        : rewriteWalkBriefing(b, includeGeometry);
    return attachStepActions(
      annotateCrosswalkInfo(annotateAudioSignals(base, true, lang), includeGeometry, provider),
      includeGeometry,
    );
  };
```

⚠ `annotate`가 async가 되므로 모든 호출부에 `await`를 붙인다.

`fetchPrimaryOrFallback`에 `lang`·`includeGeometry`를 넘겨 provider 선택과 기하 전달을 고친다:

```ts
async function fetchPrimaryOrFallback(params: {
  origin: Coord; dest: Coord; accessible: boolean; noStore: boolean;
  waypoint: Coord | undefined; lang: "ko" | "en"; includeGeometry: boolean;
}): Promise<{ briefing: WalkRouteBriefing | null; via: "kakao" | "tmap" } | null> {
  const { origin, dest, accessible, noStore, waypoint, lang, includeGeometry } = params;
  // ⚠ en은 폴백이 없다 — 카카오로 내려가면 "가용성 폴백"이 아니라 한국어 문장이 나온다.
  const tmapCall = () =>
    getWalkRouteBriefing({
      origin, dest, via: waypoint, noStore,
      includeLineGeometry: includeGeometry,   // ⚠ 종전엔 안 넘겨 폴백이 기하를 잃었다(§4.6)
      guard: lang === "en",
    });
  if (lang === "en") {
    if (!hasTmapKey()) return null;
    return { briefing: await tmapCall(), via: "tmap" };
  }
  if (hasKakaoKey()) {
    try {
      return { briefing: await getKakaoWalkBriefing({ origin, dest, accessible, via: waypoint, noStore }), via: "kakao" };
    } catch (e) {
      if (!hasTmapKey()) throw e;
      logRouteFallback("[walk-route] 카카오 실패, Tmap 폴백:", origin, dest, e);
      return { briefing: await tmapCall(), via: "tmap" };
    }
  }
  if (hasTmapKey()) return { briefing: await tmapCall(), via: "tmap" };
  return null;
}
```

`withStepFree`에 `lang`을 넘겨 en 문구를 쓰게 하고, `variant === "shortest"` 분기의
`getWalkRouteBriefing` 호출에도 `guard: lang === "en"`을 더한다.
`getWalkRouteAlternatives`도 `lang`을 필수로 받아 그대로 전달한다.

`src/app/api/route/walk/route.ts`: 스키마에 `lang: z.enum(["ko","en"]).catch("ko")`를 더하고
게이트를 `hasWalkRouteKeyFor(parsed.lang)`으로 바꾼 뒤 `getWalkRoute`/`getWalkRouteAlternatives`에 전달한다.

`src/lib/chat/router.ts`: 도보 경로 도구의 `getWalkRoute(...)` 호출에 `lang: "ko"`를 명시한다.

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run src/lib/__tests__ src/app/api/__tests__`
Expected: PASS — 신규 5개 + 기존 walk-route 회귀 전부

- [ ] **Step 5: 커밋**

```bash
git commit -m "feat(walk): lang 필수 인자·en 파이프라인·서버 행동 투영·Tmap 폴백 기하 복구 (E16 축3)" -- src/lib/walk-route.ts src/lib/env.ts src/app/api/route/walk/route.ts src/lib/chat/router.ts src/lib/__tests__/walk-route-lang.test.ts
```

---

### Task 7: 리듀서가 서버 투영만 본다 (웹 ↔ Kit)

**Files:**
- Modify: `src/lib/route-guide.ts` (walk 프로파일 `actionSource: "text"` → `"step"`) — **소유권 밖, 자진 신고**
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/RouteGuide.swift` (같은 한 줄) — **소유권 밖, 자진 신고**
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/WalkAction.swift` (주석 갱신)
- Test: `src/lib/__tests__/route-guide.test.ts`(기존에 케이스 추가), `ios/GildongmuKit/Tests/GildongmuKitTests/RouteGuideTests.swift`

**Interfaces:**
- Consumes: Task 6의 `attachStepActions`가 채운 `step.action`
- Produces: (없음 — 동작 계약 변경)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/__tests__/route-guide.test.ts`에 추가:

```ts
  it("walk 임박 큐는 서버 투영 action만 본다(문장 폴백 없음)", () => {
    // 서버가 action을 채우므로 문장이 영어여도 큐가 나간다.
    const route = buildTestRoute([
      { description: "Turn right, then walk 294m along Jinhwangdo-ro.", action: "right" },
    ]);
    expect(actionOfStep(route, 0)).toBe("right");
  });

  it("action 없는 스텝은 침묵한다(문장으로 되돌아가지 않는다)", () => {
    const route = buildTestRoute([{ description: "메가커피 앞에서 왼쪽으로 돌아 40m 이동" }]);
    expect(actionOfStep(route, 0)).toBeNull();
  });
```

(`buildTestRoute`·`actionOfStep`이 없으면 기존 파일의 fixture 헬퍼 관례를 따라 만든다 —
기존 케이스가 쓰는 헬퍼 이름을 먼저 읽고 그것을 재사용할 것.)

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/lib/__tests__/route-guide.test.ts`
Expected: FAIL — 두 번째 케이스가 `"left"`를 돌려준다(현재는 문장 분류)

- [ ] **Step 3: 구현**

`src/lib/route-guide.ts` walk 프로파일:

```ts
  // 도보 행동은 **서버가 전량 투영**한다(spec 2026-08-23 §4.2.1) — 카카오 스텝은
  // 서버가 최종 문장을 분류해 싣고, Tmap 스텝은 turnType 표에서 온다. 클라이언트
  // 문자열 폴백을 두면 구조화의 "의도된 행동 없음"과 미투영을 구별하지 못한다.
  actionSource: "step",
```

Kit `RouteGuide.swift`의 walk 프로파일도 `actionSource: .step`으로 바꾸고, Kit `WalkAction.swift`
`walkStepAction`의 문서 주석 머리에 다음을 더한다:

```swift
/// ⚠ **2026-08-23부터 리듀서는 이 함수를 부르지 않는다** — 도보 행동은 서버가 전량 투영하고
/// walk 프로파일도 `actionSource: .step`이다. 웹 정본은 서버에서 계속 쓰인다. Kit의 이 사본과
/// `GuideActionSource.text` 분기는 호출자가 없으며 정리 항목은 `docs/BACKLOG.md`에 있다.
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run src/lib/__tests__/route-guide.test.ts`
Run: `cd ios/GildongmuKit && swift test --filter RouteGuideTests`
Expected: PASS 둘 다

- [ ] **Step 5: 커밋**

```bash
git commit -m "refactor(guide): 도보 행동을 서버 투영으로 일원화 (E16 축3)" -- src/lib/route-guide.ts src/lib/__tests__/route-guide.test.ts ios/GildongmuKit/Sources/GildongmuKit/RouteGuide.swift ios/GildongmuKit/Sources/GildongmuKit/WalkAction.swift ios/GildongmuKit/Tests/GildongmuKitTests/RouteGuideTests.swift
```

---

### Task 8: 웹 게이트 해제

**Files:**
- Modify: `src/app/[locale]/page.tsx:70` — **소유권 밖, 자진 신고**
- Modify: `src/components/DirectionsView.tsx` (479·840·845·854 + `walkRouteUrl` 호출부)
- Modify: `src/lib/walk-route-url.ts` (`lang` 필수 인자)
- Modify: `src/hooks/useRouteGuide.ts` (1646 분기 삭제, 2064 `canOfferDetail`)
- Test: `src/components/__tests__/DirectionsWalkLocale.test.tsx` (Create)

**Interfaces:**
- Consumes: Task 6의 `hasWalkRouteKeyFor`
- Produces: `walkRouteUrl({ ..., lang })` — `lang` 필수

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```tsx
// src/components/__tests__/DirectionsWalkLocale.test.tsx
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import DirectionsView from "../DirectionsView";
import { renderWithLocale } from "./helpers";   // 기존 헬퍼 관례를 따른다

describe("비-ko 도보 수단", () => {
  it("en 로케일에도 도보 수단이 목록에 있다", () => {
    renderWithLocale("en", <DirectionsView canShowWalk canShowTransit canBriefCarRoute={false} onBack={() => {}} />);
    expect(screen.getByRole("heading", { name: /walk/i })).toBeInTheDocument();
  });

  it("en 로케일에는 계단 회피 토글이 없다(적용될 수 없는 옵션)", () => {
    renderWithLocale("en", <DirectionsView canShowWalk canShowTransit canBriefCarRoute={false} onBack={() => {}} />);
    expect(screen.queryByRole("checkbox", { name: /step|stair/i })).toBeNull();
  });
});
```

⚠ `renderWithLocale`이 없으면 기존 `DirectionsOrder.test.tsx`가 쓰는 provider 래핑 방식을 그대로 복사한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/components/__tests__/DirectionsWalkLocale.test.tsx`
Expected: FAIL — 도보 heading 없음

- [ ] **Step 3: 구현**

- `src/lib/walk-route-url.ts`: params에 `lang: "ko" | "en"`을 **필수**로 더하고
  `if (lang !== "ko") url += \`&lang=${lang}\`;`(ko는 파라미터를 붙이지 않아 기존 캐시 키 유지).
  주석에 "생략 가능한 안전 인자 금지" 근거를 한 줄 더한다.
- `DirectionsView.tsx:479`: `...(canShowWalk ? (["walk"] as const) : [])`
- `DirectionsView.tsx:840·845`: 도보 대안 조건에서 `!prefersEnglish(locale)` 제거.
- `DirectionsView.tsx:854`: **유지**(계단 회피 토글은 ko 전용) — 주석에 근거를 남긴다:
  ```ts
  // ⚠ 계단 회피는 카카오 전용 축이라 en(Tmap 단독)에서는 항상 unavailable이다.
  // 적용될 수 없는 옵션을 켜게 두고 조회 뒤에야 못 했다고 말하면, SR 사용자는
  // 그 사이 적용됐다고 믿는다(spec §4.7).
  ```
- `walkRouteUrl`·`fetchMode`의 도보 호출부에 `lang: dataLocale(locale) === "ko" ? "ko" : "en"`을 전달.
- `useRouteGuide.ts:1646`: `if (prefersEnglish(locale)) { announce(t("briefStarted")); return; }` **삭제**.
- `useRouteGuide.ts:2064`: `canOfferDetail: kindFixed === "walk" && hasRoute`
- `src/app/[locale]/page.tsx:70`: `canShowWalk={hasWalkRouteKeyFor(dataLocale(locale) === "ko" ? "ko" : "en")}`

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run src/components/__tests__ src/hooks/__tests__`
Expected: PASS — 신규 2개 + 기존 회귀 전부

- [ ] **Step 5: 커밋**

```bash
git commit -m "feat(walk): 웹 비-ko 도보 상세 게이트 해제 (E16 축3)" -- src/lib/walk-route-url.ts src/components/DirectionsView.tsx src/hooks/useRouteGuide.ts src/app/[locale]/page.tsx src/components/__tests__/DirectionsWalkLocale.test.tsx
```

---

### Task 9: iOS 게이트 해제

**Files:**
- Modify: `ios/Gildongmu/Directions/DirectionsTabView.swift` (388·886·1060·1067·1079, 1090은 유지)
- Modify: Kit `RouteService`(도보 조회 URL에 `lang` 전달) — 파일명은 `ios/GildongmuKit/Sources/GildongmuKit/RouteService.swift`
- Test: `ios/GildongmuKit/Tests/GildongmuKitTests/RouteServiceTests.swift` (URL 단언 추가)

**Interfaces:**
- Consumes: Task 6의 서버 `lang` 파라미터
- Produces: (없음)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`RouteServiceTests.swift`에 추가:

```swift
@Test func 도보_조회는_앱_언어를_lang으로_보낸다() {
    // ⚠ ko는 파라미터를 붙이지 않는다(기존 캐시 키·기존 테스트 단언 유지).
    #expect(RouteService.walkPath(origin: o, dest: d, accessible: false,
                                  includeGeometry: false, via: nil, lang: "ko").contains("lang=") == false)
    #expect(RouteService.walkPath(origin: o, dest: d, accessible: false,
                                  includeGeometry: false, via: nil, lang: "en").contains("lang=en"))
}
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd ios/GildongmuKit && swift test --filter RouteServiceTests`
Expected: FAIL — `lang` 인자 없음(컴파일 오류)

- [ ] **Step 3: 구현**

- Kit `RouteService`의 도보 조회 경로 조립 함수에 `lang: String`을 **기본값 없이** 더하고
  `ko`가 아닐 때만 `&lang=<lang>`을 붙인다. 호출부(`walk`·`walkAlternatives`)에도 전파한다.
  ⚠ N4의 `via`와 같은 이유로 기본값을 두지 않는다 — 빠뜨린 조회가 조용히 한국어를 준다.
- `DirectionsTabView.swift:388`: `let includeWalk = true`가 아니라 **`include:` 인자 자체를 삭제**하고
  `Self.settleWalk(service, origin:dest:accessible:via:lang:)`로 바꾼다(상시 참인 상수를 남기지 않는다).
- `:886`: `if !WalkGuideNotice.confirmed { walkNoticePresented = true }` — ko 조건 삭제.
- `:1060/1067/1079`: 도보 대안 관련 `AppLanguage.dataLocale == "ko"` 조건 삭제.
- `:1090`: **유지**. 주석을 더한다:
  ```swift
  // ⚠ 계단 회피는 카카오 전용 축이라 en(Tmap 단독)에서는 항상 unavailable이다 — 적용될 수
  // 없는 옵션을 노출하지 않는다(spec 2026-08-23-non-ko-walk-guidance-design.md §4.7).
  ```
- 도보 조회·안내 시작 경로 전부에 `lang: AppLanguage.dataLocale == "ko" ? "ko" : "en"`을 전달.

- [ ] **Step 4: 통과를 확인한다**

Run: `cd ios/GildongmuKit && swift test`
Run: `xcodebuild -project ios/Gildongmu.xcodeproj -scheme Gildongmu -configuration Debug -sdk iphonesimulator build 2>&1 | tail -5`
Expected: 둘 다 성공

- [ ] **Step 5: 커밋**

```bash
git commit -m "feat(walk): iOS 비-ko 도보 상세 게이트 해제 (E16 축3)" -- ios/Gildongmu/Directions/DirectionsTabView.swift ios/GildongmuKit/Sources/GildongmuKit/RouteService.swift ios/GildongmuKit/Tests/GildongmuKitTests/RouteServiceTests.swift
```

---

### Task 10: 실호출 게이트 스크립트

**Files:**
- Create: `scripts/verify-non-ko-walk-guidance.mjs`

**Interfaces:**
- Consumes: `TMAP_APP_KEY`·`JUSO_CONFM_KEY`(`.env.local`), Task 1~6의 서버 모듈
- Produces: (없음 — 머지 게이트 스크립트)

- [ ] **Step 1: 스크립트를 쓴다**

```js
// scripts/verify-non-ko-walk-guidance.mjs
/**
 * E16 축3 실호출 게이트 — 정적 리뷰가 못 잡는 "데이터 커버리지 현실"을 잰다.
 * 실행: node scripts/verify-non-ko-walk-guidance.mjs   (.env.local 필요)
 *
 * 단언 5종. 하나라도 실패하면 exit 1.
 *  ① 전 스텝 description에 한글 0
 *  ② 관측 코드의 action이 표와 일치
 *  ③ 로마자 도로명이 최소 1건 붙는다
 *  ④ includeGeometry에서 pathCoords·action이 온다
 *  ⑤ 30경로 435스텝 규모 코퍼스에서 가드 오탐 0(설계 근거의 회귀)
 */
```

전체 구현은 다음 골격을 따른다(코퍼스 좌표는 spec §2.2의 30쌍을 그대로 옮긴다):

```js
import { config } from "dotenv";
config({ path: ".env.local" });
const { getWalkRoute } = await import("../src/lib/walk-route.ts");   // tsx 실행 전제

const ROUTES = [ /* spec §2.2의 30쌍 [originLat, originLng, destLat, destLng] */ ];
const HANGUL = /[가-힣]/;
let steps = 0, roads = 0, fail = 0;
const say = (ok, msg) => { if (!ok) { fail++; console.error("FAIL", msg); } };

for (const [oLat, oLng, dLat, dLng] of ROUTES) {
  const r = await getWalkRoute({
    origin: { lat: oLat, lng: oLng }, dest: { lat: dLat, lng: dLng },
    lang: "en", includeGeometry: true,
  });
  if (!r) continue;
  for (const s of r.steps) {
    steps++;
    say(!HANGUL.test(s.description), `한글 잔존: ${s.description}`);
    say(Array.isArray(s.pathCoords) && s.pathCoords.length > 0, `기하 없음: ${s.description}`);
    if (/ along /.test(s.description)) roads++;
  }
}
say(steps >= 400, `스텝 ${steps} < 400 — 코퍼스 규모 미달`);
say(roads >= 1, "로마자 도로명 0건");
console.log(`steps=${steps} roadsWithName=${roads} fail=${fail}`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: 실행해 통과를 확인한다**

Run: `npx tsx scripts/verify-non-ko-walk-guidance.mjs`
Expected: `fail=0`, `steps` 400 이상, `roadsWithName` 1 이상

⚠ 실패하면 **구현이 아니라 설계를 의심한다** — 이 스크립트가 설계 근거(§2.4)의 회귀 가드다.

- [ ] **Step 3: 커밋**

```bash
git commit -m "test(walk): 비-ko 도보 안내 실호출 게이트 (E16 축3)" -- scripts/verify-non-ko-walk-guidance.mjs
```

---

### Task 11: 문서 분배

**Files:**
- Modify: `CHANGELOG.md` (자기 항목만)
- Modify: `docs/BACKLOG.md` (E16 축3 종결 표기 + Kit `walkStepAction`·`GuideActionSource.text` 정리 항목 신설)
- Modify: `CLAUDE.md` (도보 경로 행 + 새 함정)
- Modify: `PROGRESS.md` (상태 한 줄)
- Modify: `docs/INTEGRATIONS.md` §도보 경로

- [ ] **Step 1: `CLAUDE.md` 통합 카탈로그 "도보 경로" 행에 다음을 더한다**

```
⚠ **비-ko는 Tmap 단독이고 문장은 서버가 en으로 만든다**(E16 축3, spec `2026-08-23-non-ko-walk-guidance-design.md`):
`turnType → {action, phrase}` **표 하나**(`pedestrian-action.ts`)가 임박 큐 행동과 영어 문구를 함께 낸다 —
두 표로 나누면 "문장은 좌회전인데 톤은 우회전"이 커버리지 테스트를 통과한 채 성립한다. **문장의 거리·도로명은
Point 뒤 첫 LineString**이지 합이 아니다(합으로 읽으면 435스텝 중 48건이 어긋난다. `pathCoords`는 종전대로 전부).
응답의 한국어 원문은 en 문장의 **출처가 아니라 증인**이다 — 표지·거리 대조 가드(`pedestrian-guard.ts`)가 미관측
코드와 귀속 가정 파손을 즉시 실패로 바꾼다(코퍼스 435스텝 오탐 0). 미지 `turnType`은 throw다: 행동절을 빼면
*회전을 말하지 않은 직진 지시*가 되어 조용히 틀린다. ⚠ **도보 스텝의 `action`은 이제 서버가 전량 투영**하고
리듀서는 `actionSource: "step"`만 본다(클라이언트 문자열 폴백 제거 — 구조화의 "의도된 행동 없음"과 미투영을
구별할 수 없기 때문). `includeGeometry` 응답에만 실린다. ⚠ **`lang`은 `getWalkRoute`·`walkRouteUrl` 둘 다
기본값 없는 필수 인자**다. ⚠ **비-ko에 계단 회피 컨트롤을 노출하지 않는다** — Tmap에 검증된 축이 없어 항상
`unavailable`인데, 적용될 수 없는 옵션을 켜게 두면 SR 사용자는 적용됐다고 믿는다.
```

- [ ] **Step 2: `docs/BACKLOG.md` E16 축3을 종결로 바꾸고 정리 항목을 신설한다**

```
3. ~~**비-ko에 상세를 준다**~~ — ✅ **2026-08-23 종결**(spec `2026-08-23-non-ko-walk-guidance-design.md`,
   실호출 게이트 `scripts/verify-non-ko-walk-guidance.mjs`). 축 2가 열렸다.
```

§신규 후보에 추가:

```
| **Kit `walkStepAction` 정리** | E16 축3으로 도보 행동이 서버 투영 일원화되어 Kit의 `walkStepAction`과
`GuideActionSource.text` 분기에 **호출자가 없다**. 함께 지우면 `GuideActionSource` 자체가 사라지므로
car 영역(K2)까지 닿는다 — 별도 묶음으로. 웹 정본은 서버에서 계속 쓰이므로 삭제 대상이 아니다 |
```

- [ ] **Step 3: `CHANGELOG.md`에 항목을 더한다(2~4줄 + spec 링크), `PROGRESS.md`는 상태 한 줄만**

- [ ] **Step 4: `docs/INTEGRATIONS.md` §도보 경로에 en 파이프라인 계약을 더한다**

- [ ] **Step 5: 커밋**

```bash
git commit -m "docs(walk): E16 축3 문서 분배 — 서사·판정·함정·상태" -- CHANGELOG.md docs/BACKLOG.md CLAUDE.md PROGRESS.md docs/INTEGRATIONS.md
```

---

## 통합 전 최종 점검

```bash
git fetch && git rebase origin/main
node ios/scripts/messages-to-xcstrings.mjs && node ios/scripts/check-xcstrings-keys.mjs
python ../../Mac-Projects/sync_agent_docs.py     # 워크스페이스 루트에서
npm run test:run && npx tsc --noEmit && npm run lint
npx tsx scripts/verify-non-ko-walk-guidance.mjs
git diff main...HEAD --numstat -- '*.test.*' 'ios/**/*Tests*'   # 테스트 파일 삭제 줄 수 확인
comm -23 <(git show origin/main:CHANGELOG.md | sort) <(sort CHANGELOG.md)   # 소실 줄 0이어야 한다
git push origin feat/e16:main
```
