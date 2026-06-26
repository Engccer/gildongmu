# 검색 라우터 제거 + 웹 섹션 결정론적 병렬 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gemini 자연어 검색 라우터(`/api/search` + `src/lib/search-router/`)를 통째로 제거하고, 검색창이 장소(`/api/places`)·주소(`/api/address/search`)·웹(`/api/search/web`) 세 섹션을 결정론적으로 항상 병렬 호출하는 구조로 되돌린다.

**Architecture:** 라우터의 세 기능 중 키워드 재해석(해로움)·웹 분류(부정확)·지역 앵커링(카카오 키워드가 자체 처리하는 중복)이 모두 순가치 음수임이 실측으로 확인됐다(위스키바→"바" 축약이 미용실 매칭, "암사동 위스키바" 원문은 카카오가 정확 처리). LLM을 제거하고 deterministic 도구 3개를 병렬 발사한다. place/web/address가 **공존**하므로(라우터 시절 place⊕web 상호배타 가정을 폐기), `orderResultSections`·`combinedLiveMessage`를 공존 모델로 바꾼다.

**Tech Stack:** Next.js 16 (App Router), TypeScript, next-intl 4, zod 4, Vitest 4. `src/lib/search-sections.ts`는 React 비의존 순수 로직(TDD 레인 보유). Perplexity Search API(서버 전용).

## Global Constraints

- **항상 병렬**: 웹 섹션은 매 검색마다 호출한다(위원장 명시 동의 2026-06-27 — 비용 게이트 통과). "0건 폴백"·"시의성 조건부" 개념은 폐기.
- **게이트 유지**: `canSearchWeb`(`hasPerplexityKey()`) 없으면 웹 호출·섹션·통지 없음(회귀 0). `canSearchAddress`(`hasJusoKey()`) 기존 패턴 동형.
- **접근성**: 단일 polite live region. 통지는 0이 아닌 섹션을 콤마로 나열("장소 12건, 웹 5건, 주소 2건"). 포커스는 세 섹션 **모두 settled 후 1회** 결과 헤딩으로. UI 라벨 이모지 금지.
- **순수 로직 분리**: `search-sections.ts`는 React/Next/i18n 비의존 — 통지는 `{key, values}` 스펙만 반환하고 `t()`는 컴포넌트가. dodo-planet 이식성 위해 유지.
- **`PLACES_PROVIDER`·좌표 거리정렬**: `/api/places`는 좌표(`lat`/`lng`) 넘기면 `sort=distance`로 거리순(기존 동작 그대로). 라우터 제거로 바뀌지 않는다.
- **언어**: 코드 주석·커밋·문서 한국어. 변수/함수명 영어. i18n 5개 언어(ko/en/es/fr/it) 키 집합 동일성은 `i18n-messages.test.ts`가 게이트.
- **커밋**: 이메일 `engccer@gmail.com`. `git add -A` 금지 — 의도 경로만 `git commit -- <경로>`. 리뷰 통과 후 commit+push 자동(자동배포), 푸시 전 `git show HEAD --stat`로 의도 파일만 들었는지 검증.

---

### Task 1: `/api/search/web` 웹 검색 엔드포인트 신설

검색창이 직접 부를 수 있는 결정론적 웹 검색 라우트. `searchWebPerplexity`(Gemini function-call 인자형)를 GET 쿼리로 래핑하고 `WebSearchResult[]`만 반환한다.

**Files:**
- Create: `src/app/api/search/web/route.ts`
- Reference: `src/lib/chat/perplexity-search.ts:45` (`searchWebPerplexity(args): Promise<ToolResult>`), `src/lib/types.ts:648` (`WebSearchResult`), `src/lib/env.ts:139` (`hasPerplexityKey`)

**Interfaces:**
- Produces: GET `/api/search/web?query=<string>` → `200 { web: WebSearchResult[] }` (성공) / `200 { web: [] }` (Perplexity 키 없음·결과 없음·내부 실패 — graceful, 검색창은 보조 섹션이라 에러를 사용자에 노출하지 않음) / `400 { error }` (빈 query).
- `WebSearchResult = { title: string; url: string; snippet: string; date: string | null }`.

- [ ] **Step 1: 라우트 작성**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { searchWebPerplexity } from "@/lib/chat/perplexity-search";
import { hasPerplexityKey } from "@/lib/env";
import type { ToolResult } from "@/lib/chat/types";
import type { WebSearchResult } from "@/lib/types";

