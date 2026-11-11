# E70-b 채팅으로 여정 확정 — 설계

2026-11-12 · 서버 + 웹(ko) + iOS 실험판 · 앞 설계: `2026-10-17-e70-mode-change-journey-design.md`(서버 조립·여정 모델), `2026-11-02-e70-web-journey-design.md`(웹 이어 안내)

## 1. 목표와 성과

채팅에서 「자동차로 ○○역까지 가서 지하철로 △△ 가는 길」을 물으면 답 아래에 여정 카드가 붙고, 카드의 [안내 시작] 한 번으로 이어 안내가 시작된다. 지금은 채팅에 안내로 넘어가는 길이 없어(웹 경로 카드는 읽기 전용 요약, iOS 채팅은 경로 카드를 그리지 않는다) 길찾기 탭에서 출발·도착·갈아탈 곳을 다시 입력해야 한다.

**움직일 성과**: 채팅 답에서 안내 시작까지 스와이프 4회 이내(카드 제목 → 합계 → [안내 시작]), 재입력 0회. 확인은 웹 VoiceOver·iOS 실험판 실기기.

베르길리우스(E82)가 같은 통로(도구 결과 → 카드 → 안내 시작)를 쓴다.

**비목표**: 단일 수단(도보·자동차·대중교통) 경로 카드의 [안내 시작], 출발지를 현재 위치가 아닌 곳으로 잡는 여정, en·그 밖의 언어, 안드로이드, iOS 정식판, 지금 탄 열차 출발(E71), 카드 안에서 변형·출구 고르기.

## 2. 위원장 판정 (2026-11-12)

| # | 판정 | 내용 |
|---|---|---|
| P1 | 카드는 짧게 | 제목 → 합계 → [안내 시작] → [길찾기에서 열기]. 구간 줄·변형 선택·출구 선택은 카드에 넣지 않는다. 다른 경로·출구는 [길찾기에서 열기]로 가서 고른다 |
| P2 | 역이 없으면 후보를 제안하고 고르게 한다 | 갈아탈 역 없이 물으면 대중교통만으로 가는 경로를 먼저 조회해 그 경로가 실제로 지나는 역 두세 곳을 이름으로 내놓고 되묻는다. 고르면 그 역으로 여정을 조회한다. 채팅이 스스로 골라 조회하지 않는다 |

## 3. 설계 결정

