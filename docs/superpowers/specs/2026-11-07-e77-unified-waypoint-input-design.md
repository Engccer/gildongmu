# E77: 경유지/자동차 환승 입력을 검색칸 하나 + 확인 질문으로 — 설계 (2026-11-07)

판정은 위원장 판정(TextEdit 왕복 2026-11-07)이다. BACKLOG 본문은 코드 종결로 지웠고(종결 표 E77, 기각 대안은 §9), 이 문서 §2가 그 판정과 확정 문안의 정본이다(문안 글자는 `src/components/__tests__/JourneyTransferPrompt.test.ts`가 잠근다). **왜**: 종전 메뉴는 장소를 정하기 **전에** 「경유지」·「자동차에서 내리는 역/정류장」·「자동차를 탈 역/정류장」 중 무엇을 쓸지 골라야 해 인지 부담이 컸다. 장소를 고른 **뒤** 내 여정을 서술한 문장에 「네」로 답하게 바꾼다(누르는 횟수는 같고 고르는 시점과 방식이 바뀐다). 이 문서는 그 판정이 기존 설계의 **어느 문장을 바꾸는지**와, 판정이 정하지 않은 구현 결정만 적는다.

**설계 리뷰 판정**: 새 불변식·외부 통합 계약·비가역 저장 포맷·안전 크리티컬 4종 어디에도 해당하지 않는 입력 UI 변경이라 codex 적대적 설계 리뷰는 생략한다(서버 `/api/route/journey`·`/stops` 계약, `RecentRoute`·`RecentStation`·`DirectionsEndpoint`·웹 `JourneyStationPick` 저장 포맷 모두 불변).

## 1. 바뀌는 기존 문장

| 기존 설계 | 기존 문장(요지) | E77 이후 |
|---|---|---|
| E70 spec §5.1 첫 항목(iOS) | 메뉴 하나 「경유지/자동차 환승 추가」, 항목 셋이 검색 시트를 연다 | 같은 이름의 **버튼** 하나가 검색 시트(대상 `.transfer`)를 바로 연다. 메뉴·항목 셋은 없다 |
| E70 spec §5.1 "역만 받는다" | 역 칸 시트는 역·정류장이 아니면 「역이나 정류장을 골라 주세요.」 | **남은 쪽 추가 버튼과 채운 칸 재검색**(대상 `.boardStation`·`.alightStation`)에만 남는다. 입구 시트(`.transfer`)는 무엇이든 받는다 |
| E70-e spec §3 첫 항목(iOS) | 정류장 줄은 역 칸 대상일 때만 | 역 칸 대상 + **입구 대상(`.transfer`)** |
| 웹 spec §3 첫 항목 | disclosure 버튼 + 항목 셋 | disclosure 버튼(`aria-expanded`) 하나가 **검색 칸 하나**를 펼친다(§3.1) |
| 웹 spec §3 "후보는 역과 정류장만" | 역 칸 후보는 역·정류장뿐 | 역 칸(남은 쪽·채운 칸)은 그대로. 입구 칸은 끝점 칸과 같은 장소·주소 후보 + 정류장 줄 |
| 웹 spec §3 "칸 이름은 `journey.boardField`·`alightField`" | 칸 이름은 「…역/정류장」 공용 | **채운 칸**은 종류별 이름(§2.3), 빈 칸(남은 쪽을 더한 직후·글자를 고쳐 확정이 풀린 칸)은 공용 이름 그대로 |
| 웹 spec §3 ⚠ "iOS `swap()`은 역 칸을 바꾸지 않는다" | — | iOS `swap()`도 두 칸을 맞바꾼다(§4, BACKLOG E70 편승 종결) |

## 2. 공통 계약 (웹·iOS)

### 2.1 짐작 판정 (순수 함수)

