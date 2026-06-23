# 검색 좌표 연결·거리순 정렬 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 메인 검색창·채팅 `search_places`가 사용자 좌표를 카카오 로컬 검색에 넘겨 거리순 정렬해, 전국 정확도순 상위 15건 한계(맥도날드 누락)를 해결한다.

**Architecture:** `PlaceSearchParams`에 선택적 `lat`/`lng`를 추가하고, 카카오 provider가 좌표가 있으면 `x`/`y`/`sort=distance`를 붙인다(반경 미지정). 좌표는 `/api/places` 쿼리 파라미터와 채팅 `anchorOf(ctx)`로 흘러든다. 좌표가 없으면 현행 정확도순으로 graceful degrade.

**Tech Stack:** TypeScript, Next.js 16 App Router, zod 4, Vitest 4, 카카오 로컬 키워드 검색 API.

## Global Constraints

- 좌표 없으면 현행 동작 byte-identical(정확도순) — 회귀 0.
- 반경(`radius`) 미지정 — 거리순 정렬만(0건 위험 회피).
- 네이버·TourAPI provider는 좌표 무시(좌표 정렬 미지원) — `lat`/`lng`를 넘겨도 안전.
- 코드 주석·커밋 메시지: 한국어. 변수/함수명: 영어.
- 커밋 이메일 `engccer@gmail.com`. `git add -A` 금지(명시 파일만).
- 게이트: `npm run test:run`(단위) + `npm run lint` + `npm run build` + 좌표 포함 실호출.

---

### Task 1: 타입 + 카카오 provider 좌표 지원

**Files:**
- Modify: `src/lib/types.ts` (`PlaceSearchParams`)
- Modify: `src/lib/providers/kakao-local.ts` (URL 빌더 분리 + 좌표 분기)
- Test: `src/lib/__tests__/kakao-local-url.test.ts` (Create)

**Interfaces:**
- Produces: `buildKakaoSearchUrl(params: PlaceSearchParams): URL` — query/size + 좌표 분기 URL을 만드는 순수 함수. `searchPlacesKakaoLocal`이 사용.
- Consumes: `PlaceSearchParams { query; limit?; lang?; lat?; lng? }`.

- [ ] **Step 1: 타입에 좌표 추가**

`src/lib/types.ts`의 `PlaceSearchParams`(41~47행)를 수정:

```ts
export interface PlaceSearchParams {
  query: string;
  /** 결과 개수 (카카오 로컬 단일 요청 최대 15, 네이버 지역 검색은 최대 5) */
  limit?: number;
  /** UI 로케일 — 다국어 provider(TourAPI) 선택에 사용 */
  lang?: "ko" | "en";
  /** 검색 기준 좌표(WGS84). 있으면 카카오를 거리순 정렬한다. */
  lat?: number;
  lng?: number;
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

`src/lib/__tests__/kakao-local-url.test.ts` 생성:

```ts
import { describe, it, expect } from "vitest";
import { buildKakaoSearchUrl } from "../providers/kakao-local";

