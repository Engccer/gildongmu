# 랜드마크(관광지·명소) 검색 섹션 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "경복궁" 등 고유명사 검색에서 진짜 관광지를 최상단 "관광지·명소" 섹션으로 병치하되, 일반 검색의 거리순 동작은 그대로 보존한다.

**Architecture:** 검색 시 카카오를 2회 병렬 호출한다 — 기존 `/api/places`(거리순, 내 주변)와 신규 `/api/places/attractions`(정확도순 결과에서 `category_name`이 "여행 > 관광,명소"인 것만 필터). 명소 섹션은 결과가 있으면 항상 최상단, 없으면 주소·웹 섹션처럼 자동 숨김. 명소 항목은 기존 `PlaceCard`를 재사용한다.

**Tech Stack:** Next.js 16(App Router), TypeScript, next-intl 4, Vitest 4, 카카오 로컬 키워드 API.

## Global Constraints

- **판별 신호는 `category_name.startsWith("여행 > 관광,명소")`** — `category_group_code === "AT4"`가 아님(부속 명소는 group code가 빈 문자열이라 놓침, 실호출 확정).
- **명소 cap 5** — 대표 명소 + 상위 부속. accuracy 순서 유지(대표가 맨 위).
- **v1은 ko 데이터 로케일만** — `dataLocale(locale) === "ko"`일 때만 명소 호출. en/es/fr/it은 명소 섹션 미노출(기존 동작 byte-identical, en은 fast-follow에서 TourAPI로).
- **게이트 `hasKakaoKey`** — 키 없으면 명소 라우트·호출·섹션 전부 0.
- `src/lib`는 React/Next 비의존 유지(dodo 이식성). 커밋 이메일 `engccer@gmail.com`. 주석·커밋 한국어.
- **머지 게이트 = 실호출**: 좌표 포함 "경복궁" 실호출로 명소 1위=진짜 경복궁 확인. fixture green ≠ 실계약.
- i18n 키는 5개 로케일(ko·en·es·fr·it) 전부 추가 — `i18n-messages.test.ts` 게이트.

---

## 파일 구조

- `src/lib/search-sections.ts` (수정) — `SectionKind`에 `"attraction"`; `orderResultSections`·`combinedLiveMessage`에 attraction 인자.
- `src/lib/providers/kakao-local.ts` (수정) — `ENDPOINT`·`KakaoLocalDocument`·`KakaoLocalResponse` export(재사용용).
- `src/lib/providers/kakao-attractions.ts` (신규) — 명소 검색 provider(순수 헬퍼 + fetch).
- `src/app/api/places/attractions/route.ts` (신규) — 명소 검색 프록시.
- `src/components/PlaceSearch.tsx` (수정) — 명소 상태·호출·섹션 렌더 배선.
- `src/app/[locale]/page.tsx` (수정) — `canSearchAttractions={hasKakaoKey()}` 주입.
- `messages/{ko,en,es,fr,it}.json` (수정) — `search.attractionSection`·`search.attractionCount`.
- 테스트: `src/lib/__tests__/search-sections.test.ts`(수정), `src/lib/providers/__tests__/kakao-attractions.test.ts`(신규).

---

## Task 1: 섹션 로직 확장 (순수 — 명소 우선 순서 + 통지)

**Files:**
- Modify: `src/lib/search-sections.ts`
- Test: `src/lib/__tests__/search-sections.test.ts`

**Interfaces:**
- Produces: `SectionKind = "place" | "address" | "web" | "attraction"`; `orderResultSections(placeCount, addrCount, webCount?, attractionCount?)`; `combinedLiveMessage(input)` — `input`에 `attractionCount?: number | null` 추가.

- [ ] **Step 1: 실패 테스트 작성** — `src/lib/__tests__/search-sections.test.ts`의 `orderResultSections` describe에 추가:

