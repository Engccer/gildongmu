# 네이버 리뷰순 정렬 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 장소 검색(웹·iOS)과 채팅에 "네이버 리뷰 개수순" 정렬 축 하나를 정직하게 노출한다 — 값(별점·리뷰 수)은 없고 순서만 있으며, 최대 5건, 네이버 단독.

**Architecture:** `PlaceSearchParams.sort` 한 축을 서버 진입점 `pickPlacesProvider`가 읽어 `review`면 병합 체인을 우회하고 네이버 단독(`sort=comment`)으로 간다(키 부재는 throw). 라우트·채팅 도구·웹 토글·iOS 토글이 그 축을 소비하고, 채팅 렌더는 `sort`를 실어 iOS 헤딩이 "네이버 리뷰순 N곳"으로 갈린다. 미지정 시 기존 동작 바이트 동일.

**Tech Stack:** Next.js 16 Route Handler + zod, Vitest(jsdom 계약 테스트), SwiftUI + GildongmuKit(Swift Testing), Gemini function-calling.

**Spec:** `docs/superpowers/specs/2026-08-17-naver-review-sort-design.md`

**구현 방식 판정(AUTONOMY §구현 방식 판정):** inline. 서버 축(Task 1~2)이 뒤의 모든 소비자 인터페이스를 정하고, 웹·채팅·iOS가 같은 타입·같은 문구 키를 공유하며, 실호출 게이트 결과가 설계를 뒤집을 수 있는 탐색적 성격(네이버 `sort=comment` 실계약)이 있다. 리뷰는 구현과 무관하게 서브에이전트에 분리한다.

## Global Constraints

- 리뷰순은 카카오와 **병합하지 않는다**(spec §2). 6번째부터 축이 아닌데 낭독으로 경계가 안 들린다.
- **거리 재정렬 금지**(spec §2.1) — `orderSupplementTail`·`sortByDistanceFrom`을 리뷰순 결과에 태우지 않는다. 거리는 `annotateDistances` 표기만.
- **키 부재 시 정확도순 조용한 폴백 금지 → throw**(spec §3.1). 라우트 catch가 502.
- **`sort` 미지정 시 기존 동작과 바이트 동일**(spec §3.1) — 기존 테스트 무수정 통과가 증거.
- 채팅 렌더 페이로드 `{ type: "places"; places: Place[]; sort?: "review" }`(spec §5.3). iOS 헤딩 `sort === "review"` → "네이버 리뷰순 N곳", 그 외 "장소 N곳".
- 웹·iOS 토글 노출은 `dataLocale === "ko"` **그리고** 네이버 키 보유일 때만(spec §4.3·§6). 라벨 전환이 곧 상태 신호: `네이버 리뷰순으로 보기` ↔ `정확도순으로 보기`.
- 재조회 중 `disabled` 금지 — `aria-disabled` + 핸들러 가드 + in-flight ref 가드(spec §4.2). 포커스는 토글에 유지(첫 결과 착지 계약 비적용).
- 채팅 systemInstruction은 **최소판 한 줄**만, `npm run test:ab` 실측 뒤 필요할 때만 보강(spec §5.2).
- 실호출 게이트 판정 술어(spec §7): **"두 정렬의 상위 5건 집합이 다르다" + "무효 sort가 SE04로 거절된다"** 둘 다. 5건 캡·`start` 무시도 함께 관측.
- 범위 밖: CLI/MCP, 영어 로케일, 둘러보기 항목 행 표기(BACKLOG E22).
- 커밋: `git commit -- <의도 경로>`(add -A 금지), 이메일 `engccer@gmail.com`, 한국어 메시지.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `src/lib/types.ts` | `PlaceSort` 타입 + `PlaceSearchParams.sort` |
| `src/lib/providers/naver-local.ts` | `sort=comment` 전달, errorCode 봉투 throw |
| `src/lib/providers/places.ts` | `pickPlacesProvider` 리뷰순 분기(네이버 단독·throw) |
| `src/app/api/places/query-schema.ts`(신규) | `/api/places` 쿼리 스키마 추출(`sort` enum) |
| `src/app/api/places/route.ts` | 스키마 사용 |
| `scripts/verify-naver-review-sort.mjs`(신규) | 실호출 게이트 스크립트 |
| `src/lib/chat/types.ts`·`render.ts`·`declarations.ts`·`router.ts`·`system-instruction.ts` | 채팅 인자·렌더 sort·프롬프트 한 줄 |
| `src/components/chat/MessageBubble.tsx` | 리뷰순 카드 묶음 캡션 |
| `src/components/PlaceSearch.tsx`·`src/app/[locale]/page.tsx` | 웹 토글 + `canSortByReview` prop |
| `messages/*.json`(6) | `search.sortByReview`·`search.sortByAccuracy`·`chat.reviewPlacesHeading` |
| `ios/GildongmuKit/.../SearchService.swift`·`Models/ChatModels.swift`·`Models/SearchModels.swift` | Kit sort 파라미터·렌더 sort 디코딩·`PlaceSort` |
| `ios/Gildongmu/SearchModel.swift`·`SearchView.swift`·`Chat/ChatConversationView.swift` | iOS 토글·헤딩 분기 |
| `src/lib/__tests__/review-sort-drift.test.ts`(신규) | 웹↔Kit 드리프트 |
| `src/__ab__/model-ab.spec.ts` | 케이스 3종 + 도구 인자 기록 |
| `CHANGELOG.md`·`PROGRESS.md`·`CLAUDE.md`·spec §7 | 분배 |

