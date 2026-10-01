# 백로그 8차 소화: 병렬 세션 계획 (2026-10-02)

코디네이터 `gildongmu-a7 [4465c2]`. 절차 정본은 `parallel-sessions` 스킬(Claude Code 분기). 이 문서가 세션 착수 프롬프트보다 상세하고 우선한다. 위원장 판정의 정본은 `docs/BACKLOG.md`의 각 항목이다.

## 0. 전제 (관측 시점: `57e9a5ea`, 2026-10-02)

- **push 동결 없음.** 통합은 `origin/main`으로 ff push이고 push는 곧 웹 프로덕션 자동 배포다(Vercel, 스킵 규칙 없음).
- **iOS 1.19가 스토어에 있고(`5c3bf9bf`, 빌드 28) 2.0이 심사 대기 중이다(`ef5f2330`, 빌드 30, 2026-10-01 재제출).** 서버 응답 모양을 바꾸는 push는 이 두 빌드와 안드로이드 배포본을 깨뜨리면 안 된다. 심사자는 2.0을 프로덕션 서버에 붙여 본다. 이번 회차의 iOS 변경은 2.0 다음 릴리스 대상이다.
- **디스크 여유 약 8.7GB**, 스왑 0, 시뮬레이터 1대 부팅 중. 웨이브당 빌드 세션은 3개까지. 세션은 DerivedData·산출물을 자기 폴더에만 쓰고, 여유가 3GB 밑으로 내려가면 빌드를 멈추고 보고한다.
- 테스트 기준선은 `~/.claude/parallel-sessions/gildongmu/baseline-<base 12자리>.log`(`npm run test:run`). 웨이브 1 base는 이 문서를 담은 커밋이고 각 세션 보고 디렉터리의 `base.sha`가 그 값을 든다.

## 1. 마일스톤·판정·모델 배정

| 세션 | 웨이브 | 항목 | 모델·노력 | 한 줄 |
|---|---|---|---|---|
| `e59-settings` | 1 | E59 | opus·high | 설정 화면 헤딩을 주제 묶음 다섯으로, 설정 하나는 한 줄(iOS·안드로이드) |
| `small-9` | 1 | E60 · A54 · A53 ① iOS 갈래 · A50 후속 · D29 | opus·medium | 소형 결함 묶음(iOS·웹) |
| `en-briefing` | 1 | A53 ①②③ 웹·WebMCP | opus·high | en 브리핑 언어 혼합 잔여 셋 |
| `outing-shops` | 1 | E58 ②⑤⑥ | opus·high | 나들이 상점 그물 18종·촘촘히 + 도로명 지번 폴백 + 로그 스키마 |
| `outing-research` | 1 | E58 조사 | opus·high | 보행 도로망 노드 원천 조사(코드 변경 0) |
| `outing-nodes` | 2 | E58 ①③ | opus·high | 교차로 전수·횡단보도 원천 교체(조사 뒤 코디네이터가 원천 확정) |
| `android-2` | 2 | E43 M4b 후속 둘 · E57 이식 · E53 이식 | opus·high | 안드로이드 후속·이식 묶음 |
| `doc-audit` | 끝 | 문서 만료 점검 | opus·medium | 전 웨이브 통합 뒤 새 창 |

서브에이전트 모델은 디스패치마다 명시한다: 리뷰어·감사는 `model: opus`, 적대적 설계 리뷰와 데이터 무결성 최종 검토만 `model: fable`(동시 하나, `name` 부여).

### 위원장 판정 (2026-10-02, 코디네이터 세션)

1. **안드로이드 두 묶음 모두 이번 회차에 넣는다**: ①M4b 후속 둘(장소 상세 "여기로 목적지 변경"·"여기를 경유지로" 버튼, 안내 시트가 열린 동안 밑 탭 상태 줄이 앱 통지를 집는 문제) ②iOS 7차 소화 이식 둘(E57 안내 시트 첫 정보 행 착지, E53 백그라운드 음성 안내). E59의 안드로이드 몫은 `e59-settings`가 한다.

### 코디네이터 판정 (제품 판단이 아닌 설계 사항)

