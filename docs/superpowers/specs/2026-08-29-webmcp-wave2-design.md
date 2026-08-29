# WebMCP 도구층 W2 설계 — 이동 계획 보조 상시 집합 7개 (2026-08-29)

`docs/BACKLOG.md` W2의 정본. 오전판 `2026-08-28-webmcp-wave2-design.md`(화면별 배타 4집합·도구 31개)를 **대체**한다 — 같은 날 저녁 위원장 재판정(사용 사례 관점)으로 범위·등록 구조가 바뀌었다. W1(`2026-08-27-webmcp-tool-layer-design.md`)의 공통 계약(§3.0 discriminated union·사유 코드 표·§4 출력 분할·§6 접근성)은 그대로 상속하고, 오전판에서 살아남는 기반(불투명 `ref`·예산 버킷·구조 상태·codex 리뷰 14건 반영분)은 §5에 다시 적는다. 여기엔 **이 판이 새로 정하는 것**만 쓴다.

**설계 리뷰 판정**: codex 적대적 리뷰 **실시**(CLAUDE.md 게이트 조건 ① — 새 불변식 셋: 도구층 단일 실행 잠금·뷰 레지스트리 대기·상시 등록에서의 `ref` 세대). 1차 초안에 17건(high 11·med 6)이 나왔고 반영·기각 기록이 §9다. 아래 본문은 반영 후 판이다. 2차 리뷰는 W1·오전판과 같은 이유로 돌리지 않는다(같은 리뷰어의 재검토는 자기 처방 확인).

**위원장 판정 요약**
- 2026-08-28 저녁: ①범위는 사용 사례 ①(이동 계획 보조, 컴퓨터 앞) 한 줄기 — 검색 → 장소·역 정보 → 길찾기 브리핑. 사례 ②(실외 정위)·③(실시간 안내)는 모바일 에이전트 브라우저가 생기는 날의 후속. ②등록은 **앱 전체 상시 집합 한 벌**(루트 등록, 도구가 필요한 화면으로 스스로 이동). ③장소·역 정보는 `get_place_info` **하나**(축 단위).
- 2026-08-29 미결 4건: ④`read_current_view`만 유지, `focus_item` 제외 ⑤안내 세션 도구 3개 제외(코드 삭제, 사례 ③ 후속) ⑥`get_walk_infrastructure_nearby` 제외(코드 삭제, 사례 ② 후속) ⑦AI 채팅 제외·데이터 반환형 우선·`describe_app` 유지는 그대로.
- 근거는 조사 `docs/research/RESEARCH-2026-08-28-webmcp-tool-scope.md`(유효): 실배포 브랜드 1~10개·전 페이지 상시 등록, ChatGPT 사이트 도구는 데스크톱 앱 내장 브라우저만, 화면별 배타 등록은 "에이전트가 전환마다 도구를 다시 읽는다"는 미검증 기대에 기댔다.

## 0. 한 문단 요약

앱 루트(`PlaceSearch`)가 마운트 1회로 **도구 7개**를 등록하고 언마운트까지 바꾸지 않는다: `describe_app` · `search_places` · `get_place_info` · `plan_directions` · `get_transit_route_detail` · `get_route_steps` · `read_current_view`. 도구는 화면을 **스스로 옮긴다** — 검색은 홈으로, 장소 정보는 상세로, 길찾기는 길찾기 뷰로 가면서 화면이 그린 문장 그대로를 돌려준다(진입 전용 `open_*` 도구는 없다 — 겹침). 화면은 마운트할 때 자기 브릿지를 **뷰 레지스트리**(모듈 싱글턴)에 게시하고 도구는 실행 시점에 그것을 읽되, 이동 뒤 대기는 뷰 이름이 아니라 **정체성**(장소 id·게시 순번)에 결박한다. **도구층은 한 번에 하나만 실행하고**(단일 잠금, 둘째는 `busy`) 한 호출은 **operation 토큰** 하나와 전체 시간 상한을 가진다 — 두 도구가 서로 다른 화면으로 끌고 가는 경합이 구조적으로 없고, 취소된 호출의 늦은 완료가 다음 호출에 섞이지 않는다. 사용자 조작은 언제나 도구를 이긴다(도구는 `superseded`). 손잡이는 문서 세션 nonce·검색 세대·출처·순번을 결박한 불투명 `ref` 하나다. 홈 ↔ 길찾기 전환 등록(W1 §5.1)과 `focus_item`·안내 3종·보행 인프라·`open_directions`는 이 판에서 **삭제**된다.

## 1. 노출 원칙

W1 §1 개정판(데이터 반환형이 주, 제외는 겹침·이중 에이전트뿐)에 **사용 사례 한정**을 더한다.

1. **사례 ①만 넣는다.** "컴퓨터 앞에서 에이전트에게 물어 이동을 계획한다"에 쓰이는 정보·행동: 장소·주소 검색, 장소 정보(주소·전화·무장애·역이면 첫차막차·시설·실시간 도착), 세 수단 길찾기 브리핑. 판별 질문은 **"답이 사용자의 지금 자리에 의존하는가"** — 의존하면 사례 ②·③이라 뺀다(허브 10섹션·보행 인프라·실시간 안내). 예외는 길찾기 출발지 "현재 위치"뿐이며 W1 그대로다.
2. **진입 도구를 두지 않는다.** 데이터 도구가 필요한 화면으로 스스로 이동하므로 "열기만 하는" 도구는 같은 일을 하는 둘째 도구다(Chrome "겹치는 도구는 혼란"). **순수 화면 이동("길찾기 화면만 열어 줘")은 이 마일스톤 범위 밖이다** — 사례 ①은 답을 받는 것이지 화면을 조작하는 것이 아니고, 그 의도는 앱 UI로 한다(`describe_app` note). 화면 이동은 도구 출력의 `view` 필드와 화면 자체의 착지·live 문장으로 드러난다(투명성).
3. **커서를 옮기지 않는다.** `focus_item`을 빼는 순간 도구층이 능동적으로 포커스를 옮기는 코드는 0이다. 한 도구 호출에 화면 착지는 **최대 하나**(§6).
4. AI 채팅은 도구로 내지 않는다(W1 §1 이중 에이전트). `describe_app`이 "채팅과 내 주변은 화면에서 직접"이라고 알린다.

