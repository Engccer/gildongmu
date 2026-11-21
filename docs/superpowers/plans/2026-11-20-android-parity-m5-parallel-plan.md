
웨이브 1 종료(2026-11-21 02:12). **리뷰 모델 정정**: 웨이브 1 착수 프롬프트가 리뷰어를 `opus`로 지정해 Opus 세션(`and-route`·`and-common`의 코드 리뷰와 접근성 감사, `and-rows`의 접근성 감사)의 리뷰가 작성자와 같은 모델로 돌았다. 코디네이터가 통합 뒤 `fable`·high로 다시 맡겼다(코드 리뷰 둘, 접근성 감사 하나, 보고 `~/gildongmu-wt/coordinator/rereview/`). 받아들인 지적은 마지막 정리 세션이 고친다. 웨이브 2부터의 프롬프트는 `fable`로 지정한다.

**재리뷰 결과와 수정 세션 `and-wave1-fix`(2026-11-21 02:32 착수, 기준 `8241da75`, opus·high)**: 재리뷰 셋은 모두 Fable 5.2로 실행됐다(전사 확인). `and-common` 코드 리뷰가 실제 결함 하나를 찾았다: 바로가기를 한 번 쓴 뒤 런처 아이콘으로 돌아오면 `MainActivity`가 한 겹씩 쌓인다(코디네이터가 한소네 7에서 `am` 명령으로 재현: 1개 → 2개 → 3개, 런처로만 열면 1개). 받아들인 지적은 A~J 열 가지(판정 `~/gildongmu-wt/coordinator/rereview/triage.md`): 겹침, 최근 앱 재실행(재현 먼저), 권한 손의 주인 없는 해제, 받아쓰기 불가 기기의 「음성 검색」 바로가기, 정체 줄 배선 가드, 정보 띠 48dp 하한 단언, 순서 옮긴 줄 커서(재현 먼저), 채팅 같은 라벨 동작, 둘러보기 첫 줄 두 번 출력 여부, TalkBack 확인 항목 문서화. `guide/**`와 닿는 자리는 권한 손 두 파일의 몇 줄과 테스트 단언뿐이다.

**외부 종료 사고(2026-11-21 03:20)**: 같은 맥에서 도는 moment 저장소의 작업 세션 하나가 `pkill -f gate-lock.py; pkill -f gradlew; pkill -f GradleWrapperMain`을 실행해, 착수 지시문을 명령줄 인자로 가진 `and-wave1-fix`와 `and-m5-transit-2`가 함께 종료됐다(발단은 그 세션의 테스트가 게이트 락을 14분 쥔 채 멈춘 것). 커밋된 작업은 남아 있었고 코디네이터가 두 세션을 `--resume`으로 같은 창에서 이어 띄웠다(복구 지시는 보고 폴더의 `coordinator-…md`). 이후 프롬프트에 「`pkill -f`·`killall` 금지, 자기 PID만 지정해 종료, `adb`는 `ANDROID_SERIAL`로 한소네 지정, 게이트 판정은 종료 코드로」를 넣는다. 스킬 개선 후보는 `~/gildongmu-wt/coordinator/skill-improvements.md`.
# 2026-11-20 안드로이드 등가성·M5 병렬 계획 (A75 · B17 · B21~B25 · B27 · E43 M5)

코디네이터 `gildongmu-3d [11226e]`(위원장 창, 판정 진행). worktree 기준 SHA는 이 문서를 넣은 커밋이다(소유권은 그 부모 `414419a3`에서 쟀다). 위원장 지시(2026-11-20): 안드로이드 관련 구현을 병렬 세션으로 진행하고 판정과 질문은 코디네이터 세션에서 한다.

## §1 마일스톤·확정 판정·모델 배정

| 세션 | 과제 | 확정 판정 | 모델·노력 | 웨이브 |
|---|---|---|---|---|
| `and-rows` | A75(검색·내 주변·둘러보기 줄의 거리 풀어쓰기 제거) → B21 ①~⑧(장소 줄 동작과 문장 속 장소·역 열기) | BACKLOG §1 A75 판정 ⓐ, §4 B21 판정(⑨는 iOS E72 실기기 판정 뒤라 제외) | opus · medium | 1 |
| `and-common` | B22(받아쓰기: 설정 행 숨김·검색 탭 음성 검색·끝점 검색 받아쓰기·앱 바로가기) · B23(고정한 최근 항목 순서 바꾸기) · B27 ①~④(제목 메뉴 새로고침·유휴 리셋·검색 탭 현재 위치 표시줄·걸음 산출 고지) | BACKLOG §4 B22 판정(탭 방식만, 「길게 누르기」는 별도 작업)·B23·B27 | opus · medium | 1 |
| `and-route` | B24(버스 노선 집합 표시) · B17(자동차 정체 줄, 조회 화면 몫) · B25(도보 안내 시트 정보 띠) | BACKLOG §4 B24·B17·B25 | opus · medium | 1 |
| `and-m5-car` | E43 M5 설계(자동차 → 대중교통 → 여정 분해와 세션 공유 진입점)와 자동차 실시간 안내 | BACKLOG §5 E43 「M5 자동차·대중교통 안내」, 2026-11-20 판정(등가성 묶음과 나란히) | opus · high | 1 |
| `and-m5-transit` | E43 M5 대중교통 실시간 안내와 도보 인계, B27 ⑤ 새 소식 시트 | 같은 항목 | opus · high | 2 (`and-m5-car` 통합 뒤) |
| `and-journey` | B26 여정 | BACKLOG §4 B26 | opus · high | 3 (`and-m5-transit` 통합 뒤) |

