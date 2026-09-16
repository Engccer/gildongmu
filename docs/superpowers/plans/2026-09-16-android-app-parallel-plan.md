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

`Beacon` · `BeaconGate` · `BeaconTones` · `CarArrival` · `CarListener` · `CarRouteGuide` · `CourseDerivation` · `EndScreen` · `GuideAudioSession`(⚠ 2026-09-16 18:40 정정으로 **excluded** — 아래 제외 목록 참조) · `GuideBand` · `GuideCourse` · `GuideCourseAxis` · `GuideLiveRows` · `GuideMotion` · `GuideSessionCoordinator` · `GuideSpeechGate` · `GuideToneLayer` · `IdleReset` · `ListenSpeed` · `RerouteProposalGate` · `RouteGuide` · `RouteOrigin` · `SessionIdle` · `TransitDisplayProjection`(`TransitGuide` 타입 의존이라 여기) · `TransitGuide` · `TransitGuideText` · `TransitGuideTone` · `TransitIdle` · `TransitProgressOverview` · `TransitSurroundingsAnchor` · `TransitTrackService` · `WalkHealth`

**제외(이식하지 않음, 미러 등록부에 사유와 함께 등재)**: `AudioSignalProtocol`(E20 음향신호기 BLE 실험, 2026-09-01 연동 기종 없음으로 종결) · `Resources/Localizable.xcstrings`(Kit 카탈로그: 안드로이드는 `android/i18n` 변환 스크립트가 `messages/*.json`에서 직접 만든다). · `GuideAudioSession`(2026-09-16 18:40 정정 — GUIDE 세션 반박을 코디네이터가 승인: 파일 전체가 iOS AVAudioSession 모델의 리듀서라 D10에 따라 미이식. 억제·인터럽션·route 변경·didPromote 원복·잘림 방지 대기의 **목표**는 M4 입력 목록에 계약으로 남기고 안드로이드는 AudioFocus로 재설계한다. 같은 정신으로 `ListenSpeed`는 `normalizeSpeed`만 이식하고 iOS rate 표는 뺐다).

#### 정정 (2026-09-16 17:25 KST, 코디네이터 재현 — 기준 `41f377b5`)

**§2 그룹 경계의 대조가 타입 선언만 보고 함수 참조를 빠뜨렸다.** `android-kit-core`가 스크립트 전수 대조로 반박했고 코디네이터가 독립 재현했다(`grep`으로 호출부 확인).

- `DeferredAnnouncer`(CORE) → GUIDE `GuideSpeechGate`의 `speechDeferStep`·`SpeechDeferConstants`(`DeferredAnnouncer.swift:91·113`).
- `TransitExitLines`(CORE) 5함수 중 3개 → GUIDE `TransitGuide.swift:164` `transitValidExitNo`(5줄 순수 함수).
- `QuickExitTextTests`의 `buildTransitGuideRoute` 2건도 GUIDE 몫.

**처리**: GUIDE의 얕은 묶음 중간 통합에 `GuideSpeechGate`·`Beacon`·`transitValidExitNo`(TransitGuide.kt에 그 함수만 선이식)를 넣고, CORE는 그 SHA 위에서 rebase해 붙인다. GUIDE가 늦으면 CORE는 `core.json` `deferredTests(to: guide)`로 넘기고 끝낸다. 소유권 자체는 바꾸지 않는다.

**함께 내린 판정(Q2)**: `ChatService`(POST NDJSON 스트림)·`ChatSuggestionsService`(POST)는 FOUNDATION `HttpTransport`(GET 전용)에 맞지 않아, **순수 부분만 `:kit`**(줄 디코딩·파싱·요청 본문·상수)에 두고 POST·스트리밍 전송은 M6이 `:app`에서 맡는다(D5 경계, M0 `APIClient` 선례와 같은 갈래). 스트림 인터페이스 모양은 M6 맥락 없이 지금 정하지 않는다.

