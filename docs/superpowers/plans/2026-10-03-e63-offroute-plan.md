# E63 이탈 방향 안내 구현 계획 (e63-offroute)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 또는 superpowers:executing-plans. 체크박스(`- [ ]`)로 추적한다.

**Goal:** 이탈 확정을 재조회가 아니라 "돌아가기 국면"의 시작으로 바꾸고(벗어난 쪽 + 돌아갈 시계 방향을 말한다), 계속 멀어지거나 나란히 계속 걸을 때만 자동으로 새 경로를 받는다(도보·자동차, 웹·iOS, 리듀서 세 벌).

**Architecture:** 판정은 순수 리듀서(웹 `route-guide.ts` ↔ Kit `RouteGuide.swift` ↔ `:kit` `RouteGuide.kt`)가 전부 하고 공유 fixture가 세 벌을 잠근다. 리듀서는 `offRoute{…}`·`backOnRoute{spoken}`·`rerouteNeeded{reason}`를 내고, 오케스트레이터(iOS `BeaconModel`, 웹 `useRouteGuide`)는 문장 조립·발화·자동 조회만 한다. 자동 조회 트리거는 `case .offRoute`의 회차 시작에서 `rerouteNeeded`로 옮긴다(운전자 채널만 확정 즉시).

**Tech Stack:** TypeScript(Vitest) · Swift(GildongmuKit SwiftPM, 앱 SwiftUI) · Kotlin(`:kit` 순수 JVM, `:app` Compose) · i18n 원천 `messages/*.json`·`ios/i18n/ios-extra` → 생성물(xcstrings·안드로이드 strings·arg-order).

**Spec:** `docs/superpowers/specs/2026-10-03-offroute-return-design.md`(J1~J4 개정 `f351785d`) · 문안 `docs/superpowers/specs/2026-10-03-guidance-wording-confirmed.md` 다·라·마 · 백로그 `docs/BACKLOG.md` E63·A55.

설계 리뷰 판정: 설계는 spec이 리뷰를 받았다(조사 세션 2회 + J4 갈래 1회). 이 계획은 그 계약의 구현 순서다.

구현 방식 판정: 리듀서 웹 기준본·fixture·문자열·오케스트레이터는 inline(같은 파일 다중 편집·선행 결정이 후속 인터페이스를 바꾼다). Kit·`:kit` 미러 이식은 웹 기준본이 선 뒤 서로 독립(파일 겹침 없음)이라 서브에이전트 둘로 병렬 위임하고, 세 벌은 한 커밋으로 묶는다(계획 §0).

## Global Constraints

- 리듀서 세 벌·공유 fixture는 같은 커밋에서 고친다. 상수·분기 순서는 세 벌이 같다.
- 수단별 차이는 `GuideTuning` 데이터로만(`sessionKind` switch 금지). 새 튜닝 필드에 기본값을 두지 않는다.
- 이벤트 연관값(`guidance`·`side`·`firstSpoken`·`spoken`·`reason`)은 소비자에서 기본값 없이 받는다.
- 시계 함수는 `clock-direction.ts` ↔ `ClockDirection.swift` ↔ `ClockDirection.kt`의 `relativeBearing`·`clockHour`를 부르고 다시 만들지 않는다. 키 `guide.clockDirection`.
- 서버 응답 불변(이탈·재조회는 전부 클라이언트). 재조회 조회는 시작 조회와 같은 `wording=2` 축(이미 공유 빌더).
- 문장은 문안 확정본·BACKLOG E63 추가 판정 그대로. ko 플레이스홀더 순서를 바꾸면 `--update-arg-order` 두 벌 + 호출부(iOS·웹·안드로이드 앱) 인자를 함께.
- 새 통지는 `announce` 창구로만(톤 뒤 발화 계약). em dash 금지(사용자 문안).
- 로그에 좌표 유도 id 금지. 공개 저장소: 자택·실주소 금지.

## Review Focus

