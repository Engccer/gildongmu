# 수단별 진입점 재편 + 자동차 안내 (B1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 실시간 길 안내 진입점을 수단별(도보·자동차)로 재편하고, Tmap 기하 기반 자동차 승객 진행 브리핑을 신설한다.

**Architecture:** 기존 E4 경로 추종 리듀서를 "상수 치환 한정" 프로파일화(walk 동결)하고 car 전용 축(속도 기반 예고·이탈 추세·재획득 타이브레이크)을 더한다. `/api/route/car`는 walk 선례 그대로 `includeGeometry` 옵트인 + `provider` 판별자를 얻는다. 오케스트레이터(웹 `useRouteGuide`·iOS `BeaconModel`)는 `GuideKind` 봉인 구성표로 일반화한다.

**Tech Stack:** Next.js 16 / React 19 / Vitest, SwiftUI / GildongmuKit / Swift Testing. 정본: 스펙 `docs/superpowers/specs/2026-08-03-mode-entrypoints-car-guidance-design.md`(이하 §n), 조사 `docs/RESEARCH-2026-08-03-mode-specific-guidance.md`.

**구현 방식 판정(자율성 헌장):** inline. 근거 — 태스크가 강한 순차 의존(리듀서 프로파일 → car 축 → Kit 미러 → 조립 → 오케스트레이터 → UI, 선행이 후행의 인터페이스를 정의)이고 `route-guide.ts`·`RouteGuide.swift`·fixture를 여러 태스크가 연쇄 수정한다. 리뷰는 태스크 묶음별 독립 서브에이전트(요구사항+diff만 전달)로 분리한다.

## Global Constraints

- 자동차 안내는 **ko 데이터 로케일 전용**(§2). 비한국어는 시작 버튼 미노출.
- walk 동작 **회귀 0**: 리듀서 변경은 상수 참조→인자 참조 치환에 한정, 분기 구조·비교 연산자·평가 순서 불변(§4.2). 기존 fixture 10건 무수정 통과.
- 재조합 금지: Tmap description 원문 낭독, 원거리 예고는 독립 문장 결합(§4.7). 거리 표기는 `formatDistance`만.
- car 프로파일 초기값(§4.3 표)은 최초 실주행 판정까지 고정.
- 이탈 중 동결(§4.4): 분기 예고·주기·도로명·잔여·ETA 전부. 인계는 경로 진행거리 기준, 이탈·uncertain·reacquiring 중 금지.
- `/api/route/car` 미지정 응답은 신규 키 없음(`provider`만 예외, §5) — 스키마 스냅숏으로 고정.
- 세션 단일성: 플랫폼별 안내 세션 동시 최대 1개(§3.3).
- 커밋 규율: 의도 파일 pathspec 커밋, 기능+테스트 동커밋, 한국어 커밋 메시지.
- i18n 키는 6로케일 동시 + `node ios/scripts/messages-to-xcstrings.mjs all` 재생성.

---

### Task 1: 리듀서 프로파일화 (walk 동결)

**Files:**
- Modify: `src/lib/route-guide.ts`
- Modify: `src/lib/__tests__/route-guide.test.ts`
- Modify: `src/lib/__tests__/fixtures/route-guide-scenarios.json` (경계값 시나리오 추가만)

**Interfaces:**
- Produces: `GuideTuning` 인터페이스, `WALK_TUNING`·`CAR_TUNING` 상수, `guideStep(state, fix, route, now, tuning = WALK_TUNING)`, `guideStateAt(..., opts?: { autoHandoffArmed?; tuning? })`, `entryProjection(route, fix, tuning = WALK_TUNING)`.

- [ ] **Step 1: GuideTuning 정의 + 상수 치환**