---

### Task 1: 서버 정렬 축 — 타입·네이버 provider·진입점 분기

**Files:**
- Modify: `src/lib/types.ts:42-51`
- Modify: `src/lib/providers/naver-local.ts`
- Modify: `src/lib/providers/places.ts` (`pickPlacesProvider`)
- Test: `src/lib/__tests__/search-places.test.ts`(추가), `src/lib/providers/__tests__/naver-local.test.ts`(신규)

**Interfaces:**
- Produces: `export type PlaceSort = "accuracy" | "review"`; `PlaceSearchParams.sort?: PlaceSort`; `searchPlaces({query, sort:"review", ...})`가 `provider:"naver-local"` 5건 이하 반환, 네이버 키 없으면 `throw new Error("리뷰순 정렬은 네이버 지역검색 키가 필요합니다")`.

- [ ] **Step 1: 실패 테스트 — search-places.test.ts에 리뷰순 describe 추가**

```ts
// search-places.test.ts 상단 import에 추가
import { searchPlacesNaverLocal } from "../providers/naver-local";
vi.mock("../providers/naver-local");
const naverMock = vi.mocked(searchPlacesNaverLocal);

describe("searchPlaces (sort=review — 네이버 단독, spec §2·§3.1)", () => {
  beforeEach(() => {
    kakaoMock.mockReset(); naverMock.mockReset();
    hasKakao.mockReturnValue(true); hasNaver.mockReturnValue(true); hasTour.mockReturnValue(false);
    kakaoMock.mockResolvedValue(result([place("kakao-1", 37.5, 127.0)]));
    naverMock.mockResolvedValue({
      provider: "naver-local", query: "q",
      places: [place("n-far", 38.0, 128.0), place("n-near", 37.5, 127.001)],
    });
  });

  it("리뷰순은 병합을 우회해 네이버만 부른다(카카오 미호출)", async () => {
    const res = await searchPlaces({ query: "길동 맛집", sort: "review" });
    expect(kakaoMock).not.toHaveBeenCalled();
    expect(naverMock).toHaveBeenCalledWith(expect.objectContaining({ sort: "review" }));
    expect(res.provider).toBe("naver-local");
    expect(res.places.map((p) => p.id)).toEqual(["n-far", "n-near"]);
  });

  it("좌표가 있어도 거리 재정렬 없이 표기만 붙는다", async () => {
    const res = await searchPlaces({ query: "길동 맛집", sort: "review", lat: 37.5, lng: 127.0 });
    expect(res.places.map((p) => p.id)).toEqual(["n-far", "n-near"]);
    expect(res.places[0].distanceMeters).toBeGreaterThan(res.places[1].distanceMeters!);
  });

  it("네이버 키가 없으면 조용한 폴백 없이 throw", async () => {
    hasNaver.mockReturnValue(false);
    await expect(searchPlaces({ query: "길동 맛집", sort: "review" })).rejects.toThrow(/네이버/);
    expect(kakaoMock).not.toHaveBeenCalled();
  });

  it("sort 미지정·accuracy는 리뷰순 분기에 들어가지 않는다(카카오 경로)", async () => {
    hasNaver.mockReturnValue(false);
    await searchPlaces({ query: "q", sort: "accuracy" });
    expect(kakaoMock).toHaveBeenCalled();
    expect(naverMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 실패 테스트 — naver-local.test.ts 신규**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../env", () => ({
  env: { NAVER_LOCAL_CLIENT_ID: "id", NAVER_LOCAL_CLIENT_SECRET: "secret" },
}));

const item = { title: "<b>진주집</b>", link: "", category: "음식점", description: "", telephone: "",
  address: "서울 영등포구", roadAddress: "서울 영등포구 국제금융로", mapx: "1269250000", mapy: "375250000" };

describe("searchPlacesNaverLocal — sort 파라미터·오류 봉투", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
  afterEach(() => vi.unstubAllGlobals());

  function ok(body: unknown) {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => body });
  }

  it("sort=review면 네이버 sort=comment·display=5", async () => {
    ok({ total: 1, start: 1, display: 1, items: [item] });
    const { searchPlacesNaverLocal } = await import("../naver-local");
    await searchPlacesNaverLocal({ query: "여의도 맛집", sort: "review", limit: 15 });
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get("sort")).toBe("comment");
    expect(url.searchParams.get("display")).toBe("5");
  });

  it("sort 미지정이면 sort 파라미터를 붙이지 않는다(기존과 바이트 동일)", async () => {
    ok({ total: 1, start: 1, display: 1, items: [item] });
    const { searchPlacesNaverLocal } = await import("../naver-local");
    await searchPlacesNaverLocal({ query: "여의도 맛집" });
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.has("sort")).toBe(false);
  });

  it("200에 errorCode가 실려 오면 throw(조용한 빈 결과 금지)", async () => {
    ok({ errorCode: "SE04", errorMessage: "부적절한 sort값입니다." });
    const { searchPlacesNaverLocal } = await import("../naver-local");
    await expect(searchPlacesNaverLocal({ query: "q", sort: "review" })).rejects.toThrow(/SE04/);
  });
});
```

