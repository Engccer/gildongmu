package space.dodoplanet.gildongmu.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import space.dodoplanet.gildongmu.a11y.headingText
import space.dodoplanet.gildongmu.a11y.mergedRow
import space.dodoplanet.gildongmu.kit.models.JusoAddress
import space.dodoplanet.gildongmu.kit.models.Place
import space.dodoplanet.gildongmu.kit.parseChatMarkdownBlocks

/**
 * 착지 대상 requester 보관(화면 하나에 하나). 질문 헤딩은 메시지 id, 블록·카드 행은 키 문자열(`block-<msg>-<i>` 등) — 완료 착지와
 * pop 복귀 착지가 같은 맵을 쓴다.
 */
class ChatFocusTargets {
    private val questions = HashMap<Long, FocusRequester>()
    private val rows = HashMap<String, FocusRequester>()

    fun question(id: Long): FocusRequester = questions.getOrPut(id) { FocusRequester() }

    fun row(key: String): FocusRequester = rows.getOrPut(key) { FocusRequester() }

    fun existingRow(key: String): FocusRequester? = rows[key]

    fun existingQuestion(id: Long): FocusRequester? = questions[id]
}

/**
 * 대화 목록(spec §3-3). eager — 화면 밖 메시지도 접근성 트리에 있어야 착지·선형 탐색이 닿는다(가상 스크롤 금지).
 * 답변은 산문 블록(장소 언급 활성화) → 렌더 묶음·출처·응답 액션 → (마지막 성공 답변이면) follow-up 칩 순.
 */
@Composable
fun ChatMessageList(
    messages: List<ChatMessage>,
    followUps: List<String>,
    lang: String,
    targets: ChatFocusTargets,
    onOpenPlace: (Place, String) -> Unit,
    onOpenAddress: (JusoAddress, String) -> Unit,
    onSubmitFollowUp: (String) -> Unit,
    onNoApp: () -> Unit,
) {
    val lastId = messages.lastOrNull()?.id
    for (message in messages) {
        key(message.id) {
            when (message.role) {
                ChatRole.user -> QuestionHeading(message, targets)
                ChatRole.assistant -> Column(Modifier.fillMaxWidth()) {
                    val places = cardPlaces(message)
                    val blocks = parseChatMarkdownBlocks(message.text)
                    if (blocks.isEmpty()) {
                        AnswerBlock("block-${message.id}-0", message.text, heading = false, places, lang, targets, onOpenPlace)
                    } else {
                        blocks.forEachIndexed { index, block ->
                            AnswerBlock("block-${message.id}-$index", block.text, block.isHeading, places, lang, targets, onOpenPlace)
                        }
                    }
                    AnswerExtras(message, lang, targets, onOpenPlace, onOpenAddress, onNoApp)
                    if (message.id == lastId && !message.failed && followUps.isNotEmpty()) FollowUpChips(message.id, followUps, onSubmitFollowUp)
                }
            }
        }
    }
}

/** 질문 = 원문 그대로 한 객체 + 헤딩(턴 단위 점프의 유일한 발견 경로, 헌장 §6). 마크다운 해석 없음. */
@Composable
private fun QuestionHeading(message: ChatMessage, targets: ChatFocusTargets) {
    Text(
        message.text,
        Modifier
            .fillMaxWidth()
            .padding(top = 16.dp, bottom = 8.dp)
            .background(MaterialTheme.colorScheme.secondaryContainer, RoundedCornerShape(12.dp))
            .mergedRow("question-${message.id}", focus = targets.question(message.id))
            .headingText()
            .padding(12.dp),
        style = MaterialTheme.typography.bodyLarge,
    )
}

/** 굵게·고정폭 구간을 스팬으로. 스팬은 접근성 노드를 쪼개지 않는다(링크는 쪼개므로 만들지 않는다). */
fun ChatInlineText.annotated(): AnnotatedString = buildAnnotatedString {
    append(plain)
    bold.forEach { addStyle(SpanStyle(fontWeight = FontWeight.Bold), it.first, it.last + 1) }
    code.forEach { addStyle(SpanStyle(fontFamily = FontFamily.Monospace), it.first, it.last + 1) }
}