1. **경로로 돌아왔는데 복귀(15m·8초)가 늦는 사람이 경로를 따라 걷는다** → 나란히 걷기 재조회가 나면 안 된다(하한 15m 기준점 재설정). fixture 16.
2. **확정 순간 걷던 방향이 이미 경로 쪽(시계 11~1)** → 말·톤·진동 0, 경로 위로 오면 "복귀했습니다"도 0. fixture 11(가).
3. **보류 뒤 첫 발화가 백그라운드에서 버려지지 않는다** → `firstSpoken`으로 `.actionable` 분류(iOS 소비 단위 테스트).
4. **자동 조회가 진행 중일 때 리듀서가 또 `rerouteNeeded`** → 무시(예산·토큰 보존). iOS·웹 오케스트레이터 가드.
5. **en 세션의 이탈 문장** → 시계 방향·쪽 낱말이 6로케일에서 한 언어로 나온다(i18n 테스트 + 키 린터).

---

### Task 1: 웹 리듀서 기준본 + 공유 fixture (세 벌 커밋의 웹 몫)

**Files:**
- Modify: `src/lib/route-guide.ts`(이벤트·상태·튜닝·5절 이탈 분기·확정 경로·재획득·uncertain), `src/lib/route-geometry.ts`(부호 있는 수직·확정 지점 창 투영·점 좌표), `src/lib/__tests__/route-guide.test.ts`(하니스 기대 키), `src/lib/__tests__/fixtures/route-guide-scenarios.json`(시나리오 1~17 + 기존 이탈 시나리오 갱신), `src/lib/guide-live-rows.ts`(이벤트 타입 변화만)
- Test: 위 테스트 + `a6-probe.test.ts`·`course-derivation-replay.test.ts` 등 기존 이탈 테스트

**Interfaces (Produces):**
```ts
export type OffRouteNotice = "confirm" | "renotify";
export type OffRouteReason = "distance" | "course" | "joint";
export type OffRouteGuidance = "turn" | "opposite" | "sideOnly" | "hold";
export type OffRouteSide = "left" | "right";
export type RerouteReason = "away" | "parallel";
// GuideEvent
| { kind: "offRoute"; notice: OffRouteNotice; reason: OffRouteReason; guidance: OffRouteGuidance;
    side: OffRouteSide | null; returnRelDeg: number | null; firstSpoken: boolean }
| { kind: "backOnRoute"; spoken: boolean }
| { kind: "rerouteNeeded"; reason: RerouteReason }
// GuideState 추가
offRouteConfirmD: number | null; offRouteMinPerp: number | null;
offRouteAwayRun: { count: number; since: number } | null;
offRouteAnchor: { lat: number; lng: number; perp: number } | null;
offRouteReason: OffRouteReason | null; offRouteSpoken: boolean;
returnCandidateSince: number | null;
perpHistory: readonly { at: number; perp: number }[];
lastHeading: { bearing: number; uncertaintyDeg: number; at: number } | null;
// GuideTuning 추가(spec §4.3 + J4): rerouteAwayM rerouteAwayFixes rerouteAwayMinS rerouteParallelM
// rerouteParallelClosingM jointConfirmPerpM(null) jointConfirmMismatches approachVoteMaxDeg(null)
// approachVoteClosingM returnPerpM(null) returnHoldS returnTargetAheadM returnWindowBackM
// returnWindowAheadM sideMinPerpM oppositeMinDeg headingMaxAgeS headingMaxUncertaintyDeg
// 새 경로 머리말(§3.7): 진행 방위 기준 새 경로 첫 15m의 시. 방위 없음·U 초과면 null.
export function rerouteHeadClock(state: GuideState, route: GuideRoute, now: number, tuning: GuideTuning): number | null;
// route-geometry
export function projectSigned(poly: Polyline, p: Coord, fromD: number, toD: number):
  { d: number; perpMeters: number; signed: number } | null; // signed: 오른쪽 +
export function pointAt(poly: Polyline, d: number): Coord | null;
```

