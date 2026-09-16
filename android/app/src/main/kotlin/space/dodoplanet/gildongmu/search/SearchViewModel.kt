package space.dodoplanet.gildongmu.search

import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.foundation.text.input.clearText
import androidx.compose.foundation.text.input.setTextAndPlaceCursorAtEnd
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import space.dodoplanet.gildongmu.a11y.HapticKind
import space.dodoplanet.gildongmu.a11y.Notice
import space.dodoplanet.gildongmu.kit.NearbyCoord
import space.dodoplanet.gildongmu.kit.RecentQuery
import space.dodoplanet.gildongmu.kit.models.PlaceSort
import space.dodoplanet.gildongmu.nav.ReturnFocusSlot
import space.dodoplanet.gildongmu.kit.RecentSearchStore
import space.dodoplanet.gildongmu.kit.SearchOutcome
import space.dodoplanet.gildongmu.kit.SearchService

/** 검색 화면 상태(iOS `SearchModel` 미러). 검색어는 여기 없다 — `SearchViewModel.queryState`(`TextFieldState`). */
data class SearchUiState(
    val outcome: SearchOutcome? = null,
    val isSearching: Boolean = false,
    /** 3-state 불변식: "결과 없음"과 구분되는 "조회 실패"(정본 두 트랙 모두 실패 + 결과 0). */
    val failed: Boolean = false,
    /** 검색 완료 세대. 화면이 첫 결과 착지 시점을 아는 신호. */
    val resultsRevision: Int = 0,
    val bucket: String? = null,
    val region: String? = null,
    val recentQueries: List<RecentQuery> = emptyList(),
    val notice: Notice = Notice(0, ""),
    /** 정렬 축(iOS `SearchModel.sort`). review = 네이버 리뷰순 단독. 라벨 전환이 곧 상태 신호. */
    val sort: PlaceSort = PlaceSort.accuracy,
    /** 리뷰순 토글 노출 조건: ko + 이 세션에서 네이버가 답한 응답을 본 적 있음(래치). */
    val canSortByReview: Boolean = false,
) {
    val totalCount: Int get() = outcome?.orderedSections?.sumOf { it.count } ?: 0
}

/**
 * 통지 문장 공급. 리소스는 화면 몫이라 ViewModel은 문장을 주입받는다(JVM 테스트 가능). 전부 **호출 시점**에
 * 읽는 람다다 — 생성 시점에 굳히면 Android 13 앱별 언어 변경 뒤 화면은 새 언어인데 통지만 옛 언어로 난다.
 */
class SearchStrings(
    val searchingFor: (String) -> String,
    val failed: () -> String,
    val empty: () -> String,
    val count: (Int) -> String,
    val deleted: () -> String,
    val cleared: () -> String,
    val clearedExceptPinned: () -> String,
)

/**
 * 검색 화면 상태 머신(spec §4). 요청 세대는 Job 취소(iOS Task 취소 = 웹 request-id ref). 전송과 최근 검색의
 * **첫 로드**는 `io`에서, 이후 최근 검색 갱신은 main에서 부른다(SharedPreferences는 첫 로드 뒤 메모리 캐시이고
 * 쓰기는 `apply`가 비동기라 안전 — 착지 대상을 동기로 돌려줘야 하기 때문). 프로세스 재생성은 검색어만
 * `SavedStateHandle`로 복원하고 결과는 포기한다(iOS와 같다).
 */
