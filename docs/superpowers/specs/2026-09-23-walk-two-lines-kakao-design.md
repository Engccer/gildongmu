# 도보 경로 두 줄을 카카오 안에서 (E42) 설계

2026-09-23. 백로그 E42. 근거 조사 `docs/research/RESEARCH-2026-09-13-walk-route-provider-options.md`.

## 0. 위원장 판정 (재논의하지 않는다)

1. 두 줄 모두 카카오. Tmap은 카카오 실패 시 폴백으로만 남는다(2026-07-29 계약 그대로).
2. 첫 줄 = 최단 경로(`SHORTEST`), 기본 펼침. 둘째 줄 = 계단 회피 경로(`ACCESSIBLE`), 접힘.
3. 계단 회피 토글을 없앤다.
4. 계단 회피 경로가 없으면 둘째 줄에 `BROAD_FIRST`를 싣는다.

**문구(2026-09-23 TextEdit 확정, 렌더 그대로)**: `최단 경로, 총 850m, 약 12분` / `계단 회피 경로, 총 880m, 약 13분` / 부재 시 `큰길 경로, 총 880m, 약 13분`(사유 문장 없음 — 이름이 곧 정보다) / 줄 안 버튼 `최단 경로로 안내 시작`·`계단 회피 경로로 안내 시작`·`큰길 경로로 안내 시작`. 줄은 한 접근성 객체(`joinText`).

## 1. 줄 종류 (`kind`)

줄의 이름은 그 경로가 가진 성질에 대한 약속이다. 그래서 이름을 고르는 판정은 **서버 한 곳**에 두고 응답에 `kind`로 싣는다. 클라이언트는 `kind`를 이름·안내 요청으로 투영만 한다.

| kind | 화면 이름(ko) | 조건 | 안내 시작 요청 |
|---|---|---|---|
| `shortest` | 최단 경로 | ko: 카카오 `route_mode=SHORTEST`(카카오 실패 시 Tmap `searchOption=10`) · en: Tmap `10` | `variant=shortest` |
| `accessible` | 계단 회피 경로 | 카카오 `ACCESSIBLE` 응답이 있고 **원문에 "계단"이 없다** | `accessible=true` |
| `broad` | 큰길 경로 | `ACCESSIBLE`이 없거나(`ROUTE_RESULT_NOT_FOUND`) 원문에 "계단"이 남았다 → 카카오 `BROAD_FIRST` | (파라미터 없음) |
| `recommended` | 추천 경로 | en 전용: Tmap `0` | (파라미터 없음) |

- **`accessible`의 판정은 종전 `applied` fail-closed와 같은 술어다**(`s.description.includes("계단")`, 카카오 원문). 계단 문구가 남은 `ACCESSIBLE` 응답을 "계단 회피 경로"라 부르면 이름이 거짓이 된다. 종전엔 그 응답을 경고 문장과 함께 냈지만, 위원장이 줄에서 경고 문장을 지웠으므로 이름이 참인 쪽(`BROAD_FIRST`, "큰길 경로")으로 보낸다.
- **둘째 줄은 카카오만이다.** 카카오가 실패(throw·키 없음)하면 둘째 줄은 없다(Tmap으로 대신하지 않는다). Tmap에는 계단 회피 축이 없고, Tmap `0`을 "큰길 경로"라 부를 근거도 없다(조사 §3 — Tmap `4` 대로우선조차 독립 축이 못 된다). 첫 줄은 Tmap 폴백이 있으므로 카카오 장애 때 화면은 "최단 경로" 한 줄이 된다.
- **같은 경로여도 두 줄을 싣는다.** 최단과 둘째 줄의 기하가 같을 수 있다(조사 §2.2: 15곳 중 4곳에서 `SHORTEST`=`BROAD_FIRST`). 두 이름은 각각 참인 성질을 말하므로("가장 짧은 길이 곧 계단 없는 길이다") 중복 제거하지 않는다.
- **이름이 성질을 말하므로 줄 경로에는 `stepFree`·`stepFreeNotice`를 싣지 않고, 스텝 0 유사 문장도 넣지 않는다.** 위원장이 지운 부재 사유 문장이 펼친 본문으로 되살아나는 경로를 구조로 막는다.
- **한 응답 안에서 provider를 섞지 않는다.** 첫 줄이 Tmap 폴백이면 카카오 둘째 줄을 싣지 않는다(`alternatives=1`도 추천이 카카오인데 최단만 Tmap이면 `shortest`를 비운다). 두 provider의 거리를 나란히 놓으면 조사 §4의 "최단이 더 긴" 역전이 돌아온다.
- **한 응답의 줄들은 같은 좌표로 부른다(원좌표).** 반올림은 캐시 키만이 아니라 카카오에 보내는 좌표 자체를 바꿔(셀 약 11m) 같은 길이 "최단 852m / 계단 회피 848m"로 나올 수 있다. 줄 목록은 세 모드 모두 원좌표, 단일 조회(안내·옛 화면)는 종전대로 `ACCESSIBLE`만 원좌표.
- **안내 세션의 이름도 서버가 준다.** 기하 응답(`includeGeometry=1`)에만 additive `kind`를 싣는다 — 요청이 아니라 **실제로 돌려준 경로**의 성질이다(계단 회피 요청이 큰길로 내려가면 `broad`, Tmap이 준 기본 경로는 `recommended`, 계단 문구가 남은 계단 회피 응답은 어느 이름도 참이 아니라 부재). 브리핑 응답은 byte-identical이다(CLI·채팅·MCP·옛 앱 무변경 — `attachStepActions`의 내부 필드 게이트와 같은 규율).

