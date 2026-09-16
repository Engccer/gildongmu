# 안드로이드 M6 채팅 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** iOS 채팅과 기능 등가인 안드로이드 채팅(채팅 탭·장소 채팅·동의 게이트·NDJSON 스트리밍·메시지 접근성·받아쓰기)을 Compose로 만든다.

**Architecture:** 판정은 `:kit`(무수정), `chat/`은 전송(HttpURLConnection POST, `splitStreamLines` 소비)·대화 상태 머신(`ChatViewModel`)·화면 조립만. 받아쓰기는 `speech/DictationSession.kt` 새 파일에서 인식기를 포트로 감싼 상태 머신. 진입은 `NavController.openChat(place?)`(장소면 스택 push).

**Tech Stack:** Kotlin 2.4.20 · Compose BOM 2026.09.00(foundation/ui 1.12.1) · navigation-compose 2.10.1 · activity-compose 1.13.0 · coroutines 1.11.0 · JUnit5(JVM) · ui-test-junit4 + ATF(androidTest)

**Spec:** `docs/superpowers/specs/2026-09-16-android-m6-chat-design.md`(78cc20c5 이후 개정본)

**구현 방식 판정:** inline. 근거: ① 머신 규약상 Gradle 데몬은 세션당 하나(16GB)라 병렬 서브에이전트가 각자 빌드할 수 없다 ② 화면 파일(`ChatScreen.kt`·`ChatMessages.kt`)이 조각 ①②③에서 반복 편집된다. 리뷰는 조각마다 별도 컨텍스트(opus).

## 개정(2026-09-16 밤 — spec 2차 리뷰·main `fc246219` 반영, 아래 Task 본문보다 우선)

- 착지 부착은 main `a11y/Landing.kt` `landingTarget`과 `mergedRow(focus)`뿐(main 소스 가드). `chat/ChatLanding.kt`는 `land()`만 남기고 자체 `landingTarget`을 지운다. 텍스트 필드 착지도 `landingTarget`.
- `SoundPoolChatSounds`는 `chat/ChatFactories.kt` 안(private). `ChatSounds.kt`는 인터페이스만.
- `ChatHttp.post`는 `open` 인자(가짜 연결 주입)와 취소 중 예외 → 취소 변환을 가진다. `ChatHttpTest`의 취소 케이스는 가짜 연결(JDK 21은 청크 읽기 중 `disconnect`로 깨지 않는다).
- 받아쓰기: `DictationPhase`에 Failed 없음, `isActive` = Starting·Listening, `toggle`은 Starting 무시·Preparing 취소, 다운로드 Ready·Scheduled 모두 청취 없이 통지(`DictationNotice.DownloadReady`·`DownloadRequested`, android-extra 신규 키 `android.voice.downloadReady`·`android.voice.downloadRequested` 6로케일), 타이머 세대 확인·상한 무장은 `port.stop()` 앞·`onReady` 1회, `detach()`(구성 변경 시 정상 정지 후 해제), 생성은 `dictationSessionOrNull(context, …)` 한 곳.
- 완료 착지를 건너뛴 실패는 통지 줄에 실패 문장(받아쓰기 중이면 세션 끝에 전사 통지와 결합), 전사 착지는 미소비 완료 착지를 소비, 전송 뒤 스크롤은 한 프레임 뒤.
- 실호출: `/api/chat/suggestions`는 서버 6초 상한으로 빈 목록(코디네이터 확인) — 테스트는 목록·상한 3만 단언.

## Global Constraints

- 소유: `android/app/src/main/kotlin/space/dodoplanet/gildongmu/chat/**`(신규), `speech/DictationSession.kt`(새 파일만), `res/raw/chat_send.mp3`·`chat_receive.mp3`, `nav/AppRoot.kt` 두 줄, `AndroidManifest.xml` `RECORD_AUDIO` 한 줄(별도 커밋), `android/i18n/android-extra/*` 키 additive(필요 시), 테스트 `app/src/test/.../chat/**`·`speech/DictationSessionTest.kt`·`app/src/androidTest/.../chat/**`, `CHANGELOG.md` 자기 항목.
- 금지: `a11y/`·`i18n/`·`net/`·`storage/`·`location/`·`search/`·`place/`·`nearby/`·`directions/`·`guide/`·`audio/`·기존 `speech/Dictation.kt` **수정**(호출은 허용), `android/kit/**`·`ios/**`·`src/**`·`packages/**`·gradle 파일.
- 서버 계약 변경 0, `:kit` 무수정, 외부 마크다운 라이브러리 금지, 새 데이터 유형 0.
- 인자 있는 문자열은 `appLocalized(res, R.string.x, args)`만(`LocalizedCallSiteGuardTest`). 인자 없는 것은 `stringResource(id)`/`res.getString(id)`.
- 정규식 약칭 클래스(`\d`·`\s`·`\w`) 금지, 문자 클래스 안 `[`는 `\[`. `runCatching`은 suspend·async 안에서 금지(취소 삼킴).
- API 33+ 전용 JDK 오버로드 금지(README §3). `readAllBytes()` 대신 `readBytes()`.
- 착지: 행·헤딩은 `mergedRow(tag, spoken, focus = r)`, 버튼은 `Modifier.landingTarget(r)`. 성패는 `requestFocus(FocusDirection.Enter)`의 Boolean(무인자 `requestFocus()`는 Unit).
- `enabled = false` 금지(보내기·받아쓰기). 상태는 `stateDescription`/라벨.
- 커밋: pathspec(`git commit -- <paths>`), 한국어 메시지, 꼬리말 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. `origin` push 금지.
- 게이트는 락 안에서(README §7). 빌드·테스트 명령은 `cd android && ./gradlew ...`, 끝나면 `./gradlew --stop`.

## 파일 지도

| 파일 | 책임 |
|---|---|
| `chat/ChatInline.kt` | `chatInlineText(text): ChatInlineText(plain, bold, code)` 순수 |
| `chat/AddressToPlace.kt` | `jusoAddressToPlace(address, match, dataLocale): Place` 순수(웹 미러) |
| `chat/ChatStrings.kt` | `ChatStrings` 문장 람다 묶음 + `chatStrings(res)` 프로덕션 + `toolLabelId`·`sourceLabelId` 리터럴 표 |
| `chat/ChatHttp.kt` | `ChatHttp.post` — POST 한 곳, IO, 감시자 disconnect |
| `chat/ChatStream.kt` | `ChatStreamSource`·`HttpChatStreamSource`·`readChatStream`·`ChatSuggestionsSource`·`HttpChatSuggestionsSource` |
| `chat/ChatConsent.kt` | `ChatConsentStore` + `ChatConsentContent` 컴포저블 |
| `chat/ChatSounds.kt` | `ChatSounds` 인터페이스 + `SoundPoolChatSounds` |
| `chat/ChatViewModel.kt` | 상태 머신(§4) + `ChatLocation` 인터페이스 |
| `chat/ChatFactories.kt` | `chatViewModelFactory(context, place)` + 프로덕션 `ChatLocation`·싱글턴(동의·효과음) |
| `chat/ChatLanding.kt` | `Modifier.landingTarget(r)`·`land(r, tag)` |
| `chat/ChatRoutes.kt` | `PlaceChatRoute`·`NavController.openChat` |
| `chat/ChatScreen.kt` | `ChatTabScreen`·`PlaceChatScreen`·공용 `ChatConversation`·입력 바 |
| `chat/ChatMessages.kt` | 말풍선·블록·렌더 묶음·출처·액션 행·칩 |
| `speech/DictationSession.kt` | `RecognizerPort`·`DictationEffects`·`DictationSession`·`dictationErrorOutcome`·`supportDecision`·`speechLanguageTag`·`AndroidRecognizerPort`·`AndroidDictationEffects` |

