# 안드로이드 M6 — 채팅(AI에게 질문) 설계

> 입력: 병렬 계획 `docs/superpowers/plans/2026-09-16-android-app-parallel-plan.md` §5-4·§5-5(M6 착수 입력), 판정 문서 `2026-09-15-android-app-decisions.md` §1·D5·D7·D9·D10, 접근성 헌장 §5·§6(+ `~/.claude/reference/accessibility.md` 대화형 UI 절·받아쓰기 불변식), iOS 원본 `ios/Gildongmu/Chat/**`·`SpeechService.swift`·`HoldDictationButton.swift`(탭 토글 갈래), `:kit` CORE 채팅 파일(`core.json` note가 D5 경계의 정본).
> **리뷰 게이트 판정**: 적대적 설계 리뷰 **필요** — 새 상태 머신(대화·받아쓰기 세션)·포커스 계약·외부 통합의 계약 가정(NDJSON 스트림 전송, 온디바이스 인식기)을 담는다.
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
- **결과 진동**(iOS 성공·실패 햅틱): M2b 판정 ㉓ — 설정 화면 마일스톤.
- **받아쓰기 홀드 방식**: 설정 화면 마일스톤(iOS에서도 설정 선택지). M6는 탭 토글만.
- **세션 유휴 리셋**(iOS `resetChatModel`): 안드로이드에 앱 유휴 리셋 기제가 아직 없다.
- **수동 위치**(M2c): `userLocation`은 GPS 저장 좌표만. 자리 주석.
- **안내 출력 억제 연동**(iOS `GuideSession.setDictationActive`): M4가 `DictationSession.isActive`를 관찰해 붙인다.
- **채팅 탭 첫 줄 위치 표시줄**: M2b `location/LocationBarRow`가 통합 시점 `main`에 있으면 호출, 없으면 자리 주석(코디네이터 판정 7).
- 서버 결함(A44 후보, U+2028·U+2029·U+0085 날 문자가 이벤트 줄을 쪼갠다): **우회하지 않는다.** 클라이언트는 `splitStreamLines` 계약대로 동작하고 iOS와 같은 증상(그 답변은 실패 문구)이 난다.

## 2. 구조

```
[4] 화면      chat/ChatScreen.kt(탭·장소 화면 + 공용 대화 본문) · ChatMessages.kt(말풍선·블록·카드·출처·칩)
              chat/ChatConsent.kt(동의 저장소 + 동의 본문)
[3] 실행      chat/ChatHttp.kt(POST 한 곳 + 취소 시 disconnect) · ChatStream.kt(스트림 소스 + 순수 리더 readChatStream)
              chat/ChatSounds.kt(SoundPool) · speech/DictationSession.kt(온디바이스 인식기 세션)
[상태]        chat/ChatViewModel.kt(대화 상태 머신) · ChatStrings.kt(문장 람다 + 도구·출처 라벨 리터럴 표)
              chat/ChatInline.kt(블록 인라인 마크다운 → AnnotatedString, 순수) · chat/AddressToPlace.kt(웹 jusoAddressToPlace 미러, 순수)
[진입]        chat/ChatRoutes.kt(PlaceChatRoute + NavController.openChat) · ChatFactories.kt(ViewModel 팩토리)
[2] :kit      ChatService·ChatSuggestionsService·ChatMarkdown·ChatPlaceMentions·PlaceChatPrompts·ChatModels(무수정)
res/raw       chat_send.mp3 · chat_receive.mp3 (iOS `Resources/chat-send.mp3`·`chat-receive.mp3` 바이트 동일 사본)
```

판단 근거: 판정은 `:kit`, `chat/`은 전송·상태·조립만(D5). 전송(HTTP)·리더(순수)·상태 머신·화면을 파일로 갈라 리더와 ViewModel을 JVM에서 잠근다.

## 3. 화면 계약

### 3-1. 공통 골격(읽기 순서 = 표 순서)