describe("buildKakaoSearchUrl", () => {
  it("좌표가 없으면 query·size만, 좌표 정렬 파라미터는 없다", () => {
    const url = buildKakaoSearchUrl({ query: "맥도날드" });
    expect(url.searchParams.get("query")).toBe("맥도날드");
    expect(url.searchParams.get("size")).toBe("15");
    expect(url.searchParams.get("x")).toBeNull();
    expect(url.searchParams.get("y")).toBeNull();
    expect(url.searchParams.get("sort")).toBeNull();
  });

  it("좌표가 있으면 x(경도)·y(위도)·sort=distance를 붙이고 radius는 없다", () => {
    const url = buildKakaoSearchUrl({
      query: "맥도날드",
      lat: 37.5384,
      lng: 127.1377,
    });
    expect(url.searchParams.get("x")).toBe("127.1377");
    expect(url.searchParams.get("y")).toBe("37.5384");
    expect(url.searchParams.get("sort")).toBe("distance");
    expect(url.searchParams.get("radius")).toBeNull();
  });

  it("limit은 15로 클램프된다", () => {
    expect(buildKakaoSearchUrl({ query: "x", limit: 99 }).searchParams.get("size")).toBe("15");
  });

  it("lat만 있고 lng가 없으면 좌표 정렬을 적용하지 않는다", () => {
    const url = buildKakaoSearchUrl({ query: "x", lat: 37.5 });
    expect(url.searchParams.get("sort")).toBeNull();
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npm run test:run -- kakao-local-url`
Expected: FAIL — `buildKakaoSearchUrl is not a function` (export 없음).

- [ ] **Step 4: 카카오 provider에 URL 빌더 분리 + 좌표 분기**

`src/lib/providers/kakao-local.ts`의 `searchPlacesKakaoLocal`(58~83행)을 수정. 상수 `ENDPOINT` 아래에 순수 빌더를 추가하고, fetch 함수가 그것을 사용하도록 바꾼다:

```ts
/**
 * 검색 URL 빌더(순수) — query·size에 더해, 좌표가 둘 다 있으면
 * x(경도)·y(위도)·sort=distance를 붙인다. radius는 지정하지 않는다
 * (거리순 정렬만 — 근처에 없으면 먼 곳도 거리순으로 노출, 0건 위험 회피).
 * 좌표가 없거나 한쪽만 있으면 카카오 기본(정확도순)으로 graceful degrade.
 */
export function buildKakaoSearchUrl(params: PlaceSearchParams): URL {
  const url = new URL(ENDPOINT);
  url.searchParams.set("query", params.query);
  url.searchParams.set("size", String(Math.min(params.limit ?? 10, 15)));
  if (params.lat != null && params.lng != null) {
    url.searchParams.set("x", String(params.lng));
    url.searchParams.set("y", String(params.lat));
    url.searchParams.set("sort", "distance");
  }
  return url;
}

export async function searchPlacesKakaoLocal(
  params: PlaceSearchParams,
): Promise<PlaceSearchResult> {
  const url = buildKakaoSearchUrl(params);

  const res = await fetch(url, {
    headers: {
      Authorization: `KakaoAK ${env.KAKAO_REST_API_KEY}`,
    },
    next: { revalidate: 300 },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`카카오 로컬 검색 실패: HTTP ${res.status} ${body}`);
  }

  const data = (await res.json()) as KakaoLocalResponse;
  return {
    places: data.documents.map(normalizeDocument),
    provider: "kakao-local",
    query: params.query,
  };
}
```

`PlaceSearchParams` import는 파일 상단(2행)에 이미 있다.

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm run test:run -- kakao-local-url`
Expected: PASS (4개).

- [ ] **Step 6: 커밋**

```bash
git add src/lib/types.ts src/lib/providers/kakao-local.ts src/lib/__tests__/kakao-local-url.test.ts
git commit -m "feat(search): 카카오 검색 좌표 거리순 정렬 + URL 빌더 분리

좌표(lat/lng) 있으면 x/y/sort=distance, 없으면 정확도순 graceful.
buildKakaoSearchUrl 순수 함수로 분리해 결정적 단위테스트.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" -- src/lib/types.ts src/lib/providers/kakao-local.ts src/lib/__tests__/kakao-local-url.test.ts
```

---

### Task 2: `/api/places` 라우트 좌표 파싱

**Files:**
- Modify: `src/app/api/places/route.ts` (zod 스키마 + 전달)

**Interfaces:**
- Consumes: `searchPlaces(params)` — `lat`/`lng` 선택 필드 수용(Task 1).
- Produces: `/api/places?query=..&lat=..&lng=..` — 유효 좌표면 거리순, 무효/누락이면 좌표 없이 검색.

- [ ] **Step 1: zod 스키마에 좌표 추가**

`src/app/api/places/route.ts`의 `querySchema`(12행)에 좌표를 추가. 위경도는 한국 범위가 아니라 일반 유효 범위로 검증하고, 파싱 실패 시 검색을 막지 않도록 `.optional().catch(undefined)`로 흡수한다:

```ts
const querySchema = z.object({
  query: z.string().trim().min(1, "검색어가 비어 있습니다").max(100),
  limit: z.coerce.number().int().min(1).max(15).default(15),
  lang: z.enum(["ko", "en"]).default("ko"),
  // 좌표는 검색 품질 보조 — 있으면 거리순, 무효/누락이면 좌표 없이 검색(400 아님).
  lat: z.coerce.number().min(-90).max(90).optional().catch(undefined),
  lng: z.coerce.number().min(-180).max(180).optional().catch(undefined),
});
```

- [ ] **Step 2: 파싱 입력에 좌표 추가**

같은 파일 `GET`의 `safeParse` 입력(24~28행)에 lat/lng를 추가:

```ts
  const parsed = querySchema.safeParse({
    query: request.nextUrl.searchParams.get("query") ?? "",
    limit: request.nextUrl.searchParams.get("limit") ?? undefined,
    lang: request.nextUrl.searchParams.get("lang") ?? undefined,
    lat: request.nextUrl.searchParams.get("lat") ?? undefined,
    lng: request.nextUrl.searchParams.get("lng") ?? undefined,
  });
```

`searchPlaces(parsed.data)`는 그대로 — `parsed.data`에 lat/lng가 포함돼 전달된다.

- [ ] **Step 3: 타입체크·린트 확인**

Run: `npm run lint`
Expected: 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/places/route.ts
git commit -m "feat(search): /api/places가 lat/lng 좌표를 파싱해 전달

좌표는 검색 품질 보조 — 유효하면 거리순, 무효/누락이면 catch로
흡수해 좌표 없이 검색(400으로 막지 않음).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" -- src/app/api/places/route.ts
```

---

### Task 3: 메인 검색창 좌표 주입

**Files:**
- Modify: `src/components/PlaceSearch.tsx` (`performSearch`의 fetch URL + deps)

**Interfaces:**
- Consumes: `userCoords`(121~122행, `geo.status === "ready" ? geo.coords : null`), `/api/places?...&lat=&lng=`(Task 2).

- [ ] **Step 1: performSearch fetch URL에 좌표 추가**

`src/components/PlaceSearch.tsx`의 `performSearch`(199행~) 안 fetch 호출(217행)을 수정. `userCoords`(이미 121~122행에 선언됨)를 쿼리에 덧붙인다:

```ts
        const coordQuery = userCoords
          ? `&lat=${userCoords.lat}&lng=${userCoords.lng}`
          : "";
        const res = await fetch(
          `/api/places?query=${encodeURIComponent(q)}&lang=${dataLocale(locale)}${coordQuery}`,
        );
```

- [ ] **Step 2: useCallback deps에 userCoords 추가**

같은 `performSearch`의 의존성 배열(231행 `[locale]`)을 `[locale, userCoords]`로 바꾼다. 좌표가 늦게 도착해도(권한 허용) 다음 검색부터 반영되며, stale 좌표로 검색되지 않는다.

```ts
    [locale, userCoords],
  );
```

- [ ] **Step 3: 린트·빌드 확인**

Run: `npm run lint && npm run build`
Expected: 에러 없음(react-hooks/exhaustive-deps 경고 없음).

- [ ] **Step 4: 커밋**

```bash
git add src/components/PlaceSearch.tsx
git commit -m "feat(search): 메인 검색창이 현재 위치를 검색에 전달

useGeolocation ready 시 userCoords를 /api/places에 넘겨 거리순.
권한 거부/미준비면 좌표 없이 호출(현행 정확도순 degrade).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" -- src/components/PlaceSearch.tsx
```

---

### Task 4: 채팅 `search_places` 좌표 주입

**Files:**
- Modify: `src/lib/chat/router.ts` (`search_places` 케이스)
- Test: `src/lib/chat/__tests__/router.test.ts` (기존 search_places 케이스 보강)

**Interfaces:**
- Consumes: `anchorOf(ctx)`(26행, `placeAnchor ?? userLocation`), `searchPlaces`(Task 1).

- [ ] **Step 1: 실패하는 테스트 보강**

`src/lib/chat/__tests__/router.test.ts`의 기존 `search_places` 케이스(74행 근처) 옆에, 좌표가 전달되는지 검증하는 테스트를 추가한다. 기존 파일의 mock 패턴(searchPlaces를 vi.mock으로 가로채는 방식)을 따른다. 기존 테스트가 `searchPlaces` 호출 인자를 검증하지 않으면, 호출 인자에 anchor 좌표가 포함되는지 보강:

```ts
  it("search_places: anchorOf(ctx) 좌표를 searchPlaces에 전달", async () => {
    const spy = vi.mocked(searchPlaces);
    await executeFunction(
      "search_places",
      { query: "맥도날드" },
      { dataLocale: "ko", userLocation: { lat: 37.5384, lng: 127.1377 } } as ExecutionContext,
    );
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ query: "맥도날드", lat: 37.5384, lng: 127.1377 }),
    );
  });
