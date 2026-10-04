# 병렬 계획: 안드로이드 정식판 동기화 (2026-09-27)

코디네이터 세션 `gildongmu-d9`. 기준 SHA `1d95484c`(main, 2026-09-27).

**종료 상태(2026-09-27 07:4x KST)**: 웨이브 1·2 전부 로컬 `main` ff 통합(`8fc9f721` n4 → `71977c53` e50 → `be31a3f8` chat → `54edf15b` m4b), origin push 없음(동결 해제 뒤 push). 웨이브 3 `android-doc-audit` 통합 `51e5f603`(문서 11개 정정, CLAUDE.md 여유 1.7KB — 다음 웨이브 전 다이어트 권고). 남은 worktree 0·`feat/*` 0. 남은 사용자 판정은 BACKLOG E43(한소네 7 실기기 목록·듣기 속도 뜻·체중 착지 대상). **push 동결 중**(2026-09-29 08:00 KST까지, CLAUDE.md "gildongmu push 동결") — 통합은 로컬 `main` fast-forward이고 `origin` push는 없다. 위원장 지시: "안드로이드 앱을 iOS 정식판 최신 빌드에 맞게 동기화. 배포된 1.18은 무시하고 최신 개발 상태로. 병렬 세션으로 구현하고 판정은 코디네이터 세션에서."

## §1. 마일스톤과 확정 판정

### 위원장이 확정한 것 (2026-09-27)

1. **동기화 기준은 iOS Release 빌드 구성이다.** iOS `#if DEBUG || EXPERIMENTAL`·`AppConfig.experimental*` 뒤에 봉인된 것은 범위 밖: 나들이(E51, Kit `Outing*.swift` 6개·`BeaconTone.stroll`·`WalkInfraService.nearbyWithCoordinates`·`WalkInfraModels` 좌표 필드), 자동차·대중교통 실시간 안내(M5: E35 `TransitRidingPosition`·E48 `TransitBusStop`·A46·A47·`LocationService` keep-alive), 설정의 좌우 안내음·진동 알림 확장·자동차 듣는 사람. 등록부 `pending` 8건은 그대로 둔다.
2. **M4b(안내 중 변경: 목적지 바꾸기·경유지 추가/변경/삭제·대안 줄 프리뷰/채택·장소 상세 중첩·주변 확인)를 이번 동기화에 넣는다.** BACKLOG E43의 "M5 뒤"에서 앞당긴다.
3. **채팅 산문 CRLF 줄 경계는 웹·안드로이드 쪽(CommonMark: CRLF에서 줄을 가른다)에 맞춘다.** iOS Kit `ChatMarkdown.swift`와 공유 fixture `chat-markdown-line-break-cases.json`의 기대값을 고치고 `:kit`이 그 fixture를 읽는다.

### 코디네이터 설계 판정 (제품 판단 아님)

- 설정 "업데이트 이력" 행은 안드로이드 출시 노트 정본이 아직 없어 이번에도 뺀다(판정 43 그대로). 테마 행·AI 채팅 동의 토글·듣기 속도 행은 넣는다(iOS 정식판 설정과 등가).
- 언어 변경 뒤 이미 로드된 payload의 옛 dataLocale(안드로이드 ㉖)은 범위 밖 유지.
- 갭 측정 방법: (a) 등록부 `ported` 항목마다 Swift 파일의 마지막 커밋 시각이 Kotlin보다 뒤인 것(8건 → Release 관련 4건: `RouteModels`·`RouteService`·`RecentSearchStore`·`TransitBriefingStations` 주석) (b) BACKLOG E43 "등가성 후속" 항목 전수 (c) iOS 도보 안내 5파일 대 안드로이드 `guide/` 기능 대조(탐색 에이전트, 2026-09-27) (d) iOS `SettingsView` 대 `settingsRows`.

### 마일스톤

