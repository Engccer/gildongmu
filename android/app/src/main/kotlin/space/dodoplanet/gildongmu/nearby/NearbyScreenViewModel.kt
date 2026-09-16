package space.dodoplanet.gildongmu.nearby

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import space.dodoplanet.gildongmu.a11y.Notice
import space.dodoplanet.gildongmu.kit.NearbyCoord
import space.dodoplanet.gildongmu.kit.NearbyCoordinateSource
import space.dodoplanet.gildongmu.kit.NearbyCoverage
import space.dodoplanet.gildongmu.kit.NearbyLoadCore
import space.dodoplanet.gildongmu.kit.NearbyLoadEvent
import space.dodoplanet.gildongmu.kit.NearbyLoadPhase
import space.dodoplanet.gildongmu.kit.RevealWindow
import space.dodoplanet.gildongmu.kit.spokenDistanceUnits
import space.dodoplanet.gildongmu.nav.ReturnFocusSlot

/** 착지 지시. `rev`가 화면의 `consumedLanding`보다 크면 한 프레임 뒤 `key`에 착지한다(M1 `resultsRevision` 관용구). */
sealed class Landing {
    data object None : Landing()
    data class Key(val key: String, val rev: Int) : Landing()
}

/**
 * kind별 조립기(spec §5 표). `fetch`는 **non-null을 보장**한다(0건 = 빈 payload) — null을 돌려주면 :kit 코어가 `Empty`/`RefreshFailed`로
 * 접어 Loaded에서 새로고침 0건이 "기존 정보를 유지합니다"가 된다(3-state 붕괴). 빈 판정은 `isEmpty`가 한다.
 */
class NearbyKindSpec<P : Any>(
    val coverage: NearbyCoverage,
    /** 둘째 인자 = 직전 Loaded payload(재조회 때만 non-null). 조각 병합 kind(conditions)가 쓴다(spec 판정 25). */
    val fetch: suspend (NearbyCoord?, P?) -> P,
    val isEmpty: (P) -> Boolean,
    /** 첫 로드 착지 키. null → non-null 전이가 곧 "목록이 처음 생겼다"(iOS `nearbyFocusOnLoad`). */
    val firstKey: (P) -> String?,
    val loadedNotice: (P) -> String,
    /** 0건 본문 — payload를 받는다(지하철은 최근접 역 문장, 통지와 같은 문장). `isEmpty`가 항상 거짓인 kind(walkInfra·conditions)는 null. */
    val emptyCopy: ((P) -> String)? = null,
)

/**
 * 내 주변 화면 공통 껍데기(iOS `SubwayNearbyModel` 규범 패턴 + `nearbyAnnouncer`·`NearbyFocusOnLoad`). 판정은 전부 :kit
 * `NearbyLoadCore`; 앱 층은 좌표 어댑터·이벤트→통지 문장·착지 세대·리빌 창·pop 복귀 키뿐.
 */