#### 웨이브 3 소유권 추가 (2026-09-16 21:3x, 기준 `a585bbc0`)

| 세션 | 모델 | 소유(쓰기) | additive 예외(보고 필수) |
|---|---|---|---|
| `android-m1`(계속) | fable | `place/`·`nearby/`·`search/`·`nav/`·`a11y/`·`i18n/`·`net/`·`storage/`·`location/`·`speech/`·매니페스트·gradle·android-extra·README. M2b → 프리필 배선 → M2c(수동 위치) → 설정 화면 | — |
| `android-m4` | fable | `guide/`·`audio/`·`res/raw/` 톤·`directions/` 안내 시작 버튼 자리·spec M4 | `AppRoot.kt` 등록·띠바 한 자리, 매니페스트(서비스·FOREGROUND_SERVICE·…LOCATION·POST_NOTIFICATIONS·VIBRATE), `app/build.gradle.kts` 의존성, android-extra 키 |
| `android-m6` | opus | `chat/`·`res/raw/chat_*`·spec M6 | `AppRoot.kt` 채팅 등록 한 줄, android-extra 키, `app/build.gradle.kts`(마크다운 라이브러리 금지) |

`directions/`는 M3 종료로 소유자가 없어졌다: 안내 시작 버튼 자리는 M4, 끝점 검색 화면 재사용(M2c 수동 위치)은 android-m1이 **호출만**. 그 밖의 `directions/` 변경은 코디네이터 판정. M5(자동차·대중교통 안내)·설정 화면·M2c는 미배정.

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

같은 틀로 §2 GUIDE 목록. `GuideAudioSession`은 excluded(D10, §2 정정). `TransitGuide`·`RouteGuide`는 1,000줄 넘는 리듀서라 fixture 시나리오(`transit-guide-scenarios.json`·`route-guide-scenarios.json` 등)가 초록이 되기 전엔 통합하지 않는다. 판정 계층 수정 전 `docs/INTEGRATIONS.md` §실시간 길 안내를 읽는다(CLAUDE.md 지시).

## §5-4. 통합 기록

