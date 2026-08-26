# WebMCP 도구층 설계 (2026-08-27)

`docs/BACKLOG.md` W1 게이트 2의 정본. 웹앱(길동무 길찾기 뷰)이 `document.modelContext.registerTool`로 자기 기능을 브라우저 에이전트에게 선언하는 계층의 **도구 목록·계약·출력 분할·등록 수명·접근성 계약·구현 인계**를 여기에 못박는다. 설계 근거는 이 문서 하나에 둔다. 구현은 Codex가 `feat/webmcp`에서 하고, 이 문서와 어긋나는 실측이 나오면 구현을 멈추고 이 문서로 돌아온다(AUTONOMY §역방향 전이).

**설계 리뷰 판정**: codex 적대적 리뷰 **실시**(CLAUDE.md 마일스톤 게이트 조건 ② — 새 외부 통합의 계약 가정을 여기서 처음 정의한다). 1차 초안에 36건이 나왔고 그 반영·기각 기록이 §9다. 아래 본문은 반영 후 판이다.

**전제(게이트 0·1)**: ChatGPT 데스크톱 앱 내장 브라우저에서 VoiceOver가 돌고, **DOM 포커스를 옮기면** VoiceOver가 따라온다(2026-08-27 위원장 실측 통과, 프로브 `4a3ee44`). Tmap 키는 dodo-planet이 전용 앱으로 옮겨 가 길동무 프로덕션 키의 일 1,000건(자동차+보행자 공유)은 길동무 단독이 됐다(2026-08-27 게이트 1 종결). 게이트 0이 증명한 것은 "DOM 포커스 → VO 추종"뿐이다 — VO 탐색 커서의 현재 위치를 페이지가 읽을 수 있다는 것도, 도구 실행이 사용자 제스처로 인정된다는 것도 아직 증명되지 않았다(§6.7·§8.4 실기기 게이트).

## 0. 한 문단 요약

에이전트에게 주는 도구는 **10개**다: 길찾기 뷰가 마운트 동안 고정 등록하는 9개 + 홈(검색 뷰)이 고정 등록하는 진입 도구 1개. 조건부 등록은 없다 — 결과가 없거나 세대가 지났으면 도구가 그 사실을 구조화해 돌려준다. 채팅 도구 24개를 옮기지 않는다(채팅은 "무엇이든 물어보는" 표면, WebMCP는 "이 화면이 할 수 있는 일"의 표면). 주력 아이디어는 축 A(에이전트가 답을 읽어 주는 대신 **스크린 리더 커서를 그 자리로 옮긴다**)이고, 나머지는 그 커서가 착지할 화면을 만드는 도구(조회·상세·안내)다. 조회 결과에는 세대 토큰 `planId`가 붙고, 경로 분할의 손잡이는 `planId` + 응답에 이미 있는 `routeKey`다. 출력은 도구별 **allowlist 직렬화**로만 나가고(좌표 필드는 allowlist에 없다) 1,500자 상한은 **항목 단위 생략**으로만 지킨다(문자열을 자르지 않는다).

## 1. 노출 원칙 (무엇을 넣고 무엇을 빼는가)

Chrome 모범 사례 네 줄이 선택 기준이다: "한 도구는 한 기능", "겹치는 도구는 에이전트를 혼란시킨다", "도구 하나하나가 컨텍스트 창과 완료 시간을 잡아먹는다", "정적 등록이 기본". 여기에 이 프로젝트의 기준 둘을 더한다.

1. **탭이 없으면 못 하는 것만 넣는다.** 서버 MCP(`packages/mcp`, npm `gildongmu-mcp`)가 똑같이 답할 수 있는 조회는 WebMCP의 존재 이유가 아니다. 넣는 것은 **①화면 상태를 바꾸거나 읽는 것 ②브라우저 안의 것(사용자 현재 위치·진행 중 안내 세션)에 의존하는 것 ③커서를 옮기는 것**이다. ②의 유일한 순수 조회 도구가 `get_walk_infrastructure_nearby`이고, 이 도구만 대응 화면 섹션이 없다(§3.9에 그 예외를 명시한다).
2. **채팅 도구와 1:1로 옮기지 않는다.** `declarations.ts`의 24개는 Gemini가 산문을 쓰기 위한 재료이고 `place` 인자·`resolvedPlace`·카드는 채팅 UI의 계약이다.

### 1.1 채팅 도구 24개 판정표

