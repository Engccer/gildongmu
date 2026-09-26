package space.dodoplanet.gildongmu.nearby

import android.util.Log
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.a11y.landingTarget
import space.dodoplanet.gildongmu.a11y.BodyLine
import space.dodoplanet.gildongmu.a11y.HeadingLine
import space.dodoplanet.gildongmu.a11y.mergedRow
import space.dodoplanet.gildongmu.a11y.tapTarget
import space.dodoplanet.gildongmu.i18n.AppLocale
import space.dodoplanet.gildongmu.i18n.appLocalized
import space.dodoplanet.gildongmu.kit.APIError
import space.dodoplanet.gildongmu.kit.NearbyCoord
import space.dodoplanet.gildongmu.kit.NearbyCoordinateSource
import space.dodoplanet.gildongmu.kit.NearbyCoverage
import space.dodoplanet.gildongmu.kit.NearbyLoadCore
import space.dodoplanet.gildongmu.kit.NearbyLoadEvent
import space.dodoplanet.gildongmu.kit.NearbyLoadPhase
import space.dodoplanet.gildongmu.kit.NearbyService
import space.dodoplanet.gildongmu.kit.RevealWindow
import space.dodoplanet.gildongmu.kit.UnavailableHereReason
import space.dodoplanet.gildongmu.kit.bilingualName
import space.dodoplanet.gildongmu.kit.models.Place
import space.dodoplanet.gildongmu.kit.models.SurroundingsScene
import space.dodoplanet.gildongmu.kit.sceneItemToPlace
import space.dodoplanet.gildongmu.kit.spokenDistanceUnits

/**
 * "주변 상황" 자동 펼침(iOS `SurroundingsSceneAutoSection`, spec §12-2). 부모(둘러보기) 커밋과 함께 나타나고 트리거·닫기·착지가 없다 —
 * 헤딩이 발견 경로, 포커스는 부모의 위치 문장 1회 착지가 전부. 묶음별 "더 보기" 창은 ViewModel이 들고 커밋마다 리셋한다(판정 31).
 * 항목 행은 `PlaceRow`가 아니라 자체 문장 행(판정 30) — 같은 화면의 가게 목록과 `place-{id}`가 겹친다.
 */
@Composable
fun SceneAutoSection(payload: AroundPayload, vm: NearbyScreenViewModel<AroundPayload>, requesterFor: (String) -> FocusRequester, onOpenPlace: (Place, returnKey: String) -> Unit) {
    val windows by vm.groupWindows.collectAsState()

    HeadingLine(stringResource(R.string.surroundings_ready), "scene-heading")
    val scene = payload.scene
    when {
        payload.sceneFailed || scene == null -> BodyLine(stringResource(R.string.surroundings_error), "scene-error")
        scene.total == 0 -> BodyLine(stringResource(R.string.surroundings_empty), "scene-empty")
        // 위치 문장은 없다 — 부모의 위치 문장이 같은 내용을 이미 말한다(중복 낭독 금지).
        else -> SceneGroups(scene, windows, showPlace = false, requesterFor, onOpenPlace) { bucket, total ->
            vm.revealMoreInGroup(bucket, total) { i -> sceneItemKey(bucket, i) }
        }
    }
}

/**
 * 묶음·항목·더 보기·출처(iOS `SurroundingsSceneGroupsView`) — 자동 펼침과 버튼형이 공유한다. `showPlace`는 버튼형만(위치 확인 문장이 먼저).
 * 한 줄 = 한 객체(버튼 → 상세). 착지 requester는 clickable의 focusable 앞(소스 가드 규칙).
 */
