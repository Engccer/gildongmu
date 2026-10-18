# E73 환승 도보 안내 구현 계획 (2026-10-19)

spec `docs/superpowers/specs/2026-10-19-e73-transfer-walk-design.md`. 세션 `e73-transfer-walk`, base `4a400d37`.

구현 방식 판정: **inline**. 태스크 1(Kit)이 태스크 2·3의 인터페이스(`startAfterPrewalk` 시그니처·`initTransitGuide(startingAt:)`)를 정하고, 2·3은 같은 두 파일(`TransitGuideModel.swift`·`GuideSessionCoordinator.swift`)을 함께 고친다(파일 겹침 + 선행 관계). 웹 기준본이 없는 Kit 단독 함수라 미러 이식 과제가 없다.

## 태스크

1. **Kit `TransitTransferWalk.swift` + 테스트** — `transitTransferWalkTarget`·`withoutWalkBefore`·`initTransitGuide(route:startingAt:now:)`. `TransitTransferWalkTests.swift`(spec §4 Kit 항목). 등록부 `android/kit/mirrors/guide.json`에 `pending`. 게이트: `swift test --filter TransitTransferWalk`.
2. **TransitGuideModel** — `startAfterPrewalk(guideRoute:startLeg:…:prewalkCompleted:)`, `beginSession(startLeg:)`(초기 상태·재개 통지), `sessionStartLeg` + 탔다 술어, `stopForTransferWalk()`, `completeOrAdvance` 미리 실행 갈래 + `transferWalk` 로그.
3. **GuideSessionCoordinator·BeaconModel** — `PrewalkContext`(안내용 경로·시작 구간·`transfer`), `beginTransit`이 안내용 경로를 한 번 만든다, `transitTransferWalk(_:)`(정지 → `prewalkTask` 600ms → `launchPrewalk`), `endPrewalk`가 시작 구간을 넘긴다, `markPrewalk(target:transfer:)`, 정지·권한 상실 꼬리 문장 분기.
4. **문자열** — `ios-extra` 6로케일 `ios.beacon.transferWalkCancelledWith`, 생성물 재생성(`Localizable.xcstrings`·`arg-order.json`), 렌더 확인.
5. **가드** — `guidance-gate-drift.test.ts` 갱신(`beginBeacon(` 호출 수·`launchPrewalk` 호출자·`markPrewalk` 개수), 새 `transfer-walk-guard.test.ts`, `prewalk-stop-join.test.ts` 영향 확인.
6. **게이트** — `test:run`·`tsc`·`lint`·Kit `swift test`·xcodebuild Release·Experimental(gate-lock, 전용 derivedData).
7. **리뷰** — 구현 리뷰(opus) · a11y 점검(opus, a11y-auditor 지시) · 안전 최종 검토(fable 1회).
8. **문서 분배** — BACKLOG E73 종결 + §2 행 + 웹 갭 · FIELD-TEST 행 · CHANGELOG · PROGRESS 한 줄 · INTEGRATIONS 승차 전 도보 절 · 통합.
