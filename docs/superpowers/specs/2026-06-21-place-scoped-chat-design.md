# 장소별 채팅 재배치 설계 (Spec A)

> 2026-06-21 · gildongmu · 구현 대상(이번 사이클). 관련: [로드맵](2026-06-21-chat-relocation-and-dodo-port-roadmap.md), [dodo 이식 spec](2026-06-21-dodo-korea-api-port-design.md)

## 1. 배경과 문제

현재 채팅은 **메인 페이지에서 검색 모드 ↔ 채팅 모드로 분기**한다(`ModeToggle` + `mode-state.ts` + `keyboard-shortcuts.ts`). 실사용(PWA) 결과 위원장 판단:

- 메인 분기가 오히려 활용성을 떨어뜨리고, **"검색창 중심 초미니멀 내비게이션"** 콘셉트에서 멀어졌다.
- 채팅은 "막연한 채팅"이 아니라 **특정 장소에 관해 묻는 맥락**일 때 가장 유용하다.

따라서 채팅을 **메인 분기에서 떼어내고, 개별 장소 상세 화면의 컨텍스트 진입점**으로 재배치한다.

## 2. 핵심 원칙 — 엔진은 건드리지 않는다

채팅 **엔진·UI 코어는 한 줄도 바꾸지 않는다**. 그대로 재사용:

- `/api/chat` 라우트, `src/lib/chat/agent-loop.ts`(`runAgentLoop`), `src/lib/chat/router.ts`(13개 도구), `ToolResult{data,render,source}`
- `ChatInterface`, `useChat`, `MessageBubble`(RenderBlock·마크다운·tight-list), `SourceList`, `ChatInput`(음성 포함)

바뀌는 것은 오직 **(1) 진입·마운트 방식 (2) 장소 컨텍스트 주입**. 단, `/api/chat` 요청 계약에 **선택적 `placeContext` 필드 1개**를 더하는 것은 허용(하위호환, 없으면 기존과 동일 동작).

## 3. 확정된 결정 (2026-06-21, 위원장)

| 갈림길 | 결정 |
|---|---|
| 좌표 도구 기준 위치 | **선택한 그 장소 기준** (주변 카페·버스·공기질·둘러보기 등이 장소 좌표를 앵커로) |
| 예시 프롬프트 3개 | **장소 유형별 맞춤**(역/음식점·카페/일반 버킷) |
| 대화 상태 | **장소마다 새 대화로 시작**(오버레이 닫으면 초기화) |
| 닫기 동선 | **명시적 '채팅 닫기' 버튼** + Esc + 뒤로가기, 셋 다 트리거 버튼으로 포커스 복귀 |
| 거리 추적 | 코드 보존(삭제 금지), 마운트만 제거 — 미래 별도 브랜치에서 고도화 |

## 4. 작업 — 제거 (B-1: 메인 분기 해체)

**삭제 파일**
- `src/components/ModeToggle.tsx`
- `src/lib/chat/mode-state.ts` (+ `mode-state.test.ts`)
- `src/lib/chat/keyboard-shortcuts.ts` (+ 단위테스트)
- `src/hooks/useAppMode.ts`

**수정**
- `src/components/PlaceSearch.tsx`: 모드 분기 렌더(`mode==="chat"` 가지), `useAppMode` 구독, `changeMode`, 단축키 `keydown` 리스너, 모드 전환 포커스 effect, `ModeToggle` 렌더를 **전부 제거** → 순수 검색 컴포넌트로 환원. `canShowChat` prop은 제거하지 말고 **PlaceDetail로 전달**(용도 전환: 모드 게이트 → 장소 채팅 진입 게이트).
- `src/app/[locale]/page.tsx`: `canShowChat={hasGeminiKey()}`는 유지(전달 경로만 PlaceSearch→PlaceDetail로 바뀜).
- i18n(`messages/*.json`): 모드 토글 라벨·단축키 힌트 키 제거(`chat.shortcut.*`, 토글 라벨 등). `i18n-messages.test.ts` 키 패리티 유지.

## 5. 작업 — 숨김 (B-2: 거리 추적 코드 보존)

- `src/components/PlaceDetail.tsx`의 `<DistanceBeacon dest={...} />` **마운트 한 줄만 제거**.
- **보존(삭제 금지)**: `DistanceBeacon.tsx`, `src/hooks/useDistanceBeacon.ts`, `src/lib/beacon.ts`, `src/hooks/useBeaconSound.ts`, `src/hooks/useScreenWakeLock.ts`, `messages/*.json`의 `beacon.*` 키.
- **왜 죽은 코드가 아닌가**: 위원장이 "추후 별도 브랜치에서 고도화하여 작동 확인 후 다시 추가"를 명시. 거리 추적은 watchPosition 기반 미완성 기능이며 **의도된 보류**다. 죽은 코드 청소(미사용 export/i18n 키 제거) 시 이 5개 파일과 `beacon.*` 키는 제거 금지 — 이 spec이 그 근거.

