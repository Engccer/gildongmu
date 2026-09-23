# N4 경유지 진행 표시 — 설계 (2026-09-24)

선행 정본: `2026-08-22-waypoint-ios-design.md`(W1~W3 도착 감지·소비), `2026-08-22-waypoint-server-web-cli-design.md`(서버 `waypoint{stepIndex,coord}` 계약). 판정 출처: `docs/BACKLOG.md` N4 🆕(위원장 판정 3건, 2026-09-24), 계획 `docs/superpowers/plans/2026-09-24-backlog-sweep-5-parallel-plan.md` §1 N4(코디네이터 판정 3건).

**설계 리뷰 판정**: 적대적 리뷰 대상이다 — 리듀서에 새 래치·이벤트(판정 계층)를 더하고 3벌 미러 + 공유 fixture 계약을 바꾼다(게이트 ①). 결과는 §9.

## 0. 확정 판정

| # | 판정 | 출처 |
|---|---|---|
| ① | 남은 거리 행은 **"다음 목표" 기준 한 줄**: 도착 전 "경유지 {label}까지 {distance}, 약 {min}분", 도착 뒤 "목적지 {dest}까지 {distance}, 약 {min}분". 전체 남은 거리는 진행 상황 조망(`GuideText.progress`·웹 `progressOverviewLine`)에만 | 위원장 2026-09-24 |
| ② | 접근 예고 1회 "경유지 {label}까지 {distance}", 도착 "경유지 {label} 도착. 이제 목적지 {dest}로 안내합니다". 도착 종 `.nearby`·임박 큐 우선(W2·W3) 불변 | 위원장 2026-09-24 |
| ③ | 웹도 함께 연다. 이번 세션은 훅·패널까지, 길찾기 화면 배선은 웨이브 2 `n4-web-wire` | 위원장 2026-09-24 + 계획 §2 |
| ④ | 도착 문장은 상세 시트에 **별도 행으로 남기지 않는다**. 도착 뒤 남은 거리 행의 라벨이 "목적지 {dest}까지"로 바뀌는 것이 화면의 표시다(상세 모드 1회 확인 문장 비표시 원칙 spec 2026-08-11 §2-1 유지) | 위원장 2026-09-24(이 세션 문답) |
| ⑤ | 접근 예고 거리는 도보 최종 접근과 같은 값(50m)에서 시작하는 잠정 상수(A6 계열, 실보행 판정 대상) | 계획 §1 |
| ⑥ | 도착 추정(`maybePresumeArrival`·`presumedArrival`)은 최종 목적지에만. 게이트는 느슨하게 하지 않는다(A23·A31) | 계획 §1 |

## 1. 범위

- **안에**: 리듀서 3벌(웹 `route-guide.ts` ↔ Kit `RouteGuide.swift` ↔ `:kit` `RouteGuide.kt`) + 공유 fixture, iOS `BeaconModel`·`BeaconTrackingSheet`, 웹 `useRouteGuide`·`DistanceBeacon`, 문장 3개(6로케일·xcstrings·`arg-order.json`·안드로이드 strings 재생성).
- **밖에**: 웹 길찾기 화면의 `walkGuideStartable` `!hasVia` 해제·경유지 전달(웨이브 2 `n4-web-wire`), 자동차 경유지 접근 예고(프로파일 값 null — N4에 남김), 안드로이드 앱 UI 배선(`WalkGuideModel.kt`·`GuideSheet.kt` — BACKLOG E43 등가성 후속; 컴파일에 필요한 무동작 분기 1줄만 넣는다), 띠바 거리(총 잔여 유지, 경유지 spec §4.4 판정 그대로).

## 2. 리듀서

### 2.1 프로파일 값

`GuideTuning.waypointApproachM: number | null` — 경유지 접근 예고 임계(경유지 도착선까지 경로 잔여, m). null = 접근 예고 없음.

- walk: `WAYPOINT_APPROACH_M = HANDOFF_DIST_M`(= 50). 옛 최종 접근 진입선(기하 없는 세션의 50m 인계)과 같은 값에서 시작하되 **이름을 따로 둔다** — 실보행에서 한쪽만 바뀔 수 있다(⚠ 잠정, BACKLOG §2 도보 표).
- car·carDriver: `null`. 자동차의 경유지 리듬(속도 연동 거리)은 판정 밖이다. 자동차 세션은 도착 이벤트만 종전대로 받는다.

### 2.2 상태

`GuideState.waypointApproached: boolean`(접근 예고 소비 래치). 초기 false. `restateAt`(재획득·복귀)은 **승계**한다(`waypointReached`·`waypointPending`과 같은 목록 — 승계 목록은 `restateAt` 한 곳). 새 경로 세대(`initialGuideState`)는 초기화.

