# E71: 타고 있는 열차에서 여정을 시작한다 — 설계

- 상태: 설계(2026-10-27, 세션 e71-riding-start). 판정 요청 `~/gildongmu-wt/e71-riding-start-reports/judgment-202610272205.md`(⓪~④, 기본값으로 진행).
- 판정 정본: `docs/BACKLOG.md` E71, 코디네이터 판정(계획 `docs/superpowers/plans/2026-10-27-backlog-sweep-14-parallel-plan.md` §1 판정 7). E70 첫 판의 판정(spec `2026-10-17-e70-mode-change-journey-design.md` D1~D14, 판정 1~32)과 E70-e(`2026-10-27-e70e-bus-stop-transfer-design.md`)는 재논의하지 않고 그 위에 얹는다.
- 범위: **iOS 실험판 전용**(E70과 같은 봉인 `AppConfig.experimentalJourneyEnabled`), **첫 판은 지하철 중 서울 실시간 도착이 닿는 노선만**. 서버는 기존 `/api/route/journey`에 옵트인 파라미터만 더하고 미지정 응답은 바이트 동일.
- **설계 리뷰 판정: 해당.** 새 외부 계약 가정(서울 지하철 실시간 `updnLine`·`trainLineNm` ↔ ODsay `wayCode` 방향 조인)과 안내 세션의 새 시작 경로(대중교통 세션이 대기 국면의 "이미 탔어요" 둘째 단계로 열린다)를 담는다. codex 적대적 설계 리뷰 결과는 §11.

## 0. 한 문단 요약

열차 안의 사용자가 길찾기 화면에서 출발지를 「지금 탄 열차」로 바꾸고, 지금 서 있거나 다음에 설 역(노선 포함)과 방면을 고른 뒤 조회한다. 서버는 그 역 좌표에서 대중교통 후보를 찾되 **그 역에서 그 노선·그 방향으로 타는 경로만** 받는다(반대 방향이면 그 사실을 말한다). 안내를 시작하면 대중교통 세션이 대기 국면에서 열리면서 **세션 안 [이미 탔어요](A34)의 둘째 단계 「타고 계신 차량을 선택하세요」로 바로 들어간다**. 열차를 고르면 `boardAboard` 식별 잠금 riding, 「열차 정보 없이 계속」이면 비관측 근사 잠금 riding(폴 0)이다. 급행·종착 차단과 「급행인가요?」는 A34·A16 그대로다. 역 B(자동차를 탈 역)를 정했으면 하차 뒤 E70의 출구 도보·자동차 구간이 이어진다.

## 1. 의도와 목표

**왜**(BACKLOG E70 피드백 2026-10-10 12:04): 급행을 탄 채 "내려서 택시" 부분만 안내받으려 다음 역 출발로 대중교통 안내를 시작했더니, 앱이 "그 역에서 새로 출발하는 사람"으로 보고 다른 경로를 잡았다. 세션 안의 [이미 탔어요]는 이미 도는 세션에서 탄 열차를 바꾸는 수단이고, 세션 밖(열차 안)에서 새로 시작할 길이 없다.

**목표**
1. 열차 안에서 "지금 이 열차를 타고 목적지까지"를 한 번의 조회로 얻고, 안내가 탑승 대기가 아니라 승차 중으로 이어진다.
2. 그 열차로 갈 수 없는 경로(다른 노선에서 타는 경로, 반대 방향)를 대신 내보내지 않는다(E70 판정 7의 "지정 역을 말없이 바꾸지 않는다"와 같은 불변식).
3. 새 판정 규칙을 만들지 않는다: 열차 식별·급행·종착·비관측 잠금·복구 수단은 A34·A16·A36 그대로다.

**비목표**: 버스(E70-e 뒤 별도), 실시간 도착이 없는 지하철·철도, 급행에 맞는 경로 찾기(판정 ④ 나), 최근 경로 저장, 웹 UI·안드로이드·en.

**반목표(동작해도 실패인 것)**
- 사용자의 열차와 다른 노선이나 반대 방향으로 타는 경로로 안내가 시작되는 것.
- 승차 중인 사람에게 "{역}에서 {노선} 탑승"을 기다리라고 하거나 승차 정류소 도착 관측(boarding)을 기다리는 것.
- 기존 여정·대중교통 안내·`/api/route/journey` 미지정 응답이 바뀌는 것.

## 2. 사실 (설계를 묶는 코드·데이터)