Declarative API·`plan_directions` 수단 인자는 W1 §8.5대로 범위 밖. W1-R 3건 중 #1(도보 최단 대안)·#2(`read_current_view` 설명문)는 이 마일스톤에 편입하고, #3(보행 인프라 SHAPE)은 도구 삭제로 소멸한다.

## 2. 도구 목록 (정본 표)

| # | 도구 | 축 | readOnlyHint | 필요 화면(스스로 이동) |
|---|---|---|---|---|
| 1 | `describe_app` | 고지 | true | 없음 |
| 2 | `search_places` | 조회 | false(최근 검색어 저장·화면 이동) | 홈 |
| 3 | `get_place_info` | 조회 | false(화면 이동) | 장소 상세 |
| 4 | `plan_directions` | 조회 | false(W1 그대로) | 길찾기 |
| 5 | `get_transit_route_detail` | 조회 | true | 길찾기(현재 계획) |
| 6 | `get_route_steps` | 조회 | true | 길찾기(현재 계획) |
| 7 | `read_current_view` | A(읽기) | true | 없음 |

- 7개는 위원장 "10개 안팎"의 아래쪽이다. 차이는 진입 도구 폐기(원칙 2)와 ④⑤⑥ 제외에서 온다 — 채우기 위해 도구를 만들지 않는다.
- **도구 목록 정본은 코드다**(`src/lib/webmcp/manifest.ts`, §5.1). `untrustedContentHint`는 W1 규칙(`describe_app`만 `false`).
- **삭제**: `focus_item` · `start_guidance` · `guidance_status` · `stop_guidance` · `get_walk_infrastructure_nearby` · `open_directions`(도구 파일·`DIRECTIONS_TOOL_NAMES`·`HOME_TOOL_NAMES`). **그 도구만 소비하던 기계도 함께 지운다**(§8.4) — 개념으로 훑고 낱말로 훑지 말 것.

## 3. 도구별 계약

### 3.0 공통 (W1 §3.0에 더한다)

- **단일 실행 잠금 + operation 토큰**(`tool-lock.ts`, 모듈 싱글턴): 잠금을 지나는 도구는 실행 시작에 `op = acquire(name)`을 받고(잠겨 있으면 즉시 `busy{running:"<name>"}`), 화면 이동·축 실행·정착 대기 **전부를 그 `op`에 결박**한다. 잠금은 `finally`에서 풀린다. `op`는 **전체 시간 상한 30초**를 가지며(단계별 상한: 화면 이동 2초·조회 정착은 화면 자체 타임아웃 승계), 초과·signal abort는 `aborted{detail:"timeout"|"signal"}`로 끝난다. **취소·만료된 `op`의 늦은 완료는 도구 결과에 반영되지 않는다**(정착 resolver·이동 대기자가 `op` 일치를 본다) — 화면 상태 변화 자체는 화면의 것이라 막지 않는다(사용자에게 보이는 결과라 투명하다). `describe_app`·`read_current_view`는 잠금을 지나지 않는다(읽기만 — 진행 중 도구가 있어도 답한다).
- **사용자 우선**: 도구가 대기 중인 자원(검색·조회·축·화면)에 사용자 조작이 일어나면 도구는 `superseded`로 끝난다. 도구는 사용자 조작을 막거나 되돌리지 않는다. 이 규칙은 아래 각 도구의 경합 항에서 구체화된다.
- **모달 중 거절**: 채팅 오버레이·현재 위치 지정 모달이 열려 있으면 화면을 옮기는 도구(2·3·4)는 `modalOpen`(userActionRequired)으로 거절한다. 배경 화면을 조용히 바꾸면 모달을 닫는 순간 사용자가 낯선 화면에 놓이고, 착지가 모달 밖으로 새어 나간다. 모달을 도구가 닫지 않는다.
- **화면 이동 계약(`ensureView`)**: 도구는 `view-registry`(§5.2)를 읽고, 필요 화면·정체성이 아니면 루트가 게시한 `navigate`를 `op`와 함께 부른 뒤 `waitForView`로 **정체성 일치 게시**를 기다린다(상한 초과 `viewChanging`, retryable). 이동은 전부 **화면이 원래 쓰는 핸들러**(`openDetail`·`requestOpenPlace`·`openDirections`·뒤로가기 핸들러)를 지나 히스토리 규율을 상속한다.
- **새 사유 코드**(`types.ts` `REASON_FLAGS` 등록): `staleResult`(검색 세대 지남, retryable — 복구는 §3.6) · `notConfigured`(키 게이트로 이 배포에 없는 기능) · `notApplicable`(비역 등 대상 아님) · `viewChanging`(화면 이동 상한 초과, retryable) · `geocodeFailed`(주소 `ref`의 좌표 확보 실패, retryable) · `modalOpen`(userActionRequired).
- **상태는 문자열이 아니라 구조다**: 축 봉투(§3.3)와 항목의 도메인 상태(도착 4-state·시간표 coverage)는 `line` 안 낱말이 아니라 **구조 필드**로 병기. 번역 문장은 `message`/`line`에 따로.
- 실행 상태 어휘 `busy`·`superseded`·`aborted`·`cooldown{retryAfterMs}`는 W1과 같다.

### 3.1 `describe_app` (readOnly, 잠금 미경유)