## 2. 서버 계약 (`/api/route/walk`)

### 2.1 새 옵트인 `lines=1` (신규 클라이언트 전용)

응답 `{ lines: WalkRouteLine[] }`, `WalkRouteLine = { kind, route: WalkRouteBriefing }`. 배열 순서가 화면 순서이고 **첫 원소가 기본 펼침**이다.

- **ko**: `[shortest, accessible|broad]`. 두 조회(최단·계단 회피)를 병렬로 돌리고, 계단 회피가 없거나 계단 문구가 남았을 때만 `BROAD_FIRST`를 이어 부른다.
- **en(비-ko)**: `[recommended, shortest]` — 현행 2행(Tmap `0`+`10`) 그대로다. 카카오 안내문이 한국어 고정이라 en에는 카카오 축(계단 회피·큰길)이 없다(E16 축3). **그래서 ko와 en의 화면 구성이 갈린다**(ko는 최단이 위, en은 추천이 위). en 순서를 바꾸는 것은 이 판정의 범위 밖이다.
- **3-state**:
  - 첫 줄 조회가 throw하면(ko는 Tmap 폴백까지 실패) 전체 502. 첫 줄이 화면의 주 경로라 종전 `alternatives=1`의 "기본 실패는 502" 비대칭을 그대로 잇는다.
  - 둘째 줄의 throw는 흡수해 그 줄만 뺀다. 둘째 줄 조회(계단 회피 → 부재 시 큰길)에는 **총 10초 예산**을 둔다 — 두 호출이 이어져 클라이언트 15초 예산을 넘기면 이미 와 있던 첫 줄까지 잃는다.
  - 경로 없음(`null`)은 그 줄만 뺀다. 첫 줄이 없고 둘째 줄만 있으면 둘째 줄이 첫 원소(기본 펼침)가 된다. 둘 다 없으면 `lines: []` — 클라이언트는 이것을 "경로 없음"으로 읽는다. 단 **싣는 줄이 0개인데 둘째 줄이 실패였으면 502**다(한쪽이 실패인데 "경로 없음"이라 말하지 않는다 — 3-state).
- **조합표**(허용 밖은 400 — 옵트인을 조용히 무시하지 않는다): `lines`+`variant` 400 · `lines`+`alternatives` 400 · `lines`+`includeGeometry` 400(조회 화면은 기하가 불필요, 기하는 안내 시작의 단일 조회로) · `lines`+`accessible=true` 400(계단 회피 축은 둘째 줄 안에 있다). `lines`+`via`·`lang`은 허용.
- **캐시·좌표**: 카카오 URL에 `route_mode`가 들어가 모드별 캐시가 자연 분리된다. `BROAD_FIRST`는 파라미터를 보내지 않는다(미전송이 곧 그 값 — 기존 URL·캐시 키 그대로). 줄 목록은 세 모드 모두 원좌표(§1), 단일 조회는 `SHORTEST`·`BROAD_FIRST` 반올림·`ACCESSIBLE` 원좌표(기존 계약).
- **호출량**: 조회 1회당 카카오 도보 `SHORTEST` 1 + `ACCESSIBLE` 1 + (계단 회피 부재 시 약 25%) `BROAD_FIRST` 1 ≈ **2.25건**, 조회 화면의 Tmap 도보 0건(현행 카카오 1 + Tmap 1). 카카오 도보는 일 1,000건 무료 + 초과 건당 10원. dodo-planet은 카카오 도보를 쓰지 않으므로(자동차 `kakao-navi`만) 도보 호출량은 길동무 단독이다(코디네이터 확인 2026-09-23). 소비량은 통합 전 콘솔에서 확인한다. 레이트리밋은 요청 단위라 종전 그대로(60초 10회).