| 세션 | 통합 SHA | 시각 | 비고 |
|---|---|---|---|
| `android-m1` M0 | `41f377b5` | 2026-09-16 16:3x | 환경·뼈대·FOUNDATION 28파일·등록부·README. 리뷰 BLOCKER 1(API 33 전용 호출)·MAJOR 반영 |
| `android-kit-guide` 선행 | `41cd341c` | 17:4x | Beacon·GuideSpeechGate·transitValidExitNo + 판정 9파일(11/32) |
| `android-kit-guide` 완료 | `73bea1c0` | 20:1x | 31 ported + 1 excluded, :kit 테스트 764, 리뷰 4건 반영. CORE 유예 2건 흡수. 리뷰 뒤 커밋 2개(09f56020·73bea1c0)는 코디네이터가 별도 재리뷰 디스패치(`~/gildongmu-wt/android-m1-reports/guide-post-review.md`). M4·M5 입력(D10 [3] 잔여·GuideAudioSession 목표 계약 5항·시나리오 18개·ListenSpeed Android 배율 실측)은 `~/gildongmu-wt/android-kit-guide-reports/report.md`가 정본이라 **wave 3 착수 전에 spec으로 옮긴다**. 참고: `RouteGuide`의 `maxOf`/`minOf`는 NaN에서 Swift와 다르다(웹과 같다) — :app fix 경계에서 유한값 가드 판단 재료 |
| (재리뷰) GUIDE 사후 커밋 | — | 21:2x | 코디네이터 디스패치 읽기 전용 리뷰(`77aa36e2..73bea1c0`): **BLOCKER 0**. 09f56020의 진단이 한 칸 어긋남 — Apple ICU `\s`는 `\p{White_Space}`라 새 클래스가 U+000B·U+0085 두 문자 좁다(MINOR). Foundation `CharacterSet.whitespaces`는 U+200B 포함(MINOR). **diff 밖 MAJOR**: 다른 그룹 12파일이 Swift `.whitespaces`를 Kotlin `trim()`으로 옮겨 같은 갈림. 후속은 세션 `android-kit-fix`(opus, base `eb7bf0f8`)가 맡는다 — README §3 `\p{…}` 규칙과 `RegexPortabilityTest`만 소유 예외 |
| `android-m1` M2 조각 1 `location/` | `7a4a9379` | 20:0x | GMS 무의존 `LocationStore`(FUSED_PROVIDER + GPS 폴백), M2 spec `c411c8c7`·계획 포함. M3가 이 시그니처를 직접 소비 |
| `android-kit-fix` 완료 | `157989f3` | 20:2x | 공백 상수 = `\\p{White_Space}`, 12파일+α trim 재판정(Swift 집합 미러, Kotlin 기본 trim·isBlank 금지 소스 가드), U+200B, README §3 `\\p{…}` 규칙, API 33 `URLDecoder` 제거, `ChatService.splitStreamLines`(CRLF·LF·CR). 리뷰 BLOCKER 0. ⚠ 18:36~20:00 정지는 fable 사용 한도(세션 셋 동시) |
| `android-m1` 설정·배선·스토어 준비 | `f215b164` → `b5263ce5` | 09-17 03:xx~ | 설정 화면(§14)·openChat 배선·억제 훅·체중 키·README §1·KDoc·PlaceholderScreen 삭제·결과 진동 게이트(㉗) · `docs/playstore/{listing,data-safety,internal-track}.md` + `android/scripts/play-upload.mjs` 골격. 데이터 안전성 판정: 서비스 제공자≠공유 / 값은 ASC 라벨과 일치(Vercel 요청 로그 사실 명시) / **전경 서비스 선언은 실험판 소스셋 매뉴페스트로 이동**(정식 APK 검사 스크립트) |
| `android-m4` M4 완료 | `6a20cdc5` | 09-17 03:0x | 도보 실시간 안내: 세션 싱글턴·전경 서비스(location)+지속 알림(안내 종료 액션)·안내 위치 스트림·SoundPool+AudioFocus(usage MEDIA, 톤 SONIFICATION·TTS SPEECH)·TTS(speechDeferStep, 배율 1.0=호출 없음)·진동 3종·시트·띠바·종료 화면·계측 로그·실험판 게이트. 리뷰 4회 반영. 매니페스트 additive(서비스·FOREGROUND_SERVICE(_LOCATION)·POST_NOTIFICATIONS·VIBRATE·WAKE_LOCK·ACTIVITY_RECOGNITION), `AppSourceGuardTest` 허용 1줄(소유권 예외). **실보행 대본 25항·회수 명령은 `~/gildongmu-wt/android-m4-reports/report.md`**. 세션 종료·창 닫음(실기기 판정은 별도 세션) |
| `android-m6` M6 완료 | `87fc6f31` → `45c8c4ab` | 09-17 00:xx | 채팅 탭·장소 채팅·동의 게이트·NDJSON 전송기·질문 헤딩/산문 블록/장소 언급/카드·출처·공유·칩·입력 바(IME 인셋)·온디바이스 받아쓰기(`speech/DictationSession.kt`, API 33 게이트)·`openChat(place?)`. 리뷰 전부 반영. **위원장 판정: 실패 시 실패 답변 블록 착지(헌장 §6 편차 채택, 참조 문서 갱신은 실기기 뒤)**. 실기기 16항목 report §⑤ |
| `android-m1` M2c 완료 | `cdcdf23b` → `ba43fb0b` | 09-17 0x:xx | 현재 위치 수동 지정(`EffectiveLocation` 단일 진입점·StatusLine 병합·EndpointPicker 추출·표시줄 버튼)·설정 §14 설계 확정. BLOCKER 4 해소(StatusLine seq 충돌 → 발화 단위 세대). ⚠ M6 chat/ 파일 additive 편집(자진 신고, M6 spec §4-1 자리). 실기기 §13-6 23~26 |
| `android-m1` 프리필 배선 + M2b 완료 | `448c4d79` → `fc246219` | 22:0x | 프리필 버튼 2개(`PlaceNav.onOpenDirections`) · M2b(내 주변 6 kind·주변 상황 자동 펼침·장소 상세 도메인 섹션·역 자동 섹션 5종·무장애·현재 위치 표시줄) · `a11y/Landing.kt` `landingTarget`(터치 모드 버튼 착지 결함 처방, 24곳 전수 + 소스 가드) · KDoc 정정. 리뷰 전부 반영. 실기기 항목 +6(§12-5 17~22) + landingTarget TalkBack 터치 실측. 세션은 M2c로 |
| `android-m3` M3 완료 | `30a26bbb` | 21:2x | 길찾기 브리핑(`directions/` 11파일, 끝점 검색·현재 위치·3수단·프리필 1회 소비 스토어 + `openDirections`), app 테스트 124. 리뷰 31건 반영·기각 0. 실기기 판정 13항목은 `~/gildongmu-wt/android-m3-reports/report.md`. 세션 종료·창 닫음. 프리필 버튼 배선은 android-m1(`PlaceDetailScreen.kt` [M3] 자리, `PlaceNav.onOpenDirections`) |
| `android-m1` M2 완료 | `0e8c1204` | 21:0x | 장소 상세·검색 보강·내 주변 허브(둘러보기·지하철·버스·따릉이)·ios-extra 268키·`AppScreenScaffold`(화면 Scaffold 직접 호출 소스 가드). 리뷰 BLOCKER 1(착지 FocusRequester가 focusable 뒤에 붙어 무효 — `mergedRow(tag, spoken, focus)` 봉인) 반영. 실기기 판정 16항목은 report ⑤. 남은 것: M3 프리필 배선(M3 뒤)·M2b·실기기. 세션은 M2b로 이어감 |
| `android-m1` 앱 골격 | `eb7bf0f8` | 20:5x | 하단 탭 4개(iOS `AppTab.order` 미러·실험판 순서 게이트)·단일 NavHost(Nav2 채택, Nav3 기각 근거는 M2 spec §10)·자리표시 3화면. **웨이브 2 소유권**: 화면 패키지 하나씩(`search/`·`place/`·`nearby/`·`directions/`·`chat/`), `nav/`·`a11y/`·`i18n/`·`net/`·`storage/`·매니페스트·gradle·android-extra는 `android-m1`, 다른 세션은 등록 한 줄·android-extra 키 additive만(정본 `android/README.md` §1). M3 세션 `android-m3`(fable) 이 SHA에서 착수 |
| `android-m1` M1 | `65ef75f4` | 19:4x | 검색 화면 구현·정규식 가드·JsonSupport 계약·ATF 검사 레인. 리뷰 2건 반영, 기각 1(`failed` 필드 제거 — 3-state 유지). 실기기 판정 9항목은 spec §8 대기(기기 미연결). 실험판 APK `android/app/build/outputs/apk/experimental/app-experimental.apk`. 세션은 M2 spec으로 이어감 |
| `android-kit-core` 완료 | `b312ff01` | 19:0x | 29/29, :kit 테스트 573, 리뷰 4건 반영. 인계: QuickExitGuideRouteTests 2건 → GUIDE. 미이식 2(urlErrorCancelled 플랫폼 대응 없음·수동 위치 소스 가드는 안드로이드 안내 모델이 달 것), 미검증 1(Deeplink 쿼리 `=`·`+` 인코딩이 Foundation과 같은지 — Xcode 라이선스 미동의라 이 머신에서 Swift 실행 불가, iOS 세션에서 확인). :app 계약은 `core.json` note가 정본 |