- 출력 `{ok, currentView, tools:[{name, available, reason?, requires?, produces?}], axes:[{axis, available}], notes:[string]}`. `currentView`는 §5.2의 안정 판정을 따르고 도구 이동 중이면 `"changing"`.
- `tools`는 manifest에서 **생성**(별도 상수 없음): `available`은 런타임 게이트 결합값 — `plan_directions`는 `hasWalkRouteKey∥hasOdsayKey∥hasCarRouteKey`, `get_transit_route_detail`은 대중교통 키, `search_places`는 항상. `requires`/`produces`는 연쇄(`search_places` produces `ref` → `get_place_info`·`plan_directions.toRef` requires `ref`; `plan_directions` produces `planId` → 5·6 requires `planId`).
- `axes`는 `get_place_info` 축의 배포별 가용 — 화면 게이트가 있는 둘만(`arrivals`=`canShowSubway`, `barrierFree`=`canShowBarrierFree`). 게이트 없는 축은 항상 `available:true`.
- `notes`(고정 영문): "Tools switch screens by themselves; the output's view field says where the app is now" · "To only open a screen, use the app; tools always answer" · "AI chat and the Nearby hub have no tools — they are on-screen only" · "The app never returns coordinates" · "One tool runs at a time; a second call returns busy".

### 3.2 `search_places` (홈)

- 입력 `{query: string, sort?: "accuracy"|"review"}`. 빈 질의는 `unsupported{detail:"emptyQuery"}`.
- 화면 이동(`navigate.toHome(op)`): 홈이 아니면 **상태로 진전을 재는 유한 루프** — ①맨 위 뷰의 뒤로가기 핸들러 호출(길찾기 `backFromDirections`·상세 `backToResults`·내 주변 `backFromNearbyHub`) ②다음 `popstate` **또는** 1초 중 먼저 오는 것을 기다림 ③`currentView()` 재판정, 홈이면 종료 ④최대 3회. **어느 popstate가 누구 것인지 귀속시키지 않는다** — 사용자가 동시에 뒤로가기를 눌러도 상태 재판정이 진전을 보장하고, 핸들러가 `replaceState`만 하는 방어 경로도 다음 재판정에서 잡힌다. 3회 뒤에도 홈이 아니면 `viewChanging`. 상태 직접 대입으로 홈을 만들지 않는다(히스토리에 유령 엔트리가 남아 뒤로가기가 빈 길찾기 뷰를 되살린다). 언와인드 중간 단계의 포커스 복귀는 `op` 진행 중 억제하고 **홈 착지 하나만** 일어난다(§6).
- **원자 호출**: 화면 정본을 `runSearch(request:{query, sort}, signal): Promise<SearchOutcome>`로 재정의하고(현 `runQuerySearch`·`toggleSort`가 이 하나를 부른다) 도구는 그것을 부른다. 시작 시 `searchAttempt` 발급, 세 분기(장소·주소·웹) 각각 `pending|done|empty|error|skipped`, 웹은 폴백 조건 미충족이면 `skipped`로 종결. 정착 = 세 분기 비-pending. `searchFailed`는 장소·주소 **둘 다** `error`일 때만. 정착 판정은 커밋 뒤 effect([[effect-resolver-must-guard-committed-state]])이고 **정착 시 결과 스냅샷을 `searchAttempt`에 결박해 동결**한다(§5.3의 `ref` 해석 표).
- 출력 `{ok, view:"home", searchRef, query, sort, branches:{places, addresses, web}, places:[{ref, name, category, address, roadAddress, distance?, phone?, isStation}], addresses:[{ref, road, jibun, zip, english?}], web:[{title, url, snippet}], placesReturnedCount?, placesTotalCount?, …}`. 상한 생략 순서 `web` → `addresses` → `places`. `distance`는 화면 표기 문자열(`formatDistance`).
- `web[].url`은 화면 링크 href의 **origin+path만**이되 **path에 십진 좌표쌍 세그먼트가 있으면 `url` 키를 뺀다**(§7).
- 경합: 잠금 → 쿨다운 3초(`search` 버킷) → 대기 중 사용자 검색·정렬 토글 → `superseded`.

### 3.3 `get_place_info` (장소 상세)

