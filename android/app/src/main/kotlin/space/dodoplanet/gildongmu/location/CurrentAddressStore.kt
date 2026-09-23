package space.dodoplanet.gildongmu.location

import androidx.annotation.MainThread
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import space.dodoplanet.gildongmu.kit.NearbyCoord
import space.dodoplanet.gildongmu.kit.SearchService
import java.util.Locale

/**
 * 현재 위치(GPS) 좌표의 대표 주소 캐시(iOS `CurrentAddressStore`·웹 `current-address-store.ts` 미러, spec §12-4). 앱 싱글턴 —
 * 화면을 오가도 조회는 좌표당 1회다.
 *
 * **좌표당·언어당 1회이고 재시도하지 않는다.** 실패·미매칭도 그 좌표의 확정 결과로 기록해 다시 조회하지 않는다. 주소는 부가 정보이므로
 * 모르면 라벨이 "현재 위치"로 남는 것이 정답이고(3-state), 재시도 루프는 라벨을 뒤늦게 바꿔 재낭독만 만든다.
 * ⚠ 좌표가 바뀌면 옛 주소를 먼저 버린다 — 새 좌표에 옛 주소를 붙여 두면 화면으로 반증할 수 없는 거짓 위치 주장이 된다.
 *
 * `state`는 표시줄이 읽는 스냅샷(관찰 채널) — `LocationStore`의 권한·좌표·실패 표식은 관찰 불가 필드라 `ensureLoaded`가 찍는다.
 */
class CurrentAddressStore(private val location: LocationStore, private val search: SearchService) {
    // 호출은 메인 스레드에서만(`inflight`·`LocationStore` 필드 읽기가 그 위에 선다 — iOS `@MainActor` 동형). 유일한 호출부는 `LaunchedEffect`.
    private val _state = MutableStateFlow(snapshot(null, null, null))
    val state: StateFlow<LocationBarInput> = _state.asStateFlow()

    /** 주소가 확정된 좌표·언어의 키. 조회 중복 판정에만 쓴다. */
    private var loadedKey: String? = null
    private var inflight = false

    private fun snapshot(address: String?, english: String?, staleFixAtEpoch: Double?) =
        LocationBarInput(location.authorization(), location.stored != null, location.lastFixFailed, address, english, staleFixAtEpoch)

    /** 옛 위치의 관찰 채널(`LocationStore.staleChanges`) — 표시줄이 구독해 `syncFromStore`를 부른다. */
    val staleChanges: StateFlow<StaleFix?> get() = location.staleChanges

    /**
     * 표시용 좌표의 주소를 확보한다. 좌표는 `coordinateForDisplay()`가 준다 — 이미 허용된 세션에서만 값을 돌려주므로 허브 진입만으로
     * 권한 팝업이 뜨지 않는다(판정 28). 미허용·실패면 `loadedKey`를 세우지 않는다(나중에 허용되면 그때 조회된다).
     * 표시용 좌표가 없고 직전 측위가 취득 실패였으면 옛 위치 좌표로 잇는다(spec 2026-09-23 stale-origin §4.3) — 그 주소는 옛 위치
     * 문장으로만 표시된다(`coordinateForDisplay`의 "낡은 좌표 금지"는 그대로).
     */
    @MainThread
    suspend fun ensureLoaded(lang: String) {
        if (inflight) return
        inflight = true
        try {
            val fresh = location.coordinateForDisplay()
            val stale = if (fresh == null) location.staleFix() else null
            resolve(fresh ?: stale?.let { NearbyCoord(it.lat, it.lng) }, stale?.fixedAtEpoch, lang)
        } finally {
            inflight = false
        }
    }

    /**
     * 옛 위치가 서거나 풀렸을 때(다른 화면의 측위 성공·실패) **측위 없이** 스냅샷과 주소를 다시 맞춘다. 여기서 다시 재면 실패·성공이
     * 번갈아 서로를 부르는 측위 반복이 된다. 옛 위치면 그 좌표, 풀렸으면 방금 쓰인 보관 좌표(권한 `Fine`일 때만)의 주소다.
     */
    @MainThread
    suspend fun syncFromStore(lang: String) {
        if (inflight) return
        inflight = true
        try {
            val stale = location.staleFix()
            val coord = stale?.let { NearbyCoord(it.lat, it.lng) }
                ?: location.stored?.takeIf { location.authorization() == LocationPermission.Fine }?.let { NearbyCoord(it.lat, it.lng) }
            resolve(coord, stale?.fixedAtEpoch, lang)
        } finally {
            inflight = false
        }
    }

    private suspend fun resolve(coord: NearbyCoord?, staleAt: Double?, lang: String) {
        if (coord == null) {
            _state.value = snapshot(_state.value.address, _state.value.english, null)
            return
        }
        // 캐시 키. 4자리 약 ±5.5m — GPS 오차보다 작아 같은 자리의 재조회를 만들지 않으면서, 실제로 움직였으면 키가 갈린다.
        val key = String.format(Locale.ROOT, "%.4f,%.4f|%s", coord.lat, coord.lng, lang)
        if (key == loadedKey) {
            _state.value = snapshot(_state.value.address, _state.value.english, staleAt)
            return
        }
        // 좌표가 갈렸으면 새 주소가 오기 전에 옛 주소를 버린다(옛 위치 문장에도 다른 좌표의 주소를 싣지 않는다).
        _state.value = snapshot(null, null, staleAt)
        val resolved = try {
            search.reverseGeocode(coord.lat, coord.lng, lang)
        } catch (e: CancellationException) {
            throw e // ⚠ 취소는 "그 좌표를 확정했다"가 아니다 — 확정은 결과가 실제로 도착했을 때만
        } catch (e: Exception) {
            null
        }
        loadedKey = key
        val address = resolved?.address
        _state.value = snapshot(address, if (address == null) null else resolved.english, staleAt)
    }
}