---

## 조각 ① — 동의 게이트 + 전송기 + 메시지 목록(보고 ②)

### Task 0: 매니페스트 `RECORD_AUDIO` (별도 커밋)

**Files:** Modify `android/app/src/main/AndroidManifest.xml`(위치 권한 줄 아래 한 줄)

- [ ] `<uses-permission android:name="android.permission.RECORD_AUDIO" />` 추가
- [ ] 커밋 `feat(android): RECORD_AUDIO 권한 선언(M6 받아쓰기, 코디네이터 승인 — 선언만, 요청은 받아쓰기 버튼에서)`

### Task 1: 순수 조각 — 인라인 마크다운·주소 → Place·문자열 표

**Files:** Create `chat/ChatInline.kt`, `chat/AddressToPlace.kt`, `chat/ChatStrings.kt`; Test `test/.../chat/ChatInlineTest.kt`, `AddressToPlaceTest.kt`

**Interfaces — Produces:**
```kotlin
data class ChatInlineText(val plain: String, val bold: List<IntRange>, val code: List<IntRange>)
fun chatInlineText(text: String): ChatInlineText
fun jusoAddressToPlace(address: JusoAddress, match: AddressMatch, dataLocale: String): Place
class ChatStrings(
    val failed: () -> String, val emptyAnswer: () -> String, val progressFallback: () -> String,
    val progressSearching: (String) -> String, val toolLabel: (String) -> String,
    val addressNotFound: () -> String, val addressLookupFailed: () -> String,
)
fun chatStrings(res: Resources): ChatStrings
@StringRes fun toolLabelId(category: String): Int?     // 19개(iOS ChatModel.toolLabel 표)
@StringRes fun sourceLabelId(label: String): Int?      // 17개(iOS sourceDisplayLabel 표)
```

- [ ] **테스트 먼저** `ChatInlineTest`:
```kotlin
class ChatInlineTest {
    private fun t(s: String) = chatInlineText(s)
    @Test fun `굵게 두 꼴은 기호를 걷고 구간을 남긴다`() {
        val r = t("**강남역** 근처 __카페__")
        assertEquals("강남역 근처 카페", r.plain)
        assertEquals(listOf(0..2, 7..8), r.bold)
    }
    @Test fun `고정폭·취소선·링크`() {
        assertEquals("2호선 A12", t("`2호선` A12").plain); assertEquals(listOf(0..2), t("`2호선` A12").code)
        assertEquals("폐업", t("~~폐업~~").plain)
        assertEquals("안내", t("[안내](https://x.test)").plain)
    }
    @Test fun `기울임은 기호 안쪽이 공백이 아닐 때만`() {
        assertEquals("아주 좋음", t("아주 *좋음*").plain)
        assertEquals("2 * 3 * 4", t("2 * 3 * 4").plain)
    }
    @Test fun `밑줄 한 개는 걷지 않는다(snake_case)`() { assertEquals("get_weather", t("get_weather").plain) }
    @Test fun `이스케이프는 역슬래시만 걷는다`() { assertEquals("*별표*", t("""\*별표\*""").plain) }
    @Test fun `짝 없는 기호는 원문`() { assertEquals("**미완", t("**미완").plain) }
    @Test fun `목록 표지는 건드리지 않는다`() { assertEquals("1. **역** 출구", t("1. **역** 출구").plain.let { "1. " + it.removePrefix("1. ") }); assertEquals("• 역", t("• 역").plain) }
}
```
- [ ] `AddressToPlaceTest` — 웹 `src/lib/__tests__/address-to-place.test.ts` 6케이스 그대로(ADDR 픽스처, ko/en, bdNm 빈 값, roadAddrPart1 빈 값). id = `"juso-${roadAddr}"`, category `""`, englishAddress는 en일 때만.
- [ ] 실행 `./gradlew :app:testDebugUnitTest --tests '*ChatInlineTest' --tests '*AddressToPlaceTest'` → FAIL(미정의)
- [ ] 구현: `chatInlineText`는 앞에서부터 한 번 훑는 스캐너(정규식 없이 문자 비교) — 우선순위 이스케이프 → `` ` `` → `**`/`__` → `~~` → `[..](..)` → `*`. 닫는 기호를 못 찾으면 그 기호를 원문 문자로 내보낸다. 구간은 `plain` 인덱스 기준 `IntRange`(inclusive). `jusoAddressToPlace`는 웹 함수 그대로. `ChatStrings`의 `chatStrings(res)`는 `R.string.android_chat_failed`·`android_chat_emptyAnswer`·`android_chat_progressFallback`·`appLocalized(res, R.string.chat_progress_searching, labels)`·`toolLabelId(c)?.let(res::getString) ?: c`·`search_addressCoordFailed`·`directions_coordError`. 표 두 개는 iOS `ChatModel.toolLabel`·`MessageBubbleView.sourceDisplayLabel` 키 전수를 `when` 리터럴로.
- [ ] PASS 확인 → 커밋 `feat(android): M6 순수 조각 — 인라인 마크다운 걷기·주소→Place(웹 미러)·채팅 문자열 표`

### Task 2: 전송기 — POST 한 곳·스트림 리더·스트림/칩 소스

**Files:** Create `chat/ChatHttp.kt`, `chat/ChatStream.kt`; Test `ChatStreamReaderTest.kt`, `ChatHttpTest.kt`

**Interfaces — Produces:**
```kotlin
object ChatHttp {
    suspend fun <T> post(url: String, body: String, timeoutMs: Long, read: suspend (status: Int, stream: InputStream) -> T): T
}
const val STREAM_READ_BUFFER_BYTES = 8192
suspend fun readChatStream(input: InputStream, bufferSize: Int = STREAM_READ_BUFFER_BYTES, emit: suspend (ChatStreamEvent) -> Unit)
fun interface ChatStreamSource { fun events(body: ChatRequestBody): Flow<ChatStreamEvent> }
class HttpChatStreamSource(private val baseUrl: String) : ChatStreamSource
fun interface ChatSuggestionsSource { suspend fun fetch(lastUser: String, lastAssistant: String, locale: String, placeName: String?): List<String> }
class HttpChatSuggestionsSource(private val baseUrl: String) : ChatSuggestionsSource
```

- [ ] **테스트 먼저** `ChatStreamReaderTest`:
```kotlin
class ChatStreamReaderTest {
    private val ndjson = Fixtures.kit("chat-stream.ndjson").toByteArray()
    /** 매 read가 최대 n바이트만 주는 스트림 — 청크 경계 재현. */
    private class Chunked(private val bytes: ByteArray, private val n: Int) : InputStream() {
        private var pos = 0
        override fun read(): Int = if (pos < bytes.size) bytes[pos++].toInt() and 0xFF else -1
        override fun read(b: ByteArray, off: Int, len: Int): Int {
            if (pos >= bytes.size) return -1
            val k = minOf(len, n, bytes.size - pos); System.arraycopy(bytes, pos, b, off, k); pos += k; return k
        }
    }
    private fun events(bytes: ByteArray, n: Int) = runBlocking { buildList { readChatStream(Chunked(bytes, n)) { add(it) } } }