```ts
/** 수단별 튜닝 프로파일(§4.3). walk는 현행 상수 동결 — 값 변경은 회귀다. */
export interface GuideTuning {
  /** 임박(선행) 낭독: 잔여 ≤ max(announceAheadM, v×announceAheadSpeedS) */
  announceAheadM: number;
  announceAheadSpeedS: number;
  /** 원거리 예고 경계(m). null=미사용(walk) */
  farNoticeM: number | null;
  windowAheadMinM: number;
  windowAheadSpeedS: number;
  offRouteBaseM: number;
  offRouteHoldS: number;
  /** 이탈 확정에 "수직거리 비감소 추세" 요구(§4.3) */
  offRouteTrend: boolean;
  offRouteRenotifyS: number;
  /** 이탈 재통지의 warning 톤 여부(첫 확정은 항상 warning) */
  offRouteRenotifyWarns: boolean;
  handoffDistM: number;
  handoffRearmM: number;
  /** 재획득 전방 연속성 타이브레이크(§4.3 — 재획득 경로 한정) */
  reacquireTieBreak: boolean;
  speedSuggest: boolean;
}

export const WALK_TUNING: GuideTuning = {
  announceAheadM: 40, announceAheadSpeedS: 0, farNoticeM: null,
  windowAheadMinM: 50, windowAheadSpeedS: 0,
  offRouteBaseM: 30, offRouteHoldS: 20, offRouteTrend: false,
  offRouteRenotifyS: 60, offRouteRenotifyWarns: true,
  handoffDistM: 50, handoffRearmM: 70,
  reacquireTieBreak: false, speedSuggest: true,
};

export const CAR_TUNING: GuideTuning = {
  announceAheadM: 120, announceAheadSpeedS: 15, farNoticeM: 1500,
  windowAheadMinM: 150, windowAheadSpeedS: 5,
  offRouteBaseM: 50, offRouteHoldS: 10, offRouteTrend: true,
  offRouteRenotifyS: 180, offRouteRenotifyWarns: false,
  handoffDistM: 150, handoffRearmM: 200,
  reacquireTieBreak: true, speedSuggest: false,
};
```

`guideStep`·`guideStateAt`·`entryProjection`에 `tuning` 인자(기본 `WALK_TUNING`)를 추가하고 본문의 `ANNOUNCE_AHEAD_M`→`max(tuning.announceAheadM, v*tuning.announceAheadSpeedS)`, `WINDOW_AHEAD_MIN_M`→`tuning.windowAheadMinM`(+속도항), `OFF_ROUTE_BASE_M`→`tuning.offRouteBaseM`, `OFF_ROUTE_HOLD_S`→`tuning.offRouteHoldS`, `OFF_ROUTE_RENOTIFY_S`→`tuning.offRouteRenotifyS`, `HANDOFF_DIST_M`/`HANDOFF_REARM_M`→`tuning.handoffDistM/handoffRearmM`, 속도 제안 분기를 `tuning.speedSuggest` 가드로 치환한다. **walk 기본값에서 v항은 0×이라 수식이 현행과 동일 값** — 분기·순서는 손대지 않는다. 기존 export 상수는 유지(외부 참조 호환).

속도 추정 v는 §4.3 정의로 이미 계산 중인 표본에서 파생한다(표본 2개 미만이면 0):

```ts
const lastSeg = samples.length >= 2
  ? Math.max(0, (samples[samples.length - 1].d - samples[samples.length - 2].d) /
      Math.max(0.001, samples[samples.length - 1].at - samples[samples.length - 2].at))
  : 0;
const v = Math.max(lastSeg, median);
```

- [ ] **Step 2: 경계값 fixture 추가(walk)** — `route-guide-scenarios.json`에 시나리오 4건 추가: 선행 낭독 잔여 정확히 40m(발화)·41m(침묵), 이탈 수직 정확히 30m(비이탈 — 판정이 `>`)·31m(이탈 누적), 인계 잔여 정확히 50m(인계), 재획득 공백 정확히 10초(비진입 — 판정이 `>`). 좌표 규약은 파일 comment 그대로.

- [ ] **Step 3: 검증** — `npx vitest run src/lib/__tests__/route-guide.test.ts` green(기존 10건 무수정 + 신규 경계 4건).

- [ ] **Step 4: 커밋** — `feat(guide): 리듀서 튜닝 프로파일화(walk 동결) + 경계값 fixture`

### Task 2: car 리듀서 축 + car 시나리오 fixture

**Files:**
- Modify: `src/lib/route-guide.ts`
- Modify: `src/lib/__tests__/route-guide.test.ts`
- Modify: `src/lib/__tests__/fixtures/route-guide-scenarios.json`

