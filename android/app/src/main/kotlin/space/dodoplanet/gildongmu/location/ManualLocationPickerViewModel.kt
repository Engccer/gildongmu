package space.dodoplanet.gildongmu.location

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import space.dodoplanet.gildongmu.AppConfig
import space.dodoplanet.gildongmu.directions.DirectionsFieldTarget
import space.dodoplanet.gildongmu.directions.EndpointPicker
import space.dodoplanet.gildongmu.directions.Strings
import space.dodoplanet.gildongmu.directions.resourceStrings
import space.dodoplanet.gildongmu.i18n.AppLocale
import space.dodoplanet.gildongmu.kit.DirectionsEndpoint
import space.dodoplanet.gildongmu.kit.NearbyCoord
import space.dodoplanet.gildongmu.kit.RecentSearchStore
import space.dodoplanet.gildongmu.kit.SearchService
import space.dodoplanet.gildongmu.kit.isEligibleManualFix
import space.dodoplanet.gildongmu.storage.SharedPreferencesStore

/**
 * 현재 위치 수동 지정 화면의 ViewModel(spec §13-3 — 웹 `ManualLocationPicker.commitManual`·iOS `LocationBarView.commit` 동형).
 * M3의 `EndpointPicker`를 `manualLocation` 타깃으로 열고, 확정의 의미(`onSelect`)를 **`commit`**으로 정한다:
 * - in-flight 가드: 측위가 끝날 때까지 두 번째 확정은 조용히 버린다(연타 무시).
 * - `Current`("현재 위치로 되돌리기") → `manual.clear()` 즉시(측위·통지 0).
 * - `Place` → 권한이 `Fine`일 때만 진행 통지("현재 위치 확인 중", picker의 단일 창구 — 측위가 실제로 일어나는 갈래에서만) +
 *   `currentFix(force = true, silent = false)`를 origin으로(적격 fix만; 실내 8초는 그 통지가 말한다). `Fine`이 아니면 **권한 다이얼로그 없이**
 *   origin null(판정 37). 그 다음 `manual.set` → 그 다음 pop(라벨이 확정된 뒤라 허브 복귀 착지가 결과를 읽는다).
 * - 뒤로(취소)는 `cancel()` — 진행 중 측위 잡을 끊고 `set`은 없다.
 *
 * pop은 콜백이 아니라 `done` 상태다: ViewModel은 액티비티 재생성을 넘어 살아 `NavController`를 붙들면 옛 컨트롤러에 pop하게 된다 —
 * 화면이 `done`을 읽어 자기 `onBack`을 부른다. 지정 중에는 picker를 닫지 않는다(`closesOnSelect = false`) — 통지가 그 화면의 `StatusLine`에서 난다.
 */
class ManualLocationPickerViewModel(
    search: SearchService,
    store: RecentSearchStore,
    private val strings: Strings,
    io: CoroutineDispatcher,
    dataLocale: () -> String,
    ranking: suspend () -> NearbyCoord?,
    private val manual: ManualLocationStore,
    private val location: LocationStore,
    private val now: () -> Double,
) : ViewModel() {
    val picker = EndpointPicker(search, store, strings, io, viewModelScope, dataLocale, ranking, closesOnSelect = false) { endpoint, _ -> commit(endpoint) }

    private val _done = MutableStateFlow(false)
    /** 지정·해제가 끝났다(`set`/`clear` 뒤). 화면이 읽어 pop한다. */
    val done: StateFlow<Boolean> = _done.asStateFlow()

    private var commitJob: Job? = null

    init {
        picker.open(DirectionsFieldTarget.manualLocation)
    }

    private fun commit(endpoint: DirectionsEndpoint) {
        if (commitJob?.isActive == true) return
        commitJob = viewModelScope.launch {
            when (endpoint) {
                DirectionsEndpoint.Current -> manual.clear()
                is DirectionsEndpoint.Place -> {
                    val origin = if (location.authorization() == LocationPermission.Fine) {
                        picker.postNotice(strings.get("manualLocation.locating"))
                        location.currentFix(force = true, silent = false)?.takeIf { isEligibleManualFix(it, now()) }
                    } else {
                        null
                    }
                    manual.set(endpoint.label, endpoint.labelRoman, endpoint.lat, endpoint.lng, origin)
                }
            }
            _done.value = true
        }
    }

    /** 뒤로(취소): 진행 중 측위를 끊는다 — 그 뒤 `set`은 없다(`CancellationException`이 그대로 통과). */
    fun cancel() {
        commitJob?.cancel()
    }
}

/**
 * 지정 화면 ViewModel 팩토리 — 이 패키지가 앱 컨텍스트로 스스로 만든다(길찾기 관용구, Activity 캡처 없음). `LocationStore`는 `location/` 안이라
 * 여기서만 잡는다(판정 38 소스 가드). 문자열·언어는 호출 시점에 읽는다.
 */
fun manualLocationPickerFactory(context: Context): ViewModelProvider.Factory {
    val app = context.applicationContext
    return viewModelFactory {
        initializer {
            ManualLocationPickerViewModel(
                search = SearchService(AppConfig.apiClient),
                store = RecentSearchStore(SharedPreferencesStore(app)),
                strings = resourceStrings(app.resources),
                io = Dispatchers.IO,
                dataLocale = { AppLocale.dataLocale(app.resources) },
                ranking = { AppConfig.effectiveLocation.coordinateForRanking() },
                manual = AppConfig.manualLocationStore,
                location = AppConfig.locationStore,
                now = { System.currentTimeMillis() / 1000.0 },
            )
        }
    }
}