/**
 * 검색창 웹 섹션 — Perplexity Search를 GET 쿼리로 래핑한다. 장소·주소와 함께
 * 매 검색마다 병렬 호출되는 보조 섹션이라, 키 없음·결과 없음·내부 실패는 모두
 * 빈 배열로 graceful degrade한다(섹션 미렌더). LLM 분류 없음 — 결정론.
 */
const querySchema = z.object({
  query: z.string().trim().min(1, "검색어가 비어 있습니다").max(100),
});

function extractWeb(tr: ToolResult): WebSearchResult[] {
  const r = tr.render;
  return r && r.type === "web-results" ? r.results : [];
}

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({
    query: request.nextUrl.searchParams.get("query") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "잘못된 요청" },
      { status: 400 },
    );
  }
  // 키 없으면 빈 배열(섹션 미노출) — canSearchWeb 게이트와 일관, 호출 자체가 안 옴이 정상.
  if (!hasPerplexityKey()) return NextResponse.json({ web: [] });
  try {
    const tr = await searchWebPerplexity({ query: parsed.data.query, max_results: 5 });
    return NextResponse.json({ web: extractWeb(tr) });
  } catch {
    // 보조 섹션이라 실패를 사용자에 노출하지 않고 빈 배열로 degrade.
    return NextResponse.json({ web: [] });
  }
}
```

- [ ] **Step 2: 빌드·린트 검증**

Run: `npm run lint && npm run build`
Expected: 통과(타입 에러 없음). `ToolResult.render.type === "web-results"` 판별이 타입 좁히기로 동작하는지 확인 — 안 되면 `perplexity-search.ts`의 `ToolResult` 정의를 보고 `render` 판별 유니온 형태에 맞춰 좁힌다.

- [ ] **Step 3: 실호출 검증(dev 서버)**

Run:
```bash
npm run dev &  # 이미 떠 있으면 생략
sleep 4
curl -s "http://localhost:3000/api/search/web?query=%ED%99%98%EC%9C%A8%20%EC%B5%9C%EC%8B%A0" | python3 -c "import sys,json;d=json.load(sys.stdin);print('web 건수:',len(d.get('web',[])));[print(' -',w['title'],'|',w['url']) for w in d['web'][:3]]"
curl -s -o /dev/null -w "빈쿼리 HTTP %{http_code}\n" "http://localhost:3000/api/search/web?query="
```
Expected: "환율 최신" → web ≥1건(제목·URL). 빈쿼리 → HTTP 400.

- [ ] **Step 4: 커밋**

```bash
git commit -- src/app/api/search/web/route.ts -m "feat(search): /api/search/web 결정론적 Perplexity 웹 검색 엔드포인트"
```

---

### Task 2: `search-sections.ts` 공존 모델로 재설계 (TDD)

place/web/address가 공존하므로 `combinedLiveMessage`를 "0이 아닌 섹션을 부분(part)으로 나열"하는 형태로 바꾸고, `orderResultSections`의 상호배타 가정을 제거한다. 순수 로직이라 TDD.

**Files:**
- Modify: `src/lib/search-sections.ts`
- Test: `src/lib/__tests__/search-sections.test.ts` (기존 파일 — 경로는 `git ls-files | grep search-sections` 로 확인 후 동일 위치에 추가)

**Interfaces:**
- Produces:
  - `orderResultSections(placeCount, addrCount, webCount=0): SectionKind[]` — **시그니처 불변**, 공존 시 건수 내림차순·동률 시 place>web>address. (기존 로직이 이미 공존 지원 — 주석·테스트만 수정)
  - `combinedLiveMessage(input): LivePart[] | null` — **반환 타입 변경**(`LiveSpec | null` → `LivePart[] | null`). `webFallback` 입력 필드 제거.
  - `export type LivePart = { key: string; values?: Record<string, number> }`

- [ ] **Step 1: 실패 테스트 작성 (combinedLiveMessage 공존)**

기존 `search-sections.test.ts`에 추가(기존 `LiveSpec` 단일반환 기대 테스트는 이 Task에서 새 배열형으로 갱신):

```typescript
import { describe, it, expect } from "vitest";
import { combinedLiveMessage, orderResultSections } from "../search-sections";