    @Test fun `청크 크기와 무관하게 같은 이벤트`() {
        val whole = events(ndjson, 8192)
        assertTrue(whole.first() is ChatStreamEvent.Status); assertTrue(whole.last() is ChatStreamEvent.Done)
        for (n in listOf(1, 7, 100)) assertEquals(whole, events(ndjson, n))
    }
    @Test fun `개행 없는 마지막 줄·CRLF·빈 줄`() {
        val body = "{\"type\":\"status\",\"categories\":[]}\r\n\r\n{\"type\":\"error\",\"code\":\"x\"}".toByteArray()
        assertEquals(listOf(ChatStreamEvent.Status(emptyList()), ChatStreamEvent.Error("x")), events(body, 3))
    }
    @Test fun `다중 바이트 글자가 청크 경계에서 끊겨도 온전`() {
        val body = "{\"type\":\"done\",\"text\":\"강동역 주변\"}\n".toByteArray()
        assertEquals("강동역 주변", (events(body, 1).single() as ChatStreamEvent.Done).text)
    }
    @Test fun `깨진 줄은 Decoding 오류`() {
        assertFailsWith<APIError.Decoding> { events("{\"type\":\n".toByteArray(), 8192) }
    }
    @Test fun `U+2028 날 문자는 줄을 쪼갠다 — 서버 결함 A44의 현행 계약(우회 금지)`() {
        val body = "{\"type\":\"done\",\"text\":\"가 나\"}\n".toByteArray()
        assertFailsWith<APIError.Decoding> { events(body, 8192) }
    }
}
```
- [ ] **테스트 먼저** `ChatHttpTest`(로컬 `ServerSocket`, JVM `HttpURLConnection`):
  - `POST 본문과 헤더가 서버에 도착하고 2xx 스트림을 읽는다` — 서버 스레드가 요청 줄·헤더·`Content-Length`만큼 본문을 읽어 기록, `HTTP/1.1 200 OK` + `Content-Type: application/x-ndjson` + 본문 두 줄 + 연결 닫기. `HttpChatStreamSource("http://127.0.0.1:$port").events(body).toList()` == 2이벤트, 기록된 본문 == `ChatService.encodeBody(body)`, `Content-Type: application/json`.
  - `비-2xx는 statusError로` — `429` + `{"error":"rate_limited"}` → `assertFailsWith<APIError.BadStatus>`, `message == "rate_limited"`.
  - `멈춘 서버에서 수집을 취소하면 곧 반환한다` — 서버가 헤더(chunked)와 status 한 줄만 쓰고 소켓을 열어 둔 채 대기. `val job = launch(Dispatchers.Default) { src.events(body).collect { first.complete(Unit) } }`; `first.await()`; `withTimeout(2_000) { job.cancelAndJoin() }` 성공(감시자 disconnect가 읽기를 깨움).
  - `칩: 전송 예외는 빈 목록` — 닫힌 포트로 `HttpChatSuggestionsSource.fetch` → `emptyList()`.
- [ ] FAIL 확인
- [ ] 구현 `ChatHttp.post`:
```kotlin
suspend fun <T> post(url: String, body: String, timeoutMs: Long, read: suspend (Int, InputStream) -> T): T = withContext(Dispatchers.IO) {
    val connection = URL(url).openConnection() as HttpURLConnection
    // 블로킹 읽기는 취소를 보지 못한다 — 감시자가 취소 시 연결을 닫아 읽기를 깨운다(IO 스레드, 메인에서 소켓을 닫지 않는다).
    val watcher = launch { try { awaitCancellation() } finally { connection.disconnect() } }
    try {
        val bytes = body.toByteArray(Charsets.UTF_8)
        connection.requestMethod = "POST"
        connection.doOutput = true
        connection.setRequestProperty("Content-Type", "application/json")
        connection.connectTimeout = timeoutMs.toInt()
        connection.readTimeout = timeoutMs.toInt()
        connection.setFixedLengthStreamingMode(bytes.size)
        connection.outputStream.use { it.write(bytes) }
        val status = connection.responseCode
        val stream = if (status in 200..299) connection.inputStream else (connection.errorStream ?: ByteArrayInputStream(ByteArray(0)))
        stream.use { read(status, it) }
    } finally {
        watcher.cancel()
        connection.disconnect()
    }
}
```
  `readChatStream`: spec §5-3 루프(`splitStreamLines` + `eventFromStreamLine`, 매 루프 `currentCoroutineContext().ensureActive()`). `HttpChatStreamSource.events` = `channelFlow { ChatHttp.post(baseUrl + ChatService.path, ChatService.encodeBody(body), ChatService.timeoutMs) { status, s -> if (status !in 200..299) throw ChatService.statusError(status, s.readBytes().decodeToString())!!; readChatStream(s) { send(it) } } }.flowOn(Dispatchers.IO)`. `HttpChatSuggestionsSource.fetch` = `try { ChatHttp.post(..., ChatSuggestionsService.timeoutMs) { st, s -> ChatSuggestionsService.followUps(st, s.readBytes().decodeToString()) } } catch (e: CancellationException) { throw e } catch (e: Exception) { emptyList() }`.
- [ ] PASS → 커밋 `feat(android): M6 채팅 전송기 — POST 한 곳(취소 시 disconnect)·NDJSON 리더(splitStreamLines 8KB)·follow-up 소스`

### Task 3: 동의 저장소·효과음 인터페이스·대화 ViewModel

**Files:** Create `chat/ChatConsent.kt`(저장소 부분), `chat/ChatSounds.kt`(인터페이스만), `chat/ChatViewModel.kt`; Test `ChatViewModelTest.kt`

**Interfaces — Consumes:** Task 1 `ChatStrings`·`jusoAddressToPlace`, Task 2 `ChatStreamSource`·`ChatSuggestionsSource`.
**Produces:**
```kotlin
class ChatConsentStore(private val store: KeyValueStore) { val granted: StateFlow<Boolean>; fun grant() }  // 키 "aiChatConsent" = "true"
interface ChatSounds { fun send(); fun receive() }
interface ChatLocation { suspend fun prime(); fun last(): ChatRequestBody.Coordinate? }
enum class ChatRole { user, assistant }
data class ChatMessage(val id: Long, val role: ChatRole, val text: String, val failed: Boolean = false, val renders: List<ChatRenderPayload> = emptyList(), val sources: List<ChatSource> = emptyList())
data class ChatUiState(val messages: List<ChatMessage> = emptyList(), val isStreaming: Boolean = false, val followUps: List<String> = emptyList(), val answerRevision: Int = 0, val notice: Notice = Notice(0, ""))
class ChatViewModel(place: Place?, stream: ChatStreamSource, suggestions: ChatSuggestionsSource, geocode: suspend (String) -> AddressMatch?,
    consent: ChatConsentStore, location: ChatLocation, lang: () -> String, dataLocale: () -> String, strings: ChatStrings, sounds: ChatSounds, savedState: SavedStateHandle) : ViewModel() {
    val place: Place?; val draft: TextFieldState; val state: StateFlow<ChatUiState>
    var consumedAnswerRevision: Int            // 화면 전용(비저장)
    fun send(text: String): Boolean
    fun sendDraft(): Boolean
    fun clearDraft()
    fun mergeTranscript(transcript: String): String
    fun announce(text: String)
    suspend fun resolveAddress(address: JusoAddress): Place?
    fun rememberReturnFocus(key: String); fun takeReturnFocus(): String?
}
```

- [ ] **테스트 먼저** `ChatViewModelTest`(`MainDispatcherExtension(StandardTestDispatcher())`, `CatalogStrings("ko")`로 `ChatStrings` 구성, 페이크: `FakeStream(flowFactory)`·`FakeSuggestions`·`FakeLocation(primes 카운터, last)`·`FakeSounds(sends, receives)`·`InMemoryKeyValueStore` 동의 저장소). 케이스(각각 한 `@Test`):
  1. 동의 없음 → `send` false, 메시지 0, 소리 0.
  2. 빈 문자열·공백 → false. 스트리밍 중 두 번째 `send` → false.
  3. 전송 → true, 사용자 메시지·`isStreaming`·`sends == 1`·통지 비움.
  4. status `["search_places","get_weather"]` → 통지 `"장소, 날씨 조회 중"`; status `[]` → `"정보 확인 중"`; 미지 `"x_tool"` → `"x_tool 조회 중"`.
  5. done(text, renders, sources) → 답변 추가(renders·sources 보존)·`answerRevision == 1`·`receives == 1`·통지 비움·`isStreaming` false·follow-up 조회 1회 후 `followUps` 반영.
  6. error 이벤트 → `failed = true` 답변 `"답변을 가져오지 못했습니다."`, follow-up 조회 0. flow 예외(`IOException`) → 같다. done 뒤 예외 → 실패.
  7. 빈 done text → `"답변을 준비하지 못했습니다"`.
  8. **취소 누수**: `FakeStream`이 `awaitCancellation` 뒤 `IOException`을 던지는 flow; 전송 후 `viewModelScope` 취소(테스트는 `vm.clearForTest()` = `onCleared` 호출 경로 대신 `ViewModelStore().also{...}.clear()`로) → 답변 추가 0·`receives == 0`·`answerRevision == 0`.
  9. 요청 본문: 일반 채팅은 `primes == 1`, `placeContext` null, `userLocation == last()`, `locale == "ko"`, 히스토리 순서(실패 답변 포함). 장소 채팅(`category` 빈 값 장소, 역 장소)은 `primes == 0`, `placeContext.category == null`, `isStation` 판정. `prime`이 `SecurityException`을 던져도 전송 계속.
  10. 두 번째 전송이 칩을 비우고, 늦게 도착한 첫 제안(지연 페이크)을 커밋하지 않는다.
  11. `sendDraft`: 성공 시 초안 비움, 스트리밍 중엔 false이고 초안 유지. `send("칩")`은 초안 유지.
  12. `resolveAddress`: 매칭 → Place(id `juso-…`); 0건 → null + 통지 `"이 주소의 좌표를 찾지 못해 상세를 열 수 없습니다."`; 예외 → null + `"선택한 주소의 좌표를 확인하지 못했습니다."`; 진행 중 두 번째 호출 → null 즉시(지오코더 호출 1회); 첫 호출 코루틴 취소 뒤 세 번째 호출은 진행된다(가드 해제).
  13. `mergeTranscript`: 초안 `"  "` + `"강남역"` → `"강남역"`; 초안 `"근처"` + `"카페"` → `"근처 카페"`(초안도 교체). 전송 성공·`clearDraft`는 통지를 비운다.
  14. 복귀 키: `rememberReturnFocus("card-1-0-k1")` → `takeReturnFocus()` 한 번만 값.
- [ ] FAIL 확인
- [ ] 구현: spec §4 그대로. 메시지 id는 `nextId++`(Long). 스트림 잡 끝의 첫 줄 `currentCoroutineContext().ensureActive()`. 수집 catch는 `CancellationException` 재던짐 + `Exception` → `errored = true`. `prime`은 `try { location.prime() } catch (e: CancellationException) { throw e } catch (e: Exception) { }`. `resolveAddress`의 in-flight는 `private var resolving = false` + `try/finally`. 복귀 키는 `ReturnFocusSlot(savedState)`.
- [ ] PASS → 커밋 `feat(android): M6 채팅 상태 머신 — 동의 이중 방어·스트림 수집(취소 누수 차단)·진행 통지·follow-up·주소 해석(3-state)·복귀 키`

### Task 4: 화면 골격 — 진입·동의 본문·대화 목록(산문·질문)·입력 바(받아쓰기 제외)·AppRoot

**Files:** Create `chat/ChatLanding.kt`, `chat/ChatRoutes.kt`, `chat/ChatFactories.kt`, `chat/ChatScreen.kt`, `chat/ChatMessages.kt`, 동의 컴포저블(`ChatConsent.kt`에 추가), `ChatSounds.kt`에 `SoundPoolChatSounds` + `res/raw/chat_send.mp3`·`chat_receive.mp3`(iOS 파일 복사); Modify `nav/AppRoot.kt`(두 줄)

**Produces:**
```kotlin
fun Modifier.landingTarget(r: FocusRequester): Modifier = focusRequester(r).focusProperties { canFocus = true }
fun land(r: FocusRequester?, tag: String): Boolean   // requestFocus(FocusDirection.Enter) + 예외 포착, Log.i("ChatFocus", "$tag ok|fail")
@Serializable data class PlaceChatRoute(val placeJson: String) { val place: Place; companion object { fun of(place: Place): PlaceChatRoute } }
fun NavController.openChat(place: Place?)
fun chatViewModelFactory(context: Context, place: Place?): ViewModelProvider.Factory
@Composable fun ChatTabScreen(onOpenPlace: (Place) -> Unit)
@Composable fun PlaceChatScreen(route: PlaceChatRoute, onBack: () -> Unit, onOpenPlace: (Place) -> Unit)
```

- [ ] `ChatFactories.kt`: 싱글턴 `ChatServices`(`@Volatile` 지연 생성, 앱 컨텍스트): `consent = ChatConsentStore(SharedPreferencesStore(app, "gildongmu.chat"))`, `sounds = SoundPoolChatSounds(app)`. 프로덕션 `ChatLocation`: `prime = AppConfig.locationStore.currentCoordinate(timeoutMs = (LocationFixPolicy.softTimeout * 1000).toLong())`(결과 버림), `last = AppConfig.locationStore.stored?.let { Coordinate(it.lat, it.lng) }`. 팩토리 `viewModelFactory { initializer { ChatViewModel(place, HttpChatStreamSource(AppConfig.API_BASE_URL), HttpChatSuggestionsSource(AppConfig.API_BASE_URL), { q -> SearchService(AppConfig.apiClient).geocode(q, 1).firstOrNull() }, consent, location, { AppLocale.current(app.resources) }, { AppLocale.dataLocale(app.resources) }, chatStrings(app.resources), sounds, createSavedStateHandle()) } }`. (주소 해석의 `geocode`는 `withContext(Dispatchers.IO)`로 감싼다.)
- [ ] `SoundPoolChatSounds`: `SoundPool.Builder().setMaxStreams(2).setAudioAttributes(AudioAttributes.Builder().setUsage(USAGE_ASSISTANCE_SONIFICATION).setContentType(CONTENT_TYPE_SONIFICATION).build())`, `load(R.raw.chat_send)`·`chat_receive`, `setOnLoadCompleteListener`로 로드 완료 id 집합, 미로드면 조용히 무시.
- [ ] `ChatRoutes.kt`: `openChat(null)` = `navigate(ChatRoute) { popUpTo(graph.findStartDestination().id) { saveState = true }; launchSingleTop = true; restoreState = true }`, `openChat(place)` = `navigate(PlaceChatRoute.of(place))`.
- [ ] `ChatScreen.kt` 골격:
  - `ChatTabScreen`: `val vm: ChatViewModel = viewModel(factory = chatViewModelFactory(LocalContext.current, null))`, `AppScreenScaffold(stringResource(R.string.android_tab_chat), onBack = null, titleFocus)` → `// [M2b] LocationBarRow` 자리(통합 시 main 확인) → `ChatBody(vm, suggestions = 4개, titleFocus, landOnEntry = false, onOpenPlace)`.
  - `PlaceChatScreen`: `remember(route) { route.place }`로 장소, 팩토리 `chatViewModelFactory(ctx, place)`, 제목 `bilingualName(lang, place.name, null, place.nameRoman).primary`, 뒤로, `ChatBody(vm, suggestions = placeChatPromptKeys(place) → 문자열, titleFocus, landOnEntry = true, onOpenPlace)`. 문자열 키 → 리소스는 `placeChat.prompt.*` 9개 리터럴 `when`.
  - `ChatBody`: `granted by consent.granted.collectAsState()`. 미동의 → `ChatConsentContent(onAgree)`, 동의 → `ChatConversation`. 진입 착지(`landOnEntry`): `LaunchedEffect(Unit) { withFrameNanos {}; land(titleFocus, "entry") }`(동의 전·후 모두 상단 바 제목 — 동의 제목 헤딩 착지는 제목 헤딩 착지로 충분한지 실기기 §8-6, 계획은 상단 바 제목 하나로 단순화). 동의 착지: `var agreedHere by remember { mutableStateOf(false) }`; `LaunchedEffect(granted, agreedHere) { if (granted && agreedHere) { withFrameNanos {}; land(fieldFocus, "consent"); agreedHere = false } }`.
  - `ChatConversation`: `Column(Modifier.weight(1f).verticalScroll(scroll))`에 빈 대화 추천 버튼·`ChatMessageList`·`StatusLine`(+ 진행 표시), 아래 `ChatInputBar`. 전송 경로 `fun submitSuggestion(text) { if (vm.send(text)) { land(sendFocus, "send"); scope.launch { scroll.animateScrollTo(scroll.maxValue) } } }`, 보내기·IME `if (vm.sendDraft()) { land(...); scroll }`. 완료 착지:
