# dodo-planet 한국 여행 API·채팅 카드 이식 설계 (Spec B)

> 2026-06-21 · **gildongmu → dodo-planet 이식 설계(spec만, 미구현)**. 이 문서는 미래 사이클에서 자체 plan으로 전개될 설계 altitude 문서다. 관련: [로드맵](2026-06-21-chat-relocation-and-dodo-port-roadmap.md), [장소별 채팅 spec](2026-06-21-place-scoped-chat-design.md)

## 1. 목표와 동기

gildongmu는 **국내 서비스 연동 실험실**이고 궁극 목표는 "검증된 기능을 dodo-planet(가족 여행 가이드 PWA)에 통합"이다. dodo는 이미 **채팅 중심 + Gemini function-calling + 44개 도구**를 갖췄으나 한국 로컬 정보(지하철·버스·따릉이·소아진료·공기질·날씨·도로명주소·대중교통 길찾기·역 메타/시설)가 없다.

→ gildongmu에서 **실호출로 검증 완료한 한국 여행 API 스택과 채팅 답변 카드·출처 UI**를 dodo에 이식해, 한국 방문 가족 여행자에게 맞춤 정보를 제공한다. 위원장 방침: **API 키와 채팅 답변 카드는 거의 그대로 가져다 쓴다.**

## 2. 현황 격차 (이식 조사, 2026-06-21)

| 항목 | dodo 현재 | gildongmu | 이식 난이도 |
|---|---|---|---|
| `executeFunction` 반환 | `string`(JSON 직렬화) | `ToolResult{data,render,source}` | **큰 변경** — 카드/출처 인프라 전무 |
| `RenderPayload` 타입·카드 디스패치 | 없음(마크다운만) | 15종 discriminated union + MessageBubble RenderBlock | 신규 도입 |
| `SourceAttribution`·`SourceList` | 없음 | 있음(출처 푸터) | 신규 도입 |
| 한국 provider | kakao-local·google·tour-api 정도 | 23개(subway·bus·bike·clinic·kids·surroundings·air·weather·juso·odsay·ncp·역 메타/시설) | 코드 이식·공존 |
| 에이전트 루프 | `generateWithFCLoop`(서버 내장) | `runAgentLoop`(React/Next 비의존, 테스트 용이) | gildongmu 패턴이 더 깔끔 |
| env 키 | KAKAO(선택)·AMADEUS·GOOGLE·PERPLEXITY | + TOUR·DATA_GO_KR·SEOUL_*·ODSAY·JUSO·NCP | 키 추가(.env 거의 그대로) |

dodo의 도메인 함수(여행 예약·경비·피드·아기 정보·일정 등 44개)는 **그대로 유지**하고, 한국 도구는 **추가·공존**한다(통합/대체 아님).

## 3. 이식 아키텍처 — 4계층

### 계층 1: ToolResult 타입 도입
- dodo `src/lib/gemini/types.ts`에 `ToolResult{data, render?, source?}`·`RenderPayload`·`SourceAttribution` 추가.
- 기존 44개 함수는 **`{ data: <기존 문자열/객체> }` 최소 래핑**으로 점진 호환(렌더/출처 없이도 동작). 한 번에 다 안 바꿔도 됨 — `executeFunction`이 `string | ToolResult`를 흡수하는 어댑터를 두거나, 반환을 `ToolResult`로 통일하되 `render`·`source`는 옵셔널.
- **리스크**: dodo `router.ts`가 모든 도메인 함수를 호출하므로 시그니처 전환이 파급. → 어댑터 경유로 폭발 차단(새 한국 도구만 render/source 채움, 기존은 data만).

### 계층 2: 한국 provider 이식
- gildongmu `src/lib/providers/`의 한국 스택을 dodo `src/lib/providers/`로 복사. `src/lib/`는 **React/Next 비의존**으로 유지(원래 이식성 목표)이므로 대부분 그대로 이동 가능.
- 대상: `places.ts`(한국 우선순위)·`kakao-*`·`tour-api`·`juso-address`·`ncp-*`·`odsay`·`subway-nearby`·`seoul-subway-arrival`·`tago-bus`·`seoul-bike`·`seoul-metro-facilities`·`korail-facilities`·`subway-stations`(+seed json)·`night-clinic`·`kids-places`·`surroundings`·`air-quality`·`weather`·`geo/bearing`.
- dodo의 `selectPlacesProvider`와 **공존**: 한국 + 좌표 + 카카오 키 → 한국 스택, 그 외 → 기존 google. (이미 dodo에 tour-api 우선 분기 선례 있음.)