**Interfaces:**
- Produces: `GuideEvent`에 `{ kind: "farNotice"; indices: number[] }` 추가. `GuideState`에 `farNoticedUpTo: number`(초기 -1)·`offRoutePeakPerp: number | null`·`reacquirePrevD: number | null`·`reacquireSince: number | null` 추가. fixture 시나리오에 `tuning: "walk" | "car"` 필드(미지정=walk).

- [ ] **Step 1: 원거리 예고(farNotice)** — 6b 임박 분기 **뒤**(§4.1 우선순위)에:

```ts
// 6b'. 원거리 예고(§4.3): 다음 분기 경계선(farNoticeM) 하향 통과 시 1회.
// 임박이 같은 fix에 성립하면 임박만 나가고 여기의 래치도 소비된다(6b에서
// farNoticedUpTo를 함께 전진) — 뒤늦은 원거리 예고 금지.
if (
  tuning.farNoticeM !== null &&
  next.announcedUpTo < route.steps.length - 1 &&
  next.farNoticedUpTo < next.announcedUpTo + 1
) {
  const boundary = route.steps[next.announcedUpTo].endD;
  const prevRemaining = boundary - state.d;
  const nowRemaining = boundary - d;
  if (prevRemaining > tuning.farNoticeM && nowRemaining <= tuning.farNoticeM) {
    const indices = unitAt(route, next.announcedUpTo + 1);
    next = { ...next, farNoticedUpTo: next.announcedUpTo + 1 };
    return { state: next, event: { kind: "farNotice", indices }, tone: null };
  }
}
```

6b(임박)가 발화할 때 `farNoticedUpTo: indices[indices.length - 1]`도 함께 전진시킨다. 세션 시작이 이미 경계 안이면 `prevRemaining > farNoticeM`이 거짓이라 자연 미발화(§4.3).

- [ ] **Step 2: 이탈 추세 조건** — `offRouteTrend`가 참일 때: 이탈 누적 중 `offRoutePeakPerp`를 갱신하고, 현재 수직거리가 `peak - 5m` 미만으로 줄면 `offRouteSince`·peak을 리셋(복귀 중 오확정 차단). 확정 조건은 기존 hold 시간 경과 그대로.

- [ ] **Step 3: 재획득 타이브레이크** — reacquiring 진입 시 `reacquirePrevD = state.d`·`reacquireSince = now` 저장. reacquiring 처리에서 `entryProjection`이 ambiguous이고 `tuning.reacquireTieBreak`이면: 전역 후보 중 `d ∈ [prevD, prevD + v×(now - reacquireSince + REACQUIRE_GAP_S)×1.5 + 100]` 후보가 **정확히 1개**일 때만 채택(0·복수는 거부 유지). v는 reacquiring 진입 전 마지막 중앙값(표본 리셋 전에 보관 — `reacquireSpeed` 지역 보관 대신 창 계산이 리셋되므로 진입 시 v를 `reacquirePrevD`와 함께 저장해도 된다: `reacquireV: number` 필드 허용).
- [ ] **Step 4: 이탈 재통지 프로파일** — offRoute phase 재통지의 tone을 `tuning.offRouteRenotifyWarns ? "warning" : null`로.
- [ ] **Step 5: car 시나리오 fixture** — `tuning: "car"` 시나리오 8건(§8.2): 고속 전진(22m/s, 창 되먹임으로 edgeHit 0)·fix 공백 2~3초 무재확보·이탈 확정(50m 초과 10초 + 추세)·복귀 중 리셋(perp 감소 시 미확정)·재획득 타이브레이크 채택/0개 거부/복수 거부·원거리+임박 동시(임박만)·경계선 하향 통과 farNotice 1회. 테스트 로더에 `tuning` 필드 해석 추가(`sc.tuning === "car" ? CAR_TUNING : WALK_TUNING`).
- [ ] **Step 6: 검증 + 커밋** — vitest green. `feat(guide): car 리듀서 축(원거리 예고·이탈 추세·재획득 타이브레이크) + 공유 fixture`

### Task 3: Kit 미러 (RouteGuide.swift 프로파일 + car 축)