- [ ] **Step 3: 실행해 실패 확인** — `npx vitest run src/lib/__tests__/search-places.test.ts src/lib/providers/__tests__/naver-local.test.ts` → FAIL(`sort` 미전달·throw 없음).

- [ ] **Step 4: 구현**

`src/lib/types.ts`:
```ts
/** 장소 검색 정렬 축. review = 네이버 지역검색 sort=comment(카페·블로그 리뷰 '개수'순, 값 없음·최대 5건·좌표 무시). */
export type PlaceSort = "accuracy" | "review";

export interface PlaceSearchParams {
  query: string;
  limit?: number;
  lang?: "ko" | "en";
  lat?: number;
  lng?: number;
  /** 미지정=accuracy(기존 동작과 바이트 동일). review는 네이버 단독(spec 2026-08-17-naver-review-sort). */
  sort?: PlaceSort;
}
```

`naver-local.ts` `searchPlacesNaverLocal`:
```ts
  url.searchParams.set("query", params.query);
  // 리뷰순(sort=comment)은 네이버가 5로 캡하므로 limit을 이중으로 두지 않는다(spec §3.2).
  if (params.sort === "review") {
    url.searchParams.set("sort", "comment");
    url.searchParams.set("display", "5");
  } else {
    url.searchParams.set("display", String(Math.min(params.limit ?? 5, 5)));
  }
  ...
  const data = (await res.json()) as NaverLocalResponse | NaverErrorEnvelope;
  // 무효 파라미터는 HTTP 200 + {errorCode:"SE04"}로 온다(실측 2026-08-17) — items가 없어
  // 조용히 TypeError가 되지 않도록 봉투를 먼저 본다.
  if ("errorCode" in data) {
    throw new Error(`네이버 지역 검색 오류: ${data.errorCode} ${data.errorMessage ?? ""}`.trim());
  }
```
with `interface NaverErrorEnvelope { errorCode: string; errorMessage?: string }`.

`places.ts` `pickPlacesProvider` — `forced` 분기 바로 뒤에:
```ts
  // 리뷰순은 병합하지 않는다(spec §2): 카카오를 뒤에 붙이면 6번째부터 축이 아닌데
  // 낭독은 선형이라 경계가 안 들린다. 키가 없으면 소비자가 부르지 말았어야 할 요청 —
  // 정확도순으로 조용히 폴백하면 사용자가 믿는 정렬과 다른 결과가 되므로 throw(§2.1).
  if (params.sort === "review") {
    if (!hasNaverLocalKeys()) {
      throw new Error("리뷰순 정렬은 네이버 지역검색 키가 필요합니다");
    }
    return searchPlacesNaverLocal(params);
  }
```
`searchPlaces` 주석에 한 줄: "리뷰순도 이 주석(annotateDistances)만 지난다 — 정렬 없음".

- [ ] **Step 5: 테스트 통과 확인** — 위 두 파일 + `npx vitest run src/lib/__tests__/places-merge-ko.test.ts` PASS(기존 무수정).

- [ ] **Step 6: 커밋**
```bash
git commit -- src/lib/types.ts src/lib/providers/naver-local.ts src/lib/providers/places.ts src/lib/__tests__/search-places.test.ts src/lib/providers/__tests__/naver-local.test.ts -m "feat(places): 리뷰순 정렬 축 — sort=review는 네이버 단독(sort=comment), 병합·거리 재정렬 없음, 키 부재는 throw"
```

---

### Task 2: 라우트 — `sort` enum + 스키마 추출

**Files:**
- Create: `src/app/api/places/query-schema.ts`
- Modify: `src/app/api/places/route.ts`
- Test: `src/app/api/__tests__/places-query.test.ts`(신규)

**Interfaces:**
- Produces: `parsePlacesQuery(sp: URLSearchParams): { ok: true; data: PlacesQuery } | { ok: false; message: string }`, `PlacesQuery.sort: PlaceSort`(기본 `"accuracy"`).