| 세션 | 범위 | 참조 spec·iOS 정본 | 모델·노력 | 웨이브 |
|---|---|---|---|---|
| `android-e50` | 길찾기 탭 동조 5건: ①E50 수단 재조회 버튼(`:kit` `TransitModeAxis`·`TransitRouteResult.requeryAxes`/`knownRequeryAxes`·`RouteService.transitModeRequery` + 앱 3-state·세대 결박·취소·포커스 착지·실패 `.high` 통지+실패 진동) ②수동·옛 위치 출발의 안내 시작 고지 `manualLocation.guideStartsFromCurrent`(iOS `announceGuideStartIfManualOrigin`) ③`RecentEndpoint.labelRoman`(Kit `RecentSearchStore.swift`, 앱 `recordRecent`·`recentSide` 두 곳) ④길찾기 탭 선두 "안내 종료" 이중 방어 버튼(iOS `DirectionsTabView` 추적 중 `beacon.stop`) ⑤도보 안내 첫 사용 공지 시트(iOS `WalkGuideNoticeSheet`, 키 `ios.directions.walkNotice.head/body`는 안드로이드 strings에 없어 `android/i18n/android-extra/*.json` 6로케일에 xcstrings 문안 그대로 추가) ⑥`TransitBriefingStations.kt` 주석 동조(2026-09-23 Swift 주석) | `docs/superpowers/specs/2026-09-24-transit-alternatives-reasoned-design.md` §3.2·§4.2·§4.3·§5, `2026-09-23-stale-origin-disclosure-design.md`, iOS `DirectionsTabView.swift`(`requery`·`requeryRows`·`landRequeryFocus`·`cancelRequeries`) | opus · medium | 1 |
| `android-n4` | 도보 안내 wave 1: ①N4 경유지 진행 4항(접근 예고 통지 `directions.viaRemaining` · 도착 문장 `directions.viaArrivedContinue` + ko 방향 조사 `KoreanParticle` · 남은 거리 행 다음 목표 기준 `guideNextTarget`/`directions.viaDestRemaining` · 경유지 지난 세션 `waypointPassedInSession`)과 프로파일 복원(`GuideTuning.walk` 원본, `waypointApproachM = null` 제거) · 경유지 도착 시 대안 프리뷰 초기화 자리는 m4b가 채우므로 주석만 ②E31 체중 입력 권유(종료 화면 권유 두 줄+버튼 → 설정 체중 필드로, 무시 2회 카운터 `WalkHealth.shouldShowWeightPrompt`/`nextWeightPromptDismissals`, 복귀 뒤 재계산) | `2026-09-24-waypoint-progress-design.md` §2·§3·§4.1·§6, `2026-09-11-weight-notice-dismissal-design.md`, iOS `BeaconModel.swift`(`updateRemaining`·`etaMinutes`·`consume` `.waypointApproaching`/`.waypointReached`)·`BeaconTrackingSheet.swift`(`showsWeightPrompt`) | opus · medium | 1 |
| `android-chat` | ①채팅 답변 듣기 버튼(iOS `TtsPlayer.playMessage` 동형: 기기 `TextToSpeech` 우선, 로케일 보이스 없으면 `POST /api/tts` MP3 폴백, 라벨 토글 `android.chat.listen`/`listenStop`, 배속은 `:kit` `ListenSpeed`, 실패 통지 `chat.listenFailed`, 안내 세션 오디오 포커스와 충돌 없이) ②설정 행 3종: 듣기 속도(1·1.5·2배)·테마(시스템/라이트/다크, `MainActivity` 적용)·AI 채팅 동의 토글(`ChatConsentStore` 철회 경로 신설, 끄면 다음 전송 전 동의 화면 재노출) ③B12: `:kit` `MarkdownPlainTextTest.kt`를 공유 fixture `markdown-plain-text-cases.json` 소비로 전환 + `chat-markdown-line-break-cases.json`을 `:kit` 테스트로 소비 ④CRLF 정렬: fixture 기대값을 CommonMark 쪽(CRLF = 줄 경계, CR 단독·VT·FF·NEL은 경계 아님 유지)으로 고치고 iOS Kit `ChatMarkdown.swift` `split`을 CRLF도 가르게 수정, Kit `ChatMarkdownLineBreakTests` 초록 | `2026-09-24-web-chat-copy-listen-design.md` §5, iOS `TtsPlayer.swift`·`SettingsView.swift`·`GildongmuApp.swift`(`themePreference`), `:kit` `ListenSpeed.kt` | opus · medium | 1 |
| `android-m4b` | 도보 안내 wave 2(위원장 판정 2): ①세션 중 목적지 바꾸기(제목 메뉴 + 끝점 검색 시트 `EndpointPicker` 재사용 + 길찾기 폼 동기화) ②경유지 추가·변경·삭제(시트 버튼 + 검색 시트 + 재조회, N4 행·문장은 n4 결과 위에) ③두 줄 사이 대안 프리뷰·채택(`alternateLine`·`commitLineSwitch`·조망의 "다른 경로 보기", 시작 요청에 `alternate` 전달) ④안내 시트에서 장소 상세 중첩(길찾기 진입 숨김) ⑤주변 확인(추적 중·도착 화면, `SceneSection` 재사용) | iOS `BeaconModel.swift`(`changeDestination`·`setWaypoint`·`removeWaypoint`·`requestVariantSwitch`·`alternativePreviewState`)·`BeaconTrackingSheet.swift`·`GuideTitleMenu.swift`·`GuideOverviewSheet.swift`(`WalkAlternativePreviewSheet`)·`GuideFormSyncStore`, spec `2026-08-12-guide-destination-menu-design.md`·`2026-09-23-walk-two-lines-kakao-design.md` §4 | opus · high | 2 (e50·n4 통합 뒤) |