**Files:**
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/RouteGuide.swift`
- Modify: `ios/GildongmuKit/Tests/GildongmuKitTests/RouteGuideTests.swift`

**Interfaces:**
- Produces: `GuideTuning` struct(+`.walk`/`.car` 정적 프로파일), `guideStep(state:fix:route:now:tuning:)`(기본 `.walk`), `GuideEvent.farNotice(indices:)`, 상태 필드 미러.

- [ ] Task 1·2의 웹 변경을 필드·수식·분기 순서까지 1:1 미러. RouteGuideTests의 fixture 로더에 `tuning` 필드 해석 추가(공유 JSON은 Task 2에서 이미 확장됨 — Kit 테스트가 같은 파일을 읽으므로 car 시나리오 8건이 자동 적용된다).
- [ ] `cd ios/GildongmuKit && swift test --filter RouteGuideTests` green. 커밋 `feat(ios): RouteGuide 프로파일·car 축 미러 동조`

### Task 4: `/api/route/car` provider 판별자 + includeGeometry 옵트인

**Files:**
- Modify: `src/lib/types.ts` (`CarRouteGuide`·`CarRouteBriefing`)
- Modify: `src/lib/providers/tmap-car.ts`
- Modify: `src/lib/car-route.ts`
- Modify: `src/app/api/route/car/route.ts`
- Test: `src/lib/providers/__tests__/tmap-car.test.ts`(기존 확장), `src/app/api/__tests__/car-route-schema.test.ts`(신규)

**Interfaces:**
- Produces: `CarRouteBriefing.provider: "tmap" | "kakao"`, `CarRouteGuide.pathCoords?: Coord[]`·`CarRouteGuide.roadLinks?: { name: string | null; distanceMeters: number }[]`, `getCarRoute(params & { includeGeometry?: boolean })`, 라우트 쿼리 `includeGeometry`(walk 동형: `"1"`만 허용, 그 외 400).

- [ ] **Step 1: normalize 확장** — `normalizeTmapCarRoute(data, { includeGeometry = false })`: feature 순회를 Point 필터 대신 순서 보존 스캔으로 바꾸고, **description 있는 Point만 스텝**·`pointType S/E`·무 description Point는 마커로 제외(§5 화이트리스트). includeGeometry면 각 guide에 다음 안내 Point 직전까지의 LineString `coordinates`를 병합해 `pathCoords`(WGS84 `{lat,lng}` 변환)로, LineString properties의 `name`(없거나 `roadType` 무명 계열이면 null)·`distance`를 `roadLinks`로 싣는다. guides의 `distanceMeters/durationSeconds` 0 유지(§5).
- [ ] **Step 2: 서비스·라우트** — `car-route.ts`가 briefing에 `provider` 세팅(tmap/kakao). 라우트는 `includeGeometry` zod 검증(`z.literal("1").optional()` — walk 라우트와 동일 형) 후 provider에 전달, **카카오 폴백 경로는 includeGeometry 무시**(기하 미지원 — 응답에 pathCoords 부재가 신호, §5).
- [ ] **Step 3: 스키마 스냅숏 테스트** — fixture 기반 4형: 미지정(pathCoords·roadLinks 키 자체 부재 + provider 존재), `includeGeometry=1`(기하 포함), `includeGeometry=2` 400, 카카오 폴백(provider:"kakao"·기하 부재). Tmap fixture는 조사 실측 구조(P·L 교대 + PLL 연속 자리 포함)로 축소 재현해 **"Point 없이 LineString 연속" 병합**과 종점 마커 제외를 함께 잠근다.
- [ ] **Step 4: 검증 + 커밋** — vitest green + `npx tsc --noEmit` 변경분 0오류. `feat(car): provider 판별자 + includeGeometry 옵트인(Tmap 기하 정규화)`

### Task 5: 웹 car 기하 조립 `buildCarGuide` (fail-closed)

**Files:**
- Create: `src/lib/car-route-guide.ts`
- Test: `src/lib/__tests__/car-route-guide.test.ts`

**Interfaces:**
- Consumes: `CarRouteBriefing`(Task 4), `buildGuideRoute`·`GuideRoute`(route-geometry).
- Produces: `interface CarRoadSpan { name: string | null; startD: number; endD: number }`, `interface CarGuideData { route: GuideRoute; roadSpans: CarRoadSpan[] }`, `buildCarGuide(briefing: CarRouteBriefing): CarGuideData | null`, `roadNameAt(spans: CarRoadSpan[], d: number): string | null`.

- [ ] **Step 1: 조립 + 검증** — guides의 `pathCoords`를 `GuideStepGeometry(description=guidance, pathCoords)`로 투영해 `buildGuideRoute` 재사용. **fail-closed(§5)**: 어느 guide든 `pathCoords` 부재·2점 미만·비유한 좌표면 전체 null(부분 조립 금지 — `buildGuideRoute`의 이음매·0길이 검증은 그대로 두 번째 층). `roadSpans`는 `roadLinks`의 `distanceMeters`를 누적해 전 구간 `[startD, endD)` 사슬로 조립하고, 누적 합이 `route.totalMeters`와 5% 이상 어긋나면 roadSpans만 빈 배열(도로명 기능 강등 — 경로 안내 자체는 유지, 가짜 정밀 금지).
- [ ] **Step 2: `roadNameAt`** — d가 속한 span의 name(무명 span·빈 spans는 null).
- [ ] **Step 3: 테스트** — 정상 조립·guide 1개 기하 결측 시 전체 null·좌표 NaN 시 null·roadSpans 어긋남 시 빈 배열·roadNameAt 경계(0·경계점·총거리 초과).
- [ ] **Step 4: 커밋** — `feat(car): 자동차 안내 기하 조립(fail-closed) + 도로명 스팬`

### Task 6: Kit 미러 — RouteModels 확장 + CarGuide 조립

**Files:**
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/Models/RouteModels.swift` (`CarRouteGuide`에 `pathCoords`·`roadLinks`, `CarRouteBriefing`에 `provider` — 전부 optional Codable, 기존 디코딩 byte-호환)
- Create: `ios/GildongmuKit/Sources/GildongmuKit/CarRouteGuide.swift` (`buildCarGuide`·`CarRoadSpan`·`roadNameAt` 미러)
- Test: `ios/GildongmuKit/Tests/GildongmuKitTests/CarRouteGuideTests.swift`(Task 5 케이스 미러)

