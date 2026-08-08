# 대중교통 실시간 길 안내 (B2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대중교통 경로의 승차 대기 → 탑승 잠금 → 하차 카운트다운 → 사용자 확인 전환을 도착 API 신호로 안내한다(웹·iOS 동시).

**Architecture:** GPS 없는 폴링 상태 머신을 신설한다(`transit-guide.ts` ↔ Kit `TransitGuide.swift`, 공유 fixture). 신호는 서울버스 vehId 잠금·지하철 btrainNo 잠금·지방버스 근사이고, 서버는 `/api/transit/track` 판별 union으로 봉투 차이를 흡수한다. ODsay `passStopList`는 `includeStops=1` 옵트인으로 노출한다. 기존 지하철 실시간 조회의 부역명 결함(§6.3)을 선행 수정한다.

**Tech Stack:** Next.js 16 / React 19 / Vitest, SwiftUI / GildongmuKit / Swift Testing. 정본: 스펙 `docs/superpowers/specs/2026-08-04-transit-guidance-design.md`(이하 §n), 조사 `docs/research/RESEARCH-2026-08-03-mode-specific-guidance.md`.

**구현 방식 판정(자율성 헌장):** inline. 근거 — 상태 머신 계약이 훅·모델·UI 전부의 인터페이스를 정의하는 강한 순차 의존이고, 공유 fixture·`types.ts`·`odsay.ts`를 여러 태스크가 연쇄 수정하며, T0 실호출 결과가 T2·T5의 계약을 바꾼다(탐색적). 리뷰는 묶음별 독립 서브에이전트(스펙+diff만 전달)로 분리한다.

## Global Constraints

- **ko 데이터 로케일 전용**(§2). 비한국어는 시작 버튼 미노출.
- 낭독 정본은 도착 API 완성 문장. 문맥은 독립 문장 병치, 문법 결합·재조합 금지(§2). 변화 감지는 원문·구조 필드로만.
- **leg 전환은 사용자 확인**: riding→arrived는 신호, arrived→다음 leg는 "다음 구간" 버튼(§4.2). 지방버스는 arrived 전이 자체가 없다(§5.2).
- 신호 상태는 배타 enum(tracking·notYetVisible·signalLost·upstreamFailed·untrackable), empty와 upstream 오류를 절대 뭉개지 않는다(§4.2·§7).
- 잠금은 복합 키(provider·노선·방향·식별자 원문), 식별자 문자열 무변형(§4.2).
- 폴링은 세션당 단일 비행 + `seq`·`phaseGen` 커밋(§4.2). 세션 폴링 캡 240콜(§7).
- 통지: polite 단일 채널, 예외는 잔여 1·도착만 interrupting. 게시 전 코얼레싱(supersede)(§6.1).
- `/api/route/transit` 미지정 응답 byte-호환(스키마 스냅숏), CLI/MCP 무변경(§2·§7).
- 세션 단일성: 도보·자동차·대중교통 통틀어 플랫폼당 1개(§3.2).
- 커밋 규율: 의도 파일 pathspec 커밋, 기능+테스트 동커밋, 한국어 커밋 메시지. i18n 키는 6로케일 동시 + `node ios/scripts/messages-to-xcstrings.mjs all` 재생성.

---

### Task 0: 실호출 프로브 (계약 확정 — 코드 작성 전)

**Files:** 스크래치 전용(레포 밖). 결과는 이 플랜 실행 로그와 PROGRESS(마일스톤 종결 시)에 기록.