핵심 알고리즘(세 벌 공통, spec §3):
- 유도기 관측은 프로파일 게이트 **앞**에서 `lastHeading`에 보관(게이트는 표결에만).
- 표 계산은 국면 분기 뒤 한 자리(D11): following·bundle은 구속 창 `d`, offRoute는 `entryProjection` 기준(현행).
- 접근 표 제외(§3.2 ②, `approachVoteMaxDeg` 있는 프로파일만): 표가 `mismatch`이고, 진행 방위가 기준 투영점(수직의 발)을 향해 ±45° 안이고, `perpHistory`에서 4초 이상 전 값 중 가장 최근(10초 안) 대비 2m 이상 줄었으면 그 표를 넣지 않는다. 기준 투영은 following에선 구속 창, offRoute에선 확정 지점 창.
- 확정 경로 셋 + 앞질러 감(§3.2 ①⑤): 거리 축(현행) · 방위 축(현행) · 결합(`perp ≥ jointConfirmPerpM` ∧ 창 불일치 ≥ 5 ∧ 일치 0 ∧ `!crawling`). 거리·결합 조건이 선 fix에서 `entryProjection` 후보 하나가 구속 창 끝 너머 앞이면 `restateAt`(이벤트 없음).
- 확정 fix: `dConf = d`, 확정 지점 창 투영으로 방향(§3.3)을 계산해 `offRoute{confirm, …}`. `hold`면 톤 null·`lastOffRouteNoticeAt` 그대로·`offRouteSpoken` false, 아니면 warning·now·true. `firstSpoken = guidance != hold`.
- offRoute 분기 순서: 확정 지점 창 투영 → `perpHistory` 갱신 → 표(접근 제외) → 복귀(§3.6) → 재조회 요청(§3.5 + J4) → 재통지(§3.4).
- 확정 지점 창: `projectSigned(poly, fix, dConf − 60, dConf + 200)`이 창 어느 끝(±0.5m)에 붙으면 `projectSigned(poly, fix, 0, total)`.
- 방향: `side = |signed| < 3 ? null : signed > 0 ? right : left`, 목표점 = `pointAt(dProj + 10)`, `rel = relativeBearing(heading, bearing(fix → 목표))`, `clock = clockHour(rel)`, 접선 = `tangentAt(dProj, 15)`. 순서: 방위 없음·나이 > 5초·U > 30 → `sideOnly` / 접선 차 ≥ 135 ∧ 시계 5~7 → `opposite` / side null → `sideOnly` / 시계 11·12·1 → `hold` / 그 밖 `turn`. `returnRelDeg`는 turn·hold만.
- 복귀(도보 `returnPerpM` 있음): `globalCandidates(max(15, acc))` 하나 → `returnCandidateSince`(이 fix 표가 mismatch면 now로 재설정) → 8초 ∧ (방위 래치면 verdict on) → `backOnRoute{spoken: offRouteSpoken}` + `restateAt`. 자동차: 현행(entryProjection ok ∧ 방위 해제, 유지 0).
- 재조회 요청: `min = min(min, perp)`; 기준점 재설정(`perp < floor` ∨ `perp ≤ anchor.perp − closing`, floor = `returnPerpM ?? offRouteBaseM`); 자격 = `perp ≥ min + Δ` ∨ `haversine(anchor, fix) ≥ L`; 연속 K ∧ 2초 → `rerouteNeeded{away|parallel}`, `min = perp`, `anchor = 이 fix`, run null.
- 재통지: `!speedGuardActive` ∧ (`!offRouteSpoken` ∨ 간격 경과) ∧ 방위 5초 안 ∧ 다가가는 중 아님(10초 이상 전 중 가장 최근(15초 안) 대비 5m 감소 아님) ∧ 다시 고른 guidance ≠ hold → `offRoute{renotify, reason: offRouteReason, …, firstSpoken: !offRouteSpoken}`, 톤 = firstSpoken ? warning : (renotifyWarns ? warning : null).
- uncertain·reacquiring 진입: `returnCandidateSince`·`offRouteAwayRun`·`offRouteAnchor`·`perpHistory` 비움. 이탈 유래 재획득(`reacquiringFromOffRoute`): 도보는 15m 유일 후보가 아니면 곧바로 offRoute로(보존), 후보면 offRoute로 돌아가 다음 fix의 복귀 판정(유지 8초)이 맡는다. 자동차는 현행.
- `guideStateAt`: 새 필드 초기화(`lastHeading`은 opts로 승계, `restateAt`이 넘긴다).

- [ ] Step 1: fixture 시나리오 1~17(+ 기존 이탈 시나리오 6개를 15m·8초 복귀로 갱신)과 하니스 기대 키(`notice`·`reason`·`guidance`·`side`·`firstSpoken`·`spoken`·`rerouteReason`·`returnClock`)를 먼저 쓴다.
- [ ] Step 2: `npx vitest run src/lib/__tests__/route-guide.test.ts` → 새 시나리오 FAIL 확인.
- [ ] Step 3: 위 알고리즘 구현.
- [ ] Step 4: 같은 테스트 + `src/lib/__tests__/` 이탈·방위 축 관련 전부 PASS.
- [ ] Step 5: 변이 주입 3건(하한 제거·접근 제외 제거·hold 판정 제거)으로 fixture가 빨개지는지 확인 후 원복(커밋 뒤).

