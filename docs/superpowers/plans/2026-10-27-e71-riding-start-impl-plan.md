# E71 지금 탄 열차에서 여정 시작 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 열차 안의 사용자가 길찾기 화면에서 「지금 탄 열차」 출발(역·노선·방면)로 여정을 조회하고, 안내가 A34 [이미 탔어요] 둘째 단계(열차 고르기)로 바로 열려 승차 중으로 이어지게 한다(iOS 실험판, 지하철만).

**Architecture:** 서버 `/api/route/journey`에 옵트인 `boardKind=aboard`·`boardDir`을 더해 그 역·노선·방향으로 타는 경로만 낸다(추천 대체 없음, 택시 앞 구간 없음). Kit은 방면 목록·방향 잠금 순수 함수와 질의 필드를 더한다. 앱은 출발지 시트에 aboard 모드, 길찾기 모델에 aboard 출발 상태·방면 단계, 안내 모델에 aboard 시작(둘째 단계 선점·방향 잠금)을 더한다. Kit 대중교통 전이·웹·`:kit` 미러·공유 fixture는 바꾸지 않는다.

**Tech Stack:** Next.js 16 route handler + zod 4 + Vitest 4(서버), Swift 6 / SwiftUI / Swift Testing(Kit·앱).

**Spec:** `docs/superpowers/specs/2026-10-27-e71-riding-start-design.md`(R1~R14, §4 서버 계약, §7 문장 표). 구현자는 spec과 이 계획을 함께 읽는다.

**구현 방식 판정(결합도):** 태스크 1(서버)과 2(Kit)는 spec §4 계약으로만 이어져 독립 → 병렬. 3(안내)은 2의 `journeyAboardTrainItems`를, 4(길찾기)는 2·3의 타입을 쓰므로 순차. 5(실호출)는 1 뒤. 3·4는 같은 앱 타깃이지만 파일이 겹치지 않는다(`JourneyPlan`은 3이 소유, 4는 생성만).

## Global Constraints

- 작업 디렉터리 `~/gildongmu-wt/e71-riding-start`, 브랜치 `feat/e71-riding-start`. 커밋은 `git add <경로> && git commit -m "…" -- <경로>`(새 파일은 add 필요), `git add -A`·`.` 금지, 메시지 끝 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, 주석·커밋 한국어.
- 무거운 게이트는 `VITE_CONFIG_NATIVE_IGNORE_WARNING=true VITEST_MAX_WORKERS=2 python3 ~/.claude/skills/parallel-sessions/scripts/gate-lock.py e71-riding-start -- <명령>`으로 감싼다. 단일 테스트 파일은 `npx vitest run <파일>` 직접 실행 가능.
- `/api/route/journey`의 aboard 미지정 요청 응답은 바이트 동일. 기존 `/api/route/*` 불변.
- 봉인: 새 UI는 `AppConfig.experimentalJourneyEnabled` ∧ 데이터 로케일 ko에서만 존재(역 칸과 같은 조건 `journeyInputEnabled`).
- 안전 인자 기본값 금지: `TransitGuideModel.start(…, aboard:)`, `beginTransit(…, aboard:)`, `JourneyPlan.aboard`, `JourneyStationQuery.aboardDirection`은 기본값 없음 — 기존 호출부는 `nil`을 명시한다.
- `boardDir` 허용값은 정확히 `상행`·`하행`·`내선`·`외선`. aboard는 `boardLine` 필수.
- 문장은 spec §7 표 그대로(ko). 다른 로케일(en·es·fr·it·ja)은 같은 ko 값(E70 관례). 가운뎃점·em dash 금지, 구분자는 쉼표.
- `:kit`·안드로이드·웹 UI 변경 없음. `TransitGuide.swift` 전이 변경 없음(`directionMatchesWayCode`의 접근 수준도 그대로 — 방향 잠금은 `updnLine` 문자열 같음으로 한다).
- 공개 저장소: 테스트·fixture·스크립트 표본은 공개 대형 역(서울역·신도림·왕십리·시청 등)과 합성 좌표만. 위원장 실승차 구간·자택 근처 역 금지.
- 금지: `npm install`, `CLAUDE.md` 수정, 실기기 배포, 정적 seed 커밋, `vercel` 수동 배포, env 변경.

## Review Focus