- [ ] **Step 1: 서울버스 `getArrInfoByRoute` 실호출** — 임의 노선(천호역 인근 정류소)으로 `stId`·`busRouteId`·`ord` 조합 호출. 확정할 것: `staOrd`·`sectOrd` 필드 존재, `vehId1/2` 슬롯 모양, 도착 종결 상태의 `arrmsg` 문장 원문(§4.2 arrived 트리거), `ord` 파라미터가 `getStaionByRoute`의 `seq`와 일치하는지.
- [ ] **Step 2: 승차→하차 vehId 조인 재현** — 승차 정류소 `getStationByUid`의 `vehId1`이 몇 분 뒤 하차 정류소 `getArrInfoByRoute`의 `vehId1/2`로 나타나는지 1회 재현(조사 §1.1 재확인).
- [ ] **Step 3: 부역명 회귀 행렬(§6.3)** — `realtimeStationArrival`에 {천호, 천호(풍납토성), 군자, 군자(능동), 강동, 양평, 왕십리} 각각 조회해 INFO-200/정상 표를 만든다. 이 표가 T1의 폴백 설계 근거다.
- [ ] **Step 4: ODsay passStopList 실호출** — 천호→강남 경로에서 `passStopList.stations[]` 필드(이름·x·y·`localStationID`·`arsID`·`stationID`) 확정 + 지방 경로 1건(대전 등)으로 `localStationID` ↔ TAGO `nodeId` 일치 여부 판정(§5.2 직결 가능성).
- [ ] **Step 5: 열차 선택 목록 실데이터** — 천호(풍납토성)·강남(2호선 내선/외선 확인용 역 포함) 도착 목록에서 `btrainNo`·`updnLine`·`trainLineNm`·`bstatnNm`·`btrainSttus` 원문 채집. 방면 판정기(§5.1)와 내선/외선 ↔ `serviceWayCode` 대응 확정.
- [ ] **Step 6: 결과를 아래 태스크의 미확정 지점에 반영**(계약이 어긋나면 스펙 §11 절차대로 스펙 갱신 먼저).

### Task 1: 지하철 조회명 정식 표기 수정 (기존 A축 결함, 분리 커밋)

**Files:**
- Modify: `src/lib/providers/seoul-subway-arrival.ts`
- Modify: `src/lib/providers/subway-nearby.ts` (조회명 해석 경유)
- Modify: `src/app/api/station/subway-arrival/route.ts` (해석 경유)
- Test: `src/lib/providers/__tests__/seoul-subway-arrival.test.ts`

**Interfaces:**
- Produces: `resolveArrivalQueryName(input: string, lineHint?: string): string`(seed 정식 표기 우선·모호 시 괄호 보존 원문), `fetchSubwayArrivals(stationName, opts?: { lineHint?: string })` — 내부에서 정식 표기 조회 → INFO-200 시 벗긴 표기 1회 재조회(§6.3 호환 폴백).
- Produces: `SubwayArrival`에 additive 필드 `trainNo?: string`(btrainNo 원문)·`arrivalCode?: string`(arvlCd 원문)·기존 `direction`(updnLine) 유지.

- [ ] **Step 1: 실패 테스트** — ①`resolveArrivalQueryName("천호")` → `"천호(풍납토성)"`(seed 매칭) ②`"천호역 5호선"` → 동일 ③seed 미매칭 `"없는역(부역명)"` → 괄호 보존 원문 ④파서가 `btrainNo`·`arvlCd`를 투영 ⑤정식 표기 INFO-200 fixture → 벗긴 표기 재조회 호출(fetch mock 2회) 검증.
- [ ] **Step 2: 구현** — 조회명 해석은 `matchStationsByName`(노선까지 확정될 때만 채택, §6.3), 표시명은 현행 `cleanName` 유지. `toArrival`에 `trainNo: str(item.btrainNo) || undefined`, `arrivalCode: str(item.arvlCd) || undefined` 추가.
- [ ] **Step 3: 기존 소비자 행동 계약 테스트** — nearby 경로가 부역명 seed 이름을 넣었을 때 정식 표기로 조회되는지(§6.3 회귀 행렬의 코드 판) + 기존 응답 스키마 additive 검증.
- [ ] **Step 4: `npm run test:run -- seoul-subway-arrival subway-nearby` green → 커밋** `fix(subway): 실시간 도착 조회를 부역명 포함 정식 표기로 (INFO-200 위장 미커버 해소)`.

### Task 2: ODsay passStopList + `/api/route/transit?includeStops=1`

**Files:**
- Modify: `src/lib/types.ts`, `src/lib/providers/odsay.ts`, `src/app/api/route/transit/route.ts`
- Test: `src/lib/providers/__tests__/odsay.test.ts`, `src/app/api/__tests__/transit-route-schema.test.ts`(신규 스냅숏)