```kotlin
val initialAnswerRevision = remember { s.answerRevision }
LaunchedEffect(s.answerRevision) {
    if (s.answerRevision <= initialAnswerRevision || s.answerRevision <= vm.consumedAnswerRevision) return@LaunchedEffect
    vm.consumedAnswerRevision = s.answerRevision
    val last = s.messages.lastOrNull() ?: return@LaunchedEffect
    withFrameNanos {}
    val blocked = s.isStreaming || dictationActive || fieldFocused
    val target = if (blocked) null else if (last.failed) blockFocus["block-${last.id}-0"] else s.messages.lastOrNull { it.role == ChatRole.user }?.let { questionFocus[it.id] }
    if (target == null || !land(target, "completion")) scroll.animateScrollTo(scroll.maxValue)
}
```
  (조각 ①에서 `dictationActive = false` 상수, 조각 ③에서 세션 상태로 교체.) 복귀 착지: `LaunchedEffect(Unit) { val key = vm.takeReturnFocus() ?: return@LaunchedEffect; withFrameNanos {}; land(originFocus[key], "return") }`.
  - `ChatInputBar`: 1행 `TextField(state = vm.draft, lineLimits = SingleLine, label = { Text(stringResource(R.string.chat_inputLabel)) }, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send), onKeyboardAction = { submitDraft() }, trailingIcon = if (vm.draft.text.isNotEmpty()) { { IconButton(onClick = { vm.clearDraft(); land(fieldFocus, "clear") }, Modifier.testTag("chat-clear")) { Icon(Icons.Filled.Close, stringResource(R.string.android_chat_clear)) } } } else null, modifier = Modifier.fillMaxWidth().testTag("chat-field").focusRequester(fieldFocus).onFocusChanged { fieldFocused = it.isFocused })`. 2행 `Row`: (조각 ③ 받아쓰기 자리) + `Button(onClick = { if (!s.isStreaming) submitDraft() }, Modifier.tapTarget().testTag("chat-send").landingTarget(sendFocus).semantics { if (s.isStreaming) stateDescription = sending }) { Text(stringResource(R.string.chat_send)) }`.
  - `ChatConsentContent`: spec §3-2(제목 헤딩 `headingText()`, 문단 `mergedRow`, 개인정보 버튼 `context.tryStartActivity(Intent(ACTION_VIEW, Uri.parse("${AppConfig.API_BASE_URL}/${AppLocale.current(res)}/privacy")))` false면 `vm.announce(noAppToOpen)`, 동의 버튼 `consent.grant(); agreedHere = true`).
