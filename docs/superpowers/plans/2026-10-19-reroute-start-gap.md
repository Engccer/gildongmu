# A70 재조회 C 세 층 구현 계획 (2026-10-19)

spec: `docs/superpowers/specs/2026-10-19-reroute-start-gap-design.md`. 세션 `a70-reroute`, worktree `~/gildongmu-wt/a70-reroute`(base `641739f8`).

구현 방식 판정: **웹 기준본(T1~T4)은 inline** — 리듀서·게이트·훅이 같은 이벤트·상태 이름을 정하고 뒤 태스크의 인터페이스를 바꾼다(선행 결정이 후속 인터페이스를 바꾼다). **Kit·`:kit`·iOS 앱·안드로이드 앱 이식(T5~T7)은 sonnet 서브에이전트 과제**로 웹 기준본 커밋 뒤에 낸다 — 파일이 겹치지 않고(Kit·`:kit`·앱 셋) 기준본과 공유 fixture가 계약을 고정한다. T5(Kit)와 T6(`:kit`)는 병렬, T7(iOS 앱·안드로이드 앱)은 각 미러가 끝난 뒤.

## T1. 서버 출발점 재시도 (`src/lib/walk-route.ts`)

- `ORIGIN_GAP_RETRY_M = 30`, `routeOriginGapMeters(briefing, origin)`(첫 점 없으면 null).
- `resolveWalkRoute`: `includeGeometry`일 때만, 기본·shortest 축에서 카카오 응답 gap > 30 ∧ ko ∧ Tmap 키 → Tmap 재조회(같은 via·searchOption), gap 작은 쪽 채택(동률 카카오, 재시도 throw/null은 카카오 유지 + 로그). 계단 회피·en·Tmap 폴백 응답은 재시도 없음.
- 채택 응답의 gap > 30이면 `originGapM`(정수). `WalkRouteBriefing.originGapM?` 타입.
- 테스트: `walk-route.test.ts`류에 provider mock으로 ①근거리 재시도 없음·필드 부재 ②카카오 먼데 Tmap 가까움 → Tmap ③둘 다 멂 → 가까운 쪽 + 필드 ④Tmap 실패 → 카카오 + 필드 ⑤브리핑 응답(기하 없음) 재시도 없음·필드 부재 ⑥계단 회피 재시도 없음 ⑦en 재시도 없음·필드 규칙.

## T2. 리듀서 (`route-geometry.ts`·`route-guide.ts`·`final-approach.ts`)

- `GuideRoute.destination?: Coord`, `buildGuideRoute(steps, { waypointStepIndex, destination })`.
- `GuideTuning.rerouteFarM`·`rerouteFarS`·`offRouteArrivalEntry`(walk 100·60·true, car 400·60·false, carDriver는 car 상속 확인).
- `GuideState.offRouteFarSince`, `CLEARED_RETURN_TIMERS`·`guideStateAt`·`confirm` 초기화.
- `RerouteReason` `"far"`, 돌아가기 국면 (2) 단계 `far` 판정(§3.1 순서·재무장).
- `offRouteArrivalQualifies(distance, accuracy)`(final-approach), 돌아가기 국면 맨 앞 입구 → `phase: finalApproach` + `{kind: "nearDestination"}`.
- fixture `route-guide-scenarios.json`: `dest` 키, 시나리오 `A70 ①` 수렴 걸음 far(합성: 확정 249m → 60초 뒤 far, 다가가는 중) · `A70 ②` 40m 평행 보도 장시간 far 없음 · `A70 ③` far 뒤 재무장(조회 실패 가정: 같은 상태로 60초 더 → far 재발) · `A70 ④` 이탈 중 목적지 25m(acc 10) 5초 지속 → nearDestination(4초째는 없음) · `A70 ④-b` 근접 fix 뒤 자격 없는 fix 하나면 연속이 끊긴다 · `A70 ④-c` 미통과 경유지가 있으면 닫힘 · `A70 ⑤` 정확도 35m면 입구 닫힘 · `A70 ⑥` dest 없으면 닫힘 · `A70 ⑦` 자동차 400m·60초 far + 자동차 입구 닫힘 · `A70 ⑧` uncertain 공백은 60초에 산입되지 않음. 웹 하네스에 `dest` 처리.

