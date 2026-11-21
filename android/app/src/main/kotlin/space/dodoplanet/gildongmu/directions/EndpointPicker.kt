package space.dodoplanet.gildongmu.directions

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.roundToInt
import space.dodoplanet.gildongmu.a11y.HapticKind
import space.dodoplanet.gildongmu.a11y.Notice
import space.dodoplanet.gildongmu.kit.APIError
import space.dodoplanet.gildongmu.kit.DirectionsEndpoint
import space.dodoplanet.gildongmu.kit.JourneyStationKind
import space.dodoplanet.gildongmu.kit.JourneyTransferMode
import space.dodoplanet.gildongmu.kit.NearbyCoord
import space.dodoplanet.gildongmu.kit.RecentEndpoint
import space.dodoplanet.gildongmu.kit.RecentSearchStore
import space.dodoplanet.gildongmu.kit.RecentStation
import space.dodoplanet.gildongmu.kit.RoutePoint
import space.dodoplanet.gildongmu.kit.RouteService
import space.dodoplanet.gildongmu.kit.SearchService
import space.dodoplanet.gildongmu.kit.StationLayoutKind
import space.dodoplanet.gildongmu.kit.haversineMeters
import space.dodoplanet.gildongmu.kit.stationLayoutKind
import space.dodoplanet.gildongmu.kit.ReorderMove
import space.dodoplanet.gildongmu.a11y.pinnedOrderAfterMove
import space.dodoplanet.gildongmu.kit.normalizeVoiceQuery
import androidx.compose.foundation.text.input.clearText
import androidx.compose.foundation.text.input.setTextAndPlaceCursorAtEnd
import space.dodoplanet.gildongmu.kit.models.JusoAddress
import space.dodoplanet.gildongmu.kit.models.Place

/**
 * 여정 입력(B26)이 끝점 검색에 거는 자리 — 역 칸·입구 검색·지금 탄 열차 역 검색의 확정과 정류장 검색의 근거. **인자 전부 기본값이 없다**
 * (빠뜨리면 정류장 검색이 조용히 꺼진다, iOS 역 칸 init과 같은 이유). `onSelectAboardStation`이 null이면 출발지 시트에 「지하철역 검색」 행이 없다(여정 입력이 안 설 때).
 * `stopOrigin`·`stopDest`는 길찾기 폼의 출발·도착 좌표 중 알려진 것이다(둘 다 없으면 정류장 검색을 하지 않는다).
 */
class JourneyPickerHooks(
    val routes: RouteService,
    val stopOrigin: RoutePoint?,
    val stopDest: RoutePoint?,
    /** 역 칸(`boardStation`·`alightStation`)의 확정 — 역 장소는 노선 힌트가, 정류장은 `kind=busStop`이 실린다. */
    val onSelectStation: (RecentStation, DirectionsFieldTarget) -> Unit,
    val onSelectAboardStation: ((RecentStation) -> Unit)?,
    /** 입구 검색의 확정 — 질문 대상으로 넘긴다(질문은 시트가 닫힌 뒤 화면이 띄운다). */
    val onSelectTransfer: (RecentStation, JourneyTransferMode) -> Unit,
)

