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
import space.dodoplanet.gildongmu.a11y.Notice
import space.dodoplanet.gildongmu.kit.RecentQuery
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
) : ViewModel() {
    val queryState = TextFieldState(savedState.get<String>(QUERY_KEY) ?: "")

    private val _state = MutableStateFlow(SearchUiState())
    val state: StateFlow<SearchUiState> = _state.asStateFlow()

    /** 화면이 소비한 착지 세대 — 비저장 필드(프로세스 재생성 뒤 revision 0과 수명을 맞춘다). */
    var consumedRevision: Int = 0

    private var searchJob: Job? = null

    /** 최근 검색 첫 로드. `submit`이 기록하기 전에 join해 로드가 기록을 덮지 않게 한다. */
    private val initJob: Job = viewModelScope.launch {
        val recent = withContext(io) { store.queries() }
        _state.update { it.copy(recentQueries = recent) }
    }

    fun submit() {
        val trimmed = queryState.text.toString().trim()
        if (trimmed.isEmpty()) return
        searchJob?.cancel() // 진행 중 검색 폐기: stale 응답 차단
        savedState[QUERY_KEY] = trimmed
        val lang = dataLocale()
        // iOS와 같이 동기로 "검색 중"에 들어간다 — 버튼 가드와 통지가 첫 디스패치를 기다리지 않는다.
        _state.update { it.copy(bucket = null, region = null, isSearching = true, notice = next(strings.searchingFor(trimmed))) }
        searchJob = viewModelScope.launch {
            initJob.join()
            _state.update { it.copy(recentQueries = store.recordQuery(trimmed)) } // 제출 = 기록 시점
            // 좌표는 M1에서 싣지 않는다(spec §9-2) — 전국 정확도순.
            val result = withContext(io) { service.search(trimmed, lat = null, lng = null, lang = lang) }
            ensureActive()
            _state.update { s ->
                val total = result.orderedSections.sumOf { it.count }
                val failed = result.allFailed && total == 0
                s.copy(
                    outcome = result, isSearching = false, failed = failed, resultsRevision = s.resultsRevision + 1,
                    notice = next(if (failed) strings.failed() else if (total == 0) strings.empty() else strings.count(total)),
                )
            }
        }
    }

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

    private fun next(text: String): Notice = Notice(_state.value.notice.seq + 1, text)

    companion object {
        const val QUERY_KEY = "query"
    }
}