**Interfaces:**
- Produces: `TransitLegStop { name: string; localId?: string; arsId?: string; lat: number; lng: number }`, `TransitLeg.stops?: TransitLegStop[]`(탑승 leg 한정, 양 끝 포함), `normalizeOdsayRoute(data, opts?: { includeStops?: boolean })`, `getTransitRoute(params & { includeStops?: boolean })`, 라우트 쿼리 `includeStops`(walk `includeGeometry` 선례: `"1"`만 허용, 그 외 400, 미지정 시 키 부재).

- [ ] **Step 1: 실패 테스트** — fixture(T0 Step 4 실데이터로 작성)에서 ①미지정 시 `stops` 키 부재(byte-호환) ②`includeStops` 시 탑승 leg에 양 끝 포함 stops·도보 leg 무 stops ③좌표 숫자 변환·결측 항목 필터.
- [ ] **Step 2: 구현** — `OdsaySubPath.passStopList?.stations?: Array<{stationName?, x?, y?, localStationID?, arsID?, stationID?}>` 선언, `toLeg`에 opts 전달. 라우트 zod `includeStops: z.union([z.literal("1"), z.null()])`.
- [ ] **Step 3: 스키마 스냅숏** — 미지정/`includeStops=1`/잘못된 값 400 3형 고정.
- [ ] **Step 4: green → 커밋** `feat(transit): ODsay 경유 정류장 옵트인 노출 (includeStops=1)`.

### Task 3+4: transit-guide 상태 머신 (웹 + Kit 미러, fixture 동조 — 단일 커밋)

**Files:**
- Create: `src/lib/transit-guide.ts`, `src/lib/__tests__/transit-guide.test.ts`, `src/lib/__tests__/fixtures/transit-guide-scenarios.json`
- Create: `ios/GildongmuKit/Sources/GildongmuKit/TransitGuide.swift`, `ios/GildongmuKit/Tests/GildongmuKitTests/TransitGuideTests.swift`(fixture 로더는 RouteGuideTests 관례)

**Interfaces (Produces — 이후 전 태스크가 소비하는 정본):**

```ts
export type TransitTrackMode = "seoulBus" | "tagoBus" | "subway";
export type TransitPhase = "waiting" | "riding" | "arrived" | "done";
export type TransitSignal = "tracking" | "notYetVisible" | "signalLost" | "upstreamFailed" | "untrackable";

/** 잠금·매칭 복합 키(§4.2). 식별자는 원문 문자열 무변형. tagoBus 근사는 vehicleId "". */
export interface TransitLock { mode: TransitTrackMode; routeId: string; direction: string; vehicleId: string }

/** 안내 대상으로 조립된 경로(§4.1). buildTransitGuideRoute가 TransitRoute+stops에서 만든다. */
export interface TransitGuideLeg {
  mode: "bus" | "subway";
  lineName: string;
  trackMode: TransitTrackMode | null;        // null = untrackable(비수도권 지하철 등)
  boardName: string; alightName: string;
  boardStop: TransitLegStop | null; alightStop: TransitLegStop | null;
  stationCount: number | null;
  routeId: string | null;                     // 서울버스 TOPIS ID(leg.serviceRouteId)
  wayCode: number | null;                     // 지하철 방향(serviceWayCode)
  walkBeforeMinutes: number | null;           // 선행 도보 문맥(§4.1)
}
export interface TransitGuideRoute { legs: TransitGuideLeg[]; walkAfterMinutes: number | null }

/** 폴링 응답(라우트 판별 union의 클라 투영, §7). failed는 HTTP·502·타임아웃. */
export type TrackPoll =
  | { kind: "ok"; items: TrackItem[] }
  | { kind: "empty" } | { kind: "unsupported" } | { kind: "failed" };
export interface TrackItem {
  vehicleId: string | null; direction: string; message: string;   // 완성 문장 원문
  remainingStops: number | null;                                  // §6.2 추출(서버 계산)
  destinationName: string | null; express: boolean; arrivalCode: string | null;
}

export type TransitInput =
  | { kind: "poll"; seq: number; phaseGen: number; poll: TrackPoll }
  | { kind: "board"; lock: TransitLock }
  | { kind: "changeBoarding" } | { kind: "advance" } | { kind: "stop" };

export interface TransitAnnounce { text: string; interrupt: boolean; tone: "ladder" | "imminent" | "arrive" | "weak" | "start" | null }
export interface TransitGuideState { /* legIndex, phase, phaseGen, signal, lock, remaining, lastMessage, lastUpdatedAt, ladder 래치, failCount, failSince, pollCount, … */ }
export function initTransitGuide(route: TransitGuideRoute, now: number): TransitGuideState;
export function transitGuideStep(state, input: TransitInput, route, now): { state; announce: TransitAnnounce | null };
export function pollIntervalMs(state): number;   // §7 적응 주기 + 캡 강등
export function buildTransitGuideRoute(route: TransitRoute): TransitGuideRoute | null;  // 탑승 leg 0개면 null
export function classifyTrackMode(leg: TransitLeg): TransitTrackMode | null;            // 노선 매핑표(§5.1)
```