class NearbyScreenViewModel<P : Any>(
    private val spec: NearbyKindSpec<P>,
    coordinate: NearbyCoordinateSource,
    private val strings: NearbyStrings,
    private val savedState: SavedStateHandle,
) : ViewModel() {
    private val reveal = RevealWindow()
    private val _visibleCount = MutableStateFlow(reveal.visibleCount)

    /** `RevealWindow`는 참조 타입이라 값을 상태에 다시 써야 재구성된다(:kit KDoc). */
    val visibleCount: StateFlow<Int> = _visibleCount.asStateFlow()

    private val _notice = MutableStateFlow(Notice(0, ""))
    val notice: StateFlow<Notice> = _notice.asStateFlow()

    private val _landing = MutableStateFlow<Landing>(Landing.None)
    val landing: StateFlow<Landing> = _landing.asStateFlow()

    /** 묶음별 리빌 창(둘러보기 "주변 상황", spec 판정 31). 산술은 :kit `RevealWindow` 한 벌, 상태에는 공개 수만 투영한다. */
    private val groupReveal = mutableMapOf<String, RevealWindow>()
    private val _groupWindows = MutableStateFlow<Map<String, Int>>(emptyMap())
    val groupWindows: StateFlow<Map<String, Int>> = _groupWindows.asStateFlow()

    /** 진행 중(첫 로드·재조회 모두). 코어는 Loaded를 유지한 채 재조회하므로 phase로는 알 수 없다 — 새로고침 버튼 `stateDescription` 근거. */
    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()
    private var inFlight = 0

    private var hasLoadedOnce = false

    /** pop 복귀 착지 키(공용 슬롯, spec §3-1). */
    val returnFocus = ReturnFocusSlot(savedState)

    /** 화면이 소비한 착지 세대(비저장 — 구성 변경마다 커서가 튀지 않게, 재생성 뒤엔 0부터). */
    var consumedLanding: Int = 0
    private var landingRev = 0
    private var previousFirstKey: String? = null
    private var didLand = false

    private val core = NearbyLoadCore<P>(
        coordinate = coordinate,
        coverage = spec.coverage,
        fetch = { coord, previous -> spec.fetch(coord, previous) },
        willCommit = { reveal.reset(); _visibleCount.value = reveal.visibleCount; groupReveal.clear(); _groupWindows.value = emptyMap() }, // 커밋과 원자
        onEvent = ::onEvent,
    )
    val phase: StateFlow<NearbyLoadPhase<P>> = core.phase

    fun isEmpty(payload: P): Boolean = spec.isEmpty(payload)
    fun emptyCopy(payload: P): String = checkNotNull(spec.emptyCopy) { "isEmpty가 참인데 emptyCopy가 없다(조립기 결함)" }(payload)

    /** 재진입은 코어 가드가 막는다(진행 중 재호출 무시) — 새로고침 버튼을 비활성화하지 않는 근거. */
    fun load(force: Boolean = false) {
        hasLoadedOnce = true
        inFlight += 1 // launch 전에 동기로(버튼 stateDescription이 첫 디스패치를 기다리지 않는다); 겹친 호출은 코어가 무시해도 카운터로 정확
        _isLoading.value = true
        viewModelScope.launch {
            try { core.load(force) } finally { inFlight -= 1; _isLoading.value = inFlight > 0 }
        }
    }

    /** 화면 진입 로드 — 구성 변경(회전) 뒤 재진입은 건너뛴다(재조회 + 통지 재발화 방지, iOS `.task` 동형). */
    fun loadOnEnter() {
        if (!hasLoadedOnce) load()
    }

    /** "더 보기": 공개 수를 늘리고 첫 새 항목에 착지한다. */
    fun revealMore(totalCount: Int, keyAt: (Int) -> String) {
        val firstNew = reveal.revealMore(totalCount) ?: return
        _visibleCount.value = reveal.visibleCount
        _landing.value = Landing.Key(keyAt(firstNew), ++landingRev)
    }

    /** 묶음별 "더 보기"(없는 묶음은 `RevealWindow.initialVisible`부터). 첫 새 항목에 같은 착지 슬롯으로. */
    fun revealMoreInGroup(group: String, totalCount: Int, keyAt: (Int) -> String) {
        val window = groupReveal.getOrPut(group) { RevealWindow() }
        val firstNew = window.revealMore(totalCount) ?: return
        _groupWindows.value = _groupWindows.value + (group to window.visibleCount)
        _landing.value = Landing.Key(keyAt(firstNew), ++landingRev)
    }

    private fun onEvent(event: NearbyLoadEvent<P>) {
        when (event) {
            is NearbyLoadEvent.Loaded -> {
                post(spec.loadedNotice(event.payload))
                val key = spec.firstKey(event.payload)
                if (!didLand && previousFirstKey == null && key != null) {
                    didLand = true
                    _landing.value = Landing.Key(key, ++landingRev)
                }
                previousFirstKey = key
            }
            NearbyLoadEvent.EmptyResult -> Unit // M2 4종은 fetch non-null이라 도달 불가
            NearbyLoadEvent.RefreshFailed -> post(strings.refreshFailed())
            NearbyLoadEvent.PermissionLost -> post(strings.refreshDenied())
            NearbyLoadEvent.AccuracyLost -> post(strings.refreshReduced())
            NearbyLoadEvent.WentOutOfCoverage -> post(strings.outOfCoverage())
        }
    }

    /** 설정 화면을 열 앱이 없을 때(커스텀 안드로이드) — 통지가 유일한 증거. */
    fun notifyNoApp() = post(strings.noAppToOpen())

    /** 통지도 낭독 채널이다 — 낭독형은 거리 단위를 풀어쓰고(iOS `nearbyAnnouncer` 동형) 시각 텍스트는 원문을 지킨다. */
    private fun post(text: String) {
        val spoken = spokenDistanceUnits(text, strings.spokenMeters())
        _notice.value = Notice(_notice.value.seq + 1, text, spoken.takeIf { it != text })
    }
}
