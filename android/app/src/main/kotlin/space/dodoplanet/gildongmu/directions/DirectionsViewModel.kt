package space.dodoplanet.gildongmu.directions

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import space.dodoplanet.gildongmu.a11y.Notice
import space.dodoplanet.gildongmu.kit.APIError
import space.dodoplanet.gildongmu.kit.DataLocale
import space.dodoplanet.gildongmu.kit.DirectionsEndpoint
import space.dodoplanet.gildongmu.kit.DirectionsMode
import space.dodoplanet.gildongmu.kit.DirectionsModeOutcome
import space.dodoplanet.gildongmu.kit.DirectionsOutcomeClassifier
import space.dodoplanet.gildongmu.kit.DirectionsResults
import space.dodoplanet.gildongmu.kit.KoreanParticle
import space.dodoplanet.gildongmu.kit.NearbyCoord
import space.dodoplanet.gildongmu.kit.RecentEndpoint
import space.dodoplanet.gildongmu.kit.RecentRoute
import space.dodoplanet.gildongmu.kit.RecentSearchStore
import space.dodoplanet.gildongmu.kit.RoutePoint
import space.dodoplanet.gildongmu.kit.RouteService
import space.dodoplanet.gildongmu.kit.SearchService
import space.dodoplanet.gildongmu.kit.bilingualName
import space.dodoplanet.gildongmu.kit.isInKorea
import space.dodoplanet.gildongmu.kit.models.JusoAddress
import space.dodoplanet.gildongmu.kit.models.Place
import space.dodoplanet.gildongmu.kit.models.WalkRouteBriefing
import space.dodoplanet.gildongmu.location.LocationException

/** 조회 국면(iOS `DirectionsModel.Phase` 미러). 커버리지 밖은 실패가 아니다. */
sealed class DirectionsPhase {
    data object Idle : DirectionsPhase()
    data object NeedEndpoints : DirectionsPhase()
    data object Locating : DirectionsPhase()
    data object Loading : DirectionsPhase()
    data object GeoDenied : DirectionsPhase()
    data object GeoReduced : DirectionsPhase()
    data object GeoError : DirectionsPhase()
    data object OutOfCoverage : DirectionsPhase()
    data class Settled(val successCount: Int) : DirectionsPhase()
}

/** 출입구 승격본(A11) — 입력 필드가 아니라 여기 산다(승격은 경로·안내 층의 목적지이고 필드는 사용자가 고른 원명). */
data class PromotedDestination(val label: String, val lat: Double, val lng: Double)

/** 화면이 커서를 옮길 자리(spec §3-5). 한 요청 = 한 착지, seq가 바뀌면 화면이 한 프레임 뒤 대입한다. */
sealed class LandingTarget {
    data class Field(val field: DirectionsFieldTarget) : LandingTarget()
    data object Submit : LandingTarget()
    data object WalkHeading : LandingTarget()
    data class RecentRoute(val id: String) : LandingTarget()
}

data class LandingRequest(val seq: Int, val target: LandingTarget)

data class DirectionsUiState(
    val from: DirectionsEndpoint? = DirectionsEndpoint.Current,
    val to: DirectionsEndpoint? = null,
    val via: DirectionsEndpoint.Place? = null,
    val phase: DirectionsPhase = DirectionsPhase.Idle,
    /** 결과·최단·승격본은 **같은 순간에만** 커밋한다(중간 return에서 한쪽만 선 상태가 관찰되지 않게). */
    val results: DirectionsResults? = null,
    val walkShortest: WalkRouteBriefing? = null,
    val promotedDestination: PromotedDestination? = null,
    /** 조회 완료 세대(화면 펼침 상태 초기화 신호). */
    val resultsRevision: Int = 0,
    val stepFreeEnabled: Boolean = false,
    val stepFreeBusy: Boolean = false,
    val isRefreshingCurrent: Boolean = false,
    /** "정확한 위치 허용" 재요청이 거부된 뒤에만 설정 열기 폴백을 낸다(spec §3-1 표 8). 새 조회·필드 변경에 리셋. */
    val preciseRetryFailed: Boolean = false,
    val isRequestingPrecise: Boolean = false,
    val currentAddress: String? = null,
    val currentAddressEnglish: String? = null,
    val recentRoutes: List<RecentRoute> = emptyList(),
    val landing: LandingRequest? = null,
    val notice: Notice = Notice(0, ""),
) {
    val isBusy: Boolean get() = phase == DirectionsPhase.Locating || phase == DirectionsPhase.Loading || stepFreeBusy
}