## 6. 작업 — 추가 (B-3: 장소별 채팅 진입 + 오버레이)

### 6-1. 진입 버튼 (PlaceDetail)
- 거리 추적이 있던 자리(`RouteLinks` 뒤, `CarRouteBriefing` 앞)에 **"이 장소에 관해 물어보기 / Ask about this place"** 버튼.
- 게이트: `canShowChat`(`hasGeminiKey()`)가 true일 때만 렌더. 없으면 진입점 없음(순수 검색·상세 회귀 0).
- `triggerRef`(`useRef<HTMLButtonElement>`)로 버튼 참조 보관 → 닫기 시 포커스 복귀 대상.

### 6-2. ChatOverlay 컴포넌트 (신규)
- `role="dialog"` `aria-modal="true"` `aria-labelledby`(오버레이 h2). 미니멀 ARIA: dialog role + label로 충분, 추가 landmark·live region 신설 금지.
- **포커스 트랩**: Tab 순회가 오버레이 내부에 갇힘. 열릴 때 포커스를 오버레이 h2(`tabIndex={-1}`, "이 장소에 관해 물어보기")로 이동.
- **3중 닫기 동선**(전부 `restoreFocus=true`로 트리거 버튼 복귀):
  1. **명시적 '채팅 닫기 / Close chat' 버튼**(오버레이 헤더). 닫기 버튼 자체가 언마운트되며 포커스가 body로 유실되는 것을 막기 위해 닫기 직전 `triggerRef.current?.focus()`.
  2. **Esc** 키.
  3. **뒤로가기**: `openDetail`의 기존 History API 트랩 패턴 재사용 — 오버레이 열 때 `pushState`로 트랩 엔트리 추가, `popstate`로 닫기. (장소 상세 자체도 같은 패턴이라 "뒤로가기 → 채팅 닫힘 → 한 번 더 → 상세 닫힘" 자연 스택.)
- **선례 재사용**: 이 닫기·포커스 복귀 비대칭은 `src/lib/nearby-panel-store.ts`의 `close(restoreFocus)` 관용구와 동형. 가능하면 그 패턴을 따른다(검증된 a11y).

### 6-3. 채팅 내용 = 기존 ChatInterface
- 오버레이 본문에 **기존 `ChatInterface`를 장소마다 새로 마운트**. 오버레이를 닫으면 언마운트 → `useChat` 상태 자연 초기화("장소마다 새 대화").
- `ChatInterface`/`useChat`에 **`placeContext` prop 추가**(아래 7) → `/api/chat` 요청 body에 실어 보냄.

### 6-4. 빈 상태 = 예시 프롬프트 3개
- `messages.length === 0`일 때 오버레이에 **예시 프롬프트 버튼 3개** 노출. 클릭 → 그 텍스트를 첫 메시지로 `sendMessage`. 대화 시작되면(메시지 ≥ 1) 사라짐.
- 유형 분기는 **순수 함수** `placeChatPrompts(place): string[]`(i18n 키 3개 반환, 테스트 가능):
  - **역**(`isStation(place)`): 실시간 지하철 도착 / 이 역 교통약자 편의시설 / 이 역 주변에 뭐가 있어
  - **음식점·카페**(category 또는 카카오 코드 FD6·CE7): 여기까지 가는 법 / 근처에 비슷한 곳 더 / 이 지역 날씨
  - **일반**(기본): 여기까지 가는 법 / 주변에 뭐가 있어 / 이 지역 공기질·날씨
- 최종 카피는 `placeChat.prompt.*` i18n 5개 언어. 버킷 판정 로직만 spec 고정, 문구는 구현 시 확정.

## 7. 장소 컨텍스트 주입 (B-4: 장소 기준 위치 — 핵심 불변식)

### 7-1. 계약 확장
- `/api/chat` 요청 body에 **선택적 `placeContext`**:
  ```ts
  placeContext?: { name: string; lat: number; lng: number; category?: string; isStation?: boolean }
  ```
- `ExecutionContext`에 장소 앵커 추가(예: `ctx.placeAnchor?: { lat; lng; name }`). `userLocation`은 **그대로 둠**(별도 필드).

