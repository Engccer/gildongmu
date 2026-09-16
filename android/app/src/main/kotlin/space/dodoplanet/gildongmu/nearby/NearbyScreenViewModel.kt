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
    val fetch: suspend (NearbyCoord?) -> P,
    val isEmpty: (P) -> Boolean,
    /** 첫 로드 착지 키. null → non-null 전이가 곧 "목록이 처음 생겼다"(iOS `nearbyFocusOnLoad`). */
    val firstKey: (P) -> String?,
    val loadedNotice: (P) -> String,
    val emptyCopy: () -> String,
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

    /** 화면이 소비한 착지 세대(비저장 — 구성 변경마다 커서가 튀지 않게, 재생성 뒤엔 0부터). */
    var consumedLanding: Int = 0
    private var landingRev = 0
    private var previousFirstKey: String? = null
    private var didLand = false

    private val core = NearbyLoadCore<P>(
        coordinate = coordinate,
        coverage = spec.coverage,
        fetch = { coord, _ -> spec.fetch(coord) },
        willCommit = { reveal.reset(); _visibleCount.value = reveal.visibleCount }, // 커밋과 원자
        onEvent = ::onEvent,
    )
    val phase: StateFlow<NearbyLoadPhase<P>> = core.phase

    fun isEmpty(payload: P): Boolean = spec.isEmpty(payload)
    fun emptyCopy(): String = spec.emptyCopy()

    /** 재진입은 코어 가드가 막는다(진행 중 재호출 무시) — 새로고침 버튼을 비활성화하지 않는 근거. */
    fun load(force: Boolean = false) {
        viewModelScope.launch { core.load(force) }
    }

    /** "더 보기": 공개 수를 늘리고 첫 새 항목에 착지한다. */
    fun revealMore(totalCount: Int, keyAt: (Int) -> String) {
        val firstNew = reveal.revealMore(totalCount) ?: return
        _visibleCount.value = reveal.visibleCount
        _landing.value = Landing.Key(keyAt(firstNew), ++landingRev)
    }

    /** pop 복귀 착지 키(spec §3-1). 저장은 `SavedStateHandle`, 소비는 한 번(착지 시도 시 무조건 지운다). */
    fun rememberReturnFocus(key: String) {
        savedState[RETURN_FOCUS_KEY] = key
    }

    fun takeReturnFocus(): String? {
        val key = savedState.get<String>(RETURN_FOCUS_KEY)
        savedState.remove<String>(RETURN_FOCUS_KEY)
        return key
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

    private fun post(text: String) {
        _notice.value = Notice(_notice.value.seq + 1, text)
    }

    companion object {
        const val RETURN_FOCUS_KEY = "returnFocus"
    }
}
