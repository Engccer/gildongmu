# 검색창 자연어 라우터 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 단일 검색창을 유지한 채 Gemini 단발 분류로 자연어 검색(지역 앵커링 + 웹 폴백)을 통합한다.

**Architecture:** 검색창 `runQuerySearch`는 두 갈래 병렬 — `/api/address/search`(juso, 불변) + 신규 `/api/search`(Gemini 단발 라우터). 라우터는 `search_places`(+region)·`search_web` 2종 중 하나를 골라 실행하고, 장소 0건이면 코드가 결정적으로 Perplexity 웹 폴백한다. Gemini 키 없으면 naive 카카오 검색으로 강등(회귀 0).

**Tech Stack:** Next.js 16, TypeScript, `@google/genai`(function-calling), zod, Vitest 4(node-env), next-intl.

## Global Constraints

- 코드 주석·커밋 메시지·문서: 한국어. 변수/함수명: 영어. (커밋 이메일 `engccer@gmail.com`)
- `src/lib/search-router/`는 **React/Next 비의존**(dodo 이식성, `src/lib/chat/`와 동형).
- 외부 데이터 fetch·영문표기 분기는 `useLocale()` 원시값 금지 → `dataLocale`/`prefersEnglish` 경유.
- 기능·버그픽스는 같은 커밋에 테스트 동반.
- 단위 테스트는 node-env Vitest. 컴포넌트 와이어링 테스트 레인 없음 → lint+build+실호출이 게이트.
- mock 폴백으로 실데이터 실패를 가리지 않는다(가짜 실데이터 금지).
- 접근성: 단일 polite live region, 이미 보이는 콘텐츠를 live region에 복제 금지.
- `GEMINI_MODEL = "gemini-3.5-flash"`, ai 클라이언트는 `getGeminiClient()` 주입형.
- 매 커밋 `npm run test:run` + `npm run lint` 통과.

---

## File Structure

```
src/lib/search-router/
  types.ts          SearchIntent, SearchRouteResult, RouterAnchor
  declarations.ts   buildSearchDeclarations(): FunctionDeclaration[]  (search_places, search_web)
  flow.ts           pickAnchor(), shouldFallbackToWeb()  (순수)
  classify.ts       classifySearchQuery({query, locale, ai})  (Gemini 단발)
  __tests__/
    flow.test.ts
    declarations.test.ts
    classify.test.ts
src/app/api/search/route.ts   GET 오케스트레이터
src/lib/search-sections.ts    (수정) SectionKind에 "web", orderResultSections·combinedLiveMessage 확장
src/components/WebResults.tsx  (이동) chat/WebResults.tsx → components/WebResults.tsx
src/components/PlaceSearch.tsx (수정) performSearch → /api/search, {kind} 분기 렌더
messages/{ko,en,es,fr,it}.json (수정) 웹 섹션 키
```

---

## Task 1: search-router 순수 코어 (types + flow + declarations)

**Files:**
- Create: `src/lib/search-router/types.ts`
- Create: `src/lib/search-router/flow.ts`
- Create: `src/lib/search-router/declarations.ts`
- Test: `src/lib/search-router/__tests__/flow.test.ts`
- Test: `src/lib/search-router/__tests__/declarations.test.ts`

**Interfaces:**
- Produces:
  - `type RouterAnchor = { lat: number; lng: number }`
  - `type SearchIntent = { kind: "place"; keyword: string; region?: string } | { kind: "web"; query: string; recency?: string }`
  - `type SearchRouteResult = { kind: "place"; places: Place[] } | { kind: "web"; web: WebSearchResult[]; fallbackFrom?: "place" }`
  - `pickAnchor(geocoded: RouterAnchor | null, userCoords: RouterAnchor | null): RouterAnchor | null`
  - `shouldFallbackToWeb(placeCount: number, hasPerplexity: boolean): boolean`
  - `buildSearchDeclarations(): FunctionDeclaration[]`

- [ ] **Step 1: Write types.ts**

```typescript
import type { Place, WebSearchResult } from "@/lib/types";

/** 라우터 앵커 좌표(WGS84). */
export type RouterAnchor = { lat: number; lng: number };

/**
 * Gemini 단발 분류 결과. place(지역·키워드 추출) 또는 web(시의성 질의) 중 하나.
 * recency는 Perplexity search_recency_filter 화이트리스트(hour|day|week|month|year).
 */
export type SearchIntent =
  | { kind: "place"; keyword: string; region?: string }
  | { kind: "web"; query: string; recency?: string };

/**
 * 라우트가 클라이언트에 돌려주는 판별 결과. place와 web은 상호배타.
 * fallbackFrom:"place" = 장소 0건이라 코드가 결정적으로 웹 폴백한 경우(길 B).
 */
export type SearchRouteResult =
  | { kind: "place"; places: Place[] }
  | { kind: "web"; web: WebSearchResult[]; fallbackFrom?: "place" };
```

- [ ] **Step 2: Write flow.ts**

