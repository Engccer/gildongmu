# 승차 전 도보 핸드오프(A25) 구현 계획

> **For agentic workers:** 이 계획은 inline으로 실행한다(아래 판정). 단계는 체크박스로 추적한다.

**Goal:** 대중교통 안내 시작 시 첫 탑승 leg 앞 도보를 도보 실시간 안내로 먼저 돌리고, 도착하면 대기 국면으로 자동 연결한다.

**Architecture:** 판정은 Kit·웹 순수 함수 `transitPrewalkTarget`/`withoutPrewalk`(공유 fixture). iOS는 `GuideSession`이 prewalk 컨텍스트(id·Task)를 소유하고 `BeaconModel.onSessionEnd(reason)`(stop() 정리 뒤 다음 턴 전달 + begin 말미 startFailed)로 연결한다. 웹은 `TransitGuidePanel`이 `DistanceBeacon(onSessionEnd)`을 마운트하고 `useTransitGuide.startAfterPrewalk`로 잇는다.

**Tech Stack:** Swift(SwiftUI·Kit SPM, Swift Testing) · TypeScript(React 19, Vitest, jsdom) · i18n 6로케일 + `scripts/messages-to-xcstrings.mjs`.

**Spec:** `docs/superpowers/specs/2026-08-30-transit-prewalk-handoff-design.md`

**구현 방식 판정:** inline. 근거 — Task 2~4가 같은 파일(`BeaconModel`·`GuideSession`)을 순차로 만지고, Task 1의 인터페이스(`PrewalkTarget` 모양)가 뒤 전부를 정하며, 실기기 배포까지 한 세션이 맡는다(수정 파일 겹침 있음·선행 관계 있음). 리뷰는 별도 서브에이전트(spec-compliance·code-quality).

## Global Constraints

- 안전 인자에 기본값 금지(`prewalkCompleted`, `onSessionEnd` reason).
- `transit.start`·`useTransitGuide.start` 시그니처 불변(종전 경로 관찰 동작 동일).
- 통지는 각 모델의 기존 창구만(`announce`/live region). i18n 6로케일 동조 + xcstrings 재생성.
- `git add -A` 금지. 커밋은 `git commit -- <경로>`.

---

### Task 1: 순수 판정 함수 + 공유 fixture (웹·Kit)

**Files:** Modify `src/lib/transit-guide.ts`, `ios/GildongmuKit/Sources/GildongmuKit/TransitGuide.swift`, `src/lib/__tests__/fixtures/transit-guide-scenarios.json`(`prewalk` 키), `src/lib/__tests__/transit-guide.test.ts`, `ios/GildongmuKit/Tests/GildongmuKitTests/TransitGuideTests.swift`.

**Produces:**
- 웹 `export interface TransitPrewalkTarget { name: string; lat: number; lng: number; minutes: number }`, `transitPrewalkTarget(route): TransitPrewalkTarget | null`, `withoutPrewalk(route): TransitGuideRoute`.
- Kit `public struct TransitPrewalkTarget: Equatable { name, lat, lng, minutes }`, `public func transitPrewalkTarget(_:) -> TransitPrewalkTarget?`, `public func withoutPrewalk(_:) -> TransitGuideRoute`.

- [ ] fixture에 `"prewalk": { "subwaySingle": {name:"천호", lat, lng, minutes:3}, "seoulBusSingle": null, ... 전 route }` 추가(값은 routes에서 읽는다).
- [ ] 웹 테스트: fixture 전 route 대조 + 경계(0분·null·boardStop 없음·(0,0)·NaN·두 번째 leg만 도보) + `withoutPrewalk` 원본 불변·leg1 불변.
- [ ] 구현 → 통과 → Kit 미러 + `TransitGuideTests`에 fixture 대조 → `swift test` 통과 → 커밋.

### Task 2: BeaconModel — prewalk 모드·종료 신호

**Files:** Modify `ios/Gildongmu/Directions/BeaconModel.swift`, `BeaconTrackingSheet.swift`(버튼 1개, 추가 전용), `messages/*.json`(`transitGuide.prewalkArrived`·`prewalkArrivedButton`).

**Produces:** `enum BeaconEndReason { arrived, userStopped, startFailed, ended }`, `var prewalkTarget: String?`, `var onSessionEnd: ((BeaconEndReason) -> Void)?`, `func declarePrewalkArrival()`.

