# Perplexity 웹 검색 채팅 도구 — 설계 (dodo-planet 이식)

> 2026-06-21. 길동무 Gemini function-calling 채팅에 **실시간 웹 검색** 도구를 추가한다.
> dodo-planet의 `search_web_perplexity`를 길동무 에이전틱(`ToolResult`) 구조로 적응 이식한다.

## 동기

길동무 채팅의 13개 도구는 모두 **국내 로컬 API 정본**(장소·교통·공기질·날씨 등)이라
"최신 뉴스·실시간 정책·공식 발표·임시 운영시간·환율" 같은 **시의성 있는 웹 정보**를 다루지 못한다.
Perplexity Search API를 14번째 도구로 붙여 LLM이 필요 시 웹을 조회·종합하게 한다.
한국 방문 외국인(입국 정책·교통 공지)과 시각장애인(실시간 변동 정보)에게 특히 유효.

## dodo → 길동무 적응 (핵심 차이)

| | dodo-planet | 길동무 |
|---|---|---|
| 도구 반환 | JSON **문자열** | `ToolResult{data, render?, source?}` |
| 에러 메시지 | `rm()` 5개 언어 (사용자 직접 노출) | `data.error`(LLM-facing) → LLM이 사용자 언어로 표현 |
| 결과 노출 | 산문 인용만 | **웹 결과 카드**(제목+링크+요약) + 산문 종합 |
| 키 게이트 | 런타임 분기 | `hasPerplexityKey()` → `availableDeclarations()` 필터(키 없으면 모델이 호출 불가) |

**결과 카드 결정(위원장 승인 2026-06-21)**: dodo는 카드 없이 LLM이 산문에 인용하지만,
길동무는 "정보의 정본은 리스트/텍스트 UI"이고 시각장애 사용자가 출처를 **직접 클릭해 검증**해야 하므로
각 결과를 제목 링크 + 요약 카드(`web-results` render type)로 노출한다.

## 아키텍처

```
Gemini가 search_web 호출
  → router.ts case "search_web"
    → searchWebPerplexity(args, locale): ToolResult
      → POST https://api.perplexity.ai/search (Bearer, 10s timeout)
      → 성공: { data: {results...}, render: {type:"web-results", results}, source:[PERPLEXITY] }
      → 실패: { data: {ok:false, error, message} }   (카드·출처 없음 — LLM이 실패 표현)
  → agent-loop: data를 LLM에 관찰로 전달(다음 iteration), render·source 누적
  → done 이벤트: MessageBubble이 web-results 카드 + 출처 푸터 렌더
```

## 변경 파일

1. **`src/lib/types.ts`** — `WebSearchResult` 도메인 타입 추가
   ```ts
   export interface WebSearchResult {
     title: string;
     url: string;
     snippet: string;
     date: string | null;
   }
   ```

2. **`src/lib/chat/types.ts`** — `RenderPayload` 유니온에 추가
   ```ts
   | { type: "web-results"; results: WebSearchResult[] }   // <WebResults results/>
   ```

3. **`src/lib/env.ts`** — `PERPLEXITY_API_KEY` 스키마 + parse + `hasPerplexityKey()`

4. **`src/lib/chat/perplexity-search.ts`** (신설) — dodo 로직 이식 + `ToolResult` 적응
   - 쿼리 trim·빈값 거부, `max_results` clamp 1~10(기본 5), `search_recency_filter` 화이트리스트(hour/day/week/month/year), 10s AbortController 타임아웃
   - 401/403→AUTH, 429→RATE_LIMIT, 그 외 비정상→SERVER_ERROR, fetch 예외→NETWORK_ERROR
   - 성공: `{ data: {ok,query,count,results}, render: {type:"web-results", results: trimmed} }`
   - 실패: `{ data: {ok:false, error, message} }` (message는 LLM-facing 한국어 — LLM이 사용자 언어로 재표현)
   - React/Next 비의존(dodo 이식성), `ToolResult` 타입만 import

5. **`src/lib/chat/declarations.ts`** — `search_web` 선언(gate=`hasPerplexityKey`)
   - 파라미터: `query`(required), `max_results`(number, 기본5·최대10), `search_recency_filter`(hour/day/week/month/year)
   - description: "최신 뉴스·실시간 정책·공식 발표·운영시간 등 **최근 웹 데이터**가 필요할 때. 국내 로컬 API(장소·교통·공기질)로 답할 수 있으면 그쪽을 우선."

6. **`src/lib/chat/router.ts`** — `case "search_web"`: `searchWebPerplexity` 호출 후 `source: src` 부착

7. **`src/lib/chat/sources.ts`** — `PERPLEXITY = { label:"source.perplexity", url:"https://www.perplexity.ai" }`, `case "search_web": return [PERPLEXITY]`

8. **`src/components/chat/WebResults.tsx`** (신설) — 결과 카드
   - `h3`(`chat.webResults.heading`) + 결과 링크 목록(제목 링크 + 요약 `<p>`)
   - 링크는 회전자 link 점프로 발견(검색 결과 PlaceCard가 버튼이듯), 미니멀(과잉 region 없음)
   - 빈 배열이면 미렌더

9. **`src/components/chat/MessageBubble.tsx`** — `RenderBlock`에 `case "web-results": return <WebResults results={render.results} />`

10. **`src/app/api/chat/route.ts`** — 시스템 프롬프트 `[도구 사용]`에 한 줄: "최신·실시간 웹 정보(뉴스·정책·환율·임시 운영시간)는 `search_web`로 조회하되, 국내 장소·교통·공기질은 전용 도구를 우선하라."

11. **`messages/{ko,en,es,fr,it}.json`** — `chat.source.perplexity`, `chat.progress.tool.search_web`, `chat.webResults.heading` 3종 추가

12. **테스트** — `src/lib/chat/__tests__/perplexity-search.test.ts`: dodo 9개 케이스 이식(ToolResult 적응 — `parsed.ok` 대신 `result.data.ok`, 성공 시 `result.render.type==="web-results"` 검증 추가)

## 키 수급

- `PERPLEXITY_API_KEY` — dodo-planet `.env.local`에서 수입(공유 키, Deepgram·Gemini 동형)
- 로컬 검증 후 Vercel 프로덕션 등록(`vercel@latest` 사용 — env add 빈값 버그 회피, 메모리 `vercel-env-add-noninteractive-bug`)

## 불변식

- **I-1 게이트**: 키 없으면 `search_web` 선언이 노출 안 됨 → 모델 호출 불가 → 회귀 0(기존 13도구 byte-identical)
- **I-2 실패 흡수**: Perplexity 실패는 `data.error`로 LLM에 전달, 루프 안 죽임(agent-loop allSettled)
- **I-3 카드/출처 비대칭**: 성공만 카드+출처, 실패는 산문으로만 실패 통지
- **I-4 PII 없음**: 웹 결과는 공개 데이터 → render에 결과 그대로 실어도 누수 아님(places/addresses 동형)

## 검증 (머지 게이트)

- 단위 테스트: perplexity-search 9개(성공 정규화·빈쿼리·clamp·401/429/500·키없음·타임아웃·recency)
- i18n 키 일관성: `i18n-messages.test.ts`(ko 기준 키 집합)
- **실호출**: dev `/api/chat`에 "스페인 입국 정책 최신" 류 질의 → `search_web` 호출·결과 카드·출처 Perplexity 확인
- lint + build (컴포넌트 와이어링 게이트 — node-env 테스트 레인 없음)