### 2.3 이벤트

`{ kind: "waypointApproaching"; remainingMeters: number }` — 경유지 도착선까지 경로 잔여(반올림 m). 톤 없음(`null`) — 도착 종은 도착에만 울린다(②).

### 2.4 판정 (W0·W4)

```
// W0) 세대 첫 fix: 세대가 이미 접근선 안에서 시작하면 예고를 소비한다(무발화).
//     guideStep 머리, 역순 시각 방어 바로 뒤 — 조기 반환 국면보다 앞이다.
if state.lastFixAt == null && tuning.waypointApproachM != null
   && route.waypointStepIndex != nil && !state.waypointReached && !state.waypointApproached
   && steps[w].startD - state.d <= tuning.waypointApproachM {
    state.waypointApproached = true
}
…
// W4) 접근 예고: 6c(선행 전문)·6b'(원거리 예고) 뒤, 주기(6c 주기) 앞.
if tuning.waypointApproachM != nil && w != nil && !next.waypointReached && !next.waypointApproached
   && !isOff && !jumped {
    rem = steps[w].startD - d
    if rem <= tuning.waypointApproachM {
        next.waypointApproached = true; next.lastAnnouncedAt = now
        return emit(next, .waypointApproaching(round(rem)), nil)
    }
}
```

- **수준 판정 + 래치**다(교차 판정이 아니다). 같은 fix에 더 높은 이벤트(임박·도착·선행 전문)가 걸리면 이번 fix를 내주고 다음 fix에 나간다 — 조건이 계속 참이기 때문이다. 교차 판정(`farNotice` 방식)은 그 경합에서 예고를 영구히 잃는다.
- **도착이 예고를 대신한다**: 예고가 밀린 사이 도착선을 넘으면 W1이 `waypointReached`를 세우고 W4는 다시 서지 않는다(`!waypointReached`). "경유지까지 3m" 뒤 곧바로 "도착"이 붙는 잉여가 없다. `rem > 0`은 `!isOff ∧ !jumped ∧ !waypointReached`에서 따라 나온다(W1이 같은 조건으로 먼저 섰을 것이므로).
- **W0 — 세대가 접근선 안에서 시작하면 무발화 소비**: 원거리 예고의 "재진입 시점 유닛 소비"(`farNoticedUpTo`)와 같은 원리다. 시작·재조회 직후 첫 fix에 예고가 나가면 시작 통지(원자 시작 발화)나 재조회 통지 바로 뒤에 겹친다. 경유지 추가 직후처럼 가까운 경우엔 곧 도착이 알린다. 판정 기준은 fix의 `d`가 아니라 **세대 진입 `state.d`**다(W0는 투영 전이다). `lastFixAt == null`은 세대(`guideStateAt`) 첫 fix만 참이다 — 재획득·복귀 재구성도 `guideStateAt`을 지나므로, 공백 중 접근선 안으로 들어온 경우도 무발화 소비된다(공백을 지나 온 거리는 이미 들을 기회가 없었다).
- **우선순위**: 이월된 도착(W2) > 임박(6a) > 이번 fix 도착(W3) > 최종 접근(6b, 미도착 경유지면 불성립) > 선행 전문(6c) > 원거리 예고(car 전용) > **접근 예고(W4)** > 주기 > 속도 제안. 예고는 "다음에 할 일"(선행 전문)보다 급하지 않다 — 둘 다 수준 판정이라 밀려도 잃지 않는다.
- `!isOff ∧ !jumped`: W1과 같은 신뢰 조건(이탈 의심·투영 점프 중의 `d`로 말하지 않는다).

### 2.5 다음 목표 (순수 함수)

```
guideNextTarget(route, state) -> { kind: "route" | "waypoint" | "destination"; meters: number }
  w == nil                  → { route,       max(0, totalMeters - d) }
  w != nil ∧ !waypointReached → { waypoint,  max(0, steps[w].startD - d) }
  w != nil ∧ waypointReached  → { destination, max(0, totalMeters - d) }
```

`route`는 경유지 없는 세션이다 — 표시는 종전 그대로("남은 거리 …", 바이트 동일). 3벌 미러 + fixture `expect.nextTarget`로 잠근다. 소비자는 남은 거리 행 하나다(iOS `updateRemaining`, 웹 `progressOf`). 띠바·추세 톤·진행 상황 조망은 총 잔여를 계속 쓴다(①·§1).

### 2.6 fixture 시나리오 (`route-guide-scenarios.json`)