```ts
  it("명소가 있으면 건수와 무관하게 최상단", () => {
    // 내 주변 15건이 명소 3건보다 많아도 명소가 먼저.
    expect(orderResultSections(15, 0, 0, 3)).toEqual(["attraction", "place"]);
    expect(orderResultSections(2, 5, 0, 1)).toEqual([
      "attraction",
      "address",
      "place",
    ]);
  });
  it("명소가 0이면 기존 순서 그대로", () => {
    expect(orderResultSections(7, 1, 0, 0)).toEqual(["place", "address"]);
  });
```

그리고 `combinedLiveMessage 공존 모델` describe에 추가:

```ts
  it("명소가 있으면 attractionCount를 맨 앞 part로", () => {
    expect(
      combinedLiveMessage({
        ...base,
        placeCount: 15,
        webCount: 0,
        addrCount: 0,
        attractionCount: 3,
      }),
    ).toEqual([
      { key: "search.attractionCount", values: { count: 3 } },
      { key: "search.placeCount", values: { count: 15 } },
    ]);
  });
  it("명소만 있어도 attractionCount 단일 part", () => {
    expect(
      combinedLiveMessage({
        ...base,
        placeCount: 0,
        webCount: 0,
        addrCount: 0,
        attractionCount: 2,
      }),
    ).toEqual([{ key: "search.attractionCount", values: { count: 2 } }]);
  });
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm run test:run -- search-sections`
Expected: FAIL — `orderResultSections`가 4번째 인자를 무시, attractionCount 미지원.

- [ ] **Step 3: 최소 구현** — `src/lib/search-sections.ts` 수정.

`SectionKind`:
```ts
export type SectionKind = "place" | "address" | "web" | "attraction";
```

`orderResultSections` — 4번째 인자 추가, 명소는 있으면 unshift로 최상단:
```ts
export function orderResultSections(
  placeCount: number,
  addrCount: number,
  webCount = 0,
  attractionCount = 0,
): SectionKind[] {
  const present: { kind: SectionKind; count: number; rank: number }[] = [];
  if (placeCount > 0) present.push({ kind: "place", count: placeCount, rank: 0 });
  if (webCount > 0) present.push({ kind: "web", count: webCount, rank: 1 });
  if (addrCount > 0) present.push({ kind: "address", count: addrCount, rank: 2 });
  present.sort((a, b) => b.count - a.count || a.rank - b.rank);
  const ordered = present.map((s) => s.kind);
  // 명소는 "이 이름의 유명한 그곳"이라는 가장 강한 의도 신호 — 건수 무시하고 최상단.
  if (attractionCount > 0) ordered.unshift("attraction");
  return ordered;
}
```

`combinedLiveMessage` — input 타입에 `attractionCount` 추가, idle 가드에 포함, attraction part를 맨 앞에 push:
```ts
export function combinedLiveMessage(input: {
  loading: boolean;
  placeCount: number | null;
  addrCount: number | null;
  webCount?: number | null;
  attractionCount?: number | null;
  spokenQuery: string | null;
  placeErrored: boolean;
}): LivePart[] | null {
  const { loading, placeCount, addrCount, spokenQuery, placeErrored } = input;
  const webCount = input.webCount ?? null;
  const attractionCount = input.attractionCount ?? null;
  if (loading) {
    return [{ key: spokenQuery ? "search.searchingFor" : "search.searching" }];
  }
  if (
    placeCount === null &&
    addrCount === null &&
    webCount === null &&
    attractionCount === null &&
    !placeErrored
  ) {
    return null;
  }
  const attraction = attractionCount ?? 0;
  const place = placeCount ?? 0;
  const web = webCount ?? 0;
  const addr = addrCount ?? 0;
  const parts: LivePart[] = [];
  if (attraction > 0)
    parts.push({ key: "search.attractionCount", values: { count: attraction } });
  if (place > 0) parts.push({ key: "search.placeCount", values: { count: place } });
  if (web > 0) parts.push({ key: "search.webCount", values: { count: web } });
  if (addr > 0) parts.push({ key: "search.addressCount", values: { count: addr } });
  if (parts.length > 0) return parts;
  if (placeErrored) return [{ key: "search.error" }];
  return [{ key: "search.noResults" }];
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm run test:run -- search-sections`
Expected: PASS(기존 + 신규 전부).