1. **조회와 시작 사이 열차 목록이 바뀜**(고른 방향 열차가 모두 지나가 반대 방향만 남음) → 안내 목록이 비고 「열차 정보 없이 계속」만 남아야 한다(반대 방향 되살리기 금지). 태스크 2(`journeyAboardTrainItems`) + 태스크 3(`waitingCandidatesPool`·`boardAboard` 재확인) 테스트.
2. **환승역에서 같은 이름 다른 노선**(서울역 1호선 aboard, 후보 첫 탈것이 서울역 4호선) → 불일치. 태스크 1 테스트.
3. **순환선 2호선 내선·외선**(`updnLine`이 상행·하행이 아님) → `directionMatchesWayCode`가 외선=1·내선=2로 판정하고, 방면 묶음도 내선·외선으로 갈린다. 태스크 1·2·5.
4. **노선이 안 붙은 역 장소**(카카오 분류 끝이 노선이 아님) + 그 역 도착 목록에 노선이 둘 이상 → 노선 질문이 선다. 노선이 하나뿐이면 묻지 않는다. 태스크 2(`journeyAboardLines`) + 태스크 4.
5. **aboard 출발 상태에서 출발지를 다른 곳으로 바꾸거나 역 B를 지움** → aboard 상태가 남아 일반 조회에 `boardKind=aboard`가 실리면 안 된다. 태스크 4 모델 테스트(소스 가드).

---

### Task 1: 서버 aboard 옵트인

**Files:**
- Modify: `src/lib/types.ts`(`JourneyStationInput`·`JourneyResult.designatedMissing`)
- Modify: `src/lib/transit-guide.ts:735`(`directionMatchesWayCode`에 `export`만 붙인다)
- Modify: `src/lib/journey/designated.ts`(aboard 술어·반대 방향 판정)
- Modify: `src/lib/journey/assemble.ts`(aboard 분기)
- Modify: `src/app/api/route/journey/route.ts`(파라미터)
- Test: `src/lib/journey/__tests__/designated.test.ts`, `src/lib/journey/__tests__/assemble.test.ts`, 라우트 테스트(기존 `src/app/api/route/journey` 테스트 파일이 있으면 거기, 없으면 `src/lib/journey/__tests__/route-params.test.ts`로 `GET`을 직접 부른다 — 기존 assemble 테스트의 deps 스텁 관례를 따른다)

**Interfaces:**
- Produces(타입): `JourneyStationInput.kind?: "stop" | "aboard"`, `JourneyStationInput.direction?: "상행" | "하행" | "내선" | "외선"`(aboard에서만), `JourneyResult.designatedMissing?: { side: "board" | "alight" | "both"; oppositeDirection?: true }`.
- Produces(함수): `export function directionMatchesWayCode(updnLine: string, wayCode: number | null): boolean | null`(transit-guide.ts, 본문 불변), `export function boardOppositeOnly(pools: TransitRoute[][], input: JourneyStationInput): boolean`(designated.ts).
- Produces(HTTP): `GET /api/route/journey?…&board=lat,lng&boardName=…&boardLine=…&boardKind=aboard&boardDir=상행`.

- [ ] **Step 1: 실패 테스트 — designated**

`designated.test.ts`에 기존 픽스처 빌더로 지하철 첫 탈것 경로를 만들어:
- `sideMatch(route,"board",{name:"서울역",coord,line:"1호선",kind:"aboard",direction:"상행"},false)` → 1호선·`serviceWayCode:1` 경로 `"strong"`, `serviceWayCode:2` 경로 `null`, `serviceWayCode` 없음 `null`, 4호선(`lineName:"수도권 4호선"`, wayCode 1) 경로 `null`, 첫 탈것이 버스인 경로 `null`(stops=true여도 약 맞음 없음).
- 2호선: `direction:"외선"` ↔ wayCode 1 strong, `"내선"` ↔ 2 strong.
- `boardOppositeOnly([[wayCode2Route]], aboardInput상행)` → `true`; `[[wayCode2Route, wayCode1Route]]` → `false`; 다른 노선만 → `false`.

- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/journey/__tests__/designated.test.ts` → FAIL.

- [ ] **Step 3: 구현** — `sideMatch`에서 `input.kind === "aboard"`면 `leg.mode === "subway" && isSameStation(…) && directionMatchesWayCode(input.direction ?? "", leg.serviceWayCode ?? null) === true ? "strong" : null`(약 맞음 없음, `stops` 무시). `boardOppositeOnly`: 모든 풀의 경로 중 aboard 술어를 통과한 것이 없고, 첫 탈것이 지하철 ∧ `isSameStation` ∧ `directionMatchesWayCode(...) === false`인 것이 하나 이상이면 true. `transit-guide.ts`의 함수에 `export`만 추가.

- [ ] **Step 4: 실패 테스트 — assemble**

기존 `assemble.test.ts` deps 스텁 관례로:
- aboard만(역 B 없음), 후보에 맞는 경로 있음 → `variants.length === 1`, `variants[0].kind === "designated"`, `taxiIn` 없음, `reserve`에 넘긴 비용 0, `deps.car` 미호출, 추천 경로가 달라도 추가 변형 없음.
- aboard만, 맞는 경로 없음·반대 방향만 → `{ variants: [], designatedMissing: { side: "board", oppositeDirection: true } }`.
- aboard만, 맞는 경로 없음·방향 무관(다른 노선만) → `{ variants: [], designatedMissing: { side: "board" } }`(`oppositeDirection` 키 없음).
- aboard + 역 B 둘 다 맞는 경로 있음 → `designated` 하나 + egress.
- aboard + 역 B, aboard만 맞는 경로 있음 → `variants[0].kind === "recommended"`, 그 경로의 첫 탈것이 aboard 술어 통과, `designatedMissing: { side: "alight" }`.
- 미지정 요청(기존 테스트 하나를 골라) 결과 JSON이 이 변경 전과 같다(기존 테스트가 그대로 통과하면 충분 — 새 단언 불필요).
- aboard의 ODsay 출발점이 `board.coord`(이미 종전 동작)이고 subwayOnly 풀도 조회한다.

- [ ] **Step 5: 구현** — `getJourney`에서 `const aboard = req.board?.kind === "aboard"`. aboard면: 지정 판정은 그대로 `findDesignated`(술어가 sideMatch에서 갈림), 정류장 약 맞음 루프(`stops`)를 타지 않는다. `designated`가 없고 `req.alight`면 `findDesignated(pool, { board: req.board })`를 풀 순서대로 찾아 `{kind:"recommended"}` + `designatedMissing:{side:"alight"}`. 그것도 없으면 `{ variants: [], designatedMissing: { side: "board", ...(boardOppositeOnly(pools, req.board) ? { oppositeDirection: true } : {}) } }`로 즉시 반환. aboard의 `picked`에는 추천을 더하지 않는다. `planTaxiCalls`의 `taxiInDests`는 aboard면 `[]`, 결과 조립의 `taxiIn`도 aboard면 없음. `trimBoard`는 `!!req.board` 그대로.

- [ ] **Step 6: 실패 테스트 — 라우트 파라미터** — 400 넷(`boardKind=aboard`인데 `boardDir` 없음 / `boardDir=북행` / `boardDir`만 있고 `boardKind` 없음 / aboard인데 `boardLine` 없음), 정상 aboard 요청이 `getJourney`에 `board:{kind:"aboard",direction:"상행",line:"1호선",…}`로 넘어감, aboard는 `stops` 없이도 받음. 기존 `boardKind=stop` 검증(stops 필요)은 그대로.

- [ ] **Step 7: 구현** — `boardKind: z.union([z.literal("stop"), z.literal("aboard"), z.null()])`, `boardDir: z.union([z.enum(["상행","하행","내선","외선"]), z.null()])`, refine: stop만 `stops` 필요 / `boardDir`은 `boardKind === "aboard"`일 때만 있고 그때 필수 / aboard면 `boardLine` 필수. `getJourney` 입력에 aboard면 `direction` 실음. 라우트 머리 주석의 파라미터 설명에 aboard 한 줄.

- [ ] **Step 8: 통과 확인** — `npx vitest run src/lib/journey` + 라우트 테스트 + `npx tsc --noEmit -p .` → PASS·0 error.

- [ ] **Step 9: 커밋** — `feat(journey): E71 지금 탄 열차 출발 옵트인(boardKind=aboard·boardDir)`.

---

### Task 2: Kit 순수 함수·질의·모델

**Files:**
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/Journey.swift`(세 함수 + 타입)
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/RouteService.swift`(`JourneyStationQuery.aboardDirection`, 질의 조립)
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/Models/RouteModels.swift`(`JourneyDesignatedMissing.oppositeDirection`)
- Modify(호출부 컴파일 유지만): `ios/Gildongmu/Directions/DirectionsTabView.swift`의 `JourneyStationQuery(...)` 두 곳에 `aboardDirection: nil`
- Test: `ios/GildongmuKit/Tests/GildongmuKitTests/JourneyTests.swift`(기존 Journey 테스트 파일 — 없으면 같은 폴더의 E70 테스트 파일명을 따른다), RouteService 질의 테스트가 있는 파일