/**
 * 길찾기 상태 머신(iOS `DirectionsModel` 미러, spec §4). 필드는 원자 확정, 조회는 3수단 병렬 + 수단별 상태 분류(:kit),
 * 통지는 단일 polite 창구(`notice`), 착지는 `landing` 요청. 탭 이탈은 조회를 취소하지 않는다(ViewModel이 산다).
 */
class DirectionsViewModel(
    private val routes: RouteService,
    private val search: SearchService,
    private val store: RecentSearchStore,
    private val locator: EndpointLocator,
    private val dataLocale: () -> String,
    private val strings: Strings,
    private val savedState: SavedStateHandle,
    prefill: StateFlow<DirectionsPrefill?> = DirectionsPrefillStore.pending,
    private val takePrefill: (DirectionsPrefill) -> Boolean = DirectionsPrefillStore::take,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    private val queryTimeoutMs: Long = 15_000,
) : ViewModel() {
    private val _state = MutableStateFlow(
        DirectionsUiState(
            from = if (savedState.contains(KEY_FROM)) endpointFromJson(savedState[KEY_FROM]) else DirectionsEndpoint.Current,
            to = endpointFromJson(savedState[KEY_TO]),
            via = endpointFromJson(savedState[KEY_VIA]) as? DirectionsEndpoint.Place,
        ),
    )
    val state: StateFlow<DirectionsUiState> = _state.asStateFlow()

    /** 화면이 소비한 착지 seq(비저장 — 재생성 뒤 다시 착지하지 않는다). */
    var consumedLanding: Int = 0

    private var queryJob: Job? = null

    /** 재진입 가드(웹 in-flight ref). 조회와 토글 재조회가 **같은** 가드를 쓴다(교차 레이스 차단). */
    private var isInFlight = false
    private var hasLoadedCurrentAddress = false
    /** 주소 병기 요청 세대(latest-wins) — 세 경로(조회 성공·진입·재선택)가 겹칠 때 늦은 옛 좌표의 답이 새 주소를 덮지 않게. */
    private var addressSeq = 0
    /** 사용자가 최근 경로 목록을 건드렸으면 늦게 끝난 init 로드가 그 결과를 덮지 않는다. */
    private var recentRoutesTouched = false
    private var lastCoords: Coords? = null

    private data class Coords(val origin: NearbyCoord, val dest: NearbyCoord, val via: RoutePoint?)

    private class QueryTimeout : Exception("query timeout")

    private val initJob: Job = viewModelScope.launch {
        val recent = withContext(io) { store.routes() }
        if (!recentRoutesTouched) _state.update { it.copy(recentRoutes = recent) }
    }

    init {
        // 프리필(spec §5): 값이 오는 즉시 소비 — 탭이 이미 보이는 상태라 재컴포지션이 없어도 남는 값이 없다.
        viewModelScope.launch {
            prefill.collect { p -> if (p != null && takePrefill(p)) applyPrefill(p) }
        }
    }

    // ── 필드 ──────────────────────────────────────────────────────────────────

    /** 필드 확정은 엔드포인트 전체 교체(원자). 장소면 스코프 최근 목록에 기록, 이전 결과는 폐기. */
    fun setEndpoint(endpoint: DirectionsEndpoint, target: DirectionsFieldTarget) {
        if (target == DirectionsFieldTarget.via) {
            (endpoint as? DirectionsEndpoint.Place)?.let(::setVia)
            return
        }
        _state.update { if (target == DirectionsFieldTarget.from) it.copy(from = endpoint) else it.copy(to = endpoint) }
        recordRecent(endpoint, target)
        saveFields()
        clearResults()
    }

    /** 경유지 확정(N4) — 장소만(현재 위치는 경유지가 될 수 없다). */
    fun setVia(place: DirectionsEndpoint.Place) {
        _state.update { it.copy(via = place) }
        recordRecent(place, DirectionsFieldTarget.via)
        saveFields()
        clearResults()
    }

    fun clearVia() {
        if (_state.value.via == null) return
        _state.update { it.copy(via = null) }
        saveFields()
        clearResults()
    }

    /** 출발↔도착 원자 교환(미확정 null도 그대로). 기록 없음 — 재배치일 뿐 새 확정이 아니다. */
    fun swap() {
        _state.update { it.copy(from = it.to, to = it.from) }
        saveFields()
        clearResults()
    }

    private fun recordRecent(endpoint: DirectionsEndpoint, target: DirectionsFieldTarget) {
        if (endpoint is DirectionsEndpoint.Place) {
            store.recordEndpoint(RecentEndpoint(endpoint.label, endpoint.lat, endpoint.lng), target.recentScope)
        }
    }

    private fun saveFields() {
        val s = _state.value
        savedState[KEY_FROM] = s.from?.toJson() ?: ""
        savedState[KEY_TO] = s.to?.toJson() ?: ""
        savedState[KEY_VIA] = s.via?.toJson() ?: ""
    }

    /** 필드가 바뀌면 이전 결과·상태를 폐기하고 진행 조회를 취소한다(늦은 응답이 초기화 화면을 되채우지 않게). */
    private fun clearResults() {
        queryJob?.cancel()
        isInFlight = false
        _state.update {
            it.copy(
                stepFreeBusy = false, results = null, walkShortest = null, promotedDestination = null,
                phase = DirectionsPhase.Idle, notice = next(""), preciseRetryFailed = false,
            )
        }
    }

    // ── 조회 ──────────────────────────────────────────────────────────────────

    fun runQuery() {
        if (isInFlight) return
        val s = _state.value
        val from = s.from
        val to = s.to
        if (from == null || to == null) {
            setPhase(DirectionsPhase.NeedEndpoints)
            return
        }
        isInFlight = true
        _state.update { it.copy(preciseRetryFailed = false) }
        // iOS와 같이 진행 국면에 동기로 들어간다 — 버튼 가드·상태 문장이 첫 디스패치를 기다리지 않는다(M1 판정).
        setPhase(if (from == DirectionsEndpoint.Current || to == DirectionsEndpoint.Current) DirectionsPhase.Locating else DirectionsPhase.Loading)
        queryJob = viewModelScope.launch {
            try {
                performQuery(from, to, s.via)
            } finally {
                // 취소된(옛) 조회가 새 조회의 가드를 풀지 않도록 — 살아 있을 때만 리셋.
                if (currentCoroutineContext().isActive) isInFlight = false
            }
        }
    }

    private suspend fun performQuery(from: DirectionsEndpoint, to: DirectionsEndpoint, via: DirectionsEndpoint.Place?) {
        _state.update { it.copy(results = null, walkShortest = null, promotedDestination = null) }
        var current: NearbyCoord? = null
        if (from == DirectionsEndpoint.Current || to == DirectionsEndpoint.Current) {
            current = try {
                locator.currentCoordinate(force = false)
            } catch (e: LocationException) {
                // 거부·정밀 꺼짐·취득 실패는 다른 문장(3-state).
                setPhase(
                    when (e.kind) {
                        LocationException.Kind.Denied -> DirectionsPhase.GeoDenied
                        LocationException.Kind.ReducedAccuracy -> DirectionsPhase.GeoReduced
                        LocationException.Kind.Unavailable -> DirectionsPhase.GeoError
                    },
                )
                return
            }
            // 현재 위치가 서비스 지역 밖이면 조회 자체를 중단(upstream 0 호출). 오류가 아니라 커버리지 안내.
            if (!isInKorea(current.lat, current.lng)) {
                setPhase(DirectionsPhase.OutOfCoverage)
                return
            }
            hasLoadedCurrentAddress = true
            val acquired = current
            viewModelScope.launch { syncCurrentAddress(acquired) } // 조회 취소에 딸려가지 않는 별도 작업
            setPhase(DirectionsPhase.Loading)
        }
        currentCoroutineContext().ensureActive()
        // `Current`가 있으면 위에서 `current`가 채워졌으므로 도달 불가 — 도달하면 침묵 고착이 아니라 사유 있는 상태로(3-state).
        val origin = coordinateOf(from, current)
        val queried = coordinateOf(to, current)
        if (origin == null || queried == null) {
            setPhase(DirectionsPhase.GeoError)
            return
        }
        val viaCoord = via?.let { RoutePoint(it.lat, it.lng) }
        if (viaCoord != null && !isInKorea(viaCoord.lat, viaCoord.lng)) {
            setPhase(DirectionsPhase.OutOfCoverage)
            return
        }

        // 승격 왕복도 이 조회의 일부라 loading 안에서 돈다(직전 settled에 머물면서 결과만 빈 창 방지).
        val lang = dataLocale()
        var promoted: PromotedDestination? = null
        if (to is DirectionsEndpoint.Place && lang == "ko") {
            val entrance = withContext(io) { search.destinationEntrance(to.label, queried.lat, queried.lng, origin.lat, origin.lng) }
            currentCoroutineContext().ensureActive()
            if (entrance != null) promoted = PromotedDestination(entrance.name, entrance.lat, entrance.lng)
        }
        val dest = promoted?.let { NearbyCoord(it.lat, it.lng) } ?: queried
        lastCoords = Coords(origin, dest, viaCoord)

        val accessible = _state.value.stepFreeEnabled && lang == "ko"
        val dl = if (lang == "ko") DataLocale.ko else DataLocale.en
        val settled = coroutineScope {
            // 대중교통은 경유지가 있으면 호출하지 않는다(ODsay 미지원) — 실패도 경로 없음도 아닌 별도 상태.
            val transit = async(io) {
                if (viaCoord == null) timed { routes.transit(origin.lat, origin.lng, dest.lat, dest.lng, includeStops = true, lang = lang) } else null
            }
            val walk = async(io) { timed { routes.walkAlternatives(origin.lat, origin.lng, dest.lat, dest.lng, accessible, dl, viaCoord) } }
            val car = async(io) { timed { routes.car(origin.lat, origin.lng, dest.lat, dest.lng, lang, via = viaCoord) } }
            Triple(transit.await(), walk.await(), car.await())
        }
        currentCoroutineContext().ensureActive()
        val (transit, walk, car) = settled
        val outcomes = mapOf(
            DirectionsMode.transit to (transit?.let(DirectionsOutcomeClassifier::classifyTransit) ?: DirectionsModeOutcome.UnsupportedWaypoint),
            DirectionsMode.car to DirectionsOutcomeClassifier.classifyCar(car),
            DirectionsMode.walk to DirectionsOutcomeClassifier.classifyWalk(walk.map { it.result }),
        )
        // 서버 마커 이중 방어 — place 종단점이 한국 밖일 수 있다. 하나라도 감지하면 화면 전체를 전환한다.
        if (outcomes.values.any { it.isOutOfCoverage }) {
            setPhase(DirectionsPhase.OutOfCoverage)
            return
        }
        val results = DirectionsResults(outcomes)
        initJob.join()
        val recent = store.recordRoute(RecentRoute(recentSide(from), recentSide(to), via?.let(::recentSide)))
        _state.update {
            it.copy(
                results = results, walkShortest = walk.getOrNull()?.shortest, promotedDestination = promoted,
                phase = DirectionsPhase.Settled(results.successCount), resultsRevision = it.resultsRevision + 1,
                recentRoutes = recent,
                // 완료 통지는 합산 1문장(수단별 개별 통지 금지). 포커스는 옮기지 않는다(위원장 판정 2026-08-02).
                notice = next(if (results.successCount > 0) strings.get("directions.readySummary", results.successCount) else strings.get("directions.allFailed")),
            )
        }
    }

    /**
     * 수단 조회 15초 상한. ⚠ 블록이 `Result`를 돌려주므로 바깥 null은 **만료만** 뜻한다 — 블록 값을 그대로 두면 transit의
     * 정상 "경로 없음"(null)이 만료 null과 같은 값이 되어 `Error`로 낭독된다(3-state 붕괴). `withTimeout`의 예외는
     * `CancellationException`이라 분류기가 다시 던지므로 `OrNull` 판이 필수.
     */
    private suspend fun <T> timed(block: suspend () -> T): Result<T> =
        withTimeoutOrNull(queryTimeoutMs) { settle(block) } ?: Result.failure(QueryTimeout())

    /** 취소는 삼키지 않는다(`runCatching` 금지, README §3). */
    private suspend fun <T> settle(block: suspend () -> T): Result<T> = try {
        Result.success(block())
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        Result.failure(e)
    }

    /** 계단 회피 토글(웹 toggleStepFree 동형): 결과가 있으면 도보만 재조회, 조회 전이면 상태만. */
    fun toggleStepFree() {
        if (isInFlight) return
        _state.update { it.copy(stepFreeEnabled = !it.stepFreeEnabled) }
        val coords = lastCoords ?: return
        if (_state.value.results == null) return
        isInFlight = true
        _state.update { it.copy(stepFreeBusy = true) }
        queryJob = viewModelScope.launch {
            try {
                refetchWalk(coords)
            } finally {
                if (currentCoroutineContext().isActive) {
                    isInFlight = false
                    _state.update { it.copy(stepFreeBusy = false) }
                }
            }
        }
    }

    private suspend fun refetchWalk(coords: Coords) {
        val lang = dataLocale()
        val accessible = _state.value.stepFreeEnabled && lang == "ko"
        val dl = if (lang == "ko") DataLocale.ko else DataLocale.en
        val walk = withContext(io) { timed { routes.walkAlternatives(coords.origin.lat, coords.origin.lng, coords.dest.lat, coords.dest.lng, accessible, dl, coords.via) } }
        currentCoroutineContext().ensureActive()
        val current = _state.value.results ?: return
        var outcome = DirectionsOutcomeClassifier.classifyWalk(walk.map { it.result })
        // 부분 재조회가 다른 수단 결과까지 버리게 하지 않는다 — 커버리지 밖은 도보 오류로.
        if (outcome.isOutOfCoverage) outcome = DirectionsModeOutcome.Error
        _state.update {
            it.copy(results = current.replacingWalk(outcome), walkShortest = walk.getOrNull()?.shortest, landing = landingNext(LandingTarget.WalkHeading))
        }
    }

    /** "정확한 위치 허용"(GeoReduced 해결 버튼): 재요청이 FINE이면 재조회, 아니면 통지만. */
    fun requestPreciseLocation() {
        if (_state.value.isRequestingPrecise) return
        _state.update { it.copy(isRequestingPrecise = true) }
        viewModelScope.launch {
            val granted = try {
                locator.requestPreciseLocation()
            } finally {
                _state.update { it.copy(isRequestingPrecise = false) }
            }
            if (granted) {
                runQuery()
            } else {
                _state.update { it.copy(preciseRetryFailed = true, notice = next(strings.get("android.common.geoReducedDesc"))) }
            }
        }
    }

    // ── 현재 위치 라벨(F-B) ──────────────────────────────────────────────────

    /** 이미 허가된 세션에서만 조용히 주소를 병기한다(탭 진입만으론 권한 팝업 금지). */
    fun loadCurrentAddressIfAuthorized() {
        if (hasLoadedCurrentAddress) return
        val s = _state.value
        if (s.from != DirectionsEndpoint.Current && s.to != DirectionsEndpoint.Current) return
        viewModelScope.launch {
            val coord = locator.coordinateForRanking() ?: return@launch
            hasLoadedCurrentAddress = true
            syncCurrentAddress(coord)
        }
    }

    /** "현재 위치 사용" 재선택 = 강제 재측위 + 주소 새로고침. 실패는 조용히 직전 라벨 유지. */
    fun refreshCurrentLocation() {
        if (_state.value.isRefreshingCurrent) return
        _state.update { it.copy(isRefreshingCurrent = true) }
        viewModelScope.launch {
            try {
                val coord = try {
                    locator.currentCoordinate(force = true)
                } catch (_: LocationException) {
                    null
                } ?: return@launch
                hasLoadedCurrentAddress = true
                syncCurrentAddress(coord)
            } finally {
                _state.update { it.copy(isRefreshingCurrent = false) }
            }
        }
    }

    /** 역지오코딩 실패·매칭 없음은 null로 비운다(옛 좌표의 주소를 남기지 않는다). 주소는 조회 흐름을 막지 않는다. */
    private suspend fun syncCurrentAddress(coord: NearbyCoord) {
        val seq = ++addressSeq
        val resolved = try {
            withContext(io) { search.reverseGeocode(coord.lat, coord.lng, dataLocale()) }
        } catch (_: APIError) {
            null
        }
        if (seq != addressSeq) return // 더 새 요청이 이미 떠났다 — 옛 답으로 덮지 않는다
        _state.update { it.copy(currentAddress = resolved?.address, currentAddressEnglish = if (resolved?.address == null) null else resolved.english) }
    }

    /**
     * 필드 한 줄 = 한 객체: "출발지, 현재 위치"처럼 라벨+값 단일 텍스트(쉼표 결합). 미확정 필드는 검색 유도 라벨이 곧
     * 버튼 이름. `accessible`은 병기 변종(E28): false = 시각 `Roman (한글)`, true = 낭독(괄호 없이).
     */
    fun fieldText(target: DirectionsFieldTarget, accessible: Boolean, lang: String): String {
        val s = _state.value
        val label = when (target) {
            DirectionsFieldTarget.from -> strings.get("directions.from")
            DirectionsFieldTarget.to -> strings.get("directions.to")
            DirectionsFieldTarget.via -> strings.get("directions.via")
            DirectionsFieldTarget.manualLocation -> error("manualLocation은 길찾기 폼 필드가 아니다")
        }
        val endpoint = when (target) {
            DirectionsFieldTarget.from -> s.from
            DirectionsFieldTarget.to -> s.to
            DirectionsFieldTarget.via -> s.via
            DirectionsFieldTarget.manualLocation -> error("manualLocation은 길찾기 폼 필드가 아니다")
        }
        return when (endpoint) {
            DirectionsEndpoint.Current -> "$label, ${currentLocationText(accessible, lang)}"
            is DirectionsEndpoint.Place -> {
                val name = bilingualName(lang, endpoint.label, en = null, roman = endpoint.labelRoman)
                "$label, ${if (accessible) name.primary else name.display}"
            }
            null -> when (target) {
                DirectionsFieldTarget.from -> strings.get("directions.searchFrom")
                DirectionsFieldTarget.to -> strings.get("directions.searchTo")
                DirectionsFieldTarget.via -> strings.get("directions.addVia")
                DirectionsFieldTarget.manualLocation -> error("manualLocation은 길찾기 폼 필드가 아니다")
            }
        }
    }

    private fun currentLocationText(accessible: Boolean, lang: String): String {
        val s = _state.value
        if (s.isRefreshingCurrent) return strings.get("directions.refreshingCurrent")
        val address = s.currentAddress ?: return strings.get("directions.currentLocation")
        val name = bilingualName(lang, address, en = s.currentAddressEnglish, roman = null)
        return strings.get("directions.currentLocationNear", if (accessible) name.primary else name.display)
    }

    /** 마지막 도보 구간이 가리킬 목적지 이름(spec §3-4-a): 승격본 → 도착지 장소 → 현재 위치면 null("목적지까지"). */
    val destinationName: String?
        get() = _state.value.promotedDestination?.label ?: (_state.value.to as? DirectionsEndpoint.Place)?.label

    // ── 최근 경로 ─────────────────────────────────────────────────────────────

    fun recentRouteLabel(route: RecentRoute, lang: String): String {
        val from = route.from?.label ?: strings.get("directions.currentLocation")
        val to = route.to?.label ?: strings.get("directions.currentLocation")
        val via = route.via?.label ?: return strings.get("recentRoutes.item", from, to)
        // ko 목적격 조사는 받침에 따라 갈려 자원에 못 박는다 — 호출부가 붙이고 한글이 아니면 조사 없이.
        val viaText = if (lang == "ko") via + (KoreanParticle.objectMarker(via) ?: "") else via
        return strings.get("recentRoutes.itemVia", from, to, viaText)
    }

    /** 활성화 = 두 필드(+경유지) 원자 확정 + 즉시 조회. 화면이 조회 버튼을 먼저 선점한다(결과 도착 시 섹션 소멸). */
    fun activateRecentRoute(route: RecentRoute) {
        setEndpoint(route.from?.let(::endpointOf) ?: DirectionsEndpoint.Current, DirectionsFieldTarget.from)
        setEndpoint(route.to?.let(::endpointOf) ?: DirectionsEndpoint.Current, DirectionsFieldTarget.to)
        route.via?.let { setVia(endpointOf(it)) } ?: clearVia()
        runQuery()
    }

    /** 삭제 — 착지 대상은 다음 → 이전(항목 키), 소멸이면 null(화면이 조회 버튼으로). */
    fun removeRecentRoute(route: RecentRoute): String? {
        recentRoutesTouched = true
        val before = _state.value.recentRoutes
        val index = before.indexOfFirst { it.id == route.id }
        if (index < 0) return null
        val after = store.removeRoute(route)
        val target = after.getOrNull(minOf(index, after.size - 1))?.id
        _state.update {
            it.copy(
                recentRoutes = after, notice = next(strings.get("recent.deleted")),
                landing = landingNext(target?.let(LandingTarget::RecentRoute) ?: LandingTarget.Submit),
            )
        }
        return target
    }

    /** 고정 토글: 화면 자리는 유지(정렬은 다음 로드부터), 통지 없음 — `stateDescription` 변화가 신호. */
    fun togglePinRecentRoute(route: RecentRoute) {
        recentRoutesTouched = true
        val list = _state.value.recentRoutes.toMutableList()
        val index = list.indexOfFirst { it.id == route.id }
        if (index < 0) return
        val pinned = !list[index].pinned
        store.setRoutePinned(route, pinned)
        list[index] = RecentRoute(route.from, route.to, route.via, pinned)
        _state.update { it.copy(recentRoutes = list) }
    }

    /** 모두 지우기 — 고정은 보존. 비면 섹션이 소멸해 조회 버튼으로 착지. */
    fun clearRecentRoutes() {
        recentRoutesTouched = true
        val after = store.clearRoutes()
        _state.update {
            it.copy(
                recentRoutes = after,
                notice = next(if (after.isEmpty()) strings.get("recentRoutes.cleared") else strings.get("recent.clearedExceptPinned")),
                landing = if (after.isEmpty()) landingNext(LandingTarget.Submit) else it.landing,
            )
        }
    }

    // ── 끝점 검색(EndpointPicker 합성, spec §13-3·판정 32) ────────────────────

    /** 후보·최근 목록·통지는 `EndpointPicker`; 확정의 의미(필드 확정·재측위·착지)는 아래 `onSelect`가 정한다. */
    val picker = EndpointPicker(search, store, strings, io, viewModelScope, dataLocale, ranking = { locator.coordinateForRanking() }) { endpoint, target ->
        setEndpoint(endpoint, target)
        // "현재 위치 사용" 재선택 = 강제 재측위 + 주소 새로고침(F-B) — from에서만(지정 화면의 되돌리기는 이 부수효과가 없다).
        if (target == DirectionsFieldTarget.from && endpoint == DirectionsEndpoint.Current) refreshCurrentLocation()
        // 확정 뒤 착지: 출발지 → 도착지 버튼, 도착지·경유지 → 조회 버튼(셋 다 "다음에 할 일").
        val landing = if (target == DirectionsFieldTarget.from) LandingTarget.Field(DirectionsFieldTarget.to) else LandingTarget.Submit
        _state.update { it.copy(landing = landingNext(landing)) }
    }
    val endpointSearch: StateFlow<EndpointSearchState?> get() = picker.state

    fun openPicker(target: DirectionsFieldTarget) = picker.open(target)

    /** 닫힘은 진행 중 검색을 취소하고(picker) 열었던 필드로 착지한다(여기). */
    fun closePicker() {
        val target = picker.close() ?: return
        _state.update { it.copy(landing = landingNext(LandingTarget.Field(target))) }
    }

    fun submitCandidates() = picker.submitCandidates()
    fun selectPlace(place: Place) = picker.selectPlace(place)
    fun selectRecentEndpoint(endpoint: RecentEndpoint) = picker.selectRecentEndpoint(endpoint)
    fun selectCurrent() = picker.selectCurrent()
    fun selectAddress(address: JusoAddress) = picker.selectAddress(address)
    fun removeRecentEndpoint(endpoint: RecentEndpoint): String? = picker.removeRecentEndpoint(endpoint)
    fun togglePinRecentEndpoint(endpoint: RecentEndpoint) = picker.togglePinRecentEndpoint(endpoint)
    fun clearRecentEndpoints() = picker.clearRecentEndpoints()

    // ── 프리필(spec §5) ───────────────────────────────────────────────────────

    private fun applyPrefill(prefill: DirectionsPrefill) {
        val place = DirectionsEndpoint.Place(prefill.label, prefill.lat, prefill.lng, prefill.labelRoman)
        val from = if (prefill.role == DirectionsPrefillRole.from) place else DirectionsEndpoint.Current
        val to = if (prefill.role == DirectionsPrefillRole.to) place else null
        _state.update { it.copy(from = from, to = to, via = null) }
        recordRecent(place, if (prefill.role == DirectionsPrefillRole.from) DirectionsFieldTarget.from else DirectionsFieldTarget.to)
        saveFields()
        clearResults()
        // 양끝이 다 있으면 즉시 조회(E32), 도착지가 비면 조회 대신 도착지 버튼 착지.
        if (to != null) runQuery() else _state.update { it.copy(landing = landingNext(LandingTarget.Field(DirectionsFieldTarget.to))) }
    }

    // ── 공용 ──────────────────────────────────────────────────────────────────

    private fun setPhase(phase: DirectionsPhase) {
        _state.update { it.copy(phase = phase, notice = next(phaseText(phase))) }
    }

    private fun phaseText(phase: DirectionsPhase): String = when (phase) {
        DirectionsPhase.Idle -> ""
        DirectionsPhase.NeedEndpoints -> strings.get("directions.needEndpoints")
        DirectionsPhase.Locating -> strings.get("directions.locating")
        DirectionsPhase.Loading -> strings.get("directions.loading")
        DirectionsPhase.GeoDenied -> strings.get("android.common.geoDeniedDesc")
        DirectionsPhase.GeoReduced -> strings.get("android.common.geoReducedDesc")
        DirectionsPhase.GeoError -> strings.get("directions.geoError")
        DirectionsPhase.OutOfCoverage -> strings.get("android.common.outOfCoverage")
        is DirectionsPhase.Settled ->
            if (phase.successCount > 0) strings.get("directions.readySummary", phase.successCount) else strings.get("directions.allFailed")
    }

    private fun next(text: String): Notice = Notice(_state.value.notice.seq + 1, text)

    private fun landingNext(target: LandingTarget): LandingRequest = LandingRequest((_state.value.landing?.seq ?: 0) + 1, target)

    private fun coordinateOf(endpoint: DirectionsEndpoint, current: NearbyCoord?): NearbyCoord? = when (endpoint) {
        DirectionsEndpoint.Current -> current
        is DirectionsEndpoint.Place -> NearbyCoord(endpoint.lat, endpoint.lng)
    }

    private fun recentSide(endpoint: DirectionsEndpoint): RecentEndpoint? =
        (endpoint as? DirectionsEndpoint.Place)?.let { RecentEndpoint(it.label, it.lat, it.lng) }

    private fun endpointOf(side: RecentEndpoint): DirectionsEndpoint.Place = DirectionsEndpoint.Place(side.label, side.lat, side.lng)

    companion object {
        const val KEY_FROM = "directions.from"
        const val KEY_TO = "directions.to"
        const val KEY_VIA = "directions.via"
    }
}
