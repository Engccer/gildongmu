# E70 첫 판 구현 계획: 택시 → 대중교통 → 택시 여정

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 길찾기 화면에서 갈아탈 역(최대 둘)을 지정해 택시 + 대중교통 + 택시 여정을 한 번에 조회하고, 앱 수명 안내 세션 위에서 단계를 이어 안내한다(iOS 실험판 전용).

**Architecture:** 서버 새 라우트 `/api/route/journey`가 ODsay 후보 전체(선정 전) 위에서 지정 역 경로를 판정하고, 자르기·출구 수집(카카오)·택시 조회(Tmap, 팬아웃 전 호출 수 예약)를 조립한다. Kit에 응답 디코딩과 순수 전이 함수 `journeyStep`을 두고, 앱 `GuideSession`이 여정 상태를 소유해 단계 세션(자동차 승객·도보 chained·대중교통)을 `startJourneyStage` 한 입구로 잇는다.

**Tech Stack:** Next.js 16 Route Handler · zod 4 · Vitest 4 / Swift(GildongmuKit, Swift Testing) · SwiftUI 앱

**Spec:** `docs/superpowers/specs/2026-10-17-e70-mode-change-journey-design.md`(판정 1~17, 문안 §8.4, 순서 §12). 판정 정본은 `docs/BACKLOG.md` E70.

**위임/inline 판정:** 과제 1·2(서버 순수·provider 분리)와 4(Kit)는 파일이 겹치지 않고 아래 인터페이스로만 이어져 sonnet 서브에이전트에 위임한다(1·2·4 병렬, 커밋은 부모가). 과제 3(라우트 조립·실호출 게이트)은 1·2의 결과를 묶고 외부 호출 예산을 쥐므로 inline. 과제 5~7은 같은 파일(`DirectionsTabView`·`GuideSessionCoordinator`·`BeaconModel`)을 순차로 고치므로 inline.

## Global Constraints

- 여정 조회는 ko 전용(`lang` 미지정 또는 `ko`, 그 밖은 400). iOS는 `AppLanguage.dataLocale == "ko"`일 때만 역 지정 버튼을 그린다(D2).
- 기존 `/api/route/*` 응답 바이트 동일. `getTransitRoute` 재구성은 골든 스냅샷이 잠근다.
- 좌표 파라미터는 경로 라우트 관례 `coordSchema`("위도,경도" 한 쌍, `route-coord-schema.ts`): `origin`·`dest`·`board`·`alight` + `boardName`·`boardLine`·`alightName`·`alightLine`. (spec §4.1의 lat/lng 분리 표기 대신 형제 라우트 `/api/route/car`·`/transit`과 같은 계약 — 같은 안전 파싱이고 Kit `coordPair`를 그대로 쓴다.)
- `JOURNEY_STATION_IDENTITY_M = 500`, 접근 도보 문턱 30m, 인계 지연 600ms, 사이 상태 복귀 상한 30초, 한 조회 Tmap 상한 8, IP 버킷 60초 16회(호출 수), 인스턴스 일 상한 200(KST), 출구 예선 그룹당 5, 출구 질의 n ≤ 25·3연속 미발견 중단·반경 800m·첫 묶음 n=1..8 병렬, 승강장 질의 반경 500m·하차역 300m 안 최근접 하나.
- 카카오 질의는 `next: { revalidate: 300 }` 숫자 리터럴(`kakao-cache-ttl.test.ts`), 래퍼 캐시 없음. Tmap 택시는 캐시 없음.
- 문안은 spec §8.4 확정본 그대로(키 이름은 `ios.journey.*`). 「역」으로 끝나는 이름은 `{station}`에 넣기 전 표시용 함수로 「역」 한 글자를 뗀다.
- iOS 입구·결과·`startJourney` 호출은 전부 `AppConfig.experimentalJourneyEnabled`(`#if EXPERIMENTAL`) 안.
- 안전 인자 기본값 금지: `StartRequest.carListener`, `markChained` 인자, Kit `journey(...)` 인자.
- 공개 저장소 규율: 자택 근처 역·위원장 실조회 구간(종로행·여의도행·부천 왕복의 실제 출발지 포함)을 테스트·fixture·스크립트·커밋에 싣지 않는다. 표본은 아현·광화문·신촌·서울역·수원·강남·잠실 같은 일반 역.
- ODsay 실호출 이 세션 10건 상한(원장 `~/gildongmu-wt/e70-impl-reports/odsay-ledger.tsv`), 저장본 재분석 우선.

## Review Focus

1. **역 이름이 「역」으로 끝나는 장소(서울역)**: 표시 문장에 「서울역역」이 나오지 않고, 이름 키·카카오 출구 질의(`서울역 1번출구`)도 「역역」이 되지 않는다 → 과제 2 `displayStationName`·과제 3 질의 빌더 테스트.
2. **노선 표기가 소스마다 다른 환승역**(`수도권2호선`·`수도권 2호선`·`2호선`, `수도권 수인.분당선`·`수인분당선`): 같은 노선으로 판정하고 `1호선` ↔ `11호선`은 다르다 → 과제 2 `sameLine` fixture.
3. **ODsay 경로의 첫·마지막 탈것이 버스**인 변형(추천이 버스로 시작·끝): 지정 역 판정에서 탈락하고, 출구 수집을 하지 않으며(`egress` 부재 → 택시 뒤 출발 = 하차 정류 좌표, kind `none`), 제목은 버스 키 → 과제 2·3·5 테스트.
4. **사용자가 택시 단계에서 「택시에서 내렸어요」를 누른 직후 자동 도착 판정이 같은 seq로 도착**: 전이는 한 번만 → 과제 4 `journeyStep` 경쟁 테스트 + 과제 6 소스 가드(버튼이 토큰을 실어 보낸다).
5. **여정 중 길찾기 탭에서 다른 안내 시작·정밀 위치 재시작**: `guide.alreadyActive` 거부, `beacon.restart()` 미호출 → 과제 6 소스 가드(`isOccupied` 사용 자리 셈).

---

