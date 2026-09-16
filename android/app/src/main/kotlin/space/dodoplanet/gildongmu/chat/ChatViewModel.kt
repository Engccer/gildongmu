package space.dodoplanet.gildongmu.chat

import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.foundation.text.input.clearText
import androidx.compose.foundation.text.input.setTextAndPlaceCursorAtEnd
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import space.dodoplanet.gildongmu.a11y.Notice
import space.dodoplanet.gildongmu.kit.isStation
import space.dodoplanet.gildongmu.kit.models.AddressMatch
import space.dodoplanet.gildongmu.kit.models.ChatRenderPayload
import space.dodoplanet.gildongmu.kit.models.ChatRequestBody
import space.dodoplanet.gildongmu.kit.models.ChatSource
import space.dodoplanet.gildongmu.kit.models.ChatStreamEvent
import space.dodoplanet.gildongmu.kit.models.JusoAddress
import space.dodoplanet.gildongmu.kit.models.Place
import space.dodoplanet.gildongmu.nav.ReturnFocusSlot

enum class ChatRole { user, assistant }

/** 메시지 하나(iOS `ChatMessage` 미러). `failed`는 실패 문구 답변 — 완료 착지 대상이 갈린다(spec §3-4). */
data class ChatMessage(
    val id: Long,
    val role: ChatRole,
    val text: String,
    val failed: Boolean = false,
    val renders: List<ChatRenderPayload> = emptyList(),
    val sources: List<ChatSource> = emptyList(),
)

data class ChatUiState(
    val messages: List<ChatMessage> = emptyList(),
    val isStreaming: Boolean = false,
    /** 마지막 성공 답변 뒤 follow-up 질문. 전송 시 비운다. */
    val followUps: List<String> = emptyList(),
    /** 답변(성공·실패) 도착 세대 — 화면의 완료 착지 신호. */
    val answerRevision: Int = 0,
    /** 화면의 단일 polite 창구(진행 문장·주소 실패·받아쓰기 결과). */
    val notice: Notice = Notice(0, ""),
)

/** 위치(iOS `LocationService` 사용분). `prime`은 일반 채팅 전송 직전 1회 측위 시도, `last`는 저장 좌표(없으면 null). */
interface ChatLocation {
    suspend fun prime()
    fun last(): ChatRequestBody.Coordinate?
}

/**
 * 대화 상태 머신(iOS `ChatModel` 미러, spec §4). `place`가 있으면 장소 앵커 채팅(스택 엔트리마다 새 대화), 없으면 채팅 탭.
 * 스트림은 `viewModelScope` 한 잡 — 장소 채팅 pop(ViewModel 해제)이 스트림을 끊고, 탭 전환은 끊지 않는다.
 */