| # | 요소 | 접근성 계약 |
|---|---|---|
| 1 | 상단 바(`AppScreenScaffold`) | 탭: 제목 `android.tab.chat`, 뒤로 없음. 장소: 제목 = 장소 이름(`bilingualName(...).primary`), 뒤로 있음. 제목은 헤딩(기존 `AppTopBar`) |
| 2 | (탭만) 위치 표시줄 | M2b `LocationBarRow` 자리(§1). 장소 채팅엔 **두지 않는다** — 장소 좌표가 앵커라 표시줄이 거짓 신호가 된다(iOS `showsLocationBar: false`) |
| 3 | 동의 전: 동의 본문(§3-2) / 동의 뒤: 대화 목록(§3-3) | 세로 스크롤 `Column`(가상 스크롤 금지 — 헌장 §1, iOS LazyVStack 금지와 같은 결론) |
| 4 | 통지 줄 `StatusLine(notice)` | 화면의 **단일 polite 창구**. 진행 문장·주소 좌표 실패·받아쓰기 결과·공유/열기 실패가 전부 여기로. 목록 끝(입력 바 바로 위)에 두고, 스트리밍 중엔 왼쪽에 진행 표시(`CircularProgressIndicator`, `clearAndSetSemantics {}` — 시각 전용) |
| 5 | 입력 바(스크롤 밖, 하단 고정) | 1행: 텍스트 필드(라벨 `chat.inputLabel`, 한 줄, IME 동작 `Send`, `TextFieldState`는 ViewModel 소유) + 초안이 있을 때만 끝의 지우기 아이콘 버튼(`android.chat.clear`). 2행: 받아쓰기 버튼(게이트 통과 시만, §6) + 보내기 버튼(`chat.send`). 읽기 순서 필드 → 지우기 → 받아쓰기 → 보내기(iOS 동형). 버튼은 **보이는 텍스트 라벨**(아이콘만 버튼은 코어 아이콘에 마이크가 없고, 텍스트면 라벨 = 이름이라 ARIA 대응물 불필요) |

### 3-2. 동의 본문(iOS `ChatConsentView` 미러)

제목 `android.chat.consentTitle`(헤딩) → `consentData` → `consentAiNotice` → `consentAlt`(각 `mergedRow` 한 객체) → 버튼 `android.common.privacyPolicy`(`{API_BASE_URL}/{AppLocale.current}/privacy`를 `ACTION_VIEW`, 실패는 통지 `android.common.noAppToOpen`) → 버튼 `android.chat.consentAgree`.
동의 누름 → `ChatConsentStore.grant()`(저장 + `StateFlow` 갱신 — 열린 탭·장소 화면이 함께 전환) → **그 화면만** 한 프레임 뒤 텍스트 필드로 착지(사라진 동의 버튼에서의 이탈 차단, 헌장 §5; iOS `focusDraftOnAppear`). 저장은 `SharedPreferencesStore(app, "gildongmu.chat")` 키 `aiChatConsent` = `"true"` — 실험판·정식판은 applicationId가 달라 저장이 자동으로 갈린다(iOS 앱별 UserDefaults 동형). 미결정·거부를 구분하지 않는다(iOS와 같다).

### 3-3. 대화 목록

**빈 대화**: 추천 질문 버튼만(설명 문장 없음 — 버튼이 곧 설명). 탭 = `android.chat.suggestion1~4`, 장소 = `placeChatPromptKeys(place)`의 3개. 누르면 전송(§3-4 전송 경로). 첫 전송 뒤 사라진다.

**질문(사용자 턴)**: 원문 그대로 한 객체, **헤딩**(`mergedRow("question-<id>", focus = r).headingText()`). 마크다운 해석 없음. 완료 착지 대상.

**답변(어시스턴트 턴)**, 위에서 아래로:
1. 산문: `parseChatMarkdownBlocks(text)` 블록마다 한 객체(`mergedRow`). 블록이 0개면 원문 한 객체. 헤딩 블록은 `headingText()` + 제목 스타일. 표시 텍스트는 `ChatInline`(§3-5)이 강조 기호를 걷은 `AnnotatedString`(스팬은 노드를 쪼개지 않는다).
   - 장소 언급 = `chatPlaceMentions(block.text, 이 답변의 Places 렌더 장소 전부)`.
   - **0개**: 평문 객체.
   - **1개**: 블록 전체가 버튼(`clickable(role = Button)` + `mergedRow`) → 장소 상세. 이름 구간만 강조색(시각). 커스텀 액션 없음(잉여). 헤딩 블록이면 헤딩 + 버튼이 한 노드에 함께 선다.
   - **2개 이상(드묾)**: 블록은 평문 한 객체 + `customActions`에 장소마다 `android.chat.openPlace`(`bilingualName(...).primary`), 산문 등장 순. 이름 구간은 강조색. **인라인 링크(`LinkAnnotation`)는 쓰지 않는다** — 링크마다 포커스 노드가 따로 서서 블록이 쪼개진다(한 줄 = 한 객체 위반). 시각 사용자는 아래 카드로 연다(카드가 안전망, iOS 주석과 같은 한계). ⚠ 실기기 판정 §8-5: 한소네 점자 탐색이 커스텀 액션에 못 닿으면 블록 아래 보이는 버튼으로 바꾼다(M1 §8-8 조건 승계).
