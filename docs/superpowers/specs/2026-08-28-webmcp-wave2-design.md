# WebMCP 도구층 W2 설계 — 홈 검색·"내 주변"·장소 상세 (2026-08-28)

> **폐기(2026-08-29)**: 같은 날 저녁 위원장 재판정(사례 ① 한정·상시 집합 한 벌·`get_place_info` 하나)으로 이 문서의 화면별 배타 4집합 설계는 폐기됐다. 후속 정본은 `2026-08-29-webmcp-wave2-design.md`. 본문은 기록으로 불변.

`docs/BACKLOG.md` W2의 정본. W1(`2026-08-27-webmcp-tool-layer-design.md`, 길찾기 뷰 9 + 홈 1)의 원칙 개정(§1, 2026-08-28)을 받아 나머지 세 화면에 도구층을 얹는다. W1의 공통 계약(§3.0 discriminated union·사유 코드 표·§4 출력 분할·§5 정적 등록·§6 접근성)은 그대로 상속하고 여기엔 **W2가 새로 정하는 것**만 쓴다.

**설계 리뷰 판정**: codex 적대적 리뷰 **실시**(CLAUDE.md 게이트 조건 ① 새 불변식). 1차 초안에 14건(high 10)이 나왔고 반영·기각 기록이 §9다. 아래 본문은 반영 후 판이다. 2차 리뷰는 W1과 같은 이유로 돌리지 않는다(같은 리뷰어의 재검토는 자기 처방 확인).

**위원장 판정(2026-08-28, 조사 `docs/research/RESEARCH-2026-08-28-webmcp-tool-scope.md`)**: ①절충안 — 빈틈 메우기 원칙 폐기, 앱 능력 고지 도구 추가, 세 화면 확장 ②주 사용자 모델은 **데이터 반환형**("스크린 리더로 ChatGPT를 쓰는 사람은 인앱 브라우저를 추가로 탐색하고 싶지 않다"), 축 A는 서사·보조 편의로 유지 ③"내 주변"은 **섹션별 도구 10개** ④AI 채팅은 도구로 내지 않는다 ⑤범위는 홈 검색 + 내 주변 + 장소 상세 전부. 마감은 설계 제약이 아니다(완성도 기준).

## 0. 한 문단 요약

화면 4개가 각자 도구 집합을 **배타적으로** 등록한다: 홈 **7**, 길찾기 **10**(W1 9 + `describe_app`), 내 주변 **14**, 장소 상세 **11**. 어느 순간에도 14 이하다. 데이터 반환 도구는 **화면을 같은 상태로 바꾸면서**(패널 펼침·조회 실행) 화면이 그린 문장 그대로를 돌려준다. 손잡이는 **`ref` 하나**다 — 출처·화면 세대·조회 세대·순번을 안에 결박한 불투명 토큰이고, 같은 값이 다른 것을 가리키는 순간이 없다. 시작과 대기는 W1 `runQuery` 동형의 **원자 호출 하나**(`runSearch`·`runSectionLoad`)다. 같은 이름의 도구는 **manifest 한 벌**에서 입력·출력·사유 코드가 생성되어 어느 화면에서든 같은 계약이고, 화면 전환은 코디네이터가 새 집합의 등록 완료까지 확인한 뒤 `open_*`가 돌아온다.

## 1. 노출 원칙 (W1 §1 개정판의 적용)

넣는다: 화면이 보여 주는 정보·행동 전부(데이터 반환형이 주). 빼는 것은 둘뿐.

- **겹침**: 같은 일을 두 도구가 하지 않는다. 장소 상세의 버스·따릉이·날씨는 허브와 **같은 이름·같은 계약**(앵커만 화면이 정한다).
- **이중 에이전트**: AI 채팅(`ChatOverlay`)은 도구로 내지 않는다. 채팅이 답하는 것은 전부 개별 도구로 나가므로 겹치고, Gemini 산문을 ChatGPT가 받으면 날조 위험이 두 겹이다. `describe_app`이 "채팅은 화면에서 직접"이라고 알린다.