| 채팅 도구 | 판정 | 한 줄 근거 |
|---|---|---|
| `search_places` | ✗ | 서버 MCP·검색창이 한다. 길찾기 뷰에서는 목적지 해석이 `plan_directions` 안에 있다 |
| `search_address` | ✗ | 위와 같음 |
| `get_subway_arrivals` | ✗ | "내 주변" 허브 뷰의 일. 이 마일스톤은 길찾기 뷰 한 화면(+홈 진입)에 한정한다(§8.5) |
| `get_night_clinics` | ✗ | 허브 뷰 |
| `get_kids_places` | ✗ | 허브 뷰 |
| `get_nearby_events` | ✗ | 허브 뷰 |
| `get_surroundings` | ✗ | 허브 뷰 |
| `get_where_am_i` | ✗ | 서버 MCP `where-am-i`가 준다(채팅 판은 `place` 인자라 브라우저 위치도 안 쓴다) |
| `get_nearby_overview` | ✗ | 1,641자로 상한 초과인 데다 허브 뷰의 일 |
| `get_bus_arrivals` | ✗ | 허브 뷰 |
| `get_bike_stations` | ✗ | 허브 뷰 |
| `get_air_quality` · `get_weather` · `get_congestion` | ✗ | 서버 MCP가 준다. 화면 결합 없음 |
| `get_station_meta` · `get_station_facilities` · `get_station_timetable` | ✗ | 서버 MCP가 준다. 화면 결합 없음. (1차 초안은 시설 도구를 넣었으나 리뷰 #15·#19 — 화면 섹션 없음·동명이역 — 로 뺐다. 빠른 하차 문은 대중교통 상세에 있다) |
| `get_car_route` | △ | `plan_directions`의 `car` 결과로 흡수 |
| `get_nearby_barrier_free` · `get_barrier_free_detail` | ✗ | 허브 뷰. 다음 웨이브 |
| `get_transit_route` | △ | `plan_directions`(추천 1 + 대안 한 줄) + `get_transit_route_detail`로 분할 흡수 |
| `get_walk_infrastructure` | **○** | 브라우저 위치에 의존하는 유일한 순수 조회. `get_walk_infrastructure_nearby` |
| `get_walk_route` | △ | `plan_directions`의 `walk` 결과 + `get_route_steps`(페이지)로 분할 흡수 |
| `search_web` | ✗ | 에이전트가 직접 검색한다. 유료이기도 하다 |

○ 1, △ 3(→ 도구 3), ✗ 20. 여기에 채팅에 없는 축 A·B·진입 도구 6개를 더해 10개다.

## 2. 도구 목록 (정본 표 — 등록 집합·수명·힌트)

| # | name | 축 | 등록 주체 | readOnlyHint | untrustedContentHint |
|---|---|---|---|---|---|
| 1 | `open_directions` | 진입 | 홈(`PlaceSearch`, 검색 뷰가 보일 때) | false | true |
| 2 | `read_current_view` | A | `DirectionsView` | true | true |
| 3 | `focus_item` | A | `DirectionsView` | false | true |
| 4 | `plan_directions` | 조회 | `DirectionsView` | false | true |
| 5 | `get_transit_route_detail` | 조회 | `DirectionsView` | true | true |
| 6 | `get_route_steps` | 조회 | `DirectionsView` | true | true |
| 7 | `start_guidance` | B | `DirectionsView` | false | true |
| 8 | `guidance_status` | B | `DirectionsView` | true | true |
| 9 | `stop_guidance` | B | `DirectionsView` | false | false |
| 10 | `get_walk_infrastructure_nearby` | C | `DirectionsView` | true | true |

- **최대 동시 등록 수는 9**(길찾기 뷰가 보일 때 2~10). 홈과 길찾기 뷰는 History API로 배타 전환되므로 1과 2~10이 동시에 서는 순간은 없다(§5).
- `untrustedContentHint`는 **외부 API 데이터나 사용자 입력이 한 글자라도 출력에 실리면 true**다. 3·7이 true인 이유: 돌려주는 `label`·`routeKey`가 장소명·경로 문장에서 온다(리뷰 #23). 9만 `{ok}`·사유 코드뿐이라 false.
- **이름 규칙**: 동사가 실행과 개시를 구분한다. `plan_directions`는 조회를 **끝까지 실행**하고 결과를 돌려준다. `start_guidance`는 세션을 **개시**하고 즉시 돌아온다. 이름 30자 이내, 언더스코어.
- **언어**: `name`·`description`·파라미터 설명은 **영어 고정 문자열**(로케일 무관 — 재등록 방지·에이전트 안정성·심사 언어). 출력 안의 사람 문장(스텝·라벨·통지)은 **화면과 같은 로케일의 같은 문자열**이다(§4.3).

## 3. 도구별 계약

### 3.0 공통

- `inputSchema`는 `additionalProperties: false`. 검증은 "스키마는 느슨하게, 코드는 엄격하게" — 범위·존재·세대 검사는 `execute` 안에서 하고 **실패는 throw가 아니라 구조화된 사유로 돌려준다**(에이전트가 스스로 고쳐 재시도할 수 있게). throw는 런타임 부재·등록 실패뿐.
- **모든 출력은 discriminated union이다.** 최상위에 `ok: true | false`, 실패면 `reason`(아래 사유 코드 표) + 필요 시 `retryable: boolean` + `userActionRequired: boolean`. 성공 모양은 도구별.
- **사유 코드 표**(도구 공통 어휘 — 새 코드는 여기 등록):

  | reason | 뜻 | retryable | userActionRequired |
  |---|---|---|---|
  | `noResult` | 아직 조회 결과가 없다(`plan_directions` 먼저) | true | false |
  | `stalePlan` | `planId`가 현재 세대와 다르다(재조회됨 — `read_current_view`로 새 `planId`) | true | false |
  | `busy` | 조회가 진행 중이다 | true | false |
  | `superseded` | 대기 중 다른 조회가 시작돼 이 호출은 무효 | true | false |
  | `toNotFound` / `fromNotFound` / `viaNotFound` | 후보 0건 | false | false |
  | `needsDisambiguation` | 후보가 여럿이라 고르지 않았다(후보 목록 동반) | false | false |
  | `geoDenied` / `geoUnavailable` / `geoTimeout` | 현재 위치 측위 실패 3종(화면 `geoError`의 세분) | denied는 false, 나머지 true | denied만 true |
  | `outOfCoverage` | 한국 밖 | false | false |
  | `unknownRouteKey` | 이 `planId` 안에 그 경로가 없다 | false | false |
  | `notStartable` | 안내 시작 조건 미충족(키·실좌표·결과) | false | false |
  | `sessionActive` | 다른 안내 세션이 점유 중 | false | true |
  | `noSession` | 활성 세션 없음 | false | false |
  | `confirmationRequired` | 사용자 제스처가 필요해 페이지 컨트롤에 포커스를 두었다(§3.7) | false | true |
  | `notFound` / `focusRejected` / `editingInProgress` | `focus_item` 3종(§3.3) | false | 마지막만 true |
  | `cooldown` | 최소 간격 미달(`retryAfterMs` 동반) | true | false |
  | `aborted` | 뷰 언마운트·실행 signal 취소 | false | false |
  | `unsupported` | 그 기능이 이 환경에 없다(`outsideKorea` 등 세부는 `detail`) | false | false |

- **실행 signal**: `execute(input, { signal })`의 `signal`을 모든 fetch·`awaitGeolocation`·phase 대기에 전파한다. 뷰 언마운트 cleanup은 등록 abort와 **별도로** 진행 중 대기자를 `aborted`로 끝낸다(리뷰 #28). ⚠ 호스트가 `signal`을 주지 않는 구현도 있으므로 도구 헬퍼가 자체 `AbortController`를 하나 더 만들어 둘을 합친다(`AbortSignal.any`).
- **출력 직렬화는 도구별 allowlist**(§4.5). 표에 없는 키는 나가지 않는다.
- **상한 1,500자**(§4.4)는 `JSON.stringify` 결과의 `string.length`(UTF-16 코드 유닛) 기준이고 헬퍼가 최종 문자열에서 다시 검증한다.

### 3.1 `open_directions` (진입)

- description: `Open the Gildongmu directions view from the home screen, optionally pre-filling the destination. Call plan_directions after this to run the search. If the directions view is already open this is a no-op.`
- inputSchema: `{ to?: string }` (`Destination place name or address to pre-fill. Optional.`)
- 동작: 검색 뷰의 기존 전환 경로(`?dir=` + `pushState`, `PlaceSearch`가 이미 가진 핸들러)를 부른다. `to`는 **필드 텍스트로만** 채우고 해석·조회는 하지 않는다(해석은 `plan_directions`의 책임 — 두 도구가 같은 해석을 하면 겹친다). 이미 길찾기 뷰가 열려 있으면 `{ ok:true, alreadyOpen:true }`.
- 출력: `{ ok:true, alreadyOpen:boolean }`. 포커스: 뷰 전환의 기존 착지(제목 `titleRef`)를 그대로 따른다 — 도구층이 더하지 않는다.
- 수명: 검색 뷰가 보이는 동안 등록. 길찾기 뷰로 전환되면 검색 뷰 컴포넌트가 해제한다(같은 `PlaceSearch` 안에서 뷰가 갈리면 `visible` 조건을 등록 훅의 `enabled`로 준다). **전환 순간 2~10이 등록되기 전에 1이 사라지는 창**은 수용한다(그 창에서 에이전트가 부를 도구는 없고, 호스트는 다음 목록 갱신을 받는다) — 반대 방향(둘이 겹치는 창)만 막는다: 2~10의 등록은 1의 abort **뒤에** 일어난다(`useEffect` 순서가 아니라 `PlaceSearch`가 뷰 전환 커밋에서 abort를 먼저 부른다).
- 쿨다운 없음(조회가 없다). 중복 호출은 no-op.

### 3.2 `read_current_view` (A, readOnly)

- description: `Read the state of the Gildongmu directions view: from/to/via fields, whether a plan is loaded (and its planId), a short summary per travel mode with route keys, the guidance session state, which element has keyboard focus, and the high-level focus targets for focus_item. Call this before planning, focusing, or when a tool returned stalePlan.`
- inputSchema: 빈 객체.
- 출력:
  ```
  { ok:true,
    fields: { from: string, to: string, via: string|null, avoidStairs: boolean },
    phase: "idle"|"needEndpoints"|"locating"|"loading"|"geoError"|"outOfCoverage"|"settled",
    plan: null | { planId, destination, modes: [ { mode, outcome: "done"|"empty"|"error"|"unsupportedWaypoint",
                                                     summary?: string, routeKey?: string } ] },
    guidance: { status: "idle"|"starting"|"tracking"|"done"|"failed", mode?: "walk"|"car"|"transit", routeKey?: string },
    keyboardFocus: { label: string|null, targetId: string|null },
    targets: [ { id, label } ] }
  ```
  - `fields`는 라벨 문자열(`FieldState.text`)이다. **좌표는 없다**(§7).
  - `keyboardFocus`는 `document.activeElement`의 접근 가능한 이름이다(body/documentElement면 `label:null`). **VoiceOver 탐색 커서가 아니다** — 페이지는 VO 커서를 읽을 수 없다. 이름을 `cursor`라 부르지 않는 이유가 그것이다(리뷰 #14). 접근 가능한 이름 계산은 `aria-label` → `aria-labelledby` 텍스트 → `textContent.trim()` 순(프로브 `activeElementLabel` 승격, `src/lib/webmcp/accessible-name.ts`).
  - `targets`는 **고수준 착지점만**이다: 필드 3·제출 버튼·수단 heading(있는 것만)·대중교통 경로 disclosure(≤5)·안내 패널(세션 중). 스텝·leg 착지 ID는 여기 싣지 않고 `get_route_steps`·`get_transit_route_detail`이 페이지 단위로 준다(리뷰 #20).
  - `guidance.status`는 §3.8의 상태 5종이고 세션이 없을 때도 `idle`로 항상 있다.

### 3.3 `focus_item` (A)

- description: `Move keyboard focus (and with it the screen reader's reading position) to one element of the directions view, so the user hears it in place instead of you reading it back. Use only when the user asked to be taken to something. Target ids come from read_current_view, plan_directions, get_route_steps, or get_transit_route_detail. Returns the label now under focus.`
- inputSchema: `{ targetId: string, planId?: string }` (`planId`: `Required for plan-scoped targets (mode, route, step, leg). Omit for fields and controls.`)
- **착지 대상 ID 체계**(안정 ID — DOM 인덱스가 아니다):
  - 뷰 범위: `field:from` · `field:to` · `field:via` · `control:submit` · `guidance:panel`(세션 중에만 존재)
  - 계획 범위(`planId` 필수): `mode:transit` · `mode:walk` · `mode:car` · `transit:route:{routeRef}` · `transit:leg:{routeRef}:{n}` · `walk:step:{n}` · `car:step:{n}` (n은 화면 번호와 같은 1-based)
  - `routeRef`는 `routeKey`가 아니라 **그 계획 안 경로의 0-based 순번을 base36으로 적은 내부 토큰**이다(`targets.ts`가 `planId` 스코프에서 `routeKey ↔ routeRef` 표를 든다). DOM 속성·CSS 선택자에 외부 문자열을 넣지 않는다(리뷰 #22). 선택자는 `[data-focus-target="…"]`이고 값은 `[a-z0-9:._-]`만 허용, 조회는 `CSS.escape` 경유.
- 동작 순서:
  1. `planId`가 필요한 대상인데 없거나 현재 세대와 다르면 `stalePlan`.
  2. `document.activeElement`가 `input`·`textarea`이고 대상이 그 요소 자신이 아니면 `editingInProgress`(사용자가 타이핑 중인 필드에서 커서를 빼앗지 않는다 — 리뷰 #13). 안내 세션 중이라도 `focus_item`은 거절하지 않는다 — 안내 중 "다음 스텝을 읽어 줘 → 그 자리로 옮겨 줘"가 축 A의 핵심 시나리오이고, 세션 통지는 live region이라 포커스 위치와 독립이다.
  3. 대상이 접힌 대안 경로 안이면 그 disclosure를 **화면 핸들러(`toggleRoute`)로** 펼치고, **대상이 DOM에 나타날 때까지 최대 500ms** 기다린다(`MutationObserver` + timeout). 그 사이 세대가 바뀌면 `superseded`(리뷰 #21).
  4. 없으면 `notFound`. `focus()` 후 `document.activeElement === target`이 아니면 `focusRejected`.
  5. 성공: `{ ok:true, label }`.
- 착지 대상 중 비인터랙티브 요소(`<li>`·heading)는 `tabIndex={-1}`(프로그래밍 포커스만, Tab 순서 불변).
- **통지하지 않는다.** 포커스 착지 낭독이 곧 통지다(헌장 §5 이중 낭독 금지).

### 3.4 `plan_directions` (조회)

- description: `Plan a trip in the Gildongmu directions view: resolve the destination (and optional origin, one via point, stair-avoiding walk), run the search for transit, walking and driving as the user would, and return a compact summary per mode with a planId and route keys. Origin defaults to the user's current location, which stays in the browser. If a name is ambiguous, returns candidates instead of guessing.`
- inputSchema:
  ```
  { to:   string  (required) "Destination: a place name or address, e.g. 'Seoul Station' or '세종대로 110'."
    toCandidateId?: string   "Pick one of the candidates returned by needsDisambiguation."
    from?: string            "Origin place name or address. Omit for the user's current location."
    fromCandidateId?: string
    via?: string             "One via point. Transit does not support via and reports unsupportedWaypoint."
    viaCandidateId?: string
    avoidStairs?: boolean    "Prefer a stair-free walking route. Default false." }
  ```
- **호출은 완전 교체다**(리뷰 #24): 생략된 `from`은 현재 위치, `via`는 없음, `avoidStairs`는 false로 **한 번에** 설정한다. 화면에 남아 있던 옛 경유지·출발지가 섞여 들어가지 않는다.
- **후보 해석**(리뷰 #11): 각 문자열은 화면의 후보 검색(`/api/places` + `/api/address/search`, `DirectionsEndpointSearch`가 쓰는 것)으로 푼다. 자동 채택은 **후보가 1건**이거나 **정규화 이름이 질의와 정확히 일치하는 후보가 정확히 1건**일 때만. 그 외(후보 0건 → `toNotFound`, 여럿이고 정확 일치 없음 → `needsDisambiguation`)는 **조회를 실행하지 않고** `{ ok:false, reason:"needsDisambiguation", field:"to", candidates:[ { candidateId, label, address } ≤5 ] }`를 돌려준다. `candidateId`는 그 호출의 후보 목록에 대한 단기 토큰(후보 검색 결과를 `execute` 클로저의 `Map`에 60초 보관)이고 다음 호출에 `toCandidateId`로 되돌린다. 채택한 후보 이름은 출력 `resolved`에 되돌린다("후쿠오카"→대구 가게 실측 재발 방지는 자동 채택 조건이 맡고, `resolved`는 사후 확인용).
- **조회 실행은 트랜잭션**(리뷰 #5): 화면의 정본 핸들러를 `runQuery(request: { from, to, via, avoidStairs })` 형태로 정의해 **완전한 요청 스냅샷**을 받게 하고, 필드 상태 갱신과 조회 시작을 같은 세대(`genRef` 증가)에서 커밋한다. 도구는 그 함수를 부른다. **새 fetch 경로를 만들지 않는다** — 화면이 그리는 `results`와 도구가 돌려주는 결과는 같은 객체다.
- **경합 정책은 reject-while-busy 하나다**(리뷰 #4): 조회 진행 중(`inFlight`) 도구 호출은 `busy`. 도구 호출이 대기 중일 때 **사용자가** 화면에서 새 조회를 시작하면 대기자는 `superseded`(사용자를 막지 않는다). 대기자는 호출 시점 세대에 결박되고 `phase` 전이가 그 세대일 때만 resolve된다(`useEffect`가 `{gen, resolve}` 슬롯을 본다).
- `planId`: `settled` 커밋마다 새로 발급되는 불투명 토큰(`gen` 기반, `p{gen}`). 재조회·계단 회피 토글 재조회도 새 `planId`다(결과 객체가 바뀌므로).
- 출력(1,500자 안):
  ```
  { ok:true, planId, resolved:{ from, to, via|null, avoidStairs },
    transit: { outcome, recommended?: { routeKey, totalMinutes, transfers, fare, walkMinutes, legLines:[…] },
               alternatives?: [ { routeKey, oneLine, highlight? } ], totalCandidates? },
    walk:    { outcome, distanceMeters?, durationSeconds?, stepCount?, stepFree?, stepFreeNotice? },
    car:     { outcome, distanceMeters?, durationSeconds?, guideCount? },
    targets: [ { id, label } ] }
  ```
  `outcome`은 `ModeOutcome.kind`(`done`·`empty`·`error`·`unsupportedWaypoint`) 그대로 — **3-state를 뭉개지 않는다**. `legLines`는 leg 한 줄 요약("5호선 강동 → 광화문, 12정거장"), `oneLine`은 화면 disclosure 라벨과 같은 문장. 1차 초안의 `firstSteps`는 뺐다(스텝은 `get_route_steps`의 몫 — 요약에 넣으면 절단 대상이 된다).
- 실패: `busy`·`superseded`·`toNotFound`·`needsDisambiguation`·`geoDenied`·`geoUnavailable`·`geoTimeout`·`outOfCoverage`·`cooldown`·`aborted` 중 하나. 화면 `phase`와의 대응: `geoError` → 측위 실패 3종(`useGeolocation`의 오류 코드로 세분), `outOfCoverage` → 동명.
- **포커스를 옮기지 않는다**(이 화면의 기존 판정). **화면의 완료 통지는 그대로 낸다**(§6.3).
- **쿨다운**(리뷰 #27): 성공·실패 무관하게 **시작 시각 기준 3초**. 미달이면 `cooldown` + `retryAfterMs`.
- **세 수단 병렬 조회 비용은 명시적으로 수용한다**(리뷰 #33): 화면 계약이 "한 조회 = 세 수단"이고 수단별 조회는 화면에 없다. 도보만 원하는 요청도 세 수단을 부른다(사용자가 버튼을 누른 것과 같은 비용). Tmap 일 1,000건이 길동무 단독이 된 지금(게이트 1) 이 비용이 쿼터를 위협하지 않으며, 수단 선택 인자는 화면 핸들러가 그것을 지원하는 날 함께 넣는다.

### 3.5 `get_transit_route_detail` (조회, readOnly)

- description: `Return one transit route from the current plan in full: every leg with line, boarding and alighting stops, station count, walking distance, and the quick-exit door (which car and door to board so you alight next to the elevator or the transfer passage). Requires planId and routeKey from plan_directions.`
- inputSchema: `{ planId: string, routeKey: string }` (둘 다 필수).
- 출력: `{ ok:true, planId, routeKey, summary, legs:[ { n, mode, lineName?, fromName?, toName?, stationCount?, distanceMeters?, quickExit?, targetId } ] }`. 정거장 전체 목록(`stops[]`)은 싣지 않는다 — 3,706자의 대부분이 그것이고, 정거장을 하나하나 듣는 것은 `focus_item`으로 화면을 읽는 길이다.
- 실패: `noResult`·`stalePlan`·`unknownRouteKey`.

### 3.6 `get_route_steps` (조회, readOnly)

- description: `Return walking or driving directions from the current plan as a numbered page of step sentences, exactly as shown on screen, with a focus target id per step. Page with offset and limit. Requires planId.`
- inputSchema: `{ planId: string, mode: "walk"|"car", offset?: integer ≥0 (default 0), limit?: integer 1~20 (default 10) }`
- 출력은 수단 결과의 3-state를 최상위에 둔다(리뷰 #2):
  ```
  { ok:true, planId, mode, outcome:"done", total, offset, returnedCount, nextOffset|null, steps:[ { n, text, targetId } ] }
  { ok:true, planId, mode, outcome:"empty"|"error"|"unsupportedWaypoint" }   // steps 없음
  ```
- 스텝 번호 `n`은 화면 `StepList` 번호와 같다(도보 스텝 0 계단 회피 고지·경유지 구획 문장 포함 순서). 한 페이지가 상한을 넘기면 `limit`을 줄여 **완전한 항목만** 싣고 `nextOffset`을 당긴다(§4.4).

### 3.7 `start_guidance` (B)

- description: `Start live turn-by-turn guidance for the current plan: walking, driving, or one transit route. Same as the user pressing the guidance start button; uses the browser's location and speaks through the screen reader. Requires planId, and routeKey for transit. Returns immediately; if the browser needs a user gesture, focus is placed on the start button and confirmationRequired is returned.`
- inputSchema: `{ planId: string, mode: "walk"|"car"|"transit", routeKey?: string }` — **transit이면 `routeKey` 필수**(생략에 의한 추천 자동 선택 금지, 리뷰 #12).
- 동작: `stalePlan`·`noResult`·`notStartable` 검사 → 세션 소유자(`guide-session-store`, §5.2)에 **원자적 `claim("starting")`** — 이미 `starting`·`tracking`이면 `sessionActive`(기존 세션을 대신 끊지 않는다) → 화면의 같은 버튼 핸들러를 부른다(`DistanceBeacon` 트리거·해당 `routeKey`의 `TransitGuidePanel` 트리거) → 세션이 `tracking`으로 전이하거나 실패하면 그 결과를 돌려준다(최대 20초 대기, 그 뒤엔 `starting` 상태 그대로 `{ ok:true, status:"starting" }`).
- **사용자 제스처 폴백**(리뷰 #10): 도구 실행이 브라우저의 사용자 활성화로 인정되는지는 미검증이다(위치 권한 프롬프트·오디오 컨텍스트 재개가 걸릴 수 있다). 구현은 시작 핸들러 안의 활성화 의존 단계가 거부되면(권한 프롬프트 차단·`AudioContext` `suspended` 지속) 세션을 `failed`로 되돌리고 **시작 버튼에 포커스를 둔 뒤** `confirmationRequired`를 돌려준다 — 사용자가 그 버튼을 직접 누르면 된다(축 A의 방식으로 해결하는 폴백). 이 경로가 실제로 필요한지는 §8.4 실기기 게이트가 정한다.
- **별도 사용자 확인 토큰은 두지 않는다**(리뷰 #9 부분 기각, §9). `readOnlyHint:false`가 호스트에 주는 신호이고, 호스트 측 확인 UI의 유무는 §8.4 실기기에서 본다. 위험 완화는 ①`needsDisambiguation`으로 오해석 목적지 조회 자체를 막고 ②`sessionActive`로 진행 중 세션을 못 끊게 하며 ③`stop_guidance`는 화면 중지 버튼과 같은 통지·포커스 복귀를 남긴다는 세 겹이다. **위원장 판정(2026-08-27)**: 페이지 단계 확인을 두지 않는다 — 확인 없이 바로 실행. 위험 완화는 위 세 겹으로 충분하고, 호스트 확인 UI 유무는 §8.4 ④로 실측만 한다.
- 출력: `{ ok:true, status:"tracking"|"starting", mode, routeKey?, targets:[ { id:"guidance:panel", label } ] }`.
- 포커스·통지: 화면 버튼이 하는 것을 그대로(도보 `onStart={announceGuideStart}`, 패널 트리거). 도구층이 더하거나 빼지 않는다(§6.1).

### 3.8 `guidance_status` (B, readOnly)

- description: `Read the live guidance session: status, what to do now, what comes next, distance or stops remaining, off-route or signal-lost flags. Always available; returns status idle when no session is running. Read-only; it never speaks.`
- inputSchema: 빈 객체.
- 출력: `{ ok:true, status:"idle"|"starting"|"tracking"|"done"|"failed", mode?, routeKey?, now?, next?, remainingMeters?, etaSeconds?, remainingStops?, offRoute?, signal?, degraded?, lastMessage? }`
  - 도보·자동차 필드는 `RouteGuideApi`가 화면에 이미 내는 문자열(`liveRows.top`/`currentText` → `now`, `liveRows.next` → `next`, `progress` → `remainingMeters`·`etaSeconds`, `offRoute`, `degradeText` → `degraded`)이다. **리듀서 내부(`GuideState.phase`·`stepIndex`)는 노출하지 않는다** — 화면이 말하지 않는 것을 도구가 말하면 낭독과 어긋난다.
  - 대중교통은 `TransitGuideState`의 표시 필드(`phase`→`now`에 문장화된 화면 상태줄, `legIndex`·`lineName`, `remaining`→`remainingStops`, `lastMessage`, `signal`, `dataAgeSeconds`).
  - `done`·`failed`는 **종료 화면·실패 표시가 화면에 남아 있는 동안** 유지된다(리뷰 #8 — 자동 종료 직후 상태를 읽을 수 있어야 한다). 화면이 그것을 지울 때(사용자 닫기·새 조회) `idle`로.
- 상태는 §5.2의 세션 스냅샷에서 읽는다(자식 훅을 직접 만지지 않는다).

### 3.9 `stop_guidance` (B)

- description: `Stop the live guidance session, including one that is still starting. Same as the user pressing the stop button.`
- inputSchema: 빈 객체. 출력 `{ ok:true, previousStatus }` 또는 `noSession`.
- 동작: `guide-session-store`의 `stopActiveGuideSession()`(이미 있는 전역 함수)을 부른다. `starting` 중이면 세션 소유자가 진행 중 시작을 취소한다(측위 대기 중 abort). 포커스 복귀·중지 통지는 화면 중지 핸들러의 몫.

### 3.10 `get_walk_infrastructure_nearby` (C, readOnly)

- description: `Pedestrian infrastructure within about 150 m of the user's current location: audible traffic signals, crosswalks and tactile paving, each with direction and distance. The location never leaves the browser except to this site's own API. Registry data (Seoul, OpenStreetMap) that may differ from the street. Not shown on this screen.`
- inputSchema: 빈 객체(좌표 인자 금지 — 받으면 에이전트가 임의 좌표를 "현재 위치"라 부르는 경로가 생긴다).
- 동작: `awaitGeolocation({ force:true, signal })` → `/api/walk/nearby?lat&lng`(자체 API). 응답의 discriminated union(`ok`/`unsupported: outsideKorea`/`error`)을 그대로 `ok`·`unsupported`·`error`로. 출력에 좌표 없음(방위·거리·종류·이름만). 쿨다운 10초.
- **이 도구는 §1 원칙 ①의 명시적 예외다**: 길찾기 뷰에 대응 섹션이 없어 사용자가 화면에서 확인하거나 `focus_item`으로 찾을 수 없다(리뷰 #15). 그래도 두는 이유는 브라우저 위치 없이는 답할 수 없는 조회라 서버 MCP가 대체하지 못하고, 출력이 짧아(실측 496자) 전부 에이전트 발화로 전달되며, 허브 뷰의 보행 인프라 패널이 같은 API의 화면판이라 사용자가 확인하려면 그 화면으로 가면 되기 때문이다. description 끝 문장이 그 사실을 에이전트에게 알린다. 다음 웨이브에서 허브 뷰 도구층이 생기면 그쪽으로 옮기고 여기서 뺀다.

## 4. 출력 분할 계약

### 4.1 원칙

- **상한 1,500자**(`JSON.stringify` 결과 `length`)는 권장값이지만 헬퍼가 강제하는 **하드 상한**이다. 초과 시 잘린 사실을 `truncated:true` + `returnedCount`/`totalCount`(또는 `nextOffset`)로 남긴다 — 조용한 절단 금지.
- **분할 손잡이는 `planId` + `routeKey`**. `routeKey`는 한 응답 안에서만 유일하고 재조회 뒤 같은 문자열이 다른 경로를 가리킬 수 있으므로(리뷰 #1) 세대 토큰 `planId`가 반드시 동반된다.
- **분할은 접근성 설계와 같은 모양**이다: 후보 9개를 쏟지 않고 "추천은 이것, 대안 4건, 자세히 들으시겠습니까".

### 4.2 경로 3단

| 단 | 도구 | 담는 것 | 실측·예상 크기 |
|---|---|---|---|
| 요약 | `plan_directions` | 수단별 outcome + 추천 1건 leg 한 줄 + 대안 한 줄 + 도보·자동차 수치 + 고수준 targets | ≈1.0K |
| 상세 | `get_transit_route_detail` | 한 경로의 leg 전부 + 빠른 하차 문(정거장 목록 제외) | 551자 기준 ≈700 |
| 스텝 | `get_route_steps` | 도보·자동차 스텝 페이지 | ≤1.2K/페이지 |

### 4.3 문장의 정본

도구가 돌려주는 사람 문장(스텝·대안 라벨·통지·상태줄)은 **화면이 그리는 문자열과 같은 함수에서 나온다**(`rewriteWalkGuidance` 결과, `StepList`가 받는 배열, `RouteGuideApi.liveRows`, 패널 상태줄). 도구용 문장을 따로 조립하지 않는다 — 커서가 착지해 사용자가 듣는 것과 에이전트가 읽은 것이 다르면 SR 사용자에게 반증 채널이 없다.

### 4.4 상한 헬퍼 — 문자열을 자르지 않는다 (리뷰 #3)

`src/lib/webmcp/output.ts` `capOutput(value, plan)`은 **항목 단위로만** 줄인다: `plan`이 지정한 배열 필드를 순서대로(`targets` → `alternatives` → `legLines` → `steps`) **뒤에서부터 통째로** 빼고, 뺀 수를 `returnedCount`/`totalCount`(페이지형은 `nextOffset`)에 반영한다. **문자열 필드는 어떤 경우에도 자르지 않는다** — 안내 문장은 뒷부분이 잘리면 뜻이 뒤집히고("왼쪽으로 가지 말고 오른쪽으로"), 식별자·사유 코드가 잘리면 후속 호출이 죽는다. 배열을 다 비워도 넘기면(단일 항목이 상한을 넘는 경우) `{ ok:false, reason:"unsupported", detail:"itemTooLarge" }`로 실패시킨다(정상 데이터에서는 일어나지 않아야 하고, 일어나면 fixture로 잡는다). 메타 필드(`truncated`·카운트) 공간을 먼저 예약한 뒤 최종 직렬화 결과를 다시 잰다.

### 4.5 allowlist 직렬화 (리뷰 #17)

도구마다 `outputShape`(키 → 타입, 중첩 허용)를 두고 `serialize(value, shape)`가 **표에 있는 키만** 내보낸다. 모르는 키는 기본 폐기. 좌표(`lat`·`lng`·`latitude`·`coord`·`geometry`·`pathCoords`…)는 어느 표에도 없으므로 이름과 무관하게 나가지 않는다. 검증: 도구 10개의 `outputShape`에 좌표성 키가 없음을 테스트가 단언하고, 실측 응답 fixture(3,706자 transit 등)를 통과시켜 좌표 문자열(소수점 4자리 이상 위경도 패턴)이 결과에 없음을 정규식으로 이중 확인한다.

## 5. 등록·해제 수명

### 5.1 전부 정적 등록 (리뷰 #6·#7·#8·#29·#30)

| 도구 | 등록 주체 | 등록 | 해제 |
|---|---|---|---|
| 1 | `PlaceSearch`(검색 뷰 표시 중) | 검색 뷰 표시 | 길찾기 뷰 전환 커밋 직전 |
| 2~10 | `DirectionsView` | 마운트 | 언마운트 |

- **조건부 등록은 없다.** 결과가 없으면 `noResult`, 세대가 지났으면 `stalePlan`, 세션이 없으면 `idle`/`noSession`. 호스트의 도구 목록 갱신 타이밍에 기능 성립을 의존하지 않는다(Chrome "정적 등록이 기본"과 정합).
- **기제**: `AbortController` 하나 = 등록 집합 하나. `registerTool(tool, { signal })` 뒤 `controller.abort()`가 해제. `execute`는 **ref로 최신 상태를 읽고** 등록은 마운트 1회다(재등록 트리거 0 — 로케일 전환·타이핑·폴링·포커스 이동 어느 것도 목록을 흔들지 않는다. 테스트: 마운트 후 `registerTool` 호출 수 = 도구 수, 상태 변경 후 추가 호출 0).
- **런타임 부재**: `document.modelContext`가 없으면 훅은 아무것도 하지 않는다(경고 로그 없음 — 대부분의 사용자가 이 경로다). 프로브 페이지만 지원 여부를 화면에 낸다.

### 5.2 안내 세션의 소유자는 자식이 아니라 `guide-session-store`다

1차 초안은 B 도구를 `DistanceBeacon`·`TransitGuidePanel` 안에서 등록하려 했다. 그러면 ①대중교통 패널이 경로마다 인스턴스라 같은 이름이 이중 등록되거나 이전 cleanup이 새 등록을 지우고 ②`starting` 중엔 도구가 없어 취소가 불가능하며 ③종료 직후 상태를 읽기 전에 도구가 사라진다(리뷰 #7·#8). 해법은 이미 있는 계층이다 — `src/lib/guide-session-store.ts`가 세션 점유(`claimGuideSession`/`releaseGuideSession`/`stopActiveGuideSession`)의 전역 소유자다. 여기에 **상태 스냅샷 슬롯**을 더한다:

- `publishGuideSnapshot(snapshot: GuideSnapshot | null)` — 자식 훅(`useRouteGuide`·`useTransitGuide`)이 렌더마다(값이 바뀔 때) 게시. `GuideSnapshot = { sessionId, status, mode, routeKey?, now?, next?, … §3.8 필드 }`.
- `readGuideSnapshot()` — `guidance_status`가 읽는다. 세션 없음은 `{ status:"idle" }`.
- `claimGuideSession`은 **`starting` 단계부터** 점유한다(지금은 tracking 시작 시점 — `start_guidance`가 `claim`에 실패하면 `sessionActive`, 두 호출이 동시에 와도 하나만 통과. 자식의 시작 핸들러도 같은 claim을 지나므로 사용자 버튼과 도구가 경쟁해도 원자적이다).
- `done`·`failed` 스냅샷은 자식이 종료 화면을 유지하는 동안 남기고, 화면이 그것을 지우는 시점(닫기·새 조회·언마운트)에 `null`로 게시한다.
- `sessionId`는 claim마다 증가. `stop_guidance`가 돌려주는 `previousStatus`와 `guidance_status`의 상태는 같은 스냅샷에서 나온다.

이 층은 `src/lib`(React 비의존)에 있어 iOS `GuideSession.shared`와 같은 자리다 — 세션 소유권을 전역 하나가 쥔다는 계약이 두 플랫폼에서 같다.

## 6. 접근성 계약

기준 정본은 `~/.claude/ACCESSIBILITY.md`. 이 도구층은 헌장 §1 "동적 콘텐츠 등장 시 포커스 이동"과 §5 "비동기·상태 경계에서 포커스 이탈 방지(유지 우선)" 사이에 있다. 판별선은 **누가 일으켰는가**다.

1. **포커스를 능동적으로 옮기는 도구층 코드는 `focus_item` 하나뿐이다.** 그 이동은 사용자가 에이전트에게 부탁한 결과라 "사용자 행동의 응답"이고 §1의 착지에 해당한다. `plan_directions`는 조회 완료 후 무이동(이 화면의 기존 판정), `open_directions`·`start_guidance`·`stop_guidance`는 **화면 핸들러가 원래 하는 포커스 이동**(뷰 제목 착지·패널 트리거 착지·중지 후 트리거 복귀)이 **그대로 일어난다** — 도구층이 더하거나 빼지 않는다. "도구층이 옮기지 않는다"와 "실제 포커스가 움직이지 않는다"는 다른 말이며, 후자는 이 세 도구에서 참이 아니다(리뷰 #31). `confirmationRequired` 폴백(§3.7)만 예외로 도구층이 시작 버튼에 포커스를 둔다.
2. **비동기 경계에서 커서를 잃지 않는다.** 화면은 조회 중 컨트롤을 `aria-disabled` + `inFlight`로 살려 둔다(`disabled` 미사용). 도구는 **화면 핸들러를 부르므로** 이 보장을 상속한다. 도구 전용 경로는 §3.10 하나이고 그 도구는 화면 상태를 건드리지 않는다.
3. **페이지의 음성 채널은 하나이고, 도구는 거기에 쓰지 않는다.** 조회 완료·안내 통지는 화면 live region이 종전대로 낸다. 에이전트 호스트가 도구 출력을 어떻게 발화하는지는 페이지가 통제할 수 없다. 두 발화가 겹칠 가능성(리뷰 #18)은 **실기기 게이트 항목**이다(§8.4): 겹침이 실제로 중요한 통지를 삼키면 `runQuery(request, { source:"webmcp" })`로 **완료 통지만** 억제하는 선택지를 연다(오류·안전 통지는 억제 대상이 아니다). 실측 전에는 페이지 통지를 유지한다 — 페이지가 신뢰 채널이고, 호스트 발화가 VO에 도달하지 않는 환경에서 페이지 통지가 유일한 신호다.
4. **착지 뒤 낭독은 요소 자신이다.** `focus_item`은 통지하지 않는다. 착지 대상은 "한 줄 = 한 접근성 객체"를 지키는 요소(스텝 `<li>`·수단 heading·경로 disclosure 버튼)라 착지 낭독이 곧 그 항목 전체다. 새 착지 대상(`guidance:panel`)도 같은 규칙.
5. **탭 순서 불변.** `tabIndex={-1}`은 프로그래밍 포커스만.
6. **안내 패널 착지는 live region이 아니라 그 앞의 정적 헤딩**이다(live region에 포커스를 두면 매 갱신이 착지 낭독을 끊는다).
7. **`keyboardFocus`는 VO 커서가 아니다.** 게이트 0은 "DOM 포커스 → VO 추종"만 증명했다. VO가 탐색으로 옮긴 커서 위치를 `activeElement`가 반영한다는 증거는 없고, 페이지는 그것을 알 방법이 없다. 그래서 `read_current_view`는 `keyboardFocus`라 부르고 SR 커서라고 주장하지 않으며, `focus_item`은 `label`을 돌려줘 포커스 추종이 안 되는 호스트에서도 최소한의 대안(호스트가 라벨을 읽어 줌)이 남게 한다.

## 7. 개인정보·쿼터

- **신뢰 경계는 둘이다**(리뷰 #16): ①앱 서버(`gildongmu.dodoplanet.space`) — 좌표가 여기까지 가는 것은 종전과 같다(`/privacy`가 이미 서술) ②에이전트 호스트(ChatGPT 등, 제3자) — **새 수신자**다. 도구 출력은 ②로 간다.
- ②에 나가는 것: 사용자가 입력한 출발·도착·경유 문자열, 해석된 장소명·주소, 경로 요약·스텝 문장, 안내 상태줄, 주변 보행 인프라의 종류·방위·거리. **좌표는 나가지 않는다**(§4.5 allowlist). 그러나 이 정보만으로도 사용자의 위치·이동은 강하게 추론되므로 **위치·여정 데이터 전체를 개인정보로 분류**한다.
- **위원장 판정(2026-08-27)**: ①은 **추가**, ②는 두지 않는다. 문안은 구현 시 TextEdit 왕복으로 확정한다(Codex 구현 범위에 `/{locale}/privacy` 카피 한 절 포함). 원안: ①웹 `/privacy`에 "브라우저 에이전트(WebMCP)를 켠 경우 도구 출력이 그 에이전트 제공자에게 전달된다" 한 절을 넣을지 ②첫 도구 호출 전 페이지 단계 동의(1회, `localStorage`)를 둘지. 권고는 ①만: WebMCP는 사용자가 에이전트 쪽에서 켜야 성립하는 기능이라 그 행위가 동의이고, 페이지 단계 동의는 도구 호출을 한 번 더 막아 데모·실사용 모두 어색하다. iOS·PrivacyInfo·ASC 라벨은 무관(이 층은 웹 전용, 앱은 WebMCP를 모른다).
- **쿼터**: `plan_directions`는 사용자 버튼과 같은 요청 수(세 수단 병렬). 도구층 쿨다운은 **시작 시각 기준**(성공·실패 무관) 3초, `get_walk_infrastructure_nearby` 10초, 동시 호출은 `busy`로 병합. 서버 IP 레이트리밋은 그대로. Tmap 일 1,000건(자동차+보행자 공유)은 게이트 1로 길동무 단독이 됐고 `lang="en"` 도보가 Tmap 단독인 사실은 그대로다 — 심사 기간 트래픽 상한은 이 쿨다운과 서버 리밋이 정한다.

## 8. 구현자 인계

### 8.1 의존성: `usewebmcp` 도입 **안 함**

- 프로브(`4a3ee44`)가 `document.modelContext` + `AbortController` 직접 호출로 동작을 증명했다. 필요한 것은 "등록·해제·execute ref·allowlist 직렬화·상한" 훅 하나다.
- `usewebmcp` v5.0.1은 이름·설명·deps 변경 시 재등록, 런타임 부재 시 `console.warn`, MCP-B식 출력 정규화(`structuredContent`)를 붙인다. 셋 다 이 설계와 어긋난다(§5 재등록 0·경고 로그 0, 출력은 문자열 하나). "vanilla 기본"과 챌린지 심사(코드를 읽는다)에도 자체 구현이 유리하다.
- 폴리필도 넣지 않는다. 지원 브라우저가 아니면 도구가 없는 것이 정답이다.

### 8.2 파일 배치 (소유 `src/lib/webmcp/**` + 소비 컴포넌트 최소 배선)

| 파일 | 내용 | React 의존 |
|---|---|---|
| `src/lib/webmcp/types.ts` | `WebMcpTool`·`ModelContext`·사유 코드 union·`modelContext()` 탐지(프로브에서 이동) | 없음 |
| `src/lib/webmcp/output.ts` | `capOutput`(항목 단위)·`serialize(value, shape)`(allowlist)·길이 측정 | 없음 |
| `src/lib/webmcp/targets.ts` | 착지 ID 체계·`routeKey ↔ routeRef` 표·허용 문자·`data-focus-target` 상수 | 없음 |
| `src/lib/webmcp/accessible-name.ts` | `activeElementLabel` 승격 | 없음(DOM만) |
| `src/lib/webmcp/tools/*.ts` | 도구별 `description`·`inputSchema`·`outputShape`·`execute` 조립(화면 상태·핸들러는 인자) | 없음 |
| `src/lib/guide-session-store.ts` | **확장**: `starting` 단계 claim·`sessionId`·`publishGuideSnapshot`/`readGuideSnapshot` | 없음 |
| `src/hooks/useWebMcpTools.ts` | `useWebMcpTools(tools, { enabled })` — 마운트 등록·abort 해제·execute ref·실행 signal 합성 | 있음 |
| `DirectionsView.tsx` | `runQuery(request)` 트랜잭션화 + 세대 대기 슬롯 + 훅 호출 1줄(9개) + `data-focus-target` | 배선 |
| `PlaceSearch.tsx` | `open_directions` 등록 + 전환 시 abort 순서 | 배선 |
| `useRouteGuide.ts`·`useTransitGuide.ts` | `publishGuideSnapshot` 게시(값 변경 시), `starting` claim | 배선 |
| `StepList.tsx`·`WalkRouteBriefing.tsx`·`CarRouteBriefing.tsx`·`TransitRouteBriefing.tsx`·`DistanceBeacon.tsx`·`TransitGuidePanel.tsx` | `<li>`·heading·패널 헤딩에 `data-focus-target` + `tabIndex={-1}` | 배선 |
| `src/app/[locale]/webmcp-probe/**` | 유지. 프로브 도구 2개는 `src/lib/webmcp` 헬퍼로 재작성 | — |

`src/lib/webmcp`·`guide-session-store`는 React/Next 비의존. 도구 조립 함수는 "상태 스냅샷 + 핸들러 → 출력"의 순수 함수라 node-env 단위 테스트가 된다.

### 8.3 기존 fetch를 감싸는 방식

- **감싸지 않는다 — 부른다.** 도구 `execute`는 화면이 이미 가진 핸들러(`runQuery(request)`, 시작 트리거, `stopActiveGuideSession`)를 ref로 부르고, 완료를 **세대 결박 대기자**로 기다린 뒤 **화면 상태에서** 출력을 조립한다. 대기자 계약(§3.4): `{ gen, resolve, reject }` 단일 슬롯, `phase` 전이가 같은 `gen`일 때만 resolve, 다른 `gen`의 조회 시작은 `superseded`, 언마운트·실행 signal은 `aborted`.
- 도구 전용 fetch는 §3.10 하나. 좌표 소스는 `awaitGeolocation({ force:true })`. 실행 signal 전파.
- 서버·API 라우트는 **한 줄도 바꾸지 않는다**. 클라이언트 전용 마일스톤.

### 8.4 테스트 (게이트 레인) + 실기기 게이트

- `output.test.ts`: 3,706자 실측 fixture → 항목 단위 절단·1,500 이하·문자열 무손상(모든 문자열이 원본의 부분이 아니라 **동일**)·`truncated`/카운트·좌표 패턴 부재·`itemTooLarge` 실패.
- `targets.test.ts`: ID 생성·파싱 왕복, 허용 문자, `routeRef` 표.
- `useWebMcpTools.test.tsx`(jsdom): 등록 수 = 도구 수, 상태 변경 후 재등록 0, 언마운트 abort, 런타임 부재 시 등록·경고 0, 실행 signal 합성.
- `DirectionsView.test.tsx` 확장(결정론적 deferred Promise로 경합 재현, 리뷰 #36): `focus_item` 착지(`waitFor` — [[jsdom-sync-focus-assertion-flake]])·`editingInProgress`·접힌 경로 펼침 후 착지 / `plan_directions` 중 `busy` / 도구 대기 중 사용자 조회 → `superseded` / 재조회 뒤 옛 `planId` → `stalePlan` / `needsDisambiguation` 왕복 / 언마운트 중 대기자 `aborted` / 세 수단 outcome 3-state 보존.
- `guide-session-store.test.ts`: `starting` claim 원자성(동시 두 claim 중 하나만), 스냅샷 게시·`done` 유지·`null` 소거, `stop`이 `starting`을 취소.
- **실기기 게이트(리뷰로 대체 불가, ChatGPT 내장 브라우저 + VoiceOver)**: ①`focus_item` 착지 낭독(§6.4) ②`start_guidance`가 사용자 제스처 없이 위치 권한·오디오까지 통과하는가 — 실패하면 `confirmationRequired` 폴백이 동작하는가(§3.7) ③호스트 발화와 페이지 완료 통지의 겹침이 중요한 통지를 삼키는가(§6.3) ④호스트가 `readOnlyHint:false` 도구에 확인 UI를 띄우는가(§3.7 위원장 판정의 재료). 대본은 `docs/FIELD-TEST.md`에 코디네이터가 추가.

### 8.5 범위 밖(다음 웨이브 후보 — BACKLOG 반영은 코디네이터)

- "내 주변" 허브 뷰 도구층(§1.1 ✗ 허브 항목 + `get_walk_infrastructure_nearby` 이관).
- 역 시설 도구(동명이역 `ambiguousStation` 계약과 화면 섹션이 함께 있어야 한다 — 장소 상세 뷰 도구층의 일).
- 장소 상세 뷰 `focus_item`.
- `plan_directions`의 수단 선택 인자(화면 핸들러 지원 선행).
- Declarative API(폼 속성) — 같은 기능이 두 표면에 서면 겹치므로 imperative만.

## 9. 설계 리뷰 기록

**codex 적대적 리뷰 1회**(2026-08-27 08:02 KST, `codex exec` diff 직접 주입·`< /dev/null`·메인 체크아웃 cwd, 5분 24초·66,664 토큰, 정상 종료). 판정 시점 대상은 이 파일의 1차 초안(커밋 전, worktree `feat/webmcp-spec` @ base `ce61cc0`; `origin/main`은 리뷰 중 `3ef4d87`로 이동했으나 소유 파일과 무관). 지적 36건, 최종 판정 "이대로는 불안전". 처리 원칙: 즉시 지엽 패치가 아니라 계층 재검토 — 36건 중 절반이 **"조건부 등록"과 "세대 없는 `routeKey`"라는 두 결정**에서 파생됐고(#1·#6·#7·#8·#12·#21·#29·#30·#32), 그 둘을 뒤집자(전부 정적 등록 + `planId`; 세션 소유자를 자식이 아니라 기존 전역 `guide-session-store`로) 개별 지적 대부분이 같이 닫혔다.

**반영(설계 변경)** — #1·#12 `planId` 세대 토큰 필수 / #2 `get_route_steps` outcome union / #3 문자열 절단 금지·항목 단위 생략 / #4·#5 reject-while-busy 단일 정책 + `runQuery(request)` 트랜잭션 + 세대 결박 대기자 / #6 전부 정적 등록 / #7·#8·#32 B 도구를 `guide-session-store` 소유로, `starting` claim, `done`·`failed` 유지 / #10 사용자 제스처 폴백 `confirmationRequired` + 실기기 게이트 / #11 `needsDisambiguation`·`candidateId` / #13 `editingInProgress` 거절 + description 조건 / #14 `keyboardFocus` 명명 + VO 커서 비주장 / #15·#19·#26 역 시설 도구 제거(다음 웨이브), 보행 인프라는 명시적 예외로 유지 / #16 신뢰 경계 2분·여정 데이터 개인정보 분류 / #17 allowlist 직렬화 / #20 요약 targets 고수준 한정 / #21 DOM 등장 대기 500ms + 세대 검사 / #22 `routeRef` 내부 토큰·`CSS.escape`·허용 문자 / #23 3·7 `untrustedContentHint:true` / #24 완전 교체 의미 / #25 실패 사유 표 / #27 시작 시각 기준 쿨다운·`retryAfterMs`·도구별 / #28 실행 signal 전파·언마운트 `aborted` / #29 도구 수 단일 표(10) / #30 `open_directions` 정식 계약 + abort 순서 / #31 포커스 문장 구분 / #33 세 수단 비용 명시 수용 / #34·#35 타입·측정 단위 명시 / #36 경합 테스트 목록.

**부분 기각·보류** —
- **#9(안내 시작·중지에 사용자 확인 토큰)**: 페이지 단계 토큰은 넣지 않는다. 근거: `readOnlyHint:false`가 호스트에 주는 표준 신호이고, 페이지가 또 한 번 막으면 "에이전트에게 부탁한 사용자"가 두 번 확인하게 된다. 위험 완화는 `needsDisambiguation`·`sessionActive`·중지 통지 세 겹으로 대신한다. **최종 판정은 위원장**(§3.7)이며 §8.4 ④ 실측(호스트 확인 UI 유무)이 재료다.
- **#18(이중 낭독 "수용" 불가)**: 페이지 통지 억제 선택지를 설계에 열어 두되(`source:"webmcp"`), 실측 전엔 페이지 통지를 유지한다. 근거: 페이지가 신뢰 채널이고 호스트 발화가 VO에 닿는지 자체가 미검증이라, 먼저 억제하면 통지 0인 환경이 생길 수 있다. §8.4 ③.
- **#33(세 수단 병렬 비용)**: 비용을 명시적으로 수용. 화면 계약을 도구층이 우회하지 않는다는 원칙이 더 크다.
- **#13의 "안내 세션 중 기본 거절"**: 기각. 안내 중 스텝으로 커서를 옮기는 것이 축 A의 핵심 시나리오다. 편집 중 필드 보호만 채택.

**리뷰가 잡지 못한 것(자체 발견)**: 1차 초안 §0·§2·§5의 도구 수 불일치(10/8+2/11)는 리뷰 #29가 함께 잡았다. 그 외 자체 수정: 게이트 1 종결로 Tmap 쿼터 전제 갱신(코디네이터 전파 2026-08-27 07:52).

**2차 리뷰**: 돌리지 않는다. 반영이 구조 변경 2건(정적 등록·세션 소유자)과 계약 명시이고, 두 변경 모두 codex가 제시한 방향 그대로라 같은 리뷰어의 재검토는 자기 처방 확인이 된다. 잔여 리스크는 구현 단계 spec-compliance 리뷰와 §8.4 게이트가 덮는다.