2. 렌더 묶음(`renders` 순서대로), 비지 않은 묶음마다 **구획 헤딩**(수 포함) 뒤 행:
   - `Places(sort=accuracy)` → `android.chat.placesHeading`(N) / `Places(sort=review)` → `chat.reviewPlacesHeading`(N). 행 = `search.PlaceRow(place, lang, spokenMeters, onClick)` → 상세. (nearby 4종은 `:kit`이 `places` 투영으로 이미 `Places`로 바꾼다.)
   - `Addresses` → `android.chat.addressesHeading`(N). 행 = `search.AddressRow`에 `clickable(role = Button)` 수식자를 넘긴다(`PlaceRow`와 같은 순서) → 지오코딩 → 상세(§4-4).
   - `WebResults` → `android.chat.webResultsHeading`(N). 행 = `search.WebRow`(http/https만 브라우저).
   - `Unsupported` → 없음(산문이 정본).
3. 출처(있을 때만): 헤딩 `android.chat.sourcesHeading` + 행. 라벨 = `source.<id>` → `chat.source.<id>` 리터럴 표(미지 라벨은 원문 — 키 누락이 화면에서 드러난다, iOS 동형). url이 http/https면 버튼(브라우저), 아니면 평문 객체.
4. 응답 액션 행: 공유 아이콘 버튼(`Icons.Filled.Share`, 이름 `android.chat.share`) → `ACTION_SEND` text/plain = 답변 원문(`message.text`), 선택기. 처리 앱 없음은 통지 `android.common.noAppToOpen`. `// [M4 뒤] 듣기` 자리.

**follow-up 칩**: 마지막 답변이 성공이고 제안이 있을 때만, 그 답변 뒤에 구획 헤딩 `android.chat.followUps` + 버튼들. 도착 통지 없음(조용히 생기는 보조 컨트롤 — 헤딩으로 발견). iOS는 컨테이너 라벨이었으나 TalkBack에는 컨테이너 진입 낭독이 없어 **헤딩이 발견 경로의 대응물**이다(카드·출처 구획 헤딩과 같은 모양). 누르면 전송.

### 3-4. 포커스 계약(헌장 §6 → Compose)

착지 관용구는 M1~M3와 같다: 대상 `FocusRequester`를 `focusable` **앞**에 붙이고(`mergedRow(focus = r)` 또는 `Modifier.focusRequester(r).clickable(...)`), 상태 변화 뒤 `withFrameNanos {}` 한 프레임 뒤 `runCatching { r.requestFocus() }`(실패는 `Log.w("Chat", ...)`). 목록이 eager `Column`이라 화면 밖 노드도 트리에 있고 `focusable`의 bring-into-view가 스크롤한다(iOS의 컬링·400ms 재시도 시퀀스가 필요 없는 이유 — 실기기 판정 §8-2).

| 사건 | 포커스 | 근거 |
|---|---|---|
| 전송(보내기 버튼·IME 전송·추천 질문·follow-up 칩 — **전부 화면의 `submit(text)` 한 함수**) | `vm.send(text)`가 받아들였을 때만 **같은 핸들러에서 동기로** 보내기 버튼 착지 | 누른 추천·칩이 다음 프레임에 사라진다 — 사라지기 전에 안정 요소로 선점(헌장 §5). 입력 포커스가 필드를 떠나 소프트 키보드가 내려간다(수용 — 다음 행동은 답변 듣기) |
| 스트리밍 중 | 보내기 버튼 유지. 클릭은 무시(핸들러 가드 + ViewModel in-flight 가드), `enabled = false` 금지, `stateDescription = android.chat.sending` | M1 검색 버튼 관용구(disabled는 포커스를 떨군다). 포커스를 쥔 노드의 상태 설명 변화는 TalkBack이 즉시 발화 |
| 완료(성공·실패 공통) | 마지막 **질문 헤딩** 착지. 조건: `answerRevision`이 이 화면 진입 시 값보다 크고, 아직 소비 안 했고, 스트리밍 중이 아니고, **받아쓰기 청취 중이 아니다** | 헌장 §6. 진입 시 값을 `remember`로 잡아(StatusLine `initialSeq`와 같은 꼴) 다른 탭에 있는 동안 끝난 답변이 복귀 때 포커스를 끌어가지 않게 한다(iOS `.task(id:)` 금지 사유와 같다). 청취 중이면 발화가 마이크에 섞이므로 건너뛰고, 곧 올 전사 착지(보내기 버튼)가 대신한다 |
| 지우기 | 초안 비움 + 텍스트 필드 착지(같은 핸들러) | 지우기 버튼이 자신을 없앤다 |
| 동의 | 텍스트 필드(§3-2) | |
| 받아쓰기 전사 도착 | 초안에 병합 → 보내기 버튼 착지 → 통지(병합 원문) | 헌장 §6 받아쓰기 완료(포커스 먼저, 통지 나중 — polite라 TalkBack이 포커스 낭독 뒤에 잇는다) |
| 장소 상세에서 pop 복귀 | 연 원점(카드 행 `card-<msg>-<place.id>`·언급 블록 `block-<msg>-<index>`·주소 행 `address-<msg>-<roadAddr>`) | `ReturnFocusSlot`(ViewModel `SavedStateHandle`) — 기존 관용구. 소비는 `LaunchedEffect` 안에서 한 번 |

