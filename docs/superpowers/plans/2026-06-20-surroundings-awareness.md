# 내 주변 둘러보기 (기능 A) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 현재 위치 반경 내 상점·시설·랜드마크를 카카오 카테고리 검색으로 받아 **거리 + 북 기준 8방위 방향**과 함께 낭독하는 "내 주변 둘러보기" 섹션을 홈에 추가한다(BlindSquare식 상시 인지).

**Architecture:** kids-places 패턴 차용 — 카카오 로컬 **카테고리 검색**(`category_group_code` 8종) 좌표 근접 병렬 호출 → dedupe·거리순·cap. 신규 핵심은 두 좌표 간 **방위각 순수 함수**(`bearing.ts`)로 방향 라벨 산출. 신규 API·키 0개(기존 `KAKAO_REST_API_KEY` 재사용).

**Tech Stack:** Next.js 16(App Router), TypeScript, zod 4, next-intl 4, Vitest 4, Tailwind.

## Global Constraints

- `src/lib/`는 React/Next 비의존(dodo-planet 이식성). `bearing.ts`·`surroundings.ts`는 순수.
- 좌표 WGS84 십진. 카카오 `x`=경도·`y`=위도. 거리는 카카오 `distance`(m) 정본, 누락 시 haversine 폴백.
- **방향은 북 기준 8방위**(heading 미보유 — "2시 방향" 식 정면-상대 표기 금지). spec §5-4.
- 부분 실패 불변식: `Promise.allSettled`, 일부 실패해도 보존, **전부 실패만 throw→502**("조회 실패"≠"주변 없음").
- **mock 폴백 없음**(가짜 실데이터 금지). 키 없음→빈 배열·섹션 미노출.
- a11y: 정보 정본 텍스트, 단일 polite `aria-live`, 자기완결 li, 과잉 ARIA 금지. 터치 타깃 `min-h-11`.
- 카카오 장소명은 한국어 → `lang="ko"`. 카테고리·방위 라벨은 i18n 5개 언어.
- i18n 키는 5개 로케일(ko·en·es·fr·it) 동일 집합 필수(`i18n-messages.test.ts` 게이트).
- 커밋 이메일 `engccer@gmail.com`. 기능+테스트 같은 커밋.

---

### Task 1: 방위·거리 순수 함수 (`bearing.ts`)

**Files:**
- Create: `src/lib/geo/bearing.ts`
- Test: `src/lib/geo/__tests__/bearing.test.ts`

**Interfaces:**
- Produces:
  - `type CompassDirection = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw"`
  - `bearingDegrees(fromLat: number, fromLng: number, toLat: number, toLng: number): number` — 0~360, 북=0 시계방향.
  - `bearingToCompass8(degrees: number): CompassDirection`
  - `haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/geo/__tests__/bearing.test.ts
import { describe, it, expect } from "vitest";
import {
  bearingDegrees,
  bearingToCompass8,
  haversineMeters,
} from "../bearing";

describe("bearingDegrees (북=0, 시계방향)", () => {
  const O = { lat: 37.5, lng: 127.0 };
  it("정북(위도 증가) → ~0도", () => {
    expect(bearingDegrees(O.lat, O.lng, 37.51, 127.0)).toBeCloseTo(0, 0);
  });
  it("정동(경도 증가) → ~90도", () => {
    expect(bearingDegrees(O.lat, O.lng, 37.5, 127.01)).toBeCloseTo(90, 0);
  });
  it("정남(위도 감소) → ~180도", () => {
    expect(bearingDegrees(O.lat, O.lng, 37.49, 127.0)).toBeCloseTo(180, 0);
  });
  it("정서(경도 감소) → ~270도", () => {
    expect(bearingDegrees(O.lat, O.lng, 37.5, 126.99)).toBeCloseTo(270, 0);
  });
});

describe("bearingToCompass8", () => {
  it.each([
    [0, "n"], [44, "n"], [45, "ne"], [90, "e"], [135, "se"],
    [180, "s"], [225, "sw"], [270, "w"], [315, "nw"], [359, "n"],
  ])("%i도 → %s", (deg, dir) => {
    expect(bearingToCompass8(deg as number)).toBe(dir);
  });
  it("음수·360+ 정규화", () => {
    expect(bearingToCompass8(-45)).toBe("nw");
    expect(bearingToCompass8(405)).toBe("ne");
  });
});

describe("haversineMeters", () => {
  it("동일 좌표 → 0", () => {
    expect(haversineMeters(37.5, 127.0, 37.5, 127.0)).toBeCloseTo(0, 0);
  });
  it("위도 0.01도(~1.1km) → 1000~1200m", () => {
    const d = haversineMeters(37.5, 127.0, 37.51, 127.0);
    expect(d).toBeGreaterThan(1000);
    expect(d).toBeLessThan(1200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/lib/geo/__tests__/bearing.test.ts`