### 7-2. 불변식 (반드시 둘 다 구현 — 한쪽만이면 회귀)
- **I-1 (주변/앰비언트 도구 = 장소 앵커)**: `get_subway_arrivals`·`get_bus_arrivals`·`get_air_quality`·`get_surroundings`·`get_kids_places`·`get_night_clinics`·`get_bike_stations` 등 좌표 도구는 `args.place` 미지정 시 **`placeAnchor ?? userLocation`** 순으로 기준 좌표 결정(`resolveCoord` 우선순위 변경). → "경복궁 상세에서 '근처 카페'"가 경복궁 기준.
- **I-2 (길찾기 도구 = 현위치 출발 · 장소 도착)**: `get_car_route`·`get_transit_route`는 **출발 = 실제 `userLocation`, 도착 = 장소**(placeAnchor 또는 args). → "여기까지 가는 법"이 장소→장소로 깨지지 않음. **이래서 `userLocation`을 장소 좌표로 덮어쓰면 안 된다.**
- **I-3 (LLM 지시)**: systemInstruction에 "사용자는 '<name>'(<category>)에 관해 묻고 있다. '여기/이곳/근처/주변'은 이 장소를 가리킨다. 위치 기반 도구는 이 장소를 기준으로 한다"를 placeContext 있을 때만 덧붙임.
- **I-4 (하위호환)**: `placeContext` 없으면(혹시 모를 다른 진입) 기존 동작 그대로 — `userLocation` 기준, 지시문 미추가.

## 8. 게이트·접근성 정합

- **진입 게이트**: `hasGeminiKey()` 없으면 "이 장소에 관해 물어보기" 버튼 미렌더 → 채팅 전체 비노출(검색·상세 회귀 0).
- **미니멀 ARIA**: dialog role + aria-labelledby + 포커스 관리로 충분. 새 live region·landmark·skip link 신설 금지. 진행 통지는 기존 `ChatInterface`의 단일 polite 채널 그대로(2026-06-21 산문 채널 제거분 유지).
- **포커스 계약**: 열기→오버레이 h2 / 닫기(3경로)→트리거 버튼. 응답 완료 포커스 이동(최신 질문 heading)은 기존 `ChatInterface` 동작 유지.
- **이모지 금지**: 버튼 라벨은 텍스트("이 장소에 관해 물어보기"·"채팅 닫기"), lucide 아이콘은 `aria-hidden` 허용.

## 9. 테스트 게이트 (매 커밋)

- **순수 단위테스트**: `placeChatPrompts(place)` 버킷 분기(역/음식점/일반 → 올바른 3키), `resolveCoord` 장소 앵커 우선순위(placeAnchor 있으면 우선, 없으면 userLocation, args.place 최우선).
- **회귀 방지**: `placeContext` 없을 때 기존 동작 불변(I-4) 테스트.
- **lint + build**: 오버레이 포커스 트랩·History 트랩 와이어링은 node-env 테스트 레인이 없어 lint+build+수동 검증이 게이트(기존 관례).
- **dev 실호출 머지 게이트**: 장소 상세 → "이 장소에 관해 물어보기" → 오버레이 → "근처 카페"가 그 장소 기준으로 검색되는지 / "채팅 닫기"·Esc·뒤로가기가 트리거 버튼으로 포커스 복귀하는지 / 장소 바꿔 다시 열면 새 대화인지.

## 10. 비목표 (이번 범위 밖)

- 채팅 답변 카드에서 다시 장소 상세로 진입(현재도 no-op, 후속).
- 대화 누적·딥링크 복원.
- 거리 추적 기능 자체의 수정(별도 브랜치, Phase 4).
- dodo-planet 이식 구현(Spec B, Phase 3).

## 11. 영향 파일 요약

| 구분 | 파일 |
|---|---|
| 삭제 | `ModeToggle.tsx`, `lib/chat/mode-state.ts`, `lib/chat/keyboard-shortcuts.ts`, `hooks/useAppMode.ts` (+테스트) |
| 신규 | `components/chat/ChatOverlay.tsx`, `components/chat/PlaceChatLauncher`(또는 PlaceDetail 내 버튼), `lib/chat/place-prompts.ts`(`placeChatPrompts`) (+테스트) |
| 수정 | `PlaceSearch.tsx`(분기 제거·canShowChat 전달), `PlaceDetail.tsx`(거리추적 마운트 제거·버튼 추가), `ChatInterface.tsx`/`useChat.ts`(placeContext·빈상태 프롬프트), `app/api/chat/route.ts`(placeContext 수신), `lib/chat/router.ts`(resolveCoord 앵커), `lib/chat/types.ts`(ExecutionContext 앵커), `messages/*.json`(`placeChat.*` 추가·모드/단축키 키 제거) |
| 보존(불변) | `DistanceBeacon.tsx`, `hooks/useDistanceBeacon.ts`, `lib/beacon.ts`, `hooks/useBeaconSound.ts`, `hooks/useScreenWakeLock.ts`, `beacon.*` i18n |