/** 정류장 검색의 결과(iOS `StopSearchOutcome`) — `unsearched`는 대상 지역을 못 정했다는 서버 판정. */
private class StopSearchOutcome(val rows: List<StopRow>, val failed: Boolean, val truncated: Boolean, val unsearched: Boolean)

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
    /** 장소 후보를 고를 때 그 번호를 목적지 전화번호부에 적는 자리(E90). 목적지가 아닌 화면(수동 위치 지정)은 `{}`를 명시한다 — 기본값이 없다. */
    private val noteDestinationPhone: (Place) -> Unit,
    private val onSelect: (DirectionsEndpoint, DirectionsFieldTarget) -> Unit,
) {
    /** 장소 후보만 받는가(잘못 내림 복구의 역 검색, `EndpointSearchContent`의 `stationsOnly`와 짝) — 주소 후보를 버려 후보 수 통지가 보이는 줄 수와 같다. */
    var placesOnly = false

    /**
     * 여정 입력 자리(길찾기 화면만 건다 — 수동 위치·안내 시트는 null이라 동작이 그대로다). **열 때마다** 읽는다(`open`) — 여정 입력이 서는 조건(데이터 로케일 ko)이
     * 그 사이 바뀔 수 있고 출발·도착 좌표도 그때그때 다르다.
     */
    var journey: (() -> JourneyPickerHooks)? = null
    private var hooks: JourneyPickerHooks? = null

    private val _state = MutableStateFlow<EndpointSearchState?>(null)
    val state: StateFlow<EndpointSearchState?> = _state.asStateFlow()

    /** 끝점 검색이 소비한 후보 세대(열 때마다 0으로). */
    var consumedCandidateRevision: Int = 0

    private var searchJob: Job? = null
    private var geocodeJob: Job? = null

    fun open(target: DirectionsFieldTarget) {
        consumedCandidateRevision = 0
        val journeyHooks = journey?.invoke()
        hooks = journeyHooks
        _state.value = EndpointSearchState(target, aboardOffered = target == DirectionsFieldTarget.from && journeyHooks?.onSelectAboardStation != null)
        // 역 칸은 최근 목록을 보이지 않는다(분류가 없어 역인지 알 수 없다).
        if (target.isStationTarget) return
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

    /**
     * 지금 탄 열차 역 검색(E71)으로 바뀐다 — 같은 시트가 지하철역만 받는 검색으로 다시 시작한다. 앞선 후보·주소·정류장 줄은 이 모드의 계약(지하철역만,
     * 정류장 검색 없음)과 맞지 않아 비운다. 「지하철역 검색」 행이 있을 때(`aboardOffered`)만 선다.
     */
    fun startAboardSearch() {
        val picker = _state.value ?: return
        if (!picker.aboardOffered || picker.aboardMode) return
        searchJob?.cancel()
        picker.queryState.clearText()
        update {
            it.copy(
                places = emptyList(), addresses = emptyList(), stops = emptyList(), stopsFailed = false, stopsTruncated = false,
                showsNoBusData = false, showsPlacesFailure = false, hasSearched = false, isSearching = false,
                notice = next(it, ""), aboardMode = true,
            )
        }
    }

    /** 받아쓰기 전사로 바로 후보 검색(B22 ②, iOS 동형): 다듬은 검색어를 입력에 넣고 그 원문을 통지한 뒤 검색한다(출발·도착은 주소 비중이 높아 끝 마침표 하나에 juso가 0건). */
    fun submitVoice(transcript: String) {
        val picker = _state.value ?: return
        val query = normalizeVoiceQuery(transcript)
        picker.queryState.setTextAndPlaceCursorAtEnd(query)
        postNotice(query)
        submitCandidates()
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
            val journeyHooks = hooks
            val stopsSearch = picker.searchesStops && journeyHooks != null
            // 정류장 검색은 제출 때 장소 검색과 병렬로 돈다(타자마다 아님).
            val (outcome, stopResult) = coroutineScope {
                val stops = async { if (stopsSearch && journeyHooks != null) searchStops(journeyHooks, trimmed, coord) else null }
                val found = withContext(io) { search.search(trimmed, coord?.lat, coord?.lng, lang, includeWeb = false) }
                found to stops.await()
            }
            currentCoroutineContext().ensureActive()
            val places = outcome.places.items.take(CANDIDATE_LIMIT)
            val addresses = if (placesOnly || picker.stationsOnlyMode) emptyList() else outcome.addresses.items.take(CANDIDATE_LIMIT)
            val stops = stopResult?.rows ?: emptyList()
            val count = places.size + addresses.size + stops.size
            // 역 칸·입구 검색은 역이 장소 트랙에서만 오므로 그 성패를 본다(주소 성공이 장소 실패를 가리지 않는다). 그 밖은 종전대로 양쪽 다 실패일 때만 실패다.
            val journeyMode = picker.stationsOnlyMode || stopsSearch
            val placesFailed = if (journeyMode) outcome.places.isFailed else outcome.allFailed
            val showsPlacesFailure = journeyMode && placesFailed && count > 0
            val showsNoBusData = count == 0 && (stopResult?.unsearched ?: false)
            val stopsFailed = stopResult?.failed ?: false
            // 3-state: "0건"과 "조회 실패"(양쪽 다 실패)를 뭉개지 않는다. 실패는 줄만 두면 훑어야 알게 되니 건수 뒤에 한 문장씩 덧붙이고 진동도 맞춘다.
            var haptic = HapticKind.success
            var message = when {
                count > 0 -> strings.get("directions.candidateCount", count)
                placesFailed -> { haptic = HapticKind.failure; strings.get("directions.candidateError") }
                else -> { haptic = HapticKind.attention; strings.get("directions.candidateNone") }
            }
            if (count > 0 && showsPlacesFailure) { message += " " + strings.get("directions.candidateError"); haptic = HapticKind.attention }
            if (stopsFailed) { message += " " + strings.get("android.journey.stopSearchFailed"); if (count > 0) haptic = HapticKind.attention }
            if (showsNoBusData) message += " " + strings.get("android.common.unavailableHere.noBusData")
            update {
                it.copy(
                    places = places, addresses = addresses, stops = stops, stopsFailed = stopsFailed, stopsTruncated = stopResult?.truncated ?: false,
                    showsNoBusData = showsNoBusData, showsPlacesFailure = showsPlacesFailure,
                    isSearching = false, candidateRevision = it.candidateRevision + 1,
                    notice = if (journeyMode) next(it, message).copy(haptic = haptic) else next(it, message),
                )
            }
        }
    }

    /** 서버 `q`의 trim 길이 계약(2~30자) — 밖이면 정류장 검색을 하지 않는다(400이 실패 줄로 위장하지 않게). */
    private val stopQueryLengths = 2..30

    /**
     * 두 글자 이상 + 알려진 좌표가 있을 때만 정류장 검색을 한다. 서비스 지역 밖은 실패가 아니다(빈 줄 — 장소 결과가 정본), 그 밖의 예외는 실패 한 줄(미유도 지역은 `unsearched`가 따로 말한다).
     * 거리순 5건(기준점이 없으면 서버 순서 그대로, 거리는 생략).
     */
    private suspend fun searchStops(journeyHooks: JourneyPickerHooks, text: String, reference: NearbyCoord?): StopSearchOutcome? {
        if (text.codePointCount(0, text.length) !in stopQueryLengths) return null
        if (journeyHooks.stopOrigin == null && journeyHooks.stopDest == null) return null
        return try {
            val result = withContext(io) { journeyHooks.routes.journeyStops(text, journeyHooks.stopOrigin, journeyHooks.stopDest) }
            val rows = result.stops.map { hit ->
                StopRow(hit, reference?.let { haversineMeters(it.lat, it.lng, hit.lat, hit.lng).roundToInt() })
            }
            // 거리 있는 쪽만 가른다 — 정렬이 안정적이라 같은 거리는 서버 순서를 지킨다.
            val sorted = if (reference != null) rows.sortedBy { it.distance ?: Int.MAX_VALUE } else rows
            StopSearchOutcome(sorted.take(CANDIDATE_LIMIT), result.failed, result.truncated, result.unsearched)
        } catch (e: CancellationException) {
            throw e
        } catch (_: APIError.OutOfCoverage) {
            StopSearchOutcome(emptyList(), failed = false, truncated = false, unsearched = false)
        } catch (_: Exception) {
            StopSearchOutcome(emptyList(), failed = true, truncated = false, unsearched = false)
        }
    }

    /** 장소 줄 활성화 — 대상별로 다르다: 지금 탄 열차는 지하철역만, 역 칸은 역만, 입구 검색은 역이면 질문 대상, 그 밖은 종전 확정(전화 기록 포함). */
    fun selectPlace(place: Place) {
        val picker = _state.value ?: return
        when {
            picker.aboardMode -> selectAboardStation(place)
            picker.target.isStationTarget -> selectStation(place, picker.target)
            picker.target == DirectionsFieldTarget.transfer && hooks != null -> selectTransferPlace(place)
            else -> selectEndpointPlace(place)
        }
    }

    private fun selectEndpointPlace(place: Place) {
        noteDestinationPhone(place)
        select(DirectionsEndpoint.Place(place.name, place.lat, place.lng, place.nameRoman))
    }

    private fun stationOf(place: Place) = RecentStation(place.name, place.lat, place.lng, journeyLineHint(place), kind = null)

    /** 화면 변화 없는 활성화 응답이라 시트에 남고 진동과 함께 통지한다(고우선 표식이 없는 통지 슬롯이라 문장 + 진동 하나로 전한다). */
    private fun rejectWith(key: String) =
        update { it.copy(notice = next(it, strings.get(key)).copy(haptic = HapticKind.attention)) }

    /** 역 칸은 역이나 정류장만 받는다: 이 줄은 장소 줄이고 지하철·철도역이 아니면 칸에 넣지 않고 시트를 연 채 통지한다. */
    private fun selectStation(place: Place, target: DirectionsFieldTarget) {
        val journeyHooks = hooks ?: return
        if (stationLayoutKind(place) == null) return rejectWith("android.journey.notStation")
        journeyHooks.onSelectStation(stationOf(place), target)
        finishJourneySelect()
    }

    /** 지금 탄 열차 역 검색(E71): 지하철역만 받는다(실시간 도착이 닿는 노선이 첫 판의 범위). 아니면 시트를 연 채 통지한다. */
    private fun selectAboardStation(place: Place) {
        val callback = hooks?.onSelectAboardStation ?: return
        if (stationLayoutKind(place) != StationLayoutKind.subway) return rejectWith("android.journey.aboardNotSubway")
        callback(stationOf(place))
        finishJourneySelect()
    }

    /** 입구 검색(E77)의 장소 줄: 지하철·철도역이면 확정하지 않고 질문 대상으로 넘기고, 그 밖은 종전 경유지 확정이다. */
    private fun selectTransferPlace(place: Place) {
        val mode = when (stationLayoutKind(place)) {
            StationLayoutKind.subway -> JourneyTransferMode.subway
            StationLayoutKind.rail -> JourneyTransferMode.rail
            null -> return selectEndpointPlace(place)
        }
        hooks?.onSelectTransfer?.invoke(stationOf(place), mode)
        finishJourneySelect()
    }

    /** 정류장 줄 활성화(E70-e): 이름은 원문 그대로, 노선 힌트 없음. 입구 검색의 정류장은 질문 대상(수단 낱말 「버스」)이고 역 칸의 정류장은 칸 확정이다. */
    fun selectStop(row: StopRow) {
        val picker = _state.value ?: return
        val journeyHooks = hooks ?: return
        val station = RecentStation(row.hit.name, row.hit.lat, row.hit.lng, line = null, kind = JourneyStationKind.busStop)
        if (picker.target == DirectionsFieldTarget.transfer) journeyHooks.onSelectTransfer(station, JourneyTransferMode.bus)
        else journeyHooks.onSelectStation(station, picker.target)
        finishJourneySelect()
    }

    /** 여정 확정 뒤 마무리 — 진행 중 검색·지오코딩을 취소하고 닫는다(`select`와 같은 규칙, 끝점 확정이 아니라 `onSelect`는 부르지 않는다). */
    private fun finishJourneySelect() {
        searchJob?.cancel()
        geocodeJob?.cancel()
        if (closesOnSelect) _state.value = null
    }

    /** 최근 장소 행 활성화 = 재검색 없이 즉시 확정(기록은 `onSelect` 쪽 — 이중 기록 금지). */
    fun selectRecentEndpoint(endpoint: RecentEndpoint) = select(DirectionsEndpoint.Place(endpoint.label, endpoint.lat, endpoint.lng, endpoint.labelRoman))

    /** "현재 위치 사용"(from) / "현재 위치로 되돌리기"(manualLocation). 도착지는 스왑이, 경유지는 장소만(spec §3-2 표 5). */
    fun selectCurrent() {
        val picker = _state.value ?: return
        val target = picker.target
        if (target != DirectionsFieldTarget.from && target != DirectionsFieldTarget.manualLocation) return
        // 지금 탄 열차 역 검색에서는 「현재 위치 사용」 행이 없다(출발이 그 역이다).
        if (picker.aboardMode) return
        select(DirectionsEndpoint.Current)
    }

    /** 주소 후보는 지오코딩 성공 시에만 확정. 실패는 coordError 통지 + 화면 유지. 연타는 무시. */
    fun selectAddress(address: JusoAddress) {
        // 역 칸·지금 탄 열차는 주소 후보를 보이지 않는다(분류가 없어 역인지 알 수 없다).
        if (_state.value?.stationsOnlyMode == true) return
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

    /** 고정 최근 장소 순서 바꾸기(B23, iOS `DirectionsEndpointSearchView.moveRecent`): 그 칸의 스코프에 저장하고 돌려받은 배열을 채택, 새 자리(1부터)를 통지한다. */
    fun moveRecentEndpoint(endpoint: RecentEndpoint, move: ReorderMove) {
        val picker = _state.value ?: return
        val order = pinnedOrderAfterMove(picker.recentEndpoints, endpoint, move, { it.pinned }) { a, b -> a.id == b.id } ?: return
        val after = store.reorderPinnedEndpoints(order, picker.target.recentScope)
        val position = after.indexOfFirst { it.id == endpoint.id }
        if (position < 0) return
        update { it.copy(recentEndpoints = after, notice = next(it, strings.get("android.reorder.moved", position + 1))) }
    }

    fun togglePinRecentEndpoint(endpoint: RecentEndpoint) {
        val picker = _state.value ?: return
        val list = picker.recentEndpoints.toMutableList()
        val index = list.indexOfFirst { it.id == endpoint.id }
        if (index < 0) return
        val pinned = !list[index].pinned
        store.setEndpointPinned(endpoint, picker.target.recentScope, pinned)
        list[index] = RecentEndpoint(endpoint.label, endpoint.lat, endpoint.lng, pinned, endpoint.labelRoman)
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
