# 길동무 채팅 — 에이전틱 워크플로우 전환 설계

> 작성 2026-06-20. 채팅 모드를 "버튼만 띄우는 단발 호출"에서 "의도 이해 → 필요 API 연쇄 호출 → 후속 정보 수집 → 끝까지 종합 응답"하는 에이전틱 루프로 전환한다. dodo-planet의 `generateWithFCLoop`·NDJSON 스트리밍 패턴을 이식·적응한다.

## 1. 문제 정의 (현재 한계)

현재 `/api/chat`은 **2-pass 단발 호출**이다:

1. `generateContent(tools)` → functionCall **1개**만 추출
2. `executeFunction` → 대부분 `{ summary: "아래에 표시했습니다", render }` 반환 (좌표/파라미터만 추출, 실데이터 미수집)
3. `generateContent(no tools)` → "표시했습니다" 요약만 보고 산문 생성

세 가지 구조적 한계:

- **연쇄 불가**: 도구를 딱 한 번만 호출. "역 찾기 → 도착정보 → 날씨 종합" 같은 다단계 워크플로 불가능.
- **LLM이 실데이터를 못 봄**: self-fetch 카드 계열(지하철·버스·공기질 등)은 router가 데이터를 가져오지 않으므로 Gemini는 "아래에 표시했습니다"라는 빈 요약만 받는다. 진짜 종합·판단이 불가능 = "버튼만 띄우는 수준".
- **2번째 패스에 tools 미전달**: 일부러 추가 호출을 막아 단발을 강제.

## 2. 목표 (측정 가능한 성과)

- **연쇄 호출 동작**: dev 실호출에서 한 질문("강남역 가는 길과 거기 날씨")이 ≥2개 도구를 연쇄 호출하고, Gemini가 그 실데이터를 종합한 산문을 반환한다.
- **실데이터 근거 응답**: 응답 산문이 실제 수치/등급/경로를 인용한다(예: "통합대기환경지수 229, 나쁨"). "표시했습니다" 류 빈 요약 금지.
- **중간 중단 없음**: 수십 초 걸려도 스트리밍 진행 이벤트가 흐르고, 빈 버블·무응답으로 끝나지 않는다.
- **딥링크·출처 보존**: 기존 카드(딥링크·tel·역시설 region)가 하단에 그대로 마운트되고, 추가로 구조화 출처 블록이 붙는다.

## 3. 확정된 설계 결정 (위원장 승인 2026-06-20)

1. **하이브리드 응답**: Gemini 종합 산문(맨 위) + 기존 self-fetch 카드/딥링크/출처(하단). 산문=판단·요약, 카드=상세·딥링크·출처로 역할 분리.
2. **스트리밍 진행 이벤트 + 최종답변 1회 낭독**: NDJSON으로 진행 단계(`status`)를 polite 통지하되, 완성된 최종 산문은 1회만 낭독(토큰별 스트리밍 아님 — 재낭독 소음 차단).
3. **적극적 에이전트**: 의도 충족에 필요한 관련 도구를 자율 연쇄(경로면 날씨·공기질 등). 단 명백히 무관한 건 호출 금지(과잉 방지).
4. **구조화 출처 블록**: 응답 하단에 사용한 데이터 제공처(카카오·에어코리아·기상청·ODsay 등)를 명시적으로 나열. 딥링크는 기존 카드가 제공.

## 4. 아키텍처

```
사용자 발화
  → /api/chat (ReadableStream + NDJSON, maxDuration=120)
      → runAgentLoop({ ai, model, history, ctx, onStatus })
          반복 (iter < MAX=6):
            generateContent(contents, { systemInstruction, tools })
            functionCall 파트 추출
            ├─ 없음 → 최종 text 확보 → break
            └─ 있음 → Promise.allSettled(도구 병렬 실행)
                       각 도구: provider 직접 호출 → { data, render?, source? }
                       onStatus(categories)  ── status 이벤트 스트리밍
                       model content + functionResponse(data) history push
                       renders·sources 누적
          루프 종료 후 text 비면 → tools 없이 1회 강제 generateContent (폴백)
          반환 { text, renders[], sources[] }
      → done 이벤트 emit { text, renders, sources }
  → useChat: NDJSON 파싱 → 최종 ChatMessage
  → MessageBubble: 산문 + renders[] 카드 + SourceList
```

