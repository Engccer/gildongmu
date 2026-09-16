package space.dodoplanet.gildongmu.search

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import android.util.Log
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.a11y.StatusLine
import space.dodoplanet.gildongmu.a11y.headingText
import space.dodoplanet.gildongmu.i18n.AppLocale
import space.dodoplanet.gildongmu.kit.RecentQuery
import space.dodoplanet.gildongmu.kit.SearchOutcome
import space.dodoplanet.gildongmu.kit.SearchSection
import space.dodoplanet.gildongmu.kit.bucketLabel
import space.dodoplanet.gildongmu.kit.bucketsPresent
import space.dodoplanet.gildongmu.kit.filterPlacesByBucket
import space.dodoplanet.gildongmu.kit.filterPlacesByRegion
import space.dodoplanet.gildongmu.kit.models.Place
import space.dodoplanet.gildongmu.kit.regionLabel
import space.dodoplanet.gildongmu.kit.regionsPresent

/**
 * 검색 화면(spec §3 표 순서). 읽기 순서 = 시각 순서. 전부 `Column + verticalScroll` — 모든 행이 접근성 트리에
 * 있어야 하므로(헌장 §1) `LazyColumn`을 쓰지 않는다(수백 건이 생기는 M2 이후 재판정).
 */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun SearchScreen(vm: SearchViewModel) {
    val s by vm.state.collectAsState()
    val res = LocalContext.current.resources
    val lang = remember(res) { AppLocale.current(res) }
    val fieldFocus = remember { FocusRequester() }
    val buttonFocus = remember { FocusRequester() }
    val firstRowFocus = remember { FocusRequester() }
    // 최근 검색 행의 requester는 검색어로 보관한다 — index로 들면 삭제 뒤 옛 목록의 자리를 가리켜 지워질 행에 착지한다.
    val recentFocus = remember { mutableMapOf<String, FocusRequester>() }
    var pendingRecentLanding by remember { mutableStateOf<String?>(null) }
    val searchingLabel = stringResource(R.string.android_search_searching)

    // 결과 도착 시 첫 결과 행 착지(한 프레임 뒤, 소비한 세대만 한 번). 통지가 착지 라벨에 잘리는 것은 iOS와 같이 수용.
    LaunchedEffect(s.resultsRevision) {
        if (s.resultsRevision > vm.consumedRevision) {
            vm.consumedRevision = s.resultsRevision
            if (s.totalCount > 0) {
                withFrameNanos { }
                runCatching { firstRowFocus.requestFocus() }.onFailure { Log.w("SearchScreen", "첫 결과 착지 실패", it) }
            }
        }
    }
    // 최근 검색 삭제 뒤 착지: 재구성이 끝난 다음 프레임에 새 목록의 행으로(첫 결과 착지와 같은 꼴).
    LaunchedEffect(pendingRecentLanding) {
        val target = pendingRecentLanding ?: return@LaunchedEffect
        withFrameNanos { }
        recentFocus[target]?.let { r -> runCatching { r.requestFocus() }.onFailure { Log.w("SearchScreen", "최근 검색 착지 실패", it) } }
        pendingRecentLanding = null
    }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp)
            .semantics { testTagsAsResourceId = true },
    ) {
        Text(stringResource(R.string.app_title), Modifier.headingText().padding(vertical = 12.dp), style = MaterialTheme.typography.titleLarge)

        TextField(
            state = vm.queryState,
            lineLimits = TextFieldLineLimits.SingleLine,
            label = { Text(stringResource(R.string.search_label)) },
            placeholder = { Text(stringResource(R.string.android_search_prompt)) },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            // 하드웨어 Enter도 단일행 필드에선 이 경로로 온다(Compose 문서) — 별도 키 폴백을 두면 이중 제출이다.
            onKeyboardAction = { if (!s.isSearching) vm.submit() },
            trailingIcon = if (vm.queryState.text.isNotEmpty()) {
                {
                    IconButton(onClick = { vm.clearQuery(); fieldFocus.requestFocus() }, modifier = Modifier.testTag("clear")) {
                        Icon(Icons.Filled.Close, contentDescription = stringResource(R.string.search_clear))
                    }
                }
            } else null,
            modifier = Modifier
                .fillMaxWidth()
                .testTag("query")
                .focusRequester(fieldFocus),
        )

        Button(
            onClick = { if (!s.isSearching) vm.submit() },
            modifier = Modifier
                .testTag("submit")
                .focusRequester(buttonFocus)
                // disabled는 포커스를 떨군다 — 클릭 무시 + 상태 설명(헌장 §5 ⓐ)
                .semantics { if (s.isSearching) stateDescription = searchingLabel },
        ) { Text(stringResource(R.string.search_button)) }

        StatusLine(s.notice, Modifier.padding(vertical = 8.dp))

        if (s.outcome == null && !s.isSearching && s.recentQueries.isNotEmpty()) {
            RecentSection(
                queries = s.recentQueries,
                requesterFor = { text -> recentFocus.getOrPut(text) { FocusRequester() } },
                onRun = { vm.setQuery(it); vm.submit() },
                onTogglePin = vm::togglePinRecent,
                onDelete = { text ->
                    val target = vm.removeRecent(text)
                    recentFocus.remove(text)
                    if (target == null) buttonFocus.requestFocus() else pendingRecentLanding = target
                },
                onClearAll = { vm.clearRecent(); if (vm.state.value.recentQueries.isEmpty()) buttonFocus.requestFocus() },
            )
        }

        s.outcome?.let { outcome ->
            ResultSections(outcome, s.bucket, s.region, lang, firstRowFocus, vm::setBucket, vm::setRegion)
        }
    }
}

