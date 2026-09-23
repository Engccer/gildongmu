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

- **안에**: 리듀서 3벌(웹 `route-guide.ts` ↔ Kit `RouteGuide.swift` ↔ `:kit` `RouteGuide.kt`) + 공유 fixture, iOS `BeaconModel`·`BeaconTrackingSheet`, 웹 `useRouteGuide`·`DistanceBeacon`, 문장 4개(6로케일·xcstrings·`arg-order.json`·안드로이드 strings 재생성).
- **밖에**: 웹 길찾기 화면의 `walkGuideStartable` `!hasVia` 해제·경유지 전달(웨이브 2 `n4-web-wire`), 자동차 경유지 접근 예고(프로파일 값 null — N4에 남김), 안드로이드 앱 UI 배선(`WalkGuideModel.kt`·`GuideSheet.kt` — BACKLOG E43 등가성 후속; 컴파일에 필요한 무동작 분기 1줄만 넣는다), 띠바 거리(총 잔여 유지, 경유지 spec §4.4 판정 그대로).

## 2. 리듀서

### 2.1 프로파일 값

`GuideTuning.waypointApproachM: number | null` — 경유지 접근 예고 임계(경유지 도착선까지 경로 잔여, m). null = 접근 예고 없음.

- walk: `WAYPOINT_APPROACH_M = HANDOFF_DIST_M`(= 50). 옛 최종 접근 진입선(기하 없는 세션의 50m 인계)과 같은 값에서 시작하되 **이름을 따로 둔다** — 실보행에서 한쪽만 바뀔 수 있다(⚠ 잠정, BACKLOG §2 도보 표).
- car·carDriver: `null`. 자동차의 경유지 리듬(속도 연동 거리)은 판정 밖이다. 자동차 세션은 도착 이벤트만 종전대로 받는다.

### 2.2 상태