### Task 1: ODsay 후보 진입점 분리 + 바이트 동일 골든 (위임, sonnet)

**Files:**
- Modify: `src/lib/providers/odsay.ts`(`getTransitRoute` 593~667)
- Create: `src/lib/providers/__tests__/odsay-golden.test.ts`, `src/lib/providers/__tests__/fixtures/odsay-golden/*.json`(입력 셋 + 골든 출력)

**Interfaces:**
- Produces: `export async function getTransitCandidates(params: { origin: Coord; dest: Coord; includeStops?: boolean; lang?: "ko" | "en"; modeAxis?: TransitModeAxis }): Promise<{ ranked: TransitRoute[] } | null>` — 지금 `getTransitRoute`의 조회·en 재조회·정규화·수단 거르기·강등까지. null = 경로 없음, throw = 조회 실패.
- `getTransitRoute`는 `getTransitCandidates` + (modeAxis면 `ranked[0]`) + `annotateHighlights(selectTransitRoutes(ranked), ranked)`로 다시 쓴다. 시그니처·주석 계약 불변.

- [ ] **Step 1: 골든 입력 마련** — 공개 가능한 응답 셋을 `fixtures/odsay-golden/`에 복사: `~/gildongmu-wt/e70-design-reports/odsay-samples/`의 `searchPubTransPathT__EX=126.9764__EY=37.5716__OPT=0__SX=126.9561__SY=37.5574.json`(아현→광화문), 같은 쌍 `__SearchPathType=1.json`, `EX=126.9721__EY=37.5560__…SX=126.9421__SY=37.5597.json`(신촌→서울역). ⚠ `EX=126.7831` 파일은 쓰지 않는다(실조회 구간).
- [ ] **Step 2: 골든 생성(리팩터 전 코드로)** — 테스트는 `fetch`를 stub해 파일 응답을 주고, `bus-service-hours`·`subway-service-hours`·`odsay-express-stops`를 빈 Map으로 mock, `kstNowMinutes`가 들어가는 `annotateServiceStatus`의 시각은 `vi.setSystemTime(new Date("2026-10-20T01:00:00Z"))`로 고정. 경우: 표본 2쌍 × `includeStops` {false, true} + 아현→광화문 `modeAxis: "subwayOnly"`(SearchPathType=1 파일). 출력 `JSON.stringify(result, null, 2)`를 `toMatchFileSnapshot("fixtures/odsay-golden/<이름>.out.json")`. 리팩터 전 코드로 한 번 돌려 골든을 쓰고 커밋 대상에 넣는다.
- [ ] **Step 3: 실행 — 골든이 생기고 통과** — `npx vitest run src/lib/providers/__tests__/odsay-golden.test.ts` → PASS(골든 5개 생성).
- [ ] **Step 4: `getTransitCandidates` 추출, `getTransitRoute` 재구성** + 같은 파일에 `getTransitCandidates` 단위 테스트 한 건(아현→광화문 includeStops: `ranked.length === 원본 path 수`, 각 탈것 leg에 `stops`).
- [ ] **Step 5: 골든·기존 ODsay 테스트 통과** — `npx vitest run src/lib/providers/__tests__ src/lib/__tests__/odsay` → PASS, 골든 파일 diff 0(`git diff --stat -- src/lib/providers/__tests__/fixtures/odsay-golden` 비어 있음).
- [ ] **Step 6: 개인 corpus 재생(커밋 안 함)** — 스크래치 스크립트로 `~/gildongmu-private/probes/odsay-alternatives-2026-09-24/*.json` 각각을 리팩터 전 커밋(base)과 후 코드로 같은 mock 조건에서 돌려 JSON 동일을 확인, 결과(파일 수·불일치 0)만 보고한다.

### Task 2: 여정 순수 계층 (위임, sonnet)

**Files:**
- Create: `src/lib/journey/station-identity.ts`, `designated.ts`, `trim.ts`, `egress.ts`, `budget.ts`, `display.ts`, `types.ts` + `src/lib/journey/__tests__/*.test.ts` + `src/lib/__tests__/fixtures/journey-line-names.json`
- Modify: `src/lib/types.ts`(아래 Journey 타입을 `export`)

**Interfaces (Produces):**
- `src/lib/types.ts`: spec §4.7 그대로 `JourneyResult`·`JourneyVariant`·`EgressOption` + `JourneyStationInput { name: string; coord: Coord; line?: string }`. ⚠ `EgressOption`에 `placeName: string`을 더한다(카카오 `place_name` 원문 `"아현역 3번출구"`·`"서울역택시승강장"`, `none`이면 `""`) — 출구 도보 세션의 목적지 라벨(D8 「출구 번호가 주인공」)이 확정 문안 밖 새 문장 없이 데이터 이름으로 선다.
- `station-identity.ts`: `JOURNEY_STATION_IDENTITY_M = 500`; `sameLine(a: string, b: string): boolean`; `isSameStation(stop: { name: string; lat: number; lng: number; lineName?: string }, input: JourneyStationInput): boolean`.
  - `sameLine`: 두 쪽 모두 `subwayLineKey`(`subway-line-names.ts`)의 key로 `subwayLineNameEn` 표 값이 있으면 그 값끼리 비교. 아니면 지역 접두(`수도권|부산|대구|광주|대전`, 접두 뒤 공백 허용)와 공백·`.`·`·`를 걷어 `lineHintMatches`.
  - `isSameStation` = `normalizeStationName` 키 같음 ∧ Haversine(`geo.ts`) ≤ 500 ∧ (`input.line` 있고 `stop.lineName` 있으면 `sameLine`).
