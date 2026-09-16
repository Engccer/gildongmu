package space.dodoplanet.gildongmu.location

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull
import space.dodoplanet.gildongmu.kit.LocationFixPolicy
import space.dodoplanet.gildongmu.kit.NearbyCoord
import space.dodoplanet.gildongmu.kit.NearbyCoordinateSource
import space.dodoplanet.gildongmu.kit.NearbyLocationError
import space.dodoplanet.gildongmu.kit.canReuseCachedFix
import space.dodoplanet.gildongmu.kit.isBetterFix
import space.dodoplanet.gildongmu.kit.isStorableFix
import space.dodoplanet.gildongmu.kit.shouldAcceptFix

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
) {
    data class StoredFix(val lat: Double, val lng: Double, val accuracy: Double, val fixedAtElapsedMs: Long)

    var stored: StoredFix? = null

    /** 시도해서 실패한 상태(확정된 실패, 표시줄 판정 재료 — iOS `lastFixFailed`). */
    var lastFixFailed: Boolean = false
        private set

    /** 기기 위치 서비스 켜짐 여부(화면의 `FailedLocation` 문구 판정용 — `LocationManager` 접근은 `location/`에서만). */
    fun isLocationEnabled(): Boolean = source.isLocationEnabled()

    private fun ageOf(fix: StoredFix): Double = (source.elapsedRealtimeMs() - fix.fixedAtElapsedMs) / 1000.0

    /**
     * 권한 요청(최초 1회 시스템 다이얼로그) + 현재 위치 1회 취득. `force`면 캐시를 버리고 재취득. 실패해도 저장된 좌표는 남는다.
     * 권한 요청은 **내 주변 화면 로드**에서만 여기로 온다(검색 가중은 `coordinateForRanking`).
     */
    suspend fun currentCoordinate(
        force: Boolean = false,
        timeoutMs: Long = (LocationFixPolicy.timeout * 1000).toLong(),
        ttlSeconds: Double = LocationFixPolicy.freshTTL,
        acceptAccuracy: Double = LocationFixPolicy.acceptAccuracy,
    ): NearbyCoord {
        // ⚠ 나이만 보지 않는다 — 저장 상한(100m)이 재사용 기준(30m)보다 느슨하다.
        stored?.let { if (!force && canReuseCachedFix(it.accuracy, ageOf(it), ttlSeconds, acceptAccuracy)) return NearbyCoord(it.lat, it.lng) }

        var permission = permissions.current()
        if (permission == LocationPermission.None) permission = permissions.request()
        when (permission) {
            LocationPermission.None -> throw LocationException(LocationException.Kind.Denied)
            // "대략적인 위치"만 허용 = 1~3km 오차. 그대로 "주변"을 말하면 있지도 않은 정보가 된다 — 별개 상태.
            LocationPermission.Coarse -> { lastFixFailed = true; throw LocationException(LocationException.Kind.ReducedAccuracy) }
            LocationPermission.Fine -> Unit
        }
        // 권한 뒤, 취득 앞(권한 앞에 두면 위치를 켜고 돌아온 뒤에야 권한 다이얼로그가 떠 두 단계 왕복).
        if (!source.isLocationEnabled()) { lastFixFailed = true; throw LocationException(LocationException.Kind.Unavailable) }
        return try {
            acquireGatedFix(timeoutMs, acceptAccuracy).also { lastFixFailed = false }
        } catch (e: LocationException) {
            lastFixFailed = true
            throw e
        }
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
        val subscriptions = providers.map { source.subscribe(it, onFix) }
        try {
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
    suspend fun coordinateForRanking(): NearbyCoord? {
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

    /** :kit 코어 어댑터. 취소는 그대로 통과(`LocationException`만 번역), 어댑터 자신의 타임아웃은 `Unavailable`. */
    fun nearbyCoordinateSource(): NearbyCoordinateSource = NearbyCoordinateSource.Current { force ->
        try {
            currentCoordinate(force)
        } catch (e: LocationException) {
            throw when (e.kind) {
                LocationException.Kind.Denied -> NearbyLocationError.Denied
                LocationException.Kind.ReducedAccuracy -> NearbyLocationError.ReducedAccuracy
                LocationException.Kind.Unavailable -> NearbyLocationError.Unavailable
            }
        }
    }
}