1. 접근 예고 1회: 직진 100 + 100, 경유지 1. 잔여 50 밖에서는 무이벤트, 첫 신뢰 fix `d ≥ 50`에서 `waypointApproaching`(톤 없음), 이후 다시 안 나가고 도착선에서 `waypointReached`. `nextTarget`는 도착 전 `waypoint`, 뒤 `destination`.
2. 세대가 접근선 안에서 시작: 30 + 100, 경유지 1 → 예고 0회, 도착 1회.
3. 선행 전문과 같은 fix: 한 fix에 잔여 50 안·선행 전문 40 안이 함께 서면 `announceSteps` 먼저, 다음 fix에 `waypointApproaching`.
4. 자동차 프로파일: 예고 0회(`waypointApproachM = null`), 도착은 종전대로.
5. 경유지 없는 경로: `nextTarget = route`(총 잔여).

## 3. 문장 (6로케일, `directions` 네임스페이스)

| 키 | ko(확정값) | 소비 |
|---|---|---|
| `directions.viaRemaining` | `경유지 {label}까지 {distance}` | 접근 예고 통지 + 남은 거리 행(도착 전)의 거리 조각 |
| `directions.viaDestRemaining` | `목적지 {dest}까지 {distance}` | 남은 거리 행(도착 뒤)의 거리 조각 |
| `directions.viaArrivedContinue` | `경유지 {label} 도착. 이제 목적지 {dest} 안내합니다` | 도착 통지 |

- 행은 `joinText(거리 조각, guide.remainingTime)` — 종전 행과 같은 조립(쉼표, 한 객체). 시간 조각은 근거 없으면 생략(3-state).
- **ko `{dest}`에는 호출부가 방향 조사를 붙인다**(`directionParticle`·`KoreanParticle.direction` — "서울역으로"·"학교로"·"길동으로"). 받침 판정이 안 되는 이름(영문·숫자 끝)은 **`로`로 물러난다** — 다른 자리(목적격)는 조사를 빼고 물러나지만, 여기서 조사를 빼면 "목적지 GS25 안내합니다"로 문장이 깨진다. 한국어로 읽히는 영문·숫자 끝(에스, 오, 일, 엘, 알…)은 대부분 `로`가 맞다. 비-ko 로케일은 조사 없이 `{dest}` 원문.
- 조망 목록의 구획 행은 종전 `directions.viaArrived`("경유지 {label} 도착") 그대로다 — 세 소비자(웹·CLI·iOS 조망)가 같은 구획 문장을 쓴다(경유지 spec §4.3).
- xcstrings는 `messages-to-xcstrings.mjs`로 재생성, `ios/i18n/arg-order.json`은 신규 키만 `--update-arg-order`, 안드로이드 strings는 변환 스크립트로 재생성(손 편집 금지).

## 4. iOS

### 4.1 `BeaconModel`

- `updateRemaining(route:state:)`: `guideNextTarget`로 조각을 고른다. `route` → 종전 `guide.remainingDistance`; `waypoint` → `viaRemaining(routeWaypointLabel, 거리)`; `destination` → `viaDestRemaining(destinationLabel, 거리)`. 라벨은 **경로에 결박된 `routeWaypointLabel`**(도착 뒤 `waypoint = nil`이 돼도 남는다)을 쓰고, 그것이 nil이면(방어) `route` 조각으로 물러난다.
- 시간 조각: walk는 총 소요의 **목표 잔여 비례**(`duration × meters / totalMeters`, 종전 식의 분자만 목표 잔여로). car는 `waypoint` 목표에서 **생략**(재조회 ETA는 목적지까지라 경유지 시간이 아니다 — 날조 금지), 그 밖은 종전 ETA 카운트다운. `etaMinutesNow`(조망이 쓰는 총 잔여 산식)는 그대로 두고 목표 잔여를 받는 분기를 더한다(사본 금지).
- 띠바 `updateBandDistance`는 총 잔여 유지.
- `consume(.waypointApproaching(m))`: `text = viaRemaining(label, formatDistance(m))`, `statusText = text`, `announce(text)`. 톤 없음. `lastGuidance`는 덮지 않는다(실행 안내가 아니다). 억제 중이면 발화하지 않고 보관하지 않는다(거리 문장은 시간이 지나면 거짓 — 주기 통지와 같은 취급). 라벨이 nil이면 무발화.
- `consume(.waypointReached)`: 문장만 `viaArrivedContinue(reached.label, destinationLabel + 조사)`로 바꾼다. 나머지(도착 종·`waypoint = nil`·파생물 폐기·억제 중 보관)는 불변.
- 운전자 채널: car 프로파일은 예고를 내지 않으므로 해당 없음.

### 4.2 `BeaconTrackingSheet`

