# 도보 기본 provider 카카오 전환 + Tmap 폴백 + 계단 회피 모드 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 도보 경로의 기본 provider를 카카오(`dapi.kakao.com/v2/routing/walk`)로 전환하고 Tmap을 throw 시 폴백으로 강등하며, 계단 회피 모드(`route_mode=ACCESSIBLE`)를 옵트인으로 신설한다.

**Architecture:** 신규 `kakao-walk` provider(순수 정규화·fail-closed)를 만들고, `walk-route.ts` 서비스가 provider 선택·폴백·`stepFree` 3-state·안전 문장 삽입을 소유한다. 소비자(라우트·채팅·웹 UI)는 서비스 계약만 따른다. spec 정본: `docs/superpowers/specs/2026-07-29-kakao-walk-primary-design.md`.

**Tech Stack:** Next.js 16 Route Handler, zod 4, Vitest 4 (node env, fetch mock).

## Global Constraints

- 커밋 이메일 `engccer@gmail.com`, 주석·커밋 한국어, 변수/함수명 영어. `git add -A` 금지(의도 파일만).
- guidance 완성 문장이 낭독 정본: 스텝 문장을 자르거나 재조합하지 않는다(안전 문장은 별도 스텝 삽입).
- 3-state: 키 없음(미노출·404) ≠ 경로 없음(null) ≠ upstream 장애(throw→502). 미관측 status·스키마 위반은 **throw**(null 흡수 금지).
- 경로 불가 graceful null은 실측 확정 status 2종만: `TOO_FAR_AWAY`·`ROUTE_RESULT_NOT_FOUND`.
- 폴백은 카카오 **throw 시에만**(null은 폴백 없이 null). 폴백 발동 시 `console.warn`으로 원인 로그.
- `stepFree` 값은 `"applied" | "no_stepfree_route" | "unavailable"`. accessible 요청 시 항상 존재, 미요청 시 필드 부재.
- 캐시는 provider fetch 단위(`next: { revalidate: 3600 }`), 좌표는 `roundCoord(값, 4)`.
- 카카오 fetch 타임아웃 8초(`AbortSignal.timeout(8000)`), Tmap 폴백에도 동일 적용.
- 음향신호기 주석: 판정 대상은 "횡단보도" 포함 스텝 중 수량 표현(`\d+개의`) 없는 것만, 판정 좌표는 `pathCoords` 전체 최근접(Tmap 단일 `coord`는 1원소 취급), 반경 40m(2026-07-29 실측 확정: 32.5m 이하 vs 91m 이상 완전 분리).
- UI 라벨 이모지 금지, 산문에 em dash 금지.

---

### Task 1: kakao-walk provider (정규화 + fetch)

**Files:**
- Create: `src/lib/providers/kakao-walk.ts`
- Modify: `src/lib/types.ts:272-287` (`WalkRouteStep`에 `pathCoords?: Coord[]` 추가)
- Test: `src/lib/providers/__tests__/kakao-walk.test.ts`

**Interfaces:**
- Consumes: `WalkRouteBriefing`/`WalkRouteStep`/`Coord`(`../types`), `roundCoord`(`../coord-round`), `env`(`../env`).
- Produces: `getKakaoWalkBriefing(params: { origin: Coord; dest: Coord; accessible?: boolean }): Promise<WalkRouteBriefing | null>` 와 순수 함수 `normalizeKakaoWalkRoute(data: KakaoWalkResponse): WalkRouteBriefing | null`(null=경로 불가 status). Task 2가 이 두 이름을 그대로 import한다.

- [ ] **Step 1: types.ts에 pathCoords 추가**

`WalkRouteStep`에 필드 1개 추가(기존 `coord` 유지 — Tmap 경로):

```ts
export interface WalkRouteStep {
  description: string;
  distanceMeters?: number;
  /**
   * 안내 지점 좌표(내부 전달용). provider가 채우고 walk-route 서비스가
   * 음향신호기 주석 판정에 쓴 뒤 **응답 전 제거**한다 — API 응답에 노출 금지.
   * coord는 단일 지점(Tmap Point), pathCoords는 스텝 폴리라인(카카오) —
   * 판정은 두 형태 모두 "후보점 목록"으로 수용한다(2026-07-29 재캘리브레이션).
   */
  coord?: Coord;
  pathCoords?: Coord[];
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

`src/lib/providers/__tests__/kakao-walk.test.ts`. 실측 envelope(top-level `route` 단수 + top-level `status`)를 fixture로 고정:

```ts
import { describe, expect, it } from "vitest";
import {
  normalizeKakaoWalkRoute,
  type KakaoWalkResponse,
} from "../kakao-walk";

function makeResponse(overrides?: Partial<KakaoWalkResponse>): KakaoWalkResponse {
  return {
    status: "OK",
    route: {
      properties: { totalDistance: 646, totalTime: 645 },
      legs: [
        {
          steps: [
            {
              properties: { guidance: "노량진역 7번 출구까지 역사 내 이동", distance: 35 },
              path: { points: [[126.94089, 37.51358], [126.94013, 37.51354]] },
            },
            {
              properties: { guidance: "지하보도 이용", distance: 40 },
              path: { points: [[126.93985, 37.51339]] },
            },
          ],
        },
      ],
    },
    ...overrides,
  };
}