## §5-5. 웨이브 종료 때 분배할 판정 (코디네이터 보관, 아직 BACKLOG 미등재)

- **iOS 역이식 후보 3건**(android-m1 M2 spec 리뷰 부산물, 2026-09-16 21:4x, 급하지 않음 — 위원장 판정 뒤 `PORTS.md`/BACKLOG로): ① 위치 실패 문구를 서버 실패와 가른다(iOS는 둘 다 "정보를 가져오지 못했습니다") ② 경유 정류소 통지 "경유 정류소 N곳"(iOS는 "주변 정류소" 재사용) ③ 딥링크 빌더가 null이면 버튼을 숨긴다(iOS는 무반응 버튼).
- **M2b로 미룬 것**(android-m1 판정): 내 주변 나머지 6섹션·주변 상황·역 자동 섹션·무장애·표시줄/수동 위치·진동.
- **M4·M5 입력**: `~/gildongmu-wt/android-kit-guide-reports/report.md`의 D10 [3] 잔여·GuideAudioSession 목표 계약 5항·시나리오 18개·ListenSpeed Android 배율 실측 → wave 3 spec 입력으로 옮긴다(보고 파일은 worktree 밖이라 남아 있다).
- **서버 결함(kit-fix 발견, iOS 현존)**: `src/app/api/chat/route.ts` NDJSON이 `JSON.stringify` 결과의 U+2028·U+2029·U+0085를 날 문자로 내보내, Swift `bytes.lines`(와 Kotlin 미러)가 이벤트 줄을 그 자리에서 쪼개 **채팅 답변 전체를 잃는다**(웹은 무사). 처방은 서버에서 세 문자를 `\uXXXX` 이스케이프로 치환(구버전 호환). push 동결 해제 뒤 배포 → BACKLOG A44로 등재(코디네이터).
- **M6 착수 입력**: `splitStreamLines`는 꼬리를 매번 재스캔하므로 읽기 버퍼 8KB 이상. `ChatMarkdown`의 CRLF 분리가 Swift와 다름(후속 후보).
- **동결 해제 뒤 iOS**: Foundation `CharacterSet` 실측 집합(U+200B 포함)이 Kotlin 하드코딩으로만 잠겨 있다 — iOS Kit 테스트에 같은 단언 검토. 기기 ICU 정규식은 M1 계측 때 실측.
- **M3 발 판정(승인)**: ① M2 spec §4 "권한 요청은 내 주변 진입에서만" → "내 주변 진입 + 길찾기 조회"로 문구 정정(android-m1) ② 앱 설정 열기 인텐트는 M2 통합 뒤 `location/` 함수 하나로 통일(android-m1) ③ 최근 장소 라벨은 원문(iOS 동형) ④ TopAppBar 통일 커밋이 directions도 함께(android-m1).
- **M2b 판정(코디네이터 승인 21:1x)**: ㉒ 수동 위치 지정은 M3 끝점 검색 화면 재사용이라 M3 통합 뒤 **M2c** ㉓ 결과 진동은 **설정 화면 마일스톤**(언어·진동·받아쓰기 홀드 등 iOS 설정 미러, 아직 미배정)에서 함께.
- **iOS 역이식 후보 ④**(android-m3): `DirectionsModel.syncCurrentAddress`(`DirectionsTabView.swift:324-329`)에 latest-wins가 없어 세 경로가 겹치면 옛 주소가 덮는다(안드로이드는 `addressSeq`로 닫음).
- **iOS 역이식 후보 ⑤**(android-m1 M2b 판정 29, 코디네이터 승인 21:5x): 허브 "현재 위치" 줄은 권한 없음 → "위치 권한이 필요합니다", 대략 위치만 → "정확한 위치가 꺼져 있습니다", 실제 취득 실패만 → "위치를 확인할 수 없습니다"(3-state). iOS는 셋을 "위치를 확인할 수 없습니다"로 뭉갠다.
- **출시 전 게이트(BACKLOG 등재, M6 리뷰 부산물)**: 웹 `privacy.dictation` 문구가 "iOS 앱의 받아쓰기는 기기 안에서 처리"로 플랫폼을 한정한다 — 안드로이드도 온디바이스라 수집 유형은 같지만 공개 문구에 없다. 동결 해제 뒤 6로케일 문구 수정(4자 일치: 웹 privacy·iOS PrivacyInfo·ASC 라벨·Play 데이터 안전성).
- **Compose 1.12.1 착지 결함(android-m1 처방 중)**: 터치 입력 모드에서 `clickable`(Button)은 포커스를 못 받아 버튼 착지 `requestFocus()`가 false — 한소네 키보드 모드에선 초록이라 실측이 놓친다. 처방 `focusProperties { canFocus = true }` 공용 관용구 + 소스 가드. TalkBack 폰 실측 항목(O1 일반 폰 필요성의 실례).
- **3자 동조 판정 후보(BACKLOG, android-m1 M2b)**: 직전 좌표가 있으면 이번 측위가 실패해도 표시줄이 옛 주소를 "현재 위치"로 말한다(집에서 잡은 주소가 지하에서도 남는 경로). iOS·웹도 같은 동작 — 셋을 함께 판정. 역 시설 행 "약 120m"는 iOS 동형(낭독 풀어쓰기 없음) — 실기기 판정과 함께.
- **프로덕션 결함(BACKLOG, android-m6 실호출 + 코디네이터 Vercel 로그 확인 22:2x)**: `/api/chat/suggestions`가 빈 목록 200을 반복 — 로그는 Gemini 생성이 `AbortSignal.timeout(6000)`에 걸린 AbortError 다수 + 503 `UNAVAILABLE`("high demand") 1건(13:25~13:26Z, dpl_2khJpdj…). 원인은 서버 코드가 아니라 모델 지연·가용성이지만 서버 6초 = 클라이언트 6초(iOS·kit `timeoutMs`)라 여유 0. 동결 해제 뒤 판정: 서버 예산 상향 또는 모델·thinking 설정 재판정(`eval:ab`), 클라이언트 예산은 서버보다 길게. 웹·iOS·안드로이드 공통 영향(follow-up 칩 0).
- **iOS 역이식 후보 ⑥**(android-m1 M2c 판정 37): 수동 위치 지정 순간에 GPS 권한 팝업을 띄우지 않는다(권한 있을 때만 지정 시점 실측, 없으면 팝업 없이 "위치 확인 불가"). iOS·웹은 그 자리에서 권한을 묻는다.
- **BACKLOG(android-m1 판정 43)**: 안드로이드 설정의 "업데이트 이력"은 안드로이드 출시 노트 정본이 생길 때(첫 Play 제출) 만든다 — `release-notes.md`는 iOS 스코프.
- **M4 실기기 위원장 판정 예정**: #3 백그라운드 음성(앱 전경 ∨ 화면 꺼짐이면 발화, 타 앱 전경만 억제 — iOS와 다름) · #15 통화 중 소리·문장 억제 + 진동은 냄.
- **M4 → m1 인계**: 억제 훅 배선(`speech/DictationSession` → `GuideSession.setOutputSuppressed`), 체중 저장소 키 공유(`walkWeightKg`, `SharedPreferencesStore(context)` 기본 이름 — 설정 화면이 같은 키를 쓴다), README §1, `RouteGeometry.kt` KDoc.
- **M5 착수 조건(코디네이터 판정)**: M4의 [3] 계층(전경 서비스·오디오 포커스·TTS)이 한소네 7에서 최소 스모크(설치·안내 시작·톤·발화·알림 종료)를 통과한 뒤. 그 전에 M5를 쌓으면 [3] 결함이 두 수단에 복제된다.
- **웹 flake 관찰(android-m4 4차 게이트)**: `src/components/__tests__/TransitGuidePanel.test.tsx` "관측이 끝나면 …(래치)"가 2스레드 병렬에서 2회 실패 뒤 통과, 단독 통과 — `src/` 변경 0. 재발하면 BACKLOG.
- **정정(09-17, 코디네이터 권고 기각 — android-m1 실측)**: 안내 ATF를 `src/androidTestExperimental/`로 옮기라는 권고는 틀렸다 — `testBuildType` 미지정이라 계측 변형은 debug뿐이고 그 소스셋은 어떤 태스크로도 돌지 않아 테스트가 조용히 사라진다. 현 구조(테스트가 게이트를 켜고 상태만 주입, 서비스 미기동)가 일관되며, 서비스를 실제로 띄우는 ATF가 생기면 `testBuildType = "experimental"` 전환을 코디네이터가 판정한다(README §7).
- **가드 점검(android-m1)**: 리터럴 스캔 정규식이 `$`가 든 리터럴에서 따옴표 짝이 어긋나 뒤 키를 삼키는 함정 — M1·M2 소스 가드에 같은 꼴이 있는지 확인.
- **iOS 세션 확인 항목**: Deeplink 쿼리 `=`·`+` 인코딩이 Foundation과 같은지(CORE 미검증, Xcode 라이선스 동의 뒤).

