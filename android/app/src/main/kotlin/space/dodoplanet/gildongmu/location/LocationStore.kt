package space.dodoplanet.gildongmu.location

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withTimeoutOrNull
import space.dodoplanet.gildongmu.kit.LocationFixPolicy
import space.dodoplanet.gildongmu.kit.ManualFix
import space.dodoplanet.gildongmu.kit.NearbyCoord
import space.dodoplanet.gildongmu.kit.canReuseCachedFix
import space.dodoplanet.gildongmu.kit.isBetterFix
import space.dodoplanet.gildongmu.kit.isStorableFix
import space.dodoplanet.gildongmu.kit.shouldAcceptFix

/** 옛 위치(spec 2026-09-23 stale-origin §4.3): 좌표 + 측정 시각(epoch 초). `location` 밖에서도 쓰는 값이라 최상위 타입이다. */
data class StaleFix(val lat: Double, val lng: Double, val fixedAtEpoch: Double)

/** 위치 취득 실패의 세 원인(iOS `LocationError` 미러). 조회 실패와 뭉개지 않는다(3-state). */
class LocationException(val kind: Kind) : Exception(kind.name) {
    enum class Kind { Denied, ReducedAccuracy, Unavailable }
}

/**
 * 현재 위치 공유 스토어(iOS `LocationService` = 웹 geolocation 싱글턴 미러, spec §4). 앱에 하나.
 * 절차는 iOS `currentCoordinate` 그대로: 캐시 재사용 게이트(나이만 보지 않는다) → 권한 → 정밀도 → 기기 위치 서비스 → 게이트 취득.
 * 저장은 fix 수신 지점에서만(수신 시각 도장). 판정 함수는 전부 :kit `LocationFixPolicy`.
 */