공통: 구현·이식·탐색 서브에이전트는 `model: sonnet`·`effort: medium`, 리뷰어·감사는 `model: opus`·`effort: high`. `and-m5-car`·`and-m5-transit`은 새 세션 구조와 상태 전이를 정하므로 spec 커밋 뒤 codex `adversarial-review` 1회(회전 상한 2회). 나머지 세션은 iOS 정본이 확정된 이식이라 설계 리뷰를 생략한다.

### 코디네이터 설계 판정 (제품 판단 아님)

- **A75의 처방을 화면의 모든 병합 줄에 적용한다.** 원인(`mergedRow`에 낭독용 이름을 얹으면 한소네가 이름과 글자를 이어 붙인다)이 길찾기 브리핑 줄·안내 시트 줄에도 같고, `android/README.md` §6이 이 풀어쓰기를 「실기기 판정 뒤 제거 가능」으로 적어 두었다. 세션마다 자기 소유 파일의 줄에서 걷어 낸다. 음성 발화와 상태 통지 채널(`WalkGuideModel.post`·`StatusLine`)의 풀어쓰기는 그대로 둔다. 낭독용 이름이 거리 말고 다른 이유로 보이는 글자와 다른 줄은 두고 판정 요청으로 보고한다.
- **M5는 정식 기능 구성(`debug`·`release`)에 넣는다.** 동기화 기준이 iOS 정식판이고 iOS는 2.0에서 자동차·대중교통 안내를 정식판으로 졸업시켰다(도보 안내 정식판 이동과 같은 원칙, `android/README.md` 「배포 전 개발·검증 기준」). 운전자 모드 피커처럼 iOS 실험판에 남은 것은 범위 밖이다.
- **M5는 자동차 → 대중교통 → 여정 순으로 직렬이다.** 셋 다 `GuideSession`의 시작 진입점·전경 서비스·시트 호스트를 고치고 대중교통은 도보 세션으로 인계하므로, 앞 세션이 정한 진입점 모양이 뒤 세션의 인터페이스다.
- **실기기 점검은 세션이 통합 전에 한소네 7에서 직접 한다**(2026-11-20 위원장 지시, 착수 뒤 정정. 착수 프롬프트의 「실기기 설치 금지」를 이 문장이 대신한다). 절차는 §3 「한소네 실기기 점검」.

## §2 파일 소유권 (기준 `414419a3`)

`A/` = `android/app/src/main/kotlin/space/dodoplanet/gildongmu/`, `K/` = `android/kit/src/main/kotlin/space/dodoplanet/gildongmu/kit/`. 호출 관계로 쟀다(이름 grep이 아니다). 테스트 파일은 같은 패키지의 것을 함께 소유한다.