- [ ] **Step 5: 커밋**

```bash
git commit -m "feat(search): 섹션 로직에 명소(attraction) 추가 — 있으면 최상단, 통지 맨 앞

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" -- src/lib/search-sections.ts src/lib/__tests__/search-sections.test.ts
```

---

## Task 2: 명소 검색 provider

**Files:**
- Modify: `src/lib/providers/kakao-local.ts` (export 추가)
- Create: `src/lib/providers/kakao-attractions.ts`
- Test: `src/lib/providers/__tests__/kakao-attractions.test.ts`

**Interfaces:**
- Consumes: `normalizeDocument`, `KakaoLocalDocument`, `KakaoLocalResponse`, `ENDPOINT` (from kakao-local); `haversineMeters` (from `../geo`); `PlaceSearchParams`, `Place`, `PlaceSearchResult` (from `../types`).
- Produces: `ATTRACTION_CATEGORY_PREFIX`, `isAttraction(category: string): boolean`, `buildAttractionSearchUrl(params): URL`, `extractAttractions(docs: KakaoLocalDocument[], params): Place[]`, `searchAttractions(params): Promise<PlaceSearchResult>`.

- [ ] **Step 1: kakao-local.ts에 export 추가** — 3개 심볼을 재사용 가능하게 export.

`src/lib/providers/kakao-local.ts`에서:
- `const ENDPOINT =` → `export const ENDPOINT =`
- `interface KakaoLocalDocument {` → `export interface KakaoLocalDocument {`
- `interface KakaoLocalResponse {` → `export interface KakaoLocalResponse {`

(`normalizeDocument`는 이미 export됨.)

- [ ] **Step 2: 실패 테스트 작성** — `src/lib/providers/__tests__/kakao-attractions.test.ts` 신규:

```ts
import { describe, it, expect } from "vitest";
import {
  isAttraction,
  buildAttractionSearchUrl,
  extractAttractions,
} from "../kakao-attractions";
import type { KakaoLocalDocument } from "../kakao-local";

function doc(
  id: string,
  name: string,
  category: string,
  y: string,
  x: string,
): KakaoLocalDocument {
  return {
    id,
    place_name: name,
    category_name: category,
    category_group_code: "",
    phone: "",
    address_name: "",
    road_address_name: "",
    x,
    y,
    place_url: "",
    distance: "",
  };
}

describe("isAttraction", () => {
  it("여행 > 관광,명소로 시작하면 명소(group code 빈 값이어도)", () => {
    expect(isAttraction("여행 > 관광,명소 > 문화유적 > 고궁,궁")).toBe(true);
    expect(isAttraction("여행 > 관광,명소 > 문화유적")).toBe(true);
  });
  it("음식점·주차장·지하철은 명소 아님", () => {
    expect(isAttraction("음식점 > 한식 > 한정식 > 경복궁")).toBe(false);
    expect(isAttraction("교통,수송 > 교통시설 > 주차장")).toBe(false);
  });
});

describe("buildAttractionSearchUrl", () => {
  it("정확도순 — 좌표·sort를 붙이지 않는다", () => {
    const url = buildAttractionSearchUrl({
      query: "경복궁",
      lat: 37.538,
      lng: 127.143,
    });
    expect(url.searchParams.get("query")).toBe("경복궁");
    expect(url.searchParams.get("x")).toBeNull();
    expect(url.searchParams.get("y")).toBeNull();
    expect(url.searchParams.get("sort")).toBeNull();
    expect(url.searchParams.get("size")).toBe("15");
  });
});

describe("extractAttractions", () => {
  const docs: KakaoLocalDocument[] = [
    doc("1", "경복궁", "여행 > 관광,명소 > 문화유적 > 고궁,궁", "37.579", "126.977"),
    doc("2", "경복궁 주차장", "교통,수송 > 교통시설 > 주차장", "37.579", "126.976"),
    doc("3", "경복궁 삼계탕", "음식점 > 한식 > 육류,고기", "37.51", "127.10"),
    doc("4", "경복궁 경회루", "여행 > 관광,명소 > 문화유적", "37.580", "126.977"),
    doc("5", "경복궁 근정전", "여행 > 관광,명소 > 문화유적", "37.579", "126.977"),
    doc("6", "경복궁 향원정", "여행 > 관광,명소 > 문화유적", "37.581", "126.977"),
    doc("7", "경복궁 집옥재", "여행 > 관광,명소 > 문화유적", "37.581", "126.978"),
    doc("8", "경복궁 흥례문", "여행 > 관광,명소 > 문화유적", "37.578", "126.977"),
  ];

  it("명소만 남기고, accuracy 순서로 cap 5까지", () => {
    const out = extractAttractions(docs, { query: "경복궁" });
    expect(out.map((p) => p.name)).toEqual([
      "경복궁",
      "경복궁 경회루",
      "경복궁 근정전",
      "경복궁 향원정",
      "경복궁 집옥재",
    ]);
    // 음식점·주차장은 제외.
    expect(out.some((p) => p.name === "경복궁 삼계탕")).toBe(false);
  });

  it("좌표가 있으면 distanceMeters를 채운다", () => {
    const out = extractAttractions(docs, {
      query: "경복궁",
      lat: 37.538,
      lng: 127.143,
    });
    expect(out[0]?.distanceMeters).toBeGreaterThan(0);
  });

  it("좌표가 없으면 distanceMeters 미설정", () => {
    const out = extractAttractions(docs, { query: "경복궁" });
    expect(out[0]?.distanceMeters).toBeUndefined();
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npm run test:run -- kakao-attractions`
Expected: FAIL — `../kakao-attractions` 모듈 없음.