- [ ] **Step 1: 실패 테스트**
```ts
import { describe, expect, it } from "vitest";
import { parsePlacesQuery } from "../places/query-schema";
const q = (s: string) => new URLSearchParams(s);

describe("/api/places 쿼리 — sort 축(spec §3.2)", () => {
  it("기본값은 accuracy", () => {
    const r = parsePlacesQuery(q("query=길동"));
    expect(r.ok && r.data.sort).toBe("accuracy");
  });
  it("sort=review 허용", () => {
    const r = parsePlacesQuery(q("query=길동&sort=review"));
    expect(r.ok && r.data.sort).toBe("review");
  });
  it("무효 sort는 400(조용한 무시 금지)", () => {
    expect(parsePlacesQuery(q("query=길동&sort=rating")).ok).toBe(false);
  });
  it("리뷰순에서도 좌표는 파싱된다(표기 전용, 검색엔 안 쓰임)", () => {
    const r = parsePlacesQuery(q("query=길동&sort=review&lat=37.5&lng=127.1"));
    expect(r.ok && r.data.lat).toBe(37.5);
  });
});
```
- [ ] **Step 2: 실패 확인** — `npx vitest run src/app/api/__tests__/places-query.test.ts` → 모듈 없음.
- [ ] **Step 3: 구현** — `query-schema.ts`에 route.ts의 `querySchema`를 이동하고 `sort: z.enum(["accuracy","review"]).default("accuracy")` 추가, `parsePlacesQuery`가 `safeParse` 결과를 `{ok,data}|{ok:false,message}`로 감싼다. route.ts는 `parsePlacesQuery(request.nextUrl.searchParams)`로 교체하고 `searchPlaces(parsed.data)`. 주석: "리뷰순에서 좌표는 거리 표기에만 쓰인다 — 순위에 영향 없음(spec §3.2)".
- [ ] **Step 4: 통과 확인 + `npx vitest run src/app/api/__tests__/coord-param-usage.test.ts`**(가드가 새 파일의 `latParam` 사용을 인정하는지).
- [ ] **Step 5: 커밋** `feat(api/places): sort 파라미터(accuracy|review) — 스키마 분리, 무효값 400`

---

### Task 3: 실호출 게이트 — 네이버 계약 스크립트

**Files:**
- Create: `scripts/verify-naver-review-sort.mjs`
- Modify: spec §7 아래 "실호출 결과(2026-08-17)" 표.

- [ ] **Step 1: 스크립트 작성** — `.env.local`에서 `NAVER_LOCAL_CLIENT_ID/SECRET` 로드(env 미설정 시 `.env.local` 파싱), 질의 `여의도 맛집`으로 4호출: `sort=random`·`sort=comment`(display=5)·`sort=bogus`·`sort=comment&start=6&display=10`. 판정 4축을 **각각 PASS/FAIL로 출력하고 하나라도 FAIL이면 exit 1**:
  1. `random` 상위 5건 이름 집합 ≠ `comment` 상위 5건 이름 집합
  2. `bogus` → `errorCode === "SE04"`
  3. `display=10` 요청 응답 items ≤ 5
  4. `start=6` 응답의 첫 항목 == `start=1` 응답의 첫 항목(페이지네이션 무시)
- [ ] **Step 2: 실행** `node scripts/verify-naver-review-sort.mjs` → 4축 PASS. FAIL이면 spec §1 전제가 무너진 것 — 멈추고 spec으로 되돌아간다.
- [ ] **Step 3: spec §7 아래에 결과 표(호출 시각·질의·두 정렬 상위 5·판정)를 남기고 커밋** `test(places): 네이버 리뷰순 실호출 게이트 스크립트 + 결과 기록`

---

### Task 4: 채팅 — `sort` 인자·렌더 sort·프롬프트 한 줄·웹 캡션

**Files:**
- Modify: `src/lib/chat/types.ts:40`, `render.ts`, `declarations.ts`, `router.ts:108-119`, `system-instruction.ts`
- Modify: `src/components/chat/MessageBubble.tsx`(RenderBlock places)
- Modify: `messages/*.json` `chat.reviewPlacesHeading`(6 로케일)
- Test: `src/lib/chat/__tests__/declarations.test.ts`·`render.test.ts`·`router.test.ts` 추가

**Interfaces:**
- Produces: `RenderPayload` `{ type: "places"; places: Place[]; sort?: "review" }`; `placesToRender(places, sort?: PlaceSort)`가 `sort==="review"`일 때만 `sort` 키를 싣는다(그 외 페이로드 불변 — 기존 `toEqual` 테스트 통과).
- Consumes: Task 1의 `PlaceSort`, `hasNaverLocalKeys`.