- 웹 `journeyTransferGuess(place, origin, dest)`(`src/lib/journey/transfer-guess.ts`) ↔ Kit `journeyTransferGuess(placeLat:placeLng:origin:dest:)`(`Journey.swift`에 추가 — 새 Kit 파일이 아니라 미러 등록부 변경 없음). 공유 fixture `src/lib/__tests__/fixtures/journey-transfer-guess.json`.
- 반환 `"board"`(자동차로 이동하다가 그 장소에서 대중교통으로 = 승차 쪽 칸 「자동차에서 내리는 …」) / `"alight"`(대중교통을 이용하다가 그 장소에서 내려 자동차로 = 하차 쪽 칸 「자동차를 탈 …」).
- 출발지·도착지 좌표가 **둘 다** 있고 도착지까지 직선거리가 출발지까지보다 **엄격히 작을 때만** `"alight"`, 그 밖(좌표 하나라도 없음·같음·출발지가 더 가까움)은 `"board"`. 현재 위치 출발은 화면이 쓰는 위치 좌표(웹 위치 스토어의 `ready` 좌표, iOS `endpointCoordinate(model.from)`)를 넣고, 없으면 없음이다.

### 2.2 수단 낱말

장소 줄이면 `stationLayoutKind`(웹 `station-phone.ts` ↔ Kit `StationPhone.swift`)가 `subway` → 「지하철」, `rail` → 「기차」, 정류장 줄 → 「버스」. 그 밖 장소 줄·주소 줄·최근 경유지 줄은 역이 아니다 → 질문 없이 경유지(판정 2).

### 2.3 문안 키 (웹 `journey.*` = iOS `ios.journey.*`, ko 글자 동일 — 가드 `journey-web-copy.test.ts`)

`{place}`는 질문·버튼 속 장소 이름: 역이면 기존 `stationPlace`(「{station}역」, 표시 이름 함수로 꼬리 노선·「역」을 뗀 이름), 정류장이면 새 `stopPlace`(「{stop} 정류장」, 이름 원문).

| 키 | ko |
|---|---|
| `askAlightSubway` | 지하철을 이용하다가 {place}에서 내려 자동차로 환승하실 예정인가요? |
| `askAlightRail` | 기차를 이용하다가 {place}에서 내려 자동차로 환승하실 예정인가요? |
| `askAlightBus` | 버스를 이용하다가 {place}에서 내려 자동차로 환승하실 예정인가요? |
| `askBoardSubway` | 자동차로 이동하다가 {place}에서 지하철로 환승하실 예정인가요? |
| `askBoardRail` | 자동차로 이동하다가 {place}에서 기차로 환승하실 예정인가요? |
| `askBoardBus` | 자동차로 이동하다가 {place}에서 버스로 환승하실 예정인가요? |
| `answerYesAlight` | 네, {place}에서 자동차로 환승합니다 |
| `answerYesBoardSubway` | 네, {place}에서 지하철로 환승합니다 |
| `answerYesBoardRail` | 네, {place}에서 기차로 환승합니다 |
| `answerYesBoardBus` | 네, {place}에서 버스로 환승합니다 |
| `answerNoBoardSubway` | 아니요, 자동차로 이동하다가 {place}에서 지하철로 환승합니다 |
| `answerNoBoardRail` | 아니요, 자동차로 이동하다가 {place}에서 기차로 환승합니다 |
| `answerNoBoardBus` | 아니요, 자동차로 이동하다가 {place}에서 버스로 환승합니다 |
| `answerNoAlightSubway` | 아니요, 지하철을 이용하다가 {place}에서 내려 자동차로 환승합니다 |
| `answerNoAlightRail` | 아니요, 기차를 이용하다가 {place}에서 내려 자동차로 환승합니다 |
| `answerNoAlightBus` | 아니요, 버스를 이용하다가 {place}에서 내려 자동차로 환승합니다 |
| `answerViaOnly` | 아니요, 환승하지 않고 경유만 합니다 |
| `stopPlace` | {stop} 정류장 |
| `boardFieldStation` | 자동차에서 내리는 역 |
| `boardFieldStop` | 자동차에서 내리는 정류장 |
| `alightFieldStation` | 자동차를 탈 역 |
| `alightFieldStop` | 자동차를 탈 정류장 |