- [ ] `ChatMessages.kt`(조각 ①분): 질문 `Text(q.text, Modifier.fillMaxWidth().mergedRow("question-${q.id}", focus = questionFocus.getOrPut(q.id) { FocusRequester() }).headingText())`, 답변 블록 `parseChatMarkdownBlocks` → 블록마다 `Text(annotated(chatInlineText(block.text)), Modifier.fillMaxWidth().mergedRow("block-${m.id}-$i", focus = …).let { if (block.isHeading) it.headingText() else it }, style = if (heading) titleMedium else bodyLarge)`; 블록 0개면 원문 한 객체(키 `block-<id>-0`). 렌더·출처·칩은 조각 ②.
- [ ] `nav/AppRoot.kt`: `composable<ChatRoute> { PlaceholderScreen(AppTab.chat) } // M6` → `composable<ChatRoute> { ChatTabScreen { navController.navigate(PlaceDetailRoute.of(it)) } }`; 스택 등록에 `composable<PlaceChatRoute> { entry -> PlaceChatScreen(entry.toRoute(), { navController.popBackStack() }) { navController.navigate(PlaceDetailRoute.of(it)) } }` 한 줄 + import 두 줄. (`PlaceholderScreen` import가 다른 곳에서 안 쓰이면 경고 — 같은 패키지라 import 없음.)
- [ ] `./gradlew :app:assembleDebug :app:testDebugUnitTest` 통과(락 안) → 커밋 `feat(android): M6 채팅 화면 골격 — openChat 진입·동의 본문·질문 헤딩·산문 블록·입력 바·전송/완료/복귀 착지(landingTarget)·효과음·AppRoot 등록`

