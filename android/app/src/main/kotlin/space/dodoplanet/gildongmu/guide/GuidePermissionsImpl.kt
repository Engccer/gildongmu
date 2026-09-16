package space.dodoplanet.gildongmu.guide

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import kotlinx.coroutines.CompletableDeferred
import space.dodoplanet.gildongmu.AppConfig
import space.dodoplanet.gildongmu.location.LocationPermission

/**
 * 안내 권한 손(spec §3-4). 위치는 M2 손(`AppConfig.permissionGate`·`locationStore`)을 그대로 지나고, 알림(33+)·걸음 센서는 자기
 * 대기 슬롯을 든다(`AndroidPermissionGate` 동형 — `GuideBottomBar` 컴포지션이 `rememberLauncherForActivityResult`로 `attach/deliver`를
 * 붙인다. `MainActivity`는 android-m1 소유라 건드리지 않는다). 거부는 둘 다 차단이 아니다.
 */
class GuidePermissionsImpl(context: Context) : GuidePermissions {
    private val app = context.applicationContext
    private var launch: ((Array<String>) -> Unit)? = null
    /** 대기 중인 다이얼로그(권한, 완료 신호) — 다른 권한의 요청은 그 다이얼로그가 끝난 뒤 자기 것을 띄운다. */
    private var waiter: Pair<String, CompletableDeferred<Unit>>? = null

    override fun isLocationEnabled(): Boolean = AppConfig.locationStore.isLocationEnabled()
    override fun currentLocation(): LocationPermission = AppConfig.permissionGate.current()
    override suspend fun requestLocation(): LocationPermission = AppConfig.permissionGate.request()

    override suspend fun requestNotifications() {
        if (Build.VERSION.SDK_INT < 33) return
        if (granted(Manifest.permission.POST_NOTIFICATIONS)) return
        ask(Manifest.permission.POST_NOTIFICATIONS)
    }

    override suspend fun requestActivityRecognition(): Boolean {
        if (granted(Manifest.permission.ACTIVITY_RECOGNITION)) return true
        ask(Manifest.permission.ACTIVITY_RECOGNITION)
        return granted(Manifest.permission.ACTIVITY_RECOGNITION)
    }

    /** 다이얼로그 1회 — 손이 없으면(Activity 없음) 묻지 못하니 그대로 돌아온다. 동시 요청은 같은 결과를 기다린다. */
    private suspend fun ask(permission: String) {
        val launcher = launch ?: return
        val existing = waiter
        if (existing != null) {
            existing.second.await()
            if (existing.first == permission) return
        }
        val deferred = CompletableDeferred<Unit>()
        waiter = permission to deferred
        launcher(arrayOf(permission))
        try { deferred.await() } finally { if (waiter?.second === deferred) waiter = null }
    }

    fun attach(launch: (Array<String>) -> Unit) { this.launch = launch }
    fun detach() { launch = null }

    /** 시스템 결과 도착 — 값은 결과 맵이 아니라 `checkSelfPermission` 재판정. */
    fun deliver() {
        val pending = waiter ?: return
        waiter = null
        pending.second.complete(Unit)
    }

    private fun granted(permission: String) = app.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
}