| 세션 | 소유(수정) |
|---|---|
| `and-rows` | `A/search/SearchRows.kt`(함수 `RecentRow` 제외) · `A/nearby/**` · `A/chat/ChatRenders.kt`·`ChatInline.kt`·`ChatMessages.kt`·`AddressToPlace.kt` · `A/place/**` · `A/a11y/A11y.kt`·`Lines.kt` · 줄 동작 헬퍼 새 파일 · `K/NearbyService.kt`와 그 모델(옵트인 `coords=1`·`places=1`) · `android/README.md` §6의 풀어쓰기 문장 |
| `and-common` | `A/search/SearchScreen.kt`·`SearchViewModel.kt` · `SearchRows.kt`의 `RecentRow` 함수 · `A/directions/EndpointSearchContent.kt`·`EndpointPicker.kt`·`EndpointSearchState.kt` · `A/directions/DirectionsScreen.kt`의 최근 경로 줄 · `A/settings/**` · `A/speech/**` · `A/chat/ChatViewModel.kt`·`ChatScreen.kt`·`ChatDictation.kt` · `A/nav/**` · `A/a11y/AppTopBar.kt` · `A/location/LocationBar.kt` · `A/MainActivity.kt` · `AndroidManifest.xml`의 바로가기 선언과 `res/xml/shortcuts.xml` · `android/i18n/android-extra/*.json`의 자기 키 |
| `and-route` | `K/RouteService.kt`·`K/models/RouteModels.kt` · `A/directions/TransitLegText.kt`·`RouteRows.kt`·`RouteText.kt`·`BriefingStations.kt`·`DirectionsStrings.kt` · `A/directions/DirectionsViewModel.kt`의 경로 조회 호출 자리 · `A/guide/ui/GuideSheet.kt`·`GuideBand.kt` |
| `and-m5-car` | `A/guide/**`(위 두 파일과 `ui/WalkGuideNoticeSheet.kt` 제외) · `A/audio/**`(`ChatTtsPlayer.kt` 제외) · `K/Car*.kt`·`K/GuideStart.kt`(신설)·`K/CarTrafficAhead.kt`(신설)·`K/GuideSessionCoordinator.kt` · spec `docs/superpowers/specs/2026-11-20-android-m5-guidance-design.md` · `AndroidManifest.xml`의 안내 서비스 선언 |

**겹침과 직렬 순서**

- `K/RouteService.kt`·`K/models/RouteModels.kt`·`A/directions/RouteRows.kt`·`A/guide/ui/GuideSheet.kt`: `and-route` → `and-m5-car`. `and-m5-car`은 `and-route`가 `origin/main`에 통합되기 전에는 이 넷을 고치지 않는다. 통합 여부는 `git fetch origin && git log origin/main --oneline -- android/kit/src/main/kotlin/space/dodoplanet/gildongmu/kit/models/RouteModels.kt | head -1`이 기준 SHA 뒤 커밋을 내는지로 본다(통보를 기다리지 않는다). 그 전까지는 spec·`:kit` 이식·`WalkGuideModel` 쪽을 한다.
- `A/search/SearchRows.kt`: `and-rows`(장소·주소 줄)와 `and-common`(`RecentRow`)이 함수 단위로 나눠 고친다. `A/directions/DirectionsScreen.kt`: `and-common`(최근 경로 줄)과 `and-m5-car`(자동차 안내 시작 자리)가 자리를 나눠 고친다. `AndroidManifest.xml`: `and-common`(바로가기)과 `and-m5-car`(서비스). 알고 받아들인 겹침이고, 뒤에 통합하는 쪽이 rebase 충돌을 푼다.
- `A/nav/AppRoot.kt`는 `and-common` 소유다. 다른 세션이 등록 한두 줄을 더해야 하면 더하고 통합 보고에 자진 신고한다.
- `GuideSheet.kt`의 B16(「경로 새로고침」·「지금 여기는 어디?」)은 iOS E75 실기기 판정 전이라 이번 범위 밖이다.

**경계 인터페이스**

- `and-route` → `and-m5-car`: 자동차 정체 모델(`CarJam`·`congestion` 3-state)과 옵트인 `traffic=1`은 `and-route`가 `RouteModels.kt`·`RouteService.kt`에 iOS Kit과 같은 이름으로 넣는다. 주행 중 새 정체 판정(`CarTrafficAhead.swift`의 `newCarJamsAhead`)은 `and-m5-car` 몫이다. 버스 노선 집합은 `and-route`가 표시 몫(`TransitLane`·`TransitRouteLeg.lanes`·`transitBriefingLineName`, `lanes=1`)만 옮기고 노선 선택·잠금(`transitLegWithLane`)은 `and-m5-transit` 몫이다.
- `and-m5-car` → `and-m5-transit`: 시작 진입점(`GuideSession`의 시작 함수 모양, 시작 버튼, 전경 서비스, 시트 호스트)은 `and-m5-car`의 spec이 정하고 통합 보고에 인계 절로 적는다. `startWalk(WalkStartRequest)`를 부르는 기존 코드는 깨지 않는다.
- `and-rows`의 줄 동작 헬퍼(전화 걸기 → 여기까지 길찾기 → 주소 복사 → 물어보기)는 `and-rows`만 쓴다. 다른 세션은 이번 웨이브에서 부르지 않는다.

#### 정정 (2026-11-20 22:45 KST, 기준 `3bba3963`, 코디네이터가 재현 확인)