- [ ] **Step 4: provider 구현** — `src/lib/providers/kakao-attractions.ts` 신규:

```ts
import { env } from "../env";
import { haversineMeters } from "../geo";
import type { Place, PlaceSearchParams, PlaceSearchResult } from "../types";
import {
  ENDPOINT,
  normalizeDocument,
  type KakaoLocalDocument,
  type KakaoLocalResponse,
} from "./kakao-local";

/**
 * 관광지·명소 검색 provider — 카카오 로컬 키워드를 **정확도순**(좌표·sort 없이)
 * 으로 호출해, category_name이 "여행 > 관광,명소"인 항목만 추린다.
 *
 * ⚠ 판별은 category_group_code "AT4"가 아니라 category_name 계층으로 한다.
 * 경복궁 본궁만 AT4이고 경회루·근정전 등 부속은 group code가 빈 문자열이라
 * AT4로 필터하면 진짜 명소를 놓친다(실호출 확정). kids-places가 쓰는
 * category_name 화이트리스트 패턴과 동형.
 *
 * 거리순(내 주변, /api/places)과 정렬 방식이 반대라 한 호출로 둘 다 못 만든다 —
 * 검색 시 이 provider를 거리순 place 검색과 병렬 호출한다.
 */
export const ATTRACTION_CATEGORY_PREFIX = "여행 > 관광,명소";

/** 명소 표시 상한 — 대표 명소 + 상위 부속. accuracy 순서라 대표가 맨 위. */
const ATTRACTION_CAP = 5;

export function isAttraction(category: string): boolean {
  return category.startsWith(ATTRACTION_CATEGORY_PREFIX);
}

/** 정확도순 URL — 좌표·sort를 붙이지 않는다(거리순이면 명소가 밀려남). */
export function buildAttractionSearchUrl(params: PlaceSearchParams): URL {
  const url = new URL(ENDPOINT);
  url.searchParams.set("query", params.query);
  url.searchParams.set("size", "15");
  return url;
}

/**
 * 응답 문서에서 명소만 추출 — 필터 → (좌표 있으면) Haversine 거리 주입 → cap.
 * accuracy 순서 유지(정렬 안 함) — 대표 명소가 맨 위.
 */
export function extractAttractions(
  docs: KakaoLocalDocument[],
  params: PlaceSearchParams,
): Place[] {
  const places = docs
    .map(normalizeDocument)
    .filter((p) => isAttraction(p.category));
  const { lat, lng } = params;
  const withDistance =
    lat != null && lng != null
      ? places.map((p) => ({
          ...p,
          distanceMeters: Math.round(haversineMeters(lat, lng, p.lat, p.lng)),
        }))
      : places;
  return withDistance.slice(0, ATTRACTION_CAP);
}

export async function searchAttractions(
  params: PlaceSearchParams,
): Promise<PlaceSearchResult> {
  const url = buildAttractionSearchUrl(params);
  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${env.KAKAO_REST_API_KEY}` },
    next: { revalidate: 300 },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`카카오 명소 검색 실패: HTTP ${res.status} ${body}`);
  }
  const data = (await res.json()) as KakaoLocalResponse;
  return {
    places: extractAttractions(data.documents, params),
    provider: "kakao-attractions",
    query: params.query,
  };
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm run test:run -- kakao-attractions`
Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git commit -m "feat(providers): 명소(관광지) 검색 provider — 정확도순+category_name 필터

카카오 정확도순 호출 결과에서 여행>관광,명소만 추려 cap 5. AT4 group code는
부속 명소를 놓쳐 category_name 계층으로 판별(실호출 확정).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" -- src/lib/providers/kakao-local.ts src/lib/providers/kakao-attractions.ts src/lib/providers/__tests__/kakao-attractions.test.ts
```