@Composable
private fun SceneGroups(
    scene: SurroundingsScene,
    windows: Map<String, Int>,
    showPlace: Boolean,
    requesterFor: (String) -> FocusRequester,
    onOpenPlace: (Place, returnKey: String) -> Unit,
    onRevealMore: (bucket: String, total: Int) -> Unit,
) {
    val res = LocalContext.current.resources
    val lang = AppLocale.current(res)
    val meters = stringResource(R.string.android_unit_spokenMeters)
    val showMore = stringResource(R.string.actions_showMore)
    if (showPlace) scene.place?.let { place ->
        // 위치 문장은 주소라 로마자(주소 규칙)로 병기(E28).
        val name = bilingualName(lang, place, en = null, roman = scene.placeRoman)
        BodyLine(name.display, "scene-place", name.primary.takeIf { it != name.display })
    }
    for (group in scene.groups) {
        // 묶음 제목이 유일한 발견 경로(제목 점프로 통째 건너뛰기). 미지 bucket은 원값 노출.
        val bucketName = sceneBucketResId(group.bucket)?.let { stringResource(it) } ?: group.bucket
        HeadingLine(sceneBucketTitle(bucketName, group.items.size) { appLocalized(res, R.string.surroundings_count, it) }, "scene-${group.bucket}")
        val visible = windows[group.bucket] ?: RevealWindow.initialVisible
        group.items.take(visible).forEachIndexed { i, item ->
            val name = bilingualName(lang, item.name, en = null, roman = item.nameRoman)
            val line = { nm: String -> sceneItemLine(item, nm, lang, { d, x, r -> appLocalized(res, R.string.surroundings_itemWithRoad, d, x, r) }) { d, x -> appLocalized(res, R.string.surroundings_item, d, x) } }
            val key = sceneItemKey(group.bucket, i)
            val visual = line(name.display)
            val spoken = spokenDistanceUnits(line(name.primary), meters).takeIf { it != visual }
            Text(
                visual,
                Modifier
                    .fillMaxWidth()
                    .landingTarget(requesterFor(key))
                    .clickable(role = Role.Button) { onOpenPlace(sceneItemToPlace(item), key) }
                    .testTag(key)
                    .defaultMinSize(minHeight = 48.dp)
                    .padding(vertical = 8.dp)
                    .semantics(mergeDescendants = true) { if (spoken != null) contentDescription = spoken },
            )
        }
        if (group.items.size > visible) {
            Button(onClick = { onRevealMore(group.bucket, group.items.size) }, Modifier.tapTarget().testTag("showMore-${group.bucket}")) { Text(showMore) }
        }
    }
    // 실재성 한계 고지 — 이름을 그대로 말하는 대신 출처로 헤지.
    BodyLine(stringResource(R.string.surroundings_source), "scene-source")
}

/**
 * 버튼형 "주변 확인"의 상태(iOS `SurroundingsSceneModel`, M4b). 앵커 고정 조회(`:kit NearbyLoadCore` + `Fixed`) — 판정은 코어, 여기는 진행·재조회
 * 실패·닫기·묶음 창·착지 세대뿐. **소유자는 화면 밖**(도보 안내 세션)이다: 장소 상세 왕복에 시트 컴포지션이 사라져도 펼친 목록과 착지 자리가
 * 남아야 한다(iOS는 중첩 시트라 시트가 산다). 통지 채널이 없다(감싸는 화면이 단일 통지 채널을 소유한다) — 조회 중은 트리거 상태, 결과는 착지.
 */
