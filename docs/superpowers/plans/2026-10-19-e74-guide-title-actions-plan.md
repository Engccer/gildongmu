# E74 제목 행 밀기 동작 계획 (2026-10-19)

spec `docs/superpowers/specs/2026-10-19-e74-guide-title-actions-design.md`. 구현 방식: inline 전부(과제가 같은 파일 묶음을 순서대로 고치고 앞 과제의 인터페이스를 뒤 과제가 쓴다 — 게이트 → 행 뷰 → 모델 진입점 → 시트 배선 → 가드). 미러 이식 없음(iOS 앱 타깃만, Kit 변경 없음).

1. `AppConfig.experimentalGuideTitleActionsEnabled` 추가.
2. 문자열 `ios.guide.differentRoute`·`ios.guide.titleWaypointChange` 6로케일(`ios/i18n/ios-extra`) → `node ios/scripts/messages-to-xcstrings.mjs all` + 안드로이드 생성물 재생성.
3. `GuideTitleActionsRow`(`GuideTitleMenu.swift`).
4. `BeaconModel`: `canRequestDifferentRoute`·`requestDifferentRoute()`·`differentRouteAdoptedSeq`, `fetchProposal`에 선언 갈래, `backOnRoute`의 선언 조회 보존.
5. 시트 배선: `BeaconTrackingSheet`(첫 행·헤더·경유지 행 `!플래그`·채택 세대 착지), `TransitTrackingSheet`(첫 행·헤더).
6. 가드 `guidance-gate-drift.test.ts` §8 + 변이 주입으로 검출력 확인.
7. 게이트: `test:run`·`tsc`·`lint`·Kit `swift test`·xcodebuild Release·Experimental.
8. 리뷰(opus, diff) · a11y 정적 감사(opus) · 안전 최종 검토 생략 판정(실험판 봉인 UI, 데이터 무결성 변경 없음).
9. 문서 분배: BACKLOG E74·§2 행, CHANGELOG, PROGRESS, PATTERNS 제목 행 절.