### 2.2 `variant=shortest`의 출처가 바뀐다 (옛 클라이언트까지 이득)

- ko: 카카오 `route_mode=SHORTEST`, 카카오 throw 시 Tmap `searchOption=10` 폴백. 경로 없음(`null`)은 폴백하지 않는다(가용성 장치이지 커버리지 보강이 아니다 — 기본 경로와 같은 규칙).
- en: Tmap `10` 단독(현행).
- `accessible=true`와 함께 오면 종전처럼 `stepFree: "unavailable"` + "최단 경로에는 계단 회피가 적용되지 않습니다…" 문장을 싣는다(옛 앱의 토글 켬 상태 안전 문장. 새 클라이언트는 이 조합을 보내지 않는다).
- 키 게이트: ko는 카카오 또는 Tmap 키, en은 Tmap 키. 둘 다 없으면 throw(502) — `null`은 "경로 없음"의 뜻이라 "축 없음"을 위장하지 않는다(종전 계약).
- 카카오 경유라 **최단 경로도 횡단보도 차로 수·도로 폭 주석(`annotateCrosswalkInfo`)을 얻는다**(종전 Tmap 최단은 못 얻었다).

### 2.3 `alternatives=1`은 모양을 그대로 둔다 (옛 앱 호환)

배포된 iOS(1.x)와 안드로이드는 `alternatives=1`로 `{ result, shortest }`를 받아 "추천 경로/최단 경로" 두 줄을 그린다. **웹 배포가 앱보다 먼저**이므로 이 봉투를 바꾸면 옛 앱이 깨진다. 그래서:

- 봉투 모양·필드 의미 불변: `result` = 기본 파이프라인(카카오 `BROAD_FIRST`, `accessible=true`면 계단 회피 파이프라인), `shortest` = §2.2의 최단.
- 바뀌는 것은 `shortest`의 출처뿐이다(ko 카카오 `SHORTEST`). 조사 §4의 "최단이라 이름 붙은 줄이 더 길다"(서대문 연희 +39%)가 옛 앱에서도 구조적으로 사라진다(`SHORTEST` ≤ `BROAD_FIRST`, 같은 provider).
- `shortest` 생략 조건: 최단 축이 성립하지 않는 키 상태(§2.2 게이트)면 필드 부재(종전 "Tmap 키 없음"의 일반화).

### 2.4 안내 요청은 기존 파라미터 그대로

안내 시작·재조회·수동 전환은 §1 표의 "안내 시작 요청"으로 `includeGeometry=1` 단일 조회를 한다. 새 파라미터가 없다.

- `accessible` 세션의 재조회에서 계단 회피 경로가 사라지면 기존 파이프라인이 `BROAD_FIRST`로 내려가 `stepFreeNotice`를 싣고, 클라이언트가 그 문장을 1회 통지한다(spec 2026-08-08 §2.3). 걷는 중에 성질이 바뀐 것은 새 정보라 말한다 — 조회 화면 줄에서 지운 문장과는 층이 다르다.
- `broad` 세션은 기본 파이프라인(카카오 `BROAD_FIRST`, 카카오 실패 시 Tmap `0` 폴백)을 탄다. 폴백 경로의 이름 불일치는 종전 가용성 폴백과 같은 수용이다.

### 2.5 서버가 모르는 것

- 채팅(`get_walk_route` 계열)·CLI·MCP의 기본 조회는 파라미터 없음 = 카카오 `BROAD_FIRST` 그대로다. 채팅의 기본 경로를 최단으로 바꿀지는 이번 범위 밖(BACKLOG로 이월, 채팅 라우터 소유가 다른 세션이다).

## 3. 웹