### 3-5. 인라인 마크다운(`ChatInline.kt`, 순수)

`chatInlineText(text: String): ChatInlineText(plain: String, bold: List<IntRange>, code: List<IntRange>)` — 화면이 `AnnotatedString`으로 옮긴다(스팬 조립만 Compose). 규칙: `**x**`·`__x__` → 굵게, `` `x` `` → 고정폭, `[label](url)` → label(URL 버림, 링크 없음), `*x*`는 여는 `*` 뒤와 닫는 `*` 앞이 공백이 아닐 때만 기울임으로 보고 기호를 걷는다(`_x_`는 걷지 않는다 — snake_case 오인). 짝 없는 기호는 원문 유지. 장소 이름 강조 구간은 `plain` 안에서 이름을 찾아 칠한다(언급 판정 자체는 `:kit`이 원문 블록으로 한다). 정규식 약칭 클래스 금지(README §3).

## 4. 상태 머신 `ChatViewModel`

```kotlin
data class ChatMessage(val id: Long, val role: Role, val text: String,
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
) : ViewModel()
```

### 4-1. `send(text): Boolean`

1. `trimmed` = 앞뒤 공백·개행 제거. **가드**: `consent.granted.value` 아님 / 빈 문자열 / `isStreaming`이면 `false`(동의 가드는 UI 게이트가 뚫려도 전송을 구조적으로 막는다 — iOS 이중 방어).
2. follow-up 조회 취소·칩 비움 → 사용자 메시지 추가 → `sounds.send()` → `isStreaming = true` → `true` 반환(화면이 보내기 버튼 착지).
3. 스트림 잡(`viewModelScope`):
   - **일반 채팅만** `location.prime()`(= `LocationStore.currentCoordinate(timeoutMs = softTimeout)`, `LocationException`은 삼킨다). 첫 사용이면 권한 다이얼로그가 뜬다 — iOS 계약 그대로(위치는 필수가 아니다, 실패해도 계속). 장소 채팅은 측위를 트리거하지 않고 저장 좌표만.
   - 본문 `ChatRequestBody(messages = 전체 히스토리(실패 문구 포함, iOS 동형), userLocation = location.last(), locale = lang(), placeContext = place?.let { PlaceContext(name, lat, lng, category.ifEmpty { null }, isStation(it)) })`. `userLocation`: 장소 앵커 > (M2c 수동 위치 자리) > GPS 저장 좌표 — 길찾기 출발지는 서버가 이 필드를 쓴다(장소로 덮지 않는다).
   - `stream.events(body).collect`: `Status` → 진행 통지(§4-3), `Done` → 보관, `Error` → 실패 표시, `Unknown` → 무시. 수집 중 예외(`APIError`·`IOException`·디코딩)는 실패(`CancellationException`은 다시 던진다).
   - 종료: 통지 비움(`Notice(seq+1, "")`) → `isStreaming = false` → `Done`이 있고 실패 표시가 없으면 답변 추가(빈 `text`는 `android.chat.emptyAnswer`), 아니면 `android.chat.failed` 답변 추가 → `sounds.receive()`(성패 무관 턴 경계 신호) → `answerRevision++` → 성공이면 follow-up 조회.
4. `onCleared`는 `viewModelScope` 취소로 스트림·follow-up·지오코딩을 함께 끊는다(장소 채팅 pop = iOS 시트 dismiss 취소). 탭 채팅은 탭 전환에 취소하지 않는다.

### 4-2. follow-up

직전 질문·답변 한 쌍 + `lang()` + `place?.name`으로 `suggestions.fetch`. 결과는 조회 잡이 살아 있을 때만 커밋(전송·취소가 잡을 취소한다). 실패·비-2xx·디코딩 불가는 전부 빈 목록(`ChatSuggestionsService.followUps`), 취소만 전파.

### 4-3. 진행 통지

라벨 = `categories.map(strings.toolLabel)`(19개 리터럴 표, 미지 키는 원문) 쉼표 결합. 비면 `android.chat.progressFallback`, 아니면 `chat.progress.searching`(labels). `Notice(seq+1, 문장)` — status 이벤트당 1회. 답변 산문은 통지하지 않는다(포커스 이동이 곧 통지, 헌장 §5 복제 금지). **실패도 따로 통지하지 않는다**: 실패 문구가 답변 자리에 들어가고 질문 헤딩 착지 다음 스와이프에서 읽힌다(iOS 동형). 착지 자체가 진행 중 낭독을 끊는다.

### 4-4. 주소 카드 열기 `suspend fun resolveAddress(address: JusoAddress): Place?`