- [ ] 웹과 동일 계약 미러 + `swift test` green. 커밋 `feat(ios): 자동차 기하 모델·조립 미러`

### Task 7: i18n — 자동차 안내 문구 (6로케일 + xcstrings)

**Files:**
- Modify: `messages/{ko,en,es,fr,it,ja}.json`, `ios/Gildongmu/Resources/Localizable.xcstrings`(재생성)

**Interfaces:**
- Produces(guide 네임스페이스): `carStart`("자동차 안내 시작. 안내 {count}개, 총 {distance}. {first}"), `farNotice`("약 {distance} 뒤 다음 안내가 있습니다. {step}"), `carOffRoute`("경로에서 벗어나 안내를 일시 중지했습니다. 경로 다시 조회로 재개할 수 있습니다"), `carRoadNow`("{road} 주행 중"), `progressCar`("{road}남은 거리 {total}. 다음 안내까지 {distance}" — road는 `carRoadNow`+쉼표 선조립 또는 빈 문자열), `etaStale`("예상 시간은 {minutes}분 전 기준"), `carDetailUnavailable`("경로 정보를 가져오지 못해 간략 안내로 시작합니다" — 기존 detailUnavailable 재사용 가능 여부 확인 후 재사용이면 신설 생략). directions 쪽: `walkGuideStart`("도보 안내 시작")·`carGuideStart`("자동차 안내 시작")·`briefGuideStart`("간략 안내 시작") — 웹 DirectionsView 네임스페이스와 iOS 공용 키 위치는 기존 `beacon.start` 관례를 따라 beacon 네임스페이스에 둔다.
- 비한국어 로케일도 키 패리티 필수(i18n 게이트) — 자동차 안내가 ko 전용이라도 키는 6로케일 번역.

- [ ] 키 추가 → `node ios/scripts/messages-to-xcstrings.mjs all` → `node ios/scripts/check-xcstrings-keys.mjs` green → i18n 테스트 green → 커밋.

### Task 8: 웹 오케스트레이터 — kind 봉인 구성 + 세션 단일성 + ETA