### §1-1. 모델·노력 배정

전부 `--model opus`. `android-m4b`만 `--effort high`(Compose 화면 구조를 새로 고른다), 나머지는 `medium`(iOS 정본과 spec이 확정돼 기계적 이식). 세션 안 서브에이전트는 `model: opus`, 적대적 설계 리뷰·보안/데이터 무결성 최종 검토만 `model: fable`(이번 웨이브에 해당 사안 없음 — m4b가 시트 구조 갈림길을 만나면 1회).

## §2. 파일 소유권 지도 (기준 `1d95484c`)

역방향 술어("그 세션의 진입점이 그 파일을 호출·수정하는가")로 쟀다. 경로는 `android/app/src/main/kotlin/space/dodoplanet/gildongmu/` = `A/`, `android/kit/src/main/kotlin/space/dodoplanet/gildongmu/kit/` = `K/`.

| 세션 | 소유(수정) | 읽기만 |
|---|---|---|
| `android-e50` | `K/models/RouteModels.kt` · `K/RouteService.kt` · `K/RecentSearchStore.kt` · `K/TransitBriefingStations.kt`(주석) · 그 `:kit` 테스트 4개 · `android/kit/mirrors/core.json`·`foundation.json`(해당 항목 `note`만) · `A/directions/**` · `A/guide/ui/WalkGuideNoticeSheet.kt`(**새 파일**) · `app/src/test/.../directions/**` · `android/i18n/android-extra/*.json`(walkNotice 두 키만) · `android/i18n/arg-order.json`(재생성) | `A/guide/**`(WalkStartRequest·GuideSession.startWalk 호출), `A/location/**`(EffectiveLocation·StaleOrigin 표식) |
| `android-n4` | `A/guide/**`(WalkGuideModel·GuideText·GuideStrings·WalkGuideUiState·ui/GuideSheet.kt 등, **`ui/WalkGuideNoticeSheet.kt` 제외**) · `app/src/test/.../guide/**` | `K/RouteGuide.kt`(`guideNextTarget`·`WaypointApproaching` 이미 미러됨, 고치지 않는다), `K/WalkHealth.kt`, `K/KoreanParticle.kt`, `A/settings/SettingsStore.kt`(체중 필드 — 열기만, 수정은 chat 세션 소유라 필요하면 보고) |
| `android-chat` | `A/chat/**` · `A/settings/**` · `A/MainActivity.kt`(테마 적용) · `A/audio/ChatTtsPlayer.kt`(**새 파일**) · `app/src/test/.../{chat,settings}/**` · `:kit` `MarkdownPlainTextTest.kt`·`ChatMarkdownTest.kt`(신설 가능) · `K/ChatMarkdown.kt`(필요 시) · **iOS** `ios/GildongmuKit/Sources/GildongmuKit/ChatMarkdown.swift` · `ios/GildongmuKit/Tests/GildongmuKitTests/ChatMarkdownLineBreakTests.swift` · `src/lib/__tests__/fixtures/chat-markdown-line-break-cases.json` | `A/audio/TtsGuideSpeaker.kt`·`GuideAudioFocus.kt`(재사용 가능하면 재사용, 수정이 필요하면 자진 신고), `K/ListenSpeed.kt`, `ios/Gildongmu/Chat/TtsPlayer.swift` |
| `android-m4b` (웨이브 2) | `A/guide/**` · `A/directions/DirectionsViewModel.kt`·`DirectionsScreen.kt`(폼 동기화 자리만) · `A/place/PlaceRoutes.kt`·`PlaceDetailScreen.kt`(길찾기 진입 숨김 플래그) · `A/nearby/SceneSection.kt`(임베드 인자 추가 수준) · 관련 테스트 | `A/directions/EndpointPicker.kt`·`EndpointSearchContent.kt`(재사용) |