### Task 2: Kit·`:kit` 미러 (서브에이전트 둘, 병렬)

**Files:** Kit `RouteGuide.swift`·`RouteGeometry.swift`·`GuideSpeechChannel.swift`·`GuideLiveRows.swift`(필요 시)·`RouteGuideTests.swift`·`GuideSpeechChannelTests`; `:kit` 같은 이름 `.kt`와 테스트; 안드로이드 앱 `WalkGuideModel.kt`(최소: `OffRoute` 확정에서 현행 즉시 조회 유지, `RerouteNeeded` 무시, `BackOnRoute`는 `spoken`일 때만 발화) · `GuideText.kt`(`rerouteDone` 인자 순서). `android/kit/mirrors/*.json`은 파일 추가가 없으면 불변.

**Interfaces:** Task 1의 TS 타입을 Swift `enum GuideEvent { case offRoute(notice:reason:guidance:side:returnRelDeg:firstSpoken:), backOnRoute(spoken:), rerouteNeeded(reason:) }`, Kotlin `data class OffRoute(...)`·`data class BackOnRoute(val spoken: Boolean)`·`data class RerouteNeeded(val reason: RerouteReason)`로. `guideEventSpeechClass(_ event:)`는 `offRouteEpisodeStart` 인자를 지우고 `firstSpoken`으로 분류(`rerouteNeeded`는 `.deferrable`). 함수 `rerouteHeadClock`·`projectSigned`·`pointAt` 같은 이름.

- [ ] Step 1: 웹 기준본 diff(`git diff` 리듀서·기하)를 줄 단위로 이식.
- [ ] Step 2: `swift test` / `./gradlew :kit:test :app:testDebugUnitTest --rerun-tasks`(gate-lock) 초록.

### Task 3: 문자열(6로케일)과 문장 조립

**Files:** `messages/*.json`(guide 키), `ios/i18n/ios-extra/*.json`(`autoReroute` 제거 — 웹도 쓰므로 messages로), 생성물 재생성(`node ios/scripts/messages-to-xcstrings.mjs --update-arg-order` 등), `ios/Gildongmu/Directions/GuideText.swift`, 웹 `src/lib/guide-text*.ts`(조립 함수 위치는 기존 관례), 테스트.

새·변경 키(ko 정본):
- `guide.offRouteRight` "경로에서 오른쪽으로 벗어났습니다" · `guide.offRouteLeft` "경로에서 왼쪽으로 벗어났습니다" · `guide.offRouteOpposite` "경로와 반대 방향입니다"
- `guide.offRouteReturnClock` "{direction}으로 돌아가세요" · `guide.offRouteTurnBack` "뒤로 도세요"
- `guide.carOffRouteClock` "경로는 {direction}입니다" · `guide.carOffRouteBehind` "경로는 뒤쪽입니다"
- `guide.rerouteDone` "현재 위치에서 경로를 다시 찾았습니다. {first}. 안내 {count}개, 총 {distance}."
- `guide.autoReroute` "새 경로로 다시 안내합니다. {first}. 안내 {count}개, 총 {distance}."
- `guide.rerouteHeadClock` "{direction}으로 도세요. 그 후 {first}" · `guide.rerouteHeadBack` "뒤로 도세요. 그 후 {first}" · `guide.rerouteHeadStraight` "진행 방향 그대로 {first}"
- 문장 결합: 쪽 문장 + ". " + 행동 문장(`guide.bundle`과 같은 관례). sideOnly·side null은 쪽 문장 단독 / 현행 `guide.offRoute`.

조립(iOS `GuideText.offRoute(event:kind:)`·`autoReroute(route:firstIndices:liveSteps:headClock:)`, 웹 미러): 시계 6 → 뒤쪽 낱말, 12 → 직진 머리말, 머리말이 있으면 첫 스텝은 `parts.body`(있을 때), 묶음이면 머리말은 첫 문장에.

- [ ] Step 1: 조립 함수 테스트(ko·en 문자열) 먼저.
- [ ] Step 2: 키·조립 구현, 생성물 재생성, `i18n-messages.test.ts`·키 린터 초록.

