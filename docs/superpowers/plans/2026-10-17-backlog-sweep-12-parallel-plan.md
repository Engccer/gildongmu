# 백로그 12차 소화: 병렬 세션 계획 (2026-10-17)

> **종료 상태(2026-10-17 12:10)**: 전 세션 통합 완료, 창·worktree·`feat/*` 0. `small-14` `4b9ec59f`(A66·A61·A63·D34) · `e70-impl` `76044e59`(E70 첫 판) · `e70-wording` `b523dcda`(E70 판정 18~27). 실기기 `b523dcda` 두 구성 설치. 미러링 실기기 확인: A61 통과, A66·A64 화면 쪽 통과, E72 ③ 일부 통과(§2 행에 기록). 남은 위원장 판정: E72 ①②(VoiceOver, 정식판 아카이브 문턱) · E70 FIELD-TEST §6-3 · N4 자동차. 새 결함 A67(정식판 승차 전 도보 다리 문장 창구).

코디네이터 `gildongmu-f4 [d7e740]`. 절차 정본은 `parallel-sessions` 스킬(Claude Code 분기). 이 문서가 세션 착수 프롬프트보다 상세하고 우선한다. 위원장 판정의 정본은 `docs/BACKLOG.md`의 각 항목이다. 위원장 지시(2026-10-17): "남은 백로그도 처리하고 실기기에 배포해 줘."

설계 리뷰 판정: 계획 문서라 적대적 설계 리뷰 대상이 아니다(E70은 spec이 이미 codex 2회·빌더 점검을 거쳤다).

## 0. 전제 (관측 시점: `b2fd179e`, 2026-10-17)

- **push 동결 없음.** 통합은 `origin/main`으로 ff push이고 push는 곧 웹 프로덕션 자동 배포다(Vercel).
- 디스크 여유 679GB, 스왑 0, 부팅된 시뮬레이터 0. 아이폰 13 Pro 연결됨(실기기 설치는 코디네이터 몫, §1 판정 4).
- 테스트 기준선은 `~/.claude/parallel-sessions/gildongmu/baseline-<base 12자리>.log`(`npm run test:run`). base는 이 문서를 담은 커밋이고 각 세션 보고 디렉터리의 `base.sha`가 그 값을 든다.
- 세 벌 미러(웹·Kit·`:kit`)와 공유 fixture는 고치는 세션이 같은 커밋에서 맞춘다. Kit에 파일을 추가·개명·삭제하면 `android/kit/mirrors/<그룹>.json`을 함께 고친다.
- iOS 프로젝트는 파일 시스템 동기 그룹이라 새 Swift 파일을 더해도 `project.pbxproj`를 고치지 않는다.

## 1. 마일스톤·판정·모델 배정

코드로 지금 닫을 수 있는 열린 항목 전부(BACKLOG §1 결함 중 미종결 셋 + 11차 소유 밖 후속 하나 + §5 E70 착수 가능). A1(동결)·A16(실승차 판정 대기)·§2 이하는 코드 대상이 아니다.

| 세션 | 항목 | 모델·노력 | 한 줄 |
|---|---|---|---|
| `e70-impl` | E70 첫 판 | `opus[1m]`·high | spec `2026-10-17-e70-mode-change-journey-design.md` §12 순서대로 서버 `/api/route/journey` → Kit → 앱 입력·결과 → 세션 이어짓기 → 가드·문서. iOS 실험판 전용 |
| `small-14` | A66 · A61 · A63 · 안드로이드 테스트 후속 | opus·medium | 남은 네 목록 복귀 재조회 생략(A64 규칙) · 언어 전환 시 길찾기 프리필 재조회(증상 확인 먼저) · 웹 채팅 출처 줄 한 객체 · `WalkGuideWaypointProgressTest.kt`의 늘 참 단언 |

서브에이전트 모델은 디스패치마다 명시한다: 리뷰어·감사 `model: opus`, 데이터 무결성·안전 최종 검토만 `model: fable`(동시 하나), 할 일이 정해진 구현·이식·탐색 `model: sonnet`. 적대적 설계 리뷰는 codex `adversarial-review`, 실패 신호면 `model: fable` 서브에이전트.

### 코디네이터 판정 (제품 판단이 아닌 설계 사항)