#### 정정 (2026-09-27 06:3x KST, 코디네이터 판정 — 기준 `04d4efb8`)

- `A/guide/ui/WalkGuideStartButton.kt`는 이번 웨이브에서 **`android-e50` 소유**로 옮긴다(안내 시작 고지의 트리거가 그 버튼의 `onClick`이라 "호출하는가" 술어로 e50 것이 맞다. n4의 범위(N4·E31)는 이 파일을 부르지 않는다). e50은 `WalkGuideStartButton`·`walkGuideStartSlot`에 기본값 없는 `onStart: () -> Unit` 인자를 더해 `startWalk` 직전에 부른다(안 A). `WalkStartRequest`는 여전히 손대지 않는다. n4는 이 파일을 읽기만 한다.

- E31 체중 권유의 [체중 입력하기] 착지(n4 경계 질의): 웨이브 1에서는 **n4가 기존 `SettingsRoute`(제목 착지)로 push**하고 `nav/AppRoot.kt`의 `GuideBottomBar` 호출에 `onOpenSettings` 람다 1줄을 더한다(자진 신고). **chat은 `SettingsRoute`에 선택 인자 `focusRow: SettingsRow? = null`을 열고 `Weight`면 체중 필드로 착지**(`landingTarget`)시킨다. 두 세션이 같은 웨이브라 컴파일 결합을 피하려고 호출 전환은 **웨이브 2 `android-m4b`가 인계**받아 한 줄로 바꾼다(guide/** 소유). 착지 없이 통합되는 구간은 BACKLOG E43 한 줄로 남긴다.

- `nav/AppRoot.kt`는 웨이브 1에서 n4(`GuideBottomBar` `onOpenSettings` 1줄)와 chat(`SettingsRoute` data class 전환에 따른 호출부 4곳 기계적 치환)이 함께 건드린다. 겹침을 알고 수용한다: 자리가 다르고 둘 다 기계적이라 rebase 충돌은 뒤에 통합하는 쪽이 해소한다(자진 신고 대상). chat의 설계 디폴트(듣기 실패는 웹 B12처럼 통지, 포커스 상실 시 정지, 배속 = 시스템 속도 × 배율)는 착수 보고 `start-202609270627.md`가 정본.

- 정정(2026-09-27 06:44, e50 보고): 착수 프롬프트의 전제 "`ios.directions.walkNotice.*`가 안드로이드 strings에 없다"는 **틀렸다**. ios-extra 도입으로 `android.directions.walkNotice.*` 9키가 전 로케일에 이미 있었다(코디네이터 grep이 키 이름을 잘못 변환). i18n 편집 0. 저장소에 `zh` 로케일은 없다.

- 정정(2026-09-27 06:52, m4b 착수 보고 — 기준 `ebcd3508`): ①`PlaceDetailRoute.showsDirectionsEntry`가 E45로 이미 있어 `place/**` 수정 0 ②`SceneSection.kt`에는 자동 펼침판만 있어 버튼형(iOS `SurroundingsSceneSection`)을 같은 파일에 신설하고 묶음 렌더를 공유로 뽑는다("임베드 인자 추가"보다 큰 변경, m4b 소유로 인정) ③장소 상세 중첩이 내비 push라 `nav/AppRoot.kt` `GuideBottomBar` 호출 한 줄 변경 허가(자진 신고) ④대안 프리뷰·줄 전환 문장 11키는 ios-extra 비접두 키라 android-extra 6로케일에 `android.guide.*`로 추가 ⑤길찾기 VM에 무통지 조회(iOS `runQuery(silently:)`) 진입점 추가.

**겹침 → 직렬**: `A/guide/**`는 n4(웨이브 1) → m4b(웨이브 2). `A/directions/**`는 e50(웨이브 1) → m4b(웨이브 2). 웨이브 1 세 세션은 소유 파일이 겹치지 않는다.

**경계 인터페이스(병렬 전 고정)**:
- e50 → m4b: `WalkStartRequest`는 e50이 고치지 않는다(`alternate` 추가는 m4b 몫). 첫 사용 공지는 `A/guide/ui/WalkGuideNoticeSheet.kt`에 두고 길찾기 화면이 부른다(공지 표식 키는 iOS `WalkGuideNotice.key`와 같은 이름).
- n4 → m4b: `WalkGuideModel`의 경유지 도착 처리에 "대안 프리뷰 초기화는 m4b"라는 주석 자리만 남긴다. `waypointPassedInSession`·`routeWaypointLabel`은 n4가 확정하고 m4b가 `changeDestination`에서 초기화한다(iOS 동형).
- chat ↔ 나머지: 설정 저장 키는 iOS와 같은 이름(`listenSpeed` = `ListenSpeed.storageKey`, `themePreference`, AI 동의 `aiChatConsent`). 채팅 듣기 재생기는 안내 세션 `GuideAudioFocus`와 한 채널을 쓰지 않도록 자기 오디오 포커스를 요청하고, 안내 세션이 살아 있으면 안내 발화가 우선이다(안내 중 채팅 듣기는 iOS도 `TtsPlayer.shared.stop()`으로 양보).

**공용 생성물·문서**: `res/values*/strings.xml`·`kit-strings.json`은 rebase 뒤 `node android/scripts/messages-to-android-strings.mjs`·`messages-to-kit-strings.mjs`로 재생성(손 편집 금지). `CHANGELOG.md`·`docs/BACKLOG.md`·`PROGRESS.md`·`android/README.md`는 **자기 항목·자기 절만** 고치고 rebase 뒤 `comm -23` 소실 대조. `android/kit/mirrors/*.json`은 자기 항목 `note`만. `NOTICE.md`·`docs/FORKING.md`는 이번 범위에 새 seed·식별자가 없어 건드리지 않는다.

## §3. git 격리 절차 (push 동결판)

```bash
# 코디네이터가 착수 전에 만들었다(세션은 만들지 않는다)
git -C ~/Mac-Projects/gildongmu worktree add ~/gildongmu-wt/<name> -b feat/<name> main
# 세션: 자기 브랜치에만, pathspec 커밋(git add -A 금지). 커밋 메시지 한국어, 꼬리말은 하니스가 지정한 줄 그대로
# 통합: base=$(git rev-parse main) && git rebase "${base}" → 공유 문서 comm 대조 → 생성물 재생성 → 게이트 → git -C ~/Mac-Projects/gildongmu merge --ff-only feat/<name>
#       ff 거부면 다른 세션이 먼저 올린 것: rebase부터 다시(게이트도 다시)
```

- `--force` 금지. **`origin` push 금지**(`.git/hooks/pre-push`가 막고, 막혀도 시도하지 않는다). 계획 커밋도 push하지 않는다.
- worktree에 `node_modules`·`.env.local`·공식 Android 스킬(`.claude/skills/`)은 코디네이터가 미리 넣었다. **`npm install` 금지.** SDK·JDK 설치 금지.
- **무거운 게이트는 `android/README.md` §7 절차 그대로**: `until mkdir ~/gildongmu-wt/gate.lock 2>/dev/null; do sleep 30; done` → 게이트 → (성공·실패 무관) `rmdir ~/gildongmu-wt/gate.lock; (cd android && ./gradlew --stop)`. vitest는 `VITEST_MAX_THREADS=2 npm run test:run`. iOS Kit 테스트(`cd ios/GildongmuKit && swift test`)도 같은 락 안에서.
- **기준선 기록**: `~/.claude/parallel-sessions/gildongmu/baseline-96175514xxxx.log`(base `1d95484c`, `:kit:test`·`:app:testDebugUnitTest`·`assembleDebug`·`npm run test:run`). 게이트가 실패하면 먼저 이 기록과 대조한다. 기록에 없는 실패는 자기 변경 탓으로 본다. 기준선을 다시 재려고 `git stash`·`checkout`을 하지 않는다. rebase 뒤 처음 보는 실패는 자기 것으로 단정하지 말고 보고한다.
- **리뷰는 별도 컨텍스트**(서브에이전트 `model: opus`, 요구사항 + `git diff main...HEAD`만 전달, 세션 히스토리 전달 금지). 리뷰 전에 전부 커밋(미커밋 0). 리뷰가 도는 동안 rebase·커밋 금지. 리뷰 결과는 파일(`~/gildongmu-wt/<name>-reports/review-<주제>-<YYYYmmddHHMM>.md`)로 받아 전문을 읽은 뒤 닫는다. 접근성 감사는 워크스페이스 `.claude/agents/a11y-auditor.md`가 worktree에 실리지 않으므로 그 파일을 Read해 지시를 준 `model: opus` 범용 에이전트로 대신한다.
- rebase 뒤 공유 문서 소실 대조: `base=$(git rev-parse main)` 뒤 `comm -23 <(git show "${base}:CHANGELOG.md" | sort) <(sort CHANGELOG.md)`(BACKLOG·PROGRESS·README도). 출력은 전부 자기가 지운 줄이어야 한다. **`${base}`처럼 중괄호로 감싼다.**
- 보고: `~/gildongmu-wt/<name>-reports/<단계>-<YYYYmmddHHMM>.md`(worktree 밖, 단계마다 **새 파일**: `start`·`review`·`integrated`·`blocked`). 코디네이터 `gildongmu-d9 [884058]`에 `SendMessage`로 파일 이름을 통보한다. 메시지는 유실될 수 있으므로 **파일이 정본**이다.
- 세션은 TTS 요약 파일을 쓰지 않는다. 위원장에게 닿아야 하는 것은 코디네이터에게 보낸다.
- 실기기 설치(`adb install`·`android install`)는 이번 웨이브에서 하지 않는다(한소네 7 판정은 위원장이 통합 뒤 따로). 빌드 산출물 경로만 보고.
- 하드 스톱 4종(비용·외부 발신·파괴·아키텍처 양자택일)은 코디네이터에게. 서버(`src/**`) 라우트·응답 변경 금지(fixture 파일은 chat 세션만 예외).

## §4. 웨이브

| 웨이브 | 세션 | 시작 조건 | 종료 조건 |
|---|---|---|---|
| 1 | `android-e50` · `android-n4` · `android-chat` | 지금(기준선 기록 생성 뒤) | 각자 범위 구현 + 테스트 + 리뷰(spec 준수·코드 품질·접근성 감사) 통과 + 문서 분배(CHANGELOG·BACKLOG E43 자기 항목·PROGRESS 한 줄) + `main` ff 통합 보고 |
| 2 | `android-m4b` | e50·n4 둘 다 ff 통합된 SHA 위 | 같은 조건. spec은 세션이 쓴다(`docs/superpowers/specs/2026-09-2x-android-walk-session-edits-design.md`), 적대적 설계 리뷰는 새 상태 전이가 있으므로 1회 |
| 3 | `doc-audit` | 웨이브 2 통합 뒤 | 문서 겹침·낡은 서술 정리. 한소네 7 판정은 그 뒤 위원장 |

동시 게이트 상한: 락으로 1. 웨이브 1 창 셋은 30초 간격으로 띄운다.

## §5. 세션별 착수 프롬프트

프롬프트 원문은 `~/.claude/parallel-sessions/gildongmu/<name>.prompt.txt`(런처가 복사). 보고 디렉터리 `~/gildongmu-wt/<name>-reports/`.

## §5-4. 통합 기록

(코디네이터가 채운다: 세션 · 통합 SHA · 시각 · 자진 신고 · 남은 판정)

| 세션 | 통합 SHA | 시각 | 자진 신고 | 남은 판정 |
|---|---|---|---|---|
| `android-n4` | `8fc9f721` | 2026-09-27 06:39 | `nav/AppRoot.kt` 1줄(허가) · 새 파일 `guide/ui/WeightSettingsNav.kt` | 한소네 7: 예고 50m·도착 조사·행 전환·권유 2회 닫기·설정 왕복 착지 / iOS 역이식 후보(E31 응답 표식 수명) / m4b 인계 4항은 `integrated-202609270639.md` |
| `android-e50` | `71977c53` | 2026-09-27 06:44 | `WalkGuideStartButton.kt` 소유 이전 반영(정정 절) · 실패 통지 `.high` 등가는 StatusLine+진동 · 안내 종료 섹션 제목은 세션 목적지 | 한소네 7: 안내 시작 고지가 시트 등장·TTS에 묻히는가(묻히면 발화 창구를 `WalkGuideModel`로 — m4b 이후) · 재조회 실패 뒤 커서·실패 문장 중복 · 공지 시트 중 조회 완료 통지 |
| `android-chat` | `be31a3f8` | 2026-09-27 06:50 | `nav/AppRoot.kt` 호출부 치환 · `guide/ui/WeightSettingsNav.kt` 치환(focusRow 기본값) · `GuideSourceGuardTest` ③ 허용 목록 1줄 · Settings ATF 단언 2줄 · CLAUDE.md 수정 → AGENTS.md는 코디네이터가 재생성 | 배속 뜻 불일치(채팅 = 시스템 속도×배율, 도보 안내 `TtsGuideSpeaker` = 절대 배율) → BACKLOG E43 판정 행 · TalkBack 공존 실기기 3항 · m4b 인계: focusRow=Weight 착지는 텍스트 필드라 키보드가 뜸(한 프레임 뒤 `requestFocus` 1회, 착지 대상 실기기 판정) · 기존 `GuideAudioFocus` LOSS 뒤 핸들 덮임 관찰 |
| `android-m4b` | `54edf15b` | 2026-09-27 07:31 | `nav/AppRoot.kt` 호출 1줄+import 2줄(허가) · `SceneSection.kt` 버튼형 신설(사전 인정) · CLAUDE.md 1줄 → AGENTS.md 코디네이터 재생성 | 한소네 7: BACKLOG E43 M4b ⓐ~ⓖ + E31 착지(필드 vs 푸터) · iOS 대비 의도된 차이 7건은 `integrated-202609270731.md` · 후속 후보 2건(장소 상세 "여기로 목적지 변경"·시트 중 밑 탭 StatusLine 통지) |


## §6. 코디네이터 메모

- 2026-09-27 착수 전 디스크 여유 14GB(20GB 미만). 스크래치·npm 캐시·타 프로젝트 DerivedData 정리 뒤 14GB 유지(안드로이드 worktree는 DerivedData가 없어 진행). ⚠ 정리 중 `/private/tmp/claude-502/*/` glob이 프로젝트 단위 폴더를 잡아 **살아 있는 세션(dodo-planet `api-validation-i18n`)의 스크래치까지 지웠다** — 하니스가 폴더를 재생성해 세션은 계속 돌았지만 그 세션의 중간 산출물은 유실됐을 수 있다. 다음부터는 세션 ID 폴더 단위로, `ps`로 살아 있는 세션 ID를 뺀 뒤 지운다.
- 등록부 `pending` 8건(E35·E48·E51)은 이번 범위 밖이라 그대로 둔다. 드리프트 4건(WalkInfra·BeaconTones·GuideToneLayer)도 E51 전용이라 두고, `mirror-registry`·`android-kit-drift` 테스트가 초록임을 기준선으로 확인.
