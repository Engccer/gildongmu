package space.dodoplanet.gildongmu.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.layout.WindowInsetsRulers
import androidx.compose.foundation.layout.fitInside
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.annotation.StringRes
import androidx.lifecycle.viewmodel.compose.viewModel
import space.dodoplanet.gildongmu.AppConfig
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.a11y.AppScreenScaffold
import space.dodoplanet.gildongmu.a11y.StatusLine
import space.dodoplanet.gildongmu.a11y.landingTarget
import space.dodoplanet.gildongmu.a11y.tapTarget
import space.dodoplanet.gildongmu.i18n.AppLocale
import space.dodoplanet.gildongmu.kit.bilingualName
import space.dodoplanet.gildongmu.kit.models.Place
import space.dodoplanet.gildongmu.kit.placeChatPromptKeys
import space.dodoplanet.gildongmu.location.LocationBarRow

/** 채팅 탭(일반 채팅, spec §3-1). 대화는 이 탭 백스택 엔트리의 ViewModel — 탭 전환에도 이어진다. */
@Composable
fun ChatTabScreen(onOpenPlace: (Place) -> Unit) {
    val context = LocalContext.current
    val vm: ChatViewModel = viewModel(factory = chatViewModelFactory(context, null))
    val titleFocus = remember { FocusRequester() }
    val suggestions = listOf(
        R.string.android_chat_suggestion1,
        R.string.android_chat_suggestion2,
        R.string.android_chat_suggestion3,
        R.string.android_chat_suggestion4,
    ).map { stringResource(it) }
    AppScreenScaffold(stringResource(R.string.android_tab_chat), onBack = null, titleFocus = titleFocus) { padding ->
        // 위치 표시줄은 채팅 탭에만(장소 채팅은 장소 좌표가 앵커라 표시줄이 거짓 신호가 된다, spec §3-1)
        ChatBody(vm, suggestions, titleFocus, landOnEntry = false, onOpenPlace, Modifier.padding(padding), showsLocationBar = true)
    }
}

/** 장소 채팅(장소 앵커, spec §3-1). 스택 엔트리마다 새 대화, pop이 스트림을 끊는다(ViewModel 해제). */
@Composable
fun PlaceChatScreen(route: PlaceChatRoute, onBack: () -> Unit, onOpenPlace: (Place) -> Unit) {
    val context = LocalContext.current
    val place = remember(route) { route.place } // JSON 디코딩은 한 번
    val vm: ChatViewModel = viewModel(factory = chatViewModelFactory(context, place))
    val lang = remember(context.resources) { AppLocale.current(context.resources) }
    val titleFocus = remember { FocusRequester() }
    val suggestions = placeChatPromptKeys(place).mapNotNull { placePromptId(it) }.map { stringResource(it) }
    val title = bilingualName(lang, place.name, en = null, roman = place.nameRoman).primary
    AppScreenScaffold(title, onBack = onBack, titleFocus = titleFocus) { padding ->
        ChatBody(vm, suggestions, titleFocus, landOnEntry = true, onOpenPlace, Modifier.padding(padding))
    }
}

/** 장소 유형별 예시 프롬프트 키(`:kit` `placeChatPromptKeys`) → 리소스. 리터럴 매핑. */
@StringRes
private fun placePromptId(key: String): Int? = when (key) {
    "placeChat.prompt.stationArrivals" -> R.string.placeChat_prompt_stationArrivals
    "placeChat.prompt.stationFacilities" -> R.string.placeChat_prompt_stationFacilities
    "placeChat.prompt.stationSurroundings" -> R.string.placeChat_prompt_stationSurroundings
    "placeChat.prompt.foodRoute" -> R.string.placeChat_prompt_foodRoute
    "placeChat.prompt.foodSimilar" -> R.string.placeChat_prompt_foodSimilar
    "placeChat.prompt.foodWeather" -> R.string.placeChat_prompt_foodWeather
    "placeChat.prompt.generalRoute" -> R.string.placeChat_prompt_generalRoute
    "placeChat.prompt.generalSurroundings" -> R.string.placeChat_prompt_generalSurroundings
    "placeChat.prompt.generalWeather" -> R.string.placeChat_prompt_generalWeather
    else -> null
}