- `designated.ts`: `firstVehicle(route) / lastVehicle(route): TransitLeg | undefined`; `legEndStop(leg, "board" | "alight"): TransitLegStop | undefined`(`stops[0]` / `stops[stops.length-1]` — ODsay `startX/Y`·`endX/Y`와 같은 정류 좌표, `includeStops` 필수); `matchesBoard(route, A)`·`matchesAlight(route, B)`(첫/마지막 탈것 `mode === "subway"`·stop 있음·`isSameStation`); `findDesignated(ranked, { board?, alight? }): TransitRoute | null`(양쪽 지정 쪽 전부 만족하는 첫 경로); `missingSide(pools: TransitRoute[][], { board?, alight? }): "board" | "alight" | "both"`(spec §3.2: 승차만 맞는 후보 있으면 `"alight"`, 하차만 있으면 `"board"`, 그 밖 `"both"`; 한쪽만 지정이면 그쪽).
- `trim.ts`: `trimJourneyTransit(route, { trimBoard: boolean; trimAlight: boolean }): TransitRoute` — 첫 탈것 앞 도보 leg들 / 마지막 탈것 뒤 도보 leg들 제거, `summary.totalMinutes`·`walkMinutes`에서 뗀 도보 `minutes` 합만 빼고(0 하한), `departName`/`arriveName`은 첫/마지막 탈것 `fromName`/`toName`. `routeKey`·`fare`·`transfers`·`walkMeters`는 유지(walkMeters는 정의상 총 도보라 뗀 거리를 알면 뺀다: 뗀 leg `distanceMeters` 합, 모르면 키 삭제 — 모름을 틀린 값으로 남기지 않는다).
- `egress.ts`:
  - `parseExitDoc(doc: KakaoLocalDocument, stationDisplay: string): { label: string; lineName?: string; coord: Coord } | null` — 카테고리 끝 `지하철출구` ∧ 이름이 `${stationDisplay}역`으로 시작, 나머지에서 `(노선)? (\d+(-\d+)?)번\s*출구`.
  - `exitsForLine(exits, alightLine: string | undefined)` — spec §4.4 노선 거르기(표기 없는 출구는 전부 무표기일 때만).
  - `prefilterExits(exits, to: Coord, k: number)` — `to`까지 직선 오름차순 k개(안정).
  - `pickStand(docs, alightCoord): { label: string; coord: Coord } | null` — 이름에 「택시」, 하차 좌표 300m 안 최근접.
  - `chooseFastest(options: Array<{ option: EgressOption; walkFromStopM: number }>): EgressOption | null` — `taxiOut.durationSeconds`를 분(반올림)으로 비교, 동점은 `walkFromStopM` 짧은 쪽.
- `budget.ts`: `JOURNEY_CALL_CAP = 8`; `planTaxiCalls(input: { taxiInDests: Coord[]; groups: Array<{ exits: ExitCand[]; stand: Cand | null; fallbackStop: Coord | null }>; to: Coord }): { taxiIn: Coord[]; groups: Array<{ starts: Array<{ kind; label; lineName?; coord }> }>; cost: number }` — 좌표 4자리 키로 중복 제거, `fallbackStop`은 출구·승강장이 없거나 카카오 실패 그룹의 하차 좌표. 8을 넘으면 출구만 줄인다: 남은 칸 = 8 − taxiIn 수 − 승강장·fallback 수, 그룹 [0](기본 변형)이 `ceil(남은/그룹수)`, 나머지 `floor`, 각 그룹은 `min(그 몫, 5)`개를 `prefilterExits`로. cost = 유일 좌표 수.
- `display.ts`: `displayStationName(name: string): string` — 괄호 부기 유지, 후행 노선 토큰 제거(`stripStationSuffixKeepParens`), 끝 「역」 한 글자 제거(이름이 「역」 하나면 유지). `서울역`→`서울`, `아현역 2호선`→`아현`.

- [ ] **Step 1: 노선 표기 fixture** — `journey-line-names.json`: `[{ a, b, same }]` — 카카오 카테고리 끝 조각(`수도권2호선`·`경의중앙선`·`수인분당선`·`신분당선`·`공항철도`·`수도권1호선`·`9호선`) × ODsay `lineName`(`odsay-lane-names-observed.json`의 값에서 고른다: `수도권 2호선`·`수도권 수인.분당선`·`경의중앙선`·`공항철도`·`수도권 9호선(급행)`), 반례 `수도권 1호선`↔`11호선`·`2호선`↔`신분당선`. 과제 3 실호출이 카카오 쪽 표기를 확인하면 덧붙인다.
- [ ] **Step 2: 실패하는 테스트** — 파일별:
  - `station-identity.test.ts`: fixture 전수; 신촌 반례(`{ name: "신촌역", coord: 경의중앙선 신촌 카카오 좌표 37.5597,126.9421 }` vs ODsay 2호선 신촌 정류 좌표 `stops[0]` — 신촌→서울역 골든 입력에서 2호선 신촌 승차 경로의 좌표) → false; 같은 역 복합체: 서울역 4호선 정류 ↔ 공항철도 정류 좌표(골든 입력에서) 331m 수준 → true; 잠실 2↔8호선 426m 근거는 상수 주석에.
  - `designated.test.ts`: 아현→광화문 골든 입력을 정규화(`normalizeOdsayRoutes(…, {includeStops:true})`)한 후보에서 `findDesignated(…, { board: 아현 2호선 })`의 첫 탈것 `fromName === "아현"`이고 `ranked[0]`(애오개 승차)와 다르다; 버스로 시작하는 경로는 board 불일치; `missingSide` 세 갈래.
  - `trim.test.ts`: 합성 경로(앞 도보 5분, 탈것, 거리 0·3분 환승 통로(이미 legs에서 빠짐 → summary에만), 탈것, 뒤 도보 4분, total 40, walk 12) → `trimBoard+trimAlight`: total 31, walk 3, legs 둘(탈것만), `routeKey` 유지.
  - `egress.test.ts`: `"노량진역 1호선 9번출구"`→label 9·line `1호선`; `"강남역 3-1번출구"`→`3-1`; 카테고리 `지하철출구` 아님→null; 다른 역 이름(`"노량진수산시장 …"`)→null; 노선 거르기 세 경우; 동점 규칙.
  - `budget.test.ts`: taxiIn 2 + 두 그룹(같은 역·다른 노선, 각 출구 7·승강장 1, 승강장 좌표 같음) → cost ≤ 8, 그룹 출구 섞이지 않음, 승강장 1회만 계산; 출구 0·카카오 실패 그룹 → fallback 1칸.
  - `display.test.ts`: `서울역`→`서울`, `아현`→`아현`, `역`→`역`, `천호(풍납토성)역`→`천호(풍납토성)`.
