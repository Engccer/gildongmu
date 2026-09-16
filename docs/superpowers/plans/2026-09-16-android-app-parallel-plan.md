# 병렬 계획: 안드로이드 앱 착수 (2026-09-16)

> 코디네이터 세션이 `docs/superpowers/specs/2026-09-15-android-app-decisions.md`(판정 13건)와 `docs/research/RESEARCH-2026-09-15-android-release.md`(조사)를 입력으로 작성. 작업 세션은 자기 절만 읽어도 착수할 수 있게 자족적으로 쓴다.
> ⛔ **push 동결 중**(2026-09-22 09:00 KST까지, OpenAI WebMCP Challenge 심사). **통합은 로컬 `main` fast-forward**이고 `origin` push는 `.git/hooks/pre-push`가 막는다. 훅을 지우지 않는다. 안드로이드 작업은 서버를 건드리지 않으므로 동결과 충돌하지 않는다.
> 종료 상태: (웨이브 진행 중. 끝나면 여기에 세션별 SHA·남은 판정 위치 한 줄)

## §1. 마일스톤과 확정 판정

기준 SHA: `fdc19534`(로컬 `main`, 작업 트리 clean, 2026-09-16 15:40 KST).

### 이 세션(2026-09-16)에서 위원장이 확정한 것

| 열린 판정 | 확정 |
|---|---|
| O2 패키지 이름 | **iOS와 같은 체계.** 정식 `space.dodoplanet.gildongmu`, 실험판 `space.dodoplanet.gildongmu.dev`(`applicationIdSuffix`) |
| O6 실험 빌드 구성 | **처음부터 둔다.** build type 또는 flavor로 `debug`·`release`·`experimental` 세 구성. iOS와 같이 실험판은 번들 ID·표시 이름(`…실험`)·아이콘이 다르고 정식판과 한 기기에 공존한다. 표시 이름 접미사는 스크린 리더 사용자의 유일한 구분 수단이라 반드시 유지 |
| 병렬 구성 | **뼈대 1창 → 3창 병렬**(§4) |

열린 채 두는 것: O1(일반 폰 확보, M4 진입 때 재검토) · O3(스토어 등재 정보, 계정 개설 뒤) · O4·O5(한소네 개발자 옵션·Play Console 앱, 위원장이 실기기에서 확인). Play 개발자 계정 개설(25달러)은 비용 발생이라 위원장이 직접 한다. 개발은 계정 없이 진행되고 내부 테스트 트랙 업로드만 계정을 기다린다.

### 마일스톤 (판정 문서 §2 그대로, 세션 배정만 추가)

| | 내용 | 세션 | 웨이브 |
|---|---|---|---|
| M0 | 개발 환경 + 프로젝트 뼈대 + 첫 빌드 + **이식 방식 확립**(기초 파일 이식 + 공유 fixture 시험 장치 + 미러 등록부) | `android-m1` | 0 |
| M1 | 검색 화면(옴니박스·칩 필터·결과 목록·최근 검색·음성은 게이트) + i18n 변환 + 서버 호출 + 접근성 기본형 | `android-m1`(M0 이어서) | 1 |
| Kit-core | Kit 순수 로직 중 검색·장소·내 주변·역·길찾기 문장·채팅 계열 이식 | `android-kit-core` | 1 |
| Kit-guide | Kit 순수 로직 중 실시간 안내 판정 계층 이식 | `android-kit-guide` | 1 |
| M2 | 장소 상세 + 내 주변 | 후속 | 2 (Kit-core 뒤) |
| M3 | 길찾기 브리핑 | 후속 | 2 (Kit-core 뒤) |
| M4 | 실시간 안내(도보): 전경 서비스·오디오 포커스·[3] 서비스 | 후속 | 3 (Kit-guide 뒤) |
| M5 | 실시간 안내(대중교통·자동차) | 후속 | 3 |
| M6 | 채팅 | 후속 | 3 |

**M0이 결정적이다.** 여기서 정한 모듈 배치·패키지 이름·fixture 로딩 방식·Kotlin 관용구를 나머지 두 세션이 그대로 따른다. M0 체크포인트 커밋이 `main`에 오르기 전에는 웨이브 1의 로직 세션을 띄우지 않는다.