1. **세션 안 [이미 탔어요](A34 ②, `TransitGuideModel.beginAboard` → `pickAboardStation(at:)` → `boardAboard(item:)`)**: 대기 국면에서 역(`viaStops` 인덱스)을 고르면 그 역의 도착 목록을 폴하고(`boardOverrideIndex`), `transitAboardCandidates`(도착 코드 0~5)와 `classifyTransitBoardingCandidates`(경로 leg 방향 `wayCode` 대조·종착·급행 차단)를 거친 열차를 보인다. 고르면 `TransitGuideInput.boardAboard(lock)` → `enterRiding(.declared)`. 「열차 정보 없이 계속」은 급행 노선이면 「급행인가요?」(`transitNeedsExpressPrompt`) 뒤 `boardAlready(express:)` → `.board(근사 잠금)` → riding(비관측, `transitPollIntervalMs` 0). 「다른 역 선택」(`pickAnotherAboardStation`)이 있다.
2. **방향 조인은 실호출로 확정돼 있다**: `directionMatchesWayCode(updnLine, wayCode)`(Kit `TransitGuide.swift`·웹 `transit-guide.ts`, 2026-08-16 실호출 — 상행·외선 = 1, 하행·내선 = 2, 그 밖은 nil). 서버 `TransitLeg.serviceWayCode`가 지하철 leg에 ODsay `wayCode`를 싣는다(`odsay.ts`).
3. **서울 지하철 실시간 도착**(`/api/station/subway-arrival?station=`, Kit `StationService`)은 열차마다 `line`(「1호선」)·`direction`(`updnLine` 원문)·`trainLineNm`(「인천행 - 구로방면」)·`destination`(종착)을 준다. 미커버 역은 `INFO-200` → 응답 null, 조회 실패는 502.
4. **여정 서버**(`getJourney`): 역 A 지정이면 ODsay 출발점이 A 좌표이고(`origin = req.board?.coord ?? req.from`), 지정 역 판정은 선정 전 전체 후보 + 지하철만 후보 위에서 `findDesignated`가 한다. 택시 앞 구간은 A 지정일 때 Tmap을 부른다.
5. **여정 안내**: `JourneyShape.startsWithTaxi == false`면 첫 단계가 `transit`이고 `GuideSession.startJourneyStage(.transit)`가 `beginTransit`을 부른다. 승차 전 도보는 `transitPrewalkTarget`이 서는 경로에서만 생기며, 승차 쪽을 자른(D3) 경로엔 서지 않는다.
6. **대중교통 시트 첫 착지**는 `.task { landControlFocus(.status, …) }`(E38), 착지 허용 집합에 `.waitingLabel`(A34 pickVehicle 질문)이 이미 있다(`transit-landing-guard.test.ts`). E75 뒤 제목 행 `GuideTitleActionsRow`에는 착지 바인딩이 없다(인계).

## 3. 판정 기록

### 3.1 판정 요청(기본값으로 진행, `judgment-202610272205.md`)

| # | 질문 | 기본값 |
|---|---|---|
| ⓪ | 입구 자리 | **출발지 검색 시트의 「현재 위치 사용」 바로 다음 행 「지금 탄 열차에서 출발」**. 평소 길찾기 화면 읽기 순서는 그대로다(계획 판정 7의 "출발지 칸 메뉴"는 출발지 칸이 버튼이라 그 칸이 여는 시트의 행으로 옮겼다. 항목 하나뿐인 메뉴는 만들지 않는다 — E70 §5.1). |
| ① | 단계 순서·문장, 열차를 고르는 곳 | **역 먼저**(검색 결과가 노선별 장소라 노선이 함께 정해진다) → 노선(장소에 노선이 없을 때만) → 방면. **열차 고르기는 안내 시작 직후 안내 화면**(A34 둘째 단계). |
| ② | 잘못 골랐을 때 | 기존 [다른 역 선택]·[열차 정보 없이 계속]·[탑승 변경]·[안내 종료] 재사용, 새 버튼 없음. |
| ③ | 출발 좌표·서버 표현 | 고른 역 좌표. 서버는 `boardKind=aboard` + `boardDir`(옵트인). 그 역·노선·방향으로 타는 경로만 받고 대체 경로 없음, 반대 방향이면 그 사실 문장. |
| ④ | 급행 확인 | A34·A16 그대로(안내 화면). 급행에 맞는 경로 찾기는 다음 판(BACKLOG 편승). |

### 3.2 설계 결정 (이 spec이 정한 것)