## §5-6. 토큰 감사 (2026-09-17 04:xx, 전사 `~/.claude/projects` usage 합산, 09-16 14:00 이후)

| 세션 | 모델 | 메인 턴 | 캐시 읽기 | 턴당 컨텍스트 중앙값 |
|---|---|---|---|---|
| `android-m1`(M0~설정·스토어 준비, 14시간) | fable | 1,708 | 996M | 611K(최대 960K) |
| `android-m4` | fable | 550 | 320M | 636K |
| 코디네이터(이 세션) | fable | 494 | 198M | 약 400K |
| `android-kit-guide` | opus | 536 | 255M | 395K |
| `android-m6` | opus | 438 | 237M | 586K |
| `android-kit-core` | opus | 345 | 180M | — |
| `android-m3` | fable | 243 | 129M | — |
| `android-kit-fix` | opus | 252 | 68M | — |
| 서브에이전트 합계 | opus 3,010턴·0.9B / fable 390턴·76M / sonnet 166턴·21M | | | |

**fable 합계 3,379턴·캐시 읽기 1.72B·출력 10.3M. 원인 순위**: ① 한 세션을 7마일스톤 이어 쓴 것(m1 58%) ② 세션들이 600~950K 컨텍스트에서 수백 턴(자동 압축 미발동) ③ 코디네이터 자동 깨움 58건(idle notice 13·세션 메시지 39·sleep 확인 6) ④ `model: opus` 지시 전 fable 서브에이전트 363턴 ⑤ 설계 리뷰 최대 5회전. 교훈은 `parallel-sessions` 스킬 2.4.0에 반영(마일스톤당 새 세션·opus 명시는 착수 프롬프트에·idle 구독 1회·리뷰 2회 상한).

## §6. 코디네이터 메모

- 기기 페어링: 위원장이 한소네에서 개발자 옵션 → 무선 디버깅 → 페어링 코드를 열면 코디네이터 세션에서 `adb pair`·`adb connect`. USB는 점자 디스플레이로 유지.
- Play 개발자 계정: 위원장이 직접(비용). 개설되면 `android-m1`에 내부 테스트 트랙 업로드 절차(keystore는 `~/gildongmu-private/`, Play App Signing 켬)를 추가 지시.
- iOS 릴리스 절차 `ios-release-submit` 스킬에 "이 변경이 안드로이드에도 필요한가" 한 줄(D6 장치 3)은 자작 스킬 개정이라 코디네이터가 웨이브 종료 때 한다.
- `xcrun simctl`이 Xcode 라이선스 미동의를 냈다(2026-09-16 15:19). 안드로이드와 무관하지만 다음 iOS 빌드 전에 `sudo xcodebuild -license`가 필요하다.