- 수단 낱말을 자리표시자로 두지 않는 이유: 조사(「지하철을」·「기차를」)가 낱말마다 달라 한 틀에 넣을 수 없다. 문장 하나 = 키 하나(낭독 안내문은 필드 조립이 아니라 문장 쓰기).
- 질문은 짐작 쪽 `ask*`, 버튼은 **짐작이 첫 버튼**: 짐작 `alight`면 [`answerYesAlight`, `answerNoBoard{수단}`, `answerViaOnly`], 짐작 `board`면 [`answerYesBoard{수단}`, `answerNoAlight{수단}`, `answerViaOnly`].
- 답 → 칸: `answerYesAlight`·`answerNoAlight*` → 하차 쪽 칸(`alight`), `answerYesBoard*`·`answerNoBoard*` → 승차 쪽 칸(`board`), `answerViaOnly` → 경유지(그 장소를 끝점으로, 최근 경유지 기록 포함).
- 지운 키는 없다(입구 이름 `addMenu`, 남은 쪽 추가 `addBoardStation`·`addAlightStation`, 빈 칸 이름 `boardField`·`alightField`, 지우기 `clearStations`, `notStation`이 모두 남는다). 안드로이드는 웹 `journey.*`를 생성 문자열로 받으므로 새 키가 생성물(`android/app/src/main/res/values*/strings.xml`·`android/i18n/arg-order.json`)에 추가만 된다 — 안드로이드 화면이 쓰는 키는 없다.
- 웹 6로케일은 이 ko를 번역한다. iOS 여정 키는 첫 판 관례대로 ko 한 벌(`ios-extra/ko.json`만, 기능이 데이터 로케일 ko 전용).
- 웹 전용 키 하나: `transferField` 「경유지/자동차 환승」(입구 검색 칸의 이름, §3.1) — **위원장 판정 2026-11-07**(선택지 셋 중 이 문장). iOS 시트 제목은 입구 버튼 이름(`addMenu`)을 쓴다.

### 2.4 두 번째와 그 밖

- 역·정류장 칸이 하나라도 있으면 입구는 없다(종전): 남은 쪽 추가 버튼(공용 이름) + 「갈아탈 역/정류장 지우기」. 남은 쪽 검색은 종전 역 칸 검색(웹은 목록 단계에서 거르고, iOS는 「역이나 정류장을 골라 주세요.」).
- 경유지가 정해지면 경유지 줄 + 「경유지 삭제」만(종전).
- 봉인은 종전 그대로: 웹 `journeyEnabled`(서버 키 게이트 + 데이터 로케일 ko), iOS `journeyInputEnabled`(실험판 + ko). 그 밖엔 일반 「경유지 추가」.

## 3. 웹 (E70-f)

### 3.1 입구 칸

- 「경유지/자동차 환승 추가」 disclosure 버튼(`aria-expanded`, 종전 버튼 그대로)이 바로 아래에 **끝점 칸(`EndpointField`)과 같은 검색 칸** 하나를 펼친다(이름 `transferField`, 펼칠 때 입력으로 포커스). 버튼을 다시 누르면 접힌다 = 검색 취소, 아무것도 바뀌지 않는다.
- 후보: 장소(카카오 순서, 상위 5) → 정류장 줄(역 칸과 같은 검색·같은 줄·같은 3-state 문장, 상위 5) → 주소(상위 5). 최근 경유지 목록도 끝점 칸처럼 보인다(경유지로 확정 — 분류가 없어 역인지 모른다). 건수 통지는 셋을 모두 센다. 음성 버튼도 끝점 칸 그대로.
- `EndpointField`에 선택 prop `transfer`(정류장 검색 기준 좌표·게이트·역/정류장 선택 콜백)를 더한다. 없으면 종전과 바이트 동일한 동작이다(출발·도착·경유지 칸).
- 장소 줄이 역(`stationLayoutKind`)이거나 정류장 줄이면 확정하지 않고 질문 대화상자를 연다. 그 밖은 경유지로 확정(종전 경유지 확정 경로 — 최근 경유지 기록, 포커스는 조회 버튼).

### 3.2 질문 대화상자