### §1-1. 모델 배정

| 세션 | 모델 | 근거 |
|---|---|---|
| `android-m1` | `fable` | **판단이 정본**: M1 spec을 새로 쓰고(모듈 배치·fixture 하네스·i18n 변환·Compose 접근성 기본형), Swift→Kotlin 이식 관용구를 처음 정한다. ⚠ fable 한도 위험: 코디네이터가 착수 30분 뒤 worktree HEAD가 base 그대로인지 대조한다 |
| `android-kit-core` | `opus[1m]` | **절차가 정본**: 정본은 Swift 원본 + TS 원본 + 공유 fixture이고 이 세션은 M0이 정한 관용구로 옮겨 적는다. 파일 수가 많아 1M 판 |
| `android-kit-guide` | `opus[1m]` | 같음. 분량이 가장 크다(약 5,800줄) |

낮춘 세션이 판정에 부딪히면(fixture가 Swift와 TS에서 다르게 읽힌다, 원본 두 벌이 서로 어긋난다, 이식 불가한 플랫폼 의존이 섞여 있다) 혼자 정하지 말고 코디네이터에 보고한다.

## §2. 파일 소유권 지도

술어는 "그 파일을 고치는가"이지 "이름이 나오는가"가 아니다. 안드로이드 코드는 전부 저장소 루트 `android/` 아래에 둔다(`ios/`와 형제). 세 세션의 소유는 **Kit 원본 파일 단위**로 가른다(아래 표). Kotlin 파일 이름은 Swift 파일 이름을 따른다(`Coverage.swift` → `Coverage.kt`).

### 공용 뼈대 (M0이 만들고 이후 `android-m1`만 고친다)

`android/settings.gradle.kts` · `android/build.gradle.kts` · `android/gradle/**` · `android/gradlew*` · `android/gradle.properties` · `android/kit/build.gradle.kts` · `android/app/**` · `android/scripts/**` · `android/i18n/**` · `android/README.md`. 로직 세션이 뼈대를 고쳐야 하면(의존성 추가 등) 고치지 말고 코디네이터에 보고한다. 단 **새 Kotlin 파일 추가는 자유**다(자기 그룹 파일만).

### Kit 원본 파일 배정

`ios/GildongmuKit/Sources/GildongmuKit/` 기준. 판정 문서 D5의 [2] 계층 전부. 그룹 경계는 코디네이터가 타입 참조를 스크립트로 전수 대조해 그었다(2026-09-16, 기준 `fdc19534`). 주석·`Range`·`CodingKeys` 같은 거짓 참조는 뺐다.

**FOUNDATION (M0, `android-m1`)**: 다른 두 그룹이 의존하는 타입과 M1 검색이 쓰는 것.

`APIClient` · `AppVersion` · `CoordQuery` · `Coverage`(+`Resources/korea-boundary.json` 바이트 동일 사본) · `Format` · `Geo` · `KoreanParticle` · `Localization` · `LocationFix` · `RouteGeometry`(`RoutePoint`) · `CarAction` · `WalkAction` · `FinalApproach`(`BearingUnavailable`·`FinalApproachGeometry` 타입을 `RouteModels`가 쓴다) · `Models/*` 9파일 전부(`BarrierFreeModels`·`ChatModels`·`NearbyModels`·`RouteModels`·`SearchModels`·`StationModels`·`SurroundingsSceneModels`·`WalkInfraModels`·`WhereAmIModels`)
그리고 M1 검색이 쓰는 것: `SearchFilters` · `SearchService` · `VoiceQuery` · `RecentSearchStore` · `BilingualName` · `KakaoCategory`

**CORE (`android-kit-core`)**: 검색·장소·내 주변·역·길찾기 문장·채팅·정위.