- 입력 `{ref: string, axes?: ("basic"|"timetable"|"facilities"|"arrivals"|"barrierFree")[], refresh?: boolean, offset?: number}`. `axes` 생략은 **해당하는 축 전부**(비역은 `basic`+`barrierFree`). `offset`은 **축을 하나만 요청했을 때** 그 축의 항목 페이징(§4.4 `page` 모드, 응답 `nextOffset`) — 축 여럿과 함께 오면 `unsupported{detail:"offsetNeedsSingleAxis"}`.
- `ref` 해석(§5.3): nonce 불일치·세대 불일치 → `staleResult`, 순번 밖 → `notFound`. 해석은 **동결 스냅샷에서 한 번**이고 그 `Place` 객체를 끝까지 쓴다(가변 표를 다시 읽지 않는다). 장소 `ref`는 `requestOpenPlace(place)`(채팅 카드와 같은 브릿지 — 어느 화면에서든 상세로 정규화). 주소 `ref`는 화면의 주소 카드 탭과 같은 경로(`/api/geocode` → `Place` 합성 → 같은 브릿지), 실패는 `geocodeFailed`. 이미 **같은 `place.id`의 상세가 게시돼 있으면** 이동 없음. `waitForView("place", {placeId})`는 그 id의 브릿지 게시를 기다린다(다른 장소의 브릿지는 일치가 아니다).
- **축 실행은 화면 소유 명령**(§5.4): `bridge.ensureLoaded(axis, op)` / `bridge.refresh(axis, op)`. 마운트 fetch 축(`basic`의 역 메타·`timetable`·`barrierFree`)은 `ensureLoaded`가 settle 대기, 버튼 트리거 축(`facilities` 코레일·서울, `arrivals`)은 화면이 자기 `load` 핸들러를 `source:"tool"`로 부른다(핸들러 복제 금지 — 다만 `source:"tool"`은 그 핸들러의 **헤딩 착지를 억제**한다, §6). `refresh`는 "닫았다 열기"가 아니라 **명시 재검증 계약**이다: 직전 데이터를 유지한 채 `load(force)`를 부르고, 실패하면 직전 데이터 + `refreshError`. 요청하지 않은 축은 건드리지 않는다. 완료는 명령 시점에 잡은 그 축의 요청 세대에 결박되고 **사이에 사용자가 같은 축을 닫거나 새로고침하면 그 축만 `superseded`**(다른 축 결과는 그대로).
- 게이트 순서(축마다): 비역인데 역 축 요청 → `notApplicable`; **화면에 게이트가 있는 축만** 키 게이트 → `notConfigured`(`arrivals`=`canShowSubway`, `barrierFree`=`canShowBarrierFree`; 시간표·시설·역 메타는 화면이 무조건 마운트하므로 도구도 조회하고 서버 거절은 `error`); 그 밖에 조회. 한 축의 실패가 다른 축을 막지 않는다. `present`는 **부모 `PlaceDetail`의 props에서 게시 시점에 확정**되고 자식 effect 등록 여부에서 오지 않는다 — 브릿지 게시 직후의 미등록 창이 거짓 `notConfigured`가 되지 않는다(자식 attach는 `ensureLoaded`가 `op` 상한 안에서 기다린다).
- **출력은 요청한 축마다 같은 봉투**: `{ok, view:"place", ref, name, category, isStation, basic?:{status, address:{english?, road?, jibun?}, phone?, stationMeta?:{status, lines:[string]}}, timetable?:{status, basis?, lines:[{line, first?, last?, coverage}], refreshError?}, facilities?:{status, korail:{status, groups:[{name, lines:[string]}]}, metro:{status, groups:[…], supplementFailed?}, refreshError?}, arrivals?:{status, items:[{line, direction, message, state:{kind}}], refreshError?}, barrierFree?:{status, match:{kind:"matched", facilityCount}|{kind:"unmatched"}, facilities:[{label, value}], source?, refreshError?}, axesRequested:[…], truncated?, nextOffset?}`. **미요청 축은 키를 생략**하고, `notApplicable`·`notConfigured`는 `status`로 나간다(`null`을 뜻으로 쓰지 않는다). 복합 축(시설)은 출처별 `status`를 보존하고 축 `status`는 두 출처의 결합(둘 다 `done`이면 `done`, 하나만이면 `partial`). `refreshError`가 있으면 `lines`/`groups`/`items`는 **직전 성공 데이터**다. `source`는 라벨 문자열이지 URL이 아니다. 문장은 **화면과 같은 함수**(`src/lib/place-lines/*.ts`).
- **상한 1,500자는 축 순서로 항목을 뺀다**: `arrivals.items` → `facilities.metro.groups` → `facilities.korail.groups` → `timetable.lines` → `basic.stationMeta.lines` → `barrierFree.facilities`. 빠진 배열은 `…ReturnedCount/…TotalCount`가 남고, 에이전트는 **그 축 하나 + `offset`**으로 다시 불러 유한 횟수에 전량을 받는다(설명문이 이 절차를 말한다). **정착 데이터의 재직렬화는 fetch가 아니므로 쿨다운·예산을 소비하지 않는다** — 쿨다운은 `refresh`와 첫 로드에만 걸린다.
- 경합: 잠금 → 축별 쿨다운(`arrivals` 10초, 나머지 60초, fetch에만) → 사용자 조작 `superseded`(축 단위).

### 3.4 `plan_directions` (길찾기, W1 §3.4 승계)