1. **`CLAUDE.md`는 코디네이터만 고친다**(7차 판정 유지). 예산 여유가 작다(약 75KB/80KB). 세션은 새 함정의 상세를 `docs/PATTERNS.md`·`docs/INTEGRATIONS.md`의 같은 제목 절에 쓰고, `CLAUDE.md`에 들어갈 규칙 한두 줄과 고쳐야 할 기존 문장은 완료 보고의 "공유 자산 반영 요청"에 문장 그대로 적는다. 코디네이터가 웨이브 끝에 모아 반영하고 `AGENTS.md`를 재생성한다.
2. **실기기 배포는 코디네이터가 웨이브 경계에서 메인 체크아웃으로 한다**(공식판·실험판 두 구성). 세션은 `deploy-device.sh`를 돌리지 않는다. 세션의 iOS 검증은 Kit `swift test`와 앱 타깃 빌드까지다.
3. **App Store 제출·npm 발행·안드로이드 배포는 범위 밖.** 세션은 What's New에 적을 문장만 보고에 남긴다(E60·E59는 정식판 사용자가 듣는 순서·구조가 바뀐다).
4. **E58의 원천 선택은 `outing-research` 보고를 코디네이터가 읽고 정한다.** 약관(국외 반출·캐싱·표시 조항)이나 비용이 걸리면 그때 위원장에게 묻는다. 조사 세션은 repo 코드를 고치지 않고 `docs/research/` 문서와 보고 디렉터리의 탐침 스크립트만 남긴다. `outing-nodes`는 그 판정이 난 뒤 착수 프롬프트를 새로 받는다.
5. **A54의 결합용 키는 마침표만 떼는 기계적 변경이면 문안 확인 없이 진행한다**(E41 규칙의 적용). 문장을 새로 쓰게 되면 `judgment-*.md` 경로. `CLError.denied` 매핑은 기존 권한 거부 문장이 있으면 그것을 쓴다.
6. **A53 ①의 iOS 갈래(`TransitGuideModel.destinationLabel`에 로마자 운반)는 `small-9`가 맡는다.** `en-briefing`은 웹·WebMCP만. 두 세션이 같은 iOS 파일을 만지지 않게 하기 위한 분할이고, 영문 자격 판정 술어는 양쪽 다 기존 것(`transitLegUsesEnglish`·웹 `legEn`·`transitWalkDestinationName`)을 쓴다.
7. **E45 웹 브리핑 대응은 보류한다**: 웹에는 단락을 분절하지 않는 로터 등가물이 없다(B8과 같은 근거, 위원장 보류 판정 2026-08-17). 안드로이드 한소네 판정과 함께 다시 본다.
8. **범위에서 뺀 것**: E47(ODsay 실호출은 비용) · N4 자동차 경유지(실주행 판정 선행) · E51 후속 ④⑤(실보행 판정 행) · E48 후보 ②③(실승차 뒤) · B13(실보행 뒤) · 웹 전용 대기 묶음(E33 웹·B6·B8·W1-R·B9 안내 중 전환) · E14 ③·E15 ③(설계 선행) · PORTS open 행(어휘·모델을 바꿀 때 함께).
9. **E51 후속 ③(학교·공원 이정표)은 E58 ②에 흡수된다**: 18종 전부에는 학교(`SC4`)가 들어 있고, 공원은 카카오 분류에 없어 관광명소(`AT4`)로 일부만 잡힌다. `outing-shops`가 그 사실을 로그 재생으로 확인해 적는다.

## 2. 파일 소유권 지도

술어는 "이름이 나오는가"가 아니라 "그 세션이 그 파일을 고쳐야 하는가"다. 아래는 코디네이터가 호출부를 열어 확인한 목록이고(관측 `57e9a5ea`), 세션이 틀린 자리를 발견하면 보고한다(코디네이터가 재현해 정정 절을 단다).

### 웨이브 1