- [ ] **Step 3: 실행 → FAIL(모듈 없음)** — `npx vitest run src/lib/journey`.
- [ ] **Step 4: 구현** (위 시그니처 그대로, React·Next 비의존).
- [ ] **Step 5: 실행 → PASS** + `npx tsc --noEmit -p .`는 부모가 게이트에서 돌린다.

### Task 3: 카카오 출구·승강장 provider, 레이트 리밋, 라우트 조립, 실호출 게이트 (inline)

**Files:**
- Modify: `src/lib/providers/kakao-local.ts`, `src/lib/rate-limit.ts`, `src/lib/env.ts`(필요 시 게이트 조합 함수만)
- Create: `src/lib/journey/assemble.ts`, `src/app/api/route/journey/route.ts`, `scripts/verify-journey-exits.mjs`, 테스트 `src/lib/journey/__tests__/assemble.test.ts`, `src/lib/__tests__/rate-limit-reserve.test.ts`, `src/app/api/route/journey/__tests__/route.test.ts`

**Interfaces:**
- Consumes: 과제 1 `getTransitCandidates`, 과제 2 전부, `getCarRoute`(`car-route.ts`).
- Produces:
  - `buildKakaoRadiusSearchUrl(query: string, coord: Coord, radius: number): URL`; `searchSubwayExitsKakao(stationDisplay: string, coord: Coord): Promise<KakaoLocalDocument[]>`(n=1..8 병렬 → 발견이 이어지면 다음 8개, 3연속 미발견 중단, n ≤ 25); `searchTaxiStandsKakao(stationDisplay: string, coord: Coord): Promise<KakaoLocalDocument[]>`(`"{역}역 택시승강장"`·`"택시승강장"` 반경 500). 둘 다 `next: { revalidate: 300 }`, HTTP 실패 throw.
  - `rate-limit.ts`: `reserveCalls(store, key, now, cost, limit, windowMs): boolean`(모자라면 무기록 거절); `reserveJourneyTmap(ip: string, now: number, cost: number): "ok" | "rateLimited" | "budgetExhausted"`(일 상한 200 KST 먼저 판정(무기록) → IP 16/60초 예약 → 일 카운터 커밋).
  - `assemble.ts`: `getJourney(req: { from: Coord; to: Coord; board?: JourneyStationInput; alight?: JourneyStationInput }, deps: JourneyDeps, reserve: (cost: number) => "ok" | "rateLimited" | "budgetExhausted"): Promise<JourneyOutcome>` — `JourneyOutcome = { kind: "ok"; result: JourneyResult } | { kind: "rateLimited" } | { kind: "budgetExhausted" }`; 오류는 throw(라우트가 502). `JourneyDeps = { candidates: typeof getTransitCandidates; car: (o: Coord, d: Coord) => Promise<CarRouteBriefing>; exits: typeof searchSubwayExitsKakao; stands: typeof searchTaxiStandsKakao }`.
  - 라우트: `GET /api/route/journey?origin&dest&board&boardName&boardLine&alight&alightName&alightLine&lang`. 순서: 파싱(400: board·alight 둘 다 없음, 이름 없는 좌표, `lang`이 ko 아님) → `isInKorea` 전부(밖이면 200 `{outOfCoverage:true}`) → 키 게이트 `hasOdsayKey() && hasTmapKey() && hasKakaoKey()`(503) → `getJourney`(429 / 503 `{budgetExhausted:true}` / 502) → 200 `NextResponse.json(result, { headers: { "Cache-Control": "no-store" } })`. `export const dynamic = "force-dynamic"`.

`getJourney` 파이프라인(spec §4.2, 순서가 계약): ① `candidates({ origin: board?.coord ?? from, dest: alight?.coord ?? to, includeStops: true })` → null이면 `{ variants: [] }`. ② `findDesignated(ranked)`; 없으면 `candidates({ …, modeAxis: "subwayOnly" })` 위에서 한 번 더(호출 실패는 throw 그대로). 그래도 없으면 `designatedMissing = { side: missingSide([ranked, subwayRanked]) }`. ③ `recommended = selectTransitRoutes(ranked)[0]`(`odsay-select.ts`), designated와 `routeKey` 같으면 변형 하나(`kind: "designated"`). 변형 순서 [designated, recommended]. ④ `trimJourneyTransit(…, { trimBoard: !!board, trimAlight: !!alight })`. ⑤ 출구: alight 지정 ∧ 마지막 탈것 subway인 변형마다 하차역 이름 키별로 카카오 원시 수집 1회(실패는 그 역 `lookupFailed`) → `(하차역, 노선)` 그룹으로 `parseExitDoc`·`exitsForLine`·`pickStand`. ⑥ `planTaxiCalls` → `reserve(cost)` → 거절이면 즉시 반환(Tmap 0회). ⑦ Tmap 병렬: 택시 앞(변형별 첫 탈것 승차 stop 좌표, 같은 좌표 1회) 실패 → throw(502), 택시 뒤 후보 실패 → 그 후보만 제외, 그룹 전부 실패 → throw. ⑧ 조립: `egress.options = [chooseFastest(exits), stand?]` 또는 `[none]`, `totals.minutes = round(taxiIn.durationSeconds/60) + transit.summary.totalMinutes + round(options[0].taxiOut.durationSeconds/60)`, `taxiFare = taxiIn.taxiFare + options[0].taxiOut.taxiFare`, `transitFare = transit.summary.fare`. alight 미지정 변형은 `egress` 부재, board 미지정 변형은 `taxiIn` 부재. `boardStation`/`alightStation`은 실제 첫/마지막 탈것 stop(이름·좌표).

