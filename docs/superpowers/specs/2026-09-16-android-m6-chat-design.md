# 안드로이드 M6 — 채팅(AI에게 질문) 설계

> 입력: 병렬 계획 `docs/superpowers/plans/2026-09-16-android-app-parallel-plan.md` §5-4·§5-5(M6 착수 입력), 판정 문서 `2026-09-15-android-app-decisions.md` §1·D5·D7·D9·D10, 접근성 헌장 §5·§6(+ `~/.claude/reference/accessibility.md` 대화형 UI 절·받아쓰기 불변식), iOS 원본 `ios/Gildongmu/Chat/**`·`SpeechService.swift`·`HoldDictationButton.swift`(탭 토글 갈래), `:kit` CORE 채팅 파일(`core.json` note가 D5 경계의 정본).
> **리뷰 게이트 판정**: 적대적 설계 리뷰 **필요** — 새 상태 머신(대화·받아쓰기 세션)·포커스 계약·외부 통합의 계약 가정(NDJSON 스트림 전송, 온디바이스 인식기)을 담는다. 결과는 §11.
> **서버 계약 변경 0**(`/api/chat`·`/api/chat/suggestions`·`/api/geocode` 기존 응답 그대로). `:kit` 무수정.

## 1. 범위

| 포함 | 비고 |
|---|---|
| 채팅 탭(일반 채팅, `placeContext` 없음) | 대화는 탭 백스택 엔트리의 ViewModel — 탭 전환에 살아남고 스트림도 계속 돈다(iOS App 소유 모델 동형) |
| 장소 채팅(장소 앵커) | `PlaceChatRoute` 스택 화면. **엔트리마다 새 대화**(iOS 시트 표시마다 새 `ChatView` 동형), pop이면 스트림 취소 |
| AI 동의 게이트 | 인라인 동의 화면 + ViewModel `send` 가드 이중 방어(iOS `ChatConsentView` + `ChatModel.send`) |
| NDJSON 스트리밍 전송·follow-up 칩 전송 | `chat/` 안 `HttpURLConnection` POST. 줄 분리는 `:kit` `splitStreamLines`만 |
| 메시지 목록 접근성(헌장 §6) | 질문 헤딩, 산문 블록별 객체, 장소 언급 활성화, 카드(장소·nearby 투영·주소·웹 결과)·출처, 공유 버튼, 진행 통지, 완료 효과음·포커스 |
| 입력 | 텍스트 필드 + 지우기 + 받아쓰기(API 33 게이트, 탭 토글) + 보내기 |
| 카드 탭 → 장소 상세 | 장소 카드·언급 블록은 즉시, 주소 카드는 `/api/geocode` 뒤(화면 이탈 시 폐기 — 웹 `ChatAddressResults` 동작) |
| 진입 함수 `NavController.openChat(place: Place?)` | 장소 상세 버튼 배선은 android-m1(§7) |
| 받아쓰기 세션 `speech/DictationSession.kt` | **새 파일**(코디네이터 승인 — 기존 `speech/` 파일 무수정). 검색·길찾기 마이크가 나중에 재사용 |
| 매니페스트 `RECORD_AUDIO` 한 줄 | 코디네이터 승인, 별도 커밋 |

**범위 밖(판정 기록)**
- 답변 **듣기(TTS)** 버튼: M4 오디오 계층 뒤(D10 — iOS는 안내와 `TtsPlayer`를 공유). 응답 액션 행에 자리만 예약.
- **결과 진동**(iOS 성공·실패 햅틱): M2b 판정 ㉓ — 설정 화면 마일스톤. 그 대신 실패는 착지 대상으로 가른다(§3-4, §11 M4).
- **받아쓰기 홀드 방식**: 설정 화면 마일스톤(iOS에서도 설정 선택지). M6는 탭 토글만.
- **세션 유휴 리셋**(iOS `resetChatModel`): 안드로이드에 앱 유휴 리셋 기제가 아직 없다.
- **수동 위치**(M2c): `userLocation`은 GPS 저장 좌표만. 자리 주석.
- **안내 출력 억제 연동**(iOS `GuideSession.setDictationActive`): M4가 `DictationSession.isActive`를 관찰해 붙인다.
- **채팅 탭 첫 줄 위치 표시줄**: M2b `location/LocationBarRow`가 통합 시점 `main`에 있으면 호출, 없으면 자리 주석(코디네이터 판정 7).
- 서버 결함(A44 후보, U+2028·U+2029·U+0085 날 문자가 이벤트 줄을 쪼갠다): **우회하지 않는다.** 클라이언트는 `splitStreamLines` 계약대로 동작하고 iOS와 같은 증상(그 답변은 실패 문구)이 난다.
- **개인정보 공개 문구**: 웹 `privacy.dictation`이 "iOS 앱의 받아쓰기는 기기 안에서 처리"로 플랫폼을 한정한다. 수집 유형은 그대로(온디바이스)지만 안드로이드 받아쓰기를 말하지 않는다 — 웹 push 동결 중이라 M6에서 고치지 않고 **출시 전 게이트로 BACKLOG 등재를 코디네이터에 요청**(4자 일치 대상).

## 2. 구조

```
[4] 화면      chat/ChatScreen.kt(탭·장소 화면 + 공용 대화 본문 + 입력 바) · ChatMessages.kt(말풍선·블록·카드·출처·칩)
              chat/ChatConsent.kt(동의 저장소 + 동의 본문) · chat/ChatLanding.kt(착지 `land` + 진단 로그 — 부착 관용구는 `a11y/Landing.kt` `landingTarget`)
[3] 실행      chat/ChatHttp.kt(POST 한 곳 + 취소 시 disconnect) · ChatStream.kt(스트림 소스 + 순수 리더 readChatStream)
              chat/ChatFactories.kt(팩토리 + SoundPool 효과음 `USAGE_ASSISTANCE_SONIFICATION`) · speech/DictationSession.kt(인식기 포트 + 세션 상태 머신 + 안드로이드 어댑터)
[상태]        chat/ChatViewModel.kt(대화 상태 머신) · ChatStrings.kt(문장 람다 + 도구·출처 라벨 리터럴 표)
              chat/ChatInline.kt(블록 인라인 마크다운 → 평문+구간, 순수) · chat/AddressToPlace.kt(웹 jusoAddressToPlace 미러, 순수)
[진입]        chat/ChatRoutes.kt(PlaceChatRoute + NavController.openChat) · ChatFactories.kt(ViewModel 팩토리)
[2] :kit      ChatService·ChatSuggestionsService·ChatMarkdown·ChatPlaceMentions·PlaceChatPrompts·ChatModels·VoiceQuery(무수정)
res/raw       chat_send.mp3 · chat_receive.mp3 (iOS `Resources/chat-send.mp3`·`chat-receive.mp3` 바이트 동일 사본)
```

판단 근거: 판정은 `:kit`, `chat/`은 전송·상태·조립만(D5). 전송(HTTP)·리더(순수)·상태 머신·화면을 파일로 갈라 리더·대화 ViewModel·받아쓰기 세션을 JVM에서 잠근다(받아쓰기는 인식기를 포트 인터페이스로 감싸 가짜 인식기로 돈다). `AddressToPlace`는 웹 `src/lib` 미러인데 iOS 대응물이 없어 `:app`에 둔다 — iOS가 같은 경로를 얻으면 `:kit`로 옮긴다(D5).

## 3. 화면 계약

### 3-1. 공통 골격(읽기 순서 = 표 순서)

| # | 요소 | 접근성 계약 |
|---|---|---|
| 1 | 상단 바(`AppScreenScaffold`) | 탭: 제목 `android.tab.chat`, 뒤로 없음. 장소: 제목 = 장소 이름(`bilingualName(...).primary`), 뒤로 있음. 제목은 헤딩(기존 `AppTopBar`) |
| 2 | (탭만, 동의 뒤) 위치 표시줄 | M2b `LocationBarRow(AppConfig.currentAddressStore)` — 스크롤 밖 첫 줄. 진입 시점 스냅샷이라 같은 화면의 전송(측위·권한 허용)이 상태를 바꿨을 수 있어 **답변 뒤 `ensureLoaded`를 다시 부른다**(좌표당 1회는 스토어가 막는다). 장소 채팅엔 **두지 않는다** — 장소 좌표가 앵커라 표시줄이 거짓 신호가 된다(iOS `showsLocationBar: false`) |
| 3 | 동의 전: 동의 본문(§3-2) / 동의 뒤: 대화 목록(§3-3) | 세로 스크롤 `Column`(가상 스크롤 금지 — 헌장 §1, iOS LazyVStack 금지와 같은 결론) |
| 4 | 통지 줄 `StatusLine(notice)` | 화면의 **단일 polite 창구**. 진행 문장·주소 좌표 실패·받아쓰기 결과·받아쓰기 실패·열기 실패가 전부 여기로. **스크롤 밖**, 입력 바 바로 위에 고정(목록을 올려 읽는 중에도 라이브 리전이 화면 안에 있다 — 화면 밖 노드의 라이브 리전 발화는 보장되지 않는다). 스트리밍 중엔 왼쪽에 진행 표시(`CircularProgressIndicator`, `clearAndSetSemantics {}` — 시각 전용) |
| 5 | 입력 바(스크롤 밖, 하단 고정 — 대화 컨테이너에 `fitInside(WindowInsetsRulers.Ime.current)`: targetSdk 36 edge-to-edge에서 `adjustResize`는 창을 줄이지 않고 IME 인셋만 주므로 앱이 맞춰야 키보드가 입력 바를 덮지 않는다) | 1행: 텍스트 필드(라벨 `chat.inputLabel`, 한 줄, IME 동작 `Send`, `TextFieldState`는 ViewModel 소유) + 초안이 있을 때만 끝의 지우기 아이콘 버튼(`android.chat.clear`). 2행: 받아쓰기 버튼(게이트 통과 시만, §6) + (거부 상태에서만) 설정 열기 버튼 + 보내기 버튼(`chat.send`). 읽기 순서 필드 → 지우기 → 받아쓰기 → (설정 열기) → 보내기. 버튼은 **보이는 텍스트 라벨**(텍스트면 라벨 = 이름이라 대응 속성 불필요, 코어 아이콘에 마이크도 없다) |

