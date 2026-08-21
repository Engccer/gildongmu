# N3 대중교통 boarding 국면 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans(inline). 판정 근거: Kit·웹 상태 머신 → fixture → 앱·웹 소비자가 순차 의존(같은 enum·이벤트를 전 태스크가 공유)하고 `TransitGuide.swift`·`transit-guide.ts`를 여러 태스크가 건드린다 → inline. 리뷰는 태스크 묶음마다 별도 서브에이전트(spec-compliance + code-quality), 마지막에 cross-cutting.

**Goal:** "탑승" 버튼을 차량 선택으로 바꾸고, 선택 차량의 승차 정류소 도착을 앱이 관측해 `riding`으로 올린다. 상태 문구 전수 개정 + A19 포커스 착지.

**Architecture:** Kit `TransitGuide.swift` ↔ 웹 `src/lib/transit-guide.ts` 1:1 미러 상태 머신에 `boarding` 국면·입력 2(`confirmBoarded`·`restoreBoarding`)·이벤트 3(`vehicleSelected`·`approaching`·`vehiclePassed`)을 더하고, 공유 fixture로 동조를 강제한다. 소비자(iOS `TransitGuideModel`·`TransitTrackingSheet`, 웹 `useTransitGuide`·`TransitGuidePanel`)는 폴링 갈래·문구·포커스만 바꾼다.

**Spec:** `docs/superpowers/specs/2026-08-22-transit-boarding-phase-design.md`

## Global Constraints
- §2 소유 파일 밖 수정 금지(`TransitTrackingSheet.swift`는 문구·포커스만).
- `messages/*.json`은 `transitGuide` 네임스페이스만, 6개 로케일 동시. xcstrings는 `node ios/scripts/messages-to-xcstrings.mjs` 재생성.
- 커밋은 `git commit -- <경로>` pathspec. 실기기 배포 전 다른 세션에 알림.
- 웹·Kit 상수·판정은 byte 동등(fixture 양쪽 green이 게이트).

---

### Task 1: 상태 머신 — 웹 `transit-guide.ts` + fixture 변환
**Files:** Modify `src/lib/transit-guide.ts`, `src/lib/__tests__/fixtures/transit-guide-scenarios.json`(스크립트 변환), `src/lib/__tests__/transit-guide.test.ts`(kind 매핑·신규 시나리오 8).
**Produces:** `TransitPhase` += `"boarding"`; `TransitInput` += `{kind:"confirmBoarded"}`·`{kind:"restoreBoarding"}`; `TransitGuideEvent` += `{kind:"vehicleSelected",legIndex}`·`{kind:"approaching",remaining:number|null,message}`·`{kind:"vehiclePassed"}`; `boarded` += `cause:"observed"|"declared"`; state += `previousPhase: TransitPhase|null`; `BOARD_STOP_FRESH_SECONDS = 120`.
- [ ] fixture 변환 스크립트(scratchpad, python): 비근사 lock `board` 스텝의 expect `phase:"riding"`→`"boarding"`, `event.kind:"boarded"`→`"vehicleSelected"`; 바로 뒤에 `{at: 동일, input:{kind:"confirmBoarded"}, expect:{phase:"riding", event:{kind:"boarded",cause:"declared"}}}` 삽입; 그 이후 같은 leg 국면의 poll `phaseGen` +1(다음 board/changeBoarding/advance/restore까지). "탑승 변경 취소"용 `board`(직전 스텝이 changeBoarding 계열이고 lock이 previousLock과 같음)는 `restoreBoarding`으로 치환·삽입 없음. 변환 전후 시나리오 수 24 assert.
- [ ] 신규 시나리오 8(spec §3.4)을 JSON에 추가. 테스트 실행 → 실패 확인.
- [ ] `transit-guide.ts` 구현: `handleBoard`(근사→riding 종전, 식별자→boarding: `enterBoarding`), `handleConfirmBoarded`, `handleRestoreBoarding`, `handleChangeBoarding`에 boarding 허용 + `previousPhase` 기록, `enterRiding(next, now)` 공용 초기화(failCount/failSince 포함), `handlePoll`의 `phase==="boarding"` 갈래(`commitBoardingMatched`·미매칭 규칙), `pollIntervalMs` boarding=20_000, `eventProfile` 3종, `canAdvance` 불변.
- [ ] `npx vitest run src/lib/__tests__/transit-guide.test.ts` green. 커밋.

