package space.dodoplanet.gildongmu.directions

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import space.dodoplanet.gildongmu.a11y.Notice
import space.dodoplanet.gildongmu.kit.APIError
import space.dodoplanet.gildongmu.kit.DirectionsEndpoint
import space.dodoplanet.gildongmu.kit.NearbyCoord
import space.dodoplanet.gildongmu.kit.RecentEndpoint
import space.dodoplanet.gildongmu.kit.RecentSearchStore
import space.dodoplanet.gildongmu.kit.SearchService
import space.dodoplanet.gildongmu.kit.models.JusoAddress
import space.dodoplanet.gildongmu.kit.models.Place

/**
 * 끝점 검색(iOS `EndpointSearchModel` 동형, spec §13-3·판정 32) — 길찾기 폼(`DirectionsViewModel`이 합성)과 현재 위치 수동 지정 화면
 * (`ManualLocationPickerViewModel`)이 같은 모델을 쓴다. 이 클래스는 후보·최근 목록·통지만 알고, **확정의 의미는 `onSelect`가 정한다**
 * (길찾기: 필드 확정 + 착지 / 지정: 수동 위치 set·clear). 착지 발급은 여기 없다(길찾기 래퍼가 `close` 뒤 발급).
 */
class EndpointPicker(
    private val search: SearchService,
    private val store: RecentSearchStore,
    private val strings: Strings,
    private val io: CoroutineDispatcher,
    private val scope: CoroutineScope,
    private val dataLocale: () -> String,
    /** 후보 근접 가중 좌표(유효 좌표 — 수동이면 측위 없이 그 좌표, spec §13-2). null이면 좌표 없이 검색. */
    private val ranking: suspend () -> NearbyCoord?,
    /** 확정 뒤 화면을 닫는가 — 길찾기는 폼으로 돌아가고(true), 수동 지정은 측위 통지를 이 화면에서 내야 하므로 호스트가 pop할 때까지 연다(false). */
    private val closesOnSelect: Boolean,
    private val onSelect: (DirectionsEndpoint, DirectionsFieldTarget) -> Unit,
) {
    private val _state = MutableStateFlow<EndpointSearchState?>(null)
    val state: StateFlow<EndpointSearchState?> = _state.asStateFlow()

    /** 끝점 검색이 소비한 후보 세대(열 때마다 0으로). */
    var consumedCandidateRevision: Int = 0

    private var searchJob: Job? = null
    private var geocodeJob: Job? = null

    fun open(target: DirectionsFieldTarget) {
        consumedCandidateRevision = 0
        _state.value = EndpointSearchState(target)
        // 첫 로드는 io(spec §7) — 진입 착지가 검색 입력이라 목록이 한 프레임 늦어도 계약이 깨지지 않는다.
        scope.launch {
            val recent = withContext(io) { store.endpoints(target.recentScope) }
            update { if (it.target == target) it.copy(recentEndpoints = recent) else it }
        }
    }

    /** 닫힘은 결정과 무관하게 진행 중 후보 검색·지오코딩을 취소한다 — 닫힌 뒤 도착한 응답이 확정하지 않는다. 열려 있던 타깃을 돌려준다. */
    fun close(): DirectionsFieldTarget? {
        val target = _state.value?.target ?: return null
        searchJob?.cancel()
        geocodeJob?.cancel()
        _state.value = null
        return target
    }

    fun submitCandidates() {
        val picker = _state.value ?: return
        val trimmed = picker.queryState.text.toString().trim()
        if (trimmed.isEmpty()) return
        searchJob?.cancel()
        val lang = dataLocale()
        update { it.copy(hasSearched = true, isSearching = true) }
        searchJob = scope.launch {
            // 허가된 세션이면 좌표를 실어 근접 블렌딩(팝업 없음). 수동 위치면 그 좌표.
            val coord = ranking()
            val outcome = withContext(io) { search.search(trimmed, coord?.lat, coord?.lng, lang, includeWeb = false) }
            currentCoroutineContext().ensureActive()
            val places = outcome.places.items.take(CANDIDATE_LIMIT)
            val addresses = outcome.addresses.items.take(CANDIDATE_LIMIT)
            val count = places.size + addresses.size
            // 3-state: "0건"과 "조회 실패"(양쪽 다 실패)를 뭉개지 않는다.
            val message = when {
                count > 0 -> strings.get("directions.candidateCount", count)
                outcome.allFailed -> strings.get("directions.candidateError")
                else -> strings.get("directions.candidateNone")
            }
            update { it.copy(places = places, addresses = addresses, isSearching = false, candidateRevision = it.candidateRevision + 1, notice = next(it, message)) }
        }
    }

    fun selectPlace(place: Place) = select(DirectionsEndpoint.Place(place.name, place.lat, place.lng, place.nameRoman))

    /** 최근 장소 행 활성화 = 재검색 없이 즉시 확정(기록은 `onSelect` 쪽 — 이중 기록 금지). */
    fun selectRecentEndpoint(endpoint: RecentEndpoint) = select(DirectionsEndpoint.Place(endpoint.label, endpoint.lat, endpoint.lng))

    /** "현재 위치 사용"(from) / "현재 위치로 되돌리기"(manualLocation). 도착지는 스왑이, 경유지는 장소만(spec §3-2 표 5). */
    fun selectCurrent() {
        val target = _state.value?.target ?: return
        if (target != DirectionsFieldTarget.from && target != DirectionsFieldTarget.manualLocation) return
        select(DirectionsEndpoint.Current)
    }

    /** 주소 후보는 지오코딩 성공 시에만 확정. 실패는 coordError 통지 + 화면 유지. 연타는 무시. */
    fun selectAddress(address: JusoAddress) {
        if (geocodeJob?.isActive == true) return
        geocodeJob = scope.launch {
            val target = address.roadAddrPart1.ifEmpty { address.roadAddr }
            val match = try {
                withContext(io) { search.geocode(target) }.firstOrNull()
            } catch (_: APIError) {
                null
            }
            currentCoroutineContext().ensureActive()
            if (match == null) {
                update { it.copy(notice = next(it, strings.get("directions.coordError"))) }
                return@launch
            }
            // 라틴 표기는 지정 시점의 juso 공식 영문 주소(E28). 이 잡 자신이 지오코딩 잡이라 취소 대상에서 뺀다.
            select(DirectionsEndpoint.Place(target, match.lat, match.lng, address.engAddr.trim().ifEmpty { null }), cancelGeocode = false)
        }
    }

    /** `cancelGeocode=false`는 지오코딩 경로 자신이 부를 때 — 자기 잡을 취소하면 이 아래가 조용히 건너뛰어진다. */
    private fun select(endpoint: DirectionsEndpoint, cancelGeocode: Boolean = true) {
        val target = _state.value?.target ?: return
        onSelect(endpoint, target)
        searchJob?.cancel()
        if (cancelGeocode) geocodeJob?.cancel()
        if (closesOnSelect) _state.value = null
    }

    /** 진행 통지 등 호스트가 이 화면의 단일 창구로 흘리는 문장(수동 지정의 "현재 위치 확인 중"). */
    fun postNotice(text: String) = update { it.copy(notice = next(it, text)) }

    fun removeRecentEndpoint(endpoint: RecentEndpoint): String? {
        val picker = _state.value ?: return null
        val index = picker.recentEndpoints.indexOfFirst { it.id == endpoint.id }
        if (index < 0) return null
        val after = store.removeEndpoint(endpoint, picker.target.recentScope)
        update { it.copy(recentEndpoints = after, notice = next(it, strings.get("recent.deleted"))) }
        return after.getOrNull(minOf(index, after.size - 1))?.id
    }

    fun togglePinRecentEndpoint(endpoint: RecentEndpoint) {
        val picker = _state.value ?: return
        val list = picker.recentEndpoints.toMutableList()
        val index = list.indexOfFirst { it.id == endpoint.id }
        if (index < 0) return
        val pinned = !list[index].pinned
        store.setEndpointPinned(endpoint, picker.target.recentScope, pinned)
        list[index] = RecentEndpoint(endpoint.label, endpoint.lat, endpoint.lng, pinned)
        update { it.copy(recentEndpoints = list) }
    }

    fun clearRecentEndpoints() {
        val picker = _state.value ?: return
        val after = store.clearEndpoints(picker.target.recentScope)
        update { it.copy(recentEndpoints = after, notice = next(it, strings.get(if (after.isEmpty()) "recent.cleared" else "recent.clearedExceptPinned"))) }
    }

    private fun update(transform: (EndpointSearchState) -> EndpointSearchState) {
        _state.update { it?.let(transform) }
    }

    private fun next(picker: EndpointSearchState, text: String) = Notice(picker.notice.seq + 1, text)

    companion object {
        const val CANDIDATE_LIMIT = 5
    }
}