```

(기존 파일 상단 import에 `searchPlaces`·`ExecutionContext`가 없으면 추가. mock 방식은 기존 테스트에 맞춘다 — 기존 search_places 테스트가 통과하는 구조를 그대로 재사용.)

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm run test:run -- router`
Expected: FAIL — 현재 `searchPlaces`는 `{ query, lang }`만 받아 lat/lng가 없음.

- [ ] **Step 3: router의 search_places에 anchor 주입**

`src/lib/chat/router.ts`의 `search_places` 케이스(56~59행)를 수정:

```ts
    case "search_places": {
      const query = String(args.query ?? "");
      const anchor = anchorOf(ctx);
      const result = await searchPlaces({
        query,
        lang: ctx.dataLocale,
        lat: anchor?.lat,
        lng: anchor?.lng,
      });
      return { data: placesToData(result.places), render: placesToRender(result.places), source: src };
    }
```

`anchorOf`는 같은 파일 26행에 이미 정의돼 있다. `resolveCoord`(지명→좌표 변환용 단건 호출)는 **변경하지 않는다**(좌표 컨텍스트를 주면 안 됨).

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm run test:run -- router`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/chat/router.ts src/lib/chat/__tests__/router.test.ts
git commit -m "feat(chat): search_places가 anchorOf 좌표로 거리순 검색

장소 앵커 있으면 그 장소 기준, 없으면 현재 위치. 다른 좌표 도구와
동일 패턴. declaration엔 좌표 파라미터 미노출(LLM 날조 차단).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" -- src/lib/chat/router.ts src/lib/chat/__tests__/router.test.ts
```