- `and-common` 착수 보고: `:kit` `RecentSearchStore.reorderPinned*`는 **이식돼 있지 않다**(`Reorder.kt`만 있다, `grep reorderPinned android/kit/src/main` 0건). BACKLOG B23 본문의 「이식돼 있고」를 그대로 옮긴 착수 프롬프트의 전제가 틀렸다. `and-common`이 `K/RecentSearchStore.kt`에 `applyPinnedOrder`·`reorderPinned*`와 Kit 테스트를 옮긴다(소유에 더한다).
- `and-common`: B23 최근 경로 이동에 `A/directions/DirectionsViewModel.kt` 함수 하나와 `DirectionsStrings.kt` 키 4줄을 덧붙인다(`and-route` 소유 파일, 덧붙이기만).
- `and-rows` 착수 보고: `PlaceRow` 호출부가 `A/search/SearchScreen.kt`(`and-common` 소유)에 있어 그 함수 몇 줄을 고치고, `A/nav/AppRoot.kt`에 공급 한 줄을 더한다. `:kit` `LocationNarrative.kt`·`StationPhone.kt`·`models/NearbyModels.kt`에 함수·필드를 더한다(소유에 더한다).
- `and-route` 착수 보고: 노선 이름 조립은 `K/TransitExitLines.kt`에 둔다(iOS 자리와 같다, 소유에 더한다). 수단 재조회도 `lanes=1`을 보낸다.

- 판정 요청 둘(`and-rows` 22:43, `and-route` 22:45)이 같은 건이다: 영어 등 한국어가 아닌 화면에서 한글 병기 때문에 낭독용 이름이 화면 글자와 다른 줄. 위원장에게 묻기 전에 `and-rows`(`a11y/A11y.kt` 소유)가 한소네 영어 화면 출력을 관측하고, 두 번 실리면 자식 글자의 시맨틱을 숨겨 낭독용 이름만 한 번 내는 방법을 검토한다(채택 조건: 누르기·작업 메뉴·착지 보존을 테스트로 확인, 한국어 화면 불변, 실기기 한 번 출력). 조건을 못 맞추면 그대로 두고 통합한 뒤 코디네이터가 위원장에게 묻는다. 회신 원문은 `~/gildongmu-wt/and-rows-reports/coordinator-202611202258.md`.

- 위원장 판정(2026-11-20, `and-common` 판정 요청 2건): ①탭 루트 「새로고침」은 「설정」 앞에 따로 둔 버튼으로 확정(메뉴로 묶지 않는다) ②정보 출처 걸음·칼로리 문장은 「걸음 수는 걸음 센서 실측, 칼로리는 걸은 거리와 체중으로 계산한 추정치입니다」(「이 기기의」를 뺀다).

**공용 생성물·문서**: `res/values*/strings.xml`·`gildongmu-kit-strings.json`·`arg-order.json`은 rebase 뒤 생성 스크립트로 다시 만든다(손 편집 금지). `messages/*.json`은 고치지 않는다(안드로이드 전용 문안은 `android/i18n/android-extra/`). `android/kit/mirrors/*.json`은 자기 항목만. `CHANGELOG.md`·`docs/BACKLOG.md`·`PROGRESS.md`·`android/README.md`·`.claude/rules/android.md`는 자기 항목·자기 절만 고치고 rebase 뒤 `comm -23`으로 소실을 대조한다. `CLAUDE.md`를 고쳤으면 통합 보고에 적는다(형제 `AGENTS.md`는 코디네이터가 다시 만든다). 서버·웹·iOS(`src/**`·`ios/**`·`packages/**`)와 공유 fixture는 읽기만 한다.

## §3 git 격리·게이트

main 직접 push(스킬 `parallel-sessions` Claude 지침 §3). worktree `~/gildongmu-wt/<이름>`(브랜치 `feat/<이름>`)와 `node_modules`·공식 Android 스킬은 코디네이터가 미리 만들었다. 세션은 `npm install`·SDK 설치를 하지 않는다.

- 통합: 고정 `base` rebase → 공유 문서 `comm -23` 대조 → 생성물 재생성 → 게이트 → `git push origin feat/<이름>:main && git -C ~/Mac-Projects/gildongmu pull --ff-only`. `--force` 금지, 거부되면 fetch부터 다시.
- **Gradle은 가벼운 실행까지 전부 머신 전역 락 안에서 돈다**(`android/README.md` §7의 `mkdir` 락 대신 스킬의 `gate-lock.py`를 쓴다. 게이트 끝의 `./gradlew --stop`이 머신의 데몬을 모두 내려 락 밖 실행을 죽이기 때문이다).
  ```bash
  export ANDROID_HOME=~/Library/Android/sdk
  python3 ~/.claude/skills/parallel-sessions/scripts/gate-lock.py <이름> -- bash -c 'cd android && ./gradlew :kit:test :app:testDebugUnitTest :app:assembleDebug :app:assembleRelease :app:assembleExperimental :app:compileDebugAndroidTestKotlin; code=$?; ./gradlew --stop >/dev/null 2>&1; exit $code'
  VITEST_MAX_WORKERS=2 python3 ~/.claude/skills/parallel-sessions/scripts/gate-lock.py <이름> -- npm run test:run
  node android/scripts/check-release-manifest.mjs android/app/build/outputs/apk/debug/app-debug.apk   # release도, 실험판은 --experimental
  ```
  개발 중 좁은 실행(`./gradlew :kit:test --tests …`)도 같은 락으로 감싸고 끝에 `--stop`을 붙인다.