### Task 5: 조각 ① 게이트·리뷰·통합 (보고 ②)

- [ ] 락 안 README §7 게이트 + vitest(`xcstrings-plural` 1건 실패는 기대값)
- [ ] 실호출 1회: `GILDONGMU_REAL_CALL=1 ./gradlew :app:testDebugUnitTest --tests '*ChatRealCallTest'`(Task 5에서 작성 — `assumeTrue(System.getenv("GILDONGMU_REAL_CALL") == "1")`, 일반 채팅 "강남역 근처 카페 알려줘" → `HttpChatStreamSource(API_BASE_URL)` 이벤트: Status ≥ 1, Done 1, Done.renders에 Places ≥ 1; 칩 1회 → 목록 크기 ≤ 3). 결과를 보고 파일에.
- [ ] 리뷰 디스패치(opus, 별도 컨텍스트, 요구사항 = spec §1~§5·§9 + 헌장 §5·§6, 산출물 = `git diff main...HEAD`, 결과 `~/gildongmu-wt/android-m6-reports/review-m6-slice1.md`). 리뷰 중 커밋·rebase 금지. 반영 커밋.
- [ ] `git rebase main` → `comm` CHANGELOG 대조 → 게이트 재실행 → `git -C ~/Mac-Projects/gildongmu merge --ff-only feat/android-m6` → 보고 ② + SendMessage

---

## 조각 ② — 렌더 카드·장소 언급·출처·공유·칩

### Task 6: 렌더 묶음·언급 활성화·출처·액션 행·follow-up

**Files:** Modify `chat/ChatMessages.kt`, `chat/ChatScreen.kt`; Test `ChatSourceGuardTest.kt`(생성 — 조각 ②까지의 가드)

- [ ] 블록 언급: `val cardPlaces = m.renders.filterIsInstance<ChatRenderPayload.Places>().flatMap { it.places }`; `mentions = chatPlaceMentions(block.text, cardPlaces)`. 1개 → 수식자 `Modifier.fillMaxWidth().mergedRow(key, focus = r).clickable(role = Role.Button) { open(mentions[0], key) }` 순서가 아니라 **`focusRequester`가 앞에 오도록** `Modifier.fillMaxWidth().clickable(role = Role.Button) { … }.mergedRow(key, focus = r)`(PlaceRow와 같은 순서: clickable → mergedRow; 착지 requester는 mergedRow 인자). 2개 이상 → `mergedRow(key, focus = r).semantics { customActions = mentions.map { CustomAccessibilityAction(appLocalized(res, R.string.android_chat_openPlace, bilingualName(lang, it.name, null, it.nameRoman).primary)) { open(it, key); true } } }`. 이름 강조: `plain.indexOf(name)` 반복으로 `SpanStyle(color = MaterialTheme.colorScheme.primary)`.
- [ ] 렌더 묶음 `renders.forEachIndexed { r, render -> }`: 비지 않은 `Places`·`Addresses`·`WebResults`만 구획 헤딩 `Text(heading, Modifier.fillMaxWidth().mergedRow("h-${m.id}-$r").headingText(), style = labelLarge)` + 행. Places 행 `PlaceRow(place, lang, spokenMeters, onClick = { open(place, "card-${m.id}-$r-${place.id}") }, modifier = Modifier.focusRequester(originFocus.getOrPut(key) { FocusRequester() }))`. Addresses 행 `AddressRow(address, lang, Modifier.focusRequester(r).clickable(role = Role.Button) { openAddress(address, key) })`. WebResults `WebRow(result)`. `open(place, key) = { vm.rememberReturnFocus(key); onOpenPlace(place) }`. `openAddress` = `scope.launch { vm.resolveAddress(a)?.let { open(it, key) } }`(`scope = rememberCoroutineScope()` — 화면 이탈 시 취소).
- [ ] 출처: 헤딩 `android.chat.sourcesHeading` + 행(`sourceLabelId(label)?.let(res::getString) ?: label`; url http/https → `Modifier.clickable(role = Button) { context.tryStartActivity(Intent(ACTION_VIEW, uri)) }.mergedRow("src-…")`, 아니면 `mergedRow`만).
- [ ] 액션 행(어시스턴트만, 실패 포함): `IconButton(onClick = { context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, m.text), null)) }, Modifier.testTag("share-${m.id}")) { Icon(Icons.Filled.Share, stringResource(R.string.android_chat_share)) }` + `// [M4 뒤] 듣기 버튼 자리`.
- [ ] follow-up: 마지막 메시지가 성공 답변이고 `followUps` 비지 않으면 그 답변 뒤에 헤딩 `android.chat.followUps` + 버튼(`submitSuggestion`).
- [ ] `ChatSourceGuardTest`(spec §9 행 중 조각 ②까지): 줄 분리 API 0(`readLine(`·`lineSequence(`·`BufferedReader`·`.lines()`), `splitStreamLines` 사용, `STREAM_READ_BUFFER_BYTES = 8192` 이상, 채팅 버튼 `enabled =` 0, `focusRequester(` 허용 꼴(`landingTarget` 정의·`Modifier.focusRequester(originFocus`·`Modifier.focusRequester(fieldFocus` — 텍스트 필드는 항상 포커스 가능), 화면이 `rememberReturnFocus`·`takeReturnFocus`를 부른다, `toolLabelId`·`sourceLabelId` 키 집합 == iOS `ChatModel.swift`·`ChatConversationView.swift`의 `case "…":` 추출 집합.
- [ ] 게이트(락) → 커밋 `feat(android): M6 채팅 카드·언급·출처·공유·follow-up — 언급 1개 블록 버튼·2개 이상 커스텀 액션·주소 카드 지오코딩(화면 스코프)·구획 헤딩·소스 가드`