`GuideState.waypointApproached: boolean`(접근 예고 소비 래치). 초기 false. `restateAt`(재획득·복귀)은 **승계**한다(`waypointReached`·`waypointPending`과 같은 목록 — 승계 목록은 `restateAt` 한 곳). 새 경로 세대(`initialGuideState`)는 초기화한다. 그래서 판정 ②의 "1회"는 **경로 세대당**이다 — 예고 뒤 재조회로 경유지 잔여가 다시 50m 밖이 되면 새 세대에서 다시 낸다(참인 새 경로의 문장, 의도).

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
    if rem >= 1 && rem <= tuning.waypointApproachM {
        next.waypointApproached = true; next.lastAnnouncedAt = now
        return emit(next, .waypointApproaching(round(rem)), nil)
    }
}
```

- **수준 판정 + 래치**다(교차 판정이 아니다). 같은 fix에 더 높은 이벤트(임박·도착·선행 전문)가 걸리면 이번 fix를 내주고 다음 fix에 나간다 — 조건이 계속 참이기 때문이다. 교차 판정(`farNotice` 방식)은 그 경합에서 예고를 영구히 잃는다.
- **도착이 예고를 대신한다**: 예고가 밀린 사이 도착선을 넘으면 W1이 `waypointReached`를 세우고 W4는 다시 서지 않는다(`!waypointReached`). "경유지까지 3m" 뒤 곧바로 "도착"이 붙는 잉여가 없다. `rem > 0`은 `!isOff ∧ !jumped ∧ !waypointReached`에서 따라 나온다(W1이 같은 조건으로 먼저 섰을 것이므로).
- **W0 — 시작·재조회 세대가 접근선 안에서 시작하면 무발화 소비**: 원거리 예고의 "재진입 시점 유닛 소비"(`farNoticedUpTo`)와 같은 원리다. 시작·재조회 직후 첫 fix에 예고가 나가면 시작 통지(원자 시작 발화)나 재조회 통지 바로 뒤에 겹친다. 경유지 추가 직후처럼 가까운 경우엔 곧 도착이 알린다. 판정 기준은 fix의 `d`가 아니라 **세대 진입 `state.d`**(= 0)다(W0는 투영 전이다). 그래서 도착선이 50~60m인 경로는 첫 투영이 몇 m 나아가 있으면 시작 통지 뒤 예고가 붙을 수 있다(받아들이는 경계값 대가).
  - `lastFixAt == null`은 **`initialGuideState`(시작·재조회) 뒤 첫 fix에서만** 참이다. 재획득·이탈 복귀는 `restateAt` 직후 `lastFixAt = now`로 덮으므로 W0를 지나지 않는다. 즉 예고 전 공백을 지나 접근선 안에서 재획득하면 **복귀 통지 다음 fix에 예고가 나간다**(의도 — 공백 뒤 "경유지까지 N m"는 위치를 되찾은 사용자에게 정보다). 예고를 이미 냈으면 래치 승계로 다시 나가지 않는다. 두 경로 모두 fixture가 잠근다(§2.6).
- **1m 미만은 예고하지 않는다**: "경유지까지 0m"는 곧 도착이라 W1에 맡긴다.
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
6. 예고 뒤 공백 → 재획득 → 접근선 안: 래치 승계로 다시 안 나간다.
7. 예고 전 공백 → 재획득이 접근선 안: 복귀 통지(`reacquired`) → 선행 전문 → 예고(재구성은 W0를 지나지 않는다).
8. 임박 큐와 같은 fix: 임박 먼저, 예고는 다음 fix.
9. 접근선 안 fix가 이탈 의심(수직거리 40m): 그 fix는 예고 없음, 다음 정상 fix에서 예고.

## 3. 문장 (6로케일, `directions` 네임스페이스)

| 키 | ko(확정값) | 소비 |
|---|---|---|
| `directions.viaRemaining` | `경유지 {label}까지 {distance}` | 접근 예고 통지 + 남은 거리 행(도착 전)의 거리 조각 |
| `directions.viaDestRemaining` | `목적지 {dest}까지 {distance}` | 남은 거리 행(도착 뒤)의 거리 조각 |
| `directions.viaArrivedContinue` | `경유지 {label} 도착. 이제 목적지 {dest} 안내합니다` | 도착 통지 |
| `directions.viaDropped` | `경유지 {label}를 포함한 경로를 찾지 못해 경유지 없이 안내합니다` | 웹: 경유지 경로를 못 받아 간략 안내로 내려갈 때(iOS `ios.guide.waypointDropped`와 같은 문장, 6로케일 동일 사본) |

- 행은 `joinText(거리 조각, guide.remainingTime)` — 종전 행과 같은 조립(쉼표, 한 객체). 시간 조각은 근거 없으면 생략(3-state).
- **ko `{dest}`에는 호출부가 방향 조사를 붙인다**(`directionParticle`·`KoreanParticle.direction` — "서울역으로"·"학교로"·"길동으로"). 그래서 ko 문자열 자원은 조사 없이 `{dest} 안내합니다`로 저장되고, `{dest}`를 조사 없이 넣는 소비자를 새로 만들면 안 된다(소비자는 두 플랫폼의 도착 통지 한 곳씩). 받침 판정이 안 되는 이름(영문·숫자·괄호 끝)은 **`로`로 물러난다** — 조사를 빼면 "목적지 GS25 안내합니다"로 문장이 깨지기 때문이다. ⚠ 이 폴백은 **추측**이다: 읽는 소리가 모음·ㄹ로 끝나면 맞고(에스·오·일·엘), 3·6·0·M·N·"…Market"·"(…점)"처럼 받침 소리로 끝나면 틀린다. 받침에 무관한 문형("{dest}까지 안내합니다")으로 물러나는 안은 새 문안이라 채택하지 않았다 — 실보행 판정(§8 ④)에서 거슬리면 그때 문안 왕복으로 연다. 비-ko 로케일은 조사 없이 `{dest}` 원문.
- 조망 목록의 구획 행은 종전 `directions.viaArrived`("경유지 {label} 도착") 그대로다 — 세 소비자(웹·CLI·iOS 조망)가 같은 구획 문장을 쓴다(경유지 spec §4.3).
- xcstrings는 `messages-to-xcstrings.mjs`로 재생성, `ios/i18n/arg-order.json`은 신규 키만 `--update-arg-order`, 안드로이드 strings는 변환 스크립트로 재생성(손 편집 금지).

## 4. iOS

### 4.1 `BeaconModel`

- `updateRemaining(route:state:)`: `guideNextTarget`로 조각을 고른다. `waypoint` → `viaRemaining(routeWaypointLabel, 경유지 잔여)`; `destination` 또는 **이 세션이 경유지를 지났으면**(`waypointPassedInSession` — 지난 뒤 재조회 경로엔 경유지가 없어 `route`가 된다) → `viaDestRemaining(destinationLabel, 총 잔여)`; 그 밖 → 종전 `guide.remainingDistance(총 잔여)`. 라벨은 **경로에 결박된 `routeWaypointLabel`**(도착 뒤 `waypoint = nil`이 돼도 남는다)이고, 그것이 nil이면(방어) 거리까지 함께 종전 행(총 잔여)으로 물러난다.
- 행은 감지(W1) 시점에 바뀌고 문장은 발화 시점에 나간다 — 도착이 임박 큐에 밀린 fix(W2)에서는 행이 문장보다 한 fix 먼저 "목적지 {dest}까지"가 된다(의도, 실보행에서 결함으로 읽지 말 것).
- 시간 조각: walk는 총 소요의 **목표 잔여 비례**(`duration × meters / totalMeters`, 종전 식의 분자만 목표 잔여로). car는 `waypoint` 목표에서 **생략**(재조회 ETA는 목적지까지라 경유지 시간이 아니다 — 날조 금지), 그 밖은 종전 ETA 카운트다운. 목표 잔여 1m 미만이면 생략("0m, 약 1분" 금지). `etaMinutesNow`(조망이 쓰는 총 잔여 산식)는 목표 잔여를 받는 `etaMinutes`의 총 잔여 호출로 둔다(사본 금지).
- 띠바 `updateBandDistance`는 총 잔여 유지.
- `consume(.waypointApproaching(m))`: `text = viaRemaining(label, formatDistance(m))`, `statusText = text`, `announce(text)`. 톤 없음. `lastGuidance`는 덮지 않는다(실행 안내가 아니다). 억제 중이면 발화하지 않고 보관하지 않는다(거리 문장은 시간이 지나면 거짓 — 주기 통지와 같은 취급). 라벨이 nil이면 무발화.
- `consume(.waypointReached)`: 문장만 `viaArrivedContinue(reached.label, destinationLabel + 조사)`로 바꾼다. 나머지(도착 종·`waypoint = nil`·파생물 폐기·억제 중 보관)는 불변.
- 운전자 채널: car 프로파일은 예고를 내지 않으므로 해당 없음.

### 4.2 `BeaconTrackingSheet`

행 구성 불변 — `remainingText` 행의 내용만 바뀐다(한 `distanceText` = 한 접근성 객체, `spokenDistanceUnits` 낭독 정정 경유). 새 행·live region 없음(④).

## 5. 웹

### 5.1 `useRouteGuide`

- 입력: `options.via?: RouteGuideVia | null`(`{ lat, lng, label }`). **기본 없음 = 종전 동작 바이트 동일**. 기존 네 번째 인자 객체에 선택 필드로 더하므로 기존 호출부가 그대로 컴파일된다. 매 렌더 ref로 두고 조회 직전에 읽는다(`walkAxis` 동형 — 봉인하지 않는다).
- walk 조회만 `walkRouteUrl({ via })`에 싣는다(자동차 경유지 개방은 범위 밖 — car 조회는 계속 `via` 없음). 세션이 더는 싣지 않는 경유지는 **좌표 정체성**으로 든다(`excludedViaRef`): 도착을 확정하면(`waypointReached` 소비) 그 경로의 경유지를, 경유지 경로를 못 받아 간략으로 내려가면 요청한 경유지를 넣는다. 조회 직전 입력 `via`가 그것과 같으면 빼고 다르면 싣는다 — 세션 중 입력이 다른 경유지로 바뀌면 그것은 다시 간다. `start()`가 비운다.
- **왕복 중 도착**: 재조회 응답이 착지했는데 그 경로의 경유지가 이미 제외 대상이면(왕복 중 지났다) **폐기**한다(iOS `rerouteToken += 1` 동형). 커밋하면 새 세대가 지난 경유지를 되살려 도착이 두 번 난다. 이탈 상태는 남아 버튼으로 다시 누를 수 있다.
- **경유지 부재 강등**: 시작 조회가 실패해 간략 안내로 내려가는데 경유지를 요청했다면, 강등 통지 뒤에 `directions.viaDropped`를 붙인다(화면엔 경유지가 남아 있어 말하지 않으면 간략 직선 안내가 경유지를 지나는 것처럼 들린다 — iOS `waypointDropped` 동형). 상시 표시는 종전 강등 문구.
- 응답 `waypoint.stepIndex`를 `buildGuideRoute(steps, { waypointStepIndex })`에 넘긴다. 경유지를 보냈는데 응답에 `waypoint`가 없으면 **상세 불가**(`unavailable`, iOS `fetchDetailData` 동형 — 경유지를 모르는 경로로 조용히 안내하지 않는다). 커밋 시 경로 결박 라벨 `routeViaLabelRef`를 기록한다.
- `GuideProgress`에 `target: { kind: "route" } | { kind: "waypoint"; label } | { kind: "destination"; label }`을 더하고 `remainingMeters`·`etaSeconds`는 그 목표 기준(walk 비례, car는 `waypoint`에서 null, 1m 미만 null). 경유지를 지난 세션(`viaPassedRef`)은 재조회 경로에서도 `destination`(iOS 동형). 시간은 `etaSecondsFor(route, 잔여, toWaypoint)` 한 함수이고 **조망(`announceProgress`)은 총 잔여로 부른다** — 행의 경유지 시간을 조망의 총 거리에 붙이면 "1.2km, 약 8분" 같은 거짓 수치가 된다.
- 이벤트: `waypointApproaching` → `viaRemaining` 통지(`rememberGuidance` 안 함), `waypointReached` → 톤 계층 `priorityTone: "nearby"` + `viaArrivedContinue` 통지 + `viaPassedRef = true`. 통지는 기존 `announce` 창구 하나(A40).

### 5.2 `DistanceBeacon`

- props에 `via?: { lat: number; lng: number; label: string } | null`(선택)을 더해 훅에 넘긴다. 기존 호출부(`DirectionsView.tsx`)는 무변경 컴파일.
- 진행 행: `progress.target`으로 거리 조각 키를 고른다(`route`는 종전 `guide.remainingDistance`). 한 `<p>` 한 텍스트(`joinText`).

### 5.3 인계 (웨이브 2 `n4-web-wire`)

`<DistanceBeacon via={{ lat, lng, label }} … />` — 경유지 조회의 도보 안내 시작 버튼에 폼의 경유지를 넘기고 `walkGuideStartable`의 `!hasVia`를 푼다. 훅을 직접 쓰면 `useRouteGuide(dest, "walk", axis, { onSessionEnd, via })`.

## 6. 안드로이드

`:kit` `RouteGuide.kt`에 §2 전량(필드·상태·이벤트·W0·W4·`guideNextTarget`) 미러 + `RouteGuideTest`가 같은 fixture를 소비. `:app` `WalkGuideModel.consume`의 `when`은 봉인 클래스라 새 이벤트에 **무동작 분기 1줄**이 컴파일에 필요하다. strings는 재생성만.

**안드로이드 사용자는 이번 웨이브에서 종전 그대로 듣는다(의도)**: 예고 없음, 도착 문장 "경유지 X 도착", 남은 거리 행은 총 잔여. 등가성 4항(예고 소비·도착 문장 교체·행 다음 목표·경유지 지난 세션의 행)은 BACKLOG E43에 등재한다.

## 7. 테스트·게이트

- fixture §2.6 5건 — 웹 `route-guide.test.ts`·Kit `RouteGuideTests`·`:kit` `RouteGuideTest`가 같은 파일을 읽는다(`expect.nextTarget` 판정 3벌).
- 웹 jsdom: `useRouteGuide`(경유지 옵션이 `via` 파라미터로 나가는가, 도착 뒤 재조회에서 빠지는가, 경유지 응답 부재면 상세 불가), `DistanceBeacon`(행 라벨 전환, `via` 미지정 시 종전 문구).
- iOS: `BeaconModel` 배선은 테스트 레인이 없어 순수 계층(`guideNextTarget`)과 fixture가 잠그고 실기기 판정으로 넘긴다.
- 게이트: `test:run`·`tsc`·`lint`·Kit `swift test`·`:kit` 테스트·xcodebuild 실험판 빌드 1회.

## 8. 실보행 판정 (BACKLOG §2 도보 표)

① 접근 예고 50m가 이른가·늦은가(잠정) ② 도착 문장 뒤 남은 거리 행 라벨 전환을 알아채는가(받아쓰기 억제 중 지난 경우 — 예고는 버리고 도착만 갚는다 — 포함) ③ 예고와 선행 전문·임박 큐가 겹칠 때 순서가 자연스러운가 ④ 영문·숫자로 끝나는 목적지 이름에서 도착 문장의 "로" 폴백이 거슬리는가(§3).

## 9. 설계 리뷰 결과

적대적 리뷰 1회(`model: fable`, 2026-09-24, 리뷰 대상 `562c6fb8`): HIGH 3 · MEDIUM 6 · LOW 5, BLOCKER 없음, 판정 ④ 충돌 없음. 전부 반영(본문에 녹였다). 2회차는 돌리지 않았다 — 지적이 전부 국소 보정이고 계층 선택을 흔든 것이 없다.

| # | 지적 | 판정 |
|---|---|---|
| 1 HIGH | W0가 재획득·복귀에서 돈다는 서술이 거짓(`restateAt` 뒤 `lastFixAt = now`) | 수용 — 서술 정정, 재구성 뒤 예고 허용을 의도로 명시, fixture 2건(§2.4·§2.6 ⑥⑦) |
| 2 HIGH | 웹: 왕복 중 도착 뒤 착지한 재조회가 경유지를 되살림 | 수용 — 제외 경유지와 같은 경로 응답 폐기 + jsdom |
| 3 HIGH | 웹 조망이 행의 경유지 시간을 재사용 | 수용 — `etaSecondsFor` 분리, 조망은 총 잔여 + jsdom |
| 4 MEDIUM | 조사 폴백 "로"는 추측 | 부분 수용 — 서술을 추측으로 정정·실보행 ④, 새 문형 안은 새 문안이라 보류 |
| 5 MEDIUM | 세션 중 `via` 변경 계약 부재 | 수용 — 제외 경유지를 좌표 정체성으로 |
| 6 MEDIUM | 웹 경유지 부재 강등이 침묵 | 수용 — `directions.viaDropped`(iOS 문장 사본) |
| 7 MEDIUM | 도착 뒤 재조회에서 행이 "남은 거리"로 되돌아감 | 수용 — 세션 플래그로 목적지 목표 유지(iOS·웹) |
| 8 MEDIUM | fixture가 승계·임박 경합·이탈 의심을 못 잠금 | 수용 — 4건 추가(§2.6 ⑥~⑨) |
| 9 MEDIUM | 안드로이드가 옛 문장을 계속 냄 | 수용 — §6에 의도 명시, E43 4항 |
| 10 LOW | 50~60m 경계에서 시작 통지 뒤 예고 | 수용 — 대가로 명시 |
| 11 LOW | "0m" 예고·"0m, 약 1분" | 수용 — `rem ≥ 1`, 1m 미만 시간 생략 |
| 12 LOW | 재조회 세대 초기화로 예고 두 번 | 수용 — "세대당 1회"로 명시 |
| 13 LOW | 웹 도착 톤·행 전환 시점·라벨 폴백 서술 | 수용 — §4.1·§5.1 서술 |
| 14 | ④ 충돌 없음, 억제 복귀 경로 | 수용 — §8 ②에 포함 |