| # | 결정 | 근거 |
|---|---|---|
| R1 | **Kit 대중교통 상태 머신(`TransitGuide.swift` 전이)과 웹·`:kit` 미러, 공유 fixture를 바꾸지 않는다.** 시작은 `initTransitGuide`(waiting) + 앱 모델이 A34 둘째 단계를 세우는 것이고, riding 진입은 기존 입력 `boardAboard`·`board(근사)`뿐이다. E71이 기대는 전이는 공유 fixture `transit-guide-scenarios.json`의 기존 시나리오가 세 벌에서 이미 잠근다(「이미 탑승 식별 잠금(A34 ②): waiting → boardAboard → riding(declared)」, 「비관측 잠금(지하철 이미 탑승, A34 ①)」, 「이미 탑승 식별 잠금 가드」) | 미관측을 탑승으로 추론하지 않는다는 N3 원칙과 A34 판정(사용자가 고른 열차만 식별 잠금)을 그대로 지킨다. 새 시작 상태(`initTransitGuideRiding` 류)를 만들면 열차를 누가 정하는가를 다시 판정해야 하고, 그 판정은 A34가 이미 했다. 이미 잠긴 전이에 시나리오를 덧대지 않는다 |
| R2 | 방면은 **그 역의 실시간 도착 목록**에서 만든다(Kit 순수 함수 `journeyAboardDirections`): 노선이 같은 도착 항목을 `updnLine`으로 묶고, 묶음마다 이름은 `trainLineNm`의 「 - 」 뒤 조각(「구로방면」), 없으면 `updnLine` 원문, 종착 이름(중복 제거, 처음 본 순서)을 붙인다. `updnLine`이 빈 항목은 버린다 | 사용자는 열차 안에서 종착(「인천행」)이나 다음 역 방면을 듣는다. 방향 키 `updnLine`은 서버 방향 판정(R4)과 같은 축이다 |
| R3 | 방면 목록의 3-state: 불러오는 중 / 0묶음(「지금 이 역에 오는 열차가 조회되지 않습니다.」) / 미커버(null, 「이 역은 실시간 열차 정보가 없어 지금 탄 열차에서 출발할 수 없습니다.」) / 조회 실패(「열차 정보를 불러오지 못했습니다.」 + [다시 시도]). 미커버·0묶음이면 조회 버튼은 지금 탄 열차 출발을 조회하지 않는다 | 3-state 불변식. 실시간이 없는 역은 안내 화면의 열차 식별도 성립하지 않는다 |
| R4 | 서버 지정 판정의 aboard 술어 = 첫 탈것이 지하철 ∧ 기존 같은 역 판정(`isSameStation`: 이름 키 · 500m · 노선 힌트 — aboard는 노선 힌트가 필수라 노선 비교가 언제나 걸린다) ∧ `directionMatchesWayCode(boardDir, leg.serviceWayCode) === true`. `null`(모르는 표기·`wayCode` 없음)은 불일치 | 반대 방향 안내가 경로 없음보다 나쁘다(오필터가 과노출보다 나쁘다는 기존 대응표 원칙의 반대 방향 적용: 여기선 틀린 경로가 곧 사고) |
| R5 | aboard면 **추천 경로(`selectTransitRoutes` 1순위)를 변형으로 내지 않는다.** 역 B도 정했고 둘 다 맞는 경로가 없으면 aboard만 맞는 경로를 `kind: "recommended"` + `designatedMissing.side: "alight"`로 낸다(E70 판정 14 문장 「{B}역에서 내리는 경로를 찾지 못했습니다.」 그대로 — 여전히 그 열차를 탄다). aboard가 안 맞으면 `variants: []` + `designatedMissing: { side: "board", oppositeDirection?: true }`(같은 역·노선 후보가 방향만 다를 때) | 사용자는 이미 열차 안이다. 다른 곳에서 타는 경로는 쓸 수 없다 |
| R6 | aboard면 택시 앞 구간이 없다(Tmap 0회), 승차 쪽 도보는 자른다(D3 `trimBoard`) | 출발이 열차 안이다 |
| R7 | 조회 출발 좌표는 고른 역 좌표(`origin`도 같은 값을 보낸다) | 지하·열차 안 GPS는 부정확하다. `origin`은 aboard에서 택시 앞 구간이 없어 쓰이지 않는다 |
| R8 | 안내 시작: `JourneyPlan.aboard`가 참이면 `startJourneyStage(.transit)` → `beginTransit(…, aboard: plan.aboard)` → `TransitGuideModel.start(…, aboard:)`(`TransitAboardStart?` = 고른 방향 `updnLine` 원문, nil = 종전 대기 시작). 모델은 세션 초기화 뒤 첫 leg가 지하철 추적 가능(`trackMode == .subway`, `viaStops` 비어 있지 않음)이면 `aboardStep = .pickVehicle`·`boardOverrideIndex = 0`으로 둘째 단계를 세우고 즉폴한다. 시작 통지는 목적지 문장(E40 `transitGuide.startedAt`)만이고 대기 문맥(「{역}에서 {노선} 탑승.」)을 내지 않는다. 추적 불가 leg면 종전 대기 시작 + [이미 탔어요](방어, R3 때문에 도달하지 않는다) | A34 둘째 단계와 같은 화면·같은 판정. 대기 문맥은 승차 중인 사람에게 거짓이다 |
| R9 | 시트 첫 착지는 aboard 시작이면 `.waitingLabel`(「타고 계신 차량을 선택하세요」), 아니면 종전 `.status` | 첫 행동이 열차 고르기다. 착지 허용 집합에 이미 있는 대상이라 가드 변경이 작다(E75 인계: 제목 행에는 착지 바인딩이 없고 기본은 상태 문장 — aboard 시작만 질문 라벨) |
| R14 | **aboard 시작의 열차 목록은 고른 방향에 잠긴다**(설계 리뷰 high). 모델은 그 세션 동안 도착 항목 중 `direction`이 고른 `updnLine`과 같은 것만 후보 분류(`classifyTransitBoardingCandidates`)에 넘긴다(분류의 "방향 일치 0이면 전체 복원"이 같은 방향 안에서만 일어나게). `boardAboard(item:)`도 같은 조건을 다시 확인하고 다르면 무시한다. 맞는 열차가 없으면 목록은 비고 「열차 정보 없이 계속」(급행 노선이면 「급행인가요?」)이 남는다 — 반대 방향을 되살리지 않는다. 판정은 Kit 순수 함수 `journeyAboardTrainItems(items:direction:)` 하나(`Journey.swift`) | 사용자가 방면을 이미 밝혔고 서버가 그 방향 경로만 냈다. 조회와 시작 사이에 열차가 바뀌어도 반대 방향 열차로 riding 식별 잠금이 서면 하차 안내가 엉뚱한 역을 센다. 기존 A34(방면을 밝히지 않은 세션 안 흐름)의 복원 동작은 그대로 둔다 |
| R10 | `aboard` 인자는 기본값 없이 `beginTransit`·`TransitGuideModel.start`에 더하고 기존 호출 자리는 `false`를 명시한다 | 안전 인자 기본값 금지 규율 |
| R11 | 지금 탄 열차 출발 여정은 최근 경로에 저장하지 않는다 | 열차 위치는 그때뿐이다 |
| R12 | 출발지가 지금 탄 열차면 「바꾸기」·경유지·「자동차에서 내리는 역 추가」를 숨기고 「자동차를 탈 역 추가」 일반 버튼만 둔다. 출발지 칸을 다시 눌러 다른 출발지를 고르면 지금 탄 열차는 사라진다 | 경유지·역 A는 열차 출발과 배타(D14와 같은 이유) |
| R13 | 결과 합계 줄은 aboard면 대중교통 요금을 말하지 않는다: 「총 {minutes}분」, 택시 구간이 있으면 「총 {minutes}분, 택시 요금 약 {taxiFare}원」 | 이미 낸 요금이다. 서버 `totals`는 바꾸지 않는다 |