| 세션 | 소유 |
|---|---|
| `e59-settings` | `ios/Gildongmu/SettingsView.swift` 전체 · 설정 화면 문자열 키(`messages/*.json`의 `ios.settings.*` 헤딩·행 키) · 안드로이드 `settings/**`(`SettingsScreen.kt`·`SettingsRows.kt`·`ChoiceDialog.kt`·테스트 `SettingsScreenA11yTest.kt`·`SettingsRowsTest.kt`) · 생성물(xcstrings·`arg-order.json`·안드로이드 strings)은 재생성 |
| `small-9` | `ios/Gildongmu/SearchView.swift`의 `.accessibilityActions` 빌더와 그 위 주석(E60) · `ios/Gildongmu/Directions/GuideSessionCoordinator.swift`의 `.userStopped`·`.startFailed` 결합·창구 자리(A54) · `BeaconModel.swift`의 `handle(locationError:)` 매핑 한 자리(A54) · `BeaconTrackingSheet.swift`의 `landFocus` 재시도 조건 한 자리(A54 ②, 실기기에서 거슬린다는 판정은 아직 없으므로 **조건을 "커서가 아직 출발 자리일 때만"으로 좁히는 것이 해가 없을 때만**) · `ios/Gildongmu/Directions/TransitGuideModel.swift`의 `destinationLabel`과 `DirectionsTabView.swift`의 `session.startTransit(` 호출 자리(A53 ① iOS) · `src/hooks/useTransitGuide.ts`와 그 테스트(A50 후속 `AbortController`) · `package.json`·`package-lock.json`의 `jiti` 직접 선언(D29) · 결합용 키를 더하면 `messages/*.json` 그 키만 |
| `en-briefing` | `src/lib/directions-state.ts`(끝점 `labelRoman`) · `src/components/DirectionsView.tsx`의 후보 확정·끝점 자리와 중간 도보 줄 자리 · `src/components/TransitRouteBriefing.tsx` · `src/lib/transit-walk-leg.ts`와 테스트 · `src/lib/webmcp/tools/plan-directions.ts`의 탑승 줄 투영과 `src/lib/place-lines/*`·`route-step-items.ts` 중 그 줄을 만드는 함수 · 공유 fixture(도보 줄 목적지 이름)에 케이스 추가 |
| `outing-shops` | `ios/Gildongmu/Directions/OutingModel.swift`(조회 파라미터·`outingFix` 로그 줄·도로명 재조회 자리) · `OutingOverviewAdapter.swift` · Kit `OutingRequery.swift`·`OutingPassBy.swift`의 `outingRoadNameStep`·`OutingLandmark.swift`와 각 테스트 · `src/app/api/places/around/route.ts`와 `src/lib/providers/surroundings.ts`의 **옵트인 파라미터**(기본 응답 불변) · spec `2026-09-26-outing-mode-design.md` §11·§15 · `docs/superpowers/specs/logs/README.md` 로그 색인 행 |
| `outing-research` | `docs/research/RESEARCH-2026-10-02-outing-walk-network.md`(신설) · 탐침 스크립트는 `~/gildongmu-wt/outing-research-reports/scripts/`(repo 밖) · repo 코드 수정 0 |

**웨이브 1 경계**
- `OutingSheet.swift`·`OutingDistanceTone.swift`·`OutingProjection.swift`·`OutingOrigin.swift`는 웨이브 1에서 아무도 고치지 않는다(`outing-nodes`가 지날 수 있다). `outing-shops`가 그 파일의 낡은 주석을 발견하면 보고에 함수 이름을 적는다.
- `TransitGuideModel.swift`는 `small-9`만(`destinationLabel` 자리). `GuideSessionCoordinator.swift`도 `small-9`만.
- `DirectionsView.tsx`·`DirectionsTabView.swift`의 도보 줄 영역(E52 `walk-lines` 산출)은 건드리지 않는다. `en-briefing`은 대중교통 브리핑과 끝점 자리만, `small-9`는 `startTransit(` 호출 인자만.
- `messages/*.json`은 자기 키만. `e59-settings`는 `ios.settings.*`, `small-9`는 A54 결합용 키, 나머지는 더하지 않는다.
- 안드로이드는 웨이브 1에서 `e59-settings`만 만진다(`settings/**`). `android-2`가 더할 설정 행(백그라운드 음성 토글)은 웨이브 2에서 `e59-settings` 통합본 위에 얹는다.