## T3. 채택 검사 판정 (`reroute-proposal-gate.ts`)

- `routeStartGapMeters(route, current)`, `routeStartsNearby(route, current, maxDrift)`, `routeStartCompass(route, from)`(→ `bearingToCompass8` 재사용, 웹은 `geo/bearing.ts`).
- 새 공유 fixture `route-start-gap-cases.json`(gap·nearby·compass 판정표).

## T4. 웹 훅 (`useRouteGuide.ts`) + 문자열

- `autoReroute`: 신선도 뒤 `routeStartsNearby` 거짓 → `raiseRerouteButton(true)`(원인 `farStart`).
- 시작(`detailStart`·`carStart`)·버튼 재조회(`rerouteDone`): gap > `rerouteMaxDriftM`이면 `guide.routeStartsAway` 앞 문장.
- `nearDestination` 소비: 최종 접근 진입(서술 없음·간략 인계 없음·이탈 흔적 정리) + 도착 또는 `finalApproachNear`.
- `buildGuideRoute(…, { destination })`.
- 6로케일 `messages/*.json`에 `guide.routeStartsAway`. 생성물(xcstrings·arg-order·안드로이드 strings)은 rebase 뒤 재생성.
- 테스트: 훅 offroute 테스트 레인(`useRouteGuide.offroute.test.tsx` 관례)에 자동 거부·시작 고지·nearDestination 소비. 소스 가드 `a70-destination-wiring.test.ts`(세 오케스트레이터의 `buildGuideRoute`가 `destination`을 싣는다, iOS·안드로이드 앱 파일 문자열 대조).

## T5. Kit 미러 (sonnet, `ios/GildongmuKit`)

`RouteGeometry.swift`(destination)·`RouteGuide.swift`(T2 전부)·`FinalApproach.swift`(술어)·`RerouteProposalGate.swift`(T3, 8방위 함수 신규)·테스트 하네스(`dest`)·새 fixture 소비. `swift test` 통과.

## T6. `:kit` 미러 (sonnet, `android/kit`)

같은 범위의 Kotlin 미러 + `RouteGuideTest`·`RerouteProposalGateTest` 하네스. 정규식 약칭·`trim` 금지 규칙 준수. `:kit:test` 통과.

## T7. 앱 배선 (sonnet, 미러 뒤)

- iOS `BeaconModel.swift`: `fetchDetailData`의 `destination`, `fetchProposal` 거부(`farStart`), 시작·`performReroute` 고지, `nearDestination` → `beginFinalApproach(entry: .offRoute)`. `GuideText` 문장 조립. iOS 키는 `messages` 생성물.
- 안드로이드 `WalkGuideModel.kt`: 같은 넷.
- 빌드: Kit `swift test`, xcodebuild Release·Experimental, `:app` 테스트.

## T8. 실호출 게이트 `scripts/verify-walk-origin-gap.mjs` (spec §7)

로컬 `npm run dev` 대상, 비공개 케이스는 `ORIGIN_GAP_CASES` 경로(저장소 밖). 결과 거리만 spec §7에.

## T9. 리뷰·문서·통합

- 적대적 설계 리뷰(이 계획·spec 커밋 뒤) → 구현 리뷰(opus, `git diff origin/main...HEAD`) → 안전 최종 검토(fable 1회) → a11y 점검(opus, 문장·포커스 변화).
- 문서: CHANGELOG · BACKLOG A70 종결 + §2 행 · FIELD-TEST 행 · PROGRESS 한 줄 · INTEGRATIONS §이탈은 돌아가기 국면의 시작이다(far·두 번째 입구·채택 검사) · INTEGRATIONS 도보 경로 출발점 재시도.
- 게이트: `test:run`·`tsc`·`lint`·Kit `swift test`·xcodebuild 두 구성·`:kit`/`:app` 테스트(gate-lock), 실호출 게이트.