화면이 **자기 컴포지션 스코프**(`rememberCoroutineScope`)에서 부른다 — 탭 전환·pop으로 화면이 컴포지션을 떠나면 스코프가 취소되어 늦은 결과로 상세를 열지 않는다(웹 `aliveRef` 동형). in-flight 가드(진행 중 재탭 무시, `finally`에서 해제 — 취소 경로 포함). 질의 = `roadAddrPart1` 비면 `roadAddr`. 매칭 0 또는 예외 → 통지 `search.addressCoordFailed` + null. 성공 → `jusoAddressToPlace(address, match, dataLocale())`(웹 `src/lib/address-to-place.ts` 미러: id `juso-<roadAddr>`, 이름 = `bdNm` 비면 도로명, 영문 주소는 en일 때만) → 화면이 원점 키를 기억하고 상세를 연다.

### 4-5. 받아쓰기와의 접점

`mergeDraft(transcript): String`(초안 공백뿐이면 전사만, 아니면 `초안 + " " + 전사`; 초안 교체) · `announce(text)`(통지). 스트리밍 중에도 병합만 한다(자동 전송 없음 — 탭 토글 계약).

## 5. 전송

### 5-1. `ChatHttp.post(url, body, timeoutMs, read: (status, stream) -> T): T`

`HttpURLConnection` POST 한 곳(스트림·follow-up 공용). `Content-Type: application/json`, 고정 길이 본문, `connectTimeout = readTimeout = timeoutMs`(URLSession `timeoutInterval`과 같은 **유휴** 상한 — 채팅 180초·칩 6초, `:kit` 상수). 블로킹 읽기는 코루틴 취소를 보지 못하므로 **감시 코루틴**이 취소 시 `disconnect()`해 읽기를 즉시 깨운다(정상 종료 시 감시자 취소). 상태 코드는 `read`에 넘기고 2xx가 아니면 `errorStream`을 넘긴다. `:app` `net/HttpUrlConnectionTransport`(GET 전용, 소유 밖)는 건드리지 않는다.

### 5-2. `ChatStreamSource.events(body): Flow<ChatStreamEvent>` (`channelFlow`)

POST `ChatService.path`, 비-2xx는 오류 본문을 모아 `ChatService.statusError`로 던진다. 2xx는 `readChatStream(input) { send(it) }`.

### 5-3. `readChatStream(input, emit)` — 순수 리더

읽기 버퍼 `STREAM_READ_BUFFER_BYTES = 8192`(§5-5 계획 입력: `splitStreamLines`가 꼬리를 매번 재스캔한다). 루프: `read` → `remainder + chunk`를 `ChatService.splitStreamLines(buf, endOfStream = false)` → 줄마다 `ChatService.eventFromStreamLine`(빈 줄 null은 건너뜀) → `emit`. EOF에서 `endOfStream = true`로 한 번 더. 매 루프 `ensureActive()`. 깨진 줄은 `APIError.Decoding`이 그대로 올라가 스트림 실패가 된다(iOS 동형 — 앞서 `Done`을 받았어도 실패). **줄 분리를 앱에서 새로 쓰지 않는다**(`readLine`·`lineSequence`·`BufferedReader` 금지 — 소스 가드).

### 5-4. `ChatSuggestionsSource.fetch(...)`

POST `ChatSuggestionsService.path`, 본문 `ChatSuggestionsService.encodeBody`, 전량 읽기 → `ChatSuggestionsService.followUps(status, body)`. 전송 예외는 빈 목록, 취소는 전파.

## 6. 받아쓰기 `speech/DictationSession.kt`

**게이트**: 화면이 `Dictation.isAvailable(context)`(API 33 + 온디바이스 인식 가능)일 때만 버튼·세션을 만든다. 아니면 버튼·세션 0(D9, 한소네 6 = 버튼 없음).

**온디바이스 강제**: `SpeechRecognizer.createOnDeviceSpeechRecognizer`만 쓴다(서버 인식 폴백 금지 — 개인정보 신고 "오디오 미수집"이 이 한 줄에 걸린다). 언어 태그 = 앱 언어(ko-KR·en-US·es-ES·fr-FR·it-IT·ja-JP, iOS `speechLocaleIdentifier` 미러, 자동 감지 금지).

```kotlin
sealed class DictationPhase { Idle; Starting; Preparing; Listening; Denied; Failed(kind: DictationFailure) }
enum class DictationFailure { Locale, OnDevice, Download, Audio, Generic }
class DictationSession(context, languageTag: () -> String, onTranscript: (String) -> Unit) {
    val phase: StateFlow<DictationPhase>
    val isActive: StateFlow<Boolean>      // Starting·Preparing·Listening — M4 안내 억제 연동 지점
    fun start(); fun stop(); fun cancel(); fun markDenied(); fun reset(); fun destroy()
}
```