- 입력에 `toRef?: string`을 더한다(`to`와 배타 — 둘 다 오면 `unsupported{detail:"toAndToRef"}`). `toRef`는 검색 `ref`이고 상세의 "여기까지 길찾기"와 같은 **좌표 endpoint**(`{kind:"place", label:name, coord}`)로 요청에 실린다 — 텍스트 재해석 없음. 주소 `ref`는 `geocodeFailed` 경로 공유.
- 화면 이동: 길찾기 뷰가 아니면 `navigate.toDirections(op)`(`openDirections(null)` — 필드는 채우지 않는다, 요청 스냅샷이 전부 싣는다) 뒤 `waitForView("directions", {publishedAfter: op})` — **이동을 시작한 뒤 게시된 브릿지**만 일치다. 상세 위에서 열리면 히스토리 규율 그대로.
- **안내 세션과의 경합**: 도구 조회는 `hasActiveGuideSession()`이면 `sessionActive`로 거절하고 **세션을 끊지 않는다**(화면의 사용자 조회는 `stopActiveGuideSession()`으로 끊는다 — 그 차이가 의도다). 거절 뒤·조회 중에 사용자가 안내를 시작하는 경합은 사용자·사용자 경합(사용자 조회 중 안내 시작)과 같은 화면 규칙을 따르며 도구층이 새로 만든 것이 아니다 — 도구는 화면이 낸 `settled`를 그대로 돌려준다. `guide-session-store`에 계획용 점유는 두지 않는다(§9 #4·#11).
- 그 밖(해석·`needsDisambiguation`·세 수단 병렬·쿨다운 3초)은 W1 그대로. 출력에 `view:"directions"`, 도보에 `shortest?: {distanceMeters, durationSeconds, stepCount}`(W1-R #1).

### 3.5 `get_transit_route_detail` · `get_route_steps` (길찾기, W1 §3.5·§3.6 승계)

- 길찾기 뷰가 아니면 `noResult{detail:"noDirectionsView"}`(이동하지 않는다 — 계획이 없는 뷰로 가 봐야 답이 없다). `planId` 불일치는 `stalePlan`.
- `get_route_steps`에 `variant?: "recommended"|"shortest"`(기본 recommended, W1-R #1). 최단은 화면과 같은 배열(`walkStepItems`). 출력의 `targetId` 필드는 `focus_item` 삭제와 함께 뺀다.

### 3.6 `read_current_view` (readOnly, 잠금 미경유)

- 최상위 `view: "home"|"directions"|"place"|"nearby"|"changing"`. **도구 이동이 진행 중이면 `viewChanging`을 돌려주고 화면 데이터를 섞지 않는다**(`toolRunning` 동반). 사용자가 일으킨 전환은 React 커밋 하나라 두 브릿지가 동시에 게시된 순간이 없다(§5.2).
- 화면별 필드: 홈 `{query, sort, searchRef?, branches?, counts:{places, addresses, web}, chatOpen}`; 길찾기 `{fields, phase, plan:{planId, destination, modes:[…]}|null, guidanceActive}`(W1 필드에서 `keyboardFocus`·`targets`·`guidance` 스냅샷 제거. `guidanceActive`는 `hasActiveGuideSession()`); 상세 `{ref?, name, isStation, axes:[{axis, status}], chatOpen}`; 내 주변 `{note:"no tools on this screen"}`. `fields`의 사용자 입력(출발·도착·경유 텍스트)은 W1부터 나가던 것이고 privacy 문안이 이미 열거한다.
- 설명문: "Call this when a tool returned stalePlan, or to learn which screen the app is on". **`staleResult`의 복구 절차는 이 도구가 아니라 `search_places` 재호출**이다(홈 출력에 `query`가 있어 같은 검색어로 다시 부른다) — `staleResult` 실패 출력에 `recovery:"search_places"` + `query`를 싣는다. `stalePlan`과 `staleResult`를 한 설명문으로 묶지 않는다.

## 4. 착지·DOM 속성

- `data-focus-target`·착지용 `tabIndex={-1}`·`targets.ts`의 착지 ID 문법·`dom.ts`·`accessible-name.ts`는 `focus_item`의 소비물이라 **삭제**한다(§8.4). `RouteRefTable`(`routeRef`)은 `get_transit_route_detail`이 계속 쓰므로 남기고 `route-refs.ts`로 옮긴다.
- 새 DOM 속성은 없다. 축 실행은 DOM 셀렉터가 아니라 **브릿지 명령**(§5.4)이다 — 오전판의 `data-section-trigger` 클릭 방식은 사용자 토글과의 소유권 경합(리뷰 #9)으로 폐기했다.

## 5. 기반

### 5.1 manifest (오전판 §5.4 승계, 축소)

`src/lib/webmcp/manifest.ts`가 **도구 이름 → {description, inputSchema, outputShape, reasons, readOnly, locks, build(registry)}** 한 벌을 가진다. `index.ts`의 `buildAppTools(registry)`는 여기서 생성하고 `describe_app`도 같은 표를 읽는다. 테스트: 등록 이름 집합 **equality**(7개), `describe_app.tools` 이름 = 등록 이름, 설명 500자·이름 30자.

### 5.2 뷰 레지스트리 (`src/lib/webmcp/view-registry.ts`, React 비의존)

모듈 싱글턴. 오전판 §5.3 전환 코디네이터의 자리이되 등록 교체가 없으므로 `viewEpoch`·`ready`는 사라지고 **"어느 화면이 어떤 정체성으로 지금 브릿지를 게시했는가"**만 남는다.

- `publishView(view, bridge, identity)` / `withdrawView(view, bridge)`: 화면 컴포넌트가 마운트·언마운트 effect에서 부른다(`DirectionsView`→`DirectionsBridge`, `PlaceDetail`→`PlaceBridge` with `identity = place.id`, 홈은 `PlaceSearch`가 `HomeBridge`를 홈 표시 여부와 함께). 게시마다 **단조 순번 `seq`**가 붙는다. withdraw는 **자기 브릿지 정체성일 때만** 지운다(상세 `key` 리마운트에서 옛 cleanup이 새 게시를 지우지 않게).
- `currentView()`: `PlaceSearch`가 한 커밋에 한 뷰만 렌더하므로 게시는 상호 배타다(우선순위 표는 방어용: 길찾기 > 내 주변 > 상세 > 홈). 도구 `op`가 이동 중이면 `"changing"`.
- `waitForView(view, match, {op})`: `match`는 `{placeId}`(상세) 또는 `{publishedAfter: seq}`(이동 시작 시점 이후 게시) — **뷰 이름만으로는 일치하지 않는다**. 이미 일치 게시면 즉시, 아니면 게시 이벤트 대기, `op` 상한(2초)·abort는 reject.
- `navigate`: 루트 `PlaceSearch`가 `setNavigator({toHome(op), toDirections(op), toPlace(place, op)})`로 게시한다. 셋 다 `op`를 받아 억제 신호(§6)와 상한을 공유한다. `toHome`은 §3.2의 유한 루프.
- **테스트**: 게시·철회·정체성 가드, `waitForView` 세 결과(즉시·이벤트·타임아웃)와 두 `match`, `toHome` 2단계 언와인드(길찾기 위 상세)·사용자 동시 뒤로가기 주입·3회 상한, 정체성 불일치(장소 A 게시 중 B 요청)에서 조기 성공 0.

### 5.3 불투명 `ref`

형식(내부) `{nonce}.{searchAttempt}.{source}.{row}` base36 — `nonce`는 **문서 로드마다 새로 뽑는 세션 값**(리로드 뒤 옛 `ref`가 새 결과의 같은 순번으로 풀리지 않게), `source ∈ {p, a}`(장소·주소). 외부엔 문자열뿐, 파싱은 `place-refs.ts` 한 곳. 검사 순서 nonce → attempt → row. 해석 표는 `runSearch` **정착 시 동결한 결과 스냅샷**(`HomeBridge.snapshotFor(attempt)`)이고 가변 화면 상태를 다시 읽지 않는다 — 해석 뒤 사용자가 새 검색을 시작해도 이미 해석한 `Place`로 진행한다(그 화면 전환은 `requestOpenPlace`가 정규화한다).

### 5.4 `PlaceBridge` (화면 소유)

`PlaceDetail`이 소유하고 **축 5개 엔트리 전부**를 갖는다: `{axis, present, kind:"mount"|"trigger", read(), ensureLoaded(op), refresh(op)}`. `present`는 부모 props(`isStation`·`canShowSubway`·`canShowBarrierFree`)에서 **게시 시점에 확정**. 역 섹션 컴포넌트는 `useAxisBridge(axis, {read, load})`로 자기 엔트리의 상태 소스·`load(force, source)`를 **채워 넣을 뿐** 엔트리를 만들지 않는다. `ensureLoaded`는 ①attach 대기(`op` 상한 안) ②`idle`이면 `load(false, "tool")` ③명령 시점 요청 세대에 결박된 settle 대기 — 세대가 바뀌면 `superseded`. `refresh`는 `load(true, "tool")`이고 직전 데이터 유지·실패 시 `refreshError`. settle은 커밋 뒤 effect에서 풀고, 언마운트 cleanup은 대기자를 `aborted`로 끝낸다. 트리거 축의 `load`는 화면 버튼 핸들러와 같은 함수이고 `source:"tool"`은 헤딩 착지만 건너뛴다(§6).

### 5.5 쿨다운·세션 예산 (오전판 §5.5 승계)

`tool-budget.ts` 모듈 싱글턴, upstream 키 버킷 `search`(3초)·`plan`(3초)·`stationArrivals`(10초)·`stationTimetable`·`stationFacilities`(코레일)·`stationFacilitiesMetro`(서울 도시철도 — 다른 upstream이라 버킷도 다르다, W2-B1)·`barrierFree`(60초). 세션 예산 버킷당 시간당 도구 유발 fetch 30회, 초과는 `cooldown{retryAfterMs}`(결정적). **버킷은 실제 fetch를 일으킬 때만 소비**한다(정착 데이터 재직렬화·페이징은 무료). 서버 측 일일 예산·single-flight는 마일스톤 밖(`docs/BACKLOG.md` W2 후속).

### 5.6 등록 수명

`PlaceSearch` 마운트에서 `useWebMcpTools(() => buildAppTools(registry), {enabled:true})` 1회. `abortNow`·`enabled` 토글·홈 가시 조건은 삭제한다. 런타임 부재는 침묵(W1). 테스트: 마운트 후 `registerTool` 호출 수 = 7, 뷰 전환 3회 뒤 추가 호출 0.

## 6. 접근성 계약 (W1 §6 상속 + 개정)

1. **한 도구 호출에 착지는 최대 하나 — 최종 화면의 기존 착지뿐이다.** 도구층이 능동적으로 옮기는 포커스는 0이고, 화면 전환의 기존 착지(상세 `<h2>`·길찾기 제목·홈 결과 헤딩)는 **마지막 전환에서만** 일어난다. `op` 진행 중의 중간 착지(홈 언와인드의 단계별 포커스 복귀, 트리거 축 `load`의 헤딩 착지)는 화면 핸들러가 `source:"tool"`/`op` 억제 신호를 받아 건너뛴다. 오류·안전 통지는 억제하지 않는다.
2. **완료 통지는 최종 결과 하나만**: 중간 단계(언와인드·축 로드)의 완료 live 문장은 억제하고 최종 화면의 완료 문장만 낸다. 페이지 음성 채널은 하나이고 도구는 거기에 쓰지 않는다(W1 §6.3). 호스트 발화와의 겹침은 §8.3 ⑨의 **배포 차단 판정**이다.
3. **모달 위에서는 화면을 옮기지 않는다**(§3.0 `modalOpen`).
4. `read_current_view`는 DOM 포커스도 VO 커서도 주장하지 않는다(필드 자체를 뺐다 — W1 §6.7의 근거).

## 7. 개인정보·쿼터

- **출력 필드별 데이터 흐름 표**를 `output.ts` 옆 주석이 아니라 `manifest.ts`의 각 도구 `outputShape`에 **필드 단위 출처 주석**으로 남긴다(사용자 입력 / 화면 문장 / 외부 URL). 좌표는 allowlist 부재 + 직렬화 스캔(`lat=`·`lng=`·`x=`·`y=` 쿼리 이름, 십진 좌표쌍, **숫자 2원소 배열**)을 `output.test.ts`에 더한다. URL은 `web[].url` 하나이고 origin+path만 싣되 path에 좌표쌍 세그먼트가 있으면 키를 뺀다. `barrierFree.source`는 라벨이다.
- 새 데이터 유형: **검색어·검색 결과(장소명·주소·전화)·장소 정보(역 시간표·시설·실시간 도착·무장애 시설)**. privacy `agent` 절(`privacy.agent`, 6로케일)에서 안내 상태·보행 인프라는 **빠지고** 검색어·검색 결과·장소 정보가 **더해진다**(폼 입력·현재 위치 기반 파생 문장은 종전 열거 유지). **문안은 위원장 TextEdit 왕복으로 확정**(plan 마지막 태스크, 배포 전 게이트). 새 제3자 없음.
- 쿼터는 §5.5.

## 8. 구현자 인계

### 8.1 파일

| 파일 | 내용 |
|---|---|
| `src/lib/webmcp/manifest.ts` | 도구 정의 7개 한 벌, `buildAppTools`, 필드 출처 주석 |
| `src/lib/webmcp/view-registry.ts` | 게시·철회·`seq`·`currentView`·`waitForView(match)`·`navigator` |
| `src/lib/webmcp/tool-lock.ts` | 단일 잠금 + `op` 토큰·전체 상한 |
| `src/lib/webmcp/place-refs.ts` | nonce·세대·순번 인코딩, 동결 스냅샷 해석 |
| `src/lib/webmcp/tool-budget.ts` | 쿨다운·세션 예산(fetch 시에만 소비) |
| `src/lib/webmcp/route-refs.ts` | `targets.ts`에서 `RouteRefTable`만 남긴 것 |
| `src/lib/webmcp/types.ts` · `output.ts` | 사유 코드 추가·직렬화 스캔(좌표쌍 배열 포함) |
| `src/lib/webmcp/tools/context.ts` | `HomeBridge{runSearch, snapshotFor, openAddress, read}` · `PlaceBridge` · `DirectionsBridge`(`ensureVisible`·`expandRoute` 삭제) |
| `src/lib/webmcp/tools/{describe-app,search-places,get-place-info,plan-directions,get-transit-route-detail,get-route-steps,read-current-view}.ts` | |
| `src/lib/place-lines/{station-meta,station-timetable,station-facilities,station-metro,station-arrivals,barrier-free}.ts` | 축별 줄 조립(컴포넌트·도구 공용, lib에 둔다) |
| `src/hooks/useWebMcpTools.ts` · `useAxisBridge.ts` | `abortNow` 삭제 · 축 엔트리 채움 |
| `PlaceSearch.tsx`(루트 등록·`navigator`·`runSearch` 트랜잭션화·동결 스냅샷·`HomeBridge` 게시·모달 상태 노출) · `DirectionsView.tsx`(브릿지 게시로 전환, 등록 삭제) · `PlaceDetail.tsx`(`PlaceBridge` 게시·`present` 확정) · 역 섹션 5 · `BarrierFreeInfo`(`load(force, source)` 시그니처·착지 억제) | 배선 |
| W1-R: `plan-directions.ts` · `get-route-steps.ts` · `DirectionsView.tsx` | 도보 최단 |

### 8.2 테스트

- `manifest.test.ts`: 이름 집합 equality(7), `describe_app.tools` = 등록 이름, 설명 500자·이름 30자.
- `view-registry.test.ts`: §5.2 테스트 항목 전부.
- `tool-lock.test.ts`: 둘째 호출 `busy{running}`, abort·throw·타임아웃 뒤 해제, 만료 `op`의 늦은 resolve 무시, 읽기 도구 미경유.
- `place-refs.test.ts`: 왕복, nonce·attempt·row 검사 순서, 리로드(nonce 교체) 뒤 옛 ref 거절, 동결 스냅샷 해석(해석 뒤 새 검색이 결과를 바꾸지 않음).
- `output.test.ts`: 전 SHAPE 좌표 키 부재 + 직렬화 스캔(좌표쌍 배열) + `get_place_info` 축 순서 생략 + 단일 축 `offset` 페이징으로 전량 회수.
- `place-lines/*.test.tsx`(jsdom): 렌더 텍스트 == 도구 `line`(축 6).
- `PlaceSearchWebMcp.test.tsx`(deferred Promise): `runSearch` 정착·`web skipped`·`searchFailed`·`superseded`·홈 언와인드(2단계·동시 뒤로가기·3회 상한)·`modalOpen`·마운트 등록 7·전환 뒤 재등록 0·중간 착지 0.
- `PlaceDetailWebMcp.test.tsx`: `ensureLoaded`(attach 대기·idle 로드·세대 결박)·`refresh`(직전 데이터 유지·`refreshError`)·사용자 토글 개입 `superseded`(축 단위)·`notApplicable`/`notConfigured`(게시 직후 창에서 거짓 없음)·축별 실패 격리·언마운트 `aborted`·정체성 불일치 대기·`source:"tool"` 착지 억제·재직렬화 무과금.
- `plan-directions.test.ts`: `toRef` 좌표 endpoint·`to`와 배타·`geocodeFailed`·`publishedAfter` 일치·`sessionActive` 시 세션 불변; `get-route-steps.test.ts`: `variant`.
- **삭제 전 고정하는 회귀 테스트**(§8.4): 상세 "여기까지 길찾기"의 목적지 프리필, 뒤로가기 포커스 복귀(결과 헤딩·진입 칩), 사용자 안내 시작·중지(`claim`/`release` 원자성). 삭제 뒤 `webmcp-removal.test.ts`가 `focus_item`·`start_guidance`·`data-focus-target`·`data-guide-trigger`·`publishGuideSnapshot` 소스 참조 0을 스캔한다.

### 8.3 실기기 게이트 (`docs/FIELD-TEST.md` §8 ⑧~⑪ 교체 — **배포 차단 판정**)

⑧ 어느 화면에서든 "강동역 첫차 몇 시야": `search_places → get_place_info` 연쇄를 에이전트가 스스로 잇고 화면이 상세로 옮겨 가는가, VoiceOver 착지가 상세 제목 **한 번**인가(홈 결과 헤딩 착지·시설 헤딩 착지가 끼면 차단). ⑨ 호스트 발화와 페이지 착지·완료 통지의 겹침 — 중요한 통지가 삼켜지면 차단(억제 범위를 넓힌다). ⑩ 1,500자 초과 역에서 `truncated` 뒤 에이전트가 단일 축 + `offset`으로 전량을 받는가. ⑪ "거기까지 길찾기": `toRef` 경로가 상세의 "여기까지 길찾기" 버튼과 같은 목적지로 조회하는가(결과 이름 대조). ⑦(AI 채팅·내 주변 부탁 시 폴백)은 W2 뒤 재관측.

### 8.4 삭제 목록 (동작 계약 기준)

삭제 승인 조건은 이름·기원·참조 0이 아니라 **기존 사용자 동작의 회귀 테스트가 삭제 전에 고정돼 있고 삭제 뒤에도 통과하는 것**이다(§8.2).

| 지우는 것 | 그것만 소비하던 것 | 남기는 것(사용자 동작) |
|---|---|---|
| `focus_item` | `data-focus-target` 속성 전부(`DirectionsView`·`WalkRouteBriefing`·`TransitRouteBriefing`·`DistanceBeacon`·`TransitGuidePanel`), 착지 전용 `tabIndex={-1}`, `targets.ts` 착지 문법·`parseTargetId`·`focusTargetSelector`, `dom.ts`, `accessible-name.ts`, `DirectionsBridge.ensureVisible`, `read_current_view.keyboardFocus/targets`, `get_route_steps`·`get_transit_route_detail`의 `targetId` | 화면 전환·뒤로가기의 기존 착지(`headingRef`류 `tabIndex={-1}`) — 도구 이전부터 있던 것 |
| `start_guidance`·`stop_guidance`·`guidance_status` | `data-guide-trigger`·`guideTriggerSelector`, `DirectionsBridge.expandRoute`, `guide-session-store`의 `publishGuideSnapshot`/`readGuideSnapshot`/`clearRetainedGuideSnapshot`·자식 훅의 게시 호출(`useRouteGuide`·`useTransitGuide`), `read_current_view.guidance` | `claimGuideSession`(`starting` 단계 점유)·`releaseGuideSession`·`hasActiveGuideSession`·`stopActiveGuideSession` — 사용자 버튼 경합 원자성과 화면 조회의 세션 종료는 도구와 무관하게 옳다 |
| `get_walk_infrastructure_nearby` | 도구 파일뿐 | 서비스 `getWalkInfrastructure`(화면·채팅) |
| `open_directions` | `HomeBridge.openDirections/isDirectionsOpen`, `PlaceSearch.openDirectionsWithText`·`abortHomeTools`·`homeVisible`, `DirectionsView.initialToText`(사용처 4곳 — 전부 이 도구 경로인지 확인 뒤) | 상세 "여기까지 길찾기"(`openDirections(endpoint)`)·홈 "길찾기" 칩 |
| 오전판 spec·plan | 머리에 "폐기, 이 문서 참조" 한 줄, 본문 불변 | |

각 행은 "낱말 검색"이 아니라 **그 도구의 실행 경로를 따라가** 잡는다(같은 이름이 i18n 키·콜백 양쪽에 있을 수 있다 — CLAUDE.md E16 함정).

## 9. 설계 리뷰 기록 (codex adversarial, 2026-08-29, raw `codex exec` spec-injection, gpt-5.6-sol high)

판정 "승인 보류, high 11·med 6". 처리(리뷰는 처방이 아니라 신호 — 각 건을 아키텍처 수준에서 대조했다):

| # | 지적 | 처리 |
|---|---|---|
| 1 | `waitForView`가 뷰 이름만 봐 장소 A 게시 중 B 요청이 조기 성공 | **반영** — `match`(`placeId`·`publishedAfter: seq`) 결박(§5.2) |
| 2 | 브릿지 게시 ~ 자식 attach 사이 거짓 `notConfigured` | **반영** — `present`는 부모 props에서 게시 시점 확정, attach는 `ensureLoaded`가 대기(§5.4) |
| 3 | popstate 언와인드의 데드락·오귀속 | **반영(설계 변경)** — 이벤트 귀속 대신 상태 재판정 유한 루프(1초 또는 popstate, 3회 상한, `op` 전체 상한). 히스토리 엔트리 ID 처방은 채택하지 않았다: 진전을 상태로 보장하면 귀속이 필요 없다(§3.2) |
| 4 | 단일 잠금은 사용자 조작과 경쟁 | **부분 반영** — "사용자 우선 → 도구 `superseded`" 공통 규칙(§3.0) + 자원별 구체화. 계획용 lease는 **기각**: 도구 조회는 세션을 끊지 않고(사전 거절), 조회 중 사용자 안내 시작은 사용자·사용자 경합과 같은 화면 규칙이다(§3.4) |
| 5 | abort 뒤 늦은 커밋·무기한 잠금 | **반영** — `op` 토큰·전체 30초 상한·만료 `op` 완료 무시(§3.0) |
| 6 | 잠금 미경유 읽기가 전환 중 혼합 스냅샷 | **부분 반영** — 도구 이동 중 `viewChanging` 반환. 사용자 전환은 한 커밋 한 뷰라 혼합 창이 없다(§3.6·§5.2) |
| 7 | 리로드 뒤 `ref` 충돌, 해석 시점 미정 | **반영** — 문서 nonce + 정착 시 동결 스냅샷에서 1회 해석(§5.3) |
| 8 | 1,500자 재호출이 진전을 보장 못 함 | **반영** — 단일 축 `offset` 페이징(W1 `capOutput` page 모드) + 재직렬화 무과금(§3.3·§5.5) |
| 9 | 버튼 클릭 축 실행의 소유권·`refresh` 의미 | **반영(설계 변경)** — DOM 클릭 폐기, 브릿지 명령 `ensureLoaded`/`refresh`(세대 결박, 직전 데이터 유지, `refreshError`)(§3.3·§5.4) |
| 10 | 축 봉투가 `null`·미요청·적용 불가·갱신 실패를 못 가름 | **반영** — 축마다 같은 봉투, 미요청은 키 생략, `status`로 판정, 출처별 status·`partial`(§3.3) |
| 11 | `sessionActive` 비원자·snapshot 삭제 뒤 lifecycle 공백 | **부분 반영** — `guidanceActive`는 `hasActiveGuideSession()`(남는 API), 삭제 범위를 snapshot 계열로 한정해 lifecycle API 보존을 명시(§8.4). 계획용 claim은 #4와 같은 근거로 기각 |
| 12 | 삭제 기준이 동작 보존을 증명하지 않음 | **반영** — 삭제 전 회귀 테스트 고정, "git blame" 기준 폐기(§8.2·§8.4) |
| 13 | 채팅 모달 아래 자동 이동 | **반영** — `modalOpen` 거절(§3.0·§6) |
| 14 | 연쇄 착지·음성 겹침을 관찰로 미룸 | **반영** — 호출당 착지 최대 1·중간 통지 억제(`source:"tool"`/`op`), 실기기 ⑨를 차단 판정으로(§6·§8.3). 시설 축 `load()`가 실제로 헤딩 착지를 한다(코드 확인) |
| 15 | 좌표 유출 경로(URL path·`source`·배열) | **반영** — path 좌표쌍 세그먼트면 `url` 생략, `source`는 라벨, 좌표쌍 배열 스캔, 필드 출처 주석(§7) |
| 16 | `staleResult` 복구 안내 불일치 | **반영** — 복구는 `search_places` 재호출, 실패 출력에 `recovery`+`query`, 설명문 분리(§3.6) |
| 17 | `open_*` 삭제로 순수 이동 의도 상실 | **기각** — 순수 화면 이동은 사례 ① 밖(위원장 판정 ②·⑦, 데이터 반환형). 단일 이동 도구 대안은 후속 판정 항목으로 `docs/BACKLOG.md`에 남긴다(§1 원칙 2·`describe_app` note) |

기각 2(#4 lease·#17), 부분 3, 반영 12.