| # | 결정 | 근거 |
|---|---|---|
| D1 | 새 채팅 도구 `plan_journey` 하나. 인자는 `destination`(필수)·`board_station`·`alight_station`·각 `_kind`(`station` 기본, `stop`) | 모델이 채우는 것은 여정 입력(이름·순서)뿐이다. 경로·시간·요금·출구는 `getJourney`가 조립한다(날조 금지 불변식) |
| D2 | 출발지는 늘 `ctx.userLocation` | 기존 길찾기 도구와 같다. 카드가 안내 시작으로 이어지므로 출발지가 지금 위치가 아니면 안내가 성립하지 않는다. 위치가 없으면 `NO_LOCATION` |
| D3 | 역 이름 → 좌표는 서버가 푼다: `searchPlaces`에서 역(`isStation`)인 첫 결과, 노선 힌트는 `journeyLineHint`. 정류장(`_kind: stop`)은 `searchJourneyStops`의 첫 결과 | 모델이 좌표·노선을 만들지 않는다. 못 찾으면 `placeNotFound`(다른 역으로 조용히 대체 금지) |
| D4 | 두 역 모두 없으면 조회하지 않고 후보를 돌려준다: `getTransitRoute(현재 위치 → 목적지)`의 추천 경로에서 지하철·기차 구간의 승차역·환승역·하차역을 경로 순서로 최대 3곳(`candidates`, 이름 + 노선) | P2. 후보가 결정론으로 나온다(모델이 역을 지어낼 자리가 없다). 대중교통 조회는 기존 캐시를 탄다. 후보가 0곳(버스만·경로 없음)이면 `candidates: []`와 함께 「갈아탈 역이나 정류장 이름을 알려 달라」고 되묻게 한다 |
| D5 | 한 턴에 `plan_journey`의 **여정 조회**는 1회 | 여정 한 번이 Tmap 최대 8회이고 인스턴스 일 상한이 200이다. 후보 응답(D4)은 Tmap을 쓰지 않아 횟수에 넣지 않는다. 둘째 호출부터는 `{ error }`로 돌려 모델이 되묻게 한다 |
| D6 | 예산·레이트 리밋은 `/api/route/journey`와 같은 장치를 쓴다(`reserveJourneyTmap`·IP 버킷·일 상한) | 예약 밖 Tmap 호출 0이라는 E70 불변식을 채팅 경로에서도 지킨다. 상한에 걸리면 3-state의 「조회 실패」로 돌린다(경로 없음과 뭉개지 않는다) |
| D7 | 도구 노출은 **클라이언트 능력 신고**로 연다: 채팅 요청에 `capabilities: ["journey"]`가 있고, 서버 키 게이트(ODsay·Tmap·카카오)가 참이고, 로케일이 ko일 때만 선언 | 정식판 iOS·안드로이드·옛 클라이언트는 신고하지 않으므로 도구가 선언되지 않는다(카드를 못 그리는 클라이언트가 유료 조회만 일으키는 것을 막는다). 웹 ko와 iOS 실험판만 신고한다 |
| D8 | 렌더는 props-driven `{ type: "journey", result, board, alight, dest, destLabel, destRoman }` | self-fetch면 여정을 두 번 조회한다(Tmap 16회). 택시 시간은 조회 시점 값이고, 안내를 시작하면 단계 세션이 자기 경로를 새로 받는다 |
| D9 | 모델에 주는 `data`는 변형별 요약(제목 재료·총 시간·요금·갈아타는 역·대중교통 구간의 노선과 승하차역)만 | 답의 글이 구간을 말할 재료다(P1에서 카드가 구간을 싣지 않는다). 좌표·기하는 싣지 않는다 |
| D10 | 카드가 싣는 계획은 추천 순서의 첫 변형(`variants[0]`)과 첫 출구 | P1. 길찾기 결과 화면의 기본 선택과 같다 |
| D11 | 지정한 역으로 경로를 찾지 못한 줄(`journeyMissingLines`)은 카드에 남긴다(제목 다음) | 제목이 추천 경로로 바뀐 이유가 그 줄뿐이다. 빼면 「○○역으로 물었는데 다른 역 경로」가 설명 없이 나온다 |
| D12 | 웹 [안내 시작]: 채팅을 닫고 길찾기 화면을 그 여정 결과로 열어 이어 안내를 바로 시작한다. 다시 조회하지 않는다(카드의 결과를 넘긴다) | 웹의 이어 안내(`JourneyGuide`)는 길찾기 화면의 통지 창구와 세션 점유 위에서 돈다. 채팅은 모달 대화상자라 그 안에 안내 패널을 두면 닫는 순간 안내가 끝난다 |
| D13 | iOS [안내 시작]: `GuideSession.shared.startJourney(plan:)`을 채팅에서 바로 부른다. 안내 시트는 루트 시트라 채팅 탭 위에 뜬다 | 이미 앱 수명 코디네이터가 있다. 게이트는 `experimentalJourneyEnabled` |
| D14 | [길찾기에서 열기]: 길찾기 화면(탭)에 도착지·갈아탈 곳을 채우고 카드의 결과를 그대로 보여 준다(재조회 없음) | 변형·출구를 고르는 자리는 길찾기 결과 화면 하나로 둔다 |
| D15 | 카드는 답이 끝난 뒤(done) 한 번 마운트된다. 카드에 heading을 두지 않고 제목은 평문 한 줄 | 기존 채팅 카드 규칙(중복 낭독 차단). 턴 점프는 질문 헤딩이 맡는다 |

## 4. 서버

### 4.1 도구 선언 (`src/lib/chat/declarations.ts`)

- 이름 `plan_journey`. 설명: 자동차(택시·가족 차)와 대중교통을 섞어 가는 여정을 조회한다. 자동차에서 내려 대중교통을 탈 역(`board_station`)이나 대중교통에서 내려 자동차를 탈 역(`alight_station`)을 사용자가 말한 이름 그대로 넘긴다. 둘 다 모르면 비워서 호출하면 후보 역이 온다.
- 게이트: `hasOdsayKey() && hasTmapKey() && hasKakaoKey()`에 더해 요청 능력(D7). `availableDeclarations()`가 능력 집합을 인자로 받는다(기본값 없는 필수 인자: 생략이 조용한 전면 노출이 되지 않게).

### 4.2 실행 (`src/lib/chat/router.ts`)

1. `destination` → `searchPlaces` 첫 결과. 없으면 `placeNotFound`.
2. `ctx.userLocation` 없으면 `NO_LOCATION`. 한국 밖이면 `coverageGate`.
3. 두 역 모두 없으면 D4의 후보 응답: `{ needStation: true, destination, candidates: [{ name, line }] }`.
4. 역 이름을 D3으로 푼다. 실패하면 `placeNotFound(이름)`.
5. D5 턴 상한 확인 → D6 예약 → `getJourney(req, journeyDeps, reserve)`.
6. 결과 3-state: 찾음(`data` 요약 + `render`) / 경로 없음(`{ journey: null }`) / 실패(throw, 루프가 오류 결과로 감싼다).

턴 상한은 `ExecutionContext`에 턴 단위 카운터를 둔다(요청마다 새 컨텍스트라 턴과 수명이 같다).

### 4.3 시스템 지침 (`system-instruction.ts`, 도구가 선언될 때만 싣는 한 단락)