1. **E70은 한 세션이다.** 앱 단계 5~7이 같은 파일(`DirectionsTabView`·`GuideSessionCoordinator`·`BeaconModel`)을 순차로 고치므로 나누지 않는다(spec §12 판정 근거). 서버 1~3과 Kit 4의 서브에이전트 위임은 세션이 정한다.
2. **E70 실호출 상한**: ODsay는 세션 전체 10건(Flex 건당 약 27원, 11차 판정 8과 같은 규칙: `--out` 저장, 재분석은 저장본, `--from-corpus` 우선). 카카오·Tmap은 무료 한도 안에서 필요한 만큼, 건수를 보고에 적는다. 10건을 넘겨야 하면 멈추고 `judgment-*.md`.
3. **`CLAUDE.md`는 코디네이터만 고친다**(76.9KB/80KB, 여유 3KB). 세션은 상세를 `docs/PATTERNS.md`·`docs/INTEGRATIONS.md`의 같은 제목 절에 쓰고, `CLAUDE.md`에 들어갈 한두 줄은 완료 보고의 "공유 자산 반영 요청"에 문장 그대로 적는다. 여유가 작으니 새 줄보다 기존 줄 교체를 먼저 제안한다.
4. **실기기 배포는 코디네이터가 전 세션 통합 뒤 메인 체크아웃에서 한다**(공식판·실험판 두 구성). 세션은 `deploy-device.sh`를 돌리지 않는다. 세션의 iOS 검증은 Kit `swift test`와 앱 타깃 빌드(Release·Experimental 두 구성)까지다.
5. **A61은 증상 확인이 먼저다**(BACKLOG 처방이 "실측 전"). 시뮬레이터 또는 소스 추적으로 재현되지 않으면 고치지 않고 근거와 함께 보고한다.
6. **A63 판정은 Chrome 접근성 트리 실측**(jsdom 불가). `npm run dev`는 세션 worktree에서 포트를 겹치지 않게(3100번대) 띄우고 끝나면 내린다.
7. **App Store 제출·npm 발행·안드로이드 배포는 범위 밖.** What's New 문장은 보고에만.

## 2. 파일 소유권 지도

| 세션 | 소유 |
|---|---|
| `e70-impl` | spec §12 목록 전부: `src/lib/providers/odsay.ts`(후보 진입점 분리) · `src/lib/journey/*`(새) · `src/lib/providers/kakao-local.ts`의 출구·승강장 함수 · `src/app/api/route/journey/route.ts`(새) · `src/lib/rate-limit.ts` · `src/lib/types.ts`의 Journey 타입 · `scripts/verify-journey-exits.mjs`(새) · Kit `Models/RouteModels.swift`·`RouteService.swift`·`Journey.swift`(새)·`JourneyTests.swift`(새)·`RecentSearchStore.swift` · 앱 `AppConfig.swift`·`DirectionsTabView.swift`·`DirectionsEndpointSearchView.swift`·`GuideSessionCoordinator.swift`·`BeaconModel.swift`·`TransitGuideModel.swift`·`BeaconTrackingSheet.swift`·`TransitTrackingSheet.swift`·`JourneySheet.swift`(새) · `GildongmuApp.swift`의 **안내 세션 인계 클로저·시트 item 자리** · 문안 `ios/i18n/ios-extra/*`의 E70 키 · `guidance-gate-drift.test.ts` · `docs/INTEGRATIONS.md` 여정 절 · BACKLOG E70·FIELD-TEST·CHANGELOG·PROGRESS의 E70 자리 |
| `small-14` | iOS `Nearby/KidsNearbyView.swift`·`BarrierFreeNearbyView.swift`·`ClinicNearbyView.swift`·`EventsNearbyView.swift`(A66, 선례 세 화면은 읽기만) · `GildongmuApp.swift`의 **언어 `.id`·프리필 소거 자리**(A61) · 웹 `src/components/chat/SourceList.tsx`와 그 테스트(A63) · 안드로이드 `android/app/src/test/**/WalkGuideWaypointProgressTest.kt` · BACKLOG A66·A61·A63 항목 · CHANGELOG 자기 항목 |

**경계**

- `GildongmuApp.swift`는 두 세션이 서로 다른 자리를 고친다. 뒤에 통합하는 쪽이 rebase 충돌을 풀고 앱 빌드 두 구성을 다시 돌린다.
- `Localizable.xcstrings`·`messages/*.json`·`ios/i18n/ios-extra/*.json`은 자기 키만. 생성물(xcstrings·`arg-order.json`·안드로이드 strings·`android/kit/mirrors/*.json`)은 rebase 뒤 재생성하고 손으로 병합하지 않는다.
- `CHANGELOG.md`·`docs/BACKLOG.md`·`PROGRESS.md`는 자기 항목만, rebase 뒤 `comm` 대조.

**통합 순서**: 준비된 순서대로(대개 `small-14` 먼저).

## 3. git 격리 절차 (main 직접 push)

11차 계획 `2026-10-17-backlog-sweep-11-parallel-plan.md` §3과 같다(worktree `~/gildongmu-wt/<이름>`, 브랜치 `feat/<이름>`, pathspec 커밋, rebase → `comm` 대조 → 생성물 재생성 → 게이트 → `git push origin feat/<이름>:main`, `--force` 금지, 무거운 게이트는 `gate-lock.py`, xcodebuild `-derivedDataPath ~/gildongmu-wt/<이름>-dd`, 리뷰는 `git diff origin/main...HEAD`, 공개 저장소 규율).