### Task 4: 웹 오케스트레이터

**Files:** `src/hooks/useRouteGuide.ts`, `src/components/DistanceBeacon.tsx`(이탈 상태 행이 리듀서 문장을 보이게), 신설 `src/lib/reroute-proposal-gate.ts`(+ 테스트, Kit 미러: `MAX_DRIFT_M` 수단별 30·150, `MAX_AGE_S` 120, `MAX_FETCHES_PER_SESSION` 5), `src/hooks/__tests__/useRouteGuide*.test.tsx`.

- `offRoute` 이벤트: 문장 조립 → `announce`(hold면 무발화). 회차 표지 `offRouteSpokenRef`(게시함)는 confirm에서 지우고 발화 때 세운다.
- `backOnRoute{spoken}`: `spoken ∧ offRouteSpokenRef`일 때만 "경로로 복귀했습니다".
- `rerouteNeeded`: 자동 조회 진행 중이면 무시, 예산 초과면 무시 → `fetchGuideRoute(true)` → 채택 시점 신선도(마지막 fix 15초 안 ∧ 취득점 대비 수단별 drift·120초) → `commitDetail` + `autoReroute` 문장(머리말 `rerouteHeadClock`). 버튼 재조회는 진행 중 자동 조회를 세대 증가로 폐기.

- [ ] Step 1: 훅 테스트(확정 → 문장, rerouteNeeded → 조회·채택 문장, 진행 중 무시, 복귀 무발화 조건) 먼저.
- [ ] Step 2: 구현, `npx vitest run src/hooks` 초록.

### Task 5: iOS 오케스트레이터 + 로그

**Files:** `ios/Gildongmu/Directions/BeaconModel.swift`(`consume` 이탈·복귀·rerouteNeeded, `maybeFetchProposal` 트리거 이동, 운전자 채널 즉시 조회 유지 + 실패 뒤 재시도, `RerouteProposalGate` 수단별 drift, 로그 줄), Kit `RerouteProposalGate.swift`·`:kit` 미러(`maxDriftMeters(kind)`), 소스 가드 테스트(웹 레인 `src/lib/__tests__/*guard*.test.ts` 관례).

- 로그(spec §6): `fix` 줄 `sperp=`·`ret=`·`appr=1`, 새 줄 `offRouteNotice`·`rerouteTrigger`·`rerouteAdopt`, `backOnRoute via= perp= hold= spoken=`.
- E57 착지(`docs/PATTERNS.md` "자동 채택 통지 뒤")가 트리거 이동 뒤에도 같은 자리(채택 통지)인지 확인.
- prewalk·나들이 귀환이 같은 경로로 도는지 기존 테스트로 확인.

- [ ] Step 1: 소스 가드(트리거가 `rerouteNeeded`에서만, `offRoute` 소비에 `maybeFetchProposal` 없음 — 운전자 채널 제외) 먼저.
- [ ] Step 2: 구현, Kit `swift test` 초록.

### Task 6: A55 (별도 커밋)

**Files:** `BeaconModel.changeDestination`, 호출부 `PlaceDetailView`·`BeaconTrackingSheet`, 도보 시작 문장 라벨 인자, Kit `TransitWalkLegText.destinationName` 재사용, `ios.guide.destChangedNoName`.

- [ ] Step 1: en 세션 판정 테스트(Kit 함수 재사용이면 기존 테스트 확장) → 구현 → 커밋.

### Task 7: 게이트·리뷰·문서·통합

- [ ] 웹 `test:run`·`tsc`·`lint`, Kit `swift test`, gradle `--rerun-tasks`, iOS 앱 타깃 빌드 1회(전부 gate-lock).
- [ ] 로그 재생: 2026-10-03 오후 두 구멍(14:02:41~57 무통지 → 결합 확정, 14:03:21 복귀 중 확정 → 사라짐)이 새 리듀서에서 설계대로인지(저장소 밖 스크립트).
- [ ] 리뷰: spec-compliance·code-quality(opus) → a11y·낭독 감사(opus).
- [ ] 문서 분배: BACKLOG E63·A55(·D11) 종결, §2 행, FIELD-TEST, CHANGELOG, PROGRESS, INTEGRATIONS 같은 제목 절.
- [ ] rebase·대조·생성물 재생성·게이트·ff push·완료 보고.