**Interfaces:**
- Produces:
  - `public struct JourneyAboardDirection: Sendable, Hashable { public let direction: String /* updnLine 원문 */; public let name: String /* 「구로방면」 */; public let terminals: [String] /* 종착 이름, 「행」 없음 */ }`
  - `public func journeyAboardLines(_ arrivals: [SubwayArrival]) -> [String]` — `line`이 nil·빈 값이 아닌 서로 다른 값, 처음 본 순서.
  - `public func journeyAboardDirections(_ arrivals: [SubwayArrival], line: String) -> [JourneyAboardDirection]` — `line`이 `journeyLineHintMatches(arrival.line, line)`인 항목만, `direction`(trim 뒤 빈 값 버림)으로 묶음, 묶음 순서는 처음 본 순서. `name` = 그 묶음에서 처음으로 `trainLineNm`이 「 - 」를 담은 항목의 뒤 조각(trim), 없으면 `direction`. `terminals` = `destination`(trim, 빈 값 버림) 중복 제거·처음 본 순서.
  - `public func journeyAboardTrainItems(_ items: [TransitTrackItem], direction: String) -> [TransitTrackItem]` — `item.direction == direction`인 것만(순서 유지).
  - `JourneyStationQuery.init(name:lat:lng:line:kind:aboardDirection:)` — `aboardDirection: String?` 기본값 없음. non-nil이면 질의에 `boardKind=aboard`·`boardDir=<값>`을 싣고 `boardLine`은 `line`(aboard는 line이 있어야 한다 — nil이면 `preconditionFailure` 대신 질의에서 빠지게 두면 서버 400이 실패 3-state로 드러난다. 구현자는 생략으로 둔다). aboard는 `alight` 쪽에 오지 않는다(`alight`에 non-nil이면 무시).
  - `JourneyDesignatedMissing.oppositeDirection: Bool?`(디코딩 옵셔널, init 인자 기본값 없음 — 기존 생성부는 `nil`).
- ⚠ Kit에 정규식 약칭·Foundation 공백 집합을 쓰지 않는다(`isJourneySeparator` 관례). trim은 공백·탭·개행만.

- [ ] **Step 1: 실패 테스트** — Swift Testing으로:
  - `journeyAboardLines`: `[1호선, nil, 1호선, 경의중앙선, ""]` → `["1호선","경의중앙선"]`.
  - `journeyAboardDirections(line:"1호선")`: 입력 `(1호선,상행,"인천행 - 구로방면","인천")`, `(1호선,상행,"부평행 - 구로방면","부평")`, `(1호선,하행,"청량리행 - 역곡방면","청량리")`, `(1호선,상행,"인천행 - 구로방면","인천")`, `(경의중앙선,상행,…)`, `(1호선,"",…)` → `[{상행, 구로방면, [인천, 부평]}, {하행, 역곡방면, [청량리]}]`.
  - `trainLineNm`에 「 - 」가 없으면 `name == direction`.
  - 2호선 `내선`·`외선` 두 묶음.
  - `journeyAboardTrainItems`: 상행 2·하행 1 → 상행 2; 하행만 남은 목록에 `direction:"상행"` → `[]`.
  - `JourneyStationQuery` aboard 질의: `boardKind=aboard`, `boardDir=상행`, `boardLine=1호선`, `stops=1` 포함, 기존 정류장 질의 불변.
  - `JourneyResult` 디코딩: `{"variants":[],"designatedMissing":{"side":"board","oppositeDirection":true}}` → `oppositeDirection == true`; 키 없으면 nil.
- [ ] **Step 2: 실패 확인** — `cd ios/GildongmuKit && swift test --filter Journey` → 컴파일 실패/FAIL.
- [ ] **Step 3: 구현** — 위 시그니처대로. 질의 조립은 `RouteService.journey`의 `if let board` 블록 안에서 `board.aboardDirection` 분기.
- [ ] **Step 4: 통과 확인** — `swift test --filter Journey` PASS, 이어서 `swift test` 전체 PASS(기준선 실패와 비교, 새 실패 0).
- [ ] **Step 5: 앱 컴파일 유지** — `DirectionsTabView.swift`의 `JourneyStationQuery(` 두 곳에 `aboardDirection: nil`(그 밖 수정 없음).
- [ ] **Step 6: 커밋** — `feat(kit): E71 방면 묶음·방향 잠금 순수 함수와 aboard 질의`.

---

### Task 3: 안내 aboard 시작(안내 모델·코디네이터·시트)