describe("combinedLiveMessage 공존 모델", () => {
  const base = { loading: false, spokenQuery: null, placeErrored: false };

  it("장소·웹·주소 모두 있으면 세 part를 순서대로", () => {
    expect(
      combinedLiveMessage({ ...base, placeCount: 12, webCount: 5, addrCount: 2 }),
    ).toEqual([
      { key: "search.placeCount", values: { count: 12 } },
      { key: "search.webCount", values: { count: 5 } },
      { key: "search.addressCount", values: { count: 2 } },
    ]);
  });

  it("장소만 있으면 placeCount 단일 part", () => {
    expect(
      combinedLiveMessage({ ...base, placeCount: 8, webCount: 0, addrCount: 0 }),
    ).toEqual([{ key: "search.placeCount", values: { count: 8 } }]);
  });

  it("웹만 있으면 webCount 단일 part(장소 0건이어도 noResults 아님)", () => {
    expect(
      combinedLiveMessage({ ...base, placeCount: 0, webCount: 3, addrCount: 0 }),
    ).toEqual([{ key: "search.webCount", values: { count: 3 } }]);
  });

  it("loading이면 searching", () => {
    expect(
      combinedLiveMessage({ ...base, loading: true, placeCount: null, webCount: null, addrCount: null }),
    ).toEqual([{ key: "search.searching" }]);
  });

  it("loading + spokenQuery면 searchingFor", () => {
    expect(
      combinedLiveMessage({ ...base, loading: true, spokenQuery: "길동 카페", placeCount: null, webCount: null, addrCount: null }),
    ).toEqual([{ key: "search.searchingFor" }]);
  });

  it("검색 전 idle(모두 null·비에러)이면 null", () => {
    expect(
      combinedLiveMessage({ ...base, placeCount: null, webCount: null, addrCount: null }),
    ).toBeNull();
  });

  it("모두 0건 + 장소 에러면 search.error", () => {
    expect(
      combinedLiveMessage({ ...base, placeCount: null, webCount: 0, addrCount: 0, placeErrored: true }),
    ).toEqual([{ key: "search.error" }]);
  });

  it("모두 0건 + 에러 아님이면 noResults", () => {
    expect(
      combinedLiveMessage({ ...base, placeCount: 0, webCount: 0, addrCount: 0 }),
    ).toEqual([{ key: "search.noResults" }]);
  });
});

