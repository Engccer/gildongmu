package space.dodoplanet.gildongmu.search

import android.content.ActivityNotFoundException
import android.content.Intent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Star
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import android.net.Uri
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import space.dodoplanet.gildongmu.a11y.mergedRow
import space.dodoplanet.gildongmu.kit.bilingualName
import space.dodoplanet.gildongmu.kit.joinText
import space.dodoplanet.gildongmu.kit.models.JusoAddress
import space.dodoplanet.gildongmu.kit.models.Place
import space.dodoplanet.gildongmu.kit.models.WebSearchResult
import space.dodoplanet.gildongmu.kit.pickCategory

// 결과 행·최근 검색 행·칩 축(spec §3-5·§3-7·§3-8). 판정은 :kit, 여기는 시각·시맨틱 조립만.

/** 장소 행: 이름 줄 + `분류, 주소` 줄을 한 객체로. M1은 비활성 텍스트(상세는 M2). 거리는 M1에 좌표가 없어 오지 않는다. */
@Composable
fun PlaceRow(place: Place, lang: String, modifier: Modifier = Modifier) {
    val name = bilingualName(lang, place.name, en = null, roman = place.nameRoman)
    val secondary = joinText(
        pickCategory(lang, place.category, place.categoryEn),
        place.roadAddress.ifEmpty { place.address },
    )
    val spoken = if (name.secondary == null) null else joinText(name.primary, secondary)
    Column(modifier.fillMaxWidth().mergedRow("place-${place.id}", spoken).padding(vertical = 8.dp)) {
        Text(name.display, style = MaterialTheme.typography.bodyLarge)
        if (secondary.isNotEmpty()) Text(secondary, style = MaterialTheme.typography.bodyMedium)
    }
}

/** 주소 행: `roadAddr, zipNo`. 비-ko는 시각 `engAddr (roadAddr), zipNo`, 낭독은 괄호 없이(E28 판정 ③). */
@Composable
fun AddressRow(address: JusoAddress, lang: String, modifier: Modifier = Modifier) {
    val name = bilingualName(lang, address.roadAddr, en = address.engAddr, roman = null)
    val spoken = if (name.secondary == null) null else "${name.primary}, ${address.zipNo}"
    Column(modifier.fillMaxWidth().mergedRow("address-${address.roadAddr}", spoken).padding(vertical = 8.dp)) {
        Text("${name.display}, ${address.zipNo}", style = MaterialTheme.typography.bodyLarge)
    }
}

/**
 * 웹 결과 행: 제목+요약 한 객체. 외부 URL은 비신뢰 데이터라 `http`/`https`만 브라우저로 열고(다른 스킴은 타 앱
 * 딥링크가 될 수 있다) 그 밖은 비활성 텍스트 객체로 남긴다. 열 앱이 없어도 행은 남는다.
 */
@Composable
fun WebRow(result: WebSearchResult, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val uri = Uri.parse(result.url)
    val openable = uri.scheme?.lowercase() in setOf("http", "https")
    Column(
        modifier
            .fillMaxWidth()
            .then(
                if (openable) {
                    Modifier.clickable(role = Role.Button) {
                        try {
                            context.startActivity(Intent(Intent.ACTION_VIEW, uri))
                        } catch (_: ActivityNotFoundException) {
                            // 열 앱이 없다 — 정보는 텍스트로 이미 전달됐다
                        }
                    }
                } else {
                    Modifier.mergedRow("web-${result.url}")
                },
            )
            .testTag("web-${result.url}")
            .defaultMinSize(minHeight = 48.dp)
            .padding(vertical = 8.dp),
    ) {
        Text(result.title, style = MaterialTheme.typography.bodyLarge)
        Text(result.snippet, style = MaterialTheme.typography.bodyMedium)
    }
}

/**
 * 최근 검색 행(spec §3-5): 활성화 = 재검색. 고정은 라벨이 아니라 `stateDescription`("고정됨"), 고정/해제·삭제는
 * 커스텀 액션(TalkBack 작업 메뉴). 시각 핀 아이콘은 `clearAndSetSemantics`로 별도 노드가 되지 않는다.
 * ⚠ 실기기 판정 조건(spec §8-8): 한소네 점자 탐색이 커스텀 액션에 못 닿으면 보이는 버튼으로 바꾼다.
 */
@Composable
fun RecentRow(
    query: String,
    pinned: Boolean,
    labels: RecentRowLabels,
    focusRequester: FocusRequester,
    onRun: () -> Unit,
    onTogglePin: () -> Unit,
    onDelete: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier
            .fillMaxWidth()
            .focusRequester(focusRequester)
            // clickable이 clearAndSetSemantics보다 바깥이라 onClick 액션은 살아남고, 안쪽(아이콘 등)만 지워진다.
            .clickable(role = Role.Button, onClick = onRun)
            .testTag("recent-$query")
            .defaultMinSize(minHeight = 48.dp)
            .padding(vertical = 8.dp)
            .clearAndSetSemantics {
                contentDescription = query
                if (pinned) stateDescription = labels.pinned
                customActions = listOf(
                    CustomAccessibilityAction(if (pinned) labels.unpin else labels.pin) { onTogglePin(); true },
                    CustomAccessibilityAction(labels.delete) { onDelete(); true },
                )
            },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(query, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        if (pinned) Icon(Icons.Filled.Star, contentDescription = null)
    }
}

class RecentRowLabels(val pinned: String, val pin: String, val unpin: String, val delete: String)

/** 필터 축 하나(분류·지역 공용). 항목이 1개 이하면 그리지 않는다(웹 ChipFilter 미러). 칩 목록·건수는 전체 결과 기준 고정. `axisKey`는 로케일 무관 testTag용. */
@Composable
fun ChipAxis(
    axisKey: String,
    axisLabel: String,
    allLabel: String,
    items: List<ChipItem>,
    selected: String?,
    onSelect: (String?) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (items.size <= 1) return
    Column(modifier.fillMaxWidth()) {
        Text(axisLabel, style = MaterialTheme.typography.labelLarge)
        FlowRow(Modifier.selectableGroup()) {
            FilterChip(selected = selected == null, onClick = { onSelect(null) }, label = { Text(allLabel) }, modifier = Modifier.testTag("chip-$axisKey-all"))
            for (item in items) {
                FilterChip(
                    selected = selected == item.key,
                    onClick = { onSelect(item.key) },
                    label = { Text("${item.label} ${item.count}") },
                    modifier = Modifier.testTag("chip-$axisKey-${item.key}"),
                )
            }
        }
    }
}

class ChipItem(val key: String, val label: String, val count: Int)