### 핵심 불변식 (코드 쓰기 전 고정)

- **I-1 도구 실패가 루프를 죽이지 않는다**: `Promise.allSettled` + rejected는 `data: { error: "<사유>" }`로 LLM에 전달. Gemini가 지어내지 않고 실패를 안내하도록 systemInstruction이 강제.
- **I-2 빈 text 절대 반환 안 함**: 루프 종료 후에도 text가 비면 tools 없이 1회 더 호출(dodo 3단계 폴백 정신). 그래도 비면 i18n 폴백 문구.
- **I-3 카드는 done에서 1회 마운트**: 진행 중엔 status만 흐르고, renders는 done에 실어 최종 산문과 함께 한 번에 등장(중복 낭독 차단, "1회 낭독" 결정 정합).
- **I-4 router는 provider를 직접 import 호출**(HTTP 우회): 서버 내부 함수 호출이라 라운드트립 없음. self-fetch 카드는 별도로 /api 경유 fetch(이중 호출이나 provider revalidate 캐시가 흡수). **컴포넌트 무수정**.
- **I-5 데이터 언어 분리 유지**: 외부 데이터 fetch·영문 분기는 `ctx.dataLocale`/`prefersEnglish`를 거친다(기존 규칙). `useLocale()` 원시값 직접 사용 금지.

## 5. 데이터 계약 (`src/lib/chat/types.ts`)

```ts
// 도구 결과 — 3분할 (summary 단일 → data/render/source)
interface ToolResult {
  data: Record<string, unknown>;    // [신설] LLM이 추론할 실제 JSON (요약 문자열 아님)
  render?: RenderPayload;           // [유지] 마운트할 카드 (discriminated union)
  source?: SourceAttribution;       // [신설] 데이터 제공처
}

// 데이터 제공처
interface SourceAttribution {
  label: string;   // 표시명 (i18n 키 또는 직접 문자열) — sources.ts가 생성
  url?: string;    // 선택적 출처 링크
}

// 메시지 — render 단수 → renders 복수
interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  renders?: RenderPayload[];        // [변경] render 단수 → renders 복수
  sources?: SourceAttribution[];    // [신설]
  error?: string;
}

// NDJSON 스트리밍 이벤트
type ChatStreamEvent =
  | { type: "status"; categories: string[] }                                    // 진행 통지
  | { type: "done"; text: string; renders: RenderPayload[]; sources: SourceAttribution[] }
  | { type: "error"; code: string };
```

`RenderPayload` discriminated union은 현 정의 그대로 유지(13개 도구의 마운트 변종).

## 6. 라우터 (`src/lib/chat/router.ts`) — 도구가 실데이터 반환

`executeFunction` 반환을 `{ summary } → { data, render?, source? }`로 전환. 각 도구가 provider를 직접 호출해 LLM-facing 데이터를 만든다.

### 도구별 변경 패턴 (3분류)

**(a) props-driven (이미 fetch 중) — places·address**: 데이터를 그대로 `data`에 싣고, render는 데이터 첨부, source 추가.

```ts
case "search_places": {
  const result = await searchPlaces({ query, lang: ctx.dataLocale });
  return {
    data: { count: result.places.length, places: result.places.slice(0, 10) },
    render: placesToRender(result.places),
    source: sourceFor("search_places", ctx),  // en이면 카카오+TourAPI
  };
}
```

**(b) 좌표/지명 기반 self-fetch — air-quality·bus·bike·car-route·transit-route**: provider 직접 호출해 데이터 수집 + 카드 마운트 지시.