@Composable
private fun RecentSection(
    queries: List<RecentQuery>,
    requesterFor: (String) -> FocusRequester,
    onRun: (String) -> Unit,
    onTogglePin: (String) -> Unit,
    onDelete: (String) -> Unit,
    onClearAll: () -> Unit,
) {
    val labels = RecentRowLabels(
        pinned = stringResource(R.string.recent_pinned), pin = stringResource(R.string.recent_pin),
        unpin = stringResource(R.string.recent_unpin), delete = stringResource(R.string.recent_delete),
    )
    Text(stringResource(R.string.recent_title), Modifier.headingText().padding(top = 16.dp, bottom = 4.dp), style = MaterialTheme.typography.titleMedium)
    for (q in queries) {
        RecentRow(
            query = q.text, pinned = q.pinned, labels = labels, focusRequester = requesterFor(q.text),
            onRun = { onRun(q.text) }, onTogglePin = { onTogglePin(q.text) }, onDelete = { onDelete(q.text) },
        )
    }
    Button(onClick = onClearAll, modifier = Modifier.testTag("recent-clear")) { Text(stringResource(R.string.recent_clearAll)) }
}

/** 결과 섹션들(건수 내림차순, `SearchOutcome.orderedSections`). 첫 행에만 착지 requester. 섹션이 둘 이상일 때만 헤딩(웹 미러). */
@Composable
private fun ResultSections(
    outcome: SearchOutcome,
    bucket: String?,
    region: String?,
    lang: String,
    firstRowFocus: FocusRequester,
    onBucket: (String?) -> Unit,
    onRegion: (String?) -> Unit,
) {
    val sections = outcome.orderedSections
    val showHeadings = sections.size > 1
    // 착지 대상은 첫 섹션의 첫 항목 하나로 미리 정한다(재구성 순서에 기대지 않는다). FocusRequester는 한 노드에만 붙는다.
    val firstKey: String? = when (val first = sections.firstOrNull()) {
        is SearchSection.Places -> first.items.firstOrNull()?.let { "place-${it.id}" }
        is SearchSection.Addresses -> first.items.firstOrNull()?.let { "address-${it.roadAddr}" }
        is SearchSection.Web -> first.items.firstOrNull()?.let { "web-${it.url}" }
        null -> null
    }
    fun rowModifier(key: String): Modifier = if (key == firstKey) Modifier.focusRequester(firstRowFocus) else Modifier

    for (section in sections) {
        when (section) {
            is SearchSection.Places -> {
                if (showHeadings) SectionHeading(stringResource(R.string.search_placeSection))
                PlacesSection(section.items, bucket, region, lang, onBucket, onRegion, ::rowModifier)
            }
            is SearchSection.Addresses -> {
                if (showHeadings) SectionHeading(stringResource(R.string.search_addressSection))
                for (address in section.items) AddressRow(address, lang, rowModifier("address-${address.roadAddr}"))
            }
            is SearchSection.Web -> {
                if (showHeadings) SectionHeading(stringResource(R.string.android_search_webSection))
                for (result in section.items) WebRow(result, rowModifier("web-${result.url}"))
            }
        }
    }
}

@Composable
private fun SectionHeading(text: String) {
    Text(text, Modifier.headingText().padding(top = 16.dp, bottom = 4.dp), style = MaterialTheme.typography.titleMedium)
}

/** 장소 섹션: 두 축 칩(AND) + 정확도순 플랫 리스트. 칩 목록·건수는 전체 결과(base) 기준 고정. */
@Composable
private fun PlacesSection(
    base: List<Place>,
    bucket: String?,
    region: String?,
    lang: String,
    onBucket: (String?) -> Unit,
    onRegion: (String?) -> Unit,
    rowModifier: (String) -> Modifier,
) {
    val bucketItems = bucketsPresent(base).map { key -> ChipItem(key, bucketLabel(key, lang), filterPlacesByBucket(base, key).size) }
    val regionItems = regionsPresent(base).map { key -> ChipItem(key, regionLabel(key, lang), filterPlacesByRegion(base, key).size) }
    ChipAxis("bucket", stringResource(R.string.category_filterLabel), stringResource(R.string.category_all), bucketItems, bucket, onBucket)
    ChipAxis("region", stringResource(R.string.region_filterLabel), stringResource(R.string.region_all), regionItems, region, onRegion)
    val filtered = filterPlacesByRegion(filterPlacesByBucket(base, bucket), region)
    if (filtered.isEmpty()) {
        Text(stringResource(R.string.search_noFilterResults), Modifier.padding(vertical = 8.dp))
    } else {
        for (place in filtered) PlaceRow(place, lang, spokenMeters = stringResource(R.string.android_unit_spokenMeters), modifier = rowModifier("place-${place.id}"))
    }
}