**Files:**
- Create: `src/lib/guide-session-store.ts` (모듈 싱글턴 — 세션 소유 `claim(kind, dest)`/`release()`, nearby-panel-store 관례)
- Modify: `src/hooks/useRouteGuide.ts`
- Test: `src/hooks/__tests__/useRouteGuide.car.test.tsx`(신규, jsdom)

**Interfaces:**
- Consumes: Task 1~5 전부.
- Produces: `useRouteGuide(dest, kind: GuideKind = "walk")`, `GuideKind = "walk" | "car"`. 내부 봉인 구성표:

```ts
const GUIDE_CONFIGS = {
  walk: { tuning: WALK_TUNING, fetch: fetchWalkGuideRoute, canDetail: (locale) => !prefersEnglish(locale) },
  car:  { tuning: CAR_TUNING,  fetch: fetchCarGuideRoute,  canDetail: (locale) => !prefersEnglish(locale) },
} as const;
```

- [ ] **Step 1: kind 구성** — fetch·tuning·낭독 조립(eventText의 farNotice→`guide.farNotice`, offRoute→kind별 문구, 시작 문구 carStart)을 구성표에서 원자 선택. car fetch는 `/api/route/car?...&includeGeometry=1` → `buildCarGuide` → `{ route, roadSpans, durationSeconds, provider }`(provider!=="tmap"이거나 null이면 시작 폴백 §4.5).
- [ ] **Step 2: 세션 단일성** — 시작 시 `guide-session-store.claim()`, 다른 세션이 쥐고 있으면 그 세션 stop 콜백 호출 후 시작(§3.3). 패널 2곳(장소 상세·길찾기 뷰) 동시 추적 불가 테스트.
- [ ] **Step 3: car ETA(§4.6)** — 10분 인터벌(세션 캡 6회, 시작 조회 포함 카운트)로 `/api/route/car`(기하 없이) 재호출 → `durationSeconds`를 잔여 ETA로 교체(기하·상태 불변). 세대 3중 일치(세션 gen·목적지·경로 gen) 커밋. 사이 구간은 경과 차감 카운트다운(묶음 A 표시 재사용 — progress.etaSeconds 갱신원만 교체). 실패·캡 소진은 stale 마크(`etaUpdatedAt`), 진행 상황 응답에 `etaStale` 병기. 이탈 중 인터벌 정지(§4.4).
- [ ] **Step 4: car 낭독 조립** — farNotice=`guide.farNotice`(distance는 `formatDistance(잔여 기하 계산값)` — description 파싱 금지), 진행 상황=`progressCar`(+`roadNameAt`), 이탈=`carOffRoute`(반복 동일 문구·무톤). 도로명은 이탈·uncertain 중 숨김.
- [ ] **Step 5: 테스트** — car kind 시작→carStart 통지, provider kakao면 폴백 통지, farNotice 발화 문구, 이탈 동결(이탈 중 잔여 표시 숨김·ETA 인터벌 정지), 세션 단일성. jsdom + fetch mock(Task 4 스냅숏 fixture 재사용).
- [ ] **Step 6: 커밋** — `feat(guide): 오케스트레이터 kind 봉인 구성 + 자동차 ETA·낭독`

### Task 9: 웹 UI — 진입점 재편

**Files:**
- Modify: `src/components/DirectionsView.tsx`(수단 섹션 버튼 + 폴백 섹션 + 패널 마운트), `src/components/DistanceBeacon.tsx`(kind prop·수단 라벨), `src/components/PlaceDetail.tsx`(개명 확인 — heading은 beacon.heading 문구 갱신으로 처리)
- Test: `src/components/__tests__/DirectionsGuideEntry.test.tsx`(신규)

- [ ] **Step 1: 버튼·게이트** — 도보 섹션에 `beacon.walkGuideStart`, 자동차 섹션에 `beacon.carGuideStart`(게이트: ko ∧ 경로 성공 ∧ provider==="tmap", §3.1). 버튼은 해당 kind로 패널 세션 시작(패널은 뷰 하단 1개 마운트, kind는 시작 버튼이 결정).
- [ ] **Step 2: 폴백 섹션** — 시작 가능 안내 0개 ∧ 목적지 확정 ∧ 전 수단 settled일 때만 `beacon.briefGuideStart` 섹션(§3.1). 사라질 때 포커스 선점(헌장 §5 — 기존 useLayoutEffect 관례).
- [ ] **Step 3: 상태 행렬 테스트(§8.4)** — {도보 성공/실패}×{자동차 tmap/kakao/실패}×{ko/en} 조합에서 버튼·폴백 노출 단언(개별 조합 대표 6케이스 이상).
- [ ] **Step 4: 커밋** — `feat(web): 길찾기 뷰 수단별 안내 진입점 + 간략 폴백 게이트`