## 4. 웨이브

1. **웨이브 1**: `e70-impl` · `small-14` 동시.
2. **통합 뒤** 코디네이터가 `CLAUDE.md` 반영, 메인 체크아웃에서 실기기 두 구성 설치.
3. **끝**: `doc-audit` 새 창.

## 5. 착수 프롬프트와 보고 경로

사본 `~/.claude/parallel-sessions/gildongmu/<이름>.prompt.txt`, 보고 `~/gildongmu-wt/<이름>-reports/`(단계별 새 파일 `start`·`integrating`·`done`·`blocked`·`judgment` + `-<YYYYmmddHHMM>.md`, 리뷰 `review-*`, `base.sha`). 보고는 파일과 `SendMessage` 둘 다. **위원장에게 직접 묻지 않는다**: 판정이 필요하면 `judgment-*.md`에 쉬운 한국어로 질문·선택지·각 선택지에서 위원장이 듣게 될 문장을 적어 통보하고, 기본값으로 진행할 수 있으면 진행한다. 코디네이터가 위원장에게 묻고 답을 전한다.

## 6. 정정 (코디네이터가 재현해 확인한 것)

- **09:25, 관측 `4b9ec59f`: `small-14` 종료.** A66·A61(소스 추적으로 증상 확인)·A63(Chrome 접근성 트리 실측)·안드로이드 늘 참 단언 교체. 변경 파일이 소유 목록 안임을 확인, 창·worktree 정리. CLAUDE.md 반영 요청 없음.
- **위원장 판정(E70 진행 중)**: 판정 18 「{역}역에서 내리는 경로」 채택. 실기기: 메인 `4b9ec59f`로 실험판·공식판 두 구성 설치(아이폰 잠금이라 자동 실행만 실패).
- **10:25, 관측 `76044e59`: `e70-impl` 종료(DONE_WITH_CONCERNS).** 통합 `76044e59`, 게이트 전부 통과, ODsay 3건(상한 10)·카카오 약 300·Tmap 약 77. 소유 밖 최소 수정 5파일(`RouteBriefing`·`GuideTitleMenu`·`GuideOverviewSheet`·`PlaceDetailView`·`briefing-station-entry-guard.test.ts`)은 여정 nil이면 불변이라 수용. 창·worktree 정리.
- **위원장 판정(E70 열린 판정 1~9, 같은 시각)**: 1 출구 이름 도착 문장 · 2 최근 경로에 역 이름 덧붙임 · 3 「갈아탈 역 지우기」 버튼 하나 · 4 완료 알림 현행 · 5 버스판 문장 둘 · 6 여정 하차 직후 버튼 이름을 「다음 구간」으로(통지 현행) · 7 숨김 현행 · 8 동명 이역일 때만 노선 병기 · 9 다리 문장 싣기. 반영은 새 세션 `e70-wording`(opus·high, base `76044e59`).
- **`CLAUDE.md` 반영(코디네이터)**: `e70-impl` 요청 중 ODsay 줄 교체·통합 카탈로그 여정 행. 「화면 배치를 바꾸면 … 첫 성공 수단 heading으로 1회 이동」 정정 권고는 **기각**: 웹 `DirectionsView.tsx`(첫 성공 heading 1회 포커스)와 iOS `DirectionsTabView.swift` 주석이 현행이라 문장이 참이다. 77.3KB/80KB.
- **12:00, 관측 `b523dcda`: `e70-wording` 종료.** 판정 18~27 반영(재판정 ①최근 경로 여정만 짧게 ②버스로 끝나면 「내린 정류장에서」), 확인 리뷰 MAJOR 0, 게이트 전부 초록. 범위 밖 관찰 ①은 BACKLOG A67로 등재, ②(실패 통지가 도착 문장을 대체할 수 있음)는 FIELD-TEST §6-3 행. CLAUDE.md 선택 1줄은 반영하지 않는다(spec §8.4·소스 가드가 정본, 여유 2.7KB 보존). 창·worktree 정리.
- **미러링 실기기 확인(코디네이터, 위원장 지시 "실기기 판정은 아이폰 미러링으로")**: VoiceOver 낭독은 미러링으로 관측 불가(스킬 `iphone-mirroring-control` voiceover-narration). 화면 쪽만 판정해 BACKLOG A61·§2 E65·E72 행에 기록. 밀기는 CGEvent 가로 스크롤(`wheel2`)로 재현된다: 도로명 행은 끝까지 밀기가 발동해 주소 복사가 실행된다.