- **권한**: 화면이 `rememberLauncherForActivityResult(RequestPermission())`로 `RECORD_AUDIO`를 묻는다(허용 → `start()`, 거부 → `markDenied()`). 세션은 권한을 가정한다(`ERROR_INSUFFICIENT_PERMISSIONS`도 `Denied`).
- **시작** `start()`(Idle·Denied·Failed에서만, 세대 토큰 증가 캡처): `Starting` → `checkRecognitionSupport`: 설치됨 → 청취 시작 / 지원·대기(다운로드 필요) → `Preparing`(라벨 "음성 인식 준비 중" + 통지 1회, 마이크가 뜨거워지기 전) → API 34+ `triggerModelDownload(listener)` 성공이면 청취 시작, 오류·`onScheduled`는 `Failed(Download)`; API 33은 다운로드만 걸고 `Failed(Download)` / 목록에 없음 → `Failed(OnDevice)` / 조회 오류(구현 미지원) → 그대로 청취 시도(이후 오류 코드로 판정). 각 비동기 경계 뒤 세대가 바뀌었으면(취소가 다녀갔으면) 조용히 정리하고 끝낸다(iOS 세대 가드).
- **청취 시작**: 상태 `Listening`(버튼 라벨이 "받아쓰기 중지"로 바뀐다) → 두 프레임 + 150ms 뒤 **`AccessibilityManager.interrupt()`**(라벨 변경 낭독을 끊는다 — iOS 빈 문자열 `.high` 통지의 안드로이드 대응물. 발화 문자열을 게시하는 방식은 쓰지 않는다) → `startListening(intent)`(`LANGUAGE_MODEL_FREE_FORM`, 언어, 분할 세션 `EXTRA_SEGMENTED_SESSION = EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS` 60,000 — 말을 멈춰도 정지를 누를 때까지 이어 받는다, 구현이 무시할 수 있음) → `onReadyForSpeech`에서 한 번 더 `interrupt()` + 시작음(`MediaActionSound.START_VIDEO_RECORDING`, iOS 시스템 사운드 1113 대응).
- **녹음 중 SR 발화 0**: 청취 중엔 화면이 통지 줄의 새 문장을 보류(청취 시작 시점의 `notice`를 표시 유지, 끝나면 최신 문장 하나만 발화)하고 완료 착지를 건너뛴다(§3-4). 라벨은 청취 내내 불변.
- **정지** `stop()`(Listening에서만, 이중 정지 가드): 정지음(`STOP_VIDEO_RECORDING`) 즉시 → `stopListening()` → 결과 도착 시 전달. **60초 캡**: 청취 60초가 지나면 `stop()`과 같은 경로(자동 전송 없음 — 초안 병합).
- **결과는 콜백 단일 채널**(수동 정지·캡·인식기 자체 종료 모두): `onSegmentResults` 누적 → `onEndOfSegmentedSession`에서 결합, 분할 미지원 구현은 `onResults` 첫 후보. 정리(`destroy`) → `Idle` → 공백 제거 뒤 `hasSpeechContent`(`:kit`)가 참일 때만 `onTranscript`(문장부호만 나온 무발화 전사 차단, iOS `stop()` 한 곳과 같은 층).
- **오류 코드**: `NO_MATCH`·`SPEECH_TIMEOUT`, 정지 뒤 `CLIENT` → 누적분으로 정상 종료 / `INSUFFICIENT_PERMISSIONS` → `Denied` / `LANGUAGE_NOT_SUPPORTED` → `Failed(Locale)` / `LANGUAGE_UNAVAILABLE` → `Failed(OnDevice)` / `AUDIO`·`RECOGNIZER_BUSY` → `Failed(Audio)` / 그 밖 → `Failed(Generic)`. 판정은 순수 함수 `dictationErrorOutcome(code, stopping)`.
- **취소** `cancel()`: 세대 증가, `cancel()`+`destroy()`, `Idle`, 전달·통지 없음. 화면 `DisposableEffect`의 onDispose가 부른다(탭 전환·pop = 마이크 항상 폐기, iOS `onDisappear`).

**버튼**(탭 토글, 헌장 §6 ⓐ): 라벨 = `Preparing`이면 `android.voice.preparing`, `Listening`이면 `voice.stop`, 그 밖 `android.voice.start`. 누르면 `Listening` → `stop()` / `Starting`·`Preparing` → 무시(정지·재시작 모두 불가한 구간) / 그 밖 → 권한 확인 후 `start()`. `enabled = false` 금지.
**실패 안내**: `Denied` → 통지 `android.voice.denied` + 버튼 바로 뒤에 "설정 열기"(`android.common.openSettings`, `location/appDetailsSettingsIntent`) 버튼이 선다(다음 시작 시도에서 사라진다 — M3 해결 버튼 모양). `Failed(kind)` → 종류별 통지(`android.voice.errorLocale`·`errorOnDevice`·`errorDownload`·`errorAudio`·`failed`) 후 `reset()`으로 즉시 재시도 가능 상태.

