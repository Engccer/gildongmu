package space.dodoplanet.gildongmu.chat

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.unit.dp
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.a11y.headingText
import space.dodoplanet.gildongmu.a11y.landingTarget
import space.dodoplanet.gildongmu.a11y.mergedRow
import space.dodoplanet.gildongmu.a11y.tapTarget
import space.dodoplanet.gildongmu.i18n.appLocalized
import space.dodoplanet.gildongmu.kit.bilingualName
import space.dodoplanet.gildongmu.kit.chatPlaceMentions
import space.dodoplanet.gildongmu.kit.models.ChatRenderPayload
import space.dodoplanet.gildongmu.kit.models.JusoAddress
import space.dodoplanet.gildongmu.kit.models.Place
import space.dodoplanet.gildongmu.kit.models.PlaceSort
import space.dodoplanet.gildongmu.nav.tryStartActivity
import space.dodoplanet.gildongmu.search.AddressRow
import space.dodoplanet.gildongmu.search.PlaceRow
import space.dodoplanet.gildongmu.search.WebRow

/** 이 답변의 카드 장소 전부 — 산문 블록 장소 언급의 유일한 근거(장소 앵커 모드처럼 서버가 카드를 생략하면 빈 목록이라 활성화도 없다). */
fun cardPlaces(message: ChatMessage): List<Place> =
    message.renders.filterIsInstance<ChatRenderPayload.Places>().flatMap { it.places }

/**
 * 산문 블록 하나(spec §3-3). 블록은 언제나 **한 접근성 객체**이고 카드 장소 언급 수로 활성화만 가른다:
 * 0개 = 평문 / 1개 = 블록 전체가 버튼(이름만 강조색) / 2개 이상 = 평문 + 장소마다 커스텀 액션(인라인 링크는 노드를 쪼개므로 만들지 않는다).
 */
@Composable
fun AnswerBlock(
    key: String,
    source: String,
    heading: Boolean,
    places: List<Place>,
    lang: String,
    targets: ChatFocusTargets,
    onOpenPlace: (Place, String) -> Unit,
) {
    val res = LocalContext.current.resources
    val inline = chatInlineText(source)
    val mentions = chatPlaceMentions(source, places)
    val accent = MaterialTheme.colorScheme.primary
    val text = inline.annotated().withNames(inline.plain, mentions.map { it.name }, SpanStyle(color = accent))
    val base = Modifier.fillMaxWidth()
    val row = when (mentions.size) {
        0 -> base.mergedRow(key, focus = targets.row(key))
        1 -> base.clickable(role = Role.Button) { onOpenPlace(mentions[0], key) }.mergedRow(key, focus = targets.row(key))
        else -> {
            val actions = mentions.map { place ->
                val label = appLocalized(res, R.string.android_chat_openPlace, bilingualName(lang, place.name, en = null, roman = place.nameRoman).primary)
                CustomAccessibilityAction(label) { onOpenPlace(place, key); true }
            }
            base.mergedRow(key, focus = targets.row(key)).semantics { customActions = actions }
        }
    }
    Text(
        text,
        (if (heading) row.headingText() else row).padding(vertical = 4.dp),
        style = if (heading) MaterialTheme.typography.titleMedium else MaterialTheme.typography.bodyLarge,
    )
}

/** 평문 안의 장소 이름 구간을 칠한다(시각 전용 — 판정은 `:kit`이 원문 블록으로 한다). */
private fun AnnotatedString.withNames(plain: String, names: List<String>, style: SpanStyle): AnnotatedString {
    if (names.isEmpty()) return this
    val builder = AnnotatedString.Builder(this)
    for (name in names.filter { it.isNotEmpty() }) {
        var from = plain.indexOf(name)
        while (from >= 0) {
            builder.addStyle(style, from, from + name.length)
            from = plain.indexOf(name, from + name.length)
        }
    }
    return builder.toAnnotatedString()
}

/**
 * 답변 뒤 렌더 묶음·출처·응답 액션(spec §3-3 2~4). 비지 않은 묶음마다 수를 실은 구획 헤딩(카드 시작점 점프·몇 개를 지날지). 착지 키의 `r`은 묶음 인덱스 —
 * 정확도순·리뷰순 묶음에 같은 장소가 있어도 키가 겹치지 않는다.
 */