### Task 2: 상태 머신 — Kit `TransitGuide.swift` 미러 + `TransitGuideTests`
**Files:** Modify `ios/GildongmuKit/Sources/GildongmuKit/TransitGuide.swift`, `ios/GildongmuKit/Tests/GildongmuKitTests/TransitGuideTests.swift`(`toInput`·`kindName`·`cause` 대조).
**Produces:** `TransitPhase.boarding`, `TransitGuideInput.confirmBoarded/.restoreBoarding`, `TransitGuideEvent.vehicleSelected(legIndex:)/.approaching(remaining:message:)/.vehiclePassed`, `.boarded(legIndex:cause:)` + `TransitBoardedCause { observed, declared }`, `state.previousPhase`, `transitBoardStopFreshSeconds = 120`.
- [ ] 테스트 러너 확장 → `swift test --filter TransitGuideTests`(Kit 디렉터리) 실패 확인 → 구현 → green. 커밋.

### Task 3: 문구 6로케일 + xcstrings
**Files:** `messages/{ko,en,es,fr,it,ja}.json` `transitGuide`; `ios/**/Localizable.xcstrings` 재생성.
- [ ] 키 신설 13·개정 2·삭제 2(spec §6). `npx vitest run src/__tests__/i18n-messages.test.ts`(경로는 `ls src/**/i18n-messages.test.ts`로 확인) + `node ios/scripts/messages-to-xcstrings.mjs && node ios/scripts/check-xcstrings-keys.mjs`. 커밋.

### Task 4: iOS `TransitGuideModel` + `TransitTrackingSheet`
**Files:** Modify `ios/Gildongmu/Directions/TransitGuideModel.swift`, `ios/Gildongmu/Directions/TransitTrackingSheet.swift`.
- [ ] 모델: `selectedDescription`, `confirmBoarded()`, `cancelChangeBoarding()`→`.restoreBoarding`, `fetchPoll/tagoCacheKey/resolveTagoIfNeeded` boarding 갈래, `pollOnce` 스냅숏은 waiting만, `boardOverrideName` 소거=riding 진입·advance(`result.state.phase == .riding && state.phase != .riding`), `statusLineText`·`signalStatusText`·`announcementText` 국면 분기(spec §4.1), 계측 로그 기존 형식 유지.
- [ ] 시트: `enum SheetControl { stop, advance, changeBoarding, confirmBoarded, walkHandoff, waitingLabel, reboardPrompt }` 단일 옵셔널 `@AccessibilityFocusState`; `landControlFocus(_:proxy:)` 헬퍼(취소·경합 해제·scrollTo·400·검증·재scrollTo·300·재대입·로그); boarding 컨트롤 2; 후보 라벨 키 `selectTrain/selectBus`; `boardApprox`; 전이 착지(waiting→boarding=confirmBoarded, →riding 종전). `landReboardPromptFocus`·`landChangeBoardingFocus`·`recoverWaitingLabelFocus`·handoff/arrived 착지를 헬퍼로 통일.
- [ ] `xcodebuild -scheme Gildongmu -configuration Debug -destination 'generic/platform=iOS Simulator' build` 통과. 커밋.

### Task 5: 웹 `useTransitGuide.ts` + `TransitGuidePanel.tsx`
- [ ] 훅: `fetchPoll` 갈래(`phase === "waiting" || "boarding"`), `boardOverride` 소거 시점, `confirmBoarded`·`restoreBoarding` 액션, 문구 조립(국면 분기), 통지 텍스트.
- [ ] 패널: boarding 섹션(상태 문장 + [탑승했습니다]·[다른 차량 선택]), 후보 버튼 라벨, 전이 포커스(waiting→boarding = 탑승했습니다 버튼 ref). `npm run test:run`·`npm run lint`·`npx tsc --noEmit`. 커밋.

### Task 6: 리뷰·문서·통합
- [ ] 서브에이전트 리뷰: spec-compliance(spec + `git diff main..HEAD`) + code-quality. 지적은 계층 대조 후 처리.
- [ ] 문서 분배: `CHANGELOG.md`(2026-08-22 N3 소제목), `docs/BACKLOG.md` N3·A19 종결, `PROGRESS.md` 상태 한 줄, `docs/FIELD-TEST.md` 실승차 행 3, `CLAUDE.md` 통합 카탈로그 대중교통 행에 "탑승=선택, 도착 관측=riding" 한 줄, `docs/INTEGRATIONS.md` §대중교통 상태 머신 표 갱신(있으면).
- [ ] §3 통합: `git fetch && git rebase origin/main` → xcstrings 재생성 → `npm run test:run` → `git push origin feat/n3-transit-boarding:main` → worktree 제거 → 실기기 배포(다른 세션 알림 후, Experimental+Debug 두 구성) → 위원장에게 "N1 착수 가능" 보고.