- 기준선 기록 `~/.claude/parallel-sessions/gildongmu/baseline-<worktree 기준 SHA 12자리>.log`(`:kit:test`·`:app:testDebugUnitTest`, 정확한 경로는 착수 프롬프트에 있다). 실패하면 먼저 이 기록과 대조하고, 기준선을 다시 재려고 `git stash`·`checkout`을 하지 않는다. rebase 뒤 처음 보는 실패는 자기 것으로 단정하지 말고 보고한다.
- 리뷰: 전부 커밋한 뒤 `git diff origin/main...HEAD`로 별도 컨텍스트 리뷰어(`model: opus`)에게 맡긴다. 화면을 고쳤으면 접근성 감사를 붙인다(워크스페이스 `~/Mac-Projects/.claude/agents/a11y-auditor.md`를 Read해 지시를 준 `model: opus` 범용 에이전트). 리뷰가 도는 동안 rebase·커밋 금지, 결과는 보고 디렉터리의 파일로 받아 전문을 읽는다. 리뷰 반영분은 다시 리뷰하지 않는다.
- **한소네 실기기 점검**(통합 전, 코드 리뷰 반영 뒤. 에뮬레이터는 띄우지 않는다):
  - 한 번에 한 세션만 기기를 쓴다: 설치·키 주입·판정을 한 덩어리로 `python3 ~/.claude/skills/parallel-sessions/scripts/gate-lock.py <이름>-device -- <명령>` 안에서 돌린다(2026-11-21 00:03 정정: 기기 점검은 기기 전용 락 `GATE_LOCK_FILE=~/.claude/parallel-sessions/hansone.lock`으로 옮기고, 그 안의 Gradle 호출만 게이트 락으로 감싼다. 순서는 항상 기기 락 → 게이트 락. 같은 락을 쓰던 동안 키 주입 5~10분씩이 `and-m5-car`의 단위 테스트를 22분 넘게 굶겼다. 락은 선착순이 아니다. 01:05 2판: 두 락을 겹쳐 쥐지 않는다. 게이트 락에서 `assembleDebug`를 먼저 끝내 APK를 보고 디렉터리로 복사하고, 기기 락에서는 설치와 키 주입만 한다. 1판의 겹침은 `and-m5-car`가 기기 락을 26분 쥔 채 빌드를 기다리게 했다. 같은 시각 moment 저장소의 `android-m0` 세션이 같은 게이트 락과 한소네를 쓰기 시작해 그쪽 코디네이터에 기기 락을 알렸다. 규칙 원문 `~/gildongmu-wt/coordinator/device-lock-v2-202611210105.md`). 락 안에서 `debug` APK를 다시 빌드해 `adb install -r`로 넣고 바로 점검한다(다른 세션이 그 사이 자기 빌드를 덮어썼을 수 있다).
  - **시작 전마다 위원장이 기기를 쓰는 중인지 본다**: `adb shell dumpsys window | grep mCurrentFocus`가 `com.selvashc.connectivity`(터미널 모드)이면 시험하지 않는다. 15분 뒤 한 번 더 보고, 여전히 쓰는 중이면 「실기기 미확인」을 보고에 적고 통합한다(코디네이터가 뒤에 묶어 점검한다).
  - 도구와 절차: `H7_SCRIPTS=~/_Aliases/KHY/Consulting/"11. 한소네7 베타테스터"/scripts`, 그 폴더 `CLAUDE.md`의 「맥에서 자동 시험하기」 절(키는 가상 키보드·점자 키 주입으로만, 판정은 `LCDOUT`·`BRLOUT` 출력으로, `uiautomator dump`·`android layout` 금지, 기기의 `wifi pw.txt`를 열지 않는다)과 `android/README.md` §2 「한소네 7 점자 흐름」. 그 절의 0단계(베타 패치 설치)는 하지 않는다. 한소네의 OS·설정·다른 앱·파일은 건드리지 않는다.
  - 점검 내용: 기존 `android/scripts/hansone-smoke.py` 전 구간 통과(회귀)와 자기 변경의 점검. 자기 점검 대본은 `android/scripts/hansone-<이름>.py` 새 파일로 커밋한다(공용 `hansone-smoke.py`는 `and-rows`만 고친다). 점자·화면 출력에 같은 내용이 두 번 실리는 줄이 새로 생겼는지 함께 본다.
  - 하지 않는 것: 실제 전화 발신(전화 걸기는 다이얼 화면이 뜨는 것까지만 본다), 메시지·메일 발신. 실내라 위치를 못 잡거나 주행이 필요한 항목은 확인하지 못한 것으로 적는다. 끝나면 안내를 끝내고 홈 메뉴로 돌려놓는다(`--cleanup`).
  - 기기에서 드러난 결함은 통합 전에 고친다. 결과는 `device-<YYYYmmddHHMM>.md`(조작, 기대, 실제 출력, 판정)로 쓰고 통합 보고에 요약한다.