## 4. 서버: `/api/route/journey` aboard 옵트인

### 4.1 요청

- `boardKind=aboard`(새 값) + `boardDir` ∈ {`상행`, `하행`, `내선`, `외선`}. `board`·`boardName`·`boardLine`이 함께 와야 한다(aboard만 `boardLine` 필수 — 없으면 `isSameStation`이 노선 비교를 건너뛰어 환승역의 다른 노선이 통과한다). `boardDir`은 `boardKind=aboard`일 때만 받고 그때는 필수(400). `stops=1`을 요구하지 않는다(종전 refine은 `boardKind=stop`에만 건다).
- 타입: `JourneyStationInput.kind?: "stop" | "aboard"`, `direction?: "상행" | "하행" | "내선" | "외선"`(aboard에서만). Kit `JourneyStationQuery.kind`에 `.aboard`, `direction` 필드.
- 미지정 요청은 종전과 바이트 동일(파이프라인 분기가 `kind === "aboard"`에서만 갈린다).

### 4.2 파이프라인 차이 (aboard일 때만)

1. 후보: 종전 그대로(① 전체, 지정 없으면 ② 지하철만). 출발점 = 역 좌표.
2. 지정 판정: `sideMatch(route, "board", input)`가 `kind === "aboard"`면 R4 술어(강 맞음만, 약 맞음 없음).
3. 추천 없음(R5): `designated`가 있으면 그 하나만(`kind: "designated"`). 없고 역 B가 지정이면 `findDesignated(pools, { board: aboard })`를 `kind: "recommended"` + `designatedMissing.side: "alight"`. 그것도 없으면 `variants: []` + `designatedMissing: { side: "board", oppositeDirection? }`.
4. `oppositeDirection: true` = 풀 어딘가에 첫 탈것이 같은 역(이름·500m·노선) 지하철 leg이고 `directionMatchesWayCode(boardDir, wayCode) === false`인 후보가 있고, 방향이 맞는 후보는 없다(= R4 실패의 원인이 방향일 때만).
5. 택시 앞 구간 없음(R6), Tmap 예약 비용에 앞 구간을 넣지 않는다. 출구·택시 뒤 구간은 역 B 지정일 때 종전 그대로.
6. `directionMatchesWayCode`는 `src/lib/transit-guide.ts`에서 export해 재사용한다(새 사본 금지 — 웹·Kit 미러 한 쌍 유지).

