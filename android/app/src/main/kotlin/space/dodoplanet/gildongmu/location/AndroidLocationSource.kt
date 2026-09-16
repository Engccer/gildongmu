package space.dodoplanet.gildongmu.location

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.location.LocationRequest
import android.os.SystemClock

/**
 * `LocationManager` 구현 — **앱에서 `LocationManager`를 만드는 유일한 자리**(소스 가드 `AppSourceGuardTest`).
 * GMS 의존 0: 융합 제공자는 플랫폼 `FUSED_PROVIDER`(API 31)이고 존재 여부는 `hasProvider`로 스토어가 가른다.
 */
class AndroidLocationSource(context: Context) : LocationSource {
    private val app = context.applicationContext
    private val manager = app.getSystemService(LocationManager::class.java)

    override fun isLocationEnabled(): Boolean = manager.isLocationEnabled

    override fun hasProvider(name: String): Boolean = manager.hasProvider(name)

    @SuppressLint("MissingPermission") // 권한 판정은 LocationStore가 PermissionGate로 먼저 한다
    override fun subscribe(provider: String, onFix: (RawFix) -> Unit): AutoCloseable {
        val listener = LocationListener { location -> onFix(location.toRawFix()) }
        val request = LocationRequest.Builder(1_000L).setQuality(LocationRequest.QUALITY_HIGH_ACCURACY).build()
        manager.requestLocationUpdates(provider, request, app.mainExecutor, listener)
        return AutoCloseable { manager.removeUpdates(listener) }
    }

    override fun elapsedRealtimeMs(): Long = SystemClock.elapsedRealtime()

    private fun Location.toRawFix() = RawFix(
        lat = latitude,
        lng = longitude,
        accuracyMeters = if (hasAccuracy()) accuracy.toDouble() else -1.0,
        elapsedRealtimeMs = elapsedRealtimeNanos / 1_000_000,
    )
}
