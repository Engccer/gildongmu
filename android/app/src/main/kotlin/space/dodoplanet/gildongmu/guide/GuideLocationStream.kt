package space.dodoplanet.gildongmu.guide

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.location.LocationRequest

/**
 * 안내 전용 연속 위치 스트림(spec §4-2, iOS `LocationService.startBeaconUpdates` 대응). 전경 서비스가 열고 닫는다.
 *
 * `LocationStore`(M2 단발 취득)와 별개 리스너인 이유: 속도·방위·`elapsedRealtimeNanos`를 실은 페이로드가 필요하고 수명이
 * 서비스에 결박된다. `LocationManager`는 리스너마다 독립 요청을 받으므로 두 스트림이 한 매니저에 공존한다(iOS 단일 매니저
 * 프로파일 경합이 없다). `LocationManager` 생성 자리는 `AndroidLocationSource`와 여기 둘뿐(`AppSourceGuardTest` 허용 목록).
 *
 * provider는 `FUSED` → 없으면 **`GPS` 단독**(NETWORK 병행 금지 — 안내 수용 술어 `isUsableFix`는 정확도 상한이 없고 조이는 것이
 * 금지라 1,500m fix가 그대로 추세·거리에 실린다. M2 단발 취득은 30m 게이트가 있어 무사한 것이다). 거리 필터는 끈다(데드밴드가 이미 필터).
 */
class GuideLocationStream(context: Context) {
    private val app = context.applicationContext
    private val manager = app.getSystemService(LocationManager::class.java)
    private var listener: LocationListener? = null

    /** 스트림을 연다. provider가 하나도 없으면 false(호출부가 제공자 꺼짐과 같은 경로로 접는다). */
    @SuppressLint("MissingPermission") // 권한은 WalkGuideModel.start ②가 먼저 판정하고 startForeground가 그 뒤다
    fun open(onFix: (GuideFixPayload) -> Unit, onProviderDisabled: () -> Unit): Boolean {
        val provider = when {
            manager.hasProvider(LocationManager.FUSED_PROVIDER) -> LocationManager.FUSED_PROVIDER
            manager.hasProvider(LocationManager.GPS_PROVIDER) -> LocationManager.GPS_PROVIDER
            else -> return false
        }
        val l = object : LocationListener {
            override fun onLocationChanged(location: Location) = onFix(location.toGuideFix())
            override fun onProviderDisabled(p: String) = onProviderDisabled()
            override fun onProviderEnabled(p: String) = Unit // 세션은 이미 끝났다(§4-2)
        }
        listener = l
        GuideDiag.log("stream provider=$provider")
        val request = LocationRequest.Builder(1_000L)
            .setQuality(LocationRequest.QUALITY_HIGH_ACCURACY)
            .setMinUpdateDistanceMeters(0f)
            .build()
        manager.requestLocationUpdates(provider, request, app.mainExecutor, l)
        return true
    }

    fun close() {
        listener?.let(manager::removeUpdates)
        listener = null
    }
}

internal fun Location.toGuideFix(): GuideFixPayload = guideFixPayload(
    latitude, longitude,
    hasAccuracy(), accuracy,
    hasSpeed(), speed,
    hasSpeedAccuracy(), speedAccuracyMetersPerSecond,
    hasBearing(), bearing,
    hasBearingAccuracy(), bearingAccuracyDegrees,
    elapsedRealtimeNanos,
)