Expected: FAIL (`Cannot find module '../bearing'`)

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/geo/bearing.ts
/**
 * 두 WGS84 좌표 간 방위·거리 순수 함수(React/Next 비의존).
 *
 * 방위는 **북 기준 8방위**다. 사용자가 바라보는 방향(heading)은 모르므로
 * "2시 방향" 같은 정면-상대 표기를 쓰지 않는다(spec §5-4) — 방위는 본질적으로
 * 북 기준이라 오해 여지가 없다. BlindSquare식 "내 주변" 방향 안내의 정본.
 */

export type CompassDirection = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** from→to 방위각(0~360, 북=0, 동=90). */
export function bearingDegrees(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): number {
  const phi1 = toRad(fromLat);
  const phi2 = toRad(toLat);
  const dLambda = toRad(toLng - fromLng);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** 방위각 → 8방위(45도 단위 반올림). 음수·360+ 정규화. */
export function bearingToCompass8(degrees: number): CompassDirection {
  const dirs: CompassDirection[] = [
    "n", "ne", "e", "se", "s", "sw", "w", "nw",
  ];
  const norm = ((degrees % 360) + 360) % 360;
  return dirs[Math.round(norm / 45) % 8];
}

/** Haversine 거리(m). 카카오 distance 누락 시 폴백. */
export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const dPhi = toRad(lat2 - lat1);
  const dLambda = toRad(lng2 - lng1);
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLambda / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/lib/geo/__tests__/bearing.test.ts`
Expected: PASS (all)

- [ ] **Step 5: Commit**

```bash
git add src/lib/geo/bearing.ts src/lib/geo/__tests__/bearing.test.ts
git commit -m "feat(geo): 두 좌표 간 방위(8방위)·거리 순수 함수 추가"
```

---

### Task 2: 타입 + surroundings provider (`surroundings.ts`)

**Files:**
- Modify: `src/lib/types.ts` (끝에 추가)
- Create: `src/lib/providers/surroundings.ts`
- Create: `src/lib/__tests__/fixtures/kakao-around.json`
- Test: `src/lib/__tests__/surroundings.test.ts`

**Interfaces:**
- Consumes: `bearingDegrees`, `bearingToCompass8`, `haversineMeters`, `CompassDirection` (Task 1); `env.KAKAO_REST_API_KEY`.
- Produces:
  - `type SurroundingCategory = "convenience" | "subway" | "restaurant" | "cafe" | "bank" | "pharmacy" | "hospital" | "mart" | "public" | "attraction"`
  - `interface SurroundingPlace { id; name; category: SurroundingCategory; categoryRaw: string; distanceMeters: number; bearing: CompassDirection; lat; lng; phone?; link? }`
  - `normalizeSurroundingDoc(doc, userLat, userLng): SurroundingPlace | null`
  - `rankSurroundings(docLists: KakaoCatDoc[][], userLat, userLng, cap): SurroundingPlace[]`
  - `findSurroundingsNear(lat, lng): Promise<SurroundingPlace[]>`

- [ ] **Step 1: 타입 추가 (types.ts 끝에)**

```ts
// src/lib/types.ts 끝에 추가
import type { CompassDirection } from "./geo/bearing";

/** 내 주변 둘러보기(기능 A) 카테고리 — 카카오 category_group_code 매핑. */
export type SurroundingCategory =
  | "convenience"
  | "subway"
  | "restaurant"
  | "cafe"
  | "bank"
  | "pharmacy"
  | "hospital"
  | "mart"
  | "public"
  | "attraction";

/**
 * 내 주변 둘러보기 결과 1건 — 카카오 카테고리 검색 좌표 근접.
 * 거리는 카카오 `distance`(m) 정본, 방향은 두 좌표 간 북 기준 8방위(우리가 산출).
 */
export interface SurroundingPlace {
  id: string;
  name: string;
  category: SurroundingCategory;
  /** 카카오 category_name 전체 계층(보조 표시) */
  categoryRaw: string;
  distanceMeters: number;
  bearing: CompassDirection;
  lat: number;
  lng: number;
  phone?: string;
  link?: string;
}
```

- [ ] **Step 2: fixture 작성**

```json
// src/lib/__tests__/fixtures/kakao-around.json
{
  "convenience": [
    {
      "id": "1001",
      "place_name": "GS25 길동점",
      "category_name": "가정,생활 > 편의점 > GS25",
      "category_group_code": "CS2",
      "phone": "02-111-1111",
      "x": "127.14035",
      "y": "37.53760",
      "place_url": "http://place.map.kakao.com/1001",
      "distance": "40"
    },
    {
      "id": "1002",
      "place_name": "CU 길동중앙점",
      "category_name": "가정,생활 > 편의점 > CU",
      "category_group_code": "CS2",
      "x": "127.13900",
      "y": "37.53850",
      "place_url": "http://place.map.kakao.com/1002",
      "distance": "120"
    }
  ],
  "subway": [
    {
      "id": "2001",
      "place_name": "길동역 5호선",
      "category_name": "교통,수송 > 지하철,전철 > 수도권5호선",
      "category_group_code": "SW8",
      "x": "127.13994",
      "y": "37.53785",
      "place_url": "http://place.map.kakao.com/2001",
      "distance": "15"
    }
  ],
  "dupOfConvenience": [
    {
      "id": "1001",
      "place_name": "GS25 길동점",
      "category_name": "가정,생활 > 편의점 > GS25",
      "category_group_code": "CS2",
      "x": "127.14035",
      "y": "37.53760",
      "distance": "40"
    }
  ]
}
```

- [ ] **Step 3: Write the failing test**

```ts
// src/lib/__tests__/surroundings.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import fixture from "./fixtures/kakao-around.json";

vi.mock("../env", () => ({
  env: { KAKAO_REST_API_KEY: "test-key" },
  hasKakaoKey: () => true,
}));

import {
  normalizeSurroundingDoc,
  rankSurroundings,
  findSurroundingsNear,
} from "../providers/surroundings";

const USER = { lat: 37.5378, lng: 127.1399 };

describe("normalizeSurroundingDoc", () => {
  it("CS2 → convenience, 거리·방위 산출", () => {
    const r = normalizeSurroundingDoc(fixture.convenience[0], USER.lat, USER.lng);
    expect(r).not.toBeNull();
    expect(r!.category).toBe("convenience");
    expect(r!.id).toBe("kakao-1001");
    expect(r!.distanceMeters).toBe(40);
    expect(["n","ne","e","se","s","sw","w","nw"]).toContain(r!.bearing);
    expect(r!.name).toBe("GS25 길동점");
  });

  it("SW8 → subway", () => {
    const r = normalizeSurroundingDoc(fixture.subway[0], USER.lat, USER.lng);
    expect(r!.category).toBe("subway");
  });

  it("매핑 안 된 group code → null(거짓양성 차단)", () => {
    const unknown = { ...fixture.convenience[0], category_group_code: "ZZ9" };
    expect(normalizeSurroundingDoc(unknown, USER.lat, USER.lng)).toBeNull();
  });

  it("distance 누락 → haversine 폴백(>0)", () => {
    const noDist = { ...fixture.subway[0], distance: undefined };
    const r = normalizeSurroundingDoc(noDist, USER.lat, USER.lng);
    expect(r!.distanceMeters).toBeGreaterThan(0);
  });
});

describe("rankSurroundings", () => {
  it("dedupe(id)·거리순·cap", () => {
    const out = rankSurroundings(
      [fixture.convenience, fixture.subway, fixture.dupOfConvenience],
      USER.lat, USER.lng, 10,
    );
    const ids = out.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length); // dedupe
    expect(ids).toContain("kakao-2001");
    // 거리 오름차순
    for (let i = 1; i < out.length; i++) {
      expect(out[i].distanceMeters).toBeGreaterThanOrEqual(out[i - 1].distanceMeters);
    }
  });

  it("cap 적용", () => {
    const out = rankSurroundings([fixture.convenience, fixture.subway], USER.lat, USER.lng, 1);
    expect(out).toHaveLength(1);
  });
});

