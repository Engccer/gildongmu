package space.dodoplanet.gildongmu.directions

import androidx.navigation.NavController
import androidx.navigation.NavGraph.Companion.findStartDestination
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import space.dodoplanet.gildongmu.nav.DirectionsRoute

/**
 * 장소 상세 → 길찾기 탭 프리필 계약(spec §5, iOS `DirectionsPrefill{role, endpoint}` 미러). "여기까지 길찾기"는
 * `to`, "여기부터 길찾기"는 `from`. 끝점은 언제나 장소다(현재 위치는 프리필로 오지 않는다).
 */
enum class DirectionsPrefillRole { from, to }

data class DirectionsPrefill(
    val role: DirectionsPrefillRole,
    val label: String,
    val lat: Double,
    val lng: Double,
    /** `Place.nameRoman`(E28 병기). 없으면 null. */
    val labelRoman: String? = null,
)

/**
 * 1회 소비 스토어(iOS `DirectionsPrefillStore` 동형). 라우트 인자가 아닌 이유는 spec §5 — 탭 루트 `DirectionsRoute`는
 * `nav/` 소유 `data object`이고, `restoreState`가 저장 백스택을 복원할 때 새 인자의 우선순위가 미확인이다.
 * `StateFlow`인 이유: 길찾기 `ViewModel`이 살아 있으면 값이 오는 **즉시** 소비한다(탭이 이미 보이는 상태에서 불려
 * 재컴포지션이 없어도 남는 값이 없다). ViewModel이 아직 없으면 현재 값이 재생돼 init에서 소비된다.
 */
object DirectionsPrefillStore {
    private val _pending = MutableStateFlow<DirectionsPrefill?>(null)
    val pending: StateFlow<DirectionsPrefill?> = _pending.asStateFlow()

    fun offer(prefill: DirectionsPrefill) {
        _pending.value = prefill
    }

    /** 가져가기 — 같은 값일 때만 비운다(두 소비자가 겹쳐도 한 번만 참). */
    fun take(prefill: DirectionsPrefill): Boolean = _pending.compareAndSet(prefill, null)
}

/**
 * 길찾기 탭으로 전환하며 프리필을 넘긴다 — M2 장소 상세가 부르는 유일한 API. 탭 전환 옵션은 `AppRoot`의
 * 하단 탭과 같다(탭별 백스택 보존).
 */
fun NavController.openDirections(prefill: DirectionsPrefill) {
    DirectionsPrefillStore.offer(prefill)
    navigate(DirectionsRoute) {
        popUpTo(graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}