### 웨이브 2 (`e59-settings` 통합 뒤 `android-2`, `outing-research`·`outing-shops` 통합 + 코디네이터 원천 판정 뒤 `outing-nodes`)

| 세션 | 소유 |
|---|---|
| `outing-nodes` | 새 원천 seed·빌드 스크립트(`scripts/build-*.mjs`) · `src/lib/providers/osm-walk-nodes.ts`·`walk-infra.ts`·`/api/walk/nearby` 옵트인 · `NOTICE.md` 표 · Kit `OutingPassBy.swift`(`outingCrosswalkNoticeStep` 원천 주입·교차로 판정 신설)·`OutingLandmark.swift`·`OutingProjection.swift`와 테스트 · `OutingModel.swift`의 노드 조회 자리 · `OutingSheet.swift`(필요 시) · spec `2026-09-26-outing-mode-design.md` 새 절 · `docs/INTEGRATIONS.md` §보행 인프라 |
| `android-2` | `android/app/src/main/kotlin/space/dodoplanet/gildongmu/place/**`(`PlaceDetailScreen.kt`·`PlaceDetailViewModel.kt`·`PlaceRoutes.kt`) · `nav/AppRoot.kt`(`LocalModalOpen` 공급) · `guide/**`(`GuideSession.kt`·`WalkGuideModel.kt`·`ui/GuideSheet.kt`·`ui/GuideBand.kt`) · `audio/TtsGuideSpeaker.kt`와 새 대기 칸 파일 · `settings/SettingsScreen.kt`의 백그라운드 음성 **행 하나**(헤딩 구조는 `e59-settings` 산출을 따른다) · `:kit`의 `GuideSpeechChannel` 미러와 `android/kit/mirrors/guide.json` · 안드로이드 테스트 · `android/README.md` 해당 절 |

### 정정 (2026-10-02 04:49, 관측 `5a577d1b`, `e59-settings` 착수 보고로 확인)

- 설정 화면 문자열 키(`ios.settings.*`)는 `messages/*.json`이 아니라 **`ios/i18n/ios-extra/*.json`**(중첩 `ios.settings`)에 있다. 코디네이터가 `ko.json`을 열어 재현했다. `e59-settings`는 그 파일의 자기 키만 만지고, `messages/*.json`은 건드리지 않는다. 위 웨이브 1 표의 `messages/*.json`의 `ios.settings.*` 서술은 틀렸다.
- A51 소스 가드 `src/lib/__tests__/settings-language-relabel.test.ts`는 `.menu` 전환과 한 몸이라 `e59-settings` 소유에 더한다.
- (05:00, `e59-settings` 보고, 코디네이터 재현) **base `5a577d1b`에서 안드로이드 `:app` 컴파일이 깨져 있다**: `7de51d26`(iOS 2.0)이 `ios/i18n/ios-extra/*.json`에서 `ios.directions.walkNotice.*` 9키를 지워 안드로이드 strings 재생성에서도 빠졌는데 `guide/ui/WalkGuideNoticeSheet.kt`가 아직 참조한다. 수정은 `e59-settings`가 별도 선행 커밋으로 한다(9키를 안드로이드 전용 원천으로 이관 + strings 재생성, 공지 시트 유지). `android-2`는 그 통합본 위에서 시작한다. 안드로이드 strings 드리프트 게이트가 "iOS 키 삭제 → 안드로이드 참조 잔존"을 못 잡은 것은 `doc-audit`·`android-2` 인계 사항.
- (04:58, `en-briefing` 보고, 코디네이터 재현) **A53 ②의 전제가 틀렸다**: iOS·안드로이드도 웹과 같이 "Walk 3 min to 여의도, 98m"(문장 틀은 앱 언어, 역 이름만 한국어)이다(`RouteBriefing.transitLegText(.korean)`이 `appLocalized`로 조립). ▶ 위원장 판정(2026-10-02): 문장은 앱과 같게 두고 웹 도보 줄의 한국어 역 이름에만 `lang="ko"`를 단다(탑승 줄과 같은 방식). `en-briefing`의 소유권 밖 자진 신고 셋(`PlaceSearch.tsx` 프리필 두 줄·`recent-searches.ts` `labelRoman` 선택 필드·새 lib 파일 1개)은 승인.