---

## 조각 ③ — 받아쓰기·상세 진입 마무리

### Task 7: `speech/DictationSession.kt` 상태 머신 + 포트 테스트

**Files:** Create `speech/DictationSession.kt`; Test `test/.../speech/DictationSessionTest.kt`

**Produces:** spec §6 코드 블록의 인터페이스 그대로 + 순수 함수:
```kotlin
enum class RecognizerSupport { Installed, NeedsDownload, Unsupported, Unknown }
enum class DownloadResult { Ready, Scheduled, Failed }
fun supportDecision(tag: String, installed: List<String>, supported: List<String>, pending: List<String>): RecognizerSupport   // Locale.forLanguageTag 정규화(언어+지역, 지역 없는 항목은 언어만 비교)
fun speechLanguageTag(appLang: String): String       // ko→ko-KR, en→en-US, es→es-ES, fr→fr-FR, it→it-IT, ja→ja-JP, 그 밖 ko-KR
sealed class DictationErrorOutcome { data object Finish; data object Denied; data class Fail(val kind: DictationFailure) }
fun dictationErrorOutcome(code: Int, stopping: Boolean, listening: Boolean): DictationErrorOutcome
sealed class DictationNotice { data object Preparing; data object DownloadFailed; data class Failure(val kind: DictationFailure); data object Denied }
const val STOP_FINALIZE_TIMEOUT_MS = 3_000L
const val LISTEN_CAP_MS = 60_000L
const val INTERRUPT_SETTLE_MS = 150L
```
(오류 코드 상수는 `SpeechRecognizer.ERROR_*` 값을 그대로 쓰되 JVM 테스트가 안드로이드 스텁 상수를 읽을 수 있으므로 `SpeechRecognizer.ERROR_NO_MATCH` 등을 참조한다. "누적분 전달 후 실패 통지 생략"은 세션 쪽 규칙.)

- [ ] **테스트 먼저**(가짜 포트는 호출 기록 + 테스트가 콜백을 수동 발화, 가짜 효과는 `startTones`·`stopTones`·`interrupts` 카운터와 수동 실행 타이머 큐):
  1. `supportDecision`: installed `["ko-KR"]` + tag ko-KR → Installed; installed `["ko_KR"]`·`["ko"]` → Installed; supported만 → NeedsDownload; pending만 → NeedsDownload; 없음 → Unsupported.
  2. `speechLanguageTag` 표.
  3. `dictationErrorOutcome`: NO_MATCH·SPEECH_TIMEOUT → Finish; CLIENT + stopping → Finish; INSUFFICIENT_PERMISSIONS → Denied; LANGUAGE_NOT_SUPPORTED → Fail(Locale); LANGUAGE_UNAVAILABLE → Fail(OnDevice); AUDIO·RECOGNIZER_BUSY → Fail(Audio); SERVER_DISCONNECTED + listening → Fail(Interrupted); 같은 코드 + !listening → Fail(StartFailed).
  4. 시작 → Installed → phase Listening, 타이머(`INTERRUPT_SETTLE_MS`) 실행 전 `port.start` 0회·실행 후 `interrupts == 1`·`start == 1`; `onReady` → `interrupts == 2`·`startTones == 1`.
  5. NeedsDownload → Preparing(통지 0) → Ready → Listening / Scheduled → 통지 `Preparing`·Idle / Failed → 통지 `DownloadFailed`·Idle. Unsupported → 통지 `Failure(OnDevice)`·Idle.
  6. 분할: `onSegment("강남역")`·`onSegment("근처 카페")`·`onEnd(null)` → `onTranscript("강남역 근처 카페")` 1회·`stopTones == 1`(자동 종료에도 끝소리)·Idle. 비분할 `onEnd("강남역")` → 전달.
  7. 무발화: `onEnd(".")` → 전달 0.
  8. 정지: Listening 토글 → `stopTones == 1`·`port.stop == 1`; 이어 `onEnd` → 전달 1·`stopTones` 여전히 1. 정지 뒤 콜백 없음 → 3초 타이머 실행 → 누적분 전달·`port.cancel == 1`·Idle. 그 뒤 늦은 `onEnd` → 전달 추가 0.
  9. 60초 캡 타이머 → 정지 경로(`stopTones == 1`, `port.stop == 1`).
  10. 준비 중 토글 → `cancel`: 이후 다운로드 `Ready` 콜백이 와도 `port.start` 0회·Idle.
  11. 취소 뒤 옛 세대 `onSegment`·`onEnd` → 전달 0. 취소 → 재시작 → 옛 리스너 `onEnd("옛")` → 새 세션에 붙지 않음.
  12. 오류 + 누적분: `onSegment("강남역")` 뒤 `onError(SERVER_DISCONNECTED)` → `onTranscript("강남역")`·실패 통지 0. 누적 없음 → 통지 `Failure(Interrupted)`.
  13. `markDenied()` → Denied·통지 `Denied`; Denied에서 토글 → 시작.
  14. 이중 정지: Listening 토글 두 번(첫 토글 뒤 stopping) → `port.stop == 1`, 두 번째는 무시.