### 4.3 응답

종전 `JourneyResult` 그대로 + `designatedMissing.oppositeDirection?: true`(aboard에서만, additive). aboard 변형엔 `taxiIn`이 없다. 출발·도착 사이 대중교통 후보 자체가 0건이면 종전처럼 `{ variants: [] }`만 낸다(앱은 둘 다 「지금 탄 열차로 가는 경로를 찾지 못했습니다.」).

### 4.4 레이트 리밋

aboard는 Tmap을 부르지 않아(역 B 없음) 종전 IP 버킷(Tmap 예약 비용으로 찬다)이 요청을 세지 못한다. 그래서 aboard 요청은 경로 조회 전에 IP 버킷에 1칸을 기록한다(`chargeJourneyIp`, Tmap 일 상한은 그대로). ODsay는 호출 수가 곧 비용이라 aboard도 종전과 같은 IP당 상한 아래에 둔다.

## 5. iOS 길찾기 화면

### 5.1 입력

- 출발지 검색 시트(`DirectionsEndpointSearchView`, 대상 `.from`)의 「현재 위치 사용」 다음 행 「지금 탄 열차에서 출발」(`ios.journey.aboardStart`). 봉인: `experimentalJourneyEnabled` ∧ 데이터 로케일 ko(역 칸과 같은 조건).
- 누르면 **같은 시트가 aboard 모드로 바뀐다**(시트를 닫았다 다시 띄우지 않는다 — 그 사이 커서가 화면 최상단으로 떨어진다). 역 칸 검색과 같은 화면이되 **지하철역만** 받는다(`stationLayoutKind == .subway`, 정류장 검색 없음, 최근 목록·「현재 위치 사용」 없음). 제목·검색 필드 이름 「지금 서 있거나 다음에 설 역」(`ios.journey.aboardStationField`), 커서는 검색 필드로. 지하철역이 아니면 기존 통지 「역이나 정류장을 골라 주세요.」(`ios.journey.notStation`).
- 역이 정해지면 시트가 닫히고 출발지 칸이 「출발지, 지금 탄 열차, {역 장소 이름}」이 되며 그 아래에 방면 단계가 선다. 커서는 방면 질문 줄로 간다(질문이 다음 행동이다).
  - 노선: 장소 노선 힌트(카테고리 끝 조각 또는 이름 꼬리 — 역 칸과 같은 추출)가 있으면 그 노선. 없으면 도착 목록의 서로 다른 `line`이 하나면 그것, 둘 이상이면 질문 「어느 노선인가요?」(`ios.journey.aboardLinePrompt`) + 노선 버튼들.
  - 방면: 질문 「어느 방면 열차인가요?」(`ios.journey.aboardDirectionPrompt`) + 묶음마다 버튼 한 줄 「{방면}, {종착1}행, {종착2}행」(`ios.journey.aboardDirectionRow` — 종착 조각은 `joinText`, 한 줄 = 한 객체). 3-state는 R3.
  - 고르면 질문·버튼이 사라지고 출발지 칸이 「출발지, 지금 탄 열차, {역 장소 이름}, {방면}」, 커서는 조회 버튼(사라지는 버튼의 포커스 선점, 헌장 §5).
