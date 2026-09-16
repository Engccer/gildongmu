package space.dodoplanet.gildongmu.location

/** 플랫폼 fix 한 건. `accuracyMeters`는 `Location.hasAccuracy()`가 거짓이면 `-1.0`(README §3 관용구 — :kit `> 0` 가드가 거른다). */
data class RawFix(val lat: Double, val lng: Double, val accuracyMeters: Double, val elapsedRealtimeMs: Long)

/**
 * `LocationManager` 추상(spec §4). 구현은 `AndroidLocationSource` 한 곳뿐이고 JVM 테스트는 페이크를 쓴다.
 * 콜백은 메인 스레드에서 온다.
 */
interface LocationSource {
    fun isLocationEnabled(): Boolean
    fun hasProvider(name: String): Boolean

    /** 갱신 구독 시작. 반환값을 `close`하면 `removeUpdates`. */
    fun subscribe(provider: String, onFix: (RawFix) -> Unit): AutoCloseable
    fun elapsedRealtimeMs(): Long

    companion object {
        const val FUSED = "fused"
        const val GPS = "gps"
        const val NETWORK = "network"
    }
}