### 3-2. 동의 본문(iOS `ChatConsentView` 미러)

제목 `android.chat.consentTitle`(헤딩, 착지 가능) → `consentData` → `consentAiNotice` → `consentAlt`(각 `mergedRow` 한 객체) → 버튼 `android.common.privacyPolicy`(`{API_BASE_URL}/{AppLocale.current}/privacy`를 `ACTION_VIEW`, `tryStartActivity`가 false면 통지 `android.common.noAppToOpen`) → 버튼 `android.chat.consentAgree`.
동의 여부의 첫 읽기는 IO에서(`ChatConsentStore.ensureLoaded`, 저장소 계약 — `SharedPreferences` 첫 접근은 디스크 로드). 읽기 전(`granted == null`)엔 동의 본문도 대화도 그리지 않는다(동의 전 화면이 한 프레임 번쩍이지 않게). 동의 누름 → `ChatConsentStore.grant()`(저장 + `StateFlow` 갱신 — 열린 탭·장소 화면이 함께 전환) → **그 화면만**, 동의 상태가 true로 커밋된 뒤 첫 프레임(`LaunchedEffect(granted)`)에 텍스트 필드로 착지(사라진 동의 버튼에서의 이탈 차단, 헌장 §5; iOS `focusDraftOnAppear`). 저장은 `SharedPreferencesStore(app, "gildongmu.chat")` 키 `aiChatConsent` = `"true"` — 실험판·정식판은 applicationId가 달라 저장이 자동으로 갈린다(iOS 앱별 UserDefaults 동형). 미결정·거부를 구분하지 않는다(iOS와 같다).

### 3-3. 대화 목록

**빈 대화**: 추천 질문 버튼만(설명 문장 없음 — 버튼이 곧 설명). 탭 = `android.chat.suggestion1~4`, 장소 = `placeChatPromptKeys(place)`의 3개. 누르면 전송(§3-4). 첫 전송 뒤 사라진다.

**질문(사용자 턴)**: 원문 그대로 한 객체, **헤딩**(`mergedRow("question-<id>", focus = r).headingText()`). 마크다운 해석 없음. 완료 착지 대상.

**답변(어시스턴트 턴)**, 위에서 아래로:
1. 산문: `parseChatMarkdownBlocks(text)` 블록마다 한 객체(`mergedRow("block-<msg>-<i>", focus = r)`). 블록이 0개면 원문 한 객체. 헤딩 블록은 `headingText()` + 제목 스타일. 표시 텍스트는 `chatInlineText`(§3-5)가 강조 기호를 걷은 평문 + 굵게·고정폭 구간이고 화면이 `AnnotatedString`으로 옮긴다(스팬은 노드를 쪼개지 않는다).
   - 장소 언급 = `chatPlaceMentions(block.text, 이 답변의 Places 렌더 장소 전부)`.
   - **0개**: 평문 객체.
   - **1개**: 블록 전체가 버튼(`clickable(role = Button)` + `mergedRow`) → 장소 상세. 이름 구간만 강조색(시각). 커스텀 액션 없음(잉여). 헤딩 블록이면 헤딩 + 버튼이 한 노드에 함께 선다.
   - **2개 이상(드묾)**: 블록은 평문 한 객체 + `customActions`에 장소마다 `android.chat.openPlace`(`bilingualName(...).primary`), 산문 등장 순. 이름 구간은 강조색. **인라인 링크(`LinkAnnotation`)는 쓰지 않는다** — 링크마다 포커스 노드가 따로 서서 블록이 쪼개진다. 시각 사용자는 아래 카드로 연다(카드가 안전망, iOS 주석과 같은 한계). ⚠ 실기기 판정 §8-5: 한소네 점자 탐색이 커스텀 액션에 못 닿으면 블록 아래 보이는 버튼으로 바꾼다(M1 §8-8 조건 승계).
2. 렌더 묶음(`renders` 순서 = 묶음 인덱스 `r`), 비지 않은 묶음마다 **구획 헤딩**(수 포함) 뒤 행:
   - `Places(sort=accuracy)` → `android.chat.placesHeading`(N) / `Places(sort=review)` → `chat.reviewPlacesHeading`(N). 행 = `search.PlaceRow(place, lang, spokenMeters, onClick, modifier = Modifier.focusRequester(r))` → 상세. (nearby 4종은 `:kit`이 `places` 투영으로 이미 `Places`로 바꾼다.)
   - `Addresses` → `android.chat.addressesHeading`(N). 행 = `search.AddressRow`에 `focusRequester(r).clickable(role = Button)` 수식자를 넘긴다(`PlaceRow`와 같은 순서) → 지오코딩 → 상세(§4-4).
   - `WebResults` → `android.chat.webResultsHeading`(N). 행 = `search.WebRow`(http/https만 브라우저).
   - `Unsupported` → 없음(산문이 정본).
3. 출처(있을 때만): 헤딩 `android.chat.sourcesHeading` + 행. 라벨 = `source.<id>` → `chat.source.<id>` 리터럴 표(미지 라벨은 원문 — 키 누락이 화면에서 드러난다, iOS 동형). url이 http/https면 버튼(브라우저), 아니면 평문 객체.
4. 응답 액션 행: 공유 아이콘 버튼(`Icons.Filled.Share`, 이름 `android.chat.share`) → `ACTION_SEND` text/plain = 답변 원문(`message.text`)을 `Intent.createChooser`로(선택기는 항상 있어 실패 분기 없음). `// [M4 뒤] 듣기` 자리.

**follow-up 칩**: 마지막 답변이 성공이고 제안이 있을 때만, 그 답변 뒤에 구획 헤딩 `android.chat.followUps` + 버튼들. 도착 통지 없음(조용히 생기는 보조 컨트롤 — 헤딩으로 발견). iOS는 컨테이너 라벨이었으나 TalkBack에는 컨테이너 진입 낭독이 없어 **헤딩이 발견 경로의 대응물**이다(카드·출처 구획 헤딩과 같은 모양). 누르면 전송.

### 3-4. 포커스 계약(헌장 §6 → Compose)

**착지 관용구**: 부착은 `a11y/`의 둘뿐이다(main 소스 가드) — 행·헤딩·블록은 `mergedRow(focus = r)`(내부 `focusable()`은 항상 포커스 가능), 버튼·텍스트 필드·클릭 행은 `Modifier.landingTarget(r)`(= `focusRequester(r).focusProperties { canFocus = true }`, `clickable` 체인 **앞**). Compose 1.12의 `clickable`(Material3 `Button` 포함)은 입력 모드가 터치면 포커스를 받지 않아(TalkBack 폰 사용자는 터치 모드에 머문다) 그냥 `focusRequester`만 걸면 착지가 조용히 실패한다(설계 리뷰 B1 — 코디네이터가 `a11y/Landing.kt`로 승격·전수 교체). 착지 실행은 `chat/ChatLanding.kt` `land(r, tag)` — `requestFocus()`의 **Boolean과 예외 둘 다** 보고 `Log.i("ChatFocus", "$tag ok|fail")`(진단 로그, iOS `ChatFocusDiag` 대응; 모든 빌드, 개인정보 없음). 원칙은 상태 변화 뒤 `withFrameNanos {}` 한 프레임 뒤 착지이고, **전송 착지만 예외적으로 같은 핸들러에서 동기**다(사라질 버튼보다 먼저 옮긴다). 목록이 eager `Column`이라 화면 밖 노드도 트리에 있고 `focusable`의 bring-into-view가 스크롤한다. ⚠ "TalkBack 접근성 포커스가 입력 포커스를 따라오는가"는 M1 spec §8-2의 미검증 전제이고 §8-1·§8-2가 그 결과에 종속된다.

