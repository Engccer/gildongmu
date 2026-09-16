package space.dodoplanet.gildongmu.location

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.util.Log
import kotlinx.coroutines.CompletableDeferred

/** Android 12 이후 위치 권한 3-state: 정확한 위치 / 대략적인 위치만 / 없음. */
enum class LocationPermission { Fine, Coarse, None }

/**
 * 권한 게이트(spec §4). `request()`는 시스템 다이얼로그(FINE+COARSE 동시) 뒤 재판정한다 — 영구 거부라 시스템이
 * 다이얼로그를 띄우지 않으면 즉시 `None`. "처음 묻기"를 따로 추적하지 않는다(요청은 멱등).
 */
interface PermissionGate {
    fun current(): LocationPermission
    suspend fun request(): LocationPermission
}

/**
 * 대기 슬롯을 **앱 싱글턴이 쥔다**(iOS `authContinuations` 동형): Activity는 "요청을 띄우는 손"(`attach`)과
 * "결과를 전달하는 손"(`deliver`)만 등록·해제한다. 다이얼로그 중 Activity가 재생성되면 새 Activity의
 * `ActivityResultRegistry` 콜백이 같은 슬롯을 재개한다. 프로세스 재생성 뒤 도착한 결과는 대기자가 없다 — 로그만
 * 남기고 버린다(화면 `load()`가 `checkSelfPermission`으로 다시 판정한다).
 */
class AndroidPermissionGate(context: Context) : PermissionGate {
    private val app = context.applicationContext
    private var launch: ((Array<String>) -> Unit)? = null
    private val waiters = ArrayList<CompletableDeferred<LocationPermission>>()

    override fun current(): LocationPermission = when {
        granted(Manifest.permission.ACCESS_FINE_LOCATION) -> LocationPermission.Fine
        granted(Manifest.permission.ACCESS_COARSE_LOCATION) -> LocationPermission.Coarse
        else -> LocationPermission.None
    }

    override suspend fun request(): LocationPermission {
        val launcher = launch ?: return current() // 손이 없다(Activity 없음) — 묻지 못하니 현재값
        val deferred = CompletableDeferred<LocationPermission>()
        val first = waiters.isEmpty()
        waiters += deferred
        if (first) launcher(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
        return deferred.await()
    }

    fun attach(launch: (Array<String>) -> Unit) {
        this.launch = launch
    }

    fun detach() {
        launch = null
    }

    /** 시스템 결과 도착. 값은 결과 맵이 아니라 `checkSelfPermission` 재판정(맵은 요청한 둘만 담고 "대략" 선택을 구분하지 못한다). */
    fun deliver() {
        if (waiters.isEmpty()) {
            Log.i("Location", "권한 결과가 왔지만 대기자가 없다(프로세스 재생성) — 버린다")
            return
        }
        val result = current()
        val pending = ArrayList(waiters)
        waiters.clear()
        pending.forEach { it.complete(result) }
    }

    private fun granted(permission: String) = app.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
}