## 7. 진입 계약

```kotlin
// chat/ChatRoutes.kt
@Serializable data class PlaceChatRoute(val placeJson: String) { val place: Place get() = ...; companion object { fun of(place: Place) } }
fun NavController.openChat(place: Place?)
```

- `place == null` → 채팅 탭 전환(`openDirections`와 같은 탭 옵션 — `popUpTo(start){saveState}`·`launchSingleTop`·`restoreState`). 대화는 이어진다.
- `place != null` → **현재 탭 스택에** `PlaceChatRoute.of(place)` push. 백스택 엔트리마다 새 ViewModel = 장소마다 새 대화. 프리필 스토어가 필요 없다(라우트 인자가 곧 앵커이고 탭 루트를 건드리지 않는다).
- **AppRoot 변경(M6, 두 줄)**: `composable<ChatRoute> { ChatTabScreen(onOpenPlace = { navController.navigate(PlaceDetailRoute.of(it)) }) }`(자리표시 교체) + `composable<PlaceChatRoute> { entry -> PlaceChatScreen(entry.toRoute(), onBack = { navController.popBackStack() }, onOpenPlace = { navController.navigate(PlaceDetailRoute.of(it)) }) }`.
- **android-m1 배선(M6 통합 뒤)**: `PlaceNav.onOpenChat: (Place) -> Unit` + AppRoot `onOpenChat = { navController.openChat(it) }` + 상세 `[M6]` 자리에 `placeChat.launch` 버튼. 채팅에서 연 상세는 "물어보기"를 숨긴다(iOS `showsChatEntry: false`, 순환 방지) — **`PlaceDetailRoute.of(place, showsChatEntry = false)` 플래그는 m1이 그 배선 때 넣고, M6의 두 `onOpenPlace`는 그 뒤 플래그를 전달한다**(그 전엔 기존 `PlaceDetailRoute.of(place)`로 push).

## 8. 실기기 판정 항목 (TalkBack 폰 · 한소네 7 키보드·점자)

1. 전송 → 포커스가 보내기 버튼에 머물고 "전송 중" 상태가 발화된다. 추천 질문·칩으로 전송해도 최상단 이탈이 없다.
2. 완료 → 마지막 질문 헤딩 착지, 다음 이동이 답변 첫 블록. 긴 대화(10턴+)에서도 착지(eager Column + bring-into-view로 충분한가 — 부족하면 iOS식 지연·검증·1회 재시도).
3. 산문 블록이 각각 한 객체, 헤딩 블록이 헤딩 탐색에 잡힌다. 강조 스팬이 노드를 쪼개지 않는다.
4. 언급 1개 블록 = "…, 버튼" 한 객체이고 활성화가 상세로 간다(헤딩 + 버튼 조합 낭독 포함).
5. 언급 2개 이상 블록의 커스텀 액션이 TalkBack 작업 메뉴와 **한소네 점자 탐색**에서 닿는다(못 닿으면 보이는 버튼으로 교체 — M1 §8-8 조건).
6. 카드·블록·주소 행 → 상세 → 뒤로 → 원점 착지. 주소 지오코딩 왕복 중 탭 전환 → 유령 상세 없음.
7. 진행 통지가 한 번씩 발화되고 답변 산문이 통지로 중복 낭독되지 않는다. 구획 헤딩(카드·출처·추가 질문)이 소음인지 발견 경로인지.
8. 효과음(전송·완료) 음량·TalkBack 발화와의 겹침.
9. 동의 → 텍스트 필드 착지(소프트 키보드가 올라오는 것이 수용 가능한가 — 아니면 제목 헤딩).
10. 받아쓰기: 한소네 6(Android 12)에서 버튼 없음 · 한소네 7에서 `isOnDeviceRecognitionAvailable`·한국어 지원 조회 결과 · 라벨 전환 낭독이 전사에 섞이지 않는다(`interrupt()` 시점) · 시작/정지음 · 분할 세션이 정지까지 이어지는가(아니면 짧은 침묵에 끊기는가) · 전사 도착 후 보내기 버튼 착지 뒤 원문 낭독 순서 · 거부 → 설정 열기 버튼.
11. 지우기 → 텍스트 필드 착지. 한소네 키보드로 필드·지우기·받아쓰기·보내기 전부 도달, 물리 Enter가 전송.
12. 공유 선택기가 뜨고 닫힌 뒤 포커스가 공유 버튼에 남는다.
13. (알려진 서버 결함) U+2028이 섞인 답변은 실패 문구가 된다 — iOS와 같은 증상 확인만, 우회 없음.