`BarrierFreeService` · `ChatMarkdown` · `ChatPlaceMentions` · `ChatService` · `ChatSuggestionsService` · `ClinicKind` · `Deeplink` · `DeferredAnnouncer` · `Directions` · `LocationNarrative` · `ManualLocation` · `MarkdownPlainText` · `NearbyLoadCore` · `NearbyService` · `PlaceChatPrompts` · `PlaceHoursService` · `PlaceProjection`(⚠ `guideDestinationPlace(dest: BeaconDest)` 한 함수만 GUIDE 소유 `Beacon`의 타입을 쓴다: 그 함수는 GUIDE의 `Beacon.kt`가 `main`에 오른 뒤 rebase해서 붙이고, 그 전엔 그 함수 하나만 빼고 이식) · `QuickExitText` · `RevealWindow` · `RouteService` · `StationMatch` · `StationService` · `SubwayArrivalLine` · `TransitAlternativeName` · `TransitDisplay` · `TransitExitLines` · `TransitWalkLegText` · `WalkInfraService` · `WhereAmIService`

**GUIDE (`android-kit-guide`)**: 실시간 안내 판정 계층.

`Beacon` · `BeaconGate` · `BeaconTones` · `CarArrival` · `CarListener` · `CarRouteGuide` · `CourseDerivation` · `EndScreen` · `GuideAudioSession`(⚠ 판정 부분만: iOS 오디오 세션 API에 붙은 계약은 D10에 따라 이식하지 않는다. 순수 판정 `guideAudioStep`·route 변경 판정 등만) · `GuideBand` · `GuideCourse` · `GuideCourseAxis` · `GuideLiveRows` · `GuideMotion` · `GuideSessionCoordinator` · `GuideSpeechGate` · `GuideToneLayer` · `IdleReset` · `ListenSpeed` · `RerouteProposalGate` · `RouteGuide` · `RouteOrigin` · `SessionIdle` · `TransitDisplayProjection`(`TransitGuide` 타입 의존이라 여기) · `TransitGuide` · `TransitGuideText` · `TransitGuideTone` · `TransitIdle` · `TransitProgressOverview` · `TransitSurroundingsAnchor` · `TransitTrackService` · `WalkHealth`

**제외(이식하지 않음, 미러 등록부에 사유와 함께 등재)**: `AudioSignalProtocol`(E20 음향신호기 BLE 실험, 2026-09-01 연동 기종 없음으로 종결) · `Resources/Localizable.xcstrings`(Kit 카탈로그: 안드로이드는 `android/i18n` 변환 스크립트가 `messages/*.json`에서 직접 만든다).

### 공용 생성물·문서

| 파일 | 규약 |
|---|---|
| `android/kit/mirrors/<그룹>.json` 미러 등록부 | 그룹별 파일 하나(`foundation.json`·`core.json`·`guide.json`). 자기 파일만 고친다. 형식은 M0이 정하고 검사 테스트가 셋을 합쳐 읽는다 |
| `src/lib/__tests__/fixtures/*.json` 공유 fixture | **읽기만.** 세 플랫폼의 정답표라 안드로이드 이식 때문에 고치지 않는다. fixture가 틀렸다고 판단되면 코디네이터에 보고(웹·iOS 테스트도 같이 바뀌어야 한다) |
| `CHANGELOG.md` | 자기 항목만 맨 위 날짜 절에 추가. rebase 뒤 `comm` 소실 대조 필수(§3) |
| `docs/BACKLOG.md` | 이 웨이브에서는 코디네이터만 고친다. 세션은 남길 판정을 보고 파일에 적는다 |
| `PROGRESS.md` | 코디네이터가 웨이브 종료 때 상태 한 줄 |
| `docs/superpowers/specs/2026-09-16-android-app-design.md` | `android-m1`이 쓴다(M1 범위). 로직 세션은 spec을 새로 쓰지 않고 이 계획 §5 + M0 산출물(`android/README.md`)이 계약이다 |
| `ios/**` · `src/**`(fixture·드리프트 테스트 제외) · `packages/**` | **어느 세션도 고치지 않는다.** 심사 통과한 iOS를 흔들지 않는다(D4) |
| `src/lib/__tests__/mirror-registry.test.ts`(가칭) | M0이 만들고 이후 `android-m1`만 고친다. 로직 세션은 등록부 JSON만 고쳐서 통과시킨다 |

## §3. git 격리 절차 (push 동결판)