```ts
case "get_air_quality": {
  const coord = await resolveCoord(args.place, ctx);   // place geocode 또는 ctx.userLocation
  if (!coord) return { data: { error: "위치를 알 수 없음" } };
  const air = await getNearbyAirQuality(coord.lat, coord.lng);  // provider 직접 호출
  return {
    data: { air },
    render: { type: "air-quality", lat: coord.lat, lng: coord.lng },
    source: sourceFor("get_air_quality", ctx),
  };
}
```

**(c) 현재위치 nearby self-fetch — subway·clinics·kids·surroundings**: provider 직접 호출(현재위치 필요). userLocation 없으면 `data:{error}`.

```ts
case "get_subway_arrivals": {
  if (!ctx.userLocation) return { data: { error: "현재 위치 없음" } };
  const arrivals = await fetchNearbySubwayArrivals(ctx.userLocation);  // provider 직접
  return {
    data: { arrivals },
    render: { type: "subway-nearby" },
    source: sourceFor("get_subway_arrivals", ctx),
  };
}
```

> **provider 직접 호출 매핑** (router가 import): `searchPlaces`·`searchJusoAddresses`·`getNearbyAirQuality`·`fetchNearbySubwayArrivals`·버스(`fetchNearbyBusStops`)·따릉이·소아진료·kids·surroundings·`findStationMeta`·역시설(코레일+서울메트로)·자동차경로·ODsay. 각 provider의 기존 시그니처를 그대로 쓴다. 일부 도구는 station-meta처럼 정적 seed라 즉시 반환.

> `data`는 토큰 절약을 위해 상위 N건/핵심 필드만 싣는다(전체 배열 금지). LLM이 종합하기에 충분한 만큼만.

## 7. 출처 맵 (`src/lib/chat/sources.ts` 신설, 순수)

도구명 → `SourceAttribution` 정적 매핑. `ctx.dataLocale`로 분기(예: car-route는 ko=카카오모빌리티, en=NCP; places는 en이면 +TourAPI).

```ts
export function sourceFor(tool: string, ctx: ExecutionContext): SourceAttribution | undefined { ... }
export function dedupeSources(sources: SourceAttribution[]): SourceAttribution[] { ... }  // label 기준
```

제공처 라벨(i18n): 카카오, 행정안전부 도로명주소, 서울 열린데이터광장, 에어코리아(한국환경공단), 기상청, 국토교통부 TAGO, 국립중앙의료원, 카카오모빌리티, NCP, ODsay, 국가철도공단, 한국철도공사, 서울교통공사. **루프가 사용된 도구의 source를 수집 → `dedupeSources` → done에 적재**.

## 8. 에이전트 루프 (`src/lib/chat/agent-loop.ts` 신설, React/Next 비의존)

dodo `generateWithFCLoop` 이식 + gildongmu 적응. **테스트 가능하도록 ai 클라이언트를 주입**.

```ts
interface AgentLoopResult { text: string; renders: RenderPayload[]; sources: SourceAttribution[]; }

export async function runAgentLoop(opts: {
  ai: GoogleGenAI;
  model: string;
  systemInstruction: string;
  tools: { functionDeclarations: FunctionDeclaration[] }[];
  history: Content[];            // 시작 history (사용자 발화까지)
  ctx: ExecutionContext;
  onStatus?: (categories: string[]) => void;   // status 이벤트 콜백
  maxIterations?: number;        // 기본 6
}): Promise<AgentLoopResult>
```

루프 의사코드:

```
renders = []; sources = []
response = generateContent(history, { systemInstruction, tools })
iter = 0
while (iter < maxIterations):
  parts = response.candidates[0].content.parts
  fcParts = parts.filter(p => "functionCall" in p)
  if fcParts.length === 0: break               // 최종 text 도달
  history.push(modelContent)                    // Gemini 3 규약: thoughtSignature 보존
  onStatus(fcParts.map(categoryOf))             // 진행 통지
  settled = await Promise.allSettled(fcParts.map(p => executeFunction(p.name, p.args, ctx)))
  responseParts = []
  for each (fcPart, result) in settled:
    if fulfilled:
      if result.render: renders.push(result.render)
      if result.source: sources.push(result.source)
      responseParts.push({ functionResponse: { name, response: result.data } })
    else:  // I-1: 실패를 LLM에 전달, 루프 안 죽임
      responseParts.push({ functionResponse: { name, response: { error: String(reason) } } })
  history.push({ role: "user", parts: responseParts })
  response = generateContent(history, { systemInstruction, tools })   // tools 유지(연쇄)
  iter++
text = response.text ?? ""
if (text.trim() === ""):                        // I-2: 빈 text 폴백
  retry = generateContent(history, { systemInstruction })  // tools 없이 산문 강제
  text = retry.text ?? ""
return { text, renders: dedupeRenders?(renders), sources: dedupeSources(sources) }
```

