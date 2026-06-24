# 검색창 자연어 라우터 (Natural Language Search Router) — 설계

> 작성 2026-06-24. 단일 검색창을 유지하면서 자연어 검색의 이점을 통합한다.
> 위원장이 폐기한 "검색⇄채팅 모드 분기"(2026-06-21)를 되살리지 않는다 — 출력은 기존 장소 리스트 그대로, 단발 1왕복, 검색창은 검색창으로 남는다.

## 1. 문제와 목표

### 문제 (실측 근거)

현재 검색창은 카카오 키워드 검색에 검색어 문자열을 그대로 던진다. 2026-06-24 실측:

| 쿼리 | 카카오 total_count | 비고 |
|---|---|---|
| `강동역 근처 맛집` | 1710 | "근처" 필러를 카카오가 이미 처리 — **이 부류는 멀쩡** |
| `강동역 맛집` | 2913 | 정상 |
| `암사동 캐나다 식당` | **0** | 그런 상호가 실재하지 않아 키워드 매칭 실패 |
| `길동 조용한 카페` | 37 | 정상(지역 토큰 매칭) |

핵심 발견: **필러 제거가 문제가 아니다.** 진짜 0건은 `암사동 캐나다 식당`처럼 토큰은 이미 깨끗한데 그 상호가 실재하지 않는 **복합 의미 쿼리**다. 사람은 "암사동(지역) + 서양/외국 음식점(카테고리)"으로 분해하지만 키워드 매칭엔 그 분해가 없다.

### 목표 (측정 가능한 성과)

1. `암사동 캐나다 식당` 같은 복합 의미 쿼리가 **지역+카테고리로 분해**되어 결과를 낸다(또는 웹 폴백).
2. 현재 위치가 아닌 **지역 좌표 앵커링** — "암사동…"을 길동에서 검색해도 암사동 기준으로 찾는다.
3. `환율 최신` 같은 **시의성 웹 정보 질의**가 웹 검색으로 라우팅된다.
4. **회귀 0**: `길동 카페` 같은 흔한 검색은 그대로 동작하고, Gemini 키 없으면 현재 결정론적 동작 그대로.

확인 방법: dev 서버 `/api/search` 실호출(§7 머지 게이트).

## 2. 핵심 결정 (브레인스토밍 합의)

| 항목 | 결정 | 근거 |
|---|---|---|
| **트리거** | 항상 (검색창 쿼리는 매번 라우터 경유) | 0건 폴백은 "결과는 나오는데 엉뚱한" 사각을 못 잡는다. 시각장애 사용자는 그럴듯하게 틀린 목록을 눈으로 못 거르므로 매 검색에서 의도를 먼저 읽어야 한다. 검색은 폼 제출(키 입력마다 아님)이라 ~0.5초 추가는 수용. |
| **강도** | 단발 분류 (single-pass, Gemini가 결과 관찰 안 함) | 풀 에이전트 루프는 멀티 왕복으로 지연이 필연적으로 길어져 검색 UX에 악영향. 단발은 1왕복으로 지연을 묶는다. |
| **범위** | 검색창에만 | "내 주변" 6종 버튼은 누름 자체가 확정된 구조화 쿼리(deterministic) — 해석할 게 없는데 LLM을 끼우면 지연·비용만 더한다. 의도가 모호한 자유 텍스트는 검색창 하나뿐. |
| **라우터 도구** | `search_places`(+region) · `search_web` **2종만** | (i) 검색 의도 한정(실시간/버튼 제외). **주소(juso)는 라우터 밖 병렬 유지** — 이미 무료·무제한·결정론적이라 LLM 뒤에 둘 이유 없고, "장소+주소 병렬"은 회귀 교훈까지 박힌 검증된 기능이라 단발 단일선택으로 바꾸면 "강동"처럼 장소이자 주소인 입력에서 한쪽을 잃는다. |
| **Perplexity** | 길 A + 길 B 모두 | 길 A = Gemini가 분류 단계에서 웹 질의를 `search_web`으로 라우팅. 길 B = 장소 0건일 때 **코드가 결정적으로** 웹 폴백(단발이라 Gemini는 0건을 못 보므로 코드가 결정). |

### Gemini ↔ Perplexity 메커니즘

Gemini는 네이티브 웹 검색을 못 한다(코드 확인: Google Search grounding 미사용). Perplexity가 웹 검색 엔진이고, function-calling 다리로 연결된다 — Gemini가 "무엇을 검색할지" 판단(두뇌), Perplexity가 실제로 웹을 뒤짐(손), 호출 중개는 항상 서버 코드(키는 서버 전용). **단발에서는 Gemini가 결과를 되읽어 종합하지 않는다** — 종합은 풀 에이전트 루프에서만 일어난다. 따라서 검색창에서 Perplexity 결과는 종합 없이 `WebResults` 카드로 그대로 렌더된다.