class SceneLookup(val anchor: NearbyCoord, private val scope: CoroutineScope, service: NearbyService) {
    private val reveal = mutableMapOf<String, RevealWindow>()
    private val _windows = MutableStateFlow<Map<String, Int>>(emptyMap())
    val windows: StateFlow<Map<String, Int>> = _windows.asStateFlow()
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()
    /** 재조회 실패 — 코어 계약 #11이 직전 데이터를 유지하므로 이 표식이 없으면 재조회 실패가 무신호가 된다. */
    private val _refreshFailed = MutableStateFlow(false)
    val refreshFailed: StateFlow<Boolean> = _refreshFailed.asStateFlow()
    /** 닫기(데이터는 버리지 않고 표시만 접는다 — 재조회는 load가). */
    private val _closed = MutableStateFlow(false)
    val closed: StateFlow<Boolean> = _closed.asStateFlow()
    /** 조회 완료 세대 — 화면이 결과 착지 시점을 아는 신호. 소비는 `consumedLoad`(시트가 다시 열려도 다시 착지하지 않는다). */
    private val _loadSeq = MutableStateFlow(0)
    val loadSeq: StateFlow<Int> = _loadSeq.asStateFlow()
    var consumedLoad = 0
    /**
     * 섹션이 컴포지션에 올라와 있는가(섹션의 `DisposableEffect`가 세운다). 조회는 세션 스코프라 시트를 접어도 끝까지 가는데, 그 사이 끝난 조회의 결과 착지를
     * 돌아온 시트에서 내면 진입 착지(제목·접기 버튼)와 두 번 갈린다 — 떠나 있는 동안 끝난 조회는 착지를 소비된 것으로 둔다(결과는 펼쳐진 채 남는다).
     */
    var attached = false
    /** "더 보기" 첫 새 항목 키(착지 대상)와 세대. */
    private val _revealLanding = MutableStateFlow<Pair<Int, String>?>(null)
    val revealLanding: StateFlow<Pair<Int, String>?> = _revealLanding.asStateFlow()
    var consumedReveal = 0

    private val core = NearbyLoadCore<SurroundingsScene>(
        coordinate = NearbyCoordinateSource.Fixed(anchor),
        coverage = NearbyCoverage.korea,
        fetch = { coord, _ ->
            val c = requireNotNull(coord) { "fixed 소스는 좌표를 보장한다" }
            // data null = 서버 키 미보유 — 빈 결과로 위장하지 않고 오류로 태운다(3-state).
            val scene = service.surroundingsScene(c.lat, c.lng) ?: throw APIError.BadStatus(200, "surroundings scene: data null")
            scene.takeIf { it.total > 0 }   // null → 코어가 Empty로
        },
        willCommit = {
            reveal.clear(); _windows.value = emptyMap()
            _refreshFailed.value = false
        },
        onEvent = { if (it is NearbyLoadEvent.RefreshFailed) _refreshFailed.value = true },
    )
    val phase: StateFlow<NearbyLoadPhase<SurroundingsScene>> = core.phase

    fun load() {
        if (_busy.value) return
        _busy.value = true
        _refreshFailed.value = false
        _closed.value = false
        scope.launch {
            try { core.load() } finally {
                _busy.value = false
                _loadSeq.value += 1
                if (!attached) consumedLoad = _loadSeq.value
            }
        }
    }

    fun close() { _closed.value = true }

    fun revealMore(bucket: String, total: Int) {
        val window = reveal.getOrPut(bucket) { RevealWindow() }
        val firstNew = window.revealMore(total) ?: return
        _windows.value = _windows.value + (bucket to window.visibleCount)
        _revealLanding.value = ((_revealLanding.value?.first ?: 0) + 1) to sceneItemKey(bucket, firstNew)
    }
}

/** 종단 메시지(iOS `terminalMessage`) — 빈 결과·실패·커버리지·지역 미제공. 권한 계열은 고정 앵커라 도달 불가. */
private fun sceneTerminalMessageId(phase: NearbyLoadPhase<SurroundingsScene>, refreshFailed: Boolean): Int? {
    if (refreshFailed) return R.string.surroundings_error
    return when (phase) {
        NearbyLoadPhase.Empty -> R.string.surroundings_empty
        NearbyLoadPhase.FailedServer, NearbyLoadPhase.FailedLocation -> R.string.surroundings_error
        NearbyLoadPhase.OutOfCoverage -> R.string.android_common_outOfCoverage
        is NearbyLoadPhase.UnavailableHere -> when (phase.reason) {
            UnavailableHereReason.seoulOnly -> R.string.android_common_unavailableHere_seoulOnly
            UnavailableHereReason.noBusData -> R.string.android_common_unavailableHere_noBusData
        }
        else -> null
    }
}