| 사건 | 포커스 | 근거 |
|---|---|---|
| 전송 — 보내기 버튼·IME 전송 | `vm.sendDraft()`가 받아들였을 때만(초안은 **그때만** 비운다) 같은 핸들러에서 동기로 보내기 버튼 착지. 목록 끝 스크롤은 메시지 수 변화의 효과에서(새 질문이 배치된 뒤의 `maxValue`) | 헌장 §6. 입력 포커스가 필드를 떠나 소프트 키보드가 내려간다(수용 — 다음 행동은 답변 듣기) |
| 전송 — 추천 질문·follow-up 칩 | `vm.send(text)`가 받아들였을 때만 보내기 버튼 착지 + 끝으로 스크롤. **초안은 건드리지 않는다**(iOS 동형) | 누른 버튼이 다음 프레임에 사라진다 — 사라지기 전에 안정 요소로 선점(헌장 §5) |
| 스트리밍 중 | 보내기 버튼 유지. 클릭은 무시(핸들러 가드 + ViewModel in-flight 가드), `enabled = false` 금지, `stateDescription = android.chat.sending` | M1 검색 버튼 관용구(disabled는 포커스를 떨군다). 포커스를 쥔 노드의 상태 설명 변화는 TalkBack이 강제 발화 |
| 완료 — 성공 | 마지막 **질문 헤딩** 착지 | 헌장 §6 |
| 완료 — 실패 | 마지막 **실패 답변 블록** 착지(문장 "답변을 가져오지 못했습니다.") | 착지 대상의 낭독이 곧 실패 문장이라, 결과 진동이 빠진 안드로이드에서 성공·실패를 가르는 비시각 신호가 된다(완료음은 성패 무관). 질문 헤딩은 바로 위라 한 번 뒤로 가면 된다. ⚠ 헌장 §6 "완료 시 질문 헤딩"의 **안드로이드 편차**(판정 5) |
| 완료 착지 공통 조건 | ① `answerRevision`이 이 화면 진입 시 값(`remember`)보다 크고 아직 소비 안 함 ② 스트리밍 중이 아님 ③ **받아쓰기 세션이 활성(`isActive`: Starting·Preparing·Listening)이 아님** ④ **텍스트 필드가 입력 포커스를 갖고 있지 않음**(`onFocusChanged`로 화면 상태에 보관). ③·④로 건너뛴 착지는 **소비**(되살리지 않는다) — 그때는 끝으로 스크롤만. **건너뛴 완료가 실패면** 통지 줄에 실패 문장(`android.chat.failed`)을 게시한다: ④는 즉시, ③이면 받아쓰기 세션이 끝날 때 — 전사가 오면 전사 통지와 한 문장(`실패 문장 + 공백 + 병합 원문`), 전사 없이 끝나면 실패 문장만(리뷰 R2-M1) | ① 다른 탭에 있는 동안 끝난 답변이 복귀 때 포커스를 끌어가지 않게(StatusLine `initialSeq`와 같은 꼴, iOS `.task(id:)` 금지 사유). ③ 탐색 낭독이 곧 뜨거워질 마이크에 섞인다. ④ 답을 기다리며 다음 질문을 치던 점자 키보드 사용자의 입력을 끊지 않는다(Compose `requestFocus`는 iOS와 달리 입력 포커스 자체를 옮긴다). ③·④ 경우 성공은 완료음만, 실패는 완료음 + 실패 통지(§8-2) |
| 지우기 | 초안 비움 + 텍스트 필드 착지(같은 핸들러) | 지우기 버튼이 자신을 없앤다 |
| 동의 | 텍스트 필드(§3-2) | |
| 장소 채팅 진입(push) | 상단 바 제목 헤딩(동의 여부 무관), **push당 1회**(`rememberSaveable` 표식 — 상세 pop 복귀·구성 변경에서 다시 돌지 않아 복귀 착지와 겹치지 않는다) | 누른 "물어보기" 버튼이 사라지는 전이. M2 장소 상세 진입 착지와 같은 꼴 |
| 받아쓰기 전사 도착 | 초안에 병합 → 대기 중인 완료 착지를 소비(iOS가 전사 도착 시 완료 포커스 시퀀스를 취소하는 것과 같다) → 보내기 버튼 착지 → 통지(병합 원문, 보류된 실패가 있으면 앞에 붙인다) | 헌장 §6 받아쓰기 완료. TalkBack polite 통지는 새 발화에 끊기지 않고 포커스 낭독 뒤에 잇는다. 통지 줄의 원문은 다음 전송·지우기에서 비운다(초안과의 중복 잔존 차단) |
| 장소 상세에서 pop 복귀 | 연 원점(카드 행 `card-<msg>-<r>-<place.id>`·언급 블록 `block-<msg>-<i>`·주소 행 `address-<msg>-<r>-<roadAddr>`) | `ReturnFocusSlot`(ViewModel `SavedStateHandle`) — 기존 관용구. 소비는 `LaunchedEffect` 안에서 한 번. 묶음 인덱스 `r`은 정확도순·리뷰순 묶음에 같은 장소가 있을 때 키 충돌을 막는다 |

권한 다이얼로그 경계(일반 채팅 첫 전송의 위치 권한, 받아쓰기의 마이크 권한) 뒤 커서 위치는 보장되지 않는다 — 가설 착지를 넣지 않고 §8-13에서 실측한다.

### 3-5. 인라인 마크다운(`ChatInline.kt`, 순수)

`chatInlineText(text: String): ChatInlineText(plain: String, bold: List<IntRange>, code: List<IntRange>)`. 규칙: `**x**`·`__x__` → 굵게, `` `x` `` → 고정폭, `~~x~~` → 기호만 걷음, `[label](url)` → label(URL 버림 — 링크 노드가 블록을 쪼개므로 링크로 만들지 않는다, 서버 지시가 본문 URL을 막아 영향이 작다), `*x*`는 여는 `*` 뒤와 닫는 `*` 앞이 공백이 아닐 때만 기호를 걷는다(`_x_`는 걷지 않는다 — snake_case 오인), `\*`·`\_`·`` \` ``·`\~` 이스케이프는 역슬래시만 걷는다. 짝 없는 기호는 원문 유지. 장소 이름 강조 구간은 `plain` 안에서 이름을 찾아 칠한다(언급 판정 자체는 `:kit`이 원문 블록으로 한다). 정규식 약칭 클래스 금지(README §3).

## 4. 상태 머신 `ChatViewModel`

```kotlin
data class ChatMessage(val id: Long, val role: Role, val text: String, val failed: Boolean = false,
                       val renders: List<ChatRenderPayload> = emptyList(), val sources: List<ChatSource> = emptyList())