행 구성 불변 — `remainingText` 행의 내용만 바뀐다(한 `distanceText` = 한 접근성 객체, `spokenDistanceUnits` 낭독 정정 경유). 새 행·live region 없음(④).

## 5. 웹

### 5.1 `useRouteGuide`

- 입력: `options.via?: RouteGuideVia | null`(`{ lat, lng, label }`). **기본 없음 = 종전 동작 바이트 동일**. 기존 네 번째 인자 객체에 선택 필드로 더하므로 기존 호출부가 그대로 컴파일된다. 매 렌더 ref로 두고 조회 직전에 읽는다(`walkAxis` 동형 — 봉인하지 않는다).
- walk 조회만 `walkRouteUrl({ via })`에 싣는다(자동차 경유지 개방은 범위 밖 — car 조회는 계속 `via` 없음). 세션 안에서 도착을 확정하면(`waypointReached` 소비) `viaPassedRef = true` — 이후 재조회는 출발→도착(iOS `waypoint = nil` 동형). `start()`가 되돌린다.
- 응답 `waypoint.stepIndex`를 `buildGuideRoute(steps, { waypointStepIndex })`에 넘긴다. 경유지를 보냈는데 응답에 `waypoint`가 없으면 **상세 불가**(`unavailable`, iOS `fetchDetailData` 동형 — 경유지를 모르는 경로로 조용히 안내하지 않는다). 커밋 시 경로 결박 라벨 `routeViaLabelRef`를 기록한다.
- `GuideProgress`에 `target: { kind: "route" } | { kind: "waypoint"; label } | { kind: "destination"; label }`을 더하고 `remainingMeters`·`etaSeconds`는 그 목표 기준(walk 비례, car는 `waypoint`에서 null). 조망(`announceProgress`)은 총 잔여 산식을 계속 쓴다.
- 이벤트: `waypointApproaching` → `viaRemaining` 통지(`rememberGuidance` 안 함), `waypointReached` → 톤 계층 `priorityTone: "nearby"` + `viaArrivedContinue` 통지 + `viaPassedRef = true`. 통지는 기존 `announce` 창구 하나(A40).

### 5.2 `DistanceBeacon`

- props에 `via?: { lat: number; lng: number; label: string } | null`(선택)을 더해 훅에 넘긴다. 기존 호출부(`DirectionsView.tsx`)는 무변경 컴파일.
- 진행 행: `progress.target`으로 거리 조각 키를 고른다(`route`는 종전 `guide.remainingDistance`). 한 `<p>` 한 텍스트(`joinText`).

### 5.3 인계 (웨이브 2 `n4-web-wire`)

`<DistanceBeacon via={{ lat, lng, label }} … />` — 경유지 조회의 도보 안내 시작 버튼에 폼의 경유지를 넘기고 `walkGuideStartable`의 `!hasVia`를 푼다. 훅을 직접 쓰면 `useRouteGuide(dest, "walk", axis, { onSessionEnd, via })`.

## 6. 안드로이드

`:kit` `RouteGuide.kt`에 §2 전량(필드·상태·이벤트·W0·W4·`guideNextTarget`) 미러 + `RouteGuideTest`가 같은 fixture를 소비. `:app` `WalkGuideModel.consume`의 `when`은 봉인 클래스라 새 이벤트에 **무동작 분기 1줄**이 컴파일에 필요하다(표시·통지 배선은 E43 후속). strings는 재생성만.

## 7. 테스트·게이트

- fixture §2.6 5건 — 웹 `route-guide.test.ts`·Kit `RouteGuideTests`·`:kit` `RouteGuideTest`가 같은 파일을 읽는다(`expect.nextTarget` 판정 3벌).
- 웹 jsdom: `useRouteGuide`(경유지 옵션이 `via` 파라미터로 나가는가, 도착 뒤 재조회에서 빠지는가, 경유지 응답 부재면 상세 불가), `DistanceBeacon`(행 라벨 전환, `via` 미지정 시 종전 문구).
- iOS: `BeaconModel` 배선은 테스트 레인이 없어 순수 계층(`guideNextTarget`)과 fixture가 잠그고 실기기 판정으로 넘긴다.
- 게이트: `test:run`·`tsc`·`lint`·Kit `swift test`·`:kit` 테스트·xcodebuild 실험판 빌드 1회.

## 8. 실보행 판정 (BACKLOG §2 도보 표)

① 접근 예고 50m가 이른가·늦은가(잠정) ② 도착 문장 뒤 남은 거리 행 라벨 전환을 알아채는가 ③ 예고와 선행 전문·임박 큐가 겹칠 때 순서가 자연스러운가.

## 9. 설계 리뷰 결과

(리뷰 뒤 기록)