```bash
# 코디네이터가 착수 전에 만든다(세션은 만들지 않는다)
git -C ~/Mac-Projects/gildongmu worktree add ~/gildongmu-wt/<name> -b feat/<name> main
# 세션: 자기 브랜치에만, pathspec 커밋(git add -A 금지). 커밋 메시지 한국어, 꼬리말은 하니스가 지정한 줄 그대로
# 통합: git rebase main → 생성물 재생성 → 게이트 → git -C ~/Mac-Projects/gildongmu merge --ff-only feat/<name>
#       ff 거부면 다른 세션이 먼저 올린 것: rebase부터 다시(게이트도 다시)
```

- `--force` 금지. `origin` push 금지(훅이 막고, 막혀도 시도하지 않는다).
- worktree에 `node_modules`는 코디네이터가 미리 설치해 두었다. **`npm install` 금지.** 안드로이드 SDK·JDK 설치는 `android-m1`(M0)만 한다. 다른 세션은 설치하지 않고, 없으면 코디네이터에 보고.
- **무거운 게이트(`./gradlew build`·`./gradlew test`·`npm run test:run`)는 머신 전역 락을 잡고 돈다**: `until mkdir ~/gildongmu-wt/gate.lock 2>/dev/null; do sleep 30; done` → 게이트 → (실패해도) `rmdir ~/gildongmu-wt/gate.lock`. Gradle 데몬은 세션당 하나로 두고(`org.gradle.workers.max=2`), 끝나면 `./gradlew --stop`으로 내린다. 16GB 머신에서 gradle 데몬 셋 + vitest가 겹치면 죽는다.
- vitest는 `VITEST_MAX_THREADS=2 npm run test:run`으로 돈다.
- **리뷰는 별도 컨텍스트**(서브에이전트, 요구사항 + `git diff main...HEAD`만 전달, 세션 히스토리 전달 금지). 리뷰가 도는 동안 rebase·커밋 금지. 리뷰 결과는 파일(`~/gildongmu-wt/<name>-reports/`)로 받아 전문을 읽은 뒤 닫는다. 리뷰 전에 전부 커밋한다(미커밋 0).
- rebase 뒤 공유 문서 소실 대조: `base=$(git rev-parse main)` 뒤 `comm -23 <(git show "${base}:CHANGELOG.md" | sort) <(sort CHANGELOG.md)`; 출력은 전부 자기가 지운 줄이어야 한다. **`${base}`처럼 중괄호로 감싼다**(zsh 수정자 함정).
- 보고 파일: `~/gildongmu-wt/<name>-reports/report.md`(worktree 밖). 체크포인트·통합·막힘마다 갱신하고 코디네이터(`SendMessage`)에도 보낸다. 메시지는 유실될 수 있으므로 **파일이 정본**이다.
- 세션은 TTS 요약 파일(`~/.claude/tts-summary.txt`)을 쓰지 않는다. 위원장에게 닿아야 하는 것은 코디네이터에게 보낸다.
- 실기기 설치(`adb install`)는 한 번에 한 세션. 설치 직전 코디네이터에 알리고 허가 뒤에. 기기 페어링(`adb pair`)은 코디네이터가 위원장과 한다: 세션은 `adb devices`가 비어 있으면 APK 경로만 보고하고 기다리지 않고 다음 일을 한다.

## §4. 웨이브

| 웨이브 | 세션 | 시작 조건 | 종료 조건 |
|---|---|---|---|
| 0 | `android-m1` | 지금 | **M0 체크포인트**가 `main`에 ff로 올라감: 환경 설치 완료, `./gradlew :kit:test :app:assembleDebug` 초록, FOUNDATION 이식 + fixture 하네스 + 미러 등록부 + 검사 테스트 초록, `android/README.md`에 이식 관용구 문서화. 그 SHA를 코디네이터에 보고 |
| 1 | `android-m1`(계속) · `android-kit-core` · `android-kit-guide` | M0 SHA 위에서 두 로직 worktree 생성 | 각자 그룹 전량 이식 + fixture 초록 + 미러 등록부 완비 + 리뷰 통과 + ff 통합. M1은 검색 화면이 한소네에서 점자로 읽히는 것까지 |
| 2 | M2·M3 세션 | CORE 통합 뒤 | (후속 계획) |
| 3 | M4·M5·M6 세션 | GUIDE 통합 뒤 | (후속 계획) |