- [ ] **Step 1: fixture 시나리오 작성**(§8.1 전 항목, 시각·seq 명시 입력 시퀀스 → 기대 {phase, signal, announce 텍스트·interrupt·tone} 표): 사다리 래치 / 임계 건너뜀 / 잔여 증가 / 소실 원거리 vs 임박(arrived 추정·재관측 복귀) / 신호 상태 전이(3회·90초, failed↔empty 교차) / phaseGen·seq 폐기 / advance 원자 전이 / changeBoarding / untrackable / done 문구 2형 / tagoBus arrived 미발동·기준 차량 교체 / 통지 코얼레싱은 **상태 머신 출력 계약으로**: 같은 스텝에서 도착이 성립하면 사다리 통지를 내지 않는다(큐 계층 코얼레싱은 훅·모델 몫).
- [ ] **Step 2: 웹 구현 + 로더 테스트 green** — 통지 문구는 i18n 키가 아니라 **문구 빌더 주입**(`TransitGuideStrings` 인터페이스, 웹은 next-intl·iOS는 appLocalized가 공급 — route-guide 낭독 조립 관례).
- [ ] **Step 3: Kit 미러 + 같은 fixture 로더 green** — `swift test --package-path ios/GildongmuKit`.
- [ ] **Step 4: 단일 커밋** `feat(transit-guide): 대중교통 안내 상태 머신 (웹·Kit 공유 fixture)`.

### Task 5: `/api/transit/track` + provider 확장

**Files:**
- Modify: `src/lib/providers/seoul-bus.ts`(getArrInfoByRoute op), `src/lib/providers/tago-bus.ts`(필터 재사용 export)
- Create: `src/lib/transit-track.ts`(서비스: 판별 union 조립·ord 해석·왕복쌍 가드·잔여 추출 §6.2), `src/app/api/transit/track/route.ts`
- Test: `src/lib/__tests__/transit-track.test.ts`, 라우트 스냅숏

**Interfaces:**
- Produces: 라우트 GET `?phase=wait|ride&mode=seoulBus|tagoBus|subway&...`(mode별 zod: seoulBus wait `arsId`·`routeId` / ride `stopId`·`routeId`·`boardOrd`? → 서버가 ord 해석 / tagoBus `nodeId`·`cityCode`·`routeNo` / subway `station`·`lineName`) → `{ mode, status: "ok"|"empty"|"unsupported", items: TrackItem[] }`, upstream 오류 502. IP 레이트리밋 60초 20회(`checkTransitTrackRateLimit`).
- Produces: `fetchSeoulArrivalsByRoute(stId, busRouteId, ord)`, `resolveSeoulOrd(routeId, boardStopId, alightStopId)`(승차 순번 이후 최소, 실패 시 캐시 우회 1회 → null), `resolveTagoAlightStop(lat, lng, routeNo)`(왕복쌍 모호 가드 → null).

- [ ] **Step 1: 실패 테스트** — T0 실데이터 fixture로 ①서울 슬롯 vehId·문장·잔여(staOrd−sectOrd) 투영 ②TAGO routeno 필터·arrprevstationcnt ③지하철 btrainNo·arvlMsg2·arvlCd 투영(T1 확장 재사용) ④ord 규칙(중복 정류소·역전 시 null) ⑤왕복쌍 40m 가드 ⑥empty vs 502 구분 ⑦잘못된 mode 400.
- [ ] **Step 2: 구현** — 봉투 정책은 provider별 유지(§7 "클라가 봉투 차이를 해석하지 않는다"의 서버 판). `https` + `AbortSignal.timeout(8000)`.
- [ ] **Step 3: green → 커밋** `feat(api): 대중교통 추적 폴링 라우트 (판별 union·ord 해석·왕복쌍 가드)`.