---

## Task 3: 명소 검색 API 라우트

**Files:**
- Create: `src/app/api/places/attractions/route.ts`

**Interfaces:**
- Consumes: `searchAttractions` (from `@/lib/providers/kakao-attractions`); `hasKakaoKey` (from `@/lib/env`).
- Produces: `GET` — `{ places: Place[], provider, query }` 또는 키 없으면 `{ places: [] }`.

- [ ] **Step 1: 라우트 구현** — `src/app/api/places/attractions/route.ts` 신규(`/api/places` 미러):

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasKakaoKey } from "@/lib/env";
import { searchAttractions } from "@/lib/providers/kakao-attractions";

/**
 * 관광지·명소 검색 프록시 — 정확도순 카카오 호출로 랜드마크를 surface한다.
 * 거리순 /api/places와 병렬로 호출되며, 카카오 키가 없으면 빈 결과(死기능 0).
 */
const querySchema = z.object({
  query: z.string().trim().min(1, "검색어가 비어 있습니다").max(100),
  lang: z.enum(["ko", "en"]).default("ko"),
  lat: z.coerce.number().min(-90).max(90).optional().catch(undefined),
  lng: z.coerce.number().min(-180).max(180).optional().catch(undefined),
});

export async function GET(request: NextRequest) {
  if (!hasKakaoKey()) {
    return NextResponse.json({ places: [], provider: "none", query: "" });
  }
  const parsed = querySchema.safeParse({
    query: request.nextUrl.searchParams.get("query") ?? "",
    lang: request.nextUrl.searchParams.get("lang") ?? undefined,
    lat: request.nextUrl.searchParams.get("lat") ?? undefined,
    lng: request.nextUrl.searchParams.get("lng") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "잘못된 요청" },
      { status: 400 },
    );
  }
  try {
    const result = await searchAttractions(parsed.data);
    return NextResponse.json(result);
  } catch (e) {
    console.error("[api/places/attractions] 검색 실패:", e);
    return NextResponse.json(
      { error: "관광지 검색에 실패했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 2: 빌드·린트 확인**

Run: `npm run lint && npm run build`
Expected: 통과(타입·라우트 인식).

- [ ] **Step 3: 실호출 검증 (머지 게이트)** — dev 서버로 실제 응답 확인:

```bash
npm run dev &   # 백그라운드, 잠시 대기
sleep 4
echo "=== 경복궁 (좌표=길동) — 명소 1위 확인 ==="
curl -s "http://localhost:3000/api/places/attractions?query=%EA%B2%BD%EB%B3%B5%EA%B6%81&lat=37.538&lng=127.143" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); [print(p['name'],'|',p['category'],'|',p.get('distanceMeters')) for p in d['places']]"
echo "=== 카페 — 명소 0건 확인 ==="
curl -s "http://localhost:3000/api/places/attractions?query=%EC%B9%B4%ED%8E%98&lat=37.538&lng=127.143" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('places:', len(d['places']))"
```
Expected: 경복궁 → 첫 항목 `경복궁 | 여행 > 관광,명소 … | <거리>`(부속 4곳 이어짐, 음식점 없음). 카페 → `places: 0`.

- [ ] **Step 4: 커밋**

```bash
git commit -m "feat(api): /api/places/attractions — 명소 검색 프록시(게이트 hasKakaoKey)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" -- src/app/api/places/attractions/route.ts
```

---

## Task 4: PlaceSearch 배선 + i18n + page 주입

**Files:**
- Modify: `src/components/PlaceSearch.tsx`
- Modify: `src/app/[locale]/page.tsx`
- Modify: `messages/ko.json`, `messages/en.json`, `messages/es.json`, `messages/fr.json`, `messages/it.json`

**Interfaces:**
- Consumes: `searchAttractions` 결과(`/api/places/attractions`); Task 1의 `orderResultSections`/`combinedLiveMessage`(attraction 인자); `PlaceCard`, `dataLocale`, `hasKakaoKey`.

- [ ] **Step 1: i18n 키 추가(5개 로케일)** — 각 `messages/*.json`의 `search` 객체에 두 키 추가:

`ko.json`:
```json
    "attractionSection": "관광지·명소",
    "attractionCount": "관광지 {count}곳",
```
`en.json`:
```json
    "attractionSection": "Attractions",
    "attractionCount": "{count} attractions",
```
`es.json`:
```json
    "attractionSection": "Lugares turísticos",
    "attractionCount": "{count} lugares turísticos",
```
`fr.json`:
```json
    "attractionSection": "Sites touristiques",
    "attractionCount": "{count} sites touristiques",
```
`it.json`:
```json
    "attractionSection": "Attrazioni",
    "attractionCount": "{count} attrazioni",
```

- [ ] **Step 2: i18n 게이트 통과 확인**

Run: `npm run test:run -- i18n-messages`
Expected: PASS(5개 로케일 키 집합 일치).

- [ ] **Step 3: page.tsx에 게이트 주입** — `src/app/[locale]/page.tsx`의 `<PlaceSearch ...>`에 한 줄 추가(`canShowWhereAmI` 아래):

```tsx
      canSearchAttractions={hasKakaoKey()}
```

- [ ] **Step 4: PlaceSearch prop·상태·호출 추가** — `src/components/PlaceSearch.tsx` 수정.

(a) `PlaceCard` import 추가(파일 상단 import 블록):
```ts
import { PlaceCard } from "./PlaceCard";
```

(b) props 타입에 추가(`canShowWhereAmI?: boolean;` 근처):
```ts
  /** 카카오 키가 있어 관광지·명소 검색 섹션을 제공할 수 있는지 */
  canSearchAttractions?: boolean;
```
그리고 구조분해 기본값(`canShowWhereAmI = false,` 근처):
```ts
  canSearchAttractions = false,
```

(c) 상태·ref 추가(`addrStatus` useState 근처):
```ts
  const [attractionStatus, setAttractionStatus] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "done"; places: Place[] }
    | { kind: "error" }
  >({ kind: "idle" });
  const attractionReqIdRef = useRef(0);
```

(d) `performAttractionSearch` 추가(`performWebSearch` 정의 아래) — place performSearch와 동형 stale 가드:
```ts
  /**
   * 명소 검색 실행 — /api/places/attractions(정확도순+category_name 필터) 호출.
   * 거리순 장소 검색과 병렬 발사되는 보조 섹션. 결과 있으면 최상단 병치,
   * 없으면 섹션 미노출(orderResultSections가 제외). place reqId 동형 stale 가드.
   */
  const performAttractionSearch = useCallback(
    async (raw: string): Promise<number> => {
      const q = raw.trim();
      if (!q) return 0;
      const myId = ++attractionReqIdRef.current;
      setAttractionStatus({ kind: "loading" });
      try {
        const coordQuery = userCoords
          ? `&lat=${userCoords.lat}&lng=${userCoords.lng}`
          : "";
        const res = await fetch(
          `/api/places/attractions?query=${encodeURIComponent(q)}&lang=${dataLocale(locale)}${coordQuery}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as PlaceSearchResult;
        if (attractionReqIdRef.current !== myId) return 0;
        setAttractionStatus({ kind: "done", places: data.places });
        return data.places.length;
      } catch {
        // 보조 섹션 — 실패는 0건 취급(무음 degrade, 폴백 억제는 장소 errored 담당).
        if (attractionReqIdRef.current !== myId) return 0;
        setAttractionStatus({ kind: "error" });
        return 0;
      }
    },
    [locale, userCoords],
  );