- **조회**: 도보는 `lines=1` 하나(종전 `alternatives=1`). 결과 모델은 `{ kind:"done", mode:"walk", lines }`(비어 있으면 `empty`).
- **화면**: 줄마다 disclosure 버튼 한 개. 라벨 `joinText(이름, 요약)` = "최단 경로, 총 850m, 약 12분". 첫 줄의 기본 펼침은 종전 장거리 접힘 문턱(`shouldCollapseWalk`)을 따르고 둘째 줄은 접힘. 줄이 하나여도 같은 모양이다(이름이 성질을 말하므로 대비 상대가 없어도 정보다 — 종전 "추천"은 대비될 때만 정보라 단일 화면을 달리 그렸다).
- **안내 시작 버튼은 줄 안으로**(B9 ② 흡수): 펼친 본문 맨 위에 `DistanceBeacon`(`startOnOpen`), 라벨 `{이름}로 안내 시작`. 섹션 상단의 "도보 안내 시작" 버튼과 계단 회피 토글은 없앤다. 세션이 살아 있는 줄은 강제 펼침(`DistanceBeacon.onActiveChange` — 접힘 언마운트가 세션을 죽이는 경로 차단, 대중교통 `activeGuideAlt` 동형).
  - B9 ②는 병렬 계획 §1이 "이번 웨이브 밖"으로 적었지만 이 세션의 착수 지시와 BACKLOG E42 본문이 흡수를 명시한다. 그래서 웹 도보 안내의 기본 진입이 `variant=shortest`가 된다(기술 위험은 낮다 — 카카오 `SHORTEST` 기하는 기본 경로와 같은 파이프라인이다). 웹 실시간 안내의 실보행 미검증은 그대로 남아 FIELD-TEST 행으로 둔다.
  - 장거리(30분 초과) 첫 줄은 접힌 채 시작하므로 안내 시작 버튼도 접힘 안에 있다 — 종전 웹 주석("접힘 안에 넣으면 도달 불가")을 뒤집는 **의도된 변경**이다(iOS M3와 같다. 버튼이 줄에 귀속되는 대가로 장거리에서만 펼침 1동작이 는다).
  - 다른 줄의 안내 시작은 웹 claim 규칙대로 기존 세션을 끝내고 새 세션을 시작한다(대중교통 대안 버튼과 같다. iOS의 거부 게이트와의 비대칭은 기존 계약).
- **`useRouteGuide`·`DistanceBeacon`**: 훅의 셋째 인자를 `walkAxis: { accessible: boolean; variant: "shortest" | null }`로 바꾸고 `DistanceBeacon`에 `variant` 필수 prop을 더한다(기본값 없음 — A13 "최단 경로가 추천 경로로 조용히 바뀐다" 계열). 소비자는 길찾기 도보 줄·자동차(`null`)·대중교통 승차 전 도보와 인계(`TransitGuidePanel` 두 곳, `null`). `walkRouteUrl`에 `variant`를 필수 인자로 더한다. 웹에는 안내 중 전환이 없어 세션 이름은 쓰지 않는다.
- **계단 회피 토글 삭제의 소비자**(소비자 기준으로 자른다): URL 복원값 `?walkAccessible=1`, 조회 요청의 `avoidStairs`, 대중교통 안내의 `walkAccessible`(승차 전 도보)을 함께 걷는다. 대중교통 승차 전 도보는 `accessible=false`로 고정된다 — 토글이 없어진 뒤 그 값의 출처가 없다(§8 미결 1).
- en: 같은 컴포넌트가 `lines`(추천·최단)를 그대로 그린다. 안내 시작 버튼도 줄 안으로 들어가는 것은 같다.

## 4. iOS