```typescript
import type { RouterAnchor } from "./types";

/**
 * 검색 앵커 선택(순수). 지오코딩된 지역 좌표가 있으면 그것을, 없으면 현재 위치를,
 * 둘 다 없으면 null(카카오 정확도순 graceful). 지역 명시가 현재 위치를 누른다 —
 * "암사동…"을 길동에서 검색해도 암사동 기준으로 찾기 위함.
 */
export function pickAnchor(
  geocoded: RouterAnchor | null,
  userCoords: RouterAnchor | null,
): RouterAnchor | null {
  return geocoded ?? userCoords ?? null;
}

/**
 * 장소 0건일 때 웹 폴백(길 B) 여부(순수). Perplexity 키가 있고 결과가 0일 때만.
 */
export function shouldFallbackToWeb(
  placeCount: number,
  hasPerplexity: boolean,
): boolean {
  return placeCount === 0 && hasPerplexity;
}
```

- [ ] **Step 3: Write declarations.ts**

```typescript
import type { FunctionDeclaration } from "@google/genai";

/**
 * 검색창 라우터가 Gemini에 노출하는 도구 2종(순수 데이터).
 * 채팅(14종)과 달리 검색 의도만 — 실시간/버튼 도구는 비노출(deterministic 유지).
 * search_places는 region을 선택 인자로 받아 지역 앵커링을 가능케 한다.
 */
export function buildSearchDeclarations(): FunctionDeclaration[] {
  return [
    {
      name: "search_places",
      description:
        "장소(상호·POI)를 검색한다. 자연어에서 지역과 카테고리를 분해한다. " +
        "예: '암사동 캐나다 식당' → keyword='양식 서양음식점', region='암사동'. " +
        "'길동 카페' → keyword='카페', region='길동'.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          keyword: {
            type: "string",
            description:
              "장소 검색 키워드(카테고리·업종·상호). 지역명은 빼고 region에 넣는다. " +
              "실재하지 않을 법한 표현은 카카오가 찾을 만한 일반 카테고리로 바꾼다(예: '캐나다 식당'→'양식 서양음식점').",
          },
          region: {
            type: "string",
            description:
              "검색 기준 지역/동/역 이름(있을 때만). 예: '암사동', '강동역', '강남'. 없으면 생략(현재 위치 기준).",
          },
        },
        required: ["keyword"],
      },
    },
    {
      name: "search_web",
      description:
        "장소가 아니라 시의성 웹 정보를 찾을 때. 예: '환율 최신', '스페인 입국 정책', '오늘 날씨 뉴스'. " +
        "특정 상호/지역 장소 검색이면 이 도구가 아니라 search_places를 쓴다.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "웹 검색어" },
          recency: {
            type: "string",
            enum: ["hour", "day", "week", "month", "year"],
            description: "시간 필터(선택) — 최신성이 중요할 때만.",
          },
        },
        required: ["query"],
      },
    },
  ];
}
```

- [ ] **Step 4: Write flow.test.ts**

```typescript
import { describe, it, expect } from "vitest";
import { pickAnchor, shouldFallbackToWeb } from "../flow";

describe("pickAnchor", () => {
  const geo = { lat: 37.55, lng: 127.13 };
  const user = { lat: 37.54, lng: 127.14 };
  it("지오코딩 좌표가 있으면 그것을 우선(현재 위치를 누름)", () => {
    expect(pickAnchor(geo, user)).toBe(geo);
  });
  it("지오코딩 없으면 현재 위치로 폴백", () => {
    expect(pickAnchor(null, user)).toBe(user);
  });
  it("둘 다 없으면 null", () => {
    expect(pickAnchor(null, null)).toBeNull();
  });
});

describe("shouldFallbackToWeb", () => {
  it("0건 + Perplexity 키 있음 → true", () => {
    expect(shouldFallbackToWeb(0, true)).toBe(true);
  });
  it("0건 + 키 없음 → false", () => {
    expect(shouldFallbackToWeb(0, false)).toBe(false);
  });
  it("결과 있음 → false", () => {
    expect(shouldFallbackToWeb(3, true)).toBe(false);
  });
});
```

- [ ] **Step 5: Write declarations.test.ts**

```typescript
import { describe, it, expect } from "vitest";
import { buildSearchDeclarations } from "../declarations";

describe("buildSearchDeclarations", () => {
  it("검색 의도 2종만 노출(실시간/버튼 도구 비포함)", () => {
    const names = buildSearchDeclarations().map((d) => d.name);
    expect(names).toEqual(["search_places", "search_web"]);
  });
  it("search_places는 keyword 필수·region 선택", () => {
    const decl = buildSearchDeclarations().find((d) => d.name === "search_places")!;
    const schema = decl.parametersJsonSchema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(Object.keys(schema.properties)).toEqual(["keyword", "region"]);
    expect(schema.required).toEqual(["keyword"]);
  });
});
```

- [ ] **Step 6: Run tests**

Run: `npm run test:run -- src/lib/search-router`
Expected: PASS (flow 6, declarations 2).

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(search): 라우터 순수 코어 — types·flow·declarations