- [ ] **Step 1: 실패 테스트**
```ts
// declarations.test.ts
it("네이버 키가 있으면 search_places에 sort 속성이 실린다", async () => {
  vi.stubEnv("KAKAO_REST_API_KEY", "k");
  vi.stubEnv("NAVER_LOCAL_CLIENT_ID", "n"); vi.stubEnv("NAVER_LOCAL_CLIENT_SECRET", "s");
  const { availableDeclarations } = await import("../declarations");
  const d = availableDeclarations().find((x) => x.name === "search_places")!;
  const props = (d.parametersJsonSchema as { properties: Record<string, unknown> }).properties;
  expect(props.sort).toBeDefined();
});
it("네이버 키가 없으면 sort 속성이 없다(도구 자체는 카카오 게이트로 유지)", async () => {
  vi.stubEnv("KAKAO_REST_API_KEY", "k");
  vi.stubEnv("NAVER_LOCAL_CLIENT_ID", undefined); vi.stubEnv("NAVER_LOCAL_CLIENT_SECRET", undefined);
  const { availableDeclarations } = await import("../declarations");
  const d = availableDeclarations().find((x) => x.name === "search_places")!;
  const props = (d.parametersJsonSchema as { properties: Record<string, unknown> }).properties;
  expect(props.sort).toBeUndefined();
});
// render.test.ts
it("placesToRender는 review일 때만 sort를 싣는다", () => {
  expect(placesToRender([place], "review")).toEqual({ type: "places", places: [place], sort: "review" });
  expect(placesToRender([place], "accuracy")).toEqual({ type: "places", places: [place] });
});
// router.test.ts
it("search_places: sort=review를 searchPlaces에 넘기고 렌더에 싣는다", async () => {
  const r = await executeFunction("search_places", { query: "길동 맛집", sort: "review" }, ctxKo);
  expect(vi.mocked(searchPlaces)).toHaveBeenCalledWith(expect.objectContaining({ sort: "review" }));
  expect(r.render).toEqual({ type: "places", places: expect.any(Array), sort: "review" });
});
it("search_places: 무효 sort는 accuracy로(LLM 오값이 서버 throw로 번지지 않게)", async () => {
  await executeFunction("search_places", { query: "길동 맛집", sort: "rating" }, ctxKo);
  expect(vi.mocked(searchPlaces)).toHaveBeenLastCalledWith(expect.not.objectContaining({ sort: "rating" }));
});
```
- [ ] **Step 2: 실패 확인** `npx vitest run src/lib/chat/__tests__/declarations.test.ts src/lib/chat/__tests__/render.test.ts src/lib/chat/__tests__/router.test.ts`
- [ ] **Step 3: 구현**
  - `types.ts`: `| { type: "places"; places: Place[]; sort?: "review" }`
  - `render.ts`: `export function placesToRender(places: Place[], sort?: PlaceSort): RenderPayload { return sort === "review" ? { type: "places", places, sort: "review" } : { type: "places", places }; }`
  - `declarations.ts`: `GatedDeclaration.declaration: FunctionDeclaration | (() => FunctionDeclaration)`; search_places를 `buildSearchPlacesDeclaration()` 함수로 — `hasNaverLocalKeys()`면 `properties.sort = { type: "string", enum: ["review"], description: "\"review\" — 네이버 카페·블로그 리뷰 '개수'가 많은 순. ⚠ 별점·평점·리뷰 수의 '값'은 제공되지 않는다(순서만). ⚠ 최대 5곳. ⚠ 좌표를 쓰지 않으므로 query에 지역명을 반드시 포함할 것(예: '길동 맛집')." }`. `availableDeclarations`는 `typeof d.declaration === "function" ? d.declaration() : d.declaration`. 주석: 도구 존재는 카카오, 이 인자는 네이버가 정한다 — 게이트가 둘로 갈리는 것이 정상(spec §5.1).
  - `router.ts` search_places: `const sort: PlaceSort | undefined = args.sort === "review" ? "review" : undefined;` → `searchPlaces({..., sort})`, `placesToRender(result.places, sort)`.
  - `system-instruction.ts` [신뢰성] 뒤 한 줄: `` `- 별점·평점·리뷰 수를 물으면 그 값은 제공되지 않음을 밝히고, 대신 search_places의 sort "review"(네이버 리뷰 많은 순, 최대 5곳)를 제안하거나 호출하라. 지명이 없으면 위치를 먼저 확인해 query에 지역명을 넣어라.\n` `` (sort 속성이 없을 때 이 문장이 무의미해지지 않게 `hasNaverLocalKeys()` 조건부로 삽입).
  - `MessageBubble.tsx` case "places": `render.sort === "review"`면 `<p className="font-semibold">{tChat("reviewPlacesHeading", { count: render.places.length })}</p>` 를 `ResultList` 위에(웹 SourceList "출처 " 접두와 같은 역할 — 두 묶음 경계). `useTranslations("chat")` 훅은 RenderBlock 안에서.
  - `messages/*.json` `chat.reviewPlacesHeading`: ko `"네이버 리뷰순 {count}곳"`, en `"Top {count} by Naver reviews"`, es `"{count} lugares por reseñas de Naver"`, fr `"{count} lieux par avis Naver"`, it `"{count} luoghi per recensioni Naver"`, ja `"Naverレビュー順{count}件"`.
- [ ] **Step 4: 통과 확인** + `npx vitest run src/lib/__tests__/i18n-messages.test.ts src/lib/chat`
- [ ] **Step 5: 커밋** `feat(chat): search_places sort=review 인자(네이버 키 게이트) + 렌더 sort + 프롬프트 한 줄 + 웹 리뷰순 캡션`

---

### Task 5: 웹 검색 토글

**Files:**
- Modify: `src/components/PlaceSearch.tsx`, `src/app/[locale]/page.tsx`
- Modify: `messages/*.json` `search.sortByReview`·`search.sortByAccuracy`
- Test: `src/components/__tests__/PlaceSearch.reviewSort.test.tsx`(신규, jsdom)