### Task 6+7: 웹 훅 + 패널 + 진입점 + i18n

**Files:**
- Create: `src/hooks/useTransitGuide.ts`, `src/components/TransitGuidePanel.tsx`
- Modify: `src/components/DirectionsView.tsx`, `messages/{ko,en,es,fr,it,ja}.json`
- Test: `src/components/__tests__/TransitGuidePanel.test.tsx`, `DirectionsGuideEntry.test.tsx` 확장

**Interfaces:**
- Produces: `useTransitGuide(route: TransitRoute | null)` — 내부: `buildTransitGuideRoute`, 단일 비행 폴링 루프(`pollIntervalMs`), 세대 커밋, `claimGuideSession`/`releaseGuideSession`, 통지 큐 코얼레싱(§6.1 supersede — 게시 전 최신 대체), 탭 숨김 시 폴링 정지·복귀 즉폴. 반환: `{ state, waitingItems, start, stop, board, changeBoarding, advance, progressSummary }`.
- Produces: DirectionsView `transitGuideStartable = transit done ∧ ko ∧ buildTransitGuideRoute ≠ null`, `briefFallback`에 `!transitGuideStartable` 추가, transit 섹션 heading 직후 `<TransitGuidePanel …startOnOpen triggerLabel={tBeacon("guideStart")} />`.
- i18n 키(`guide.transit*` 네임스페이스, 6로케일): start·boardConfirm(행위구 항목 라벨)·boarded·contextLine("{line}, {stop} 기준")·arrived("…내리신 뒤 '다음 구간'…")·arrivedGuess·nextLegWalk·doneWithWalk·done·signalLost·signalRecovered·notYetVisible 안내·untrackable·approximate(근사 병기)·approxVehicleChanged·checkDirection·terminatesEarly("{dest}행, {stop}까지 가지 않습니다")·expressCheck·advance(버튼)·changeBoarding(버튼)·departed("{ago} 전 관측")·capReached.

- [ ] **Step 1: 훅 구현 + jsdom 테스트**(폴링 mock: 단일 비행·늦은 응답 폐기·세션 강탈 시 정지 — `jsdom-sync-focus-assertion-flake` 관례로 waitFor).
- [ ] **Step 2: 패널 구현** — 대기 목록(복합 키 identity·정렬 안정·소실 항목 3분 유지+관측 시각·종착 비활성·급행 라벨), riding 상시 표시(잔여·최신 문장·신호 상태·마지막 갱신), arrived "다음 구간", 단일 polite live region + interrupting 2종은 별도 assertive 1회성 노드가 아니라 **같은 region + `role="alert"` 전환 금지** — 웹은 polite 유지(웹 실승차 가치 낮음, interrupting은 iOS만: 플랫폼 차이를 §6.1 재량으로 기록).
- [ ] **Step 3: DirectionsView 배선 + 진입점 행렬 테스트 확장**({transit 유/무}×{ko/en}, briefFallback에 transit 포함) + i18n 6로케일 + `i18n-messages` green.
- [ ] **Step 4: green → 커밋** `feat(web): 대중교통 실시간 안내 패널·진입점`.

### Task 8: iOS 세션 코디네이터

**Files:**
- Create: `ios/Gildongmu/Directions/GuideSessionCoordinator.swift`
- Modify: `ios/Gildongmu/Directions/BeaconModel.swift`(claim/release 경유)

**Interfaces:**
- Produces: `@MainActor final class GuideSessionCoordinator`(싱글턴 `shared`): `claim(stop: @escaping () -> Void) -> SessionToken`(기존 세션 동기 stop 후 토큰 발급), `release(_ token)`, `stopActive() -> Bool`. 웹 store 동형 + 토큰(§3.2).

- [ ] **Step 1: 구현 + BeaconModel 연동**(start 경로에서 claim, stop에서 release — 기존 단일성 동작 불변).
- [ ] **Step 2: 시뮬 빌드 green → 커밋** `refactor(ios): 안내 세션 단일성을 앱 코디네이터로 승격`.

### Task 9+10: iOS 모델 + 시트 + 진입점