describe("normalizeKakaoWalkRoute", () => {
  it("정상 응답을 WalkRouteBriefing으로 정규화한다(pathCoords lat/lng 변환 포함)", () => {
    const briefing = normalizeKakaoWalkRoute(makeResponse());
    expect(briefing).not.toBeNull();
    expect(briefing?.distanceMeters).toBe(646);
    expect(briefing?.durationSeconds).toBe(645);
    expect(briefing?.steps).toHaveLength(2);
    expect(briefing?.steps[0]).toEqual({
      description: "노량진역 7번 출구까지 역사 내 이동",
      distanceMeters: 35,
      pathCoords: [
        { lat: 37.51358, lng: 126.94089 },
        { lat: 37.51354, lng: 126.94013 },
      ],
    });
  });

  it("다중 leg를 순서대로 평탄화한다", () => {
    const res = makeResponse();
    res.route!.legs = [
      { steps: [{ properties: { guidance: "1구간" }, path: { points: [[127, 37]] } }] },
      { steps: [{ properties: { guidance: "2구간" }, path: { points: [[127.1, 37.1]] } }] },
    ];
    const briefing = normalizeKakaoWalkRoute(res);
    expect(briefing?.steps.map((s) => s.description)).toEqual(["1구간", "2구간"]);
  });

  it("guidance 없는 스텝은 제외하고, 좌표 깨진 스텝은 pathCoords만 생략한다", () => {
    const res = makeResponse();
    res.route!.legs = [
      {
        steps: [
          { properties: { guidance: "" }, path: { points: [[127, 37]] } },
          { properties: { guidance: "좌표 없는 안내" }, path: { points: [] } },
        ],
      },
    ];
    const briefing = normalizeKakaoWalkRoute(res);
    expect(briefing?.steps).toEqual([{ description: "좌표 없는 안내" }]);
  });

  it("경로 불가 status 2종은 null(graceful)", () => {
    for (const status of ["TOO_FAR_AWAY", "ROUTE_RESULT_NOT_FOUND"]) {
      expect(
        normalizeKakaoWalkRoute(makeResponse({ status, route: { properties: { totalDistance: 0, totalTime: 0 }, legs: [] } })),
      ).toBeNull();
    }
  });

  it("미관측 status는 throw(fail-closed — 장애를 경로 없음으로 뭉개지 않는다)", () => {
    expect(() =>
      normalizeKakaoWalkRoute(makeResponse({ status: "UNKNOWN_NEW_STATUS", route: { properties: { totalDistance: 0, totalTime: 0 }, legs: [] } })),
    ).toThrow();
  });

  it("스키마 위반(route 부재·총거리 비유한·안내 단계 0개)은 throw", () => {
    expect(() => normalizeKakaoWalkRoute({ status: "OK" } as KakaoWalkResponse)).toThrow();
    const badDist = makeResponse();
    badDist.route!.properties.totalDistance = 0;
    expect(() => normalizeKakaoWalkRoute(badDist)).toThrow();
    const noSteps = makeResponse();
    noSteps.route!.legs = [{ steps: [{ properties: { guidance: "" }, path: { points: [] } }] }];
    expect(() => normalizeKakaoWalkRoute(noSteps)).toThrow();
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx vitest run src/lib/providers/__tests__/kakao-walk.test.ts`
Expected: FAIL (모듈 없음).

- [ ] **Step 4: provider 구현**

`src/lib/providers/kakao-walk.ts`. 파일 헤더 주석에 실측 계약(2026-07-22·07-29: envelope route 단수·status 2종·ACCESSIBLE·en 미지원)을 tmap-pedestrian.ts 스타일로 기록:

```ts
import { env } from "../env";
import { roundCoord } from "../coord-round";
import type { Coord, WalkRouteBriefing, WalkRouteStep } from "../types";

const ENDPOINT = "https://dapi.kakao.com/v2/routing/walk";

/** 경로 불가로 graceful(null) 처리할 status — 실호출 관측분만(추측 금지). */
const NO_ROUTE_STATUSES = new Set(["TOO_FAR_AWAY", "ROUTE_RESULT_NOT_FOUND"]);

interface KakaoWalkStep {
  properties?: { guidance?: string; distance?: number };
  path?: { points?: [number, number][] };
}

export interface KakaoWalkResponse {
  status?: string;
  route?: {
    properties: { totalDistance?: number; totalTime?: number };
    legs?: { steps?: KakaoWalkStep[] }[];
  };
}

export function normalizeKakaoWalkRoute(
  data: KakaoWalkResponse,
): WalkRouteBriefing | null {
  const status = data.status;
  if (status !== undefined && status !== "OK") {
    if (NO_ROUTE_STATUSES.has(status)) return null;
    throw new Error(`카카오 도보 경로 실패: 미관측 status ${status}`);
  }
  const route = data.route;
  if (!route) throw new Error("카카오 도보 경로 정규화 실패: route 부재");
  const distanceMeters = route.properties?.totalDistance ?? NaN;
  const durationSeconds = route.properties?.totalTime ?? NaN;
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    throw new Error("카카오 도보 경로 정규화 실패: 총 거리 값 이상");
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("카카오 도보 경로 정규화 실패: 총 시간 값 이상");
  }
  const steps: WalkRouteStep[] = [];
  for (const leg of route.legs ?? []) {
    for (const step of leg.steps ?? []) {
      const description = step.properties?.guidance;
      if (!description) continue;
      const distance = step.properties?.distance;
      // points는 [lng, lat] 순서. 유한 좌표만 pathCoords로 투영, 전멸이면 생략
      // (주석 판정만 포기하고 안내문은 살린다 — Tmap coord 생략 원칙 동형).
      const pathCoords: Coord[] = (step.path?.points ?? [])
        .filter(([lng, lat]) => Number.isFinite(lat) && Number.isFinite(lng))
        .map(([lng, lat]) => ({ lat, lng }));
      steps.push({
        description,
        ...(Number.isFinite(distance) ? { distanceMeters: distance } : {}),
        ...(pathCoords.length > 0 ? { pathCoords } : {}),
      });
    }
  }
  if (steps.length === 0) {
    throw new Error("카카오 도보 경로 정규화 실패: 안내 단계 0개");
  }
  return { distanceMeters, durationSeconds, steps };
}

/**
 * 카카오 도보 경로 조회. 경로 없으면 null(graceful), HTTP 실패·미관측 status·
 * 스키마 위반은 throw(서비스가 Tmap 폴백으로 전환). 타임아웃 8초: 무한 대기는
 * throw가 아니라서 폴백이 영영 발동하지 않는다(spec §아키텍처).
 */
export async function getKakaoWalkBriefing(params: {
  origin: Coord;
  dest: Coord;
  accessible?: boolean;
}): Promise<WalkRouteBriefing | null> {
  const { origin, dest, accessible } = params;
  const url = new URL(ENDPOINT);
  url.searchParams.set("start_x", String(roundCoord(origin.lng, 4)));
  url.searchParams.set("start_y", String(roundCoord(origin.lat, 4)));
  url.searchParams.set("end_x", String(roundCoord(dest.lng, 4)));
  url.searchParams.set("end_y", String(roundCoord(dest.lat, 4)));
  if (accessible) url.searchParams.set("route_mode", "ACCESSIBLE");
  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${env.KAKAO_REST_API_KEY ?? ""}` },
    signal: AbortSignal.timeout(8_000),
    // route_mode가 URL에 포함되어 모드별 캐시가 자연 분리된다(spec §캐시).
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`카카오 도보 경로 실패: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  return normalizeKakaoWalkRoute((await res.json()) as KakaoWalkResponse);
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run src/lib/providers/__tests__/kakao-walk.test.ts`
Expected: PASS 전건.

- [ ] **Step 6: 전체 게이트 후 커밋**

Run: `npm run test:run && npm run lint`
Expected: 전건 통과(기존 회귀 0).

```bash
git add src/lib/providers/kakao-walk.ts src/lib/providers/__tests__/kakao-walk.test.ts
git commit -m "feat(walk): 카카오 도보 provider 신설(fail-closed 정규화·pathCoords)" -- src/lib/providers/kakao-walk.ts src/lib/providers/__tests__/kakao-walk.test.ts src/lib/types.ts
```

---

### Task 2: walk-route 서비스 개정 (폴백 + stepFree + 안전 문장 + 주석 재캘리브레이션)

**Files:**
- Modify: `src/lib/walk-route.ts` (전면 개정)
- Modify: `src/lib/types.ts` (`WalkRouteBriefing`에 `stepFree` 추가)
- Modify: `src/lib/env.ts:138-140` 인근 (`hasWalkRouteKey` 신설)
- Test: `src/lib/__tests__/walk-route.test.ts` (확장)

**Interfaces:**
- Consumes: Task 1의 `getKakaoWalkBriefing`, 기존 `getWalkRouteBriefing`(tmap-pedestrian), `hasAudioSignalNear(lat, lng, radiusMeters)`(audio-signals), `hasKakaoKey`/`hasTmapKey`(env).
- Produces: `getWalkRoute(params: { origin: Coord; dest: Coord; accessible?: boolean }): Promise<WalkRouteBriefing | null>`, `type StepFreeStatus = "applied" | "no_stepfree_route" | "unavailable"`, `hasWalkRouteKey(): boolean`(env). Task 3·4가 이 이름들을 그대로 쓴다.

- [ ] **Step 1: 타입 확장**

`WalkRouteBriefing`에 옵트인 필드(미요청 시 부재 = 기존 응답 byte-호환):

```ts
/** 계단 회피(accessible) 요청 결과 상태 — accessible 요청 시에만 존재. */
export type StepFreeStatus = "applied" | "no_stepfree_route" | "unavailable";

export interface WalkRouteBriefing {
  distanceMeters: number;
  durationSeconds: number;
  steps: WalkRouteStep[];
  stepFree?: StepFreeStatus;
}
```

`env.ts`(hasTmapKey 아래):

```ts
/** 도보 길찾기 사용 가능 여부 — 기본 카카오, 폴백 Tmap. 어느 한쪽 키만 있어도 동작. */
export function hasWalkRouteKey(): boolean {
  return hasKakaoKey() || hasTmapKey();
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

기존 `src/lib/__tests__/walk-route.test.ts`의 annotate 테스트를 유지·확장하고 서비스 분기 테스트를 추가한다. provider·env는 `vi.mock`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../providers/kakao-walk", () => ({ getKakaoWalkBriefing: vi.fn() }));
vi.mock("../providers/tmap-pedestrian", () => ({ getWalkRouteBriefing: vi.fn() }));
vi.mock("../env", () => ({ hasKakaoKey: vi.fn(() => true), hasTmapKey: vi.fn(() => true) }));

import { getKakaoWalkBriefing } from "../providers/kakao-walk";
import { getWalkRouteBriefing } from "../providers/tmap-pedestrian";
import { hasKakaoKey, hasTmapKey } from "../env";
import { annotateAudioSignals, getWalkRoute } from "../walk-route";

const ORIGIN = { lat: 37.5385, lng: 127.1455 };
const DEST = { lat: 37.54, lng: 127.15 };
const KAKAO_BRIEFING = {
  distanceMeters: 1000,
  durationSeconds: 900,
  steps: [{ description: "강동역 2번 출구까지 역사 내 이동" }],
};
const TMAP_BRIEFING = {
  distanceMeters: 1100,
  durationSeconds: 950,
  steps: [{ description: "보행자도로를 따라 100m 이동" }],
};

beforeEach(() => {
  vi.mocked(getKakaoWalkBriefing).mockReset().mockResolvedValue(KAKAO_BRIEFING);
  vi.mocked(getWalkRouteBriefing).mockReset().mockResolvedValue(TMAP_BRIEFING);
  vi.mocked(hasKakaoKey).mockReturnValue(true);
  vi.mocked(hasTmapKey).mockReturnValue(true);
});

describe("getWalkRoute provider 선택·폴백", () => {
  it("카카오 키가 있으면 카카오가 기본이다", async () => {
    const r = await getWalkRoute({ origin: ORIGIN, dest: DEST });
    expect(r?.steps[0].description).toContain("역사 내 이동");
    expect(getWalkRouteBriefing).not.toHaveBeenCalled();
  });

  it("카카오 throw 시에만 Tmap 폴백한다", async () => {
    vi.mocked(getKakaoWalkBriefing).mockRejectedValue(new Error("HTTP 500"));
    const r = await getWalkRoute({ origin: ORIGIN, dest: DEST });
    expect(r?.steps[0].description).toContain("보행자도로");
  });

  it("카카오가 정상 판정한 경로 없음(null)은 폴백 없이 null", async () => {
    vi.mocked(getKakaoWalkBriefing).mockResolvedValue(null);
    expect(await getWalkRoute({ origin: ORIGIN, dest: DEST })).toBeNull();
    expect(getWalkRouteBriefing).not.toHaveBeenCalled();
  });

  it("카카오 키 없으면 Tmap 단독(현행 동작)", async () => {
    vi.mocked(hasKakaoKey).mockReturnValue(false);
    const r = await getWalkRoute({ origin: ORIGIN, dest: DEST });
    expect(r?.steps[0].description).toContain("보행자도로");
    expect(getKakaoWalkBriefing).not.toHaveBeenCalled();
  });

  it("둘 다 throw면 throw(502 전파)", async () => {
    vi.mocked(getKakaoWalkBriefing).mockRejectedValue(new Error("kakao down"));
    vi.mocked(getWalkRouteBriefing).mockRejectedValue(new Error("tmap down"));
    await expect(getWalkRoute({ origin: ORIGIN, dest: DEST })).rejects.toThrow();
  });

  it("카카오 throw + Tmap 키 없음이면 throw", async () => {
    vi.mocked(getKakaoWalkBriefing).mockRejectedValue(new Error("kakao down"));
    vi.mocked(hasTmapKey).mockReturnValue(false);
    await expect(getWalkRoute({ origin: ORIGIN, dest: DEST })).rejects.toThrow();
  });
});

describe("getWalkRoute 계단 회피(stepFree)", () => {
  it("ACCESSIBLE 성공(계단 문구 없음)은 applied — accessible 플래그가 provider에 전달된다", async () => {
    const r = await getWalkRoute({ origin: ORIGIN, dest: DEST, accessible: true });
    expect(vi.mocked(getKakaoWalkBriefing).mock.calls[0][0].accessible).toBe(true);
    expect(r?.stepFree).toBe("applied");
    expect(r?.steps[0].description).toContain("역사 내 이동"); // 안내 문장 미삽입
  });

  it("ACCESSIBLE 응답에 계단 guidance가 있으면 applied 금지(fail-closed)", async () => {
    vi.mocked(getKakaoWalkBriefing).mockResolvedValue({
      ...KAKAO_BRIEFING,
      steps: [{ description: "호텔마누 앞에서 계단이용" }],
    });
    const r = await getWalkRoute({ origin: ORIGIN, dest: DEST, accessible: true });
    expect(r?.stepFree).toBe("no_stepfree_route");
    expect(r?.steps[0].description).toContain("계단 없는 경로를 찾지 못해");
  });

  it("ACCESSIBLE 경로 없음이면 기본 모드 재호출 + no_stepfree_route + 안내 문장 삽입", async () => {
    vi.mocked(getKakaoWalkBriefing)
      .mockResolvedValueOnce(null) // ACCESSIBLE 호출
      .mockResolvedValueOnce(KAKAO_BRIEFING); // 기본 재호출
    const r = await getWalkRoute({ origin: ORIGIN, dest: DEST, accessible: true });
    expect(r?.stepFree).toBe("no_stepfree_route");
    expect(r?.steps[0].description).toContain("계단 없는 경로를 찾지 못해");
    expect(r?.steps[1].description).toContain("역사 내 이동");
  });

  it("카카오 throw면 Tmap 폴백 + unavailable + 안내 문장", async () => {
    vi.mocked(getKakaoWalkBriefing).mockRejectedValue(new Error("down"));
    const r = await getWalkRoute({ origin: ORIGIN, dest: DEST, accessible: true });
    expect(r?.stepFree).toBe("unavailable");
    expect(r?.steps[0].description).toContain("계단 회피 경로를 조회하지 못했습니다");
  });

  it("Tmap 단독 배포에 accessible 요청이면 unavailable", async () => {
    vi.mocked(hasKakaoKey).mockReturnValue(false);
    const r = await getWalkRoute({ origin: ORIGIN, dest: DEST, accessible: true });
    expect(r?.stepFree).toBe("unavailable");
  });

  it("기본 모드마저 경로 없음이면 null", async () => {
    vi.mocked(getKakaoWalkBriefing).mockResolvedValue(null);
    expect(await getWalkRoute({ origin: ORIGIN, dest: DEST, accessible: true })).toBeNull();
  });

  it("accessible 미요청이면 stepFree 필드 자체가 없다(기존 응답 byte-호환)", async () => {
    const r = await getWalkRoute({ origin: ORIGIN, dest: DEST });
    expect(r && "stepFree" in r).toBe(false);
  });
});
```

annotate 테스트 확장(기존 케이스 유지 + 신규):

```ts
// 기존 walk-route.test.ts의 annotateAudioSignals 케이스(hasAudioSignalNear mock 포함)는
// 그대로 두고 아래를 추가한다. hasAudioSignalNear는 기존 mock 방식 재사용.
describe("annotateAudioSignals 카카오 스텝(pathCoords)", () => {
  it("횡단보도 스텝은 pathCoords 후보점 중 하나라도 40m 내면 주석(첫 점이 멀어도 매칭)", () => {
    // hasAudioSignalNear mock: 두 번째 점만 true를 반환하도록 구성
  });
  it("수량 표현 병합 스텝('2개의 횡단보도 이용')은 seed가 가까워도 무주석", () => {});
  it("Tmap 단일 coord 스텝 기존 동작 회귀 0(coord 1원소 취급)", () => {});
  it("주석 후 coord·pathCoords 모두 제거된다", () => {});
});
```

(빈 화살표 함수 금지 — 실제 구현 시 각 케이스를 기존 테스트의 fixture 스타일로 채운다. `hasAudioSignalNear`를 mock하고 pathCoords 2점 스텝·`2개의 횡단보도 이용` 스텝·coord 단일 스텝을 넣어 위 단언을 각각 작성한다.)

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx vitest run src/lib/__tests__/walk-route.test.ts`
Expected: FAIL (신규 시그니처·stepFree 미구현).

- [ ] **Step 4: 서비스 구현**

`src/lib/walk-route.ts` 전면 개정:

```ts
import { getKakaoWalkBriefing } from "./providers/kakao-walk";
import { getWalkRouteBriefing } from "./providers/tmap-pedestrian";
import { hasAudioSignalNear } from "./providers/audio-signals";
import { hasKakaoKey, hasTmapKey } from "./env";
import type { Coord, StepFreeStatus, WalkRouteBriefing } from "./types";

/**
 * 도보 경로 서비스 진입점(라우트·채팅 공용 — provider 직접 호출 금지).
 * 기본 카카오, 카카오 throw 시에만 Tmap 폴백(spec 2026-07-29 위원장 판정).
 * 경로 없음(null)은 폴백하지 않는다: 폴백은 가용성 장치이지 커버리지 보강이 아니다.
 */

const ANNOTATION = "음향신호기 있음"; // 도보 경로는 V1 ko 전용 — i18n 키 불필요
const MATCH_RADIUS_METERS = 40;
/** "2개의 횡단보도 이용" 류 병합 스텝 — 어느 횡단보도인지 특정 불가라 주석 생략. */
const MERGED_CROSSWALK = /\d+개의/;

/** 계단 회피 미적용 시 브리핑 맨 앞에 삽입하는 안전 문장(모든 소비자 결정론 전달). */
const STEP_FREE_NOTICE: Record<Exclude<StepFreeStatus, "applied">, string> = {
  no_stepfree_route:
    "계단 없는 경로를 찾지 못해 일반 경로를 안내합니다. 계단이 포함될 수 있습니다.",
  unavailable:
    "계단 회피 경로를 조회하지 못했습니다. 일반 경로를 안내하며 계단이 포함될 수 있습니다.",
};

export function annotateAudioSignals(briefing: WalkRouteBriefing): WalkRouteBriefing {
  const steps = briefing.steps.map((step) => {
    const { coord, pathCoords, ...rest } = step;
    // 판정 후보점: 카카오 폴리라인 전체(재캘리브레이션 2026-07-29 — 첫 점만으로는
    // 진입 전 시작점이 신호기와 멀어 미탐) 또는 Tmap 단일 Point.
    const candidates = pathCoords ?? (coord ? [coord] : []);
    if (
      candidates.length > 0 &&
      rest.description.includes("횡단보도") &&
      !MERGED_CROSSWALK.test(rest.description) &&
      candidates.some((c) => hasAudioSignalNear(c.lat, c.lng, MATCH_RADIUS_METERS))
    ) {
      return { ...rest, description: `${rest.description}, ${ANNOTATION}` };
    }
    return rest;
  });
  return { ...briefing, steps };
}

/** 안전 문장을 스텝 0번에 삽입한다(기존 문장 개변 금지 — 별도 스텝). */
function withStepFree(
  briefing: WalkRouteBriefing,
  status: StepFreeStatus,
): WalkRouteBriefing {
  if (status === "applied") return { ...briefing, stepFree: status };
  return {
    ...briefing,
    stepFree: status,
    steps: [{ description: STEP_FREE_NOTICE[status] }, ...briefing.steps],
  };
}

/** 폴백 원인 로그 — Vercel 로그로 폴백률을 관측한다(파서 회귀 조기 발견). */
function logFallback(reason: unknown) {
  console.warn("[walk-route] 카카오 실패, Tmap 폴백:", reason);
}

async function fetchPrimaryOrFallback(params: {
  origin: Coord;
  dest: Coord;
  accessible: boolean;
}): Promise<{ briefing: WalkRouteBriefing | null; via: "kakao" | "tmap" } | null> {
  const { origin, dest, accessible } = params;
  if (hasKakaoKey()) {
    try {
      return { briefing: await getKakaoWalkBriefing({ origin, dest, accessible }), via: "kakao" };
    } catch (e) {
      if (!hasTmapKey()) throw e;
      logFallback(e);
      return { briefing: await getWalkRouteBriefing({ origin, dest }), via: "tmap" };
    }
  }
  if (hasTmapKey()) {
    return { briefing: await getWalkRouteBriefing({ origin, dest }), via: "tmap" };
  }
  return null; // 게이트(hasWalkRouteKey)가 먼저 막지만 이중 방어
}

export async function getWalkRoute(params: {
  origin: Coord;
  dest: Coord;
  accessible?: boolean;
}): Promise<WalkRouteBriefing | null> {
  const { origin, dest, accessible = false } = params;

  if (!accessible) {
    const r = await fetchPrimaryOrFallback({ origin, dest, accessible: false });
    return r?.briefing ? annotateAudioSignals(r.briefing) : null;
  }

  // 계단 회피: 카카오 전용. Tmap 경유(폴백·단독)는 동등 모드가 없어 unavailable.
  const r = await fetchPrimaryOrFallback({ origin, dest, accessible: true });
  if (!r) return null;
  if (r.via === "tmap") {
    return r.briefing ? withStepFree(annotateAudioSignals(r.briefing), "unavailable") : null;
  }
  if (r.briefing) {
    // applied fail-closed: ACCESSIBLE 응답에 계단 문구가 남아 있으면 안전 선언 금지.
    const hasStairs = r.briefing.steps.some((s) => s.description.includes("계단"));
    return withStepFree(
      annotateAudioSignals(r.briefing),
      hasStairs ? "no_stepfree_route" : "applied",
    );
  }
  // 무계단 경로 부재(ROUTE_RESULT_NOT_FOUND): 기본 모드 재호출(같은 fetch 캐시 공유).
  const base = await fetchPrimaryOrFallback({ origin, dest, accessible: false });
  if (!base?.briefing) return null;
  return withStepFree(
    annotateAudioSignals(base.briefing),
    base.via === "tmap" ? "unavailable" : "no_stepfree_route",
  );
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run src/lib/__tests__/walk-route.test.ts`
Expected: PASS 전건(기존 annotate 케이스 포함).

- [ ] **Step 6: 전체 게이트 후 커밋**

Run: `npm run test:run && npm run lint`

```bash
git commit -m "feat(walk): 서비스 폴백·stepFree 3-state·안전 문장·주석 재캘리브레이션" -- src/lib/walk-route.ts src/lib/types.ts src/lib/env.ts src/lib/__tests__/walk-route.test.ts
```

---

### Task 3: 소비자 연결 (라우트·게이트·채팅·카탈로그)

**Files:**
- Modify: `src/app/api/route/walk/route.ts` (accessible 파싱 + 게이트 교체)
- Modify: `src/app/[locale]/page.tsx:14,44` (`hasTmapKey` → `hasWalkRouteKey`)
- Modify: `src/lib/chat/declarations.ts:261-277` (게이트·accessible 파라미터)
- Modify: `src/lib/chat/router.ts:221-250` (게이트·accessible 전달)
- Modify: `packages/cli/src/endpoint-catalog-shared.ts:95` + `packages/mcp/src/endpoint-catalog-shared.ts` 동일 행 (両미러 동조)
- Test: `src/app/api/route/walk/__tests__/route.test.ts` (확장), `src/lib/chat/__tests__/router.test.ts`·`declarations.test.ts` (게이트 mock 교체)

**Interfaces:**
- Consumes: Task 2의 `getWalkRoute({origin, dest, accessible?})`·`hasWalkRouteKey()`.
- Produces: `/api/route/walk?origin=&dest=&accessible=true|false` HTTP 계약(오입력 400), 채팅 도구 `get_walk_route(destination, accessible?)`.

- [ ] **Step 1: 라우트 테스트 확장(실패 확인)**

`route.test.ts`의 `vi.mock("@/lib/env")`를 `hasWalkRouteKey`로 교체하고 추가:

```ts
it("accessible=true는 서비스에 전달된다", async () => {
  // getWalkRoute mock 호출 인자에 accessible: true 단언
});
it("accessible 오입력(1·yes·True)은 400 — 안전 옵션을 기본 모드로 조용히 강등하지 않는다", async () => {
  // ?accessible=1 요청 → 400 단언. "true"/"false"/부재만 허용.
});
it("키 없음(hasWalkRouteKey false)은 404 유지", async () => {});
```

- [ ] **Step 2: 라우트 구현**

`route.ts`: `hasTmapKey` import를 `hasWalkRouteKey`로 교체, zod 스키마 확장:

```ts
const querySchema = z.object({
  origin: coordSchema,
  dest: coordSchema,
  accessible: z
    .union([z.literal("true"), z.literal("false")])
    .nullable()
    .transform((v) => v === "true"),
});
// GET 내부: accessible: request.nextUrl.searchParams.get("accessible")
// (부재 null → false, "true"/"false" 외 값은 union 불일치로 400)
// getWalkRoute({ ...parsed.data })로 전달. 헤더 주석의 "Tmap" 서술을
// "기본 카카오·폴백 Tmap"으로 갱신.
```

- [ ] **Step 3: page.tsx·채팅 게이트 교체 + accessible 파라미터**

- `page.tsx`: `hasTmapKey` import·`canShowWalk={hasTmapKey()}`를 `hasWalkRouteKey`로 교체.
- `declarations.ts` get_walk_route 항목: `gate: hasWalkRouteKey`로 교체, 파라미터 추가:

```ts
accessible: {
  type: "boolean",
  description:
    "계단 회피·엘리베이터 경로를 명시 요청할 때만 true(예: '계단 없는 길로', '엘리베이터로 갈 수 있는 경로').",
},
```

- `router.ts` get_walk_route 케이스: 이중 방어 가드를 `hasWalkRouteKey()`로 교체, `const accessible = args.accessible === true;`를 `getWalkRoute({ origin: ctx.userLocation, dest: …, accessible })`로 전달. 반환 data에 `...(briefing.stepFree ? { stepFree: briefing.stepFree } : {})` 포함(안전 문장은 steps에 이미 삽입되어 있어 LLM 재량과 무관하게 전달됨 — 주석으로 명시).
- 카탈로그 両미러: `route-walk` 항목 설명을 "도보 경로 텍스트 브리핑(기본 카카오·폴백 Tmap, 완성 문장 안내)"로, 쿼리 파라미터에 `accessible`(optional, "true"/"false") 추가. cli·mcp 두 파일을 동일하게(drift 테스트가 강제).

- [ ] **Step 4: 전체 게이트 후 커밋**

Run: `npm run test:run && npm run lint && npm run build`
Expected: 전건 통과. 채팅 테스트의 `hasTmapKey` mock이 남아 있으면 함께 교체.

```bash
git commit -m "feat(walk): 라우트·채팅·카탈로그에 계단 회피 옵션 연결, 게이트 hasWalkRouteKey 통일" -- src/app/api/route/walk/route.ts src/app/api/route/walk/__tests__/route.test.ts "src/app/[locale]/page.tsx" src/lib/chat/declarations.ts src/lib/chat/router.ts src/lib/chat/__tests__ packages/cli/src/endpoint-catalog-shared.ts packages/mcp/src/endpoint-catalog-shared.ts
```

---

### Task 4: 웹 UI 계단 회피 토글 (DirectionsView)

**Files:**
- Modify: `src/components/DirectionsView.tsx` (도보 수단 토글·재조회·URL 동기화)
- Modify: `messages/ko.json`·`en.json`·`es.json`·`fr.json`·`it.json`·`ja.json` (토글 라벨 키 — i18n-messages.test.ts가 전 로케일 일치를 강제)
- Test: 컴포넌트 와이어링 레인 없음(repo 관례) — `npm run lint`·`npm run build` + Task 5 실호출이 게이트

**Interfaces:**
- Consumes: `/api/route/walk?…&accessible=true`(Task 3), `WalkRouteBriefing.stepFree`(표시는 불필요 — 안전 문장이 steps에 이미 있음).
- Produces: `?dir=`에 accessible 토큰(기존 직렬화 규칙에 1필드 추가).

- [ ] **Step 1: 토글 구현**

- 도보 수단 패널에 버튼 1개: 라벨 `pedestrian.stepFreeToggle` = ko "계단 없는 경로"(en "Step-free route", 나머지 로케일 각 언어 번역). 도보는 ko 전용 노출(`canShowWalk && !prefersEnglish`)이라 실표시는 ko뿐이지만 키는 전 로케일 필수.
- 토글은 `aria-pressed` 버튼(`disabled` 금지 — `aria-disabled`+가드 관례), 상태 변경 시 도보 경로만 재조회(`accessible` 쿼리 부착).
- **stale 방어**: DirectionsView의 기존 요청 무효화 패턴(모드별 재조회 시 이전 응답 폐기)에 accessible 상태를 포함 — 토글 연타 시 늦게 도착한 반대 모드 응답이 화면을 덮지 않도록 요청 시점 상태와 응답 대조 후 불일치면 폐기. 구현은 기존 파일의 재조회 흐름(fetchOutcome·request 관리)을 따르되, 토글 상태를 요청 키에 넣는다.
- 결과 표시는 기존 `WalkRouteResult` 그대로(안전 문장이 브리핑 steps[0]로 이미 낭독됨 — 별도 표기·별도 live region 신설 금지).
- `?dir=` 직렬화에 accessible 토큰 추가(예: 기존 토큰 뒤 `walkAccessible=1`은 켜짐일 때만 — 스키마는 기존 직렬화 코드 규칙에 맞춤). 복원 시 토글 상태와 조회 모드가 일치해야 한다.

- [ ] **Step 2: 게이트 후 커밋**

Run: `npm run test:run && npm run lint && npm run build`

```bash
git commit -m "feat(walk): 길찾기 도보에 계단 없는 경로 토글" -- src/components/DirectionsView.tsx messages/ko.json messages/en.json messages/es.json messages/fr.json messages/it.json messages/ja.json
```

---

### Task 5: 배포·실호출 검증·문서 (컨트롤러 직접 — 서브에이전트 dispatch 아님)

**Files:**
- Modify: `CLAUDE.md` (통합 카탈로그 도보 행·API 키 표 갱신), `PROGRESS.md` (검증 로그)
- 점검: 웹 `src/app/[locale]/privacy` 카피·`ios/Gildongmu/PrivacyInfo.xcprivacy`·`docs/appstore/1.0-submission-draft.md` §7 (위치정보 전송 목적 서술)

- [ ] **Step 1: privacy 3면 점검** — 카카오 전송 목적이 "장소 검색·자동차 길찾기" 식으로 한정 서술돼 있으면 도보 경로 목적을 3면 동시 추가, provider 한정 서술이 없으면 변경 0으로 기록.
- [ ] **Step 2: push(자동 배포) 후 prod 실호출 5종** — spec §테스트·검증 계획의 머지 게이트 항목(기본 문체·ACCESSIBLE applied/no_stepfree_route·안내 문장·TOO_FAR_AWAY null·주석 규칙 적용 확인).
- [ ] **Step 3: 폴백 로컬 실증** — 카카오 키 무효화 로컬 기동으로 Tmap 폴백+로그 확인 후 원복.
- [ ] **Step 4: 카카오 콘솔 유료 전환 여부 확인** — 미신청이면 그대로(비용 상한 0원 성립), 신청돼 있으면 위원장에게 해제 여부 확인(하드 스톱).
- [ ] **Step 5: CLAUDE.md·PROGRESS.md 갱신 + `python3 sync_agent_docs.py` + 커밋·push.**

---

## Self-Review

- Spec coverage: provider(T1)·fail-closed(T1)·폴백/타임아웃/로그(T2)·stepFree 표 6행(T2)·안전 문장(T2)·주석 재캘리브레이션 반영(T2)·엄격 파싱(T3)·게이트 통일(T3)·채팅 긍정 트리거(T3)·카탈로그 미러(T3)·토글/stale/URL(T4)·privacy·prod 게이트·유료 전환 확인(T5). 캐시는 provider fetch 단위(T1 revalidate)로 커버.
- 타입 일관성: `getKakaoWalkBriefing`·`getWalkRoute`·`hasWalkRouteKey`·`StepFreeStatus` 명칭이 태스크 간 동일.
- iOS: 스키마 옵트인이라 이번 플랜 범위 밖(변경 0, 문체 개선 즉시 수혜) — spec §UI 확정사항.