- 출발지 칸을 다시 누르면 출발지 검색 시트가 열리고, 다른 출발지를 고르면 지금 탄 열차 상태를 지운다. 「지금 탄 열차에서 출발」을 다시 누르면 역부터 다시.
- R12 숨김. 역 B 칸(「자동차를 탈 역」)은 E70 그대로.
- 조회: 지금 탄 열차 출발이 방면까지 정해졌으면 여정 조회만 한다(D12 동형). 방면 전이면 조회 버튼은 방면 질문으로 커서를 옮기고 「어느 방면 열차인가요?」를 통지한다(`.high`, 화면 변화 없는 활성화 응답).

### 5.2 결과

E70 결과 표시를 그대로 쓰되:
- 변형은 언제나 하나라 heading이 없다. `designatedMissing.side == "alight"`면 맨 위 「{B}역에서 내리는 경로를 찾지 못했습니다.」(기존 키) 뒤 그 경로.
- `variants: []`면 「지금 탄 열차로 가는 경로를 찾지 못했습니다.」(`ios.journey.aboardMissing`), `oppositeDirection`이면 「지금 탄 열차는 목적지 반대 방향으로 갑니다.」(`ios.journey.aboardOpposite`). [안내 시작] 없음.
- 합계 줄 R13(`ios.journey.totalsAboard`·`ios.journey.totalsAboardTaxi`). 구간 줄은 종전 문장(실승차 판정 항목).

### 5.3 저장

R11: 최근 경로 저장 자리에서 aboard 조회를 건너뛴다(소스 가드로 잠근다).

## 6. iOS 안내

- `JourneyPlan`에 `aboard: Bool`(기본값 없음, 길찾기 탭이 결과를 만들 때 정한다). 모양(`JourneyShape`)은 바뀌지 않는다: `taxiIn`이 없으니 첫 단계는 `transit`.
- `startJourneyStage(.transit)`이 `beginTransit(route:…, aboard: plan.aboard)`를 부른다. `startTransit`은 `aboard: false`.
- `TransitGuideModel.start(…, aboard:)`·`beginSession(…, aboard:)` — R8. `startAfterPrewalk`는 `aboard: false`(승차 전 도보·환승 도보 뒤는 언제나 대기).
- 시트 첫 착지 R9: 시트가 처음 뜰 때 `model.aboardStep == .pickVehicle`이면 `.waitingLabel`.
- 열차 목록은 R14로 고른 방향에 잠긴다(세션 상태 `aboardDirection`, [다른 역 선택] 뒤에도 유지, `boardAboard`·확정 도착·안내 종료에서 해제).
- 그 뒤는 전부 기존: 열차 고르기 → `boardAboard` → riding(식별, 하차역 목록 폴, 사다리·도착), 「열차 정보 없이 계속」 → (급행 노선이면 「급행인가요?」) → riding(비관측, 폴 0, 수동 [다음 구간]), [다른 역 선택], 하차 뒤 여정 다음 단계(역 B 지정이면 `rideCompleted` → 출구 도보·자동차, 아니면 말미 도보 인계).
- 봉인: `startJourney`의 호출 자리는 종전 하나(길찾기 탭, 실험판 조건 안)이고 aboard는 그 안의 계획 값이다. 세션 시작 호출 전수(`guidance-gate-drift.test.ts`)는 바뀌지 않아야 한다 — 바뀌면 그 가드가 잡는다. `beginTransit`·`TransitGuideModel.start` 시그니처 변경에 맞춰 가드 문자열만 갱신한다.

## 7. 표시·낭독 계약

| 키(가칭) | ko 문장 | 자리 |
|---|---|---|
| `ios.journey.aboardStart` | 지금 탄 열차에서 출발 | 출발지 검색 시트 행 |
| `ios.journey.aboardStationField` | 지금 서 있거나 다음에 설 역 | 역 검색 시트 제목 |
| `ios.journey.aboardField` | 지금 탄 열차, {station} | 출발지 칸 값(방면 전) |
| `ios.journey.aboardFieldDirection` | 지금 탄 열차, {station}, {direction} | 출발지 칸 값(방면 뒤) |
| `ios.journey.aboardLinePrompt` | 어느 노선인가요? | 노선 질문 |
| `ios.journey.aboardDirectionPrompt` | 어느 방면 열차인가요? | 방면 질문·방면 전 조회 응답 |
| `ios.journey.aboardDirectionRow` | {direction}, {terminals} | 방면 버튼(종착 조각은 「{이름}행」을 `joinText`) |
| `ios.journey.aboardTerminal` | {name}행 | 종착 조각 |
| `ios.journey.aboardDirectionsLoading` | 열차 정보를 불러오는 중입니다. | 방면 3-state |
| `ios.journey.aboardDirectionsEmpty` | 지금 이 역에 오는 열차가 조회되지 않습니다. | 방면 3-state |
| `ios.journey.aboardDirectionsUnavailable` | 이 역은 실시간 열차 정보가 없어 지금 탄 열차에서 출발할 수 없습니다. | 방면 3-state |
| `ios.journey.aboardDirectionsFailed` | 열차 정보를 불러오지 못했습니다. | 방면 3-state(+ 기존 다시 시도 버튼 키) |
| `ios.journey.aboardMissing` | 지금 탄 열차로 가는 경로를 찾지 못했습니다. | 결과 |
| `ios.journey.aboardOpposite` | 지금 탄 열차는 목적지 반대 방향으로 갑니다. | 결과 |
| `ios.journey.totalsAboard` | 총 {minutes}분 | 합계 줄 |
| `ios.journey.totalsAboardTaxi` | 총 {minutes}분, 택시 요금 약 {taxiFare}원 | 합계 줄(역 B) |