/** 동의 게이트 + 대화. 동의는 앱 전역이라 열린 화면이 함께 전환되고, 착지는 동의를 누른 화면에서만(spec §3-2). */
@Composable
private fun ChatBody(
    vm: ChatViewModel,
    suggestions: List<String>,
    titleFocus: FocusRequester,
    landOnEntry: Boolean,
    onOpenPlace: (Place) -> Unit,
    modifier: Modifier,
    showsLocationBar: Boolean = false,
) {
    val granted by vm.consentGranted.collectAsState()
    val fieldFocus = remember { FocusRequester() }
    var agreedHere by remember { mutableStateOf(false) }
    // push 진입 1회 — 백스택 복귀(상세 pop)·구성 변경에 살아남아, 복귀 착지와 겹쳐 제목을 한 번 거치지 않게 한다.
    var entryLanded by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(Unit) { vm.ensureConsentLoaded() } // 첫 읽기는 IO

    // 장소 채팅 진입(push): 누른 "물어보기" 버튼이 사라지는 전이 — 상단 바 제목 헤딩으로(동의 여부 무관, M2 장소 상세 진입 착지와 같은 꼴).
    if (landOnEntry && !entryLanded) {
        LaunchedEffect(Unit) {
            withFrameNanos { }
            land(titleFocus, "entry")
            entryLanded = true
        }
    }
    // 동의 → 텍스트 필드. 동의 상태가 커밋된 뒤 첫 프레임(사라진 동의 버튼에서의 이탈 차단, 헌장 §5).
    LaunchedEffect(granted, agreedHere) {
        if (granted == true && agreedHere) {
            withFrameNanos { }
            land(fieldFocus, "consent")
            agreedHere = false
        }
    }

    when (granted) {
        null -> Unit // 아직 읽는 중 — 한 프레임 수준, 아무것도 그리지 않는다
        false -> {
        val notice by vm.state.collectAsState()
        ChatConsentContent(
            notice = notice.notice,
            onAgree = { vm.grantConsent(); agreedHere = true },
            onNoApp = { vm.announce(it) },
            modifier = modifier,
        )
        }
        true -> ChatConversation(vm, suggestions, fieldFocus, onOpenPlace, showsLocationBar, modifier)
    }
}