- [ ] **Step 1: 실패하는 테스트**:
  - `rate-limit-reserve.test.ts`: `reserveCalls` 16 한도에 8+8 허용·9번째 1회 거절·거절 시 count 불변·창 만료 뒤 리셋; `reserveJourneyTmap` 일 200 도달 시 `budgetExhausted`이고 IP 버킷 무기록, KST 자정(UTC 15:00) 넘으면 리셋.
  - `assemble.test.ts`(deps 가짜): 변형 하나/둘/못 찾음(`designatedMissing.side`), A만(택시 앞 있음·egress 없음), B만(택시 앞 없음·대중교통 앞 도보 유지), 출구 일부 실패(남은 후보로)·전부 실패(throw), 카카오 실패 → `lookupFailed: true` + kind `none` 후보, 예약 거절 → Tmap 호출 0(가짜 `car`가 호출 수를 센다), 예약 cost = 실제 `car` 호출 수, 마지막 탈것 버스 → egress kind `none`.
  - `route.test.ts`: 400 셋, outOfCoverage, 503(키), 429, 503 budgetExhausted, 200 `Cache-Control: no-store`.
  - `kakao-local` URL 빌더: `radius`·`x`/`y`(4자리)·`size=15`. `kakao-cache-ttl.test.ts`는 수정 없이 새 함수를 덮는지 실행으로 확인.
- [ ] **Step 2: FAIL 확인** → **Step 3: 구현** → **Step 4: PASS** — `npx vitest run src/lib/journey src/lib/__tests__/rate-limit-reserve.test.ts src/app/api/route/journey src/lib/__tests__/kakao-cache-ttl.test.ts src/lib/__tests__/coord-param-usage.test.ts`.
- [ ] **Step 5: 실호출 게이트 스크립트** `scripts/verify-journey-exits.mjs` — 역 10곳(공개 일반 역·목적지: 대방→여의도 IFC몰, 개봉→구로구청, 강남→코엑스, 서울→서울대학교병원, 잠실→올림픽공원, 수원→수원시청, 신도림→고척스카이돔, 홍대입구→마포구청, 사당→서울대학교, 고속터미널→예술의전당) × 하차 노선. 카카오로 출구 수집 → 노선 거르기 → 노선 거른 출구가 5 이하인 그룹은 예선이 무의미하므로 Tmap 없이 통과로 기록 → 5 초과 그룹만 전수 Tmap 대 예선 5 비교. `--out <dir>` 저장, `--from-corpus <dir>` 무호출 재분석, Tmap 호출 수 출력, 놓친 그룹이 있으면 exit 1. 위원장 실조회·자택 근처 역 금지.
- [ ] **Step 6: 실행** `node --env-file=.env.local scripts/verify-journey-exits.mjs --out ~/gildongmu-wt/e70-impl-reports/journey-exits` → 놓침 0(놓치면 spec §4.5-5대로 판정 요청 파일). 카카오·Tmap 건수 기록.
- [ ] **Step 7: 라우트 실호출 3건** — 워크트리에서 `PORT=3107 npm run dev`, `curl`로 A만(아현→광화문 방면 일반 출발지)·B만·둘 다. ODsay 건수를 원장에 적고(라우트당 ≤2), 응답을 `~/gildongmu-wt/e70-impl-reports/journey-live/`에 저장, 확인 항목: 지정 역 변형의 첫 탈것 `fromName`, 잘린 합계, 출구 라벨, 택시 시간. dev 서버 내림.

### Task 4: Kit — 여정 디코딩·조회·전이 함수·최근 경로 (위임, sonnet)