/**
 * 버튼형 "주변 확인"(iOS `SurroundingsSceneSection`, M4b) — 다른 화면(도보 안내 시트) 안에 임베드되는 행들. 트리거 → 조회 → 결과 헤딩·닫기·묶음.
 * 통지는 포커스·상태 채널만(헌장 §5): 조회 중 = 트리거 `stateDescription`(라벨 불변), 성공 = 결과 헤딩 착지, 빈 결과·실패 = 메시지 행 착지,
 * 닫기 = 트리거 착지(닫기 자신도 사라지는 전이). 라이브 리전 없음. 착지 requester는 호스트가 준다(장소 상세에서 돌아온 행 착지도 호스트 몫).
 */
@Composable
fun SceneButtonSection(lookup: SceneLookup, requesterFor: (String) -> FocusRequester, onOpenPlace: (Place, returnKey: String) -> Unit) {
    val phase by lookup.phase.collectAsState()
    val busy by lookup.busy.collectAsState()
    val refreshFailed by lookup.refreshFailed.collectAsState()
    val closed by lookup.closed.collectAsState()
    val windows by lookup.windows.collectAsState()
    val loadSeq by lookup.loadSeq.collectAsState()
    val revealLanding by lookup.revealLanding.collectAsState()
    val scope = rememberCoroutineScope()
    val loaded = phase as? NearbyLoadPhase.Loaded
    val isOpen = loaded != null && !closed
    val message = sceneTerminalMessageId(phase, refreshFailed)
    val loadingLabel = stringResource(R.string.surroundings_loading)

    DisposableEffect(lookup) {
        lookup.attached = true
        onDispose { lookup.attached = false }
    }
    LaunchedEffect(loadSeq) {
        if (loadSeq <= lookup.consumedLoad) return@LaunchedEffect
        lookup.consumedLoad = loadSeq
        val target = when {
            message != null -> "scene-message"
            isOpen -> "scene-heading"
            else -> null
        } ?: return@LaunchedEffect
        landScene(requesterFor(target), target)
    }
    LaunchedEffect(revealLanding) {
        val (seq, key) = revealLanding ?: return@LaunchedEffect
        if (seq <= lookup.consumedReveal) return@LaunchedEffect
        lookup.consumedReveal = seq
        landScene(requesterFor(key), key)
    }

    Button(
        onClick = { lookup.load() },
        modifier = Modifier
            .fillMaxWidth()
            .tapTarget()
            .landingTarget(requesterFor("scene-trigger"))
            .testTag("scene-trigger")
            .semantics { if (busy) stateDescription = loadingLabel },
    ) { Text(stringResource(if (isOpen) R.string.surroundings_refresh else R.string.surroundings_button)) }
    if (message != null) {
        Text(stringResource(message), Modifier.fillMaxWidth().mergedRow("scene-message", focus = requesterFor("scene-message")).padding(vertical = 8.dp))
    }
    if (loaded != null && !closed) {
        HeadingLine(stringResource(R.string.surroundings_ready), "scene-heading", focus = requesterFor("scene-heading"))
        Button(
            onClick = {
                lookup.close()
                scope.launch { landScene(requesterFor("scene-trigger"), "scene-trigger") }
            },
            modifier = Modifier.fillMaxWidth().tapTarget().testTag("scene-close"),
        ) { Text(stringResource(R.string.actions_close)) }
        SceneGroups(loaded.payload, windows, showPlace = true, requesterFor, onOpenPlace) { bucket, total -> lookup.revealMore(bucket, total) }
    }
}

/** 한 프레임 뒤 대입, 실패하면 400ms 뒤 한 번 더(시트 안이라 표시 애니메이션이 없다 — `guide/ui/land`보다 짧다). */
private suspend fun landScene(requester: FocusRequester, what: String) {
    withFrameNanos { }
    runCatching { requester.requestFocus() }.onFailure {
        delay(400)
        runCatching { requester.requestFocus() }.onFailure { e -> Log.w("Scene", "$what 착지 실패", e) }
    }
}