동시 게이트 상한 3. 웨이브 1은 창 셋이므로 락으로 직렬화한다(§3).

## §5. 세션별 착수 프롬프트

### 5-1. `android-m1` (웨이브 0 → 1, fable)

프롬프트 원문은 `~/.claude/parallel-sessions/gildongmu/android-m1.prompt.txt`. 요지:

1. **worktree** `~/gildongmu-wt/android-m1`(브랜치 `feat/android-m1`, base `fdc19534`). 이 계획 §2·§3을 지킨다.
2. **읽을 것**: 판정 문서(§1 판정 13건을 다시 논의하지 않는다, §4 실측값 재조사 금지, §5 착수 지침) · 조사 문서 §1·§2·§4·§7 · `~/.claude/ACCESSIBILITY.md` · `ios/GildongmuKit/Package.swift`와 Kit 테스트의 fixture 로딩 방식(`#filePath`에서 5단계 위) · `ios/scripts/messages-to-xcstrings.mjs` 머리 주석(플레이스홀더 순서·ICU 복수 처리) · `src/lib/__tests__/format-drift.test.ts`(드리프트 가드 선례).
3. **M0 산출물**(체크포인트 커밋 하나로 묶지 말고 논리 단위로 여러 커밋, 마지막에 `main` ff):
   - 환경: `brew install --cask temurin@21 android-commandlinetools`, `sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0"`, 라이선스 동의. JDK 25는 건드리지 않는다. 프로젝트는 Gradle toolchain으로 21을 고정(기계 경로를 `gradle.properties`에 박지 않는다). 에뮬레이터·Android Studio 설치 금지(디스크·메모리).
   - 뼈대: `android/` 루트, 모듈 둘: `:app`(Compose, minSdk 31, targetSdk 36, 패키지 `space.dodoplanet.gildongmu`, 실험판 `.dev` 구성, 표시 이름 접미사) · `:kit`(순수 Kotlin/JVM, 안드로이드 의존 0, `GildongmuKit`의 미러). Kotlin 패키지 `space.dodoplanet.gildongmu.kit`. `:kit`은 `import android.*`가 0이어야 하고 그것을 소스 가드 테스트로 잠근다.
   - fixture 하네스: `:kit` 테스트가 저장소 루트를 찾아 `src/lib/__tests__/fixtures/*.json`을 읽는 공용 로더 하나. JSON은 `kotlinx.serialization`. 로더가 못 찾으면 조용히 통과하지 않고 실패한다(Kit `CoverageTests` "리소스를 못 읽어 링이 비면 즉시 실패" 정신).
   - FOUNDATION 이식(§2 목록): Swift가 정본이되 TS 판과 fixture로 교차 검증. Kit 테스트(`Tests/GildongmuKitTests/<이름>Tests.swift`)를 Kotlin 테스트로 함께 옮긴다(fixture 없는 것도 테스트는 있다).
   - 미러 등록부: `android/kit/mirrors/<그룹>.json`과 검사 테스트. **검사 술어**: Kit `Sources/GildongmuKit/**/*.swift` 전수가 등록부 셋 중 하나에 "이식됨(kotlin 경로 실재)" 또는 "제외(사유)"로 있어야 한다. iOS에 새 Kit 파일이 생기면 웹 테스트가 빨개진다(D6 장치 2). 등록부 형식·검사 위치는 spec에서 정한다(웹 vitest에 두면 `npm run test:run`이 매 커밋 잡는다).
   - `android/README.md`: 빌드·설치·테스트 명령, 이식 관용구(Swift `struct`→`data class`, `enum`→`enum class`/`sealed`, `Codable`→`@Serializable`, 옵셔널, 시각·거리 단위, 정규식 미러 때 문자 클래스 `[` 이스케이프 함정), fixture 로더 사용법, 등록부 갱신법. 로직 세션 둘이 이것만 읽고 따라 하게 쓴다.
   - 체크포인트 보고: `main` ff SHA, 환경 설치 결과, 게이트 명령과 결과, 로직 세션이 알아야 할 것.