**Files:**
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/APIService.swift`(track·includeStops), `Models/RouteModels.swift`(TransitLegStop·TrackItem·판별 union 디코딩)
- Create: `ios/Gildongmu/Directions/TransitGuideModel.swift`, `ios/Gildongmu/Directions/TransitTrackingSheet.swift`
- Modify: `ios/Gildongmu/Directions/DirectionsTabView.swift`(`GuideStartButton.transit`·transitGuideStartable·briefFallbackVisible·시트 마운트), `GuideText.swift`(문구 빌더 공급)

- [ ] **Step 1: Kit 모델·APIService 확장 + 디코딩 테스트**(판별 union·additive 필드, 엄격 Int 함정 주의 — 서버 `Math.round` 불필요 축이지만 remainingStops null 허용 확인).
- [ ] **Step 2: TransitGuideModel** — BeaconModel 관례(판정은 Kit, 배선만): 폴링 Task 루프(단일 비행·`pollIntervalMs`), scenePhase 배경 정지·복귀 즉폴+상태 통지(§3.2), 통지는 앱 단일 announcer 경유 + 잔여 1·도착만 `.high`(§6.1), 코얼레싱(pendingRecovery 관례 동형).
- [ ] **Step 3: TransitTrackingSheet** — heading "대중교통 안내"+목적지, 열릴 때 중지 버튼 착지, 대기 목록(List identity=복합 키), 시트 닫기=stop, 컨트롤 국면별 노출.
- [ ] **Step 4: DirectionsTabView** — transit 섹션 heading 직후 `Button(appLocalized("beacon.guideStart"))`, 게이트 `transitGuideStartable`(ko ∧ done ∧ 탑승 leg ≥1), `briefFallbackVisible`에 포함, `GuideStartButton.transit` 포커스.
- [ ] **Step 5: xcstrings 재생성 + 린터 + 시뮬 빌드 green → 커밋** `feat(ios): 대중교통 실시간 안내 (열차 선택·vehId 잠금·수동 하차 확인)`.

### Task 11: 실호출 게이트 (머지 전, §8.5)

- [ ] dev 서버 경유 실호출: ①`/api/route/transit?includeStops=1` 실경로 stops 검증 ②`/api/transit/track` 서울 wait·ride(가능하면 실차 vehId 조인), subway(부역명 역 포함), tago 1건 ③열차 목록 필터 실데이터 재확인(T0 채집분과 대조) ④prod 배포 후 스모크. 결과는 PROGRESS B2 절에 기록.

### Task 12: 독립 리뷰 → 반영

- [ ] 묶음 리뷰 2건(코어: T1~T5 / UI: T6~T10) — 서브에이전트에 **스펙+diff만** 전달(세션 히스토리 금지), 트리 동결([[freeze-artifact-before-review-dispatch]]: 커밋 SHA 범위 명시). 지적은 아키텍처 대조 후 수용·기각 기록.

### Task 13: 최종 게이트 + 문서 + 배포

- [ ] `npm run test:run` 전체·`npx tsc --noEmit`·`npm run lint`·`npm run build`·Kit `swift test`·iOS 시뮬 빌드 전부 green.
- [ ] PROGRESS.md B2 절(실호출 로그 포함)·docs/BACKLOG.md(F-a B2 → 실승차 판정 항목으로 전환) 갱신.
- [ ] push(자동배포) + 기기 연결 시 `./ios/deploy-device.sh`.

## Self-Review

- 스펙 대조: §3(진입점·시트) T6~T10, §4(상태 머신) T3+4, §5(신호) T0·T5, §6.1(통지) T3·T6·T9, §6.2 T5, §6.3 T1, §7(API·쿼터) T2·T5, §8(게이트) 각 태스크 Step + T11~13, §9 비범위 미구현 확인. 누락 없음.
- 타입 일관: `TransitLegStop`(T2)을 T3 `TransitGuideLeg`·T9 Kit 모델이 동명 소비, `TrackItem`(T3)을 T5 라우트·T9 디코딩이 공유, `pollIntervalMs`·`buildTransitGuideRoute` 명칭 전 태스크 동일.
- 웹 interrupting 미적용(§6.1 플랫폼 재량)은 T6 Step 2에 명시 — 스펙 §6.1은 iOS 채널 기준이고 웹은 polite 유지(실승차 창구가 iOS).