## 9. 테스트·게이트

| 층 | 내용 |
|---|---|
| JVM `ChatStreamReaderTest` | `chat-stream.ndjson` fixture를 1·7·8192바이트 청크로 읽어도 같은 이벤트, 개행 없는 마지막 줄, CRLF, 청크 경계에서 끊긴 다중 바이트, 깨진 줄은 `APIError.Decoding`, U+2028 포함 줄이 쪼개져 디코딩 오류가 되는 현행 계약(서버 결함 문서화) |
| JVM `ChatViewModelTest` | 동의·빈 문자열·스트리밍 가드, 전송 → 효과음·상태, status → 통지 문장(실제 카탈로그 `CatalogStrings`), done → 답변·revision·완료음·follow-up, error 이벤트·예외 → 실패 문구, 빈 done → emptyAnswer, 요청 본문(히스토리·일반 채팅 prime 1회·장소 채팅 prime 0·placeContext·isStation·category 빈 값 생략), 전송이 칩을 비우고 늦은 제안을 버린다, 주소 해석 성공·0건·예외·in-flight·취소 뒤 가드 해제, 복귀 키 |
| JVM `ChatInlineTest`·`AddressToPlaceTest` | 인라인 규칙 표 / 웹 `address-to-place.test.ts` 6케이스 미러 |
| JVM `DictationSessionTest` | 순수 함수: 오류 코드 → 결과, 지원 목록 → 결정(설치·다운로드·미지원), 언어 태그 표 |
| JVM `ChatSourceGuardTest` | `chat/`에 줄 분리 API 0·`splitStreamLines` 사용·버퍼 ≥ 8192 / 보내기·받아쓰기 버튼에 `enabled =` 0 / 받아쓰기 버튼·세션 생성은 `Dictation.isAvailable` 분기 안 / `createSpeechRecognizer(` 0(온디바이스 강제) / 도구·출처 라벨 표가 iOS 표와 같은 키 전수 / 착지 순서 가드는 기존 `AppSourceGuardTest`가 덮는다 |
| androidTest `ChatScreenA11yTest`(ATF 레인) | 동의 → 추천 질문 전송(스텁 스트림) → 질문 헤딩·블록·카드 행이 단일 노드이고 검사 통과 |
| 실호출 게이트(수동, 환경변수 `GILDONGMU_REAL_CALL=1`일 때만) | 프로덕션 `/api/chat` 1회(장소 카드가 나오는 질의)·`/api/chat/suggestions` 1회 — `HttpChatStreamSource`가 status ≥ 1·done·renders를 실제로 받는가 |
| 머신 게이트 | README §7(락 안) |

## 10. 판정 기록

| # | 판정 | 기각한 대안·근거 |
|---|---|---|
| 1 | 장소 채팅은 스택 라우트 push(엔트리마다 새 대화) | 프리필 스토어 + 채팅 탭: 탭의 일반 대화와 장소 대화가 한 모델에 섞인다 |
| 2 | 받아쓰기 세션은 `speech/` 새 파일(코디네이터 승인) | `chat/` 안: 검색·길찾기 마이크가 복제한다 |
| 3 | 언급 2개 이상은 커스텀 액션만, 인라인 링크 없음 | `LinkAnnotation`: 링크마다 포커스 노드가 서서 블록이 쪼개진다 |
| 4 | follow-up 묶음은 구획 헤딩 | iOS 컨테이너 라벨: TalkBack에 컨테이너 진입 낭독이 없다 |
| 5 | 실패는 별도 통지 없이 답변 자리 + 질문 헤딩 착지 | 웹 `role="alert"`: 정본은 iOS이고 착지가 이미 낭독을 끊는다. `a11y/`에 assertive 창구도 없다 |
| 6 | 받아쓰기·보내기 버튼은 보이는 텍스트 라벨 | 아이콘 버튼: 코어 아이콘에 마이크가 없어 의존성 추가가 필요하다 |
| 7 | 라벨 변경 낭독 차단은 `AccessibilityManager.interrupt()` | 빈 문자열 통지: 안드로이드엔 "끊기만 하고 발화 0"인 게시 수단이 이것뿐이다 |
| 8 | 받아쓰기 실패는 인라인 통지 + (거부만) 설정 열기 버튼 | 다이얼로그: M2·M3 해결 버튼 관용구와 어긋나고 창 전환 포커스 복귀가 실기기 미검증 |
| 9 | 청취 중 통지·완료 착지 보류 | 헌장 §6 "녹음 중 SR 발화 0" |
| 10 | 주소 카드 → 지오코딩 → 상세(착수 프롬프트, 웹 동작) | iOS는 복사 액션만. 상세가 주소 복사 버튼을 이미 가진다 |