---

### Task 5: 전체 게이트 + 실호출 검증 + push

**Files:** 없음(검증·배포).

- [ ] **Step 1: 전체 단위테스트**

Run: `npm run test:run`
Expected: 전부 PASS(신규 4 + 기존 + router 보강).

- [ ] **Step 2: 린트 + 빌드**

Run: `npm run lint && npm run build`
Expected: 에러 없음.

- [ ] **Step 3: dev 서버 실호출 — before/after 대조**

dev 서버를 백그라운드로 띄우고(`npm run dev`), 길동 좌표로 좌표 유/무를 대조한다:

```bash
# 좌표 없음(현행 — 정확도순, 전국)
curl -s "http://localhost:3000/api/places?query=맥도날드&lang=ko" \
  | python3 -c "import sys,json;[print(x['name'],x['address']) for x in json.load(sys.stdin)['places'][:15]]"

# 좌표 있음(거리순 — 강동구 길동 인근이 상위)
curl -s "http://localhost:3000/api/places?query=맥도날드&lang=ko&lat=37.5384&lng=127.1377" \
  | python3 -c "import sys,json;[print(x['name'],x['address']) for x in json.load(sys.stdin)['places'][:15]]"
```

Expected: 좌표 포함 호출에서 **강동구/길동 인근 맥도날드 지점**이 결과 상위에 나타난다(좌표 없는 호출엔 누락). 무효 좌표(`lat=999`)는 400 없이 좌표 없이 검색됨도 확인.

- [ ] **Step 4: 커밋(검증 로그가 코드 변경을 낳으면) + push**

검증에서 코드 수정이 없으면 Task 1~4 커밋을 그대로 push. gildongmu는 리뷰 게이트 통과 후 자동 commit+push(메모리 `gildongmu-auto-commit-push`):

```bash
git push
```

push 후 Vercel 자동배포. 프로덕션 `gildongmu.vercel.app/api/places?query=맥도날드&lat=37.5384&lng=127.1377` 실호출로 거리순 확인.

- [ ] **Step 5: 문서 갱신**

`docs/SPEC.md` 실험 백로그 또는 `CLAUDE.md` 아키텍처에 "검색 좌표 거리순 정렬" 한 줄 추가(메인 검색·채팅이 좌표를 카카오에 넘겨 거리순, 좌표 없으면 정확도순 graceful). `python sync_agent_docs.py`로 AGENTS.md 재생성 후 함께 커밋.

---

## Self-Review

**Spec coverage:**
- §3-1 타입 → Task 1 Step 1 ✓
- §3-2 카카오 거리순 → Task 1 Step 4 ✓
- §3-3 라우트 파싱 → Task 2 ✓
- §3-4 메인 검색창 → Task 3 ✓
- §3-5 채팅 anchorOf → Task 4 ✓
- §4 범위 밖(네이버/TourAPI 무시·페이지네이션 제외) → Global Constraints + 코드가 카카오 경로만 수정 ✓
- §5 테스트 → Task 1·4 단위 + Task 5 실호출 ✓
- §6 측정 성과 → Task 5 Step 3 before/after ✓

**Placeholder scan:** 없음(모든 코드 블록 완전).

**Type consistency:** `buildKakaoSearchUrl(params: PlaceSearchParams): URL`이 Task 1에서 정의·Task 1에서 소비. `anchorOf(ctx)`는 기존 함수. `PlaceSearchParams.lat/lng` 일관.