@Composable
private fun ChatConversation(
    vm: ChatViewModel,
    suggestions: List<String>,
    fieldFocus: FocusRequester,
    onOpenPlace: (Place) -> Unit,
    showsLocationBar: Boolean,
    modifier: Modifier,
) {
    val s by vm.state.collectAsState()
    val scroll = rememberScrollState()
    val sendFocus = remember { FocusRequester() }
    val targets = remember { ChatFocusTargets() }
    var fieldFocused by remember { mutableStateOf(false) }
    val dictationActive = false // [조각 ③] 받아쓰기 세션 활성
    val sendingLabel = stringResource(R.string.android_chat_sending)
    val failedText = stringResource(R.string.android_chat_failed)

    fun afterSend() {
        land(sendFocus, "send")
    }

    // 전송 뒤 끝으로 스크롤 — 새 질문이 배치된 뒤의 maxValue를 읽도록 메시지 수 변화의 효과에서(핸들러 안의 값은 새 질문 이전이다).
    LaunchedEffect(s.messages.size) {
        if (s.messages.lastOrNull()?.role == ChatRole.user) scroll.animateScrollTo(scroll.maxValue)
    }

    fun submitDraft() {
        if (vm.sendDraft()) afterSend()
    }

    fun submitSuggestion(text: String) {
        if (vm.send(text)) afterSend()
    }

    // 완료 착지(spec §3-4): 성공 = 마지막 질문 헤딩, 실패 = 실패 블록. 이 화면 진입 뒤의 답변만, 한 번만.
    // 스트리밍 중(새 질문)·받아쓰기 활성·입력 중이면 건너뛰되 소비한다 — 그때는 끝으로 스크롤만.
    // 실패인데 착지하지 못했으면 통지 줄에 실패 문장 — 착지가 유일한 성패 신호라 건너뛰면 실패가 조용해진다(리뷰 R2-M1).
    val initialAnswerRevision = remember { s.answerRevision }
    // 소비한 완료 세대 — [조각 ③] 전사 착지가 대기 중인 완료 착지를 소비할 때 이 값을 올린다.
    var consumedRevision by remember { mutableIntStateOf(initialAnswerRevision) }
    LaunchedEffect(s.answerRevision) {
        val revision = s.answerRevision
        if (revision <= consumedRevision) return@LaunchedEffect
        consumedRevision = revision
        withFrameNanos { }
        val current = vm.state.value
        val last = current.messages.lastOrNull()
        val blocked = current.isStreaming || dictationActive || fieldFocused
        val target = when {
            blocked || last == null -> null
            last.failed -> targets.existingRow("block-${last.id}-0")
            else -> current.messages.lastOrNull { it.role == ChatRole.user }?.let { targets.existingQuestion(it.id) }
        }
        val landed = target != null && land(target, if (last?.failed == true) "completion-failed" else "completion")
        if (!landed) {
            if (last?.failed == true && !current.isStreaming) vm.announce(failedText) // [조각 ③] 받아쓰기 활성이면 세션 끝에 전사 통지와 결합
            scroll.animateScrollTo(scroll.maxValue)
        }
    }
    // 위치 표시줄은 진입 시점 스냅샷이다 — 같은 화면의 전송(측위·권한 허용)이 상태를 바꿨을 수 있어 답변 뒤 다시 맞춘다(좌표당 1회는 스토어가 막는다).
    if (showsLocationBar) {
        val res = LocalContext.current.resources
        LaunchedEffect(s.answerRevision) {
            if (s.answerRevision > initialAnswerRevision) AppConfig.currentAddressStore.ensureLoaded(AppLocale.dataLocale(res))
        }
    }
    // pop 복귀: 상세를 연 원점(카드·블록·주소 행)으로. 키는 한 번만 소비된다.
    LaunchedEffect(Unit) {
        val key = vm.takeReturnFocus() ?: return@LaunchedEffect
        withFrameNanos { }
        land(targets.existingRow(key), "return")
    }

    // Android 15+ edge-to-edge: adjustResize는 창을 줄이지 않고 IME 인셋만 준다 — 입력 바가 키보드 뒤로 숨지 않게 이 컨테이너를 IME 위로 맞춘다.
    Column(modifier.fillMaxSize().fitInside(WindowInsetsRulers.Ime.current).semantics { testTagsAsResourceId = true }) {
        if (showsLocationBar) {
            // 대화의 조회 기준 좌표(iOS `LocationBarView`) — 스크롤 밖 첫 줄
            Column(Modifier.padding(horizontal = 16.dp)) { LocationBarRow(AppConfig.currentAddressStore) }
        }
        Column(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(scroll)
                .padding(horizontal = 16.dp),
        ) {
            if (s.messages.isEmpty()) {
                suggestions.forEachIndexed { index, text ->
                    OutlinedButton(
                        onClick = { submitSuggestion(text) },
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp).tapTarget().testTag("suggestion-$index"),
                    ) { Text(text) }
                }
            }
            ChatMessageList(s.messages, targets)
        }
        // 통지 줄은 스크롤 밖 — 목록을 올려 읽는 중에도 라이브 리전이 화면 안에 있다(읽기 순서는 목록 끝 → 통지 → 입력 그대로).
        Row(Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (s.isStreaming) {
                // 시각 전용 진행 표시 — 진행 문장은 옆의 통지 줄이 말한다
                CircularProgressIndicator(Modifier.size(16.dp).clearAndSetSemantics { })
            }
            StatusLine(s.notice, Modifier.padding(vertical = 4.dp))
        }
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
            TextField(
                state = vm.draft,
                lineLimits = TextFieldLineLimits.SingleLine,
                label = { Text(stringResource(R.string.chat_inputLabel)) },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                // 하드웨어 Enter도 단일행 필드에선 이 경로로 온다(M1 검색 관례)
                onKeyboardAction = { if (!s.isStreaming) submitDraft() },
                trailingIcon = if (vm.draft.text.isNotEmpty()) {
                    {
                        // 초안이 있을 때만. 누르면 자신이 사라지므로 필드로 선점 착지(헌장 §5).
                        IconButton(onClick = { vm.clearDraft(); land(fieldFocus, "clear") }, modifier = Modifier.testTag("chat-clear")) {
                            Icon(Icons.Filled.Close, contentDescription = stringResource(R.string.android_chat_clear))
                        }
                    }
                } else {
                    null
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag("chat-field")
                    .landingTarget(fieldFocus)
                    .onFocusChanged { fieldFocused = it.hasFocus },
            )
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
                // [조각 ③] 받아쓰기 버튼(API 33 게이트) · 거부 시 설정 열기
                Button(
                    // 스트리밍 중엔 무시 — enabled=false는 포커스를 떨군다(헌장 §5 ⓐ). 상태는 stateDescription이 말한다.
                    onClick = { if (!s.isStreaming) submitDraft() },
                    modifier = Modifier
                        .landingTarget(sendFocus)
                        .tapTarget()
                        .testTag("chat-send")
                        .semantics { if (s.isStreaming) stateDescription = sendingLabel },
                ) { Text(stringResource(R.string.chat_send)) }
            }
        }
    }
}