### Task 10: iOS 오케스트레이터 — BeaconModel kind 구성 + ETA

**Files:**
- Modify: `ios/Gildongmu/Directions/BeaconModel.swift`, `ios/GildongmuKit/Sources/GildongmuKit/RouteService.swift`(car includeGeometry 파라미터·provider 디코딩)
- Modify: `ios/Gildongmu/Directions/GuideText.swift`(farNotice·carStart·progressCar·carRoadNow 조립)

- [ ] Task 8과 동일 계약을 iOS로: `start(dest:label:kind:)`(kind별 봉인 구성 — fetch·tuning·문구), car ETA 인터벌(Task 8 §4.6 규칙 동일 — Task/Timer + 세대 토큰), 이탈 동결(remainingText·도로명 nil), farNotice 소비(`consume(event:)`에 case 추가). 낭독 채널·시트 계약은 현행.
- [ ] 시뮬 빌드 green. 커밋 `feat(ios): BeaconModel 수단 구성 + 자동차 ETA·낭독`

### Task 11: iOS UI — 길찾기 탭 진입점 재편 + 시트 수단화

**Files:**
- Modify: `ios/Gildongmu/Directions/DirectionsTabView.swift`(기존 선두 추적 섹션 → 수단 섹션별 시작 버튼 + 폴백 섹션), `ios/Gildongmu/Directions/BeaconTrackingSheet.swift`(수단 라벨 헤더·컨트롤 분기: 전환 버튼 walk 전용, 재조회 car 이탈 시)

- [ ] §3.1·§3.3 그대로: 수단 섹션 헤더 직후 시작 버튼(자동차 게이트 ko∧provider tmap), 폴백 섹션은 "시작 가능 0개 ∧ settled ∧ 목적지 확정", 권한 실패 해결 버튼(settings/precise)은 현행 로직을 폴백 섹션과 추적 섹션에 승계. 시트 헤더는 kind별 heading("도보 안내"/"자동차 안내" + 목적지).
- [ ] 시뮬 빌드 + `snapshot-ui`로 버튼 노출 확인. 커밋 `feat(ios): 길찾기 탭 수단별 진입점 + 시트 수단화`

### Task 12: 실호출 게이트 + 통합 검증 + a11y 감사

- [ ] **실호출(§8.6)**: dev 서버에서 실좌표(길동역→강남역) `curl "/api/route/car?...&includeGeometry=1"` → 스크립트로 `buildCarGuide` 조립 성공·roadSpans 합계 오차·guide 수 확인. 다른 실경로 1건(단거리 시내) 추가.
- [ ] 전체 게이트: `npm run test:run`·`npm run lint`·`npx tsc --noEmit`(변경분)·`npm run build`·Kit `swift test`·iOS 시뮬 빌드.
- [ ] `a11y-auditor` 서브에이전트 감사(신규 버튼·폴백 섹션·시트 분기·이탈 동결 통지).
- [ ] 태스크 묶음 리뷰: 독립 서브에이전트 2회(리듀서·데이터 묶음 Task 1~6 / 오케스트레이터·UI 묶음 Task 7~11) — 요구사항(스펙 §)+diff만 전달.

### Task 13: 문서·마무리

- [ ] PROGRESS.md B1 절 신설(검증 로그 포함), docs/BACKLOG.md 갱신(B2 대기·§9 백로그 항목 이관), 스펙 §10 플랜 리뷰 포커스 소화 확인.
- [ ] 최종 커밋·push(자동배포), iPhone 연결 시 `ios/deploy-device.sh`.
- [ ] 상태 보고: DONE/DONE_WITH_CONCERNS + 위원장 실주행 판정 항목(§8.7) 안내.