@Composable
fun AnswerExtras(
    message: ChatMessage,
    lang: String,
    targets: ChatFocusTargets,
    onOpenPlace: (Place, String) -> Unit,
    onOpenAddress: (JusoAddress, String) -> Unit,
    onNoApp: () -> Unit,
) {
    val context = LocalContext.current
    val res = context.resources
    val spokenMeters = stringResource(R.string.android_unit_spokenMeters)
    Column(Modifier.fillMaxWidth()) {
        message.renders.forEachIndexed { r, render ->
            when (render) {
                is ChatRenderPayload.Places -> if (render.places.isNotEmpty()) {
                    val count = render.places.size
                    SectionHeading(
                        "h-${message.id}-$r",
                        if (render.sort == PlaceSort.review) appLocalized(res, R.string.chat_reviewPlacesHeading, count) else appLocalized(res, R.string.android_chat_placesHeading, count),
                    )
                    for (place in render.places) {
                        key(place.id) {
                            val rowKey = "card-${message.id}-$r-${place.id}"
                            PlaceRow(place, lang, spokenMeters, onClick = { onOpenPlace(place, rowKey) }, modifier = Modifier.landingTarget(targets.row(rowKey)))
                        }
                    }
                }
                is ChatRenderPayload.Addresses -> if (render.addresses.isNotEmpty()) {
                    SectionHeading("h-${message.id}-$r", appLocalized(res, R.string.android_chat_addressesHeading, render.addresses.size))
                    for (address in render.addresses) {
                        key(address.roadAddr) {
                            val rowKey = "address-${message.id}-$r-${address.roadAddr}"
                            AddressRow(address, lang, Modifier.landingTarget(targets.row(rowKey)).clickable(role = Role.Button) { onOpenAddress(address, rowKey) })
                        }
                    }
                }
                is ChatRenderPayload.WebResults -> if (render.results.isNotEmpty()) {
                    SectionHeading("h-${message.id}-$r", appLocalized(res, R.string.android_chat_webResultsHeading, render.results.size))
                    for (result in render.results) key(result.url) { WebRow(result) }
                }
                ChatRenderPayload.Unsupported -> Unit // 산문이 정본
            }
        }
        if (message.sources.isNotEmpty()) {
            SectionHeading("sources-${message.id}", stringResource(R.string.android_chat_sourcesHeading))
            message.sources.forEachIndexed { i, source ->
                val label = sourceLabelId(source.label)?.let { stringResource(it) } ?: source.label // 미지 라벨은 원문(키 누락이 드러난다)
                val uri = source.url?.let(Uri::parse)?.takeIf { it.scheme?.lowercase() in setOf("http", "https") }
                val row = if (uri != null) {
                    Modifier.fillMaxWidth().clickable(role = Role.Button) { if (!context.tryStartActivity(Intent(Intent.ACTION_VIEW, uri))) onNoApp() }
                } else {
                    Modifier.fillMaxWidth()
                }
                Text(label, row.mergedRow("source-${message.id}-$i").padding(vertical = 4.dp), style = MaterialTheme.typography.bodyMedium)
            }
        }
        // 응답 액션 행 — 답변 원문 공유(선택기는 항상 있어 실패 분기 없음). [M4 뒤] 듣기(TTS) 버튼 자리
        Row(Modifier.fillMaxWidth()) {
            IconButton(
                onClick = {
                    val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, message.text)
                    context.tryStartActivity(Intent.createChooser(send, null))
                },
                modifier = Modifier.testTag("share-${message.id}"),
            ) { Icon(Icons.Filled.Share, contentDescription = stringResource(R.string.android_chat_share)) }
        }
    }
}

/** 마지막 성공 답변 뒤 follow-up 질문. 도착 통지 없음 — 구획 헤딩이 발견 경로(TalkBack엔 컨테이너 진입 낭독이 없다, spec 판정 4). */
@Composable
fun FollowUpChips(messageId: Long, followUps: List<String>, onSubmit: (String) -> Unit) {
    SectionHeading("followups-$messageId", stringResource(R.string.android_chat_followUps))
    followUps.forEachIndexed { index, text ->
        OutlinedButton(
            onClick = { onSubmit(text) },
            modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp).tapTarget().testTag("followup-$index"),
        ) { Text(text) }
    }
}

/** 구획 헤딩 한 줄: 시각은 작은 캡션, 스크린 리더는 헤딩. */
@Composable
private fun SectionHeading(key: String, title: String) {
    Text(title, Modifier.fillMaxWidth().padding(top = 12.dp).mergedRow(key).headingText(), style = MaterialTheme.typography.labelLarge)
}