- **maxIterations=6**: 적극 연쇄 수용(dodo는 3). 각 iteration이 병렬 도구 묶음이라 6라운드면 충분.
- **renders 중복**: 같은 카드가 두 번 마운트되지 않도록 type+파라미터 키로 dedupe(선택적, 같은 도구 반복 호출 대비).
- **tools 유지**: dodo와 동일하게 매 iteration에 tools 전달(현 코드의 "2패스 tools 제거"를 폐기). 빈 버블은 I-2 폴백이 막는다.

## 9. systemInstruction

```
너는 한국 로컬 정보 에이전트다. 사용자 언어({locale})로 답한다.

[도구 사용]
- 사용자 의도를 충족하는 데 필요한 도구를 충분히 호출하라. 관련 정보(경로 질문이면 날씨·공기질 등)는 자율적으로 연쇄 조회하되, 명백히 무관한 건 호출하지 마라.
- "확인 중", "잠시만요" 같은 대기 멘트로 턴을 끝내지 마라. 이 채팅엔 자동 후속이 없다 — 도구를 쓸 거면 같은 턴에 호출하고, 충분한 결과를 모은 뒤에만 최종 답변하라.

[신뢰성]
- 도구 결과 데이터에 근거해서만 사실을 말하라. 도구가 실패하거나 빈 결과면 지어내지 말고, 실패를 분명히 알린 뒤 구체적 대안 한 가지를 제시하라.
- 출처·딥링크는 시스템이 응답 하단에 자동으로 붙인다. 본문엔 URL을 나열하지 말고 간결하게 핵심만 종합하라.
```

## 10. 라우트 / 클라이언트 / UI

### `/api/chat/route.ts`
- `export const maxDuration = 120` (조기 중단 방지), `dynamic = "force-dynamic"` 유지.
- `ReadableStream` + NDJSON 인코더. `sendEvent(controller, { type, ... })` → `JSON.stringify(e)+"\n"`.
- `runAgentLoop({ ..., onStatus: cats => sendEvent({type:"status", categories:cats}) })`.
- 완료 시 `sendEvent({type:"done", text, renders, sources})`, 에러 시 `{type:"error", code:"chat_failed"}`, finally `controller.close()`.
- Content-Type `application/x-ndjson; charset=utf-8`, `Cache-Control: no-cache`.
- 키 없으면(현행) 502 `chat_unavailable`(스트림 시작 전 early return).

### `src/hooks/useChat.ts`
- NDJSON 리더(dodo `useChat` 패턴): `reader.read()` 루프, 버퍼 split("\n"), 줄별 JSON.parse.
  - `status` → `setProgressCategories(cats)` (진행 상태 노출)
  - `done` → 최종 ChatMessage push (`text`, `renders`, `sources`)
  - `error` → setError(code)
- `AbortController` 타임아웃 **120s로 상향**(현재 무타임아웃 → 명시). in-flight ref 유지.
- 반환에 `progressCategories` 추가(ChatInterface 통지용).

### `src/components/chat/ChatInterface.tsx`
- 진행 status용 **별도 polite live region** 추가(기존 최종답변 region과 분리 — 진행과 완료를 다른 채널로). `isLoading && progressCategories` 변할 때 "OO 조회 중" 통지.
- 최종답변 1회 낭독(기존 `lastAssistant` 로직) 유지.