- Kit: `WalkLineKind`(raw `shortest`·`accessible`·`broad`·`recommended`, 투영 `variant`·`accessible`)·`WalkRouteLine`(`kind`는 원시 문자열로 디코딩, 판독은 `lineKind` — 서버가 다섯째 종류를 더해도 디코딩이 죽지 않는다. 모르는 종류의 줄은 화면에서 뺀다)·`RouteService.walkLines(…)`. 모델은 기존 `RouteModels.swift`에 둔다(새 Kit 파일 없음 → 안드로이드 등록부 불변).
- 길찾기 도보 섹션: 줄마다 `DisclosureGroup`, 라벨·버튼 문구는 웹과 같다. 토글·재조회 경로(`toggleStepFree`·`refetchWalk`) 삭제. 대중교통 안내 시작의 `accessible:`는 `false`.
- 실시간 안내: `StartRequest`의 `shortestAvailable: Bool`을 `line: WalkLineKind?`(이 세션의 줄)·`alternate: WalkLineKind?`(조회 화면의 다른 줄)로 바꾼다(기본값 없음, `toggle`의 `variant` 기본값 인자도 삭제). 수동 전환·대안 프리뷰의 대상은 `alternate`이고, `fetchDetailData`는 요청 축(경로 축·계단 회피)을 **인자로** 받는다(세션 필드를 읽으면 프리뷰가 다른 축을 조회한다). 전환 커밋에서 요청 축과 두 줄 종류를 한 원자 블록에서 맞바꾸고 복구 재시작 인자(`lastStartRequest`)도 동기화한다. 줄이 없는 세션(승차 전 도보·인계·간략 폴백)은 둘 다 `nil`이라 전환 진입점이 없다(종전 `shortestAvailable=false`와 같은 결과).
- 프리뷰 헤더·전환 통지 문장의 이름은 **응답 `kind`가 우선**이고 없으면 요청한 줄 이름이다(계단 회피를 요청했는데 큰길이 오면 "큰길 경로로 전환", 이름을 못 주는 응답이면 요청 이름 + 기존 경고 문장). 전환 통지는 `guide.switchedTo{Shortest,Recommended}`에 `Accessible`·`Broad` 두 키를 더한다(확정된 줄 이름을 기존 틀에 대입한 파생 — 6로케일).
- 안내 시작 버튼 포커스 정체성은 `GuideStartButton.walkLine(kind)`다(배열 인덱스 금지). 시트가 닫힌 뒤 착지는 kind로 줄을 찾아 강제 펼치고, 그 줄이 새 조회에서 사라졌으면 첫 줄 버튼으로 폴백한다.
- 빌드 구성: 조회 화면은 Release·Experimental 모두. 실시간 안내 도보는 정식 졸업 상태라 게이트 변화 없음.

## 5. WebMCP·CLI

- `plan_directions`: 입력 `avoidStairs` 삭제(토글이 없다). 출력 `walk`는 `lines: [{ kind, label, distanceMeters, durationSeconds, stepCount }]`(`label`은 화면 줄 버튼 문장, `read_current_view`의 도보 요약도 첫 줄 `label`)로 바뀌고 `stepFree`·`stepFreeNotice`·`shortest`는 사라진다. `resolved.avoidStairs`·`read_current_view.fields.avoidStairs`도 삭제.
- `get_route_steps`: 파라미터 이름 `variant`는 유지하고 값을 줄 종류(`shortest`·`accessible`·`broad`·`recommended`)로 바꾼다(이름까지 바꾸면 옛 호출이 스키마 위반이 된다). 생략 시 첫 줄. 계획에 없는 종류는 `unsupported{detail:"noLine"}`.
- CLI·MCP 카탈로그 `route-walk`: `variant` 파라미터를 싣는다("shortest면 최단 경로 — ko 카카오·폴백 Tmap, en Tmap"). `lines`는 싣지 않는다(봉투가 `result`가 아니라 CLI 포매터 계약 밖이고, 조회 화면 전용이다). `accessible` 설명은 유지. 두 미러 바이트 동일. npm 릴리스는 이 마일스톤에서 하지 않는다.

## 6. 문구 (6로케일)

- 새 키: `directions.walkAccessible`(계단 회피 경로) · `directions.walkBroad`(큰길 경로) · `beacon.guideStartWalk{Shortest,Accessible,Broad,Recommended}`(○○ 경로로 안내 시작 — 웹·iOS 공용, 종전 iOS 전용 `beacon.guideStartWalkShortest`는 messages로 옮겼다) · iOS `guide.switchedToAccessible`·`guide.switchedToBroad`.
- 기존 `directions.walkShortest`·`directions.walkRecommended`는 유지(안드로이드·en이 쓴다). `route.pedestrian.stepFreeToggle`은 안드로이드가 아직 쓰므로 유지한다(웹·iOS에서 참조 0). iOS 전용 `ios.directions.walkShortest`·`ios.directions.walkRecommended`는 지웠다(iOS도 messages `directions.*`를 쓴다).
- 비-ko 문구는 ko 뜻을 따른다.

## 7. 검증