describe("findSurroundingsNear (부분 실패 불변식)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("일부 카테고리 실패해도 나머지 보존", async () => {
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      call++;
      if (call % 2 === 0) throw new Error("network");
      return { ok: true, json: async () => ({ documents: fixture.convenience }) } as Response;
    }));
    const out = await findSurroundingsNear(USER.lat, USER.lng);
    expect(out.length).toBeGreaterThan(0);
  });

  it("전부 실패 → throw", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    await expect(findSurroundingsNear(USER.lat, USER.lng)).rejects.toThrow();
  });

  it("키 없으면 [] (env 재모킹)", async () => {
    vi.resetModules();
    vi.doMock("../env", () => ({ env: { KAKAO_REST_API_KEY: "" }, hasKakaoKey: () => false }));
    const mod = await import("../providers/surroundings");
    const out = await mod.findSurroundingsNear(USER.lat, USER.lng);
    expect(out).toEqual([]);
    vi.doUnmock("../env");
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test:run -- src/lib/__tests__/surroundings.test.ts`
Expected: FAIL (`Cannot find module '../providers/surroundings'`)

- [ ] **Step 5: Write implementation**

```ts
// src/lib/providers/surroundings.ts
import { env } from "../env";
import { bearingDegrees, bearingToCompass8, haversineMeters } from "../geo/bearing";
import type { SurroundingCategory, SurroundingPlace } from "../types";

/**
 * 내 주변 둘러보기(기능 A) provider — 카카오 로컬 **카테고리 검색** 좌표 근접.
 *
 * 신규 API·게이트 없음(기존 KAKAO_REST_API_KEY). kids-places가 키워드+화이트리스트로
 * 거짓양성을 걸렀다면, 이쪽은 `category_group_code`로 검색 자체가 카테고리 정제돼
 * 노이즈가 적다. 신규 핵심은 두 좌표 간 **북 기준 8방위 방향**(bearing.ts) 산출 —
 * BlindSquare식 "어느 쪽에 뭐가 있나" 상시 인지. 설계 `docs/.../2026-06-20-surroundings-awareness-design.md`.
 */

const ENDPOINT = "https://dapi.kakao.com/v2/local/search/category.json";
const RADIUS_METERS = 500; // 도보 즉시권 "둘러보기"
const RESULT_CAP = 12;

/** 카카오 category_group_code → 우리 카테고리. 여기 없는 코드는 거부(null). */
const CATEGORY_GROUPS: Record<string, SurroundingCategory> = {
  CS2: "convenience",
  SW8: "subway",
  FD6: "restaurant",
  CE7: "cafe",
  BK9: "bank",
  PM9: "pharmacy",
  HP8: "hospital",
  MT1: "mart",
  PO3: "public",
  AT4: "attraction",
};

export interface KakaoCatDoc {
  id: string;
  place_name: string;
  category_name: string;
  category_group_code: string;
  phone?: string;
  x: string;
  y: string;
  place_url?: string;
  distance?: string;
}

function numOrNaN(v: unknown): number {
  if (v == null) return NaN;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : NaN;
}

/** doc → SurroundingPlace. group code 미매핑 시 null(거짓양성 차단). */
export function normalizeSurroundingDoc(
  doc: KakaoCatDoc,
  userLat: number,
  userLng: number,
): SurroundingPlace | null {
  const category = CATEGORY_GROUPS[doc.category_group_code];
  if (!category) return null;
  const lat = Number(doc.y);
  const lng = Number(doc.x);
  const kakaoDist = numOrNaN(doc.distance);
  const distanceMeters = Number.isNaN(kakaoDist)
    ? Math.round(haversineMeters(userLat, userLng, lat, lng))
    : kakaoDist;
  const bearing = bearingToCompass8(bearingDegrees(userLat, userLng, lat, lng));
  return {
    id: `kakao-${doc.id}`,
    name: doc.place_name,
    category,
    categoryRaw: doc.category_name ?? "",
    distanceMeters,
    bearing,
    lat,
    lng,
    phone: doc.phone || undefined,
    link: doc.place_url || undefined,
  };
}

/** 여러 카테고리 응답 → dedupe(id)·거리순·cap. */
export function rankSurroundings(
  docLists: KakaoCatDoc[][],
  userLat: number,
  userLng: number,
  cap: number,
): SurroundingPlace[] {
  const byId = new Map<string, SurroundingPlace>();
  for (const list of docLists) {
    for (const doc of list) {
      const p = normalizeSurroundingDoc(doc, userLat, userLng);
      if (!p) continue;
      if (!byId.has(p.id)) byId.set(p.id, p);
    }
  }
  return [...byId.values()]
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, cap);
}

async function fetchKakaoCategory(
  code: string,
  lat: number,
  lng: number,
): Promise<KakaoCatDoc[]> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("category_group_code", code);
  url.searchParams.set("x", String(lng));
  url.searchParams.set("y", String(lat));
  url.searchParams.set("radius", String(RADIUS_METERS));
  url.searchParams.set("sort", "distance");
  url.searchParams.set("size", "15");
  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${env.KAKAO_REST_API_KEY}` },
    // 주변 시설은 분 단위로 생멸하지 않음 → 동일 좌표 재방문 시 카카오 호출 절감
    // (kids-places 300초 좌표-키 캐시 동형, 버스/지하철 no-store와 구분).
    next: { revalidate: 300 },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`주변 검색 실패(${code}): HTTP ${res.status} ${body}`);
  }
  const data = (await res.json()) as { documents?: KakaoCatDoc[] };
  return Array.isArray(data?.documents) ? data.documents : [];
}

/**
 * 좌표 → 내 주변 시설(카테고리 8종 병렬 병합). 키 없으면 [].
 * 부분 실패 불변식(kids-places 동형): 일부 실패 보존, 전부 실패만 throw→502.
 */
export async function findSurroundingsNear(
  lat: number,
  lng: number,
): Promise<SurroundingPlace[]> {
  if (!env.KAKAO_REST_API_KEY) return [];
  const codes = Object.keys(CATEGORY_GROUPS);
  const settled = await Promise.allSettled(
    codes.map((c) => fetchKakaoCategory(c, lat, lng)),
  );
  const lists: KakaoCatDoc[][] = [];
  let anyFulfilled = false;
  for (const s of settled) {
    if (s.status === "fulfilled") {
      anyFulfilled = true;
      lists.push(s.value);
    }
  }
  if (!anyFulfilled) {
    const firstRej = settled.find(
      (s): s is PromiseRejectedResult => s.status === "rejected",
    );
    throw new Error(`주변 조회 실패: ${firstRej?.reason ?? "모든 카테고리 실패"}`);
  }
  return rankSurroundings(lists, lat, lng, RESULT_CAP);
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test:run -- src/lib/__tests__/surroundings.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/types.ts src/lib/providers/surroundings.ts src/lib/__tests__/surroundings.test.ts src/lib/__tests__/fixtures/kakao-around.json
git commit -m "feat(surroundings): 카카오 카테고리 검색 좌표근접 provider(방위 포함)"
```

---

### Task 3: API 라우트 (`/api/places/around`)

**Files:**
- Create: `src/app/api/places/around/route.ts`

**Interfaces:**
- Consumes: `findSurroundingsNear` (Task 2), `hasKakaoKey` (env).
- Produces: `GET /api/places/around?lat&lng` → `{ places: SurroundingPlace[] }` | `{ error }`(400/502).

- [ ] **Step 1: Write implementation**

```ts
// src/app/api/places/around/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasKakaoKey } from "@/lib/env";
import { findSurroundingsNear } from "@/lib/providers/surroundings";

/**
 * GET /api/places/around?lat=..&lng=..
 * 내 주변 둘러보기(기능 A) — 카카오 카테고리 8종 좌표 근접 병합, 거리·방위 포함.
 * 키 없음 → { places: [] }(canShowSurroundings 게이트와 이중 방어).
 * upstream 전부 실패 → 502. 빈 결과 → [] graceful.
 */

export const dynamic = "force-dynamic";

const querySchema = z.object({
  lat: z.coerce.number().min(33).max(43),
  lng: z.coerce.number().min(124).max(132),
});

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({
    lat: request.nextUrl.searchParams.get("lat") ?? "",
    lng: request.nextUrl.searchParams.get("lng") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "잘못된 요청" },
      { status: 400 },
    );
  }
  if (!hasKakaoKey()) {
    return NextResponse.json({ places: [] });
  }
  try {
    const places = await findSurroundingsNear(parsed.data.lat, parsed.data.lng);
    return NextResponse.json({ places });
  } catch (e) {
    console.error("[api/places/around]", e);
    return NextResponse.json({ error: "주변 정보 조회 실패" }, { status: 502 });
  }
}
```

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: Commit**

```bash
git add src/app/api/places/around/route.ts
git commit -m "feat(api): /api/places/around 내 주변 둘러보기 라우트"
```

---

### Task 4: i18n 메시지 (5개 로케일)

**Files:**
- Modify: `messages/ko.json`, `messages/en.json`, `messages/es.json`, `messages/fr.json`, `messages/it.json`

**Interfaces:**
- Produces: 각 파일에 `surroundingsNearby` 객체. 키 집합 5개 로케일 동일(`i18n-messages.test.ts` 게이트).

- [ ] **Step 1: ko.json에 추가(최상위 객체에 `surroundingsNearby` 키)**

```jsonc
"surroundingsNearby": {
  "button": "내 주변 둘러보기",
  "refresh": "새로고침",
  "locating": "현재 위치 확인 중…",
  "loading": "내 주변 시설 조회 중…",
  "empty": "주변에 안내할 시설이 없습니다.",
  "error": "주변 조회에 실패했습니다. 잠시 후 다시 시도해 주세요.",
  "ready": "내 주변 시설입니다.",
  "asOf": "{time} 기준",
  "item": "{category} · {direction}쪽 · 약 {distance}",
  "category": {
    "convenience": "편의점", "subway": "지하철역", "restaurant": "음식점",
    "cafe": "카페", "bank": "은행", "pharmacy": "약국", "hospital": "병원",
    "mart": "마트", "public": "공공기관", "attraction": "관광명소"
  },
  "direction": {
    "n": "북", "ne": "북동", "e": "동", "se": "남동",
    "s": "남", "sw": "남서", "w": "서", "nw": "북서"
  },
  "call": "전화하기",
  "mapLink": "카카오맵에서 보기",
  "geoDenied": "현재 위치 권한이 필요합니다. 브라우저에서 위치 접근을 허용해 주세요.",
  "geoUnsupported": "이 브라우저는 현재 위치를 지원하지 않습니다.",
  "source": "출처: 카카오맵 장소 검색. 방향은 북 기준 방위입니다."
}
```

- [ ] **Step 2: en.json에 추가**

```jsonc
"surroundingsNearby": {
  "button": "Explore nearby", "refresh": "Refresh",
  "locating": "Getting your location…", "loading": "Finding places nearby…",
  "empty": "No places to announce nearby.",
  "error": "Could not load nearby places. Please try again.",
  "ready": "Places near you.", "asOf": "as of {time}",
  "item": "{category} · {direction} · about {distance}",
  "category": {
    "convenience": "convenience store", "subway": "subway station",
    "restaurant": "restaurant", "cafe": "cafe", "bank": "bank",
    "pharmacy": "pharmacy", "hospital": "hospital", "mart": "supermarket",
    "public": "public office", "attraction": "attraction"
  },
  "direction": {
    "n": "N", "ne": "NE", "e": "E", "se": "SE",
    "s": "S", "sw": "SW", "w": "W", "nw": "NW"
  },
  "call": "Call", "mapLink": "View on Kakao Map",
  "geoDenied": "Location permission is required. Please allow location access in your browser.",
  "geoUnsupported": "This browser does not support location.",
  "source": "Source: Kakao Map place search. Direction is a compass bearing (from North)."
}
```

- [ ] **Step 3: es.json에 추가**

```jsonc
"surroundingsNearby": {
  "button": "Explorar alrededores", "refresh": "Actualizar",
  "locating": "Obteniendo tu ubicación…", "loading": "Buscando lugares cercanos…",
  "empty": "No hay lugares que anunciar cerca.",
  "error": "No se pudieron cargar los lugares cercanos. Inténtalo de nuevo.",
  "ready": "Lugares cerca de ti.", "asOf": "a las {time}",
  "item": "{category} · {direction} · unos {distance}",
  "category": {
    "convenience": "tienda de conveniencia", "subway": "estación de metro",
    "restaurant": "restaurante", "cafe": "cafetería", "bank": "banco",
    "pharmacy": "farmacia", "hospital": "hospital", "mart": "supermercado",
    "public": "oficina pública", "attraction": "atracción"
  },
  "direction": {
    "n": "N", "ne": "NE", "e": "E", "se": "SE",
    "s": "S", "sw": "SO", "w": "O", "nw": "NO"
  },
  "call": "Llamar", "mapLink": "Ver en Kakao Map",
  "geoDenied": "Se requiere permiso de ubicación. Permite el acceso a la ubicación en tu navegador.",
  "geoUnsupported": "Este navegador no admite la ubicación.",
  "source": "Fuente: búsqueda de lugares de Kakao Map. La dirección es un rumbo (desde el norte)."
}
```

- [ ] **Step 4: fr.json에 추가**

```jsonc
"surroundingsNearby": {
  "button": "Explorer les environs", "refresh": "Actualiser",
  "locating": "Localisation en cours…", "loading": "Recherche de lieux à proximité…",
  "empty": "Aucun lieu à signaler à proximité.",
  "error": "Impossible de charger les lieux proches. Veuillez réessayer.",
  "ready": "Lieux près de vous.", "asOf": "à {time}",
  "item": "{category} · {direction} · environ {distance}",
  "category": {
    "convenience": "supérette", "subway": "station de métro",
    "restaurant": "restaurant", "cafe": "café", "bank": "banque",
    "pharmacy": "pharmacie", "hospital": "hôpital", "mart": "supermarché",
    "public": "service public", "attraction": "attraction"
  },
  "direction": {
    "n": "N", "ne": "NE", "e": "E", "se": "SE",
    "s": "S", "sw": "SO", "w": "O", "nw": "NO"
  },
  "call": "Appeler", "mapLink": "Voir sur Kakao Map",
  "geoDenied": "L'autorisation de localisation est requise. Veuillez l'autoriser dans votre navigateur.",
  "geoUnsupported": "Ce navigateur ne prend pas en charge la localisation.",
  "source": "Source : recherche de lieux Kakao Map. La direction est un cap (depuis le nord)."
}
```

- [ ] **Step 5: it.json에 추가**

```jsonc
"surroundingsNearby": {
  "button": "Esplora dintorni", "refresh": "Aggiorna",
  "locating": "Rilevamento posizione…", "loading": "Ricerca luoghi nelle vicinanze…",
  "empty": "Nessun luogo da segnalare nelle vicinanze.",
  "error": "Impossibile caricare i luoghi vicini. Riprova.",
  "ready": "Luoghi vicino a te.", "asOf": "alle {time}",
  "item": "{category} · {direction} · circa {distance}",
  "category": {
    "convenience": "minimarket", "subway": "stazione della metro",
    "restaurant": "ristorante", "cafe": "caffè", "bank": "banca",
    "pharmacy": "farmacia", "hospital": "ospedale", "mart": "supermercato",
    "public": "ufficio pubblico", "attraction": "attrazione"
  },
  "direction": {
    "n": "N", "ne": "NE", "e": "E", "se": "SE",
    "s": "S", "sw": "SO", "w": "O", "nw": "NO"
  },
  "call": "Chiama", "mapLink": "Vedi su Kakao Map",
  "geoDenied": "È richiesta l'autorizzazione alla posizione. Consenti l'accesso nel browser.",
  "geoUnsupported": "Questo browser non supporta la geolocalizzazione.",
  "source": "Fonte: ricerca luoghi Kakao Map. La direzione è un rilevamento (dal nord)."
}
```

- [ ] **Step 6: i18n 키 정합 게이트**

Run: `npm run test:run -- i18n-messages`
Expected: PASS(5개 로케일 키 집합·ICU 플레이스홀더 동일)

- [ ] **Step 7: Commit**

```bash
git add messages/ko.json messages/en.json messages/es.json messages/fr.json messages/it.json
git commit -m "feat(i18n): surroundingsNearby 5개 언어 메시지"
```

---

### Task 5: UI 컴포넌트 (`SurroundingsNearby.tsx`)

**Files:**
- Create: `src/components/SurroundingsNearby.tsx`

**Interfaces:**
- Consumes: `SurroundingPlace` (types), `awaitGeolocation`, `formatDistance`, `GET /api/places/around`.
- Produces: `export function SurroundingsNearby()`.

- [ ] **Step 1: Write implementation** (KidsPlacesNearby 동형 — 거리에 방향 추가)

```tsx
// src/components/SurroundingsNearby.tsx
"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { SurroundingPlace } from "@/lib/types";
import { formatDistance } from "@/lib/format";
import { awaitGeolocation } from "@/lib/geolocation";

type Status =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error" }
  | { kind: "geoerror"; reason: "denied" | "unsupported" }
  | { kind: "done"; places: SurroundingPlace[]; at: string };

/**
 * 내 주변 둘러보기(기능 A) — 홈 진입점. KidsPlacesNearby 동형(geolocation 공유
 * 스토어 → 좌표 조회 → 자기완결 리스트). 차이: 각 항목에 **북 기준 8방위 방향**을
 * 거리와 함께 낭독("편의점 · 남동쪽 · 약 40m"). BlindSquare식 상시 인지.
 */
export function SurroundingsNearby() {
  const t = useTranslations("surroundingsNearby");
  const tActions = useTranslations("actions");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const inFlightRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  async function fetchAt(lat: number, lng: number) {
    setStatus({ kind: "loading" });
    try {
      const res = await fetch(`/api/places/around?lat=${lat}&lng=${lng}`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) {
        setStatus({ kind: "error" });
        return;
      }
      const places = (body.places ?? []) as SurroundingPlace[];
      if (places.length === 0) {
        setStatus({ kind: "empty" });
        return;
      }
      const at = new Date().toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });
      setStatus({ kind: "done", places, at });
      requestAnimationFrame(() => headingRef.current?.focus());
    } catch {
      setStatus({ kind: "error" });
    }
  }

  function load() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const done = () => {
      inFlightRef.current = false;
    };
    setStatus({ kind: "locating" });
    void awaitGeolocation().then((g) => {
      if (g.status === "ready") {
        void fetchAt(g.coords.lat, g.coords.lng).finally(done);
      } else {
        setStatus({
          kind: "geoerror",
          reason: g.status === "unsupported" ? "unsupported" : "denied",
        });
        done();
      }
    });
  }

  function close() {
    setStatus({ kind: "idle" });
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  const busy = status.kind === "locating" || status.kind === "loading";
  const buttonLabel = status.kind === "done" ? t("refresh") : t("button");

  const live =
    status.kind === "locating"
      ? t("locating")
      : status.kind === "loading"
        ? t("loading")
        : status.kind === "empty"
          ? t("empty")
          : status.kind === "error"
            ? t("error")
            : status.kind === "geoerror"
              ? status.reason === "denied"
                ? t("geoDenied")
                : t("geoUnsupported")
              : status.kind === "done"
                ? t("ready")
                : "";

  return (
    <div className="mt-3">
      <button
        ref={triggerRef}
        type="button"
        onClick={load}
        aria-disabled={busy}
        aria-busy={busy}
        className="min-h-11 rounded-md border border-accent px-4 py-2 text-sm font-medium text-accent aria-disabled:opacity-50"
      >
        {buttonLabel}
      </button>

      <p aria-live="polite" role="status" className="mt-2 min-h-5 text-sm">
        {live}
      </p>

      {status.kind === "done" && (
        <section
          aria-labelledby={headingId}
          className="mt-2 rounded-md border border-border p-3"
        >
          <h3
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className="text-base font-semibold"
          >
            {t("ready")}
            <span className="ml-2 text-xs font-normal opacity-70">
              {t("asOf", { time: status.at })}
            </span>
          </h3>

          <button
            type="button"
            onClick={close}
            className="mt-1 min-h-11 text-sm text-accent underline"
          >
            {tActions("close")}
          </button>

          <ul className="mt-2 space-y-4">
            {status.places.map((p) => (
              <li key={p.id}>
                <p className="font-medium">
                  <span lang="ko">{p.name}</span>{" "}
                  <span className="text-xs font-normal opacity-70">
                    {t("item", {
                      category: t(`category.${p.category}`),
                      direction: t(`direction.${p.bearing}`),
                      distance: formatDistance(p.distanceMeters),
                    })}
                  </span>
                </p>

                {p.phone && (
                  <p className="mt-1 text-sm">
                    <a href={`tel:${p.phone}`} className="text-accent underline">
                      {p.phone}
                      <span className="ml-1 opacity-70">{t("call")}</span>
                    </a>
                  </p>
                )}

                {p.link && (
                  <p className="mt-1 text-sm">
                    <a
                      href={p.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent underline"
                    >
                      {t("mapLink")}
                    </a>
                  </p>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs opacity-70">{t("source")}</p>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 타입 체크 + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: 에러 없음

- [ ] **Step 3: Commit**

```bash
git add src/components/SurroundingsNearby.tsx
git commit -m "feat(ui): SurroundingsNearby 내 주변 둘러보기 컴포넌트"
```

---

### Task 6: 홈 마운트 + 게이트 + 문서

**Files:**
- Modify: `src/app/[locale]/page.tsx` (canShowSurroundings 주입)
- Modify: `src/components/PlaceSearch.tsx` (prop + 6번째 섹션 렌더)
- Modify: `CLAUDE.md` (아키텍처 항목 추가)

**Interfaces:**
- Consumes: `SurroundingsNearby` (Task 5), `hasKakaoKey`.

- [ ] **Step 1: page.tsx — canShowSurroundings 주입**

`src/app/[locale]/page.tsx`에서 `<PlaceSearch>` props에 추가(canShowKids 줄 근처):

```tsx
      canShowKids={hasKakaoKey()}
      canShowSurroundings={hasKakaoKey()}
```

- [ ] **Step 2: PlaceSearch.tsx — import + prop 선언 + 렌더**

import 추가(다른 nearby import 근처, 29번째 줄 근처):

```tsx
import { SurroundingsNearby } from "./SurroundingsNearby";
```

prop 기본값(`canShowKids = false,` 줄 근처):

```tsx
  canShowSurroundings = false,
```

prop 타입(`canShowKids?: boolean;` 줄 근처):

```tsx
  canShowSurroundings?: boolean;
```

렌더 — KidsPlacesNearby 블록(514줄 근처) **바로 뒤**에 6번째 섹션 추가:

```tsx
      {canShowSurroundings && status.kind === "idle" && (
        <div className="mt-4">
          <SurroundingsNearby />
        </div>
      )}
```

- [ ] **Step 3: 타입·lint·전체 테스트·빌드 게이트**

Run: `npx tsc --noEmit && npm run lint && npm run test:run && npm run build`
Expected: 전부 통과

- [ ] **Step 4: CLAUDE.md 아키텍처 항목 추가**

`## 아키텍처`의 "내 주변" 관련 목록에 항목 추가(kids-places 항목 근처):

```markdown
- **내 주변 둘러보기** (기능 A, `surroundings.ts` + `/api/places/around` + `SurroundingsNearby`): BlindSquare식 상시 인지 차용 — 카카오 로컬 **카테고리 검색**(`category_group_code` 8종: 편의점·지하철역·음식점·카페·은행·약국·병원·마트·공공기관·관광명소) 좌표 근접 병렬 → dedupe·거리순·상위 12. 신규 핵심은 두 좌표 간 **북 기준 8방위 방향**(`src/lib/geo/bearing.ts` 순수: `bearingDegrees`·`bearingToCompass8`·`haversineMeters`) — heading 미보유라 "2시 방향"식 정면-상대 표기 대신 방위(북/북동/…)로 정직 표기. 거리는 카카오 `distance`(m) 정본, 누락 시 haversine 폴백. 부분 실패 불변식(kids-places 동형, allSettled·전부 실패만 throw→502). 신규 API·키 0(기존 `KAKAO_REST_API_KEY`, `canShowSurroundings`=`hasKakaoKey()`). 캐시 300초. 설계 `docs/superpowers/specs/2026-06-20-surroundings-awareness-design.md`(기능 A), 계획 `docs/superpowers/plans/2026-06-20-surroundings-awareness.md`. 기능 B(OSM 횡단보도·점자블록 + data.go.kr 음향신호기)는 후속 마일스톤(길동 OSM 보행 태깅 희박 실측 근거).
```

- [ ] **Step 5: AGENTS.md 동기화**

Run: `cd /Users/hunyongkim/Mac-Projects && python sync_agent_docs.py`
Expected: AGENTS.md 재생성

- [ ] **Step 6: Commit**

```bash
git add src/app/[locale]/page.tsx src/components/PlaceSearch.tsx CLAUDE.md AGENTS.md gildongmu/AGENTS.md
git commit -m "feat: 내 주변 둘러보기 홈 마운트 + 문서(기능 A 완료)"
```

---

## Self-Review 체크

- **Spec 커버리지**: 기능 A(주변 둘러보기·카카오·거리+방향) 전부 Task 1~6에 매핑. 기능 B는 spec에서 후속으로 명시 분리(범위 외).
- **타입 일관성**: `SurroundingPlace`·`SurroundingCategory`·`CompassDirection`·`findSurroundingsNear`·`normalizeSurroundingDoc`·`rankSurroundings` 명칭이 Task 2 정의 ↔ Task 3·5 소비에서 일치. `places` 응답 키 일치(route↔component).
- **방위 i18n 키**: `direction.{n,ne,e,se,s,sw,w,nw}` ↔ bearing.ts `CompassDirection` 리터럴 일치. `category.*` ↔ `SurroundingCategory` 10종 일치.
- **게이트**: `canShowSurroundings`=`hasKakaoKey()` 주입↔prop↔렌더 일치. 라우트 이중 방어.