Declarative API·`plan_directions` 수단 인자는 W1 §8.5대로 범위 밖. W1 도구의 재작업 3건은 `docs/BACKLOG.md` W1-R(도보 최단 대안·`read_current_view` 설명문·보행 인프라 SHAPE 통일)이고 이 마일스톤의 태스크로 편입한다.

## 2. 도구 목록 (정본 표)

| 화면 | 도구 | 축 | readOnlyHint |
|---|---|---|---|
| 홈 | `describe_app` · `read_current_view` · `focus_item` | 고지·A | true·true·false |
| 홈 | `search_places` | 조회 | false(최근 검색어 저장) |
| 홈 | `open_place` · `open_directions` · `open_nearby` | 진입 | false |
| 길찾기 | W1 9개 + `describe_app` | | |
| 내 주변 | `describe_app` · `read_current_view` · `focus_item` · `open_place` | | |
| 내 주변 | `get_nearby_surroundings` · `get_local_conditions` · `get_nearby_subway_arrivals` · `get_nearby_bus_arrivals` · `get_nearby_bike_stations` · `get_nearby_night_clinics` · `get_nearby_barrier_free_places` · `get_nearby_kids_places` · `get_nearby_events` · `get_walk_infrastructure_nearby` | 조회 | true |
| 장소 상세 | `describe_app` · `read_current_view` · `focus_item` · `open_directions` | | |
| 장소 상세 | `get_station_timetable` · `get_station_facilities` · `get_station_arrivals` · `get_nearby_bus_arrivals` · `get_nearby_bike_stations` · `get_local_conditions` · `get_barrier_free_info` | 조회 | true |

- **readOnlyHint**: 조회 도구는 패널을 펼치고 fetch를 일으키지만 앱 밖 세계를 바꾸지 않는다 → `true`(매 조회 확인 UI 회피). 화면 전환·검색 실행·포커스 이동은 `false`. `untrustedContentHint`는 W1 규칙(`describe_app`만 `false`).
- **이름 규칙**: `open_*` 개시(전환 + 새 집합 등록 확인 후 반환), `get_*`·`search_*` 실행(정착까지 대기).
- **manifest가 정본이다**(§5.4): 이 표는 요약이고 코드 정본은 `src/lib/webmcp/manifest.ts`. 같은 이름은 어느 화면이든 그 manifest 항목 하나에서 조립된다.

## 3. 도구별 계약

### 3.0 W2 공통 (W1 §3.0에 더한다)