- 첫 판 ko 한 벌(E70 관례 — 여정 문구는 ko, 다른 로케일은 같은 ko 값). 위치 인자 순서는 `ios/i18n/arg-order.json`이 잠근다.
- 「{역}역」이 아니라 장소 이름 그대로(「개봉역 1호선」)를 칸 값에 쓴다 — 노선이 함께 들려야 한다.
- 통지: 역 확정·방면 확정은 커서 이동이 답이다(칸 라벨 낭독, 별도 통지 없음). 방면 목록 도착은 통지하지 않는다(커서가 질문 줄에 있고 다음 스와이프가 목록이다). 실패·0묶음·미커버는 그 줄이 질문 자리에 서므로 polite 통지 한 번(상태 변화).

## 8. 검증

### 8.1 단위·계약

- 서버 순수: aboard 술어(같은 역·노선·방향 맞음 / 방향 반대 / 노선 다름 / 이름 같고 500m 밖 / `wayCode` 없음 → 불일치), 추천 미제공, 역 B 동시 지정의 `alight` 폴백, `oppositeDirection` 조건, 택시 앞 구간 없음(Tmap 비용), 미지정 요청 바이트 동일, 라우트 파라미터 검증(400 넷: `boardDir` 누락, `boardDir` 미지 값, `boardDir` 단독, aboard인데 `boardLine` 누락), 환승역 다른 노선 배제(같은 이름·같은 좌표의 다른 노선 leg는 불일치).
- Kit: `journeyAboardDirections`(노선 거르기·묶기·이름 추출·종착 중복·빈 `updnLine`), `journeyAboardTrainItems`(같은 방향만, 반대 방향만 남으면 빈 배열 — 리뷰 high의 결합 재현: 반대 방향 1개만 남은 목록이 분류 뒤에도 선택 가능 후보 0), `JourneyStationQuery` aboard 질의 문자열, `JourneyResult` `oppositeDirection` 디코딩.
- 대중교통 전이: 변경 없음(R1). Kit `swift test`·웹 `test:run`의 기존 공유 fixture 레인이 그대로 초록이어야 한다.
- 소스 가드: 출발지 시트 행·aboard 시작 경로의 실험판 조건, `TransitGuideModel.start`의 `aboard` 기본값 없음과 시작 통지 분기, 시트 첫 착지 분기(`transit-landing-guard.test.ts`), aboard 방향 잠금의 두 자리(후보 분류 입력·`boardAboard` 재확인), 최근 경로 미저장, `guidance-gate-drift.test.ts` 진입점 수 불변.

### 8.2 실호출 게이트 (머지 조건)

`scripts/verify-journey-aboard.mjs`(새 파일, `--from-corpus` 우선, 실호출은 `--out`): 공개 가능한 대형 환승역 표본(예: 서울역 1호선·4호선, 신도림 2호선 내선·외선과 1호선, 왕십리 5호선)에서
1. 서울 실시간 도착 1회씩(≤ 20회 — 키 일 1,000회 공유)으로 방면 묶음을 만들고(`journeyAboardDirections`와 같은 규칙의 JS 판),
2. 각 역에서 목적지 하나(방향이 분명한 공개 역)로 `getJourney`를 aboard로 부르고(ODsay ≤ 10회), 목적지 쪽 방향은 지정 경로가 나오고 첫 탈것 `serviceWayCode`가 `directionMatchesWayCode`로 맞으며, 반대 방향은 `variants: []` + `oppositeDirection`인지 단언한다(순환선 2호선 표본 필수).
통과 기준: 단언 전부 PASS, 판정 불가(`wayCode` 없음·`updnLine` 미지 표기)는 FAIL로 센다(부재는 실패 — 헐거운 판정 술어 금지).