4. **M1 산출물**(체크포인트 뒤): M1 범위 spec(`docs/superpowers/specs/2026-09-16-android-app-design.md`, 적대적 설계 리뷰 1회는 spec에 새 불변식·통합 계약이 있으므로 실시하고 판정 한 줄을 spec에 남긴다) → 계획 → 구현. 범위: 홈 옴니박스 검색(`/api/places` + 주소 병렬, 정확도순 플랫 리스트, 칩 필터 축, 최근 검색), i18n 변환 스크립트(`messages/*.json` → `res/values-*/strings.xml`, ko 등장 순서 positional, 결정론 byte-identical, `ios/i18n/arg-order.json`과 같은 순서 잠금), 서버 base URL `https://gildongmu.dodoplanet.space`(서버 계약 변경 0), 접근성 기본형(`mergeDescendants`로 한 줄 = 한 객체, 헤딩 semantics, 단일 polite 통지 창구, 포커스 이동 관용구, 44dp 타깃, TalkBack 터치와 키보드 탐색 둘 다), Compose 접근성 검사 레인(Accessibility Test Framework) 연결. 받아쓰기는 API 33 게이트(D9)이며 M1에서는 게이트 함수와 미노출만.
5. **완료 조건**: 한소네 7에 실험판 설치 후 검색이 점자로 읽힌다(위원장 판정은 코디네이터 경유). `uiautomator dump`로 접근성 트리 구조 확인 기록을 보고에 남긴다.
6. **금지**: `ios/**`·`src/**`(fixture 읽기, 드리프트 테스트 신설 제외)·`packages/**` 수정, `origin` push, `npm install`, 에뮬레이터 설치, 서버 라우트·응답 변경에 의존하는 설계, 하드 스톱 4종(비용·외부 발신·파괴·아키텍처 양자택일은 코디네이터에게).

### 5-2. `android-kit-core` (웨이브 1, opus[1m])

M0 체크포인트 뒤 코디네이터가 확정한다. 요지: `~/gildongmu-wt/android-kit-core`, §2 CORE 목록 전량을 `android/README.md` 관용구대로 이식, Kit 테스트 동반 이식, fixture 초록, `mirrors/core.json` 완비, `:kit:test` + `npm run test:run` 초록, 리뷰(spec-compliance = Swift·TS 원본 대조, code-quality) 통과 뒤 ff 통합. `PlaceProjection`의 `BeaconDest` 함수 한 개는 GUIDE 통합 뒤 rebase해서 붙인다.

### 5-3. `android-kit-guide` (웨이브 1, opus[1m])

같은 틀로 §2 GUIDE 목록. `GuideAudioSession`은 판정 함수만(D10). `TransitGuide`·`RouteGuide`는 1,000줄 넘는 리듀서라 fixture 시나리오(`transit-guide-scenarios.json`·`route-guide-scenarios.json` 등)가 초록이 되기 전엔 통합하지 않는다. 판정 계층 수정 전 `docs/INTEGRATIONS.md` §실시간 길 안내를 읽는다(CLAUDE.md 지시).

## §6. 코디네이터 메모

- 기기 페어링: 위원장이 한소네에서 개발자 옵션 → 무선 디버깅 → 페어링 코드를 열면 코디네이터 세션에서 `adb pair`·`adb connect`. USB는 점자 디스플레이로 유지.
- Play 개발자 계정: 위원장이 직접(비용). 개설되면 `android-m1`에 내부 테스트 트랙 업로드 절차(keystore는 `~/gildongmu-private/`, Play App Signing 켬)를 추가 지시.
- iOS 릴리스 절차 `ios-release-submit` 스킬에 "이 변경이 안드로이드에도 필요한가" 한 줄(D6 장치 3)은 자작 스킬 개정이라 코디네이터가 웨이브 종료 때 한다.
- `xcrun simctl`이 Xcode 라이선스 미동의를 냈다(2026-09-16 15:19). 안드로이드와 무관하지만 다음 iOS 빌드 전에 `sudo xcodebuild -license`가 필요하다.