class SearchViewModel(
    private val service: SearchService,
    private val store: RecentSearchStore,
    private val dataLocale: () -> String,
    private val strings: SearchStrings,
    private val savedState: SavedStateHandle,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    /** 순위 가중 좌표(spec §3-3). 권한이 이미 있을 때만 값, 팝업 없음. 제출은 이것을 **먼저 기다린다**(iOS 동형, 직렬). */
    private val coordinate: suspend () -> NearbyCoord? = { null },
) : ViewModel() {
    val queryState = TextFieldState(savedState.get<String>(QUERY_KEY) ?: "")

    private val _state = MutableStateFlow(SearchUiState())
    val state: StateFlow<SearchUiState> = _state.asStateFlow()

    /** 화면이 소비한 착지 세대 — 비저장 필드(프로세스 재생성 뒤 revision 0과 수명을 맞춘다). */
    var consumedRevision: Int = 0

    private var searchJob: Job? = null

    /** 마지막으로 제출된 질의 — 정렬 토글은 입력창의 현재 텍스트가 아니라 이것으로 재조회한다. */
    private var lastSubmittedQuery = ""

    /** 네이버가 답한 응답을 이 세션에서 본 적 있는가(래치) — 앱은 서버 키를 모르므로 `placesProvider`가 유일한 관측 채널. */
    private var naverBackedSeen = false

    /** 최근 검색 첫 로드. `submit`이 기록하기 전에 join해 로드가 기록을 덮지 않게 한다. */
    private val initJob: Job = viewModelScope.launch {
        val recent = withContext(io) { store.queries() }
        _state.update { it.copy(recentQueries = recent) }
    }

    /**
     * 제출. `landFocus = false`는 정렬 토글의 재조회(새로고침 계열 — 사용자가 토글에 커서를 둔 채 일으킨 변화)로, 첫 결과
     * 착지 계약을 적용하지 않고 실패 시 정렬을 되돌린다.
     */
    fun submit(landFocus: Boolean = true) {
        val trimmed = queryState.text.toString().trim()
        if (trimmed.isEmpty()) return
        searchJob?.cancel() // 진행 중 검색 폐기: stale 응답 차단
        savedState[QUERY_KEY] = trimmed
        lastSubmittedQuery = trimmed
        val lang = dataLocale()
        val requestedSort = _state.value.sort
        // iOS와 같이 동기로 "검색 중"에 들어간다 — 버튼 가드와 통지가 첫 디스패치를 기다리지 않는다.
        _state.update { it.copy(bucket = null, region = null, isSearching = true, notice = next(strings.searchingFor(trimmed))) }
        searchJob = viewModelScope.launch {
            initJob.join()
            _state.update { it.copy(recentQueries = store.recordQuery(trimmed)) } // 제출 = 기록 시점
            // 권한이 이미 허용된 세션이면 좌표를 먼저 얻어 싣는다(캐시 우선, 팝업 없음, 2초 상한 — 직렬, iOS 동형).
            // 좌표 없는 검색은 전국 정확도순이라 근처 결과가 매몰된다. 재정렬은 하지 않는다(서버 근접 블렌딩).
            val coord = coordinate()
            val result = withContext(io) { service.search(trimmed, lat = coord?.lat, lng = coord?.lng, lang = lang, sort = requestedSort) }
            ensureActive()
            if (result.placesProvider == "merged" || result.placesProvider == "naver-local") naverBackedSeen = true
            if (!landFocus) consumedRevision = _state.value.resultsRevision + 1 // 착지 없음(update 람다는 재실행될 수 있어 밖에서)
            _state.update { s ->
                val total = result.orderedSections.sumOf { it.count }
                val failed = result.allFailed && total == 0
                // 정렬 재조회의 장소 트랙이 실패하면 라벨(=상태 신호)이 실패한 정렬을 가리키지 않게 되돌린다(웹 롤백 미러).
                val sort = if (!landFocus && requestedSort == s.sort && result.places.isFailed) flip(requestedSort) else s.sort
                val revision = s.resultsRevision + 1
                s.copy(
                    outcome = result, isSearching = false, failed = failed, resultsRevision = revision, sort = sort,
                    canSortByReview = lang == "ko" && naverBackedSeen,
                    // 결과 진동(spec §14-3): 실패·0건·n건 3-state
                    notice = next(if (failed) strings.failed() else if (total == 0) strings.empty() else strings.count(total), if (failed) HapticKind.failure else if (total == 0) HapticKind.attention else HapticKind.success),
                )
            }
        }
    }

    /**
     * 정렬 전환(iOS `toggleSort`): 칩 리셋, 입력창을 마지막 제출 질의로 되돌리고 그것으로 재조회, 착지 없음. 검색 중이거나
     * 제출 이력이 없으면 무시. `sort`는 다음 일반 제출에도 유지된다.
     */
    fun toggleSort() {
        if (_state.value.isSearching || lastSubmittedQuery.isEmpty()) return
        _state.update { it.copy(sort = flip(it.sort)) }
        setQuery(lastSubmittedQuery)
        submit(landFocus = false)
    }

    private fun flip(sort: PlaceSort) = if (sort == PlaceSort.review) PlaceSort.accuracy else PlaceSort.review

    private val returnFocus = ReturnFocusSlot(savedState)

    /** pop 복귀 착지 키(spec §3-1, 공용 슬롯): 결과가 없는 화면(재생성 뒤)은 시도 없이 지운다. */
    fun rememberReturnFocus(key: String) = returnFocus.remember(key)

    fun takeReturnFocus(): String? = returnFocus.take()?.takeIf { _state.value.outcome != null }

    /** 입력만 비운다(결과 유지 — iOS `.searchable` 동형). */
    fun clearQuery() {
        queryState.clearText()
        savedState[QUERY_KEY] = ""
    }

    fun setQuery(text: String) = queryState.setTextAndPlaceCursorAtEnd(text)

    fun setBucket(bucket: String?) = _state.update { it.copy(bucket = bucket) }

    fun setRegion(region: String?) = _state.update { it.copy(region = region) }

    /**
     * 항목 삭제. 반환은 착지할 행의 **검색어**(다음 → 이전), 목록 소멸이면 null(화면이 검색 버튼으로 보낸다).
     * index가 아니라 검색어인 이유: 화면의 requester는 검색어로 보관하고 재구성 뒤 한 프레임 있다가 착지한다.
     * 통지는 seq를 올려 연속 삭제도 매번 발화한다.
     */
    fun removeRecent(text: String): String? {
        val before = _state.value.recentQueries
        val index = before.indexOfFirst { it.text == text }
        if (index < 0) return null
        val after = store.removeQuery(text)
        _state.update { it.copy(recentQueries = after, notice = next(strings.deleted())) }
        if (after.isEmpty()) return null
        return after[minOf(index, after.size - 1)].text
    }

    /** 고정 토글: 화면 자리는 유지(정렬은 다음 로드부터)하고 그 항목만 교체한다. 통지는 없다 — `stateDescription` 변화가 신호. */
    fun togglePinRecent(text: String) {
        val list = _state.value.recentQueries.toMutableList()
        val index = list.indexOfFirst { it.text == text }
        if (index < 0) return
        val updated = RecentQuery(text, !list[index].pinned)
        list[index] = updated
        store.setQueryPinned(text, updated.pinned)
        _state.update { it.copy(recentQueries = list) }
    }

    /** 모두 지우기 — 고정은 보존한다. 목록이 남으면 "모두 지웠습니다"는 거짓이라 다른 문장. */
    fun clearRecent() {
        val after = store.clearQueries()
        _state.update { it.copy(recentQueries = after, notice = next(if (after.isEmpty()) strings.cleared() else strings.clearedExceptPinned())) }
    }

    private fun next(text: String, haptic: HapticKind? = null): Notice = Notice(_state.value.notice.seq + 1, text, haptic = haptic)

    companion object {
        const val QUERY_KEY = "query"
    }
}