- 사용자 판정은 `~/gildongmu-wt/<이름>-reports/judgment-<YYYYmmddHHMM>.md`로 쓰고 코디네이터에 통보한 뒤 기본값으로 계속한다. 하드 스톱(비용·외부 발신·파괴·아키텍처 양자택일)은 코디네이터에게 보고한다.

## §4 웨이브

웨이브 1: `and-rows`·`and-common`·`and-route`·`and-m5-car`. 웨이브 2: `and-m5-transit`(2026-11-21 01:21 착수, 기준 `b03153c4`. 대중교통은 한 세션에 넘치므로 단계마다 통합하고, 문맥이 불어나면 남은 단계를 인계해 `and-m5-transit-2`가 잇는다. 시작 버튼은 본체가 완결된 단계에서 연다). 웨이브 3: `and-journey`. 그 뒤 doc-audit 세션과 한소네 실기기 점검.

## §5 착수 프롬프트·보고

프롬프트 사본 `~/.claude/parallel-sessions/gildongmu/<이름>.prompt.txt`, 보고 `~/gildongmu-wt/<이름>-reports/`(단계마다 새 파일 `start`·`review`·`integrated`·`blocked`·`judgment`).

## §5-1 통합 기록

| 세션 | 통합 SHA | 시각 | 자진 신고 | 남은 판정 |
|---|---|---|---|---|
| `and-route` | `9358346a` | 2026-11-20 23시대 | `K/TransitExitLines.kt`(노선 이름 조립, 착수 보고로 신고) | 영어 화면 대중교통 구간 줄의 낭독 이름(`and-rows`의 관측 뒤). 실기기 미확인: 정체 줄·노선 집합 줄 실물(해당 경로 필요), TalkBack 띠 빈 곳 짚기. 한소네 `hansone-smoke.py`·`hansone-and-route.py` 종료 0. 리뷰 서브에이전트 둘은 `claude-opus-5-5`로 실행됨(전사 확인) |
| `and-m5-car` | `b03153c4` | 2026-11-21 01:18 | `guide/ui/GuideSheet.kt`(자동차 제목·현재 도로 줄·도보 인계 버튼), `directions/DirectionsScreen.kt` 시작 슬롯 한 줄, 알림 제목. 리뷰어는 Fable·high(작성자가 Opus) | 열린 판정 없음. 실기기 미확인: 주행 항목 전부, TalkBack 낭독·커서(BACKLOG §2 「E43 M5 자동차 안드로이드」 ①~⑨). 한소네 `hansone-smoke.py`·`hansone-and-m5-car.py` 통과 |
| `and-rows` | `a88a0d54` | 2026-11-21 01:35 | `search/SearchScreen.kt`·`nav/AppRoot.kt`(`and-common` 소유) 배선, 채팅 `ChatScreen.kt`, 가드 둘, `:kit` `LocationNarrative.kt`·`StationPhone.kt` | A77(영어 화면 병기 줄이 한소네에서 두 번 출력, 위원장 판정 대기), A76(상세·물어보기에서 돌아오면 커서가 검색창, B21 이전부터). 인계: 채팅 `resolveAddress`·`AddressToPlace.kt` 계열이 죽은 코드. 한소네 `hansone-smoke.py`(A75 경고 소멸)·`hansone-and-rows.py` 통과 |
| `and-m5-transit` 단계 1 | `a31ef698` | 2026-11-21 01:45 | 소유 밖 파일 없음, `:app` 변경 없음. `:kit` `TransitTransferWalk.kt`에 `JourneyTuning` 상수 하나를 임시로 둠(`and-journey`가 `Journey.swift` 이식 때 합친다) | 열린 판정 없음. 설계 spec §6(6-1~6-10)과 `:kit` 이식 6파일·E76 표류분. codex 설계 리뷰 6건 수용(§6-10). 화면 변화가 없어 한소네 점검 없음. 남은 단계 2~7(§6-9)은 `and-m5-transit-2`(2026-11-21 01:46 착수, 기준 `a31ef698`)가 잇는다. 시작 진입점은 도보 인계 뒤(단계 7)로 옮겼다 |
| `and-common` | `16a7b6c4` | 2026-11-21 02:12 | `:kit` `RecentSearchStore.kt`(`reorderPinned*` 이식)·등록부 `foundation.json`, `directions/DirectionsViewModel.kt`(`moveRecentRoute`)·`DirectionsStrings.kt`(`and-route` 소유), `settings/SettingsAction.kt`의 새로고침 버튼 | 열린 판정 없음(새로고침 자리·걸음 문장은 위원장 판정 반영). 한소네에서 찾은 결함 셋(첫 결과 착지, 결과 수 통지, 따뜻한 실행 바로가기)은 통합 전에 고침. 미확인: B23 메뉴(고정 항목 없음), 끝점 검색 받아쓰기, 10분 유휴 리셋, TalkBack 폰(BACKLOG §2 「B22·B23·B27 한소네」). 넘김: B22 「길게 누르기」, B27 ⑤(M5 도달 때), A78 |
| `and-m5-transit-2` 단계 2 | `f649ad04` | 2026-11-21 02:54 | 소유 밖 파일 없음(`guide/**`와 그 테스트) | 열린 판정 없음. 대중교통 모델 핵심(`TransitGuideModel.kt` 수명·폴·유휴·통지·사용자 동작). Fable 코드 리뷰 6건 중 5건 수용. 사용자 미도달이라 한소네 점검 없음. ⚠ 환승 도보 훅 `onTransferWalk`가 비어 있으면 환승 도보 판정을 건너뛴다: 단계 6이 반드시 배선한다. 같은 세션이 단계 3을 잇는다 |
| `and-m5-transit-2` 단계 3 | `fb892b4a` | 2026-11-21 03:57 | 소유 밖 파일 없음. 자진 신고: 재개 뒤 묶음 3-2 커밋을 게이트 종료 코드 확인 전에 만들어 실패 1건을 push 전 다음 커밋에서 고침 | 열린 판정 없음. 대중교통 모델 확장(승차 중 현재역 E35·버스 정류장 E48·정류장 재기준 E76·잘못 내림 복구 E78·목적지 전환·다른 경로). Fable 코드 리뷰 3건 수용(변이 주입으로 검출 확인). 사용자 미도달. 남은 단계 4~7은 `and-m5-transit-3`(2026-11-21 03:58 착수, 기준 `fb892b4a`)가 잇는다 |
| `and-wave1-fix` | `54841ab6` | 2026-11-21 04:10 | `guide/GuidePermissionsImpl.kt`·`guide/ui/GuideBottomBar.kt`(권한 손 주인 대조), `GuideSourceGuardTest` ⑦(「launchMode 무변경」을 「singleTop만」으로), `chat/ChatRenders.kt`, `search/SearchScreen.kt`·`directions/DirectionsScreen.kt`·`directions/EndpointSearchContent.kt`(옮긴 줄 착지 각 3~4줄) | 재리뷰 지적 A~J: 여덟 고침(겹침은 `launchMode="singleTop"`, 최근 앱 재실행·순서 옮긴 줄 커서는 한소네에서 재현 뒤 고침), I 재현 안 됨(그대로), D는 API 33 미만만 숨김. **판정 대기**: API 33 이상인데 음성 인식기가 없는 기기의 「음성 검색」 바로가기(BACKLOG B22, 기본값 그대로 둠). 변이 12건 모두 검출. 한소네 대본 `hansone-and-wave1-fix.py`·회귀 통과. 미확인: TalkBack 폰 항목, 이동 뒤 자리 통지가 착지 낭독에 덮이는지 |
| `and-m5-transit-3` 단계 4 | `4b4308c3` | 2026-11-21 04:48 | `nav/AppSourceGuardTest.kt`(and-common 소유)의 위치 허용 목록에 `GuideSession.kt` 추가(안내는 수동 위치가 아니라 실제 GPS를 쓴다) | 열린 판정 없음. 대중교통 서비스·오디오 경계: 전경 서비스의 다섯 경로를 세대 번호와 함께 지금 소유 모델에만 전달, keep-alive 원함과 가동 분리(시작 거부가 세션을 끝내지 않고 전경 복귀가 다시 켬), 톤·TTS·진동 한 벌을 두 모델이 공유. Fable 리뷰 1건 수용(하차 뒤 서비스 없는 알림이 남던 자리). 변이 2건 검출. 사용자 미도달. spec과 다른 점: 세대 수열을 공유 컨트롤러가 발급. 단계 7 한소네 점검에 「하차 직후 알림창에 안내 알림이 남지 않는가」 추가. 남은 단계 5~7은 `and-m5-transit-4`(2026-11-21 04:50 착수)가 잇는다 |
| `and-m5-transit-4` 단계 5 | `01452751` | 2026-11-21 06:26 | `directions/EndpointSearchContent.kt`·`EndpointPicker.kt`(복구 역 검색용 인자), `directions/DirectionsScreen.kt`·`location/ManualLocationPickerScreen.kt`(그 인자 전달), `nearby/SceneSection.kt`(들이기 요청자 인자), androidTest `GuideSheetA11yTest.kt` | **열린 판정**: 대중교통·도보 시트 제목 메뉴 순서(BACKLOG E43 M5). 대중교통 안내 시트(뼈대·착지, 경유역·국면 컨트롤, 조망, 잘못 내림 복구·목적지 전환·주변 확인). Fable 코드 리뷰 3건·접근성 감사 5건 수용, 영어 화면 「다른 경로」 구간 줄은 A77 여섯째 자리로. 사용자 미도달. 단계 6(도보 인계)은 코드와 리뷰 반영까지 끝나 브랜치 `feat/and-m5-transit-4-s6`에 있고 미통합. 한소네 확인 항목(화면 밖 복귀 착지 세 곳, 경유역 펼침 복원, 후보 목록 갱신 중 커서)은 단계 7 대본으로. 남은 단계 6~7은 `and-m5-transit-5`(2026-11-21 06:30 착수)가 잇는다 |
| `and-m5-transit-5` 단계 6 | `4ce88f75` | 2026-11-21 06:44 | 소유 밖 파일 없음 | 열린 판정 없음. 도보 인계(승차 전 도보, 하차 인계, 환승 도보, 출구 대기)와 대중교통 시트 두 자리 배선. 앞 세션 브랜치의 세 커밋을 cherry-pick, `GuideSession.kt` 충돌 한 곳은 양쪽 유지. 단계 6 리뷰 지적 5(출구 문장이 1회 소리 경고를 밀어냄)도 받아 한 통지로 합침. 코디네이터 확인: `onTransferWalk`·`onPassedPrewalk`가 `GuideSession.kt`에 배선돼 있고 `GuideTransitHandoffGuardTest`가 잠근다, 「단계 6:」 표식 0, `startTransit(` 호출부 0. 사용자 미도달. 옮기면서 새로 쓴 배선과 충돌 해소분은 단계 7 리뷰에 함께. 같은 세션이 단계 7로 이어 간다 |
| `and-m5-transit-5` 단계 7 | `589b344d` | 2026-11-21 10:54 | `nav/AppRoot.kt`(새 소식 창을 앱 시작 때 어느 탭에서나), `directions/DirectionsScreen.kt`(옛 도보 공지 제거), `android/scripts/hansone-smoke.py`, `src/lib/__tests__/android-strings-drift.test.ts`(의도 차이 한 줄), 새 소식 문안 생성물, 공유 문서. `GuideStrings` 공용 키 매핑과 제목 메뉴 순서는 도보·자동차 시트에도 닿는다 | 열린 판정 없음(2026-11-21 위원장 판정 셋 반영: 새 소식 창 제목은 버전만 뺌, 제목 메뉴는 아이폰 순서, 새 소식 창의 「시트 닫기」 숨김). 대중교통 시작 버튼과 앱 시작 새 소식 창(B27 ⑤)으로 사용자에게 도달. 코디네이터가 통합 전에 한소네 추가 점검을 요구해(탑승 중·하차 화면은 기기에서 그려진 적이 없었다) 결함 셋을 기기에서 찾아 고쳤다: 경유역 펼침 줄이 그려지는 순간의 충돌(단계 5부터 있던 미매핑 문자열 키), 열차를 고른 뒤 착지 포기 둘. 한소네 통과: 회귀 전 항목, 탑승 중·하차·「남은 도보 안내 시작」, 하차 직후 알림 0, 새 소식 창 닫힘 길 셋, 제목 메뉴 순서. 남은 것: BACKLOG §2 E43 M5 ⑦⑧(경유역 상세 왕복, 다른 탭 띠바 펼침 착지) 한소네 재측정, 실승차 ①~⑥, A80·A81(이름 없는 「버튼」). 코디네이터 확인: 원격 main 11커밋·42파일, 계측 로그·APK 커밋 0, 옛 공지 테스트는 `ReleaseNoticeTest`로 대체. 리뷰·감사는 Fable 5.2, 구현 서브에이전트는 Sonnet 5.5로 실행됨(세션 전사 확인 보고). 대중교통 단계 1~7 끝 |