**Files:**
- Modify: `ios/Gildongmu/Directions/TransitGuideModel.swift`(`start`·`beginSession`·`waitingCandidatesPool`·`boardAboard`·해제 지점)
- Modify: `ios/Gildongmu/Directions/GuideSessionCoordinator.swift`(`JourneyPlan.aboard`, `beginTransit(aboard:)`, `startTransit`, `startJourneyStage`)
- Modify: `ios/Gildongmu/Directions/TransitTrackingSheet.swift:179`(첫 착지)
- Modify: `src/lib/__tests__/guidance-gate-drift.test.ts`(시그니처 문자열이 걸리면 갱신만), `src/lib/__tests__/transit-landing-guard.test.ts:44`(면제 줄 문자열)
- Create: `src/lib/__tests__/e71-aboard-start-guard.test.ts`(소스 가드)

**Interfaces:**
- Consumes: 태스크 2 `journeyAboardTrainItems(_:direction:)`.
- Produces:
  - `struct TransitAboardStart: Equatable { let direction: String }`(TransitGuideModel.swift 최상위, `updnLine` 원문).
  - `TransitGuideModel.start(transitRoute:destinationLabel:destinationRoman:dest:accessible:aboard: TransitAboardStart?)`.
  - `JourneyPlan.aboard: TransitAboardStart?`(저장 프로퍼티, memberwise init 인자 — 기본값 없음).
  - `GuideSession.beginTransit(route:destinationLabel:destinationRoman:dest:accessible:aboard:)`(private).

- [ ] **Step 1: 실패 소스 가드** — `e71-aboard-start-guard.test.ts`(기존 가드의 `readFileSync` + `declarationBody` 관례 — `guidance-gate-drift.test.ts`의 헬퍼를 복사하지 말고 같은 방식으로 본문을 자른다):
  - `TransitGuideModel.swift`의 `func start(` 시그니처가 `aboard: TransitAboardStart?`를 담고 `aboard: TransitAboardStart? =`를 담지 않는다.
  - `beginTransit(` 선언 시그니처도 같다. `startTransit` 본문이 `aboard: nil`, `startJourneyStage` 본문이 `aboard: plan.aboard`를 담는다. `startAfterPrewalk` 경로가 `aboard: nil`로 세션을 연다.
  - `waitingCandidatesPool` 본문이 `journeyAboardTrainItems(`를 담는다. `boardAboard(item:` 본문이 `aboardDirection`과 `item.direction`을 비교한다.
  - `TransitTrackingSheet.swift`에 `.task { landControlFocus(model.aboardStep == .pickVehicle ? .waitingLabel : .status, proxy: proxy) }` 한 줄.
  - aboard 시작 통지 분기: `beginSession` 본문(또는 시작 통지 조립 자리)이 aboard일 때 `waitContextText`를 붙이지 않는다(문자열 `aboard == nil` 또는 동등 분기를 단언 — 구현이 정한 표현에 맞춰 단언을 하나로 고정).
- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/__tests__/e71-aboard-start-guard.test.ts` FAIL.
- [ ] **Step 3: 모델 구현** —
  - `private(set) var aboardDirection: String?` 세션 상태. `beginSession(…, aboard:)`가 세션 초기화(`initTransitGuide`) 뒤 `aboard`가 있고 첫 leg `trackMode == .subway`·`viaStops` 비어 있지 않으면 `aboardDirection = aboard.direction`, `aboardStep = .pickVehicle`, `boardOverrideIndex = 0`, 스냅숏 비움, `transitGuideLog("aboard start direction=…")`, 즉폴(`restartPollLoop(immediate: true)` — 종전 시작 폴과 중복되지 않게 시작 폴 자리를 그대로 쓴다). 조건이 안 서면 `aboardDirection = nil`로 종전 대기 시작.
  - 시작 통지: aboard 시작이 섰으면 `transitGuide.startedAt` 문장만(대기 문맥 `waitContextText` 생략).
  - `waitingCandidatesPool()`: `aboardStep == .pickVehicle`이면 `transitAboardCandidates(all)`을 `aboardDirection`이 있을 때 `journeyAboardTrainItems(_, direction:)`로 한 번 더 거른다.
  - `boardAboard(item:description:)`: `aboardDirection`이 있고 `item.direction != aboardDirection`이면 `transitGuideLog("boardAboard rejected direction …")` 후 return.
  - 해제: `aboardDirection = nil`을 세션 종료(`stop`)·`declareArrived`·riding 진입 뒤(`result.state.phase != .waiting`에서 `aboardStep = nil` 하는 자리, line ~1783)에 둔다. [다른 역 선택]·`cancelAboard`는 유지.
  - `startAfterPrewalk`는 `aboard: nil`.
- [ ] **Step 4: 코디네이터 구현** — `JourneyPlan`에 `let aboard: TransitAboardStart?`. `startTransit`→`beginTransit(…, aboard: nil)`. `beginTransit`은 aboard가 있으면 승차 전 도보 판정(`transitPrewalkTarget`)을 건너뛰고 곧장 `transit.start(…, aboard: aboard)`(서버가 승차 쪽을 잘라 원래 서지 않지만 구조로 막는다). `startJourneyStage(.transit)`은 `aboard: plan.aboard`. 태스크 4가 `JourneyPlan(…)` 생성부에 `aboard:`를 채운다 — 이 태스크에서는 기존 생성부(`DirectionsTabView.swift:1198`)에 `aboard: nil`만 넣어 컴파일을 유지한다.
- [ ] **Step 5: 시트 구현** — 179행 `.task`를 Step 1의 한 줄로. `transit-landing-guard.test.ts:44` 면제 줄 문자열을 같은 줄로 바꾸고 허용 대상 집합 단언(111행 `["status","waitingLabel"]`)이 그대로 통과하는지 확인.
- [ ] **Step 6: 통과 확인** — `npx vitest run src/lib/__tests__/e71-aboard-start-guard.test.ts src/lib/__tests__/guidance-gate-drift.test.ts src/lib/__tests__/transit-landing-guard.test.ts` PASS. `guidance-gate-drift`의 진입점 수(12)·`callersOf(..., "beginTransit(")` 결과가 변하지 않아야 한다(변하면 구현이 새 시작 경로를 만든 것 — 고친다).
- [ ] **Step 7: 빌드** — `xcodebuild -project ios/Gildongmu.xcodeproj -scheme Gildongmu -configuration Experimental -destination 'generic/platform=iOS Simulator' -derivedDataPath ~/gildongmu-wt/e71-riding-start-dd build -quiet`(gate-lock 래핑) → BUILD SUCCEEDED.
- [ ] **Step 8: 커밋** — `feat(ios): E71 대중교통 안내를 지금 탄 열차 고르기로 시작(방향 잠금)`.

---

### Task 4: 길찾기 화면 aboard 출발(입력·방면 단계·조회·결과)

**Files:**
- Modify: `ios/Gildongmu/Directions/DirectionsEndpointSearchView.swift`(aboard 모드)
- Modify: `ios/Gildongmu/Directions/DirectionsTabView.swift`(모델 상태·뷰·조회·저장 생략·`JourneyPlan(aboard:)`)
- Modify: `ios/Gildongmu/Directions/JourneyResultRows.swift`(합계·없음 문장)
- Modify: `ios/i18n/ios-extra/{ko,en,es,fr,it,ja}.json`(`ios.journey.*` spec §7 키 16개, 다른 로케일은 ko 값)
- Regenerate: `node ios/scripts/messages-to-xcstrings.mjs app`(`Localizable.xcstrings`·`ios/i18n/arg-order.json` 신규 키 자동 등록)
- Modify: `src/lib/__tests__/e71-aboard-start-guard.test.ts`(길찾기 소스 가드 추가)

**Interfaces:**
- Consumes: 태스크 2 `journeyAboardLines`·`journeyAboardDirections`·`JourneyAboardDirection`·`JourneyStationQuery(…aboardDirection:)`·`JourneyDesignatedMissing.oppositeDirection`, 태스크 3 `TransitAboardStart`·`JourneyPlan(…, aboard:)`.
- Produces(모델): `DirectionsModel`
  - `private(set) var aboardOrigin: AboardOrigin?` — `struct AboardOrigin: Equatable { let station: RecentStation /* label=장소 이름 */; var line: String?; var direction: JourneyAboardDirection? }`.
  - `enum AboardDirectionsState: Equatable { case idle, loading, loaded([JourneyAboardDirection]), lines([String]), unavailable, failed }` + `private(set) var aboardDirectionsState`.
  - `func startAboard(station: RecentStation)` — 출발지 칸 대체, 경유지·역 A(`boardStation`) 비움, 결과 지움, 도착 정보 조회 시작(노선은 `station.line` → 없으면 도착 목록의 `journeyAboardLines`가 하나면 그것, 둘 이상이면 `.lines`).
  - `func chooseAboardLine(_ line: String)`, `func chooseAboardDirection(_ d: JourneyAboardDirection)`, `func retryAboardDirections()`, `func clearAboard()`(출발지 칸에 다른 끝점을 고를 때 `setEndpoint(_, for: .from)`가 부른다).
- 화면 규칙(spec §5.1·§7·R12·R13): 출발지 시트 `.from`에 `journeyInputEnabled`일 때만 「현재 위치 사용」 다음 행 `ios.journey.aboardStart`. 누르면 시트가 aboard 모드(제목·검색 필드 이름 `ios.journey.aboardStationField`, 최근 목록·현재 위치 행·정류장 검색 숨김, 지하철역(`stationLayoutKind == .subway`)만 받음, 아니면 기존 `ios.journey.notStation` 통지)로 바뀌고 커서는 검색 필드로. 역을 고르면 `onSelectAboardStation(RecentStation)`(라벨=장소 이름, line=`journeyLineHint(place)`, kind=nil)로 돌려주고 닫는다. 길찾기 화면: 출발지 칸 값 `ios.journey.aboardField`/`aboardFieldDirection`, 칸 바로 아래 노선 질문(`aboardLinePrompt` + 노선 버튼) 또는 방면 질문(`aboardDirectionPrompt` + 방면 버튼, 버튼 한 줄 = `aboardDirectionRow`의 `{direction}`=방면 이름, `{terminals}`=`aboardTerminal`들을 `joinText`), 3-state 줄(`aboardDirectionsLoading`·`Empty`·`Unavailable`·`Failed` + 기존 다시 시도 키). 역 확정 뒤 커서는 질문 줄, 방면 확정 뒤 커서는 조회 버튼(질문·버튼이 사라지기 전에 옮긴다). 실패·0묶음·미커버만 polite 통지 한 번. aboard 출발이면 「바꾸기」·경유지·역 A 메뉴 항목 숨김, 역 B는 기존 `ios.journey.addAlightStation` 일반 버튼 하나로. 방면 전 조회 버튼 → 커서를 방면 질문으로 + `aboardDirectionPrompt` `.high` 통지. 조회는 여정만, `board`=`JourneyStationQuery(name: 역 이름(journeyStationDisplayName), lat,lng, line: aboardOrigin.line, kind: nil, aboardDirection: direction.direction)`, origin=역 좌표. 결과: `variants` 빈 배열이면 `oppositeDirection`에 따라 `aboardOpposite`/`aboardMissing`, side alight면 기존 `designatedMissingAlight` 줄, 합계는 `totalsAboard`/`totalsAboardTaxi`(택시 요금 0이면 앞 것), 변형 heading 없음. aboard 결과는 `recordRecentRoute`를 부르지 않는다. 안내 시작 `JourneyPlan(…, aboard: TransitAboardStart(direction: dir.direction))`.

- [ ] **Step 1: 실패 소스 가드 추가**(`e71-aboard-start-guard.test.ts`): ① `DirectionsEndpointSearchView.swift`의 `ios.journey.aboardStart` 행이 `onSelectAboardStation != nil` 조건 안에 있고 길찾기 탭은 그 콜백을 `journeyInputEnabled`일 때만 넘긴다 ② `performJourney`의 `recordRecentRoute(` 호출이 aboard가 아닐 때만(`aboardOrigin == nil` 조건) ③ `setEndpoint` 본문이 `.from`에서 `clearAboard()`를 부른다 ④ `JourneyPlan(` 생성부가 `aboard:`를 담는다 ⑤ spec §7 키 16개가 `ios/i18n/ios-extra/ko.json`에 있고 값이 spec 문장과 같다(표를 테스트에 상수로 옮긴다) ⑥ 그 값들에 `·`·`—` 없음.
- [ ] **Step 2: 실패 확인** — 해당 테스트 FAIL.
- [ ] **Step 3: i18n** — 6로케일 json에 키 추가 → `node ios/scripts/messages-to-xcstrings.mjs app` → `node ios/scripts/check-xcstrings-keys.mjs`(있으면) 통과.
- [ ] **Step 4: 시트 aboard 모드 구현**(`DirectionsEndpointSearchView`: 새 인자 `onSelectAboardStation: ((RecentStation) -> Void)?`를 끝점 init에 기본값 없이 추가 — 기존 끝점 호출부는 `nil`, `.from`만 실값).
- [ ] **Step 5: 모델 구현**(위 Produces) — 도착 정보는 `StationService.arrivals(station: journeyStationDisplayName(station.label), lang: "ko")`, 응답 nil = `.unavailable`, throw = `.failed`, 묶음 0 = `.loaded([])`(Empty 문장). 세대 토큰으로 늦은 응답 폐기(`startAboard`·`clearAboard`마다 증가).
- [ ] **Step 6: 뷰·결과 구현**(위 화면 규칙). 결과 행 문장 조립은 `JourneyResultRows.swift` 기존 함수 옆에.
- [ ] **Step 7: 통과 확인** — 가드 PASS, `npx vitest run src/lib/__tests__/e71-aboard-start-guard.test.ts src/lib/__tests__/i18n-messages.test.ts`, 이어서 Experimental·Release 두 구성 빌드(태스크 3 Step 7 명령, `-configuration Release`도) BUILD SUCCEEDED.
- [ ] **Step 8: 커밋** — `feat(ios): E71 길찾기 출발지 「지금 탄 열차에서 출발」(역·노선·방면)`. 재생성 파일(`ios/Gildongmu/Localizable.xcstrings` 등 실제 바뀐 경로, `ios/i18n/arg-order.json`)을 경로로 함께.

---

### Task 5: 실호출 게이트

**Files:**
- Create: `scripts/verify-journey-aboard.mjs`(구조·저장·재생·상한은 `scripts/verify-journey-bus-stops.mjs` 관례 그대로: `--out <저장소 밖 dir>`·`--from-corpus <dir>`, 서버 계층(`getJourney`·`journeyDeps`, 서울 도착 provider 함수)을 그대로 태우고 판정 로직을 복제하지 않는다)

**Interfaces:**
- Consumes: 태스크 1 HTTP/함수 계약, `src/lib/providers/seoul-subway-arrival.ts`의 역 이름 도착 조회 함수.
- 상한: `ODSAY_CAP = 10`, `SEOUL_RT_CAP = 20`, `TMAP_CAP`·`KAKAO_CAP`은 역 B 표본이 없으면 0(표본에 역 B를 넣지 않는다 — Tmap 0회).
- 표본(공개 역만): 서울역 1호선(목적지 1호선 남쪽 공개 역 하나 = 맞는 방향, 반대 방향 묶음으로 같은 목적지 = `oppositeDirection`), 신도림 2호선 내선·외선(순환선, 목적지 2호선 공개 역 하나), 왕십리 5호선 한 방향. 도착 1회/역으로 방면 묶음을 만들고(`journeyAboardDirections`와 같은 규칙 — 스크립트 안 JS 함수는 Kit 함수 문서 주석을 정본으로 같은 규칙만), 각 묶음의 `updnLine`으로 aboard 조회.
- 판정: 맞는 방향 → `variants.length === 1` ∧ 첫 탈것 `serviceWayCode`가 `directionMatchesWayCode(updnLine, wayCode) === true` ∧ 첫 탈것 정류 이름이 표본 역. 반대 방향 → `variants.length === 0` ∧ `designatedMissing.oppositeDirection === true`. 도착 0건·`updnLine` 미지 표기·`wayCode` 없음은 FAIL(측정 못 함도 FAIL). 통과 = 전부 PASS.

- [ ] **Step 1: 스크립트 작성** — 위 판정, 실행 요약 `PASS n/n · ODsay 실호출 k · 서울 실시간 m`.
- [ ] **Step 2: 실호출 1회** — `node scripts/verify-journey-aboard.mjs --out ~/gildongmu-wt/e71-riding-start-reports/corpus-aboard`(env는 `.env.local`이 있으면 스크립트가 bus-stops 관례대로 읽는다) → 전부 PASS, 호출 수 상한 이내.
- [ ] **Step 3: 재생 확인** — `node scripts/verify-journey-aboard.mjs --from-corpus ~/gildongmu-wt/e71-riding-start-reports/corpus-aboard` → 호출 0, 같은 판정.
- [ ] **Step 4: 커밋** — 스크립트만(`corpus`는 저장소 밖). `test(journey): E71 aboard 실호출 게이트`.

---

### Task 6(부모 세션): 감사·문서 분배·통합

부모 세션이 직접 한다(서브에이전트 위임 아님).
- a11y 감사: `.claude/agents/a11y-auditor.md`를 읽어 그 지시를 `model: opus` 일반 에이전트에 주고 태스크 3·4 diff를 감사.
- 문서: `docs/INTEGRATIONS.md` §여정 조립과 출구 수집에 aboard 방향 조인 계약(R4·R5·R14·`boardLine` 필수), `docs/BACKLOG.md` E71 항목 종결 표기 + 머리 착수 순서 표 + §2 실승차 행(spec §8.3) + 판정 ④ 나 편승 항목, `docs/FIELD-TEST.md` §6-3 행, `CHANGELOG.md`, `PROGRESS.md` 여정 자리 한 줄.
- 계획 §3 리베이스·`comm` 비교·생성 파일 재생성·게이트·push·완료 보고.