## 3. 아키텍처 / 파이프라인

```
검색어 + userCoords
   │
   ├─────────────────────────────────┐
   ▼ (병렬, 기존 그대로·무료)          ▼ Gemini 단발 분류 (1왕복, ai 주입)
  /api/address/search (juso)      classifySearchQuery → SearchIntent
   │ (PlaceSearch 변경 없음)            │
   │                          ┌────────┴─────────┐
   │                          ▼ PLACE            ▼ WEB (길 A)
   │              region? → geocode(region) → anchor      searchWebPerplexity
   │              (없으면 userCoords 앵커)                    │
   │              → searchPlaces(keyword, anchor)            │
   │                          │                             │
   │                          ▼ 0건 & hasPerplexityKey (길 B)│
   │                  searchWebPerplexity(원쿼리)            │
   ▼                          ▼                             ▼
  주소 섹션            장소 섹션  또는  웹 섹션(fallbackFrom:"place")   웹 섹션
   └────────── orderResultSections: 결과 있는 섹션 위로 (web 추가) ──────────┘
```

place와 web은 **상호배타**(라우터가 하나만 선택). 화면엔 최대 {place 또는 web} + {address}.

### 동작 예시

- `암사동 캐나다 식당` → PLACE{region:"암사동", keyword:"양식·서양음식점"} → 암사동 앵커 카카오 검색. 0건이면 길 B 웹 폴백.
- `환율 최신` → WEB → Perplexity 웹 카드(길 A). juso 병렬은 0건이라 주소 섹션 없음.
- `길동 카페` → PLACE{keyword:"카페", region:"길동"} → 평소처럼 즉시(Gemini 단순 분류만).
- `세종대로 110` → Gemini가 PLACE로 가도 카카오는 약하지만, **juso 병렬이 주소 2건**을 잡아 주소 섹션이 뜸 → 기존 통합검색 가치 보존.

## 4. 모듈 / 인터페이스

### 새 모듈: `src/lib/search-router/` (React 비의존 — dodo 이식성, `src/lib/chat/`와 동형)

```
types.ts
  SearchIntent =
    | { kind: "place"; keyword: string; region?: string }
    | { kind: "web"; query: string; recency?: string }
  SearchRouteResult =
    | { kind: "place"; places: Place[] }
    | { kind: "web"; web: WebSearchResult[]; fallbackFrom?: "place" }

declarations.ts
  buildSearchDeclarations(): FunctionDeclaration[]  // 순수 데이터, 2종
    - search_places { keyword: string, region?: string }
    - search_web    { query: string, recency?: enum(hour|day|week|month|year) }

classify.ts
  classifySearchQuery({ query, locale, ai }): Promise<SearchIntent>
    - Gemini 단발 호출(주입 ai = getGeminiClient()), GEMINI_MODEL 재사용
    - systemInstruction: "분류만·지역/키워드 추출·산문 절대 금지"
    - functionCall 파싱 → SearchIntent
    - 무응답/throw/알 수 없는 도구 → { kind:"place", keyword: query } graceful 기본값(현행 동작으로 강등)

flow.ts (순수 — 결정적 테스트)
  pickAnchor(geocoded: Coords|null, userCoords: Coords|null): Coords|null
  shouldFallbackToWeb(placeCount: number, hasPerplexity: boolean): boolean
```

`classify.ts`는 `agent-loop.ts`의 ai 주입 패턴을 따라 mock으로 결정적 테스트한다. systemInstruction의 "산문 금지"가 채팅 회귀를 구조적으로 차단한다.

### 새 라우트: `src/app/api/search/route.ts` (thin 오케스트레이터)

```
GET ?query&lang&lat&lng
  zod: query(1~100), lang(ko|en), lat/lng optional(.catch undefined)
  1. !hasGeminiKey() → searchPlaces({query,lang,lat,lng}) → { kind:"place", places }   // 회귀 0
  2. ai = getGeminiClient(); intent = classifySearchQuery({ query, locale:lang, ai })
     - web   → searchWebPerplexity({query:intent.query, max_results, recency:intent.recency})
               → { kind:"web", web }                                                    // 길 A
     - place → geocoded = intent.region ? await geocodeRegion(intent.region) : null
               anchor = pickAnchor(geocoded, {lat,lng})
               result = searchPlaces({ query:intent.keyword, lang, ...anchor })
               shouldFallbackToWeb(result.places.length, hasPerplexityKey())
                 ? searchWebPerplexity({query}) → { kind:"web", web, fallbackFrom:"place" }  // 길 B
                 : { kind:"place", places: result.places }
  catch → best-effort: naive 장소검색 또는 502(파국 시)
```

`geocodeRegion(region)`: 카카오 주소검색(`searchAddress(region, 1)`) 첫 좌표 재사용, 실패→null(graceful, userCoords 앵커로).

### 변경 파일