### 계층 3: 도구 declaration·카드 UI
- gildongmu의 **13개 한국 도구 declaration**(게이트 포함: `hasKakaoKey`·`hasDataGoKrKey`·`hasSeoulSubwayRealtimeKey`·`hasSeoulOpenDataKey`·`hasJusoKey`·`hasOdsayKey`)을 dodo `declarations.ts`에 추가. dodo의 동적 필터(`TRIP_DEPENDENT`·`BUILDER_ONLY`)와 **함수 개수 10–20 권장** 정합을 위해, 한국 도구는 **한국 체류 컨텍스트(국가코드/도시) + 키 존재 시만 노출**.
- **카드·출처 UI**: gildongmu `MessageBubble`의 RenderBlock 디스패치·카드 컴포넌트(`ResultList`·`SubwayArrivalsNearby`·`AirQuality`/`LocalConditions`·`CarRouteBriefing`·`TransitRouteBriefing` 등)·`SourceList`를 dodo `components/chat/`로 이식. **단, 카드 컴포넌트는 gildongmu 컴포넌트·훅(useGeolocation 등)에 의존** → 이식 시 의존성 동반 또는 dodo 등가물로 치환 필요(주의 지점).

### 계층 4: env·게이트
- dodo `.env.local`에 한국 키 추가: `TOUR_API_KEY`·`DATA_GO_KR_API_KEY`·`SEOUL_OPEN_DATA_KEY`·`SEOUL_SUBWAY_REALTIME_KEY`·`ODSAY_API_KEY`·`JUSO_CONFM_KEY`·`NCP_MAPS_CLIENT_ID/SECRET`. **gildongmu .env에서 거의 그대로 복사**(`GEMINI`/`KAKAO`/`DEEPGRAM`은 이미 공유 키).
- Vercel 프로덕션 env 등록 + 재배포 필요(키 추가 후 재배포 안 하면 옛 env — gildongmu 실측 교훈).

## 4. 알려진 리스크·미해결

- **ODsay 대중교통**: Server 방식 공인 IP 화이트리스트라 Vercel 가변 IP 프로덕션 미동작(gildongmu와 동일 한계). dodo도 같은 벽 → 고정 IP/프록시/유료 또는 도구에서 제외 후 별도 처리.
- **ToolResult 파급**: 계층 1 전환이 dodo 전 도메인에 닿음 → 어댑터로 폭 제한 필수.
- **카드 의존성**: gildongmu 카드가 gildongmu 전용 훅/스토어(geolocation·nearby-panel)에 묶임 → 이식 시 동반 또는 치환 결정 필요.
- **함수 수 상한**: dodo 44 + 한국 13 = 57. Gemini 권장 10–20 초과 → 컨텍스트별 동적 필터(한국 체류 시만 한국 도구, 비한국 시 숨김)가 필수.
- **카카오맵 API 정책 변경(2026-07-21)**: 무료쿼터=개발자계정 첫 활성화 앱만. dodo는 자체 카카오 앱이므로 영향 점검 필요(gildongmu는 dodo 앱 공유라 무영향).

## 5. 역수입 후보 (dodo → gildongmu 또는 양방향)

이식 과정에서 정리되는 패턴 중 dodo에 두면 좋은 것: `ToolResult` 3분할·NDJSON 스트리밍·출처 블록·`remarkTightLists`(loose list VoiceOver 이중 낭독 방지)·에이전틱 산문+self-fetch 카드 하이브리드. gildongmu가 dodo에서 이식해온 구조의 진화분이므로 **dodo 본가에 역수입**.

## 6. 이 문서의 지위

- **spec-only**. 구현 시점(Phase 3, 미래 사이클)에 이 설계를 입력으로 별도 `writing-plans`를 돌려 단계별 plan을 만든 뒤 구현한다.
- altitude: 아키텍처·계층·리스크 수준. 라인 단위 매핑은 plan 단계에서. 외부 API 통합은 **실호출을 머지 게이트**로 박는 원칙 유지(fixture green ≠ 실계약).