**Interfaces:**
- Produces: `PlaceSearch` prop `canSortByReview?: boolean`(page.tsx가 `hasNaverLocalKeys()` 전달). URL `?sort=review` 동기화(`replaceState`).

- [ ] **Step 1: 실패 테스트(jsdom)** — `PlaceSearch.test.tsx`의 하네스(NextIntlClientProvider ko + geolocation stub)를 재사용하고 `fetch`를 스텁해 `/api/places` 호출 URL을 기록:
```ts
it("ko+키: 검색 후 토글이 뜨고, 누르면 sort=review로 재조회되며 라벨이 전환되고 포커스가 토글에 남는다", async () => {
  renderHome({ canSortByReview: true });
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "길동 맛집" } });
  fireEvent.submit(screen.getByRole("searchbox").closest("form")!);
  const toggle = await screen.findByRole("button", { name: "네이버 리뷰순으로 보기" });
  toggle.focus();
  fireEvent.click(toggle);
  await waitFor(() => expect(fetchUrls.some((u) => u.includes("sort=review"))).toBe(true));
  await screen.findByRole("button", { name: "정확도순으로 보기" });
  expect(document.activeElement).toBe(toggle);
  expect(new URL(window.location.href).searchParams.get("sort")).toBe("review");
});
it("키 없음 또는 en 로케일이면 토글이 없다", ...); // canSortByReview=false / locale en 두 케이스
it("재조회 중 토글은 disabled가 아니라 aria-disabled이고 재클릭은 무시된다", ...); // fetch를 pending으로 두고 두 번 클릭 → fetch 1회
```
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현**
  - state `const [sort, setSort] = useState<PlaceSort>("accuracy")`, `sortRef`(fetch가 최신값을 읽음), `sortInFlightRef = useRef(false)`, `keepFocusOnSortRef = useRef(false)`, `lastQueryRef`.
  - `performSearch`: URL에 `sort`(review면 set, 아니면 delete), fetch에 `sortRef.current === "review" ? "&sort=review" : ""`, `lastQueryRef.current = q`.
  - 마운트 effect: `params.get("sort") === "review"`면 `setSort("review"); sortRef.current="review"` **before** 자동검색.
  - 포커스 effect(settled 분기): `if (keepFocusOnSortRef.current) { keepFocusOnSortRef.current = false; focusedForSearchRef.current = true; } else requestAnimationFrame(...)`.
  - 핸들러:
```ts
async function toggleSort() {
  if (sortInFlightRef.current || status.kind === "loading") return;
  const q = lastQueryRef.current; if (!q) return;
  sortInFlightRef.current = true;
  const next: PlaceSort = sortRef.current === "review" ? "accuracy" : "review";
  sortRef.current = next; setSort(next);
  keepFocusOnSortRef.current = true;
  try { await performSearch(q); } finally { sortInFlightRef.current = false; }
}
```
  - 렌더(결과 컨테이너 **바로 앞**, live region 뒤 — 컨테이너는 loading 중 언마운트되므로 밖에 둬야 포커스가 산다): `{canSortByReview && dataLocale(locale) === "ko" && status.kind !== "idle" && (<button type="button" onClick={toggleSort} aria-disabled={status.kind === "loading" || undefined} className="mt-3 min-h-11 underline">{t(sort === "review" ? "search.sortByAccuracy" : "search.sortByReview")}</button>)}`
  - `page.tsx`: `canSortByReview={hasNaverLocalKeys()}` (import from `@/lib/env`).
  - messages: ko `sortByReview: "네이버 리뷰순으로 보기"`, `sortByAccuracy: "정확도순으로 보기"`; en `"Sort by Naver reviews"`/`"Sort by relevance"`; es `"Ordenar por reseñas de Naver"`/`"Ordenar por relevancia"`; fr `"Trier par avis Naver"`/`"Trier par pertinence"`; it `"Ordina per recensioni Naver"`/`"Ordina per rilevanza"`; ja `"Naverレビュー順で見る"`/`"関連度順で見る"`.
- [ ] **Step 4: 통과 확인** `npx vitest run src/components/__tests__/PlaceSearch` + `npm run lint`
- [ ] **Step 5: 커밋** `feat(web): 검색 결과 리뷰순 토글 — 라벨 전환이 상태 신호, 포커스 유지, ?sort=review 동기화`

---

### Task 6: iOS Kit — `PlaceSort`·SearchService `sort`·렌더 sort 디코딩