data class ChatUiState(
    val messages: List<ChatMessage> = emptyList(),
    val isStreaming: Boolean = false,
    val followUps: List<String> = emptyList(),
    val answerRevision: Int = 0,
    val notice: Notice = Notice(0, ""),
)
class ChatViewModel(
    val place: Place?,                       // null = 일반 채팅
    private val stream: ChatStreamSource,
    private val suggestions: ChatSuggestionsSource,
    private val geocode: suspend (String) -> AddressMatch?,   // SearchService.geocode(q, 1).firstOrNull()
    private val consent: ChatConsentStore,
    private val location: ChatLocation,      // prime(): 일반 채팅 전송 직전 1회 측위 시도 / last(): 저장 좌표
    private val lang: () -> String,          // AppLocale.current — 요청 locale·follow-up locale
    private val dataLocale: () -> String,    // 주소 → Place의 영문 주소 채움 판정
    private val strings: ChatStrings,
    private val sounds: ChatSounds,
    savedState: SavedStateHandle,
) : ViewModel() { val draft = TextFieldState() }
```

### 4-1. `send(text): Boolean` · `sendDraft(): Boolean`

1. `trimmed` = 앞뒤 공백·개행 제거. **가드**: `consent.granted.value` 아님 / 빈 문자열 / `isStreaming`이면 `false`(동의 가드는 UI 게이트가 뚫려도 전송을 구조적으로 막는다 — iOS 이중 방어). `sendDraft()`는 초안으로 `send`를 부르고 **true일 때만** 초안을 비운다.
2. follow-up 조회 취소·칩 비움 → 사용자 메시지 추가 → 통지 줄 비움 → `sounds.send()` → `isStreaming = true` → `true` 반환.
3. 스트림 잡(`viewModelScope`):
   - **일반 채팅만** `location.prime()`(= `LocationStore.currentCoordinate(timeoutMs = (LocationFixPolicy.softTimeout * 1000).toLong())`, 취소가 아닌 예외는 전부 삼킨다 — iOS `try?`). 첫 사용이면 권한 다이얼로그가 뜬다 — iOS 계약 그대로(위치는 필수가 아니다). 장소 채팅은 측위를 트리거하지 않고 저장 좌표만.
   - 본문 `ChatRequestBody(messages = 전체 히스토리(실패 문구 포함, iOS 동형), userLocation = location.last(), locale = lang(), placeContext = place?.let { PlaceContext(name, lat, lng, category.ifEmpty { null }, isStation(it)) })`. `userLocation`: 장소 앵커는 서버가 `placeContext`로 처리 > (M2c 수동 위치 자리) > GPS 저장 좌표 — 길찾기 출발지는 서버가 이 필드를 쓴다(장소로 덮지 않는다).
   - `stream.events(body).collect`: `Status` → 진행 통지(§4-3), `Done` → 보관, `Error` → 실패 표시, `Unknown` → 무시. 수집 중 `CancellationException`은 다시 던지고 그 밖 예외(`APIError`·`IOException`·디코딩)는 실패 표시.
   - **종료 절차 첫 줄 `currentCoroutineContext().ensureActive()`**(iOS `guard !Task.isCancelled`): 취소로 `disconnect()`된 읽기는 `CancellationException`이 아니라 `IOException`으로 깨어나므로, 이 가드가 없으면 장소 채팅 pop 뒤 떠난 화면에서 실패 답변·완료음이 난다(리뷰 M1).
   - 종료: 통지 비움 → `isStreaming = false` → `Done`이 있고 실패 표시가 없으면 답변 추가(빈 `text`는 `android.chat.emptyAnswer`), 아니면 `failed = true`인 `android.chat.failed` 답변 추가 → `sounds.receive()`(성패 무관 턴 경계 신호) → `answerRevision++` → 성공이면 follow-up 조회.
4. `onCleared`는 `viewModelScope` 취소로 스트림·follow-up을 함께 끊는다(장소 채팅 pop = iOS 시트 dismiss 취소). 탭 채팅은 탭 전환에 취소하지 않는다.

### 4-2. follow-up

직전 질문·답변 한 쌍 + `lang()` + `place?.name`으로 `suggestions.fetch`. 결과는 조회 잡이 살아 있을 때만 커밋(전송이 잡을 취소한다). 실패·비-2xx·디코딩 불가는 전부 빈 목록(`ChatSuggestionsService.followUps`), 취소만 전파.

### 4-3. 진행 통지

라벨 = `categories.map(strings.toolLabel)`(19개 리터럴 표, 미지 키는 원문) 쉼표 결합. 비면 `android.chat.progressFallback`, 아니면 `chat.progress.searching`(labels). `Notice(seq+1, 문장)` — status 이벤트당 1회. 답변 산문은 통지하지 않는다(헌장 §5 복제 금지). 실패는 착지가 신호이고, 착지를 건너뛴 실패만 화면이 통지한다(§3-4). TalkBack의 polite 통지는 새 포커스 낭독에 끊기지 않으므로, 완료 착지 낭독은 말하던 진행 문장 뒤에 이어진다(수용 — 진행 문장은 짧다).

### 4-4. 주소 카드 열기 `suspend fun resolveAddress(address: JusoAddress): Place?`

화면이 **자기 컴포지션 스코프**(`rememberCoroutineScope`)에서 부른다 — 탭 전환·pop으로 화면이 컴포지션을 떠나면 스코프가 취소되어 늦은 결과로 상세를 열지 않는다(웹 `aliveRef` 동형). in-flight 가드(진행 중 재탭 무시, `finally`에서 해제 — 취소 경로 포함). 질의 = `roadAddrPart1` 비면 `roadAddr`. 매칭 0 → 통지 `search.addressCoordFailed`("좌표를 찾지 못해") + null / 예외 → 통지 `directions.coordError`("확인하지 못했습니다") + null(3-state: 없음 ≠ 조회 실패) / 취소 → 다시 던짐. 성공 → `jusoAddressToPlace(address, match, dataLocale())`(웹 `src/lib/address-to-place.ts` 미러: id `juso-<roadAddr>`, 이름 = `bdNm` 비면 도로명(`roadAddrPart1` 비면 `roadAddr`), 지번 = `jibunAddr`, 영문 주소는 en일 때만) → 화면이 원점 키를 기억하고 상세를 연다.

### 4-5. 받아쓰기와의 접점

`mergeTranscript(transcript): String`(초안 공백뿐이면 전사만, 아니면 `초안 + " " + 전사`; 초안 교체 후 반환) · `announce(text)`(통지). 스트리밍 중에도 병합만 한다(자동 전송 없음 — 탭 토글 계약). 전송(`send` 성공)·지우기(`clearDraft`)는 통지 줄을 비운다.

## 5. 전송

### 5-1. `ChatHttp.post(url, body, timeoutMs, read: suspend (status: Int, stream: InputStream) -> T): T`

`HttpURLConnection` POST 한 곳(스트림·follow-up 공용), 연결은 `open` 인자(기본 `URL.openConnection`)로 받는다. **전부 `Dispatchers.IO`에서**. `Content-Type: application/json`, `setFixedLengthStreamingMode`, `connectTimeout = readTimeout = timeoutMs`(URLSession `timeoutInterval`과 같은 **유휴** 상한 — 채팅 180초·칩 6초, `:kit` 상수). 블로킹 읽기는 코루틴 취소를 보지 못하므로 **감시 코루틴(IO 디스패처)**이 취소 시 `disconnect()`해 읽기를 즉시 깨운다(메인 스레드에서 소켓을 닫지 않는다). 감시자는 `try/finally`로 **모든 경로**에서 해제한다(남으면 부모 스코프가 자식 완료를 기다려 스트림이 끝나지 않는다). 취소 중에 난 비취소 예외(연결을 닫아 깨운 읽기의 `IOException`)는 `ensureActive()`로 취소로 바꿔 던진다 — 코루틴은 취소 뒤의 비취소 예외를 근본 원인으로 삼아 부모에 실패로 전파한다(구현 중 테스트가 검출). 2xx가 아니면 `errorStream`(null이면 빈 입력)을 넘긴다. ⚠ 읽기를 깨우는 것은 플랫폼 구현이다: JVM 표준 구현(JDK 21)은 청크 응답 읽기 중 `disconnect()`가 읽기 잠금에 막혀 깨우지 못한다(실측·바이트코드 확인) — 그래서 JVM 테스트는 가짜 연결로 계약만 잠그고, 안드로이드(OkHttp 기반) 기기 동작은 §8-16. `:app` `net/HttpUrlConnectionTransport`(GET 전용, 소유 밖)는 건드리지 않는다.

### 5-2. `ChatStreamSource.events(body): Flow<ChatStreamEvent>`

`channelFlow { ChatHttp.post(...) { status, stream -> ... } }.flowOn(Dispatchers.IO)`. 비-2xx는 오류 본문을 모아 `ChatService.statusError`로 던진다. 2xx는 `readChatStream(stream) { send(it) }`.

### 5-3. `readChatStream(input, emit)` — 순수 리더

읽기 버퍼 `STREAM_READ_BUFFER_BYTES = 8192`(§5-5 계획 입력: `splitStreamLines`가 꼬리를 매번 재스캔한다). 루프: `read` → `remainder + chunk`를 `ChatService.splitStreamLines(buf, endOfStream = false)` → 줄마다 `ChatService.eventFromStreamLine`(빈 줄 null은 건너뜀) → `emit`. EOF에서 `endOfStream = true`로 한 번 더. 매 루프 `ensureActive()`. 깨진 줄은 `APIError.Decoding`이 그대로 올라가 스트림 실패가 된다(iOS 동형 — 앞서 `Done`을 받았어도 실패). **줄 분리를 앱에서 새로 쓰지 않는다**(`readLine`·`lineSequence`·`BufferedReader`·`lines()` 금지 — 소스 가드).

### 5-4. `ChatSuggestionsSource.fetch(...)`

POST `ChatSuggestionsService.path`, 본문 `ChatSuggestionsService.encodeBody`, 전량 읽기 → `ChatSuggestionsService.followUps(status, body)`. 취소가 아닌 예외는 빈 목록, 취소는 전파.

## 6. 받아쓰기 `speech/DictationSession.kt`

**게이트**: 화면이 `Dictation.isAvailable(context)`(API 33 + 온디바이스 인식 가능)일 때만 버튼·세션을 만든다. 아니면 버튼·세션 0(D9, 한소네 6 = 버튼 없음).

**온디바이스 강제**: `SpeechRecognizer.createOnDeviceSpeechRecognizer`만 쓴다(서버 인식 폴백 금지 — 개인정보 신고 "오디오 미수집"이 이 한 줄에 걸린다). 언어 태그 = 앱 언어(ko-KR·en-US·es-ES·fr-FR·it-IT·ja-JP, iOS `speechLocaleIdentifier` 미러, 자동 감지 금지).

**구조**: 세션 상태 머신은 인식기를 **포트**로만 본다 — JVM에서 가짜 인식기로 전 계약을 잠근다.

```kotlin
interface RecognizerPort {                       // 안드로이드 어댑터 AndroidRecognizerPort가 SpeechRecognizer를 감싼다(메인 스레드·메인 실행기)
    fun checkSupport(languageTag: String, onResult: (RecognizerSupport) -> Unit)   // Installed | NeedsDownload | Unsupported | Unknown
    fun download(languageTag: String, onResult: (DownloadResult) -> Unit)          // Ready | Scheduled | Failed  (API 33은 요청만 = Scheduled)
    fun start(languageTag: String, listener: RecognizerListener)                  // 세션마다 새 인식기
    fun stop(); fun cancel()                                                       // cancel은 destroy까지
}
interface RecognizerListener { fun onReady(); fun onSegment(text: String); fun onEnd(finalText: String?); fun onError(code: Int) }
interface DictationEffects { fun startTone(); fun stopTone(); fun interruptScreenReader(); fun postDelayed(ms: Long, block: () -> Unit): () -> Unit }