class LocationStore(
    private val source: LocationSource,
    private val permissions: PermissionGate,
    private val log: (String) -> Unit = {},
    /** epoch 초 — 판정용 fix의 `at`(:kit `ManualFix`)을 만들 때만 쓴다. */
    private val epochNow: () -> Double = { System.currentTimeMillis() / 1000.0 },
) {
    data class StoredFix(val lat: Double, val lng: Double, val accuracy: Double, val fixedAtElapsedMs: Long)


    var stored: StoredFix? = null
        internal set(value) {
            field = value
            // 좌표가 새로 들어왔다 — 옛 위치를 푼다(단발·타임아웃 최선값 공통, stale-origin §2).
            failedSinceLastStore = false
            publishStale()
        }

    /** 시도해서 실패한 상태(확정된 실패, 표시줄 판정 재료 — iOS `lastFixFailed`). */
    var lastFixFailed: Boolean = false
        private set

    /**
     * 보관 좌표를 마지막으로 쓴 뒤 **취득 실패**(시간 초과·fix 0·기기 위치 꺼짐)가 있었는가(iOS `failedSinceLastStore` 미러). 권한 없음·
     * 대략적 위치·조용한 측위의 실패는 세우지 않는다 — 앞의 둘은 옛 위치로 답하지 않는 상태이고, 조용한 측위는 표시를 흔들지 않는다.
     * 내리는 자리는 `stored` 쓰기 하나다.
     */
    private var failedSinceLastStore = false

    private val _staleChanges = MutableStateFlow<StaleFix?>(null)

    /**
     * 옛 위치의 관찰 채널(표시줄이 구독한다 — `ensureLoaded` 스냅샷만으로는 다른 화면의 성공·실패를 못 따라간다). 값은 옛 위치가 서거나
     * 풀리는 순간의 `staleFix()`이고, 판정 자체는 늘 `staleFix()`가 정본이다(권한은 호출 시점에 다시 본다).
     */
    val staleChanges: StateFlow<StaleFix?> = _staleChanges.asStateFlow()

    /** 옛 위치: 보관 좌표를 쓴 뒤 취득 실패가 있었으면 그 좌표와 측정 시각(epoch 초), 아니면 null(iOS `staleFix` 미러). 권한 `Fine`이 먼저다. */
    fun staleFix(): StaleFix? {
        if (!failedSinceLastStore || permissions.current() != LocationPermission.Fine) return null
        val fix = stored ?: return null
        return StaleFix(fix.lat, fix.lng, epochNow() - ageOf(fix))
    }

    private fun publishStale() {
        val next = staleFix()
        // 측정 시각은 epoch 환산이라 호출마다 미세하게 다르다 — 같은 좌표·같은 옛 위치면 다시 내보내지 않는다.
        val prev = _staleChanges.value
        if (next == null || prev == null || next.lat != prev.lat || next.lng != prev.lng) _staleChanges.value = next
    }

    /** 기기 위치 서비스 켜짐 여부(화면의 `FailedLocation` 문구 판정용 — `LocationManager` 접근은 `location/`에서만). */
    fun isLocationEnabled(): Boolean = source.isLocationEnabled()

    /** 권한 스냅샷(표시줄 판정 재료, spec §12-4). ⚠ `None`은 "거부"가 아니다 — 아직 묻지 않은 상태와 같은 값. */
    fun authorization(): LocationPermission = permissions.current()

    private fun ageOf(fix: StoredFix): Double = (source.elapsedRealtimeMs() - fix.fixedAtElapsedMs) / 1000.0

    /**
     * 권한 요청(최초 1회 시스템 다이얼로그) + 현재 위치 1회 취득. `force`면 캐시를 버리고 재취득. 실패해도 저장된 좌표는 남는다.
     * 권한 요청(시스템 다이얼로그)이 여기로 오는 자리는 **내 주변 화면 진입·길찾기 조회·채팅 첫 전송의 위치 prime**(spec §4 정정) —
     * 검색 가중·표시줄은 `gpsCoordinateForRanking`/`coordinateForDisplay`(권한이 이미 있을 때만, 팝업 없음).
     * `silent` = 화면이 요청하지 않은 측위(수동 위치 판정, spec §13-2): 실패해도 `lastFixFailed`를 세우지 않는다(표시줄의 "이 세션에서
     * 확정된 실패" 정의가 넓어지지 않게). 성공 fix의 `stored` 갱신은 그대로. 앱 층의 좌표 진입점은 `EffectiveLocation`뿐이다(판정 38).
     */
    suspend fun currentCoordinate(
        force: Boolean = false,
        timeoutMs: Long = (LocationFixPolicy.timeout * 1000).toLong(),
        ttlSeconds: Double = LocationFixPolicy.freshTTL,
        acceptAccuracy: Double = LocationFixPolicy.acceptAccuracy,
        silent: Boolean = false,
    ): NearbyCoord {
        // ⚠ 나이만 보지 않는다 — 저장 상한(100m)이 재사용 기준(30m)보다 느슨하다.
        stored?.let { if (!force && canReuseCachedFix(it.accuracy, ageOf(it), ttlSeconds, acceptAccuracy)) return NearbyCoord(it.lat, it.lng) }

        var permission = permissions.current()
        if (permission == LocationPermission.None) permission = permissions.request()
        when (permission) {
            LocationPermission.None -> throw LocationException(LocationException.Kind.Denied)
            // "대략적인 위치"만 허용 = 1~3km 오차. 그대로 "주변"을 말하면 있지도 않은 정보가 된다 — 별개 상태.
            LocationPermission.Coarse -> { if (!silent) lastFixFailed = true; throw LocationException(LocationException.Kind.ReducedAccuracy) }
            LocationPermission.Fine -> Unit
        }
        // 권한 뒤, 취득 앞(권한 앞에 두면 위치를 켜고 돌아온 뒤에야 권한 다이얼로그가 떠 두 단계 왕복).
        if (!source.isLocationEnabled()) { if (!silent) markUnavailable(); throw LocationException(LocationException.Kind.Unavailable) }
        return try {
            acquireGatedFix(timeoutMs, acceptAccuracy).also { lastFixFailed = false }
        } catch (e: LocationException) {
            if (!silent) markUnavailable()
            throw e
        }
    }

    private fun markUnavailable() {
        lastFixFailed = true
        failedSinceLastStore = true
        publishStale()
    }

    /**
     * 판정·지정용 실측 fix(spec §13-2): `currentCoordinate(force, silent)`를 지나 성공하면 `stored`를 `ManualFix`(`at` = epoch 초 − 나이)로,
     * 실패는 null. 취소는 그대로 통과한다.
     */
    suspend fun currentFix(force: Boolean, silent: Boolean): ManualFix? {
        try {
            currentCoordinate(force = force, silent = silent)
        } catch (e: LocationException) {
            return null
        }
        val fix = stored ?: return null
        return ManualFix(fix.lat, fix.lng, fix.accuracy, epochNow() - ageOf(fix))
    }

    /**
     * 정확도·신선도 게이트를 지나는 fix를 기다린다. 상한이면 **이번 호출 안에서** 본 최선값(iOS `oneShotBest`) —
     * 스토어의 옛 값은 폴백 후보가 아니다(낡은 좌표가 "현재 위치"로 나가는 경로). 이번 취득에 fix 0이면 `Unavailable`.
     * `getCurrentLocation`을 쓰지 않는 이유는 iOS `requestLocation`과 같다 — 목표 정확도에 못 미쳐도 한 값을 주고 멈춘다.
     */
    private suspend fun acquireGatedFix(timeoutMs: Long, acceptAccuracy: Double): NearbyCoord {
        val providers = when {
            source.hasProvider(LocationSource.FUSED) -> listOf(LocationSource.FUSED)
            source.hasProvider(LocationSource.GPS) ->
                if (source.hasProvider(LocationSource.NETWORK)) listOf(LocationSource.GPS, LocationSource.NETWORK) else listOf(LocationSource.GPS)
            else -> throw LocationException(LocationException.Kind.Unavailable)
        }
        log("locationProviders=$providers")
        var best: StoredFix? = null
        val accepted = CompletableDeferred<NearbyCoord>()
        val onFix: (RawFix) -> Unit = { raw ->
            val age = (source.elapsedRealtimeMs() - raw.elapsedRealtimeMs) / 1000.0
            if (isStorableFix(raw.accuracyMeters, age)) {
                val fix = StoredFix(raw.lat, raw.lng, raw.accuracyMeters, raw.elapsedRealtimeMs)
                stored = fix
                if (isBetterFix(raw.accuracyMeters, best?.accuracy)) best = fix
            }
            if (shouldAcceptFix(raw.accuracyMeters, age, acceptAccuracy)) accepted.complete(NearbyCoord(raw.lat, raw.lng))
        }
        val subscriptions = ArrayList<AutoCloseable>()
        try {
            providers.forEach { subscriptions += source.subscribe(it, onFix) } // 둘째가 던져도 첫 구독은 finally가 닫는다
            return withTimeoutOrNull(timeoutMs) { accepted.await() }
                ?: best?.let { NearbyCoord(it.lat, it.lng) }
                ?: throw LocationException(LocationException.Kind.Unavailable)
        } finally {
            subscriptions.forEach { it.close() } // 취소·반환·타임아웃 어느 경로든
        }
    }

    /**
     * 검색 순위 가중용. 권한이 없으면 **팝업 없이** null(권한은 내 주변 첫 사용 시점에 묻는다). 짧은 상한·긴 TTL·느슨한
     * 정확도(:kit soft 상수), 실패는 스토어 폴백 — 좌표를 못 얻으면 좌표 없이 검색하는 소비자다.
     */
    suspend fun gpsCoordinateForRanking(): NearbyCoord? {
        if (permissions.current() != LocationPermission.Fine) return null
        return try {
            currentCoordinate(
                timeoutMs = (LocationFixPolicy.softTimeout * 1000).toLong(),
                ttlSeconds = LocationFixPolicy.softTTL,
                acceptAccuracy = LocationFixPolicy.storeCeiling,
            )
        } catch (e: LocationException) {
            stored?.let { NearbyCoord(it.lat, it.lng) }
        }
    }

    /**
     * 표시용 좌표(iOS `coordinateForDisplay`, spec §12-4): 권한 `Fine`이 아니면 null(팝업 없음 — `Coarse`도 시도하지 않는다), soft 상한,
     * **TTL·정확도는 기본값**(60초·30m), 실패는 **null — `stored` 폴백 없음**. `coordinateForRanking`과 세 축이 다르다: 이 좌표는 역지오코딩돼
     * "현재 위치, 〈주소〉"로 낭독되므로 낡은 좌표의 주소는 화면으로 반증할 수 없는 거짓 위치 주장이다(아침 좌표가 점심에 "현재 위치"로).
     */
    suspend fun coordinateForDisplay(): NearbyCoord? {
        if (permissions.current() != LocationPermission.Fine) return null
        return try {
            currentCoordinate(timeoutMs = (LocationFixPolicy.softTimeout * 1000).toLong())
        } catch (e: LocationException) {
            null
        }
    }

}