검색창 자연어 라우터의 순수 부분(앵커 선택·웹폴백 판정·Gemini 도구 2종).
search-router는 React 비의존(dodo 이식성).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UKHyhyt69nKrfPpzeLZ4P8" -- src/lib/search-router/types.ts src/lib/search-router/flow.ts src/lib/search-router/declarations.ts src/lib/search-router/__tests__/flow.test.ts src/lib/search-router/__tests__/declarations.test.ts
```

---

## Task 2: classify.ts — Gemini 단발 분류

**Files:**
- Create: `src/lib/search-router/classify.ts`
- Test: `src/lib/search-router/__tests__/classify.test.ts`

**Interfaces:**
- Consumes: `SearchIntent`(types), `buildSearchDeclarations`(declarations), `@google/genai` `GoogleGenAI`/`FunctionCall`.
- Produces: `classifySearchQuery({ query, locale, ai }: { query: string; locale: string; ai: ClassifyClient }): Promise<SearchIntent>` where `ClassifyClient = Pick<GoogleGenAI, "models">`.

- [ ] **Step 1: Write the failing test (classify.test.ts)**

```typescript
import { describe, it, expect, vi } from "vitest";
import { classifySearchQuery } from "../classify";

/** functionCall 1개를 담은 가짜 Gemini 응답을 만드는 헬퍼. */
function mockAi(fn: { name: string; args: Record<string, unknown> } | null) {
  const parts = fn ? [{ functionCall: fn }] : [{ text: "" }];
  return {
    models: {
      generateContent: vi.fn().mockResolvedValue({
        candidates: [{ content: { parts } }],
      }),
    },
  };
}

