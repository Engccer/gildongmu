package space.dodoplanet.gildongmu.directions

import android.util.Log
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.clearText
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import space.dodoplanet.gildongmu.a11y.StatusLine
import space.dodoplanet.gildongmu.a11y.headingText
import space.dodoplanet.gildongmu.i18n.AppLocale
import space.dodoplanet.gildongmu.kit.bilingualName
import space.dodoplanet.gildongmu.kit.joinText

/**
 * 끝점 검색(spec §3-2, iOS `DirectionsEndpointSearchView` 대응). 폼을 통째로 교체하는 모달 콘텐츠 — 진입 착지는 검색
 * 입력, 후보 도착은 첫 후보. 받아쓰기 행은 없다(D9 — 마이크 마일스톤이 검색 버튼 뒤에 넣는다).
 */
@Composable
fun EndpointSearchContent(vm: DirectionsViewModel, p: EndpointSearchState) {
    val res = LocalContext.current.resources
    val lang = remember(res) { AppLocale.current(res) }
    val strings = remember(res) { resourceStrings(res) }
    val fieldFocus = remember { FocusRequester() }
    val searchButtonFocus = remember { FocusRequester() }
    val firstCandidateFocus = remember { FocusRequester() }
    val recentFocus = remember { mutableMapOf<String, FocusRequester>() }
    var pendingRecentLanding by remember { mutableStateOf<String?>(null) }
    val searchingLabel = strings.get("android.search.searching")

    // 진입 착지 = 검색 입력(커서가 최상단에 머물면 필드까지 스와이프해 내려가야 한다는 실기기 확인).
    LaunchedEffect(Unit) {
        withFrameNanos { }
        runCatching { fieldFocus.requestFocus() }.onFailure { Log.w("EndpointSearch", "입력 착지 실패", it) }
    }
    // 후보 도착 시 첫 후보 착지(M1 첫 결과 관용구). 통지가 착지 라벨에 잘리는 것은 iOS와 같이 수용.
    LaunchedEffect(p.candidateRevision) {
        if (p.candidateRevision > vm.consumedCandidateRevision) {
            vm.consumedCandidateRevision = p.candidateRevision
            if (p.places.isNotEmpty() || p.addresses.isNotEmpty()) {
                withFrameNanos { }
                runCatching { firstCandidateFocus.requestFocus() }.onFailure { Log.w("EndpointSearch", "첫 후보 착지 실패", it) }
            }
        }
    }
    LaunchedEffect(pendingRecentLanding) {
        val target = pendingRecentLanding ?: return@LaunchedEffect
        withFrameNanos { }
        recentFocus[target]?.let { r -> runCatching { r.requestFocus() }.onFailure { Log.w("EndpointSearch", "최근 장소 착지 실패", it) } }
        pendingRecentLanding = null
    }

    val title = when (p.target) {
        DirectionsFieldTarget.from -> strings.get("directions.searchFrom")
        DirectionsFieldTarget.to -> strings.get("directions.searchTo")
        DirectionsFieldTarget.via -> strings.get("directions.searchVia")
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
        Text(title, Modifier.headingText().padding(vertical = 12.dp), style = MaterialTheme.typography.titleLarge)
        Button(onClick = vm::closePicker, modifier = Modifier.testTag("ep-close")) { Text(strings.get("actions.close")) }

        TextField(
            state = p.queryState,
            lineLimits = TextFieldLineLimits.SingleLine,
            label = { Text(strings.get("search.label")) },
            placeholder = { Text(strings.get("android.search.prompt")) },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            // 단일행 필드의 하드웨어 Enter도 이 경로로 온다(M1 판정) — 별도 키 폴백은 이중 제출.
            onKeyboardAction = { if (!p.isSearching) vm.submitCandidates() },
            trailingIcon = if (p.queryState.text.isNotEmpty()) {
                {
                    IconButton(onClick = { p.queryState.clearText(); fieldFocus.requestFocus() }, modifier = Modifier.testTag("ep-clear")) {
                        Icon(Icons.Filled.Close, contentDescription = strings.get("search.clear"))
                    }
                }
            } else null,
            modifier = Modifier.fillMaxWidth().testTag("ep-query").focusRequester(fieldFocus),
        )
        Button(
            onClick = { if (!p.isSearching) vm.submitCandidates() },
            modifier = Modifier
                .testTag("ep-submit")
                .focusRequester(searchButtonFocus)
                .semantics { if (p.isSearching) stateDescription = searchingLabel },
        ) { Text(strings.get("search.button")) }

        // 출발지에서만 — 도착지는 스왑이 담당하고 경유지는 장소만.
        if (p.target == DirectionsFieldTarget.from) {
            Button(onClick = vm::selectCurrent, modifier = Modifier.testTag("ep-current")) { Text(strings.get("directions.useCurrentLocation")) }
        }

        StatusLine(p.notice, Modifier.padding(vertical = 8.dp))

        if (!p.hasSearched && p.recentEndpoints.isNotEmpty()) {
            SectionHeading(strings.get("recent.title"))
            val pinnedLabel = strings.get("recent.pinned")
            for (e in p.recentEndpoints) {
                ActionRow(
                    visual = e.label, tag = "ep-recent-${e.id}", spoken = e.label,
                    state = if (e.pinned) pinnedLabel else null,
                    actions = listOf(
                        CustomAccessibilityAction(strings.get(if (e.pinned) "recent.unpin" else "recent.pin")) { vm.togglePinRecentEndpoint(e); true },
                        CustomAccessibilityAction(strings.get("recent.delete")) {
                            val target = vm.removeRecentEndpoint(e)
                            recentFocus.remove(e.id)
                            if (target == null) searchButtonFocus.requestFocus() else pendingRecentLanding = target
                            true
                        },
                    ),
                    onClick = { vm.selectRecentEndpoint(e) },
                    modifier = Modifier.focusRequester(recentFocus.getOrPut(e.id) { FocusRequester() }),
                )
            }
            Button(
                onClick = { vm.clearRecentEndpoints(); if (vm.endpointSearch.value?.recentEndpoints.isNullOrEmpty()) searchButtonFocus.requestFocus() },
                modifier = Modifier.testTag("ep-recent-clear"),
            ) { Text(strings.get("recent.clearAll")) }
        }

        // 후보(장소 먼저, 주소 다음). 첫 후보에만 착지 requester.
        p.places.forEachIndexed { index, place ->
            val name = bilingualName(lang, place.name, en = null, roman = place.nameRoman)
            val address = place.roadAddress.ifEmpty { place.address }
            ActionRow(
                visual = joinText(name.display, address), spoken = joinText(name.primary, address), tag = "ep-place-${place.id}",
                onClick = { vm.selectPlace(place) },
                modifier = if (index == 0) Modifier.focusRequester(firstCandidateFocus) else Modifier,
            )
        }
        p.addresses.forEachIndexed { index, address ->
            val name = bilingualName(lang, address.roadAddr, en = address.engAddr, roman = null)
            ActionRow(
                visual = name.display, spoken = name.primary, tag = "ep-address-${address.roadAddr}",
                onClick = { vm.selectAddress(address) },
                modifier = if (index == 0 && p.places.isEmpty()) Modifier.focusRequester(firstCandidateFocus) else Modifier,
            )
        }
    }
}