- [ ] `pendingEndReason`(begin에서 `.ended` 초기화). 확정 도착·추정·선언은 stop() 직전 `.arrived`, `stopByUser`는 `.userStopped`.
- [ ] `stop()` 말미: `let cb = onSessionEnd; onSessionEnd = nil; let r = pendingEndReason; pendingEndReason = .ended; prewalkTarget = nil; if let cb { Task { @MainActor in cb(r) } }`.
- [ ] `begin()` Task 말미: `starting = false; if !isTracking, let cb = onSessionEnd { onSessionEnd = nil; cb(.startFailed) }`.
- [ ] 세 종료 화면 경로에 `let prewalk = prewalkTarget != nil` 캡처 → 종료 화면·건강 요약 건너뜀, 도착 문장은 `transitGuide.prewalkArrived`(station) 사용. `maybeEndIdleSession`에 `prewalkTarget == nil` 가드.
- [ ] `declarePrewalkArrival()`: guard isTracking, prewalk → `.arrived` → `playTone(.nearby)` → stop() → announce(prewalkArrived, .high).
- [ ] 시트: `prewalkTarget != nil`이면 종료 버튼 위 `Button(prewalkArrivedButton(station)) { model.declarePrewalkArrival() }`.
- [ ] 빌드(`xcodebuild` 시뮬) 통과 → 커밋.

### Task 3: TransitGuideModel.startAfterPrewalk + GuideSession 연결

**Files:** Modify `TransitGuideModel.swift`, `GuideSessionCoordinator.swift`, `messages/*.json`(`prewalkStart`·`prewalkUnavailable`·`prewalkCancelled`), `src/lib/__tests__/guidance-gate-drift.test.ts`(7→8, startBeacon 2→3, startTransit 본문 포함), `docs/superpowers/specs/2026-08-15-walk-guidance-ship-design.md` §3.2 표에 8번째 행.

- [ ] `TransitGuideModel.start`를 `startSession(guideRoute:label:dest:accessible:)` 공통부로 쪼개되 `start` 시그니처·동작 불변. `startAfterPrewalk(transitRoute:destinationLabel:dest:accessible:prewalkCompleted:)` = 거부 게이트 → build → `prewalkCompleted ? withoutPrewalk : 그대로` → 공통부. `announceExternal(_:)` 공개(창구 재사용).
- [ ] `GuideSession`: `PrewalkContext`, `prewalkTask`, `cancelPrewalk()`, `startTransit` 분기, `endPrewalk(id, reason)`(spec §4.4 그대로). `startBeacon`·`startTransit` 진입에서 `cancelPrewalk()`(단, startTransit 자신의 prewalk 경로가 startBeacon을 부르므로 startBeacon의 취소는 prewalk 설정 **앞**에 두거나 내부 경로는 `beacon.requestStart` 직접 — 게이트 테스트가 `self.startBeacon(`을 세므로 startBeacon을 부르고 그 안의 cancelPrewalk는 "다른 컨텍스트만" 취소하도록 id 비교).
- [ ] 게이트 테스트 갱신 → `npm run test:run -- guidance-gate-drift` 통과 → 빌드 → 커밋.

### Task 4: 웹 미러

**Files:** Modify `src/hooks/useRouteGuide.ts`·`src/components/DistanceBeacon.tsx`(`onSessionEnd` 추가 전용), `src/hooks/useTransitGuide.ts`(`startAfterPrewalk`·`prewalkTarget`), `src/components/TransitGuidePanel.tsx`, `src/components/__tests__/TransitGuidePanel.test.tsx`.

- [ ] `useRouteGuide`: 옵션 `onSessionEnd?`, 세션 종료 함수에서 `arrivedRef` 기준 reason 1회 전달(도착은 announce 뒤). `DistanceBeacon` prop 통과.
- [ ] 훅: `prewalkTarget = useMemo(transitPrewalkTarget(guideRoute))`, `startAfterPrewalk(prewalkCompleted)`(시작 문장 앞 `prewalkArrived` 결합), `start` 불변.
- [ ] 패널: `prewalk` 상태(ref 스냅숏), 시작 버튼 분기, `DistanceBeacon` 마운트 + 선언 버튼 + `declaredRef`, `onSessionEnd` 처리(arrived/ended), `onActiveChange(true)`.
- [ ] 테스트 5건(spec §7) → 통과 → 커밋.

### Task 5: i18n·xcstrings·게이트 전수

- [ ] 6로케일 키 6개 동조, `node scripts/messages-to-xcstrings.mjs`, `i18n-messages.test.ts`·`check-xcstrings-keys.mjs` 통과.
- [ ] `npm run test:run` 전체, Kit `swift test`, 앱 빌드.
- [ ] 리뷰: spec-compliance + code-quality 서브에이전트(요구사항·diff만 전달).

### Task 6: 통합·배포·문서

- [ ] rebase origin/main → 생성물 재생성 → 테스트 → `git push origin feat/a25-prewalk:main`(ff).
- [ ] `CONFIGURATION=Experimental ./ios/deploy-device.sh`(기기 연결 시).
- [ ] CHANGELOG 항목, BACKLOG A25 상태(실승차 판정 대기), FIELD-TEST 대본 행, CLAUDE.md 함정 1줄(prewalk 종료 화면 캡처·안전망 비적용), spec 2026-08-04 §4.1에 개정 표기.
- [ ] 코디네이터 SendMessage 보고, worktree 제거.