describe("classifySearchQuery", () => {
  it("복합 의미 쿼리 → place{region,keyword}", async () => {
    const ai = mockAi({
      name: "search_places",
      args: { keyword: "양식 서양음식점", region: "암사동" },
    });
    const intent = await classifySearchQuery({
      query: "암사동 캐나다 식당",
      locale: "ko",
      ai,
    });
    expect(intent).toEqual({
      kind: "place",
      keyword: "양식 서양음식점",
      region: "암사동",
    });
  });

  it("시의성 질의 → web{query}", async () => {
    const ai = mockAi({ name: "search_web", args: { query: "환율 최신" } });
    const intent = await classifySearchQuery({
      query: "환율 최신",
      locale: "ko",
      ai,
    });
    expect(intent).toEqual({ kind: "web", query: "환율 최신" });
  });

  it("region 없는 단순 장소 → place{keyword}", async () => {
    const ai = mockAi({ name: "search_places", args: { keyword: "카페" } });
    const intent = await classifySearchQuery({
      query: "길동 카페",
      locale: "ko",
      ai,
    });
    expect(intent).toEqual({ kind: "place", keyword: "카페" });
  });

  it("functionCall 없음 → place 기본값(원쿼리)", async () => {
    const ai = mockAi(null);
    const intent = await classifySearchQuery({
      query: "강남역 맛집",
      locale: "ko",
      ai,
    });
    expect(intent).toEqual({ kind: "place", keyword: "강남역 맛집" });
  });

  it("알 수 없는 도구 → place 기본값", async () => {
    const ai = mockAi({ name: "do_something", args: {} });
    const intent = await classifySearchQuery({
      query: "뭔가",
      locale: "ko",
      ai,
    });
    expect(intent).toEqual({ kind: "place", keyword: "뭔가" });
  });

  it("빈 keyword면 원쿼리로 보정", async () => {
    const ai = mockAi({ name: "search_places", args: { keyword: "" } });
    const intent = await classifySearchQuery({
      query: "강동 분식",
      locale: "ko",
      ai,
    });
    expect(intent).toEqual({ kind: "place", keyword: "강동 분식" });
  });

  it("Gemini throw → place 기본값(graceful degrade)", async () => {
    const ai = {
      models: { generateContent: vi.fn().mockRejectedValue(new Error("boom")) },
    };
    const intent = await classifySearchQuery({
      query: "에러쿼리",
      locale: "ko",
      ai,
    });
    expect(intent).toEqual({ kind: "place", keyword: "에러쿼리" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/lib/search-router/__tests__/classify.test.ts`
Expected: FAIL ("classifySearchQuery is not a function" / 모듈 없음).

- [ ] **Step 3: Write classify.ts**

```typescript
import type { GoogleGenAI, FunctionCall, Part } from "@google/genai";
import { GEMINI_MODEL } from "@/lib/gemini/client";
import { buildSearchDeclarations } from "./declarations";
import type { SearchIntent } from "./types";

/** classify가 필요로 하는 최소 클라이언트 표면(테스트 mock 가능). */
export type ClassifyClient = Pick<GoogleGenAI, "models">;

const SYSTEM_INSTRUCTION =
  "너는 검색창 쿼리 분류기다. 사용자의 자연어 검색어를 정확히 하나의 도구로 분류한다. " +
  "장소/상호/지역 검색이면 search_places로, 지역명과 카테고리를 분해한다(지역명은 region, 나머지는 keyword). " +
  "실재하지 않을 법한 표현은 카카오가 찾을 일반 카테고리로 바꾼다(예: '캐나다 식당'→'양식 서양음식점'). " +
  "시의성 웹 정보(뉴스·정책·환율·시세 등)면 search_web으로 분류한다. " +
  "산문이나 설명을 절대 출력하지 말고 반드시 도구를 호출한다.";

function firstFunctionCall(parts: Part[] | undefined): FunctionCall | null {
  if (!parts) return null;
  for (const p of parts) {
    if ("functionCall" in p && p.functionCall) return p.functionCall;
  }
  return null;
}

/**
 * Gemini 단발 분류(1왕복, 결과 관찰 없음). functionCall을 SearchIntent로 파싱한다.
 * 무응답·알 수 없는 도구·빈 keyword·throw는 모두 { kind:"place", keyword: query }로
 * graceful degrade(현행 naive 검색과 동일 동작) — 사용자에 에러를 노출하지 않는다.
 */
export async function classifySearchQuery(opts: {
  query: string;
  locale: string;
  ai: ClassifyClient;
}): Promise<SearchIntent> {
  const { query, locale, ai } = opts;
  const fallback: SearchIntent = { kind: "place", keyword: query };
  try {
    const res = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts: [{ text: `[locale=${locale}] ${query}` }] }],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        tools: [{ functionDeclarations: buildSearchDeclarations() }],
      },
    });
    const call = firstFunctionCall(res.candidates?.[0]?.content?.parts);
    if (!call) return fallback;

    if (call.name === "search_web") {
      const webQuery = String(call.args?.query ?? "").trim();
      if (!webQuery) return fallback;
      const recency = call.args?.recency ? String(call.args.recency) : undefined;
      return { kind: "web", query: webQuery, ...(recency ? { recency } : {}) };
    }
    if (call.name === "search_places") {
      const keyword = String(call.args?.keyword ?? "").trim() || query;
      const region = call.args?.region ? String(call.args.region).trim() : "";
      return { kind: "place", keyword, ...(region ? { region } : {}) };
    }
    return fallback;
  } catch {
    return fallback;
  }
}
```

> 참고: `GEMINI_MODEL`·`getGeminiClient`의 실제 export 경로는 `src/lib/gemini/`다. Task 시작 시 `grep -rn "export const GEMINI_MODEL\|export function getGeminiClient" src/lib/gemini/`로 정확한 파일명을 확인해 import 경로를 맞춘다(현재 `agent-loop.ts`가 재노출하나 원본은 client 모듈일 수 있음).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/lib/search-router/__tests__/classify.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(search): Gemini 단발 쿼리 분류기 classifySearchQuery

functionCall→SearchIntent 파싱, 무응답·throw·알수없는도구는 place 기본값으로
graceful degrade. ai 주입형이라 mock으로 결정적 테스트(7개).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UKHyhyt69nKrfPpzeLZ4P8" -- src/lib/search-router/classify.ts src/lib/search-router/__tests__/classify.test.ts
```

---

## Task 3: /api/search 라우트 오케스트레이터

**Files:**
- Create: `src/app/api/search/route.ts`
- (참고) Modify 없음 — 기존 provider/헬퍼 재사용

**Interfaces:**
- Consumes: `classifySearchQuery`, `pickAnchor`, `shouldFallbackToWeb`, `SearchRouteResult`(search-router); `searchPlaces`(providers/places), `searchAddress`(providers/kakao-address), `searchWebPerplexity`(chat/perplexity-search), `getGeminiClient`(gemini), `hasGeminiKey`/`hasPerplexityKey`/`hasKakaoKey`(env), `dataLocale`(data-locale).
- Produces: `GET /api/search?query&lang&lat&lng` → JSON `SearchRouteResult` (200), 입력 오류 400, 파국 502.

- [ ] **Step 1: Write route.ts**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { searchPlaces } from "@/lib/providers/places";
import { searchAddress } from "@/lib/providers/kakao-address";
import { searchWebPerplexity } from "@/lib/chat/perplexity-search";
import { getGeminiClient } from "@/lib/gemini/client";
import { hasGeminiKey, hasPerplexityKey, hasKakaoKey } from "@/lib/env";
import { dataLocale } from "@/lib/data-locale";
import { classifySearchQuery } from "@/lib/search-router/classify";
import { pickAnchor, shouldFallbackToWeb } from "@/lib/search-router/flow";
import type { RouterAnchor, SearchRouteResult } from "@/lib/search-router/types";
import type { WebSearchResult } from "@/lib/types";

/**
 * 검색창 자연어 라우터 — Gemini 단발 분류로 search_places(+지역 앵커)/search_web 중
 * 하나를 골라 실행한다. 주소(juso)는 이 라우트가 아니라 클라이언트가 /api/address/search로
 * 병렬 호출한다(무료·결정론 — LLM 뒤에 둘 이유 없음). Gemini 키 없으면 naive 장소검색(회귀 0).
 */

const querySchema = z.object({
  query: z.string().trim().min(1, "검색어가 비어 있습니다").max(100),
  lang: z.enum(["ko", "en"]).default("ko"),
  lat: z.coerce.number().min(-90).max(90).optional().catch(undefined),
  lng: z.coerce.number().min(-180).max(180).optional().catch(undefined),
});

/** searchWebPerplexity ToolResult의 render에서 웹 결과 배열을 추출. */
function extractWeb(toolResult: { render?: { type: string; results?: WebSearchResult[] } }): WebSearchResult[] {
  const r = toolResult.render;
  return r && r.type === "web-results" && r.results ? r.results : [];
}

export async function GET(request: NextRequest) {
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
  const { query, lang, lat, lng } = parsed.data;
  const dl = dataLocale(lang);
  const userCoords: RouterAnchor | null =
    lat != null && lng != null ? { lat, lng } : null;

  // naive 장소검색(라우터 미적용/폴백 공통).
  const naivePlace = async (): Promise<SearchRouteResult> => {
    const r = await searchPlaces({ query, lang: dl, lat: lat, lng: lng });
    return { kind: "place", places: r.places };
  };

  try {
    // 1. Gemini 키 없음 → 현행 결정론 동작.
    if (!hasGeminiKey()) {
      return NextResponse.json(await naivePlace());
    }
    const ai = getGeminiClient();
    if (!ai) return NextResponse.json(await naivePlace());

    // 2. 단발 분류.
    const intent = await classifySearchQuery({ query, locale: lang, ai });

    // 3-A. 웹 라우팅(길 A).
    if (intent.kind === "web") {
      const tr = await searchWebPerplexity({
        query: intent.query,
        ...(intent.recency ? { search_recency_filter: intent.recency } : {}),
      });
      const web = extractWeb(tr);
      const result: SearchRouteResult = { kind: "web", web };
      return NextResponse.json(result);
    }

    // 3-B. 장소(지역 앵커링).
    let geocoded: RouterAnchor | null = null;
    if (intent.region && hasKakaoKey()) {
      try {
        const matches = await searchAddress(intent.region, 1);
        const m = matches[0];
        if (m && typeof m.lat === "number" && typeof m.lng === "number") {
          geocoded = { lat: m.lat, lng: m.lng };
        }
      } catch {
        geocoded = null; // 지오코딩 실패 → userCoords 앵커로 graceful
      }
    }
    const anchor = pickAnchor(geocoded, userCoords);
    const placeR = await searchPlaces({
      query: intent.keyword,
      lang: dl,
      lat: anchor?.lat,
      lng: anchor?.lng,
    });

    // 3-C. 0건 → 웹 폴백(길 B, 코드 결정).
    if (shouldFallbackToWeb(placeR.places.length, hasPerplexityKey())) {
      const tr = await searchWebPerplexity({ query });
      const web = extractWeb(tr);
      if (web.length > 0) {
        const result: SearchRouteResult = { kind: "web", web, fallbackFrom: "place" };
        return NextResponse.json(result);
      }
    }
    const result: SearchRouteResult = { kind: "place", places: placeR.places };
    return NextResponse.json(result);
  } catch (e) {
    console.error("[api/search] 라우터 실패, naive 폴백 시도:", e);
    // 분류/실행 중 예외 → naive 장소검색으로 최후 폴백, 그것도 실패면 502.
    try {
      return NextResponse.json(await naivePlace());
    } catch {
      return NextResponse.json(
        { error: "검색에 실패했습니다. 잠시 후 다시 시도해 주세요." },
        { status: 502 },
      );
    }
  }
}
```

> Task 시작 시 확인: (a) `AddressMatch`의 좌표 필드명이 `lat`/`lng`인지 `grep -n "interface AddressMatch" -A8 src/lib/types.ts`로 확인하고 다르면 맞춘다. (b) `searchPlaces` params 타입(`PlaceSearchParams`)에 `lang`이 `"ko"|"en"`인지 확인 — `dataLocale`이 그 유니온을 반환한다. (c) `getGeminiClient`·`GEMINI_MODEL` import 경로 확정.

- [ ] **Step 2: lint + build로 타입·라우트 검증**

Run: `npm run lint && npm run build`
Expected: 통과(타입 에러 0). 라우트 핸들러는 node-env 단위 테스트 레인이 없어 실호출(Task 6)이 게이트.

- [ ] **Step 3: 로컬 실호출 스모크(키 있는 경우)**

```bash
npm run dev &  # 백그라운드, 잠시 후
curl -s "http://localhost:3000/api/search?query=$(python3 -c "import urllib.parse;print(urllib.parse.quote('길동 카페'))")&lang=ko" | python3 -m json.tool
```
Expected: `{"kind":"place","places":[...]}`(카페 결과). 빈 query는 400.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(search): /api/search 라우터 오케스트레이터

Gemini 단발 분류→search_places(지역 지오코딩 앵커)/search_web 디스패치,
장소 0건이면 코드가 결정적으로 웹 폴백(길 B). 키 없음·예외는 naive 장소검색
폴백(회귀 0), 파국만 502.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UKHyhyt69nKrfPpzeLZ4P8" -- src/app/api/search/route.ts
```

---

## Task 4: search-sections.ts — 웹 섹션 확장

**Files:**
- Modify: `src/lib/search-sections.ts`
- Test: `src/lib/__tests__/search-sections.test.ts` (기존 파일에 케이스 추가 — 경로는 시작 시 `find src -name "search-sections.test.ts"`로 확인)

**Interfaces:**
- Produces:
  - `type SectionKind = "place" | "address" | "web"`
  - `orderResultSections(placeCount: number, addrCount: number, webCount?: number): SectionKind[]`
  - `combinedLiveMessage(input: { loading; placeCount; addrCount; webCount; webFallback; spokenQuery; placeErrored }): LiveSpec | null`

- [ ] **Step 1: Write failing tests (추가)**

```typescript
// search-sections.test.ts 에 추가
import { orderResultSections, combinedLiveMessage } from "@/lib/search-sections";

describe("orderResultSections — 웹", () => {
  it("웹만 있으면 web 단독", () => {
    expect(orderResultSections(0, 0, 3)).toEqual(["web"]);
  });
  it("웹+주소면 건수 내림차순(웹>주소)", () => {
    expect(orderResultSections(0, 2, 5)).toEqual(["web", "address"]);
    expect(orderResultSections(0, 5, 2)).toEqual(["address", "web"]);
  });
  it("place와 web은 상호배타라 동시 호출 안 됨 — place만이면 기존대로", () => {
    expect(orderResultSections(3, 0, 0)).toEqual(["place"]);
  });
});

describe("combinedLiveMessage — 웹", () => {
  const base = { loading: false, spokenQuery: null, placeErrored: false };
  it("웹 폴백(장소 0)이면 webFallback 통지", () => {
    expect(
      combinedLiveMessage({ ...base, placeCount: 0, addrCount: 0, webCount: 4, webFallback: true }),
    ).toEqual({ key: "search.webFallbackAnnouncement", values: { count: 4 } });
  });
  it("웹 단독(길 A)이면 web 통지", () => {
    expect(
      combinedLiveMessage({ ...base, placeCount: null, addrCount: 0, webCount: 4, webFallback: false }),
    ).toEqual({ key: "search.webResultsAnnouncement", values: { count: 4 } });
  });
  it("웹+주소 둘 다면 합산 통지", () => {
    expect(
      combinedLiveMessage({ ...base, placeCount: null, addrCount: 2, webCount: 4, webFallback: false }),
    ).toEqual({ key: "search.webAndAddressAnnouncement", values: { web: 4, addr: 2 } });
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm run test:run -- search-sections`
Expected: FAIL(웹 케이스 미구현).

- [ ] **Step 3: Modify search-sections.ts**

`SectionKind` 변경:
```typescript
export type SectionKind = "place" | "address" | "web";
```

`orderResultSections`에 `webCount` 추가(place/web 상호배타라 우선순위 place>web>address):
```typescript
export function orderResultSections(
  placeCount: number,
  addrCount: number,
  webCount = 0,
): SectionKind[] {
  const present: { kind: SectionKind; count: number; rank: number }[] = [];
  if (placeCount > 0) present.push({ kind: "place", count: placeCount, rank: 0 });
  if (webCount > 0) present.push({ kind: "web", count: webCount, rank: 1 });
  if (addrCount > 0) present.push({ kind: "address", count: addrCount, rank: 2 });
  // 건수 내림차순, 동률이면 rank(place>web>address) 우선.
  present.sort((a, b) => b.count - a.count || a.rank - b.rank);
  return present.map((s) => s.kind);
}
```

`combinedLiveMessage`에 `webCount`·`webFallback` 추가. 함수 본문을 다음으로 교체:
```typescript
export function combinedLiveMessage(input: {
  loading: boolean;
  placeCount: number | null;
  addrCount: number | null;
  webCount: number | null;
  webFallback: boolean;
  spokenQuery: string | null;
  placeErrored: boolean;
}): LiveSpec | null {
  const { loading, placeCount, addrCount, webCount, spokenQuery, placeErrored, webFallback } = input;
  if (loading) {
    return { key: spokenQuery ? "search.searchingFor" : "search.searching" };
  }
  if (placeCount === null && addrCount === null && webCount === null && !placeErrored) {
    return null;
  }
  const place = placeCount ?? 0;
  const addr = addrCount ?? 0;
  const web = webCount ?? 0;
  // 웹 결과(길 A/B) — place와 상호배타.
  if (web > 0) {
    if (addr > 0) {
      return { key: "search.webAndAddressAnnouncement", values: { web, addr } };
    }
    return webFallback
      ? { key: "search.webFallbackAnnouncement", values: { count: web } }
      : { key: "search.webResultsAnnouncement", values: { count: web } };
  }
  if (place > 0 && addr > 0) {
    return { key: "search.combinedAnnouncement", values: { place, addr } };
  }
  if (addr > 0) {
    return { key: "search.addressResultsAnnouncement", values: { count: addr } };
  }
  if (placeErrored) {
    return { key: "search.error" };
  }
  return { key: "search.resultsAnnouncement", values: { count: place } };
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test:run -- search-sections`
Expected: PASS(기존 + 신규 웹 케이스). 기존 호출부(PlaceSearch)는 Task 5에서 새 시그니처로 맞춘다 — 이 Task 단독으론 빌드가 깨질 수 있으니 Task 5와 연속 실행한다.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(search): search-sections 웹 섹션 확장

SectionKind에 web 추가, orderResultSections webCount 인자(place>web>address 우선),
combinedLiveMessage webCount·webFallback(길A 단독·길B 폴백·웹+주소 합산 통지).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UKHyhyt69nKrfPpzeLZ4P8" -- src/lib/search-sections.ts src/lib/__tests__/search-sections.test.ts
```

---

## Task 5: WebResults 이동 + PlaceSearch 와이어링 + i18n

**Files:**
- Move: `src/components/chat/WebResults.tsx` → `src/components/WebResults.tsx` (chat의 import 경로도 갱신)
- Modify: `src/components/PlaceSearch.tsx`
- Modify: `messages/{ko,en,es,fr,it}.json`

**Interfaces:**
- Consumes: `/api/search` `SearchRouteResult`, `WebResults`({results}), `orderResultSections`/`combinedLiveMessage`(신규 시그니처).

- [ ] **Step 1: WebResults 이동**

```bash
git mv src/components/chat/WebResults.tsx src/components/WebResults.tsx
grep -rln "chat/WebResults\|components/chat/WebResults" src/ # import 경로 쓰는 곳 찾기
```
`src/components/chat/`에서 `WebResults`를 import하던 파일(MessageBubble 등)의 경로를 `@/components/WebResults`로 수정. `WebResults.tsx` 내부의 상대 import(`@/lib/types` 등)는 절대경로라 영향 없음 — 단 `../` 상대경로가 있으면 한 단계 보정.

- [ ] **Step 2: i18n 키 추가(messages/ko.json `search` 블록)**

```json
"webResultsAnnouncement": "웹 결과 {count}건",
"webFallbackAnnouncement": "장소를 찾지 못해 웹에서 {count}건을 찾았습니다",
"webAndAddressAnnouncement": "웹 결과 {web}건, 주소 {addr}건",
"webSectionHeading": "웹"
```
en/es/fr/it에도 동일 키를 각 언어로 추가(아래 번역, ICU 플레이스홀더 동일 유지):
- en: `"webResultsAnnouncement": "{count} web results"`, `"webFallbackAnnouncement": "No places found; found {count} web results instead"`, `"webAndAddressAnnouncement": "{web} web results, {addr} addresses"`, `"webSectionHeading": "Web"`
- es: `"{count} resultados web"` / `"No se encontraron lugares; se encontraron {count} resultados web"` / `"{web} resultados web, {addr} direcciones"` / `"Web"`
- fr: `"{count} résultats web"` / `"Aucun lieu trouvé ; {count} résultats web trouvés"` / `"{web} résultats web, {addr} adresses"` / `"Web"`
- it: `"{count} risultati web"` / `"Nessun luogo trovato; trovati {count} risultati web"` / `"{web} risultati web, {addr} indirizzi"` / `"Web"`

- [ ] **Step 3: PlaceSearch.tsx — performSearch가 /api/search 호출 + {kind} 분기**

`performSearch`를 `/api/places` 대신 `/api/search` 호출로 바꾸고, 응답을 `SearchRouteResult`로 받아 place/web 상태를 분리 저장한다. 핵심 변경(정확한 라인은 시작 시 `grep -n "performSearch\|/api/places\|rawPlaces\|setPlaces" src/components/PlaceSearch.tsx`로 확인):

1. 상태 추가: 웹 결과·웹폴백 플래그.
```typescript
const [webResults, setWebResults] = useState<WebSearchResult[] | null>(null);
const [webFallback, setWebFallback] = useState(false);
```
2. `performSearch` fetch 대상 교체:
```typescript
// 기존: `/api/places?query=...&lang=...${coordQuery}`
const url = `/api/search?query=${encodeURIComponent(raw)}&lang=${dataLocale(locale)}${coordQuery}`;
const res = await fetch(url);
if (!res.ok) throw new Error(`search ${res.status}`);
const data = (await res.json()) as SearchRouteResult;
if (data.kind === "web") {
  setWebResults(data.web);
  setWebFallback(data.fallbackFrom === "place");
  setRawPlaces([]); // 장소 섹션 비움(상호배타)
} else {
  setRawPlaces(data.places);
  setWebResults(null);
  setWebFallback(false);
}
```
   - `coordQuery`는 기존 `userCoords` 기반 `&lat=&lng=` 그대로 재사용.
   - `lang` 파라미터는 기존이 `locale`이었다면 `dataLocale(locale)`로 맞춘다(라우트 zod가 ko|en).
3. `combinedLiveMessage` 호출에 `webCount`·`webFallback` 전달:
```typescript
combinedLiveMessage({
  loading,
  placeCount: /* 기존 */,
  addrCount: /* 기존 */,
  webCount: webResults ? webResults.length : null,
  webFallback,
  spokenQuery,
  placeErrored,
});
```
4. `orderResultSections` 호출에 `webResults?.length ?? 0` 전달, 렌더 분기에서 `"web"` 섹션이면 `<WebResults results={webResults!} />`를 그린다(단일 섹션이면 헤딩 생략, 주소와 공존 시 `search.webSectionHeading` h3 — 기존 place/address 헤딩 규칙과 동일 패턴).
5. 새 검색 시작 시 `setWebResults(null); setWebFallback(false)` 리셋(stale 웹 잔류 방지). import 추가: `WebSearchResult`(@/lib/types), `WebResults`(@/components/WebResults), `dataLocale`(@/lib/data-locale, 이미 있으면 재사용).

- [ ] **Step 4: lint + build + 기존 테스트**

Run: `npm run lint && npm run build && npm run test:run`
Expected: 전부 통과(타입·i18n 키 일관성 `i18n-messages.test.ts` 포함).

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(search): 검색창을 /api/search 라우터에 연결 + 웹 섹션 렌더

performSearch가 /api/search 호출, SearchRouteResult {kind} 분기(place→ResultList,
web→WebResults). 주소 병렬 불변. WebResults를 chat 밖으로 이동. 웹 통지 i18n 5종.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UKHyhyt69nKrfPpzeLZ4P8" -- src/components/PlaceSearch.tsx src/components/WebResults.tsx src/components/chat/MessageBubble.tsx messages/ko.json messages/en.json messages/es.json messages/fr.json messages/it.json
```
(실제 변경 파일만 stage — `git status`로 chat import 경로를 고친 파일을 확인해 포함.)

---

## Task 6: 실호출 효과성 검증 + 리뷰

**Files:** 변경 없음(검증·리뷰 단계). 발견된 결함은 해당 Task 파일로 되돌아가 수정.

- [ ] **Step 1: dev 서버 기동 + 다양한 시나리오 실호출**

`npm run dev` 후 각 시나리오를 `/api/search`로 실호출하고 응답 `kind`·내용을 기록한다(KST 기준):

| 시나리오 | 쿼리 | 기대 |
|---|---|---|
| 복합 의미(핵심) | `암사동 캐나다 식당` | place(암사동 앵커, 양식류) 또는 길 B web(fallbackFrom:place) |
| 지역 앵커링 | `강동역 근처 맛집` | place, 결과가 강동역 인근 |
| 단순 회귀 | `길동 카페` | **place, web 미발동**(회귀 가드) |
| 시의성 웹(길 A) | `환율 최신` | web |
| 웹 정책 | `스페인 입국 정책 최신` | web |
| 주소 병렬 | `세종대로 110`(+`/api/address/search`) | 주소 섹션 존재 |
| 지역 이동 | 길동 좌표로 `해운대 카페` | place, 해운대 앵커 |
| 무결과 graceful | `asdfqwer존재안함zxcv` | place 0건 또는 web 폴백(에러 아님) |
| 입력 검증 | 빈 query | 400 |

각 호출을 `curl`로 실행, 응답을 `/tmp/search-router-verify/results.log`에 append(타임스탬프 포함).

- [ ] **Step 2: 회귀·효과성 판정**

- 핵심 성과(spec §1) 충족 확인: 복합 의미 쿼리가 결과를 내는가, 지역 앵커링이 동작하는가, 웹 라우팅이 되는가, 단순 검색이 그대로인가.
- `길동 카페`가 web으로 새지 않는지(오버라우팅), `환율 최신`이 place로 새지 않는지(언더라우팅) 양방향 확인.
- 실패 시 systemInstruction/declaration description을 조정(분류 latent라 프롬프트가 제어판) 후 재검증.

- [ ] **Step 3: 코드 리뷰**

`code-reviewer` 서브에이전트로 전체 diff(Task 1~5) 리뷰 — 라우트 에러 경로·타입 안전·앵커 폴백·접근성 통지. UI 변경분은 `a11y-auditor`로 점검. 지적은 글로벌 "리뷰 처리" 원칙(계층 대조 우선)으로 처리.

- [ ] **Step 4: 최종 게이트 + 푸시**

```bash
npm run lint && npm run build && npm run test:run
```
전부 green이면 gildongmu 자동 commit+push 관례에 따라 push(자동배포). 프로덕션은 `GEMINI_API_KEY`·`PERPLEXITY_API_KEY` 이미 등록됨(CLAUDE.md) — 배포 후 `gildongmu.vercel.app/api/search` 1~2개 시나리오 실호출로 프로덕션 검증.

- [ ] **Step 5: 문서 갱신**

`CLAUDE.md` 아키텍처에 "검색창 자연어 라우터" 항목 추가(spec·plan 경로, 핵심 불변식, 실호출 검증 결과), `python sync_agent_docs.py`로 AGENTS.md 재생성. 커밋.

---

## Self-Review (작성자 점검)

- **Spec 커버리지**: §1 목표 1(복합 의미 분해)→Task2 classify+Task3 라우트, 목표 2(지역 앵커)→Task3 geocode+pickAnchor, 목표 3(웹 라우팅)→Task2/3 길 A, 목표 4(회귀 0)→Task3 hasGeminiKey 폴백+Task6 회귀 가드. §2 결정 전부 반영. §4 모듈 전부 Task화. §6 접근성→Task4/5, 에러→Task3. §7 테스트→Task1/2/4 단위 + Task6 실호출. ✅
- **Placeholder**: 모든 코드 단계에 완전한 코드. "시작 시 확인" 주석은 import 경로 등 환경 의존 1줄 검증이지 미완성 아님. ✅
- **타입 일관성**: `SearchIntent`/`SearchRouteResult`/`RouterAnchor`가 Task1 정의 → Task2/3/5에서 동일 사용. `classifySearchQuery`/`pickAnchor`/`shouldFallbackToWeb`/`orderResultSections`/`combinedLiveMessage` 시그니처 전 Task 일치. `extractWeb`는 `searchWebPerplexity` ToolResult.render 구조와 정합. ✅
- **알려진 환경 의존(시작 시 확인 명시됨)**: `getGeminiClient`/`GEMINI_MODEL` 경로, `AddressMatch` 좌표 필드명, chat의 WebResults import 경로. 각 Task에 grep 1줄로 박음.