**Files:**
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/Models/RouteModels.swift`, `RouteService.swift`, `RecentSearchStore.swift`, `android/kit/mirrors/core.json`·`foundation.json`·`guide.json`(새 파일 `pending` 등재 + 수정 파일 note에 「E70 여정 필드 미이식(첫 판 iOS 실험판 전용)」)
- Create: `ios/GildongmuKit/Sources/GildongmuKit/Journey.swift`, `ios/GildongmuKit/Tests/GildongmuKitTests/JourneyTests.swift`, `JourneyModelsTests.swift`

**Interfaces (Produces):**
- `RouteModels.swift`: `public struct JourneyResult: Codable, Sendable, Hashable { variants: [JourneyVariant]; designatedMissing: JourneyDesignatedMissing? }`, `JourneyDesignatedMissing { side: JourneyMissingSide }`(`board|alight|both`), `JourneyVariant { kind: JourneyVariantKind(designated|recommended); boardStation: JourneyStationRef?; alightStation: JourneyStationRef?; taxiIn: CarRouteBriefing?; transit: TransitRoute; egress: JourneyEgress?; totals: JourneyTotals }`, `JourneyStationRef { name: String; coord: JourneyCoord }`, `JourneyCoord { lat; lng }`(기존 좌표 타입이 있으면 그것), `JourneyEgress { options: [EgressOption]; lookupFailed: Bool? }`, `EgressOption { kind: EgressKind(exit|stand|none); label: String; lineName: String?; coord; taxiOut: CarRouteBriefing }`, `JourneyTotals { minutes: Int; taxiFare: Int; transitFare: Int }`. `public enum JourneyResponse { case result(JourneyResult), outOfCoverage }`(기존 transit의 envelope 관례를 따른다).
- `RouteService.swift`: `public func journey(originLat: Double, originLng: Double, destLat: Double, destLng: Double, board: JourneyStationQuery?, alight: JourneyStationQuery?) async throws -> JourneyResponse` — `JourneyStationQuery { name: String; lat: Double; lng: Double; line: String? }`. 쿼리: `origin`·`dest`·(있으면) `board`·`boardName`·`boardLine`·`alight`·`alightName`·`alightLine`. lang 없음(ko 전용).
- `Journey.swift`:
  - `public enum JourneyStage: String, Sendable { case taxiIn, access, transit, egress, taxiOut }`
  - `public enum JourneyPhase: Equatable, Sendable { case running(JourneyStage), transitioning(to: JourneyStage), failed(at: JourneyStage) }`
  - `public struct JourneyToken: Hashable, Sendable { journeyId: UUID; seq: Int }`
  - `public struct JourneyShape: Equatable, Sendable { startsWithTaxi: Bool; alightDesignated: Bool; hasEgressWalk: Bool }`
  - `public struct JourneyState: Equatable, Sendable { journeyId: UUID; shape: JourneyShape; phase: JourneyPhase; seq: Int; var token: JourneyToken }`; `public static func start(id: UUID, shape: JourneyShape) -> JourneyState`(phase `transitioning(to: startsWithTaxi ? .taxiIn : .transit)`, seq 1)
  - `public enum JourneyStageEnd: Sendable { case arrived, userStopped, startFailed, ended }`(앱 `BeaconModel.EndReason`과 1:1)
  - `public enum JourneyEvent: Sendable { case stageEnded(JourneyStageEnd), taxiDropped, taxiBoarded, rideCompleted, transitStopped, prepared(JourneyStage), prepFailed, retry, userEnded, staleTimeout }`
  - `public enum JourneyStepResult: Equatable, Sendable { case ignore, next(JourneyState), end }`
  - `public func journeyStep(_ state: JourneyState, _ event: JourneyEvent, token: JourneyToken) -> JourneyStepResult` — token 불일치면 `.ignore`. `.next`는 언제나 seq + 1. 전이 표:

| 국면 | 사건 | 결과 |
|---|---|---|
| 어느 국면 | `userEnded` | `end` |
| running(taxiIn) | `stageEnded(.arrived)`·`taxiDropped` | transitioning(access) |
| running(taxiIn) | `stageEnded(.userStopped)` | end |
| running(taxiIn) | `stageEnded(.startFailed)`·`stageEnded(.ended)` | failed(taxiIn) |
| running(access) | `stageEnded(.arrived/.startFailed/.ended)` | transitioning(transit) |
| running(access) | `stageEnded(.userStopped)` | end |
| running(transit) | `rideCompleted` | alightDesignated면 transitioning(hasEgressWalk ? egress : taxiOut), 아니면 end |
| running(transit) | `transitStopped` | end |
| running(egress) | `stageEnded(.arrived)`·`taxiBoarded` | transitioning(taxiOut) |
| running(egress) | `stageEnded(.userStopped)` | end |
| running(egress) | `stageEnded(.startFailed)`·`stageEnded(.ended)` | failed(egress) |
| running(taxiOut) | `stageEnded(.startFailed)` | failed(taxiOut) |
| running(taxiOut) | `stageEnded(그 밖)` | end |
| transitioning(s) | `prepared(s)` | running(s) |
| transitioning(access) | `prepared(.transit)` | running(transit)(30m 미만 생략) |
| transitioning(s) | `prepFailed`·`staleTimeout` | failed(s) |
| failed(s) | `retry` | transitioning(s) |
| failed(taxiIn) | `taxiDropped` | transitioning(access) |
| failed(egress) | `taxiBoarded` | transitioning(taxiOut) |
| 그 밖 | | ignore |

  - `public func journeyNeedsAccessWalk(fromLat:fromLng:toLat:toLng:) -> Bool` — 직선 ≥ 30m(`JourneyTuning.accessWalkMinMeters = 30`). 상수 `JourneyTuning.handoffDelayMs = 600`, `staleTransitionSeconds = 30`.
  - `public func journeyStationDisplayName(_ name: String) -> String` — 웹 `displayStationName` 미러(같은 사례 테스트).
- `RecentSearchStore.swift`: `public struct RecentStation: Codable, Equatable, Hashable, Sendable { label; lat; lng; line: String? }`; `RecentRoute`에 `boardStation: RecentStation?`·`alightStation: RecentStation?` (init 인자는 `via` 뒤·`pinned` 앞, **기본값 없음** — 기존 호출부 전부 nil 명시; 관용 디코딩은 decodeIfPresent), `sameRoute`·`id`가 둘을 포함(역 키 = 좌표 4자리).

- [ ] **Step 1: 실패하는 테스트** — `JourneyTests`: 표의 모든 행(시작 셋 × 사건) + 낡은 token 무시 + 경쟁(`taxiDropped`와 `stageEnded(.arrived)`를 같은 token으로 연달아 → 두 번째 ignore) + end 뒤 사건 없음(상태가 없으므로 호출부 몫 — 대신 `userEnded`가 모든 국면에서 end) + `journeyNeedsAccessWalk` 29/31m + 표시 이름 사례. `JourneyModelsTests`: 서버 응답 JSON(과제 3 Step 7 저장본 하나를 축약해 fixture로, 없으면 spec §4.7 모양 손 JSON) 디코딩, outOfCoverage 디코딩, `RecentRoute` 구버전 JSON 디코딩(역 필드 nil)·역 포함 왕복·`id`가 역 유무로 갈림.
- [ ] **Step 2: FAIL** → **Step 3: 구현** → **Step 4: PASS** — `VITEST_MAX_WORKERS=2 python3 ~/.claude/skills/parallel-sessions/scripts/gate-lock.py e70-impl -- swift test --package-path ios/GildongmuKit --filter "Journey|RecentSearch|RouteService"`.
- [ ] **Step 5: 미러 등록부** — `npx vitest run src/lib/__tests__/mirror-registry.test.ts` PASS.

### Task 5: 앱 입력·결과 (inline)

**Files:**
- Modify: `ios/Gildongmu/AppConfig.swift`(`experimentalJourneyEnabled`, 나들이 선례 모양), `ios/Gildongmu/Directions/DirectionsTabView.swift`, `DirectionsEndpointSearchView.swift`, `ios/i18n/ios-extra/{ko,en,es,fr,it,ja}.json`(키 `ios.journey.*` — ko는 §8.4 확정본, 다른 로케일은 로케일 동조 게이트가 요구하는 만큼 번역; 여정은 ko 데이터 로케일에서만 보이므로 사용자에게 닿지 않는다) → 생성물 재생성(`node ios/scripts/messages-to-xcstrings.mjs` 등 기존 절차, `--update-arg-order`)
- Test: 소스 가드는 과제 7

**동작(spec §5):**
- 상태(DirectionsModel): `journeyExpanded: Bool`, `boardStation`/`alightStation: JourneyStationInputApp?`(`Place`에서: name, lat, lng, line = 이름 꼬리 노선 토큰(Kit에 없으면 카테고리 마지막 조각이 `…호선|…선|…철도`일 때 그 값)), `journeyResult: JourneyResult?`, `journeyMissing`, `selectedVariant: Int`, `selectedEgress: [Int: Int]`.
- 버튼 「택시로 갈아탈 역 정하기」(경유지 행 다음, `experimentalJourneyEnabled ∧ dataLocale == "ko"`), 펼치면 두 칸 + 경유지 행 숨김(D14), 포커스 첫 칸. 경유지가 있으면 펼칠 때 비운다(D14 반대 방향: 경유지를 넣으면 펼친 칸을 접고 비운다).
- 역 칸 검색: 기존 시트에 `onSelectStation: ((Place) -> Void)?` 경로 — 이 경로에선 최근 끝점 목록 숨김, `stationLayoutKind(place) == nil`이면 칸에 넣지 않고 polite 「역을 골라 주세요.」.
- 조회: 역이 하나라도 있으면 `runQuery`가 여정만 조회(D12). 결과 3-state: 경로 없음(`variants` 빈 배열)은 기존 대중교통 경로 없음 문장, throw는 기존 조회 실패 문장, outOfCoverage는 기존.
- 결과 섹션(§5.2 읽기 순서, 줄마다 `joinText` 한 객체): 못 찾음 줄(side별 9/10번, both는 두 줄) → 변형 둘이면 변형별 heading(제목 키 선택 규칙 §8.4 아래 둘째 단락) + 선택 버튼(선택 trait) → 합계 줄 → 택시 앞 줄 → 기존 대중교통 구간 줄 렌더러 재사용 → 출구 줄(승강장 있으면 두 버튼, 없으면 한 줄; `lookupFailed`/`none` 문장) → [안내 시작](기존 키). 착지: 변형 둘이면 첫 heading, 아니면 합계 줄.
- 안내 시작: `if AppConfig.experimentalJourneyEnabled { GuideSession.shared.startJourney(plan:) }` — plan은 과제 6 `JourneyPlan`.
- 최근 경로: 여정 조회 성공 시 역 포함 기록, 최근 경로 라벨에 역 이름을 덧붙이는 기존 `recentRoutes.itemVia` 같은 새 문장은 만들지 않는다 — 라벨은 그대로(출발·도착), 복원 시 칸을 채우고 펼친다.

- [ ] Step 1: 플래그·문안 키·생성물 → Step 2: 모델 상태·조회 → Step 3: 입력 UI → Step 4: 결과 UI → Step 5: 앱 빌드 Experimental·Release(`xcodebuild … -derivedDataPath ~/gildongmu-wt/e70-impl-dd`, gate-lock) 성공 → Step 6: 커밋.

### Task 6: 앱 세션 이어짓기 (inline)

**Files:** `GuideSessionCoordinator.swift`, `BeaconModel.swift`, `TransitGuideModel.swift`, `BeaconTrackingSheet.swift`, `TransitTrackingSheet.swift`, `JourneySheet.swift`(새), `GildongmuApp.swift`(인계 클로저·시트 item 자리·띠바 요약의 journey 경우만)

**Interfaces (Produces):**
- `GuideScreenKind`에 `.journey`. `GuideSession`: `private(set) var journey: JourneyState?`, `private(set) var journeyPlan: JourneyPlan?`, `private(set) var journeyFailure: (key: String, resolution: BeaconModel.FailResolution)?`, `var isOccupied: Bool { isActive || journey != nil }`, `func startJourney(plan: JourneyPlan)`, `func journeyAction(_ event: JourneyEvent)`(시트 버튼 — 지금 token을 실어 `advanceJourney`), `func advanceJourney(_ event: JourneyEvent, token: JourneyToken)`, `private func startJourneyStage(_ stage: JourneyStage, token: JourneyToken)`, `private func beginBeacon(_:)`·`beginTransit(...)`.
- `struct JourneyPlan { variant: JourneyVariant; egress: EgressOption?; destLabel: String; destRoman: String?; dest: BeaconDest; accessible: Bool }`(shape는 여기서 유도: startsWithTaxi = `taxiIn != nil`, alightDesignated = `egress != nil` 또는 변형에 `egress`, hasEgressWalk = 고른 option.kind != .none).
- `BeaconModel`: `StartRequest.carListener: CarListener?`(기본값 없음, nil = 설정값), `private(set) var journeyChain: JourneyChainMark?`(`{ token: JourneyToken; arrivalText: String? }`), `func markChained(token: JourneyToken, arrivalText: String?)`, `private(set) var lastFailure: (key: String, resolution: FailResolution)?`, 판정 `endsWithoutScreen = prewalkTarget != nil || journeyChain != nil`를 확정·추정 도착·`stopLeavingSummary`·세션 안전망 가드(`prewalkTarget == nil` 자리)에 쓴다. chained 도착 문장 = `arrivalText ?? guide.arrived`.
- `TransitGuideModel`: `var onJourneyRideCompleted: (() -> Void)?`, `var onJourneyStopped: (() -> Void)?` — `completeOrAdvance`의 `.done` 갈래: ride 콜백이 있으면 `onJourneyStopped = nil` → `stop()` → 콜백(그리고 `pendingWalkHandoff`를 세우지 않는다), 없으면 지금 경로. `stop()` 말미: `onJourneyStopped`가 있으면 비우고 부른다. `var journeyNextIsWalk: Bool?`(시트 마지막 leg 라벨용, nil = 여정 아님).

**코디네이터 동작(spec §6):**
- `startJourney`: `refuseIfActive()`(→ `isOccupied`) → 잔여 화면 소거(startTransit과 같은 셋) → `journey = .start(...)` → `prepare(stage, token)`.
- `advanceJourney`: `journeyStep` 동기 → `.end`면 `teardownJourney(stopSessions: event가 userEnded일 때만)`; `.next`면 커밋 후 새 phase가 `transitioning(s)`면 `prepare(s)`, `running(s)`면 `startJourneyStage`, `failed`면 `journeyFailure`를 `beacon.lastFailure`에서(사유 `.ended`일 때만) 기록. 버튼 사건(`taxiDropped`·`taxiBoarded`)은 커밋 뒤 단계 세션을 멈춘다(`beacon.stop()` — 그 콜백은 낡은 token이라 무시된다).
- `prepare(s)`: 보관 `journeyTask` 하나 — 600ms 대기(`taxiIn` 첫 시작은 대기 없음) → `access`면 현재 위치(`LocationService.shared` 최신 fix, 없으면 force 측위 3분 상한)로 `journeyNeedsAccessWalk` → `prepared(.access)` 또는 `prepared(.transit)`; 측위 실패면 `prepared(.access)`(걷기 안내가 판정하게). 그 밖은 `prepared(s)`. 완료 시 token 일치 확인.
- `startJourneyStage(s, token)`: token == 지금 ∧ `!beacon.isTracking && !beacon.starting && !transit.isTracking` 아니면 return. taxiIn/taxiOut: `beacon.markChained(token, arrivalText: taxiIn ? 「{station}역에 도착했습니다.」 : nil)`(taxiOut은 chained 아님 — markChained 안 함, 대신 `onSessionEnd`에서 startFailed만 failed, 그 밖 end) + `onSessionEnd = { advanceJourney(.stageEnded(map), token) }` + `beginBeacon(kind: .car, carListener: .passenger, dest: taxiIn은 첫 탈것 승차 stop 좌표 / taxiOut은 도착지, label: 역 표시 이름+「역」 / 도착지 라벨)`. access: markChained(arrivalText: 「{station}역에 도착했습니다.」) + 도보 dest = 승차 stop. transit: `transit.onJourneyStopped = { advanceJourney(.transitStopped, token) }`, B 지정이면 `onJourneyRideCompleted = { advanceJourney(.rideCompleted, token) }` → `beginTransit(route: variant.transit, …)`; prewalk(A 미지정)는 그대로. egress: markChained(nil) + 도보 dest = option.coord, label = `option.placeName`(카카오 POI 이름 — 새 문장 없음).
- `endPrewalk`의 `.userStopped/.ended`: 여정 running(transit)이면 `advanceJourney(.transitStopped, token)`.
- `screen`: 비콘·나들이·대중교통 다음에 `journey`가 transitioning/failed면 `.journey`.
- 복귀(`handleScenePhaseChange(.active)`): transitioning이 30초 넘었으면 `staleTimeout`.
- `startBeacon`·`startTransit`·`startOuting`의 거부는 `isOccupied`. 길찾기 탭의 `beacon.restart()` 호출 자리는 `!GuideSession.shared.isOccupied` 조건.
- 시트: `BeaconTrackingSheet`에 `journeyButton: (label: String, action: () -> Void)?`(taxiIn → 「택시에서 내렸어요」, egress → 「택시에 탔어요」), `TransitTrackingSheet`의 `handoffNow`가 여정이면 `journeyNextIsWalk`로 라벨(egress 다음 → `transitGuide.walkHandoffStart`, taxiOut 다음 → `journey.taxiBoarded`) — 동작은 `model.advance()`(콜백이 다음 단계). `JourneySheet`: 상태 문장(transitioning = 기존 진행 문장 「경로를 찾는 중입니다.」 키, failed = 원인 키 또는 `journey.taxiOutFailed`/`journey.egressStartFailed`) + failed면 해결 수단 버튼(기존 설정·정밀 위치 키)·[다시 시도](기존)·단계 버튼 + [안내 종료](기존) → `journeyAction(.userEnded)`. 착지는 상태 문장.

- [ ] Step 1: BeaconModel(StartRequest 필드 + 호출부 nil 명시, markChained, lastFailure, endsWithoutScreen) → Step 2: TransitGuideModel 콜백 → Step 3: GuideSession(begin* 분리, journey 상태·전이·prepare·startJourneyStage, isOccupied) → Step 4: 시트 셋 + GildongmuApp → Step 5: 두 구성 앱 빌드 → Step 6: 커밋.

### Task 7: 가드·문서 (inline)

**Files:** `src/lib/__tests__/guidance-gate-drift.test.ts`, 새 `src/lib/__tests__/journey-session-guard.test.ts`, `docs/INTEGRATIONS.md`(새 절 「여정 조립과 출구 수집」), `docs/BACKLOG.md` E70, `docs/FIELD-TEST.md`(spec §11 다섯 항목), `CHANGELOG.md`, `PROGRESS.md`

- [ ] **guidance-gate-drift 갱신**: `ENTRY_CALL`에 `beginBeacon(`·`startJourney(` 포함, 수치 갱신(어느 자리가 늘었는지 주석); `self.startBeacon(` 4 → 형태 변경 반영; `beginBeacon(`·`beginTransit(`의 호출자는 `startBeacon`·`startTransit`·`startJourneyStage`·(prewalk·인계 내부)만; `GuideSession.shared.startJourney(` 호출은 `DirectionsTabView.swift` 하나이고 `enclosingHeaders`에 `AppConfig.experimentalJourneyEnabled`.
- [ ] **journey-session-guard**: `refuseIfActive` 본문이 `isOccupied`; `beacon.restart()` 호출 자리 머리말에 `isOccupied`; `TransitGuideModel`의 `phase == .done` 비교가 `completeOrAdvance` 한 곳이고 그 본문이 `onJourneyRideCompleted`를 부른다; `StartRequest(` 생성 자리 전부가 `carListener:`를 적는다(앱 iOS 전체 셈 = 생성 수); 여정 자동차 시작이 `.passenger`를 넘긴다; `startJourneyStage` 본문이 token 비교와 세션 부재 셋을 검사한다.
- [ ] 변이 주입(커밋 뒤): `isOccupied` → `isActive`로 바꾸면 가드가 빨갛게, `.passenger` 지우면 빨갛게, 복원.
- [ ] 문서 분배(CLAUDE.md는 손대지 않고 완료 보고에 문장).