sealed class DictationPhase { Idle; Starting; Preparing; Listening; Denied }   // 실패는 통지 뒤 곧바로 Idle이라 phase에 두지 않는다
enum class DictationFailure { StartFailed, Interrupted, Locale, OnDevice, Audio }
sealed class DictationNotice { DownloadRequested; DownloadReady; DownloadFailed; Denied; Failure(kind) }
class DictationSession(port, effects, languageTag: () -> String, onTranscript: (String) -> Unit, onNotice: (DictationNotice) -> Unit) {
    val phase: StateFlow<DictationPhase>
    val isActive: StateFlow<Boolean>      // Starting·Listening(마이크가 켜졌거나 곧 켜진다) — 완료 착지·통지 보류·M4 안내 억제 연동 지점
    fun toggle(); fun cancel(); fun markDenied(); fun dispose(); fun detach()
}
```

- **권한**: 화면이 `rememberLauncherForActivityResult(RequestPermission())`로 `RECORD_AUDIO`를 묻는다(허용 → `toggle()`, 거부 → `markDenied()`). 세션은 권한을 가정한다(`ERROR_INSUFFICIENT_PERMISSIONS`도 `Denied`).
- **토글** `toggle()`: `Listening` → 정지(정지 중이면 무시) / `Preparing` → **`cancel()`**(세대 증가, 전달 0, 라벨 복귀 — 모델 다운로드는 수십 초~수 분이라 거둘 수단이 필요하다) / `Starting` → 무시(라벨이 Idle과 같은 "받아쓰기 시작"이라 취소가 무신호가 된다, 짧다) / `Idle`·`Denied` → 시작.
- **세대 토큰**: 시작마다 세대를 올리고 **모든 포트 콜백과 타이머 블록**(지원 조회·다운로드·리스너·낭독 끊기 대기·60초 캡·3초 상한)이 자기 세대를 확인한다. 종결·취소는 세대를 올리고 타이머를 전부 해제한다 — 늦은 콜백·옛 타이머가 새 세션에 전사를 붙이거나 새 세션을 끊지 못한다. 포트 계약: `cancel` 뒤 리스너 콜백 0(어댑터는 `destroy`로 보장, 세대 확인이 이중 방어).
- **시작**: `Starting` → `checkSupport`(지원 목록의 언어 표기는 `Locale.forLanguageTag`로 정규화해 비교 — `ko_KR`·`ko`·`ko-KR`): Installed → 청취 / NeedsDownload → `Preparing`(라벨 "음성 인식 준비 중"이 곧 신호, **통지 없음** — 같은 문장 이중 발화 방지, 마이크가 없어 `isActive` 아님) → `download`: Ready → **청취하지 않고** 통지 `android.voice.downloadReady`("음성 인식이 준비됐습니다. 다시 눌러 받아쓰세요") + `Idle`(수 분 뒤 사용자가 다른 일을 하는 중에 마이크가 켜져 탐색 낭독이 녹음되는 것을 막는다, 리뷰 R2-m3) / Scheduled → 통지 `android.voice.downloadRequested`("음성 인식 준비를 요청했습니다. 잠시 뒤 다시 눌러 주세요") + `Idle`(진행형 "준비 중"은 기다리게 만든다, R2-m8) / Failed → 통지 `android.voice.errorDownload` + `Idle` / Unsupported → 통지 `android.voice.errorOnDevice` + `Idle` / Unknown(구현이 조회 미지원) → 그대로 청취 시도.
- **청취 시작**: `Listening`(라벨 "받아쓰기 중지") → 150ms 뒤(두 프레임 포함) 세대를 확인하고 `effects.interruptScreenReader()` → `port.start` → `onReady`(세션당 1회만 반응 — 구현이 반복 호출할 수 있다)에서 한 번 더 `interruptScreenReader()` + 시작음. 대기 중(아직 `port.start` 전) 정지는 인식기를 켜지 않고 `cancel()`(소리·전달 0, R2-m2). 인식 인텐트: `LANGUAGE_MODEL_FREE_FORM`, 언어, 분할 세션 `EXTRA_SEGMENTED_SESSION = EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS` 60,000(말을 멈춰도 정지를 누를 때까지 이어 받기를 요청 — 구현이 무시할 수 있음).
  - `interruptScreenReader()` = `AccessibilityManager`가 `isEnabled`일 때만 `interrupt()` — 꺼진 기기에서 부르면 `IllegalStateException`으로 앱이 죽는다(리뷰 B2, iOS `guard isVoiceOverRunning` 대응). 이 함수 한 곳에서만 부른다(소스 가드). TalkBack은 마이크가 활성화되면 스스로도 발화를 멈추지만 한소네 자체 리더는 미확인이라 둔다.
- **녹음 중 SR 발화 0**: 세션이 활성(`isActive`)인 동안 화면은 통지 줄의 새 문장을 보류(활성화 시점 `notice`를 표시 유지, 끝나면 최신 문장 하나만 발화)하고 완료 착지를 건너뛴다(§3-4). 라벨은 청취 내내 불변.
- **정지**(Listening 토글): `stopping = true` → 정지음 → **종결 대기 상한 `STOP_FINALIZE_TIMEOUT_MS = 3000` 무장**(동기 콜백 구현에서도 순서가 맞게 `port.stop()` 앞) → `port.stop()`: 그 안에 `onEnd`·`onError`가 오지 않으면 누적분으로 종결하고 `port.cancel()`(분할 모드에서 `stopListening` 뒤 콜백을 내지 않는 구현에 버튼이 "중지"로 갇히는 것을 막는다, 리뷰 M3). **60초 캡**: 청취 60초가 지나면 같은 정지 경로(iOS엔 없는 경로 — 분할 세션을 요청하므로 생긴다, 자동 전송 없음).
- **종결은 한 곳**(`finish(text)`): 정지음을 아직 안 냈으면 한 번(자동 종료 경로에도 끝 신호) → `port.cancel()` → `Idle` → 공백 제거 뒤 `hasSpeechContent`(`:kit`)가 참일 때만 `onTranscript`(문장부호만 나온 무발화 전사 차단, iOS `stop()` 한 곳과 같은 층). 결과 소비는 이 콜백 **단일 채널**(수동 정지·캡·상한 만료·인식기 자체 종료 공통).
- **결과 조립**: `onSegment` 누적(공백 한 칸 결합) → `onEnd(finalText)`: 분할 모드면 누적, 분할 미지원 구현이면 `finalText`(`onResults` 첫 후보). 
- **오류 판정** 순수 함수 `dictationErrorOutcome(code, stopping, hasAccumulated): Outcome`:
  - `NO_MATCH`·`SPEECH_TIMEOUT`, 또는 `stopping` 중 `CLIENT` → 정상 종결(누적분).
  - `INSUFFICIENT_PERMISSIONS` → `Denied`(통지 `android.voice.denied` + 설정 열기 버튼).
  - `LANGUAGE_NOT_SUPPORTED` → `Failed(Locale)`, `LANGUAGE_UNAVAILABLE` → `Failed(OnDevice)`, `AUDIO`·`RECOGNIZER_BUSY` → `Failed(Audio)`, 그 밖 → 청취 전이면 `Failed(StartFailed)`, 청취 중이면 `Failed(Interrupted)`.
  - **Failed 종결이라도 누적분이 `hasSpeechContent`면 먼저 `onTranscript`로 전달**한다(40초 받아쓴 내용을 오류 하나로 잃지 않는다, 리뷰 M3). 누적분을 전달했으면 실패 통지는 내지 않는다(전사 통지가 결과이고 소리가 끝 신호다). 전달할 것이 없을 때만 실패 통지: `StartFailed` → `android.voice.failed`("시작하지 못했습니다"), `Interrupted` → `voice.errors.stt_failed`("음성 인식에 실패했습니다"), `Locale` → `android.voice.errorLocale`, `OnDevice` → `android.voice.errorOnDevice`, `Audio` → `android.voice.errorAudio`. 통지 뒤 `Idle`(즉시 재시도 가능).
- **취소** `cancel()`: 세대 증가, 타이머 해제, `port.cancel()`, `Idle`, 전달·통지·소리 없음. 화면 `DisposableEffect`의 onDispose가 `dispose()`(= 취소 + 효과 해제)를 부른다(탭 전환·pop = 마이크 항상 폐기, iOS `onDisappear`).
- **구성 변경**(회전·글꼴 크기·앱 언어 변경 = Activity 재생성, `configChanges` 없음): onDispose에서 `LocalActivity.current?.isChangingConfigurations`가 참이면 `dispose()` 대신 `detach()` — 청취 중이면 **정상 정지 경로**(정지음·3초 상한·누적분 전달, 전달은 살아남는 ViewModel 초안에 병합)를 밟고 끝나면 효과를 해제한다. 청취 전이면 `dispose()`와 같다. 재생성으로 커서는 잃는다(수용, 리뷰 R2-m7).
- **소리**: 시작·정지음은 `ToneGenerator(AudioManager.STREAM_SYSTEM)`(`TONE_PROP_BEEP` / `TONE_PROP_ACK`) — 기본 오디오 정책에서 `USAGE_ASSISTANCE_SONIFICATION`으로 대응돼 TalkBack이 발화를 끊지 않고(끊는 것은 NAVIGATION_GUIDANCE·ASSISTANT·ALARM 재생 시작), 새 음원 파일이 필요 없다. OEM 정책·진동/무음 모드에서의 가청 여부는 §8-10. `MediaActionSound`는 `STREAM_SYSTEM_ENFORCED`라 한국 기기에서 무음 모드도 무시할 수 있어 기각.

**버튼**(탭 토글, 헌장 §6 ⓐ): 라벨 = `Preparing`이면 `android.voice.preparing`, `Listening`이면 `voice.stop`, 그 밖 `android.voice.start`. `enabled = false` 금지. 누르면 권한이 있으면 `toggle()`, 없고 세션이 비활성이면 권한 요청.
**거부 안내**: `Denied`이면 받아쓰기 버튼 바로 뒤에 "설정 열기"(`android.common.openSettings`, `location/appDetailsSettingsIntent` + `tryStartActivity`) 버튼이 선다. 다음 시작 시도에서 사라진다(설정에서 허용하고 돌아온 경우도 받아쓰기 버튼 한 번이면 해소되므로 복귀 재판정은 두지 않는다 — §11 n8 기각).

## 7. 진입 계약

```kotlin
// chat/ChatRoutes.kt
@Serializable data class PlaceChatRoute(val placeJson: String) { val place: Place get() = ...; companion object { fun of(place: Place) } }
fun NavController.openChat(place: Place?)
```

- `place == null` → 채팅 탭 전환(`openDirections`와 같은 탭 옵션 — `popUpTo(start){saveState}`·`launchSingleTop`·`restoreState`). 대화는 이어진다.
- `place != null` → **현재 탭 스택에** `PlaceChatRoute.of(place)` push. 백스택 엔트리마다 새 ViewModel = 장소마다 새 대화. 프리필 스토어가 필요 없다(라우트 인자가 곧 앵커이고 탭 루트를 건드리지 않는다).
- **AppRoot 변경(M6, 두 줄)**: `composable<ChatRoute> { ChatTabScreen(onOpenPlace = { navController.navigate(PlaceDetailRoute.of(it)) }) }`(자리표시 교체) + `composable<PlaceChatRoute> { entry -> PlaceChatScreen(entry.toRoute(), onBack = { navController.popBackStack() }, onOpenPlace = { navController.navigate(PlaceDetailRoute.of(it)) }) }`.
- **android-m1 배선(M6 통합 뒤)**: `PlaceNav.onOpenChat: (Place) -> Unit` + AppRoot `onOpenChat = { returnFocus.slot.remember("chat"); navController.openChat(it) }` + 상세 `[M6]` 자리에 `placeChat.launch` 버튼(복귀 착지 키 `"chat"`, 버튼은 `landingTarget`으로 복귀 착지 — 그냥 `focusRequester`면 B1과 같은 이유로 실패). 채팅에서 연 상세는 "물어보기"를 숨긴다(iOS `showsChatEntry: false`, 순환 방지) — **`PlaceDetailRoute.of(place, showsChatEntry = false)` 플래그는 m1이 그 배선 때 넣고, M6의 두 `onOpenPlace`는 그 뒤 플래그를 전달한다**(그 전엔 기존 `PlaceDetailRoute.of(place)`로 push).

## 8. 실기기 판정 항목 (TalkBack 폰 · 한소네 7 키보드·점자)

도구: `adb logcat -s ChatFocus`(착지 성패), `android layout`(접근성 트리·포커스 노드).

1. 전송 → 포커스가 보내기 버튼에 머물고 "전송 중" 상태가 발화된다. 추천 질문·칩으로 전송해도 최상단 이탈이 없다(`landingTarget`이 터치 모드에서 먹는가 — M1 §8-2 전제에 종속).
2. 완료 → 성공은 마지막 질문 헤딩, 실패는 실패 블록 착지. **폰을 보지 않고 성공·실패를 가를 수 있는가.** 긴 대화(10턴+)에서도 착지(부족하면 iOS식 지연·검증·1회 재시도). 필드 입력 중·받아쓰기 중 완료는 착지 없이 완료음만.
3. 산문 블록이 각각 한 객체, 헤딩 블록이 헤딩 탐색에 잡힌다. 강조 스팬이 노드를 쪼개지 않는다.
4. 언급 1개 블록 = "…, 버튼" 한 객체이고 활성화가 상세로 간다(헤딩 + 버튼 조합 낭독 포함).
5. 언급 2개 이상 블록의 커스텀 액션이 TalkBack 작업 메뉴와 **한소네 점자 탐색**에서 닿는다(못 닿으면 보이는 버튼으로 교체 — M1 §8-8 조건).
6. 카드·블록·주소 행 → 상세 → 뒤로 → 원점 착지. 주소 지오코딩 왕복 중 탭 전환 → 유령 상세 없음. 장소 채팅 진입 → 제목 착지, 뒤로 → "물어보기" 버튼 착지(m1 배선 뒤).
7. 진행 통지가 한 번씩 발화되고(목록을 위로 올려 읽는 중에도) 답변 산문이 통지로 중복 낭독되지 않는다. 구획 헤딩(카드·출처·추가 질문)이 소음인지 발견 경로인지. (TalkBack "모든 진행 상황 업데이트 말하기"를 끈 사용자는 같은 노드 변경을 30초에 한 번만 듣는다 — 참고.)
8. 효과음(전송·완료) 음량·TalkBack 발화와의 겹침.
9. 동의 → 텍스트 필드 착지(소프트 키보드가 올라오는 것이 수용 가능한가 — 아니면 제목 헤딩).
10. 받아쓰기: 한소네 6(Android 12)에서 버튼 없음 · 한소네 7에서 `isOnDeviceRecognitionAvailable`·한국어 지원 조회 결과·온디바이스 서비스가 실제로 없을 때 어느 실패로 가는가 · 라벨 전환 낭독이 전사에 섞이지 않는다(`interrupt()` 시점, 한소네 자체 리더 포함) · 시작/정지음 음량(**진동·무음 모드 포함** — `STREAM_SYSTEM`은 벨소리 음량에 묶일 수 있다) · 분할 세션이 정지까지 이어지는가(아니면 짧은 침묵에 끊기는가) · `stopListening` 뒤 종결 콜백 지연 분포(3초 상한이 마지막 문장을 자르지 않는가 — 그 값으로 상한 확정) · `onReady` 반복 여부 · 준비 중 탭 = 취소 · 다운로드 요청·완료 통지 · 청취 중 회전 → 누적분이 초안에 남는가 · 거부 → 설정 열기 버튼.
11. **전사·받아쓰기 실패 통지**: 헤드폰 없이 10회 연속, 보내기 버튼 착지 뒤 전사 원문이(실패면 실패 문장이) 매번 끝까지 낭독된다 — `Audio`(다른 앱이 마이크 사용 중)는 무음 창이 닫히지 않을 수 있다(TalkBack은 마이크 활성 중 강제 아닌 발화를 무음 처리하므로 인식 서비스의 녹음 해제가 늦으면 잘린다). 실패 시 대안: `AudioManager.activeRecordingConfigurations`가 빌 때 게시, 또는 짧은 지연.
12. **Android 15+ 폰에서 소프트 키보드가 입력 바(필드·지우기·보내기)를 덮지 않는다**(`fitInside` IME). 지우기 → 텍스트 필드 착지. 한소네 키보드로 필드·지우기·받아쓰기·보내기 전부 도달, 물리 Enter가 전송.
13. 권한 다이얼로그 경계: 일반 채팅 첫 전송의 위치 권한, 받아쓰기의 마이크 권한 — 다이얼로그가 닫힌 뒤 커서 위치(가설 착지 없음, 실측 뒤 판정).
14. 공유 선택기가 뜨고 닫힌 뒤 포커스가 공유 버튼에 남는다.
15. (알려진 서버 결함) U+2028이 섞인 답변은 실패 문구가 된다 — iOS와 같은 증상 확인만, 우회 없음. 또 프로덕션 `/api/chat/suggestions`가 6.1초 뒤 빈 목록을 준다(2026-09-16 실측 3회, 코디네이터가 Vercel 로그로 6초 AbortError·503 확인 — 동결 해제 뒤 서버 판정). follow-up 칩 실기기 판정은 서버가 고쳐진 뒤.
16. **스트림 취소**: 장소 채팅 답변 생성 중 뒤로 → 연결 종료가 즉시인가(logcat·서버 로그), 완료음·실패 답변 0. 연결 수립 단계 취소가 `connectTimeout`까지 IO 스레드를 잡는지는 참고.

## 9. 테스트·게이트

| 층 | 내용 |
|---|---|
| JVM `ChatStreamReaderTest` | `chat-stream.ndjson` fixture를 1·7·8192바이트 청크로 읽어도 같은 이벤트, 개행 없는 마지막 줄, CRLF, 청크 경계에서 끊긴 다중 바이트, 깨진 줄은 `APIError.Decoding`, U+2028 포함 줄이 쪼개져 디코딩 오류가 되는 현행 계약(서버 결함 문서화) |
| JVM `ChatHttpTest` | 로컬 `ServerSocket` 서버: POST 본문·헤더 수신, 비-2xx 오류 본문 → `statusError`, 칩 2xx·전송 실패. **가짜 `HttpURLConnection`**(블로킹 읽기를 `disconnect`가 풀어 주는 스텁): 수집 취소 → 짧은 상한 안에 반환(감시자 disconnect·해제·취소 변환) |
| JVM `ChatViewModelTest` | 동의·빈 문자열·스트리밍 가드, `sendDraft`는 성공 때만 초안 비움·칩 전송은 초안 유지, 전송 → 효과음·상태·통지 비움, status → 통지 문장(실제 카탈로그 `CatalogStrings`), done → 답변·revision·완료음·follow-up, error 이벤트·예외 → `failed` 답변, 빈 done → emptyAnswer, **취소된 뒤 스트림이 `IOException`으로 끝나도 답변·효과음·revision 0**, 요청 본문(히스토리·일반 채팅 prime 1회·장소 채팅 prime 0·prime 예외 삼킴·placeContext·isStation·category 빈 값 생략), 전송이 칩을 비우고 늦은 제안을 버린다, 주소 해석 성공·0건(찾지 못함)·예외(확인 못함)·in-flight·취소 뒤 가드 해제, 복귀 키, 전사 병합 |
| JVM `DictationSessionTest`(가짜 `RecognizerPort`·`DictationEffects`) | 지원 판정 3갈래(설치·다운로드 Ready/Scheduled/Failed 전부 청취 없이 통지·미지원·Unknown), 언어 표기 정규화, 청취 시작 순서(interrupt → start → onReady에서 interrupt + 시작음, onReady 2회 → 1회), 분할 누적·`onEnd` 결합·비분할 `finalText`, 무발화 전사 차단, 정지 → 정지음 1회 + 3초 상한 만료 종결, 동기 콜백 포트에서 전달 1회, 60초 캡, 종결 직후 재시작 뒤 옛 타이머 무발화, 자동 종료에도 정지음 1회, **준비 중 토글 = 취소(전달 0)**·Starting 토글 무시, start 대기 중 정지 → 인식기 0·소리 0, **취소 뒤 옛 세대 콜백 무시**, 이중 정지, 오류 판정 표(`dictationErrorOutcome`)와 Failed 전 누적분 전달, Denied 뒤 재시작, `detach`(청취 중 → 정상 정지·전달 후 해제 / 청취 전 → dispose) |
| JVM `ChatInlineTest`·`AddressToPlaceTest` | 인라인 규칙 표 / 웹 `address-to-place.test.ts` 6케이스 미러 |
| JVM `ChatSourceGuardTest` | `chat/`에 줄 분리 API 0·`splitStreamLines` 사용·버퍼 ≥ 8192 / 보내기·받아쓰기 버튼에 `enabled =` 0 / 받아쓰기 세션 생성은 `speech/DictationSession.kt` `dictationSessionOrNull` 한 곳(게이트)이고 화면은 그것만 부른다 / `createSpeechRecognizer(` 0(온디바이스 강제) / `.interrupt()` 호출은 `interruptScreenReader` 한 곳이고 그 함수 안에 `isEnabled` / 채팅 화면이 복귀 슬롯을 실제로 부른다(`rememberReturnFocus`·`takeReturnFocus`) / 도구·출처 라벨 표가 iOS 표와 같은 키 전수. (착지 부착 규율은 main `AppSourceGuardTest`가 앱 전체에서 `a11y/` 두 관용구로 잠근다) |
| androidTest `ChatScreenA11yTest`(ATF 레인, adb 연결 시) | 동의 → 필드 `assertIsFocused` → 추천 질문 클릭 → **보내기 버튼 `assertIsFocused`**(계측 테스트는 터치 모드라 B1을 빨갛게 만든다) → 스텁 스트림 완료 → 질문 헤딩 `assertIsFocused` → 블록·카드 행이 단일 노드이고 ATF 검사 통과. 필드에 입력 중 완료 → 필드 포커스 유지, 스텁 실패면 `status` 노드 텍스트 = 실패 문장 |
| 실호출 게이트(수동, 환경변수 `GILDONGMU_REAL_CALL=1`일 때만) | 프로덕션 `/api/chat` 1회(장소 카드가 나오는 질의)·`/api/chat/suggestions` 1회 — `ChatStreamSource`가 status ≥ 1·done·renders를 실제로 받는가 |
| 머신 게이트 | README §7(락 안) |

## 10. 판정 기록

| # | 판정 | 기각한 대안·근거 |
|---|---|---|
| 1 | 장소 채팅은 스택 라우트 push(엔트리마다 새 대화) | 프리필 스토어 + 채팅 탭: 탭의 일반 대화와 장소 대화가 한 모델에 섞인다 |
| 2 | 받아쓰기 세션은 `speech/` 새 파일(코디네이터 승인), 인식기는 포트로 감싼다 | `chat/` 안: 검색·길찾기 마이크가 복제한다. 포트 없이: 세션 상태 머신이 실기기에서만 검증된다 |
| 3 | 언급 2개 이상은 커스텀 액션만, 인라인 링크 없음 | `LinkAnnotation`: 링크마다 포커스 노드가 서서 블록이 쪼개진다 |
| 4 | follow-up 묶음은 구획 헤딩 | iOS 컨테이너 라벨: TalkBack에 컨테이너 진입 낭독이 없다 |
| 5 | 실패는 **실패 블록 착지**로 가르고, 착지를 건너뛴 실패만 통지 줄에 실패 문장 — 헌장 §6 "완료 시 질문 헤딩"의 **안드로이드 편차**(실패만, 결과 진동 도입 시 재검토, 실기기 §8-2 뒤 참조 문서 반영 여부는 위원장 판정) | 질문 헤딩 착지 + 실패 통지: 착지 낭독과 같은 문장이 연달아 발화. assertive 통지: 같은 이중 발화. 결과 진동: M2b ㉓ 설정 마일스톤. 실패 전용 완료음: 음원 추가·iOS 비대칭 |
| 6 | 받아쓰기·보내기 버튼은 보이는 텍스트 라벨 | 아이콘 버튼: 코어 아이콘에 마이크가 없어 의존성 추가가 필요하다 |
| 7 | 라벨 변경 낭독 차단은 `isEnabled` 확인 뒤 `AccessibilityManager.interrupt()` | 빈 문자열 통지: 안드로이드엔 "끊기만 하고 발화 0"인 게시 수단이 이것뿐이다 |
| 8 | 받아쓰기 실패는 인라인 통지 + (거부만) 설정 열기 버튼 | 다이얼로그: M2·M3 해결 버튼 관용구와 어긋나고 창 전환 포커스 복귀가 실기기 미검증 |
| 9 | 세션 활성(Starting·Listening) 중 통지·완료 착지 보류(건너뛴 착지는 소비, 실패는 세션 끝에 통지) | 헌장 §6 "녹음 중 SR 발화 0". Preparing은 마이크가 없어 보류하지 않는다 |
| 10 | 주소 카드 → 지오코딩 → 상세(착수 프롬프트, 웹 동작) | iOS는 복사 액션만. 상세가 주소 복사 버튼을 이미 가진다 |
| 11 | 버튼 착지 대상은 `focusProperties { canFocus = true }` | 그냥 `focusRequester`: Compose 1.12 `clickable`은 터치 모드에서 포커스 불가 |
| 12 | 준비 중 받아쓰기 탭 = 취소, 다운로드가 필요했던 세션은 끝나도 청취하지 않고 "다시 눌러 주세요" | iOS "다운로드 뒤 이어서 청취"·"준비 중 탭은 시작 완료 뒤 정지": 수 분 뒤 사용자 의사와 무관하게 마이크가 켜져 탐색 낭독이 녹음된다 |
| 13 | 받아쓰기 60초 캡·정지 뒤 3초 종결 상한 | 캡 없음: 분할 세션 요청으로 무기한 청취가 가능해진다. 상한 없음: 콜백을 내지 않는 구현에서 "중지"에 갇힌다 |
| 14 | 시작·정지음은 `ToneGenerator(STREAM_SYSTEM)` | `MediaActionSound`(무음 모드 무시 가능)·새 음원 파일(미니멀) |
| 15 | 청취 중 구성 변경은 정상 정지(누적분 초안 병합) | 취소: 회전 한 번에 긴 전사가 소리 없이 사라진다. 세션을 ViewModel로 올리기: 탭 이탈 취소를 화면이 따로 챙겨야 한다 |
| 16 | `emptyAnswer`("답변을 준비하지 못했습니다")는 성공 갈래(질문 헤딩 착지·follow-up) | iOS 동형 — 서버가 `done`을 보냈다. 실패처럼 들리는지는 실기기 참고 |

## 11. 설계 리뷰 (2026-09-16)

1차(`~/gildongmu-wt/android-m6-reports/review-m6-design.md`, 기준 89a7bcf6): **REQUEST_CHANGES** — BLOCKER 2·MAJOR 5·MINOR 15·NIT 11.

| 항목 | 처리 |
|---|---|
| B1 버튼 착지 터치 모드 실패 | 반영 — `landingTarget`(§3-4)·Boolean 로그·androidTest `assertIsFocused`·소스 가드. **M1 `SearchScreen` 검색 버튼 착지도 같은 결함**이라 코디네이터 전달 |
| B2 `interrupt()` 크래시 | 반영 — `isEnabled` 가드 한 곳 + 소스 가드 |
| M1 취소가 실패로 새어 나감·실행 규칙 | 반영 — 종료 절차 `ensureActive`, IO 디스패처, 감시자 `finally`, `errorStream` null, `ChatHttpTest` |
| M2 완료 착지가 입력 중 필드를 뺏음 | 반영 — 착지 조건 ④ + 소비 |
| M3 정지 뒤 고착·오류 시 누적 유실 | 반영 — 3초 상한, Failed 전 누적분 전달, `dictationErrorOutcome(code, stopping, hasAccumulated)` |
| M4 성공·실패 신호 부재 | 반영 — 실패 블록 착지(판정 5), §8-2 |
| M5 테스트 검출력 | 반영 — 인식기 포트 + `DictationSessionTest`, 포커스 단언, 가드 확장 |
| m1 준비 중 탭 | 반영 — 취소(판정 12) |
| m2 착지·통지 보류 조건 | 반영 — `isActive` + 소비 |
| m3 준비 중 이중 발화 | 반영 — 통지 삭제 |
| m4 다운로드 예약 ≠ 실패 | 반영 — Scheduled는 `android.voice.preparing` 통지 + Idle(새 키 없음) |
| m5 전사 통지 무음 창 | 반영 — §8-11 합격 기준·대안 |
| m6 "착지가 낭독을 끊는다" 오류 | 반영 — §4-3 문장 정정, 판정 5 근거에서 삭제 |
| m7 오디오 속성 | 반영 — SONIFICATION 명시, 받아쓰기음은 `ToneGenerator(STREAM_SYSTEM)`(판정 14). M4 안내음 usage 함정은 코디네이터 전달 |
| m8 초안 비움 규칙 | 반영 — `sendDraft` 성공 때만, 추천·칩은 초안 유지 |
| m9 스크린 리더 없을 때 스크롤 | 반영 — 전송 시·착지를 건너뛴 완료 시 끝으로 스크롤 |
| m10 인식기 API 세부 | 반영 — 콜백 세대 확인, 메인 실행기, 언어 표기 정규화, §8-10 |
| m11 자동 종료에 정지음 없음 | 반영 — 종결 한 곳에서 1회 |
| m12 장소 채팅 진입 착지·복귀 키 | 반영 — §3-4 행, §7 m1 배선 키 `"chat"` |
| m13 권한 다이얼로그 경계 | 반영 — §8-13 실측(가설 착지 없음) |
| m14 개인정보 공개 문구 | 반영 — §1 범위 밖, BACKLOG 등재를 코디네이터에 요청 |
| m15 포커스 관측 수단 | 부분 반영 — 착지 성패 로그(`ChatFocus`)와 `android layout`. 접근성 이벤트 가로채기 관찰자는 확인 필요 사항이라 실측에서 부족하면 추가 |
| n1 선택기 실패 분기 | 반영 — 분기 삭제 |
| n2 전사 통지 잔존 | 반영 — 전송·지우기에서 통지 비움 |
| n3 m1 소유 KDoc 낡음(`Dictation.kt` "권한 선언 0", `LocationStore` "권한 요청은 내 주변에서만") | 코디네이터 전달 |
| n4 지오코딩 0건 ≠ 실패 문장 | 반영 — 예외는 `directions.coordError` |
| n5 취소선·이스케이프·URL 버림 기록 | 반영 — §3-5 |
| n6 복귀 키 충돌 | 반영 — 묶음 인덱스 |
| n7 `AddressToPlace` 위치 | 반영 — §2 한 줄 |
| n8 설정 복귀 재판정 | **기각** — 받아쓰기 버튼 한 번으로 해소되고, 재판정은 포커스를 쥔 버튼이 사라지는 전이를 새로 만든다 |
| n9 진행 업데이트 설정 | 반영 — §8-7 참고 |
| n10 prime 예외·단위 | 반영 — §4-1 |
| n11 동의 착지 시점 | 반영 — §3-2 |

2차(`~/gildongmu-wt/android-m6-reports/review-m6-design-r2.md`, 기준 78cc20c5): **APPROVE_WITH_CHANGES** — 1차 33건 중 해결 26·부분 6·기각 타당 1, 신규 MAJOR 1·MINOR 8·NIT 11. 반영: R2-M1(건너뛴 실패 통지·받아쓰기 중 결합), R2-m1(타이머 세대 확인·종결 공통 정리·상한 무장 순서·`onReady` 1회·포트 계약), R2-m2(start 대기 중 정지 = 취소), R2-m3(다운로드 뒤 청취하지 않음, Preparing은 보류 대상 아님), R2-m4(실패 착지 근거 정정·헌장 편차 명시 → 코디네이터 보고), R2-m5(§9 가짜 연결·§8-16), R2-m6(착지 관용구 `a11y/Landing.kt` 승격 완료·§7 "물어보기" `landingTarget`), R2-m7(구성 변경 `detach`), R2-m8(다운로드 요청·완료 문구 신규 키 2개), n1(Starting 탭 무시), n2(부착 가드는 main이 앱 전체로), n3(SoundPool 속성 §2), n4(한 프레임 뒤 스크롤), n5(판정 16), n6·n7·n9(§8), n8(전사 착지가 완료 착지 소비), n10(Failed phase 삭제), n11(표기 — 묶음 인덱스는 키 안의 `r`, 동기 착지 예외 머리말). 재리뷰 없이 구현 진행(리뷰어 권고).

조각 ① 구현 리뷰(`~/gildongmu-wt/android-m6-reports/review-m6-slice1.md`, 기준 5718d72e): **APPROVE_WITH_CHANGES** — MAJOR 1·MINOR 7·NIT 7. 반영: M1(IME `fitInside`), m1(표시줄 답변 뒤 갱신), m2(진입 착지 push당 1회·동의 무관 제목 — spec 표 정정), m3(감시자 `UNDISPATCHED`·쓰기/응답 앞 `ensureActive` + 연결 직후 취소 테스트), m4(`***`·비링크 대괄호), m5(동의 IO 첫 읽기·미확정 3-state), m6(진행 통지 단계별·seq 단언), m7(측위 뒤 좌표 읽기·follow-up 인자 단언), n1(소비 세대를 화면 상태로), n2(통지 줄 스크롤 밖), n3(스크롤을 메시지 수 효과로), n4(프롬프트 표 kit 전수 가드), n6(서버 테스트 상한·오류 본문 없음·고정 길이·타임아웃 단언), n7(U+2028 표기·OptIn 통일). n5(화면의 `rememberReturnFocus` 호출 가드)는 조각 ②에서 호출이 생길 때 조인다. `nav/PlaceholderScreen.kt` 호출부 0은 코디네이터 전달.