```

(e) `runQuerySearch`의 병렬 발사에 명소 합류 — 기존 리셋 구간에 `setAttractionStatus` 추가하고 Promise.all에 명소 호출(ko 데이터 로케일 + 게이트일 때만):
```ts
  const runQuerySearch = useCallback(
    async (raw: string) => {
      if (!raw.trim()) return;
      setWebPending(false);
      setWebResults(null);
      const canAttraction =
        canSearchAttractions && dataLocale(locale) === "ko";
      if (!canAttraction) setAttractionStatus({ kind: "idle" });
      const [place, addrCount] = await Promise.all([
        performSearch(raw),
        canSearchAddress ? performAddressSearch(raw) : Promise.resolve(0),
        canAttraction ? performAttractionSearch(raw) : Promise.resolve(0),
      ]);
      if (
        canSearchWeb &&
        !place.errored &&
        shouldFallbackToWeb(place.count, addrCount)
      ) {
        setWebPending(true);
        void performWebSearch(raw);
      }
    },
    [
      performSearch,
      performAddressSearch,
      performWebSearch,
      performAttractionSearch,
      canSearchAddress,
      canSearchWeb,
      canSearchAttractions,
      locale,
    ],
  );
```

- [ ] **Step 5: PlaceSearch 렌더 배선** — 계속 `src/components/PlaceSearch.tsx`.

(a) 섹션 카운트·순서(`placeResultCount` 근처):
```ts
  const attractionResultCount =
    attractionStatus.kind === "done" ? attractionStatus.places.length : 0;
  const sectionOrder = orderResultSections(
    placeResultCount,
    addrResultCount,
    webResultCount,
    attractionResultCount,
  );