**Files:**
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/Models/SearchModels.swift`(`PlaceSort` enum), `SearchService.swift`(`search(... sort:)`, `SearchOutcome.placesProvider`), `Models/ChatModels.swift`(`.places([Place], sort: PlaceSort)`)
- Modify: `ios/Gildongmu/Chat/ChatConversationView.swift`(패턴 3곳)·`ChatModel.swift`(패턴 있으면)
- Test: `ios/GildongmuKit/Tests/GildongmuKitTests/ChatModelsTests.swift`(추가), `SearchServiceTests`(있으면 sort 쿼리 케이스)

**Interfaces:**
- Produces: `public enum PlaceSort: String, Sendable { case accuracy, review }`; `SearchService.search(query:lat:lng:lang:includeWeb:sort:)`(기본 `.accuracy`, review면 `sort=review` 쿼리 추가); `SearchOutcome.placesProvider: String?`; `ChatRenderPayload.places([Place], sort: PlaceSort)`(디코더: `sort` 키 `"review"`면 `.review`, 없으면 `.accuracy`).

- [ ] **Step 1: 실패 테스트(Swift Testing)**
```swift
@Test func placesRender_decodesReviewSort() throws {
    let json = #"{"type":"places","places":[],"sort":"review"}"#.data(using: .utf8)!
    let r = try JSONDecoder().decode(ChatRenderPayload.self, from: json)
    guard case .places(_, let sort) = r else { Issue.record("places 아님"); return }
    #expect(sort == .review)
}
@Test func placesRender_defaultsToAccuracy() throws { /* sort 키 없음 → .accuracy */ }
```
- [ ] **Step 2: 실패 확인** `cd ios/GildongmuKit && swift test --filter ChatModelsTests`
- [ ] **Step 3: 구현** — 위 인터페이스대로. `ChatRenderPayload` CodingKeys에 `sort` 추가; nearby 4종 투영 분기는 `.places(places, sort: .accuracy)`. `ChatConversationView` 3곳(`chatPlaceMentions` 추출·`renderHeading`·`renderView`)과 `ChatModel` 패턴을 `.places(let places, _)`로. `SearchService.search`: `if sort == .review { placesQuery.append(URLQueryItem(name: "sort", value: "review")) }`; `SearchOutcome`에 `placesProvider` 저장(`init` 기본값 nil).
- [ ] **Step 4: 통과 확인** `swift test` 전체.
- [ ] **Step 5: 커밋** `feat(ios-kit): PlaceSort 미러 — SearchService sort 쿼리, 채팅 렌더 sort 디코딩`

---

### Task 7: iOS 앱 — 검색 토글 + 렌더 헤딩 분기

**Files:**
- Modify: `ios/Gildongmu/SearchModel.swift`, `SearchView.swift`, `Chat/ChatConversationView.swift`(`renderHeading`)
- Modify: `ios/i18n/ios-extra/*.json`(불필요 — `chat.reviewPlacesHeading`·`search.sortBy*`는 messages에서 앱 카탈로그로 자동 유입) → `node ios/scripts/messages-to-xcstrings.mjs app` 재생성

**Interfaces:**
- Consumes: Task 6 `PlaceSort`, `SearchService.search(sort:)`, `SearchOutcome.placesProvider`.
- Produces: `SearchModel.sort: PlaceSort`, `SearchModel.canSortByReview: Bool`(`AppLanguage.dataLocale == "ko" && naverBackedSeen`; `naverBackedSeen`은 outcome.placesProvider ∈ {"merged","naver-local"}를 관측하면 세션 내 래치 — iOS는 서버 키를 모르므로 응답 provider가 키 보유의 유일한 관측 채널), `SearchModel.toggleSort()`(마지막 제출 질의로 재조회, `resultsRevision` 미증가 → 첫 행 착지 없음, 통지는 `announce()` 그대로).

- [ ] **Step 1: 구현**
  - `SearchModel`: `private(set) var sort: PlaceSort = .accuracy`, `private var lastSubmittedQuery = ""`, `private(set) var naverBackedSeen = false`, `var canSortByReview: Bool { AppLanguage.dataLocale == "ko" && naverBackedSeen }`. `submit()`을 `submit(landFocus: Bool = true)`로 — 성공 후 `if landFocus { resultsRevision += 1 }`, `if let p = result.placesProvider, p == "merged" || p == "naver-local" { naverBackedSeen = true }`. `func toggleSort() { guard !isSearching, !lastSubmittedQuery.isEmpty else { return }; sort = sort == .review ? .accuracy : .review; query = lastSubmittedQuery; submit(landFocus: false) }`. `service.search(..., sort: sort)`.
  - `SearchView`: `if model.canSortByReview, model.outcome != nil { Button(appLocalized(model.sort == .review ? "search.sortByAccuracy" : "search.sortByReview")) { bucket = nil; region = nil; model.toggleSort() } }` — `if let outcome = model.outcome` 블록 **앞**(리뷰순 0건이어도 토글이 남아 되돌아갈 수 있다).
  - `ChatConversationView.renderHeading`: `case .places(let places, let sort) where !places.isEmpty: return sort == .review ? appLocalized("chat.reviewPlacesHeading", String(places.count)) : appLocalized("ios.chat.placesHeading", String(places.count))`.
  - `node ios/scripts/messages-to-xcstrings.mjs app` → 카탈로그 재생성, `node ios/scripts/check-xcstrings-keys.mjs`(있으면) 통과.
- [ ] **Step 2: 빌드** `xcodebuildmcp` 또는 `xcodebuild -scheme Gildongmu -destination 'generic/platform=iOS Simulator' build` 성공.
- [ ] **Step 3: 커밋** `feat(ios): 검색 리뷰순 토글(라벨 전환·포커스 유지) + 채팅 렌더 헤딩 "네이버 리뷰순 N곳"`

---

### Task 8: 드리프트 테스트 + A/B 하네스 케이스 + 실측

**Files:**
- Create: `src/lib/__tests__/review-sort-drift.test.ts`
- Modify: `src/__ab__/model-ab.spec.ts`

- [ ] **Step 1: 드리프트 테스트** — 소스 스캔 3축: ① `src/lib/chat/types.ts`에 `sort?: "review"` ② Kit `ChatModels.swift`가 `sort` CodingKey와 `"review"` 리터럴을 디코드 ③ Kit `SearchService.swift`가 `URLQueryItem(name: "sort", value: "review")`를 보낸다. 실패 메시지에 어느 쪽을 고쳐야 하는지 명시.
- [ ] **Step 2: A/B 하네스** — 라운드 기록에 `toolArgs: parts.filter(p=>p.functionCall).map(p=>({name, args}))` 추가(출력 JSON·요약표에 포함). `Case`에 `expectArg?: { tool: string; key: string; value: unknown }` 추가해 `argPass` 판정. 케이스 3종:
  - `21-리뷰순-지명`: `["여의도 맛집 리뷰 많은 순으로 알려줘"]`, expectAny `search_places`, expectArg `{tool:"search_places", key:"sort", value:"review"}`, judge "5곳 이내, 리뷰 수·별점 값 날조 없음, '리뷰 개수순'임을 밝히는가".
  - `22-별점요청`: `["이 근처 별점 높은 카페 추천해 줘"]`, expectAny `search_places`, judge "별점 값이 없음을 밝히는가, 리뷰순 대체 제안·호출을 하는가, 별점 날조 0".
  - `23-리뷰순-지명없음`: `["근처 맛집 리뷰순으로"]`(withLocation true), expectAny `search_places`, judge "query에 지역명(동·역명)을 넣었는가(도구 인자에서 확인) — 지명 없이 '맛집' 단독이면 실패".
- [ ] **Step 3: 실측** `MODELS=gemini-3.6-flash REPS=2 ONLY=21,22,23 npm run test:ab` → `.ab-out/*.json`과 요약표를 읽고 판정 축 3종을 spec §7 아래에 기록. 축이 깨지면 그때만 systemInstruction 보강(최소 1문장, 재실측).
- [ ] **Step 4: 게이트 전체** `npm run test:run` + `npm run lint` + `npm run build`.
- [ ] **Step 5: 커밋** `test(review-sort): 웹↔Kit 드리프트 가드 + A/B 하네스 리뷰순 케이스·도구 인자 기록`

---

### Task 9: 리뷰·문서 분배·배포

- [ ] **Step 1: 서브에이전트 리뷰 2종(spec-compliance + code-quality)** — 요구사항(spec + 이 플랜)과 diff(커밋 범위)만 넘긴다. 지적은 계층 대조 후 처리, 기각은 근거 기록.
- [ ] **Step 2: 문서 분배** — `CHANGELOG.md` 항목(spec 링크), `PROGRESS.md` 상태 한 줄(검색·채팅 리뷰순 운영, iOS 다음 릴리스 대기), `CLAUDE.md` 통합 카탈로그 장소 검색 행에 함정 한 줄("리뷰순은 병합·재정렬·폴백 3금지, 렌더에 sort 필수"), `docs/BACKLOG.md` E22 착수 조건 문구는 유지. `PORTS.md`는 dodo에 장소 검색 리뷰순이 무의미(dodo는 네이버 미통합)라 미등록.
- [ ] **Step 3: push + Vercel 자동 배포**, iOS 실기기 두 구성 배포(`./ios/deploy-device.sh`, `CONFIGURATION=Experimental ./ios/deploy-device.sh`).
- [ ] **Step 4: 상태 보고** DONE / DONE_WITH_CONCERNS.

---

## Self-Review

- **Spec coverage**: §2·§2.1(Task 1) §3.1(Task 1) §3.2(Task 2) §1 실호출(Task 3) §4.1~4.3(Task 5) §5.1~5.3(Task 4) §6(Task 6·7) §7 전 행(Task 1·2·3·5·6·8) §9 범위 밖 미착수. iOS "키 보유" 조건은 서버 키를 직접 알 수 없어 `placesProvider` 관측 래치로 구현 — spec §6 "노출 조건 동일"의 실현 방식이며 spec 개정이 아니라 구현 세부(플랜에 기록).
- **Placeholder scan**: 없음.
- **Type consistency**: `PlaceSort`(웹 types.ts / Kit SearchModels.swift), `placesToRender(places, sort?)`, `RenderPayload.sort?: "review"`, `SearchService.search(sort:)`, `SearchOutcome.placesProvider`, `SearchModel.toggleSort()/canSortByReview/sort` 이름이 Task 간 일치.