- **`ref`는 불투명 토큰 하나다.** 형식(내부): `{viewEpoch}.{source}.{attempt}.{row}` base36 — `source`는 `search|clinics|events|…`(섹션 키) , `attempt`는 조회 시도 세대, `row`는 순번. 외부엔 문자열뿐이고 파싱은 `place-refs.ts` 한 곳. 검사 순서: viewEpoch 불일치 → `staleView`, attempt 불일치 → `staleResult`, row 범위 밖 → `notFound`. `open_place`·`focus_item`이 받는 인자는 이 `ref` 하나이고 **세대 인자는 따로 없다**(선택 인자가 있으면 생략된 호출이 새 세대의 같은 순번을 여는 오결박 — 리뷰 #1).
- **새 사유 코드**: `staleView`(화면 세대 지남) · `staleResult`(조회 세대 지남, W1 `stalePlan` 동형) · `notConfigured`(키 게이트로 그 기능이 이 배포에 없다) · `notApplicable`(이 화면 대상에 해당 없음 — 비역) · `viewChanging`(전환 중 호출) . 표는 `types.ts` `REASON_FLAGS`에 등록.
- **상태는 문자열이 아니라 구조다**(리뷰 #7): 화면 union을 **그대로** 싣는다 — `status: {kind:"done"} | {kind:"empty", detail?} | {kind:"error"} | {kind:"geoerror", reason:"denied"|"unsupported"} | {kind:"outOfCoverage"} | {kind:"unavailableHere", reason}`. 번역 문장(`message`)은 별도 필드. 항목의 도메인 상태(진료 open/closed/unknown, 지하철 4-state, 시간표 coverage)도 `line` 안 낱말이 아니라 **구조 필드**로 병기한다. 기능 부재(`notConfigured`)는 `empty`와 다른 상태이고 실패 사유로 나간다.
- **실행 상태 어휘는 W1과 같다**: `busy`·`superseded`·`aborted`·`cooldown{retryAfterMs}`.

### 3.1 `describe_app` (전 화면, readOnly)

- 출력 `{ok, currentView, views:[{view, description, available:[toolName], unavailable:[{tool, reason}], reach:[{tool, requires?, produces?}]}], notes:[string]}`.
- 표는 manifest에서 **생성**한다(별도 상수 없음, 리뷰 #10): 각 화면의 도구 집합은 manifest가 정본이고, `available`/`unavailable`은 **런타임 게이트**(키 게이트 `present`, 비역 등)를 결합한 값이다 — "이 배포에 문화행사가 없다"를 에이전트가 미리 안다. `reach`는 그 화면에 닿는 연쇄(장소 상세 = `[{tool:"search_places", produces:"ref"},{tool:"open_place", requires:"ref"}]`).
- `notes`: "AI chat exists on the home and place screens; it has no tool — use the individual tools"·"tools belong to the screen; open_* switches screens and returns when the new tools are registered"·"the app never returns coordinates".

### 3.2 `search_places` (홈)

- 입력 `{query: string, sort?: "accuracy"|"review"}`. 빈 질의는 `unsupported{detail:"emptyQuery"}`.
- **원자 호출**: 화면 정본을 `runSearch(request: {query, sort}, signal): Promise<SearchOutcome>`로 재정의하고(현 `runQuerySearch`·`toggleSort`가 이 하나를 부른다 — 리뷰 #3) 도구는 그것을 부른다. 시작 시 `searchAttempt` 하나를 발급하고 세 분기(장소·주소·웹)가 각각 `pending|done|empty|error|skipped`를 가진다. 웹은 폴백 조건 미충족이면 **`skipped`로 종결**(미시작이 영원히 pending으로 남지 않는다). 정착 = 세 분기 모두 비-pending. `searchFailed`는 장소·주소 **둘 다** `error`일 때만(한쪽 실패는 그 분기의 `error`로 실린다).
- 출력 `{ok, searchRef, query, sort, branches:{places, addresses, web}, places:[{ref, name, category, address, roadAddress, distance, phone, isStation}], addresses:[{ref, road, jibun, zip, english}], web:[{title, url, snippet}], placesReturnedCount, placesTotalCount, …}`(카운트 필드는 W1 `capOutput` `count` 모드 규약). 상한 생략 순서 `web` → `addresses` → `places`(`open_place`에 필요한 `places`가 마지막까지 남는다 — 리뷰 #12).
- `web[].url`은 화면의 링크 href와 같은 문자열이되 **query·fragment를 제거한 origin+path**만(리뷰 #11 — 좌표·추적 파라미터 차단). `snippet`은 화면 문장 그대로.
- 경합: 진행 중 `busy`, 대기 중 사용자 검색 시작 → `superseded`, 쿨다운 3초(W1 `plan_directions` 동형).

### 3.3 `open_place` (홈·내 주변)

- 입력 `{ref}`. 표에서 `Place`를 찾아 `requestOpenPlace(place)`(채팅 카드와 같은 브릿지). **전환 코디네이터(§5.3)가 장소 상세 집합의 등록을 확인한 뒤** `{ok, name, view:"place", toolsReady:true}`를 돌려준다(상한 2초, 넘기면 `toolsReady:false` — 에이전트가 `read_current_view`로 재확인). 전환 직전 `ref`를 다시 검증한다(표 조회 뒤 화면이 바뀌었으면 `staleView`).
- 교통·인프라 항목은 `ref`가 없다(키 부재) — 장소형 섹션(둘러보기 목록·소아 진료·무장애·아이 놀 곳·문화행사)만 연다.

### 3.4 `open_nearby` · `open_directions` (진입)

- `open_directions`는 **manifest 항목 하나**(리뷰 #5): 입력 `{to?: string}`. 홈에서 `to` 생략은 빈 폼, 장소 상세에서 `to` 생략은 **이 장소를 목적지로**(좌표 endpoint, 현 `onOpenDirections`), `to`가 있으면 어느 화면이든 텍스트 프리필. 설명문이 세 경우를 한 문장으로 말한다.
- 둘 다 코디네이터 확인 후 `{ok, alreadyOpen, view, toolsReady}`.

### 3.5 `get_nearby_*` 10종 (내 주변; 3종은 장소 상세에도)

manifest의 `sectionTool(key)` 하나가 조립한다.

- 입력 `{refresh?: boolean}`(W1 `get_walk_infrastructure_nearby`도 이 입력으로 맞춘다 — 같은 이름 같은 계약).
- **실행 전 게이트**(리뷰 #6): 화면 브릿지는 **모든 섹션 키에 대해 엔트리를 소유**한다(컴포넌트 effect 등록 여부가 정본이 아니다). `present:false`(키 게이트)면 즉시 `notConfigured`; 장소 상세에서 역 아님이면 `notApplicable`. 대기자는 컴포넌트 언마운트·화면 전환에서 전부 `aborted`.
- **원자 호출**: `runSectionLoad(key, {force}, signal): Promise<SectionOutcome>`(리뷰 #2). 브릿지가 ①패널 펼침(§6 포커스 규칙 적용) ②`force`이거나 `idle`이면 `load(force)` ③정착까지 대기 ④`read()`로 스냅샷을 **같은 등록 인스턴스·같은 attempt인지 재검증**하고 돌려준다. `attempt`는 시도 세대(모든 종단 상태에 존재), `resultAttempt`는 화면이 지금 보여 주는 결과의 세대 — force 재취득 실패로 직전 `done`이 복원되면 `attempt ≠ resultAttempt`이고 `refreshOutcome:{kind:"error"}` + `restoredPrevious:true`로 그 사실이 나간다. 이미 `done`이고 `refresh` 아님이면 fetch 없이 현재 스냅샷 반환.
- **경합**(리뷰 #13, 우선순위 고정): 같은 섹션에 in-flight → `busy`(refresh 여부 무관, W1 reject-while-busy) → 쿨다운 안 → `cooldown{retryAfterMs}` → 그 밖에만 새 attempt. 대기 중 사용자가 같은 패널을 새로고침하면 `superseded`.
- 출력 `{ok, ref?, section, status, refreshOutcome?, restoredPrevious?, heading, message, origin, manualLabel?, at, items:[{n, ref?, line, sub:[string], state?}], itemsReturnedCount, itemsTotalCount}`. `status`는 §3.0 구조. `message`는 그 패널의 live 문장(`nearbyLiveMessage`). `line`·`sub`는 화면과 **같은 함수**(`src/lib/nearby-lines/<section>.ts`, 컴포넌트·도구 공용, jsdom 대조 테스트). `state`는 도메인 상태 구조(진료 `{open:"open"|"closed"|"unknown", basis?}`, 지하철 방면 `{kind:"ok"|"unavailable"|"closed"|"unknown"}`, 인프라 없음).
- **복합 섹션은 축마다 상태**(리뷰 #7): `get_local_conditions`는 `axes:{weather:{status, lines?}, air:{…}, congestion:{…}}`에 `status ∈ done|empty|unknown|error|notConfigured`; 둘러보기는 `overview`·`scene`·`places` 세 축. 축 키 부재로 뜻을 싣지 않는다.
- 상한: `items` 뒤부터 항목 단위, 한 항목의 `sub`는 통째로(반으로 자르지 않는다). W1 `capOutput`이 **최종 직렬화 길이**로 재고 최소 폴백 `{ok,status,section,…Count,truncated}`을 보장한다(리뷰 #12 — 이미 W1 구현, 여기선 최소 폴백 상한 테스트를 더한다).

### 3.6 `get_station_timetable` · `get_station_facilities` · `get_station_arrivals` (장소 상세)

- 게이트 순서: 비역 → `notApplicable`; 키 게이트(도착은 `canShowSubway`, 시설은 코레일·서울 각각) → `notConfigured`(시설은 축별 — 한쪽만 없으면 그 축이 `notConfigured`, 있는 쪽만 트리거).
- `get_station_timetable`: 마운트 fetch 결과 대기. `lines:[{line, first?, last?, coverage:"ok"|"noTrains"|"unknown"|"unavailable"}]`, `basis`.
- `get_station_facilities`: 축 둘 `korail`·`metro`, 각 `{status, groups:[{name, lines:[string]}], supplementFailed?}`. 트리거는 `data-section-trigger` 클릭(핸들러 복제 금지), 정착 대기는 §3.5와 같은 원자 호출.
- `get_station_arrivals`: `items[].state.kind` 4-state, `line`은 `arvlMsg2` 문장.

### 3.7 `get_barrier_free_info` (장소 상세)

- `{ok, match:{kind:"matched", facilityCount} | {kind:"unmatched"}, facilities:[{label, value}], source}` — 미매칭과 "매칭됐지만 시설 0"을 가른다(리뷰 #7).

### 3.8 `read_current_view` (홈·내 주변·장소 상세)

W1과 같은 이름, 최상위 `view`로 가른다. 홈: `{query, sort, searchRef?, branches?, counts, activeElementLabel, targets}`. 내 주변: `{origin, manualLabel?, sections:[{key, present, status, itemCount?, ref?}], activePanel, …}`. 장소 상세: `{name, category, addressLines, phone, isStation, sections:[{key, present, status}], chatAvailable, …}`. 설명문은 "Call this when a tool returned staleView/staleResult, or before focus_item"(W1-R #2 동형 — 조회 전 필수 호출로 읽히지 않게).

### 3.9 `focus_item` (홈·내 주변·장소 상세)

- 입력 `{target, ref?}`. 세대 결박 대상(`place:item`·`panel:item`·`section:item`)은 **`ref` 필수**(W1의 `planId` 동형 — 리뷰 #9 추가 결함): 항목 착지 ID는 `{scope}:{key}:item:{n}`이고 `ref`의 attempt가 현재와 다르면 `staleResult`. 비결박 대상(필드·패널 헤딩·컨트롤)은 `ref` 없음.
- 대기·검증·재시도는 W1 §3.3 그대로.

## 4. 착지 ID (`targets.ts` 확장)

| 화면 | ID | 결박 |
|---|---|---|
| 홈 | `field:query` | 없음 |
| 홈 | `place:item:{n}` · `address:item:{n}` | `ref` |
| 내 주변 | `panel:{key}` (h3) | 없음 |
| 내 주변 | `panel:{key}:item:{n}` | `ref` |
| 장소 상세 | `heading:place` · `control:directions` · `control:chat` · `section:{key}` | 없음 |
| 장소 상세 | `section:{key}:item:{n}` | `ref` |

`key`는 `SectionKey`(`surroundings|conditions|subway|bus|bike|clinics|barrierFree|kids|events|walkInfra|stationTimetable|stationFacilities|stationMetro|stationArrivals|barrierFreeInfo`). DOM 속성엔 순번과 키만 — 세대는 `ref`가 든다.

## 5. 새 기반

### 5.1 안정 패널 키
허브 패널 스토어 ID를 `useId()`에서 `SectionKey`로(`useNearbyPanel({ key })`). 같은 키가 동시에 두 인스턴스인 화면은 없다(장소 상세의 버스·따릉이는 허브가 닫힌 뒤에만 마운트).

### 5.2 섹션 브릿지(화면 소유)
`HubBridge`·`PlaceBridge`가 **모든 `SectionKey`의 엔트리**를 소유한다: `{key, present, read(), runSectionLoad(opts, signal)}`. 섹션 컴포넌트는 `useSectionBridge(key, …)`로 자기 엔트리의 `load`·상태 소스를 **채워 넣을 뿐** 엔트리를 만들지 않는다. `runSectionLoad`의 정착 판정은 `useNearbyFetch`의 `seqRef` 세대에 결박되고 **커밋 뒤 effect**에서 푼다([[effect-resolver-must-guard-committed-state]]). 언마운트·전환 cleanup은 대기자를 `aborted`로 끝낸다.

### 5.3 전환 코디네이터(리뷰 #4)
`src/lib/webmcp/view-registry.ts`(모듈 싱글턴, React 비의존): `viewEpoch`(전환마다 증가)·`currentView`·`ready: Promise` 를 가진다. `useWebMcpTools`는 등록 완료 시 `markReady(view, epoch)`, `abortNow`/cleanup 시 `markLeaving(epoch)`을 부른다. 계약:
- **겹침 0은 주장하지 않는다.** 대신 전환 중(`leaving` 이후 `ready` 이전) 들어온 호출은 **결정적으로** `viewChanging`을 돌려준다(도구 `execute` 래퍼가 epoch를 검사).
- `open_*`는 `markLeaving` 뒤 새 화면의 `ready`를 기다려(상한 2초) `toolsReady`를 싣는다.
- 모든 전환 경로(도구·클릭·`popstate`·직접 URL 진입)가 같은 훅 경로를 지나므로 코디네이터 밖 전환은 없다 — 훅 `enabled` 상승/하강이 곧 `markReady`/`markLeaving`이다.
- 테스트는 세 시점(이전 집합 활성 / 제거~등록 사이 / 신규 활성)에 호출을 주입한다.

### 5.4 manifest(리뷰 #5·#10)
`src/lib/webmcp/manifest.ts`가 **도구 이름 → {description, inputSchema, outputShape, reasons, build(bridge)}** 한 벌과 **화면 → 도구 이름 집합**을 가진다. `index.ts`의 `build*Tools`는 manifest에서 생성하고, `describe_app`도 같은 표를 읽는다. 테스트: 화면별 집합 **equality**(부분집합·개수 아님), 같은 이름의 inputSchema·outputShape·reasons byte 동일, W1 `get_walk_infrastructure_nearby`·`open_directions`·`open_place`도 이 검사 대상.

### 5.5 쿨다운·예산(리뷰 #14)
쿨다운 버킷은 컴포넌트가 아니라 **모듈 싱글턴 `tool-budget.ts`의 upstream 키**(`subwayArrival`·`busArrival`·`bike`·`clinics`·`events`·`kids`·`barrierFree`·`walkInfra`·`surroundings`·`weather`·`air`·`congestion`·`stationTimetable`·`stationFacilities`·`stationArrivals`·`search`)다 — 허브 버스와 상세 버스는 같은 버킷. 값: 실시간(지하철·버스·도착) 10초, 그 외 60초, 검색 3초. 여기에 **세션 예산**: 버킷당 시간당 도구 유발 fetch 30회, 초과는 `cooldown{retryAfterMs}`(결정적). 서버 측 일일 예산·single-flight는 이 마일스톤 밖(`docs/BACKLOG.md` W2 후속 — 사용자 UI도 같은 노출이라 별도 항목).

## 6. 접근성 계약 (W1 §6 상속 + 추가)

- **조회 도구는 포커스를 새 패널로 옮기지 않는다.** 단 **아코디언이 닫는 패널 안에 DOM 포커스가 있으면 닫기 전에 그 패널의 트리거 버튼으로 보존 이동**한다(리뷰 #8 — 헌장 §5 "제거되기 전에 계속 존재할 안정 요소로 선점"). 정책은 "닫기 유지 + 보존 이동 예외" 하나다.
- **`refresh`로 목록이 교체될 때 결과 안에 DOM 포커스가 있으면 패널 헤딩으로 선점**(W1 §6.5 동형). ⚠ 이 계약의 범위는 **프로그램이 설정한 DOM 포커스**뿐이다 — VoiceOver 탐색 커서는 페이지가 읽을 수 없다(W1 `accessible-name.ts` 주석, 리뷰 #9). 항목 리스트는 안정 id로 key를 주어 같은 항목의 DOM 노드가 보존되게 한다(실기기 게이트 ⑨가 두 경우를 나눠 본다).
- `open_*` 착지는 화면 전환의 기존 착지 그대로. 통지는 화면 자체의 live 문장뿐.

## 7. 개인정보·쿼터

- 새 데이터 유형 없음(전부 화면 문자열). 좌표는 allowlist 부재 + **직렬화 결과 스캔**(`lat=`·`lng=`·`x=`·`y=` query 이름, 십진 좌표쌍 패턴)을 `output.test.ts`에 더한다(리뷰 #11). href는 화면 텍스트로 노출된 것만 싣고 query·fragment를 뗀다.
- privacy `agent` 절(`privacy.agent`, 6로케일)은 현재 길찾기 도구 출력 항목을 열거한다 — W2로 검색어·검색 결과(장소명·주소·전화)·"내 주변" 목록·역 정보가 더해지므로 갱신 필요. **문안은 위원장 TextEdit 왕복으로 확정**(plan 마지막 태스크, 배포 전 게이트). 새 제3자는 없다.
- 쿼터는 §5.5.

## 8. 구현자 인계

### 8.1 파일
| 파일 | 내용 |
|---|---|
| `src/lib/webmcp/manifest.ts` | 도구 정의 한 벌 + 화면별 집합 |
| `src/lib/webmcp/place-refs.ts` | `ref` 인코딩·검증 |
| `src/lib/webmcp/view-registry.ts` | 전환 코디네이터 |
| `src/lib/webmcp/tool-budget.ts` | 쿨다운·세션 예산 |
| `src/lib/webmcp/targets.ts` · `types.ts` · `output.ts` | 문법·사유 코드·스캔 확장 |
| `src/lib/webmcp/tools/context.ts` | `HomeBridge` 확장(`runSearch`), `HubBridge`·`PlaceBridge`(전 키 엔트리) |
| `src/lib/webmcp/tools/section-tool.ts` 외 도구별 파일 | |
| `src/lib/nearby-lines/*.ts` | 섹션별 줄 조립(컴포넌트·도구 공용) |
| `src/hooks/useNearbyPanel.ts` · `useSectionBridge.ts` · `useWebMcpTools.ts` | 안정 키·브릿지 채움·코디네이터 연동 |
| `PlaceSearch.tsx`(`runSearch` 트랜잭션화) · `NearbyHub.tsx` · `PlaceDetail.tsx` · 섹션 10 · 역 4 · `BarrierFreeInfo` | 배선·`data-focus-target`·`data-section-trigger` |
| W1-R: `plan-directions.ts` · `get-route-steps.ts` · `read-current-view.ts` · `DirectionsView.tsx` | 도보 최단·설명문·SHAPE |

### 8.2 테스트
- `manifest.test.ts`: 화면별 집합 equality(7·10·14·11), 동명 도구 스키마·SHAPE·reasons byte 동일.
- `place-refs.test.ts`: 인코딩 왕복, epoch·attempt·row 검사 순서.
- `view-registry.test.tsx`: 세 시점 호출 주입(`viewChanging` 결정성), `open_*`의 `toolsReady`, 2초 상한.
- `output.test.ts`: 전 SHAPE 좌표 키 부재 + 직렬화 스캔 + 최소 폴백 상한.
- `nearby-lines/*.test.tsx`(jsdom): 렌더 `<li>` textContent == 도구 `line`.
- `HubWebMcp`·`PlaceWebMcp`·`HomeWebMcp.test.tsx`(deferred Promise): `runSectionLoad` 정착·`attempt≠resultAttempt` 복원 경로·`busy`/`cooldown`/`superseded` 순서·`notConfigured`/`notApplicable`·구조 상태 보존·아코디언 보존 이동·refresh 선점·`web skipped`·`searchFailed` 조건.
- `tool-budget.test.ts`: 버킷 공유(허브·상세 버스), 시간당 상한, `retryAfterMs` 결정성.

### 8.3 실기기 게이트(`docs/FIELD-TEST.md` §8 ⑧~⑪)
⑧ `describe_app` 뒤 자율 연쇄 ⑨ 패널 펼침 시 커서 보존(`focus_item` 착지 경우 / 스와이프 도달 경우 분리) ⑩ 화면 전환 3연쇄 + 전환 중 호출의 호스트 표시 ⑪ 동명 도구 앵커 차이. ⑦ 재관측.

## 9. 설계 리뷰 기록 (codex adversarial, 2026-08-28, raw `codex exec` diff-injection, 67,835 토큰)

판정 "승인 보류, high 10·med 4". 처리:

| # | 지적 | 처리 |
|---|---|---|
| 1 | `placeRef`가 세대 없이 재사용, `searchId` 선택 인자 | **반영** — `ref` 불투명 토큰 하나(§3.0), 세대 인자 폐지 |
| 2 | `load`/`waitSettled` 분리의 TOCTOU, 복원 경로 오인 | **반영** — `runSectionLoad` 원자 호출, `attempt`/`resultAttempt` 분리, `restoredPrevious` |
| 3 | 검색 세 분기 공통 세대 없음, 웹 미시작 영원 pending, `sort` 경합 | **반영** — `runSearch(request)` 원자화, 분기 `skipped`, `searchFailed` 조건 명시 |
| 4 | 등록 교체 비원자, `open_*` 직후 빈 창 | **반영** — 코디네이터(§5.3): 겹침 0 주장 철회, `viewChanging` 결정적 반환, `open_*` 준비 확인 |
| 5 | 동명 도구 계약 불일치(`open_directions` 입력, `open_place` 세대 필드) | **반영** — manifest 한 벌, `open_directions {to?}` 통일 |
| 6 | 정적 등록 vs 미마운트 섹션 데드락 | **반영** — 브릿지가 전 키 엔트리 소유, `notConfigured`/`notApplicable`, cleanup `aborted` |
| 7 | 3-state가 문자열·키 부재로 뭉개짐 | **반영** — 구조 상태, 축별 상태, 항목 `state`, 무장애 `match` 구조 |
| 8 | 아코디언 자동 닫기 vs 포커스 이동 0 | **반영** — 닫히는 패널 안 포커스는 트리거로 보존 이동 |
| 9 | VO 커서는 DOM 포커스로 못 잡음, 착지 ID 세대 부재 | **반영** — 범위를 DOM 포커스로 정직하게 한정 + 안정 key, `focus_item` 결박 대상에 `ref` 필수 |
| 10 | `describe_app` 정적 표가 낡음, 부분집합 테스트 | **반영** — manifest 생성 + 런타임 `available`, equality 테스트 |
| 11 | 문자열 안 좌표·URL query | **반영** — href query 제거, 직렬화 스캔 |
| 12 | 1,500자·JSON escaping·counts | **부분 반영** — W1 `capOutput`이 이미 최종 직렬화 길이·`ReturnedCount/TotalCount`·`itemTooLarge` 폴백을 구현한다(리뷰어에게 코드가 없었다). 더한 것: 최소 폴백 상한 테스트, 생략 순서에서 `places` 최후 보존 |
| 13 | refresh 동시 호출 모순 | **반영** — busy → cooldown → 새 attempt 순서 고정 |
| 14 | 섹션 단위 쿨다운은 쿼터 보호가 아님 | **부분 반영** — upstream 키 버킷 + 세션 시간당 상한. 서버 측 일일 예산·single-flight는 사용자 UI와 같은 노출이라 별도 백로그 |

기각 0. "필수 수정 게이트 6"은 전부 본문에 들어갔다.