- [ ] FAIL → 구현 → PASS. `AndroidRecognizerPort(context)`: 세션마다 `SpeechRecognizer.createOnDeviceSpeechRecognizer(context)`; `checkSupport`는 `checkRecognitionSupport(intent, context.mainExecutor, callback)` → `onSupportResult(support)` = `supportDecision(tag, support.installedOnDeviceLanguages, support.supportedOnDeviceLanguages, support.pendingOnDeviceLanguages)`, `onError` → Unknown; `download`는 `Build.VERSION.SDK_INT >= 34`면 `triggerModelDownload(intent, mainExecutor, ModelDownloadListener{ onSuccess→Ready, onScheduled→Scheduled, onError→Failed, onProgress 무시 })`, 33이면 `triggerModelDownload(intent)` 후 Scheduled; `start`는 인텐트(`ACTION_RECOGNIZE_SPEECH`, `EXTRA_LANGUAGE_MODEL = FREE_FORM`, `EXTRA_LANGUAGE`, `EXTRA_SEGMENTED_SESSION = EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS`, `EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS = 60000`) + `RecognitionListener` 어댑터(`onReadyForSpeech`→`onReady`, `onSegmentResults`→`onSegment(첫 후보)`, `onEndOfSegmentedSession`→`onEnd(null)`, `onResults`→`onEnd(첫 후보)`, `onError`→`onError(code)`); `stop`=`stopListening()`; `cancel`=`cancel()`+`destroy()`. `AndroidDictationEffects(context)`: `ToneGenerator(AudioManager.STREAM_SYSTEM, 80)` 지연 생성 `startTone`=`TONE_PROP_BEEP`·`stopTone`=`TONE_PROP_ACK`(각 150ms); `interruptScreenReader()` = `context.getSystemService(AccessibilityManager::class.java)?.takeIf { it.isEnabled }?.interrupt()`; `postDelayed`는 메인 `Handler` + 취소 람다; 한 프레임 대기는 세션이 `INTERRUPT_SETTLE_MS`에 포함(두 프레임 ≈ 33ms를 150ms에 흡수 — 순수 테스트 가능).
- [ ] 커밋 `feat(android): 받아쓰기 세션(speech/ 새 파일) — 온디바이스 인식기 포트·지원/다운로드 판정·interrupt(isEnabled)·분할 누적·종결 한 곳(끝소리 1회·무발화 차단)·정지 3초 상한·60초 캡·세대 토큰·오류 시 누적분 전달`

### Task 8: 받아쓰기 버튼·권한·통지 보류·효과음 연결

**Files:** Modify `chat/ChatScreen.kt`; `ChatSourceGuardTest` 확장

- [ ] `ChatConversation`: `val dictationAvailable = remember { Dictation.isAvailable(context) }`. 참이면 `val session = remember { DictationSession(AndroidRecognizerPort(app), AndroidDictationEffects(app), { speechLanguageTag(AppLocale.current(res)) }, onTranscript = { t -> latestOnTranscript(t) }, onNotice = { n -> latestOnNotice(n) }) }` + `DisposableEffect(session) { onDispose { session.cancel() } }`. `onTranscript = { t -> vm.announceAfter(vm.mergeTranscript(t)) }`의 순서는 **병합 → `land(sendFocus, "transcript")` → `vm.announce(merged)`**. `onNotice`는 종류 → 리소스(`android.voice.preparing`·`errorDownload`·`denied`·`failed`·`voice.errors.stt_failed`·`errorLocale`·`errorOnDevice`·`errorAudio`) → `vm.announce`.
- [ ] 버튼: `val phase by session.phase.collectAsState()`; 라벨 when; `val launcher = rememberLauncherForActivityResult(RequestPermission()) { ok -> if (ok) session.toggle() else session.markDenied() }`; `onClick = { if (context.checkSelfPermission(RECORD_AUDIO) == GRANTED || session.isActive.value) session.toggle() else launcher.launch(RECORD_AUDIO) }`; `Modifier.tapTarget().testTag("chat-dictation")`. `phase is Denied`면 뒤에 설정 열기 버튼(`context.tryStartActivity(appDetailsSettingsIntent(context))`, 실패면 `noAppToOpen` 통지).
- [ ] 통지 보류: `val active by session.isActive.collectAsState()`; `val frozen = remember(active) { s.notice }`; `StatusLine(if (active) frozen else s.notice)`. 완료 착지의 `dictationActive = active`.
- [ ] 소스 가드 추가: 받아쓰기 세션·버튼 생성은 `if (dictationAvailable)` 안(파일 내 `DictationSession(` 등장 위치가 그 블록 안), `createSpeechRecognizer(` 0, `.interrupt()` 호출은 `speech/DictationSession.kt`의 `interruptScreenReader` 한 곳이고 같은 함수에 `isEnabled`.
- [ ] 게이트(락) → 커밋 `feat(android): M6 받아쓰기 버튼(API 33 게이트·탭 토글·권한·거부 시 설정 열기)·전사 병합 후 보내기 착지·세션 활성 중 통지·완료 착지 보류`

### Task 9: androidTest·실호출·CHANGELOG·최종 게이트·리뷰·통합(보고 ③④)

**Files:** Create `androidTest/.../chat/ChatScreenA11yTest.kt`, `test/.../chat/ChatRealCallTest.kt`(Task 5에서 만들었으면 유지); Modify `CHANGELOG.md`

- [ ] `ChatScreenA11yTest`: `ChatViewModel`을 스텁 소스(`ChatStreamSource { flowOf(Status, Done(text = "## 주변\n\n강남역 근처입니다.\n\n- 카페 A", renders = Places(listOf(강남역)), sources)) }`)로 직접 조립, 동의 저장소 `InMemoryKeyValueStore`. 흐름: 동의 버튼 클릭 → `onNodeWithTag("chat-field").assertIsFocused()` → 추천 질문 클릭 → `onNodeWithTag("chat-send").assertIsFocused()` → 완료 대기 → 질문 노드 `assertIsFocused()` → 블록·카드 행이 병합 단일 노드 → `enableAccessibilityChecks()` + `tryPerformAccessibilityChecks()`. 두 번째 테스트: 필드 클릭·입력 중 완료 → 필드 포커스 유지. (머신 게이트 밖, adb 연결 시.)
- [ ] `CHANGELOG.md` 맨 위 날짜 절에 M6 항목 2~4줄 + spec 링크.
- [ ] 락 안 최종 게이트 → 리뷰 디스패치(opus, `git diff main...HEAD`, spec 전체 + 헌장 §5·§6 대조, `review-m6-quality.md`) → 반영 → rebase·`comm` 대조·게이트 → ff 통합 → 보고 ④ → 실기기 설치는 코디네이터 허가 뒤(보고 ⑤).

---

## 자기 점검(spec 대조)

- §1 범위: 탭·장소 채팅(T4)·동의(T3·T4)·전송(T2)·목록 접근성(T4·T6)·입력(T4·T8)·카드→상세(T6)·openChat(T4)·받아쓰기(T7·T8)·매니페스트(T0). 범위 밖 자리 주석: 듣기(T6), 위치 표시줄(T4), 수동 위치(T3 주석).
- §3-4 착지 표 9행: 전송 두 경로(T4)·스트리밍(T4)·완료 성공/실패/조건(T4, 조건 ③은 T8)·지우기(T4)·동의(T4)·장소 진입(T4)·전사(T8)·복귀(T4·T6).
- §5 전송 규칙: IO·감시자 finally·errorStream null·flowOn(T2).
- §6 전 항목(T7) + 버튼·거부(T8).
- §9 테스트 표 행 전부: 리더·HTTP(T2), ViewModel(T3), 받아쓰기(T7), 인라인·주소(T1), 소스 가드(T6·T8), androidTest·실호출(T9·T5).