### 8.3 실승차(위원장, FIELD-TEST 후보)

1. 열차 안에서 역 → 방면 → 조회 → 안내 시작까지의 시간이 열차가 그 역을 떠나기 전에 끝나는가, 늦었을 때 [다른 역 선택]으로 이어지는가.
2. 방면 이름(「구로방면」)과 종착 조각이 열차 안 안내 방송과 맞물려 바로 고를 수 있는가.
3. 구간 줄 「{역}에서 {노선} 탑승」이 열차 안에서 어색한가(R13과 별개의 문안 판정 후보).
4. 급행에서 시작했는데 경로가 급행 미정차역에서 내릴 때의 흐름(판정 ④ 한계).

## 9. 첫 판 밖

- 버스에서 시작(정류소 실시간·차량 식별 계약이 다르다), 역 B가 정류장인 aboard의 지하철만 후보 보강(종전 `allStations` 규칙 그대로라 전체 후보에서만 찾는다), 실시간 없는 지하철·철도, 급행에 맞는 경로 찾기(판정 ④ 나), 웹·안드로이드·en, 최근 경로 저장.

## 10. 구현 순서와 소유 파일

판정 근거(결합도): 서버(1)와 Kit 순수(2)는 계약(§4)으로만 이어져 독립, 앱(3~4)은 `DirectionsTabView`·`GuideSessionCoordinator`·`TransitGuideModel`·`TransitTrackingSheet`를 순차로 고치고 선행 결정(시그니처)이 후속을 바꾸므로 한 태스크 안에서 순차.

1. **서버** — `src/lib/types.ts`(`JourneyStationInput.kind`·`direction`, `designatedMissing.oppositeDirection`), `src/lib/journey/designated.ts`(aboard 술어·반대 방향 판정), `src/lib/journey/assemble.ts`(추천 미제공·택시 앞 생략), `src/lib/transit-guide.ts`(`directionMatchesWayCode` export만), `src/app/api/route/journey/route.ts`(파라미터), 테스트.
2. **Kit** — `Journey.swift`(`journeyAboardDirections`), `Models/RouteModels.swift`(aboard 질의·`oppositeDirection` 디코딩)·`RouteService.swift`, 테스트(`Journey.swift`는 `:kit` 미러 등록부에서 `pending`이라 이식 대상이 아니다).
3. **앱 입력·결과** — `DirectionsEndpointSearchView.swift`(행·`.aboardStation`), `DirectionsTabView.swift`(출발지 상태·방면 단계·조회·결과·저장 생략·`JourneyPlan.aboard`), `JourneyResultRows.swift`(합계·없음 문장), `ios/i18n/ios-extra/*`.
4. **앱 안내** — `GuideSessionCoordinator.swift`(`JourneyPlan.aboard`·`beginTransit(aboard:)`), `TransitGuideModel.swift`(`start(aboard:)`·`beginSession`), `TransitTrackingSheet.swift`(첫 착지), 가드(`guidance-gate-drift`·`transit-landing-guard`·새 `e71-aboard-start-guard.test.ts`).
5. **실호출 게이트·문서** — `scripts/verify-journey-aboard.mjs`, `docs/INTEGRATIONS.md` §여정 조립과 출구 수집(aboard 방향 조인), BACKLOG E71·착수 순서 표·§2 실승차 행, FIELD-TEST §6-3, CHANGELOG, PROGRESS.

## 11. 설계 리뷰

codex `adversarial-review`(2026-10-27, 기준 `cb467a03`, 원문 `~/gildongmu-wt/e71-riding-start-reports/review-design-202610272147.md`) 판정 needs-attention, 지적 2건 모두 수용:

| 심각도 | 지적 | 처리 |
|---|---|---|
| high | A34 후보 분류가 방향 일치 0이면 전체를 복원하고 `boardAboard`가 방향을 재확인하지 않아, 조회와 시작 사이 반대 방향 열차만 남으면 그 열차로 riding 식별 잠금이 선다(웹 미러로 재현) | R14 신설: aboard 시작 세션은 고른 `updnLine`과 같은 항목만 분류에 넘기고 `boardAboard`에서 재확인, 맞는 열차가 없으면 비관측 진입만. 기존 A34 복원 동작은 방면을 밝히지 않은 흐름이라 유지 |
| medium | `boardLine`이 선택이면 `isSameStation`이 노선 비교를 건너뛰어 환승역 다른 노선이 aboard로 통과한다(서울역 1·4호선 재현) | §4.1: aboard는 `boardLine` 필수(400), 환승역 다른 노선 배제 테스트 |