### 공용 생성물·공유 문서 규약

- `messages/*.json`(6로케일)은 **자기 키만** 더하고 고친다. `Localizable.xcstrings`·`ios/i18n/arg-order.json`·안드로이드 strings는 생성물이라 rebase 뒤 재생성하고 손으로 병합하지 않는다.
- `project.pbxproj`는 새 파일을 더할 때만, 객체 ID는 파일 전체에서 유일하게(`xcodebuild -list`로 검증). Kit 파일을 추가·개명·삭제하면 `android/kit/mirrors/<그룹>.json`을 함께 고친다.
- `CHANGELOG.md`·`docs/BACKLOG.md`·`PROGRESS.md`·`docs/FIELD-TEST.md`는 자기 항목·자기 줄만. rebase 뒤 `comm -23`(그리고 상대가 절을 지웠으면 `comm -13`) 대조를 고친 문서마다 돌린다.
- `CLAUDE.md`는 §1 판정 1대로 세션이 고치지 않는다.

## 3. git 절차 (저장소 정책: main 직접 push)

```bash
cd ~/gildongmu-wt/<이름>            # worktree·node_modules·.env.local은 이미 있다(npm install 금지)
# 작업: 자기 브랜치 feat/<이름>에만, pathspec 커밋(git add -A 금지), 커밋 이메일 engccer@gmail.com
git fetch origin && base=$(git rev-parse origin/main) && git rebase "${base}" && echo "${base}" > ~/gildongmu-wt/<이름>-reports/base.sha
comm -23 <(git show "${base}:CHANGELOG.md" | sort) <(sort CHANGELOG.md)   # 고친 공유 문서마다, 중괄호 필수
# 생성물 재생성 → 게이트(gate-lock.py) → push
git push origin feat/<이름>:main && git -C ~/Mac-Projects/gildongmu pull --ff-only
```

- push가 거부되면 `--force` 없이 fetch부터 다시. rebase 뒤에는 게이트를 다시 돌린다.
- 무거운 게이트(`test:run`·`tsc`·`build`·`swift test`·`xcodebuild`·gradle·playwright)는 `VITEST_MAX_WORKERS=2 python3 ~/.claude/skills/parallel-sessions/scripts/gate-lock.py <이름> -- <명령>`으로 감싼다(머신 전체에서 한 번에 하나).
- 리뷰 전에 전부 커밋하고 리뷰어는 `git diff origin/main...HEAD`(3점)로 읽는다. 리뷰가 도는 동안 rebase·커밋 금지. 리뷰 보고는 worktree 밖 `~/gildongmu-wt/<이름>-reports/`에 파일로 받는다.
- 통합을 마치면 worktree의 빌드 산출물(DerivedData·`.build`·gradle `build/`)을 지운다. worktree 제거와 창 닫기는 코디네이터가 한다.

## 4. 웨이브

1. **웨이브 1**: `e59-settings` · `small-9` · `en-briefing` · `outing-shops` · `outing-research`.
2. **웨이브 2**: `android-2`(조건: `e59-settings` 통합) · `outing-nodes`(조건: `outing-research` 보고 + `outing-shops` 통합 + 코디네이터 원천 판정).
3. **끝**: 코디네이터의 `CLAUDE.md` 반영·실기기 배포 → `doc-audit` 새 창.

## 5. 착수 프롬프트·보고 경로

- 프롬프트 사본: `~/.claude/parallel-sessions/gildongmu/<이름>.prompt.txt`(공통 계약 `_common-w8.txt` + 세션별 과제 `<이름>.task.txt`).
- 보고 디렉터리: `~/gildongmu-wt/<이름>-reports/`(`<단계>-<YYYYmmddHHMM>.md`, 단계 = start·integrating·done·blocked·judgment, 매번 새 파일).
- 코디네이터 주소: `gildongmu-a7 [4465c2]`.