| 파일 | 변경 |
|---|---|
| `src/components/PlaceSearch.tsx` | `performSearch`가 `/api/places`→**`/api/search`** 호출, 응답 `{kind}` 분기(place→`ResultList`, web→`WebResults`). **주소 병렬(`performAddressSearch`) 불변.** request-id stale 가드·`?q=` URL 동기화·focus 동작 유지 |
| `src/lib/search-sections.ts` | `SectionKind`에 `"web"` 추가, `orderResultSections`·`combinedLiveMessage` 웹 섹션 확장 |
| `src/components/chat/WebResults.tsx` → `src/components/WebResults.tsx` | 채팅 밖에서도 쓰므로 이동(채팅 import 경로도 갱신) |
| `messages/{ko,en,es,fr,it}.json` | 웹 섹션 헤딩·"웹 결과 N건" 통지·길 B 안내문 |

**재사용(신규 외부 API·키 0)**: `searchWebPerplexity`·`WebResults`·`getGeminiClient`·`GEMINI_MODEL`·`searchPlaces`·`searchAddress`·`focusedForSearchRef`·`orderResultSections`. Gemini·Perplexity·카카오 모두 기존 키.

## 5. 데이터 흐름 / 렌더

- 클라이언트 `runQuerySearch`는 두 갈래 병렬: `/api/search`(장소-or-웹) + `/api/address/search`(주소, 불변).
- `dataLocale`/`prefersEnglish` 준수: classify에 locale 전달, 장소 키워드는 데이터 언어로 재해석, places fetch는 `dataLocale(lang)`. 웹 쿼리는 사용자 입력 언어 유지(Perplexity 다국어).
- `orderResultSections`: place·web 상호배타라 화면엔 최대 2섹션. 결과 있는 섹션 위로, 단일 섹션이면 구분 헤딩 생략.

## 6. 접근성 / 에러 처리

### 접근성

- **단일 polite live region**(기존 `combinedLiveMessage`)에 웹 건수 합산("웹 결과 N건" / 길 B는 "장소 0건, 웹 N건"). 새 채널 안 만듦(중복 낭독 회귀 교훈 준수).
- 검색 settle 후 결과 헤딩 1회 포커스(기존 `focusedForSearchRef`).
- `WebResults`는 자체 h3/h4 시맨틱 보유. 단일/복수 섹션 헤딩 규칙은 기존과 동일.
- Gemini 지연(~0.5초)은 기존 로딩 상태가 덮음 — 추가 ARIA 없음.
- UI 변경 후 `a11y-auditor` 서브에이전트 점검.

### 에러 처리 (모두 graceful degrade)

| 실패 | 처리 |
|---|---|
| Gemini 분류 throw/무응답 | naive 장소검색으로 강등(현행 동작) — 사용자에 에러 안 띄움 |
| 지역 지오코딩 실패 | `userCoords` 앵커로 폴백 |
| Perplexity 실패 (길 A) | 기존 `placeErrored` 채널로 검색 에러 통지 |
| Perplexity 실패 (길 B) | 0건 장소 섹션("결과 없음")으로 복귀 — 웹 실패가 유효 시도를 못 지움 |

라우트는 best-effort 200 반환, 파국적 경우만 502.

## 7. 테스트 / 머지 게이트

### 단위 (Vitest, node-env, mock ai)

- `classifySearchQuery`: `암사동 캐나다 식당`→place{region}, `환율 최신`→web, `길동 카페`→place, 무응답/throw→place 기본값, 알 수 없는 도구→place 기본값.
- `pickAnchor`(geocoded 우선, 없으면 userCoords, 둘 다 없으면 null), `shouldFallbackToWeb`(0 & hasPerplexity→true, 그 외 false) 순수.
- `orderResultSections`·`combinedLiveMessage` 웹 확장.
- `buildSearchDeclarations` 형태(2종, region optional).

### 실호출 머지 게이트 (CLAUDE.md "실호출이 머지 게이트")

dev 서버:
- `/api/search?query=암사동 캐나다 식당` → place(암사동 앵커) 또는 길 B 웹.
- `/api/search?query=환율 최신` → web(길 A).
- `/api/search?query=길동 카페` → **place(회귀: 단순 검색 즉시·웹 미발동)**.
- Gemini 키 없는 경로(임시 비활성) → 결정론 장소.

## 8. 비목표 (V1 제외)

- 실시간/버튼 의도의 자연어 라우팅(지하철·버스 등) — 후속 마일스톤.
- 풀 에이전트 루프(멀티턴 자기교정) — 지연 이유로 제외.
- 검색→상세 진입 외 채팅식 멀티턴.
- 웹 결과의 Gemini 종합(산문) — 단발 원칙상 카드 raw 렌더.
- dodo-planet 이식 — 모듈은 React 비의존으로 이식 가능하게 두되 이식 자체는 별도 사이클.