### `src/components/chat/MessageBubble.tsx`
- `message.render` → `message.renders?.map(...)` (복수 카드). 기존 `RenderBlock` 디스패치 재사용.
- 카드들 아래 `<SourceList sources={message.sources} />` 렌더.

### `src/components/chat/SourceList.tsx` (신설)
- 미니멀 출처 푸터. 과잉 ARIA 없이 작은 `<p>` 헤딩("출처") + 라벨 목록(url 있으면 링크, 없으면 텍스트). sources 없으면 미렌더.

### `messages/*.json` ×5 (ko·en·es·fr·it)
- `chat.progress.*` (도구 카테고리별 진행 라벨), `chat.sources` (출처 헤딩), 제공처 라벨(`chat.source.*`). 기존 `i18n-messages.test.ts` 게이트 통과(ko 기준 키 집합·ICU·태그 동일).

## 11. 테스트 / 머지 게이트

- **`agent-loop` 단위테스트** (mock ai.models.generateContent): ① 연쇄 종료(2회 도구 후 text) ② renders/sources 수집 ③ 도구 실패 graceful(I-1) ④ 빈 text 폴백(I-2) ⑤ maxIterations 도달 시 강제 종료.
- **`router` 데이터 형태 테스트** (mock provider): 각 도구가 `{data, render?, source?}` 반환, 위치 없을 때 `data:{error}`.
- **`sources` 순수 테스트**: `sourceFor` 로케일 분기, `dedupeSources` 중복제거.
- **기존 `i18n-messages.test.ts`**: 신규 키 정합.
- **실호출 머지 게이트**(node-env Vitest엔 컴포넌트 와이어링 레인 없음): dev 서버에서
  - 연쇄: "강남역 가는 길 + 거기 날씨" → ≥2 도구 + 종합 산문 + 카드 + 출처
  - 단일: "길동 카페" → 장소 카드 + 출처
  - 실패 graceful: 위치 권한 없이 "주변 지하철" → 실패 안내(빈 버블 아님)
  - 빈 text 폴백 동작 확인

## 12. 비목표 (YAGNI)

- 토큰별 텍스트 스트리밍(재낭독 소음 — "1회 낭독" 결정에 위배).
- 카드 props-driven 전면 전환(이중 호출 최적화는 후속; V1은 컴포넌트 무수정 우선).
- 채팅→상세 진입 와이어링(기존 V1 no-op 유지).
- 멀티 모델 폴백(dodo 3-stage의 Stage 2 다른 모델 — gildongmu는 단일 모델 + tools-off 폴백으로 충분).
- PII 화이트리스트(dodo의 `function_result` 스트리밍 — gildongmu는 renders를 done에 모아 보내므로 불필요; 단 data는 LLM에만, 클라엔 render만 전달돼 원칙 유지).

## 13. 영향 파일 요약

| 파일 | 변경 |
|------|------|
| `src/lib/chat/types.ts` | ToolResult 3분할, ChatMessage renders 복수+sources, ChatStreamEvent, SourceAttribution |
| `src/lib/chat/router.ts` | 각 도구 provider 직접 호출 → `{data, render?, source?}` |
| `src/lib/chat/sources.ts` | **신설** — sourceFor·dedupeSources |
| `src/lib/chat/agent-loop.ts` | **신설** — runAgentLoop (multi-turn, ai 주입) |
| `src/lib/chat/render.ts` | summary 헬퍼 → data 헬퍼 정리(placesToRender 등 유지) |
| `src/app/api/chat/route.ts` | NDJSON 스트리밍, maxDuration, runAgentLoop |
| `src/hooks/useChat.ts` | NDJSON 파싱, progressCategories, 타임아웃 |
| `src/components/chat/ChatInterface.tsx` | 진행 live region |
| `src/components/chat/MessageBubble.tsx` | renders[] + SourceList |
| `src/components/chat/SourceList.tsx` | **신설** |
| `messages/*.json` ×5 | progress·sources·source 라벨 |
| `__tests__/` | agent-loop·router·sources 테스트 |