- 자동차와 대중교통을 섞는 길을 물으면 `plan_journey`를 쓴다.
- `needStation`이 오면 `candidates`의 이름만으로 「○○역, △△역 중 어느 역에서 갈아타실 건가요?」처럼 한 문장으로 되묻고 턴을 끝낸다. 후보에 없는 역을 제안하지 않는다. 후보가 비면 갈아탈 역이나 정류장 이름을 묻는다.
- 여정이 오면 한두 문장으로 요약한다(어느 역에서 갈아타는지, 총 시간). 카드가 합계를 말하므로 요금을 되풀이하지 않는다.

삭제·긍정 트리거의 최소판으로 시작하고 금지문은 실측에서 필요가 입증될 때만 더한다.

### 4.4 요청 계약 (`/api/chat`)

`capabilities?: string[]`(알려진 값 `"journey"`). 모르는 값은 무시한다. 없으면 종전과 byte-identical.

## 5. 웹

- `RenderPayload`에 `journey` 변종. `MessageBubble`이 `JourneyChatCard`를 그린다.
- `JourneyChatCard`: `<p>`제목(`journeyVariantHeading`) → 못 찾음 줄 → `<p>`합계(`journeyTotalsLine`) → `<button>`안내 시작 → `<button>`길찾기에서 열기. 줄마다 한 접근성 객체, 버튼은 `min-h-11`.
- 통로: `ChatInterface` → `ChatOverlay` → `PlaceSearch`로 `onStartJourney(payload, { start: boolean })` 콜백. `PlaceSearch`가 채팅을 닫고 `openDirections`에 여정 프리필(도착지·갈아탈 곳·결과·자동 시작 여부)을 넘긴다.
- `DirectionsView`: 프리필에 여정 결과가 있으면 조회 없이 결과 상태를 세우고, `start`면 `JourneyResultView`가 마운트 직후 이어 안내를 시작한다(단계 패널이 자기 트리거로 착지). `start`가 아니면 여정 제목 heading에 착지한다.
- 능력 신고: `canPlanJourney && locale === "ko"`일 때 채팅 요청에 `capabilities: ["journey"]`.
- 게이트가 거짓이면 카드·버튼·import 경로가 전부 닿지 않는다(도구가 선언되지 않아 렌더가 오지 않는다).

## 6. iOS 실험판

- `ChatRenderPayload.journey(JourneyChatPayload)` 디코딩(Kit). 모르는 타입은 지금처럼 `.unsupported`.
- `ChatService` 요청에 `capabilities: ["journey"]`를 `AppConfig.experimentalJourneyEnabled`일 때만 싣는다.
- 카드 행: 제목 `Text` → 못 찾음 줄 → 합계 `Text` → [안내 시작] → [길찾기에서 열기]. 문장 조립은 길찾기 결과 화면과 같은 함수(`journeyVariantHeading` 등)를 쓴다.
- [안내 시작]: `JourneyPlan(variant: variants[0], egress: 첫 출구, destLabel, destRoman, dest, aboard: nil)`로 `startJourney`. AI 동의 게이트와 무관한 경로(전송이 아니다).
- [길찾기에서 열기]: 길찾기 탭으로 전환하고 `DirectionsModel`에 도착지·갈아탈 곳·결과를 넣는다.
- 진행 통지 문구 `chat.progress.tool.plan_journey`.

## 7. 문안 (확정 전, 위원장 왕복 대상)

| 자리 | 문안 |
|---|---|
| 카드 버튼 1 | 안내 시작 (기존 `beacon.start`) |
| 카드 버튼 2 | 길찾기에서 열기 |
| 도구 진행 문구 | 자동차 환승 경로 |
| 되묻기(모델 문장의 틀) | 신도림역, 영등포역 중 어느 역에서 갈아타실 건가요? |

제목·합계·못 찾음 줄은 길찾기 결과 화면의 기존 문자열을 그대로 쓴다.

## 8. 불변식과 테스트

- 모델이 역을 지어내지 못한다: 후보는 `getTransitRoute` 결과에서만 나오고(단위 테스트), 좌표는 서버가 푼다.
- 능력 신고가 없으면 `plan_journey`가 선언되지 않는다(선언 테스트, 종전 요청 byte-identical).
- 한 턴 여정 조회 1회(라우터 테스트). 예약 밖 Tmap 호출 0(기존 예약 함수 경유를 소스 가드로).
- 3-state: 찾음·경로 없음·실패가 `data`에서 갈린다.
- 카드 읽기 순서와 한 줄 한 객체(jsdom 컴포넌트 테스트), 웹 실브라우저 접근성 게이트.
- **실호출 게이트(머지 조건)**: 역 지정 질문 1건과 역 없는 질문 1건을 실제 채팅 API로 보내 ①카드 렌더가 오고 ②후보 응답의 역이 실제 대중교통 경로에 있는 역이며 ③모델이 후보 밖 역을 말하지 않는지 확인한다.
- iOS: Kit 디코딩 fixture(웹과 공유), 실기기에서 카드 → 안내 시트.

## 9. 설계 리뷰 판정

별도 컨텍스트 리뷰 대상이다: 새 판정 계층(능력 신고 게이트, 턴 상한)과 과금 경로(Tmap 예약)가 있다.