describe("orderResultSections 공존", () => {
  it("place·web 동시에 건수 내림차순", () => {
    expect(orderResultSections(3, 0, 5)).toEqual(["web", "place"]);
    expect(orderResultSections(10, 0, 5)).toEqual(["place", "web"]);
  });
  it("셋 동시 — 건수 내림차순, 동률 place>web>address", () => {
    expect(orderResultSections(4, 4, 4)).toEqual(["place", "web", "address"]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm run test:run -- search-sections`
Expected: FAIL — `combinedLiveMessage`가 아직 `LiveSpec`(객체)을 반환해 배열 기대와 불일치.

- [ ] **Step 3: `combinedLiveMessage` 재구현**

`src/lib/search-sections.ts`의 `combinedLiveMessage` 전체와 `LiveSpec` 타입을 교체:

```typescript
export type LivePart = { key: string; values?: Record<string, number> };

/**
 * 단일 polite 채널 통지(부분 배열). loading이면 검색 중(음성이면 searchingFor),
 * 완료면 0이 아닌 섹션(장소·웹·주소)을 차례로 part로 쌓아 호출부가 ", "로 잇는다.
 * 모두 0이면 장소 에러는 error, 아니면 noResults. 검색 전 idle은 null(통지 없음).
 * place·web·address는 항상 병렬이라 공존한다(라우터 시절 place⊕web 상호배타 폐기).
 */
export function combinedLiveMessage(input: {
  loading: boolean;
  placeCount: number | null;
  addrCount: number | null;
  webCount?: number | null;
  spokenQuery: string | null;
  placeErrored: boolean;
}): LivePart[] | null {
  const { loading, placeCount, addrCount, spokenQuery, placeErrored } = input;
  const webCount = input.webCount ?? null;
  // 1. 로딩 우선(실패 단정 금지).
  if (loading) {
    return [{ key: spokenQuery ? "search.searchingFor" : "search.searching" }];
  }
  // 2. 비로딩 + 모두 미실행 + 에러 아님 = idle(통지 없음).
  if (placeCount === null && addrCount === null && webCount === null && !placeErrored) {
    return null;
  }
  const place = placeCount ?? 0;
  const web = webCount ?? 0;
  const addr = addrCount ?? 0;
  const parts: LivePart[] = [];
  if (place > 0) parts.push({ key: "search.placeCount", values: { count: place } });
  if (web > 0) parts.push({ key: "search.webCount", values: { count: web } });
  if (addr > 0) parts.push({ key: "search.addressCount", values: { count: addr } });
  if (parts.length > 0) return parts;
  // 3. 보여줄 결과 0 — 장소 에러면 실패 통지(무음 방지), 아니면 결과 없음.
  if (placeErrored) return [{ key: "search.error" }];
  return [{ key: "search.noResults" }];
}
```

`orderResultSections`는 로직 불변 — 줄 13의 주석 `// place와 web은 라우터가 하나만 선택하므로 상호배타(동시 >0 안 됨).` 을 `// place·web·address는 항상 병렬이라 공존 가능. 건수 내림차순으로 가장 많은 섹션을 위로.` 로 교체.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm run test:run -- search-sections`
Expected: PASS(추가 8개 포함 전체).

- [ ] **Step 5: 커밋**

```bash
git commit -- src/lib/search-sections.ts src/lib/__tests__/search-sections.test.ts -m "refactor(search): combinedLiveMessage를 공존 part 배열로 — place·web·address 동시 통지"
```

---

### Task 3: i18n 통지 키 신설/정리 (5개 언어)

새 카운트 키를 5개 언어에 추가하고, 라우터 시절 조합 키를 제거한다.

**Files:**
- Modify: `messages/ko.json`, `messages/en.json`, `messages/es.json`, `messages/fr.json`, `messages/it.json`
- Test: `src/lib/__tests__/i18n-messages.test.ts` (키 집합 동일성 게이트)

**Interfaces:**
- Produces(추가): `search.placeCount`("장소 {count}건"), `search.webCount`("웹 {count}건"), `search.addressCount`("주소 {count}건"), `search.noResults`("결과가 없습니다").
- Removes: `search.combinedAnnouncement`, `search.addressResultsAnnouncement`, `search.resultsAnnouncement`, `search.webResultsAnnouncement`, `search.webFallbackAnnouncement`, `search.webAndAddressAnnouncement`.
- 유지: `search.searching`, `search.searchingFor`, `search.error`, `search.addressCoordFailed`, `search.webSection`.

- [ ] **Step 1: 제거 대상 키의 현재 참조 0 확인**

Run: `grep -rn "combinedAnnouncement\|addressResultsAnnouncement\|resultsAnnouncement\|webResultsAnnouncement\|webFallbackAnnouncement\|webAndAddressAnnouncement" src`
Expected: Task 2 이후 `search-sections.ts`에는 더 이상 없음. PlaceSearch는 Task 4에서 정리되므로 이 Task를 Task 4 **이후**에 실행하거나, PlaceSearch가 `t()`로 키를 동적 참조하지 않는지 확인(현재 `liveSpec.key`로 동적 참조 → Task 4 완료 후 죽은 키 제거가 안전). **실행 순서: Step 2(키 추가)는 지금, Step 3(키 제거)는 Task 4 완료 후.**

- [ ] **Step 2: 새 카운트 키 추가 (5개 언어 동시)**

각 `messages/*.json`의 `search` 객체에 추가. ICU 플레이스홀더 `{count}` 5언어 동일.

```jsonc
// ko.json search 객체에
"placeCount": "장소 {count}건",
"webCount": "웹 {count}건",
"addressCount": "주소 {count}건",
"noResults": "결과가 없습니다",
```
```jsonc
// en.json
"placeCount": "{count} places",
"webCount": "{count} web results",
"addressCount": "{count} addresses",
"noResults": "No results",
```
```jsonc
// es.json
"placeCount": "{count} lugares",
"webCount": "{count} resultados web",
"addressCount": "{count} direcciones",
"noResults": "Sin resultados",
```
```jsonc
// fr.json
"placeCount": "{count} lieux",
"webCount": "{count} résultats web",
"addressCount": "{count} adresses",
"noResults": "Aucun résultat",
```
```jsonc
// it.json
"placeCount": "{count} luoghi",
"webCount": "{count} risultati web",
"addressCount": "{count} indirizzi",
"noResults": "Nessun risultato",
```

- [ ] **Step 3: 죽은 조합 키 제거 (Task 4 완료 후 실행)**

Task 4가 끝나 PlaceSearch가 새 키만 참조하게 된 뒤, 위 6개 키를 5개 언어에서 제거.

- [ ] **Step 4: i18n 테스트 통과**

Run: `npm run test:run -- i18n-messages`
Expected: PASS(ko 기준 5언어 키 집합·ICU 플레이스홀더 동일).

- [ ] **Step 5: 커밋**

Step 2 직후 1차 커밋, Step 3 후 2차 커밋(또는 Task 4와 묶어 커밋).
```bash
git commit -- messages/ko.json messages/en.json messages/es.json messages/fr.json messages/it.json -m "i18n(search): 섹션 카운트 통지 키 신설(placeCount·webCount·addressCount·noResults)"
```

---

### Task 4: PlaceSearch 재배선 — `/api/places` 복원 + 웹 병렬 + 3섹션 통지

검색창이 라우터(`/api/search`) 대신 장소·주소·웹을 직접 병렬 호출하도록 되돌린다. 컴포넌트 와이어링 테스트 레인이 없으므로 lint+build+실호출이 게이트.

**Files:**
- Modify: `src/components/PlaceSearch.tsx`
- Modify: `src/app/[locale]/page.tsx:35` (게이트 prop 추가)
- Reference: `src/lib/env.ts:139` (`hasPerplexityKey`)

**Interfaces:**
- Consumes: Task 1 `/api/search/web?query=` → `{ web: WebSearchResult[] }`; Task 2 `combinedLiveMessage(): LivePart[] | null`; Task 3 새 i18n 키.
- Produces: `PlaceSearch` prop `canSearchWeb?: boolean`(기본 false).

- [ ] **Step 1: prop 추가 (PlaceSearch 시그니처 + page.tsx)**

`src/components/PlaceSearch.tsx` 구조 분해(줄 72 근처)와 인터페이스(줄 95 근처)에 `canSearchAddress` 옆에 추가:
```typescript
  canSearchAddress = false,
  canSearchWeb = false,   // 추가
  canShowChat = false,
```
```typescript
  canSearchAddress?: boolean;
  canSearchWeb?: boolean;  // 추가
  canShowChat?: boolean;
```
`src/app/[locale]/page.tsx`(줄 34-35 근처, `hasPerplexityKey` import 추가):
```typescript
      canSearchAddress={hasJusoKey()}
      canSearchWeb={hasPerplexityKey()}
      canShowChat={hasGeminiKey()}
```
import 줄(page.tsx:10-11 근처)에 `hasPerplexityKey` 추가.

- [ ] **Step 2: web 상태·reqId 도입, webFallback 제거**

PlaceSearch 줄 110-111 교체:
```typescript
  // 웹 검색 결과(장소·주소와 병렬). null=미검색/키 없음.
  const [webResults, setWebResults] = useState<WebSearchResult[] | null>(null);
```
(`webFallback` state 삭제). 줄 123 근처 `addrReqIdRef` 옆에 추가:
```typescript
  const webReqIdRef = useRef(0);
```

- [ ] **Step 3: `performSearch`를 `/api/places` 직접 호출로 복원**

줄 211-267의 `performSearch` 본문에서 try 블록(줄 230-260)을 교체. `SearchRouteResult` 분기를 제거하고 `PlaceSearchResult`를 직접 받는다. 줄 221-223의 웹 초기화도 정리:

```typescript
      const myId = ++reqIdRef.current;
      setBucket(null);
      setRegion(null);
      setStatus({ kind: "loading" });
      // URL ?q= 동기화(공유·새로고침 보존)
      const url = new URL(window.location.href);
      url.searchParams.set("q", q);
      window.history.replaceState(window.history.state, "", url);
      window.dispatchEvent(new Event("gildongmu:locationchange"));
      try {
        // 좌표가 있으면 거리순 정렬("맥도날드" 전국 체인도 근처 지점 상위).
        const coordQuery = userCoords
          ? `&lat=${userCoords.lat}&lng=${userCoords.lng}`
          : "";
        const res = await fetch(
          `/api/places?query=${encodeURIComponent(q)}&lang=${dataLocale(locale)}${coordQuery}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result = (await res.json()) as PlaceSearchResult;
        if (reqIdRef.current !== myId) return;
        setStatus({ kind: "done", result });
      } catch {
        if (reqIdRef.current !== myId) return;
        setStatus({ kind: "error" });
      }
```
줄 21의 `import type { SearchRouteResult } from "@/lib/search-router/types";` 를 제거하고 `PlaceSearchResult`를 `@/lib/types`에서 import(이미 import 중인지 확인 후 누락 시 추가). `WebSearchResult` import 유지.

- [ ] **Step 4: `performWebSearch` 신설(병렬 웹 호출)**

`performAddressSearch`(줄 289) 아래에 추가:
```typescript
  /**
   * 웹 검색 실행 — /api/search/web(Perplexity) 호출. 장소·주소와 병렬 발사되는
   * 보조 섹션이라 실패/빈 결과는 빈 배열로 graceful(섹션 미렌더). place reqId 동형.
   */
  const performWebSearch = useCallback(async (raw: string) => {
    const q = raw.trim();
    if (!q) return;
    const myId = ++webReqIdRef.current;
    setWebResults(null); // 새 검색 — 이전 웹 결과 잔류 방지.
    try {
      const res = await fetch(`/api/search/web?query=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { web: WebSearchResult[] };
      if (webReqIdRef.current !== myId) return;
      setWebResults(data.web);
    } catch {
      if (webReqIdRef.current !== myId) return;
      setWebResults([]); // 보조 섹션 — 무음 degrade.
    }
  }, []);
```

- [ ] **Step 5: `runQuerySearch`가 웹도 발사**

줄 299-305 교체:
```typescript
  const runQuerySearch = useCallback(
    (raw: string) => {
      void performSearch(raw);
      if (canSearchAddress) void performAddressSearch(raw);
      if (canSearchWeb) void performWebSearch(raw);
    },
    [performSearch, performAddressSearch, performWebSearch, canSearchAddress, canSearchWeb],
  );
```

- [ ] **Step 6: 포커스 게이트에 웹 settled 반영**

웹은 비동기라 늦게 끝날 수 있다. 줄 378-396의 포커스 effect에서 웹도 settled 조건에 포함:
```typescript
  const focusedForSearchRef = useRef(false);
  useEffect(() => {
    const placeSettled = status.kind === "done" || status.kind === "error";
    const addrSettled =
      !canSearchAddress || addrStatus.kind === "done" || addrStatus.kind === "error";
    // 웹은 done/error를 status로 추적하지 않으므로 webResults가 채워졌는지로 판정.
    const webSettled = !canSearchWeb || webResults !== null;
    const anyStarted =
      status.kind !== "idle" ||
      (canSearchAddress && addrStatus.kind !== "idle") ||
      (canSearchWeb && webResults !== null);
    if (placeSettled && addrSettled && webSettled && anyStarted) {
      if (!focusedForSearchRef.current) {
        focusedForSearchRef.current = true;
        requestAnimationFrame(() => resultsHeadingRef.current?.focus());
      }
    } else if (status.kind === "loading" || addrStatus.kind === "loading") {
      focusedForSearchRef.current = false;
    }
  }, [status.kind, addrStatus.kind, canSearchAddress, canSearchWeb, webResults]);
```
주의: `webResults`는 `performWebSearch` 시작 시 `null`로 리셋되므로 새 검색에서 다시 settled 판정이 풀린다(loading 분기의 ref 리셋과 함께 다음 settled에서 재포커스). `loading`(줄 405)은 status/addr만 보므로 그대로 둔다 — 웹이 약간 늦어도 포커스는 webSettled까지 기다린다.

- [ ] **Step 7: `liveSpec`/`liveMessage`를 part 배열로**

줄 403-422 교체. `webFallback` 인자 제거, 반환이 배열:
```typescript
  const placeCount = status.kind === "done" ? status.result.places.length : null;
  const addrCount = addrStatus.kind === "done" ? addrStatus.addresses.length : null;
  const webCount = webResults ? webResults.length : null;
  const loading = status.kind === "loading" || addrStatus.kind === "loading";
  const liveParts: LivePart[] | null =
    addrStatus.kind === "coordError"
      ? [{ key: "search.addressCoordFailed" }]
      : combinedLiveMessage({
          loading,
          placeCount,
          addrCount,
          webCount,
          spokenQuery,
          placeErrored: status.kind === "error",
        });
  const liveMessage = (liveParts ?? [])
    .map((p) =>
      p.key === "search.searchingFor"
        ? t(p.key, { query: spokenQuery ?? "" })
        : t(p.key, p.values ?? {}),
    )
    .join(", ");
```
`LivePart` 타입을 `@/lib/search-sections`에서 import 추가.

- [ ] **Step 8: 웹 카운트·섹션 렌더 정리**

줄 470 `webResultCount`는 `webResults ? webResults.length : 0` 그대로 유지(공존이라 정상). `WebResults` 마운트(줄 628 `<WebResults results={webResults ?? []} showHeading={false} />`)는 불변. 줄 108-111 주석의 "상호배타" 문구를 "장소·주소와 병렬, 공존" 으로 정정. 섹션 헤딩은 `showSectionHeadings = sectionOrder.length > 1`(불변) — 이제 장소+웹이 흔히 ≥2라 헤딩이 자연히 켜진다. 웹 섹션 헤딩 텍스트는 `search.webSection`("웹") 사용(현 코드가 이미 그렇게 그리는지 줄 606-642 확인, 아니면 place 섹션과 동형으로 `t("search.webSection")` 헤딩 부여).

- [ ] **Step 9: 빌드·린트**

Run: `npm run lint && npm run build`
Expected: 통과. `SearchRouteResult` 잔여 참조 0(`grep -n "SearchRouteResult\|webFallback" src/components/PlaceSearch.tsx` → 빈 결과).

- [ ] **Step 10: 실호출 검증(dev) — 3섹션 공존**

Run:
```bash
# dev 서버 떠 있는 상태에서, 위원장이 신고한 3쿼리 + 회귀 가드
for Q in "길동에 새로 생긴 위스키바" "암사동 캐나다 음식점" "스타벅스"; do
  echo "=== $Q ==="
  curl -s -G "http://localhost:3000/api/places" --data-urlencode "query=$Q" --data-urlencode "lang=ko" --data-urlencode "lat=37.538" --data-urlencode "lng=127.139" | python3 -c "import sys,json;d=json.load(sys.stdin);ps=d.get('places',[]);print(' 장소',len(ps),'건:',', '.join(p['name'] for p in ps[:5]))"
  curl -s -G "http://localhost:3000/api/search/web" --data-urlencode "query=$Q" | python3 -c "import sys,json;d=json.load(sys.stdin);print(' 웹',len(d.get('web',[])),'건')"
done
```
Expected: "위스키바" → 장소에 위로스키·바람 등 진짜 술집(미용실 없음 — 원문 검색이라 재해석 부작용 0). "캐나다 음식점" → 장소 소수/0 + 웹 ≥1(다이닝코드 등). "스타벅스" → 장소 다수. **브라우저로 `/ko?q=길동에 새로 생긴 위스키바` 진입 → 장소·웹 두 섹션이 함께 렌더되고 통지가 "장소 N건, 웹 M건"** 인지 확인(가능하면 Claude in Chrome).

- [ ] **Step 11: 커밋**

```bash
git commit -- src/components/PlaceSearch.tsx src/app/[locale]/page.tsx -m "feat(search): 라우터 제거하고 장소·주소·웹 3섹션 결정론적 병렬 호출"
```

---

### Task 5: 라우터 디렉터리·엔드포인트 제거

PlaceSearch가 더 이상 `search-router`를 참조하지 않으므로 안전하게 삭제한다.

**Files:**
- Delete: `src/lib/search-router/` (전체 — `types.ts`·`classify.ts`·`declarations.ts`·`flow.ts`·`__tests__/`)
- Delete: `src/app/api/search/route.ts` (`/api/search` GET 라우터 — `/api/search/web`만 남김)

- [ ] **Step 1: 잔여 참조 0 확인**

Run: `grep -rn "search-router\|/api/search\"" src` 와 `grep -rln "classifySearchQuery\|shouldFallbackToWeb\|pickAnchor\|SearchRouteResult\|SearchIntent\|RouterAnchor\|buildSearchDeclarations" src`
Expected: `/api/search/web/route.ts`(Task 1)는 `search-router`를 import하지 않으므로 빈 결과. 남는 게 있으면 그 파일을 먼저 정리.

- [ ] **Step 2: 삭제 실행**

```bash
git rm -r src/lib/search-router
git rm src/app/api/search/route.ts
```

- [ ] **Step 3: 빌드·전체 테스트**

Run: `npm run lint && npm run build && npm run test:run`
Expected: 통과(삭제된 search-router 테스트가 사라지고 나머지 green). 깨지면 잔여 import를 추적해 정리.

- [ ] **Step 4: i18n 죽은 키 제거 (Task 3 Step 3 실행)**

Task 3 Step 3의 6개 조합 키를 5언어에서 제거하고 `npm run test:run -- i18n-messages` 통과 확인.

- [ ] **Step 5: 커밋**

```bash
git commit -- src/lib/search-router src/app/api/search/route.ts messages/ko.json messages/en.json messages/es.json messages/fr.json messages/it.json -m "refactor(search): Gemini 라우터·죽은 통지 키 제거 — 결정론 3섹션으로 단일화"
```

---

### Task 6: 문서 갱신·실호출 최종 검증·배포

**Files:**
- Modify: `CLAUDE.md` (검색창 자연어 라우터 항목 → 결정론 3섹션 병렬로 재서술)
- Modify: `docs/SPEC.md` (실험 백로그 — 라우터 마일스톤을 "폐기·결정론 회귀"로 갱신)
- Run: `python sync_agent_docs.py` (AGENTS.md 재생성)

- [ ] **Step 1: CLAUDE.md 갱신**

"검색창 자연어 라우터" 항목을 제거/재서술: 라우터 폐기 근거(위스키바 재해석 부작용·앵커링 카카오 중복 실측 2026-06-27), 새 구조(장소·주소·웹 항상 병렬, `orderResultSections`·`combinedLiveMessage` 공존 모델, `canSearchWeb` 게이트, `/api/search/web` 엔드포인트), 회귀 가드(위스키바 원문 정상·캐나다 음식점 웹 보강) 기록. API 키 표의 `GEMINI_API_KEY`는 채팅이 계속 쓰므로 유지(검색에선 미사용으로 명시).

- [ ] **Step 2: 형제 문서 동기화**

Run: `python sync_agent_docs.py`
Expected: 루트·하위 `AGENTS.md` 재생성.

- [ ] **Step 3: 프로덕션 배포 후 실호출 검증**

push(자동배포) 후 프로덕션에서:
```bash
sleep 60  # 배포 전파
for Q in "길동에 새로 생긴 위스키바" "암사동 캐나다 음식점"; do
  echo "=== $Q ==="
  curl -s -G "https://gildongmu.vercel.app/api/places" --data-urlencode "query=$Q" --data-urlencode "lang=ko" --data-urlencode "lat=37.538" --data-urlencode "lng=127.139" | python3 -c "import sys,json;d=json.load(sys.stdin);print(' 장소',len(d.get('places',[])),'건')"
  curl -s -G "https://gildongmu.vercel.app/api/search/web" --data-urlencode "query=$Q" | python3 -c "import sys,json;d=json.load(sys.stdin);print(' 웹',len(d.get('web',[])),'건')"
done
curl -s -o /dev/null -w "구라우터 제거 확인 /api/search HTTP %{http_code}\n" "https://gildongmu.vercel.app/api/search?query=test"
```
Expected: 위스키바 장소(미용실 없음)+웹, 캐나다 음식점 웹 보강. `/api/search`(구 라우터) → 404/405(제거됨).

- [ ] **Step 4: 문서 커밋·푸시**

```bash
git commit -- CLAUDE.md AGENTS.md docs/SPEC.md -m "docs(search): 라우터 폐기·결정론 3섹션 병렬 아키텍처 기록"
git show HEAD --stat   # 의도 파일만 들었는지 검증
git push
```

---

## Self-Review

**Spec 커버리지:**
- 라우터 제거 → Task 5 ✓
- 웹 별도 섹션 항상 병렬 → Task 1(엔드포인트)·Task 4(병렬 발사) ✓
- place/web/address 공존 통지·정렬 → Task 2 ✓
- i18n 5언어 → Task 3 ✓
- 게이트(canSearchWeb) → Task 4 Step 1 ✓
- 접근성(단일 live·3-settled 포커스) → Task 4 Step 6·7 ✓
- 회귀 검증(위스키바·캐나다) → Task 4 Step 10·Task 6 Step 3 ✓
- 문서·배포 → Task 6 ✓

**Placeholder 스캔:** 모든 코드 스텝에 실제 코드 포함. "적절한 에러 처리" 류 없음. ✓

**타입 정합:** `LivePart`(Task 2 정의 → Task 4 import), `WebSearchResult`(types.ts → Task 1·4), `PlaceSearchResult`(Task 4), `combinedLiveMessage` 시그니처(Task 2 ↔ Task 4 Step 7 인자 일치 — `webFallback` 제거 양쪽 반영). ✓

**미해결 의존:** Task 3은 키 추가(Step 2)와 죽은 키 제거(Step 3=Task 5 Step 4)로 분리 — PlaceSearch가 동적 `liveSpec.key` 참조라 죽은 키를 Task 4 전에 지우면 런타임 누락 위험. 순서를 명시했다(추가는 먼저, 제거는 PlaceSearch 전환 후). ✓