- **실호출 게이트(호출 수십 건 이내)**: ① ko `lines=1` 주거지 구간 — 두 줄 모두 카카오 문장이고 횡단보도 스텝에 ", N차로, 도로 폭 Mm"가 실리는가 ② 역이 목적지인 구간에서 계단 회피 부재 → `broad`로 가는가(부재 비율은 조사 실측 4/15라 몇 곳을 골라 확인) ③ `variant=shortest&includeGeometry=1` 기하 연속·`finalApproach`·`kind` ④ en `lines=1`이 추천·최단 두 줄 ⑤ 금지 조합 400 ⑥ `lines=1&via=`(세 모드 경유지 legs 2) ⑦ **표본 전체에서 `최단 ≤ 둘째 줄` 거리 단언** — 위반이 나오면 그 사실과 정책을 이 절에 적는다.
- **하위 호환 테스트**: `alternatives=1` 응답 모양 불변(옛 Kit 디코더 형태 fixture).
- **게이트 테스트**: 줄 판정(계단 문구 잔존 → broad, 둘째 줄 throw 흡수, 첫 줄 throw 502, 첫 줄 null → 둘째 줄 승격), 스키마 조합표, 웹 줄 렌더(라벨·버튼 문구·강제 펼침), `walkRouteUrl` variant.
- **실기기(iOS)**: 두 줄 낭독·펼침·안내 시작·안내 중 전환(최단 ⇄ 둘째 줄)·계단 회피 세션의 재조회 열화 통지.

## 8. 미결 (코디네이터 판정 요청)

1. **대중교통 승차 전 도보의 계단 회피가 사라진다.** 토글이 그 값의 유일한 출처였다(웹·iOS 모두 도보 섹션 토글 값을 대중교통 안내에 넘겼다). 강한 디폴트로 `false` 고정했다. 되살리려면 대중교통 쪽에 별도 판정이 필요하다.
2. **채팅·CLI의 기본 도보 경로**는 여전히 큰길(`BROAD_FIRST`)이다. 화면의 첫 줄(최단)과 맞출지.
3. **안드로이드**는 `alternatives=1`(추천·최단+토글) 그대로다. 최단의 출처만 카카오로 바뀐다. 같은 두 줄로의 이식은 E43 몫.

## 9. 설계 리뷰 게이트 판정

**실시한다** — ②새 외부 통합의 계약 가정(카카오 `route_mode` 두 값의 운용) + 서버 응답 계약 추가(옛 앱 호환이 걸린 봉투). `model: fable` 적대적 리뷰, 회전 2회 상한.

**구현 리뷰(opus, HEAD `853e3400`, BLOCKER 0·MAJOR 1·MINOR 9)·접근성 감사(opus, HIGH 0·MEDIUM 3·LOW 3)** 반영: 프리뷰 헤더가 이름을 못 받은 응답에 경고를 싣는다, 세션을 잃은 웹 패널의 "안내 시작"은 다시 시작한다(종전엔 접기만), `alternatives=1` provider 혼합 금지를 양방향으로, iOS 배선 소스 가드(`walk-line-ios-guard.test.ts`), 10초 예산 테스트, 거짓 이름 폴백 제거, 비-ko 문구(en "Route avoiding stairs", ja 「階段を避けるルート」, es·fr·it 큰길 버튼에 줄 이름). 넘긴 판정: 안내 중 전환이 큰길로 내려갈 때 경고 문장을 남길지(§2.4 현행 유지), 이름을 못 받은 응답의 이름.

**설계 리뷰 1회 실시(2026-09-23, HEAD `3af8ffe5`, BLOCKER 0·MAJOR 3·MINOR 11).** 수용: MAJOR 1(세션 이름을 응답 `kind`로, 프리뷰 축 인자화) · MAJOR 2(provider 혼합 금지·줄 목록 원좌표·거리 단언 게이트) · 둘째 줄 예산·0줄+실패 502·경유지 게이트·`walkLine(kind)` 착지·`toggle` 기본값 삭제·웹 다른 줄 버튼 동작 명시·장거리 접힘 안 버튼 의도 표기·옛 앱 `shortest` 값 불변식 테스트·WebMCP `variant` 이름 유지·CLI CHANGELOG·문서 분배 자리. MAJOR 3(B9 ② 흡수)은 착수 지시가 명시한 범위라 흡수로 판정하고 §3에 기록. `accessibleRef` 갱신 effect는 유지한다(줄마다 `key` 재마운트라 실질 불변이지만, 삭제는 이 마일스톤의 요구가 아니다). 회전 2는 불필요로 판정 — 수용분이 새 판정 계층이 아니라 기존 계약(provider 게이트·내부 필드 게이트)의 재적용이다.