class ChatViewModel(
    val place: Place?,
    private val stream: ChatStreamSource,
    private val suggestions: ChatSuggestionsSource,
    private val geocode: suspend (String) -> AddressMatch?,
    private val consent: ChatConsentStore,
    private val location: ChatLocation,
    private val lang: () -> String,
    private val dataLocale: () -> String,
    private val strings: ChatStrings,
    private val sounds: ChatSounds,
    savedState: SavedStateHandle,
) : ViewModel() {
    /** 입력 초안(화면 재구성·탭 전환에도 남는다). */
    val draft = TextFieldState()

    private val _state = MutableStateFlow(ChatUiState())
    val state: StateFlow<ChatUiState> = _state.asStateFlow()

    /** AI 전송 동의(앱 전역 저장소 — 탭·장소 화면이 함께 전환된다). null = 아직 읽지 않음. */
    val consentGranted: StateFlow<Boolean?> get() = consent.granted

    suspend fun ensureConsentLoaded() = consent.ensureLoaded()

    fun grantConsent() = consent.grant()

    private val returnFocus = ReturnFocusSlot(savedState)
    private var nextId = 1L
    private var followUpJob: Job? = null
    private var resolvingAddress = false

    /**
     * 전송. 동의 가드는 UI 게이트가 뚫려도 미동의 전송을 구조적으로 막는다(iOS 이중 방어). 받아들였으면 true — 화면이 보내기 버튼으로 착지한다.
     * 초안은 건드리지 않는다(추천 질문·follow-up 칩 경로, iOS 동형). 입력 필드 경로는 [sendDraft].
     */
    fun send(text: String): Boolean {
        val trimmed = text.trim()
        if (consent.granted.value != true || trimmed.isEmpty() || _state.value.isStreaming) return false
        clearFollowUps()
        val question = ChatMessage(nextId++, ChatRole.user, trimmed)
        _state.update { it.copy(messages = it.messages + question, isStreaming = true, notice = cleared(it.notice)) }
        sounds.send()
        viewModelScope.launch { runStream() }
        return true
    }

    /** 입력 필드 경로: 받아들였을 때만 초안을 비운다(스트리밍 중 IME 전송이 초안을 잃지 않게). */
    fun sendDraft(): Boolean {
        val accepted = send(draft.text.toString())
        if (accepted) draft.clearText()
        return accepted
    }

    fun clearDraft() {
        draft.clearText()
        _state.update { it.copy(notice = cleared(it.notice)) }
    }

    /** 받아쓰기 전사를 초안에 병합한다(공백뿐인 초안은 버린다). 병합 결과가 곧 통지 원문이다 — 들은 것이 보낼 것. */
    fun mergeTranscript(transcript: String): String {
        val typed = draft.text.toString().trim()
        val merged = if (typed.isEmpty()) transcript else "$typed $transcript"
        draft.setTextAndPlaceCursorAtEnd(merged)
        return merged
    }

    fun announce(text: String) {
        _state.update { it.copy(notice = Notice(it.notice.seq + 1, text)) }
    }

    fun rememberReturnFocus(key: String) = returnFocus.remember(key)

    fun takeReturnFocus(): String? = returnFocus.take()

    /**
     * 주소 카드 → 장소(spec §4-4). 화면의 컴포지션 스코프에서 부른다 — 화면이 떠나면 취소되어 늦은 결과로 상세를 열지 않는다.
     * 0건과 조회 실패는 다른 문장(3-state). 진행 중 재탭은 null.
     */
    suspend fun resolveAddress(address: JusoAddress): Place? {
        if (resolvingAddress) return null
        resolvingAddress = true
        try {
            val match = try {
                geocode(address.roadAddrPart1.ifEmpty { address.roadAddr })
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                announce(strings.addressLookupFailed())
                return null
            }
            if (match == null) {
                announce(strings.addressNotFound())
                return null
            }
            return jusoAddressToPlace(address, match, dataLocale())
        } finally {
            resolvingAddress = false
        }
    }

    private suspend fun runStream() {
        // 일반 채팅만 전송 직전 1회 측위(최초면 권한 다이얼로그). 실패해도 계속 — 위치는 필수가 아니다(iOS `try?`).
        if (place == null) {
            try {
                location.prime()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // 좌표 없이 전송
            }
        }
        var done: ChatStreamEvent.Done? = null
        var errored = false
        try {
            stream.events(requestBody()).collect { event ->
                when (event) {
                    is ChatStreamEvent.Status -> announceProgress(event.categories)
                    is ChatStreamEvent.Done -> done = event
                    is ChatStreamEvent.Error -> errored = true
                    ChatStreamEvent.Unknown -> Unit // 전방 호환
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            errored = true
        }
        // 취소로 닫힌 연결은 IOException으로 깨어난다 — 떠난 화면에 실패 답변·완료음을 내지 않는다(iOS `guard !Task.isCancelled`).
        currentCoroutineContext().ensureActive()

        val finished = done
        val answer = if (finished != null && !errored) {
            ChatMessage(nextId++, ChatRole.assistant, finished.text.ifEmpty { strings.emptyAnswer() }, renders = finished.renders, sources = finished.sources)
        } else {
            ChatMessage(nextId++, ChatRole.assistant, strings.failed(), failed = true)
        }
        _state.update {
            it.copy(
                messages = it.messages + answer,
                isStreaming = false,
                answerRevision = it.answerRevision + 1,
                notice = cleared(it.notice),
            )
        }
        sounds.receive() // 성패 무관 턴 경계 신호
        if (!answer.failed) loadFollowUps(answer.text)
    }

    private fun loadFollowUps(answer: String) {
        val question = _state.value.messages.lastOrNull { it.role == ChatRole.user }?.text ?: return
        val locale = lang()
        val placeName = place?.name
        followUpJob = viewModelScope.launch {
            val list = suggestions.fetch(question, answer, locale, placeName)
            currentCoroutineContext().ensureActive()
            _state.update { it.copy(followUps = list) }
        }
    }

    private fun clearFollowUps() {
        followUpJob?.cancel()
        followUpJob = null
        _state.update { it.copy(followUps = emptyList()) }
    }

    private fun announceProgress(categories: List<String>) {
        val labels = categories.joinToString(", ") { strings.toolLabel(it) }
        announce(if (labels.isEmpty()) strings.progressFallback() else strings.progressSearching(labels))
    }

    /**
     * 대화 전체 히스토리(실패 문구 포함, iOS 동형) + 장소 앵커. `userLocation`은 유효 좌표(수동 위치 > GPS 저장 좌표, M2c) — 장소 앵커는 서버가 `placeContext`로 처리하고
     * 길찾기 출발지는 이 필드를 쓴다(장소로 덮지 않는다). // [M2c] 수동 위치가 GPS보다 앞선다.
     */
    private fun requestBody(): ChatRequestBody = ChatRequestBody(
        messages = _state.value.messages.map { ChatRequestBody.Turn(it.role.name, it.text) },
        userLocation = location.last(),
        locale = lang(),
        placeContext = place?.let {
            ChatRequestBody.PlaceContext(it.name, it.lat, it.lng, it.category.ifEmpty { null }, isStation(it))
        },
    )

    /** 통지 비움 — 같은 창구의 다음 문장이 새 seq로 발화되게 seq를 올린다(빈 문장은 발화되지 않는다). */
    private fun cleared(notice: Notice): Notice = if (notice.text.isEmpty()) notice else Notice(notice.seq + 1, "")
}