```

(b) `headingParts`의 `combinedLiveMessage` 호출에 attractionCount 추가:
```ts
    attractionCount:
      attractionStatus.kind === "done" ? attractionStatus.places.length : null,
```
그리고 상단 `liveMessage`용 `combinedLiveMessage` 호출(약 463행)에도 동일 인자 추가:
```ts
          attractionCount:
            attractionStatus.kind === "done"
              ? attractionStatus.places.length
              : null,
```

(c) 명소 섹션 본체 정의(`addressSectionBody` 근처):
```tsx
  // 명소 섹션 본체 — 거리순 내 주변과 동형으로 PlaceCard 재사용(이름·분류·거리는
  // joinText로 한 줄=한 객체, 버튼은 별도 객체 유지). 카테고리 그룹핑 없음(전부 명소).
  const attractionSectionBody = (
    <ul className="mt-3 flex flex-col gap-3">
      {(attractionStatus.kind === "done" ? attractionStatus.places : []).map(
        (place) => (
          <PlaceCard key={place.id} place={place} onOpen={openDetail} />
        ),
      )}
    </ul>
  );
```

(d) 결과 컨테이너 표시 조건에 명소 done 추가(약 665행 `status.kind === "done" || addrStatus.kind === "done" || ...`):
```tsx
      {(status.kind === "done" ||
        addrStatus.kind === "done" ||
        attractionStatus.kind === "done" ||
        (canSearchWeb && webResults !== null && webResults.length > 0)) && (
```

(e) `sectionOrder.map` 루프에 attraction 분기 추가(`if (kind === "place")` 앞에):
```tsx
              if (kind === "attraction") {
                return (
                  <section key="attraction" className="mt-4">
                    {showSectionHeadings && (
                      <h3 className="text-lg font-semibold">
                        {t("search.attractionSection")}
                      </h3>
                    )}
                    {attractionSectionBody}
                  </section>
                );
              }
```

- [ ] **Step 6: 린트·빌드·전체 테스트**

Run: `npm run lint && npm run build && npm run test:run`
Expected: 전부 통과.

- [ ] **Step 7: 실호출 통합 검증 (머지 게이트)** — dev 서버 + 브라우저/컬로 확인:

```bash
npm run dev &
sleep 4
# 명소 섹션이 검색 응답 경로에 실제로 실리는지 (route는 Task 3에서 검증됨)
# 여기선 UI 통합: "경복궁" 검색 시 명소 섹션이 최상단, "카페"는 미노출을 육안/AX로 확인.
```
확인 항목:
1. "경복궁" 검색 → **관광지·명소** 섹션이 **최상단**, 첫 항목 = 진짜 경복궁. 그 아래 내 주변(경복궁 삼계탕 등).
2. "카페" 검색 → 명소 섹션 **미노출**, 내 주변 결과는 변경 전과 동일.
3. 영어(`/en`)로 "Gyeongbokgung" 검색 → 명소 섹션 **미노출**(en 기존 동작 불변).
4. 통지(live region): "관광지 N곳, 장소 M곳" 순서로 낭독.

- [ ] **Step 8: a11y 감사** — `a11y-auditor` 서브에이전트로 명소 섹션 점검(과잉 ARIA·한 줄=한 객체·헤딩 계층).

- [ ] **Step 9: 커밋**

```bash
git commit -m "feat(search): 관광지·명소 섹션 UI 배선 — 랜드마크 검색 최상단 병치

경복궁 등 고유명사 검색 시 명소 섹션을 거리순 검색과 병렬 호출해 최상단에
병치. ko 데이터 로케일만(en은 fast-follow), PlaceCard 재사용, 빈 섹션 자동
숨김. i18n 5개 로케일 키 추가.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" -- src/components/PlaceSearch.tsx src/app/[locale]/page.tsx messages/ko.json messages/en.json messages/es.json messages/fr.json messages/it.json
```

---

## Self-Review

**Spec coverage:**
- 판별 신호 category_name → Task 2 `isAttraction`. ✅
- 2회 병렬 호출 → Task 2·3 provider/route + Task 4 runQuerySearch Promise.all. ✅
- 명소 최상단 순서 → Task 1 `orderResultSections` unshift. ✅
- 빈 섹션 자동 숨김 → Task 1(count 0 제외) + Task 4 sectionOrder 렌더. ✅
- cap 5·거리표기 → Task 2 `extractAttractions`. ✅
- 게이트 hasKakaoKey → Task 3 route + Task 4 page/canSearchAttractions. ✅
- v1 ko-only, en 불변 → Task 4 `dataLocale(locale) === "ko"` 가드 + Step 7 검증. ✅
- 접근성(PlaceCard 재사용·joinText·헤딩 계층·단일 통지) → Task 4 + Step 8. ✅
- 실호출 머지 게이트 → Task 3 Step 3, Task 4 Step 7. ✅
- i18n 5로케일 → Task 4 Step 1·2. ✅

**Placeholder scan:** 모든 코드 블록에 실제 구현/테스트 코드 포함. 플레이스홀더 없음.

**Type consistency:** `orderResultSections(place, addr, web, attraction)` 4-인자 시그니처가 Task 1 정의·Task 4 호출에서 일치. `searchAttractions`→`PlaceSearchResult`, `extractAttractions`→`Place[]`, `isAttraction(string)→boolean`이 Task 2 정의·Task 3·4 사용에서 일치. `attractionStatus` done shape `{places: Place[]}`가 상태·렌더에서 일치.
