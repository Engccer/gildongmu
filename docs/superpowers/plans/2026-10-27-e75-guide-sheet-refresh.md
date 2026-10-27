# E75 안내 시트 새로고침·지금 여기는 어디?·E74 졸업 구현 플랜 (2026-10-27)

spec: `docs/superpowers/specs/2026-10-27-e75-guide-sheet-refresh-design.md`. 세션 `e75-sheet`, base `e260470e`.

구현 방식 판정: T1(문자열)은 Swift와 파일이 겹치지 않고 키 이름이 spec에 확정돼 있어 서브에이전트(sonnet)로 병렬. T2(Swift)는 시트·제목 행·조망 셸·모델이 한 인터페이스(새로고침 버튼 바인딩·조망 셸 인자)를 함께 정하므로 inline. T3(가드)는 T2 결과를 읽으므로 T2 뒤. T4(문서)는 마지막.

## T1. 문자열(서브에이전트, sonnet)

- `ios/i18n/ios-extra/{ko,en,es,fr,it,ja}.json`: `ios.guide.differentRoute` 값 교체, `ios.guide.whereNow` 추가, `ios.guide.waypointChange` 삭제(spec §1·§2.1·§4.1의 6로케일 문안).
- `android/i18n/android-extra/*.json`: `android.guide.waypointChange`를 지운 iOS 키의 종전 값으로 추가(안드로이드 `GuideSheet.kt`가 쓴다).
- 생성물 재생성: `node ios/scripts/messages-to-xcstrings.mjs --update-arg-order`, `node android/scripts/messages-to-android-strings.mjs --update-arg-order`.
- 검증: i18n 관련 테스트(`i18n-messages`·`xcstrings-arg-order`·`android-strings-drift`·`android-string-refs`).

## T2. Swift(inline)

1. `AppConfig.swift`: E74 플래그 블록 삭제.
2. `GuideTitleMenu.swift` → `GuideTitleActionsRow.swift` 개명, `GuideTitleMenu` 삭제, `GuideTitleActionsRow`에서 `onDifferentRoute` 제거 + 새로고침 슬롯(`@ViewBuilder refresh`, 기본 빈 뷰), `GuideRefreshButton` 추가.
3. `BeaconModel.swift`: `showsRerouteButton`·`requestReroute()`·`isRerouting`·`offRouteEndedByReroute`·`announceProgress()` 삭제, `requestDifferentRoute()` 예산 검사·계수 제거(spec §3).
4. `BeaconTrackingSheet.swift`: 제목 행 무조건 + 새로고침 버튼(`.refresh` 바인딩), 경유지 두 행·진행 상황·주변 확인·E69 행 삭제, 「지금 여기는 어디?」 버튼, 조망 창 `NavigationStack` + `showsHereSurroundings: true`, 착지 `.reroute` → `.refresh`(소실 복구 집합), `reroutePressed`·offRoute 착지 삭제.
5. `TransitTrackingSheet.swift`: 제목 행 무조건, 헤더 메뉴 갈래 삭제.
6. `GuideOverviewSheet.swift`: `showsHereSurroundings` 인자 + `GuideHereSurroundingsSection`(현재 위치 `force: true`, 상태 문장, 조회 중 행 소실 시 헤딩 착지), 상단 닫기 조건.
7. `SurroundingsSceneSection.swift`(소유 밖 신고): `SurroundingsSceneModel`에 좌표 소스 init 추가(종전 `init(anchor:)`는 위임).
- 검증: Kit `swift test`(Kit 무변경이면 생략 가능), 앱 타깃 Release·Experimental 빌드.

## T3. 가드(T2 뒤)

`guidance-gate-drift.test.ts` §9, `guide-sheet-landing-guard.test.ts`, `reroute-button-visibility-guard.test.ts` — spec §6.

## T4. 문서

BACKLOG E75·E74·§2 E74 행·머리 착수 순서 표, FIELD-TEST §4-3b, CHANGELOG, PROGRESS, PATTERNS 제목 행·착지 절.

## 리뷰

T1~T3 커밋 뒤 spec-compliance + code-quality(opus) + a11y 감사(opus, `a11y-auditor.md` 지시) — `git diff origin/main...HEAD`.