- 새 컴포넌트 `JourneyTransferDialog` — 네이티브 `<dialog>`를 `showModal()`로 연다(모달이라 바깥은 inert, 포커스 가둠은 브라우저 몫). `aria-labelledby`로 질문 문장 `<p>`를 이름으로 걸고 그 밖 ARIA는 없다(과잉 ARIA 금지 — `role="dialog"`·`aria-modal`은 네이티브가 준다).
- DOM 순서: 질문 문장 → 버튼 1(짐작) → 버튼 2 → 버튼 3 → 「닫기」(`actions.close`). 열리면 버튼 1로 포커스를 준다 — 스크린 리더는 대화상자 이름(질문)을 먼저 말하고 버튼 1에 착지한다.
- 닫기(「닫기」·Esc의 `cancel`): `close()` 뒤 입구 버튼으로 포커스를 돌린다. 펼친 검색 칸·후보는 그대로다(아무것도 바뀌지 않는다).
- 답: `close()` 뒤 칸을 세우고(입구 칸은 접힌다) **새 줄의 입력으로** 포커스(역 칸·경유지 칸). 살아 있는 안내 세션 정지·결과 버림은 종전 칸 확정과 같은 무효화 축.

### 3.3 채운 칸 이름

`JourneyStationField`의 이름은 확정 값이 있으면 종류별(`boardFieldStation`/`boardFieldStop`/`alightFieldStation`/`alightFieldStop`), 없으면 공용(`boardField`/`alightField`). 검색 버튼 이름(`searchField`)도 같은 이름을 쓴다.

## 4. iOS (E70 실험판)

- `DirectionsFieldTarget`에 `.transfer`를 더한다. 입구는 `Menu` 대신 `Button(addMenu) { searchTarget = .transfer }`(착지 바인딩 `.via` 그대로).
- 시트 `.transfer`: 최근 목록은 경유지 목록(`.via` 스코프), 주소 후보 있음, 정류장 검색 있음(역 칸과 같은 조건 — 출발·도착 좌표 중 하나), 줄 순서는 장소(카카오 순서) → 정류장 → 주소(`stationsOnly`는 거짓). 장소 줄이 역이거나 정류장 줄이면 새 콜백 `onSelectTransfer(RecentStation, JourneyTransferMode)`로 넘기고 시트를 닫는다. 그 밖(장소·주소·최근)은 `onSelect`로 경유지(`setVia`). 제목 `addMenu`.
- 질문은 시트가 **닫힌 뒤** 길찾기 화면의 `.confirmationDialog`(제목 표시 `.visible`, 제목 = 질문, 버튼 셋 + 시스템 취소)로 띄운다 — 시트와 같은 계층 동시 표시가 안 되므로 `onChange(of: searchTarget)`의 닫힘에서 대기 중인 질문을 띄운다.
- 답 → `setJourneyStation(_, board:)` 또는 `setVia`, 착지는 `landFocusAfterResolve(.boardStation/.alightStation)`(새 칸) · 경유지는 경유지 줄(`.via`). 취소 → 입구 버튼(`.via`)으로 커서.
- 채운 칸 이름(`stationFieldText`)은 종류별 키(§2.3). 시트 제목(`.boardStation`·`.alightStation`)은 공용 이름 그대로.
- 편승: `DirectionsModel.swap()`이 `(boardStation, alightStation)`도 맞바꾼다(웹 `swapFields` 동형).

## 5. 검증

- 웹: 짐작 판정 단위(공유 fixture), `DirectionsJourney.test.tsx` 갱신(입구 칸 → 비역 장소 = 경유지 · 역 = 대화상자 문장·버튼 순서·버튼 1 착지 · 답별 칸·종류별 이름 · 닫기 = 무변화 + 입구 버튼 포커스 · 정류장 줄 · 두 번째는 종전 버튼), 문안 가드, `test:a11y`.
- Kit: `journeyTransferGuess` 공유 fixture 테스트. 앱: 빌드. 실기기 판정(§2 E70 행): 질문 문장이 끝까지 들리는가 · 짐작이 맞는 비율 · 답한 뒤 커서 착지.
